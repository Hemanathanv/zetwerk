from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db import close_prisma, get_prisma
from helpers.shipment_operational import ensure_operational_shipment_tables
from project.db_setup import ensure_project_tables
from project.service import sync_projects_from_shipments


async def main() -> None:
    prisma = await get_prisma()
    try:
        await ensure_operational_shipment_tables(prisma)
        await ensure_project_tables(prisma)
        synced = await sync_projects_from_shipments(prisma, limit=1000)
        print(f"synced_shipments={synced}")
        rows = await prisma.query_raw(
            """
            SELECT "project_name", "shipment_count"
            FROM "project"."projects"
            ORDER BY "updated_at" DESC
            LIMIT 20
            """
        )
        for row in rows:
            print(f"{row['project_name']}={row['shipment_count']}")
    finally:
        await close_prisma()


if __name__ == "__main__":
    asyncio.run(main())
