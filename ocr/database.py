import os
from contextlib import asynccontextmanager
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    _pool = await asyncpg.create_pool(
        dsn=os.getenv("DATABASE_URL"),
        min_size=2,
        max_size=10,
    )
    async with _pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                id           SERIAL PRIMARY KEY,
                name         TEXT NOT NULL,
                original_name TEXT NOT NULL,
                bucket       TEXT NOT NULL,
                file_key     TEXT NOT NULL,
                file_size    BIGINT,
                mime_type    TEXT,
                module       TEXT NOT NULL,
                created_at   TIMESTAMPTZ DEFAULT NOW()
            )
        """)


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def get_db() -> asyncpg.Connection:
    if _pool is None:
        raise RuntimeError("Database pool not initialised — call init_pool() at startup")
    async with _pool.acquire() as conn:
        yield conn


@asynccontextmanager
async def lifespan(_app):
    await init_pool()
    yield
    await close_pool()
