import os
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv()

S3_ENDPOINT = os.getenv("S3_ENDPOINT")
S3_REGION = os.getenv("S3_REGION")
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME")
S3_UPLOAD_FOLDER = os.getenv("S3_UPLOAD_FOLDER").strip("/")


s3 = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    region_name=S3_REGION,
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
)

# Create a local test file
local_file = "hello.txt"
Path(local_file).write_text("Hello from boto3!")

object_key = f"{S3_UPLOAD_FOLDER}/{local_file}"

print(f"Uploading to s3://{S3_BUCKET_NAME}/{object_key}")

try:
    s3.upload_file(local_file, S3_BUCKET_NAME, object_key)
    print("✅ Upload successful")

except ClientError as e:
    print("❌ Upload failed")
    print(e)
    raise

print()

# List files
print("Listing objects...")

try:
    response = s3.list_objects_v2(
        Bucket=S3_BUCKET_NAME,
        Prefix=S3_UPLOAD_FOLDER + "/"
    )

    if "Contents" not in response:
        print("Folder is empty.")
    else:
        for obj in response["Contents"]:
            print(obj["Key"])

except ClientError as e:
    print("❌ List failed")
    print(e)