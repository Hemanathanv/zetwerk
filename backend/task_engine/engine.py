from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from .documents import display_doc_type, extraction_source, normalize_doc_type, normalize_key
from .notifications import dispatch_notification_channels, insert_notification
from .repository import (
    ensure_task_engine_tables,
    execute_raw,
    json_param,
    query_raw,
    sync_link_rules_from_escalation_configs,
)


OPEN_STATUSES = ("PENDING", "ASSIGNED", "IN_PROGRESS", "ESCALATED")


def _debug(message: str, **fields: Any) -> None:
    if str(os.getenv("TASK_ENGINE_DEBUG", "")).lower() not in {"1", "true", "yes", "on"}:
        return
    suffix = ""
    if fields:
        suffix = " " + json.dumps(fields, default=str, sort_keys=True)
    print(f"[task_engine] {message}{suffix}", flush=True)


@dataclass
class MatchResult:
    status: str
    target_document_id: str | None = None
    target_status: str | None = None
    context: dict[str, Any] | None = None


class TaskEngine:
    def __init__(self, prisma):
        self.prisma = prisma

    @classmethod
    async def handle_event(cls, prisma, event: dict[str, Any]) -> dict[str, Any]:
        engine = cls(prisma)
        return await engine.handle(event)

    async def handle(self, event: dict[str, Any]) -> dict[str, Any]:
        _debug("event.received", event=event)
        await ensure_task_engine_tables(self.prisma)
        await sync_link_rules_from_escalation_configs(self.prisma)
        event_id = await self._record_event(event)
        event_type = str(event.get("event_type") or "")
        if event_type != "document_reviewed":
            _debug("event.ignored", event_id=event_id, event_type=event_type, reason="unsupported_event")
            return {"eventId": event_id, "status": "IGNORED", "reason": "unsupported_event"}
        result = await self._handle_document_reviewed(event)
        await execute_raw(
            self.prisma,
            'UPDATE "public"."task_engine_events" SET "status" = $2, "processed_at" = NOW() WHERE "id" = $1::uuid',
            event_id,
            "PROCESSED",
        )
        result["eventId"] = event_id
        _debug("event.processed", event_id=event_id, result=result)
        return result

    async def sync_runtime(self) -> dict[str, int]:
        from .producers import sync_task_producers

        await sync_task_producers(self.prisma)
        await self.sync_reviewed_documents()
        return await self.process_sla_thresholds()


    async def sync_reviewed_documents(self, limit: int = 500) -> dict[str, int]:
        await ensure_task_engine_tables(self.prisma)
        await sync_link_rules_from_escalation_configs(self.prisma)
        rows = await query_raw(
            self.prisma,
            """
            SELECT DISTINCT d."id"::text AS id
            FROM "public"."documents" d
            JOIN "public"."document_link_rules" r
              ON r."base_doc_type" = d."doc_type"::text
             AND r."trigger_event" = 'document_reviewed'
             AND r."is_active" IS TRUE
            WHERE d."is_deleted" IS FALSE
              AND d."status"::text = 'REVIEWED'
            ORDER BY d."id"::text
            LIMIT $1
            """,
            int(limit),
        )
        created = completed = skipped = 0
        _debug("reviewed_documents.sync.scan", documents=len(rows), limit=limit)
        for row in rows:
            result = await self._handle_document_reviewed({"entity_id": row.get("id")})
            created += int(result.get("created") or 0)
            completed += int(result.get("completed") or 0)
            skipped += int(result.get("skipped") or 0)
        _debug("reviewed_documents.sync.done", created=created, completed=completed, skipped=skipped)
        return {"created": created, "completed": completed, "skipped": skipped}

    async def process_sla_thresholds(self) -> dict[str, int]:
        await ensure_task_engine_tables(self.prisma)
        rows = await query_raw(
            self.prisma,
            """
            SELECT
              t."id"::text AS task_id, t."title", t."description", t."assigned_role", t."assigned_user_id",
              t."created_at", t."sla_deadline", t."status", t."urgency", t."metadata",
              ec."reminder_pct", ec."warning_pct", ec."escalation_pct", ec."blocker_pct",
              ec."reminder_message", ec."warning_message", ec."escalation_message", ec."blocker_message",
              ec."channels", ec."targets"
            FROM "public"."task_instances" t
            JOIN LATERAL (
              SELECT ec.*
              FROM "public"."escalation_configs" ec
              WHERE ec."base_sla_hours" > 0
                AND COALESCE(ec."task_enabled", TRUE) IS TRUE
                AND (
                  ec."id" = COALESCE(t."metadata"->>'escalationConfigId', '')
                  OR (
                    COALESCE(t."metadata"->>'escalationConfigId', '') = ''
                    AND LOWER(ec."activity_type") = LOWER(t."activity_code")
                    AND (
                      LOWER(t."activity_code") <> 'resolve_validation_failure'
                      OR (
                        COALESCE(NULLIF(TRIM(ec."base_doc"), ''), 'Doc names') <> 'Doc names'
                        AND LOWER(COALESCE(NULLIF(TRIM(ec."scope"), ''), 'validation')) NOT IN ('validation', 'document', 'generated documents')
                      )
                    )
                  )
                )
              ORDER BY
                CASE WHEN ec."id" = COALESCE(t."metadata"->>'escalationConfigId', '') THEN 0 ELSE 1 END,
                CASE WHEN COALESCE(ec."scope", '') = '' THEN 1 ELSE 0 END,
                ec."id" ASC
              LIMIT 1
            ) ec ON TRUE
            WHERE t."status" = ANY($1::text[])
              AND t."sla_deadline" IS NOT NULL
              AND t."created_at" < t."sla_deadline"
            """,
            list(OPEN_STATUSES),
        )
        counts = {"reminder": 0, "warning": 0, "escalation": 0, "blocker": 0}
        _debug("sla.scan", tasks=len(rows))
        for row in rows:
            created_at = row.get("created_at")
            deadline = row.get("sla_deadline")
            if not created_at or not deadline:
                continue
            created_at = self._as_utc(created_at)
            deadline = self._as_utc(deadline)
            elapsed = (datetime.now(timezone.utc) - created_at).total_seconds()
            total = (deadline - created_at).total_seconds()
            if total <= 0:
                continue
            pct = elapsed / total * 100
            for threshold, column, message_col in (
                ("reminder", "reminder_pct", "reminder_message"),
                ("warning", "warning_pct", "warning_message"),
                ("escalation", "escalation_pct", "escalation_message"),
                ("blocker", "blocker_pct", "blocker_message"),
            ):
                threshold_pct = int(row.get(column) or 0)
                if threshold_pct <= 0 or pct < threshold_pct:
                    continue
                created = await self._mark_sla_event(row, threshold, threshold_pct, row.get(message_col))
                if created:
                    counts[threshold] += 1
                    _debug(
                        "sla.threshold.created",
                        task_id=row.get("task_id"),
                        threshold=threshold,
                        threshold_pct=threshold_pct,
                        elapsed_pct=round(pct, 2),
                    )
                else:
                    _debug(
                        "sla.threshold.skipped",
                        task_id=row.get("task_id"),
                        threshold=threshold,
                        threshold_pct=threshold_pct,
                        reason="already_created",
                    )
        _debug("sla.scan.done", counts=counts)
        return counts

    def _as_utc(self, value: datetime | str) -> datetime:
        if isinstance(value, str):
            parsed = value.strip()
            if parsed.endswith("Z"):
                parsed = parsed[:-1] + "+00:00"
            value = datetime.fromisoformat(parsed)
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    async def _record_event(self, event: dict[str, Any]) -> str:
        event_id = str(uuid4())
        await execute_raw(
            self.prisma,
            """
            INSERT INTO "public"."task_engine_events" (
              "id", "event_type", "entity_type", "entity_id", "shipment_id", "actor_id", "payload"
            )
            VALUES ($1::uuid, $2, $3, $4, NULLIF($5, '')::uuid, $6, $7::jsonb)
            """,
            event_id,
            str(event.get("event_type") or ""),
            str(event.get("entity_type") or ""),
            str(event.get("entity_id") or ""),
            str(event.get("shipment_id") or ""),
            event.get("actor_id"),
            json.dumps(event.get("payload") or {}),
        )
        _debug(
            "event.recorded",
            event_id=event_id,
            event_type=event.get("event_type"),
            entity_type=event.get("entity_type"),
            entity_id=event.get("entity_id"),
            shipment_id=event.get("shipment_id"),
        )
        return event_id

    async def _handle_document_reviewed(self, event: dict[str, Any]) -> dict[str, Any]:
        document_id = str(event.get("entity_id") or "")
        base_doc = await self._document_context(document_id)
        if not base_doc:
            _debug("document_reviewed.skipped", document_id=document_id, reason="document_not_found")
            return {"status": "SKIPPED", "reason": "document_not_found", "created": 0, "completed": 0}
        base_doc_type = normalize_doc_type(base_doc.get("doc_type"))
        _debug(
            "document_reviewed.context",
            document_id=document_id,
            doc_type=base_doc_type,
            status=base_doc.get("status"),
            shipment_id=base_doc.get("shipment_id"),
            primary_number=base_doc.get("primaryNumber"),
            keys=base_doc.get("keys"),
        )
        rules = await query_raw(
            self.prisma,
            """
            SELECT r.*, ec."base_sla_hours", ec."task_message", ec."reminder_message",
                   ec."warning_message", ec."escalation_message", ec."blocker_message"
            FROM "public"."document_link_rules" r
            LEFT JOIN "public"."escalation_configs" ec ON ec."id" = r."escalation_config_id"
            WHERE r."is_active" IS TRUE
              AND r."trigger_event" = 'document_reviewed'
              AND r."base_doc_type" = $1
            """,
            base_doc_type,
        )
        _debug("document_reviewed.rules", document_id=document_id, base_doc_type=base_doc_type, rules=len(rules))
        created = 0
        completed = await self._resolve_tasks_waiting_for_document(base_doc)
        skipped = 0
        for rule in rules:
            _debug(
                "rule.evaluate",
                rule_id=rule.get("id"),
                escalation_config_id=rule.get("escalation_config_id"),
                base_doc_type=rule.get("base_doc_type"),
                target_doc_type=rule.get("target_doc_type"),
                assigned_role=rule.get("assigned_role"),
                base_sla_hours=rule.get("base_sla_hours"),
            )
            match = await self._find_target_document(base_doc, rule)
            source_key = self._source_key(rule, base_doc)
            if match.status == "FOUND":
                completed += await self._complete_task(source_key, match)
                _debug(
                    "rule.target_found",
                    rule_id=rule.get("id"),
                    source_key=source_key,
                    target_document_id=match.target_document_id,
                    target_status=match.target_status,
                    match=match.context,
                )
                continue
            if match.status == "MISSING":
                task_id = await self._create_or_update_upload_task(rule, base_doc, match)
                if task_id:
                    created += 1
                    _debug("rule.task_created_or_updated", rule_id=rule.get("id"), source_key=source_key, task_id=task_id)
                continue
            skipped += 1
            _debug("rule.skipped", rule_id=rule.get("id"), source_key=source_key, match_status=match.status, match=match.context)
        return {"status": "PROCESSED", "created": created, "completed": completed, "skipped": skipped}

    async def _resolve_tasks_waiting_for_document(self, reviewed_doc: dict[str, Any]) -> int:
        rows = await query_raw(
            self.prisma,
            """
            SELECT "source_key", "metadata"
            FROM "public"."task_instances"
            WHERE "status" = ANY($1::text[])
              AND "metadata"->>'source' = 'document_reviewed_required_upload'
              AND "metadata"->>'targetDocType' = $2
            LIMIT 250
            """,
            list(OPEN_STATUSES),
            normalize_doc_type(reviewed_doc.get("doc_type")),
        )
        _debug(
            "waiting_tasks.scan",
            reviewed_document_id=reviewed_doc.get("id"),
            reviewed_doc_type=normalize_doc_type(reviewed_doc.get("doc_type")),
            tasks=len(rows),
        )
        completed = 0
        for row in rows:
            metadata = row.get("metadata") or {}
            if isinstance(metadata, str):
                try:
                    metadata = json.loads(metadata)
                except json.JSONDecodeError:
                    metadata = {}
            base_document_id = str(metadata.get("baseDocumentId") or "")
            rule_id = str(metadata.get("ruleId") or "")
            if not base_document_id or not rule_id:
                continue
            base_doc = await self._document_context(base_document_id)
            if not base_doc:
                continue
            rule_rows = await query_raw(
                self.prisma,
                'SELECT * FROM "public"."document_link_rules" WHERE "id" = $1 AND "is_active" IS TRUE LIMIT 1',
                rule_id,
            )
            if not rule_rows:
                continue
            match = await self._find_target_document(base_doc, rule_rows[0])
            if match.status == "FOUND":
                completed += await self._complete_task(str(row.get("source_key") or ""), match)
                _debug(
                    "waiting_task.completed",
                    source_key=row.get("source_key"),
                    base_document_id=base_document_id,
                    reviewed_document_id=reviewed_doc.get("id"),
                    match=match.context,
                )
        return completed

    async def _document_context(self, document_id: str) -> dict[str, Any] | None:
        rows = await query_raw(
            self.prisma,
            """
            SELECT
              d."id"::text AS id,
              d."doc_type"::text AS doc_type,
              d."status"::text AS status,
              d."shipment_id"::text AS shipment_id,
              d."document_number",
              d."file_name",
              d."uploaded_by",
              d."created_at",
              d."updated_at"
            FROM "public"."documents" d
            WHERE d."id"::text = $1::text
              AND d."is_deleted" IS FALSE
            LIMIT 1
            """,
            document_id,
        )
        if not rows:
            _debug("document.context_missing", document_id=document_id)
            return None
        row = rows[0]
        keys = await self._document_keys(row["id"], row["doc_type"])
        primary_number = self._primary_document_number(row, keys)
        _debug("document.context_loaded", document_id=document_id, doc_type=row.get("doc_type"), shipment_id=row.get("shipment_id"), keys=keys)
        return {**row, "keys": keys, "primaryNumber": primary_number}

    async def _document_keys(self, document_id: str, doc_type: str) -> dict[str, list[str]]:
        source = extraction_source(doc_type)
        keys: dict[str, set[str]] = {}
        if not source:
            _debug("document.keys.skipped", document_id=document_id, doc_type=doc_type, reason="no_extraction_source")
            return {}
        select_parts: list[str] = []
        aliases: list[tuple[str, str]] = []
        for key_type, fields in source["fields"].items():
            for field in fields:
                alias = f"{key_type}_{field}".replace(".", "_")
                select_parts.append(f'e."{field}"::text AS "{alias}"')
                aliases.append((key_type, alias))
        if not select_parts:
            return {}
        rows = await query_raw(
            self.prisma,
            f"""
            SELECT {", ".join(select_parts)}
            FROM "aiextraction"."{source['table']}" e
            WHERE e."document_id"::text = $1::text
            LIMIT 1
            """,
            document_id,
        )
        if not rows:
            _debug("document.keys.empty", document_id=document_id, doc_type=doc_type, table=source["table"])
            return {}
        row = rows[0]
        for key_type, alias in aliases:
            raw = row.get(alias)
            norm = normalize_key(raw)
            if len(norm) >= 3:
                keys.setdefault(key_type, set()).add(norm)
        result = {key_type: sorted(values) for key_type, values in keys.items()}
        _debug("document.keys.loaded", document_id=document_id, doc_type=doc_type, table=source["table"], keys=result)
        return result

    def _primary_document_number(self, row: dict[str, Any], keys: dict[str, list[str]]) -> str:
        if row.get("document_number"):
            return str(row["document_number"])
        for key_type in ("invoice", "bl", "shipping_bill", "entry", "packing_slip", "project"):
            values = keys.get(key_type) or []
            if values:
                return values[0]
        return str(row.get("file_name") or row.get("id") or "")

    async def _find_target_document(self, base_doc: dict[str, Any], rule: dict[str, Any]) -> MatchResult:
        target_doc_type = normalize_doc_type(rule.get("target_doc_type"))
        match_key_types = rule.get("match_key_types") or []
        if isinstance(match_key_types, str):
            try:
                match_key_types = json.loads(match_key_types)
            except json.JSONDecodeError:
                match_key_types = []
        target_rows = await query_raw(
            self.prisma,
            """
            SELECT d."id"::text AS id, d."doc_type"::text AS doc_type, d."status"::text AS status,
                   d."shipment_id"::text AS shipment_id, d."document_number", d."file_name"
            FROM "public"."documents" d
            WHERE d."is_deleted" IS FALSE
              AND d."doc_type"::text = $1
              AND d."id"::text <> $2::text
              AND d."status"::text <> 'REJECTED'
            ORDER BY d."updated_at" DESC
            LIMIT 250
            """,
            target_doc_type,
            base_doc["id"],
        )
        if not target_rows:
            _debug(
                "target.search.missing",
                base_document_id=base_doc.get("id"),
                target_doc_type=target_doc_type,
                reason="target_doc_absent",
            )
            return MatchResult(status="MISSING", context={"reason": "target_doc_absent"})
        shipment_matches = [
            row for row in target_rows
            if base_doc.get("shipment_id") and row.get("shipment_id") == base_doc.get("shipment_id")
        ]
        if len(shipment_matches) == 1:
            row = shipment_matches[0]
            _debug(
                "target.search.found",
                base_document_id=base_doc.get("id"),
                target_document_id=row.get("id"),
                target_doc_type=target_doc_type,
                match="shipment_id",
            )
            return MatchResult(status="FOUND", target_document_id=row["id"], target_status=row.get("status"), context={"match": "shipment_id"})
        base_keys = base_doc.get("keys") or {}
        allowed_key_types = {str(item) for item in match_key_types} if match_key_types else set(base_keys)
        key_matches: list[tuple[dict[str, Any], str, str]] = []
        for row in target_rows:
            target_keys = await self._document_keys(row["id"], row["doc_type"])
            for key_type in allowed_key_types:
                overlap = set(base_keys.get(key_type) or []).intersection(target_keys.get(key_type) or [])
                if overlap:
                    key_matches.append((row, key_type, sorted(overlap)[0]))
        unique_matches = {row["id"]: (row, key_type, value) for row, key_type, value in key_matches}
        if len(unique_matches) == 1:
            row, key_type, value = next(iter(unique_matches.values()))
            _debug(
                "target.search.found",
                base_document_id=base_doc.get("id"),
                target_document_id=row.get("id"),
                target_doc_type=target_doc_type,
                match="extracted_key",
                key_type=key_type,
                key_value=value,
            )
            return MatchResult(status="FOUND", target_document_id=row["id"], target_status=row.get("status"), context={"match": "extracted_key", "keyType": key_type, "keyValue": value})
        if len(unique_matches) > 1:
            _debug(
                "target.search.ambiguous",
                base_document_id=base_doc.get("id"),
                target_doc_type=target_doc_type,
                matches=sorted(unique_matches),
            )
            return MatchResult(status="AMBIGUOUS", context={"matches": sorted(unique_matches)})
        _debug(
            "target.search.missing",
            base_document_id=base_doc.get("id"),
            target_doc_type=target_doc_type,
            reason="no_link_match",
            base_keys=base_keys,
        )
        return MatchResult(status="MISSING", context={"reason": "no_link_match", "baseKeys": base_keys})

    def _source_key(self, rule: dict[str, Any], base_doc: dict[str, Any]) -> str:
        raw = f"{rule['id']}:{base_doc['id']}:{rule['target_doc_type']}"
        digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()
        return f"task-engine:{digest}"

    async def _create_or_update_upload_task(self, rule: dict[str, Any], base_doc: dict[str, Any], match: MatchResult) -> str | None:
        source_key = self._source_key(rule, base_doc)
        target_doc_type = normalize_doc_type(rule.get("target_doc_type"))
        target_label = display_doc_type(target_doc_type)
        base_label = display_doc_type(base_doc.get("doc_type"))
        base_number = base_doc.get("primaryNumber") or base_doc.get("document_number") or base_doc["id"]
        title = f"Upload {target_label} for {base_label} {base_number}"
        description = f"{target_label} is required after {base_label} {base_number} was reviewed."
        task_id = str(uuid4())
        assigned_role = str(rule.get("assigned_role") or "").strip()
        if not assigned_role:
            _debug(
                "task.skipped",
                source_key=source_key,
                rule_id=rule.get("id"),
                escalation_config_id=rule.get("escalation_config_id"),
                reason="missing_assigned_role_in_config",
            )
            return None
        base_sla_hours = float(rule.get("base_sla_hours") or 24)
        metadata = {
            "module": "task_engine",
            "source": "document_reviewed_required_upload",
            "ruleId": rule["id"],
            "escalationConfigId": rule.get("escalation_config_id"),
            "baseDocumentId": base_doc["id"],
            "baseDocType": normalize_doc_type(base_doc.get("doc_type")),
            "baseDocumentNumber": base_number,
            "shipmentId": base_doc.get("shipment_id"),
            "targetDocType": target_doc_type,
            "match": match.context or {},
        }
        rows = await query_raw(
            self.prisma,
            """
            INSERT INTO "public"."task_instances" (
              "id", "title", "description", "category", "activity_code", "status", "urgency",
              "assigned_role", "shipment_id", "entity_type", "entity_id", "sla_deadline",
              "metadata", "source_key", "created_by", "created_at", "updated_at"
            )
            VALUES (
              $1::uuid, $2, $3, 'Documents', $4, 'ASSIGNED', 'NORMAL',
              $5, NULLIF($6, '')::uuid, 'document_requirement', $7,
              NOW() + ($8::double precision * INTERVAL '1 hour'),
              $9::jsonb, $10, $11, NOW(), NOW()
            )
            ON CONFLICT ("source_key") WHERE "source_key" IS NOT NULL DO UPDATE SET
              "title" = EXCLUDED."title",
              "description" = EXCLUDED."description",
              "assigned_role" = CASE
                WHEN "task_instances"."status" = 'ESCALATED' THEN "task_instances"."assigned_role"
                ELSE EXCLUDED."assigned_role"
              END,
              "sla_deadline" = CASE
                WHEN "task_instances"."status" = 'ESCALATED' THEN "task_instances"."sla_deadline"
                ELSE EXCLUDED."sla_deadline"
              END,
              "metadata" = CASE
                WHEN "task_instances"."status" = 'ESCALATED' THEN EXCLUDED."metadata" || "task_instances"."metadata"
                ELSE EXCLUDED."metadata"
              END,
              "updated_at" = NOW()
            RETURNING "id"::text AS id
            """,
            task_id,
            title,
            description,
            str(rule.get("activity_type") or "upload_document"),
            assigned_role,
            str(base_doc.get("shipment_id") or ""),
            target_doc_type,
            base_sla_hours,
            json_param(metadata),
            source_key,
            str(base_doc.get("uploaded_by") or "system"),
        )
        saved_task_id = str(rows[0]["id"]) if rows else task_id
        _debug(
            "task.saved",
            task_id=saved_task_id,
            source_key=source_key,
            title=title,
            assigned_role=assigned_role,
            base_sla_hours=base_sla_hours,
            escalation_config_id=rule.get("escalation_config_id"),
        )
        notification_message = self._render_template(
            rule.get("task_message"),
            {
                "Task Name": title,
                "Document Name": target_label,
                "Scope Doc Name": target_label,
                "Base Doc Name": base_label,
                "Base Document Number": base_number,
                "Shipment No": base_doc.get("shipment_id") or "",
            },
        ) or description
        await insert_notification(
            self.prisma,
            task_id=saved_task_id,
            notification_type="info",
            title=f"New task: {title}",
            message=notification_message,
            recipient_role=assigned_role,
            source="task_engine",
            dedupe_key=f"task-engine-created:{source_key}",
            metadata=metadata,
        )
        _debug(
            "task.notification.saved",
            task_id=saved_task_id,
            source_key=source_key,
            recipient_role=assigned_role,
            dedupe_key=f"task-engine-created:{source_key}",
        )
        return saved_task_id

    async def _complete_task(self, source_key: str, match: MatchResult) -> int:
        rows = await query_raw(
            self.prisma,
            """
            UPDATE "public"."task_instances"
            SET "status" = 'COMPLETED',
                "completed_at" = COALESCE("completed_at", NOW()),
                "metadata" = COALESCE("metadata", '{}'::jsonb) || $2::jsonb,
                "updated_at" = NOW()
            WHERE "source_key" = $1
              AND "status" = ANY($3::text[])
            RETURNING "id"
            """,
            source_key,
            json.dumps({
                "resolvedByTargetDocumentId": match.target_document_id,
                "resolvedByTargetStatus": match.target_status,
                "resolvedMatch": match.context or {},
            }),
            list(OPEN_STATUSES),
        )
        _debug("task.complete", source_key=source_key, completed=len(rows), match=match.context, target_document_id=match.target_document_id)
        return len(rows)

    def _render_template(self, template: str | None, values: dict[str, Any]) -> str:
        rendered = str(template or "").strip()
        if not rendered:
            return ""
        rendered = rendered.replace("{br}", "\n")
        for key, value in values.items():
            rendered = rendered.replace("{" + key + "}", str(value or ""))
        return rendered

    def _as_dict(self, value: Any) -> dict[str, Any]:
        raw = value
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                return {}
        return raw if isinstance(raw, dict) else {}

    def _additional_roles_for_threshold(self, targets: Any, threshold: str) -> list[str]:
        level_cfg = self._as_dict(targets).get(threshold)
        if not isinstance(level_cfg, dict):
            return []
        roles = level_cfg.get("additionalRoles") or []
        if not isinstance(roles, list):
            return []
        out: list[str] = []
        seen: set[str] = set()
        for role in roles:
            text = str(role or "").strip()
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(text)
        return out

    async def _notify_sla_recipient(
        self,
        *,
        task: dict[str, Any],
        threshold: str,
        threshold_pct: int,
        notification_type: str,
        title: str,
        message: str,
        recipient_role: str | None,
        recipient_user_id: str | None,
        dedupe_suffix: str,
        notification_metadata: dict[str, Any],
    ) -> str:
        notification_id = await insert_notification(
            self.prisma,
            task_id=str(task["task_id"]),
            notification_type=notification_type,
            title=title,
            message=message,
            recipient_role=recipient_role,
            recipient_user_id=recipient_user_id,
            source=f"task_sla_{threshold}",
            dedupe_key=f"task-sla:{task['task_id']}:{threshold}:{threshold_pct}:{dedupe_suffix}",
            metadata=notification_metadata,
        )
        await dispatch_notification_channels(
            self.prisma,
            channels=task.get("channels"),
            notification_id=notification_id,
            task_id=str(task["task_id"]),
            level=threshold,
            title=title,
            message=message,
            recipient_role=recipient_role,
            recipient_user_id=recipient_user_id,
            metadata=notification_metadata,
        )
        return notification_id

    async def _mark_sla_event(self, task: dict[str, Any], threshold: str, threshold_pct: int, message_template: str | None) -> bool:
        notification_type = "escalation" if threshold == "escalation" else ("blocker" if threshold == "blocker" else threshold)
        title = f"Task {threshold}: {task.get('title')}"
        metadata = self._as_dict(task.get("metadata"))
        existing_events = await query_raw(
            self.prisma,
            """
            SELECT 1
            FROM "public"."task_sla_events"
            WHERE "task_id" = $1::uuid
              AND "threshold_type" = $2
              AND "threshold_pct" = $3
            LIMIT 1
            """,
            str(task["task_id"]),
            threshold,
            threshold_pct,
        )
        if existing_events:
            return False

        previous_role = str(task.get("assigned_role") or "").strip() or None
        previous_user_id = str(task.get("assigned_user_id") or "").strip() or None
        additional_roles = self._additional_roles_for_threshold(task.get("targets"), threshold)
        next_role: str | None = None
        cc_roles: list[str] = []
        if threshold in {"warning", "escalation", "blocker"} and additional_roles:
            candidate = additional_roles[0]
            if previous_role and candidate.lower() == previous_role.lower():
                cc_roles = additional_roles[1:]
            else:
                next_role = candidate
                cc_roles = additional_roles[1:]

        message = self._render_template(
            message_template,
            {
                "Task Name": str(task.get("title") or ""),
                "Document Name": display_doc_type(metadata.get("targetDocType")),
                "Scope Doc Name": display_doc_type(metadata.get("targetDocType")),
                "Base Doc Name": display_doc_type(metadata.get("baseDocType")),
                "Base Document Number": str(metadata.get("baseDocumentNumber") or ""),
                "Shipment No": str(metadata.get("shipmentId") or ""),
            },
        ) or f"This task has reached its {threshold} SLA threshold."
        notification_metadata = {
            "threshold": threshold,
            "thresholdPct": threshold_pct,
            "previousAssignedRole": previous_role,
            "escalatedToRole": next_role,
        }

        notification_id = await self._notify_sla_recipient(
            task=task,
            threshold=threshold,
            threshold_pct=threshold_pct,
            notification_type=notification_type,
            title=title,
            message=message,
            recipient_role=previous_role,
            recipient_user_id=previous_user_id,
            dedupe_suffix="assignee",
            notification_metadata=notification_metadata,
        )
        _debug(
            "sla.notification.saved",
            task_id=task.get("task_id"),
            threshold=threshold,
            threshold_pct=threshold_pct,
            notification_id=notification_id,
            previous_role=previous_role,
            next_role=next_role,
        )
        rows = await query_raw(
            self.prisma,
            """
            INSERT INTO "public"."task_sla_events" ("id", "task_id", "threshold_type", "threshold_pct", "notification_id")
            VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid)
            ON CONFLICT ("task_id", "threshold_type", "threshold_pct") DO NOTHING
            RETURNING "id"
            """,
            str(uuid4()),
            str(task["task_id"]),
            threshold,
            threshold_pct,
            notification_id,
        )
        if not rows:
            return False

        if next_role:
            await self._notify_sla_recipient(
                task=task,
                threshold=threshold,
                threshold_pct=threshold_pct,
                notification_type=notification_type,
                title=title,
                message=message,
                recipient_role=next_role,
                recipient_user_id=None,
                dedupe_suffix=f"role:{next_role}",
                notification_metadata=notification_metadata,
            )
        for cc_role in cc_roles:
            if previous_role and cc_role.lower() == previous_role.lower():
                continue
            if next_role and cc_role.lower() == next_role.lower():
                continue
            await self._notify_sla_recipient(
                task=task,
                threshold=threshold,
                threshold_pct=threshold_pct,
                notification_type=notification_type,
                title=title,
                message=message,
                recipient_role=cc_role,
                recipient_user_id=None,
                dedupe_suffix=f"cc:{cc_role}",
                notification_metadata=notification_metadata,
            )

        metadata["previousAssignedRole"] = previous_role
        metadata["escalatedToRole"] = next_role
        metadata["slaThreshold"] = threshold
        metadata["slaThresholdPct"] = threshold_pct
        task["metadata"] = metadata

        set_parts = ['"metadata" = $2::jsonb', '"updated_at" = NOW()']
        params: list[Any] = [str(task["task_id"]), json_param(metadata)]
        if next_role:
            params.append(next_role)
            set_parts.append(f'"assigned_role" = ${len(params)}')
            set_parts.append('"assigned_user_id" = NULL')
            task["assigned_role"] = next_role
            task["assigned_user_id"] = None
        if threshold == "warning":
            set_parts.append("\"urgency\" = 'WARNING'")
        if threshold == "escalation":
            set_parts.append("\"status\" = 'ESCALATED'")
            set_parts.append('"escalation_level" = "escalation_level" + 1')
            set_parts.append("\"escalation_type\" = 'SLA'")
        if threshold == "blocker":
            set_parts.append("\"urgency\" = 'BLOCKER'")

        await execute_raw(
            self.prisma,
            f'UPDATE "public"."task_instances" SET {", ".join(set_parts)} WHERE "id" = $1::uuid',
            *params,
        )
        return True
