import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Literal
from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import get_prisma
from doc_generation import DOC_GEN_SCHEMAS, get_doc_gen_schema
from doc_generation.db_setup import ensure_doc_generation_views
from helpers.config import settings
from helpers.dependencies import get_current_user, get_session_token
from helpers.rbac_data_access import access_role, can_generate_document_type, role_has_activity
from helpers.rbac import authorize_activity, require_activity

GeneratedDocType = Literal["PACKING_LIST", "US_PACKING_LIST", "ENTRY_SUMMARY"]

router = APIRouter(prefix=settings.API_SLUG + "/doc-generation", tags=["Document Generation"])

SHARED_DOCGEN_SOURCE_ROLES = {"SUPER_ADMIN", "ADMIN", "OPS_MANAGER", "INDIA_LOGISTICS"}


class CreateDraftRequest(BaseModel):
    generatedDocType: GeneratedDocType
    sourceDocumentIds: dict[str, str] = Field(default_factory=dict)


class UpdatePackageTypeRequest(BaseModel):
    lineItemIndex: int = Field(ge=0)
    packageType: str = Field(min_length=1, max_length=80)
    customPackageTypes: list[str] = Field(default_factory=list)


class UpdateDraftRequest(BaseModel):
    fields: dict[str, str | None] = Field(default_factory=dict)
    lineItems: list[dict[str, Any]] | None = None
    status: Literal["DRAFT", "IN_REVIEW", "CONFIRMED", "GENERATED"] = "DRAFT"


def _require_doc_generation_activity(user: Any) -> None:
    if not role_has_activity(user, "documents.generate_draft"):
        raise HTTPException(status_code=403, detail="Permission denied: missing activity documents.generate_draft")


def _has_shared_docgen_access(user: Any) -> bool:
    return access_role(user).upper().replace("-", "_").replace(" ", "_") in SHARED_DOCGEN_SOURCE_ROLES


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
    customPackageTypes: list[str] = Field(default_factory=list)
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


def _positive_decimal_or_none(value: Any) -> Decimal | None:
    parsed = _decimal(value)
    return parsed if parsed > 0 else None


def _divide_as_total(numerator: Any, denominator: Any) -> str | None:
    top = _positive_decimal_or_none(numerator)
    bottom = _positive_decimal_or_none(denominator)
    if top is None or bottom is None:
        return None
    return _format_total(top / bottom)


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


def _sum_bundle_values(items: list[dict[str, Any]]) -> tuple[Decimal, bool]:
    total = Decimal("0")
    found = False
    for item in items:
        value = _item_value(
            item,
            "noOfBundles",
            "bundles",
            "bundleCount",
            "bundle_count",
            "noOfPackages",
            "no_of_packages",
            "packageCount",
            "package_count",
        )
        if value is None:
            value, _package_kind = _parse_package(
                _item_value(item, "packageDescription", "package_description", "package", "packages")
            )
        if value is None or str(value).strip() == "":
            continue
        total += _decimal(value)
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


def _line_item_identity(item: dict[str, Any], *, include_container: bool = True) -> tuple[str, ...]:
    """Return stable business keys used to align persisted rows to OCR order."""
    keys = [
        _item_value(item, "productCode", "product_code", "itemCode", "item_code"),
        _item_value(item, "quantity", "totalQtyInPcs", "quantityTotal", "qty"),
    ]
    if include_container:
        keys.append(_item_value(
            item, "containerNo", "container_no", "containerNumber", "container_number", "container"
        ))
    return tuple(re.sub(r"[^A-Z0-9.]+", "", str(value or "").upper()) for value in keys)


def _source_line_items(row: dict[str, Any]) -> list[dict[str, Any]]:
    source_items = _as_list(row.get("line_items"))
    raw_items = _raw_line_items(row)
    if not source_items:
        return raw_items
    if not raw_items:
        return source_items

    # The SQL view historically aggregated persisted children by UUID, which
    # does not preserve the row order printed on the Sales Invoice. Keep the
    # OCR array as the ordering authority and match persisted/editable values
    # back by product + quantity + container (then product + quantity).
    unused = set(range(len(source_items)))
    ordered: list[dict[str, Any]] = []
    for raw_item in raw_items:
        match_index: int | None = None
        for include_container in (True, False):
            identity = _line_item_identity(raw_item, include_container=include_container)
            for index in unused:
                if _line_item_identity(source_items[index], include_container=include_container) == identity:
                    match_index = index
                    break
            if match_index is not None:
                break
        if match_index is None:
            ordered.append(raw_item)
            continue
        unused.remove(match_index)
        ordered.append(_merge_missing_fields(source_items[match_index], raw_item))

    # Retain any database-only rows after the source-ordered rows.
    ordered.extend(source_items[index] for index in sorted(unused))
    return ordered


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
        total, found = _sum_bundle_values(line_items)
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

    if target_field in {"mpfTotal", "hmfTotal", "totalOtherFees", "totalOther", "grandTotal"}:
        entered_value = _decimal(_first_non_empty(row.get("taxable_value"), row.get("total_amount")))
        mpf = entered_value * Decimal("0.003464")
        hmf = entered_value * Decimal("0.00125")
        if target_field == "mpfTotal":
            return _format_decimal(mpf)
        if target_field == "hmfTotal":
            return _format_decimal(hmf)
        if target_field in {"totalOtherFees", "totalOther"}:
            return _format_decimal(mpf + hmf)
        tax = _decimal(row.get("tax_amount"))
        return _format_decimal(mpf + hmf + tax)

    if target_field == "totalDuty":
        total, found = _sum_line_item_values(line_items, "dutyAmount")
        return _format_decimal(total) if found else None

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
                "lineMerchandiseDescription": item.get("productDescription"),
                "lineHtsusNumber": None,
                "quantity": item.get("quantity"),
                "quantityUnit": item.get("unit"),
                "enteredValue": item.get("lineTotal"),
                "dutyRate": None,
                "dutyAmount": None,
            }
            for index, item in enumerate(source_items)
        ]
    if generated_doc_type == "US_PACKING_LIST":
        return [
            {
                "lineNo": index + 1,
                "hsnCode": _item_value(item, "hsnCode", "hsn_code", "hsCode", "hs_code"),
                "productCode": _item_value(item, "productCode", "product_code", "itemCode", "item_code", "partNumber"),
                "productDesc": _item_value(item, "productDesc", "productDescription", "product_description", "description", "itemDescription"),
                "totalQtyInPcs": _item_value(item, "totalQtyInPcs", "total_qty_in_pcs", "quantity", "quantityTotal", "qty"),
                "noOfBundles": _item_value(item, "noOfBundles", "no_of_bundles", "bundles", "bundleCount", "packageCount"),
                "grossWeightKgs": _item_value(item, "grossWeightKgs", "gross_weight_kgs", "grossWeightKg", "grossWeight", "gross_weight"),
                "netWeightKgs": _item_value(item, "netWeightKgs", "net_weight_kgs", "netWeightKg", "netWeight", "net_weight"),
                "partNumber": _item_value(item, "productCode", "product_code", "itemCode", "item_code", "partNumber"),
                "description": _item_value(item, "productDesc", "productDescription", "product_description", "description", "itemDescription"),
                "quantity": _item_value(item, "totalQtyInPcs", "total_qty_in_pcs", "quantity", "quantityTotal", "qty"),
                "bundles": _item_value(item, "noOfBundles", "no_of_bundles", "bundles", "bundleCount", "packageCount"),
                "grossWeight": _item_value(item, "grossWeightKgs", "gross_weight_kgs", "grossWeightKg", "grossWeight", "gross_weight"),
                "netWeight": _item_value(item, "netWeightKgs", "net_weight_kgs", "netWeightKg", "netWeight", "net_weight"),
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
    no_of_bundles = _item_value(
        item,
        "noOfBundles",
        "bundles",
        "bundleCount",
        "bundle_count",
        "noOfPackages",
        "no_of_packages",
        "packageCount",
        "package_count",
    ) or package_count
    kind_of_pkg = _item_value(item, "kindOfPkg", "kind_of_pkg", "packageType", "package_type") or package_kind
    qty_per_bundle = _divide_as_total(quantity, no_of_bundles)

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
        "qtyPerBundle": qty_per_bundle,
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


async def _select_source_row(
    prisma,
    generated_doc_type: str,
    source_ids: dict[str, str],
    user_id: str,
    user_role: str | None = None,
) -> dict[str, Any]:
    shared_sources = (user_role or "").upper().replace("-", "_") in SHARED_DOCGEN_SOURCE_ROLES
    if generated_doc_type == "PACKING_LIST":
        document_id = source_ids.get("SALES_INVOICE")
        if document_id:
            if shared_sources:
                rows = await _query_raw(
                    prisma,
                    """
                    SELECT * FROM docgen.v_packing_list_source
                    WHERE source_document_id::text = $1::text
                    LIMIT 1
                    """,
                    document_id,
                )
            else:
                rows = await _query_raw(
                    prisma,
                    """
                    SELECT * FROM docgen.v_packing_list_source
                    WHERE source_document_id::text = $1::text
                      AND uploaded_by::text = $2::text
                    LIMIT 1
                    """,
                    document_id,
                    user_id,
                )
        else:
            if shared_sources:
                rows = await _query_raw(
                    prisma,
                    """
                    SELECT * FROM docgen.v_packing_list_source
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                )
            else:
                rows = await _query_raw(
                    prisma,
                    """
                    SELECT * FROM docgen.v_packing_list_source
                    WHERE uploaded_by::text = $1::text
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    user_id,
                )
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
            WHERE pl_doc.uploaded_by::text = $1::text
              AND bol_doc.uploaded_by::text = $1::text
              AND ($2::text IS NULL OR v.packing_list_document_id::text = $2::text)
              AND ($3::text IS NULL OR v.bol_document_id::text = $3::text)
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

        fallback_where = "" if shared_sources else "AND dr.created_by::text = $1::text"
        fallback_params: tuple[str, ...] = () if shared_sources else (user_id,)
        rows = await _query_raw(
            prisma,
            f"""
            SELECT
              dr.id::text AS packing_list_document_id,
              NULL::text AS bol_document_id,
              dr.id::text AS packing_list_id,
              NULL::text AS bill_of_lading_id,
              NULL::text AS invoice_no,
              NULL::text AS buyer_po_no,
              NULL::text AS zetwerk_ref,
              NULL::text AS country_of_origin,
              NULL::text AS pickup_address,
              NULL::text AS total_qty,
              NULL::text AS total_bundles,
              NULL::text AS total_gross_weight_kgs,
              NULL::text AS bol_number,
              NULL::text AS project_name,
              NULL::text AS carrier_company_name,
              NULL::text AS shipper_name,
              NULL::text AS consignee_name,
              NULL::text AS consignee_address,
              COALESCE(dr.rendered_payload->'lineItems', '[]'::jsonb) AS line_items,
              '[]'::jsonb AS containers
            FROM docgen.drafts dr
            WHERE dr.generated_doc_type = 'PACKING_LIST'
              AND dr.status = 'GENERATED'
              {fallback_where}
              AND jsonb_array_length(COALESCE(dr.rendered_payload->'lineItems', '[]'::jsonb)) > 0
            ORDER BY dr.updated_at DESC
            LIMIT 1
            """,
            *fallback_params,
        )
        if rows:
            rows[0]["_source_document_ids"] = {"PACKING_LIST": str(rows[0]["packing_list_document_id"])}
            return rows[0]

    if generated_doc_type == "ENTRY_SUMMARY":
        rows = await _query_raw(
            prisma,
            """
            SELECT v.*
            FROM docgen.v_entry_summary_source v
            JOIN public.documents bol_doc ON bol_doc.id = v.bol_document_id
            JOIN public.documents si_doc ON si_doc.id = v.sales_invoice_document_id
            WHERE bol_doc.uploaded_by::text = $1::text
              AND si_doc.uploaded_by::text = $1::text
              AND ($2::text IS NULL OR v.bol_document_id::text = $2::text)
              AND ($3::text IS NULL OR v.sales_invoice_document_id::text = $3::text)
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
            "No eligible source documents found. Upload and extract the required source documents "
            "before generating this draft."
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
            INSERT INTO docgen.draft_line_items (id, draft_id, line_no, payload, created_at, updated_at)
            VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, NOW(), NOW())
            """,
            str(uuid4()),
            payload.draftId,
            line_no,
            json.dumps(item),
        )

    for container in payload.containers:
        await _execute_raw(
            prisma,
            """
            INSERT INTO docgen.container_allocations
              (id, draft_id, container_number, seal_number, payload, created_at, updated_at)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, NOW(), NOW())
            """,
            str(uuid4()),
            payload.draftId,
            container.get("containerNumber"),
            container.get("sealNumber"),
            json.dumps(container),
        )


async def _replace_draft_payload(prisma, payload: DraftPayload) -> None:
    await _execute_raw(
        prisma,
        """
        UPDATE docgen.drafts
        SET schema_version = $2,
            status = 'DRAFT'::docgen."DocGenerationStatus",
            source_document_ids = $3::jsonb,
            rendered_payload = $4::jsonb,
            updated_at = NOW()
        WHERE id::text = $1::text
        """,
        payload.draftId,
        payload.schemaVersion,
        json.dumps(payload.sourceDocumentIds),
        payload.model_dump_json(),
    )
    await _execute_raw(
        prisma,
        "DELETE FROM docgen.draft_line_items WHERE draft_id::text = $1::text",
        payload.draftId,
    )
    await _execute_raw(
        prisma,
        "DELETE FROM docgen.container_allocations WHERE draft_id::text = $1::text",
        payload.draftId,
    )

    for line_no, item in enumerate(payload.lineItems, start=1):
        await _execute_raw(
            prisma,
            """
            INSERT INTO docgen.draft_line_items (id, draft_id, line_no, payload, created_at, updated_at)
            VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, NOW(), NOW())
            """,
            str(uuid4()),
            payload.draftId,
            line_no,
            json.dumps(item),
        )

    for container in payload.containers:
        await _execute_raw(
            prisma,
            """
            INSERT INTO docgen.container_allocations
              (id, draft_id, container_number, seal_number, payload, created_at, updated_at)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, NOW(), NOW())
            """,
            str(uuid4()),
            payload.draftId,
            container.get("containerNumber"),
            container.get("sealNumber"),
            json.dumps(container),
        )


async def refresh_generated_drafts_for_source_document(
    *,
    prisma,
    source_document_id: str,
    user_id: str,
) -> dict[str, int]:
    await ensure_doc_generation_views(prisma)
    drafts = await _query_raw(
        prisma,
        """
        SELECT id, generated_doc_type, source_document_ids
        FROM docgen.drafts
        WHERE created_by::text = $1::text
        """,
        user_id,
    )
    updated = 0
    skipped = 0
    for draft in drafts:
        draft_id = str(draft["id"])
        generated_doc_type = str(draft["generated_doc_type"])
        source_ids = _coerce_json(draft.get("source_document_ids"))
        if not isinstance(source_ids, dict):
            skipped += 1
            continue
        if source_document_id not in {str(value) for value in source_ids.values()}:
            continue
        try:
            row = await _select_source_row(
                prisma=prisma,
                generated_doc_type=generated_doc_type,
                source_ids={key: str(value) for key, value in source_ids.items()},
                user_id=user_id,
            )
            payload = _build_payload(generated_doc_type, draft_id, row)
            await _replace_draft_payload(prisma, payload)
            updated += 1
        except Exception as exc:
            skipped += 1
            print(f"[docgen][refresh] skipped draftId={draft_id} error={exc}", flush=True)
    return {"eligible": len(drafts), "updated": updated, "skipped": skipped}


async def ensure_packing_list_draft_for_sales_invoice(
    *,
    prisma,
    sales_invoice_document_id: str,
    user_id: str,
    user_role: str | None = None,
) -> str:
    """Create the Packing List draft for a Sales Invoice exactly once."""
    await ensure_doc_generation_views(prisma)
    shared_sources = (user_role or "").upper().replace("-", "_").replace(" ", "_") in SHARED_DOCGEN_SOURCE_ROLES
    created_by_filter = "" if shared_sources else "AND created_by::text = $2::text"
    existing = await _query_raw(
        prisma,
        f"""
        SELECT id
        FROM docgen.drafts
        WHERE generated_doc_type = 'PACKING_LIST'
          AND source_document_ids ->> 'SALES_INVOICE' = $1
          {created_by_filter}
        ORDER BY created_at DESC
        LIMIT 1
        """,
        sales_invoice_document_id,
        user_id,
    )
    if existing:
        return str(existing[0]["id"])

    row = await _select_source_row(
        prisma,
        "PACKING_LIST",
        {"SALES_INVOICE": sales_invoice_document_id},
        user_id,
        user_role,
    )
    deterministic_id = str(
        uuid5(
            NAMESPACE_URL,
            f"ewms:packing-list:{user_id}:{sales_invoice_document_id}",
        )
    )
    payload = _build_payload("PACKING_LIST", deterministic_id, row)
    try:
        await _persist_draft(prisma, payload, user_id)
    except Exception:
        # Concurrent requests may race. The deterministic primary key guarantees
        # that only one draft can win.
        created = await _query_raw(
            prisma,
            """
            SELECT id
            FROM docgen.drafts
            WHERE id::text = $1::text
              AND ($3::boolean OR created_by::text = $2::text)
            LIMIT 1
            """,
            deterministic_id,
            user_id,
            shared_sources,
        )
        if not created:
            raise
    return payload.draftId


async def ensure_packing_list_drafts_for_accessible_sales_invoices(
    *,
    prisma,
    user_id: str,
    user_role: str | None = None,
) -> dict[str, int]:
    """Materialize one Packing List draft for each accessible Sales Invoice source."""
    await ensure_doc_generation_views(prisma)
    shared_sources = (user_role or "").upper().replace("-", "_").replace(" ", "_") in SHARED_DOCGEN_SOURCE_ROLES
    if shared_sources:
        rows = await _query_raw(
            prisma,
            """
            SELECT source_document_id
            FROM docgen.v_packing_list_source
            ORDER BY created_at DESC
            """,
        )
    else:
        rows = await _query_raw(
            prisma,
            """
            SELECT source_document_id
            FROM docgen.v_packing_list_source
            WHERE uploaded_by::text = $1::text
            ORDER BY created_at DESC
            """,
            user_id,
        )

    created_or_existing = 0
    skipped = 0
    for row in rows:
        source_document_id = row.get("source_document_id")
        if not source_document_id:
            skipped += 1
            continue
        try:
            await ensure_packing_list_draft_for_sales_invoice(
                prisma=prisma,
                sales_invoice_document_id=str(source_document_id),
                user_id=user_id,
                user_role=user_role,
            )
            created_or_existing += 1
        except Exception as exc:
            skipped += 1
            print(f"[docgen][packing-list] skipped sourceDocumentId={source_document_id} error={exc}", flush=True)

    return {"eligible": len(rows), "ready": created_or_existing, "skipped": skipped}


async def reorder_existing_packing_list_drafts(prisma) -> dict[str, int]:
    """Align every existing PL draft to its Sales Invoice's printed row order."""
    await ensure_doc_generation_views(prisma)
    drafts = await _query_raw(
        prisma,
        """
        SELECT id, created_by, source_document_ids, rendered_payload
        FROM docgen.drafts
        WHERE generated_doc_type = 'PACKING_LIST'
        ORDER BY created_at ASC
        """,
    )
    updated = 0
    skipped = 0
    mutable_fields = {
        "kindOfPkg",
        "noOfBundles",
        "qtyPerBundle",
        "containerNo",
        "sealNo",
        "netWeight",
        "netWeightKgs",
        "grossWeight",
        "grossWeightKgs",
    }

    for draft in drafts:
        source_ids = _coerce_json(draft.get("source_document_ids"))
        payload = _coerce_json(draft.get("rendered_payload"))
        if not isinstance(source_ids, dict) or not isinstance(payload, dict):
            skipped += 1
            continue
        sales_invoice_document_id = source_ids.get("SALES_INVOICE")
        if not sales_invoice_document_id:
            skipped += 1
            continue
        try:
            source_row = await _select_source_row(
                prisma,
                "PACKING_LIST",
                {"SALES_INVOICE": str(sales_invoice_document_id)},
                str(draft["created_by"]),
            )
        except Exception:
            skipped += 1
            continue

        reordered = _build_line_items("PACKING_LIST", source_row)
        existing = payload.get("lineItems")
        existing = existing if isinstance(existing, list) else []
        unused = set(range(len(existing)))
        merged_rows: list[dict[str, Any]] = []
        for new_row in reordered:
            match_index: int | None = None
            for include_container in (True, False):
                identity = _line_item_identity(new_row, include_container=include_container)
                for index in unused:
                    old_row = existing[index]
                    if isinstance(old_row, dict) and _line_item_identity(
                        old_row, include_container=include_container
                    ) == identity:
                        match_index = index
                        break
                if match_index is not None:
                    break
            merged = dict(new_row)
            if match_index is not None:
                unused.remove(match_index)
                old_row = existing[match_index]
                for field in mutable_fields:
                    if field in old_row and old_row[field] not in (None, ""):
                        merged[field] = old_row[field]
            merged_rows.append(merged)

        if merged_rows == existing:
            continue
        payload["lineItems"] = merged_rows
        await _execute_raw(
            prisma,
            """
            UPDATE docgen.drafts
            SET rendered_payload = $2::jsonb, updated_at = NOW()
            WHERE id::text = $1::text
            """,
            str(draft["id"]),
            json.dumps(payload),
        )
        await _execute_raw(
            prisma,
            "DELETE FROM docgen.draft_line_items WHERE draft_id::text = $1::text",
            str(draft["id"]),
        )
        for line_no, item in enumerate(merged_rows, start=1):
            await _execute_raw(
                prisma,
                """
                INSERT INTO docgen.draft_line_items
                  (id, draft_id, line_no, payload, created_at, updated_at)
                VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, NOW(), NOW())
                """,
                str(uuid4()),
                str(draft["id"]),
                line_no,
                json.dumps(item),
            )
        updated += 1

    return {"eligible": len(drafts), "updated": updated, "skipped": skipped}


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
        schemaVersion=2 if generated_doc_type == "ENTRY_SUMMARY" else 1,
        sourceDocs=schema["sourceDocs"],
        sourceDocumentIds=source_document_ids,
        sections=sections,
        lineItems=_build_line_items(generated_doc_type, row),
        containers=_as_list(row.get("containers")),
        stats=_build_stats(schema, sections),
    )


@router.get("/schemas")
async def list_doc_generation_schemas(
    user=Depends(get_current_user),
):
    _require_doc_generation_activity(user)
    return [
        schema
        for schema in DOC_GEN_SCHEMAS.values()
        if can_generate_document_type(user, schema.get("generatedDocType") or schema.get("docType"))
    ]


@router.post("/drafts", response_model=DraftPayload)
async def create_doc_generation_draft(
    request: CreateDraftRequest,
    user=Depends(get_current_user),
):
    _require_doc_generation_activity(user)
    if not can_generate_document_type(user, request.generatedDocType):
        raise HTTPException(status_code=403, detail="Not allowed to generate this document type")
    prisma = await get_prisma()
    try:
        await ensure_doc_generation_views(prisma)
        user_role = access_role(user)
        shared_sources = _has_shared_docgen_access(user)
        if request.generatedDocType == "PACKING_LIST":
            source_document_id = request.sourceDocumentIds.get("SALES_INVOICE")
            if not source_document_id:
                source_row = await _select_source_row(
                    prisma=prisma,
                    generated_doc_type="PACKING_LIST",
                    source_ids={},
                    user_id=str(user.id),
                    user_role=user_role,
                )
                source_document_id = str(source_row["source_document_id"])
            draft_id = await ensure_packing_list_draft_for_sales_invoice(
                prisma=prisma,
                sales_invoice_document_id=source_document_id,
                user_id=str(user.id),
                user_role=user_role,
            )
            rows = await _query_raw(
                prisma,
                """
                SELECT rendered_payload
                FROM docgen.drafts
                WHERE id::text = $1::text
                  AND ($3::boolean OR created_by::text = $2::text)
                LIMIT 1
                """,
                draft_id,
                str(user.id),
                shared_sources,
            )
            if not rows:
                raise HTTPException(status_code=404, detail="Packing List draft not found")
            return DraftPayload.model_validate(_coerce_json(rows[0]["rendered_payload"]))

        row = await _select_source_row(
            prisma=prisma,
            generated_doc_type=request.generatedDocType,
            source_ids=request.sourceDocumentIds,
            user_id=str(user.id),
            user_role=user_role,
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


@router.get("/drafts", response_model=list[DraftPayload])
async def list_doc_generation_drafts(
    generatedDocType: GeneratedDocType,
    user=Depends(get_current_user),
):
    """Return one draft per source-document set visible to the current role."""
    _require_doc_generation_activity(user)
    if not can_generate_document_type(user, generatedDocType):
        raise HTTPException(status_code=403, detail="Not allowed to generate this document type")
    prisma = await get_prisma()
    try:
        await ensure_doc_generation_views(prisma)
        user_role = access_role(user)
        shared_sources = _has_shared_docgen_access(user)
        if generatedDocType == "PACKING_LIST":
            source_key = "SALES_INVOICE"
            await ensure_packing_list_drafts_for_accessible_sales_invoices(
                prisma=prisma,
                user_id=str(user.id),
                user_role=user_role,
            )
        elif generatedDocType == "US_PACKING_LIST":
            source_key = "PACKING_LIST"
        else:
            source_key = "BILL_OF_LADING"

        rows = await _query_raw(
            prisma,
            """
            SELECT rendered_payload, created_at, updated_at
            FROM (
                SELECT DISTINCT ON (source_document_ids ->> $3)
                       rendered_payload, created_at, updated_at
                FROM docgen.drafts
                WHERE generated_doc_type = $1
                  AND ($4::boolean OR created_by::text = $2::text)
                  AND ($1 <> 'ENTRY_SUMMARY' OR schema_version >= 2)
                  AND source_document_ids ->> $3 IS NOT NULL
                ORDER BY source_document_ids ->> $3, updated_at DESC
            ) latest_drafts
            ORDER BY created_at DESC, updated_at DESC
            """,
            generatedDocType,
            str(user.id),
            source_key,
            shared_sources,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list document generation drafts: {exc}")

    drafts: list[DraftPayload] = []
    for row in rows:
        payload = _coerce_json(row.get("rendered_payload"))
        if not isinstance(payload, dict):
            continue
        payload["createdAt"] = str(row.get("created_at")) if row.get("created_at") else None
        payload["updatedAt"] = str(row.get("updated_at")) if row.get("updated_at") else None
        drafts.append(DraftPayload.model_validate(payload))
    return drafts


@router.get("/drafts/{draft_id}", response_model=DraftPayload)
async def get_doc_generation_draft(
    draft_id: str,
    user=Depends(get_current_user),
):
    _require_doc_generation_activity(user)
    prisma = await get_prisma()
    try:
        shared_sources = _has_shared_docgen_access(user)
        rows = await _query_raw(
            prisma,
            """
            SELECT rendered_payload, created_at, updated_at
            FROM docgen.drafts
            WHERE id::text = $1::text
              AND ($3::boolean OR created_by::text = $2::text)
            LIMIT 1
            """,
            draft_id,
            str(user.id),
            shared_sources,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch document generation draft: {exc}")

    if not rows:
        raise HTTPException(status_code=404, detail="Draft not found")

    payload = _coerce_json(rows[0]["rendered_payload"])
    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail="Draft payload is invalid")
    if not can_generate_document_type(user, payload.get("generatedDocType")):
        raise HTTPException(status_code=403, detail="Not allowed to generate this document type")

    payload["createdAt"] = str(rows[0].get("created_at")) if rows[0].get("created_at") else None
    payload["updatedAt"] = str(rows[0].get("updated_at")) if rows[0].get("updated_at") else None
    return DraftPayload(**payload)


@router.patch("/drafts/{draft_id}/package-type", response_model=DraftPayload)
async def update_draft_package_type(
    draft_id: str,
    request: UpdatePackageTypeRequest,
    user=Depends(get_current_user),
):
    """Persist a Packing List line item's package type and user-defined options."""
    _require_doc_generation_activity(user)
    prisma = await get_prisma()
    shared_sources = _has_shared_docgen_access(user)
    rows = await _query_raw(
        prisma,
        """
        SELECT rendered_payload, created_at
        FROM docgen.drafts
        WHERE id::text = $1::text
          AND ($3::boolean OR created_by::text = $2::text)
          AND generated_doc_type = 'PACKING_LIST'
        LIMIT 1
        """,
        draft_id,
        str(user.id),
        shared_sources,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Packing List draft not found")

    payload = _coerce_json(rows[0]["rendered_payload"])
    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail="Draft payload is invalid")
    if not can_generate_document_type(user, payload.get("generatedDocType")):
        raise HTTPException(status_code=403, detail="Not allowed to generate this document type")

    line_items = payload.get("lineItems")
    if not isinstance(line_items, list) or request.lineItemIndex >= len(line_items):
        raise HTTPException(status_code=400, detail="Packing List line item does not exist")

    package_type = request.packageType.strip()
    custom_types = list(dict.fromkeys(
        value.strip()
        for value in request.customPackageTypes
        if value.strip() and value.strip().upper() not in {"PKGS", "BUNDLE"}
    ))
    line_items[request.lineItemIndex]["kindOfPkg"] = package_type
    payload["customPackageTypes"] = custom_types

    await _execute_raw(
        prisma,
        """
        UPDATE docgen.drafts
        SET rendered_payload = $3::jsonb, updated_at = NOW()
        WHERE id::text = $1::text
          AND ($4::boolean OR created_by::text = $2::text)
        """,
        draft_id,
        str(user.id),
        json.dumps(payload),
        shared_sources,
    )
    await _execute_raw(
        prisma,
        """
        UPDATE docgen.draft_line_items
        SET payload = jsonb_set(payload, '{kindOfPkg}', to_jsonb($3::text), true),
            updated_at = NOW()
        WHERE draft_id::text = $1::text AND line_no = $2
        """,
        draft_id,
        request.lineItemIndex + 1,
        package_type,
    )

    payload["createdAt"] = str(rows[0].get("created_at")) if rows[0].get("created_at") else None
    return DraftPayload.model_validate(payload)


@router.patch("/drafts/{draft_id}", response_model=DraftPayload)
async def update_doc_generation_draft(
    draft_id: str,
    request: UpdateDraftRequest,
    user=Depends(get_current_user),
    token: str | None = Depends(get_session_token),
    _authz=Depends(require_activity("documents.generate_draft")),
):
    """Persist reviewed field values, tariff lines, calculations, and draft status."""
    _require_doc_generation_activity(user)
    if request.status in {"CONFIRMED", "GENERATED"}:
        if not token:
            raise HTTPException(status_code=401, detail="Not authenticated")
        authorize_activity(token, "documents.approve_draft")

    prisma = await get_prisma()
    shared_sources = _has_shared_docgen_access(user)
    rows = await _query_raw(
        prisma,
        """
        SELECT rendered_payload, created_at
        FROM docgen.drafts
        WHERE id::text = $1::text
          AND ($3::boolean OR created_by::text = $2::text)
        LIMIT 1
        """,
        draft_id,
        str(user.id),
        shared_sources,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Document-generation draft not found")

    payload = _coerce_json(rows[0]["rendered_payload"])
    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail="Draft payload is invalid")
    if not can_generate_document_type(user, payload.get("generatedDocType")):
        raise HTTPException(status_code=403, detail="Not allowed to generate this document type")

    for section in payload.get("sections", []):
        for field in section.get("fields", []):
            target = field.get("targetField")
            if target in request.fields:
                field["value"] = request.fields[target]
                field["validationStatus"] = "valid" if request.fields[target] not in (None, "") else "missing"

    if request.lineItems is not None:
        payload["lineItems"] = request.lineItems
    payload["status"] = request.status

    await _execute_raw(
        prisma,
        """
        UPDATE docgen.drafts
        SET rendered_payload = $3::jsonb,
            status = $4::docgen."DocGenerationStatus",
            updated_at = NOW()
        WHERE id::text = $1::text
          AND ($5::boolean OR created_by::text = $2::text)
        """,
        draft_id,
        str(user.id),
        json.dumps(payload),
        request.status,
        shared_sources,
    )
    if request.lineItems is not None:
        for line_no, item in enumerate(request.lineItems, start=1):
            await _execute_raw(
                prisma,
                """
                UPDATE docgen.draft_line_items
                SET payload = $3::jsonb, updated_at = NOW()
                WHERE draft_id::text = $1::text AND line_no = $2
                """,
                draft_id,
                line_no,
                json.dumps(item),
            )

    payload["createdAt"] = str(rows[0].get("created_at")) if rows[0].get("created_at") else None
    return DraftPayload.model_validate(payload)
