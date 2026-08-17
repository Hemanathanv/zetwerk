from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db import close_prisma, get_prisma
from document_module.db_setup import ensure_document_module_views
from helpers.shipment_operational import (
    ensure_operational_shipment_tables,
    sync_reviewed_bols_as_shipments,
)


async def main() -> None:
    prisma = await get_prisma()
    try:
        await ensure_operational_shipment_tables(prisma)
        await ensure_document_module_views(prisma)
        synced = await sync_reviewed_bols_as_shipments(prisma, limit=1000)
        print(f"synced_bols={synced}")
        rows = await prisma.query_raw(
            """
            SELECT d."doc_type"::text AS doc_type, COUNT(*)::int AS linked_count
            FROM "public"."documents" d
            WHERE d."shipment_id" IS NOT NULL
              AND d."doc_type"::text IN (
                'CHA_BILL',
                'FREIGHT_FORWARDER_BILL',
                'US_CARGO_RELEASE_ORDER',
                'CUSTOMER_BROKER_BILL',
                'OCEAN_FREIGHT'
              )
              AND d."status"::text IN ('REVIEWED', 'ARCHIVED')
              AND COALESCE(d."is_deleted", false) = false
            GROUP BY d."doc_type"::text
            ORDER BY d."doc_type"::text
            """
        )
        for row in rows:
            print(f"{row['doc_type']}={row['linked_count']}")
    finally:
        await close_prisma()


if __name__ == "__main__":
    asyncio.run(main())
