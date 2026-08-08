from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db import get_prisma
from helpers.config import settings
from helpers.dependencies import get_current_user
from helpers.shipment_operational import ensure_operational_shipment_tables


router = APIRouter(prefix=settings.API_SLUG, tags=["Tasks"])

OPEN_STATUSES = ("PENDING", "ASSIGNED", "IN_PROGRESS", "ESCALATED")
DEFAULT_ROLE_ID = "India Logistics"
TASKS_READY = False
ACTIVITY_CODE_TO_SLA_TYPE = {
    "documents.upload": "upload_document",
    "documents.re_upload_document": "re_upload_document",
    "documents.edit_extracted": "fill_manual_fields",
    "documents.approve_draft": "approve_generated_document",
    "documents.override_validation": "resolve_validation_failure",
    "documents.map_container_to_sku": "map_container_to_sku",
    "documents.approve_container_mapping": "approve_container_mapping",
}


class TaskCreateRequest(BaseModel):
    title: str
    description: str | None = None
    category: str | None = None
    activityCode: str | None = None
    urgency: str | None = None
    assignedRole: str | None = None
    assignedUserId: str | None = None
    shipmentId: str | None = None
    entityType: str | None = None
    entityId: str | None = None
    slaDeadline: str | None = None


class EscalateRequest(BaseModel):
    reason: str | None = None
    targetRoleId: str | None = None


class ReassignRequest(BaseModel):
    roleId: str | None = None
    assignedRoleId: str | None = None
    userId: str | None = None


class DelegateRequest(BaseModel):
    userId: str | None = None


async def _query_raw(prisma, sql: str, *params) -> list[dict[str, Any]]:
    rows = await prisma.query_raw(sql, *params)
    return [dict(row) for row in rows]


async def _execute_raw(prisma, sql: str, *params) -> Any:
    return await prisma.execute_raw(sql, *params)


def _json(value: Any, fallback: Any = None) -> Any:
    if value is None:
        return fallback
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return value


def _user_id(user: Any) -> str:
    return str(getattr(user, "id", "") or getattr(user, "email", "") or "system")


def _user_role(user: Any) -> str:
    primary = getattr(user, "keycloakPrimaryRole", None)
    if primary:
        return str(primary)
    role = getattr(user, "role", None)
    value = getattr(role, "value", None) or role
    return str(value or DEFAULT_ROLE_ID)


def _notification_type_for_task(task: dict[str, Any]) -> str:
    if task.get("status") == "ESCALATED":
        return "escalation"
    if task.get("urgency") == "BLOCKER":
        return "blocker"
    if task.get("urgency") == "WARNING":
        return "warning"
    return "info"


def _notification_recipient_clause(alias: str = "n") -> str:
    prefix = f'{alias}.' if alias else ""
    return (
        f'({prefix}"recipient_user_id" = $1 '
        f'OR ({prefix}"recipient_user_id" IS NULL AND {prefix}"recipient_role" = $2))'
    )


def _sla_activity_type(activity_code: str | None) -> str:
    value = str(activity_code or "").strip()
    return ACTIVITY_CODE_TO_SLA_TYPE.get(value, value or "TSK-001")


async def _has_escalation_config_table(prisma) -> bool:
    rows = await _query_raw(
        prisma,
        "SELECT to_regclass('public.escalation_configs')::text AS table_name",
    )
    return bool(rows and rows[0].get("table_name"))


async def _has_table(prisma, qualified_name: str) -> bool:
    rows = await _query_raw(
        prisma,
        "SELECT to_regclass($1)::text AS table_name",
        qualified_name,
    )
    return bool(rows and rows[0].get("table_name"))


async def _sla_config_for_activity(prisma, activity_type: str) -> dict[str, Any] | None:
    if not await _has_escalation_config_table(prisma):
        return None
    rows = await _query_raw(
        prisma,
        """
        SELECT
          "id", "activity_type", "base_sla_hours", "reminder_pct",
          "warning_pct", "escalation_pct", "blocker_pct", "task_enabled",
          "task_message", "channels", "targets"
        FROM "public"."escalation_configs"
        WHERE LOWER("activity_type") = LOWER($1)
          AND "base_sla_hours" > 0
          AND COALESCE("task_enabled", TRUE) IS TRUE
        ORDER BY
          CASE WHEN COALESCE("scope", '') = '' THEN 1 ELSE 0 END,
          "id" ASC
        LIMIT 1
        """,
        activity_type,
    )
    return rows[0] if rows else None


async def _validation_sla_config(prisma) -> dict[str, Any] | None:
    if not await _has_escalation_config_table(prisma):
        return None
    rows = await _query_raw(
        prisma,
        """
        SELECT
          "id", "activity_type", "base_sla_hours", "reminder_pct",
          "warning_pct", "escalation_pct", "blocker_pct", "task_enabled",
          "task_message", "channels", "targets"
        FROM "public"."escalation_configs"
        WHERE LOWER("activity_type") = 'resolve_validation_failure'
          AND "base_sla_hours" > 0
          AND COALESCE("task_enabled", TRUE) IS TRUE
          AND COALESCE(NULLIF(TRIM("base_doc"), ''), 'Doc names') <> 'Doc names'
          AND LOWER(COALESCE(NULLIF(TRIM("scope"), ''), 'validation')) NOT IN ('validation', 'document', 'generated documents')
        ORDER BY "id" ASC
        LIMIT 1
        """,
    )
    return rows[0] if rows else None


async def _ensure_tables(prisma) -> None:
    global TASKS_READY
    if TASKS_READY:
        return
    await ensure_operational_shipment_tables(prisma)
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "public"."escalation_configs" (
          "id" TEXT PRIMARY KEY,
          "activity_type" TEXT NOT NULL,
          "activity_name" TEXT NOT NULL,
          "description" TEXT NOT NULL DEFAULT '',
          "scope" TEXT NOT NULL DEFAULT '',
          "base_doc" TEXT NOT NULL DEFAULT '',
          "base_sla_hours" DOUBLE PRECISION NOT NULL DEFAULT 24,
          "reminder_pct" INTEGER NOT NULL DEFAULT 0,
          "warning_pct" INTEGER NOT NULL DEFAULT 50,
          "escalation_pct" INTEGER NOT NULL DEFAULT 75,
          "blocker_pct" INTEGER NOT NULL DEFAULT 100,
          "task_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
          "trigger_category" TEXT,
          "trigger_logic" TEXT,
          "task_message" TEXT,
          "reminder_message" TEXT,
          "warning_message" TEXT,
          "escalation_message" TEXT,
          "blocker_message" TEXT,
          "reminder_trigger" TEXT,
          "warning_trigger" TEXT,
          "escalation_trigger" TEXT,
          "blocker_trigger" TEXT,
          "channels" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "targets" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    await _execute_raw(prisma, 'ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "task_enabled" BOOLEAN NOT NULL DEFAULT TRUE')
    await _execute_raw(prisma, 'ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "trigger_category" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "trigger_logic" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "task_message" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "reminder_message" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "warning_message" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "escalation_message" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "blocker_message" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "reminder_trigger" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "warning_trigger" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "escalation_trigger" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "blocker_trigger" TEXT')
    await _execute_raw(prisma, 'CREATE INDEX IF NOT EXISTS "idx_escalation_configs_activity_type" ON "public"."escalation_configs"("activity_type")')
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "public"."task_instances" (
          "id" UUID PRIMARY KEY,
          "title" TEXT NOT NULL,
          "description" TEXT,
          "category" TEXT NOT NULL DEFAULT 'General',
          "activity_code" TEXT NOT NULL DEFAULT 'TSK-001',
          "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
          "urgency" TEXT NOT NULL DEFAULT 'NORMAL',
          "assigned_role" TEXT,
          "assigned_user_id" TEXT,
          "shipment_id" UUID,
          "entity_type" TEXT,
          "entity_id" TEXT,
          "parent_task_id" UUID,
          "sla_deadline" TIMESTAMPTZ,
          "started_at" TIMESTAMPTZ,
          "completed_at" TIMESTAMPTZ,
          "escalation_level" INTEGER NOT NULL DEFAULT 0,
          "escalation_type" TEXT,
          "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "source_key" TEXT,
          "created_by" TEXT,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    await _execute_raw(prisma, 'ALTER TABLE "public"."task_instances" ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT \'{}\'::jsonb')
    await _execute_raw(prisma, 'ALTER TABLE "public"."task_instances" ADD COLUMN IF NOT EXISTS "escalation_level" INTEGER NOT NULL DEFAULT 0')
    await _execute_raw(prisma, 'ALTER TABLE "public"."task_instances" ADD COLUMN IF NOT EXISTS "escalation_type" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."task_instances" ADD COLUMN IF NOT EXISTS "source_key" TEXT')
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "public"."notifications" (
          "id" UUID PRIMARY KEY,
          "type" TEXT NOT NULL DEFAULT 'info',
          "title" TEXT NOT NULL,
          "message" TEXT,
          "link" TEXT,
          "read" BOOLEAN NOT NULL DEFAULT FALSE,
          "recipient_user_id" TEXT,
          "recipient_role" TEXT,
          "task_id" UUID,
          "source" TEXT NOT NULL DEFAULT 'task',
          "dedupe_key" TEXT UNIQUE,
          "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "public"."activity_task_events" (
          "id" UUID PRIMARY KEY,
          "activity_type" TEXT NOT NULL,
          "title" TEXT,
          "description" TEXT,
          "category" TEXT NOT NULL DEFAULT 'General',
          "urgency" TEXT NOT NULL DEFAULT 'NORMAL',
          "assigned_role" TEXT,
          "assigned_user_id" TEXT,
          "shipment_id" UUID,
          "entity_type" TEXT,
          "entity_id" TEXT,
          "scope" TEXT,
          "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "source_key" TEXT UNIQUE,
          "created_by" TEXT,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "processed_at" TIMESTAMPTZ
        )
        """,
    )
    await _execute_raw(prisma, 'CREATE INDEX IF NOT EXISTS "idx_task_instances_open" ON "public"."task_instances"("status", "assigned_role", "assigned_user_id")')
    await _execute_raw(prisma, 'CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_instances_source_key" ON "public"."task_instances"("source_key") WHERE "source_key" IS NOT NULL')
    await _execute_raw(prisma, 'CREATE INDEX IF NOT EXISTS "idx_notifications_recipient" ON "public"."notifications"("recipient_user_id", "recipient_role", "read", "created_at")')
    TASKS_READY = True


def _sla_task_clause(alias: str = "t") -> str:
    prefix = f'{alias}.' if alias else ""
    return (
        "EXISTS ("
        'SELECT 1 FROM "public"."escalation_configs" ec '
        f'WHERE LOWER(ec."activity_type") = LOWER({prefix}"activity_code") '
        'AND ec."base_sla_hours" > 0'
        ' AND COALESCE(ec."task_enabled", TRUE) IS TRUE'
        f" AND (LOWER({prefix}\"activity_code\") <> 'resolve_validation_failure' "
        "OR (COALESCE(NULLIF(TRIM(ec.\"base_doc\"), ''), 'Doc names') <> 'Doc names' "
        "AND LOWER(COALESCE(NULLIF(TRIM(ec.\"scope\"), ''), 'validation')) NOT IN ('validation', 'document', 'generated documents')))"
        ")"
    )


def _apply_sla_task_filter(where: str) -> str:
    clause = _sla_task_clause("t")
    if where.strip():
        return f"{where} AND {clause}"
    return f"WHERE {clause}"


def _sla_notification_clause(alias: str = "n") -> str:
    prefix = f'{alias}.' if alias else ""
    return (
        "EXISTS ("
        'SELECT 1 FROM "public"."task_instances" nt '
        'JOIN "public"."escalation_configs" ec '
        'ON LOWER(ec."activity_type") = LOWER(nt."activity_code") '
        'AND ec."base_sla_hours" > 0 '
        'AND COALESCE(ec."task_enabled", TRUE) IS TRUE '
        "AND (LOWER(nt.\"activity_code\") <> 'resolve_validation_failure' "
        "OR (COALESCE(NULLIF(TRIM(ec.\"base_doc\"), ''), 'Doc names') <> 'Doc names' "
        "AND LOWER(COALESCE(NULLIF(TRIM(ec.\"scope\"), ''), 'validation')) NOT IN ('validation', 'document', 'generated documents'))) "
        f'WHERE nt."id" = {prefix}"task_id"'
        ")"
    )


async def _insert_notification(
    prisma,
    *,
    task: dict[str, Any],
    title: str,
    message: str,
    source: str,
    dedupe_key: str,
) -> None:
    await _execute_raw(
        prisma,
        """
        INSERT INTO "public"."notifications" (
          "id", "type", "title", "message", "link", "recipient_user_id", "recipient_role",
          "task_id", "source", "dedupe_key", "metadata"
        )
        VALUES (
          $1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid, $9, $10, $11::jsonb
        )
        ON CONFLICT ("dedupe_key") DO UPDATE SET
          "type" = EXCLUDED."type",
          "title" = EXCLUDED."title",
          "message" = EXCLUDED."message",
          "link" = EXCLUDED."link",
          "recipient_user_id" = EXCLUDED."recipient_user_id",
          "recipient_role" = EXCLUDED."recipient_role",
          "task_id" = EXCLUDED."task_id",
          "source" = EXCLUDED."source",
          "metadata" = EXCLUDED."metadata"
        """,
        str(uuid4()),
        _notification_type_for_task(task),
        title,
        message,
        f"/tasks?taskId={task['id']}",
        task.get("assigned_user_id"),
        task.get("assigned_role"),
        str(task["id"]),
        source,
        dedupe_key,
        json.dumps({"module": "tasks", "urgency": task.get("urgency")}),
    )


async def _sync_ocr_validation_tasks(prisma) -> None:
    table_rows = await _query_raw(
        prisma,
        "SELECT to_regclass('document_module.validation_tasks')::text AS table_name",
    )
    if not table_rows or not table_rows[0].get("table_name"):
        return

    sla_config = await _validation_sla_config(prisma)
    if not sla_config:
        return

    await _execute_raw(
        prisma,
        """
        INSERT INTO "public"."task_instances" (
          "id", "title", "description", "category", "activity_code", "status", "urgency",
          "assigned_role", "shipment_id", "entity_type", "entity_id", "sla_deadline",
          "metadata", "source_key", "created_by", "created_at", "updated_at"
        )
        SELECT
          (
            substr(md5('ocr-validation-task:' || vt."id"), 1, 8) || '-' ||
            substr(md5('ocr-validation-task:' || vt."id"), 9, 4) || '-' ||
            substr(md5('ocr-validation-task:' || vt."id"), 13, 4) || '-' ||
            substr(md5('ocr-validation-task:' || vt."id"), 17, 4) || '-' ||
            substr(md5('ocr-validation-task:' || vt."id"), 21, 12)
          )::uuid,
          vt."title",
          vt."description",
          'Validation',
          'resolve_validation_failure',
          CASE WHEN vt."status" = 'RESOLVED' THEN 'COMPLETED' ELSE 'ASSIGNED' END,
          CASE WHEN UPPER(vt."alert_level") = 'BLOCKER' THEN 'BLOCKER' ELSE 'WARNING' END,
          COALESCE(NULLIF(vt."assigned_role", ''), $1),
          CASE
            WHEN vt."shipment_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN vt."shipment_id"::uuid
            ELSE NULL
          END,
          'validation_result',
          COALESCE(vt."validation_result_id", vt."document_id"),
          vt."created_at" + ($2::double precision * INTERVAL '1 hour'),
          jsonb_build_object(
            'module', 'documents',
            'source', 'ocr_validation',
            'ocrTaskId', vt."id",
            'shipmentReference', vt."shipment_id",
            'documentId', vt."document_id",
            'validationResultId', vt."validation_result_id",
            'ruleCode', vt."rule_code",
            'alertLevel', vt."alert_level"
          ),
          'ocr-validation-task:' || vt."id",
          vt."created_by",
          vt."created_at",
          vt."updated_at"
        FROM "document_module"."validation_tasks" vt
        ON CONFLICT ("source_key") WHERE "source_key" IS NOT NULL DO UPDATE SET
          "title" = EXCLUDED."title",
          "description" = EXCLUDED."description",
          "activity_code" = EXCLUDED."activity_code",
          "status" = EXCLUDED."status",
          "urgency" = EXCLUDED."urgency",
          "assigned_role" = EXCLUDED."assigned_role",
          "shipment_id" = EXCLUDED."shipment_id",
          "entity_id" = EXCLUDED."entity_id",
          "sla_deadline" = EXCLUDED."sla_deadline",
          "metadata" = EXCLUDED."metadata",
          "updated_at" = EXCLUDED."updated_at"
        """,
        DEFAULT_ROLE_ID,
        float(sla_config.get("base_sla_hours") or 0),
    )
    task_rows = await _query_raw(
        prisma,
        """
        SELECT
          t."id"::text AS id, t."title", t."description", t."status", t."urgency",
          t."assigned_role", t."assigned_user_id", t."source_key"
        FROM "public"."task_instances" t
        WHERE t."source_key" LIKE 'ocr-validation-task:%'
          AND t."status" = ANY($1::text[])
        """,
        list(OPEN_STATUSES),
    )
    for task in task_rows:
        await _insert_notification(
            prisma,
            task=task,
            title=f"OCR validation task: {task.get('title')}",
            message=task.get("description") or "OCR validation found a mismatch that needs review.",
            source="ocr_validation_task",
            dedupe_key=f"notification:{task.get('source_key')}",
        )


async def _sync_document_status_tasks(
    prisma,
    *,
    activity_type: str,
    statuses: list[str],
    title: str,
    description: str,
    category: str,
) -> None:
    if not statuses or not await _has_table(prisma, "public.documents"):
        return
    sla_config = await _sla_config_for_activity(prisma, activity_type)
    if not sla_config:
        return
    source_prefix = f"document-status:{activity_type}:"
    await _execute_raw(
        prisma,
        """
        INSERT INTO "public"."task_instances" (
          "id", "title", "description", "category", "activity_code", "status", "urgency",
          "assigned_role", "entity_type", "entity_id", "sla_deadline",
          "metadata", "source_key", "created_by", "created_at", "updated_at"
        )
        SELECT
          (
            substr(md5($1 || d."id"::text), 1, 8) || '-' ||
            substr(md5($1 || d."id"::text), 9, 4) || '-' ||
            substr(md5($1 || d."id"::text), 13, 4) || '-' ||
            substr(md5($1 || d."id"::text), 17, 4) || '-' ||
            substr(md5($1 || d."id"::text), 21, 12)
          )::uuid,
          $2 || ': ' || d."doc_type"::text,
          $3,
          $4,
          $5,
          'ASSIGNED',
          'NORMAL',
          $6,
          'document',
          d."id"::text,
          d."updated_at" + ($7::double precision * INTERVAL '1 hour'),
          jsonb_build_object(
            'module', 'documents',
            'source', 'document_status',
            'documentId', d."id"::text,
            'docType', d."doc_type"::text,
            'documentStatus', d."status"::text
          ),
          $1 || d."id"::text,
          COALESCE(d."uploaded_by", 'system'),
          d."updated_at",
          NOW()
        FROM "public"."documents" d
        WHERE d."is_deleted" IS FALSE
          AND d."status"::text = ANY($8::text[])
        ON CONFLICT ("source_key") WHERE "source_key" IS NOT NULL DO UPDATE SET
          "title" = EXCLUDED."title",
          "description" = EXCLUDED."description",
          "sla_deadline" = EXCLUDED."sla_deadline",
          "metadata" = EXCLUDED."metadata",
          "updated_at" = NOW()
        """,
        source_prefix,
        title,
        description,
        category,
        activity_type,
        DEFAULT_ROLE_ID,
        float(sla_config.get("base_sla_hours") or 0),
        statuses,
    )
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."task_instances" t
        SET "status" = 'COMPLETED', "completed_at" = COALESCE(t."completed_at", NOW()), "updated_at" = NOW()
        WHERE t."source_key" LIKE $1
          AND t."status" = ANY($2::text[])
          AND NOT EXISTS (
            SELECT 1
            FROM "public"."documents" d
            WHERE d."id"::text = t."entity_id"
              AND d."is_deleted" IS FALSE
              AND d."status"::text = ANY($3::text[])
          )
        """,
        f"{source_prefix}%",
        list(OPEN_STATUSES),
        statuses,
    )


async def _sync_missing_upload_tasks(prisma) -> None:
    if not (
        await _has_table(prisma, "public.shipment_gates")
        and await _has_table(prisma, "public.gate_configs")
        and await _has_table(prisma, "public.doc_type_gates")
        and await _has_table(prisma, "public.documents")
    ):
        return
    if not await _sla_config_for_activity(prisma, "upload_document"):
        return
    source_prefix = "missing-upload:"
    try:
        await _execute_raw(
            prisma,
            """
            INSERT INTO "public"."task_instances" (
              "id", "title", "description", "category", "activity_code", "status", "urgency",
              "assigned_role", "shipment_id", "entity_type", "entity_id", "sla_deadline",
              "metadata", "source_key", "created_by", "created_at", "updated_at"
            )
            SELECT
              (
                substr(md5($1 || sg."shipment_id"::text || ':' || dtg."doc_type"), 1, 8) || '-' ||
                substr(md5($1 || sg."shipment_id"::text || ':' || dtg."doc_type"), 9, 4) || '-' ||
                substr(md5($1 || sg."shipment_id"::text || ':' || dtg."doc_type"), 13, 4) || '-' ||
                substr(md5($1 || sg."shipment_id"::text || ':' || dtg."doc_type"), 17, 4) || '-' ||
                substr(md5($1 || sg."shipment_id"::text || ':' || dtg."doc_type"), 21, 12)
              )::uuid,
              'Upload document: ' || dtg."doc_type",
              'Required shipment document has not been uploaded yet.',
              'Documents',
              'upload_document',
              'ASSIGNED',
              'NORMAL',
              $2,
              sg."shipment_id",
              'shipment_document',
              dtg."doc_type",
              sg."updated_at" + (ec."base_sla_hours" * INTERVAL '1 hour'),
              jsonb_build_object(
                'module', 'documents',
                'source', 'missing_upload',
                'shipmentId', sg."shipment_id"::text,
                'gateId', sg."id"::text,
                'gateConfigId', sg."gate_config_id"::text,
                'docType', dtg."doc_type",
                'gateNumber', gc."gate_number"
              ),
              $1 || sg."shipment_id"::text || ':' || dtg."doc_type",
              'system',
              sg."updated_at",
              NOW()
            FROM "public"."shipment_gates" sg
            JOIN "public"."gate_configs" gc ON gc."id" = sg."gate_config_id"
            JOIN "public"."doc_type_gates" dtg ON dtg."gate_config_id" = gc."id"
            JOIN LATERAL (
              SELECT "base_sla_hours"
              FROM "public"."escalation_configs" ec
              WHERE LOWER(ec."activity_type") = 'upload_document'
                AND ec."base_sla_hours" > 0
                AND COALESCE(ec."task_enabled", TRUE) IS TRUE
                AND (
                  COALESCE(NULLIF(TRIM(ec."scope"), ''), '') = ''
                  OR LOWER(ec."scope") = LOWER(dtg."doc_type")
                  OR LOWER(ec."base_doc") = LOWER(dtg."doc_type")
                )
              ORDER BY
                CASE
                  WHEN LOWER(ec."scope") = LOWER(dtg."doc_type") OR LOWER(ec."base_doc") = LOWER(dtg."doc_type") THEN 0
                  ELSE 1
                END,
                ec."id" ASC
              LIMIT 1
            ) ec ON TRUE
            WHERE sg."status" = 'OPEN'
              AND COALESCE(dtg."role_in_gate"::text, '') <> 'PARALLEL'
              AND COALESCE(dtg."is_generated", false) IS FALSE
              AND NOT EXISTS (
                SELECT 1
                FROM "public"."documents" d
                WHERE d."shipment_id" = sg."shipment_id"
                  AND COALESCE(d."is_deleted", false) IS FALSE
                  AND (
                    d."doc_type"::text = dtg."doc_type"
                    OR COALESCE(d."document_type"::text, '') = dtg."doc_type"
                  )
              )
            ON CONFLICT ("source_key") WHERE "source_key" IS NOT NULL DO UPDATE SET
              "title" = EXCLUDED."title",
              "description" = EXCLUDED."description",
              "sla_deadline" = EXCLUDED."sla_deadline",
              "metadata" = EXCLUDED."metadata",
              "updated_at" = NOW()
            """,
            source_prefix,
            DEFAULT_ROLE_ID,
        )
        await _execute_raw(
            prisma,
            """
            UPDATE "public"."task_instances" t
            SET "status" = 'COMPLETED', "completed_at" = COALESCE(t."completed_at", NOW()), "updated_at" = NOW()
            WHERE t."source_key" LIKE $1
              AND t."status" = ANY($2::text[])
              AND EXISTS (
                SELECT 1
                FROM "public"."documents" d
                WHERE d."shipment_id" = t."shipment_id"
                  AND COALESCE(d."is_deleted", false) IS FALSE
                  AND (
                    d."doc_type"::text = t."entity_id"
                    OR COALESCE(d."document_type"::text, '') = t."entity_id"
                  )
              )
            """,
            f"{source_prefix}%",
            list(OPEN_STATUSES),
        )
    except Exception:
        return


async def _sync_docgen_review_tasks(prisma) -> None:
    if not await _has_table(prisma, "docgen.drafts"):
        return
    activity_type = "approve_generated_document"
    sla_config = await _sla_config_for_activity(prisma, activity_type)
    if not sla_config:
        return
    source_prefix = "docgen-draft-review:"
    await _execute_raw(
        prisma,
        """
        INSERT INTO "public"."task_instances" (
          "id", "title", "description", "category", "activity_code", "status", "urgency",
          "assigned_role", "entity_type", "entity_id", "sla_deadline",
          "metadata", "source_key", "created_by", "created_at", "updated_at"
        )
        SELECT
          (
            substr(md5($1 || d."id"::text), 1, 8) || '-' ||
            substr(md5($1 || d."id"::text), 9, 4) || '-' ||
            substr(md5($1 || d."id"::text), 13, 4) || '-' ||
            substr(md5($1 || d."id"::text), 17, 4) || '-' ||
            substr(md5($1 || d."id"::text), 21, 12)
          )::uuid,
          'Approve generated document: ' || d."generated_doc_type",
          'Review and approve the generated document draft.',
          'Documents',
          $2,
          'ASSIGNED',
          'NORMAL',
          $3,
          'docgen_draft',
          d."id"::text,
          d."updated_at" + ($4::double precision * INTERVAL '1 hour'),
          jsonb_build_object(
            'module', 'documents',
            'source', 'docgen_review',
            'draftId', d."id"::text,
            'generatedDocType', d."generated_doc_type",
            'draftStatus', d."status"::text
          ),
          $1 || d."id"::text,
          d."created_by",
          d."updated_at",
          NOW()
        FROM "docgen"."drafts" d
        WHERE d."status"::text = 'IN_REVIEW'
        ON CONFLICT ("source_key") WHERE "source_key" IS NOT NULL DO UPDATE SET
          "title" = EXCLUDED."title",
          "description" = EXCLUDED."description",
          "sla_deadline" = EXCLUDED."sla_deadline",
          "metadata" = EXCLUDED."metadata",
          "updated_at" = NOW()
        """,
        source_prefix,
        activity_type,
        DEFAULT_ROLE_ID,
        float(sla_config.get("base_sla_hours") or 0),
    )
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."task_instances" t
        SET "status" = 'COMPLETED', "completed_at" = COALESCE(t."completed_at", NOW()), "updated_at" = NOW()
        WHERE t."source_key" LIKE $1
          AND t."status" = ANY($2::text[])
          AND NOT EXISTS (
            SELECT 1
            FROM "docgen"."drafts" d
            WHERE d."id"::text = t."entity_id"
              AND d."status"::text = 'IN_REVIEW'
          )
        """,
        f"{source_prefix}%",
        list(OPEN_STATUSES),
    )


async def _sync_activity_task_events(prisma) -> None:
    if not await _has_table(prisma, "public.activity_task_events"):
        return
    await _execute_raw(
        prisma,
        """
        INSERT INTO "public"."task_instances" (
          "id", "title", "description", "category", "activity_code", "status", "urgency",
          "assigned_role", "assigned_user_id", "shipment_id", "entity_type", "entity_id",
          "sla_deadline", "metadata", "source_key", "created_by", "created_at", "updated_at"
        )
        SELECT
          (
            substr(md5('activity-task-event:' || e."id"::text), 1, 8) || '-' ||
            substr(md5('activity-task-event:' || e."id"::text), 9, 4) || '-' ||
            substr(md5('activity-task-event:' || e."id"::text), 13, 4) || '-' ||
            substr(md5('activity-task-event:' || e."id"::text), 17, 4) || '-' ||
            substr(md5('activity-task-event:' || e."id"::text), 21, 12)
          )::uuid,
          COALESCE(NULLIF(e."title", ''), COALESCE(NULLIF(ec."task_message", ''), ec."activity_name")),
          e."description",
          e."category",
          e."activity_type",
          'ASSIGNED',
          e."urgency",
          COALESCE(NULLIF(e."assigned_role", ''), $1),
          e."assigned_user_id",
          e."shipment_id",
          e."entity_type",
          e."entity_id",
          e."created_at" + (ec."base_sla_hours" * INTERVAL '1 hour'),
          jsonb_build_object('module', 'sla', 'source', 'activity_task_event', 'eventId', e."id"::text)
            || COALESCE(e."metadata", '{}'::jsonb),
          COALESCE(e."source_key", 'activity-task-event:' || e."id"::text),
          COALESCE(e."created_by", 'system'),
          e."created_at",
          NOW()
        FROM "public"."activity_task_events" e
        JOIN LATERAL (
          SELECT "activity_name", "base_sla_hours", "task_message"
          FROM "public"."escalation_configs" ec
          WHERE LOWER(ec."activity_type") = LOWER(e."activity_type")
            AND ec."base_sla_hours" > 0
            AND COALESCE(ec."task_enabled", TRUE) IS TRUE
            AND (
              COALESCE(NULLIF(TRIM(e."scope"), ''), '') = ''
              OR COALESCE(NULLIF(TRIM(ec."scope"), ''), '') = ''
              OR LOWER(ec."scope") = LOWER(e."scope")
            )
          ORDER BY
            CASE WHEN COALESCE(ec."scope", '') = COALESCE(e."scope", '') THEN 0 ELSE 1 END,
            ec."id" ASC
          LIMIT 1
        ) ec ON TRUE
        WHERE e."processed_at" IS NULL
        ON CONFLICT ("source_key") WHERE "source_key" IS NOT NULL DO NOTHING
        """,
        DEFAULT_ROLE_ID,
    )
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."activity_task_events" e
        SET "processed_at" = NOW()
        WHERE e."processed_at" IS NULL
          AND EXISTS (
            SELECT 1
            FROM "public"."escalation_configs" ec
            WHERE LOWER(ec."activity_type") = LOWER(e."activity_type")
              AND ec."base_sla_hours" > 0
              AND COALESCE(ec."task_enabled", TRUE) IS TRUE
          )
        """,
    )


async def _sync_configured_activity_tasks(prisma) -> None:
    await _sync_missing_upload_tasks(prisma)
    await _sync_document_status_tasks(
        prisma,
        activity_type="fill_manual_fields",
        statuses=["EXTRACTED"],
        title="Fill manual fields",
        description="Review extracted document fields and complete any manual inputs.",
        category="Documents",
    )
    await _sync_document_status_tasks(
        prisma,
        activity_type="re_upload_document",
        statuses=["REJECTED"],
        title="Re-upload document",
        description="The uploaded document was rejected and needs to be uploaded again.",
        category="Documents",
    )
    await _sync_docgen_review_tasks(prisma)
    await _sync_activity_task_events(prisma)


async def _sync_task_reminders(prisma) -> None:
    await _ensure_tables(prisma)
    await _sync_ocr_validation_tasks(prisma)
    await _sync_configured_activity_tasks(prisma)
    if not await _has_escalation_config_table(prisma):
        return
    rows = await _query_raw(
        prisma,
        """
        SELECT
          t."id"::text AS id, t."title", t."description", t."status", t."urgency",
          t."assigned_role", t."assigned_user_id", t."created_at", t."sla_deadline",
          COALESCE(ec."reminder_pct", 0) AS reminder_pct
        FROM "public"."task_instances" t
        JOIN LATERAL (
          SELECT "reminder_pct"
          FROM "public"."escalation_configs" ec
          WHERE LOWER(ec."activity_type") = LOWER(t."activity_code")
            AND ec."base_sla_hours" > 0
            AND COALESCE(ec."task_enabled", TRUE) IS TRUE
            AND (
              LOWER(t."activity_code") <> 'resolve_validation_failure'
              OR (
                COALESCE(NULLIF(TRIM(ec."base_doc"), ''), 'Doc names') <> 'Doc names'
                AND LOWER(COALESCE(NULLIF(TRIM(ec."scope"), ''), 'validation')) NOT IN ('validation', 'document', 'generated documents')
              )
            )
          ORDER BY
            CASE WHEN COALESCE(ec."scope", '') = '' THEN 1 ELSE 0 END,
            ec."id" ASC
          LIMIT 1
        ) ec ON TRUE
        WHERE t."status" = ANY($1::text[])
          AND t."sla_deadline" IS NOT NULL
          AND COALESCE(ec."reminder_pct", 0) > 0
          AND NOW() >= (
            t."created_at" + ((t."sla_deadline" - t."created_at") * (COALESCE(ec."reminder_pct", 0)::double precision / 100.0))
          )
        """,
        list(OPEN_STATUSES),
    )
    for task in rows:
        pct = int(task.get("reminder_pct") or 0)
        await _insert_notification(
            prisma,
            task=task,
            title=f"Task reminder: {task.get('title')}",
            message="This task has reached its configured SLA reminder threshold.",
            source="task_reminder",
            dedupe_key=f"task-reminder:{task['id']}:{pct}",
        )


def _task_row(row: dict[str, Any]) -> dict[str, Any]:
    metadata = _json(row.get("metadata"), {}) or {}
    shipment_number = row.get("shipment_number")
    return {
        "id": str(row.get("id")),
        "title": row.get("title") or "",
        "description": row.get("description"),
        "category": row.get("category") or "General",
        "activityCode": row.get("activity_code") or "TSK-001",
        "status": row.get("status") or "ASSIGNED",
        "urgency": row.get("urgency") or "NORMAL",
        "assignedRole": row.get("assigned_role"),
        "assignedUserId": row.get("assigned_user_id"),
        "assignedUser": None,
        "shipmentId": str(row.get("shipment_id")) if row.get("shipment_id") else None,
        "shipment": {"shipmentNumber": shipment_number, "currentStageName": row.get("current_stage_name")} if shipment_number else None,
        "entityType": row.get("entity_type"),
        "entityId": row.get("entity_id"),
        "parentTaskId": str(row.get("parent_task_id")) if row.get("parent_task_id") else None,
        "parentTask": {"title": row.get("parent_title")} if row.get("parent_title") else None,
        "slaDeadline": row.get("sla_deadline").isoformat() if hasattr(row.get("sla_deadline"), "isoformat") else row.get("sla_deadline"),
        "startedAt": row.get("started_at").isoformat() if hasattr(row.get("started_at"), "isoformat") else row.get("started_at"),
        "completedAt": row.get("completed_at").isoformat() if hasattr(row.get("completed_at"), "isoformat") else row.get("completed_at"),
        "escalationLevel": int(row.get("escalation_level") or 0),
        "escalationType": row.get("escalation_type"),
        "metadata": metadata,
        "isDelegated": bool(metadata.get("delegationLog")),
        "createdAt": row.get("created_at").isoformat() if hasattr(row.get("created_at"), "isoformat") else row.get("created_at"),
        "updatedAt": row.get("updated_at").isoformat() if hasattr(row.get("updated_at"), "isoformat") else row.get("updated_at"),
    }


def _notification_row(row: dict[str, Any]) -> dict[str, Any]:
    created_at = row.get("created_at")
    created = created_at.isoformat() if hasattr(created_at, "isoformat") else created_at
    return {
        "id": str(row.get("id")),
        "type": row.get("type") or "info",
        "title": row.get("title") or "",
        "message": row.get("message") or "",
        "description": row.get("message") or "",
        "link": row.get("link") or "/tasks",
        "read": bool(row.get("read")),
        "isRead": bool(row.get("read")),
        "createdAt": created,
        "timestamp": created,
        "taskId": str(row.get("task_id")) if row.get("task_id") else None,
        "shipmentId": row.get("shipment_number") or "",
        "metadata": _json(row.get("metadata"), {}) or {},
    }


def _page_meta(total: int, page: int, page_size: int) -> dict[str, int | bool]:
    total_pages = max(1, (total + page_size - 1) // page_size)
    return {
        "total": total,
        "page": page,
        "pageSize": page_size,
        "totalPages": total_pages,
        "hasNext": page < total_pages,
        "hasPrev": page > 1,
    }


def _pagination(page: int, page_size: int) -> tuple[int, int, int]:
    safe_page = max(1, int(page or 1))
    safe_page_size = max(1, min(100, int(page_size or 20)))
    return safe_page, safe_page_size, (safe_page - 1) * safe_page_size


async def _task_rows(prisma, where: str = "", *params, limit: int = 500, offset: int = 0) -> list[dict[str, Any]]:
    safe_limit = max(1, min(500, int(limit)))
    safe_offset = max(0, int(offset))
    effective_where = _apply_sla_task_filter(where)
    rows = await _query_raw(
        prisma,
        f"""
        SELECT
          t.*, t."id"::text AS id, t."shipment_id"::text AS shipment_id,
          t."parent_task_id"::text AS parent_task_id,
          s."shipment_number", s."current_stage_name",
          p."title" AS parent_title
        FROM "public"."task_instances" t
        LEFT JOIN "public"."shipments" s ON s."id" = t."shipment_id"
        LEFT JOIN "public"."task_instances" p ON p."id" = t."parent_task_id"
        {effective_where}
        ORDER BY
          CASE t."urgency" WHEN 'BLOCKER' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END,
          t."created_at" DESC
        LIMIT {safe_limit}
        OFFSET {safe_offset}
        """,
        *params,
    )
    return [_task_row(row) for row in rows]


async def _task_total(prisma, where: str = "", *params) -> int:
    effective_where = _apply_sla_task_filter(where)
    rows = await _query_raw(
        prisma,
        f"""
        SELECT COUNT(*) AS total
        FROM "public"."task_instances" t
        LEFT JOIN "public"."shipments" s ON s."id" = t."shipment_id"
        {effective_where}
        """,
        *params,
    )
    return int((rows[0] if rows else {}).get("total") or 0)


def _current_scope_where(scope: str, user: Any, base: list[str], params: list[Any]) -> None:
    if scope == "all":
        return
    if scope == "team":
        params.append(_user_role(user))
        base.append(f't."assigned_role" = ${len(params)}')
        return
    params.append(_user_id(user))
    user_idx = len(params)
    params.append(_user_role(user))
    role_idx = len(params)
    base.append(f'(t."assigned_user_id" = ${user_idx} OR (t."assigned_user_id" IS NULL AND t."assigned_role" = ${role_idx}))')


@router.get("/tasks")
async def list_tasks(
    scope: str = Query("mine"),
    urgency: str | None = None,
    status: str | None = None,
    search: str | None = None,
    shipmentId: str | None = None,
    assignedRoleId: str | None = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    user=Depends(get_current_user),
):
    prisma = await get_prisma()
    await _sync_task_reminders(prisma)
    clauses: list[str] = []
    params: list[Any] = []
    _current_scope_where(scope, user, clauses, params)
    if urgency:
        params.append(urgency)
        clauses.append(f't."urgency" = ${len(params)}')
    if status:
        statuses = [item.strip() for item in status.split(",") if item.strip()]
        if statuses:
            params.append(statuses)
            clauses.append(f't."status" = ANY(${len(params)}::text[])')
    if search:
        params.append(f"%{search.lower()}%")
        clauses.append(
            f"""(
              LOWER(t."title") LIKE ${len(params)}
              OR LOWER(COALESCE(t."description", '')) LIKE ${len(params)}
              OR LOWER(COALESCE(t."activity_code", '')) LIKE ${len(params)}
              OR LOWER(COALESCE(s."shipment_number", '')) LIKE ${len(params)}
            )"""
        )
    if shipmentId:
        params.append(shipmentId)
        clauses.append(f't."shipment_id" = ${len(params)}::uuid')
    if assignedRoleId:
        params.append(assignedRoleId)
        clauses.append(f't."assigned_role" = ${len(params)}')
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    safe_page, safe_page_size, offset = _pagination(page, pageSize)
    total = await _task_total(prisma, where, *params)
    return {
        "ok": True,
        "data": await _task_rows(prisma, where, *params, limit=safe_page_size, offset=offset),
        "meta": _page_meta(total, safe_page, safe_page_size),
    }


@router.post("/tasks")
async def create_task(request: TaskCreateRequest, user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _ensure_tables(prisma)
    title = request.title.strip()
    if not title:
        return {"ok": False, "error": "Task title is required."}
    task_id = str(uuid4())
    activity_code = _sla_activity_type(request.activityCode)
    sla_config = await _sla_config_for_activity(prisma, activity_code)
    if not sla_config:
        return {"ok": False, "error": f"No SLA is defined for activity '{activity_code}'. Define an SLA before creating tasks or notifications for it."}
    base_sla_hours = float(sla_config.get("base_sla_hours") or 0)
    await _execute_raw(
        prisma,
        """
        INSERT INTO "public"."task_instances" (
          "id", "title", "description", "category", "activity_code", "status", "urgency",
          "assigned_role", "assigned_user_id", "shipment_id", "entity_type", "entity_id",
          "sla_deadline", "created_by"
        )
        VALUES (
          $1::uuid, $2, $3, $4, $5, 'ASSIGNED', $6,
          $7, $8, NULLIF($9, '')::uuid, $10, $11,
          COALESCE(NULLIF($12, '')::timestamptz, NOW() + ($13::double precision * INTERVAL '1 hour')), $14
        )
        """,
        task_id,
        title,
        request.description,
        request.category or "General",
        activity_code,
        request.urgency or "NORMAL",
        request.assignedRole or _user_role(user),
        request.assignedUserId,
        request.shipmentId or "",
        request.entityType or "task",
        request.entityId,
        request.slaDeadline or "",
        base_sla_hours,
        _user_id(user),
    )
    tasks = await _task_rows(prisma, 'WHERE t."id" = $1::uuid', task_id)
    if tasks:
        await _insert_notification(
            prisma,
            task={
                "id": task_id,
                "title": title,
                "urgency": request.urgency or "NORMAL",
                "status": "ASSIGNED",
                "assigned_role": request.assignedRole or _user_role(user),
                "assigned_user_id": request.assignedUserId,
            },
            title=f"New task: {title}",
            message=request.description or "A task has been assigned in the Task module.",
            source="task_assignment",
            dedupe_key=f"task-created:{task_id}",
        )
    return {"ok": True, "data": tasks[0] if tasks else None}


@router.get("/tasks/count")
async def task_count(user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _sync_task_reminders(prisma)
    role = _user_role(user)
    user_id = _user_id(user)
    rows = await _query_raw(
        prisma,
        f"""
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE "urgency" = 'BLOCKER') AS blockers
        FROM "public"."task_instances"
        WHERE "status" = ANY($1::text[])
          AND {_sla_task_clause("")}
          AND ("assigned_user_id" = $2 OR ("assigned_user_id" IS NULL AND "assigned_role" = $3))
        """,
        list(OPEN_STATUSES),
        user_id,
        role,
    )
    row = rows[0] if rows else {}
    return {"ok": True, "data": {"total": int(row.get("total") or 0), "blockers": int(row.get("blockers") or 0)}}


@router.get("/tasks/summary")
async def task_summary(user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _sync_task_reminders(prisma)
    role = _user_role(user)
    user_id = _user_id(user)
    rows = await _query_raw(
        prisma,
        f"""
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE "urgency" = 'BLOCKER') AS blockers,
          COUNT(*) FILTER (WHERE "urgency" = 'WARNING') AS warnings,
          COUNT(*) FILTER (WHERE "urgency" = 'NORMAL') AS normal,
          COUNT(*) FILTER (WHERE "status" = 'ESCALATED') AS escalated,
          COUNT(*) FILTER (WHERE "assigned_user_id" = $2 OR ("assigned_user_id" IS NULL AND "assigned_role" = $3)) AS my_count,
          COUNT(*) FILTER (WHERE "assigned_role" = $3) AS team_count
        FROM "public"."task_instances"
        WHERE "status" = ANY($1::text[])
          AND {_sla_task_clause("")}
        """,
        list(OPEN_STATUSES),
        user_id,
        role,
    )
    row = rows[0] if rows else {}
    return {"ok": True, "data": {
        "total": int(row.get("total") or 0),
        "blockers": int(row.get("blockers") or 0),
        "warnings": int(row.get("warnings") or 0),
        "normal": int(row.get("normal") or 0),
        "escalated": int(row.get("escalated") or 0),
        "myCount": int(row.get("my_count") or 0),
        "teamCount": int(row.get("team_count") or 0),
    }}


@router.get("/tasks/roles")
async def task_roles(_user=Depends(get_current_user), minLevel: int | None = None):
    prisma = await get_prisma()
    rows = await _query_raw(prisma, 'SELECT "id", "name", "system_role"::text AS role FROM "auth"."users" WHERE "is_active" = TRUE ORDER BY "name"')
    roles = sorted({DEFAULT_ROLE_ID, *[str(row.get("role") or "") for row in rows if row.get("role")]})
    return {"ok": True, "data": [{"id": role, "name": role.replace("_", " ").title(), "roleCode": role, "roleName": role.replace("_", " ").title()} for role in roles]}


@router.get("/tasks/users")
async def task_users(search: str | None = None, roleId: str | None = None, _user=Depends(get_current_user)):
    prisma = await get_prisma()
    params: list[Any] = []
    clauses = ['"is_active" = TRUE']
    if search:
        params.append(f"%{search.lower()}%")
        clauses.append(f'(LOWER("name") LIKE ${len(params)} OR LOWER("email") LIKE ${len(params)})')
    rows = await _query_raw(
        prisma,
        f'SELECT "id"::text AS id, "name", "email", "system_role"::text AS role FROM "auth"."users" WHERE {" AND ".join(clauses)} ORDER BY "name" LIMIT 50',
        *params,
    )
    data = [{"id": row["id"], "fullName": row.get("name"), "email": row.get("email"), "roleId": row.get("role")} for row in rows]
    if roleId:
        data = [item for item in data if item.get("roleId") == roleId]
    return {"ok": True, "data": data}


@router.get("/tasks/analytics")
async def task_analytics(_user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _sync_task_reminders(prisma)
    score_rows = await _query_raw(
        prisma,
        f"""
        SELECT
          COUNT(*) FILTER (WHERE "status" = ANY($1::text[])) AS open_count,
          COUNT(*) FILTER (WHERE "status" = 'COMPLETED') AS completed_count,
          COUNT(*) FILTER (WHERE "urgency" = 'BLOCKER' AND "status" = ANY($1::text[])) AS blocker_count,
          COUNT(*) FILTER (WHERE "sla_deadline" < NOW() AND "status" = ANY($1::text[])) AS overdue_count
        FROM "public"."task_instances"
        WHERE {_sla_task_clause("")}
        """,
        list(OPEN_STATUSES),
    )
    role_rows = await _query_raw(
        prisma,
        f"""
        SELECT
          COALESCE("assigned_role", 'Unassigned') AS role_id,
          COALESCE("assigned_role", 'Unassigned') AS role_code,
          COALESCE("assigned_role", 'Unassigned') AS role_name,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE "urgency" = 'BLOCKER') AS blockers,
          COUNT(*) FILTER (WHERE "urgency" = 'WARNING') AS warnings,
          COUNT(*) FILTER (WHERE "urgency" = 'NORMAL') AS normal
        FROM "public"."task_instances"
        WHERE "status" = ANY($1::text[])
          AND {_sla_task_clause("")}
        GROUP BY COALESCE("assigned_role", 'Unassigned')
        ORDER BY total DESC
        LIMIT 12
        """,
        list(OPEN_STATUSES),
    )
    hotspot_rows = await _query_raw(
        prisma,
        f"""
        SELECT
          t."shipment_id"::text AS shipment_id,
          COALESCE(s."shipment_number", t."shipment_id"::text) AS shipment_number,
          s."current_stage_name",
          COUNT(*) FILTER (WHERE t."urgency" = 'BLOCKER') AS blockers,
          COUNT(*) FILTER (WHERE t."urgency" = 'WARNING') AS warnings,
          COALESCE(EXTRACT(DAY FROM NOW() - MIN(t."created_at"))::int, 0) AS oldest_task_age_days
        FROM "public"."task_instances" t
        LEFT JOIN "public"."shipments" s ON s."id" = t."shipment_id"
        WHERE t."status" = ANY($1::text[]) AND t."shipment_id" IS NOT NULL
          AND {_sla_task_clause("t")}
        GROUP BY t."shipment_id", s."shipment_number", s."current_stage_name"
        ORDER BY blockers DESC, oldest_task_age_days DESC
        LIMIT 20
        """,
        list(OPEN_STATUSES),
    )
    score = score_rows[0] if score_rows else {}
    return {"ok": True, "data": {
        "scorecard": {
            "openCount": int(score.get("open_count") or 0),
            "completedCount": int(score.get("completed_count") or 0),
            "blockerCount": int(score.get("blocker_count") or 0),
            "overdueCount": int(score.get("overdue_count") or 0),
        },
        "tasksByRole": [
            {
                "roleId": row.get("role_id"),
                "roleCode": row.get("role_code"),
                "roleName": row.get("role_name"),
                "color": "#3b82f6",
                "total": int(row.get("total") or 0),
                "blockers": int(row.get("blockers") or 0),
                "warnings": int(row.get("warnings") or 0),
                "normal": int(row.get("normal") or 0),
            }
            for row in role_rows
        ],
        "slaTrend": [],
        "hotspots": [
            {
                "shipmentId": row.get("shipment_id"),
                "shipmentNumber": row.get("shipment_number"),
                "currentGateName": row.get("current_stage_name"),
                "blockers": int(row.get("blockers") or 0),
                "warnings": int(row.get("warnings") or 0),
                "oldestTaskAgeDays": int(row.get("oldest_task_age_days") or 0),
            }
            for row in hotspot_rows
        ],
    }}


@router.get("/tasks/{task_id}")
async def task_detail(task_id: str, _user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _sync_task_reminders(prisma)
    rows = await _task_rows(prisma, 'WHERE t."id" = $1::uuid', task_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True, "data": rows[0]}


@router.post("/tasks/{task_id}/start")
async def start_task(task_id: str, _user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _ensure_tables(prisma)
    rows = await _task_rows(prisma, 'WHERE t."id" = $1::uuid', task_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    await _execute_raw(
        prisma,
        'UPDATE "public"."task_instances" SET "status" = \'IN_PROGRESS\', "started_at" = COALESCE("started_at", NOW()), "updated_at" = NOW() WHERE "id" = $1::uuid',
        task_id,
    )
    return {"ok": True}


@router.post("/tasks/{task_id}/complete")
async def complete_task(task_id: str, _user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _ensure_tables(prisma)
    rows = await _task_rows(prisma, 'WHERE t."id" = $1::uuid', task_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    await _execute_raw(
        prisma,
        'UPDATE "public"."task_instances" SET "status" = \'COMPLETED\', "completed_at" = NOW(), "updated_at" = NOW() WHERE "id" = $1::uuid',
        task_id,
    )
    return {"ok": True}


@router.post("/tasks/{task_id}/escalate")
async def escalate_task(task_id: str, request: EscalateRequest, _user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _ensure_tables(prisma)
    rows = await _task_rows(prisma, 'WHERE t."id" = $1::uuid', task_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    task = rows[0]
    metadata = task.get("metadata") or {}
    metadata["escalationReason"] = request.reason or "SLA breach"
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."task_instances"
        SET "status" = 'ESCALATED',
            "urgency" = 'BLOCKER',
            "assigned_role" = COALESCE($2, "assigned_role"),
            "escalation_level" = "escalation_level" + 1,
            "escalation_type" = 'MANUAL',
            "metadata" = $3::jsonb,
            "updated_at" = NOW()
        WHERE "id" = $1::uuid
        """,
        task_id,
        request.targetRoleId,
        json.dumps(metadata),
    )
    task["status"] = "ESCALATED"
    task["urgency"] = "BLOCKER"
    await _insert_notification(
        prisma,
        task=task,
        title=f"Task escalated: {task.get('title')}",
        message=request.reason or "This task has been escalated.",
        source="task_escalation",
        dedupe_key=f"task-escalated:{task_id}:{datetime.now(timezone.utc).isoformat()}",
    )
    return {"ok": True}


@router.post("/tasks/{task_id}/reassign")
async def reassign_task(task_id: str, request: ReassignRequest, _user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _ensure_tables(prisma)
    rows = await _task_rows(prisma, 'WHERE t."id" = $1::uuid', task_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    role_id = request.roleId or request.assignedRoleId
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."task_instances"
        SET "assigned_role" = COALESCE($2, "assigned_role"),
            "assigned_user_id" = $3,
            "updated_at" = NOW()
        WHERE "id" = $1::uuid
        """,
        task_id,
        role_id,
        request.userId,
    )
    return {"ok": True}


@router.post("/tasks/{task_id}/delegate")
async def delegate_task(task_id: str, request: DelegateRequest, _user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _ensure_tables(prisma)
    rows = await _task_rows(prisma, 'WHERE t."id" = $1::uuid', task_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    metadata = rows[0].get("metadata") or {}
    log = metadata.get("delegationLog") if isinstance(metadata.get("delegationLog"), list) else []
    log.append({"toUserId": request.userId, "toName": request.userId or "Delegated user", "at": datetime.now(timezone.utc).isoformat()})
    metadata["delegationLog"] = log
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."task_instances"
        SET "assigned_user_id" = $2, "metadata" = $3::jsonb, "updated_at" = NOW()
        WHERE "id" = $1::uuid
        """,
        task_id,
        request.userId,
        json.dumps(metadata),
    )
    return {"ok": True}


@router.get("/notifications")
async def list_notifications(
    type: str | None = None,
    unreadOnly: bool = False,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    user=Depends(get_current_user),
):
    prisma = await get_prisma()
    await _sync_task_reminders(prisma)
    role = _user_role(user)
    user_id = _user_id(user)
    clauses = [_notification_recipient_clause("n"), _sla_notification_clause("n")]
    params: list[Any] = [user_id, role]
    if type:
        params.append(type)
        clauses.append(f'n."type" = ${len(params)}')
    if unreadOnly:
        clauses.append('n."read" = FALSE')
    where = " AND ".join(clauses)
    safe_page, safe_page_size, offset = _pagination(page, pageSize)
    rows = await _query_raw(
        prisma,
        f"""
        SELECT n.*, s."shipment_number"
        FROM "public"."notifications" n
        LEFT JOIN "public"."task_instances" t ON t."id" = n."task_id"
        LEFT JOIN "public"."shipments" s ON s."id" = t."shipment_id"
        WHERE {where}
        ORDER BY n."created_at" DESC
        LIMIT {safe_page_size}
        OFFSET {offset}
        """,
        *params,
    )
    total_rows = await _query_raw(
        prisma,
        f"""
        SELECT COUNT(*) AS total
        FROM "public"."notifications" n
        WHERE {where}
        """,
        *params,
    )
    unread_rows = await _query_raw(
        prisma,
        f"""
        SELECT COUNT(*) AS unread_count
        FROM "public"."notifications" n
        WHERE n."read" = FALSE
          AND {_notification_recipient_clause("n")}
          AND {_sla_notification_clause("n")}
        """,
        user_id,
        role,
    )
    type_rows = await _query_raw(
        prisma,
        f"""
        SELECT n."type", COUNT(*) AS count
        FROM "public"."notifications" n
        WHERE {_notification_recipient_clause("n")}
          AND {_sla_notification_clause("n")}
        GROUP BY n."type"
        """,
        user_id,
        role,
    )
    data = [_notification_row(row) for row in rows]
    meta = _page_meta(int((total_rows[0] if total_rows else {}).get("total") or 0), safe_page, safe_page_size)
    meta["unreadCount"] = int((unread_rows[0] if unread_rows else {}).get("unread_count") or 0)
    meta["typeCounts"] = {str(row.get("type") or "info"): int(row.get("count") or 0) for row in type_rows}
    return {"ok": True, "data": data, "meta": meta}


@router.patch("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _ensure_tables(prisma)
    await _execute_raw(
        prisma,
        f"""
        UPDATE "public"."notifications" n
        SET "read" = TRUE
        WHERE n."id" = $3::uuid
          AND {_notification_recipient_clause("n")}
          AND {_sla_notification_clause("n")}
        """,
        _user_id(user),
        _user_role(user),
        notification_id,
    )
    return {"ok": True}


@router.post("/notifications/mark-all-read")
async def mark_all_notifications_read(user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _ensure_tables(prisma)
    await _execute_raw(
        prisma,
        f"""
        UPDATE "public"."notifications"
        SET "read" = TRUE
        WHERE {_notification_recipient_clause("")}
          AND {_sla_notification_clause("")}
        """,
        _user_id(user),
        _user_role(user),
    )
    return {"ok": True}


@router.get("/navigation/badges")
async def navigation_badges(user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _sync_task_reminders(prisma)
    role = _user_role(user)
    user_id = _user_id(user)
    task_rows = await _query_raw(
        prisma,
        f"""
        SELECT COUNT(*) AS total
        FROM "public"."task_instances"
        WHERE "status" = ANY($1::text[])
          AND {_sla_task_clause("")}
          AND ("assigned_user_id" = $2 OR ("assigned_user_id" IS NULL AND "assigned_role" = $3))
        """,
        list(OPEN_STATUSES),
        user_id,
        role,
    )
    notif_rows = await _query_raw(
        prisma,
        f"""
        SELECT COUNT(*) AS unread
        FROM "public"."notifications"
        WHERE "read" = FALSE
          AND {_notification_recipient_clause("")}
          AND {_sla_notification_clause("")}
        """,
        user_id,
        role,
    )
    return {"ok": True, "data": {
        "tasks": int((task_rows[0] if task_rows else {}).get("total") or 0),
        "pendingDocuments": 0,
        "pendingTickets": 0,
        "unread": int((notif_rows[0] if notif_rows else {}).get("unread") or 0),
    }}
