from contextlib import asynccontextmanager
import asyncio
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.v1 import register_routes
from cache import close_redis, get_redis
from helpers.config import settings
from db import close_prisma, get_prisma
from documents_ocr.queue import (
    OpenrouterWorkerSettings,
    UploadWorkerSettings,
    close_arq_redis,
)
from arq.worker import Worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting Invoice Extraction API...")
    worker_tasks: list[asyncio.Task] = []

    try:
        await get_prisma()
        print("PostgreSQL (Prisma) connected")
    except Exception as e:
        print(f"Warning: Could not connect to Prisma: {e}")

    try:
        await get_redis()
        print("Redis connected")
    except Exception as e:
        print(f"Warning: Could not connect to Redis: {e}")

    run_workers_in_api = str(getattr(settings, "RUN_OCR_WORKERS_IN_API", "true")).lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if run_workers_in_api:
        print("Starting ARQ OCR workers inside FastAPI process...")
        upload_worker = Worker(
            functions=UploadWorkerSettings.functions,
            redis_settings=UploadWorkerSettings.redis_settings,
            queue_name=UploadWorkerSettings.queue_name,
            job_timeout=UploadWorkerSettings.job_timeout,
            max_tries=UploadWorkerSettings.max_tries,
            on_startup=UploadWorkerSettings.on_startup,
            on_shutdown=UploadWorkerSettings.on_shutdown,
        )
        openrouter_worker = Worker(
            functions=OpenrouterWorkerSettings.functions,
            redis_settings=OpenrouterWorkerSettings.redis_settings,
            queue_name=OpenrouterWorkerSettings.queue_name,
            job_timeout=OpenrouterWorkerSettings.job_timeout,
            max_tries=OpenrouterWorkerSettings.max_tries,
            on_startup=OpenrouterWorkerSettings.on_startup,
            on_shutdown=OpenrouterWorkerSettings.on_shutdown,
        )
        worker_tasks = [
            asyncio.create_task(
                upload_worker.async_run(),
                name="arq-ocr-upload-worker",
            ),
            asyncio.create_task(
                openrouter_worker.async_run(),
                name="arq-ocr-openrouter-worker",
            ),
        ]
    else:
        print("ARQ OCR workers are disabled in FastAPI (RUN_OCR_WORKERS_IN_API=false)")

    print("API ready at http://localhost:8000")

    yield  # Run the app

    print("Shutting down API...")
    for task in worker_tasks:
        task.cancel()
    if worker_tasks:
        await asyncio.gather(*worker_tasks, return_exceptions=True)
        print("OCR worker tasks stopped")

    try:
        await close_prisma()
        print("PostgreSQL (Prisma) connection closed")
    except Exception as e:
        print(f"Warning: Could not close Prisma connection: {e}")

    try:
        await close_arq_redis()
    except Exception:
        pass

    try:
        await close_redis()
        print("Redis connection closed")
    except Exception as e:
        print(f"Warning: Could not close Redis connection: {e}")


app = FastAPI(
    title=settings.API_TITLE,
    version=settings.API_VERSION,
    description="API for extracting invoice data from PDFs using LLMs",
    lifespan=lifespan,
    docs_url="/api/docs",
)

# Allow CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://192.168.10.100:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_routes(app)

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8050, reload=True)
