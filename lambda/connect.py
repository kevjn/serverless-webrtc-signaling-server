import os
import boto3

ddb = boto3.resource("dynamodb")
table = ddb.Table(os.environ["TABLE_NAME"])

# TODO: add room
def handler(event, context):
    print(event)

    try:
        table.put_item(
            Item={ "ConnectionId": event["requestContext"]["connectionId"] }
        )
    except:
        pass

    return { "statusCode": 200 }
