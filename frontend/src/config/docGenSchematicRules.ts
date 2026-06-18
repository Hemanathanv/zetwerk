/**
 * EWMS Document Generation Schematic Rules
 * 
 * Defines the field-by-field mapping for each of the 3 generated document types:
 *   1. Packing List        ← Sales Invoice (from your xlsx mapping matrix)
 *   2. Outward Packing List ← Packing List + BOL container allocation
 *   3. Draft BOE           ← BOL + Sales Invoice + Entry data
 *
 * Each rule defines: which field on the generated doc, where it comes from,
 * what transformation (if any), and whether it needs human input.
 *
 * Usage:
 *   import { DOC_GEN_SCHEMAS } from '@/config/docGenSchematicRules';
 *   const plSchema = DOC_GEN_SCHEMAS['PACKING_LIST'];
 *   plSchema.sections.forEach(s => s.mappings.forEach(m => { ... }));
 */

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------

export type MappingType =
  | 'direct'        // Copy value as-is from source
  | 'derived'       // Calculated from source fields (SUM, formula)
  | 'contextual'    // Meaning changes based on context (e.g., shipment type)
  | 'manual'        // No source — human must enter
  | 'conditional'   // Use value A if available, else value B, else manual

export type Severity = 'critical' | 'warning' | 'info';

export interface FieldMapping {
  targetField: string;          // Prisma key on generated doc
  targetLabel: string;          // Human label
  sourceDoc: string;            // 'SALES_INVOICE' | 'BILL_OF_LADING' | 'PACKING_LIST' | 'MANUAL' | 'CALCULATED'
  sourceField: string;          // Prisma key on source doc (or formula description)
  sourceLabel: string;          // Human label for source
  mappingType: MappingType;
  transformation?: string;      // Logic description if not direct copy
  validation?: string;          // Validation rule
  validationSeverity?: Severity;
  mono?: boolean;               // Render in JetBrains Mono
}

export interface GenSection {
  sectionLabel: string;
  mappings: FieldMapping[];
}

export interface DocGenSchema {
  generatedDocType: string;
  displayName: string;
  triggerCondition: string;      // When is this generation triggered
  sourceDocs: string[];          // Which docs must exist
  humanAction: string;           // What the reviewer does (from BRD)
  totalFields: number;
  autoPopulated: number;
  calculated: number;
  manualInput: number;
  sections: GenSection[];
}

// ---------------------------------------------------------------
// 1. PACKING LIST ← Sales Invoice
//    (Mapped from your Semantic_Mapping_Matrix xlsx)
// ---------------------------------------------------------------

const PACKING_LIST_GEN: DocGenSchema = {
  generatedDocType: 'PACKING_LIST',
  displayName: 'Packing List',
  triggerCondition: 'Sales Invoice APPROVED (extraction confirmed by human)',
  sourceDocs: ['SALES_INVOICE'],
  humanAction: 'Review bundle allocation, confirm weights',
  totalFields: 46,
  autoPopulated: 32,
  calculated: 7,
  manualInput: 7,
  sections: [
    {
      sectionLabel: 'Header',
      mappings: [
        { targetField: 'invoiceNo', targetLabel: 'Invoice No', sourceDoc: 'SALES_INVOICE', sourceField: 'invoiceNo', sourceLabel: 'Invoice No', mappingType: 'direct', validation: 'NOT NULL', validationSeverity: 'critical', mono: true },
        { targetField: 'invoiceDate', targetLabel: 'Invoice Date', sourceDoc: 'SALES_INVOICE', sourceField: 'invoiceDate', sourceLabel: 'Invoice Date', mappingType: 'direct', validation: 'NOT NULL; date <= today', validationSeverity: 'critical', mono: true },
        { targetField: 'buyerPoNo', targetLabel: 'Buyer PO No', sourceDoc: 'SALES_INVOICE', sourceField: 'buyerPoNo', sourceLabel: 'Buyer PO No', mappingType: 'direct', mono: true },
        { targetField: 'buyerPoDate', targetLabel: 'Buyer PO Date', sourceDoc: 'SALES_INVOICE', sourceField: 'buyerPoDate', sourceLabel: 'Buyer PO Date', mappingType: 'direct', mono: true },
        { targetField: 'zetwerkRef', targetLabel: 'Zetwerk Ref', sourceDoc: 'SALES_INVOICE', sourceField: 'zetwerkRef', sourceLabel: 'Zetwerk Ref', mappingType: 'direct', mono: true },
        { targetField: 'otherReferences', targetLabel: 'Other References', sourceDoc: 'SALES_INVOICE', sourceField: 'otherReferences', sourceLabel: 'Other References', mappingType: 'direct' },
        { targetField: 'pickupAddress', targetLabel: 'Pickup Address', sourceDoc: 'SALES_INVOICE', sourceField: 'exporterAddress', sourceLabel: 'Exporter Address', mappingType: 'contextual', transformation: 'Map exporter address as pickup location' },
      ],
    },
    {
      sectionLabel: 'Parties',
      mappings: [
        { targetField: 'exporterName', targetLabel: 'Exporter', sourceDoc: 'SALES_INVOICE', sourceField: 'exporterName', sourceLabel: 'Exporter Name', mappingType: 'direct', validation: 'NOT NULL', validationSeverity: 'critical' },
        { targetField: 'exporterAddress', targetLabel: 'Exporter Address', sourceDoc: 'SALES_INVOICE', sourceField: 'exporterAddress', sourceLabel: 'Exporter Address', mappingType: 'direct' },
        { targetField: 'buyerName', targetLabel: 'Buyer', sourceDoc: 'SALES_INVOICE', sourceField: 'buyerName', sourceLabel: 'Buyer Name', mappingType: 'direct', validation: 'NOT NULL', validationSeverity: 'critical' },
        { targetField: 'buyerAddress', targetLabel: 'Buyer Address', sourceDoc: 'SALES_INVOICE', sourceField: 'buyerAddress', sourceLabel: 'Buyer Address', mappingType: 'direct' },
        { targetField: 'consigneeName', targetLabel: 'Consignee', sourceDoc: 'SALES_INVOICE', sourceField: 'consigneeName', sourceLabel: 'Consignee Name', mappingType: 'direct', validation: 'NOT NULL', validationSeverity: 'critical' },
        { targetField: 'consigneeAddress', targetLabel: 'Consignee Address', sourceDoc: 'SALES_INVOICE', sourceField: 'consigneeAddress', sourceLabel: 'Consignee Address', mappingType: 'direct' },
        { targetField: 'gstin', targetLabel: 'GSTIN', sourceDoc: 'SALES_INVOICE', sourceField: 'gstin', sourceLabel: 'GSTIN', mappingType: 'direct', mono: true },
        { targetField: 'iec', targetLabel: 'IEC', sourceDoc: 'SALES_INVOICE', sourceField: 'iec', sourceLabel: 'IEC', mappingType: 'direct', mono: true },
        { targetField: 'shipTo', targetLabel: 'Ship To', sourceDoc: 'SALES_INVOICE', sourceField: 'shipTo', sourceLabel: 'Ship To', mappingType: 'direct' },
      ],
    },
    {
      sectionLabel: 'Shipping',
      mappings: [
        { targetField: 'portOfLoading', targetLabel: 'Port of Loading', sourceDoc: 'SALES_INVOICE', sourceField: 'portOfLoading', sourceLabel: 'Port of Loading', mappingType: 'direct' },
        { targetField: 'portOfDischarge', targetLabel: 'Port of Discharge', sourceDoc: 'SALES_INVOICE', sourceField: 'portOfDischarge', sourceLabel: 'Port of Discharge', mappingType: 'direct' },
        { targetField: 'countryOfOrigin', targetLabel: 'Country of Origin', sourceDoc: 'SALES_INVOICE', sourceField: 'countryOfOrigin', sourceLabel: 'Country of Origin', mappingType: 'direct', validation: 'NOT NULL', validationSeverity: 'critical' },
        { targetField: 'countryOfFinalDestination', targetLabel: 'Final Destination Country', sourceDoc: 'SALES_INVOICE', sourceField: 'countryOfFinalDestination', sourceLabel: 'Final Destination Country', mappingType: 'direct', validation: 'NOT NULL', validationSeverity: 'critical' },
        { targetField: 'finalDestination', targetLabel: 'Final Destination', sourceDoc: 'SALES_INVOICE', sourceField: 'finalDestination', sourceLabel: 'Final Destination', mappingType: 'direct' },
        { targetField: 'placeOfReceipt', targetLabel: 'Place of Receipt', sourceDoc: 'SALES_INVOICE', sourceField: 'placeOfReceipt', sourceLabel: 'Place of Receipt', mappingType: 'direct' },
        { targetField: 'vesselFlightNo', targetLabel: 'Vessel/Flight No', sourceDoc: 'SALES_INVOICE', sourceField: 'vesselFlightNo', sourceLabel: 'Vessel/Flight No', mappingType: 'direct' },
        { targetField: 'preCarriageBy', targetLabel: 'Pre-Carriage By', sourceDoc: 'SALES_INVOICE', sourceField: 'preCarriageBy', sourceLabel: 'Pre-Carriage By', mappingType: 'direct' },
      ],
    },
    {
      sectionLabel: 'Totals (Aggregated)',
      mappings: [
        { targetField: 'totalBundles', targetLabel: 'Total Bundles', sourceDoc: 'CALCULATED', sourceField: 'SUM(lineItems.noOfBundles)', sourceLabel: 'Sum of line item bundles', mappingType: 'derived', transformation: 'SUM(Line Items[No Of Bundles])', validation: 'Total >= count(lineItems)', validationSeverity: 'critical', mono: true },
        { targetField: 'totalQty', targetLabel: 'Total Qty (PCS)', sourceDoc: 'CALCULATED', sourceField: 'SUM(lineItems.quantity)', sourceLabel: 'Sum of line item quantities', mappingType: 'derived', transformation: 'SUM(Line Items[Quantity])', validation: 'Total >= max(lineItems.qty)', validationSeverity: 'critical', mono: true },
        { targetField: 'totalNetWeightKgs', targetLabel: 'Total Net Weight (kg)', sourceDoc: 'CALCULATED', sourceField: 'SUM(lineItems.netWeightKgs)', sourceLabel: 'Sum of line item net weights', mappingType: 'derived', transformation: 'SUM(Line Items[Net Weight Kgs])', validation: 'Net <= Gross', validationSeverity: 'critical', mono: true },
        { targetField: 'totalGrossWeightKgs', targetLabel: 'Total Gross Weight (kg)', sourceDoc: 'CALCULATED', sourceField: 'SUM(lineItems.grossWeightKgs)', sourceLabel: 'Sum of line item gross weights', mappingType: 'derived', transformation: 'SUM(Line Items[Gross Weight Kgs])', validation: 'Gross >= Net', validationSeverity: 'critical', mono: true },
      ],
    },
    {
      sectionLabel: 'Line Items (per invoice line — 1:1 cardinality)',
      mappings: [
        { targetField: 'lineItems[].hsnCode', targetLabel: 'HSN Code', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].hsnCode', sourceLabel: 'HSN Code', mappingType: 'direct', validation: 'NOT NULL per line', validationSeverity: 'critical', mono: true },
        { targetField: 'lineItems[].productCode', targetLabel: 'Product Code', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].productCode', sourceLabel: 'Product Code', mappingType: 'direct', validation: 'NOT NULL per line', validationSeverity: 'critical', mono: true },
        { targetField: 'lineItems[].productDescription', targetLabel: 'Description', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].productDescription', sourceLabel: 'Product Description', mappingType: 'direct' },
        { targetField: 'lineItems[].productSpecification', targetLabel: 'Specification', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].productSpecification', sourceLabel: 'Product Specification', mappingType: 'direct' },
        { targetField: 'lineItems[].productMarks', targetLabel: 'Marks', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].productMarks', sourceLabel: 'Product Marks', mappingType: 'direct' },
        { targetField: 'lineItems[].totalQtyInPcs', targetLabel: 'Total Qty (PCS)', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].quantity', sourceLabel: 'Quantity', mappingType: 'direct', validation: '> 0', validationSeverity: 'critical', mono: true },
        { targetField: 'lineItems[].containerNo', targetLabel: 'Container No', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].containerNo', sourceLabel: 'Container No', mappingType: 'direct', mono: true },
        { targetField: 'lineItems[].sealNo', targetLabel: 'Seal No', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].sealNo', sourceLabel: 'Seal No', mappingType: 'direct', mono: true },
        { targetField: 'lineItems[].kindOfPkg', targetLabel: 'Kind of Package', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].kindOfPkg', sourceLabel: 'Kind of Pkg', mappingType: 'direct' },
        { targetField: 'lineItems[].noOfBundles', targetLabel: 'No of Bundles', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].noOfBundles', sourceLabel: 'No of Bundles', mappingType: 'conditional', transformation: 'Use bundle count only; do not use package count', validation: 'NOT NULL or flagged manual', validationSeverity: 'warning', mono: true },
        { targetField: 'lineItems[].qtyPerBundle', targetLabel: 'Qty per Bundle', sourceDoc: 'CALCULATED', sourceField: 'lineItems[].quantity / lineItems[].noOfBundles', sourceLabel: 'Derived: qty / bundles', mappingType: 'derived', transformation: 'IF noOfBundles > 0 THEN quantity / noOfBundles ELSE MANUAL', validation: 'qtyPerBundle * noOfBundles = totalQty', validationSeverity: 'critical', mono: true },
        { targetField: 'lineItems[].netWeightKgs', targetLabel: 'Net Weight (kg)', sourceDoc: 'CALCULATED', sourceField: 'grossWeight - tareWeight OR manual', sourceLabel: 'Derived or manual', mappingType: 'derived', transformation: 'IF tareWeight exists THEN grossWeight - tareWeight; ELSE MANUAL', validation: 'netWeight <= grossWeight; > 0', validationSeverity: 'warning', mono: true },
        { targetField: 'lineItems[].grossWeightKgs', targetLabel: 'Gross Weight (kg)', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].grossWeight', sourceLabel: 'Gross Weight', mappingType: 'conditional', transformation: 'Copy from invoice if available; ELSE MANUAL', validation: '> 0', validationSeverity: 'warning', mono: true },
      ],
    },
    {
      sectionLabel: 'Footer',
      mappings: [
        { targetField: 'signatoryName', targetLabel: 'Signatory Name', sourceDoc: 'SALES_INVOICE', sourceField: 'signatoryName', sourceLabel: 'Signatory Name', mappingType: 'direct' },
        { targetField: 'signatoryDesignation', targetLabel: 'Designation', sourceDoc: 'SALES_INVOICE', sourceField: 'signatoryDesignation', sourceLabel: 'Signatory Designation', mappingType: 'direct' },
        { targetField: 'dinNumber', targetLabel: 'DIN Number', sourceDoc: 'SALES_INVOICE', sourceField: 'dinNumber', sourceLabel: 'DIN Number', mappingType: 'direct', mono: true },
      ],
    },
  ],
};

// ---------------------------------------------------------------
// 2. OUTWARD PACKING LIST ← Packing List + BOL
//    Trigger: PL is CLOSED + BOL is APPROVED
//    New schema — built from BRD + Prisma UsPackingListExtraction
// ---------------------------------------------------------------

const OUTWARD_PL_GEN: DocGenSchema = {
  generatedDocType: 'US_PACKING_LIST',
  displayName: 'Outward Packing List',
  triggerCondition: 'Packing List CLOSED + BOL APPROVED (both must exist)',
  sourceDocs: ['PACKING_LIST', 'BILL_OF_LADING'],
  humanAction: 'Confirm container-wise packing allocation',
  totalFields: 34,
  autoPopulated: 22,
  calculated: 4,
  manualInput: 8,
  sections: [
    {
      sectionLabel: 'Document Header',
      mappings: [
        { targetField: 'packingSlipNumber', targetLabel: 'Packing Slip Number', sourceDoc: 'CALCULATED', sourceField: 'OPL-{bolNumber}-{seq}', sourceLabel: 'Auto-generated from BOL', mappingType: 'derived', transformation: 'Generate: OPL-{BOL number}-001', mono: true },
        { targetField: 'documentDate', targetLabel: 'Date', sourceDoc: 'CALCULATED', sourceField: 'today()', sourceLabel: 'Current date', mappingType: 'derived', mono: true },
        { targetField: 'soNumber', targetLabel: 'SO Number', sourceDoc: 'PACKING_LIST', sourceField: 'zetwerkRef', sourceLabel: 'Zetwerk Ref', mappingType: 'direct', mono: true },
        { targetField: 'poNumber', targetLabel: 'PO Number', sourceDoc: 'PACKING_LIST', sourceField: 'buyerPoNo', sourceLabel: 'Buyer PO No', mappingType: 'direct', mono: true },
        { targetField: 'bolNumber', targetLabel: 'BOL Number', sourceDoc: 'BILL_OF_LADING', sourceField: 'bolNumber', sourceLabel: 'BOL Number', mappingType: 'direct', mono: true },
        { targetField: 'projectName', targetLabel: 'Project Name', sourceDoc: 'BILL_OF_LADING', sourceField: 'projectName', sourceLabel: 'Project Name', mappingType: 'direct' },
        { targetField: 'projectId', targetLabel: 'Project ID', sourceDoc: 'PACKING_LIST', sourceField: 'zetwerkRef', sourceLabel: 'Zetwerk Ref', mappingType: 'direct', mono: true },
        { targetField: 'countryOfOrigin', targetLabel: 'Country of Origin', sourceDoc: 'PACKING_LIST', sourceField: 'countryOfOrigin', sourceLabel: 'Country of Origin', mappingType: 'direct' },
      ],
    },
    {
      sectionLabel: 'Parties',
      mappings: [
        { targetField: 'shipperName', targetLabel: 'Shipper', sourceDoc: 'BILL_OF_LADING', sourceField: 'shipperName', sourceLabel: 'BOL Shipper', mappingType: 'direct' },
        { targetField: 'shipperLocation', targetLabel: 'Shipper Location', sourceDoc: 'PACKING_LIST', sourceField: 'pickupAddress', sourceLabel: 'Pickup Address', mappingType: 'direct' },
        { targetField: 'shipToName', targetLabel: 'Ship To', sourceDoc: 'BILL_OF_LADING', sourceField: 'consigneeName', sourceLabel: 'BOL Consignee', mappingType: 'direct' },
        { targetField: 'shipToAddress', targetLabel: 'Ship To Address', sourceDoc: 'BILL_OF_LADING', sourceField: 'consigneeAddress', sourceLabel: 'BOL Consignee Address', mappingType: 'direct' },
        { targetField: 'consigneeName', targetLabel: 'Consignee (3PL)', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: '3PL warehouse name', mappingType: 'manual' },
        { targetField: 'consigneeAddress', targetLabel: 'Consignee Address (3PL)', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: '3PL warehouse address', mappingType: 'manual' },
      ],
    },
    {
      sectionLabel: 'Shipping',
      mappings: [
        { targetField: 'carrierName', targetLabel: 'Carrier', sourceDoc: 'BILL_OF_LADING', sourceField: 'carrierCompanyName', sourceLabel: 'BOL Carrier', mappingType: 'direct' },
        { targetField: 'estimatedDeliveryDate', targetLabel: 'Est. Delivery', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'From trucking schedule', mappingType: 'manual', mono: true },
        { targetField: 'appointmentTime', targetLabel: 'Appointment', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: '3PL appointment window', mappingType: 'manual', mono: true },
      ],
    },
    {
      sectionLabel: 'Container Allocation (from BOL)',
      mappings: [
        { targetField: 'containers[].containerNumber', targetLabel: 'Container Number', sourceDoc: 'BILL_OF_LADING', sourceField: 'containers[].containerNumber', sourceLabel: 'BOL Container', mappingType: 'direct', mono: true },
        { targetField: 'containers[].sealNumber', targetLabel: 'Seal Number', sourceDoc: 'BILL_OF_LADING', sourceField: 'containers[].sealNumber', sourceLabel: 'BOL Seal', mappingType: 'direct', mono: true },
        { targetField: 'containers[].containerSize', targetLabel: 'Size', sourceDoc: 'BILL_OF_LADING', sourceField: 'containers[].containerType', sourceLabel: 'BOL Container Type', mappingType: 'direct' },
        { targetField: 'containers[].lineItems', targetLabel: 'Items in Container', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'Human allocates items to containers', mappingType: 'manual', transformation: 'User assigns PL line items to each container' },
      ],
    },
    {
      sectionLabel: 'Line Items (from Packing List, allocated to containers)',
      mappings: [
        { targetField: 'lineItems[].partNumber', targetLabel: 'Part Number', sourceDoc: 'PACKING_LIST', sourceField: 'lineItems[].productCode', sourceLabel: 'PL Product Code', mappingType: 'direct', mono: true },
        { targetField: 'lineItems[].itemDescription', targetLabel: 'Description', sourceDoc: 'PACKING_LIST', sourceField: 'lineItems[].productDescription', sourceLabel: 'PL Description', mappingType: 'direct' },
        { targetField: 'lineItems[].quantity', targetLabel: 'Quantity', sourceDoc: 'PACKING_LIST', sourceField: 'lineItems[].totalQtyInPcs', sourceLabel: 'PL Qty', mappingType: 'direct', mono: true },
        { targetField: 'lineItems[].bundleCount', targetLabel: 'Bundles', sourceDoc: 'PACKING_LIST', sourceField: 'lineItems[].noOfBundles', sourceLabel: 'PL Bundles', mappingType: 'direct', mono: true },
        { targetField: 'lineItems[].grossWeight', targetLabel: 'Gross Weight', sourceDoc: 'PACKING_LIST', sourceField: 'lineItems[].grossWeightKgs', sourceLabel: 'PL Gross Weight', mappingType: 'direct', mono: true },
        { targetField: 'lineItems[].netWeight', targetLabel: 'Net Weight', sourceDoc: 'PACKING_LIST', sourceField: 'lineItems[].netWeightKgs', sourceLabel: 'PL Net Weight', mappingType: 'direct', mono: true },
        { targetField: 'lineItems[].marksAndNumbers', targetLabel: 'Marks & Numbers', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'Container-specific marks', mappingType: 'manual' },
      ],
    },
    {
      sectionLabel: 'Totals',
      mappings: [
        { targetField: 'totalLines', targetLabel: 'Total Lines', sourceDoc: 'CALCULATED', sourceField: 'COUNT(lineItems)', sourceLabel: 'Line item count', mappingType: 'derived', mono: true },
        { targetField: 'totalPiecesAggregate', targetLabel: 'Total Pieces', sourceDoc: 'PACKING_LIST', sourceField: 'totalQty', sourceLabel: 'PL Total Qty', mappingType: 'direct', mono: true },
        { targetField: 'totalBundlesAggregate', targetLabel: 'Total Bundles', sourceDoc: 'PACKING_LIST', sourceField: 'totalBundles', sourceLabel: 'PL Total Bundles', mappingType: 'direct', mono: true },
        { targetField: 'totalWeightLbs', targetLabel: 'Total Weight (lbs)', sourceDoc: 'CALCULATED', sourceField: 'PL.totalGrossWeightKgs * 2.20462', sourceLabel: 'Converted kg to lbs', mappingType: 'derived', transformation: 'totalGrossWeightKgs * 2.20462', mono: true },
      ],
    },
    {
      sectionLabel: 'Signatures (Manual)',
      mappings: [
        { targetField: 'receivedByName', targetLabel: 'Received By', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: '3PL receiving staff', mappingType: 'manual' },
        { targetField: 'shipperSignature', targetLabel: 'Shipper Signature', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'Digital or photo', mappingType: 'manual' },
      ],
    },
  ],
};

// ---------------------------------------------------------------
// 3. DRAFT BOE ← BOL + Sales Invoice + HTS/Duty data
//    Trigger: BOL APPROVED
//    New schema — built from BRD + Prisma EntrySummaryExtraction
// ---------------------------------------------------------------

const DRAFT_BOE_GEN: DocGenSchema = {
  generatedDocType: 'ENTRY_SUMMARY',
  displayName: 'Draft Bill of Entry (Entry Summary)',
  triggerCondition: 'BOL APPROVED (extraction confirmed by human)',
  sourceDocs: ['BILL_OF_LADING', 'SALES_INVOICE'],
  humanAction: 'Add HTS codes, review duty calculations, send to US broker for filing',
  totalFields: 47,
  autoPopulated: 28,
  calculated: 5,
  manualInput: 14,
  sections: [
    {
      sectionLabel: 'Entry Details',
      mappings: [
        { targetField: 'filerCodeEntryNumber', targetLabel: 'Entry Number', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'Assigned by US Customs broker', mappingType: 'manual', mono: true },
        { targetField: 'entryType', targetLabel: 'Entry Type', sourceDoc: 'CALCULATED', sourceField: '01 (consumption)', sourceLabel: 'Default: 01 consumption entry', mappingType: 'derived', transformation: 'Default to 01 for standard import; 06 for FTZ' },
        { targetField: 'entryDate', targetLabel: 'Entry Date', sourceDoc: 'CALCULATED', sourceField: 'today()', sourceLabel: 'Current date', mappingType: 'derived', mono: true },
        { targetField: 'portCode', targetLabel: 'Port Code', sourceDoc: 'BILL_OF_LADING', sourceField: 'portOfDischarge', sourceLabel: 'BOL Port of Discharge', mappingType: 'contextual', transformation: 'Map port name to CBP port code (Oakland=2811, Long Beach=2704, Galveston=5310)' },
        { targetField: 'bondType', targetLabel: 'Bond Type', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'Continuous or single transaction', mappingType: 'manual' },
        { targetField: 'suretyNumber', targetLabel: 'Surety Number', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'From broker bond', mappingType: 'manual', mono: true },
      ],
    },
    {
      sectionLabel: 'Transport (from BOL)',
      mappings: [
        { targetField: 'importingCarrier', targetLabel: 'Importing Carrier', sourceDoc: 'BILL_OF_LADING', sourceField: 'carrierCompanyName', sourceLabel: 'BOL Carrier', mappingType: 'direct' },
        { targetField: 'modeOfTransport', targetLabel: 'Mode of Transport', sourceDoc: 'CALCULATED', sourceField: '10 (vessel)', sourceLabel: 'Default: 10 = vessel', mappingType: 'derived' },
        { targetField: 'importDate', targetLabel: 'Import Date', sourceDoc: 'BILL_OF_LADING', sourceField: 'shippedOnBoardDate', sourceLabel: 'BOL Shipped On Board', mappingType: 'direct', mono: true },
        { targetField: 'blOrAwbNumber', targetLabel: 'BL Number', sourceDoc: 'BILL_OF_LADING', sourceField: 'bolNumber', sourceLabel: 'BOL Number', mappingType: 'direct', mono: true },
        { targetField: 'houseBill', targetLabel: 'House Bill', sourceDoc: 'BILL_OF_LADING', sourceField: 'bolNumber', sourceLabel: 'Same as BOL if no FF HBL', mappingType: 'conditional', transformation: 'IF FF HBL exists THEN use FF HBL; ELSE use BOL number' },
        { targetField: 'foreignPortOfLading', targetLabel: 'Foreign Port of Lading', sourceDoc: 'BILL_OF_LADING', sourceField: 'portOfLoading', sourceLabel: 'BOL Port of Loading', mappingType: 'direct' },
        { targetField: 'usPortOfUnlading', targetLabel: 'US Port of Unlading', sourceDoc: 'BILL_OF_LADING', sourceField: 'portOfDischarge', sourceLabel: 'BOL Port of Discharge', mappingType: 'direct' },
      ],
    },
    {
      sectionLabel: 'Importer (from master data + BOL)',
      mappings: [
        { targetField: 'importerOfRecordName', targetLabel: 'Importer of Record', sourceDoc: 'BILL_OF_LADING', sourceField: 'consigneeName', sourceLabel: 'BOL Consignee', mappingType: 'direct' },
        { targetField: 'importerOfRecordAddress', targetLabel: 'Importer Address', sourceDoc: 'BILL_OF_LADING', sourceField: 'consigneeAddress', sourceLabel: 'BOL Consignee Address', mappingType: 'direct' },
        { targetField: 'importerNumber', targetLabel: 'Importer Number', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'CBP importer number', mappingType: 'manual', mono: true },
        { targetField: 'ultimateConsigneeName', targetLabel: 'Ultimate Consignee', sourceDoc: 'BILL_OF_LADING', sourceField: 'notifyPartyName', sourceLabel: 'BOL Notify Party', mappingType: 'conditional', transformation: 'IF notify party = end buyer THEN use it; ELSE use consignee' },
      ],
    },
    {
      sectionLabel: 'Origin & Manufacturer',
      mappings: [
        { targetField: 'countryOfOrigin', targetLabel: 'Country of Origin', sourceDoc: 'BILL_OF_LADING', sourceField: 'countryOfOrigin', sourceLabel: 'BOL Country of Origin', mappingType: 'direct' },
        { targetField: 'exportingCountry', targetLabel: 'Exporting Country', sourceDoc: 'SALES_INVOICE', sourceField: 'countryOfOrigin', sourceLabel: 'SI Country of Origin', mappingType: 'direct' },
        { targetField: 'exportDate', targetLabel: 'Export Date', sourceDoc: 'BILL_OF_LADING', sourceField: 'shippedOnBoardDate', sourceLabel: 'BOL Ship Date', mappingType: 'direct', mono: true },
        { targetField: 'manufacturerId', targetLabel: 'Manufacturer ID', sourceDoc: 'CALCULATED', sourceField: 'INZETMAN or INIMMECO', sourceLabel: 'Derived from exporter', mappingType: 'derived', transformation: 'IF exporter = Zetwerk THEN INZETMAN; IF Immadi THEN INIMMECO' },
      ],
    },
    {
      sectionLabel: 'Steel Melt & Pour (Section 232)',
      mappings: [
        { targetField: 'countryOfMeltAndPour', targetLabel: 'Country of Melt & Pour', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'From mill certificate', mappingType: 'manual' },
        { targetField: 'primaryCountryOfSmelt', targetLabel: 'Primary Smelt Country', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'From mill certificate', mappingType: 'manual' },
        { targetField: 'secondaryCountryOfSmelt', targetLabel: 'Secondary Smelt Country', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'If applicable', mappingType: 'manual' },
        { targetField: 'countryOfCast', targetLabel: 'Country of Cast', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'From mill certificate', mappingType: 'manual' },
      ],
    },
    {
      sectionLabel: 'Cargo (from BOL)',
      mappings: [
        { targetField: 'billQty', targetLabel: 'Bill Quantity', sourceDoc: 'BILL_OF_LADING', sourceField: 'totalPackages', sourceLabel: 'BOL Total Packages', mappingType: 'direct', mono: true },
        { targetField: 'billQtyUnit', targetLabel: 'Quantity Unit', sourceDoc: 'BILL_OF_LADING', sourceField: 'grossWeightUnit', sourceLabel: 'BOL Weight Unit', mappingType: 'contextual', transformation: 'Map: KGS=KG, PCS=PCS, PKG=PK' },
        { targetField: 'totalEnteredValue', targetLabel: 'Total Entered Value', sourceDoc: 'SALES_INVOICE', sourceField: 'totalAmount', sourceLabel: 'SI Total Amount', mappingType: 'direct', transformation: 'Sum of all SI totals linked to this BOL', mono: true },
        { targetField: 'locationOfGoods', targetLabel: 'Location of Goods (FIRMS)', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'Terminal FIRMS code', mappingType: 'manual' },
      ],
    },
    {
      sectionLabel: 'Tariff Lines (per line item — HTS codes required)',
      mappings: [
        { targetField: 'tariffLines[].lineHtsusNumber', targetLabel: 'HTS Number', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'US broker assigns HTS classification', mappingType: 'manual', transformation: 'US broker classifies each product under HTS schedule', mono: true },
        { targetField: 'tariffLines[].lineMerchandiseDescription', targetLabel: 'Merchandise Description', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].productDescription', sourceLabel: 'SI Product Description', mappingType: 'direct' },
        { targetField: 'tariffLines[].enteredValue', targetLabel: 'Entered Value', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].lineTotal', sourceLabel: 'SI Line Total', mappingType: 'direct', mono: true },
        { targetField: 'tariffLines[].dutyRate', targetLabel: 'Duty Rate', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'From HTS classification', mappingType: 'manual', transformation: 'Duty rate determined by HTS code (e.g., 25% Section 232)', mono: true },
        { targetField: 'tariffLines[].dutyAmount', targetLabel: 'Duty Amount', sourceDoc: 'CALCULATED', sourceField: 'enteredValue * dutyRate', sourceLabel: 'Calculated', mappingType: 'derived', transformation: 'enteredValue * dutyRate / 100', mono: true },
      ],
    },
    {
      sectionLabel: 'Duties & Fees Summary',
      mappings: [
        { targetField: 'totalDuty', targetLabel: 'Total Duty', sourceDoc: 'CALCULATED', sourceField: 'SUM(tariffLines.dutyAmount)', sourceLabel: 'Sum of line duties', mappingType: 'derived', mono: true },
        { targetField: 'mpfTotal', targetLabel: 'MPF Total', sourceDoc: 'CALCULATED', sourceField: '0.3464% of totalEnteredValue', sourceLabel: 'MPF formula', mappingType: 'derived', transformation: '0.003464 * totalEnteredValue, min $31.67, max $614.35', mono: true },
        { targetField: 'hmfTotal', targetLabel: 'HMF Total', sourceDoc: 'CALCULATED', sourceField: '0.125% of totalEnteredValue', sourceLabel: 'HMF formula', mappingType: 'derived', transformation: '0.00125 * totalEnteredValue', mono: true },
        { targetField: 'grandTotal', targetLabel: 'Grand Total', sourceDoc: 'CALCULATED', sourceField: 'totalDuty + mpfTotal + hmfTotal', sourceLabel: 'Sum of all', mappingType: 'derived', mono: true },
      ],
    },
    {
      sectionLabel: 'Broker / Declarant',
      mappings: [
        { targetField: 'brokerName', targetLabel: 'Broker Name', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'Assigned US customs broker', mappingType: 'manual' },
        { targetField: 'brokerAddress', targetLabel: 'Broker Address', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'Broker office', mappingType: 'manual' },
        { targetField: 'declarantName', targetLabel: 'Declarant', sourceDoc: 'MANUAL', sourceField: '', sourceLabel: 'Broker filing agent', mappingType: 'manual' },
        { targetField: 'declarantDate', targetLabel: 'Declaration Date', sourceDoc: 'CALCULATED', sourceField: 'today()', sourceLabel: 'Current date', mappingType: 'derived', mono: true },
      ],
    },
  ],
};

// ---------------------------------------------------------------
// MASTER MAP
// ---------------------------------------------------------------

export const DOC_GEN_SCHEMAS: Record<string, DocGenSchema> = {
  PACKING_LIST: PACKING_LIST_GEN,
  US_PACKING_LIST: OUTWARD_PL_GEN,
  ENTRY_SUMMARY: DRAFT_BOE_GEN,
};

export function getDocGenSchema(docType: string): DocGenSchema | undefined {
  return DOC_GEN_SCHEMAS[docType];
}

/** Get field count summary for a schema */
export function getFieldSummary(docType: string): { auto: number; calc: number; manual: number; total: number } {
  const schema = getDocGenSchema(docType);
  if (!schema) return { auto: 0, calc: 0, manual: 0, total: 0 };
  return {
    auto: schema.autoPopulated,
    calc: schema.calculated,
    manual: schema.manualInput,
    total: schema.totalFields,
  };
}
