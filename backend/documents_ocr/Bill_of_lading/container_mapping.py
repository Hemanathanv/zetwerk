"""Build and update BOL-to-Packing-List container mappings."""

from __future__ import annotations

import re
import json
from typing import Any


def _normalize_invoice_number(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def _value(row: Any, name: str) -> Any:
    return row.get(name) if isinstance(row, dict) else getattr(row, name, None)


def _raw_array(extraction: Any, name: str) -> list[dict[str, Any]]:
    raw = _value(extraction, "rawData")
    value = raw.get(name) if isinstance(raw, dict) else None
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _draft_field(payload: dict[str, Any], target_field: str) -> Any:
    for section in payload.get("sections", []):
        if not isinstance(section, dict):
            continue
        for field in section.get("fields", []):
            if isinstance(field, dict) and field.get("targetField") == target_field:
                return field.get("value")
    return None


def _number(value: Any) -> float:
    try:
        return float(re.sub(r"[^0-9.-]", "", str(value or "")) or 0)
    except ValueError:
        return 0


def _source_line_key(row: dict[str, Any], index: int) -> str:
    explicit = str(row.get("_sourceLineKey") or "").strip()
    if explicit:
        return explicit
    base_id = str(row.get("lineItemId") or index)
    if ":split:" in base_id:
        base_id = base_id.split(":split:", 1)[0]
    parts = [
        row.get("packingListDocumentId"),
        row.get("invoiceNumber"),
        row.get("productCode"),
        base_id,
    ]
    return "|".join(re.sub(r"[^A-Z0-9.:-]+", "", str(value or "").upper()) for value in parts)


def _with_source_totals(row: dict[str, Any], index: int) -> dict[str, Any]:
    enriched = dict(row)
    enriched["_sourceLineKey"] = _source_line_key(enriched, index)
    enriched["_sourceTotalQtyInPcs"] = enriched.get("_sourceTotalQtyInPcs") or enriched.get("totalQtyInPcs")
    enriched["_sourceTotalBundles"] = enriched.get("_sourceTotalBundles") or enriched.get("totalBundles")
    enriched["_sourceNetWeightKgs"] = enriched.get("_sourceNetWeightKgs") or enriched.get("netWeightKgs")
    enriched["_sourceGrossWeightKgs"] = enriched.get("_sourceGrossWeightKgs") or enriched.get("grossWeightKgs")
    return enriched


def _validate_container_split_rows(rows: list[dict[str, Any]]) -> None:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for index, row in enumerate(rows):
        key = _source_line_key(row, index)
        grouped.setdefault(key, []).append(row)

    for index, row in enumerate(rows):
        net_weight = _number(row.get("netWeightKgs"))
        gross_weight = _number(row.get("grossWeightKgs"))
        if net_weight > 0 and gross_weight > 0 and gross_weight <= net_weight:
            label = row.get("productCode") or row.get("description") or f"line {index + 1}"
            raise ValueError(f"{label}: gross weight must be greater than net weight")

    checks = (
        ("totalQtyInPcs", "_sourceTotalQtyInPcs", "quantity"),
        ("totalBundles", "_sourceTotalBundles", "bundles"),
        ("netWeightKgs", "_sourceNetWeightKgs", "net weight"),
        ("grossWeightKgs", "_sourceGrossWeightKgs", "gross weight"),
    )
    for group in grouped.values():
        source = next((row for row in group if str(row.get("_splitRow") or "").lower() != "true"), group[0])
        label = source.get("productCode") or source.get("description") or "line item"
        for value_key, source_key, label_key in checks:
            source_total = _number(source.get(source_key) or source.get(value_key))
            if source_total == 0:
                continue
            if len(group) <= 1:
                visible_total = _number(group[0].get(value_key))
                if visible_total == 0:
                    continue
                if abs(visible_total - source_total) > 0.01:
                    raise ValueError(
                        f"{label}: {label_key} {visible_total:g} must match Packing List {source_total:g}"
                    )
                continue
            split_total = sum(_number(row.get(value_key)) for row in group)
            if abs(split_total - source_total) > 0.01:
                raise ValueError(
                    f"{label}: {label_key} split total {split_total:g} must equal Packing List {source_total:g}"
                )


def _approved_snapshot_response(
    *,
    bol_document_id: str,
    invoice_numbers: list[str],
    containers: list[str],
    rows: list[dict[str, Any]],
    page: int,
    page_size: int,
    paginate: bool,
    unmapped_only: bool,
) -> dict[str, Any]:
    enriched_rows = [_with_source_totals(row, index) for index, row in enumerate(rows) if isinstance(row, dict)]
    normalized_rows = [
        {
            "lineItemId": str(row.get("lineItemId") or f"approved:{index}"),
            "packingListDocumentId": row.get("packingListDocumentId"),
            "invoiceNumber": row.get("invoiceNumber"),
            "containerNo": row.get("containerNo"),
            "productCode": row.get("productCode"),
            "description": row.get("description"),
            "specification": row.get("specification"),
            "totalQtyInPcs": row.get("totalQtyInPcs"),
            "qtyPerBundle": row.get("qtyPerBundle"),
            "totalBundles": row.get("totalBundles"),
            "netWeightKgs": row.get("netWeightKgs"),
            "grossWeightKgs": row.get("grossWeightKgs"),
            "_sourceLineKey": row.get("_sourceLineKey"),
            "_sourceTotalQtyInPcs": row.get("_sourceTotalQtyInPcs"),
            "_sourceTotalBundles": row.get("_sourceTotalBundles"),
            "_sourceNetWeightKgs": row.get("_sourceNetWeightKgs"),
            "_sourceGrossWeightKgs": row.get("_sourceGrossWeightKgs"),
            "_splitRow": row.get("_splitRow"),
        }
        for index, row in enumerate(enriched_rows)
    ]

    allowed_containers = set(containers)
    unmapped_count = sum(
        1 for row in normalized_rows
        if not row.get("containerNo") or row.get("containerNo") not in allowed_containers
    )
    filtered_rows = [
        row for row in normalized_rows
        if not unmapped_only
        or not row.get("containerNo")
        or row.get("containerNo") not in allowed_containers
    ]
    totals = {
        "totalQtyInPcs": sum(_number(row.get("totalQtyInPcs")) for row in filtered_rows),
        "totalBundles": sum(_number(row.get("totalBundles")) for row in filtered_rows),
        "netWeightKgs": sum(_number(row.get("netWeightKgs")) for row in filtered_rows),
        "grossWeightKgs": sum(_number(row.get("grossWeightKgs")) for row in filtered_rows),
    }
    total_rows = len(filtered_rows)
    safe_page_size = max(1, min(page_size, 100))
    total_pages = max(1, (total_rows + safe_page_size - 1) // safe_page_size)
    safe_page = max(1, min(page, total_pages))
    visible_rows = filtered_rows
    if paginate:
        start = (safe_page - 1) * safe_page_size
        visible_rows = filtered_rows[start:start + safe_page_size]
    matched_documents = {
        str(row.get("packingListDocumentId") or row.get("invoiceNumber") or index)
        for index, row in enumerate(normalized_rows)
    }
    return {
        "bolDocumentId": bol_document_id,
        "invoiceNumbers": invoice_numbers,
        "containers": containers,
        "matchedPackingLists": len(matched_documents),
        "unmappedCount": unmapped_count,
        "rows": visible_rows,
        "totals": totals,
        "mappingApproved": True,
        "pagination": {
            "page": safe_page,
            "pageSize": safe_page_size,
            "total": total_rows,
            "totalPages": total_pages,
            "hasNextPage": safe_page < total_pages,
            "hasPreviousPage": safe_page > 1,
        },
    }


async def build_container_mapping(
    *,
    prisma: Any,
    bol_document_id: str,
    uploaded_by: str,
    page: int = 1,
    page_size: int = 20,
    paginate: bool = True,
    unmapped_only: bool = False,
) -> dict[str, Any]:
    """Match BOL invoice references to the user's Packing Lists."""
    document = await prisma.document.find_first(
        where={
            "id": bol_document_id,
            "isDeleted": False,
            "docType": "BILL_OF_LADING",
        }
    )
    if document is None:
        raise LookupError("Bill of Lading not found")

    bol = await prisma.billoflading.find_unique(where={"documentId": bol_document_id})
    if bol is None:
        raise ValueError("Bill of Lading extraction is not available")

    invoice_rows = await prisma.billofladingexportinvoice.find_many(
        where={"billOfLadingId": bol.id}
    ) or _raw_array(bol, "exportInvoices")
    invoice_numbers = list(dict.fromkeys(
        str(_value(row, "invoiceNumber") or "").strip()
        for row in invoice_rows
        if str(_value(row, "invoiceNumber") or "").strip()
    ))
    if not invoice_numbers and str(_value(bol, "exportInvoiceNumber") or "").strip():
        invoice_numbers.append(str(_value(bol, "exportInvoiceNumber")).strip())
    wanted = {_normalize_invoice_number(value) for value in invoice_numbers} - {""}

    container_rows = await prisma.billofladingcontainer.find_many(
        where={"billOfLadingId": bol.id}
    ) or _raw_array(bol, "containers")
    containers = list(dict.fromkeys(
        str(
            _value(row, "number")
            or _value(row, "containerNo")
            or _value(row, "containerNumber")
            or ""
        ).strip()
        for row in container_rows
        if str(
            _value(row, "number")
            or _value(row, "containerNo")
            or _value(row, "containerNumber")
            or ""
        ).strip()
    ))

    raw_data = _value(bol, "rawData")
    approved_rows = raw_data.get("containerMappingRows") if isinstance(raw_data, dict) else None
    if isinstance(raw_data, dict) and raw_data.get("containerMappingApproved") is True and isinstance(approved_rows, list):
        return _approved_snapshot_response(
            bol_document_id=bol_document_id,
            invoice_numbers=invoice_numbers,
            containers=containers,
            rows=approved_rows,
            page=page,
            page_size=page_size,
            paginate=paginate,
            unmapped_only=unmapped_only,
        )

    packing_lists = await prisma.packinglistextraction.find_many(
        where={"document": {"is": {"isDeleted": False}}}
    )
    matched = [
        packing_list for packing_list in packing_lists
        if _normalize_invoice_number(_value(packing_list, "invoiceNo")) in wanted
    ]

    generated_drafts = await prisma.query_raw(
        """
        SELECT id, rendered_payload, updated_at, created_at
        FROM docgen.drafts
        WHERE generated_doc_type = 'PACKING_LIST'
          AND status = 'GENERATED'::docgen."DocGenerationStatus"
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        """
    )
    generated_rows: list[dict[str, Any]] = []
    generated_invoice_keys: set[str] = set()
    selected_generated_by_invoice: dict[str, dict[str, Any]] = {}
    for draft in generated_drafts:
        payload = draft.get("rendered_payload") or {}
        if not isinstance(payload, dict):
            continue
        invoice_number = _draft_field(payload, "invoiceNo")
        invoice_key = _normalize_invoice_number(invoice_number)
        if invoice_key not in wanted or invoice_key in selected_generated_by_invoice:
            continue
        selected_generated_by_invoice[invoice_key] = draft
    matched_generated = len(selected_generated_by_invoice)
    for invoice_key, draft in selected_generated_by_invoice.items():
        payload = draft.get("rendered_payload") or {}
        invoice_number = _draft_field(payload, "invoiceNo")
        generated_invoice_keys.add(invoice_key)
        for index, item in enumerate(payload.get("lineItems") or []):
            if not isinstance(item, dict):
                continue
            generated_rows.append({
                "lineItemId": f"draft:{draft['id']}:{index}",
                "packingListDocumentId": str(draft["id"]),
                "invoiceNumber": invoice_number,
                "containerNo": item.get("containerNo"),
                "productCode": item.get("productCode") or item.get("itemCode"),
                "description": item.get("productDescription") or item.get("productDesc"),
                "specification": item.get("productSpecification"),
                "totalQtyInPcs": item.get("totalQtyInPcs") or item.get("quantity"),
                "qtyPerBundle": item.get("qtyPerBundle"),
                "totalBundles": item.get("noOfBundles"),
                "netWeightKgs": item.get("netWeightKgs") or item.get("netWeight"),
                "grossWeightKgs": item.get("grossWeightKgs") or item.get("grossWeight"),
                "_sourceLineKey": item.get("_sourceLineKey"),
                "_sourceTotalQtyInPcs": item.get("_sourceTotalQtyInPcs"),
                "_sourceTotalBundles": item.get("_sourceNoOfBundles") or item.get("_sourceTotalBundles"),
                "_sourceNetWeightKgs": item.get("_sourceNetWeightKgs"),
                "_sourceGrossWeightKgs": item.get("_sourceGrossWeightKgs"),
                "_splitRow": item.get("_splitRow"),
            })

    rows: list[dict[str, Any]] = []
    for packing_list in matched:
        invoice_number = _value(packing_list, "invoiceNo")
        if _normalize_invoice_number(invoice_number) in generated_invoice_keys:
            continue
        items = await prisma.packinglistlineitem.find_many(
            where={"packingListId": packing_list.id}
        )
        rows.extend({
            "lineItemId": str(item.id),
            "packingListDocumentId": str(packing_list.documentId),
            "invoiceNumber": invoice_number,
            "containerNo": _value(item, "containerNo"),
            "productCode": _value(item, "productCode"),
            "description": _value(item, "productDescription"),
            "specification": _value(item, "productSpecification"),
            "totalQtyInPcs": _value(item, "totalQtyInPcs"),
            "qtyPerBundle": _value(item, "qtyPerBundle"),
            "totalBundles": _value(item, "noOfBundles"),
            "netWeightKgs": _value(item, "netWeightKgs"),
            "grossWeightKgs": _value(item, "grossWeightKgs"),
        } for item in items)
    rows.extend(generated_rows)
    matched_extraction_count = sum(
        1 for packing_list in matched
        if _normalize_invoice_number(_value(packing_list, "invoiceNo")) not in generated_invoice_keys
    )

    rows = [_with_source_totals(row, index) for index, row in enumerate(rows)]

    allowed_containers = set(containers)
    unmapped_count = sum(
        1 for row in rows
        if not row.get("containerNo") or row.get("containerNo") not in allowed_containers
    )
    filtered_rows = [
        row for row in rows
        if not unmapped_only
        or not row.get("containerNo")
        or row.get("containerNo") not in allowed_containers
    ]
    totals = {
        "totalQtyInPcs": sum(_number(row.get("totalQtyInPcs")) for row in filtered_rows),
        "totalBundles": sum(_number(row.get("totalBundles")) for row in filtered_rows),
        "netWeightKgs": sum(_number(row.get("netWeightKgs")) for row in filtered_rows),
        "grossWeightKgs": sum(_number(row.get("grossWeightKgs")) for row in filtered_rows),
    }
    total_rows = len(filtered_rows)
    safe_page_size = max(1, min(page_size, 100))
    total_pages = max(1, (total_rows + safe_page_size - 1) // safe_page_size)
    safe_page = max(1, min(page, total_pages))
    visible_rows = filtered_rows
    if paginate:
        start = (safe_page - 1) * safe_page_size
        visible_rows = filtered_rows[start:start + safe_page_size]

    return {
        "bolDocumentId": bol_document_id,
        "invoiceNumbers": invoice_numbers,
        "containers": containers,
        "matchedPackingLists": matched_extraction_count + matched_generated,
        "unmappedCount": unmapped_count,
        "rows": visible_rows,
        "totals": totals,
        "pagination": {
            "page": safe_page,
            "pageSize": safe_page_size,
            "total": total_rows,
            "totalPages": total_pages,
            "hasNextPage": safe_page < total_pages,
            "hasPreviousPage": safe_page > 1,
        },
    }


async def save_container_mapping(
    *,
    prisma: Any,
    bol_document_id: str,
    uploaded_by: str,
    assignments: list[dict[str, str | None]],
    rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Persist reviewed container selections on matched Packing List rows."""
    bol_rows = await prisma.query_raw(
        """
        SELECT raw_data
        FROM aiextraction.bills_of_lading
        WHERE document_id::text = $1::text
        LIMIT 1
        """,
        bol_document_id,
    )
    raw_data = bol_rows[0].get("raw_data") if bol_rows else {}
    if isinstance(raw_data, dict) and raw_data.get("containerMappingApproved") is True:
        rows = raw_data.get("containerMappingRows")
        return {
            "ok": True,
            "updated": 0,
            "mappingApproved": True,
            "alreadyApproved": True,
            "rows": rows if isinstance(rows, list) else [],
        }

    mapping = await build_container_mapping(
        prisma=prisma, bol_document_id=bol_document_id, uploaded_by=uploaded_by,
        paginate=False,
    )
    allowed_ids = {row["lineItemId"] for row in mapping["rows"]}
    allowed_containers = set(mapping["containers"])
    reviewed_rows = [_with_source_totals(row, index) for index, row in enumerate(rows or []) if isinstance(row, dict)]
    if reviewed_rows:
        _validate_container_split_rows(reviewed_rows)
        for row in reviewed_rows:
            container_no = str(row.get("containerNo") or "").strip() or None
            if container_no is not None and container_no not in allowed_containers:
                raise ValueError(f"Container {container_no} is not present on this BOL")
            line_item_id = str(row.get("lineItemId") or "")
            base_line_item_id = line_item_id.split(":split:", 1)[0]
            if base_line_item_id not in allowed_ids:
                raise ValueError(f"Packing List line item {line_item_id} is not part of this BOL")
    for assignment in assignments:
        line_item_id = str(assignment.get("lineItemId") or "")
        container_no = str(assignment.get("containerNo") or "").strip() or None
        if ":split:" in line_item_id:
            continue
        if line_item_id not in allowed_ids:
            raise ValueError(f"Packing List line item {line_item_id} is not part of this BOL")
        if container_no is not None and container_no not in allowed_containers:
            raise ValueError(f"Container {container_no} is not present on this BOL")
        if line_item_id.startswith("draft:"):
            _, draft_id, raw_index = line_item_id.split(":", 2)
            line_index = int(raw_index)
            draft_rows = await prisma.query_raw(
                """
                SELECT rendered_payload
                FROM docgen.drafts
                WHERE id::text = $1::text 
                LIMIT 1
                """,
                draft_id,
            )
            if not draft_rows:
                raise ValueError(f"Generated Packing List {draft_id} was not found")
            payload = draft_rows[0].get("rendered_payload") or {}
            items = payload.get("lineItems") if isinstance(payload, dict) else None
            if not isinstance(items, list) or line_index >= len(items):
                raise ValueError(f"Generated Packing List row {line_index + 1} was not found")
            items[line_index]["containerNo"] = container_no
            await prisma.execute_raw(
                """
                UPDATE docgen.drafts
                SET rendered_payload = $2::jsonb, updated_at = NOW()
                WHERE id::text = $1::text 
                """,
                draft_id,
                json.dumps(payload),
            )
            await prisma.execute_raw(
                """
                UPDATE docgen.draft_line_items
                SET payload = jsonb_set(payload, '{containerNo}', COALESCE(to_jsonb($3::text), 'null'::jsonb), true),
                    updated_at = NOW()
                WHERE draft_id::text = $1::text AND line_no = $2
                """,
                draft_id,
                line_index + 1,
                container_no,
            )
        else:
            await prisma.packinglistlineitem.update(
                where={"id": line_item_id}, data={"containerNo": container_no}
            )
    approved_mapping = await build_container_mapping(
        prisma=prisma, bol_document_id=bol_document_id, uploaded_by=uploaded_by,
        paginate=False,
    )
    snapshot_fields = (
        "lineItemId",
        "packingListDocumentId",
        "invoiceNumber",
        "containerNo",
        "productCode",
        "description",
        "specification",
        "totalQtyInPcs",
        "qtyPerBundle",
        "totalBundles",
        "netWeightKgs",
        "grossWeightKgs",
        "_sourceLineKey",
        "_sourceTotalQtyInPcs",
        "_sourceTotalBundles",
        "_sourceNetWeightKgs",
        "_sourceGrossWeightKgs",
        "_splitRow",
    )
    source_by_id = {str(row.get("lineItemId")): row for row in approved_mapping["rows"]}
    if reviewed_rows:
        reviewed_groups: dict[str, list[dict[str, Any]]] = {}
        for row in reviewed_rows:
            base_id = str(row.get("lineItemId") or "").split(":split:", 1)[0]
            reviewed_groups.setdefault(base_id, []).append(row)
        merged_rows: list[dict[str, Any]] = []
        used_groups: set[str] = set()
        for row in approved_mapping["rows"]:
            line_item_id = str(row.get("lineItemId") or "")
            group = reviewed_groups.get(line_item_id)
            if group:
                merged_rows.extend(group)
                used_groups.add(line_item_id)
            else:
                merged_rows.append(row)
        for base_id, group in reviewed_groups.items():
            if base_id not in used_groups:
                merged_rows.extend(group)
        approved_mapping["rows"] = merged_rows
    snapshot = [
        {
            field: (
                row.get(field)
                if row.get(field) is not None
                else (source_by_id.get(str(row.get("lineItemId") or "").split(":split:", 1)[0], {}) or {}).get(field)
            )
            for field in snapshot_fields
        }
        for row in approved_mapping["rows"]
    ]
    await prisma.execute_raw(
        """
        UPDATE aiextraction.bills_of_lading
        SET raw_data = COALESCE(raw_data, '{}'::jsonb)
          || jsonb_build_object(
               'containerMappingApproved', true,
               'containerMappingApprovedAt', NOW()::text,
               'containerMappingRows', $3::jsonb
             ),
            updated_at = NOW()
        WHERE document_id::text = $1::text
          AND EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = document_id AND d.uploaded_by::text = $2::text
          )
        """,
        bol_document_id,
        uploaded_by,
        json.dumps(snapshot),
    )
    return {
        "ok": True,
        "updated": len(assignments),
        "mappingApproved": True,
        "rows": snapshot,
    }


__all__ = ["build_container_mapping", "save_container_mapping"]
