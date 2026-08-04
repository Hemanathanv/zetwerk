from datetime import datetime, timezone
from typing import Any

from prisma import Json
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from documents_ocr.ISF.prompt import build_isf_prompt
from documents_ocr.schema_loader import load_extraction_schema, upsert_extraction_with_children


_SCHEMA = load_extraction_schema(parent_model="IsfExtraction")
SCALAR_FIELDS = _SCHEMA.scalar_fields


def _coerce_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value).strip()
    return text or None


class IsfManufacturer(BaseModel):
    model_config = ConfigDict(extra="ignore")

    manufacturerName: str | None = None
    streetAddress1: str | None = None
    streetAddress2: str | None = None
    city: str | None = None
    province: str | None = None
    postalCode: str | None = None
    country: str | None = None
    poNumber: str | None = None
    htsCode: str | None = None
    productCode: str | None = None
    countryOfOrigin: str | None = None

    @field_validator("*", mode="before")
    @classmethod
    def coerce_values(cls, value: Any) -> str | None:
        return _coerce_string(value)


class IsfStructuredResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    source: str | None = "OpenRouter"
    documentType: str | None = "ISF"

    importerName: str | None = None
    formSubmittedByName: str | None = None
    formSubmittedByCompany: str | None = None
    telephone: str | None = None
    fax: str | None = None
    email: str | None = None

    transactionId: str | None = None
    blType: str | None = None
    masterBlNumber: str | None = None
    bondType: str | None = None
    bondTerm: str | None = None
    haveABondWithCbp: str | None = None
    filerDocumentNumber: str | None = None
    filerDocumentType: str | None = None
    agentFilerCode: str | None = None

    scacCode: str | None = None
    houseBlNumber: str | None = None
    masterBlType: str | None = None
    containerNumber: str | None = None
    vesselNameAndVoyage: str | None = None
    sailingDate: str | None = None
    destinationPort: str | None = None
    estimatedDateArrivalPort: str | None = None

    consigneeName: str | None = None
    consigneeStreetAddress1: str | None = None
    consigneeStreetAddress2: str | None = None
    consigneeCity: str | None = None
    consigneeState: str | None = None
    consigneePostalCode: str | None = None
    consigneeCountry: str | None = None
    consigneeContact: str | None = None
    consigneeTelephone: str | None = None
    consigneeIrsTaxId: str | None = None

    buyerName: str | None = None
    buyerStreetAddress1: str | None = None
    buyerStreetAddress2: str | None = None
    buyerCity: str | None = None
    buyerState: str | None = None
    buyerPostalCode: str | None = None
    buyerCountry: str | None = None
    buyerContact: str | None = None
    buyerTelephone: str | None = None

    shipToName: str | None = None
    shipToStreetAddress1: str | None = None
    shipToStreetAddress2: str | None = None
    shipToCity: str | None = None
    shipToState: str | None = None
    shipToPostalCode: str | None = None
    shipToCountry: str | None = None
    shipToContact: str | None = None
    shipToTelephone: str | None = None

    sellerName: str | None = None
    sellerStreetAddress1: str | None = None
    sellerStreetAddress2: str | None = None
    sellerCity: str | None = None
    sellerProvince: str | None = None
    sellerPostalCode: str | None = None
    sellerCountry: str | None = None
    sellerContact: str | None = None
    sellerTelephone: str | None = None

    consolidatorName: str | None = None
    consolidatorStreetAddress1: str | None = None
    consolidatorStreetAddress2: str | None = None
    consolidatorCity: str | None = None
    consolidatorProvince: str | None = None
    consolidatorPostalCode: str | None = None
    consolidatorCountry: str | None = None
    consolidatorContact: str | None = None
    consolidatorTelephone: str | None = None

    stuffingLocationName: str | None = None
    stuffingLocationStreetAddress1: str | None = None
    stuffingLocationStreetAddress2: str | None = None
    stuffingLocationCity: str | None = None
    stuffingLocationProvince: str | None = None
    stuffingLocationPostalCode: str | None = None
    stuffingLocationCountry: str | None = None
    stuffingLocationContact: str | None = None
    stuffingLocationTelephone: str | None = None

    manufacturers: list[IsfManufacturer] = Field(default_factory=list)

    @field_validator("*", mode="before")
    @classmethod
    def coerce_scalar_values(cls, value: Any, info):
        if info.field_name == "manufacturers":
            if isinstance(value, dict):
                return [value]
            return value if isinstance(value, list) else []
        return _coerce_string(value)


def matches_isf(*, bucket: str, module: str, document: Any) -> bool:
    candidates = (
        bucket,
        module,
        getattr(document, "bucket", ""),
        getattr(document, "fileName", ""),
        getattr(document, "docType", ""),
    )
    normalized = {"".join(ch for ch in str(value or "").lower() if ch.isalnum()) for value in candidates}
    return any(token in {"isf", "importersecurityfiling", "isf10plus2", "isf102"} for token in normalized)


def build_prompt() -> str:
    return build_isf_prompt(IsfStructuredResult)


def parse_result(payload: dict[str, Any]) -> IsfStructuredResult:
    return IsfStructuredResult.model_validate(payload or {})


def to_prisma_data(*, result: IsfStructuredResult, raw_data: dict[str, Any]) -> dict[str, Any]:
    payload = result.model_dump(mode="json", exclude_none=False)
    data = {field_name: _coerce_string(payload.get(field_name)) for field_name in SCALAR_FIELDS}
    data["manufacturers"] = payload.get("manufacturers") or []
    data["rawData"] = Json(raw_data)
    data["extractedAt"] = datetime.now(timezone.utc)
    return data


async def persist_extraction(*, prisma, document_id: str, result: IsfStructuredResult, raw_data: dict[str, Any]):
    return await upsert_extraction_with_children(
        prisma=prisma,
        model_accessor_name="isfextraction",
        schema=_SCHEMA,
        document_id=document_id,
        extraction_data=to_prisma_data(result=result, raw_data=raw_data),
    )


__all__ = [
    "IsfManufacturer",
    "IsfStructuredResult",
    "ValidationError",
    "build_prompt",
    "matches_isf",
    "parse_result",
    "persist_extraction",
    "to_prisma_data",
]
