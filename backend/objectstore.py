import os
import re
import uuid
from datetime import datetime
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env", override=True)


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name, default)
    return value.strip().strip('"').strip("'") if value else value


APP_ENVIRONMENT = (_env("APP_ENVIRONMENT") or _env("APP_ENV", "dev")).strip().lower()
IS_DEV = APP_ENVIRONMENT in {"dev", "development"}
IS_PROD = APP_ENVIRONMENT in {"prod", "production"}

if IS_DEV:
    # DEV mode using SeaweedFS
    S3_ENDPOINT = _env("S3_ENDPOINT")
    S3_ACCESS_KEY = _env("S3_ACCESS_KEY") or _env("S3_APP_ACCESS") or _env("AWS_ACCESS_KEY_ID")
    S3_SECRET_KEY = _env("S3_SECRET_KEY") or _env("S3_APP_SECRET") or _env("AWS_SECRET_ACCESS_KEY")
    S3_SESSION_TOKEN = _env("AWS_SESSION_TOKEN")
    S3_ADMIN_ACCESS = _env("S3_ADMIN_ACCESS") or _env("AWS_ADMIN_ACCESS_KEY_ID")
    S3_ADMIN_SECRET = _env("S3_ADMIN_SECRET") or _env("AWS_ADMIN_SECRET_ACCESS_KEY")
    S3_REGION = _env("S3_REGION") or _env("AWS_REGION", "us-east-1")
    DEFAULT_BUCKET = _env("S3_DEFAULT_BUCKET") or _env("S3_BUCKET_NAME", "ewms-invoices")
    S3_KEY_PREFIX = (_env("VOL_DIR_UUID") or _env("S3_KEY_PREFIX", "") or "").strip("/\\")

    for key, value in {
        "S3_ENDPOINT": S3_ENDPOINT,
        "S3_ACCESS_KEY": S3_ACCESS_KEY,
        "S3_SECRET_KEY": S3_SECRET_KEY,
    }.items():
        if not value:
            raise RuntimeError(f"Missing {key} in backend/.env for DEV (SeaweedFS) mode")
else:
    # PRODUCTION mode using direct AWS S3 (EC2 IAM Role authentication by default)
    S3_ENDPOINT = _env("AWS_S3_ENDPOINT")
    S3_ACCESS_KEY = _env("AWS_ACCESS_KEY_ID") or _env("S3_ACCESS_KEY") or _env("S3_APP_ACCESS")
    S3_SECRET_KEY = _env("AWS_SECRET_ACCESS_KEY") or _env("S3_SECRET_KEY") or _env("S3_APP_SECRET")
    S3_SESSION_TOKEN = _env("AWS_SESSION_TOKEN")
    S3_ADMIN_ACCESS = _env("AWS_ADMIN_ACCESS_KEY_ID") or _env("S3_ADMIN_ACCESS")
    S3_ADMIN_SECRET = _env("AWS_ADMIN_SECRET_ACCESS_KEY") or _env("S3_ADMIN_SECRET")
    S3_REGION = _env("S3_REGION") or _env("AWS_REGION", "ap-south-1")
    DEFAULT_BUCKET = _env("S3_DEFAULT_BUCKET") or _env("S3_BUCKET_NAME", "ewms-storage")
    S3_KEY_PREFIX = (_env("S3_KEY_PREFIX") or _env("VOL_DIR_UUID") or "zw-ewms-upload-files").strip("/\\")


def _client(access: str | None, secret: str | None, session_token: str | None = None):
    kwargs: dict[str, object] = {
        "service_name": "s3",
        "region_name": S3_REGION,
        "config": Config(
            signature_version="s3v4",
            s3={"addressing_style": "virtual"},
        ),
    }
    if S3_ENDPOINT:
        kwargs["endpoint_url"] = S3_ENDPOINT
    elif IS_PROD and S3_REGION:
        kwargs["endpoint_url"] = f"https://s3.{S3_REGION}.amazonaws.com"
    if access and secret:
        kwargs["aws_access_key_id"] = access
        kwargs["aws_secret_access_key"] = secret
        if session_token:
            kwargs["aws_session_token"] = session_token
    return boto3.client(**kwargs)


s3 = _client(S3_ACCESS_KEY, S3_SECRET_KEY, S3_SESSION_TOKEN)
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


def _create_bucket(client, bucket: str) -> None:
    if S3_REGION and S3_REGION != "us-east-1":
        client.create_bucket(
            Bucket=bucket,
            CreateBucketConfiguration={"LocationConstraint": S3_REGION},
        )
    else:
        client.create_bucket(Bucket=bucket)


def _ensure_bucket(bucket: str) -> None:
    client = s3_admin or s3
    try:
        client.head_bucket(Bucket=bucket)
        return
    except ClientError as err:
        if IS_PROD:
            # Production buckets are provisioned outside the app. Uploads should
            # only create objects under S3_KEY_PREFIX/module/date, never buckets.
            raise
        code = err.response.get("Error", {}).get("Code", "")
        if code in {"404", "NoSuchBucket", "NotFound"}:
            _create_bucket(client, bucket)
        elif _is_access_denied(err):
            try:
                _create_bucket(client, bucket)
            except ClientError as create_err:
                code_create = create_err.response.get("Error", {}).get("Code", "")
                if code_create not in {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"}:
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
    return s3.generate_presigned_url(
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
    "APP_ENVIRONMENT",
    "DEFAULT_BUCKET",
    "IS_DEV",
    "IS_PROD",
    "S3_ENDPOINT",
    "S3_KEY_PREFIX",
    "S3_REGION",
    "build_object_key",
    "delete_document_object",
    "download_bytes",
    "get_download_url",
    "list_buckets",
    "list_prefix",
    "normalize_bucket_name",
    "s3",
    "s3_admin",
    "upload_bytes",
    "validate_bucket_name",
]
