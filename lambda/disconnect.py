import os
import boto3

ddb = boto3.resource("dynamodb")
table = ddb.Table(os.environ["TABLE_NAME"])

def handler(event, context):
    print(event)

    try:
        table.delete_item(
            Key={ "ConnectionId": event["requestContext"]["connectionId"] }
        )
    except:
        pass

    return { "statusCode": 200 }
