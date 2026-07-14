from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from db import get_prisma
from helpers.dependencies import get_current_user


router = APIRouter(prefix="/api/tracking", tags=["Tracking"])


def _user_id(user: Any) -> str:
    return str(user.get("id") if isinstance(user, dict) else getattr(user, "id", ""))


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _parse_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


async def _query_raw(prisma, sql: str, *params) -> list[dict[str, Any]]:
    rows = await prisma.query_raw(sql, *params)
    return [dict(row) for row in rows]


def _event_payload(row: dict[str, Any]) -> dict[str, Any] | None:
    if not row.get("event_id"):
        return None
    location = _parse_json(row.get("event_location")) or {}
    facility = _parse_json(row.get("event_facility")) or {}
    return {
        "id": str(row["event_id"]),
        "eventCode": row.get("event_code"),
        "status": row.get("event_status"),
        "description": row.get("event_description"),
        "eventAt": _iso(row.get("event_occurred_at")),
        "isActual": row.get("event_is_actual"),
        "locationName": location.get("name") or location.get("locationName") if isinstance(location, dict) else None,
        "locationLocode": location.get("locode") or location.get("unlocode") if isinstance(location, dict) else None,
        "facilityName": facility.get("name") or facility.get("facilityName") if isinstance(facility, dict) else None,
        "facilityLocode": facility.get("locode") or facility.get("unlocode") if isinstance(facility, dict) else None,
    }


def _first_vessel(row: dict[str, Any]) -> dict[str, Any]:
    vessels = _parse_json(row.get("sc_vessels")) or []
    if isinstance(vessels, list) and vessels and isinstance(vessels[0], dict):
        return vessels[0]
    return {}


def _container_payload(row: dict[str, Any], *, include_sc_events: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    container_number = str(row.get("container_number") or "").strip()
    vessel = _first_vessel(row)
    last_event = _event_payload(row)
    sc_shipment = None
    if row.get("sc_shipment_id"):
        sc_shipment = {
            "id": str(row.get("sc_shipment_id")),
            "shipmentNumber": row.get("sc_shipment_number"),
            "status": row.get("sc_status"),
            "vesselName": vessel.get("name") or row.get("vessel_name"),
            "sealine": row.get("sc_sealine"),
            "podPredictiveEta": None,
            "delayDays": None,
            "scheduleStatus": None,
        }

    return {
        "id": str(row["container_id"]),
        "containerNumber": container_number,
        "containerType": row.get("container_type"),
        "sealNumber": row.get("seal_number"),
        "grossWeight": row.get("gross_weight_kg"),
        "netWeight": row.get("net_weight_kg"),
        "packageCount": row.get("packages"),
        "currentStatus": "at_origin",
        "currentLocation": row.get("port_of_loading") or row.get("port_of_discharge"),
        "vesselName": row.get("vessel_name"),
        "voyageNumber": row.get("vessel_voyage_number"),
        "etaPort": None,
        "podPredictiveEta": None,
        "scheduleStatus": None,
        "delayDays": None,
        "lastEventAt": last_event.get("eventAt") if last_event else None,
        "latestMovementType": None,
        "shipmentId": None,
        "shipment": {
            "id": str(row["document_id"]),
            "shipmentNumber": row.get("bol_number") or str(row["document_id"]),
            "blNumber": row.get("bol_number"),
            "portOfLoading": row.get("port_of_loading"),
            "portOfDischarge": row.get("port_of_discharge"),
        },
        "sc": {
            "status": row.get("sc_status"),
            "lastEvent": last_event,
            "isoCode": None,
        } if row.get("sc_shipment_id") or last_event else None,
        "scVesselName": vessel.get("name"),
        "source": "BILL_OF_LADING_CONTAINER_MAPPING",
        "mappingApprovedAt": row.get("mapping_approved_at"),
        "scData": {
            "shipment": sc_shipment,
            "container": {"number": container_number},
            "events": include_sc_events or ([] if include_sc_events is not None else None),
        } if include_sc_events is not None or sc_shipment else None,
    }


BASE_CONTAINER_SQL = """
    SELECT
      bc.id::text AS container_id,
      bc.number AS container_number,
      bc.type AS container_type,
      bc.seal_number,
      bc.gross_weight_kg,
      bc.net_weight_kg,
      bc.packages,
      bol.id::text AS bol_id,
      bol.document_id::text AS document_id,
      bol.bol_number,
      bol.vessel_name,
      bol.vessel_voyage_number,
      bol.port_of_loading,
      bol.port_of_discharge,
      bol.raw_data->>'containerMappingApprovedAt' AS mapping_approved_at,
      NULL::text AS sc_shipment_id,
      NULL::text AS sc_shipment_number,
      NULL::text AS sc_status,
      NULL::text AS sc_sealine,
      NULL::jsonb AS sc_vessels,
      NULL::text AS event_id,
      NULL::text AS event_code,
      NULL::text AS event_status,
      NULL::text AS event_description,
      NULL::jsonb AS event_location,
      NULL::jsonb AS event_facility,
      NULL::timestamptz AS event_occurred_at,
      NULL::boolean AS event_is_actual
    FROM aiextraction.bill_of_lading_containers bc
    JOIN aiextraction.bills_of_lading bol ON bol.id = bc.bill_of_lading_id
    JOIN public.documents d ON d.id = bol.document_id
    WHERE d.uploaded_by::text = $1::text
      AND d.is_deleted = false
      AND COALESCE((bol.raw_data->>'containerMappingApproved')::boolean, false) = true
      AND COALESCE(bc.number, '') <> ''
"""


SC_CONTAINER_SQL = BASE_CONTAINER_SQL.replace(
    "NULL::text AS sc_shipment_id,\n      NULL::text AS sc_shipment_number,\n      NULL::text AS sc_status,\n      NULL::text AS sc_sealine,\n      NULL::jsonb AS sc_vessels,\n      NULL::text AS event_id,\n      NULL::text AS event_code,\n      NULL::text AS event_status,\n      NULL::text AS event_description,\n      NULL::jsonb AS event_location,\n      NULL::jsonb AS event_facility,\n      NULL::timestamptz AS event_occurred_at,\n      NULL::boolean AS event_is_actual",
    "sc.shipment_id AS sc_shipment_id,\n      sc.shipment_number AS sc_shipment_number,\n      sc.sc_status,\n      sc.sealine AS sc_sealine,\n      sc.vessels AS sc_vessels,\n      sc.event_id,\n      sc.event_code,\n      sc.event_status,\n      sc.event_description,\n      sc.event_location,\n      sc.event_facility,\n      sc.event_occurred_at,\n      sc.event_is_actual",
).replace(
    "WHERE d.uploaded_by::text = $1::text",
    """
    LEFT JOIN LATERAL (
      SELECT
        ss.id AS shipment_id,
        ss.shipment_number,
        ss.status AS sc_status,
        ss.sealine,
        ss.vessels,
        ev.id AS event_id,
        ev.event_code,
        ev.status AS event_status,
        ev.description AS event_description,
        ev.location AS event_location,
        ev.facility AS event_facility,
        ev.occurred_at AS event_occurred_at,
        ev.is_actual AS event_is_actual
      FROM dashboard.safecube_tracking_events ev
      JOIN dashboard.safecube_shipments ss ON ss.id = ev.shipment_id
      WHERE ev.container_number = bc.number
      ORDER BY ev.occurred_at DESC NULLS LAST, ev.created_at DESC
      LIMIT 1
    ) sc ON true
    WHERE d.uploaded_by::text = $1::text
    """,
)


async def _container_rows(prisma, uploaded_by: str, container_id: str | None = None) -> list[dict[str, Any]]:
    suffix = ""
    params: list[Any] = [uploaded_by]
    if container_id:
        suffix = " AND bc.id::text = $2::text"
        params.append(container_id)
    order = " ORDER BY bol.updated_at DESC, bc.item_index NULLS LAST, bc.number ASC"
    try:
        return await _query_raw(prisma, SC_CONTAINER_SQL + suffix + order, *params)
    except Exception:
        return await _query_raw(prisma, BASE_CONTAINER_SQL + suffix + order, *params)


@router.get("/containers/all")
async def list_inventory_containers(user=Depends(get_current_user)):
    prisma = await get_prisma()
    rows = await _container_rows(prisma, _user_id(user))
    return {"ok": True, "data": [_container_payload(row) for row in rows]}


@router.get("/containers/{container_id}")
async def get_inventory_container(container_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    rows = await _container_rows(prisma, _user_id(user), container_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Container not found")
    events = await _tracking_events(prisma, str(rows[0].get("container_number") or ""))
    return {"ok": True, "data": _container_payload(rows[0], include_sc_events=events)}


@router.get("/containers/{container_id}/contents")
async def get_inventory_container_contents(container_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    rows = await _query_raw(
        prisma,
        """
        SELECT item AS row
        FROM aiextraction.bill_of_lading_containers bc
        JOIN aiextraction.bills_of_lading bol ON bol.id = bc.bill_of_lading_id
        JOIN public.documents d ON d.id = bol.document_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(bol.raw_data->'containerMappingRows', '[]'::jsonb)) AS item
        WHERE d.uploaded_by::text = $1::text
          AND d.is_deleted = false
          AND bc.id::text = $2::text
          AND item->>'containerNo' = bc.number
        ORDER BY item->>'productCode', item->>'description'
        """,
        _user_id(user),
        container_id,
    )
    data = []
    for row in rows:
        item = row.get("row") or {}
        data.append({
            "matched": True,
            "productCode": item.get("productCode"),
            "description": item.get("description"),
            "specification": item.get("specification"),
            "quantity": item.get("totalQtyInPcs"),
            "grossWeight": item.get("grossWeightKgs"),
            "netWeight": item.get("netWeightKgs"),
            "containerNo": item.get("containerNo"),
            "invoiceNumber": item.get("invoiceNumber"),
            "masterData": None,
        })
    return {"ok": True, "data": data}


async def _tracking_events(prisma, container_number: str) -> list[dict[str, Any]]:
    if not container_number:
        return []
    try:
        rows = await _query_raw(
            prisma,
            """
            SELECT
              ev.id::text,
              ev.event_code,
              ev.status,
              ev.description,
              ev.location,
              ev.facility,
              ev.occurred_at,
              ev.is_actual,
              ss.vessels
            FROM dashboard.safecube_tracking_events ev
            JOIN dashboard.safecube_shipments ss ON ss.id = ev.shipment_id
            WHERE ev.container_number = $1::text
            ORDER BY ev.occurred_at DESC NULLS LAST, ev.created_at DESC
            """,
            container_number,
        )
    except Exception:
        return []
    events = []
    for row in rows:
        location = _parse_json(row.get("location")) or {}
        facility = _parse_json(row.get("facility")) or {}
        vessel = {}
        vessels = _parse_json(row.get("vessels")) or []
        if isinstance(vessels, list) and vessels and isinstance(vessels[0], dict):
            vessel = vessels[0]
        events.append({
            "id": row.get("id"),
            "eventCode": row.get("event_code"),
            "status": row.get("status"),
            "description": row.get("description"),
            "eventAt": _iso(row.get("occurred_at")),
            "isActual": row.get("is_actual"),
            "locationName": location.get("name") or location.get("locationName") if isinstance(location, dict) else None,
            "locationLocode": location.get("locode") or location.get("unlocode") if isinstance(location, dict) else None,
            "facilityName": facility.get("name") or facility.get("facilityName") if isinstance(facility, dict) else None,
            "facilityLocode": facility.get("locode") or facility.get("unlocode") if isinstance(facility, dict) else None,
            "vesselName": vessel.get("name"),
            "voyage": vessel.get("voyage"),
        })
    return events
