from __future__ import annotations

from typing import Any
from uuid import uuid4

from .db_setup import ensure_project_tables


async def _execute_raw(prisma: Any, sql: str, *params: Any) -> Any:
    execute_raw = getattr(prisma, "execute_raw", None)
    if execute_raw is None:
        raise RuntimeError("Prisma client has no execute_raw")
    return await execute_raw(sql, *params)


async def _query_raw(prisma: Any, sql: str, *params: Any) -> list[dict[str, Any]]:
    query_raw = getattr(prisma, "query_raw", None)
    if query_raw is None:
        raise RuntimeError("Prisma client has no query_raw")
    return [dict(row) for row in await query_raw(sql, *params)]


def normalize_project_key(value: Any) -> str | None:
    normalized = "".join(ch.lower() for ch in str(value or "") if ch.isalnum())
    return normalized or None


async def sync_project_for_shipment(prisma: Any, shipment_id: str) -> str | None:
    await ensure_project_tables(prisma)
    rows = await _query_raw(
        prisma,
        """
        SELECT "id"::text AS id, NULLIF(TRIM("project_name"), '') AS project_name
        FROM "public"."shipments"
        WHERE "id"::text = $1::text
        LIMIT 1
        """,
        shipment_id,
    )
    if not rows:
        return None

    project_name = rows[0].get("project_name")
    project_key = normalize_project_key(project_name)
    if not project_key:
        return None

    project_rows = await _query_raw(
        prisma,
        """
        INSERT INTO "project"."projects" (
          "id", "project_name", "project_key", "status", "updated_at"
        )
        VALUES ($1::uuid, $2, $3, 'ACTIVE', NOW())
        ON CONFLICT ("project_key") DO UPDATE SET
          "project_name" = COALESCE(NULLIF(EXCLUDED."project_name", ''), "project"."projects"."project_name"),
          "status" = 'ACTIVE',
          "updated_at" = NOW()
        RETURNING "id"::text AS id
        """,
        str(uuid4()),
        project_name,
        project_key,
    )
    if not project_rows:
        return None

    project_id = str(project_rows[0]["id"])
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."shipments"
        SET "project_id" = $2::uuid,
            "updated_at" = NOW()
        WHERE "id"::text = $1::text
        """,
        shipment_id,
        project_id,
    )
    await _refresh_project_counts(prisma)
    return project_id


async def sync_projects_from_shipments(prisma: Any, *, limit: int = 1000) -> int:
    await ensure_project_tables(prisma)
    rows = await _query_raw(
        prisma,
        """
        SELECT "id"::text AS id
        FROM "public"."shipments"
        WHERE NULLIF(TRIM("project_name"), '') IS NOT NULL
          AND lower(COALESCE("status", '')) NOT IN ('cancelled', 'canceled')
        ORDER BY "updated_at" DESC
        LIMIT $1
        """,
        limit,
    )
    synced = 0
    for row in rows:
        if await sync_project_for_shipment(prisma, str(row["id"])):
            synced += 1
    await _refresh_project_counts(prisma)
    return synced


async def _refresh_project_counts(prisma: Any) -> None:
    await _execute_raw(
        prisma,
        """
        UPDATE "project"."projects" p
        SET "shipment_count" = counts.shipment_count,
            "updated_at" = NOW()
        FROM (
          SELECT "project_id", COUNT(*)::int AS shipment_count
          FROM "public"."shipments"
          WHERE "project_id" IS NOT NULL
            AND lower(COALESCE("status", '')) NOT IN ('cancelled', 'canceled')
          GROUP BY "project_id"
        ) counts
        WHERE p."id" = counts."project_id"
        """,
    )
    await _execute_raw(
        prisma,
        """
        UPDATE "project"."projects" p
        SET "shipment_count" = 0,
            "updated_at" = NOW()
        WHERE NOT EXISTS (
          SELECT 1
          FROM "public"."shipments" s
          WHERE s."project_id" = p."id"
            AND lower(COALESCE(s."status", '')) NOT IN ('cancelled', 'canceled')
        )
        """,
    )
