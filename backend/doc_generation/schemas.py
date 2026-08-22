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
                {"targetField": "buyerPoDate", "targetLabel": "PO Date", "sourceDoc": "SALES_INVOICE", "sourceField": "buyerPoDate", "sourceLabel": "PO Date", "mappingType": "direct", "mono": True},
                {"targetField": "exporterRef", "targetLabel": "Exporter Reference", "sourceDoc": "SALES_INVOICE", "sourceField": "zetwerkRef", "sourceLabel": "Zetwerk Ref", "mappingType": "direct", "mono": True},
                {"targetField": "zetwerkRef", "targetLabel": "Zetwerk Ref", "sourceDoc": "SALES_INVOICE", "sourceField": "zetwerkRef", "sourceLabel": "Zetwerk Ref", "mappingType": "direct", "mono": True},
                {"targetField": "otherReferences", "targetLabel": "Other References", "sourceDoc": "SALES_INVOICE", "sourceField": "otherReferences", "sourceLabel": "Other References", "mappingType": "direct"},
                {"targetField": "pickupAddress", "targetLabel": "Pickup Address", "sourceDoc": "SALES_INVOICE", "sourceField": "exporterAddress", "sourceLabel": "Exporter Address", "mappingType": "contextual", "transformation": "Map exporter address as pickup location"},
            ],
        },
        {
            "sectionLabel": "Parties",
            "mappings": [
                {"targetField": "exporterName", "targetLabel": "Exporter", "sourceDoc": "SALES_INVOICE", "sourceField": "exporterName", "sourceLabel": "Exporter Name", "mappingType": "direct", "validation": "NOT NULL", "validationSeverity": "critical"},
                {"targetField": "exporterAddress", "targetLabel": "Exporter Address", "sourceDoc": "SALES_INVOICE", "sourceField": "exporterAddress", "sourceLabel": "Exporter Address", "mappingType": "direct"},
                {"targetField": "buyerName", "targetLabel": "Buyer", "sourceDoc": "SALES_INVOICE", "sourceField": "buyerName", "sourceLabel": "Buyer Name", "mappingType": "direct", "validation": "NOT NULL", "validationSeverity": "critical"},
                {"targetField": "buyerAddress", "targetLabel": "Buyer Address", "sourceDoc": "SALES_INVOICE", "sourceField": "buyerAddress", "sourceLabel": "Buyer Address", "mappingType": "direct"},
                {"targetField": "consigneeName", "targetLabel": "Consignee", "sourceDoc": "SALES_INVOICE", "sourceField": "consigneeName", "sourceLabel": "Consignee Name", "mappingType": "direct", "validation": "NOT NULL", "validationSeverity": "critical"},
                {"targetField": "consigneeAddress", "targetLabel": "Consignee Address", "sourceDoc": "SALES_INVOICE", "sourceField": "consigneeAddress", "sourceLabel": "Consignee Address", "mappingType": "direct"},
                {"targetField": "gstin", "targetLabel": "GSTIN", "sourceDoc": "SALES_INVOICE", "sourceField": "gstin", "sourceLabel": "GSTIN", "mappingType": "direct", "mono": True},
                {"targetField": "iec", "targetLabel": "IEC", "sourceDoc": "SALES_INVOICE", "sourceField": "iec", "sourceLabel": "IEC", "mappingType": "direct", "mono": True},
                {"targetField": "shipTo", "targetLabel": "Ship To", "sourceDoc": "SALES_INVOICE", "sourceField": "shipTo", "sourceLabel": "Ship To", "mappingType": "direct"},
            ],
        },
        {
            "sectionLabel": "Shipping",
            "mappings": [
                {"targetField": "portOfLoading", "targetLabel": "Port of Loading", "sourceDoc": "SALES_INVOICE", "sourceField": "portOfLoading", "sourceLabel": "Port of Loading", "mappingType": "direct"},
                {"targetField": "portOfDischarge", "targetLabel": "Port of Discharge", "sourceDoc": "SALES_INVOICE", "sourceField": "portOfDischarge", "sourceLabel": "Port of Discharge", "mappingType": "direct"},
                {"targetField": "countryOfOrigin", "targetLabel": "Country of Origin", "sourceDoc": "SALES_INVOICE", "sourceField": "countryOfOrigin", "sourceLabel": "Country of Origin", "mappingType": "direct", "validation": "NOT NULL", "validationSeverity": "critical"},
                {"targetField": "countryOfFinalDestination", "targetLabel": "Final Destination Country", "sourceDoc": "SALES_INVOICE", "sourceField": "countryOfFinalDestination", "sourceLabel": "Final Destination Country", "mappingType": "direct"},
                {"targetField": "finalDestination", "targetLabel": "Final Destination", "sourceDoc": "SALES_INVOICE", "sourceField": "finalDestination", "sourceLabel": "Final Destination", "mappingType": "direct"},
                {"targetField": "placeOfReceipt", "targetLabel": "Place of Receipt", "sourceDoc": "SALES_INVOICE", "sourceField": "placeOfReceipt", "sourceLabel": "Place of Receipt", "mappingType": "direct"},
                {"targetField": "vesselFlightNo", "targetLabel": "Vessel / Flight No", "sourceDoc": "SALES_INVOICE", "sourceField": "vesselFlightNo", "sourceLabel": "Vessel / Flight No", "mappingType": "direct"},
                {"targetField": "preCarriageBy", "targetLabel": "Pre-Carriage By", "sourceDoc": "SALES_INVOICE", "sourceField": "preCarriageBy", "sourceLabel": "Pre-Carriage By", "mappingType": "direct"},
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
            "sectionLabel": "Footer",
            "mappings": [
                {"targetField": "signatoryName", "targetLabel": "Signatory Name", "sourceDoc": "SALES_INVOICE", "sourceField": "signatoryName", "sourceLabel": "Signatory Name", "mappingType": "direct"},
                {"targetField": "signatoryDesignation", "targetLabel": "Designation", "sourceDoc": "SALES_INVOICE", "sourceField": "signatoryDesignation", "sourceLabel": "Designation", "mappingType": "direct"},
                {"targetField": "dinNumber", "targetLabel": "DIN Number", "sourceDoc": "SALES_INVOICE", "sourceField": "dinNumber", "sourceLabel": "DIN Number", "mappingType": "direct", "mono": True},
            ],
        },
        {
            "sectionLabel": "Line Items",
            "mappings": [
                {"targetField": "lineItems[].hsnCode", "targetLabel": "HSN Code", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].hsnCode", "sourceLabel": "HSN Code", "mappingType": "direct", "validation": "NOT NULL per line", "validationSeverity": "critical", "mono": True},
                {"targetField": "lineItems[].productCode", "targetLabel": "Product Code", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].productCode", "sourceLabel": "Product Code", "mappingType": "direct", "validation": "NOT NULL per line", "validationSeverity": "critical", "mono": True},
                {"targetField": "lineItems[].productDescription", "targetLabel": "Description", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].productDescription", "sourceLabel": "Product Description", "mappingType": "direct"},
                {"targetField": "lineItems[].productMarks", "targetLabel": "Product Marks", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].productMarks", "sourceLabel": "Product Marks", "mappingType": "direct"},
                {"targetField": "lineItems[].boCode", "targetLabel": "BO Code", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].boCode", "sourceLabel": "BO Code", "mappingType": "direct", "mono": True},
                {"targetField": "lineItems[].containerNo", "targetLabel": "Container No", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].containerNo", "sourceLabel": "Container No", "mappingType": "direct", "mono": True},
                {"targetField": "lineItems[].sealNo", "targetLabel": "Seal No", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].sealNo", "sourceLabel": "Seal No", "mappingType": "direct", "mono": True},
                {"targetField": "lineItems[].kindOfPkg", "targetLabel": "Package Type", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].kindOfPkg", "sourceLabel": "Kind of Pkg", "mappingType": "direct"},
                {"targetField": "lineItems[].totalQtyInPcs", "targetLabel": "Qty (PCS)", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].quantity", "sourceLabel": "Quantity", "mappingType": "direct", "validation": "> 0", "validationSeverity": "critical", "mono": True},
                {"targetField": "lineItems[].qtyPerBundle", "targetLabel": "Qty/Bundle", "sourceDoc": "CALCULATED", "sourceField": "quantity / noOfBundles", "sourceLabel": "Derived", "mappingType": "derived", "transformation": "qty ÷ bundles when bundles entered", "validation": "qtyPerBundle × bundles = qty", "validationSeverity": "critical", "mono": True},
                {"targetField": "lineItems[].noOfBundles", "targetLabel": "Bundles", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].noOfBundles", "sourceLabel": "No of Bundles", "mappingType": "conditional", "transformation": "Use bundle count only; do not use package count", "validation": "NOT NULL or flagged manual", "validationSeverity": "warning", "mono": True},
                {"targetField": "lineItems[].netWeightKgs", "targetLabel": "Net Weight (kg)", "sourceDoc": "CALCULATED", "sourceField": "grossWeight - tareWeight", "sourceLabel": "Derived or manual", "mappingType": "derived", "validation": "Net <= Gross", "validationSeverity": "warning", "mono": True},
                {"targetField": "lineItems[].grossWeightKgs", "targetLabel": "Gross Weight (kg)", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].grossWeight", "sourceLabel": "Gross Weight", "mappingType": "conditional", "transformation": "Copy from invoice if available; else manual", "validation": "> 0", "validationSeverity": "warning", "mono": True},
            ],
        },
    ],
}


OUTWARD_PL_GEN: DocGenSchema = {
    "generatedDocType": "US_PACKING_LIST",
    "displayName": "Outward GRN",
    "triggerCondition": "Packing List stock available; BOL details used when available",
    "sourceDocs": ["PACKING_LIST", "BILL_OF_LADING"],
    "humanAction": "Select/confirm dispatched stock lines and enter destination, vehicle, and driver details",
    "totalFields": 39,
    "autoPopulated": 22,
    "calculated": 4,
    "manualInput": 13,
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
            "sectionLabel": "Dispatch Details",
            "mappings": [
                {"targetField": "destinationName", "targetLabel": "Destination Name", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Customer / delivery destination", "mappingType": "manual", "validation": "NOT NULL", "validationSeverity": "critical"},
                {"targetField": "destinationAddress", "targetLabel": "Destination Address", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Delivery address", "mappingType": "manual"},
                {"targetField": "truckNumber", "targetLabel": "Truck / Vehicle No.", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Vehicle number", "mappingType": "manual"},
                {"targetField": "driverName", "targetLabel": "Driver Name", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Driver name", "mappingType": "manual"},
                {"targetField": "dispatchNotes", "targetLabel": "Dispatch Notes", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Notes", "mappingType": "manual"},
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
    "displayName": "Draft CBP FORM 7501",
    "triggerCondition": "Bill of Lading and Sales Invoice extracted",
    "sourceDocs": ["BILL_OF_LADING", "SALES_INVOICE"],
    "humanAction": "Complete broker and filing fields, assign HTS rates, and review calculated duties and fees",
    "totalFields": 72,
    "autoPopulated": 18,
    "calculated": 8,
    "manualInput": 46,
    "sections": [
        {
            "sectionLabel": "Header",
            "mappings": [
                {"targetField": "filerCodeEntryNumber", "targetLabel": "Filer Code Entry Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Available after customs filing", "mappingType": "manual", "mono": True},
                {"targetField": "entryType", "targetLabel": "Entry Type", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Customs broker", "mappingType": "manual"},
                {"targetField": "summaryDate", "targetLabel": "Summary Date", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Actual filing date", "mappingType": "manual", "mono": True},
                {"targetField": "suretyNumber", "targetLabel": "Surety Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Customs broker", "mappingType": "manual", "mono": True},
                {"targetField": "bondType", "targetLabel": "Bond Type", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Customs broker", "mappingType": "manual"},
                {"targetField": "portCode", "targetLabel": "Port Code", "sourceDoc": "BILL_OF_LADING", "sourceField": "portOfDischarge", "sourceLabel": "BOL Port of Discharge", "mappingType": "contextual", "transformation": "Resolve port name to CBP port code"},
                {"targetField": "entryDate", "targetLabel": "Entry Date", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Within 10 working days of ETA", "mappingType": "manual", "mono": True},
                {"targetField": "teamNumber", "targetLabel": "Team Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "summaryStatus", "targetLabel": "Summary Status", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "formVersion", "targetLabel": "Form Version", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "formNumber", "targetLabel": "Form Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
            ],
        },
        {
            "sectionLabel": "Transport",
            "mappings": [
                {"targetField": "importingCarrier", "targetLabel": "Importing Carrier", "sourceDoc": "BILL_OF_LADING", "sourceField": "carrierCompanyName", "sourceLabel": "BOL Carrier", "mappingType": "direct"},
                {"targetField": "modeOfTransport", "targetLabel": "Mode of Transport", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "importDate", "targetLabel": "Import Date", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual", "mono": True},
                {"targetField": "blOrAwbNumber", "targetLabel": "BL or AWB Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual", "mono": True},
                {"targetField": "additionalBLs", "targetLabel": "Additional BLs", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual", "mono": True},
                {"targetField": "houseBill", "targetLabel": "House Bill", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual", "mono": True},
                {"targetField": "subhouseBill", "targetLabel": "Subhouse Bill", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "billQty", "targetLabel": "Bill Quantity", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "billQtyUnit", "targetLabel": "Bill Quantity Unit", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "manufacturerId", "targetLabel": "Manufacturer ID", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "exportingCountry", "targetLabel": "Exporting Country", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "exportDate", "targetLabel": "Export Date", "sourceDoc": "BILL_OF_LADING", "sourceField": "exportShippingBillDate", "sourceLabel": "BOL Export Shipping Bill Date", "mappingType": "direct", "mono": True},
                {"targetField": "itNumber", "targetLabel": "IT Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "itDate", "targetLabel": "IT Date", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "missingDocs", "targetLabel": "Missing Documents", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "foreignPortOfLading", "targetLabel": "Foreign Port of Lading", "sourceDoc": "BILL_OF_LADING", "sourceField": "portOfLoading", "sourceLabel": "BOL Port of Loading", "mappingType": "direct"},
                {"targetField": "usPortOfUnlading", "targetLabel": "US Port of Unlading", "sourceDoc": "BILL_OF_LADING", "sourceField": "portOfDischarge", "sourceLabel": "BOL Port of Discharge", "mappingType": "direct"},
            ],
        },
        {
            "sectionLabel": "Parties",
            "mappings": [
                {"targetField": "countryOfOrigin", "targetLabel": "Country of Origin", "sourceDoc": "BILL_OF_LADING", "sourceField": "countryOfOrigin", "sourceLabel": "BOL Country of Origin", "mappingType": "direct"},
                {"targetField": "locationOfGoods", "targetLabel": "Location of Goods / GO Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Customs broker", "mappingType": "manual"},
                {"targetField": "consigneeNumber", "targetLabel": "Consignee Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "importerNumber", "targetLabel": "Importer Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "CBP importer number", "mappingType": "manual", "mono": True},
                {"targetField": "referenceNumber", "targetLabel": "Reference Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "ultimateConsigneeName", "targetLabel": "Ultimate Consignee Name", "sourceDoc": "BILL_OF_LADING", "sourceField": "consigneeName", "sourceLabel": "BOL Consignee", "mappingType": "direct"},
                {"targetField": "ultimateConsigneeAddress", "targetLabel": "Ultimate Consignee Address", "sourceDoc": "BILL_OF_LADING", "sourceField": "consigneeAddress", "sourceLabel": "BOL Consignee Address", "mappingType": "direct"},
                {"targetField": "ultimateConsigneeCity", "targetLabel": "Ultimate Consignee City", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "ultimateConsigneeState", "targetLabel": "Ultimate Consignee State", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "ultimateConsigneeZip", "targetLabel": "Ultimate Consignee ZIP", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "importerOfRecordName", "targetLabel": "Importer of Record Name", "sourceDoc": "BILL_OF_LADING", "sourceField": "consigneeName", "sourceLabel": "BOL Consignee", "mappingType": "direct"},
                {"targetField": "importerOfRecordAddress", "targetLabel": "Importer of Record Address", "sourceDoc": "BILL_OF_LADING", "sourceField": "consigneeAddress", "sourceLabel": "BOL Consignee Address", "mappingType": "direct"},
                {"targetField": "importerOfRecordCity", "targetLabel": "Importer of Record City", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "importerOfRecordState", "targetLabel": "Importer of Record State", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "importerOfRecordZip", "targetLabel": "Importer of Record ZIP", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
            ],
        },
        {
            "sectionLabel": "Trade Compliance",
            "mappings": [
                {"targetField": "countryOfMeltAndPour", "targetLabel": "Country of Melt and Pour", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "primaryCountryOfSmelt", "targetLabel": "Primary Country of Smelt", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "secondaryCountryOfSmelt", "targetLabel": "Secondary Country of Smelt", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "countryOfCast", "targetLabel": "Country of Cast", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
            ],
        },
        {
            "sectionLabel": "Tariff Lines",
            "mappings": [
                {"targetField": "tariffLines[].lineNo", "targetLabel": "Line No", "sourceDoc": "CALCULATED", "sourceField": "row number", "sourceLabel": "Calculated", "mappingType": "derived", "mono": True},
                {"targetField": "tariffLines[].lineMerchandiseDescription", "targetLabel": "Line Merchandise Description", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].productDescription", "sourceLabel": "Sales Invoice Description", "mappingType": "direct"},
                {"targetField": "tariffLines[].lineHtsusNumber", "targetLabel": "Line HTSUS Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Tariff master / broker", "mappingType": "manual", "mono": True},
                {"targetField": "tariffLines[].quantity", "targetLabel": "Quantity", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].quantity", "sourceLabel": "Sales Invoice Quantity", "mappingType": "direct", "mono": True},
                {"targetField": "tariffLines[].enteredValue", "targetLabel": "Entered Value", "sourceDoc": "SALES_INVOICE", "sourceField": "lineItems[].lineTotal", "sourceLabel": "Sales Invoice Line Total", "mappingType": "direct", "mono": True},
                {"targetField": "tariffLines[].dutyRate", "targetLabel": "Tariff / Duty Rate (%)", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Tariff master", "mappingType": "manual", "mono": True},
                {"targetField": "tariffLines[].dutyAmount", "targetLabel": "Duty Amount", "sourceDoc": "CALCULATED", "sourceField": "enteredValue * dutyRate", "sourceLabel": "Entered value multiplied by tariff rate", "mappingType": "derived", "mono": True},
            ],
        },
        {
            "sectionLabel": "Duties and Fees",
            "mappings": [
                {"targetField": "mpfTotal", "targetLabel": "MPF Total", "sourceDoc": "CALCULATED", "sourceField": "totalEnteredValue * 0.003464", "sourceLabel": "MPF rate from tariff master", "mappingType": "derived", "mono": True},
                {"targetField": "hmfTotal", "targetLabel": "HMF Total", "sourceDoc": "CALCULATED", "sourceField": "totalEnteredValue * 0.00125", "sourceLabel": "HMF rate from tariff master", "mappingType": "derived", "mono": True},
                {"targetField": "totalOtherFees", "targetLabel": "Total Other Fees", "sourceDoc": "CALCULATED", "sourceField": "mpfTotal + hmfTotal", "sourceLabel": "MPF plus HMF", "mappingType": "derived", "mono": True},
                {"targetField": "totalEnteredValue", "targetLabel": "Total Entered Value", "sourceDoc": "SALES_INVOICE", "sourceField": "taxableValue", "sourceLabel": "Sales Invoice Taxable Value", "mappingType": "direct", "mono": True},
                {"targetField": "totalDuty", "targetLabel": "Total Duty", "sourceDoc": "CALCULATED", "sourceField": "SUM(tariffLines.dutyAmount)", "sourceLabel": "Sum of tariff-line duty", "mappingType": "derived", "mono": True},
                {"targetField": "totalTax", "targetLabel": "Total Tax", "sourceDoc": "SALES_INVOICE", "sourceField": "taxAmount", "sourceLabel": "Sales Invoice Tax Amount", "mappingType": "direct", "mono": True},
                {"targetField": "totalOther", "targetLabel": "Total Other", "sourceDoc": "CALCULATED", "sourceField": "mpfTotal + hmfTotal", "sourceLabel": "MPF plus HMF", "mappingType": "derived", "mono": True},
                {"targetField": "grandTotal", "targetLabel": "Grand Total", "sourceDoc": "CALCULATED", "sourceField": "totalDuty + totalTax + totalOther", "sourceLabel": "Duty plus tax and other fees", "mappingType": "derived", "mono": True},
            ],
        },
        {
            "sectionLabel": "Declarant and Broker",
            "mappings": [
                {"targetField": "declarantName", "targetLabel": "Declarant Name", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "declarantCompany", "targetLabel": "Declarant Company", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "declarantTitle", "targetLabel": "Declarant Title", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "declarantDate", "targetLabel": "Declarant Date", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual", "mono": True},
                {"targetField": "isOwner", "targetLabel": "Is Owner", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "isPurchase", "targetLabel": "Is Purchase", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "brokerName", "targetLabel": "Broker Name", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "brokerAddress", "targetLabel": "Broker Address", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "brokerPhone", "targetLabel": "Broker Phone", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
                {"targetField": "brokerImporterFileNumber", "targetLabel": "Broker Importer File Number", "sourceDoc": "MANUAL", "sourceField": "", "sourceLabel": "Manual", "mappingType": "manual"},
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
