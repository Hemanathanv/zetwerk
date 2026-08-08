from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from db import get_prisma
from doc_generation.db_setup import ensure_doc_generation_views
from helpers.config import settings
from helpers.dependencies import get_current_user
from helpers.rbac import require_activity, require_any_activity
from helpers.rbac_data_access import document_sql_where


router = APIRouter(prefix=settings.API_SLUG, tags=["Inventory"])

ALL_WAREHOUSE_ID = "all"

DEFAULT_WAREHOUSE_LOCATIONS: list[dict[str, Any]] = [
    {"id": "default-la-3pl", "name": "Los Angeles 3PL — Pacific Distribution Center", "location_type": "WAREHOUSE"},
    {"id": "default-mundra-cfs", "name": "Mundra CFS — Adani Logistics", "location_type": "PORT"},
    {"id": "default-nhava-sheva-icd", "name": "Nhava Sheva ICD — Gateway Terminals", "location_type": "PORT"},
    {"id": "default-port-baltimore", "name": "Port: Baltimore", "location_type": "PORT"},
    {"id": "default-port-chicago", "name": "Port: Chicago (via rail)", "location_type": "PORT"},
    {"id": "default-port-houston", "name": "Port: Houston", "location_type": "PORT"},
    {"id": "default-port-los-angeles", "name": "Port: Los Angeles", "location_type": "PORT"},
    {"id": "default-port-savannah", "name": "Port: Savannah", "location_type": "PORT"},
    {"id": "default-savannah-3pl", "name": "Savannah 3PL — Atlantic Steel Logistics", "location_type": "WAREHOUSE"},
    {"id": "default-south-houston", "name": "South Houston Steel Receiving Hub", "location_type": "WAREHOUSE"},
]


async def _query_raw(prisma, sql: str, *params: Any) -> list[dict[str, Any]]:
    rows = await prisma.query_raw(sql, *params)
    return [dict(row) for row in rows]


async def _execute_raw(prisma, sql: str, *params: Any) -> Any:
    return await prisma.execute_raw(sql, *params)


async def _ensure_warehouse_locations_table(prisma) -> None:
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "public"."warehouse_locations" (
          "id" TEXT PRIMARY KEY,
          "name" TEXT NOT NULL,
          "address" TEXT,
          "firms_code" TEXT,
          "partner_org_id" TEXT,
          "inbound_sla_hrs" DOUBLE PRECISION,
          "outbound_sla_hrs" DOUBLE PRECISION,
          "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
          "qc_checklist" JSONB,
          "location_type" TEXT NOT NULL DEFAULT 'WAREHOUSE',
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    for ddl in [
        'ALTER TABLE "public"."warehouse_locations" ADD COLUMN IF NOT EXISTS "address" TEXT',
        'ALTER TABLE "public"."warehouse_locations" ADD COLUMN IF NOT EXISTS "firms_code" TEXT',
        'ALTER TABLE "public"."warehouse_locations" ADD COLUMN IF NOT EXISTS "partner_org_id" TEXT',
        'ALTER TABLE "public"."warehouse_locations" ADD COLUMN IF NOT EXISTS "inbound_sla_hrs" DOUBLE PRECISION',
        'ALTER TABLE "public"."warehouse_locations" ADD COLUMN IF NOT EXISTS "outbound_sla_hrs" DOUBLE PRECISION',
        'ALTER TABLE "public"."warehouse_locations" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE',
        'ALTER TABLE "public"."warehouse_locations" ADD COLUMN IF NOT EXISTS "qc_checklist" JSONB',
        'ALTER TABLE "public"."warehouse_locations" ADD COLUMN IF NOT EXISTS "location_type" TEXT NOT NULL DEFAULT \'WAREHOUSE\'',
        'ALTER TABLE "public"."warehouse_locations" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()',
        'ALTER TABLE "public"."warehouse_locations" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    ]:
        await _execute_raw(prisma, ddl)
    for item in DEFAULT_WAREHOUSE_LOCATIONS:
        await _execute_raw(
            prisma,
            """
            INSERT INTO "public"."warehouse_locations" (
              "id", "name", "is_active", "location_type"
            )
            VALUES ($1, $2, TRUE, $3)
            ON CONFLICT ("id") DO NOTHING
            """,
            item["id"],
            item["name"],
            item["location_type"],
        )


class OutwardDispatchLineRequest(BaseModel):
    warehouseStockId: str
    quantityDispatched: float = Field(gt=0)
    netWeightKg: float | None = None
    packageType: str | None = None
    notes: str | None = None


class CreateOutwardDispatchRequest(BaseModel):
    warehouseId: str | None = None
    destinationName: str = Field(min_length=1)
    destinationAddress: str | None = None
    deliveryDate: str | None = None
    truckNumber: str | None = None
    driverName: str | None = None
    notes: str | None = None
    lines: list[OutwardDispatchLineRequest] = Field(min_length=1)


def _num(value: Any) -> float:
    if isinstance(value, str):
        match = re.search(r"-?\d+(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?", value)
        if match:
            try:
                return float(match.group(0).replace(",", ""))
            except Exception:
                return 0.0
        return 0.0
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _coerce_json(value: Any) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                return value
    return value


def _clean_text(value: Any) -> str:
    text = str(value or "").strip()
    return "" if text in {"-", "\u2014", "\u2013", "\u00e2\u20ac\u201d"} else text


def _format_number(value: Any) -> str:
    numeric = _num(value)
    if numeric == 0:
        return ""
    return str(round(numeric, 3)).rstrip("0").rstrip(".")


def _package_type_text(value: Any) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    text = re.sub(r"^\s*\d+(?:,\d{3})*(?:\.\d+)?\s*", "", text).strip()
    return text or _clean_text(value)


def _match_key(value: Any) -> str:
    return "".join(ch for ch in str(value or "").upper() if ch.isalnum())


def _field_value(
    *,
    key: str,
    label: str,
    value: Any,
    source_doc: str,
    source_field: str,
    source_label: str,
    mapping_type: str,
    validation: str | None = None,
    validation_severity: str | None = None,
    mono: bool = False,
) -> dict[str, Any]:
    return {
        "targetField": key,
        "targetLabel": label,
        "value": value,
        "sourceDoc": source_doc,
        "sourceDocumentId": None,
        "sourceField": source_field,
        "sourceLabel": source_label,
        "mappingType": mapping_type,
        "validation": validation,
        "validationSeverity": validation_severity,
        "validationStatus": "valid" if _clean_text(value) else ("manual_required" if validation == "NOT NULL" else "missing"),
        "mono": mono,
    }


async def _warehouse_location_by_id(prisma, warehouse_id: str | None) -> dict[str, Any] | None:
    if not warehouse_id or warehouse_id == ALL_WAREHOUSE_ID:
        return None
    await _ensure_warehouse_locations_table(prisma)
    rows = await _query_raw(
        prisma,
        """
        SELECT "id", "name", "address", "firms_code", "location_type"
        FROM "public"."warehouse_locations"
        WHERE "id" = $1 AND "is_active" = TRUE
        """,
        warehouse_id,
    )
    if not rows:
        return None
    row = rows[0]
    return {
        "id": str(row.get("id") or ""),
        "name": row.get("name") or "",
        "address": row.get("address"),
        "firmsCode": row.get("firms_code"),
        "locationType": row.get("location_type") or "WAREHOUSE",
    }


def _stock_row(row: dict[str, Any]) -> dict[str, Any]:
    qty = _num(row.get("quantity_on_hand"))
    reserved = _num(row.get("reserved_quantity"))
    available = max(0, qty - reserved)
    return {
        "id": str(row.get("id") or row.get("product_code") or ""),
        "productCode": row.get("product_code") or "UNSPECIFIED",
        "description": row.get("description"),
        "hsCode": row.get("hs_code"),
        "quantityOnHand": qty,
        "physicalQuantityOnHand": qty,
        "reservedQuantity": reserved,
        "availableQuantity": available,
        "netWeightKg": _num(row.get("net_weight_kg")),
        "grossWeightKg": _num(row.get("gross_weight_kg")),
        "originShipmentId": str(row["origin_shipment_id"]) if row.get("origin_shipment_id") else None,
        "originGrnId": row.get("origin_grn_id"),
        "receivedAt": _iso(row.get("received_at")),
        "lastMovedAt": _iso(row.get("last_moved_at")),
        "warehouse": {"id": ALL_WAREHOUSE_ID, "name": "All warehouses"},
    }


def _sku_summary_row(row: dict[str, Any]) -> dict[str, Any]:
    qty = _num(row.get("total_quantity_on_hand"))
    reserved = _num(row.get("total_reserved_quantity"))
    available = max(0, qty - reserved)
    return {
        "productCode": row.get("product_code") or "UNSPECIFIED",
        "description": row.get("description"),
        "hsCode": row.get("hs_code"),
        "totalQuantityOnHand": qty,
        "totalPhysicalQuantityOnHand": qty,
        "totalReservedQuantity": reserved,
        "availableQuantity": available,
        "totalNetWeightKg": _num(row.get("total_net_weight_kg")),
        "totalGrossWeightKg": _num(row.get("total_gross_weight_kg")),
        "warehouseCount": 1,
        "shipmentCount": int(row.get("shipment_count") or 0),
        "dataSource": "packing_list",
    }


def _outward_record_from_draft(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("rendered_payload")
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = {}
    payload = payload if isinstance(payload, dict) else {}
    dispatch = payload.get("outwardDispatch") if isinstance(payload.get("outwardDispatch"), dict) else {}
    warehouse = dispatch.get("warehouse") if isinstance(dispatch.get("warehouse"), dict) else None
    lines = payload.get("lineItems") if isinstance(payload.get("lineItems"), list) else []
    return {
        "id": str(row.get("id")),
        "status": row.get("status") or "DRAFT",
        "destinationName": dispatch.get("destinationName"),
        "destinationAddress": dispatch.get("destinationAddress"),
        "truckNumber": dispatch.get("truckNumber"),
        "driverName": dispatch.get("driverName"),
        "notes": dispatch.get("notes"),
        "warehouse": warehouse,
        "createdAt": _iso(row.get("created_at")),
        "updatedAt": _iso(row.get("updated_at")),
        "dispatchedAt": _iso(row.get("updated_at")) if row.get("status") in {"CONFIRMED", "GENERATED"} else None,
        "documentId": None,
        "draftPayload": payload,
        "lines": [
            {
                "id": str(item.get("warehouseStockId") or item.get("lineNo") or index),
                "quantityDispatched": _num(item.get("quantityDispatched") or item.get("totalQtyInPcs")),
                "netWeightKg": _num(item.get("netWeightKg") or item.get("netWeightKgs")),
                "warehouseStock": {
                    "id": item.get("warehouseStockId"),
                    "productCode": item.get("productCode"),
                    "description": item.get("productDesc") or item.get("description"),
                },
            }
            for index, item in enumerate(lines)
            if isinstance(item, dict)
        ],
    }


async def _hydrate_outward_payload_warehouse(prisma, payload: dict[str, Any]) -> dict[str, Any]:
    dispatch = payload.get("outwardDispatch") if isinstance(payload.get("outwardDispatch"), dict) else {}
    if not dispatch:
        return payload

    warehouse = dispatch.get("warehouse") if isinstance(dispatch.get("warehouse"), dict) else None
    warehouse_id = (
        str(dispatch.get("warehouseId") or "").strip()
        or str((payload.get("sourceDocumentIds") or {}).get("WAREHOUSE_STOCK") or "").strip()
    )
    if warehouse or not warehouse_id or warehouse_id == ALL_WAREHOUSE_ID:
        return payload

    selected_warehouse = await _warehouse_location_by_id(prisma, warehouse_id)
    if not selected_warehouse:
        return payload

    hydrated = dict(payload)
    hydrated_dispatch = dict(dispatch)
    hydrated_dispatch["warehouse"] = selected_warehouse
    hydrated["outwardDispatch"] = hydrated_dispatch

    sections = hydrated.get("sections") if isinstance(hydrated.get("sections"), list) else []
    for section in sections:
        fields = section.get("fields") if isinstance(section, dict) and isinstance(section.get("fields"), list) else []
        for field in fields:
            if not isinstance(field, dict):
                continue
            target = field.get("targetField")
            if target in {"warehouseName", "shipperName", "threePlName"} and not _clean_text(field.get("value")):
                field["value"] = selected_warehouse.get("name")
            if target in {"warehouseAddress", "shipperAddress", "threePlAddress"} and not _clean_text(field.get("value")):
                field["value"] = selected_warehouse.get("address")

    return hydrated


def _set_outward_payload_field(payload: dict[str, Any], target_field: str, value: Any) -> bool:
    sections = payload.get("sections") if isinstance(payload.get("sections"), list) else []
    for section in sections:
        fields = section.get("fields") if isinstance(section, dict) and isinstance(section.get("fields"), list) else []
        for field in fields:
            if isinstance(field, dict) and field.get("targetField") == target_field:
                field["value"] = value
                field["validationStatus"] = "valid" if _clean_text(value) else field.get("validationStatus", "missing")
                return True
    return False


def _append_outward_payload_field(
    payload: dict[str, Any],
    *,
    section_label: str,
    field: dict[str, Any],
) -> None:
    sections = payload.get("sections") if isinstance(payload.get("sections"), list) else []
    if not isinstance(payload.get("sections"), list):
        payload["sections"] = sections
    target_section = None
    for section in sections:
        if isinstance(section, dict) and section.get("sectionLabel") == section_label:
            target_section = section
            break
    if target_section is None:
        target_section = {"sectionLabel": section_label, "fields": []}
        sections.append(target_section)
    fields = target_section.get("fields") if isinstance(target_section.get("fields"), list) else []
    target_section["fields"] = fields
    fields.append(field)


async def _bol_context_rows_for_outward_lines(prisma, line_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    origin_shipment_ids = sorted({
        str(item.get("originShipmentId"))
        for item in line_items
        if item.get("originShipmentId")
    })
    selected_container_numbers = sorted({
        str(item.get("containerNo")).strip()
        for item in line_items
        if str(item.get("containerNo") or "").strip()
    })
    if not origin_shipment_ids and not selected_container_numbers:
        return []
    return await _query_raw(
        prisma,
        """
        SELECT
          COALESCE(s."id"::text, d."shipment_id"::text, '') AS shipment_id,
          COALESCE(NULLIF(s."project_name", ''), NULLIF(bol."project_name", '')) AS project_name,
          COALESCE(NULLIF(s."bol_number", ''), NULLIF(bol."bol_number", ''), NULLIF(bol."mbl_number", ''), NULLIF(s."mbl_number", ''), NULLIF(s."booking_number", '')) AS bol_number,
          COALESCE(
            NULLIF(bol."country_of_origin", ''),
            NULLIF(bol."raw_data"->>'countryOfOrigin', ''),
            NULLIF(bol."raw_data"->>'country_of_origin', ''),
            NULLIF(bol."raw_data"#>>'{route,countryOfOrigin}', ''),
            NULLIF(bol."raw_data"#>>'{route,country_of_origin}', '')
          ) AS country_of_origin,
          NULLIF(bol."package_summary", '') AS package_summary,
          NULLIF(bol."total_packages", '') AS total_packages,
          NULLIF(bol."gross_weight", '') AS bol_gross_weight,
          NULLIF(bol."net_weight", '') AS bol_net_weight,
          NULLIF(bc."number", '') AS container_no,
          NULLIF(bc."packages", '') AS container_packages,
          NULLIF(bc."gross_weight_kg", '') AS container_gross_weight_kg,
          NULLIF(bc."net_weight_kg", '') AS container_net_weight_kg,
          NULLIF(gdi."product_code", '') AS product_code,
          NULLIF(gdi."product_description", '') AS product_description,
          NULLIF(gdi."product_specification", '') AS product_specification,
          d."updated_at" AS document_updated_at
        FROM "aiextraction"."bills_of_lading" bol
        JOIN "public"."documents" d ON d."id" = bol."document_id"
        LEFT JOIN "public"."shipments" s ON s."id" = d."shipment_id"
        LEFT JOIN "aiextraction"."bill_of_lading_containers" bc ON bc."bill_of_lading_id" = bol."id"
        LEFT JOIN "aiextraction"."bill_of_lading_goods_description_items" gdi ON gdi."bill_of_lading_id" = bol."id"
        WHERE (
            COALESCE(s."id"::text, d."shipment_id"::text, '') = ANY($1::text[])
            OR NULLIF(bc."number", '') = ANY($2::text[])
          )
          AND COALESCE(d."is_deleted", FALSE) = FALSE
        ORDER BY d."updated_at" DESC
        """,
        origin_shipment_ids,
        selected_container_numbers,
    )


async def _stock_rows_for_outward_line_ids(prisma, stock_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not stock_ids:
        return {}
    rows = await _query_raw(
        prisma,
        """
        WITH persisted_lines AS (
          SELECT
            pli.id::text AS id,
            COALESCE(NULLIF(TRIM(pli.product_code), ''), 'UNSPECIFIED') AS product_code,
            NULLIF(TRIM(pli.product_description), '') AS description,
            NULLIF(TRIM(pli.hsn_code), '') AS hs_code,
            COALESCE(pli.total_qty_in_pcs, pli.no_of_bundles, '0') AS quantity_text,
            COALESCE(pli.net_weight_kgs, '0') AS net_weight_text,
            COALESCE(pli.gross_weight_kgs, '0') AS gross_weight_text,
            pli.no_of_bundles AS bundles_text,
            pli.kind_of_pkg AS package_type,
            pli.container_no AS container_no,
            d.shipment_id::text AS origin_shipment_id
          FROM aiextraction.packing_list_line_items pli
          JOIN aiextraction.packing_list_extractions pl ON pl.id = pli.packing_list_id
          JOIN public.documents d ON d.id = pl.document_id
          WHERE pli.id::text = ANY($1::text[])
        ),
        requested_raw_lines AS (
          SELECT
            requested.id,
            regexp_replace(requested.id, '-raw-[0-9]+$', '') AS document_id,
            substring(requested.id from '-raw-([0-9]+)$')::int AS ordinality
          FROM unnest($1::text[]) AS requested(id)
          WHERE requested.id ~ '-raw-[0-9]+$'
        ),
        raw_lines AS (
          SELECT
            requested.id,
            COALESCE(
              raw_line.item->>'productCode',
              raw_line.item->>'product_code',
              raw_line.item->>'itemCode',
              raw_line.item->>'item_code',
              raw_line.item->>'materialCode',
              raw_line.item->>'material_code',
              'UNSPECIFIED'
            ) AS product_code,
            COALESCE(
              raw_line.item->>'productDescription',
              raw_line.item->>'product_description',
              raw_line.item->>'productDesc',
              raw_line.item->>'product_desc',
              raw_line.item->>'description',
              raw_line.item->>'lineDescription',
              raw_line.item->>'line_description'
            ) AS description,
            COALESCE(
              raw_line.item->>'hsnCode',
              raw_line.item->>'hsn_code',
              raw_line.item->>'hsCode',
              raw_line.item->>'hs_code',
              raw_line.item->>'hsCodeNo',
              raw_line.item->>'hs_code_no'
            ) AS hs_code,
            COALESCE(
              raw_line.item->>'totalQtyInPcs',
              raw_line.item->>'total_qty_in_pcs',
              raw_line.item->>'quantity',
              raw_line.item->>'quantityTotal',
              raw_line.item->>'quantity_total',
              raw_line.item->>'qty',
              raw_line.item->>'noOfBundles',
              raw_line.item->>'no_of_bundles',
              raw_line.item->>'noOfPackages',
              raw_line.item->>'no_of_packages',
              '0'
            ) AS quantity_text,
            COALESCE(
              raw_line.item->>'netWeightKgs',
              raw_line.item->>'net_weight_kgs',
              raw_line.item->>'netWeightKg',
              raw_line.item->>'net_weight_kg',
              raw_line.item->>'netWeight',
              raw_line.item->>'net_weight',
              raw_line.item->>'net_weight_total',
              '0'
            ) AS net_weight_text,
            COALESCE(
              raw_line.item->>'grossWeightKgs',
              raw_line.item->>'gross_weight_kgs',
              raw_line.item->>'grossWeightKg',
              raw_line.item->>'gross_weight_kg',
              raw_line.item->>'grossWeight',
              raw_line.item->>'gross_weight',
              raw_line.item->>'gross_weight_total',
              '0'
            ) AS gross_weight_text,
            COALESCE(
              raw_line.item->>'noOfBundles',
              raw_line.item->>'no_of_bundles',
              raw_line.item->>'bundles',
              ''
            ) AS bundles_text,
            COALESCE(
              raw_line.item->>'kindOfPkg',
              raw_line.item->>'kind_of_pkg',
              raw_line.item->>'packageType',
              raw_line.item->>'package_type',
              raw_line.item->>'packageDescription',
              raw_line.item->>'package_description',
              ''
            ) AS package_type,
            COALESCE(
              raw_line.item->>'containerNo',
              raw_line.item->>'container_no',
              raw_line.item->>'containerNumber',
              raw_line.item->>'container_number',
              ''
            ) AS container_no,
            d.shipment_id::text AS origin_shipment_id
          FROM requested_raw_lines requested
          JOIN aiextraction.packing_list_extractions pl ON pl.document_id::text = requested.document_id
          JOIN public.documents d ON d.id = pl.document_id
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(COALESCE(pl.raw_data, '{}'::jsonb)->'lineItems') = 'array'
                THEN COALESCE(pl.raw_data, '{}'::jsonb)->'lineItems'
              WHEN jsonb_typeof(COALESCE(pl.raw_data, '{}'::jsonb)->'line_items') = 'array'
                THEN COALESCE(pl.raw_data, '{}'::jsonb)->'line_items'
              WHEN jsonb_typeof(COALESCE(pl.raw_data, '{}'::jsonb)->'items') = 'array'
                THEN COALESCE(pl.raw_data, '{}'::jsonb)->'items'
              WHEN jsonb_typeof(COALESCE(pl.raw_data, '{}'::jsonb)->'packingList'->'lineItems') = 'array'
                THEN COALESCE(pl.raw_data, '{}'::jsonb)->'packingList'->'lineItems'
              WHEN jsonb_typeof(COALESCE(pl.raw_data, '{}'::jsonb)->'packingListExtraction'->'lineItems') = 'array'
                THEN COALESCE(pl.raw_data, '{}'::jsonb)->'packingListExtraction'->'lineItems'
              ELSE '[]'::jsonb
            END
          ) WITH ORDINALITY AS raw_line(item, ordinality)
          WHERE raw_line.ordinality = requested.ordinality
        ),
        generated_lines AS (
          SELECT
            dl.id::text AS id,
            COALESCE(dl.payload->>'productCode', dl.payload->>'product_code', dl.payload->>'itemCode', dl.payload->>'item_code', 'UNSPECIFIED') AS product_code,
            COALESCE(dl.payload->>'productDescription', dl.payload->>'product_description', dl.payload->>'productDesc', dl.payload->>'product_desc', dl.payload->>'description') AS description,
            COALESCE(dl.payload->>'hsnCode', dl.payload->>'hsn_code', dl.payload->>'hsCode', dl.payload->>'hs_code') AS hs_code,
            COALESCE(dl.payload->>'totalQtyInPcs', dl.payload->>'total_qty_in_pcs', dl.payload->>'quantity', dl.payload->>'qty', '0') AS quantity_text,
            COALESCE(dl.payload->>'netWeightKgs', dl.payload->>'net_weight_kgs', dl.payload->>'netWeightKg', dl.payload->>'net_weight_kg', dl.payload->>'netWeight', '0') AS net_weight_text,
            COALESCE(dl.payload->>'grossWeightKgs', dl.payload->>'gross_weight_kgs', dl.payload->>'grossWeightKg', dl.payload->>'gross_weight_kg', dl.payload->>'grossWeight', '0') AS gross_weight_text,
            COALESCE(dl.payload->>'noOfBundles', dl.payload->>'no_of_bundles', dl.payload->>'bundles') AS bundles_text,
            COALESCE(dl.payload->>'kindOfPkg', dl.payload->>'kind_of_pkg', dl.payload->>'packageType', dl.payload->>'package_type') AS package_type,
            COALESCE(dl.payload->>'containerNo', dl.payload->>'container_no', dl.payload->>'containerNumber', dl.payload->>'container_number') AS container_no,
            d.shipment_id::text AS origin_shipment_id
          FROM docgen.draft_line_items dl
          JOIN docgen.drafts dr ON dr.id = dl.draft_id
          JOIN LATERAL jsonb_each_text(COALESCE(dr.source_document_ids, '{}'::jsonb)) source_doc(key, value) ON true
          JOIN public.documents d ON d.id::text = source_doc.value
          WHERE dl.id::text = ANY($1::text[])
        ),
        stock_lines AS (
          SELECT * FROM persisted_lines
          UNION ALL
          SELECT * FROM raw_lines
          UNION ALL
          SELECT * FROM generated_lines
        )
        SELECT
          id,
          product_code,
          description,
          hs_code,
          CASE
            WHEN regexp_replace(COALESCE(quantity_text, '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN regexp_replace(COALESCE(quantity_text, '0'), '[^0-9.-]', '', 'g')::numeric
            ELSE 0
          END AS quantity_on_hand,
          CASE
            WHEN regexp_replace(COALESCE(net_weight_text, '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN regexp_replace(COALESCE(net_weight_text, '0'), '[^0-9.-]', '', 'g')::numeric
            ELSE 0
          END AS net_weight_kg,
          CASE
            WHEN regexp_replace(COALESCE(gross_weight_text, '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN regexp_replace(COALESCE(gross_weight_text, '0'), '[^0-9.-]', '', 'g')::numeric
            ELSE 0
          END AS gross_weight_kg,
          NULLIF(TRIM(bundles_text), '') AS no_of_bundles,
          NULLIF(TRIM(package_type), '') AS package_type,
          NULLIF(TRIM(container_no), '') AS container_no,
          origin_shipment_id
        FROM stock_lines
        """,
        stock_ids,
    )
    return {str(row.get("id")): row for row in rows if row.get("id")}


def _best_bol_context_for_line(line_item: dict[str, Any], context_rows: list[dict[str, Any]]) -> dict[str, Any]:
    shipment_id = str(line_item.get("originShipmentId") or "")
    container_key = _match_key(line_item.get("containerNo"))
    product_key = _match_key(line_item.get("productCode"))
    description_key = _match_key(line_item.get("productDesc") or line_item.get("description"))
    best_row: dict[str, Any] = {}
    best_score = -1
    for context_row in context_rows:
        context_container_key = _match_key(context_row.get("container_no"))
        context_product_key = _match_key(context_row.get("product_code"))
        context_description_key = _match_key(context_row.get("product_description"))
        context_shipment_id = str(context_row.get("shipment_id") or "")
        same_container = bool(container_key and context_container_key and container_key == context_container_key)
        same_product = bool(product_key and (product_key == context_product_key or (context_description_key and product_key in context_description_key)))
        same_description = bool(description_key and context_description_key and description_key in context_description_key)
        same_shipment = bool(shipment_id and shipment_id == context_shipment_id)
        score = 0
        if same_container:
            score += 100
        if same_product:
            score += 50
        if same_description:
            score += 25
        if same_shipment:
            score += 10
        if score > best_score:
            best_score = score
            best_row = context_row
    return best_row if best_score > 0 else {}


async def _refresh_existing_outward_payload(prisma, payload: dict[str, Any]) -> dict[str, Any]:
    refreshed = await _hydrate_outward_payload_warehouse(prisma, payload)
    dispatch = refreshed.get("outwardDispatch") if isinstance(refreshed.get("outwardDispatch"), dict) else {}
    warehouse = dispatch.get("warehouse") if isinstance(dispatch.get("warehouse"), dict) else {}
    line_items = refreshed.get("lineItems") if isinstance(refreshed.get("lineItems"), list) else []
    line_items = [dict(item) for item in line_items if isinstance(item, dict)]
    stock_ids = [
        str(item.get("warehouseStockId"))
        for item in line_items
        if str(item.get("warehouseStockId") or "").strip()
    ]
    stock_rows_by_id = await _stock_rows_for_outward_line_ids(prisma, stock_ids)
    for line_item in line_items:
        stock_row = stock_rows_by_id.get(str(line_item.get("warehouseStockId") or ""))
        if not stock_row:
            continue
        line_item["originShipmentId"] = _clean_text(line_item.get("originShipmentId")) or stock_row.get("origin_shipment_id")
        line_item["containerNo"] = _clean_text(line_item.get("containerNo")) or stock_row.get("container_no")
        line_item["productCode"] = _clean_text(line_item.get("productCode")) or stock_row.get("product_code")
        line_item["productDesc"] = _clean_text(line_item.get("productDesc")) or stock_row.get("description")
        line_item["description"] = _clean_text(line_item.get("description")) or stock_row.get("description")
        line_item["packageType"] = _clean_text(line_item.get("packageType")) or stock_row.get("package_type")
        line_item["noOfBundles"] = _clean_text(line_item.get("noOfBundles")) or stock_row.get("no_of_bundles")
    context_rows = await _bol_context_rows_for_outward_lines(prisma, line_items)

    first_context: dict[str, Any] = {}
    for line_item in line_items:
        context = _best_bol_context_for_line(line_item, context_rows)
        if context and not first_context:
            first_context = context
        if not context:
            continue
        bol_description = _clean_text(context.get("product_description") or context.get("product_specification"))
        bol_package_type = _package_type_text(context.get("package_summary") or line_item.get("packageType"))
        bol_bundles = _clean_text(context.get("container_packages") or context.get("total_packages") or line_item.get("noOfBundles"))
        bol_net_weight = _clean_text(context.get("container_net_weight_kg") or context.get("bol_net_weight") or line_item.get("netWeightKgs"))
        bol_gross_weight = _clean_text(context.get("container_gross_weight_kg") or context.get("bol_gross_weight") or line_item.get("grossWeightKgs"))
        line_item.update({
            "productCode": _clean_text(context.get("product_code")) or line_item.get("productCode"),
            "productDesc": bol_description or line_item.get("productDesc"),
            "description": bol_description or line_item.get("description"),
            "containerNo": _clean_text(context.get("container_no")) or line_item.get("containerNo"),
            "bolNumber": context.get("bol_number"),
            "countryOfOrigin": context.get("country_of_origin"),
            "packageType": bol_package_type,
            "kindOfPkg": bol_package_type,
            "noOfBundles": bol_bundles,
            "netWeightKgs": bol_net_weight,
            "netWeightKg": _num(bol_net_weight),
            "grossWeightKgs": bol_gross_weight,
            "grossWeightKg": _num(bol_gross_weight),
        })

    refreshed["lineItems"] = line_items
    total_qty = sum(_num(item.get("quantityDispatched") or item.get("totalQtyInPcs")) for item in line_items)
    total_net = sum(_num(item.get("netWeightKg") or item.get("netWeightKgs")) for item in line_items)
    total_gross = sum(_num(item.get("grossWeightKg") or item.get("grossWeightKgs")) for item in line_items)
    total_bundles = sum(_num(item.get("noOfBundles")) for item in line_items)
    field_updates = {
        "shipperName": warehouse.get("name") or "",
        "shipperAddress": warehouse.get("address") or "",
        "warehouseName": warehouse.get("name") or "",
        "warehouseAddress": warehouse.get("address") or "",
        "consigneeName": "Unimatics",
        "consigneeAddress": "Unimatics Manufacturing Mx,LLC\n14600 Arville Street\nSloan, NV 89054\nUSA",
        "shipTo": dispatch.get("destinationName") or "",
        "shipToAddress": dispatch.get("destinationAddress") or "",
        "projectName": first_context.get("project_name") or "",
        "additionalDetails": first_context.get("bol_number") or "",
        "bolRef": first_context.get("bol_number") or "",
        "countryOfOrigin": first_context.get("country_of_origin") or "",
        "totalQty": _format_number(total_qty),
        "totalBundles": _format_number(total_bundles),
        "totalNetWeightKgs": _format_number(total_net),
        "totalGrossWeightKgs": _format_number(total_gross),
    }
    field_definitions = {
        "shipperName": ("Parties", "Shipper", "WAREHOUSE", "warehouse.name", "Selected warehouse", "direct"),
        "shipperAddress": ("Parties", "Shipper Address", "WAREHOUSE", "warehouse.address", "Selected warehouse address", "direct"),
        "warehouseName": ("Parties", "Warehouse", "WAREHOUSE", "warehouse.name", "Selected warehouse", "direct"),
        "warehouseAddress": ("Parties", "Warehouse Address", "WAREHOUSE", "warehouse.address", "Selected warehouse address", "direct"),
        "consigneeName": ("Parties", "Consignee", "STATIC", "static", "Unimatics", "direct"),
        "consigneeAddress": ("Parties", "Consignee Address", "STATIC", "static", "Unimatics address", "direct"),
        "shipTo": ("Parties", "Ship To", "WAREHOUSE_DISPATCH", "destinationName", "User input", "manual"),
        "shipToAddress": ("Parties", "Ship To Address", "WAREHOUSE_DISPATCH", "destinationAddress", "User input", "manual"),
        "projectName": ("Additional Details", "Project Name", "SHIPMENT", "project_name", "Project name", "direct"),
        "additionalDetails": ("Additional Details", "Additional Details", "BILL_OF_LADING", "bol_number", "BOL No", "direct"),
        "bolRef": ("Additional Details", "BOL No", "BILL_OF_LADING", "bol_number", "BOL No", "direct"),
        "countryOfOrigin": ("Additional Details", "Country of Origin", "BILL_OF_LADING", "country_of_origin", "BOL", "direct"),
        "totalQty": ("Totals", "Total Qty Pieces", "CALCULATED", "SUM(lineItems.quantityDispatched)", "Line totals", "derived"),
        "totalBundles": ("Totals", "Total Bundles", "CALCULATED", "SUM(lineItems.noOfBundles)", "Line totals", "derived"),
        "totalNetWeightKgs": ("Totals", "Total Net Weight", "CALCULATED", "SUM(lineItems.netWeightKgs)", "Line totals", "derived"),
        "totalGrossWeightKgs": ("Totals", "Total Gross Weight", "CALCULATED", "SUM(lineItems.grossWeightKgs)", "Line totals", "derived"),
    }
    for key, value in field_updates.items():
        if not _clean_text(value) and key not in {
            "consigneeName",
            "consigneeAddress",
            "totalQty",
            "totalBundles",
            "totalNetWeightKgs",
            "totalGrossWeightKgs",
        }:
            continue
        if _set_outward_payload_field(refreshed, key, value):
            continue
        definition = field_definitions.get(key)
        if not definition:
            continue
        section_label, target_label, source_doc, source_field, source_label, mapping_type = definition
        _append_outward_payload_field(
            refreshed,
            section_label=section_label,
            field=_field_value(
                key=key,
                label=target_label,
                value=value,
                source_doc=source_doc,
                source_field=source_field,
                source_label=source_label,
                mapping_type=mapping_type,
                mono=key in {"additionalDetails", "bolRef", "totalQty", "totalBundles", "totalNetWeightKgs", "totalGrossWeightKgs"},
            ),
        )
    return refreshed


OUTWARD_RESERVED_STATUSES = ("DRAFT", "IN_REVIEW")
OUTWARD_DISPATCHED_STATUSES = ("CONFIRMED", "GENERATED", "DISPATCHED", "APPROVED")


async def _outward_quantities_by_status(prisma, statuses: tuple[str, ...]) -> dict[str, float]:
    status_literals = ", ".join(f"'{status}'" for status in statuses)
    rows = await _query_raw(
        prisma,
        f"""
        SELECT rendered_payload
        FROM docgen.drafts
        WHERE generated_doc_type = 'US_PACKING_LIST'
          AND status::text IN ({status_literals})
        """
    )
    quantities: dict[str, float] = {}
    for row in rows:
        payload = row.get("rendered_payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                continue
        if not isinstance(payload, dict) or not isinstance(payload.get("outwardDispatch"), dict):
            continue
        line_items = payload.get("lineItems") if isinstance(payload.get("lineItems"), list) else []
        for item in line_items:
            if not isinstance(item, dict):
                continue
            stock_id = str(item.get("warehouseStockId") or "").strip()
            if not stock_id:
                continue
            quantities[stock_id] = quantities.get(stock_id, 0.0) + _num(item.get("quantityDispatched") or item.get("totalQtyInPcs"))
    return quantities


def _apply_outward_movements(
    rows: list[dict[str, Any]],
    *,
    reserved_by_stock_id: dict[str, float],
    dispatched_by_stock_id: dict[str, float],
) -> list[dict[str, Any]]:
    adjusted: list[dict[str, Any]] = []
    for row in rows:
        next_row = dict(row)
        dispatched = dispatched_by_stock_id.get(str(next_row.get("id")), 0.0)
        next_row["quantity_on_hand"] = max(0.0, _num(next_row.get("quantity_on_hand")) - dispatched)
        reserved = _num(next_row.get("reserved_quantity")) + reserved_by_stock_id.get(str(next_row.get("id")), 0.0)
        next_row["reserved_quantity"] = min(reserved, _num(next_row.get("quantity_on_hand")))
        adjusted.append(next_row)
    return adjusted


async def _apply_outward_reservations_safe(prisma, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    try:
        reserved_by_stock_id = await _outward_quantities_by_status(prisma, OUTWARD_RESERVED_STATUSES)
        dispatched_by_stock_id = await _outward_quantities_by_status(prisma, OUTWARD_DISPATCHED_STATUSES)
        return _apply_outward_movements(
            rows,
            reserved_by_stock_id=reserved_by_stock_id,
            dispatched_by_stock_id=dispatched_by_stock_id,
        )
    except Exception as exc:
        print(f"Failed to apply outward stock movements: {exc}")
        return rows


def _outward_draft_payload(
    *,
    draft_id: str,
    request: CreateOutwardDispatchRequest,
    selected_rows: list[dict[str, Any]],
    selected_warehouse: dict[str, Any] | None,
    origin_context_by_shipment: dict[str, dict[str, Any]] | None = None,
    origin_context_by_stock_id: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    line_items: list[dict[str, Any]] = []
    stock_by_id = {str(row["id"]): row for row in selected_rows}
    origin_context_by_shipment = origin_context_by_shipment or {}
    origin_context_by_stock_id = origin_context_by_stock_id or {}
    first_stock_id = str(request.lines[0].warehouseStockId) if request.lines else ""
    first_origin_shipment_id = next(
        (
            str(row.get("origin_shipment_id"))
            for row in selected_rows
            if row.get("origin_shipment_id")
        ),
        "",
    )
    first_container_no = next(
        (
            _clean_text(row.get("container_no"))
            for row in selected_rows
            if _clean_text(row.get("container_no"))
        ),
        "",
    )
    origin_context = (
        origin_context_by_stock_id.get(first_stock_id)
        or origin_context_by_shipment.get(first_origin_shipment_id)
        or origin_context_by_shipment.get(f"container:{first_container_no}")
        or next(iter(origin_context_by_shipment.values()), {})
    )
    warehouse_name = selected_warehouse.get("name") if selected_warehouse else ""
    warehouse_address = selected_warehouse.get("address") if selected_warehouse else ""
    static_consignee_name = "Unimatics"
    static_consignee_address = "Unimatics Manufacturing Mx,LLC\n14600 Arville Street\nSloan, NV 89054\nUSA"
    for index, line in enumerate(request.lines, start=1):
        row = stock_by_id[line.warehouseStockId]
        line_context = origin_context_by_stock_id.get(line.warehouseStockId, {})
        qty = float(line.quantityDispatched)
        on_hand = _num(row.get("quantity_on_hand"))
        net_total = line.netWeightKg
        if net_total is None and on_hand > 0:
            net_total = round((_num(row.get("net_weight_kg")) / on_hand) * qty, 2)
        gross_total = None
        if on_hand > 0:
            gross_total = round((_num(row.get("gross_weight_kg")) / on_hand) * qty, 2)
        bundles = _clean_text(row.get("no_of_bundles") or row.get("bundles"))
        package_type = _clean_text(line.packageType or row.get("package_type") or row.get("kind_of_pkg"))
        bol_product_code = _clean_text(line_context.get("product_code"))
        bol_description = _clean_text(
            line_context.get("product_description")
            or line_context.get("product_specification")
        )
        bol_container_no = _clean_text(line_context.get("container_no"))
        bol_package_type = _package_type_text(
            line.packageType
            or line_context.get("package_summary")
            or row.get("package_type")
            or row.get("kind_of_pkg")
        )
        bol_bundles = _clean_text(
            line_context.get("container_packages")
            or line_context.get("total_packages")
            or bundles
        )
        bol_net_weight = _clean_text(
            line_context.get("container_net_weight_kg")
            or line_context.get("bol_net_weight")
        )
        bol_gross_weight = _clean_text(
            line_context.get("container_gross_weight_kg")
            or line_context.get("bol_gross_weight")
        )
        line_items.append(
            {
                "lineNo": index,
                "warehouseStockId": line.warehouseStockId,
                "originShipmentId": str(row.get("origin_shipment_id")) if row.get("origin_shipment_id") else None,
                "fifoAllocated": True,
                "hsnCode": row.get("hs_code"),
                "productCode": bol_product_code or row.get("product_code"),
                "productDesc": bol_description or row.get("description"),
                "description": bol_description or row.get("description"),
                "containerNo": bol_container_no or row.get("container_no"),
                "bolNumber": line_context.get("bol_number"),
                "countryOfOrigin": line_context.get("country_of_origin"),
                "deliveryDate": request.deliveryDate,
                "totalQtyInPcs": str(qty).rstrip("0").rstrip("."),
                "quantityDispatched": qty,
                "packageType": bol_package_type or package_type,
                "kindOfPkg": bol_package_type or package_type,
                "noOfBundles": bol_bundles,
                "grossWeightKgs": bol_gross_weight or _format_number(gross_total),
                "grossWeightKg": _num(bol_gross_weight) or gross_total or 0,
                "netWeightKgs": bol_net_weight or str(net_total or 0),
                "netWeightKg": _num(bol_net_weight) or net_total or 0,
                "notes": line.notes,
            }
        )

    total_qty = sum(_num(item.get("quantityDispatched")) for item in line_items)
    total_net = sum(_num(item.get("netWeightKg")) for item in line_items)
    total_gross = sum(_num(item.get("grossWeightKg") or item.get("grossWeightKgs")) for item in line_items)
    total_bundles = sum(_num(item.get("noOfBundles")) for item in line_items)
    fields = {
        "dispatchNumber": f"OGR-{draft_id[-8:].upper()}",
        "documentDate": now[:10],
        "grnDate": now[:10],
        "shipperName": warehouse_name,
        "shipperAddress": warehouse_address,
        "shipTo": request.destinationName,
        "shipToAddress": request.destinationAddress,
        "consigneeName": static_consignee_name,
        "consigneeAddress": static_consignee_address,
        "projectName": origin_context.get("project_name") or "",
        "additionalDetails": origin_context.get("bol_number") or "",
        "bolRef": origin_context.get("bol_number") or "",
        "countryOfOrigin": origin_context.get("country_of_origin") or "",
        "warehouseName": selected_warehouse.get("name") if selected_warehouse else "",
        "warehouseAddress": selected_warehouse.get("address") if selected_warehouse else "",
        "warehouseCode": selected_warehouse.get("firmsCode") if selected_warehouse else "",
        "threePlName": selected_warehouse.get("name") if selected_warehouse else "",
        "threePlAddress": selected_warehouse.get("address") if selected_warehouse else "",
        "destinationName": request.destinationName,
        "destinationAddress": request.destinationAddress,
        "deliveryDate": request.deliveryDate,
        "truckNumber": request.truckNumber,
        "driverName": request.driverName,
        "dispatchNotes": request.notes,
        "totalLines": str(len(line_items)),
        "totalQty": str(total_qty).rstrip("0").rstrip("."),
        "totalBundles": _format_number(total_bundles),
        "totalNetWeightKgs": str(round(total_net, 2)),
        "totalGrossWeightKgs": _format_number(total_gross),
    }
    sections = [
        {
            "sectionLabel": "Header",
            "fields": [
                _field_value(key="dispatchNumber", label="Outward GRN Number", value=fields["dispatchNumber"], source_doc="CALCULATED", source_field="draft id", source_label="Auto-generated", mapping_type="derived", mono=True),
                _field_value(key="documentDate", label="Document Date", value=fields["documentDate"], source_doc="CALCULATED", source_field="today()", source_label="Current date", mapping_type="derived", mono=True),
            ],
        },
        {
            "sectionLabel": "Parties",
            "fields": [
                _field_value(key="shipperName", label="Shipper", value=fields["shipperName"], source_doc="WAREHOUSE", source_field="warehouse.name", source_label="Selected warehouse", mapping_type="direct"),
                _field_value(key="shipperAddress", label="Shipper Address", value=fields["shipperAddress"], source_doc="WAREHOUSE", source_field="warehouse.address", source_label="Selected warehouse address", mapping_type="direct"),
                _field_value(key="shipTo", label="Ship To", value=fields["shipTo"], source_doc="WAREHOUSE_DISPATCH", source_field="destinationName", source_label="User input", mapping_type="manual", validation="NOT NULL", validation_severity="critical"),
                _field_value(key="shipToAddress", label="Ship To Address", value=fields["shipToAddress"], source_doc="WAREHOUSE_DISPATCH", source_field="destinationAddress", source_label="User input", mapping_type="manual"),
                _field_value(key="consigneeName", label="Consignee", value=fields["consigneeName"], source_doc="STATIC", source_field="static", source_label="Unimatics", mapping_type="direct"),
                _field_value(key="consigneeAddress", label="Consignee Address", value=fields["consigneeAddress"], source_doc="STATIC", source_field="static", source_label="Unimatics address", mapping_type="direct"),
            ],
        },
        {
            "sectionLabel": "Additional Details",
            "fields": [
                _field_value(key="projectName", label="Project Name", value=fields["projectName"], source_doc="SHIPMENT", source_field="project_name", source_label="Project name", mapping_type="direct"),
                _field_value(key="additionalDetails", label="Additional Details", value=fields["additionalDetails"], source_doc="BILL_OF_LADING", source_field="bol_number", source_label="BOL No", mapping_type="direct", mono=True),
                _field_value(key="countryOfOrigin", label="Country of Origin", value=fields["countryOfOrigin"], source_doc="BILL_OF_LADING", source_field="country_of_origin", source_label="BOL", mapping_type="direct"),
                _field_value(key="warehouseCode", label="Warehouse Code", value=fields["warehouseCode"], source_doc="WAREHOUSE", source_field="warehouse.firmsCode", source_label="Selected warehouse", mapping_type="direct", mono=True),
                _field_value(key="deliveryDate", label="Delivery Date", value=fields["deliveryDate"], source_doc="WAREHOUSE_DISPATCH", source_field="deliveryDate", source_label="User input", mapping_type="manual", mono=True),
                _field_value(key="truckNumber", label="Truck / Vehicle No.", value=fields["truckNumber"], source_doc="WAREHOUSE_DISPATCH", source_field="truckNumber", source_label="User input", mapping_type="manual", mono=True),
                _field_value(key="driverName", label="Driver Name", value=fields["driverName"], source_doc="WAREHOUSE_DISPATCH", source_field="driverName", source_label="User input", mapping_type="manual"),
                _field_value(key="dispatchNotes", label="Dispatch Notes", value=fields["dispatchNotes"], source_doc="WAREHOUSE_DISPATCH", source_field="notes", source_label="User input", mapping_type="manual"),
            ],
        },
        {
            "sectionLabel": "Totals",
            "fields": [
                _field_value(key="totalQty", label="Total Qty Pieces", value=fields["totalQty"], source_doc="CALCULATED", source_field="SUM(lineItems.quantityDispatched)", source_label="Line totals", mapping_type="derived", mono=True),
                _field_value(key="totalBundles", label="Total Bundles", value=fields["totalBundles"], source_doc="CALCULATED", source_field="SUM(lineItems.noOfBundles)", source_label="Line totals", mapping_type="derived", mono=True),
                _field_value(key="totalNetWeightKgs", label="Total Net Weight", value=fields["totalNetWeightKgs"], source_doc="CALCULATED", source_field="SUM(lineItems.netWeightKgs)", source_label="Line totals", mapping_type="derived", mono=True),
                _field_value(key="totalGrossWeightKgs", label="Total Gross Weight", value=fields["totalGrossWeightKgs"], source_doc="CALCULATED", source_field="SUM(lineItems.grossWeightKgs)", source_label="Line totals", mapping_type="derived", mono=True),
            ],
        }
    ]
    return {
        "draftId": draft_id,
        "generatedDocType": "US_PACKING_LIST",
        "displayName": "Outward GRN",
        "status": "DRAFT",
        "schemaVersion": 1,
        "sourceDocs": ["WAREHOUSE_STOCK"],
        "sourceDocumentIds": {
            "PACKING_LIST": "WAREHOUSE_STOCK",
            "WAREHOUSE_STOCK": request.warehouseId or ALL_WAREHOUSE_ID,
        },
        "sections": sections,
        "lineItems": line_items,
        "containers": [],
        "stats": {
            "auto": 0,
            "calc": 6,
            "manual": 6,
            "total": len(fields) + len(line_items),
            "valid": sum(1 for value in fields.values() if value),
            "missing": sum(1 for value in fields.values() if not value),
            "manualRequired": 1 if not request.destinationName else 0,
        },
        "outwardDispatch": {
            "destinationName": request.destinationName,
            "destinationAddress": request.destinationAddress,
            "deliveryDate": request.deliveryDate,
            "truckNumber": request.truckNumber,
            "driverName": request.driverName,
            "notes": request.notes,
            "warehouseId": request.warehouseId or ALL_WAREHOUSE_ID,
            "warehouse": selected_warehouse,
        },
        "createdAt": now,
        "updatedAt": now,
    }


def _packing_list_stock_sql(access_where: str, *, aggregate: bool) -> str:
    select = """
      MIN(src.id) AS id,
      COALESCE(NULLIF(TRIM(src.product_code), ''), 'UNSPECIFIED') AS product_code,
      NULLIF(MAX(NULLIF(TRIM(src.description), '')), '') AS description,
      NULLIF(MAX(NULLIF(TRIM(src.hs_code), '')), '') AS hs_code,
      SUM(src.qty) AS quantity_on_hand,
      0::numeric AS reserved_quantity,
      SUM(src.net_weight_kg) AS net_weight_kg,
      SUM(src.gross_weight_kg) AS gross_weight_kg,
      MAX(src.shipment_id)::text AS origin_shipment_id,
      NULL::text AS origin_grn_id,
      MAX(src.received_at) AS received_at,
      MAX(src.last_moved_at) AS last_moved_at,
      COUNT(DISTINCT src.shipment_id) FILTER (WHERE src.shipment_id IS NOT NULL) AS shipment_count
    """


def _approved_packing_list_stock_lines_sql(access_where: str) -> str:
    return f"""
      WITH approved_packing_lists AS (
        SELECT
          pl.id,
          pl.document_id,
          pl.raw_data,
          pl.reviewed_at,
          pl.extracted_at,
          pl.created_at,
          pl.updated_at,
          d.updated_at AS document_updated_at,
          d.shipment_id
        FROM aiextraction.packing_list_extractions pl
        JOIN public.documents d ON d.id = pl.document_id
        WHERE {access_where}
          AND d.doc_type::text = 'PACKING_LIST'
          AND d.status::text IN ('REVIEWED', 'ARCHIVED')
      ),
      persisted_lines AS (
        SELECT
          pli.id::text AS id,
          COALESCE(NULLIF(TRIM(pli.product_code), ''), 'UNSPECIFIED') AS product_code,
          NULLIF(TRIM(pli.product_description), '') AS description,
          NULLIF(TRIM(pli.hsn_code), '') AS hs_code,
          COALESCE(pli.total_qty_in_pcs, pli.no_of_bundles, '0') AS quantity_text,
          COALESCE(pli.net_weight_kgs, '0') AS net_weight_text,
          COALESCE(pli.gross_weight_kgs, '0') AS gross_weight_text,
          pli.no_of_bundles AS bundles_text,
          pli.kind_of_pkg AS package_type,
          pli.container_no AS container_no,
          pl.shipment_id::text AS origin_shipment_id,
          NULL::text AS origin_grn_id,
          COALESCE(pl.reviewed_at, pl.document_updated_at, pl.extracted_at, pl.created_at) AS received_at,
          pl.updated_at AS last_moved_at
        FROM approved_packing_lists pl
        JOIN aiextraction.packing_list_line_items pli ON pli.packing_list_id = pl.id
      ),
      raw_lines AS (
        SELECT
          pl.document_id::text || '-raw-' || raw_line.ordinality::text AS id,
          COALESCE(
            raw_line.item->>'productCode',
            raw_line.item->>'product_code',
            raw_line.item->>'itemCode',
            raw_line.item->>'item_code',
            raw_line.item->>'materialCode',
            raw_line.item->>'material_code',
            'UNSPECIFIED'
          ) AS product_code,
          COALESCE(
            raw_line.item->>'productDescription',
            raw_line.item->>'product_description',
            raw_line.item->>'productDesc',
            raw_line.item->>'product_desc',
            raw_line.item->>'description',
            raw_line.item->>'lineDescription',
            raw_line.item->>'line_description'
          ) AS description,
          COALESCE(
            raw_line.item->>'hsnCode',
            raw_line.item->>'hsn_code',
            raw_line.item->>'hsCode',
            raw_line.item->>'hs_code',
            raw_line.item->>'hsCodeNo',
            raw_line.item->>'hs_code_no'
          ) AS hs_code,
          COALESCE(
            raw_line.item->>'totalQtyInPcs',
            raw_line.item->>'total_qty_in_pcs',
            raw_line.item->>'quantity',
            raw_line.item->>'quantityTotal',
            raw_line.item->>'quantity_total',
            raw_line.item->>'qty',
            raw_line.item->>'noOfBundles',
            raw_line.item->>'no_of_bundles',
            raw_line.item->>'noOfPackages',
            raw_line.item->>'no_of_packages',
            '0'
          ) AS quantity_text,
          COALESCE(
            raw_line.item->>'netWeightKgs',
            raw_line.item->>'net_weight_kgs',
            raw_line.item->>'netWeightKg',
            raw_line.item->>'net_weight_kg',
            raw_line.item->>'netWeight',
            raw_line.item->>'net_weight',
            raw_line.item->>'net_weight_total',
            '0'
          ) AS net_weight_text,
          COALESCE(
            raw_line.item->>'grossWeightKgs',
            raw_line.item->>'gross_weight_kgs',
            raw_line.item->>'grossWeightKg',
            raw_line.item->>'gross_weight_kg',
            raw_line.item->>'grossWeight',
            raw_line.item->>'gross_weight',
            raw_line.item->>'gross_weight_total',
            '0'
          ) AS gross_weight_text,
          COALESCE(
            raw_line.item->>'noOfBundles',
            raw_line.item->>'no_of_bundles',
            raw_line.item->>'bundles',
            ''
          ) AS bundles_text,
          COALESCE(
            raw_line.item->>'kindOfPkg',
            raw_line.item->>'kind_of_pkg',
            raw_line.item->>'packageType',
            raw_line.item->>'package_type',
            raw_line.item->>'packageDescription',
            raw_line.item->>'package_description',
            ''
          ) AS package_type,
          COALESCE(
            raw_line.item->>'containerNo',
            raw_line.item->>'container_no',
            raw_line.item->>'containerNumber',
            raw_line.item->>'container_number',
            ''
          ) AS container_no,
          pl.shipment_id::text AS origin_shipment_id,
          NULL::text AS origin_grn_id,
          COALESCE(pl.reviewed_at, pl.document_updated_at, pl.extracted_at, pl.created_at) AS received_at,
          pl.updated_at AS last_moved_at
        FROM approved_packing_lists pl
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(COALESCE(pl.raw_data, '{{}}'::jsonb)->'lineItems') = 'array'
              THEN COALESCE(pl.raw_data, '{{}}'::jsonb)->'lineItems'
            WHEN jsonb_typeof(COALESCE(pl.raw_data, '{{}}'::jsonb)->'line_items') = 'array'
              THEN COALESCE(pl.raw_data, '{{}}'::jsonb)->'line_items'
            WHEN jsonb_typeof(COALESCE(pl.raw_data, '{{}}'::jsonb)->'items') = 'array'
              THEN COALESCE(pl.raw_data, '{{}}'::jsonb)->'items'
            WHEN jsonb_typeof(COALESCE(pl.raw_data, '{{}}'::jsonb)->'packingList'->'lineItems') = 'array'
              THEN COALESCE(pl.raw_data, '{{}}'::jsonb)->'packingList'->'lineItems'
            WHEN jsonb_typeof(COALESCE(pl.raw_data, '{{}}'::jsonb)->'packingListExtraction'->'lineItems') = 'array'
              THEN COALESCE(pl.raw_data, '{{}}'::jsonb)->'packingListExtraction'->'lineItems'
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS raw_line(item, ordinality)
        WHERE NOT EXISTS (
          SELECT 1
          FROM aiextraction.packing_list_line_items existing
          WHERE existing.packing_list_id = pl.id
        )
      ),
      generated_lines AS (
        SELECT
          dl.id::text AS id,
          COALESCE(
            dl.payload->>'productCode',
            dl.payload->>'product_code',
            dl.payload->>'itemCode',
            dl.payload->>'item_code',
            dl.payload->>'materialCode',
            dl.payload->>'material_code',
            'UNSPECIFIED'
          ) AS product_code,
          COALESCE(
            dl.payload->>'productDescription',
            dl.payload->>'product_description',
            dl.payload->>'productDesc',
            dl.payload->>'product_desc',
            dl.payload->>'description',
            dl.payload->>'lineDescription',
            dl.payload->>'line_description'
          ) AS description,
          COALESCE(
            dl.payload->>'hsnCode',
            dl.payload->>'hsn_code',
            dl.payload->>'hsCode',
            dl.payload->>'hs_code',
            dl.payload->>'hsCodeNo',
            dl.payload->>'hs_code_no'
          ) AS hs_code,
          COALESCE(
            dl.payload->>'totalQtyInPcs',
            dl.payload->>'total_qty_in_pcs',
            dl.payload->>'quantity',
            dl.payload->>'quantityTotal',
            dl.payload->>'quantity_total',
            dl.payload->>'qty',
            dl.payload->>'noOfBundles',
            dl.payload->>'no_of_bundles',
            dl.payload->>'noOfPackages',
            dl.payload->>'no_of_packages',
            '0'
          ) AS quantity_text,
          COALESCE(
            dl.payload->>'netWeightKgs',
            dl.payload->>'net_weight_kgs',
            dl.payload->>'netWeightKg',
            dl.payload->>'net_weight_kg',
            dl.payload->>'netWeight',
            dl.payload->>'net_weight',
            dl.payload->>'net_weight_total',
            '0'
          ) AS net_weight_text,
          COALESCE(
            dl.payload->>'grossWeightKgs',
            dl.payload->>'gross_weight_kgs',
            dl.payload->>'grossWeightKg',
            dl.payload->>'gross_weight_kg',
            dl.payload->>'grossWeight',
            dl.payload->>'gross_weight',
            dl.payload->>'gross_weight_total',
            '0'
          ) AS gross_weight_text,
          COALESCE(
            dl.payload->>'noOfBundles',
            dl.payload->>'no_of_bundles',
            dl.payload->>'bundles',
            ''
          ) AS bundles_text,
          COALESCE(
            dl.payload->>'kindOfPkg',
            dl.payload->>'kind_of_pkg',
            dl.payload->>'packageType',
            dl.payload->>'package_type',
            dl.payload->>'packageDescription',
            dl.payload->>'package_description',
            ''
          ) AS package_type,
          COALESCE(
            dl.payload->>'containerNo',
            dl.payload->>'container_no',
            dl.payload->>'containerNumber',
            dl.payload->>'container_number',
            ''
          ) AS container_no,
          d.shipment_id::text AS origin_shipment_id,
          NULL::text AS origin_grn_id,
          COALESCE(dr.updated_at, dr.created_at) AS received_at,
          dr.updated_at AS last_moved_at
        FROM docgen.draft_line_items dl
        JOIN docgen.drafts dr ON dr.id = dl.draft_id
        JOIN LATERAL jsonb_each_text(COALESCE(dr.source_document_ids, '{{}}'::jsonb)) source_doc(key, value) ON true
        JOIN public.documents d ON d.id::text = source_doc.value
        WHERE dr.generated_doc_type = 'PACKING_LIST'
          AND dr.status = 'GENERATED'
          AND {access_where}
      ),
      stock_lines AS (
        SELECT * FROM persisted_lines
        UNION ALL
        SELECT * FROM raw_lines
        UNION ALL
        SELECT * FROM generated_lines
      )
      SELECT
        id,
        COALESCE(NULLIF(TRIM(product_code), ''), 'UNSPECIFIED') AS product_code,
        NULLIF(TRIM(description), '') AS description,
        NULLIF(TRIM(hs_code), '') AS hs_code,
        CASE
          WHEN regexp_replace(COALESCE(quantity_text, '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN regexp_replace(COALESCE(quantity_text, '0'), '[^0-9.-]', '', 'g')::numeric
          ELSE 0
        END AS quantity_on_hand,
        0::numeric AS reserved_quantity,
        CASE
          WHEN regexp_replace(COALESCE(net_weight_text, '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN regexp_replace(COALESCE(net_weight_text, '0'), '[^0-9.-]', '', 'g')::numeric
          ELSE 0
        END AS net_weight_kg,
        CASE
          WHEN regexp_replace(COALESCE(gross_weight_text, '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN regexp_replace(COALESCE(gross_weight_text, '0'), '[^0-9.-]', '', 'g')::numeric
          ELSE 0
        END AS gross_weight_kg,
        NULLIF(TRIM(bundles_text), '') AS no_of_bundles,
        NULLIF(TRIM(package_type), '') AS package_type,
        NULLIF(TRIM(container_no), '') AS container_no,
        origin_shipment_id,
        origin_grn_id,
        received_at,
        last_moved_at
      FROM stock_lines
      WHERE COALESCE(NULLIF(TRIM(product_code), ''), NULLIF(TRIM(description), '')) IS NOT NULL
      ORDER BY received_at DESC NULLS LAST, id
    """


def _approved_packing_list_sku_summary_sql(access_where: str) -> str:
    return f"""
      WITH stock_lines AS (
        {_approved_packing_list_stock_lines_sql(access_where)}
      )
      SELECT
        MIN(id) AS id,
        product_code,
        NULLIF(MAX(description), '') AS description,
        NULLIF(MAX(hs_code), '') AS hs_code,
        SUM(quantity_on_hand) AS total_quantity_on_hand,
        0::numeric AS total_reserved_quantity,
        SUM(net_weight_kg) AS total_net_weight_kg,
        SUM(gross_weight_kg) AS total_gross_weight_kg,
        COUNT(DISTINCT origin_shipment_id) FILTER (WHERE origin_shipment_id IS NOT NULL) AS shipment_count
      FROM stock_lines
      GROUP BY product_code
      ORDER BY product_code
    """
    if aggregate:
        select = select.replace("quantity_on_hand", "total_quantity_on_hand")
        select = select.replace("reserved_quantity", "total_reserved_quantity")
        select = select.replace("net_weight_kg", "total_net_weight_kg")
        select = select.replace("gross_weight_kg", "total_gross_weight_kg")
    return f"""
      WITH stock_source AS (
        SELECT
          pli.id::text AS id,
          pli.product_code,
          pli.product_description AS description,
          pli.hsn_code AS hs_code,
          CASE
            WHEN regexp_replace(COALESCE(pli.total_qty_in_pcs, pli.no_of_bundles, '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN regexp_replace(COALESCE(pli.total_qty_in_pcs, pli.no_of_bundles, '0'), '[^0-9.-]', '', 'g')::numeric
            ELSE 0
          END AS qty,
          CASE
            WHEN regexp_replace(COALESCE(pli.net_weight_kgs, '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN regexp_replace(COALESCE(pli.net_weight_kgs, '0'), '[^0-9.-]', '', 'g')::numeric
            ELSE 0
          END AS net_weight_kg,
          CASE
            WHEN regexp_replace(COALESCE(pli.gross_weight_kgs, '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN regexp_replace(COALESCE(pli.gross_weight_kgs, '0'), '[^0-9.-]', '', 'g')::numeric
            ELSE 0
          END AS gross_weight_kg,
          d.shipment_id,
          COALESCE(pl.reviewed_at, pl.extracted_at, pl.created_at) AS received_at,
          pl.updated_at AS last_moved_at
        FROM aiextraction.packing_list_line_items pli
        JOIN aiextraction.packing_list_extractions pl ON pl.id = pli.packing_list_id
        JOIN public.documents d ON d.id = pl.document_id
        WHERE {access_where}

        UNION ALL

        SELECT
          dl.id::text AS id,
          dl.payload->>'productCode' AS product_code,
          COALESCE(dl.payload->>'productDescription', dl.payload->>'productDesc', dl.payload->>'description') AS description,
          dl.payload->>'hsnCode' AS hs_code,
          CASE
            WHEN regexp_replace(COALESCE(dl.payload->>'totalQtyInPcs', dl.payload->>'quantity', dl.payload->>'quantityTotal', dl.payload->>'noOfBundles', '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN regexp_replace(COALESCE(dl.payload->>'totalQtyInPcs', dl.payload->>'quantity', dl.payload->>'quantityTotal', dl.payload->>'noOfBundles', '0'), '[^0-9.-]', '', 'g')::numeric
            ELSE 0
          END AS qty,
          CASE
            WHEN regexp_replace(COALESCE(dl.payload->>'netWeightKgs', '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN regexp_replace(COALESCE(dl.payload->>'netWeightKgs', '0'), '[^0-9.-]', '', 'g')::numeric
            ELSE 0
          END AS net_weight_kg,
          CASE
            WHEN regexp_replace(COALESCE(dl.payload->>'grossWeightKgs', dl.payload->>'grossWeight', '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN regexp_replace(COALESCE(dl.payload->>'grossWeightKgs', dl.payload->>'grossWeight', '0'), '[^0-9.-]', '', 'g')::numeric
            ELSE 0
          END AS gross_weight_kg,
          d.shipment_id,
          dr.created_at AS received_at,
          dr.updated_at AS last_moved_at
        FROM docgen.draft_line_items dl
        JOIN docgen.drafts dr ON dr.id = dl.draft_id
        JOIN LATERAL jsonb_each_text(COALESCE(dr.source_document_ids, '{{}}'::jsonb)) source_doc(key, value) ON true
        JOIN public.documents d ON d.id::text = source_doc.value
        WHERE dr.generated_doc_type = 'PACKING_LIST'
          AND {access_where}

        UNION ALL

        SELECT
          (v.source_document_id::text || '-' || line.ordinality::text) AS id,
          line.item->>'productCode' AS product_code,
          COALESCE(line.item->>'productDescription', line.item->>'productDesc', line.item->>'description') AS description,
          line.item->>'hsnCode' AS hs_code,
          CASE
            WHEN regexp_replace(COALESCE(line.item->>'totalQtyInPcs', line.item->>'quantity', line.item->>'quantityTotal', line.item->>'noOfPackages', '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN regexp_replace(COALESCE(line.item->>'totalQtyInPcs', line.item->>'quantity', line.item->>'quantityTotal', line.item->>'noOfPackages', '0'), '[^0-9.-]', '', 'g')::numeric
            ELSE 0
          END AS qty,
          0::numeric AS net_weight_kg,
          CASE
            WHEN regexp_replace(COALESCE(line.item->>'grossWeightKgs', line.item->>'grossWeight', '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN regexp_replace(COALESCE(line.item->>'grossWeightKgs', line.item->>'grossWeight', '0'), '[^0-9.-]', '', 'g')::numeric
            ELSE 0
          END AS gross_weight_kg,
          d.shipment_id,
          v.created_at AS received_at,
          v.created_at AS last_moved_at
        FROM docgen.v_packing_list_source v
        JOIN public.documents d ON d.id = v.source_document_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.line_items, '[]'::jsonb)) WITH ORDINALITY AS line(item, ordinality)
        WHERE {access_where}
      )
      SELECT
        {select}
      FROM stock_source src
      WHERE COALESCE(NULLIF(TRIM(src.product_code), ''), NULLIF(TRIM(src.description), '')) IS NOT NULL
      GROUP BY COALESCE(NULLIF(TRIM(src.product_code), ''), 'UNSPECIFIED')
      ORDER BY COALESCE(NULLIF(TRIM(src.product_code), ''), 'UNSPECIFIED')
    """


@router.get("/inventory/warehouses")
async def list_warehouses(
    user=Depends(get_current_user),
    _authz=Depends(require_any_activity("inventory.view_warehouse", "inventory.warehouse_inventory_stock_position", "inventory.create_outward_grn_new_dispatch")),
):
    prisma = await get_prisma()
    await _ensure_warehouse_locations_table(prisma)
    rows = await _query_raw(
        prisma,
        """
        SELECT
          "id", "name", "address", "firms_code",
          "inbound_sla_hrs", "outbound_sla_hrs"
        FROM "public"."warehouse_locations"
        WHERE "is_active" = TRUE AND UPPER(COALESCE("location_type", 'WAREHOUSE')) = 'WAREHOUSE'
        ORDER BY "name"
        """,
    )
    return {
        "ok": True,
        "data": [
            {
                "id": str(row.get("id") or ""),
                "name": row.get("name") or "",
                "address": row.get("address"),
                "firmsCode": row.get("firms_code"),
                "inboundSlaHrs": row.get("inbound_sla_hrs"),
                "outboundSlaHrs": row.get("outbound_sla_hrs"),
            }
            for row in rows
        ],
    }


@router.get("/inventory/port-warehouses")
async def list_port_warehouses(
    user=Depends(get_current_user),
    _authz=Depends(require_any_activity("inventory.view_warehouse", "inventory.warehouse_inventory_stock_position", "inventory.create_outward_grn_new_dispatch")),
):
    prisma = await get_prisma()
    await _ensure_warehouse_locations_table(prisma)
    rows = await _query_raw(
        prisma,
        """
        SELECT
          "id", "name", "address", "firms_code",
          "inbound_sla_hrs", "outbound_sla_hrs"
        FROM "public"."warehouse_locations"
        WHERE "is_active" = TRUE AND UPPER(COALESCE("location_type", '')) = 'PORT'
        ORDER BY "name"
        """,
    )
    return {
        "ok": True,
        "data": [
            {
                "id": str(row.get("id") or ""),
                "name": row.get("name") or "",
                "address": row.get("address"),
                "firmsCode": row.get("firms_code"),
                "inboundSlaHrs": row.get("inbound_sla_hrs"),
                "outboundSlaHrs": row.get("outbound_sla_hrs"),
            }
            for row in rows
        ],
    }


@router.get("/warehouse/stock")
async def list_warehouse_stock(
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=25, ge=1, le=500),
    search: str | None = Query(default=None),
    user=Depends(get_current_user),
    _authz=Depends(require_any_activity("inventory.view_warehouse", "inventory.warehouse_inventory_stock_position", "inventory.create_outward_grn_new_dispatch")),
):
    prisma = await get_prisma()
    access_where, params, _ = document_sql_where("d", user)
    rows = await _query_raw(prisma, _approved_packing_list_stock_lines_sql(access_where), *params)
    rows = await _apply_outward_reservations_safe(prisma, rows)
    data = [_stock_row(row) for row in rows]
    query = (search or "").strip().lower()
    if query:
        data = [
            row for row in data
            if query in str(row.get("productCode") or "").lower()
            or query in str(row.get("description") or "").lower()
            or query in str(row.get("hsCode") or "").lower()
        ]
    total = len(data)
    start = (page - 1) * pageSize
    paged = data[start : start + pageSize]
    return {
        "ok": True,
        "data": paged,
        "meta": {
            "total": total,
            "page": page,
            "pageSize": pageSize,
            "totalPages": max(1, (total + pageSize - 1) // pageSize),
            "totalAvailable": sum(_num(row.get("availableQuantity")) for row in data),
            "totalReserved": sum(_num(row.get("reservedQuantity")) for row in data),
        },
    }


@router.get("/warehouse/stock/sku-summary")
async def list_warehouse_sku_summary(
    user=Depends(get_current_user),
    _authz=Depends(require_any_activity("inventory.view_warehouse", "inventory.warehouse_inventory_stock_position", "inventory.create_outward_grn_new_dispatch")),
):
    prisma = await get_prisma()
    access_where, params, _ = document_sql_where("d", user)
    rows = await _query_raw(prisma, _approved_packing_list_stock_lines_sql(access_where), *params)
    rows = await _apply_outward_reservations_safe(prisma, rows)
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = row.get("product_code") or "UNSPECIFIED"
        current = grouped.setdefault(
            key,
            {
                "product_code": key,
                "description": row.get("description"),
                "hs_code": row.get("hs_code"),
                "total_quantity_on_hand": 0,
                "total_reserved_quantity": 0,
                "total_net_weight_kg": 0,
                "total_gross_weight_kg": 0,
                "shipment_count": 0,
            },
        )
        current["total_quantity_on_hand"] += _num(row.get("quantity_on_hand"))
        current["total_reserved_quantity"] += _num(row.get("reserved_quantity"))
        current["total_net_weight_kg"] += _num(row.get("net_weight_kg"))
        current["total_gross_weight_kg"] += _num(row.get("gross_weight_kg"))
        current["shipment_count"] += 1 if row.get("origin_shipment_id") else 0
    return {"ok": True, "data": [_sku_summary_row(row) for row in grouped.values()]}


@router.get("/warehouse/outward")
async def list_outward_dispatches(
    status: str | None = Query(default=None),
    user=Depends(get_current_user),
    _authz=Depends(require_any_activity("inventory.view_outward_dispatches", "inventory.create_outward_grn_new_dispatch", "inventory.approve_dispatch")),
):
    prisma = await get_prisma()
    rows = await _query_raw(
        prisma,
        """
        SELECT id::text, status, rendered_payload, created_at, updated_at
        FROM docgen.drafts
        WHERE generated_doc_type = 'US_PACKING_LIST'
          AND created_by::text = $1::text
        ORDER BY updated_at DESC
        """,
        str(user.id),
    )
    status_filter = (status or "ALL").upper()
    data = []
    for row in rows:
        payload = _coerce_json(row.get("rendered_payload"))
        if not isinstance(payload, dict) or not isinstance(payload.get("outwardDispatch"), dict):
            continue
        if status_filter != "ALL" and str(row.get("status") or "").upper() != status_filter:
            continue
        refreshed_payload = await _refresh_existing_outward_payload(prisma, payload)
        if refreshed_payload != payload:
            await _execute_raw(
                prisma,
                """
                UPDATE docgen.drafts
                SET rendered_payload = $2::jsonb, updated_at = NOW()
                WHERE id::text = $1::text
                """,
                str(row.get("id")),
                json.dumps(refreshed_payload),
            )
        hydrated_row = dict(row)
        hydrated_row["rendered_payload"] = refreshed_payload
        data.append(_outward_record_from_draft(hydrated_row))
    return {"ok": True, "data": data, "meta": {"total": len(data)}}


@router.post("/warehouse/outward")
async def create_outward_dispatch(
    request: CreateOutwardDispatchRequest,
    user=Depends(get_current_user),
    _authz=Depends(require_activity("inventory.create_outward_grn_new_dispatch")),
):
    prisma = await get_prisma()
    access_where, params, _ = document_sql_where("d", user)
    stock_rows = await _query_raw(prisma, _approved_packing_list_stock_lines_sql(access_where), *params)
    stock_rows = await _apply_outward_reservations_safe(prisma, stock_rows)
    stock_by_id = {str(row["id"]): row for row in stock_rows}

    product_requests: dict[str, dict[str, Any]] = {}
    for line in request.lines:
        row = stock_by_id.get(line.warehouseStockId)
        if not row:
            raise HTTPException(status_code=400, detail=f"Stock row not found: {line.warehouseStockId}")
        product_code = row.get("product_code") or "UNSPECIFIED"
        current = product_requests.setdefault(
            product_code,
            {"quantity": 0.0, "netWeightKg": 0.0, "hasNetWeight": False, "packageType": line.packageType, "notes": line.notes},
        )
        current["quantity"] += float(line.quantityDispatched)
        if line.netWeightKg is not None:
            current["netWeightKg"] += float(line.netWeightKg)
            current["hasNetWeight"] = True
        if line.notes:
            current["notes"] = line.notes
        if line.packageType:
            current["packageType"] = line.packageType

    product_rows: dict[str, list[dict[str, Any]]] = {}
    for row in stock_rows:
        product_rows.setdefault(row.get("product_code") or "UNSPECIFIED", []).append(row)
    for rows_for_product in product_rows.values():
        rows_for_product.sort(key=lambda row: (_iso(row.get("received_at")) or "", str(row.get("id") or "")))

    selected_rows_by_id: dict[str, dict[str, Any]] = {}
    allocated_lines: list[OutwardDispatchLineRequest] = []
    for product_code, product_request in product_requests.items():
        requested_qty = float(product_request["quantity"])
        available_rows = product_rows.get(product_code, [])
        total_available = sum(max(0.0, _num(row.get("quantity_on_hand")) - _num(row.get("reserved_quantity"))) for row in available_rows)
        if requested_qty > total_available:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient available quantity for {product_code}: requested {requested_qty}, available {total_available}",
            )
        remaining = requested_qty
        for row in available_rows:
            if remaining <= 0:
                break
            available = max(0.0, _num(row.get("quantity_on_hand")) - _num(row.get("reserved_quantity")))
            if available <= 0:
                continue
            take_qty = min(remaining, available)
            net_weight = None
            if product_request["hasNetWeight"] and requested_qty > 0:
                net_weight = round(float(product_request["netWeightKg"]) * (take_qty / requested_qty), 2)
            allocated_lines.append(
                OutwardDispatchLineRequest(
                    warehouseStockId=str(row["id"]),
                    quantityDispatched=take_qty,
                    netWeightKg=net_weight,
                    packageType=product_request.get("packageType"),
                    notes=product_request.get("notes"),
                )
            )
            selected_rows_by_id[str(row["id"])] = row
            remaining -= take_qty

    allocated_request = request.model_copy(update={"lines": allocated_lines})
    selected_warehouse = await _warehouse_location_by_id(prisma, request.warehouseId)
    if request.warehouseId and not selected_warehouse:
        raise HTTPException(status_code=400, detail="Selected warehouse is not active or was not found")

    origin_shipment_ids = sorted({
        str(row.get("origin_shipment_id"))
        for row in selected_rows_by_id.values()
        if row.get("origin_shipment_id")
    })
    selected_container_numbers = sorted({
        str(row.get("container_no")).strip()
        for row in selected_rows_by_id.values()
        if str(row.get("container_no") or "").strip()
    })
    origin_context_by_shipment: dict[str, dict[str, Any]] = {}
    origin_context_by_stock_id: dict[str, dict[str, Any]] = {}
    if origin_shipment_ids or selected_container_numbers:
        context_rows = await _query_raw(
            prisma,
            """
            SELECT
              COALESCE(s."id"::text, d."shipment_id"::text, '') AS shipment_id,
              COALESCE(NULLIF(s."project_name", ''), NULLIF(bol."project_name", '')) AS project_name,
              COALESCE(NULLIF(s."bol_number", ''), NULLIF(bol."bol_number", ''), NULLIF(bol."mbl_number", ''), NULLIF(s."mbl_number", ''), NULLIF(s."booking_number", '')) AS bol_number,
              COALESCE(
                NULLIF(bol."country_of_origin", ''),
                NULLIF(bol."raw_data"->>'countryOfOrigin', ''),
                NULLIF(bol."raw_data"->>'country_of_origin', ''),
                NULLIF(bol."raw_data"#>>'{route,countryOfOrigin}', ''),
                NULLIF(bol."raw_data"#>>'{route,country_of_origin}', '')
              ) AS country_of_origin,
              NULLIF(bol."package_summary", '') AS package_summary,
              NULLIF(bol."total_packages", '') AS total_packages,
              NULLIF(bol."gross_weight", '') AS bol_gross_weight,
              NULLIF(bol."net_weight", '') AS bol_net_weight,
              NULLIF(bc."number", '') AS container_no,
              NULLIF(bc."packages", '') AS container_packages,
              NULLIF(bc."gross_weight_kg", '') AS container_gross_weight_kg,
              NULLIF(bc."net_weight_kg", '') AS container_net_weight_kg,
              NULLIF(gdi."product_code", '') AS product_code,
              NULLIF(gdi."product_description", '') AS product_description,
              NULLIF(gdi."product_specification", '') AS product_specification,
              d."updated_at" AS document_updated_at
            FROM "aiextraction"."bills_of_lading" bol
            JOIN "public"."documents" d ON d."id" = bol."document_id"
            LEFT JOIN "public"."shipments" s ON s."id" = d."shipment_id"
            LEFT JOIN "aiextraction"."bill_of_lading_containers" bc ON bc."bill_of_lading_id" = bol."id"
            LEFT JOIN "aiextraction"."bill_of_lading_goods_description_items" gdi ON gdi."bill_of_lading_id" = bol."id"
            WHERE (
                COALESCE(s."id"::text, d."shipment_id"::text, '') = ANY($1::text[])
                OR NULLIF(bc."number", '') = ANY($2::text[])
              )
              AND COALESCE(d."is_deleted", FALSE) = FALSE
            ORDER BY d."updated_at" DESC
            """,
            origin_shipment_ids,
            selected_container_numbers,
        )
        for selected_row in selected_rows_by_id.values():
            stock_id = str(selected_row.get("id") or "")
            shipment_id = str(selected_row.get("origin_shipment_id") or "")
            container_key = _match_key(selected_row.get("container_no"))
            product_key = _match_key(selected_row.get("product_code"))
            description_key = _match_key(selected_row.get("description"))
            best_row: dict[str, Any] | None = None
            best_score = -1
            for context_row in context_rows:
                context_container_key = _match_key(context_row.get("container_no"))
                context_product_key = _match_key(context_row.get("product_code"))
                context_description_key = _match_key(context_row.get("product_description"))
                context_shipment_id = str(context_row.get("shipment_id") or "")
                same_container = bool(container_key and context_container_key and container_key == context_container_key)
                same_product = bool(
                    product_key
                    and (
                        product_key == context_product_key
                        or (context_description_key and product_key in context_description_key)
                    )
                )
                same_description = bool(description_key and context_description_key and description_key in context_description_key)
                same_shipment = bool(shipment_id and shipment_id == context_shipment_id)
                score = 0
                if same_container:
                    score += 100
                if same_product:
                    score += 50
                if same_description:
                    score += 25
                if same_shipment:
                    score += 10
                if score > best_score:
                    best_score = score
                    best_row = context_row
            if best_row and best_score > 0:
                if stock_id:
                    origin_context_by_stock_id[stock_id] = best_row
                if shipment_id and shipment_id not in origin_context_by_shipment:
                    origin_context_by_shipment[shipment_id] = best_row
                matched_container = str(best_row.get("container_no") or "")
                if matched_container and f"container:{matched_container}" not in origin_context_by_shipment:
                    origin_context_by_shipment[f"container:{matched_container}"] = best_row

    draft_id = str(uuid4())
    payload = _outward_draft_payload(
        draft_id=draft_id,
        request=allocated_request,
        selected_rows=list(selected_rows_by_id.values()),
        selected_warehouse=selected_warehouse,
        origin_context_by_shipment=origin_context_by_shipment,
        origin_context_by_stock_id=origin_context_by_stock_id,
    )
    await _execute_raw(
        prisma,
        """
        INSERT INTO docgen.drafts
          (id, generated_doc_type, schema_version, status, source_document_ids, rendered_payload, created_by, created_at, updated_at)
        VALUES ($1::uuid, 'US_PACKING_LIST', 1, 'DRAFT', $2::jsonb, $3::jsonb, $4::text, NOW(), NOW())
        """,
        draft_id,
        json.dumps(payload["sourceDocumentIds"]),
        json.dumps(payload),
        str(user.id),
    )
    for line_no, item in enumerate(payload["lineItems"], start=1):
        await _execute_raw(
            prisma,
            """
            INSERT INTO docgen.draft_line_items
              (id, draft_id, line_no, payload, created_at, updated_at)
            VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, NOW(), NOW())
            """,
            str(uuid4()),
            draft_id,
            line_no,
            json.dumps(item),
        )
    rows = await _query_raw(
        prisma,
        "SELECT id::text, status, rendered_payload, created_at, updated_at FROM docgen.drafts WHERE id::text = $1::text",
        draft_id,
    )
    record = _outward_record_from_draft(rows[0]) if rows else {"id": draft_id, "status": "DRAFT", "lines": []}
    record["draftPayload"] = payload
    return {"ok": True, "data": record}


@router.patch("/warehouse/outward/{dispatch_id}/confirm")
async def confirm_outward_dispatch(
    dispatch_id: str,
    user=Depends(get_current_user),
    _authz=Depends(require_activity("inventory.approve_dispatch")),
):
    prisma = await get_prisma()
    await _execute_raw(
        prisma,
        """
        UPDATE docgen.drafts
        SET status = 'CONFIRMED', updated_at = NOW()
        WHERE id::text = $1::text
          AND generated_doc_type = 'US_PACKING_LIST'
          AND created_by::text = $2::text
        """,
        dispatch_id,
        str(user.id),
    )
    return {"ok": True, "data": {"id": dispatch_id, "status": "CONFIRMED", "documentId": None}}


@router.get("/inventory/warehouse/{warehouse_id}/stock")
async def list_inventory_warehouse_stock(
    warehouse_id: str,
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=25, ge=1, le=500),
    search: str | None = Query(default=None),
    user=Depends(get_current_user),
    _authz=Depends(require_any_activity("inventory.view_warehouse", "inventory.warehouse_inventory_stock_position", "inventory.create_outward_grn_new_dispatch")),
):
    prisma = await get_prisma()
    access_where, params, _ = document_sql_where("d", user)
    rows = await _query_raw(prisma, _approved_packing_list_stock_lines_sql(access_where), *params)
    rows = await _apply_outward_reservations_safe(prisma, rows)
    data = [_stock_row(row) for row in rows]
    query = (search or "").strip().lower()
    if query:
        data = [
            row for row in data
            if query in str(row.get("productCode") or "").lower()
            or query in str(row.get("description") or "").lower()
            or query in str(row.get("hsCode") or "").lower()
        ]
    total = len(data)
    start = (page - 1) * pageSize
    paged = data[start : start + pageSize]
    return {
        "ok": True,
        "data": paged,
        "meta": {
            "total": total,
            "page": page,
            "pageSize": pageSize,
            "totalPages": max(1, (total + pageSize - 1) // pageSize),
            "totalAvailable": sum(_num(row.get("availableQuantity")) for row in data),
            "totalReserved": sum(_num(row.get("reservedQuantity")) for row in data),
            "warehouseId": warehouse_id,
        },
    }


@router.get("/inventory/warehouse/{warehouse_id}/sku-movements")
async def get_sku_movements(
    warehouse_id: str,
    productCode: str = Query(...),
    user=Depends(get_current_user),
    _authz=Depends(require_any_activity("inventory.view_warehouse", "inventory.warehouse_inventory_stock_position")),
):
    prisma = await get_prisma()
    await ensure_doc_generation_views(prisma)
    access_where, params, next_param = document_sql_where("d", user)
    rows = await _query_raw(
        prisma,
        f"""
        SELECT
          pl.document_id::text,
          d.shipment_id::text AS shipment_id,
          COALESCE(d.document_number, pl.invoice_no, d.file_name) AS shipment_number,
          pli.container_no,
          pli.product_code,
          pli.product_description,
          pli.total_qty_in_pcs,
          pli.net_weight_kgs,
          pli.gross_weight_kgs,
          COALESCE(pl.reviewed_at, pl.extracted_at, pl.created_at) AS received_at,
          pl.exporter_name
        FROM aiextraction.packing_list_line_items pli
        JOIN aiextraction.packing_list_extractions pl ON pl.id = pli.packing_list_id
        JOIN public.documents d ON d.id = pl.document_id
        WHERE {access_where}
          AND UPPER(COALESCE(NULLIF(TRIM(pli.product_code), ''), 'UNSPECIFIED')) = UPPER(${next_param}::text)
        ORDER BY COALESCE(pl.reviewed_at, pl.extracted_at, pl.created_at) DESC NULLS LAST
        """,
        *params,
        productCode,
    )
    receipts = [
        {
            "shipment_number": row.get("shipment_number") or row.get("shipment_id"),
            "container_number": row.get("container_no"),
            "received_qty": row.get("total_qty_in_pcs"),
            "received_weight_kg": row.get("net_weight_kgs") or row.get("gross_weight_kgs"),
            "received_at": _iso(row.get("received_at")),
            "received_by_name": None,
            "exporter_name": row.get("exporter_name"),
            "qc_overall_status": None,
        }
        for row in rows
    ]
    return {"ok": True, "data": {"grnReceipts": receipts, "movements": []}}
