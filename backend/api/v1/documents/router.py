from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from db import get_prisma
from helpers.config import settings
from helpers.dependencies import get_current_user
from helpers.shipment_operational import ensure_operational_shipment_tables, link_documents_to_shipment_by_keys
from shipment_360.safecube import infer_shipment_type, track_container


router = APIRouter(tags=["Documents"])
SHIPMENT_VIEWS_SQL = Path(__file__).resolve().parents[3] / "shipment_360" / "views.sql"
DOCUMENT_MODULE_VIEWS_SQL = Path(__file__).resolve().parents[3] / "document_module" / "views.sql"
_SHIPMENT_VIEWS_READY = False
_DOCUMENT_MODULE_VIEWS_READY = False


PARALLEL_DOC_GATE_NUMBER: dict[str, int] = {
    "CHA_BILL": 1,
    "FREIGHT_FORWARDER_BILL": 2,
    "CUSTOMER_BROKER_BILL": 3,
    "OCEAN_FREIGHT": 3,
    "PORT_TO_WH": 4,
    "WH_TO_CUSTOMER": 5,
}


class TrackShipmentRequest(BaseModel):
    trackingReference: str = Field(..., min_length=1)
    shipmentType: str | None = None
    sealine: str | None = None


def _json(value: Any) -> str:
    return json.dumps(value, default=str)


def _parse_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _first_dict(value: Any) -> dict[str, Any]:
    parsed = _parse_json(value)
    if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
        return parsed[0]
    if isinstance(parsed, dict):
        return parsed
    return {}


def _as_list(value: Any) -> list[Any]:
    parsed = _parse_json(value)
    return parsed if isinstance(parsed, list) else []


def _coordinates(value: Any) -> tuple[float | None, float | None]:
    parsed = _parse_json(value)
    if not isinstance(parsed, dict):
        return None, None
    candidate = parsed.get("coordinates") if isinstance(parsed.get("coordinates"), dict) else parsed
    lat = _num(candidate.get("lat") or candidate.get("latitude"))
    lng = _num(candidate.get("lng") or candidate.get("lon") or candidate.get("longitude"))
    return lat, lng


def _dict_get(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data and data[key] not in (None, ""):
            return data[key]
    return None


def _link_ref(value: Any) -> str | None:
    normalized = "".join(ch.lower() for ch in str(value or "") if ch.isalnum())
    return normalized if len(normalized) >= 4 else None


def _doc_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "documentType": row.get("document_type") or row.get("doc_type"),
        "documentNumber": row.get("document_number"),
        "ocrStatus": row.get("ocr_status") or ("completed" if row.get("approved_at") else str(row.get("status") or "").lower()),
        "validationStatus": row.get("validation_status"),
        "approvedAt": _iso(row.get("approved_at")),
        "isGenerated": bool(row.get("is_generated")),
        "fileName": row.get("file_name"),
        "status": row.get("status"),
    }


async def _query_raw(prisma, sql: str, *params) -> list[dict[str, Any]]:
    query_raw = getattr(prisma, "query_raw", None)
    if query_raw is None:
        raise RuntimeError("Prisma client has no query_raw")
    rows = await query_raw(sql, *params)
    return [dict(row) for row in rows]


async def _shipment_documents(prisma, shipment_id: str) -> list[dict[str, Any]]:
    rows = await _query_raw(
        prisma,
        """
        SELECT "id", "doc_type"::text AS doc_type, "status"::text AS status,
               "file_name", "document_type", "document_number", "ocr_status",
               "validation_status", "approved_at", "is_generated", "created_at"
        FROM "public"."documents"
        WHERE "shipment_id" = $1::uuid
          AND COALESCE("is_deleted", false) = false
        ORDER BY "approved_at" DESC NULLS LAST, "created_at" DESC
        """,
        shipment_id,
    )
    return [_doc_payload(row) for row in rows]


async def _shipment_containers(prisma, shipment_id: str) -> list[dict[str, Any]]:
    try:
        rows = await _query_raw(
            prisma,
            """
            SELECT bc."id"::text AS id, bc."number" AS container_number,
                   bc."type" AS container_type, bc."gross_weight_kg",
                   bc."net_weight_kg", bc."packages", bc."seal_number"
            FROM "aiextraction"."bill_of_lading_containers" bc
            JOIN "aiextraction"."bills_of_lading" bol ON bol."id" = bc."bill_of_lading_id"
            JOIN "public"."documents" d ON d."id" = bol."document_id"
            WHERE d."shipment_id" = $1::uuid
              AND COALESCE(bc."number", '') <> ''
            ORDER BY bc."item_index" NULLS LAST, bc."number" ASC
            """,
            shipment_id,
        )
    except Exception:
        return []
    return [
        {
            "id": row.get("id") or row.get("container_number"),
            "containerNumber": row.get("container_number"),
            "containerType": row.get("container_type"),
            "containerSize": row.get("container_type"),
            "grossWeightKg": _num(row.get("gross_weight_kg")),
            "netWeightKg": _num(row.get("net_weight_kg")),
            "packageCount": row.get("packages"),
            "sealNumber": row.get("seal_number"),
        }
        for row in rows
    ]


async def _execute_raw(prisma, sql: str, *params) -> Any:
    execute_raw = getattr(prisma, "execute_raw", None)
    if execute_raw is None:
        raise RuntimeError("Prisma client has no execute_raw")
    return await execute_raw(sql, *params)


async def _ensure_shipment_360_views(prisma) -> None:
    global _SHIPMENT_VIEWS_READY
    if _SHIPMENT_VIEWS_READY:
        return

    existing = await _query_raw(
        prisma,
        """
        SELECT to_regclass('shipment_360.shipment_list_view')::text AS list_view,
               to_regclass('shipment_360.shipment_detail_view')::text AS detail_view
        """,
    )
    if existing and existing[0].get("list_view") and existing[0].get("detail_view"):
        _SHIPMENT_VIEWS_READY = True
        return

    await _ensure_safecube_tables(prisma)
    sql = SHIPMENT_VIEWS_SQL.read_text(encoding="utf-8")
    statements = [statement.strip() for statement in sql.split(";") if statement.strip()]
    for statement in statements:
        await _execute_raw(prisma, statement)
    _SHIPMENT_VIEWS_READY = True


async def _ensure_document_module_views(prisma) -> None:
    global _DOCUMENT_MODULE_VIEWS_READY
    if _DOCUMENT_MODULE_VIEWS_READY:
        return
    sql = DOCUMENT_MODULE_VIEWS_SQL.read_text(encoding="utf-8")
    statements = [statement.strip() for statement in sql.split(";") if statement.strip()]
    for statement in statements:
        await _execute_raw(prisma, statement)
    _DOCUMENT_MODULE_VIEWS_READY = True


async def _ensure_gate_validation_tables(prisma) -> None:
    await _execute_raw(prisma, 'CREATE SCHEMA IF NOT EXISTS "document_module"')
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "document_module"."document_validation_status" (
          "document_id" TEXT PRIMARY KEY,
          "shipment_id" TEXT,
          "doc_type" TEXT NOT NULL,
          "status" TEXT NOT NULL,
          "summary" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )


def _gate_row(row: dict[str, Any], doc_type_gates: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "gateConfigId": str(row["gate_config_id"]),
        "status": str(row.get("status") or "OPEN"),
        "passedAt": _iso(row.get("passed_at")),
        "skippedAt": _iso(row.get("skipped_at")),
        "failureReason": row.get("failure_reason") or row.get("blocked_reason"),
        "blockedReason": row.get("blocked_reason") or row.get("failure_reason"),
        "updatedAt": _iso(row.get("updated_at")),
        "createdAt": _iso(row.get("created_at")),
        "gateConfig": {
            "id": str(row["gate_config_id"]),
            "gateNumber": row.get("gate_number"),
            "gateName": row.get("gate_name") or f"Gate {row.get('gate_number')}",
            "gateLabel": row.get("gate_label"),
            "geography": row.get("geography"),
            "isIdentityGate": bool(row.get("is_identity_gate")) if row.get("is_identity_gate") is not None else False,
            "gateCheckType": row.get("gate_check_type"),
            "docTypeGates": doc_type_gates,
            "roleAssignments": [],
        },
    }


async def _shipment_gate_rows(prisma, shipment_id: str) -> list[dict[str, Any]]:
    return await _query_raw(
        prisma,
        """
        SELECT sg.*, gc."gate_number", gc."gate_name", gc."gate_label",
               gc."geography", gc."gate_check_type", gc."is_identity_gate"
        FROM "public"."shipment_gates" sg
        JOIN "public"."gate_configs" gc ON gc."id" = sg."gate_config_id"
        WHERE sg."shipment_id" = $1::uuid
        ORDER BY gc."gate_number" ASC
        """,
        shipment_id,
    )


async def _doc_type_gate_rows(prisma, gate_config_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    if not gate_config_ids:
        return {}
    try:
        rows = await _query_raw(
            prisma,
            """
            SELECT "id", "gate_config_id", "doc_type", "role_in_gate",
                   "is_generated", "mandatory_photo", "sla_override_days", "sort_order"
            FROM "public"."doc_type_gates"
            WHERE "gate_config_id" = ANY($1::uuid[])
            ORDER BY "sort_order" ASC NULLS LAST, "doc_type" ASC
            """,
            gate_config_ids,
        )
    except Exception:
        return {gate_id: [] for gate_id in gate_config_ids}
    grouped: dict[str, list[dict[str, Any]]] = {gate_id: [] for gate_id in gate_config_ids}
    for row in rows:
        gate_id = str(row["gate_config_id"])
        grouped.setdefault(gate_id, []).append(
            {
                "id": str(row["id"]),
                "docType": row.get("doc_type"),
                "roleInGate": row.get("role_in_gate"),
                "isGenerated": bool(row.get("is_generated")),
                "mandatoryPhoto": bool(row.get("mandatory_photo")),
                "slaOverrideDays": row.get("sla_override_days"),
                "sortOrder": row.get("sort_order"),
            }
        )
    return grouped


def _is_parallel_assignment(item: dict[str, Any]) -> bool:
    return str(item.get("roleInGate") or "").upper() == "PARALLEL"


def _is_parallel_only_gate(row: dict[str, Any], assignments: list[dict[str, Any]]) -> bool:
    gate_name = str(row.get("gate_name") or "").strip().lower()
    if gate_name == "parallel" or gate_name.startswith("parallel "):
        return True
    return bool(assignments) and all(_is_parallel_assignment(item) for item in assignments)


def _doc_type_parallel_gate_number(doc_type: str | None) -> int | None:
    if not doc_type:
        return None
    normalized = str(doc_type).upper()
    if normalized in PARALLEL_DOC_GATE_NUMBER:
        return PARALLEL_DOC_GATE_NUMBER[normalized]
    if normalized in {"DND", "DND_CHARGE", "DEMURRAGE_DETENTION", "DEMURRAGE_AND_DETENTION"}:
        return 3
    return None


def _remap_parallel_assignments_to_respective_gates(
    rows: list[dict[str, Any]],
    doc_type_gates: dict[str, list[dict[str, Any]]],
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    gate_id_by_number = {
        int(row["gate_number"]): str(row["gate_config_id"])
        for row in rows
        if row.get("gate_number") is not None
    }
    normalized = {gate_id: list(items) for gate_id, items in doc_type_gates.items()}

    for source_gate_id, assignments in list(doc_type_gates.items()):
        for assignment in assignments:
            if not _is_parallel_assignment(assignment):
                continue
            target_gate_number = _doc_type_parallel_gate_number(str(assignment.get("docType") or ""))
            target_gate_id = gate_id_by_number.get(target_gate_number or -1)
            if not target_gate_id:
                continue
            normalized[source_gate_id] = [
                item for item in normalized.get(source_gate_id, [])
                if item.get("id") != assignment.get("id")
            ]
            target_items = normalized.setdefault(target_gate_id, [])
            if not any(str(item.get("docType") or "").upper() == str(assignment.get("docType") or "").upper() for item in target_items):
                target_items.append(assignment)

    visible_rows = [
        row for row in rows
        if not _is_parallel_only_gate(row, normalized.get(str(row["gate_config_id"]), []))
    ]
    return visible_rows, normalized


async def _gate_documents_for_types(
    prisma,
    shipment_id: str,
    doc_types: list[str],
) -> list[dict[str, Any]]:
    if not doc_types:
        return []
    try:
        return await _query_raw(
            prisma,
            """
            SELECT "id"::text AS id,
                   COALESCE("document_type"::text, "doc_type"::text) AS doc_type,
                   "approved_at",
                   "status"::text AS status
            FROM "public"."documents"
            WHERE "shipment_id" = $1::uuid
              AND COALESCE("is_deleted", false) = false
              AND (
                "document_type"::text = ANY($2::text[])
                OR "doc_type"::text = ANY($2::text[])
              )
            ORDER BY "approved_at" DESC NULLS LAST, "created_at" DESC
            """,
            shipment_id,
            doc_types,
        )
    except Exception:
        return []


def _validation_block_reason(status: str) -> str:
    if status in {"WAITING", "RUNNING", "PENDING", "PROCESSING"}:
        return "Cross validation has not finished yet."
    return "Blocking validation failed."


async def _gate_validation_blocks(
    prisma,
    shipment_id: str,
    gate: dict[str, Any],
) -> list[dict[str, Any]]:
    await _ensure_gate_validation_tables(prisma)
    gate_id = str(gate["gate_config_id"])
    assignments = (await _doc_type_gate_rows(prisma, [gate_id])).get(gate_id, [])
    required_doc_types = [
        str(item["docType"])
        for item in assignments
        if item.get("docType")
        and item.get("roleInGate") != "PARALLEL"
        and not item.get("isGenerated")
    ]
    if not required_doc_types:
        return []

    docs = await _gate_documents_for_types(prisma, shipment_id, required_doc_types)
    docs_by_type: dict[str, list[dict[str, Any]]] = {}
    for doc in docs:
        docs_by_type.setdefault(str(doc.get("doc_type")), []).append(doc)

    blocks: list[dict[str, Any]] = []
    approved_docs: list[dict[str, Any]] = []
    for doc_type in required_doc_types:
        approved = [
            doc for doc in docs_by_type.get(doc_type, [])
            if doc.get("approved_at") is not None or str(doc.get("status") or "").upper() == "REVIEWED"
        ]
        if not approved:
            blocks.append(
                {
                    "docType": doc_type,
                    "status": "WAITING",
                    "reason": "Required document is not approved/reviewed yet.",
                }
            )
            continue
        approved_docs.append(approved[0])

    if approved_docs:
        status_rows = await _query_raw(
            prisma,
            """
            SELECT "document_id", "status", "summary"
            FROM "document_module"."document_validation_status"
            WHERE "document_id" = ANY($1::text[])
            """,
            [str(doc["id"]) for doc in approved_docs],
        )
        statuses = {str(row["document_id"]): row for row in status_rows}
        for doc in approved_docs:
            doc_id = str(doc["id"])
            status = str((statuses.get(doc_id) or {}).get("status") or "WAITING").upper()
            if status not in {"PASSED", "WARNING"}:
                blocks.append(
                    {
                        "documentId": doc_id,
                        "docType": doc.get("doc_type"),
                        "status": status,
                        "reason": _validation_block_reason(status),
                    }
                )
    return blocks


async def _set_shipment_block_reason(prisma, shipment_id: str, reason: str | None) -> None:
    try:
        await _execute_raw(
            prisma,
            """
            UPDATE "public"."shipments"
            SET "blocked_reason" = $2
            WHERE "id" = $1::uuid
            """,
            shipment_id,
            reason,
        )
    except Exception:
        pass


async def _current_open_gate(prisma, shipment_id: str) -> dict[str, Any]:
    rows = await _shipment_gate_rows(prisma, shipment_id)
    doc_type_gates = await _doc_type_gate_rows(
        prisma,
        [str(row["gate_config_id"]) for row in rows],
    )
    for row in rows:
        gate_id = str(row["gate_config_id"])
        if str(row.get("status") or "").upper() == "OPEN" and not _is_parallel_only_gate(row, doc_type_gates.get(gate_id, [])):
            return row
    raise HTTPException(status_code=409, detail="No open gate found for this shipment")


async def _ensure_safecube_tables(prisma) -> None:
    await _execute_raw(prisma, 'CREATE SCHEMA IF NOT EXISTS "dashboard"')
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "dashboard"."safecube_shipments" (
          "id" TEXT PRIMARY KEY,
          "shipment_number" TEXT NOT NULL UNIQUE,
          "shipment_type" TEXT,
          "sealine" TEXT,
          "status" TEXT,
          "current_stage" INTEGER NOT NULL DEFAULT 1,
          "current_stage_name" TEXT,
          "current_location" JSONB,
          "live_coordinates" JSONB,
          "ais" JSONB,
          "route" JSONB,
          "locations" JSONB,
          "vessels" JSONB,
          "containers" JSONB,
          "raw_data" JSONB,
          "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "dashboard"."safecube_tracking_events" (
          "id" TEXT PRIMARY KEY,
          "shipment_id" TEXT NOT NULL REFERENCES "dashboard"."safecube_shipments"("id") ON DELETE CASCADE,
          "container_number" TEXT,
          "event_code" TEXT,
          "status" TEXT,
          "description" TEXT,
          "location" JSONB,
          "facility" JSONB,
          "occurred_at" TIMESTAMPTZ,
          "is_actual" BOOLEAN,
          "raw_data" JSONB,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    await _execute_raw(prisma, 'CREATE INDEX IF NOT EXISTS "idx_safecube_shipments_status" ON "dashboard"."safecube_shipments"("status")')
    await _execute_raw(prisma, 'CREATE INDEX IF NOT EXISTS "idx_safecube_events_shipment" ON "dashboard"."safecube_tracking_events"("shipment_id")')
    await _execute_raw(prisma, 'CREATE INDEX IF NOT EXISTS "idx_safecube_events_container" ON "dashboard"."safecube_tracking_events"("container_number")')


def _event_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _flatten_events(summary: dict[str, Any]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for container in summary.get("containers") or []:
        container_number = container.get("number") or container.get("containerNumber")
        for event in container.get("events") or []:
            events.append(
                {
                    "containerNumber": container_number,
                    "eventCode": event.get("eventCode"),
                    "status": event.get("status"),
                    "description": event.get("description"),
                    "location": event.get("location"),
                    "facility": event.get("facility"),
                    "occurredAt": _event_time(event.get("date")),
                    "isActual": event.get("isActual"),
                    "rawData": event,
                }
            )
    events.sort(key=lambda item: _iso(item.get("occurredAt")) or "", reverse=True)
    return events


def _container_items(value: Any) -> list[dict[str, Any]]:
    containers = _parse_json(value) or []
    items: list[dict[str, Any]] = []
    for index, container in enumerate(containers):
        if not isinstance(container, dict):
            continue
        number = container.get("number") or container.get("containerNumber") or container.get("container_number")
        items.append(
            {
                "id": str(container.get("id") or number or index),
                "containerNumber": str(number or "UNKNOWN"),
                "containerSize": container.get("size") or container.get("containerSize"),
                "containerType": container.get("type") or container.get("containerType"),
                "grossWeightKg": container.get("grossWeightKg") or container.get("gross_weight_kg"),
                "packageCount": container.get("packageCount") or container.get("package_count"),
            }
        )
    return items


def _row_to_shipment(row: dict[str, Any], events: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    current_location = _parse_json(row.get("current_location")) or {}
    route = _parse_json(row.get("route")) or {}
    locations = _parse_json(row.get("locations")) or []
    vessels = _parse_json(row.get("vessels")) or []
    raw_data = _parse_json(row.get("raw_data"))
    first_vessel = vessels[0] if isinstance(vessels, list) and vessels else {}
    first_route = route[0] if isinstance(route, list) and route else {}

    mapped_events = [
        {
            "id": event["id"],
            "milestone": event.get("description") or event.get("event_code") or "Tracking event",
            "occurredAt": _iso(event.get("occurred_at") or row.get("fetched_at")),
            "eventData": {
                "eventCode": event.get("event_code"),
                "status": event.get("status"),
                "location": _parse_json(event.get("location")),
                "facility": _parse_json(event.get("facility")),
                "containerNumber": event.get("container_number"),
            },
        }
        for event in (events or [])
    ]

    return {
        "id": row["id"],
        "shipmentNumber": row["shipment_number"],
        "status": row.get("status") or "ACTIVE",
        "currentStage": row.get("current_stage") or 1,
        "currentStageName": row.get("current_stage_name") or "SafeCube tracking",
        "blockedReason": None,
        "vesselName": first_vessel.get("name") if isinstance(first_vessel, dict) else None,
        "portOfLoading": first_route.get("from") if isinstance(first_route, dict) else None,
        "portOfDischarge": first_route.get("to") if isinstance(first_route, dict) else None,
        "exporterName": None,
        "buyerName": None,
        "blNumber": row["shipment_number"] if row.get("shipment_type") == "BL" else None,
        "loadMode": "FCL",
        "incoterm": None,
        "incotermPort": None,
        "documents": [],
        "containers": _container_items(row.get("containers")),
        "milestones": mapped_events,
        "tickets": [],
        "inventoryItems": [],
        "_count": {"documents": 0},
        "safecubeTracking": {
            "shipmentType": row.get("shipment_type"),
            "sealine": row.get("sealine"),
            "currentLocation": current_location,
            "liveCoordinates": _parse_json(row.get("live_coordinates")),
            "ais": _parse_json(row.get("ais")),
            "route": route,
            "locations": locations,
            "vessels": vessels,
            "rawData": raw_data,
            "fetchedAt": _iso(row.get("fetched_at")),
        },
    }


async def _store_tracking(prisma, request: TrackShipmentRequest, summary: dict[str, Any]) -> dict[str, Any]:
    shipment_id = str(uuid4())
    current_location = summary.get("currentLocation") or {}
    current_stage_name = current_location.get("description") or "SafeCube tracking"
    metadata = summary.get("metadata") if isinstance(summary.get("metadata"), dict) else {}
    status = metadata.get("shippingStatus") or current_location.get("status") or "ACTIVE"

    rows = await _query_raw(
        prisma,
        """
        INSERT INTO "dashboard"."safecube_shipments" (
          "id", "shipment_number", "shipment_type", "sealine", "status",
          "current_stage", "current_stage_name", "current_location", "live_coordinates",
          "ais", "route", "locations", "vessels", "containers", "raw_data",
          "fetched_at", "updated_at"
        )
        VALUES (
          $1, $2, $3, $4, $5, 6, $6, $7::jsonb, $8::jsonb,
          $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb,
          NOW(), NOW()
        )
        ON CONFLICT ("shipment_number") DO UPDATE SET
          "shipment_type" = EXCLUDED."shipment_type",
          "sealine" = EXCLUDED."sealine",
          "status" = EXCLUDED."status",
          "current_stage_name" = EXCLUDED."current_stage_name",
          "current_location" = EXCLUDED."current_location",
          "live_coordinates" = EXCLUDED."live_coordinates",
          "ais" = EXCLUDED."ais",
          "route" = EXCLUDED."route",
          "locations" = EXCLUDED."locations",
          "vessels" = EXCLUDED."vessels",
          "containers" = EXCLUDED."containers",
          "raw_data" = EXCLUDED."raw_data",
          "fetched_at" = NOW(),
          "updated_at" = NOW()
        RETURNING *
        """,
        shipment_id,
        request.trackingReference.strip(),
        request.shipmentType,
        request.sealine,
        status,
        current_stage_name,
        _json(current_location),
        _json(summary.get("liveCoordinates")),
        _json(summary.get("ais")),
        _json(summary.get("route")),
        _json(summary.get("locations")),
        _json(summary.get("vessels")),
        _json(summary.get("containers")),
        _json(summary),
    )
    row = rows[0]

    await _execute_raw(
        prisma,
        'DELETE FROM "dashboard"."safecube_tracking_events" WHERE "shipment_id" = $1',
        row["id"],
    )
    for event in _flatten_events(summary):
        await _execute_raw(
            prisma,
            """
            INSERT INTO "dashboard"."safecube_tracking_events" (
              "id", "shipment_id", "container_number", "event_code", "status",
              "description", "location", "facility", "occurred_at", "is_actual", "raw_data"
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::timestamptz, $10, $11::jsonb)
            """,
            str(uuid4()),
            row["id"],
            event.get("containerNumber"),
            event.get("eventCode"),
            event.get("status"),
            event.get("description"),
            _json(event.get("location")),
            _json(event.get("facility")),
            event.get("occurredAt"),
            event.get("isActual"),
            _json(event.get("rawData")),
        )
    return row


async def _public_shipment_row(prisma, shipment_ref: str) -> dict[str, Any] | None:
    rows = await _query_raw(
        prisma,
        """
        SELECT "id", "shipment_number", "status", "blocked_reason",
               "current_stage", "current_stage_name", "workflow_template_id",
               "vessel_name", "port_of_loading", "port_of_discharge",
               "exporter_name", "buyer_name", "bol_number", "mbl_number",
               "booking_number", "load_type", "incoterms", "project_name",
               "eta_port", "eta_delivery", "updated_at"
        FROM "public"."shipments"
        WHERE "id"::text = $1::text OR "shipment_number" = $1::text
        LIMIT 1
        """,
        shipment_ref,
    )
    return rows[0] if rows else None


def _shipment_bol_ref(row: dict[str, Any]) -> Any:
    return row.get("bol_number")


def _public_shipment_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "shipmentNumber": row.get("shipment_number"),
        "status": row.get("status"),
        "listStatus": row.get("shipment_list_status") or "in_progress",
        "blockedReason": row.get("blocked_reason"),
        "currentStage": row.get("current_stage") or 1,
        "currentStageName": row.get("current_stage_name"),
        "templateId": str(row["workflow_template_id"]) if row.get("workflow_template_id") else None,
        "vesselName": row.get("vessel_name"),
        "portOfLoading": row.get("port_of_loading"),
        "portOfDischarge": row.get("port_of_discharge"),
        "exporterName": row.get("exporter_name"),
        "buyerName": row.get("buyer_name"),
        "blNumber": _shipment_bol_ref(row),
        "bolNumber": _shipment_bol_ref(row),
        "hblNumber": _shipment_bol_ref(row),
        "mblNumber": row.get("mbl_number"),
        "bookingNumber": row.get("booking_number"),
        "loadMode": row.get("load_type"),
        "loadType": row.get("load_type"),
        "incoterm": row.get("incoterms"),
        "incoterms": row.get("incoterms"),
        "projectName": row.get("project_name"),
        "eta": _iso(row.get("eta_delivery") or row.get("eta_port")),
        "etaPort": _iso(row.get("eta_port")),
        "etaDelivery": _iso(row.get("eta_delivery")),
        "updatedAt": _iso(row.get("updated_at")),
        "documents": [],
        "shipmentGates": [],
        "containers": [],
        "milestones": [],
        "tickets": [],
        "inventoryItems": [],
        "_count": {"documents": 0},
    }


def _document_done_score(document: dict[str, Any]) -> int:
    status = str(document.get("status") or "").upper()
    validation_status = str(document.get("validationStatus") or document.get("validation_status") or "").upper()
    ocr_status = str(document.get("ocrStatus") or document.get("ocr_status") or "").upper()
    score = 0
    if document.get("approvedAt") or document.get("approved_at"):
        score += 100
    if status in {"REVIEWED", "ARCHIVED", "APPROVED", "COMPLETED", "DONE"}:
        score += 80
    if validation_status == "PASSED":
        score += 20
    if ocr_status in {"COMPLETED", "COMPLETE", "REVIEWED", "APPROVED"}:
        score += 10
    return score


def _document_identity_key(document: dict[str, Any]) -> str:
    doc_type = str(document.get("documentType") or document.get("document_type") or "DOCUMENT").upper()
    doc_number = _link_ref(document.get("documentNumber") or document.get("document_number"))
    file_ref = _link_ref(document.get("fileName") or document.get("file_name"))
    fallback = doc_number or file_ref or str(document.get("id") or "")

    if doc_type in {"SI", "SALES_INVOICE"} or "SALES_INVOICE" in doc_type:
        return f"SALES_INVOICE|{fallback}"
    if doc_type in {"PL", "PACKING_LIST"} or ("PACKING_LIST" in doc_type and "OUTWARD" not in doc_type):
        return f"PACKING_LIST|{fallback}"
    if doc_type in {"BL", "BOL", "BILL_OF_LADING"} or "BILL_OF_LADING" in doc_type:
        return f"BILL_OF_LADING|{fallback}"
    return f"{doc_type}|{fallback}"


def _dedupe_shipment_documents(documents: list[Any]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    def _doc_count(document: dict[str, Any]) -> int:
        try:
            return max(1, int(document.get("count") or document.get("documentCount") or 1))
        except Exception:
            return 1
    for document in documents:
        if not isinstance(document, dict):
            continue
        incoming_count = _doc_count(document)
        key = _document_identity_key(document)
        if key not in deduped:
            deduped[key] = {**document, "count": incoming_count}
            order.append(key)
            continue
        combined_count = _doc_count(deduped[key]) + incoming_count
        if _document_done_score(document) > _document_done_score(deduped[key]):
             deduped[key] = {**document, "count": combined_count}
        else:
            deduped[key]["count"] = combined_count
    return [deduped[key] for key in order]


def _view_shipment_payload(row: dict[str, Any], *, include_containers: bool = False) -> dict[str, Any]:
    documents = _dedupe_shipment_documents(_as_list(row.get("documents")))
    gates = _as_list(row.get("shipment_gates"))
    approved_count = sum(1 for doc in documents if _document_done_score(doc) >= 80)
    total_count = len(documents)
    payload = {
        "id": str(row["id"]),
        "shipmentNumber": row.get("shipment_number"),
        "status": row.get("status"),
        "listStatus": row.get("shipment_list_status") or "in_progress",
        "blockedReason": row.get("blocked_reason"),
        "currentStage": row.get("current_stage") or 1,
        "currentStageName": row.get("current_stage_name"),
        "templateId": str(row["workflow_template_id"]) if row.get("workflow_template_id") else None,
        "vesselName": row.get("vessel_name"),
        "portOfLoading": row.get("port_of_loading"),
        "portOfDischarge": row.get("port_of_discharge"),
        "exporterName": row.get("exporter_name"),
        "buyerName": row.get("buyer_name"),
        "blNumber": _shipment_bol_ref(row),
        "bolNumber": _shipment_bol_ref(row),
        "hblNumber": _shipment_bol_ref(row),
        "mblNumber": row.get("mbl_number"),
        "bookingNumber": row.get("booking_number"),
        "loadMode": row.get("load_type"),
        "loadType": row.get("load_type"),
        "incoterm": row.get("incoterms"),
        "incoterms": row.get("incoterms"),
        "projectName": row.get("project_name"),
        "eta": _iso(row.get("eta_delivery") or row.get("eta_port")),
        "etaPort": _iso(row.get("eta_port")),
        "etaDelivery": _iso(row.get("eta_delivery")),
        "updatedAt": _iso(row.get("updated_at")),
        "documents": documents,
        "shipmentGates": gates,
        "containers": _as_list(row.get("containers")) if include_containers else [],
        "milestones": [],
        "tickets": [],
        "inventoryItems": [],
        "safecubeLinked": bool(row.get("safecube_linked")),
        "safecubeEtaAt": _iso(row.get("safecube_eta_at")),
        "safecubeScheduleStatus": row.get("safecube_schedule_status") or row.get("safecube_shipping_status"),
        "safecubeDelayDays": None,
        "safecubeCurrentLocation": row.get("safecube_current_location"),
        "safecubeAlertCount": row.get("safecube_alert_count") or 0,
        "_count": {
            "documents": int(total_count if total_count is not None else len(documents)),
            "documentsApproved": int(approved_count if approved_count is not None else 0),
        },
    }
    return payload

async def _annotate_linked_document_counts(prisma, shipments: list[dict[str, Any]]) -> None:
    def _count_aliases(doc_type: str) -> set[str]:
        normalized = str(doc_type or "").upper()
        aliases = {normalized} if normalized else set()
        if normalized in {"PL", "PACKING_LIST"}:
            aliases.update({"PL", "PACKING_LIST"})
        if normalized in {"SI", "SALES_INVOICE"}:
            aliases.update({"SI", "SALES_INVOICE"})
        if normalized in {"SB", "SHIPPING_BILL"}:
            aliases.update({"SB", "SHIPPING_BILL"})
        if normalized in {"CB", "ENTRY_SUMMARY", "CBP_FORM_7501"}:
            aliases.update({"CB", "ENTRY_SUMMARY", "CBP_FORM_7501"})
        return aliases

    shipment_ids = [str(shipment.get("id")) for shipment in shipments if shipment.get("id")]
    if not shipment_ids:
        return
    try:
        rows = await _query_raw(
            prisma,
            """
            SELECT
              "shipment_id"::text AS shipment_id,
              COALESCE("doc_type"::text, "document_type", '') AS document_type,
              COUNT(*)::int AS count
            FROM "public"."documents"
            WHERE "shipment_id"::text = ANY($1::text[])
              AND COALESCE("is_deleted", false) = false
            GROUP BY "shipment_id"::text, COALESCE("doc_type"::text, "document_type", '')
            """,
            shipment_ids,
        )
    except Exception as exc:
        print(f"[shipments] warning: could not annotate document counts: {exc}", flush=True)
        return

    counts_by_shipment: dict[str, dict[str, int]] = {}
    for row in rows:
        shipment_id = str(row.get("shipment_id") or "")
        doc_type = str(row.get("document_type") or "").upper()
        if shipment_id and doc_type:
            shipment_counts = counts_by_shipment.setdefault(shipment_id, {})
            for alias in _count_aliases(doc_type):
                shipment_counts[alias] = max(shipment_counts.get(alias, 0), int(row.get("count") or 0))

    for shipment in shipments:
        shipment_counts = counts_by_shipment.get(str(shipment.get("id") or ""), {})
        if not shipment_counts:
            continue
        for document in _as_list(shipment.get("documents")):
            if not isinstance(document, dict):
                continue
            doc_type = str(document.get("documentType") or document.get("document_type") or "").upper()
            count = max((shipment_counts.get(alias, 0) for alias in _count_aliases(doc_type)), default=0)
            try:
                current_count = int(document.get("count") or 1)
            except Exception:
                current_count = 1
            if count and count > current_count:
                document["count"] = count



async def _merge_document_module_gate_docs(prisma, shipments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not shipments:
        return shipments
    shipment_ref_pairs: list[tuple[str, str]] = []
    seen_ref_pairs: set[tuple[str, str]] = set()
    for shipment in shipments:
        for value in (
            shipment.get("id"),
            shipment.get("shipmentNumber"),
            shipment.get("bolNumber"),
            shipment.get("blNumber"),
            shipment.get("hblNumber"),
            shipment.get("mblNumber"),
            shipment.get("bookingNumber"),
        ):
            if not value:
                continue
            raw = str(value)
            normalized = _link_ref(raw)
            if not normalized:
                continue
            pair = (raw, normalized)
            if pair in seen_ref_pairs:
                continue
            seen_ref_pairs.add(pair)
            shipment_ref_pairs.append(pair)
    if not shipment_ref_pairs:
        return shipments
    shipment_refs = [raw for raw, _normalized in shipment_ref_pairs]
    normalized_shipment_refs = [normalized for _raw, normalized in shipment_ref_pairs]
    try:
        await _execute_raw(prisma, 'CREATE SCHEMA IF NOT EXISTS "document_module"')
        await _ensure_document_module_views(prisma)
        rows = await _query_raw(
            prisma,
            """
            SELECT
              COALESCE(
                v."shipment_id"::text,
                (
                  SELECT refs.raw_ref
                  FROM unnest($1::text[], $2::text[]) AS refs(raw_ref, normalized_ref)
                  WHERE length(refs.normalized_ref) >= 5
                    AND position(
                      refs.normalized_ref in LOWER(REGEXP_REPLACE(COALESCE(v."extracted_data"::text, ''), '[^A-Za-z0-9]+', '', 'g'))
                    ) > 0
                  LIMIT 1
                )
              ) AS mapped_shipment_ref,
              v."document_id"::text AS id,
              v."doc_type" AS document_type,
              COALESCE(v."document_number", d."document_number", v."file_name") AS document_number,
              'REVIEWED' AS status,
              'completed' AS ocr_status,
              COALESCE(d."validation_status", 'WAITING') AS validation_status,
              v."approved_at" AS approved_at,
              false AS is_generated,
              v."gate_number" AS gate_number,
              v."gate_code" AS gate_code,
              v."is_parallel" AS is_parallel
            FROM "document_module"."v_shipment_gate_documents" v
            JOIN "public"."documents" d ON d."id"::text = v."document_id"::text
            WHERE v."shipment_id"::text = ANY($1::text[])
               OR EXISTS (
                 SELECT 1
                 FROM unnest($2::text[]) AS refs(normalized_ref)
                 WHERE length(refs.normalized_ref) >= 5
                   AND position(
                     refs.normalized_ref in LOWER(REGEXP_REPLACE(COALESCE(v."extracted_data"::text, ''), '[^A-Za-z0-9]+', '', 'g'))
                   ) > 0
               )
            """,
            shipment_refs,
            normalized_shipment_refs,
        )
    except Exception as exc:
        print(f"[shipments] warning: could not merge document-module gate docs: {exc}", flush=True)
        return shipments

    by_ref: dict[str, dict[str, Any]] = {}
    by_normalized_ref: dict[str, dict[str, Any]] = {}
    for shipment in shipments:
        for value in (
            shipment.get("id"),
            shipment.get("shipmentNumber"),
            shipment.get("bolNumber"),
            shipment.get("blNumber"),
            shipment.get("hblNumber"),
            shipment.get("mblNumber"),
            shipment.get("bookingNumber"),
        ):
            if value:
                by_ref[str(value)] = shipment
                normalized = _link_ref(value)
                if normalized:
                    by_normalized_ref[normalized] = shipment

    for row in rows:
        mapped_ref = str(row.get("mapped_shipment_ref") or "")
        shipment = by_ref.get(mapped_ref) or by_normalized_ref.get(_link_ref(mapped_ref) or "")
        if not shipment:
            continue
        documents = shipment.setdefault("documents", [])
        row_id = str(row.get("id") or "")
        row_type = str(row.get("document_type") or "")
        row_number = _link_ref(row.get("document_number")) or ""
        incoming_doc = {
            "id": str(row.get("id")),
            "documentType": row.get("document_type"),
            "documentNumber": row.get("document_number"),
            "status": row.get("status"),
            "ocrStatus": row.get("ocr_status"),
            "validationStatus": row.get("validation_status"),
            "approvedAt": _iso(row.get("approved_at")),
            "isGenerated": bool(row.get("is_generated")),
            "gateNumber": row.get("gate_number"),
            "gateCode": row.get("gate_code"),
            "isParallel": bool(row.get("is_parallel")),
            "count": 1,
        }
        duplicate_index = next(
            (
                index
                for index, doc in enumerate(documents)
                if isinstance(doc, dict)
                and (
                    (
                        row_id
                        and str(doc.get("id") or "") == row_id
                    )
                    or (
                        row_type
                        and row_number
                        and str(doc.get("documentType") or doc.get("document_type") or "") == row_type
                        and (_link_ref(doc.get("documentNumber") or doc.get("document_number") or doc.get("fileName") or doc.get("file_name")) or "") == row_number
                    )
                )
            ),
            None,
        )
        if duplicate_index is None:
            documents.append(incoming_doc)
        else:
            existing_doc = documents[duplicate_index]
            try:
                combined_count = max(1, int(existing_doc.get("count") or 1)) + 1 if isinstance(existing_doc, dict) else 2
            except Exception:
                combined_count = 2
            incoming_doc["count"] = combined_count
            if _document_done_score(incoming_doc) > _document_done_score(existing_doc):
                documents[duplicate_index] = incoming_doc
            elif isinstance(existing_doc, dict):
                existing_doc["count"] = combined_count
        count = shipment.setdefault("_count", {})
        deduped_documents = _dedupe_shipment_documents(documents)
        shipment["documents"] = deduped_documents
        count["documents"] = len(deduped_documents)
        count["documentsApproved"] = sum(1 for doc in deduped_documents if _document_done_score(doc) >= 80)
    return shipments


async def _public_shipment_detail_payload(prisma, row: dict[str, Any]) -> dict[str, Any]:
    shipment_id = str(row["id"])
    documents = await _shipment_documents(prisma, shipment_id)
    gates = await _shipment_gate_rows(prisma, shipment_id)
    payload = _public_shipment_payload(row)
    payload["documents"] = documents
    payload["shipmentGates"] = gates
    payload["containers"] = await _shipment_containers(prisma, shipment_id)
    payload["_count"] = {"documents": len(documents)}
    return payload


async def _approved_bol_for_shipment(prisma, shipment: dict[str, Any]) -> dict[str, Any] | None:
    shipment_id = str(shipment.get("id") or "")
    shipment_number = str(shipment.get("shipment_number") or "")
    base_select = """
        SELECT bol.*, d.id::text AS document_id_ref
        FROM aiextraction.bills_of_lading bol
        JOIN public.documents d ON d.id = bol.document_id
    """
    order = """
        ORDER BY bol.reviewed_at DESC NULLS LAST, bol.updated_at DESC NULLS LAST
        LIMIT 1
    """
    try:
        rows = await _query_raw(
            prisma,
            base_select
            + """
            WHERE d.status::text IN ('REVIEWED', 'ARCHIVED')
              AND (
                d.shipment_id::text = $1::text
                OR bol.mbl_number = $2::text
                OR bol.booking_reference_number = $2::text
              )
            """
            + order,
            shipment_id,
            shipment_number,
        )
    except Exception:
        rows = await _query_raw(
            prisma,
            base_select
            + """
            WHERE d.status::text IN ('REVIEWED', 'ARCHIVED')
              AND (
                bol.mbl_number = $1::text
                OR bol.booking_reference_number = $1::text
              )
            """
            + order,
            shipment_number,
        )
    return rows[0] if rows else None


def _bol_tracking_reference(bol: dict[str, Any] | None, shipment: dict[str, Any] | None = None) -> str | None:
    if bol:
        for key in ("mbl_number", "booking_reference_number"):
            value = str(bol.get(key) or "").strip()
            if value:
                return value
    if shipment:
        for key in ("mbl_number", "booking_number", "shipment_number"):
            value = str(shipment.get(key) or "").strip()
            if value:
                return value
    return None


def _tracking_type_for_reference(reference: str, bol: dict[str, Any] | None, shipment: dict[str, Any] | None = None) -> str:
    if bol and reference == str(bol.get("booking_reference_number") or "").strip():
        return "BK"
    if shipment and reference == str(shipment.get("booking_number") or "").strip():
        return "BK"
    return infer_shipment_type(reference)


async def _shipment_tracking_row(prisma, shipment: dict[str, Any], bol: dict[str, Any] | None = None) -> dict[str, Any] | None:
    candidates = [
        _bol_tracking_reference(bol, shipment),
        str(shipment.get("shipment_number") or "").strip(),
    ]
    if bol:
        candidates.extend(
            str(bol.get(key) or "").strip()
            for key in ("mbl_number", "booking_reference_number")
        )
    refs = [ref for ref in dict.fromkeys(candidates) if ref]
    if not refs:
        return None
    rows = await _query_raw(
        prisma,
        """
        SELECT *
        FROM "dashboard"."safecube_shipments"
        WHERE "shipment_number" = ANY($1::text[])
        ORDER BY "fetched_at" DESC
        LIMIT 1
        """,
        refs,
    )
    return rows[0] if rows else None


def _route_node(route: dict[str, Any], key: str) -> dict[str, Any]:
    node = route.get(key) if isinstance(route, dict) else None
    if not isinstance(node, dict):
        return {"name": None, "locode": None, "lat": None, "lng": None, "at": None, "actual": None, "predictiveEta": None}
    location = node.get("location") if isinstance(node.get("location"), dict) else node
    actual_at = _dict_get(node, "at", "date", "actualAt", "actual_at")
    predictive_eta = _dict_get(node, "predictiveEta", "predictive_eta", "eta", "etaAt")
    lat, lng = _coordinates(location.get("coordinates") if isinstance(location, dict) else None)
    if lat is None or lng is None:
        lat, lng = _coordinates(location)
    return {
        "name": _dict_get(location, "name", "locationName", "city"),
        "locode": _dict_get(location, "locode", "unlocode", "locationLocode"),
        "lat": lat,
        "lng": lng,
        "at": _iso(actual_at),
        "actual": node.get("actual") if "actual" in node else node.get("isActual"),
        "predictiveEta": _iso(predictive_eta),
    }


def _safecube_event_payload(row: dict[str, Any], index: int) -> dict[str, Any]:
    raw = _parse_json(row.get("raw_data")) or {}
    location = _parse_json(row.get("location")) or {}
    facility = _parse_json(row.get("facility")) or {}
    loc_lat, loc_lng = _coordinates(location)
    if loc_lat is None or loc_lng is None:
        loc_lat, loc_lng = _coordinates(facility)
    vessel = _first_dict((_parse_json(row.get("shipment_vessels")) or []) if row.get("shipment_vessels") else raw.get("vessels"))
    return {
        "id": str(row.get("id") or index),
        "containerId": row.get("container_number"),
        "sequenceNo": index + 1,
        "eventAt": _iso(row.get("occurred_at")),
        "description": row.get("description"),
        "eventCode": row.get("event_code"),
        "locationName": _dict_get(location, "name", "locationName"),
        "locationLocode": _dict_get(location, "locode", "unlocode", "locationLocode"),
        "locationLat": loc_lat,
        "locationLng": loc_lng,
        "facilityName": _dict_get(facility, "name", "facilityName"),
        "isActual": row.get("is_actual"),
        "transportType": raw.get("transportType") if isinstance(raw, dict) else None,
        "vesselName": _dict_get(vessel, "name", "vesselName"),
    }


def _safecube_container_payload(container: dict[str, Any], index: int) -> dict[str, Any]:
    number = _dict_get(container, "number", "containerNumber", "container_number") or f"container-{index + 1}"
    return {
        "id": str(_dict_get(container, "id", "containerId") or number),
        "number": str(number),
        "isoCode": _dict_get(container, "isoCode", "iso_code"),
        "sizeType": _dict_get(container, "sizeType", "size", "type", "containerType"),
        "status": _dict_get(container, "status", "shippingStatus"),
    }


def _safecube_route_points(summary: dict[str, Any]) -> list[dict[str, float]]:
    raw = summary.get("raw") if isinstance(summary.get("raw"), dict) else summary
    route_data = raw.get("routeData") if isinstance(raw, dict) else None
    points: list[dict[str, float]] = []
    if not isinstance(route_data, dict):
        return points
    for segment in route_data.get("routeSegments") or []:
        if not isinstance(segment, dict):
            continue
        for point in segment.get("path") or []:
            lat, lng = _coordinates(point)
            if lat is not None and lng is not None:
                points.append({"lat": lat, "lng": lng})
    return points


def _safecube_location_payload(location: dict[str, Any], index: int) -> dict[str, Any] | None:
    lat, lng = _coordinates(location.get("coordinates") if isinstance(location, dict) else None)
    if lat is None or lng is None:
        lat, lng = _coordinates(location)
    if lat is None or lng is None:
        return None
    return {
        "id": str(_dict_get(location, "id", "locode", "unlocode") or f"location-{index + 1}"),
        "name": _dict_get(location, "name", "locationName", "city"),
        "locode": _dict_get(location, "locode", "unlocode", "locationLocode"),
        "lat": lat,
        "lng": lng,
        "country": _dict_get(location, "country", "countryName"),
    }


def _safecube_ui_payload(row: dict[str, Any], events: list[dict[str, Any]]) -> dict[str, Any]:
    summary = _parse_json(row.get("raw_data")) or {}
    metadata = summary.get("metadata") if isinstance(summary.get("metadata"), dict) else {}
    route = _parse_json(row.get("route")) or summary.get("route") or {}
    ais = _parse_json(row.get("ais")) or summary.get("ais") or {}
    locations = _as_list(row.get("locations") or summary.get("locations"))
    vessels = _as_list(row.get("vessels") or summary.get("vessels"))
    containers = _as_list(row.get("containers") or summary.get("containers"))
    vessel = vessels[0] if vessels and isinstance(vessels[0], dict) else {}
    live_lat, live_lng = _coordinates(row.get("live_coordinates") or summary.get("liveCoordinates"))
    current_location = _parse_json(row.get("current_location")) or summary.get("currentLocation") or {}
    current_location_payload = current_location.get("location") if isinstance(current_location.get("location"), dict) else current_location
    current_lat, current_lng = _coordinates(current_location_payload)
    if current_lat is None or current_lng is None:
        current_lat, current_lng = _coordinates(row.get("live_coordinates") or summary.get("liveCoordinates"))

    event_payloads = [_safecube_event_payload(event, index) for index, event in enumerate(reversed(events))]
    route_nodes = {key: _route_node(route, key) for key in ("prepod", "pol", "pod", "postpod")}
    eta_at = route_nodes["pod"].get("predictiveEta") or route_nodes["postpod"].get("predictiveEta")
    location_payloads = [
        payload
        for index, location in enumerate(locations)
        if isinstance(location, dict)
        for payload in [_safecube_location_payload(location, index)]
        if payload is not None
    ]

    return {
        "id": str(row["id"]),
        "vesselName": _dict_get(vessel, "name", "vesselName"),
        "vesselImo": _num(_dict_get(vessel, "imo", "imoNumber", "vesselImo")),
        "vesselCallSign": _dict_get(vessel, "callSign", "callsign", "vesselCallSign"),
        "vesselFlag": _dict_get(vessel, "flag", "vesselFlag"),
        "liveLat": live_lat,
        "liveLng": live_lng,
        "livePositionUpdatedAt": _iso(row.get("fetched_at")),
        "aisStatus": _dict_get(ais if isinstance(ais, dict) else {}, "status", "navigationStatus"),
        "currentLocationName": _dict_get(current_location_payload if isinstance(current_location_payload, dict) else {}, "name", "locationName") or current_location.get("description"),
        "currentLocationAt": _iso(current_location.get("date")),
        "currentLocationLat": current_lat,
        "currentLocationLng": current_lng,
        "currentLocationCountry": _dict_get(current_location_payload if isinstance(current_location_payload, dict) else {}, "country", "countryName"),
        "currentEventDescription": current_location.get("description") or row.get("current_stage_name"),
        "scheduleStatus": metadata.get("shippingStatus") or row.get("status"),
        "delayDays": None,
        "etaAt": eta_at,
        "etaLabel": None,
        "shippingStatus": metadata.get("shippingStatus") or row.get("status"),
        "prepodName": route_nodes["prepod"]["name"],
        "prepodLocode": route_nodes["prepod"]["locode"],
        "prepodLat": route_nodes["prepod"]["lat"],
        "prepodLng": route_nodes["prepod"]["lng"],
        "prepodAt": route_nodes["prepod"]["at"],
        "prepodActual": route_nodes["prepod"]["actual"],
        "prepodPredictiveEta": route_nodes["prepod"]["predictiveEta"],
        "polName": route_nodes["pol"]["name"],
        "polLocode": route_nodes["pol"]["locode"],
        "polLat": route_nodes["pol"]["lat"],
        "polLng": route_nodes["pol"]["lng"],
        "polAt": route_nodes["pol"]["at"],
        "polActual": route_nodes["pol"]["actual"],
        "polPredictiveEta": route_nodes["pol"]["predictiveEta"],
        "podName": route_nodes["pod"]["name"],
        "podLocode": route_nodes["pod"]["locode"],
        "podLat": route_nodes["pod"]["lat"],
        "podLng": route_nodes["pod"]["lng"],
        "podAt": route_nodes["pod"]["at"],
        "podActual": route_nodes["pod"]["actual"],
        "podPredictiveEta": route_nodes["pod"]["predictiveEta"],
        "postpodName": route_nodes["postpod"]["name"],
        "postpodLocode": route_nodes["postpod"]["locode"],
        "postpodLat": route_nodes["postpod"]["lat"],
        "postpodLng": route_nodes["postpod"]["lng"],
        "postpodAt": route_nodes["postpod"]["at"],
        "postpodActual": route_nodes["postpod"]["actual"],
        "postpodPredictiveEta": route_nodes["postpod"]["predictiveEta"],
        "containers": [
            _safecube_container_payload(container, index)
            for index, container in enumerate(containers)
            if isinstance(container, dict)
        ],
        "events": event_payloads,
        "alerts": [],
        "locations": location_payloads,
        "routePoints": _safecube_route_points(summary),
    }


async def _tracking_events_for_sc_row(prisma, safecube_shipment_id: str) -> list[dict[str, Any]]:
    return await _query_raw(
        prisma,
        """
        SELECT ev.*, ss.vessels AS shipment_vessels
        FROM "dashboard"."safecube_tracking_events" ev
        JOIN "dashboard"."safecube_shipments" ss ON ss.id = ev.shipment_id
        WHERE ev."shipment_id" = $1
        ORDER BY ev."occurred_at" DESC NULLS LAST, ev."created_at" DESC
        """,
        safecube_shipment_id,
    )


async def _update_public_shipment_from_bol_and_tracking(prisma, shipment: dict[str, Any], bol: dict[str, Any] | None, sc_row: dict[str, Any] | None) -> None:
    if not shipment or not bol:
        return
    vessels = _as_list(sc_row.get("vessels")) if sc_row else []
    vessel = vessels[0] if vessels and isinstance(vessels[0], dict) else {}
    current_location = _parse_json(sc_row.get("current_location")) if sc_row else {}
    current_stage_name = (current_location or {}).get("description") if isinstance(current_location, dict) else None
    try:
        await _execute_raw(
            prisma,
            """
            UPDATE "public"."shipments"
            SET
              "vessel_name" = COALESCE(NULLIF("vessel_name", ''), $2),
              "port_of_loading" = COALESCE(NULLIF("port_of_loading", ''), $3),
              "port_of_discharge" = COALESCE(NULLIF("port_of_discharge", ''), $4),
              "current_stage_name" = COALESCE($5, "current_stage_name"),
              "updated_at" = NOW()
            WHERE "id"::text = $1::text
            """,
            str(shipment["id"]),
            _dict_get(vessel, "name", "vesselName") or bol.get("vessel_name"),
            bol.get("port_of_loading"),
            bol.get("port_of_discharge"),
            current_stage_name,
        )
    except Exception:
        pass


@router.get(settings.API_SLUG + "/shipments")
async def list_shipments(
    user=Depends(get_current_user),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    offset: int | None = Query(None, ge=0),
    search: str | None = Query(None),
):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    resolved_offset = offset if offset is not None else (page - 1) * limit
    query_text = str(search or "").strip()
    await _ensure_shipment_360_views(prisma)
    try:
        total_rows = await _query_raw(
            prisma,
            """
            SELECT count(*)::int AS total
            FROM shipment_360.shipment_list_view
            WHERE $1::text = ''
               OR search_text ILIKE ('%' || $1::text || '%')
            """,
            query_text,
        )
        shipment_rows = await _query_raw(
            prisma,
            """
            SELECT *
            FROM shipment_360.shipment_list_view
            WHERE $1::text = ''
               OR search_text ILIKE ('%' || $1::text || '%')
            ORDER BY "created_at" DESC
            LIMIT $2 OFFSET $3
            """,
            query_text,
            limit,
            resolved_offset,
        )
        total = int((total_rows[0] or {}).get("total") or 0) if total_rows else 0
        data = [_view_shipment_payload(row) for row in shipment_rows]
        await _annotate_linked_document_counts(prisma, data)
        return {
            "ok": True,
            "data": data,
            "meta": {
                "total": total,
                "page": page if offset is None else (resolved_offset // limit) + 1,
                "pageSize": limit,
                "offset": resolved_offset,
                "hasNext": resolved_offset + len(data) < total,
                "hasPrev": resolved_offset > 0,
            },
        }
    except Exception:
        await _ensure_safecube_tables(prisma)
        rows = await _query_raw(
            prisma,
            'SELECT * FROM "dashboard"."safecube_shipments" ORDER BY "fetched_at" DESC',
        )
        return {
            "ok": True,
            "data": [_row_to_shipment(row) for row in rows],
            "meta": {"total": len(rows)},
        }


@router.get(settings.API_SLUG + "/shipments/{shipment_id}")
async def get_shipment(shipment_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    try:
        shipment = await _public_shipment_row(prisma, shipment_id)
        if shipment:
            await link_documents_to_shipment_by_keys(prisma, str(shipment["id"]))
    except Exception as exc:
        print(f"[shipments] warning: could not refresh linked documents for shipment {shipment_id}: {exc}", flush=True)
    await _ensure_shipment_360_views(prisma)
    try:
        rows = await _query_raw(
            prisma,
            """
            SELECT *
            FROM shipment_360.shipment_detail_view
            WHERE id = $1::text OR shipment_number = $1::text
            LIMIT 1
            """,
            shipment_id,
        )
        if rows:
            return {"ok": True, "data": _view_shipment_payload(rows[0], include_containers=True)}
    except Exception:
        pass

    rows = await _query_raw(
        prisma,
        """
        SELECT * FROM "dashboard"."safecube_shipments"
        WHERE "id" = $1 OR "shipment_number" = $1
        LIMIT 1
        """,
        shipment_id,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Shipment not found")
    events = await _query_raw(
        prisma,
        """
        SELECT * FROM "dashboard"."safecube_tracking_events"
        WHERE "shipment_id" = $1
        ORDER BY "occurred_at" DESC NULLS LAST, "created_at" DESC
        """,
        rows[0]["id"],
    )
    return {"data": _row_to_shipment(rows[0], events)}


@router.get(settings.API_SLUG + "/shipments/{shipment_id}/documents")
async def list_shipment_documents(shipment_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    shipment = await _public_shipment_row(prisma, shipment_id)
    if shipment:
        try:
            await link_documents_to_shipment_by_keys(prisma, str(shipment["id"]))
        except Exception as exc:
            print(f"[shipments] warning: could not refresh shipment document links {shipment_id}: {exc}", flush=True)
    await _ensure_shipment_360_views(prisma)
    rows = await _query_raw(
        prisma,
        """
        SELECT documents
        FROM shipment_360.shipment_detail_view
        WHERE id = $1::text OR shipment_number = $1::text
        LIMIT 1
        """,
        shipment_id,
    )
    if rows:
        return {"ok": True, "data": _as_list(rows[0].get("documents"))}
    shipment = shipment or await _public_shipment_row(prisma, shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return {"ok": True, "data": await _shipment_documents(prisma, str(shipment["id"]))}


@router.get(settings.API_SLUG + "/shipments/{shipment_id}/safecube")
async def get_shipment_safecube(shipment_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    await _ensure_safecube_tables(prisma)
    shipment = await _public_shipment_row(prisma, shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    bol = await _approved_bol_for_shipment(prisma, shipment)
    row = await _shipment_tracking_row(prisma, shipment, bol)
    if not row:
        return {"ok": True, "data": None}
    events = await _tracking_events_for_sc_row(prisma, str(row["id"]))
    return {"ok": True, "data": _safecube_ui_payload(row, events)}


@router.post(settings.API_SLUG + "/shipments/{shipment_id}/safecube/link")
async def link_shipment_safecube(shipment_id: str, payload: dict[str, Any] | None = None, user=Depends(get_current_user)):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    await _ensure_safecube_tables(prisma)
    shipment = await _public_shipment_row(prisma, shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    bol = await _approved_bol_for_shipment(prisma, shipment)
    tracking_reference = _bol_tracking_reference(bol, shipment)
    if not bol or not tracking_reference:
        return {"ok": False, "error": "No approved BOL with MBL/BOL reference found for this shipment"}

    existing = await _shipment_tracking_row(prisma, shipment, bol)
    if existing:
        events = await _tracking_events_for_sc_row(prisma, str(existing["id"]))
        return {"ok": True, "data": _safecube_ui_payload(existing, events)}

    body = payload or {}
    shipment_type = str(body.get("shipmentType") or _tracking_type_for_reference(tracking_reference, bol, shipment)).upper()
    sealine = body.get("sealine")
    try:
        summary = track_container(
            tracking_reference,
            shipment_type=shipment_type,
            sealine=str(sealine).strip().upper() if sealine else None,
            include_summary=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"SafeCube tracking failed: {exc}") from exc

    row = await _store_tracking(
        prisma,
        TrackShipmentRequest(
            trackingReference=tracking_reference,
            shipmentType=shipment_type,
            sealine=str(sealine).strip().upper() if sealine else None,
        ),
        summary,
    )
    await _update_public_shipment_from_bol_and_tracking(prisma, shipment, bol, row)
    events = await _tracking_events_for_sc_row(prisma, str(row["id"]))
    return {"ok": True, "data": _safecube_ui_payload(row, events)}


@router.post(settings.API_SLUG + "/shipments/{shipment_id}/safecube/sync")
async def sync_shipment_safecube(shipment_id: str, payload: dict[str, Any] | None = None, user=Depends(get_current_user)):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    await _ensure_safecube_tables(prisma)
    shipment = await _public_shipment_row(prisma, shipment_id)
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    bol = await _approved_bol_for_shipment(prisma, shipment)
    existing = await _shipment_tracking_row(prisma, shipment, bol)
    tracking_reference = str((existing or {}).get("shipment_number") or _bol_tracking_reference(bol, shipment) or "").strip()
    if not tracking_reference:
        return {"ok": False, "error": "No SafeCube reference found for this shipment"}
    body = payload or {}
    shipment_type = str(body.get("shipmentType") or (existing or {}).get("shipment_type") or _tracking_type_for_reference(tracking_reference, bol, shipment)).upper()
    sealine = body.get("sealine") or (existing or {}).get("sealine")
    try:
        summary = track_container(
            tracking_reference,
            shipment_type=shipment_type,
            sealine=str(sealine).strip().upper() if sealine else None,
            include_summary=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"SafeCube tracking failed: {exc}") from exc

    row = await _store_tracking(
        prisma,
        TrackShipmentRequest(
            trackingReference=tracking_reference,
            shipmentType=shipment_type,
            sealine=str(sealine).strip().upper() if sealine else None,
        ),
        summary,
    )
    await _update_public_shipment_from_bol_and_tracking(prisma, shipment, bol, row)
    events = await _tracking_events_for_sc_row(prisma, str(row["id"]))
    return {"ok": True, "data": _safecube_ui_payload(row, events)}


@router.post(settings.API_SLUG + "/shipments/track")
async def track_shipment(payload: TrackShipmentRequest, user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _ensure_safecube_tables(prisma)
    try:
        summary = track_container(
            payload.trackingReference,
            shipment_type=payload.shipmentType,
            sealine=payload.sealine,
            include_summary=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"SafeCube tracking failed: {exc}") from exc
    row = await _store_tracking(prisma, payload, summary)
    events = await _query_raw(
        prisma,
        """
        SELECT * FROM "dashboard"."safecube_tracking_events"
        WHERE "shipment_id" = $1
        ORDER BY "occurred_at" DESC NULLS LAST, "created_at" DESC
        """,
        row["id"],
    )
    return {"data": _row_to_shipment(row, events)}


@router.get(settings.API_SLUG + "/shipments/{shipment_id}/gates")
async def list_shipment_gates(shipment_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    try:
        shipment = await _public_shipment_row(prisma, shipment_id)
        if shipment:
            await link_documents_to_shipment_by_keys(prisma, str(shipment["id"]))
            shipment_id = str(shipment["id"])
    except Exception as exc:
        print(f"[shipments] warning: could not refresh gate document links {shipment_id}: {exc}", flush=True)
    try:
        rows = await _shipment_gate_rows(prisma, shipment_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Shipment gates not found") from exc
    doc_type_gates = await _doc_type_gate_rows(
        prisma,
        [str(row["gate_config_id"]) for row in rows],
    )
    visible_rows, doc_type_gates = _remap_parallel_assignments_to_respective_gates(rows, doc_type_gates)
    return {
        "ok": True,
        "data": [
            _gate_row(row, doc_type_gates.get(str(row["gate_config_id"]), []))
            for row in visible_rows
        ],
    }


async def _update_shipment_status(prisma, shipment_id: str, status: str) -> dict[str, Any]:
    rows = await _query_raw(
        prisma,
        """
        UPDATE "public"."shipments"
        SET "status" = $2, "updated_at" = NOW()
        WHERE "id" = $1::uuid
        RETURNING "id"::text, "shipment_number", "status"
        """,
        shipment_id,
        status,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return rows[0]


@router.post(settings.API_SLUG + "/shipments/{shipment_id}/hold")
async def hold_shipment(shipment_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    row = await _update_shipment_status(prisma, shipment_id, "on_hold")
    return {"ok": True, "data": {"shipmentId": row["id"], "status": row["status"]}}


@router.post(settings.API_SLUG + "/shipments/{shipment_id}/resume")
async def resume_shipment(shipment_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    current = await _public_shipment_row(prisma, shipment_id)
    if str(current.get("status") or "").lower() in {"cancelled", "canceled"}:
        raise HTTPException(status_code=409, detail="Cancelled shipments cannot be resumed")
    row = await _update_shipment_status(prisma, shipment_id, "active")
    return {"ok": True, "data": {"shipmentId": row["id"], "status": row["status"]}}


@router.post(settings.API_SLUG + "/shipments/{shipment_id}/cancel")
async def cancel_shipment(shipment_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    row = await _update_shipment_status(prisma, shipment_id, "cancelled")
    return {"ok": True, "data": {"shipmentId": row["id"], "status": row["status"]}}


@router.post(settings.API_SLUG + "/shipments/{shipment_id}/pass")
async def pass_shipment_gate(shipment_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    gate = await _current_open_gate(prisma, shipment_id)
    blocks = await _gate_validation_blocks(prisma, shipment_id, gate)
    if blocks:
        reason = "Gate blocked by document validation"
        await _execute_raw(
            prisma,
            """
            UPDATE "public"."shipment_gates"
            SET "blocked_reason" = $2
            WHERE "id" = $1::uuid
            """,
            str(gate["id"]),
            reason,
        )
        await _set_shipment_block_reason(prisma, shipment_id, reason)
        raise HTTPException(
            status_code=409,
            detail={
                "message": reason,
                "rule": "BLOCKED and WAITING stop gate pass; WARNING and PASSED allow gate pass.",
                "blocks": blocks,
            },
        )

    await _execute_raw(
        prisma,
        """
        UPDATE "public"."shipment_gates"
        SET "status" = 'PASSED', "passed_at" = NOW(), "blocked_reason" = NULL
        WHERE "id" = $1::uuid
        """,
        str(gate["id"]),
    )
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."shipment_gates" sg
        SET "status" = 'OPEN', "blocked_reason" = NULL
        FROM "public"."gate_configs" gc
        WHERE sg."gate_config_id" = gc."id"
          AND sg."shipment_id" = $1::uuid
          AND sg."status" NOT IN ('PASSED', 'SKIPPED')
          AND gc."gate_number" > $2
          AND EXISTS (
            SELECT 1
            FROM "public"."doc_type_gates" dtg
            WHERE dtg."gate_config_id" = gc."id"
              AND COALESCE(dtg."role_in_gate"::text, '') <> 'PARALLEL'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "public"."shipment_gates" sg2
            JOIN "public"."gate_configs" gc_open ON gc_open."id" = sg2."gate_config_id"
            WHERE sg2."shipment_id" = $1::uuid
              AND sg2."status" = 'OPEN'
              AND EXISTS (
                SELECT 1
                FROM "public"."doc_type_gates" dtg_open
                WHERE dtg_open."gate_config_id" = gc_open."id"
                  AND COALESCE(dtg_open."role_in_gate"::text, '') <> 'PARALLEL'
              )
          )
          AND gc."gate_number" = (
            SELECT MIN(gc2."gate_number")
            FROM "public"."shipment_gates" sg3
            JOIN "public"."gate_configs" gc2 ON gc2."id" = sg3."gate_config_id"
            WHERE sg3."shipment_id" = $1::uuid
              AND sg3."status" NOT IN ('PASSED', 'SKIPPED')
              AND gc2."gate_number" > $2
              AND EXISTS (
                SELECT 1
                FROM "public"."doc_type_gates" dtg2
                WHERE dtg2."gate_config_id" = gc2."id"
                  AND COALESCE(dtg2."role_in_gate"::text, '') <> 'PARALLEL'
              )
          )
        """,
        shipment_id,
        gate.get("gate_number") or 0,
    )
    await _set_shipment_block_reason(prisma, shipment_id, None)
    return {"ok": True, "data": {"shipmentId": shipment_id, "gateId": str(gate["id"]), "status": "PASSED"}}


@router.post(settings.API_SLUG + "/shipments/{shipment_id}/skip")
async def skip_shipment_gate(shipment_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    gate = await _current_open_gate(prisma, shipment_id)
    blocks = await _gate_validation_blocks(prisma, shipment_id, gate)
    if blocks:
        reason = "Gate blocked by document validation"
        await _execute_raw(
            prisma,
            """
            UPDATE "public"."shipment_gates"
            SET "blocked_reason" = $2
            WHERE "id" = $1::uuid
            """,
            str(gate["id"]),
            reason,
        )
        await _set_shipment_block_reason(prisma, shipment_id, reason)
        raise HTTPException(
            status_code=409,
            detail={
                "message": reason,
                "rule": "BLOCKED and WAITING stop gate transition; WARNING and PASSED allow gate transition.",
                "blocks": blocks,
            },
        )
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."shipment_gates"
        SET "status" = 'SKIPPED', "blocked_reason" = NULL
        WHERE "id" = $1::uuid
        """,
        str(gate["id"]),
    )
    await _set_shipment_block_reason(prisma, shipment_id, None)
    return {"ok": True, "data": {"shipmentId": shipment_id, "gateId": str(gate["id"]), "status": "SKIPPED"}}


@router.post(settings.API_SLUG + "/shipments/{shipment_id}/revert")
async def revert_shipment_gate(shipment_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    rows = await _shipment_gate_rows(prisma, shipment_id)
    passed = [row for row in rows if str(row.get("status") or "").upper() == "PASSED"]
    if not passed:
        raise HTTPException(status_code=409, detail="No passed gate found to revert")
    gate = passed[-1]
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."shipment_gates"
        SET "status" = 'OPEN', "passed_at" = NULL, "blocked_reason" = NULL
        WHERE "id" = $1::uuid
        """,
        str(gate["id"]),
    )
    await _set_shipment_block_reason(prisma, shipment_id, None)
    return {"ok": True, "data": {"shipmentId": shipment_id, "gateId": str(gate["id"]), "status": "OPEN"}}
