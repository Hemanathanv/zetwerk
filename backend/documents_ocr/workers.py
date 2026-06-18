import argparse
import asyncio
import sys
from pathlib import Path

from arq.worker import Worker

# Allow running this file directly from the repo root:
# `python3 backend/documents_ocr/workers.py both`
CURRENT_FILE = Path(__file__).resolve()
BACKEND_DIR = CURRENT_FILE.parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from documents_ocr.queue import DetectWorkerSettings, OcrWorkerSettings, UploadWorkerSettings


async def _run_detect_worker() -> None:
    print("[workers] starting ARQ detect worker", flush=True)
    worker = Worker(
        functions=DetectWorkerSettings.functions,
        redis_settings=DetectWorkerSettings.redis_settings,
        queue_name=DetectWorkerSettings.queue_name,
        job_timeout=DetectWorkerSettings.job_timeout,
        max_tries=DetectWorkerSettings.max_tries,
        on_startup=DetectWorkerSettings.on_startup,
        on_shutdown=DetectWorkerSettings.on_shutdown,
    )
    await worker.async_run()


async def _run_upload_worker() -> None:
    print("[workers] starting ARQ upload worker", flush=True)
    worker = Worker(
        functions=UploadWorkerSettings.functions,
        redis_settings=UploadWorkerSettings.redis_settings,
        queue_name=UploadWorkerSettings.queue_name,
        job_timeout=UploadWorkerSettings.job_timeout,
        max_tries=UploadWorkerSettings.max_tries,
        on_startup=UploadWorkerSettings.on_startup,
        on_shutdown=UploadWorkerSettings.on_shutdown,
    )
    await worker.async_run()


async def _run_ocr_worker() -> None:
    print("[workers] starting ARQ ocr worker", flush=True)
    worker = Worker(
        functions=OcrWorkerSettings.functions,
        redis_settings=OcrWorkerSettings.redis_settings,
        queue_name=OcrWorkerSettings.queue_name,
        job_timeout=OcrWorkerSettings.job_timeout,
        max_tries=OcrWorkerSettings.max_tries,
        on_startup=OcrWorkerSettings.on_startup,
        on_shutdown=OcrWorkerSettings.on_shutdown,
    )
    await worker.async_run()


async def _run_named_worker(name: str) -> None:
    if name == "detect_worker":
        await _run_detect_worker()
        return

    if name == "upload_worker":
        await _run_upload_worker()
        return

    if name == "ocr_worker":
        await _run_ocr_worker()
        return

    if name == "both":
        print("[workers] starting both ARQ workers", flush=True)
        await asyncio.gather(
            _run_detect_worker(),
            _run_upload_worker(),
            _run_ocr_worker(),
        )
        return

    raise ValueError(f"Unsupported worker: {name}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run OCR ARQ workers")
    parser.add_argument("worker", choices=["detect_worker", "upload_worker", "ocr_worker", "both"])
    args = parser.parse_args()
    asyncio.run(_run_named_worker(args.worker))


if __name__ == "__main__":
    main()
