import asyncio
from datetime import datetime, timezone
from io import BytesIO
import json
from pathlib import Path
import shutil
from typing import Any
from uuid import uuid4

from arq.connections import ArqRedis, RedisSettings, create_pool
from pdf2image import convert_from_bytes

from cache import get_redis
from db import get_prisma
from helpers.config import settings
from documents_ocr.document_classification import classify_document_bytes
from documents_ocr.pipeline import run_post_upload_ocr
from objectstore import build_object_key, delete_document_object, download_bytes, upload_bytes

DETECT_QUEUE = "arq:documents_ocr:detect_worker"
UPLOAD_QUEUE = "arq:documents_ocr:upload_worker"
OCR_QUEUE = "arq:documents_ocr:ocr_worker"
DETECT_JOB_NAME = "process_detection_job"
UPLOAD_JOB_NAME = "process_upload_job"
OCR_JOB_NAME = "process_ocr_job"
PROCESSING_STALE_SECONDS = 15 * 60
DETECTION_RESULT_TTL_SECONDS = 60 * 60
DETECTION_STALE_SECONDS = 5 * 60
LOCAL_POPPLER_BIN = Path(__file__).resolve().parents[1] / "poppler" / "Library" / "bin"
LINUX_POPPLER_BIN = Path("/usr/bin")

_arq_redis: ArqRedis | None = None


def _module_slug_from_doc_type(doc_type: Any) -> str:
    return str(doc_type or "uploads").strip().lower().replace("_", "-") or "uploads"


def _resolve_poppler_path() -> str | None:
    for candidate in (LOCAL_POPPLER_BIN, LINUX_POPPLER_BIN):
        executable = candidate / ("pdftoppm.exe" if candidate.drive else "pdftoppm")
        if executable.exists():
            return str(candidate)
    if shutil.which("pdftoppm"):
        return None
    raise RuntimeError(
        "Poppler not found. Install Poppler or add pdftoppm to PATH so PDF pages can be generated for OCR."
    )


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


def _detection_status_key(job_id: str) -> str:
    return f"documents_ocr:detect:{job_id}"


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_detection_stale(payload: dict[str, Any]) -> bool:
    status = str(payload.get("status") or "")
    if status not in {"queued", "running"}:
        return False
    timestamp = payload.get("updatedAt") or payload.get("createdAt")
    if not timestamp:
        return False
    try:
        updated_at = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
    except Exception:
        return False
    return (datetime.now(timezone.utc) - updated_at).total_seconds() > DETECTION_STALE_SECONDS


async def _set_detection_status(job_id: str, payload: dict[str, Any]) -> None:
    redis = await get_redis()
    await redis.set(
        _detection_status_key(job_id),
        json.dumps(payload),
        ex=DETECTION_RESULT_TTL_SECONDS,
    )


async def get_detection_status(job_id: str) -> dict[str, Any] | None:
    redis = await get_redis()
    raw = await redis.get(_detection_status_key(job_id))
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    if _is_detection_stale(parsed):
        stale_payload = {
            **parsed,
            "status": "failed",
            "message": "Document classification worker is not running or did not respond in time. Restart the backend or start the detect worker.",
            "updatedAt": _utc_iso(),
        }
        await _set_detection_status(job_id, stale_payload)
        return stale_payload
    return parsed


async def enqueue_detection_job(
    *,
    bucket: str,
    object_key: str,
    file_name: str,
    content_type: str,
    user_id: str,
) -> str:
    job_id = uuid4().hex
    payload = {
        "classificationJobId": job_id,
        "bucket": bucket,
        "objectKey": object_key,
        "fileName": file_name,
        "contentType": content_type,
        "userId": user_id,
    }
    await _set_detection_status(
        job_id,
        {
            "status": "queued",
            "classificationJobId": job_id,
            "fileName": file_name,
            "userId": user_id,
            "createdAt": _utc_iso(),
            "updatedAt": _utc_iso(),
        },
    )
    redis = await get_arq_redis()
    print(f"[arq][enqueue] queue={DETECT_QUEUE} job={DETECT_JOB_NAME} payload={payload}", flush=True)
    await redis.enqueue_job(
        DETECT_JOB_NAME,
        payload,
        _queue_name=DETECT_QUEUE,
        _job_id=f"detect:{job_id}",
    )
    return job_id


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


async def process_detection_job(ctx: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    job_id = str(payload["classificationJobId"])
    bucket = str(payload["bucket"])
    object_key = str(payload["objectKey"])
    file_name = str(payload["fileName"])
    content_type = str(payload.get("contentType") or "application/octet-stream").lower()
    user_id = str(payload.get("userId") or "")
    print(
        f"[arq][detect] start classificationJobId={job_id} bucket={bucket} objectKey={object_key}",
        flush=True,
    )
    await _set_detection_status(
        job_id,
        {
            "status": "running",
            "classificationJobId": job_id,
            "fileName": file_name,
            "userId": user_id,
            "updatedAt": _utc_iso(),
        },
    )

    try:
        file_bytes = await asyncio.to_thread(download_bytes, bucket, object_key)
        result = await asyncio.to_thread(
            classify_document_bytes,
            file_bytes=file_bytes,
            file_name=file_name,
            content_type=content_type,
        )
        result_payload = {
            "status": "success",
            "message": "Document classified. Confirm before extraction.",
            "classificationJobId": job_id,
            "docType": result.doc_type,
            "label": result.label,
            "confidence": result.confidence,
            "reasoning": result.reasoning,
            "matchedFields": result.matched_fields,
            "alternatives": result.alternatives,
            "fileName": file_name,
            "userId": user_id,
            "updatedAt": _utc_iso(),
        }
        await _set_detection_status(job_id, result_payload)
        print(
            f"[arq][detect] success classificationJobId={job_id} docType={result.doc_type} confidence={result.confidence}",
            flush=True,
        )
        return result_payload
    except Exception as exc:
        failed_payload = {
            "status": "failed",
            "message": f"Document classification failed: {exc}",
            "classificationJobId": job_id,
            "fileName": file_name,
            "userId": user_id,
            "updatedAt": _utc_iso(),
        }
        await _set_detection_status(job_id, failed_payload)
        print(f"[arq][detect] failed classificationJobId={job_id} error={exc}", flush=True)
        return failed_payload
    finally:
        try:
            await asyncio.to_thread(delete_document_object, bucket, object_key)
        except Exception:
            pass


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

    poppler_path = _resolve_poppler_path()

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
        poppler_path=poppler_path,
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
    payload_bucket = str(payload.get("bucket") or "")
    payload_module = str(payload.get("module") or "")
    force_reprocess = bool(payload.get("forceReprocess", False))
    print(
        f"[arq][ocr] start documentId={document_id} bucket={payload_bucket} module={payload_module}",
        flush=True,
    )

    document = await prisma.document.find_unique(where={"id": document_id})
    if not document:
        print(f"[arq][ocr] skipped documentId={document_id} reason=document_not_found", flush=True)
        return {"status": "skipped", "reason": "document_not_found", "documentId": document_id}

    bucket = str(getattr(document, "bucket", "") or payload_bucket)
    module = _module_slug_from_doc_type(getattr(document, "docType", None)) or payload_module or "uploads"
    db_status = str(getattr(document, "status", "") or "").upper()
    print(
        f"[arq][ocr] db_state documentId={document_id} status={db_status} bucket={bucket} module={module}",
        flush=True,
    )

    if db_status in {"EXTRACTED", "REVIEWED"} and not force_reprocess:
        print(
            f"[arq][ocr] skipped documentId={document_id} reason=already_extracted",
            flush=True,
        )
        return {"status": "skipped", "reason": "already_extracted", "documentId": document_id}
    if db_status == "PROCESSING":
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
    classification_job_id = payload.get("classificationJobId")
    if classification_job_id:
        try:
            await _set_detection_status(
                str(classification_job_id),
                {
                    "status": "failed",
                    "message": f"Document classification failed: {exc}",
                    "classificationJobId": str(classification_job_id),
                    "fileName": str(payload.get("fileName") or ""),
                    "userId": str(payload.get("userId") or ""),
                },
            )
        except Exception:
            pass
        print(f"[arq][error] job={job_name} classificationJobId={classification_job_id} error={exc}", flush=True)
        return

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


class DetectWorkerSettings:
    functions = [process_detection_job]
    redis_settings = get_arq_redis_settings()
    queue_name = DETECT_QUEUE
    job_timeout = 300
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
    "DETECT_JOB_NAME",
    "DETECT_QUEUE",
    "OCR_JOB_NAME",
    "OCR_QUEUE",
    "UPLOAD_JOB_NAME",
    "UPLOAD_QUEUE",
    "DetectWorkerSettings",
    "UploadWorkerSettings",
    "OcrWorkerSettings",
    "close_arq_redis",
    "enqueue_detection_job",
    "enqueue_ocr_job",
    "enqueue_upload_job",
    "get_arq_redis",
    "get_arq_redis_settings",
    "get_detection_status",
    "process_detection_job",
    "process_ocr_job",
    "process_upload_job",
]
