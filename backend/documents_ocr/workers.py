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

from documents_ocr.queue import OpenrouterWorkerSettings, UploadWorkerSettings


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


async def _run_openrouter_worker() -> None:
    print("[workers] starting ARQ openrouter worker", flush=True)
    worker = Worker(
        functions=OpenrouterWorkerSettings.functions,
        redis_settings=OpenrouterWorkerSettings.redis_settings,
        queue_name=OpenrouterWorkerSettings.queue_name,
        job_timeout=OpenrouterWorkerSettings.job_timeout,
        max_tries=OpenrouterWorkerSettings.max_tries,
        on_startup=OpenrouterWorkerSettings.on_startup,
        on_shutdown=OpenrouterWorkerSettings.on_shutdown,
    )
    await worker.async_run()


async def _run_named_worker(name: str) -> None:
    if name == "upload_worker":
        await _run_upload_worker()
        return

    if name == "openrouter_worker":
        await _run_openrouter_worker()
        return

    if name == "both":
        print("[workers] starting both ARQ workers", flush=True)
        await asyncio.gather(
            _run_upload_worker(),
            _run_openrouter_worker(),
        )
        return

    raise ValueError(f"Unsupported worker: {name}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run OCR ARQ workers")
    parser.add_argument("worker", choices=["upload_worker", "openrouter_worker", "both"])
    args = parser.parse_args()
    asyncio.run(_run_named_worker(args.worker))


if __name__ == "__main__":
    main()
