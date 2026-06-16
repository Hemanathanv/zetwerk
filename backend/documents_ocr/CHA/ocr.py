from datetime import datetime, timezone
import json
import re
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError
try:
    from prisma import Json
except ImportError:
    def Json(value: Any) -> Any:
        return value

from documents_ocr.CHA.prompt import build_cha_prompt
from documents_ocr.schema_loader import load_extraction_schema


_SCHEMA = load_extraction_schema(parent_model="ChaBillExtraction")
SCALAR_FIELDS = _SCHEMA.scalar_fields
ARRAY_FIELDS = _SCHEMA.array_fields
ARRAY_ITEM_FIELDS = _SCHEMA.array_item_fields


def _section_for_field(field_name: str) -> str:
    lower = field_name.lower()

    if any(token in lower for token in ("gst", "pan", "cin", "iec", "irn", "lut", "signature", "declaration", "bond", "hsn", "taxid", "doctype")):
        return "compliance"
    if any(token in lower for token in ("name", "address", "consignee", "shipper", "notify", "customer", "importer", "exporter", "broker", "agent", "buyer", "seller", "phone", "email", "contact")):
        return "entities"
    if any(token in lower for token in ("amount", "total", "duty", "tax", "value", "currency", "payment", "bank", "freight", "rate", "charge", "subtotal", "grand")):
        return "financial"
    if any(token in lower for token in ("port", "vessel", "voyage", "container", "package", "weight", "origin", "destination", "loading", "discharge", "receipt", "delivery", "bl", "awb", "flight", "shipment", "cargo", "seal", "pickup", "eta", "etd")):
        return "shipment"
    if any(token in lower for token in ("remarks", "prepared", "approved", "designation", "din", "status", "notice")):
        return "footer"
    return "header"


def _build_section_field_map() -> dict[str, list[str]]:
    mapping = {
        "compliance": [],
        "entities": [],
        "financial": [],
        "header": [],
        "shipment": [],
        "footer": [],
    }
    for field_name in SCALAR_FIELDS:
        if field_name == "documentType":
            continue
        mapping[_section_for_field(field_name)].append(field_name)
    return mapping


def _build_section_model(name: str, fields: list[str]) -> type[BaseModel]:
    namespace: dict[str, Any] = {"model_config": ConfigDict(extra="allow")}
    namespace["__annotations__"] = {field_name: str | None for field_name in fields}
    for field_name in fields:
        namespace[field_name] = None
    return type(name, (BaseModel,), namespace)


SECTION_FIELD_MAP = _build_section_field_map()

ComplianceSection = _build_section_model("ComplianceSection", SECTION_FIELD_MAP["compliance"])
EntitiesSection = _build_section_model("EntitiesSection", SECTION_FIELD_MAP["entities"])
FinancialSection = _build_section_model("FinancialSection", SECTION_FIELD_MAP["financial"])
HeaderSection = _build_section_model("HeaderSection", SECTION_FIELD_MAP["header"])
ShipmentSection = _build_section_model("ShipmentSection", SECTION_FIELD_MAP["shipment"])
FooterSection = _build_section_model("FooterSection", SECTION_FIELD_MAP["footer"])


class ChaBillStructuredResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    __array_field_schema__: ClassVar[dict[str, list[str]]] = ARRAY_ITEM_FIELDS

    source: str | None = None
    documentType: str | None = "CHA Bill"
    compliance: ComplianceSection = Field(default_factory=ComplianceSection)
    entities: EntitiesSection = Field(default_factory=EntitiesSection)
    financial: FinancialSection = Field(default_factory=FinancialSection)
    header: HeaderSection = Field(default_factory=HeaderSection)
    shipment: ShipmentSection = Field(default_factory=ShipmentSection)
    footer: FooterSection = Field(default_factory=FooterSection)
    containers: list[dict[str, Any]] = Field(default_factory=list)
    charges: list[dict[str, Any]] = Field(default_factory=list)
    taxSummary: list[dict[str, Any]] = Field(default_factory=list)
    bankDetails: list[dict[str, Any]] = Field(default_factory=list)
    flags: list[dict[str, Any]] = Field(default_factory=list)



def matches_cha(*, bucket: str, module: str, document: Any) -> bool:
    candidates = [
        bucket,
        module,
        getattr(document, "bucket", ""),
        getattr(document, "fileName", ""),
        getattr(document, "docType", ""),
    ]
    normalized = ["".join(ch for ch in str(value or "").lower() if ch.isalnum()) for value in candidates]
    return any(token in {'cha', 'chabill', 'chabills'} for token in normalized)


def build_prompt() -> str:
    return build_cha_prompt(ChaBillStructuredResult)


def _coerce_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value).strip()
    return text or None


_CONTAINER_NUMBER_RE = re.compile(r"\b[A-Z]{4}\d{7}\b", re.IGNORECASE)
_CONTAINER_TYPE_RE = re.compile(r"\b(?:20|40|45)\s?(?:GP|HC|HQ|DV|DC|RF|OT|FR|NOR|STD|ST|FT|RH)?\b", re.IGNORECASE)


FIELD_ALIASES: dict[str, dict[str, tuple[str, ...]]] = {
    "charges": {
        "lineNumber": ("line_number", "lineNo", "line_no", "srNo", "sr_no"),
        "sacHsnCode": ("sac_hsn_code", "hsnSac", "hsn_sac", "hsnCode", "hsn_code"),
        "description": ("chargeDescription", "charge_description", "particulars", "charge", "name"),
        "quantity": ("qty",),
        "ratePerUnit": ("rate_per_unit", "rate", "unitRate", "unit_rate"),
        "rate": ("rate_per_unit", "rate", "unitRate", "unit_rate"),
        "currencyAmount": ("currency_amount", "foreignCurrencyAmount", "foreign_currency_amount"),
        "foreignCurrencyAmount": ("foreign_currency_amount", "currencyAmount", "currency_amount"),
        "taxableAmount": ("taxable_amount", "taxableAmountInr", "taxable_amount_inr"),
        "taxableAmountInr": ("taxable_amount_inr", "taxableAmount", "taxable_amount"),
        "taxRatePct": ("tax_rate_pct", "taxRate", "tax_rate", "igstRate", "igst_rate"),
        "amountInr": ("amount_inr", "totalAmount", "total_amount"),
        "totalAmount": ("total_amount", "amountInr", "amount_inr"),
        "roundOff": ("round_off",),
        "igstRate": ("igst_rate",),
        "igstAmount": ("igst_amount",),
        "cgstRate": ("cgst_rate",),
        "cgstAmount": ("cgst_amount",),
        "sgstRate": ("sgst_rate",),
        "sgstAmount": ("sgst_amount",),
        "detentionDetails": ("detention_details",),
        "taxInfo": ("tax_info",),
    },
    "taxSummary": {
        "summaryEntry": ("summary_entry",),
        "hsnSac": ("hsn_sac", "hsnSac", "sacHsnCode", "sac_hsn_code"),
        "taxableAmount": ("taxable_amount", "taxableAmountInr", "taxable_amount_inr"),
        "igst": ("igst_amount", "igstAmount"),
        "cgst": ("cgst_amount", "cgstAmount"),
        "sgst": ("sgst_amount", "sgstAmount"),
        "totalAmount": ("total_amount", "amountInr", "amount_inr"),
    },
    "bankDetails": {
        "beneficiaryName": ("beneficiary_name", "accountName", "account_name"),
        "bankName": ("bank_name",),
        "accountNumber": ("account_number",),
        "branchCode": ("branch_code",),
        "swiftCode": ("swift_code",),
        "ifscCode": ("ifsc_code",),
        "routingNumber": ("routing_number",),
        "branchAddress": ("branch_address",),
        "accountType": ("account_type",),
    },
}


def _clean_text(value: Any) -> str | None:
    text = _coerce_string(value)
    if text is None:
        return None
    return re.sub(r"\s+", " ", text).strip(" ,;/")


def _parse_json_like(value: str) -> Any | None:
    stripped = value.strip()
    if not stripped or stripped[0] not in "[{":
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return None


def _array_source_items(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, str):
        parsed = _parse_json_like(value)
        if parsed is not None:
            return _array_source_items(parsed)
        return [value]
    if isinstance(value, dict):
        for key in ("items", "rows", "list", "data"):
            nested = value.get(key)
            if nested is not None:
                return _array_source_items(nested)
        return [value]
    if isinstance(value, list):
        return value
    return []


def _get_alias_value(item: dict[str, Any], field_name: str, aliases: dict[str, tuple[str, ...]]) -> Any:
    if field_name in item:
        return item.get(field_name)
    for alias in aliases.get(field_name, ()):
        if alias in item:
            return item.get(alias)
    return None


def _normalize_structured_rows(*, value: Any, expected_fields: list[str], aliases: dict[str, tuple[str, ...]] | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for raw_item in _array_source_items(value):
        if not isinstance(raw_item, dict):
            continue
        normalized_item: dict[str, Any] = {}
        for field_name in expected_fields:
            raw = _get_alias_value(raw_item, field_name, aliases or {})
            normalized_item[field_name] = raw if raw is None or isinstance(raw, str) else _coerce_string(raw)
        rows.append(normalized_item)
    return rows


def _format_container_detail(number: str | None, container_type: str | None) -> str | None:
    if number and container_type:
        return f"{number}-{container_type}"
    return number or container_type


def _split_container_detail(value: Any) -> dict[str, str | None] | None:
    if isinstance(value, dict):
        number = _clean_text(
            value.get("containerNumber")
            or value.get("containerNo")
            or value.get("container_no")
            or value.get("number")
            or value.get("no")
        )
        container_type = _clean_text(
            value.get("containerType")
            or value.get("containerSizeType")
            or value.get("container_type")
            or value.get("type")
            or value.get("sizeType")
        )
        detail = _clean_text(
            value.get("containerDetail")
            or value.get("container")
            or value.get("detail")
            or value.get("value")
        )
        if detail and (not number or not container_type):
            parsed = _split_container_detail(detail)
            if parsed:
                number = number or parsed.get("containerNumber")
                container_type = container_type or parsed.get("containerType")
        if not detail:
            detail = _format_container_detail(number, container_type)
        if not any((number, container_type, detail)):
            return None
        return {
            "containerDetail": detail,
            "containerNumber": number,
            "containerType": container_type,
        }

    text = _clean_text(value)
    if not text:
        return None

    parsed_json = _parse_json_like(text)
    if parsed_json is not None:
        rows = _collect_container_rows(parsed_json)
        return rows[0] if rows else None

    number_match = _CONTAINER_NUMBER_RE.search(text)
    number = number_match.group(0).upper() if number_match else None
    remainder = text
    if number_match:
        remainder = (text[: number_match.start()] + " " + text[number_match.end() :]).strip(" -/:,;")

    type_match = _CONTAINER_TYPE_RE.search(remainder)
    container_type = type_match.group(0).upper().replace(" ", "") if type_match else None
    if not container_type and remainder and number:
        container_type = remainder.split("/", 1)[0].strip(" -/:,;") or None

    return {
        "containerDetail": _format_container_detail(number, container_type) or text,
        "containerNumber": number,
        "containerType": container_type,
    }


def _collect_container_rows(value: Any) -> list[dict[str, str | None]]:
    if value is None:
        return []
    if isinstance(value, dict):
        for key in ("containers", "items", "list", "rows"):
            nested = value.get(key)
            if nested is not None:
                return _collect_container_rows(nested)
        parsed = _split_container_detail(value)
        return [parsed] if parsed else []
    if isinstance(value, list):
        rows: list[dict[str, str | None]] = []
        for item in value:
            rows.extend(_collect_container_rows(item))
        return rows

    text = _clean_text(value)
    if not text:
        return []
    parsed_json = _parse_json_like(text)
    if parsed_json is not None:
        return _collect_container_rows(parsed_json)

    parts = [part.strip() for part in re.split(r"\s*,\s*", text) if part.strip()]
    if len(parts) > 1:
        rows: list[dict[str, str | None]] = []
        for part in parts:
            parsed = _split_container_detail(part)
            if parsed:
                rows.append(parsed)
        return rows

    parsed = _split_container_detail(text)
    return [parsed] if parsed else []


def _normalize_containers_payload(*, value: Any, expected_fields: list[str]) -> list[dict[str, Any]]:
    rows = _collect_container_rows(value)
    fields = expected_fields or ["containerDetail", "containerNumber", "containerType"]
    normalized: list[dict[str, Any]] = []
    for row in rows:
        item = {field_name: row.get(field_name) for field_name in fields}
        normalized.append(item)
    return normalized


def normalize_array_field_payload(*, value: Any, expected_fields: list[str]) -> list[dict[str, Any]]:
    source_items = [item for item in _array_source_items(value) if isinstance(item, dict)]

    if not expected_fields:
        normalized: list[dict[str, Any]] = []
        for item in source_items:
            normalized_item: dict[str, Any] = {}
            for key, raw in item.items():
                normalized_item[key] = raw if raw is None or isinstance(raw, str) else _coerce_string(raw)
            normalized.append(normalized_item)
        return normalized

    normalized_items: list[dict[str, Any]] = []
    for item in source_items:
        normalized_item: dict[str, Any] = {}
        for field_name in expected_fields:
            raw = item.get(field_name)
            normalized_item[field_name] = raw if raw is None or isinstance(raw, str) else _coerce_string(raw)
        for key, raw in item.items():
            if key in normalized_item:
                continue
            normalized_item[key] = raw if raw is None or isinstance(raw, str) else _coerce_string(raw)
        normalized_items.append(normalized_item)
    return normalized_items


def normalize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(payload or {})
    if normalized.get("taxSummary") is None and normalized.get("tax_summary") is not None:
        normalized["taxSummary"] = normalized.get("tax_summary")
    if normalized.get("bankDetails") is None and normalized.get("bank_details") is not None:
        normalized["bankDetails"] = normalized.get("bank_details")
    if normalized.get("containers") is None and normalized.get("containersRaw") is not None:
        normalized["containers"] = normalized.get("containersRaw")

    for section_name, field_names in SECTION_FIELD_MAP.items():
        section_payload = dict(normalized.get(section_name) or {})
        for field_name in field_names:
            if section_payload.get(field_name) is None:
                section_payload[field_name] = normalized.get(field_name)
            value = section_payload.get(field_name)
            if value is not None and not isinstance(value, str):
                section_payload[field_name] = _coerce_string(value)
        normalized[section_name] = section_payload

    for field_name in ARRAY_FIELDS:
        expected_fields = ARRAY_ITEM_FIELDS.get(field_name, [])
        if field_name == "containers":
            normalized[field_name] = _normalize_containers_payload(
                value=normalized.get(field_name),
                expected_fields=expected_fields,
            )
        elif field_name in FIELD_ALIASES:
            normalized[field_name] = _normalize_structured_rows(
                value=normalized.get(field_name),
                expected_fields=expected_fields,
                aliases=FIELD_ALIASES[field_name],
            )
            if field_name == "charges":
                for index, row in enumerate(normalized[field_name], start=1):
                    if not _clean_text(row.get("lineNumber")):
                        row["lineNumber"] = str(index)
        else:
            normalized[field_name] = normalize_array_field_payload(
                value=normalized.get(field_name),
                expected_fields=expected_fields,
            )

    return normalized


def parse_result(payload: dict[str, Any]) -> ChaBillStructuredResult:
    normalized = normalize_payload(payload)
    return ChaBillStructuredResult.model_validate(normalized)


def to_prisma_data(*, result: ChaBillStructuredResult, raw_data: dict[str, Any]) -> dict[str, Any]:
    payload = result.model_dump(mode="json", exclude_none=True)
    data: dict[str, Any] = {}

    flattened_scalars: dict[str, Any] = {}
    for section_name, field_names in SECTION_FIELD_MAP.items():
        section_payload = payload.get(section_name) or {}
        for field_name in field_names:
            flattened_scalars[field_name] = section_payload.get(field_name)

    for field_name in SCALAR_FIELDS:
        data[field_name] = _coerce_string(flattened_scalars.get(field_name))

    for field_name in ARRAY_FIELDS:
        value = payload.get(field_name)
        if value is None:
            data[field_name] = None
        else:
            data[field_name] = Json(value)

    data["rawData"] = Json(raw_data)
    data["extractedAt"] = datetime.now(timezone.utc)
    return data


async def persist_extraction(*, prisma, document_id: str, result: ChaBillStructuredResult, raw_data: dict[str, Any]):
    extraction_data = to_prisma_data(result=result, raw_data=raw_data)
    create_data = {
        **extraction_data,
        "documentId": document_id,
        "document": {"connect": {"id": document_id}},
    }

    for _ in range(20):
        try:
            return await prisma.chabillextraction.upsert(
                where={"documentId": document_id},
                data={
                    "create": create_data,
                    "update": extraction_data,
                },
            )
        except Exception as exc:
            error_text = str(exc)
            field_name: str | None = None

            path_match = re.search(r"Could not find field at `[^`]*\.(\w+)`", error_text)
            if path_match:
                field_name = path_match.group(1)
            else:
                path_match = re.search(r"`[^`]*\.(\w+)`", error_text)
                if path_match and "Field does not exist in enclosing type" in error_text:
                    field_name = path_match.group(1)
            if not field_name:
                unknown_match = re.search(r"Unknown (?:arg|field) `(\w+)`", error_text)
                if unknown_match:
                    field_name = unknown_match.group(1)
            if not field_name:
                raise
            had_update_field = field_name in extraction_data
            had_create_field = field_name in create_data
            extraction_data.pop(field_name, None)
            create_data.pop(field_name, None)
            if not had_update_field and not had_create_field:
                raise

    raise RuntimeError("Failed to persist extraction after dropping unsupported fields")


__all__ = [
    "ChaBillStructuredResult",
    "ValidationError",
    "matches_cha",
    "build_prompt",
    "parse_result",
    "persist_extraction",
]
