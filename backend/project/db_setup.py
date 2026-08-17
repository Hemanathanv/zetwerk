from __future__ import annotations

from typing import Any

_PROJECT_TABLES_READY = False


async def _execute_raw(prisma: Any, sql: str, *params: Any) -> Any:
    execute_raw = getattr(prisma, "execute_raw", None)
    if execute_raw is None:
        raise RuntimeError("Prisma client has no execute_raw")
    return await execute_raw(sql, *params)


async def ensure_project_tables(prisma: Any) -> None:
    global _PROJECT_TABLES_READY
    if _PROJECT_TABLES_READY:
        return

    await _execute_raw(prisma, 'CREATE SCHEMA IF NOT EXISTS "project"')
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "project"."projects" (
          "id" UUID PRIMARY KEY,
          "project_name" TEXT NOT NULL,
          "project_key" TEXT NOT NULL UNIQUE,
          "customer_name" TEXT,
          "buyer_org_name" TEXT,
          "status" TEXT NOT NULL DEFAULT 'ACTIVE',
          "notes" TEXT,
          "shipment_count" INTEGER NOT NULL DEFAULT 0,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    await _execute_raw(prisma, 'ALTER TABLE "public"."shipments" ADD COLUMN IF NOT EXISTS "project_id" UUID')
    await _execute_raw(prisma, 'ALTER TABLE "project"."projects" ADD COLUMN IF NOT EXISTS "customer_name" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "project"."projects" ADD COLUMN IF NOT EXISTS "buyer_org_name" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "project"."projects" ADD COLUMN IF NOT EXISTS "notes" TEXT')
    await _execute_raw(prisma, 'CREATE INDEX IF NOT EXISTS "idx_projects_project_key" ON "project"."projects"("project_key")')
    await _execute_raw(prisma, 'CREATE INDEX IF NOT EXISTS "idx_shipments_project_id" ON "public"."shipments"("project_id")')
    await _execute_raw(prisma, 'CREATE INDEX IF NOT EXISTS "idx_shipments_project_name" ON "public"."shipments"("project_name")')
    await _execute_raw(
        prisma,
        """
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fk_shipments_project_id'
              AND conrelid = '"public"."shipments"'::regclass
          ) THEN
            ALTER TABLE "public"."shipments"
              ADD CONSTRAINT "fk_shipments_project_id"
              FOREIGN KEY ("project_id")
              REFERENCES "project"."projects"("id")
              ON DELETE SET NULL;
          END IF;
        END $$
        """,
    )

    _PROJECT_TABLES_READY = True
