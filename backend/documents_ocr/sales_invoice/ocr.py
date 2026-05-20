from datetime import datetime, timezone
from pathlib import Path
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from prisma import Json

from documents_ocr.sales_invoice.prompt import build_sales_invoice_prompt


PRISMA_MODEL_NAME = "SalesInvoiceExtraction"
PRISMA_SCHEMA_FILE = Path(__file__).resolve().parents[2] / "prisma" / "schema.prisma"
PRISMA_EXCLUDED_FIELDS = {
    "id",
    "documentId",
    "rawData",
    "extractedAt",
    "reviewedBy",
    "reviewedAt",
    "createdAt",
    "updatedAt",
    "document",
}
ARRAY_FIELDS = ["lineItems"]


def _load_model_fields_from_prisma(*, model_name: str, schema_path: Path) -> list[str]:
    text = schema_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    in_model = False

    fields: list[str] = []
    for raw_line in lines:
        line = raw_line.strip()

        if not in_model:
            if line.startswith(f"model {model_name} ") and line.endswith("{"):
                in_model = True
            continue

        if line == "}":
            break

        if not line or line.startswith("//") or line.startswith("@@"):
            continue

        # Prisma field lines begin with `<name> <type>`.
        parts = line.split()
        if len(parts) < 2:
            continue
        field_name = parts[0]
        if field_name.startswith("@") or field_name in PRISMA_EXCLUDED_FIELDS:
            continue
        fields.append(field_name)

    if not in_model:
        raise RuntimeError(f"Model {model_name} not found in Prisma schema: {schema_path}")
    if not fields:
        raise RuntimeError(f"No fields parsed for model {model_name} from {schema_path}")
    return fields


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
        if field_name in ARRAY_FIELDS:
            continue
        mapping[_section_for_field(field_name)].append(field_name)
    return mapping


def _build_section_model(name: str, fields: list[str]) -> type[BaseModel]:
    namespace: dict[str, Any] = {"model_config": ConfigDict(extra="allow")}
    namespace["__annotations__"] = {field_name: str | None for field_name in fields}
    for field_name in fields:
        namespace[field_name] = None
    return type(name, (BaseModel,), namespace)


SCHEMA_FIELDS = _load_model_fields_from_prisma(model_name=PRISMA_MODEL_NAME, schema_path=PRISMA_SCHEMA_FILE)
SCALAR_FIELDS = [field for field in SCHEMA_FIELDS if field not in ARRAY_FIELDS]
SECTION_FIELD_MAP = _build_section_field_map(SCALAR_FIELDS)

ComplianceSection = _build_section_model("ComplianceSection", SECTION_FIELD_MAP["compliance"])
EntitiesSection = _build_section_model("EntitiesSection", SECTION_FIELD_MAP["entities"])
FinancialSection = _build_section_model("FinancialSection", SECTION_FIELD_MAP["financial"])
HeaderSection = _build_section_model("HeaderSection", SECTION_FIELD_MAP["header"])
ShipmentSection = _build_section_model("ShipmentSection", SECTION_FIELD_MAP["shipment"])
FooterSection = _build_section_model("FooterSection", SECTION_FIELD_MAP["footer"])


class SalesInvoiceLineItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    productCode: str | None = None
    productDescription: str | None = None
    productSpecification: str | None = None
    quantity: str | None = None
    unit: str | None = None
    rate: str | None = None
    lineTotal: str | None = None
    hsnCode: str | None = None
    noOfPackages: str | None = None
    kindOfPkg: str | None = None
    productMarks: str | None = None
    containerNo: str | None = None
    sealNo: str | None = None
    boCode: str | None = None


class SalesInvoiceStructuredResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: str | None = "OpenRouter"
    documentType: str | None = "Sales Invoices"
    compliance: ComplianceSection = Field(default_factory=ComplianceSection)
    entities: EntitiesSection = Field(default_factory=EntitiesSection)
    financial: FinancialSection = Field(default_factory=FinancialSection)
    header: HeaderSection = Field(default_factory=HeaderSection)
    shipment: ShipmentSection = Field(default_factory=ShipmentSection)
    footer: FooterSection = Field(default_factory=FooterSection)
    lineItems: list[SalesInvoiceLineItem] = Field(default_factory=list)


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

    line_items = normalized.get("lineItems")
    if line_items is None:
        normalized["lineItems"] = []
    elif isinstance(line_items, dict):
        normalized["lineItems"] = [line_items]
    elif isinstance(line_items, list):
        normalized_items: list[dict[str, Any]] = []
        for item in line_items:
            if isinstance(item, dict):
                normalized_item: dict[str, Any] = {}
                for key, value in item.items():
                    if value is None:
                        normalized_item[key] = None
                    elif isinstance(value, str):
                        normalized_item[key] = value
                    else:
                        normalized_item[key] = _coerce_string(value)
                normalized_items.append(normalized_item)
        normalized["lineItems"] = normalized_items
    else:
        normalized["lineItems"] = []

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

    data["lineItems"] = Json([item.model_dump(mode="json", exclude_none=True) for item in result.lineItems])
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
