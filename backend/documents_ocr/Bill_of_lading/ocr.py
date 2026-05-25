from datetime import datetime, timezone
import re
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from prisma import Json

from documents_ocr.Bill_of_lading.prompt import build_bill_of_lading_prompt
from documents_ocr.schema_loader import load_extraction_schema


_SCHEMA = load_extraction_schema(parent_model="BillOfLading")
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


class BillOfLadingStructuredResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    __array_field_schema__: ClassVar[dict[str, list[str]]] = ARRAY_ITEM_FIELDS

    source: str | None = None
    documentType: str | None = "Bill of Lading"
    compliance: ComplianceSection = Field(default_factory=ComplianceSection)
    entities: EntitiesSection = Field(default_factory=EntitiesSection)
    financial: FinancialSection = Field(default_factory=FinancialSection)
    header: HeaderSection = Field(default_factory=HeaderSection)
    shipment: ShipmentSection = Field(default_factory=ShipmentSection)
    footer: FooterSection = Field(default_factory=FooterSection)
    exportInvoices: list[dict[str, Any]] = Field(default_factory=list)
    containers: list[dict[str, Any]] = Field(default_factory=list)
    shippingBills: list[dict[str, Any]] = Field(default_factory=list)



def matches_billoflading(*, bucket: str, module: str, document: Any) -> bool:
    candidates = [
        bucket,
        module,
        getattr(document, "bucket", ""),
        getattr(document, "fileName", ""),
        getattr(document, "docType", ""),
    ]
    normalized = ["".join(ch for ch in str(value or "").lower() if ch.isalnum()) for value in candidates]
    return any(token in {'billoflading', 'billofladings', 'bol'} for token in normalized)


def build_prompt() -> str:
    return build_bill_of_lading_prompt(BillOfLadingStructuredResult)


def _coerce_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value).strip()
    return text or None


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
    normalized = dict(payload or {})

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
        normalized[field_name] = normalize_array_field_payload(
            value=normalized.get(field_name),
            expected_fields=ARRAY_ITEM_FIELDS.get(field_name, []),
        )

    return normalized


def parse_result(payload: dict[str, Any]) -> BillOfLadingStructuredResult:
    normalized = normalize_payload(payload)
    return BillOfLadingStructuredResult.model_validate(normalized)


def to_prisma_data(*, result: BillOfLadingStructuredResult, raw_data: dict[str, Any]) -> dict[str, Any]:
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


async def persist_extraction(*, prisma, document_id: str, result: BillOfLadingStructuredResult, raw_data: dict[str, Any]):
    extraction_data = to_prisma_data(result=result, raw_data=raw_data)
    create_data = {
        **extraction_data,
        "documentId": document_id,
        "document": {"connect": {"id": document_id}},
    }

    for _ in range(20):
        try:
            return await prisma.billoflading.upsert(
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
    "BillOfLadingStructuredResult",
    "ValidationError",
    "matches_billoflading",
    "build_prompt",
    "parse_result",
    "persist_extraction",
]
