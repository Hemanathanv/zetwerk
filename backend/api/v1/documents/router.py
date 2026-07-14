from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import get_prisma
from helpers.config import settings
from helpers.dependencies import get_current_user
from shipment_360.safecube import track_container


router = APIRouter(tags=["Documents"])


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


async def _query_raw(prisma, sql: str, *params) -> list[dict[str, Any]]:
    query_raw = getattr(prisma, "query_raw", None)
    if query_raw is None:
        raise RuntimeError("Prisma client has no query_raw")
    rows = await query_raw(sql, *params)
    return [dict(row) for row in rows]


async def _execute_raw(prisma, sql: str, *params) -> Any:
    execute_raw = getattr(prisma, "execute_raw", None)
    if execute_raw is None:
        raise RuntimeError("Prisma client has no execute_raw")
    return await execute_raw(sql, *params)


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
        SELECT sg.*, gc."gate_number", gc."gate_name"
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
    queries = [
        """
        SELECT "id"::text AS id, "document_type"::text AS doc_type,
               "approved_at", "status"::text AS status
        FROM "public"."documents"
        WHERE "shipment_id" = $1::uuid
          AND "document_type"::text = ANY($2::text[])
        ORDER BY "approved_at" DESC NULLS LAST, "created_at" DESC
        """,
        """
        SELECT "id"::text AS id, "doc_type"::text AS doc_type,
               NULL::timestamptz AS approved_at, "status"::text AS status
        FROM "public"."documents"
        WHERE "shipment_id" = $1::uuid
          AND "doc_type"::text = ANY($2::text[])
        ORDER BY "created_at" DESC
        """,
    ]
    for sql in queries:
        try:
            return await _query_raw(prisma, sql, shipment_id, doc_types)
        except Exception:
            continue
    return []


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
                        "reason": (
                            "Validation has not finished yet."
                            if status == "WAITING"
                            else "Blocking validation failed."
                        ),
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
    status = current_location.get("status") or "ACTIVE"

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
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11::jsonb)
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


@router.get(settings.API_SLUG + "/shipments")
@router.get("/api/shipments")
async def list_shipments(user=Depends(get_current_user)):
    prisma = await get_prisma()
    # The operational UI expects the original EWMS shipment contract, not
    # SafeCube's standalone tracking rows.
    try:
        shipment_rows = await _query_raw(
            prisma,
            """
            SELECT "id", "shipment_number", "status", "blocked_reason",
                   "current_stage", "current_stage_name", "workflow_template_id",
                   "vessel_name", "port_of_loading", "port_of_discharge",
                   "exporter_name", "buyer_name"
            FROM "public"."shipments"
            ORDER BY "created_at" DESC
            LIMIT 200
            """,
        )
        shipment_ids = [str(row["id"]) for row in shipment_rows]
        documents_by_shipment: dict[str, list[dict[str, Any]]] = {
            shipment_id: [] for shipment_id in shipment_ids
        }
        gates_by_shipment: dict[str, list[dict[str, Any]]] = {
            shipment_id: [] for shipment_id in shipment_ids
        }

        if shipment_ids:
            try:
                document_rows = await _query_raw(
                    prisma,
                    """
                    SELECT "id", "shipment_id", "document_type", "document_number",
                           "ocr_status", "validation_status", "approved_at", "is_generated"
                    FROM "public"."documents"
                    WHERE "shipment_id" = ANY($1::uuid[])
                    ORDER BY "created_at" ASC
                    """,
                    shipment_ids,
                )
                for document in document_rows:
                    shipment_id = str(document["shipment_id"])
                    documents_by_shipment.setdefault(shipment_id, []).append({
                        "id": str(document["id"]),
                        "documentType": document.get("document_type"),
                        "documentNumber": document.get("document_number"),
                        "ocrStatus": document.get("ocr_status") or "",
                        "validationStatus": document.get("validation_status") or "",
                        "approvedAt": _iso(document.get("approved_at")),
                        "isGenerated": bool(document.get("is_generated")),
                    })
            except Exception:
                # OCR-only schemas do not carry the legacy shipment columns.
                pass

            try:
                gate_rows = await _query_raw(
                    prisma,
                    """
                    SELECT sg."shipment_id", sg."gate_config_id", sg."status",
                           sg."passed_at", sg."blocked_reason",
                           gc."gate_number", gc."gate_name"
                    FROM "public"."shipment_gates" sg
                    JOIN "public"."gate_configs" gc ON gc."id" = sg."gate_config_id"
                    WHERE sg."shipment_id" = ANY($1::uuid[])
                    ORDER BY gc."gate_number" ASC
                    """,
                    shipment_ids,
                )
                for gate in gate_rows:
                    shipment_id = str(gate["shipment_id"])
                    gates_by_shipment.setdefault(shipment_id, []).append({
                        "gateConfigId": str(gate["gate_config_id"]),
                        "status": str(gate.get("status") or "FUTURE"),
                        "passedAt": _iso(gate.get("passed_at")),
                        "blockedReason": gate.get("blocked_reason"),
                        "gateConfig": {
                            "gateNumber": gate.get("gate_number"),
                            "gateName": gate.get("gate_name"),
                        },
                    })
            except Exception:
                pass

        data = []
        for row in shipment_rows:
            shipment_id = str(row["id"])
            documents = documents_by_shipment.get(shipment_id, [])
            data.append({
                "id": shipment_id,
                "shipmentNumber": row.get("shipment_number"),
                "status": row.get("status"),
                "blockedReason": row.get("blocked_reason"),
                "currentStage": row.get("current_stage") or 1,
                "currentStageName": row.get("current_stage_name"),
                "templateId": str(row["workflow_template_id"]) if row.get("workflow_template_id") else None,
                "vesselName": row.get("vessel_name"),
                "portOfLoading": row.get("port_of_loading"),
                "portOfDischarge": row.get("port_of_discharge"),
                "exporterName": row.get("exporter_name"),
                "buyerName": row.get("buyer_name"),
                "documents": documents,
                "shipmentGates": gates_by_shipment.get(shipment_id, []),
                "_count": {"documents": len(documents)},
            })
        return {"ok": True, "data": data, "meta": {"total": len(data)}}
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
@router.get("/api/shipments/{shipment_id}")
async def get_shipment(shipment_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _ensure_safecube_tables(prisma)
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


@router.post(settings.API_SLUG + "/shipments/track")
@router.post("/api/shipments/track")
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
@router.get("/api/shipments/{shipment_id}/gates")
async def list_shipment_gates(shipment_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
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


@router.post(settings.API_SLUG + "/shipments/{shipment_id}/pass")
@router.post("/api/shipments/{shipment_id}/pass")
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
@router.post("/api/shipments/{shipment_id}/skip")
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
@router.post("/api/shipments/{shipment_id}/revert")
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
