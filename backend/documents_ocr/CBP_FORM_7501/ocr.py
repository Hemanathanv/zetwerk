from datetime import datetime, timezone
import re
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from prisma import Json

from documents_ocr.CBP_FORM_7501.prompt import build_cbp_form_7501_prompt
from documents_ocr.schema_loader import load_extraction_schema, upsert_extraction_with_children


_SCHEMA = load_extraction_schema(parent_model="EntrySummaryExtraction")
SCALAR_FIELDS = _SCHEMA.scalar_fields
ARRAY_FIELDS = _SCHEMA.array_fields
ARRAY_ITEM_FIELDS = _SCHEMA.array_item_fields
PACKAGE_TOKEN_RE = re.compile(r"\b(\d[\d,]*(?:\.\d+)?)\s*(PKG|PCS|BDL)\b", re.IGNORECASE)
INV_ENTVAL_RE = re.compile(
    r"\[\s*INV\s+VAL\s+US\s*:\s*([0-9][0-9,]*(?:\.\d+)?)\s*,\s*ENTVAL\s*:\s*([0-9][0-9,]*(?:\.\d+)?)\s*\]",
    re.IGNORECASE,
)


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


class CbpForm7501StructuredResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    __array_field_schema__: ClassVar[dict[str, list[str]]] = ARRAY_ITEM_FIELDS

    source: str | None = None
    documentType: str | None = "CBP FORM-7501"
    compliance: ComplianceSection = Field(default_factory=ComplianceSection)
    entities: EntitiesSection = Field(default_factory=EntitiesSection)
    financial: FinancialSection = Field(default_factory=FinancialSection)
    header: HeaderSection = Field(default_factory=HeaderSection)
    shipment: ShipmentSection = Field(default_factory=ShipmentSection)
    footer: FooterSection = Field(default_factory=FooterSection)
    lineItems: list[dict[str, Any]] = Field(default_factory=list)
    tariffLines: list[dict[str, Any]] = Field(default_factory=list)



def matches_cbp_form_7501(*, bucket: str, module: str, document: Any) -> bool:
    candidates = [
        bucket,
        module,
        getattr(document, "bucket", ""),
        getattr(document, "fileName", ""),
        getattr(document, "docType", ""),
    ]
    normalized = ["".join(ch for ch in str(value or "").lower() if ch.isalnum()) for value in candidates]
    return any(
        token in {
            "entrysummary",
            "entrysummaries",
            "entrysummarytarifflines",
            "entrysummarytariffline",
            "cbpform7501",
            "cbp7501",
        }
        for token in normalized
    )


def build_prompt() -> str:
    return build_cbp_form_7501_prompt(CbpForm7501StructuredResult)


def _coerce_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value).strip()
    return text or None


def _iter_string_values(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for nested in value.values():
            yield from _iter_string_values(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from _iter_string_values(nested)


def _first_present(*containers: dict[str, Any], aliases: tuple[str, ...]) -> Any:
    lowered_aliases = {alias.lower() for alias in aliases}
    for container in containers:
        for key, value in container.items():
            if key.lower() in lowered_aliases and value not in (None, ""):
                return value
    return None


def _set_if_blank(container: dict[str, Any], key: str, value: Any) -> None:
    if key in container and container.get(key) not in (None, ""):
        return
    coerced = _coerce_string(value)
    if coerced is not None:
        container[key] = coerced


def _extract_package_token(value: Any) -> tuple[str, str] | None:
    for text in _iter_string_values(value):
        match = PACKAGE_TOKEN_RE.search(text)
        if match:
            return match.group(1), match.group(2).upper()
    return None


def _extract_inv_entval_groups(value: Any) -> list[tuple[str, str]]:
    groups: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for text in _iter_string_values(value):
        for match in INV_ENTVAL_RE.finditer(text):
            group = (match.group(1), match.group(2))
            if group in seen:
                continue
            seen.add(group)
            groups.append(group)
    return groups


def _apply_cbp_7501_aliases(normalized: dict[str, Any]) -> None:
    package_source = _first_present(
        normalized,
        *(value for value in normalized.values() if isinstance(value, dict)),
        aliases=("totalPackage", "totalPackages", "package", "packages"),
    )
    package = _extract_package_token(package_source) or _extract_package_token(normalized)
    if package:
        qty, unit = package
        _set_if_blank(normalized, "billQty", qty)
        _set_if_blank(normalized, "billQtyUnit", unit)

    nested_sections = [value for value in normalized.values() if isinstance(value, dict)]
    inv_val_us = _first_present(
        normalized,
        *nested_sections,
        aliases=("invValUs", "invValUS", "invValUsd", "invoiceValueUsd"),
    )
    entval = _first_present(
        normalized,
        *nested_sections,
        aliases=("entval", "entVal", "ENTVAL"),
    )
    if entval is not None:
        _set_if_blank(normalized, "totalEnteredValue", entval)
    elif inv_val_us is not None:
        _set_if_blank(normalized, "totalEnteredValue", inv_val_us)

    bracket_groups = _extract_inv_entval_groups(normalized)
    line_items = normalized.get("lineItems")
    if not isinstance(line_items, list):
        line_items = []
        normalized["lineItems"] = line_items

    if bracket_groups and not line_items:
        normalized["lineItems"] = [{} for _ in bracket_groups]
        line_items = normalized["lineItems"]

    for index, item in enumerate(line_items):
        if not isinstance(item, dict):
            continue
        item_inv_val_us = _first_present(
            item,
            aliases=("invValUs", "invValUS", "invValUsd"),
        )
        item_entval = _first_present(
            item,
            aliases=("entval", "entVal", "ENTVAL"),
        )
        if index < len(bracket_groups):
            bracket_inv_val_us, bracket_entval = bracket_groups[index]
            if item_inv_val_us is None:
                item_inv_val_us = bracket_inv_val_us
            if item_entval is None:
                item_entval = bracket_entval

        _set_if_blank(item, "invoiceValueUsd", item_inv_val_us)
        _set_if_blank(item, "totalEnteredValueInvoice", item_entval)
        _set_if_blank(item, "enteredValue", item_entval)

    if len(bracket_groups) == 1:
        _set_if_blank(normalized, "totalEnteredValue", bracket_groups[0][1])


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

    # Backward-compatible aliases from the former two-extractor workflow.
    # Without this bridge, a retry using an older/cached response shape can
    # silently drop all item or tariff rows after the parent models were
    # merged into EntrySummaryExtraction.
    array_aliases = {
        "lineItems": (
            "entrySummaryLineItems",
            "entry_summary_line_items",
            "invoiceLines",
            "items",
        ),
        "tariffLines": (
            "tariffLineItems",
            "entrySummaryTariffLines",
            "entrySummaryTariffLineItems",
            "entry_summary_tariff_line_items",
        ),
    }
    for canonical_name, aliases in array_aliases.items():
        if normalized.get(canonical_name):
            continue
        for container in (
            normalized,
            *(value for value in normalized.values() if isinstance(value, dict)),
        ):
            for alias in aliases:
                if container.get(alias):
                    normalized[canonical_name] = container[alias]
                    break
            if normalized.get(canonical_name):
                break

    _apply_cbp_7501_aliases(normalized)

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


def parse_result(payload: dict[str, Any]) -> CbpForm7501StructuredResult:
    normalized = normalize_payload(payload)
    return CbpForm7501StructuredResult.model_validate(normalized)


def to_prisma_data(*, result: CbpForm7501StructuredResult, raw_data: dict[str, Any]) -> dict[str, Any]:
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


async def persist_extraction(*, prisma, document_id: str, result: CbpForm7501StructuredResult, raw_data: dict[str, Any]):
    extraction_data = to_prisma_data(result=result, raw_data=raw_data)
    return await upsert_extraction_with_children(
        prisma=prisma,
        model_accessor_name="entrysummaryextraction",
        schema=_SCHEMA,
        document_id=document_id,
        extraction_data=extraction_data,
    )


__all__ = [
    "CbpForm7501StructuredResult",
    "ValidationError",
    "matches_cbp_form_7501",
    "build_prompt",
    "parse_result",
    "persist_extraction",
]
