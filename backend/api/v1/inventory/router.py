from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from db import get_prisma
from doc_generation.db_setup import ensure_doc_generation_views
from helpers.dependencies import get_current_user
from helpers.rbac_data_access import document_sql_where


router = APIRouter(tags=["Inventory"])

ALL_WAREHOUSE_ID = "all"


async def _query_raw(prisma, sql: str, *params: Any) -> list[dict[str, Any]]:
    rows = await prisma.query_raw(sql, *params)
    return [dict(row) for row in rows]


async def _execute_raw(prisma, sql: str, *params: Any) -> Any:
    return await prisma.execute_raw(sql, *params)


class OutwardDispatchLineRequest(BaseModel):
    warehouseStockId: str
    quantityDispatched: float = Field(gt=0)
    netWeightKg: float | None = None
    notes: str | None = None


class CreateOutwardDispatchRequest(BaseModel):
    warehouseId: str | None = None
    destinationName: str = Field(min_length=1)
    destinationAddress: str | None = None
    truckNumber: str | None = None
    driverName: str | None = None
    notes: str | None = None
    lines: list[OutwardDispatchLineRequest] = Field(min_length=1)


def _num(value: Any) -> float:
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


def _stock_row(row: dict[str, Any]) -> dict[str, Any]:
    qty = _num(row.get("quantity_on_hand"))
    reserved = _num(row.get("reserved_quantity"))
    return {
        "id": str(row.get("id") or row.get("product_code") or ""),
        "productCode": row.get("product_code") or "UNSPECIFIED",
        "description": row.get("description"),
        "hsCode": row.get("hs_code"),
        "quantityOnHand": qty,
        "reservedQuantity": reserved,
        "availableQuantity": max(0, qty - reserved),
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
    return {
        "productCode": row.get("product_code") or "UNSPECIFIED",
        "description": row.get("description"),
        "hsCode": row.get("hs_code"),
        "totalQuantityOnHand": qty,
        "totalReservedQuantity": reserved,
        "availableQuantity": max(0, qty - reserved),
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
    lines = payload.get("lineItems") if isinstance(payload.get("lineItems"), list) else []
    return {
        "id": str(row.get("id")),
        "status": row.get("status") or "DRAFT",
        "destinationName": dispatch.get("destinationName"),
        "destinationAddress": dispatch.get("destinationAddress"),
        "truckNumber": dispatch.get("truckNumber"),
        "driverName": dispatch.get("driverName"),
        "notes": dispatch.get("notes"),
        "createdAt": _iso(row.get("created_at")),
        "updatedAt": _iso(row.get("updated_at")),
        "dispatchedAt": _iso(row.get("updated_at")) if row.get("status") in {"CONFIRMED", "DISPATCHED", "GENERATED"} else None,
        "documentId": None,
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


async def _outward_reserved_quantities(prisma) -> dict[str, float]:
    rows = await _query_raw(
        prisma,
        """
        SELECT rendered_payload
        FROM docgen.drafts
        WHERE generated_doc_type = 'US_PACKING_LIST'
          AND status IN ('DRAFT', 'IN_REVIEW', 'CONFIRMED', 'GENERATED', 'DISPATCHED')
        """
    )
    reserved: dict[str, float] = {}
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
            reserved[stock_id] = reserved.get(stock_id, 0.0) + _num(item.get("quantityDispatched") or item.get("totalQtyInPcs"))
    return reserved


def _apply_outward_reservations(rows: list[dict[str, Any]], reserved_by_stock_id: dict[str, float]) -> list[dict[str, Any]]:
    adjusted: list[dict[str, Any]] = []
    for row in rows:
        next_row = dict(row)
        reserved = _num(next_row.get("reserved_quantity")) + reserved_by_stock_id.get(str(next_row.get("id")), 0.0)
        next_row["reserved_quantity"] = reserved
        adjusted.append(next_row)
    return adjusted


async def _apply_outward_reservations_safe(prisma, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    try:
        return _apply_outward_reservations(rows, await _outward_reserved_quantities(prisma))
    except Exception:
        return rows


def _outward_draft_payload(
    *,
    draft_id: str,
    request: CreateOutwardDispatchRequest,
    selected_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    line_items: list[dict[str, Any]] = []
    stock_by_id = {str(row["id"]): row for row in selected_rows}
    for index, line in enumerate(request.lines, start=1):
        row = stock_by_id[line.warehouseStockId]
        qty = float(line.quantityDispatched)
        on_hand = _num(row.get("quantity_on_hand"))
        net_total = line.netWeightKg
        if net_total is None and on_hand > 0:
            net_total = round((_num(row.get("net_weight_kg")) / on_hand) * qty, 2)
        line_items.append(
            {
                "lineNo": index,
                "warehouseStockId": line.warehouseStockId,
                "originShipmentId": str(row.get("origin_shipment_id")) if row.get("origin_shipment_id") else None,
                "fifoAllocated": True,
                "hsnCode": row.get("hs_code"),
                "productCode": row.get("product_code"),
                "productDesc": row.get("description"),
                "description": row.get("description"),
                "totalQtyInPcs": str(qty).rstrip("0").rstrip("."),
                "quantityDispatched": qty,
                "noOfBundles": None,
                "grossWeightKgs": None,
                "netWeightKgs": str(net_total or 0),
                "netWeightKg": net_total or 0,
                "notes": line.notes,
            }
        )

    total_qty = sum(_num(item.get("quantityDispatched")) for item in line_items)
    total_net = sum(_num(item.get("netWeightKg")) for item in line_items)
    fields = {
        "dispatchNumber": f"OGR-{draft_id[-8:].upper()}",
        "documentDate": now[:10],
        "destinationName": request.destinationName,
        "destinationAddress": request.destinationAddress,
        "truckNumber": request.truckNumber,
        "driverName": request.driverName,
        "dispatchNotes": request.notes,
        "totalLines": str(len(line_items)),
        "totalQty": str(total_qty).rstrip("0").rstrip("."),
        "totalNetWeightKgs": str(round(total_net, 2)),
    }
    sections = [
        {
            "sectionLabel": "Dispatch Details",
            "fields": [
                {
                    "targetField": key,
                    "targetLabel": label,
                    "value": fields.get(key),
                    "sourceDoc": "MANUAL" if key not in {"dispatchNumber", "documentDate", "totalLines", "totalQty", "totalNetWeightKgs"} else "CALCULATED",
                    "sourceDocumentId": None,
                    "sourceField": "manual",
                    "sourceLabel": "Manual",
                    "mappingType": "manual" if key not in {"dispatchNumber", "documentDate", "totalLines", "totalQty", "totalNetWeightKgs"} else "derived",
                    "validation": "NOT NULL" if key == "destinationName" else None,
                    "validationSeverity": "critical" if key == "destinationName" else None,
                    "validationStatus": "valid" if fields.get(key) else ("manual_required" if key == "destinationName" else "missing"),
                    "mono": key in {"dispatchNumber", "documentDate", "truckNumber"},
                }
                for key, label in [
                    ("dispatchNumber", "Outward GRN Number"),
                    ("documentDate", "Date"),
                    ("destinationName", "Destination Name"),
                    ("destinationAddress", "Destination Address"),
                    ("truckNumber", "Truck / Vehicle No."),
                    ("driverName", "Driver Name"),
                    ("dispatchNotes", "Dispatch Notes"),
                    ("totalLines", "Total Lines"),
                    ("totalQty", "Total Quantity"),
                    ("totalNetWeightKgs", "Total Net Wt (kg)"),
                ]
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
            "calc": 4,
            "manual": 5,
            "total": 9 + len(line_items),
            "valid": sum(1 for value in fields.values() if value),
            "missing": sum(1 for value in fields.values() if not value),
            "manualRequired": 1 if not request.destinationName else 0,
        },
        "outwardDispatch": {
            "destinationName": request.destinationName,
            "destinationAddress": request.destinationAddress,
            "truckNumber": request.truckNumber,
            "driverName": request.driverName,
            "notes": request.notes,
            "warehouseId": request.warehouseId or ALL_WAREHOUSE_ID,
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


@router.get("/api/inventory/warehouses")
async def list_warehouses(user=Depends(get_current_user)):
    return {
        "ok": True,
        "data": [
            {
                "id": ALL_WAREHOUSE_ID,
                "name": "All warehouses",
                "address": "Packing list stock position",
                "firmsCode": None,
            }
        ],
    }


@router.get("/api/inventory/port-warehouses")
async def list_port_warehouses(user=Depends(get_current_user)):
    return {"ok": True, "data": []}


@router.get("/api/warehouse/stock")
async def list_warehouse_stock(
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=25, ge=1, le=500),
    search: str | None = Query(default=None),
    user=Depends(get_current_user),
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


@router.get("/api/warehouse/stock/sku-summary")
async def list_warehouse_sku_summary(user=Depends(get_current_user)):
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


@router.get("/api/warehouse/outward")
async def list_outward_dispatches(
    status: str | None = Query(default=None),
    user=Depends(get_current_user),
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
    data = [
        _outward_record_from_draft(row)
        for row in rows
        if isinstance(_coerced := _coerce_json(row.get("rendered_payload")), dict)
        and isinstance(_coerced.get("outwardDispatch"), dict)
        and (status_filter == "ALL" or str(row.get("status") or "").upper() == status_filter)
    ]
    return {"ok": True, "data": data, "meta": {"total": len(data)}}


@router.post("/api/warehouse/outward")
async def create_outward_dispatch(
    request: CreateOutwardDispatchRequest,
    user=Depends(get_current_user),
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
            {"quantity": 0.0, "netWeightKg": 0.0, "hasNetWeight": False, "notes": line.notes},
        )
        current["quantity"] += float(line.quantityDispatched)
        if line.netWeightKg is not None:
            current["netWeightKg"] += float(line.netWeightKg)
            current["hasNetWeight"] = True
        if line.notes:
            current["notes"] = line.notes

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
                    notes=product_request.get("notes"),
                )
            )
            selected_rows_by_id[str(row["id"])] = row
            remaining -= take_qty

    allocated_request = request.model_copy(update={"lines": allocated_lines})

    draft_id = str(uuid4())
    payload = _outward_draft_payload(draft_id=draft_id, request=allocated_request, selected_rows=list(selected_rows_by_id.values()))
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
    return {"ok": True, "data": record}


@router.patch("/api/warehouse/outward/{dispatch_id}/confirm")
async def confirm_outward_dispatch(dispatch_id: str, user=Depends(get_current_user)):
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


@router.get("/api/inventory/warehouse/{warehouse_id}/stock")
async def list_inventory_warehouse_stock(
    warehouse_id: str,
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=25, ge=1, le=500),
    search: str | None = Query(default=None),
    user=Depends(get_current_user),
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


@router.get("/api/inventory/warehouse/{warehouse_id}/sku-movements")
async def get_sku_movements(
    warehouse_id: str,
    productCode: str = Query(...),
    user=Depends(get_current_user),
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
