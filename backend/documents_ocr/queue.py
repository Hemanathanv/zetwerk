import asyncio
from typing import Any

from arq.connections import ArqRedis, RedisSettings, create_pool

from db import get_prisma
from helpers.config import settings
from documents_ocr.pipeline import run_post_upload_ocr

UPLOAD_QUEUE = "arq:documents_ocr:upload_worker"
OPENROUTER_QUEUE = "arq:documents_ocr:openrouter_worker"
UPLOAD_JOB_NAME = "process_upload_job"
OPENROUTER_JOB_NAME = "process_openrouter_job"

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
    await redis.enqueue_job(UPLOAD_JOB_NAME, payload, _queue_name=UPLOAD_QUEUE)


async def enqueue_openrouter_job(*, document_id: str, bucket: str, module: str) -> None:
    payload = {
        "documentId": document_id,
        "bucket": bucket,
        "module": module,
    }
    redis = await get_arq_redis()
    print(
        f"[arq][enqueue] queue={OPENROUTER_QUEUE} job={OPENROUTER_JOB_NAME} payload={payload}",
        flush=True,
    )
    await redis.enqueue_job(OPENROUTER_JOB_NAME, payload, _queue_name=OPENROUTER_QUEUE)


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

    await prisma.document.update(
        where={"id": document_id},
        data={"status": "QUEUED"},
    )
    print(f"[arq][upload] status->QUEUED documentId={document_id}", flush=True)
    await enqueue_openrouter_job(document_id=document_id, bucket=bucket, module=module)
    print(f"[arq][upload] enqueued_next queue={OPENROUTER_QUEUE} documentId={document_id}", flush=True)
    return {"status": "queued", "next": OPENROUTER_QUEUE, "documentId": document_id}


async def process_openrouter_job(ctx: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    prisma = await get_prisma()
    document_id = str(payload["documentId"])
    bucket = str(payload["bucket"])
    module = str(payload["module"])
    print(
        f"[arq][openrouter] start documentId={document_id} bucket={bucket} module={module}",
        flush=True,
    )

    document = await prisma.document.find_unique(where={"id": document_id})
    if not document:
        print(f"[arq][openrouter] skipped documentId={document_id} reason=document_not_found", flush=True)
        return {"status": "skipped", "reason": "document_not_found", "documentId": document_id}

    try:
        return await run_post_upload_ocr(
            prisma=prisma,
            document=document,
            bucket=bucket,
            module=module,
        )
    except asyncio.CancelledError:
        # ARQ timeout cancels the coroutine; persist terminal state before re-raising.
        try:
            await prisma.document.update(
                where={"id": document_id},
                data={"status": "REJECTED"},
            )
            print(
                f"[arq][openrouter] timeout_cancelled documentId={document_id} status->REJECTED",
                flush=True,
            )
        except Exception as update_exc:
            print(
                f"[arq][openrouter] timeout_cancelled update_failed documentId={document_id} error={update_exc}",
                flush=True,
            )
        raise
    except Exception as exc:
        try:
            await prisma.document.update(
                where={"id": document_id},
                data={"status": "REJECTED"},
            )
            print(
                f"[arq][openrouter] failed documentId={document_id} status->REJECTED error={exc}",
                flush=True,
            )
        except Exception as update_exc:
            print(
                f"[arq][openrouter] failed update_failed documentId={document_id} error={update_exc}",
                flush=True,
            )
        raise


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
    job_timeout = 120
    max_tries = 1
    on_startup = startup
    on_shutdown = shutdown


class OpenrouterWorkerSettings:
    functions = [process_openrouter_job]
    redis_settings = get_arq_redis_settings()
    queue_name = OPENROUTER_QUEUE
    # 0 or negative means no timeout (wait until provider responds).
    job_timeout = settings.OPENROUTER_JOB_TIMEOUT_SECONDS if settings.OPENROUTER_JOB_TIMEOUT_SECONDS > 0 else None
    max_tries = 1
    on_startup = startup
    on_shutdown = shutdown


__all__ = [
    "OPENROUTER_JOB_NAME",
    "OPENROUTER_QUEUE",
    "UPLOAD_JOB_NAME",
    "UPLOAD_QUEUE",
    "UploadWorkerSettings",
    "OpenrouterWorkerSettings",
    "close_arq_redis",
    "enqueue_openrouter_job",
    "enqueue_upload_job",
    "get_arq_redis",
    "get_arq_redis_settings",
    "process_openrouter_job",
    "process_upload_job",
]
