"""
Redis connection management for the backend app.
"""

from redis.asyncio import Redis

from helpers.config import settings

_redis_client: Redis | None = None


async def get_redis() -> Redis:
    """Get or create the shared Redis client instance."""
    global _redis_client

    if _redis_client is None:
        _redis_client = Redis.from_url(settings.REDIS_URL, decode_responses=True)

    await _redis_client.ping()
    return _redis_client


async def close_redis() -> None:
    """Close the shared Redis client connection."""
    global _redis_client

    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None


__all__ = ["get_redis", "close_redis", "Redis"]
