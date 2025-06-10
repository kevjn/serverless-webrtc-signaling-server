import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { aws_dynamodb, aws_iam, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Effect } from "aws-cdk-lib/aws-iam";

class Stack extends cdk.Stack {

    pythonFunction(name: string, handler: string, env: { [key: string]: string }, props?: cdk.aws_lambda.FunctionOptions): cdk.aws_lambda.Function {
        return new lambda.Function(this, name, {
            functionName: name,
            code: lambda.Code.fromAsset("./lambda"),
            handler: handler,
            runtime: lambda.Runtime.PYTHON_3_11,
            timeout: Duration.seconds(300),
            memorySize: 256,
            environment: env,
            ...props
        })
    }

    functionIntegration(name: string, api: cdk.aws_apigatewayv2.CfnApi, role: cdk.aws_iam.Role, functionArn: string): cdk.aws_apigatewayv2.CfnIntegration {
        return new apigwv2.CfnIntegration(
            this,
            name,
            {
                apiId: api.ref,
                integrationType: "AWS_PROXY",
                integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${functionArn}/invocations`,
                credentialsArn: role.roleArn
            }
        )
    }

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props)

        // ECR can be used to run lambda functions as docker container
        /*
        const fn = new lambda.DockerImageFunction(this, "DockerFunc", {
            code: lambda.DockerImageCode.fromImageAsset("../image"),
            memorySize: 1024,
            timeout: cdk.Duration.seconds(10),
        })
        */

        const api = new apigwv2.CfnApi(this, "ApiGwSocket", {
            name: "ApiGwSocket",
            protocolType: "WEBSOCKET",
            routeSelectionExpression: "$request.body.action"
        })

        const table = new aws_dynamodb.Table(this, "ConnectionIdTable", {
            tableName: "ConnectionIdTable",
            partitionKey: {
                name: "ConnectionId",
                type: aws_dynamodb.AttributeType.STRING
            },
            readCapacity: 5,
            writeCapacity: 5,
            removalPolicy: RemovalPolicy.DESTROY
        })

        // connect lambda
        const connectFunc = this.pythonFunction("ConnectFunc", "connect.handler", { TABLE_NAME: table.tableName })
        table.grantWriteData(connectFunc)

        // disconnect lambda
        const disconnectFunc = this.pythonFunction("DisconnectFunc", "disconnect.handler", { TABLE_NAME: table.tableName })
        table.grantWriteData(disconnectFunc)

        // message lambda
        const messageFunc = this.pythonFunction(
            "MessageFunc",
            "message.handler",
            {
                ENDPOINT_URL: `https://${api.ref}.execute-api.${this.region}.amazonaws.com/dev`
            },
            {
                initialPolicy: [
                    new cdk.aws_iam.PolicyStatement({
                        effect: Effect.ALLOW,
                        // send message to apigw - role
                        actions: ["execute-api:manageConnections"],
                        resources: ["*"]
                    })
                ]
            }
        )

        // announce lambda
        const announceFunc = this.pythonFunction(
            "AnnounceFunc",
            "announce.handler",
            {
                TABLE_NAME: table.tableName,
                ENDPOINT_URL: `https://${api.ref}.execute-api.${this.region}.amazonaws.com/dev`
            },
            {
                initialPolicy: [
                    new cdk.aws_iam.PolicyStatement({
                        effect: Effect.ALLOW,
                        // send message to apigw - role
                        actions: ["execute-api:manageConnections"],
                        resources: ["*"]
                    })
                ]
            }
        )
        table.grantReadWriteData(announceFunc)

        const functions = [connectFunc, disconnectFunc, messageFunc, announceFunc]

        // role for apigw to invoke lambda
        const role = new aws_iam.Role(this, "RoleForApiGwInvokeLambda", {
            roleName: "InvokeLambdaRoleForApiGw",
            assumedBy: new aws_iam.ServicePrincipal("apigateway.amazonaws.com"),
        })
        role.addToPolicy(
            new aws_iam.PolicyStatement({
                effect: Effect.ALLOW,
                resources: functions.map((it) => it.functionArn),
                actions: ["lambda:InvokeFunction"]
            })
        )

        // Lambda integrations
        const connectIntegration = this.functionIntegration("ConnectFuncIntegration", api, role, connectFunc.functionArn)
        const disconnectIntegration = this.functionIntegration("DisconnectFuncIntegration", api, role, disconnectFunc.functionArn)
        const messageIntegration = this.functionIntegration("MessageFuncIntegration", api, role, messageFunc.functionArn)
        const announceIntegration = this.functionIntegration("AnnounceFuncIntegration", api, role, announceFunc.functionArn)

        // routes
        const connectRoute = new apigwv2.CfnRoute(this, "ConnectRoute", {
            apiId: api.ref,
            routeKey: "$connect",
            authorizationType: "NONE",
            target: `integrations/${connectIntegration.ref}`
        })

        const disconnectRoute = new apigwv2.CfnRoute(this, "DisconnectRoute", {
            apiId: api.ref,
            routeKey: "$disconnect",
            authorizationType: "NONE",
            target: `integrations/${disconnectIntegration.ref}`
        })

        const messageRoute = new apigwv2.CfnRoute(this, "MessageRoute", {
            apiId: api.ref,
            routeKey: "message",
            authorizationType: "NONE",
            target: `integrations/${messageIntegration.ref}`
        })

        const announceRoute = new apigwv2.CfnRoute(this, "AnnounceRoute", {
            apiId: api.ref,
            routeKey: "announce",
            authorizationType: "NONE",
            target: `integrations/${announceIntegration.ref}`
        })

        // deployment stage
        const deployment = new apigwv2.CfnDeployment(this, "deployment", { apiId: api.ref })
        new apigwv2.CfnStage(this, "DevStage", {
            stageName: "dev",
            deploymentId: deployment.ref,
            apiId: api.ref,
            autoDeploy: true
        })
        
        // need four routes ready before deployment
        deployment.node.addDependency(connectRoute, disconnectRoute, messageRoute, announceRoute)

        // output
        new cdk.CfnOutput(this, "endpointUrl", {
            exportName: "wssEndpoint",
            value: `wss://${api.ref}.execute-api.${this.region}.amazonaws.com/dev`
        })
    }
}

const app = new cdk.App();
new Stack(app, 'DockerLambdaAwsStack', {})
