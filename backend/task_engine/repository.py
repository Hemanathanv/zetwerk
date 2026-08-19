from __future__ import annotations

import json
import os
from typing import Any

from .documents import all_key_types, extraction_source, normalize_doc_type


def debug(message: str, **fields: Any) -> None:
    if str(os.getenv("TASK_ENGINE_DEBUG", "")).lower() not in {"1", "true", "yes", "on"}:
        return
    suffix = ""
    if fields:
        suffix = " " + json.dumps(fields, default=str, sort_keys=True)
    print(f"[task_engine] {message}{suffix}", flush=True)


async def query_raw(prisma, sql: str, *params) -> list[dict[str, Any]]:
    rows = await prisma.query_raw(sql, *params)
    return [dict(row) for row in rows]


async def execute_raw(prisma, sql: str, *params) -> Any:
    return await prisma.execute_raw(sql, *params)


def json_param(value: Any) -> str:
    return json.dumps(value)


def assigned_role_from_targets(targets: Any) -> str | None:
    if isinstance(targets, str):
        try:
            targets = json.loads(targets)
        except json.JSONDecodeError:
            targets = {}
    if not isinstance(targets, dict):
        return None
    for key in ("assignedRole", "assignedRoleId", "roleId", "role"):
        value = str(targets.get(key) or "").strip()
        if value:
            return value
    return None


async def ensure_task_engine_tables(prisma) -> None:
    required_tables = (
        "public.escalation_configs",
        "public.document_link_rules",
        "public.task_engine_events",
        "public.task_instances",
        "public.notifications",
        "public.task_sla_events",
        "public.activity_task_events",
    )
    rows = await query_raw(
        prisma,
        """
        SELECT table_name
        FROM UNNEST($1::text[]) AS required(table_name)
        WHERE to_regclass(required.table_name) IS NULL
        ORDER BY table_name
        """,
        list(required_tables),
    )
    if rows:
        missing = ", ".join(str(row.get("table_name")) for row in rows)
        raise RuntimeError(f"Task engine database schema is missing: {missing}. Run Prisma migrations before starting the task engine.")


async def sync_link_rules_from_escalation_configs(prisma) -> None:
    rows = await query_raw(
        prisma,
        """
        SELECT "id", "activity_type", "base_doc", "scope", "targets"
        FROM "public"."escalation_configs"
        WHERE COALESCE("task_enabled", TRUE) IS TRUE
          AND LOWER("activity_type") = 'upload_document'
          AND COALESCE(NULLIF(TRIM("base_doc"), ''), '') <> ''
          AND COALESCE(NULLIF(TRIM("scope"), ''), '') <> ''
        """,
    )
    key_types = all_key_types()
    debug("config.sync.scan", configs=len(rows), match_key_types=key_types)
    for row in rows:
        base_doc_type = normalize_doc_type(row.get("base_doc"))
        target_doc_type = normalize_doc_type(row.get("scope"))
        if (
            not base_doc_type
            or not target_doc_type
            or base_doc_type == target_doc_type
            or not extraction_source(base_doc_type)
            or not extraction_source(target_doc_type)
        ):
            debug(
                "config.sync.skipped",
                escalation_config_id=row.get("id"),
                base_doc=row.get("base_doc"),
                scope=row.get("scope"),
                normalized_base_doc_type=base_doc_type,
                normalized_target_doc_type=target_doc_type,
                reason="invalid_or_missing_extraction_source",
            )
            continue
        assigned_role = assigned_role_from_targets(row.get("targets"))
        if not assigned_role:
            await execute_raw(
                prisma,
                """
                UPDATE "public"."document_link_rules"
                SET "is_active" = FALSE, "assigned_role" = NULL, "updated_at" = NOW()
                WHERE "id" = $1
                """,
                f"esc:{row['id']}",
            )
            debug(
                "config.sync.skipped",
                escalation_config_id=row.get("id"),
                base_doc_type=base_doc_type,
                target_doc_type=target_doc_type,
                reason="missing_assigned_role_in_config_targets",
            )
            continue
        await execute_raw(
            prisma,
            """
            INSERT INTO "public"."document_link_rules" (
              "id", "trigger_event", "activity_type", "base_doc_type", "target_doc_type",
              "match_key_types", "required_target_status", "assigned_role", "escalation_config_id"
            )
            VALUES ($1, 'document_reviewed', 'upload_document', $2, $3, $4::jsonb, 'ANY_ACTIVE', $5, $6)
            ON CONFLICT ("id") DO UPDATE SET
              "base_doc_type" = EXCLUDED."base_doc_type",
              "target_doc_type" = EXCLUDED."target_doc_type",
              "match_key_types" = EXCLUDED."match_key_types",
              "assigned_role" = EXCLUDED."assigned_role",
              "escalation_config_id" = EXCLUDED."escalation_config_id",
              "is_active" = TRUE,
              "updated_at" = NOW()
            """,
            f"esc:{row['id']}",
            base_doc_type,
            target_doc_type,
            json.dumps(key_types),
            str(assigned_role),
            str(row["id"]),
        )
        debug(
            "config.sync.rule_saved",
            rule_id=f"esc:{row['id']}",
            escalation_config_id=row.get("id"),
            base_doc_type=base_doc_type,
            target_doc_type=target_doc_type,
            assigned_role=str(assigned_role),
        )
