from datetime import datetime, timezone
import re
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError
try:
    from prisma import Json
except ImportError:  # pragma: no cover - local schema tests can run before Prisma client generation.
    def Json(value: Any) -> Any:
        return value

from documents_ocr.Shipping_bill.prompt import build_shipping_bill_prompt
from documents_ocr.schema_loader import load_extraction_schema, upsert_extraction_with_children


_SCHEMA = load_extraction_schema(parent_model="ShippingBillExtraction")
SCALAR_FIELDS = _SCHEMA.scalar_fields
ARRAY_FIELDS = _SCHEMA.array_fields
ARRAY_ITEM_FIELDS = _SCHEMA.array_item_fields

ITEM_ARRAY_ALIASES = (
    "items",
    "lineItems",
    "itemDetails",
    "shippingBillItems",
    "part3Items",
)
ITEM_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "invsn": ("invoiceSerialNo", "invoiceSerialNumber", "invoiceNo", "invNo"),
    "itemsn": ("itemSNo", "itemSn", "itemNo", "itemNumber", "serialNo", "srNo"),
    "hsCd": ("hsCode", "hsnCode", "hsn", "tariffCode"),
    "description": (
        "itemDescription",
        "goodsDescription",
        "productDescription",
        "descriptionOfGoods",
        "merchandiseDescription",
    ),
    "quantity": ("qty", "itemQuantity"),
    "uqc": ("unit", "unitCode", "quantityUnit"),
    "rate": ("unitRate", "itemRate", "unitPrice", "price"),
    "valueFc": ("value", "valueFC", "foreignCurrencyValue", "lineValue", "amount"),
    "fobInr": ("fobValueInr", "fobValue", "fobAmountInr"),
    "pmv": ("presentMarketValue",),
    "dutyAmt": ("dutyAmount",),
    "cessRt": ("cessRate",),
    "cesAmt": ("cessAmount",),
    "dbkclmd": ("drawbackClaimed", "dbkClaimed"),
    "igstStat": ("igstStatus",),
    "igstValue": ("taxableValue",),
    "igstAmount": ("igstAmt",),
    "schcod": ("schemeCode",),
    "schemeDescription": ("schemeDesc",),
    "sqcMsr": ("secondaryQuantity", "sqcMeasure"),
    "sqcUqc": ("secondaryUnit",),
    "stateOfOrigin": ("originState",),
    "districtOfOrigin": ("originDistrict",),
    "ptAbroad": ("paymentAbroad",),
    "ftaBenefitAvailed": ("ftaBenefit",),
    "rewardBenefit": ("rewardSchemeBenefit",),
    "thirdPartyItem": ("isThirdPartyItem",),
}


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


class ShippingBillStructuredResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    __array_field_schema__: ClassVar[dict[str, list[str]]] = ARRAY_ITEM_FIELDS

    source: str | None = None
    documentType: str | None = "Shipping Bill"
    compliance: ComplianceSection = Field(default_factory=ComplianceSection)
    entities: EntitiesSection = Field(default_factory=EntitiesSection)
    financial: FinancialSection = Field(default_factory=FinancialSection)
    header: HeaderSection = Field(default_factory=HeaderSection)
    shipment: ShipmentSection = Field(default_factory=ShipmentSection)
    footer: FooterSection = Field(default_factory=FooterSection)
    part1ShippingBillSummary: list[dict[str, Any]] = Field(default_factory=list)
    part2InvoiceDetails: list[dict[str, Any]] = Field(default_factory=list)
    part3ItemDetails: list[dict[str, Any]] = Field(default_factory=list)
    part4ExportSchemeDetails: list[dict[str, Any]] = Field(default_factory=list)
    part5Declarations: list[dict[str, Any]] = Field(default_factory=list)



def matches_shippingbill(*, bucket: str, module: str, document: Any) -> bool:
    candidates = [
        bucket,
        module,
        getattr(document, "bucket", ""),
        getattr(document, "fileName", ""),
        getattr(document, "docType", ""),
    ]
    normalized = ["".join(ch for ch in str(value or "").lower() if ch.isalnum()) for value in candidates]
    return any(token in {'shippingbill', 'shippingbills'} for token in normalized)


def build_prompt() -> str:
    return build_shipping_bill_prompt(ShippingBillStructuredResult)


def _coerce_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value).strip()
    return text or None


def _parse_count(value: Any) -> int | None:
    text = _coerce_string(value)
    if not text:
        return None
    match = re.search(r"\d+", text)
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None


def _promote_zetwerk_shape_aliases(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(payload or {})

    existing_items = normalized.get("part3ItemDetails")
    if not isinstance(existing_items, list) or not existing_items:
        for alias in ITEM_ARRAY_ALIASES:
            alias_items = normalized.get(alias)
            if isinstance(alias_items, list) and alias_items:
                normalized["part3ItemDetails"] = alias_items
                break

    metadata = normalized.get("metadata")
    if isinstance(metadata, dict):
        for field_name in SCALAR_FIELDS:
            if normalized.get(field_name) is None and metadata.get(field_name) is not None:
                normalized[field_name] = metadata.get(field_name)

    return normalized


def _canonical_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _normalize_shipping_bill_item_aliases(item: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(item)
    by_canonical_key = {_canonical_key(key): value for key, value in item.items()}
    for field_name in ARRAY_ITEM_FIELDS.get("part3ItemDetails", []):
        if normalized.get(field_name) is not None:
            continue
        candidates = (field_name, *ITEM_FIELD_ALIASES.get(field_name, ()))
        for candidate in candidates:
            value = by_canonical_key.get(_canonical_key(candidate))
            if value is not None and _coerce_string(value):
                normalized[field_name] = value
                break
    return normalized


def _ensure_item_row_count(
    *,
    items: list[dict[str, Any]],
    expected_count: int | None,
    expected_fields: list[str],
) -> list[dict[str, Any]]:
    if expected_count is None or expected_count <= len(items):
        return items

    fields = expected_fields or ARRAY_ITEM_FIELDS.get("part3ItemDetails", [])
    padded = list(items)
    for index in range(len(padded) + 1, expected_count + 1):
        row = {field_name: None for field_name in fields}
        if "itemsn" in row:
            row["itemsn"] = str(index)
        padded.append(row)
    return padded


def normalize_array_field_payload(*, value: Any, expected_fields: list[str]) -> list[dict[str, Any]]:
    if value is None:
        source_items: list[dict[str, Any]] = []
    elif isinstance(value, dict):
        source_items = [value]
    elif isinstance(value, list):
        source_items = [item for item in value if isinstance(item, dict)]
    else:
        source_items = []

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
    normalized = _promote_zetwerk_shape_aliases(payload)

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
        field_value = normalized.get(field_name)
        if field_name == "part3ItemDetails" and isinstance(field_value, list):
            field_value = [
                _normalize_shipping_bill_item_aliases(item)
                for item in field_value
                if isinstance(item, dict)
            ]
        normalized[field_name] = normalize_array_field_payload(
            value=field_value,
            expected_fields=ARRAY_ITEM_FIELDS.get(field_name, []),
        )
        if field_name == "part3ItemDetails":
            item_count = None
            for section_payload in normalized.values():
                if isinstance(section_payload, dict) and section_payload.get("itemCount") is not None:
                    item_count = _parse_count(section_payload.get("itemCount"))
                    break
            if item_count is None:
                item_count = _parse_count(normalized.get("itemCount"))
            normalized[field_name] = _ensure_item_row_count(
                items=normalized[field_name],
                expected_count=item_count,
                expected_fields=ARRAY_ITEM_FIELDS.get(field_name, []),
            )

    return normalized


def parse_result(payload: dict[str, Any]) -> ShippingBillStructuredResult:
    normalized = normalize_payload(payload)
    return ShippingBillStructuredResult.model_validate(normalized)


def to_prisma_data(*, result: ShippingBillStructuredResult, raw_data: dict[str, Any]) -> dict[str, Any]:
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
            data[field_name] = value

    data["rawData"] = Json(raw_data)
    data["extractedAt"] = datetime.now(timezone.utc)
    return data


async def persist_extraction(*, prisma, document_id: str, result: ShippingBillStructuredResult, raw_data: dict[str, Any]):
    extraction_data = to_prisma_data(result=result, raw_data=raw_data)
    return await upsert_extraction_with_children(
        prisma=prisma,
        model_accessor_name="shippingbillextraction",
        schema=_SCHEMA,
        document_id=document_id,
        extraction_data=extraction_data,
    )


__all__ = [
    "ShippingBillStructuredResult",
    "ValidationError",
    "matches_shippingbill",
    "build_prompt",
    "parse_result",
    "persist_extraction",
]
