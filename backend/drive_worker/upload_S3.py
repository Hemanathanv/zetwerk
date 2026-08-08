import io
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

from objectstore import DEFAULT_BUCKET, build_object_key, normalize_bucket_name, upload_bytes

BASE_DIR = Path(__file__).resolve().parent
SERVICE_ACCOUNT_FILE = Path(
    os.getenv("DRIVE_SERVICE_ACCOUNT_FILE", str(BASE_DIR / "service_account.json"))
)

SCOPES = ["https://www.googleapis.com/auth/drive"]
DEFAULT_FOLDER_ID = "1IRjTYGPde8LBD1jJVfDUzRmO62cnu3G3"
FOLDER_ID = os.getenv("DRIVE_SOURCE_FOLDER_ID", DEFAULT_FOLDER_ID).strip()
PROCESSED_FOLDER_ID = os.getenv("DRIVE_PROCESSED_FOLDER_ID", "").strip()
BUCKET = normalize_bucket_name(os.getenv("DRIVE_S3_BUCKET", DEFAULT_BUCKET))
MODULE = os.getenv("DRIVE_S3_MODULE", "sales-invoice").strip() or "sales-invoice"


def get_drive_service():
    credentials = service_account.Credentials.from_service_account_file(
        str(SERVICE_ACCOUNT_FILE),
        scopes=SCOPES,
    )
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def is_pdf(file: dict[str, Any]) -> bool:
    name = str(file.get("name") or "")
    mime_type = str(file.get("mimeType") or "")
    return mime_type == "application/pdf" or name.lower().endswith(".pdf")


def download_drive_file(drive_service, file: dict[str, Any]) -> bytes:
    request = drive_service.files().get_media(fileId=file["id"])
    stream = io.BytesIO()
    downloader = MediaIoBaseDownload(stream, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    stream.seek(0)
    return stream.read()


def upload_file_to_s3(file: dict[str, Any], file_bytes: bytes) -> str:
    object_key = build_object_key(str(file.get("name") or "drive-upload.pdf"), MODULE, datetime.now())
    upload_bytes(
        body=file_bytes,
        bucket=BUCKET,
        object_key=object_key,
        content_type="application/pdf",
    )
    return object_key


def get_drive_files(drive_service, folder_id: str = FOLDER_ID) -> list[dict[str, Any]]:
    response = drive_service.files().list(
        q=f"'{folder_id}' in parents and trashed=false",
        fields="files(id,name,mimeType,size,parents,modifiedTime)",
        pageSize=100,
        orderBy="createdTime asc",
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    ).execute()
    return [file for file in response.get("files", []) if is_pdf(file)]


def ensure_processed_folder(drive_service, source_folder_id: str = FOLDER_ID) -> str:
    if PROCESSED_FOLDER_ID:
        return PROCESSED_FOLDER_ID
    response = drive_service.files().list(
        q=(
            f"'{source_folder_id}' in parents and "
            "mimeType='application/vnd.google-apps.folder' and "
            "name='Processed' and trashed=false"
        ),
        fields="files(id,name)",
        pageSize=1,
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    ).execute()
    files = response.get("files", [])
    if files:
        return str(files[0]["id"])
    created = drive_service.files().create(
        body={
            "name": "Processed",
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [source_folder_id],
        },
        fields="id",
        supportsAllDrives=True,
    ).execute()
    return str(created["id"])


def move_file_to_folder(drive_service, file: dict[str, Any], target_folder_id: str) -> None:
    previous_parents = ",".join(file.get("parents") or [])
    drive_service.files().update(
        fileId=file["id"],
        addParents=target_folder_id,
        removeParents=previous_parents,
        fields="id,parents",
        supportsAllDrives=True,
    ).execute()
