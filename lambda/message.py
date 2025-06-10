import os
import json
import boto3

# api management
client = boto3.client(
    "apigatewaymanagementapi", endpoint_url=os.environ["ENDPOINT_URL"]
)

def handler(event, context):
    print(event)

    body = json.loads(event["body"])
    payload = {"peer": event["requestContext"]["connectionId"], "event": body["event"], "data": body["data"]}
    client.post_to_connection(Data = json.dumps(payload), ConnectionId=body["connectionId"])

    return { "statusCode": 200 }
