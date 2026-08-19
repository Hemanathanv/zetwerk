from __future__ import annotations

import json
from typing import Any

from .notifications import insert_notification
from .repository import assigned_role_from_targets, debug, ensure_task_engine_tables, execute_raw, query_raw


OPEN_STATUSES = ("PENDING", "ASSIGNED", "IN_PROGRESS", "ESCALATED")



def _assigned_role_from_config(config: dict[str, Any] | None) -> str | None:
    if not config:
        return None
    return assigned_role_from_targets(config.get("targets"))

def _notification_type_for_task(task: dict[str, Any]) -> str:
    if task.get("status") == "ESCALATED":
        return "escalation"
    if task.get("urgency") == "BLOCKER":
        return "blocker"
    if task.get("urgency") == "WARNING":
        return "warning"
    return "info"


async def _has_escalation_config_table(prisma) -> bool:
    rows = await query_raw(
        prisma,
        "SELECT to_regclass('public.escalation_configs')::text AS table_name",
    )
    return bool(rows and rows[0].get("table_name"))


async def _has_table(prisma, qualified_name: str) -> bool:
    rows = await query_raw(
        prisma,
        "SELECT to_regclass($1)::text AS table_name",
        qualified_name,
    )
    return bool(rows and rows[0].get("table_name"))


async def _sla_config_for_activity(prisma, activity_type: str) -> dict[str, Any] | None:
    if not await _has_escalation_config_table(prisma):
        return None
    rows = await query_raw(
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
    rows = await query_raw(
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


async def _insert_task_notification(
    prisma,
    *,
    task: dict[str, Any],
    title: str,
    message: str,
    source: str,
    dedupe_key: str,
) -> None:
    await insert_notification(
        prisma,
        task_id=str(task["id"]),
        notification_type=_notification_type_for_task(task),
        title=title,
        message=message,
        recipient_role=task.get("assigned_role"),
        recipient_user_id=task.get("assigned_user_id"),
        source=source,
        dedupe_key=dedupe_key,
        metadata={"module": "tasks", "urgency": task.get("urgency")},
    )


async def _sync_ocr_validation_tasks(prisma) -> None:
    table_rows = await query_raw(
        prisma,
        "SELECT to_regclass('document_module.validation_tasks')::text AS table_name",
    )
    if not table_rows or not table_rows[0].get("table_name"):
        return

    sla_config = await _validation_sla_config(prisma)
    assigned_role = _assigned_role_from_config(sla_config)
    if not sla_config or not assigned_role:
        debug("producer.skipped", producer="ocr_validation", reason="missing_assigned_role_in_config")
        return

    await execute_raw(
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
          $1,
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
            'escalationConfigId', $3,
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
        assigned_role,
        float(sla_config.get("base_sla_hours") or 0),
        str(sla_config.get("id") or ""),
    )
    task_rows = await query_raw(
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
        await _insert_task_notification(
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
    assigned_role = _assigned_role_from_config(sla_config)
    if not sla_config or not assigned_role:
        debug("producer.skipped", producer="document_status", activity_type=activity_type, reason="missing_assigned_role_in_config")
        return
    source_prefix = f"document-status:{activity_type}:"
    await execute_raw(
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
            'escalationConfigId', $9,
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
        assigned_role,
        float(sla_config.get("base_sla_hours") or 0),
        statuses,
        str(sla_config.get("id") or ""),
    )
    await execute_raw(
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
        await execute_raw(
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
              COALESCE(
                NULLIF(ec."targets"->>'assignedRole', ''),
                NULLIF(ec."targets"->>'assignedRoleId', ''),
                NULLIF(ec."targets"->>'roleId', ''),
                NULLIF(ec."targets"->>'role', '')
              ),
              sg."shipment_id",
              'shipment_document',
              dtg."doc_type",
              sg."updated_at" + (ec."base_sla_hours" * INTERVAL '1 hour'),
              jsonb_build_object(
                'module', 'documents',
                'source', 'missing_upload',
                'escalationConfigId', ec."id",
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
              SELECT "id", "base_sla_hours", "targets"
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
              AND COALESCE(
                NULLIF(ec."targets"->>'assignedRole', ''),
                NULLIF(ec."targets"->>'assignedRoleId', ''),
                NULLIF(ec."targets"->>'roleId', ''),
                NULLIF(ec."targets"->>'role', '')
              ) IS NOT NULL
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
        )
        await execute_raw(
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
    assigned_role = _assigned_role_from_config(sla_config)
    if not sla_config or not assigned_role:
        debug("producer.skipped", producer="docgen_review", activity_type=activity_type, reason="missing_assigned_role_in_config")
        return
    source_prefix = "docgen-draft-review:"
    await execute_raw(
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
            'escalationConfigId', $5,
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
        assigned_role,
        float(sla_config.get("base_sla_hours") or 0),
        str(sla_config.get("id") or ""),
    )
    await execute_raw(
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
    await execute_raw(
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
          COALESCE(
            NULLIF(e."assigned_role", ''),
            NULLIF(ec."targets"->>'assignedRole', ''),
            NULLIF(ec."targets"->>'assignedRoleId', ''),
            NULLIF(ec."targets"->>'roleId', ''),
            NULLIF(ec."targets"->>'role', '')
          ),
          e."assigned_user_id",
          e."shipment_id",
          e."entity_type",
          e."entity_id",
          e."created_at" + (ec."base_sla_hours" * INTERVAL '1 hour'),
          jsonb_build_object('module', 'sla', 'source', 'activity_task_event', 'escalationConfigId', ec."id", 'eventId', e."id"::text)
            || COALESCE(e."metadata", '{}'::jsonb),
          COALESCE(e."source_key", 'activity-task-event:' || e."id"::text),
          COALESCE(e."created_by", 'system'),
          e."created_at",
          NOW()
        FROM "public"."activity_task_events" e
        JOIN LATERAL (
          SELECT "id", "activity_name", "base_sla_hours", "task_message", "targets"
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
          AND COALESCE(
            NULLIF(e."assigned_role", ''),
            NULLIF(ec."targets"->>'assignedRole', ''),
            NULLIF(ec."targets"->>'assignedRoleId', ''),
            NULLIF(ec."targets"->>'roleId', ''),
            NULLIF(ec."targets"->>'role', '')
          ) IS NOT NULL
        ON CONFLICT ("source_key") WHERE "source_key" IS NOT NULL DO NOTHING
        """,
    )
    await execute_raw(
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
              AND COALESCE(
                NULLIF(e."assigned_role", ''),
                NULLIF(ec."targets"->>'assignedRole', ''),
                NULLIF(ec."targets"->>'assignedRoleId', ''),
                NULLIF(ec."targets"->>'roleId', ''),
                NULLIF(ec."targets"->>'role', '')
              ) IS NOT NULL
          )
        """,
    )


async def _sync_configured_activity_tasks(prisma) -> None:
    await _sync_missing_upload_tasks(prisma)
    await _sync_docgen_review_tasks(prisma)
    await _sync_activity_task_events(prisma)



async def sync_task_producers(prisma) -> None:
    await ensure_task_engine_tables(prisma)
    await _sync_ocr_validation_tasks(prisma)
    await _sync_configured_activity_tasks(prisma)
    debug("producer.sync.done")
