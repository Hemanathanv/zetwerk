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
        counts = await _query_raw(
            prisma,
            """
            SELECT
              (SELECT COUNT(*) FROM "public"."task_instances") AS tasks,
              (SELECT COUNT(*) FROM "public"."notifications") AS notifications
            """,
        )
        print(f"db_counts tasks={int(counts[0].get('tasks') or 0)} notifications={int(counts[0].get('notifications') or 0)}")

        for page in (1, 2):
            rows = await _query_raw(
                prisma,
                """
                SELECT "id"::text AS id, "title", "created_at"
                FROM "public"."task_instances"
                ORDER BY
                  CASE "urgency" WHEN 'BLOCKER' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END,
                  "created_at" DESC
                LIMIT 5 OFFSET $1
                """,
                (page - 1) * 5,
            )
            print(f"task_page_{page} rows={len(rows)} first={rows[0].get('title') if rows else '-'}")

        for page in (1, 2):
            rows = await _query_raw(
                prisma,
                """
                SELECT "id"::text AS id, "title", "source", "read", "created_at"
                FROM "public"."notifications"
                ORDER BY "created_at" DESC
                LIMIT 5 OFFSET $1
                """,
                (page - 1) * 5,
            )
            print(f"notification_page_{page} rows={len(rows)} first={rows[0].get('title') if rows else '-'}")
    finally:
        await close_prisma()


if __name__ == "__main__":
    asyncio.run(main())
