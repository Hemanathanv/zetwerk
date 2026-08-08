import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env", override=False)

from cache import close_redis, get_redis
from db import close_prisma, get_prisma
from documents_ocr.queue import close_arq_redis, enqueue_upload_job
from drive_worker.upload_S3 import (
    BUCKET,
    FOLDER_ID,
    MODULE,
    download_drive_file,
    ensure_processed_folder,
    get_drive_files,
    get_drive_service,
    move_file_to_folder,
    upload_file_to_s3,
)

DOC_TYPE = os.getenv("DRIVE_DOC_TYPE", "SALES_INVOICE").strip().upper() or "SALES_INVOICE"
UPLOADED_BY = os.getenv("DRIVE_UPLOADED_BY", "drive-worker").strip() or "drive-worker"
POLL_INTERVAL_SECONDS = max(60, int(os.getenv("DRIVE_POLL_INTERVAL_SECONDS", "3600")))
PROCESSED_SET_KEY = os.getenv("DRIVE_PROCESSED_SET_KEY", "drive_worker:processed_file_ids")
LOCK_TTL_SECONDS = int(os.getenv("DRIVE_FILE_LOCK_TTL_SECONDS", "7200"))


def log(message: str) -> None:
    print(f"[drive-worker] {message}", flush=True)


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def already_processed(file_id: str) -> bool:
    redis = await get_redis()
    return bool(await redis.sismember(PROCESSED_SET_KEY, file_id))


async def acquire_file_lock(file_id: str) -> bool:
    redis = await get_redis()
    lock_key = f"drive_worker:file_lock:{file_id}"
    return bool(await redis.set(lock_key, utc_iso(), nx=True, ex=LOCK_TTL_SECONDS))


async def mark_processed(file: dict[str, Any], document_id: str, object_key: str) -> None:
    redis = await get_redis()
    file_id = str(file["id"])
    await redis.sadd(PROCESSED_SET_KEY, file_id)
    await redis.hset(
        f"drive_worker:file:{file_id}",
        mapping={
            "fileId": file_id,
            "fileName": str(file.get("name") or ""),
            "documentId": document_id,
            "bucket": BUCKET,
            "objectKey": object_key,
            "docType": DOC_TYPE,
            "processedAt": utc_iso(),
        },
    )


async def release_file_lock(file_id: str) -> None:
    redis = await get_redis()
    await redis.delete(f"drive_worker:file_lock:{file_id}")


async def create_document_record(*, file: dict[str, Any], object_key: str, size_bytes: int) -> str:
    prisma = await get_prisma()
    document_id = str(uuid4())
    file_name = str(file.get("name") or "drive-upload.pdf")
    try:
        created = await prisma.document.create(
            data={
                "id": document_id,
                "docType": DOC_TYPE,
                "status": "QUEUED",
                "bucket": BUCKET,
                "objectKey": object_key,
                "fileName": file_name,
                "contentType": "application/pdf",
                "sizeBytes": size_bytes,
                "totalPages": None,
                "uploadedBy": UPLOADED_BY,
            }
        )
        return str(created.id)
    except Exception as exc:
        log(f"prisma create fallback file={file_name!r} error={exc}")

    await prisma.execute_raw(
        '''INSERT INTO "public"."documents"
           ("id", "doc_type", "status", "bucket", "object_key", "file_name", "content_type", "size_bytes", "total_pages", "uploaded_by", "is_deleted", "created_at", "updated_at")
           VALUES ($1::uuid, $2::text::"public"."DocType", $3::text::"public"."DocumentStatus", $4, $5, $6, $7, $8, NULL, $9, FALSE, NOW(), NOW())''',
        document_id,
        DOC_TYPE,
        "QUEUED",
        BUCKET,
        object_key,
        file_name,
        "application/pdf",
        int(size_bytes),
        UPLOADED_BY,
    )
    return document_id


async def process_file(drive_service, processed_folder_id: str, file: dict[str, Any]) -> bool:
    file_id = str(file["id"])
    file_name = str(file.get("name") or file_id)
    if await already_processed(file_id):
        log(f"skip already_processed file={file_name!r} id={file_id}")
        return False
    if not await acquire_file_lock(file_id):
        log(f"skip locked file={file_name!r} id={file_id}")
        return False

    try:
        log(f"download start file={file_name!r} id={file_id}")
        file_bytes = await asyncio.to_thread(download_drive_file, drive_service, file)
        if not file_bytes:
            raise RuntimeError("downloaded file is empty")

        object_key = await asyncio.to_thread(upload_file_to_s3, file, file_bytes)
        document_id = await create_document_record(
            file=file,
            object_key=object_key,
            size_bytes=len(file_bytes),
        )
        await enqueue_upload_job(
            document_id=document_id,
            bucket=BUCKET,
            module=MODULE,
            force_reprocess=False,
            auto_validate=False,
            refresh_generated_drafts=False,
        )
        await mark_processed(file, document_id, object_key)
        await asyncio.to_thread(move_file_to_folder, drive_service, file, processed_folder_id)
        log(f"queued documentId={document_id} file={file_name!r} s3={BUCKET}/{object_key}")
        return True
    except Exception as exc:
        log(f"failed file={file_name!r} id={file_id} error={exc}")
        return False
    finally:
        await release_file_lock(file_id)


async def poll_once() -> int:
    drive_service = await asyncio.to_thread(get_drive_service)
    processed_folder_id = await asyncio.to_thread(ensure_processed_folder, drive_service, FOLDER_ID)
    files = await asyncio.to_thread(get_drive_files, drive_service, FOLDER_ID)
    if not files:
        log(f"no pdf files found folder={FOLDER_ID}")
        return 0

    processed_count = 0
    for file in files:
        if await process_file(drive_service, processed_folder_id, file):
            processed_count += 1
    log(f"poll complete found={len(files)} processed={processed_count}")
    return processed_count


async def run_forever() -> None:
    log(
        f"started folder={FOLDER_ID} bucket={BUCKET} module={MODULE} "
        f"docType={DOC_TYPE} interval={POLL_INTERVAL_SECONDS}s"
    )
    while True:
        try:
            await poll_once()
        except Exception as exc:
            log(f"poll failed error={exc}")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def shutdown() -> None:
    await close_arq_redis()
    await close_redis()
    await close_prisma()


def main() -> None:
    once = "--once" in sys.argv
    try:
        if once:
            asyncio.run(poll_once())
        else:
            asyncio.run(run_forever())
    finally:
        try:
            asyncio.run(shutdown())
        except Exception:
            pass


if __name__ == "__main__":
    main()
