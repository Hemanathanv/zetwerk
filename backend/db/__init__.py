"""
Database module for Invoice Extraction App
Provides Prisma client initialization and access
"""

import os
from pathlib import Path

from prisma import Prisma

# Singleton Prisma client instance
_prisma_client: Prisma | None = None
_env_loaded = False


def _load_env_file(env_path: Path) -> bool:
    if not env_path.exists():
        return False

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

    return True


def _ensure_database_env() -> None:
    global _env_loaded

    if _env_loaded or os.getenv("DATABASE_URL"):
        _env_loaded = True
        return

    backend_dir = Path(__file__).resolve().parents[1]
    repo_dir = backend_dir.parent

    for env_path in (repo_dir / ".env", backend_dir / ".env"):
        if _load_env_file(env_path) and os.getenv("DATABASE_URL"):
            _env_loaded = True
            return

    _env_loaded = True


async def get_prisma() -> Prisma:
    """
    Get or create the Prisma client instance.
    This ensures we reuse the same connection pool.
    """
    global _prisma_client
    _ensure_database_env()
    if _prisma_client is None:
        _prisma_client = Prisma()
    if not _prisma_client.is_connected():
        await _prisma_client.connect()
    return _prisma_client


async def close_prisma() -> None:
    """Close the Prisma client connection"""
    global _prisma_client
    if _prisma_client is not None and _prisma_client.is_connected():
        await _prisma_client.disconnect()
        _prisma_client = None


# Convenience exports
__all__ = ["get_prisma", "close_prisma", "Prisma"]
