from typing import Literal, TypedDict

MappingType = Literal["direct", "derived", "contextual", "manual", "conditional"]
Severity = Literal["critical", "warning", "info"]


class FieldMapping(TypedDict, total=False):
    targetField: str
    targetLabel: str
    sourceDoc: str
    sourceField: str
    sourceLabel: str
    mappingType: MappingType
    transformation: str
    validation: str
    validationSeverity: Severity
    mono: bool


class GenSection(TypedDict):
    sectionLabel: str
    mappings: list[FieldMapping]


class DocGenSchema(TypedDict):
    generatedDocType: str
    displayName: str
    triggerCondition: str
    sourceDocs: list[str]
    humanAction: str
    totalFields: int
    autoPopulated: int
    calculated: int
    manualInput: int
    sections: list[GenSection]


PACKING_LIST_GEN: DocGenSchema = {
    "generatedDocType": "PACKING_LIST",
    "displayName": "Packing List",
    "triggerCondition": "Sales Invoice APPROVED (extraction confirmed by human)",
    "sourceDocs": ["SALES_INVOICE"],
    "humanAction": "Review bundle allocation, confirm weights",
    "totalFields": 46,
    "autoPopulated": 32,
    "calculated": 7,
    "manualInput": 7,
    "sections": [
        {
            "sectionLabel": "Header",
            "mappings": [
                {"targetField": "invoiceNo", "targetLabel": "Invoice No", "sourceDoc": "SALES_INVOICE", "sourceField": "invoiceNo", "sourceLabel": "Invoice No", "mappingType": "direct", "validation": "NOT NULL", "validationSeverity": "critical", "mono": True},
                {"targetField": "invoiceDate", "targetLabel": "Invoice Date", "sourceDoc": "SALES_INVOICE", "sourceField": "invoiceDate", "sourceLabel": "Invoice Date", "mappingType": "direct", "validation": "NOT NULL; date <= today", "validationSeverity": "critical", "mono": True},
                {"targetField": "buyerPoNo", "targetLabel": "Buyer PO No", "sourceDoc": "SALES_INVOICE", "sourceField": "buyerPoNo", "sourceLabel": "Buyer PO No", "mappingType": "direct", "mono": True},
                {"targetField": "zetwerkRef", "targetLabel": "Zetwerk Ref", "sourceDoc": "SALES_INVOICE", "sourceField": "zetwerkRef", "sourceLabel": "Zetwerk Ref", "mappingType": "direct", "mono": True},
                {"targetField": "pickupAddress", "targetLabel": "Pickup Address", "sourceDoc": "SALES_INVOICE", "sourceField": "exporterAddress", "sourceLabel": "Exporter Address", "mappingType": "contextual", "transformation": "Map exporter address as pickup location"},
            ],
        },
        {
            "sectionLabel": "Parties",
            "mappings": [
                {"targetField": "exporterName", "targetLabel": "Exporter", "sourceDoc": "SALES_INVOICE", "sourceField": "exporterName", "sourceLabel": "Exporter Name", "mappingType": "direct", "validation": "NOT NULL", "validationSeverity": "critical"},
                {"targetField": "buyerName", "targetLabel": "Buyer", "sourceDoc": "SALES_INVOICE", "sourceField": "buyerName", "sourceLabel": "Buyer Name", "mappingType": "direct", "validation": "NOT NULL", "validationSeverity": "critical"},
                {"targetField": "consigneeName", "targetLabel": "Consignee", "sourceDoc": "SALES_INVOICE", "sourceField": "consigneeName", "sourceLabel": "Consignee Name", "mappingType": "direct", "validation": "NOT NULL", "validationSeverity": "critical"},
                {"targetField": "gstin", "targetLabel": "GSTIN", "sourceDoc": "SALES_INVOICE", "sourceField": "gstin", "sourceLabel": "GSTIN", "mappingType": "direct", "mono": True},
                {"targetField": "iec", "targetLabel": "IEC", "sourceDoc": "SALES_INVOICE", "sourceField": "iec", "sourceLabel": "IEC", "mappingType": "direct", "mono": True},
            ],
        },
        {
            "sectionLabel": "Shipping",
            "mappings": [
                {"targetField": "portOfLoading", "targetLabel": "Port of Loading", "sourceDoc": "SALES_INVOICE", "sourceField": "portOfLoading", "sourceLabel": "Port of Loading", "mappingType": "direct"},
                {"targetField": "portOfDischarge", "targetLabel": "Port of Discharge", "sourceDoc": "SALES_INVOICE", "sourceField": "portOfDischarge", "sourceLabel": "Port of Discharge", "mappingType": "direct"},
                {"targetField": "countryOfOrigin", "targetLabel": "Country of Origin", "sourceDoc": "SALES_INVOICE", "sourceField": "countryOfOrigin", "sourceLabel": "Country of Origin", "mappingType": "direct", "validation": "NOT NULL", "validationSeverity": "critical"},
                {"targetField": "finalDestination", "targetLabel": "Final Destination", "sourceDoc": "SALES_INVOICE", "sourceField": "finalDestination", "sourceLabel": "Final Destination", "mappingType": "direct"},
            ],
        },
        {
            "sectionLabel": "Totals",
            "mappings": [
                {"targetField": "totalBundles", "targetLabel": "Total Bundles", "sourceDoc": "CALCULATED", "sourceField": "SUM(lineItems.noOfBundles)", "sourceLabel": "Sum of line item bundles", "mappingType": "derived", "transformation": "SUM(Line Items[No Of Bundles])", "validation": "Total >= count(lineItems)", "validationSeverity": "critical", "mono": True},
                {"targetField": "totalQty", "targetLabel": "Total Qty (PCS)", "sourceDoc": "CALCULATED", "sourceField": "SUM(lineItems.quantity)", "sourceLabel": "Sum of line item quantities", "mappingType": "derived", "transformation": "SUM(Line Items[Quantity])", "validation": "Total >= max(lineItems.qty)", "validationSeverity": "critical", "mono": True},
                {"targetField": "totalNetWeightKgs", "targetLabel": "Total Net Weight (kg)", "sourceDoc": "CALCULATED", "sourceField": "SUM(lineItems.netWeightKgs)", "sourceLabel": "Sum of line item net weights", "mappingType": "derived", "validation": "Net <= Gross", "validationSeverity": "critical", "mono": True},
                {"targetField": "totalGrossWeightKgs", "targetLabel": "Total Gross Weight (kg)", "sourceDoc": "CALCULATED", "sourceField": "SUM(lineItems.grossWeightKgs)", "sourceLabel": "Sum of line item gross weights", "mappingType": "derived", "validation": "Gross >= Net", "validationSeverity": "critical", "mono": True},
            ],
        },
        {
            "sectionLabel": "Line Items",
            "mappings": [
                {"targetField": "lineItems[].productCode", "targetLabel": "Product Code", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].productCode", "sourceLabel": "Product Code", "mappingType": "direct", "validation": "NOT NULL per line", "validationSeverity": "critical", "mono": True},
                {"targetField": "lineItems[].productDescription", "targetLabel": "Description", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].productDescription", "sourceLabel": "Product Description", "mappingType": "direct"},
                {"targetField": "lineItems[].totalQtyInPcs", "targetLabel": "Total Qty (PCS)", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].quantity", "sourceLabel": "Quantity", "mappingType": "direct", "validation": "> 0", "validationSeverity": "critical", "mono": True},
                {"targetField": "lineItems[].containerNo", "targetLabel": "Container No", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].containerNo", "sourceLabel": "Container No", "mappingType": "direct", "mono": True},
                {"targetField": "lineItems[].sealNo", "targetLabel": "Seal No", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].sealNo", "sourceLabel": "Seal No", "mappingType": "direct", "mono": True},
                {"targetField": "lineItems[].noOfBundles", "targetLabel": "No of Bundles", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].noOfPackages", "sourceLabel": "No of Packages", "mappingType": "conditional", "transformation": "Use noOfPackages, else manual", "validation": "NOT NULL or flagged manual", "validationSeverity": "warning", "mono": True},
                {"targetField": "lineItems[].grossWeightKgs", "targetLabel": "Gross Weight (kg)", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].grossWeight", "sourceLabel": "Gross Weight", "mappingType": "conditional", "transformation": "Copy from invoice if available; else manual", "validation": "> 0", "validationSeverity": "warning", "mono": True},
            ],
        },
    ],
}


OUTWARD_PL_GEN: DocGenSchema = {
    "generatedDocType": "US_PACKING_LIST",
    "displayName": "Outward Packing List",
    "triggerCondition": "Packing List CLOSED + BOL APPROVED (both must exist)",
    "sourceDocs": ["PACKING_LIST", "BILL_OF_LADING"],
    "humanAction": "Confirm container-wise packing allocation",
    "totalFields": 34,
    "autoPopulated": 22,
    "calculated": 4,
    "manualInput": 8,
    "sections": [
        {
            "sectionLabel": "Document Header",
            "mappings": [
                {"targetField": "packingSlipNumber", "targetLabel": "Packing Slip Number", "sourceDoc": "CALCULATED", "sourceField": "OPL-{bolNumber}-{seq}", "sourceLabel": "Auto-generated from BOL", "mappingType": "derived", "mono": True},
                {"targetField": "documentDate", "targetLabel": "Date", "sourceDoc": "CALCULATED", "sourceField": "today()", "sourceLabel": "Current date", "mappingType": "derived", "mono": True},
                {"targetField": "soNumber", "targetLabel": "SO Number", "sourceDoc": "PACKING_LIST", "sourceField": "zetwerkRef", "sourceLabel": "Zetwerk Ref", "mappingType": "direct", "mono": True},
                {"targetField": "poNumber", "targetLabel": "PO Number", "sourceDoc": "PACKING_LIST", "sourceField": "buyerPoNo", "sourceLabel": "Buyer PO No", "mappingType": "direct", "mono": True},
                {"targetField": "bolNumber", "targetLabel": "BOL Number", "sourceDoc": "BILL_OF_LADING", "sourceField": "bolNumber", "sourceLabel": "BOL Number", "mappingType": "direct", "mono": True},
                {"targetField": "projectName", "targetLabel": "Project Name", "sourceDoc": "BILL_OF_LADING", "sourceField": "projectName", "sourceLabel": "Project Name", "mappingType": "direct"},
            ],
        },
        {
            "sectionLabel": "Parties",
            "mappings": [
                {"targetField": "shipperName", "targetLabel": "Shipper", "sourceDoc": "BILL_OF_LADING", "sourceField": "shipperName", "sourceLabel": "BOL Shipper", "mappingType": "direct"},
                {"targetField": "shipToName", "targetLabel": "Ship To", "sourceDoc": "BILL_OF_LADING", "sourceField": "consigneeName", "sourceLabel": "BOL Consignee", "mappingType": "direct"},
                {"targetField": "consigneeName", "targetLabel": "Consignee (3PL)", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "3PL warehouse name", "mappingType": "manual"},
            ],
        },
        {
            "sectionLabel": "Container Allocation",
            "mappings": [
                {"targetField": "containers[].containerNumber", "targetLabel": "Container Number", "sourceDoc": "BILL_OF_LADING", "sourceField": "containers[].number", "sourceLabel": "BOL Container", "mappingType": "direct", "mono": True},
                {"targetField": "containers[].sealNumber", "targetLabel": "Seal Number", "sourceDoc": "BILL_OF_LADING", "sourceField": "containers[].sealNumber", "sourceLabel": "BOL Seal", "mappingType": "direct", "mono": True},
                {"targetField": "containers[].lineItems", "targetLabel": "Items in Container", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Human allocates items to containers", "mappingType": "manual"},
            ],
        },
        {
            "sectionLabel": "Totals",
            "mappings": [
                {"targetField": "totalLines", "targetLabel": "Total Lines", "sourceDoc": "CALCULATED", "sourceField": "COUNT(lineItems)", "sourceLabel": "Line item count", "mappingType": "derived", "mono": True},
                {"targetField": "totalPiecesAggregate", "targetLabel": "Total Pieces", "sourceDoc": "PACKING_LIST", "sourceField": "totalQty", "sourceLabel": "PL Total Qty", "mappingType": "direct", "mono": True},
                {"targetField": "totalWeightLbs", "targetLabel": "Total Weight (lbs)", "sourceDoc": "CALCULATED", "sourceField": "PL.totalGrossWeightKgs * 2.20462", "sourceLabel": "Converted kg to lbs", "mappingType": "derived", "mono": True},
            ],
        },
    ],
}


DRAFT_BOE_GEN: DocGenSchema = {
    "generatedDocType": "ENTRY_SUMMARY",
    "displayName": "Draft Bill of Entry (Entry Summary)",
    "triggerCondition": "BOL APPROVED (extraction confirmed by human)",
    "sourceDocs": ["BILL_OF_LADING", "SALES_INVOICE"],
    "humanAction": "Add HTS codes, review duty calculations, send to US broker for filing",
    "totalFields": 47,
    "autoPopulated": 28,
    "calculated": 5,
    "manualInput": 14,
    "sections": [
        {
            "sectionLabel": "Entry Details",
            "mappings": [
                {"targetField": "filerCodeEntryNumber", "targetLabel": "Entry Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Assigned by US Customs broker", "mappingType": "manual", "mono": True},
                {"targetField": "entryType", "targetLabel": "Entry Type", "sourceDoc": "CALCULATED", "sourceField": "01 (consumption)", "sourceLabel": "Default: 01 consumption entry", "mappingType": "derived"},
                {"targetField": "entryDate", "targetLabel": "Entry Date", "sourceDoc": "CALCULATED", "sourceField": "today()", "sourceLabel": "Current date", "mappingType": "derived", "mono": True},
                {"targetField": "portCode", "targetLabel": "Port Code", "sourceDoc": "BILL_OF_LADING", "sourceField": "portOfDischarge", "sourceLabel": "BOL Port of Discharge", "mappingType": "contextual", "transformation": "Map port name to CBP port code"},
            ],
        },
        {
            "sectionLabel": "Transport",
            "mappings": [
                {"targetField": "importingCarrier", "targetLabel": "Importing Carrier", "sourceDoc": "BILL_OF_LADING", "sourceField": "carrierCompanyName", "sourceLabel": "BOL Carrier", "mappingType": "direct"},
                {"targetField": "importDate", "targetLabel": "Import Date", "sourceDoc": "BILL_OF_LADING", "sourceField": "shippedOnBoardDate", "sourceLabel": "BOL Shipped On Board", "mappingType": "direct", "mono": True},
                {"targetField": "blOrAwbNumber", "targetLabel": "BL Number", "sourceDoc": "BILL_OF_LADING", "sourceField": "bolNumber", "sourceLabel": "BOL Number", "mappingType": "direct", "mono": True},
            ],
        },
        {
            "sectionLabel": "Importer",
            "mappings": [
                {"targetField": "importerOfRecordName", "targetLabel": "Importer of Record", "sourceDoc": "BILL_OF_LADING", "sourceField": "consigneeName", "sourceLabel": "BOL Consignee", "mappingType": "direct"},
                {"targetField": "importerNumber", "targetLabel": "Importer Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "CBP importer number", "mappingType": "manual", "mono": True},
            ],
        },
        {
            "sectionLabel": "Tariff Lines",
            "mappings": [
                {"targetField": "tariffLines[].lineHtsusNumber", "targetLabel": "HTS Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "US broker assigns HTS classification", "mappingType": "manual", "mono": True},
                {"targetField": "tariffLines[].lineMerchandiseDescription", "targetLabel": "Merchandise Description", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].productDescription", "sourceLabel": "SI Product Description", "mappingType": "direct"},
                {"targetField": "tariffLines[].enteredValue", "targetLabel": "Entered Value", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].lineTotal", "sourceLabel": "SI Line Total", "mappingType": "direct", "mono": True},
                {"targetField": "tariffLines[].dutyAmount", "targetLabel": "Duty Amount", "sourceDoc": "CALCULATED", "sourceField": "enteredValue * dutyRate", "sourceLabel": "Calculated", "mappingType": "derived", "mono": True},
            ],
        },
    ],
}


DOC_GEN_SCHEMAS: dict[str, DocGenSchema] = {
    "PACKING_LIST": PACKING_LIST_GEN,
    "US_PACKING_LIST": OUTWARD_PL_GEN,
    "ENTRY_SUMMARY": DRAFT_BOE_GEN,
}


def get_doc_gen_schema(doc_type: str) -> DocGenSchema | None:
    return DOC_GEN_SCHEMAS.get(doc_type)


def get_field_summary(doc_type: str) -> dict[str, int]:
    schema = get_doc_gen_schema(doc_type)
    if not schema:
        return {"auto": 0, "calc": 0, "manual": 0, "total": 0}
    return {
        "auto": schema["autoPopulated"],
        "calc": schema["calculated"],
        "manual": schema["manualInput"],
        "total": schema["totalFields"],
    }
