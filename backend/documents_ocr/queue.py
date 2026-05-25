import asyncio
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import uuid4

from arq.connections import ArqRedis, RedisSettings, create_pool
from pdf2image import convert_from_bytes

from db import get_prisma
from helpers.config import settings
from documents_ocr.pipeline import run_post_upload_ocr
from objectstore import build_object_key, download_bytes, upload_bytes

UPLOAD_QUEUE = "arq:documents_ocr:upload_worker"
OCR_QUEUE = "arq:documents_ocr:ocr_worker"
UPLOAD_JOB_NAME = "process_upload_job"
OCR_JOB_NAME = "process_ocr_job"
PROCESSING_STALE_SECONDS = 15 * 60
POPPLER_BIN = Path("/usr/bin")

_arq_redis: ArqRedis | None = None


def get_arq_redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.REDIS_URL)


async def get_arq_redis() -> ArqRedis:
    global _arq_redis
    if _arq_redis is None:
        _arq_redis = await create_pool(get_arq_redis_settings())
    return _arq_redis


async def close_arq_redis() -> None:
    global _arq_redis
    if _arq_redis is not None:
        await _arq_redis.aclose()
        _arq_redis = None


async def enqueue_upload_job(*, document_id: str, bucket: str, module: str) -> None:
    payload = {
        "documentId": document_id,
        "bucket": bucket,
        "module": module,
    }
    redis = await get_arq_redis()
    print(f"[arq][enqueue] queue={UPLOAD_QUEUE} job={UPLOAD_JOB_NAME} payload={payload}", flush=True)
    await redis.enqueue_job(
        UPLOAD_JOB_NAME,
        payload,
        _queue_name=UPLOAD_QUEUE,
        _job_id=f"upload:{document_id}",
    )


async def enqueue_ocr_job(
    *,
    document_id: str,
    bucket: str,
    module: str,
    force_reprocess: bool = False,
) -> None:
    payload = {
        "documentId": document_id,
        "bucket": bucket,
        "module": module,
        "forceReprocess": force_reprocess,
    }
    redis = await get_arq_redis()
    print(
        f"[arq][enqueue] queue={OCR_QUEUE} job={OCR_JOB_NAME} payload={payload}",
        flush=True,
    )
    job_id = f"ocr:{document_id}:{uuid4().hex}"
    await redis.enqueue_job(
        OCR_JOB_NAME,
        payload,
        _queue_name=OCR_QUEUE,
        _job_id=job_id,
    )
    print(f"[arq][enqueue] queue={OCR_QUEUE} job_id={job_id}", flush=True)


async def process_upload_job(ctx: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    prisma = await get_prisma()
    document_id = str(payload["documentId"])
    bucket = str(payload["bucket"])
    module = str(payload["module"])
    print(
        f"[arq][upload] start documentId={document_id} bucket={bucket} module={module}",
        flush=True,
    )

    document = await prisma.document.find_unique(where={"id": document_id})
    if not document:
        print(f"[arq][upload] skipped documentId={document_id} reason=document_not_found", flush=True)
        return {"status": "skipped", "reason": "document_not_found", "documentId": document_id}

    try:
        await _ensure_document_pages(prisma=prisma, document=document, module=module)
    except Exception as exc:
        await prisma.document.update(
            where={"id": document_id},
            data={"status": "UPLOADED"},
        )
        print(
            f"[arq][upload] failed documentId={document_id} reason=page_generation_error:{exc}",
            flush=True,
        )
        return {"status": "failed", "reason": f"page_generation_error: {exc}", "documentId": document_id}

    await prisma.document.update(
        where={"id": document_id},
        data={"status": "QUEUED"},
    )
    print(f"[arq][upload] status->QUEUED documentId={document_id}", flush=True)
    await enqueue_ocr_job(document_id=document_id, bucket=bucket, module=module)
    print(f"[arq][upload] enqueued_next queue={OCR_QUEUE} documentId={document_id}", flush=True)
    return {"status": "queued", "next": OCR_QUEUE, "documentId": document_id}


async def _ensure_document_pages(*, prisma, document: Any, module: str) -> None:
    content_type = str(getattr(document, "contentType", "") or "").lower()
    file_name = str(getattr(document, "fileName", "") or "").lower()
    is_pdf = content_type == "application/pdf" or file_name.endswith(".pdf")
    if not is_pdf:
        return

    existing_pages = await prisma.documentpage.count(
        where={"documentId": str(document.id), "isExtractionSource": True},
    )
    if existing_pages > 0:
        return

    if not POPPLER_BIN.exists():
        raise RuntimeError(f"Poppler not found at: {POPPLER_BIN}")

    source_bytes = await asyncio.to_thread(
        download_bytes,
        str(document.bucket),
        str(document.objectKey),
    )
    images = await asyncio.to_thread(
        convert_from_bytes,
        source_bytes,
        dpi=200,
        fmt="png",
        poppler_path=str(POPPLER_BIN),
    )
    if not images:
        return

    upload_time = datetime.now()
    page_count = len(images)
    if int(getattr(document, "totalPages", 0) or 0) != page_count:
        await prisma.document.update(
            where={"id": str(document.id)},
            data={"totalPages": page_count},
        )

    for index, image in enumerate(images, start=1):
        page_file_name = f"{Path(str(document.fileName)).stem}_page_{index:03d}.png"
        page_buffer = BytesIO()
        image.save(page_buffer, format="PNG")
        page_bytes = page_buffer.getvalue()
        page_object_key = build_object_key(page_file_name, module, upload_time)
        await asyncio.to_thread(
            upload_bytes,
            body=page_bytes,
            bucket=str(document.bucket),
            object_key=page_object_key,
            content_type="image/png",
        )
        await prisma.documentpage.create(
            data={
                "documentId": str(document.id),
                "pageNo": index,
                "bucket": str(document.bucket),
                "objectKey": page_object_key,
                "sizeBytes": len(page_bytes),
                "isExtractionSource": True,
            }
        )


async def process_ocr_job(ctx: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    prisma = await get_prisma()
    document_id = str(payload["documentId"])
    bucket = str(payload["bucket"])
    module = str(payload["module"])
    force_reprocess = bool(payload.get("forceReprocess", False))
    print(
        f"[arq][ocr] start documentId={document_id} bucket={bucket} module={module}",
        flush=True,
    )

    document = await prisma.document.find_unique(where={"id": document_id})
    if not document:
        print(f"[arq][ocr] skipped documentId={document_id} reason=document_not_found", flush=True)
        return {"status": "skipped", "reason": "document_not_found", "documentId": document_id}
    if str(getattr(document, "status", "")) == "EXTRACTED":
        print(
            f"[arq][ocr] skipped documentId={document_id} reason=already_extracted",
            flush=True,
        )
        return {"status": "skipped", "reason": "already_extracted", "documentId": document_id}
    if str(getattr(document, "status", "")) == "PROCESSING":
        updated_at = getattr(document, "updatedAt", None)
        processing_age_s: float | None = None
        if isinstance(updated_at, datetime):
            processing_age_s = (datetime.now(timezone.utc) - updated_at.astimezone(timezone.utc)).total_seconds()
        is_stale = processing_age_s is not None and processing_age_s >= PROCESSING_STALE_SECONDS
        if force_reprocess or is_stale:
            print(
                f"[arq][ocr] reprocess documentId={document_id} reason={'force' if force_reprocess else 'stale_processing'} age_s={processing_age_s}",
                flush=True,
            )
        else:
            print(
                f"[arq][ocr] skipped documentId={document_id} reason=already_processing",
                flush=True,
            )
            return {"status": "skipped", "reason": "already_processing", "documentId": document_id}

    try:
        return await run_post_upload_ocr(
            prisma=prisma,
            document=document,
            bucket=bucket,
            module=module,
        )
    except asyncio.CancelledError:
        # ARQ timeout/shutdown can cancel the coroutine; persist state and exit cleanly.
        try:
            await prisma.document.update(
                where={"id": document_id},
                data={"status": "UPLOADED"},
            )
            print(
                f"[arq][ocr] timeout_cancelled documentId={document_id} status->UPLOADED",
                flush=True,
            )
        except Exception as update_exc:
            print(
                f"[arq][ocr] timeout_cancelled update_failed documentId={document_id} error={update_exc}",
                flush=True,
            )
        return {"status": "failed", "reason": "timeout_cancelled", "documentId": document_id}
    except Exception as exc:
        try:
            await prisma.document.update(
                where={"id": document_id},
                data={"status": "UPLOADED"},
            )
            print(
                f"[arq][ocr] failed documentId={document_id} status->UPLOADED error={exc}",
                flush=True,
            )
        except Exception as update_exc:
            print(
                f"[arq][ocr] failed update_failed documentId={document_id} error={update_exc}",
                flush=True,
            )
        return {"status": "failed", "reason": str(exc), "documentId": document_id}


async def on_job_failure(ctx: dict[str, Any], job_name: str, payload: dict[str, Any], exc: Exception) -> None:
    document_id = payload.get("documentId")
    if document_id:
        prisma = await get_prisma()
        try:
            await prisma.document.update(
                where={"id": str(document_id)},
                data={"status": "UPLOADED"},
            )
            print(
                f"[arq][recover] job={job_name} documentId={document_id} status->UPLOADED",
                flush=True,
            )
        except Exception:
            pass
    print(f"[arq][error] job={job_name} error={exc}", flush=True)


async def startup(ctx: dict[str, Any]) -> None:
    print("[arq][worker] startup", flush=True)


async def shutdown(ctx: dict[str, Any]) -> None:
    print("[arq][worker] shutdown", flush=True)


class UploadWorkerSettings:
    functions = [process_upload_job]
    redis_settings = get_arq_redis_settings()
    queue_name = UPLOAD_QUEUE
    job_timeout = 900
    max_tries = 1
    on_startup = startup
    on_shutdown = shutdown


class OcrWorkerSettings:
    functions = [process_ocr_job]
    redis_settings = get_arq_redis_settings()
    queue_name = OCR_QUEUE
    # 0 or negative means no timeout (wait until provider responds).
    job_timeout = settings.OCR_JOB_TIMEOUT_SECONDS if settings.OCR_JOB_TIMEOUT_SECONDS > 0 else None
    max_tries = 1
    on_startup = startup
    on_shutdown = shutdown


__all__ = [
    "OCR_JOB_NAME",
    "OCR_QUEUE",
    "UPLOAD_JOB_NAME",
    "UPLOAD_QUEUE",
    "UploadWorkerSettings",
    "OcrWorkerSettings",
    "close_arq_redis",
    "enqueue_ocr_job",
    "enqueue_upload_job",
    "get_arq_redis",
    "get_arq_redis_settings",
    "process_ocr_job",
    "process_upload_job",
]
