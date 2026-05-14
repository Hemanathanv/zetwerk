import os
import re
import uuid
from datetime import datetime
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env", override=True)


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name, default)
    return value.strip().strip('"').strip("'") if value else value


S3_ENDPOINT = _env("S3_ENDPOINT")
S3_ACCESS_KEY = _env("S3_ACCESS_KEY") or _env("S3_APP_ACCESS")
S3_SECRET_KEY = _env("S3_SECRET_KEY") or _env("S3_APP_SECRET")
S3_ADMIN_ACCESS = _env("S3_ADMIN_ACCESS")
S3_ADMIN_SECRET = _env("S3_ADMIN_SECRET")
S3_REGION = _env("S3_REGION", "us-east-1")
DEFAULT_BUCKET = _env("S3_DEFAULT_BUCKET")
S3_KEY_PREFIX = (_env("VOL_DIR_UUID") or _env("S3_KEY_PREFIX", "") or "").strip("/\\")

for key, value in {
    "S3_ENDPOINT": S3_ENDPOINT,
    "S3_ACCESS_KEY": S3_ACCESS_KEY,
    "S3_SECRET_KEY": S3_SECRET_KEY,
}.items():
    if not value:
        raise RuntimeError(f"Missing {key} in backend/.env")


def _client(access: str, secret: str):
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        region_name=S3_REGION,
    )


s3 = _client(S3_ACCESS_KEY, S3_SECRET_KEY)
s3_admin = _client(S3_ADMIN_ACCESS, S3_ADMIN_SECRET) if (S3_ADMIN_ACCESS and S3_ADMIN_SECRET) else None


def _is_access_denied(err: ClientError) -> bool:
    return err.response.get("Error", {}).get("Code", "") in {"AccessDenied", "Forbidden", "403"}


def normalize_bucket_name(bucket: str) -> str:
    normalized = (bucket or "").strip().lower()

    if normalized.startswith("s3://"):
        normalized = normalized[5:]

    if "://" in normalized:
        normalized = normalized.split("://", 1)[1]

    normalized = normalized.split("/", 1)[0]
    normalized = normalized.split(":", 1)[0]
    normalized = normalized.replace("_", "-")
    normalized = re.sub(r"[^a-z0-9.-]+", "-", normalized)
    normalized = re.sub(r"[.-]{2,}", "-", normalized)
    normalized = normalized.strip("-.")

    if len(normalized) < 3:
        normalized = f"bucket-{normalized}" if normalized else ""

    if len(normalized) > 63:
        normalized = normalized[:63].rstrip("-.")

    return normalized


def validate_bucket_name(bucket: str) -> str | None:
    if not bucket:
        return "Bucket name is required"

    if len(bucket) < 3 or len(bucket) > 63:
        return "Bucket name must be between 3 and 63 characters"

    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]*[a-z0-9]", bucket):
        return "Bucket name must use lowercase letters, numbers, dots, or hyphens, and start/end with a letter or number"

    if ".." in bucket or ".-" in bucket or "-." in bucket:
        return "Bucket name cannot contain adjacent dots or mixed dot-hyphen separators"

    return None


def _ensure_bucket(bucket: str) -> None:
    client = s3_admin or s3
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError as err:
        code = err.response.get("Error", {}).get("Code", "")
        if code in {"404", "NoSuchBucket", "NotFound"}:
            client.create_bucket(Bucket=bucket)
        elif _is_access_denied(err):
            try:
                client.create_bucket(Bucket=bucket)
            except ClientError as create_err:
                if create_err.response["Error"]["Code"] not in {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"}:
                    raise
        else:
            raise


def build_object_key(file_name: str, module: str, timestamp: datetime | None = None) -> str:
    now = timestamp or datetime.now()
    date_prefix = now.strftime("%Y/%m/%d")
    key_prefix = f"{S3_KEY_PREFIX}/" if S3_KEY_PREFIX else ""
    safe_name = Path(file_name or "upload").name
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", safe_name)
    return f"{key_prefix}{module}/{date_prefix}/{uuid.uuid4()}_{safe_name}"


def upload_bytes(
    *,
    body: bytes,
    bucket: str,
    object_key: str,
    content_type: str,
) -> None:
    _ensure_bucket(bucket)

    try:
        s3.put_object(Bucket=bucket, Key=object_key, Body=body, ContentType=content_type)
    except ClientError as err:
        if not _is_access_denied(err) or s3_admin is None:
            raise
        s3_admin.put_object(Bucket=bucket, Key=object_key, Body=body, ContentType=content_type)


def get_download_url(bucket: str, file_key: str) -> str:
    signer = s3_admin or s3
    return signer.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": file_key},
        ExpiresIn=3600,
    )


def download_bytes(bucket: str, file_key: str) -> bytes:
    client = s3_admin or s3
    response = client.get_object(Bucket=bucket, Key=file_key)
    return response["Body"].read()


def list_buckets() -> list[str]:
    client = s3_admin or s3
    response = client.list_buckets()
    buckets = response.get("Buckets", [])
    return sorted(bucket.get("Name", "") for bucket in buckets if bucket.get("Name"))


def list_prefix(
    *,
    bucket: str,
    prefix: str = "",
    delimiter: str = "/",
) -> tuple[list[str], list[dict[str, object]]]:
    client = s3_admin or s3
    normalized_prefix = prefix.strip("/")
    if normalized_prefix:
        normalized_prefix = f"{normalized_prefix}/"

    response = client.list_objects_v2(
        Bucket=bucket,
        Prefix=normalized_prefix,
        Delimiter=delimiter,
    )

    folders = [
        entry["Prefix"][len(normalized_prefix):].rstrip("/")
        for entry in response.get("CommonPrefixes", [])
        if entry.get("Prefix")
    ]
    files = [
        {
            "key": item["Key"],
            "name": item["Key"][len(normalized_prefix):],
            "sizeBytes": int(item.get("Size", 0)),
            "lastModified": item.get("LastModified"),
        }
        for item in response.get("Contents", [])
        if item.get("Key") and item["Key"] != normalized_prefix
    ]
    return folders, files


def delete_document_object(bucket: str, file_key: str) -> None:
    try:
        s3.delete_object(Bucket=bucket, Key=file_key)
    except ClientError as err:
        if not _is_access_denied(err) or s3_admin is None:
            raise
        s3_admin.delete_object(Bucket=bucket, Key=file_key)


__all__ = [
    "DEFAULT_BUCKET",
    "S3_ENDPOINT",
    "build_object_key",
    "delete_document_object",
    "download_bytes",
    "get_download_url",
    "list_buckets",
    "list_prefix",
    "normalize_bucket_name",
    "upload_bytes",
    "validate_bucket_name",
]
