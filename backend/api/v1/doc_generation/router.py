import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import get_prisma
from doc_generation import DOC_GEN_SCHEMAS, get_doc_gen_schema
from helpers.config import settings
from helpers.dependencies import get_current_user

GeneratedDocType = Literal["PACKING_LIST", "US_PACKING_LIST", "ENTRY_SUMMARY"]

router = APIRouter(prefix=settings.API_SLUG + "/doc-generation", tags=["Document Generation"])

BACKEND_ROOT = Path(__file__).resolve().parents[3]
DOCGEN_SQL_DIR = BACKEND_ROOT / "doc_generation"
_DOCGEN_DB_READY = False


class CreateDraftRequest(BaseModel):
    generatedDocType: GeneratedDocType
    sourceDocumentIds: dict[str, str] = Field(default_factory=dict)


class FieldValue(BaseModel):
    targetField: str
    targetLabel: str
    value: str | None
    sourceDoc: str
    sourceDocumentId: str | None = None
    sourceField: str | None = None
    sourceLabel: str | None = None
    mappingType: str
    validation: str | None = None
    validationSeverity: str | None = None
    validationStatus: str = "pending"
    mono: bool = False


class SectionValue(BaseModel):
    sectionLabel: str
    fields: list[FieldValue]


class DraftPayload(BaseModel):
    draftId: str
    generatedDocType: GeneratedDocType
    displayName: str
    status: str
    schemaVersion: int
    sourceDocs: list[str]
    sourceDocumentIds: dict[str, str]
    sections: list[SectionValue]
    lineItems: list[dict[str, Any]]
    containers: list[dict[str, Any]]
    stats: dict[str, int]
    createdAt: str | None = None
    updatedAt: str | None = None


def _camel_to_snake(value: str) -> str:
    value = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", value)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value).lower()


def _coerce_json(value: Any) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("[") or stripped.startswith("{"):
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                return value
    return value


def _as_list(value: Any) -> list[dict[str, Any]]:
    value = _coerce_json(value)
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def _decimal(value: Any) -> Decimal:
    if value is None:
        return Decimal("0")
    cleaned = re.sub(r"[^0-9.\-]", "", str(value))
    if not cleaned:
        return Decimal("0")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return Decimal("0")


def _format_decimal(value: Decimal) -> str:
    return f"{value:,.2f}"


def _format_total(value: Decimal) -> str:
    if value == value.to_integral_value():
        return f"{value:,.0f}"
    return f"{value:,.2f}"


def _sum_line_item_values(items: list[dict[str, Any]], *keys: str) -> tuple[Decimal, bool]:
    total = Decimal("0")
    found = False
    for item in items:
        for key in keys:
            value = item.get(key)
            if value is None or str(value).strip() == "":
                continue
            total += _decimal(value)
            found = True
            break
    return total, found


def _sum_package_counts(items: list[dict[str, Any]]) -> tuple[Decimal, bool]:
    total = Decimal("0")
    found = False
    for item in items:
        count, _kind = _parse_package(_item_value(item, "packageDescription", "package_description", "package", "packages"))
        if not count:
            continue
        total += _decimal(count)
        found = True
    return total, found


def _first_non_empty(*values: Any) -> str | None:
    for value in values:
        if value is not None and str(value).strip() != "":
            return str(value)
    return None


def _item_value(item: dict[str, Any], *keys: str) -> str | None:
    return _first_non_empty(*(item.get(key) for key in keys))


def _parse_package(value: Any) -> tuple[str | None, str | None]:
    text = _first_non_empty(value)
    if not text:
        return None, None
    match = re.search(r"\b(\d+)\s*(PKGS?|PACKAGES?|BOX(?:ES)?|CARTONS?|BUNDLES?|NOS?|PCS?)\b", text, re.IGNORECASE)
    if not match:
        return None, None
    kind = match.group(2).replace(".", "").upper()
    if kind.startswith("PKG") or kind.startswith("PACKAGE"):
        kind = "PKGS"
    return match.group(1), kind


def _raw_line_items(row: dict[str, Any]) -> list[dict[str, Any]]:
    raw_data = _coerce_json(row.get("raw_data"))
    if not isinstance(raw_data, dict):
        return []
    for key in ("lineItems", "line_items", "items"):
        raw_items = _as_list(raw_data.get(key))
        if raw_items:
            return raw_items
    return []


def _merge_missing_fields(base: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in fallback.items():
        if key not in merged or merged.get(key) is None or str(merged.get(key)).strip() == "":
            merged[key] = value
    return merged


def _source_line_items(row: dict[str, Any]) -> list[dict[str, Any]]:
    source_items = _as_list(row.get("line_items"))
    raw_items = _raw_line_items(row)
    if not source_items:
        return raw_items
    if not raw_items:
        return source_items
    return [
        _merge_missing_fields(item, raw_items[index] if index < len(raw_items) else {})
        for index, item in enumerate(source_items)
    ]


def _row_value(row: dict[str, Any], source_field: str | None) -> str | None:
    if not source_field or source_field.startswith("lineItems"):
        return None
    if source_field == "today()":
        return date.today().isoformat()
    if source_field.startswith("OPL-"):
        bol_number = row.get("bol_number") or "BOL"
        return f"OPL-{bol_number}-001"
    if source_field == "01 (consumption)":
        return "01"
    key = _camel_to_snake(source_field)
    value = row.get(key)
    if value is None and source_field == "exporterAddress":
        value = row.get("exporter_address")
    if value is None:
        return None
    return str(value)


def _calculated_field_value(target_field: str, row: dict[str, Any]) -> str | None:
    line_items = _source_line_items(row)

    if target_field == "totalLines":
        return str(len(line_items))

    if target_field == "totalBundles":
        total, found = _sum_line_item_values(line_items, "noOfBundles", "noOfPackages", "bundles")
        if not found:
            total, found = _sum_package_counts(line_items)
        return _format_total(total) if found else None

    if target_field in {"totalQty", "totalPiecesAggregate"}:
        total, found = _sum_line_item_values(line_items, "totalQtyInPcs", "quantity", "quantityTotal")
        if found:
            return _format_total(total)
        return _first_non_empty(row.get("total_qty"), row.get("total_quantity"))

    if target_field == "totalNetWeightKgs":
        total, found = _sum_line_item_values(line_items, "netWeightKgs", "netWeight")
        return _format_total(total) if found else None

    if target_field == "totalGrossWeightKgs":
        total, found = _sum_line_item_values(line_items, "grossWeightKgs", "grossWeight")
        if found:
            return _format_total(total)
        return _first_non_empty(row.get("total_gross_weight_kgs"), row.get("gross_weight"))

    if target_field == "totalWeightLbs":
        kilograms = _first_non_empty(row.get("total_gross_weight_kgs"), row.get("gross_weight"))
        if kilograms is None:
            total, found = _sum_line_item_values(line_items, "grossWeightKgs", "grossWeight")
            if not found:
                return None
            kilograms = _format_total(total)
        return _format_decimal(_decimal(kilograms) * Decimal("2.20462"))

    return None


def _field_status(mapping_type: str, value: str | None) -> str:
    if mapping_type == "manual":
        return "manual_required"
    if value is None or value == "":
        return "missing"
    return "valid"


def _build_sections(
    *,
    generated_doc_type: str,
    row: dict[str, Any],
    source_document_ids: dict[str, str],
) -> list[SectionValue]:
    schema = get_doc_gen_schema(generated_doc_type)
    if not schema:
        raise HTTPException(status_code=400, detail="Unsupported generated document type")

    sections: list[SectionValue] = []
    for section in schema["sections"]:
        fields: list[FieldValue] = []
        for mapping in section["mappings"]:
            target_field = mapping["targetField"]
            if "[]" in target_field:
                continue

            mapping_type = mapping["mappingType"]
            value = _row_value(row, mapping.get("sourceField"))
            if mapping_type == "manual":
                value = None
            if mapping_type == "derived":
                value = _calculated_field_value(target_field, row)

            source_doc = mapping["sourceDoc"]
            fields.append(
                FieldValue(
                    targetField=target_field,
                    targetLabel=mapping["targetLabel"],
                    value=value,
                    sourceDoc=source_doc,
                    sourceDocumentId=source_document_ids.get(source_doc),
                    sourceField=mapping.get("sourceField"),
                    sourceLabel=mapping.get("sourceLabel"),
                    mappingType=mapping_type,
                    validation=mapping.get("validation"),
                    validationSeverity=mapping.get("validationSeverity"),
                    validationStatus=_field_status(mapping_type, value),
                    mono=bool(mapping.get("mono", False)),
                )
            )
        if fields:
            sections.append(SectionValue(sectionLabel=section["sectionLabel"], fields=fields))

    return sections


def _build_line_items(generated_doc_type: str, row: dict[str, Any]) -> list[dict[str, Any]]:
    source_items = _source_line_items(row)
    if generated_doc_type == "ENTRY_SUMMARY":
        return [
            {
                "lineNo": index + 1,
                "description": item.get("productDescription"),
                "enteredValue": item.get("lineTotal"),
                "htsNumber": None,
                "dutyRate": None,
                "dutyAmount": None,
            }
            for index, item in enumerate(source_items)
        ]
    if generated_doc_type == "US_PACKING_LIST":
        return [
            {
                "lineNo": index + 1,
                "partNumber": item.get("productCode"),
                "description": item.get("productDescription"),
                "quantity": item.get("totalQtyInPcs"),
                "bundles": item.get("noOfBundles"),
                "grossWeight": item.get("grossWeightKgs"),
                "netWeight": item.get("netWeightKgs"),
                "marksAndNumbers": None,
            }
            for index, item in enumerate(source_items)
        ]
    return [_build_packing_list_line_item(index, item) for index, item in enumerate(source_items)]


def _build_packing_list_line_item(index: int, item: dict[str, Any]) -> dict[str, Any]:
    package_count, package_kind = _parse_package(
        _item_value(item, "packageDescription", "package_description", "package", "packages")
    )
    description = _item_value(
        item,
        "productDescription",
        "product_description",
        "description",
        "itemDescription",
        "item_description",
        "packageDescription",
        "package_description",
        "productSpecification",
        "product_specification",
    )
    quantity = _item_value(item, "quantity", "totalQtyInPcs", "quantityTotal", "qty")
    no_of_bundles = _item_value(item, "noOfPackages", "no_of_packages", "noOfBundles", "bundles") or package_count
    kind_of_pkg = _item_value(item, "kindOfPkg", "kind_of_pkg", "packageType", "package_type") or package_kind

    return {
        "lineNo": index + 1,
        "hsnCode": _item_value(item, "hsnCode", "hsn_code"),
        "itemCode": _item_value(item, "productCode", "product_code", "itemCode", "item_code"),
        "productCode": _item_value(item, "productCode", "product_code", "itemCode", "item_code"),
        "productDesc": description,
        "productDescription": description,
        "productSpecification": _item_value(item, "productSpecification", "product_specification"),
        "totalQtyInPcs": quantity,
        "quantity": quantity,
        "noOfBundles": no_of_bundles,
        "kindOfPkg": kind_of_pkg,
        "containerNo": _item_value(item, "containerNo", "container_no", "containerNumber", "container_number", "container"),
        "sealNo": _item_value(item, "sealNo", "seal_no", "sealNumber", "seal_number", "seal"),
        "grossWeight": _item_value(item, "grossWeight", "gross_weight", "grossWeightKgs", "gross_weight_kgs"),
        "grossWeightKgs": _item_value(item, "grossWeightKgs", "gross_weight_kgs", "grossWeight", "gross_weight"),
        "netWeight": _item_value(item, "netWeight", "net_weight", "netWeightKgs", "net_weight_kgs"),
        "netWeightKgs": _item_value(item, "netWeightKgs", "net_weight_kgs", "netWeight", "net_weight"),
    }


def _build_stats(schema: dict[str, Any], sections: list[SectionValue]) -> dict[str, int]:
    valid = sum(1 for section in sections for field in section.fields if field.validationStatus == "valid")
    missing = sum(1 for section in sections for field in section.fields if field.validationStatus == "missing")
    manual = sum(1 for section in sections for field in section.fields if field.validationStatus == "manual_required")
    return {
        "auto": int(schema["autoPopulated"]),
        "calc": int(schema["calculated"]),
        "manual": int(schema["manualInput"]),
        "total": int(schema["totalFields"]),
        "valid": valid,
        "missing": missing,
        "manualRequired": manual,
    }


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


def _split_sql_statements(sql: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    in_single_quote = False
    in_double_quote = False
    dollar_tag: str | None = None
    index = 0

    while index < len(sql):
        char = sql[index]
        nxt = sql[index + 1] if index + 1 < len(sql) else ""

        if dollar_tag:
            current.append(char)
            if sql.startswith(dollar_tag, index):
                current.extend(sql[index + 1 : index + len(dollar_tag)])
                index += len(dollar_tag)
                dollar_tag = None
                continue
            index += 1
            continue

        if not in_single_quote and not in_double_quote and char == "-" and nxt == "-":
            while index < len(sql) and sql[index] != "\n":
                index += 1
            continue

        if not in_single_quote and not in_double_quote and char == "$":
            match = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", sql[index:])
            if match:
                dollar_tag = match.group(0)
                current.append(dollar_tag)
                index += len(dollar_tag)
                continue

        if char == "'" and not in_double_quote:
            current.append(char)
            if in_single_quote and nxt == "'":
                current.append(nxt)
                index += 2
                continue
            in_single_quote = not in_single_quote
            index += 1
            continue

        if char == '"' and not in_single_quote:
            in_double_quote = not in_double_quote
            current.append(char)
            index += 1
            continue

        if char == ";" and not in_single_quote and not in_double_quote:
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current = []
            index += 1
            continue

        current.append(char)
        index += 1

    tail = "".join(current).strip()
    if tail:
        statements.append(tail)
    return statements


async def _ensure_doc_generation_db(prisma) -> None:
    global _DOCGEN_DB_READY
    if _DOCGEN_DB_READY:
        return

    for sql_file in ("tables.sql", "views.sql"):
        path = DOCGEN_SQL_DIR / sql_file
        if not path.exists():
            raise RuntimeError(f"Missing doc generation SQL file: {path}")
        for statement in _split_sql_statements(path.read_text(encoding="utf-8")):
            try:
                await _execute_raw(prisma, statement)
            except Exception:
                if statement.lstrip().upper().startswith("CREATE EXTENSION"):
                    continue
                if sql_file == "views.sql":
                    continue
                raise

    _DOCGEN_DB_READY = True


async def _select_source_row(prisma, generated_doc_type: str, source_ids: dict[str, str], user_id: str) -> dict[str, Any]:
    if generated_doc_type == "PACKING_LIST":
        document_id = source_ids.get("SALES_INVOICE")
        if document_id:
            sql = """
                SELECT
                  d.id AS source_document_id,
                  si.id AS sales_invoice_id,
                  si.invoice_no,
                  si.invoice_date,
                  si.buyer_po_no,
                  si.buyer_po_date,
                  si.zetwerk_ref,
                  si.other_references,
                  si.exporter_name,
                  si.exporter_address,
                  si.buyer_name,
                  si.buyer_address,
                  si.consignee_name,
                  si.consignee_address,
                  si.gstin,
                  si.iec,
                  si.ship_to,
                  si.port_of_loading,
                  si.port_of_discharge,
                  si.country_of_origin,
                  si.country_of_final_destination,
                  si.final_destination,
                  si.place_of_receipt,
                  si.vessel_flight_no,
                  si.gross_weight,
                  si.total_quantity,
                  si.pre_carriage_by,
                  si.signatory_name,
                  si.signatory_designation,
                  si.din_number,
                  si.raw_data,
                  COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'hsnCode', li.hsn_code,
                        'productCode', li.product_code,
                        'productDescription', li.product_description,
                        'productSpecification', li.product_specification,
                        'packageDescription', li.package_description,
                        'productMarks', li.product_marks,
                        'quantity', li.quantity,
                        'quantityTotal', li.quantity_total,
                        'noOfPackages', li.no_of_packages,
                        'kindOfPkg', li.kind_of_pkg,
                        'containerNo', li.container_no,
                        'sealNo', li.seal_no,
                        'lineTotal', li.line_total
                      )
                      ORDER BY li.id
                    ) FILTER (WHERE li.id IS NOT NULL),
                    '[]'::jsonb
                  ) AS line_items
                FROM public.documents d
                JOIN aiextraction.sales_invoice_extractions si ON si.document_id = d.id
                LEFT JOIN aiextraction.sales_invoice_line_items li ON li.sales_invoice_id = si.id
                WHERE d.is_deleted = false
                  AND d.uploaded_by = $1
                  AND d.id = $2::uuid
                GROUP BY d.id, si.id
                LIMIT 1
            """
            rows = await _query_raw(prisma, sql, user_id, document_id)
        else:
            sql = """
                SELECT
                  d.id AS source_document_id,
                  si.id AS sales_invoice_id,
                  si.invoice_no,
                  si.invoice_date,
                  si.buyer_po_no,
                  si.buyer_po_date,
                  si.zetwerk_ref,
                  si.other_references,
                  si.exporter_name,
                  si.exporter_address,
                  si.buyer_name,
                  si.buyer_address,
                  si.consignee_name,
                  si.consignee_address,
                  si.gstin,
                  si.iec,
                  si.ship_to,
                  si.port_of_loading,
                  si.port_of_discharge,
                  si.country_of_origin,
                  si.country_of_final_destination,
                  si.final_destination,
                  si.place_of_receipt,
                  si.vessel_flight_no,
                  si.gross_weight,
                  si.total_quantity,
                  si.pre_carriage_by,
                  si.signatory_name,
                  si.signatory_designation,
                  si.din_number,
                  si.raw_data,
                  COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'hsnCode', li.hsn_code,
                        'productCode', li.product_code,
                        'productDescription', li.product_description,
                        'productSpecification', li.product_specification,
                        'packageDescription', li.package_description,
                        'productMarks', li.product_marks,
                        'quantity', li.quantity,
                        'quantityTotal', li.quantity_total,
                        'noOfPackages', li.no_of_packages,
                        'kindOfPkg', li.kind_of_pkg,
                        'containerNo', li.container_no,
                        'sealNo', li.seal_no,
                        'lineTotal', li.line_total
                      )
                      ORDER BY li.id
                    ) FILTER (WHERE li.id IS NOT NULL),
                    '[]'::jsonb
                  ) AS line_items
                FROM public.documents d
                JOIN aiextraction.sales_invoice_extractions si ON si.document_id = d.id
                LEFT JOIN aiextraction.sales_invoice_line_items li ON li.sales_invoice_id = si.id
                WHERE d.uploaded_by = $1 AND d.is_deleted = false
                GROUP BY d.id, si.id
                ORDER BY d.created_at DESC
                LIMIT 1
            """
            rows = await _query_raw(prisma, sql, user_id)
        if rows:
            rows[0]["_source_document_ids"] = {"SALES_INVOICE": str(rows[0]["source_document_id"])}
            return rows[0]

    if generated_doc_type == "US_PACKING_LIST":
        rows = await _query_raw(
            prisma,
            """
            SELECT v.*
            FROM docgen.v_us_packing_list_source v
            JOIN public.documents pl_doc ON pl_doc.id = v.packing_list_document_id
            JOIN public.documents bol_doc ON bol_doc.id = v.bol_document_id
            WHERE pl_doc.uploaded_by = $1
              AND bol_doc.uploaded_by = $1
              AND ($2::uuid IS NULL OR v.packing_list_document_id = $2::uuid)
              AND ($3::uuid IS NULL OR v.bol_document_id = $3::uuid)
            ORDER BY pl_doc.created_at DESC, bol_doc.created_at DESC
            LIMIT 1
            """,
            user_id,
            source_ids.get("PACKING_LIST"),
            source_ids.get("BILL_OF_LADING"),
        )
        if rows:
            rows[0]["_source_document_ids"] = {
                "PACKING_LIST": str(rows[0]["packing_list_document_id"]),
                "BILL_OF_LADING": str(rows[0]["bol_document_id"]),
            }
            return rows[0]

    if generated_doc_type == "ENTRY_SUMMARY":
        rows = await _query_raw(
            prisma,
            """
            SELECT v.*
            FROM docgen.v_entry_summary_source v
            JOIN public.documents bol_doc ON bol_doc.id = v.bol_document_id
            JOIN public.documents si_doc ON si_doc.id = v.sales_invoice_document_id
            WHERE bol_doc.uploaded_by = $1
              AND si_doc.uploaded_by = $1
              AND ($2::uuid IS NULL OR v.bol_document_id = $2::uuid)
              AND ($3::uuid IS NULL OR v.sales_invoice_document_id = $3::uuid)
            ORDER BY bol_doc.created_at DESC, si_doc.created_at DESC
            LIMIT 1
            """,
            user_id,
            source_ids.get("BILL_OF_LADING"),
            source_ids.get("SALES_INVOICE"),
        )
        if rows:
            rows[0]["_source_document_ids"] = {
                "BILL_OF_LADING": str(rows[0]["bol_document_id"]),
                "SALES_INVOICE": str(rows[0]["sales_invoice_document_id"]),
            }
            return rows[0]

    raise HTTPException(
        status_code=404,
        detail=(
            "No eligible source documents found. Install backend/doc_generation/views.sql "
            "and make sure the required OCR documents exist for this generated document type."
        ),
    )


async def _persist_draft(prisma, payload: DraftPayload, user_id: str) -> None:
    await _execute_raw(
        prisma,
        """
        INSERT INTO docgen.drafts
          (id, generated_doc_type, schema_version, status, source_document_ids, rendered_payload, created_by, created_at, updated_at)
        VALUES
          ($1::uuid, $2, $3, 'DRAFT'::docgen."DocGenerationStatus", $4::jsonb, $5::jsonb, $6::uuid, NOW(), NOW())
        """,
        payload.draftId,
        payload.generatedDocType,
        payload.schemaVersion,
        json.dumps(payload.sourceDocumentIds),
        payload.model_dump_json(),
        user_id,
    )

    for line_no, item in enumerate(payload.lineItems, start=1):
        await _execute_raw(
            prisma,
            """
            INSERT INTO docgen.draft_line_items (draft_id, line_no, payload, created_at, updated_at)
            VALUES ($1::uuid, $2, $3::jsonb, NOW(), NOW())
            """,
            payload.draftId,
            line_no,
            json.dumps(item),
        )

    for container in payload.containers:
        await _execute_raw(
            prisma,
            """
            INSERT INTO docgen.container_allocations
              (draft_id, container_number, seal_number, payload, created_at, updated_at)
            VALUES ($1::uuid, $2, $3, $4::jsonb, NOW(), NOW())
            """,
            payload.draftId,
            container.get("containerNumber"),
            container.get("sealNumber"),
            json.dumps(container),
        )


def _build_payload(generated_doc_type: str, draft_id: str, row: dict[str, Any]) -> DraftPayload:
    schema = get_doc_gen_schema(generated_doc_type)
    if not schema:
        raise HTTPException(status_code=400, detail="Unsupported generated document type")

    source_document_ids = row.get("_source_document_ids") or {}
    sections = _build_sections(
        generated_doc_type=generated_doc_type,
        row=row,
        source_document_ids=source_document_ids,
    )

    return DraftPayload(
        draftId=draft_id,
        generatedDocType=generated_doc_type,  # type: ignore[arg-type]
        displayName=schema["displayName"],
        status="DRAFT",
        schemaVersion=1,
        sourceDocs=schema["sourceDocs"],
        sourceDocumentIds=source_document_ids,
        sections=sections,
        lineItems=_build_line_items(generated_doc_type, row),
        containers=_as_list(row.get("containers")),
        stats=_build_stats(schema, sections),
    )


@router.get("/schemas")
async def list_doc_generation_schemas(user=Depends(get_current_user)):
    return list(DOC_GEN_SCHEMAS.values())


@router.post("/drafts", response_model=DraftPayload)
async def create_doc_generation_draft(request: CreateDraftRequest, user=Depends(get_current_user)):
    prisma = await get_prisma()
    try:
        await _ensure_doc_generation_db(prisma)
        row = await _select_source_row(
            prisma=prisma,
            generated_doc_type=request.generatedDocType,
            source_ids=request.sourceDocumentIds,
            user_id=str(user.id),
        )
        payload = _build_payload(request.generatedDocType, str(uuid4()), row)
        await _persist_draft(prisma, payload, str(user.id))
        return payload
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create document generation draft: {exc}",
        )


@router.get("/drafts/{draft_id}", response_model=DraftPayload)
async def get_doc_generation_draft(draft_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    try:
        rows = await _query_raw(
            prisma,
            """
            SELECT rendered_payload, created_at, updated_at
            FROM docgen.drafts
            WHERE id = $1::uuid AND created_by = $2::uuid
            LIMIT 1
            """,
            draft_id,
            str(user.id),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch document generation draft: {exc}")

    if not rows:
        raise HTTPException(status_code=404, detail="Draft not found")

    payload = _coerce_json(rows[0]["rendered_payload"])
    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail="Draft payload is invalid")

    payload["createdAt"] = str(rows[0].get("created_at")) if rows[0].get("created_at") else None
    payload["updatedAt"] = str(rows[0].get("updated_at")) if rows[0].get("updated_at") else None
    return DraftPayload(**payload)
