"""Mandatory OCR field validation.

Rules were transcribed from OCR_Extraction_Master_Completed (1).xlsx.
Only cells explicitly marked true in the workbook are mandatory. False, zero,
blank, or omitted mandatory cells are intentionally treated as non-mandatory.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from documents_ocr.schema_loader import ExtractionSchema


MANDATORY_FIELDS_BY_MODEL: dict[str, tuple[str, ...]] = {
    "SalesInvoiceExtraction": (
        "buyerName",
        "buyerAddress",
        "consigneeName",
        "consigneeAddress",
        "exporterName",
        "exporterAddress",
        "notifyParty",
        "shipTo",
        "incoterms",
        "taxAmount",
        "cess",
        "taxableValue",
        "totalAmount",
        "invoiceNo",
        "invoiceDate",
        "buyerPoNo",
        "buyerPoDate",
        "zetwerkRef",
        "dispatchedThrough",
        "countryOfFinalDestination",
        "countryOfOrigin",
        "finalDestination",
        "placeOfReceipt",
        "portOfDischarge",
        "portOfLoading",
        "vesselFlightNo",
        "totalQuantity",
        "packageDescription",
        "preCarriageBy",
        "lineItems",
    ),
    "PackingListExtraction": (
        "buyerName",
        "buyerAddress",
        "consigneeName",
        "consigneeAddress",
        "exporterName",
        "exporterAddress",
        "shipTo",
        "invoiceNo",
        "invoiceDate",
        "buyerPoNo",
        "buyerPoDate",
        "pickupAddress",
        "totalBundles",
        "totalQty",
        "totalNetWeightKgs",
        "totalGrossWeightKgs",
        "countryOfFinalDestination",
        "countryOfOrigin",
        "finalDestination",
        "placeOfReceipt",
        "portOfDischarge",
        "portOfLoading",
        "vesselFlightNo",
        "preCarriageBy",
        "lineItems",
    ),
    "BillOfLading": (
        "bolNumber",
        "shipmentReferenceNumber",
        "projectName",
        "documentCategory",
        "carrierCompanyName",
        "carrierMtoRegistrationNumber",
        "carrierFmcNumber",
        "shipperName",
        "shipperAddress",
        "consigneeName",
        "consigneeAddress",
        "consigneeContactName",
        "consigneePhone",
        "consigneeEmail",
        "notifyPartyName",
        "notifyPartyAddress",
        "notifyPartyEmail",
        "notifyPartyPhone",
        "deliveryAgentName",
        "deliveryAgentAddress",
        "deliveryAgentPhone",
        "deliveryAgentEmail",
        "placeOfAcceptance",
        "portOfLoading",
        "placeOfReceipt",
        "countryOfOrigin",
        "portOfDischarge",
        "finalDestination",
        "placeOfDelivery",
        "transhipmentPlace",
        "vesselName",
        "vesselVoyageNumber",
        "shippedOnBoardDate",
        "vesselCarrierName",
        "marksAndNumbers",
        "packageSummary",
        "totalPackages",
        "totalContainers",
        "goodsDescription",
        "grossWeight",
        "grossWeightUnit",
        "netWeight",
        "netWeightUnit",
        "usHsnc",
        "issuancePlace",
        "issuanceDate",
        "exportInvoiceNumber",
        "exportInvoiceDate",
        "exportShippingBillNumber",
        "exportShippingBillDate",
        "exportInvoices",
        "containers",
        "shippingBills",
    ),
    "EntrySummaryExtraction": (
        "filerCodeEntryNumber",
        "entryType",
        "summaryDate",
        "suretyNumber",
        "bondType",
        "portCode",
        "entryDate",
        "importingCarrier",
        "modeOfTransport",
        "importDate",
        "blOrAwbNumber",
        "additionalBLs",
        "houseBill",
        "manufacturerId",
        "exportingCountry",
        "exportDate",
        "foreignPortOfLading",
        "usPortOfUnlading",
        "countryOfOrigin",
        "locationOfGoods",
        "consigneeNumber",
        "importerNumber",
        "referenceNumber",
        "ultimateConsigneeName",
        "ultimateConsigneeAddress",
        "ultimateConsigneeCity",
        "ultimateConsigneeState",
        "ultimateConsigneeZip",
        "importerOfRecordName",
        "importerOfRecordAddress",
        "importerOfRecordCity",
        "importerOfRecordState",
        "importerOfRecordZip",
        "mpfTotal",
        "hmfTotal",
        "totalOtherFees",
        "totalEnteredValue",
        "totalDuty",
        "totalTax",
        "totalOther",
        "grandTotal",
        "declarantName",
        "declarantCompany",
        "declarantTitle",
        "declarantDate",
        "brokerName",
        "brokerAddress",
        "brokerPhone",
        "brokerImporterFileNumber",
        "lineItems",
    ),
    "OceanFreightExtraction": (
        "issuerCompanyName",
        "issuerAddress",
        "invoiceNumber",
        "invoiceDate",
        "customerName",
        "customerAddress",
        "shipper",
        "consignee",
        "vesselName",
        "voyageNumber",
        "loadingPort",
        "dischargingPort",
        "cpDate",
        "oceanBol",
        "houseBol",
        "mawb",
        "hawb",
        "containersList",
        "containersTotalCount",
        "totalUsd",
        "charges",
    ),
}


@dataclass(frozen=True)
class MandatoryValidationResult:
    missing_fields: list[str]

    @property
    def ok(self) -> bool:
        return not self.missing_fields


def _is_present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(_is_present(item) for item in value)
    if isinstance(value, dict):
        return any(_is_present(item) for item in value.values())
    return True


def _field_value(extraction: object, field_name: str) -> Any:
    if isinstance(extraction, dict):
        return extraction.get(field_name)
    return getattr(extraction, field_name, None)


def validate_mandatory_fields(
    *,
    parent_model: str,
    schema: ExtractionSchema,
    extraction: object,
    child_arrays: dict[str, list[dict[str, Any]]] | None = None,
) -> MandatoryValidationResult:
    """Validate workbook-mandatory fields for one OCR extraction."""

    rules = MANDATORY_FIELDS_BY_MODEL.get(parent_model, ())
    if not rules:
        return MandatoryValidationResult(missing_fields=[])

    child_arrays = child_arrays or {}
    array_item_fields = {
        item_field: array_name
        for array_name, fields in schema.array_item_fields.items()
        for item_field in fields
    }
    missing: list[str] = []

    for field_name in rules:
        if field_name in schema.scalar_fields:
            if not _is_present(_field_value(extraction, field_name)):
                missing.append(field_name)
            continue

        if field_name in schema.array_fields:
            if not _is_present(child_arrays.get(field_name, [])):
                missing.append(field_name)
            continue

        array_name = array_item_fields.get(field_name)
        if array_name:
            rows = child_arrays.get(array_name, [])
            if not rows or any(not _is_present(row.get(field_name)) for row in rows):
                missing.append(f"{array_name}.{field_name}")
            continue

        if not _is_present(_field_value(extraction, field_name)):
            missing.append(field_name)

    return MandatoryValidationResult(missing_fields=missing)


__all__ = [
    "MANDATORY_FIELDS_BY_MODEL",
    "MandatoryValidationResult",
    "validate_mandatory_fields",
]
