from datetime import datetime, timezone
import re
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError
try:
    from prisma import Json
except ImportError:  # pragma: no cover - local schema tests can run before Prisma client generation.
    def Json(value: Any) -> Any:
        return value

from documents_ocr.sales_invoice.prompt import build_sales_invoice_prompt
from documents_ocr.schema_loader import load_extraction_schema


def _section_for_field(field_name: str) -> str:
    lower = field_name.lower()

    if any(
        token in lower
        for token in ("gst", "pan", "cin", "iec", "irn", "lut", "signature", "declaration", "bond", "hsn", "taxid", "doctype")
    ):
        return "compliance"
    if any(
        token in lower
        for token in (
            "name",
            "address",
            "consignee",
            "shipper",
            "notify",
            "customer",
            "importer",
            "exporter",
            "broker",
            "agent",
            "buyer",
            "seller",
            "phone",
            "email",
            "contact",
        )
    ):
        return "entities"
    if any(
        token in lower
        for token in (
            "amount",
            "total",
            "duty",
            "tax",
            "value",
            "currency",
            "payment",
            "bank",
            "freight",
            "rate",
            "charge",
            "subtotal",
            "grand",
            "ifsc",
            "swift",
            "incoterm",
            "cess",
        )
    ):
        return "financial"
    if any(
        token in lower
        for token in (
            "port",
            "vessel",
            "voyage",
            "container",
            "package",
            "weight",
            "origin",
            "destination",
            "loading",
            "discharge",
            "receipt",
            "delivery",
            "bl",
            "awb",
            "flight",
            "shipment",
            "cargo",
            "seal",
            "pickup",
            "eta",
            "etd",
            "country",
            "marks",
            "carriage",
        )
    ):
        return "shipment"
    if any(token in lower for token in ("remarks", "prepared", "approved", "designation", "din", "status", "notice")):
        return "footer"
    return "header"


def _build_section_field_map(scalar_fields: list[str]) -> dict[str, list[str]]:
    mapping = {
        "compliance": [],
        "entities": [],
        "financial": [],
        "header": [],
        "shipment": [],
        "footer": [],
    }
    for field_name in scalar_fields:
        if field_name in ARRAY_FIELDS or field_name == "documentType":
            continue
        mapping[_section_for_field(field_name)].append(field_name)
    return mapping


def _build_section_model(name: str, fields: list[str]) -> type[BaseModel]:
    namespace: dict[str, Any] = {"model_config": ConfigDict(extra="allow")}
    namespace["__annotations__"] = {field_name: str | None for field_name in fields}
    for field_name in fields:
        namespace[field_name] = None
    return type(name, (BaseModel,), namespace)


_SCHEMA = load_extraction_schema(parent_model="SalesInvoiceExtraction")
SCALAR_FIELDS = _SCHEMA.scalar_fields
ARRAY_FIELDS = _SCHEMA.array_fields
ARRAY_ITEM_FIELDS = _SCHEMA.array_item_fields
SECTION_FIELD_MAP = _build_section_field_map(SCALAR_FIELDS)

PRODUCT_CODE_PATTERN = re.compile(r"\b[A-Z]{1,4}(?:\.[A-Z0-9]+){3,}\b")
SPEC_DIMENSION_PATTERN = re.compile(
    r"\b(?:[A-Z]?\d+(?:\.\d+)?\s*[Xx]\s*\d+(?:\.\d+)?"
    r"(?:\s*[Xx]\s*\d+(?:\.\d+)?)?)"
    r"(?:\s*(?:FT|MM|CM|IN|M|KG|LB))?\b"
)
SPEC_MARKER_PATTERN = re.compile(
    r"(?:^|,\s*)(HDG|GALV(?:ANIZED)?|GRADE|ASTM|COATED|PAINTED|FINISH|WHITE|BLACK|ZINC|ALLOY|STAINLESS|MILD\s+STEEL)\b",
    re.IGNORECASE,
)
PACKAGE_COUNT_PATTERN = re.compile(
    r"^(\d+)\s*(?:x\s*)?(PKGS?|PKG|PACKAGES?|NOS?|NO\.?|PCS?|BOX(?:ES)?|CARTONS?)\b(?:\s*[:\-]?\s*(.*))?$",
    re.IGNORECASE,
)

ComplianceSection = _build_section_model("ComplianceSection", SECTION_FIELD_MAP["compliance"])
EntitiesSection = _build_section_model("EntitiesSection", SECTION_FIELD_MAP["entities"])
FinancialSection = _build_section_model("FinancialSection", SECTION_FIELD_MAP["financial"])
HeaderSection = _build_section_model("HeaderSection", SECTION_FIELD_MAP["header"])
ShipmentSection = _build_section_model("ShipmentSection", SECTION_FIELD_MAP["shipment"])
FooterSection = _build_section_model("FooterSection", SECTION_FIELD_MAP["footer"])


class SalesInvoiceStructuredResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    __array_field_schema__: ClassVar[dict[str, list[str]]] = ARRAY_ITEM_FIELDS

    source: str | None = None
    documentType: str | None = "Sales Invoices"
    compliance: ComplianceSection = Field(default_factory=ComplianceSection)
    entities: EntitiesSection = Field(default_factory=EntitiesSection)
    financial: FinancialSection = Field(default_factory=FinancialSection)
    header: HeaderSection = Field(default_factory=HeaderSection)
    shipment: ShipmentSection = Field(default_factory=ShipmentSection)
    footer: FooterSection = Field(default_factory=FooterSection)
    lineItems: list[dict[str, Any]] = Field(default_factory=list)


def matches_sales_invoice(*, bucket: str, module: str, document: Any) -> bool:
    candidates = [
        bucket,
        module,
        getattr(document, "bucket", ""),
        getattr(document, "fileName", ""),
        getattr(document, "docType", ""),
    ]
    normalized = ["".join(ch for ch in str(value or "").lower() if ch.isalnum()) for value in candidates]
    return any(
        token in {"salesinvoice", "salesinvoices"}
        or ("sales" in token and "invoice" in token)
        for token in normalized
    )


def build_prompt() -> str:
    return build_sales_invoice_prompt(SalesInvoiceStructuredResult)


def _coerce_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value).strip()
    return text or None


def _clean_text(value: Any) -> str:
    text = _coerce_string(value)
    return re.sub(r"\s+", " ", text).strip() if text else ""


def _split_description_and_spec(text: str) -> tuple[str, str]:
    text = _clean_text(text)
    if not text:
        return "", ""

    dim_match = SPEC_DIMENSION_PATTERN.search(text)
    if dim_match and dim_match.start() > 2:
        left = text[: dim_match.start()].strip(" ,;:-")
        right = text[dim_match.start() :].strip(" ,;:-")
        if left and right:
            return left, right

    marker_match = SPEC_MARKER_PATTERN.search(text)
    if marker_match and marker_match.start() > 2:
        left = text[: marker_match.start()].strip(" ,;:-")
        right = text[marker_match.start() :].strip(" ,;:-")
        if left and right:
            return left, right

    if "," in text:
        parts = [part.strip(" ,;:-") for part in text.split(",") if part.strip(" ,;:-")]
        for idx in range(1, len(parts)):
            if SPEC_MARKER_PATTERN.search(parts[idx]) or SPEC_DIMENSION_PATTERN.search(parts[idx]):
                return ", ".join(parts[:idx]).strip(), ", ".join(parts[idx:]).strip()

    return text, ""


def _strip_hsn_from_description(value: Any) -> str | None:
    text = _clean_text(value)
    if not text:
        return None
    text = re.sub(r"\b\d{4}\.\d{2}\.\d{2}\b", " ", text)
    text = re.sub(r"\b\d{8,10}\b", " ", text)
    return re.sub(r"\s+", " ", text).strip() or None


def _strip_origin_certification_from_spec(value: Any) -> str | None:
    text = _clean_text(value)
    if not text:
        return None
    patterns = (
        r"\b100%\s*Indian\s+steel[^,;.]*(?:[,;.]|$)",
        r"\bsmelted\s+in\s+India[^,;.]*(?:[,;.]|$)",
        r"\b(?:made|manufactured|produced)\s+in\s+India[^,;.]*(?:[,;.]|$)",
        r"\bcountry\s+of\s+origin[^,;.]*(?:[,;.]|$)",
        r"\bcertificate\s+of\s+origin[^,;.]*(?:[,;.]|$)",
        r"\bCOO\s*[:-]\s*[^,;.]+(?:[,;.]|$)",
        r"\b(?:fully\s+)?Indian\s+origin[^,;.]*(?:[,;.]|$)",
    )
    for pattern in patterns:
        text = re.sub(pattern, " ", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip(" ,.;") or None


def _normalize_package_count(value: Any) -> str | None:
    text = _clean_text(value)
    if not text:
        return None
    match = re.match(r"^(\d+)", text)
    return match.group(1) if match else text


def _parse_numeric_quantity(value: Any) -> float | None:
    text = _clean_text(value)
    if not text:
        return None
    match = re.search(r"-?\d[\d,]*(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def _format_quantity_total(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.3f}".rstrip("0").rstrip(".")


def _normalize_signature(value: Any) -> str | None:
    if isinstance(value, bool):
        return "true" if value else "false"
    text = _clean_text(value)
    if not text:
        return None
    lowered = text.lower()
    if lowered in {"true", "yes", "y", "1", "x", "checked"} or text in {"☒", "✓", "✔"}:
        return "true"
    if lowered in {"false", "no", "n", "0"}:
        return "false"
    if re.search(r"sign|stamp|authori", text, flags=re.IGNORECASE):
        return "true"
    return text


def _repair_line_item_fields(item: dict[str, Any]) -> dict[str, Any]:
    item.pop("productPartNumber", None)
    item.pop("productSku", None)
    item.pop("unitPrice", None)

    code = _clean_text(item.get("productCode"))
    description = _clean_text(item.get("productDescription"))
    specification = _clean_text(item.get("productSpecification"))

    if not code:
        for source_name, source_value in (("description", description), ("specification", specification)):
            if not source_value:
                continue
            leading = PRODUCT_CODE_PATTERN.match(source_value)
            if not leading:
                continue
            code = leading.group(0)
            remainder = source_value[leading.end() :].strip(" ,;:-")
            if source_name == "description":
                description = remainder
            else:
                specification = remainder
            break

    if code:
        leading = PRODUCT_CODE_PATTERN.match(code)
        if leading:
            trailing = code[leading.end() :].strip(" ,;:-")
            code = leading.group(0)
            if trailing and not description:
                description = trailing

    if description:
        leading = PRODUCT_CODE_PATTERN.match(description)
        if leading:
            if not code:
                code = leading.group(0)
            description = description[leading.end() :].strip(" ,;:-")

    if description and not specification:
        split_description, split_specification = _split_description_and_spec(description)
        if split_specification:
            description = split_description
            specification = split_specification
    elif specification and not description:
        split_description, split_specification = _split_description_and_spec(specification)
        if split_description and split_specification:
            description = split_description
            specification = split_specification

    item["productCode"] = code or None
    item["productDescription"] = _strip_hsn_from_description(description)
    item["productSpecification"] = _strip_origin_certification_from_spec(specification)

    package_description = _clean_text(item.get("packageDescription"))
    if package_description:
        package_match = PACKAGE_COUNT_PATTERN.match(package_description)
        if package_match:
            if not _clean_text(item.get("noOfPackages")):
                item["noOfPackages"] = package_match.group(1)
            if not _clean_text(item.get("kindOfPkg")):
                kind = package_match.group(2).replace(".", "").upper()
                item["kindOfPkg"] = "PKGS" if kind.startswith("PKG") else kind
            trailing = _clean_text(package_match.group(3))
            item["packageDescription"] = trailing or None
        elif package_description.isdigit() and not _clean_text(item.get("noOfPackages")):
            item["noOfPackages"] = package_description
            item["packageDescription"] = None

    if item.get("noOfPackages") is not None:
        item["noOfPackages"] = _normalize_package_count(item.get("noOfPackages"))

    return item


def _with_quantity_total(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    total = 0.0
    has_quantity = False
    for item in items:
        quantity = _parse_numeric_quantity(item.get("quantity"))
        if quantity is None:
            continue
        total += quantity
        has_quantity = True
    if not has_quantity:
        return items
    formatted_total = _format_quantity_total(total)
    for item in items:
        item["quantityTotal"] = formatted_total
    return items


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
            if field_name == "signature":
                section_payload[field_name] = _normalize_signature(section_payload.get(field_name))
            if field_name == "invoiceType" and not _clean_text(section_payload.get(field_name)):
                section_payload[field_name] = "Tax Invoice"
        if section_name == "shipment":
            section_payload.pop("marksAndNumbers", None)
        normalized[section_name] = section_payload

    for field_name in ARRAY_FIELDS:
        normalized[field_name] = normalize_array_field_payload(
            value=normalized.get(field_name),
            expected_fields=ARRAY_ITEM_FIELDS.get(field_name, []),
        )
        if field_name == "lineItems":
            normalized[field_name] = _with_quantity_total(
                [_repair_line_item_fields(item) for item in normalized[field_name]]
            )

    return normalized


def parse_result(payload: dict[str, Any]) -> SalesInvoiceStructuredResult:
    normalized = normalize_payload(payload)
    return SalesInvoiceStructuredResult.model_validate(normalized)


def to_prisma_data(
    *,
    result: SalesInvoiceStructuredResult,
    raw_data: dict[str, Any],
) -> dict[str, Any]:
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


async def persist_extraction(*, prisma, document_id: str, result: SalesInvoiceStructuredResult, raw_data: dict[str, Any]):
    extraction_data = to_prisma_data(result=result, raw_data=raw_data)
    create_data = {
        **extraction_data,
        "documentId": document_id,
        "document": {"connect": {"id": document_id}},
    }
    # Compatibility fallback for stale generated Prisma clients:
    # retry upsert by removing unknown fields reported in Prisma error text.
    for _ in range(20):
        try:
            return await prisma.salesinvoiceextraction.upsert(
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
                exists_match = re.search(r"Field does not exist in enclosing type\.\s*$", error_text)
                if exists_match:
                    legacy_match = re.search(r"`[^`]*\.(\w+)`", error_text)
                    if legacy_match:
                        field_name = legacy_match.group(1)
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
    "SalesInvoiceStructuredResult",
    "ValidationError",
    "build_prompt",
    "matches_sales_invoice",
    "parse_result",
    "persist_extraction",
]
