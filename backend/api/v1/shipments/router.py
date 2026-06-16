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


router = APIRouter(tags=["Shipments"])


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
    await _ensure_safecube_tables(prisma)
    rows = await _query_raw(
        prisma,
        'SELECT * FROM "dashboard"."safecube_shipments" ORDER BY "fetched_at" DESC',
    )
    return {"data": [_row_to_shipment(row) for row in rows]}


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
