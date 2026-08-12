import asyncio
from pathlib import Path
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from db import close_prisma, get_prisma
from doc_generation.db_setup import ensure_doc_generation_views
from document_module.db_setup import ensure_document_module_views
from helpers.shipment_operational import ensure_operational_shipment_tables

SHIPMENT_360_SQL_PATH = BACKEND_DIR / "shipment_360" / "views.sql"


def _split_sql_statements(sql: str) -> list[str]:
    return [statement.strip() for statement in sql.split(";") if statement.strip()]


async def _execute_shipment_360_views(prisma) -> None:
    if not SHIPMENT_360_SQL_PATH.exists():
        raise RuntimeError(f"Missing shipment 360 SQL: {SHIPMENT_360_SQL_PATH}")

    for statement in _split_sql_statements(SHIPMENT_360_SQL_PATH.read_text(encoding="utf-8")):
        await prisma.execute_raw(statement)


async def main() -> None:
    prisma = await get_prisma()
    try:
        await ensure_doc_generation_views(prisma)
        print("[views-init] docgen views ready", flush=True)

        try:
            from doc_generation.draft_boe_backfill import ensure_entry_summary_drafts_for_all_eligible_bols

            backfill = await ensure_entry_summary_drafts_for_all_eligible_bols(prisma)
            print(
                "[views-init] draft BOE backfill complete "
                f"eligible={backfill.get('eligible', 0)} "
                f"ready={backfill.get('ready', 0)} "
                f"skipped={backfill.get('skipped', 0)}",
                flush=True,
            )
        except Exception as exc:
            print(f"[views-init] warning: draft BOE backfill skipped: {exc}", flush=True)

        await ensure_operational_shipment_tables(prisma)
        print("[views-init] operational shipment tables ready", flush=True)

        await ensure_document_module_views(prisma)
        print("[views-init] document_module views ready", flush=True)

        await _execute_shipment_360_views(prisma)
        print("[views-init] shipment_360 views ready", flush=True)
    finally:
        await close_prisma()


if __name__ == "__main__":
    asyncio.run(main())
