import os
import boto3
import json

client = boto3.client("apigatewaymanagementapi", endpoint_url=os.environ["ENDPOINT_URL"])

ddb = boto3.resource("dynamodb")
table = ddb.Table(os.environ["TABLE_NAME"])

# TODO: add room
def handler(event, context):
    print(event)

    src = event["requestContext"]["connectionId"]

    # announce presence to all other peers
    response = table.scan(FilterExpression=boto3.dynamodb.conditions.Attr("ConnectionId").ne(src))
    for peer in response["Items"]:
        dst = peer["ConnectionId"]

        message = { "event": "add-peer", "peer": src, "polite": False }
        client.post_to_connection(Data = json.dumps(message), ConnectionId = dst)

        message = { "event": "add-peer", "peer": dst, "polite": True }
        client.post_to_connection(Data = json.dumps(message), ConnectionId = src)

    return { "statusCode": 200 }
