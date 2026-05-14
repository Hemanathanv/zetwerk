from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from prisma import Json

from documents_ocr.sales_invoice.prompt import build_sales_invoice_prompt


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


class SalesInvoiceCompliance(BaseModel):
    adCode: str | None = None
    cinNo: str | None = None
    gstin: str | None = None
    irnNumber: str | None = None
    panNo: str | None = None
    rotationNo: str | None = None
    signature: bool | str | None = None


class SalesInvoiceEntities(BaseModel):
    buyerName: str | None = None
    buyerAddress: str | None = None
    consigneeName: str | None = None
    consigneeAddress: str | None = None
    exporterName: str | None = None
    exporterAddress: str | None = None
    iec: str | None = None
    notifyParty: str | None = None
    shipTo: str | None = None


class SalesInvoiceFinancial(BaseModel):
    bankName: str | None = None
    bankAccountNo: str | None = None
    bankBranch: str | None = None
    currency: str | None = None
    ifscCode: str | None = None
    swiftCode: str | None = None
    incoterms: str | None = None
    paymentTerms: str | None = None
    taxAmount: str | None = None
    cess: str | None = None
    taxableValue: str | None = None
    totalAmount: str | None = None


class SalesInvoiceHeader(BaseModel):
    invoiceNo: str | None = None
    invoiceDate: str | None = None
    buyerPoNo: str | None = None
    buyerPoDate: str | None = None
    zetwerkRef: str | None = None
    shippingBillNo: str | None = None
    shippingBillDate: str | None = None
    exporterEmail: str | None = None
    invoiceType: str | None = None
    lutArnNo: str | None = None
    issueDate: str | None = None
    otherReferences: str | None = None
    dispatchedThrough: str | None = None


class SalesInvoiceShipment(BaseModel):
    countryOfFinalDestination: str | None = None
    countryOfOrigin: str | None = None
    finalDestination: str | None = None
    placeOfReceipt: str | None = None
    portOfDischarge: str | None = None
    portOfLoading: str | None = None
    vesselFlightNo: str | None = None
    grossWeight: str | None = None
    packageDescription: str | None = None
    preCarriageBy: str | None = None
    marksAndNumbers: str | None = None


class SalesInvoiceFooter(BaseModel):
    signatoryDesignation: str | None = None
    signatoryName: str | None = None
    digitalSignatureDate: str | None = None
    digitalSignatureLocation: str | None = None
    digitalSignatureTimestamp: str | None = None
    receivablesAssignmentNotice: str | None = None
    dinNumber: str | None = None
    digitalSignatureStatus: str | None = None
    receivablesAssignmentBeneficiary: str | None = None


class SalesInvoiceStructuredResult(BaseModel):
    source: str | None = "OpenRouter"
    documentType: str | None = "Sales Invoices"
    compliance: SalesInvoiceCompliance = Field(default_factory=SalesInvoiceCompliance)
    entities: SalesInvoiceEntities = Field(default_factory=SalesInvoiceEntities)
    financial: SalesInvoiceFinancial = Field(default_factory=SalesInvoiceFinancial)
    header: SalesInvoiceHeader = Field(default_factory=SalesInvoiceHeader)
    shipment: SalesInvoiceShipment = Field(default_factory=SalesInvoiceShipment)
    footer: SalesInvoiceFooter = Field(default_factory=SalesInvoiceFooter)
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
    normalized = dict(payload)
    for section in ("compliance", "entities", "financial", "header", "shipment", "footer"):
        if normalized.get(section) is None:
            normalized[section] = {}
    if normalized.get("lineItems") is None:
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
    compliance = result.compliance
    entities = result.entities
    financial = result.financial
    header = result.header
    shipment = result.shipment
    footer = result.footer

    return {
        "adCode": compliance.adCode,
        "cinNo": compliance.cinNo,
        "gstin": compliance.gstin,
        "irnNumber": compliance.irnNumber,
        "panNo": compliance.panNo,
        "rotationNo": compliance.rotationNo,
        "signature": _coerce_string(compliance.signature),
        "buyerName": entities.buyerName,
        "buyerAddress": entities.buyerAddress,
        "consigneeName": entities.consigneeName,
        "consigneeAddress": entities.consigneeAddress,
        "exporterName": entities.exporterName,
        "exporterAddress": entities.exporterAddress,
        "iec": entities.iec,
        "notifyParty": entities.notifyParty,
        "shipTo": entities.shipTo,
        "bankName": financial.bankName,
        "bankAccountNo": financial.bankAccountNo,
        "bankBranch": financial.bankBranch,
        "currency": financial.currency,
        "ifscCode": financial.ifscCode,
        "swiftCode": financial.swiftCode,
        "incoterms": financial.incoterms,
        "paymentTerms": financial.paymentTerms,
        "taxAmount": financial.taxAmount,
        "cess": financial.cess,
        "taxableValue": financial.taxableValue,
        "totalAmount": financial.totalAmount,
        "invoiceNo": header.invoiceNo,
        "invoiceDate": header.invoiceDate,
        "buyerPoNo": header.buyerPoNo,
        "buyerPoDate": header.buyerPoDate,
        "zetwerkRef": header.zetwerkRef,
        "shippingBillNo": header.shippingBillNo,
        "shippingBillDate": header.shippingBillDate,
        "exporterEmail": header.exporterEmail,
        "invoiceType": header.invoiceType,
        "lutArnNo": header.lutArnNo,
        "issueDate": header.issueDate,
        "otherReferences": header.otherReferences,
        "dispatchedThrough": header.dispatchedThrough,
        "countryOfFinalDestination": shipment.countryOfFinalDestination,
        "countryOfOrigin": shipment.countryOfOrigin,
        "finalDestination": shipment.finalDestination,
        "placeOfReceipt": shipment.placeOfReceipt,
        "portOfDischarge": shipment.portOfDischarge,
        "portOfLoading": shipment.portOfLoading,
        "vesselFlightNo": shipment.vesselFlightNo,
        "grossWeight": shipment.grossWeight,
        "packageDescription": shipment.packageDescription,
        "preCarriageBy": shipment.preCarriageBy,
        "marksAndNumbers": shipment.marksAndNumbers,
        "signatoryDesignation": footer.signatoryDesignation,
        "signatoryName": footer.signatoryName,
        "digitalSignatureDate": footer.digitalSignatureDate,
        "digitalSignatureLocation": footer.digitalSignatureLocation,
        "digitalSignatureTimestamp": footer.digitalSignatureTimestamp,
        "receivablesAssignmentNotice": footer.receivablesAssignmentNotice,
        "dinNumber": footer.dinNumber,
        "digitalSignatureStatus": footer.digitalSignatureStatus,
        "receivablesAssignmentBeneficiary": footer.receivablesAssignmentBeneficiary,
        "lineItems": Json([item.model_dump(mode="json", exclude_none=True) for item in result.lineItems]),
        "rawData": Json(raw_data),
        "extractedAt": datetime.now(timezone.utc),
    }


async def persist_extraction(*, prisma, document_id: str, result: SalesInvoiceStructuredResult, raw_data: dict[str, Any]):
    extraction_data = to_prisma_data(result=result, raw_data=raw_data)
    return await prisma.salesinvoiceextraction.upsert(
        where={"documentId": document_id},
        data={
            "create": {
                **extraction_data,
                "document": {"connect": {"id": document_id}},
            },
            "update": extraction_data,
        },
    )


__all__ = [
    "SalesInvoiceStructuredResult",
    "ValidationError",
    "build_prompt",
    "matches_sales_invoice",
    "parse_result",
    "persist_extraction",
]
