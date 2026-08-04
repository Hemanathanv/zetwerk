from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.v1.tasks.router import _query_raw
from db import close_prisma, get_prisma


async def main() -> None:
    prisma = await get_prisma()
    try:
        rows = await _query_raw(
            prisma,
            """
            SELECT
              COALESCE("source", 'none') AS source,
              COALESCE("recipient_role", '<broadcast>') AS recipient_role,
              COUNT(*) AS count,
              COUNT(*) FILTER (WHERE "read" = FALSE) AS unread
            FROM "public"."notifications"
            GROUP BY "source", "recipient_role"
            ORDER BY source, recipient_role
            """,
        )
        for row in rows:
            print(
                f"{row.get('source')} role={row.get('recipient_role')} "
                f"count={int(row.get('count') or 0)} unread={int(row.get('unread') or 0)}"
            )
    finally:
        await close_prisma()


if __name__ == "__main__":
    asyncio.run(main())
