from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.v1.tasks.router import (
    _ensure_tables,
    _query_raw,
    _sync_ocr_validation_tasks,
    _sync_task_reminders,
)
from db import close_prisma, get_prisma


async def main() -> None:
    prisma = await get_prisma()
    try:
        await _ensure_tables(prisma)
        await _sync_ocr_validation_tasks(prisma)
        await _sync_task_reminders(prisma)
        task_rows = await _query_raw(prisma, 'SELECT COUNT(*) AS count FROM "public"."task_instances"')
        notification_rows = await _query_raw(prisma, 'SELECT COUNT(*) AS count FROM "public"."notifications"')
        print(
            f"tasks={int(task_rows[0].get('count') or 0)} "
            f"notifications={int(notification_rows[0].get('count') or 0)}"
        )
    finally:
        await close_prisma()


if __name__ == "__main__":
    asyncio.run(main())
