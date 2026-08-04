/**
 * EWMS Cross-Validation Rule Configuration
 *
 * Maps every BRD-defined cross-validation rule to the exact Prisma field keys
 * on both the SOURCE document and the TARGET document.
 *
 * 48 rules from the BRD + 9 additional rules identified from the Prisma schema
 * where field overlap creates natural validation opportunities.
 *
 * Usage:
 *   import { CROSS_VALIDATION_RULES, getRulesForDocType } from '@/config/crossValidationConfig';
 *   const chaRules = getRulesForDocType('CHA_BILL');
 *   // Returns 4 BRD rules + 2 additional
 *
 * Each rule has:
 *   - ruleId: BRD code (V-INV-01) or NEW code (V-INV-06) for additions
 *   - description: human-readable rule description
 *   - sourceDocType: the doc being validated
 *   - sourceField: Prisma field key on the source doc
 *   - targetDocType: the doc to validate against ('SELF' or 'MASTER_DATA' for non-doc checks)
 *   - targetField: Prisma field key on the target doc (or pattern string for Self/Master checks)
 *   - matchType: how to compare values
 *   - tolerance?: numeric tolerance for weight/value comparisons
 *   - isNew: true for rules added beyond the BRD (for tracking)
 */

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------

export type MatchType =
  | 'exact'           // String must match exactly (after normalization)
  | 'fuzzy_name'      // Company name match (ignore case, Ltd/Pvt/Inc variations)
  | 'numeric_exact'   // Numbers must match exactly
  | 'numeric_tolerance' // Numbers within tolerance %
  | 'pattern'         // Regex pattern match (self-validation)
  | 'contains'        // Source field contains target value (or vice versa)
  | 'set_match'       // Array/set: all items in source exist in target
  | 'master_data'     // Check against a known master value

export interface CrossValidationRule {
  ruleId: string;
  description: string;
  sourceDocType: string;
  sourceField: string;           // Prisma camelCase field key
  sourceFieldLabel: string;      // Human label for display
  targetDocType: string;         // 'SELF' | 'MASTER_DATA' | a DocType enum value
  targetField: string;           // Prisma key or pattern/expected value
  targetFieldLabel: string;
  matchType: MatchType;
  tolerance?: number;            // percentage (e.g., 1.0 = 1%)
  isNew: boolean;                // true = added beyond the 48 BRD rules
}

// ---------------------------------------------------------------
// SALES INVOICE — 5 BRD rules + 1 new
// ---------------------------------------------------------------

const V_INV: CrossValidationRule[] = [
  {
    ruleId: 'V-INV-01',
    description: 'Exporter name matches across all docs',
    sourceDocType: 'SALES_INVOICE',
    sourceField: 'exporterName',
    sourceFieldLabel: 'Exporter Name',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'shipperName',
    targetFieldLabel: 'Shipper / Consignor',
    matchType: 'fuzzy_name',
    isNew: false,
  },
  {
    ruleId: 'V-INV-02',
    description: 'Buyer / consignee matches',
    sourceDocType: 'SALES_INVOICE',
    sourceField: 'buyerName',
    sourceFieldLabel: 'Buyer Name',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'consigneeName',
    targetFieldLabel: 'Consignee',
    matchType: 'fuzzy_name',
    isNew: false,
  },
  {
    ruleId: 'V-INV-03',
    description: 'Invoice number format is valid',
    sourceDocType: 'SALES_INVOICE',
    sourceField: 'invoiceNo',
    sourceFieldLabel: 'Invoice No',
    targetDocType: 'SELF',
    targetField: '^(EXP\\/|KA\\/UM\\/|IMM\\/EXP\\/)',
    targetFieldLabel: 'Pattern: EXP/xxx or KA/UM/xxx or IMM/EXP/xxx',
    matchType: 'pattern',
    isNew: false,
  },
  {
    ruleId: 'V-INV-04',
    description: 'PO number matches buyer order on Packing List',
    sourceDocType: 'SALES_INVOICE',
    sourceField: 'buyerPoNo',
    sourceFieldLabel: 'Buyers Order No',
    targetDocType: 'PACKING_LIST',
    targetField: 'buyerPoNo',
    targetFieldLabel: 'Buyer PO Number',
    matchType: 'exact',
    isNew: false,
  },
  {
    ruleId: 'V-INV-05',
    description: 'HSN code is valid steel code',
    sourceDocType: 'SALES_INVOICE',
    sourceField: 'lineItems[].hsnCode',
    sourceFieldLabel: 'HSN Code (line items)',
    targetDocType: 'SELF',
    targetField: '^7308\\.90',
    targetFieldLabel: 'Pattern: 7308.90.xx',
    matchType: 'pattern',
    isNew: false,
  },
  // NEW: GSTIN on SI should match GSTIN on PL (both are from same exporter)
  {
    ruleId: 'V-INV-06',
    description: 'Exporter GSTIN matches Packing List GSTIN',
    sourceDocType: 'SALES_INVOICE',
    sourceField: 'gstin',
    sourceFieldLabel: 'GSTIN',
    targetDocType: 'PACKING_LIST',
    targetField: 'gstin',
    targetFieldLabel: 'GSTIN',
    matchType: 'exact',
    isNew: true,
  },
];

// ---------------------------------------------------------------
// PACKING LIST — 5 BRD rules + 1 new
// ---------------------------------------------------------------

const V_PL: CrossValidationRule[] = [
  {
    ruleId: 'V-PL-01',
    description: 'Invoice number matches Sales Invoice',
    sourceDocType: 'PACKING_LIST',
    sourceField: 'invoiceNo',
    sourceFieldLabel: 'Invoice No',
    targetDocType: 'SALES_INVOICE',
    targetField: 'invoiceNo',
    targetFieldLabel: 'Invoice Number',
    matchType: 'exact',
    isNew: false,
  },
  {
    ruleId: 'V-PL-02',
    description: 'PO number matches Sales Invoice',
    sourceDocType: 'PACKING_LIST',
    sourceField: 'buyerPoNo',
    sourceFieldLabel: 'Buyers Order No',
    targetDocType: 'SALES_INVOICE',
    targetField: 'buyerPoNo',
    targetFieldLabel: 'PO Number',
    matchType: 'exact',
    isNew: false,
  },
  {
    ruleId: 'V-PL-03',
    description: 'Bundle count matches Sales Invoice',
    sourceDocType: 'PACKING_LIST',
    sourceField: 'totalBundles',
    sourceFieldLabel: 'Total Bundles',
    targetDocType: 'SALES_INVOICE',
    targetField: 'packageDescription',
    targetFieldLabel: 'Package / Bundle count',
    matchType: 'numeric_exact',
    isNew: false,
  },
  {
    ruleId: 'V-PL-04',
    description: 'Total quantity matches Sales Invoice',
    sourceDocType: 'PACKING_LIST',
    sourceField: 'totalQty',
    sourceFieldLabel: 'Total Qty (PCS)',
    targetDocType: 'SALES_INVOICE',
    targetField: 'totalQuantity',
    targetFieldLabel: 'Total Quantity',
    matchType: 'numeric_exact',
    isNew: false,
  },
  {
    ruleId: 'V-PL-05',
    description: 'Product codes match Sales Invoice line items',
    sourceDocType: 'PACKING_LIST',
    sourceField: 'lineItems[].productCode',
    sourceFieldLabel: 'Product Code (line items)',
    targetDocType: 'SALES_INVOICE',
    targetField: 'lineItems[].productCode',
    targetFieldLabel: 'Product Code (line items)',
    matchType: 'set_match',
    isNew: false,
  },
  // NEW: Gross weight on PL should reconcile with SI gross weight
  {
    ruleId: 'V-PL-06',
    description: 'Gross weight reconcilable with Sales Invoice',
    sourceDocType: 'PACKING_LIST',
    sourceField: 'totalGrossWeightKgs',
    sourceFieldLabel: 'Gross Weight (kg)',
    targetDocType: 'SALES_INVOICE',
    targetField: 'grossWeight',
    targetFieldLabel: 'Gross Weight',
    matchType: 'numeric_tolerance',
    tolerance: 1.0,
    isNew: true,
  },
];

// ---------------------------------------------------------------
// BILL OF LADING — 8 BRD rules + 1 new
// ---------------------------------------------------------------

const V_BOL: CrossValidationRule[] = [
  {
    ruleId: 'V-BOL-01',
    description: 'Shipper matches exporter on Sales Invoice',
    sourceDocType: 'BILL_OF_LADING',
    sourceField: 'shipperName',
    sourceFieldLabel: 'Shipper/Consignor',
    targetDocType: 'SALES_INVOICE',
    targetField: 'exporterName',
    targetFieldLabel: 'Exporter Name',
    matchType: 'fuzzy_name',
    isNew: false,
  },
  {
    ruleId: 'V-BOL-02',
    description: 'Consignee matches buyer on Sales Invoice',
    sourceDocType: 'BILL_OF_LADING',
    sourceField: 'consigneeName',
    sourceFieldLabel: 'Consignee',
    targetDocType: 'SALES_INVOICE',
    targetField: 'buyerName',
    targetFieldLabel: 'Buyer Name',
    matchType: 'fuzzy_name',
    isNew: false,
  },
  {
    ruleId: 'V-BOL-03',
    description: 'All invoice numbers on BOL exist as Sales Invoices in system',
    sourceDocType: 'BILL_OF_LADING',
    sourceField: 'exportInvoiceNumber',
    sourceFieldLabel: 'Export Invoice Numbers',
    targetDocType: 'SALES_INVOICE',
    targetField: 'invoiceNo',
    targetFieldLabel: 'Invoice Number',
    matchType: 'set_match',
    isNew: false,
  },
  {
    ruleId: 'V-BOL-04',
    description: 'Gross weight matches sum of all Packing Lists in shipment',
    sourceDocType: 'BILL_OF_LADING',
    sourceField: 'grossWeight',
    sourceFieldLabel: 'Gross Weight',
    targetDocType: 'PACKING_LIST',
    targetField: 'totalGrossWeightKgs',
    targetFieldLabel: 'Gross Weight (sum of all PLs)',
    matchType: 'numeric_tolerance',
    tolerance: 1.0,
    isNew: false,
  },
  {
    ruleId: 'V-BOL-05',
    description: 'Net weight matches sum of all Packing Lists in shipment',
    sourceDocType: 'BILL_OF_LADING',
    sourceField: 'netWeight',
    sourceFieldLabel: 'Net Weight',
    targetDocType: 'PACKING_LIST',
    targetField: 'totalNetWeightKgs',
    targetFieldLabel: 'Net Weight (sum of all PLs)',
    matchType: 'numeric_tolerance',
    tolerance: 1.0,
    isNew: false,
  },
  {
    ruleId: 'V-BOL-06',
    description: 'Total packages match sum across all Sales Invoices / Packing Lists',
    sourceDocType: 'BILL_OF_LADING',
    sourceField: 'totalPackages',
    sourceFieldLabel: 'Total Packages',
    targetDocType: 'SALES_INVOICE',
    targetField: 'totalQuantity',
    targetFieldLabel: 'Bundle/package count (sum)',
    matchType: 'numeric_exact',
    isNew: false,
  },
  {
    ruleId: 'V-BOL-07',
    description: 'Shipping bill numbers on BOL match uploaded Shipping Bills',
    sourceDocType: 'BILL_OF_LADING',
    sourceField: 'exportShippingBillNumber',
    sourceFieldLabel: 'SB Numbers',
    targetDocType: 'SHIPPING_BILL',
    targetField: 'sbNo',
    targetFieldLabel: 'SB Number',
    matchType: 'set_match',
    isNew: false,
  },
  {
    ruleId: 'V-BOL-08',
    description: 'Project name consistent across BOL and FF Bill',
    sourceDocType: 'BILL_OF_LADING',
    sourceField: 'projectName',
    sourceFieldLabel: 'Project Name',
    targetDocType: 'FREIGHT_FORWARDER_BILL',
    targetField: 'projectName',
    targetFieldLabel: 'Project Name',
    matchType: 'fuzzy_name',
    isNew: false,
  },
  // NEW: Port of loading on BOL should match Shipping Bill
  {
    ruleId: 'V-BOL-09',
    description: 'Port of loading matches Shipping Bill',
    sourceDocType: 'BILL_OF_LADING',
    sourceField: 'portOfLoading',
    sourceFieldLabel: 'Port of Loading',
    targetDocType: 'SHIPPING_BILL',
    targetField: 'portOfLoading',
    targetFieldLabel: 'Port of Loading',
    matchType: 'fuzzy_name',
    isNew: true,
  },
];

// ---------------------------------------------------------------
// SHIPPING BILL — 5 BRD rules + 1 new
// ---------------------------------------------------------------

const V_SB: CrossValidationRule[] = [
  {
    ruleId: 'V-SB-01',
    description: 'Invoice numbers match Sales Invoice',
    sourceDocType: 'SHIPPING_BILL',
    sourceField: 'invoiceRefs[].invoiceNoAndDate',
    sourceFieldLabel: 'Invoice Numbers',
    targetDocType: 'SALES_INVOICE',
    targetField: 'invoiceNo',
    targetFieldLabel: 'Invoice Number',
    matchType: 'set_match',
    isNew: false,
  },
  {
    ruleId: 'V-SB-02',
    description: 'FOB value matches Sales Invoice total',
    sourceDocType: 'SHIPPING_BILL',
    sourceField: 'sectionCValueSummaryFobValue',
    sourceFieldLabel: 'FOB Value',
    targetDocType: 'SALES_INVOICE',
    targetField: 'totalAmount',
    targetFieldLabel: 'Invoice Amount',
    matchType: 'numeric_tolerance',
    tolerance: 0.5,
    isNew: false,
  },
  {
    ruleId: 'V-SB-03',
    description: 'Consignee matches BOL and Sales Invoice',
    sourceDocType: 'SHIPPING_BILL',
    sourceField: 'consigneeNameAddress',
    sourceFieldLabel: 'Consignee',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'consigneeName',
    targetFieldLabel: 'Consignee',
    matchType: 'fuzzy_name',
    isNew: false,
  },
  {
    ruleId: 'V-SB-04',
    description: 'Port of loading matches BOL',
    sourceDocType: 'SHIPPING_BILL',
    sourceField: 'portOfLoading',
    sourceFieldLabel: 'Port of Loading',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'portOfLoading',
    targetFieldLabel: 'Port of Loading',
    matchType: 'fuzzy_name',
    isNew: false,
  },
  {
    ruleId: 'V-SB-05',
    description: 'Package count matches Packing List',
    sourceDocType: 'SHIPPING_BILL',
    sourceField: 'pkgCount',
    sourceFieldLabel: 'No. of Packets',
    targetDocType: 'PACKING_LIST',
    targetField: 'totalBundles',
    targetFieldLabel: 'Total Bundles',
    matchType: 'numeric_exact',
    isNew: false,
  },
  // NEW: Exporter on SB should match Sales Invoice exporter
  {
    ruleId: 'V-SB-06',
    description: 'Exporter matches Sales Invoice',
    sourceDocType: 'SHIPPING_BILL',
    sourceField: 'exporterNameAddress',
    sourceFieldLabel: 'Exporter',
    targetDocType: 'SALES_INVOICE',
    targetField: 'exporterName',
    targetFieldLabel: 'Exporter Name',
    matchType: 'fuzzy_name',
    isNew: true,
  },
];

// ---------------------------------------------------------------
// ENTRY SUMMARY (BOE) — 8 BRD rules
// ---------------------------------------------------------------

const V_BOE: CrossValidationRule[] = [
  {
    ruleId: 'V-BOE-01',
    description: 'BL number matches BOL',
    sourceDocType: 'ENTRY_SUMMARY',
    sourceField: 'blOrAwbNumber',
    sourceFieldLabel: 'B/L or AWB Number',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'bolNumber',
    targetFieldLabel: 'BOL Number',
    matchType: 'exact',
    isNew: false,
  },
  {
    ruleId: 'V-BOE-02',
    description: 'Importer of Record is Unimacts',
    sourceDocType: 'ENTRY_SUMMARY',
    sourceField: 'importerOfRecordName',
    sourceFieldLabel: 'Importer of Record',
    targetDocType: 'MASTER_DATA',
    targetField: 'UNIMACTS GLOBAL LLC',
    targetFieldLabel: 'Expected: UNIMACTS GLOBAL LLC',
    matchType: 'master_data',
    isNew: false,
  },
  {
    ruleId: 'V-BOE-03',
    description: 'Total packages match BOL',
    sourceDocType: 'ENTRY_SUMMARY',
    sourceField: 'billQty',
    sourceFieldLabel: 'Total Packages',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'totalPackages',
    targetFieldLabel: 'Total Packages',
    matchType: 'numeric_exact',
    isNew: false,
  },
  {
    ruleId: 'V-BOE-04',
    description: 'Invoice references match BOL export invoice numbers',
    sourceDocType: 'ENTRY_SUMMARY',
    sourceField: 'lineItems[].invoiceReferences',
    sourceFieldLabel: 'Line Item Invoice References',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'exportInvoiceNumber',
    targetFieldLabel: 'Export Invoice Number',
    matchType: 'set_match',
    isNew: false,
  },
  {
    ruleId: 'V-BOE-05',
    description: 'Gross weight reconcilable with BOL',
    sourceDocType: 'ENTRY_SUMMARY',
    sourceField: 'lineItems[].grossWeights',
    sourceFieldLabel: 'Line Item Gross Weights (sum)',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'grossWeight',
    targetFieldLabel: 'Gross Weight',
    matchType: 'numeric_tolerance',
    tolerance: 2.0,
    isNew: false,
  },
  {
    ruleId: 'V-BOE-06',
    description: 'Manufacturer ID matches exporter pattern',
    sourceDocType: 'ENTRY_SUMMARY',
    sourceField: 'manufacturerId',
    sourceFieldLabel: 'Manufacturer ID',
    targetDocType: 'SELF',
    targetField: '^(INZETMAN|INIMMECO)',
    targetFieldLabel: 'Pattern: INZETMAN or INIMMECO',
    matchType: 'pattern',
    isNew: false,
  },
  {
    ruleId: 'V-BOE-07',
    description: 'Additional BLs match BOL numbers (HBL = BL on BOL when FF involved)',
    sourceDocType: 'ENTRY_SUMMARY',
    sourceField: 'additionalBLs',
    sourceFieldLabel: 'Additional BLs',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'bolNumber',
    targetFieldLabel: 'BOL Number',
    matchType: 'contains',
    isNew: false,
  },
  {
    ruleId: 'V-BOE-08',
    description: 'US port of unlading matches BOL discharge port',
    sourceDocType: 'ENTRY_SUMMARY',
    sourceField: 'usPortOfUnlading',
    sourceFieldLabel: 'US Port of Unlading',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'portOfDischarge',
    targetFieldLabel: 'Port of Discharge',
    matchType: 'fuzzy_name',
    isNew: false,
  },
];

// ---------------------------------------------------------------
// CHA BILL — 4 BRD rules + 2 new
// ---------------------------------------------------------------

const V_CHA: CrossValidationRule[] = [
  {
    ruleId: 'V-CHA-01',
    description: 'Shipper matches exporter on Sales Invoice',
    sourceDocType: 'CHA_BILL',
    sourceField: 'shipmentShipper',
    sourceFieldLabel: 'Shipper',
    targetDocType: 'SALES_INVOICE',
    targetField: 'exporterName',
    targetFieldLabel: 'Exporter',
    matchType: 'fuzzy_name',
    isNew: false,
  },
  {
    ruleId: 'V-CHA-02',
    description: 'Consignee matches BOL consignee',
    sourceDocType: 'CHA_BILL',
    sourceField: 'shipmentConsignee',
    sourceFieldLabel: 'Consignee',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'consigneeName',
    targetFieldLabel: 'Consignee',
    matchType: 'fuzzy_name',
    isNew: false,
  },
  {
    ruleId: 'V-CHA-03',
    description: 'Container numbers match BOL containers',
    sourceDocType: 'CHA_BILL',
    sourceField: 'containersRaw',
    sourceFieldLabel: 'Containers',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'containers[]',
    targetFieldLabel: 'Container list',
    matchType: 'set_match',
    isNew: false,
  },
  {
    ruleId: 'V-CHA-04',
    description: 'Vessel name matches BOL vessel',
    sourceDocType: 'CHA_BILL',
    sourceField: 'shipmentVesselName',
    sourceFieldLabel: 'Vessel Name',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'vesselName',
    targetFieldLabel: 'Vessel',
    matchType: 'fuzzy_name',
    isNew: false,
  },
  // NEW: CHA Bill GSTIN should match Sales Invoice GSTIN (same customer)
  {
    ruleId: 'V-CHA-05',
    description: 'Customer GSTIN matches Sales Invoice exporter GSTIN',
    sourceDocType: 'CHA_BILL',
    sourceField: 'customerGstin',
    sourceFieldLabel: 'Customer GSTIN',
    targetDocType: 'SALES_INVOICE',
    targetField: 'gstin',
    targetFieldLabel: 'Exporter GSTIN',
    matchType: 'exact',
    isNew: true,
  },
  // NEW: QR total invoice value should match grand total on same CHA Bill
  {
    ruleId: 'V-CHA-06',
    description: 'QR JWT total matches printed grand total (self-check)',
    sourceDocType: 'CHA_BILL',
    sourceField: 'qrTotalInvValue',
    sourceFieldLabel: 'QR Total Invoice Value',
    targetDocType: 'SELF',
    targetField: 'totalsGrandTotalInr',
    targetFieldLabel: 'Grand Total (INR)',
    matchType: 'numeric_exact',
    isNew: true,
  },
];

// ---------------------------------------------------------------
// FREIGHT FORWARDER BILL — 8 BRD rules
// ---------------------------------------------------------------

const V_FF: CrossValidationRule[] = [
  {
    ruleId: 'V-FF-01',
    description: 'Shipper matches exporter on Sales Invoice',
    sourceDocType: 'FREIGHT_FORWARDER_BILL',
    sourceField: 'shipper',
    sourceFieldLabel: 'Shipper',
    targetDocType: 'SALES_INVOICE',
    targetField: 'exporterName',
    targetFieldLabel: 'Exporter',
    matchType: 'fuzzy_name',
    isNew: false,
  },
  {
    ruleId: 'V-FF-02',
    description: 'Consignee matches BOL consignee',
    sourceDocType: 'FREIGHT_FORWARDER_BILL',
    sourceField: 'consignee',
    sourceFieldLabel: 'Consignee',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'consigneeName',
    targetFieldLabel: 'Consignee',
    matchType: 'fuzzy_name',
    isNew: false,
  },
  {
    ruleId: 'V-FF-03',
    description: 'Gross weight reconcilable with Packing List',
    sourceDocType: 'FREIGHT_FORWARDER_BILL',
    sourceField: 'cargoGrossWeightKg',
    sourceFieldLabel: 'Gross Weight',
    targetDocType: 'PACKING_LIST',
    targetField: 'totalGrossWeightKgs',
    targetFieldLabel: 'Total Weight',
    matchType: 'numeric_tolerance',
    tolerance: 1.0,
    isNew: false,
  },
  {
    ruleId: 'V-FF-04',
    description: 'Container numbers match BOL containers',
    sourceDocType: 'FREIGHT_FORWARDER_BILL',
    sourceField: 'containers[]',
    sourceFieldLabel: 'Containers',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'containers[]',
    targetFieldLabel: 'Container list',
    matchType: 'set_match',
    isNew: false,
  },
  {
    ruleId: 'V-FF-05',
    description: 'Shipping bill number matches Shipping Bill (if present)',
    sourceDocType: 'FREIGHT_FORWARDER_BILL',
    sourceField: 'sbNumbers',
    sourceFieldLabel: 'SB Number',
    targetDocType: 'SHIPPING_BILL',
    targetField: 'sbNo',
    targetFieldLabel: 'SB Number',
    matchType: 'exact',
    isNew: false,
  },
  {
    ruleId: 'V-FF-06',
    description: 'House/Master BL matches BOL number',
    sourceDocType: 'FREIGHT_FORWARDER_BILL',
    sourceField: 'houseBol',
    sourceFieldLabel: 'House/Master BL',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'bolNumber',
    targetFieldLabel: 'BOL Number',
    matchType: 'exact',
    isNew: false,
  },
  {
    ruleId: 'V-FF-07',
    description: 'Customer invoice numbers match Sales Invoices (if present)',
    sourceDocType: 'FREIGHT_FORWARDER_BILL',
    sourceField: 'customerInvoiceNumbers',
    sourceFieldLabel: 'Customer Invoice Numbers',
    targetDocType: 'SALES_INVOICE',
    targetField: 'invoiceNo',
    targetFieldLabel: 'Invoice Number',
    matchType: 'set_match',
    isNew: false,
  },
  {
    ruleId: 'V-FF-08',
    description: 'Project name matches BOL project',
    sourceDocType: 'FREIGHT_FORWARDER_BILL',
    sourceField: 'projectName',
    sourceFieldLabel: 'Project Name',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'projectName',
    targetFieldLabel: 'Project Name',
    matchType: 'fuzzy_name',
    isNew: false,
  },
];

// ---------------------------------------------------------------
// OCEAN FREIGHT — 5 BRD rules + 1 new
// ---------------------------------------------------------------

const V_OF: CrossValidationRule[] = [
  {
    ruleId: 'V-OF-01',
    description: 'Vessel name matches BOL',
    sourceDocType: 'OCEAN_FREIGHT',
    sourceField: 'vesselName',
    sourceFieldLabel: 'Vessel Name',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'vesselName',
    targetFieldLabel: 'Vessel',
    matchType: 'fuzzy_name',
    isNew: false,
  },
  {
    ruleId: 'V-OF-02',
    description: 'Loading port matches BOL',
    sourceDocType: 'OCEAN_FREIGHT',
    sourceField: 'loadingPort',
    sourceFieldLabel: 'Loading Port',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'portOfLoading',
    targetFieldLabel: 'Port of Loading',
    matchType: 'fuzzy_name',
    isNew: false,
  },
  {
    ruleId: 'V-OF-03',
    description: 'Container numbers match BOL containers',
    sourceDocType: 'OCEAN_FREIGHT',
    sourceField: 'containers[]',
    sourceFieldLabel: 'Containers',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'containers[]',
    targetFieldLabel: 'Container list',
    matchType: 'set_match',
    isNew: false,
  },
  {
    ruleId: 'V-OF-04',
    description: 'Cargo weight reconcilable with BOL (break bulk: weight & packages)',
    sourceDocType: 'OCEAN_FREIGHT',
    sourceField: 'cargoWeightKg',
    sourceFieldLabel: 'Cargo Weight',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'grossWeight',
    targetFieldLabel: 'Total Cargo Weight',
    matchType: 'numeric_tolerance',
    tolerance: 2.0,
    isNew: false,
  },
  {
    ruleId: 'V-OF-05',
    description: 'BOL number matches (if present)',
    sourceDocType: 'OCEAN_FREIGHT',
    sourceField: 'oceanBol',
    sourceFieldLabel: 'Ocean BOL / House BOL',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'bolNumber',
    targetFieldLabel: 'BOL Number',
    matchType: 'exact',
    isNew: false,
  },
  // NEW: Discharge port should match BOL discharge port
  {
    ruleId: 'V-OF-06',
    description: 'Discharge port matches BOL',
    sourceDocType: 'OCEAN_FREIGHT',
    sourceField: 'dischargingPort',
    sourceFieldLabel: 'Discharge Port',
    targetDocType: 'BILL_OF_LADING',
    targetField: 'portOfDischarge',
    targetFieldLabel: 'Port of Discharge',
    matchType: 'fuzzy_name',
    isNew: true,
  },
];

// ---------------------------------------------------------------
// MASTER ARRAYS AND LOOKUP FUNCTIONS
// ---------------------------------------------------------------

export const CROSS_VALIDATION_RULES: CrossValidationRule[] = [
  ...V_INV,
  ...V_PL,
  ...V_BOL,
  ...V_SB,
  ...V_BOE,
  ...V_CHA,
  ...V_FF,
  ...V_OF,
];

/** Get all rules where the given docType is the SOURCE */
export function getRulesForDocType(docType: string): CrossValidationRule[] {
  return CROSS_VALIDATION_RULES.filter(r => r.sourceDocType === docType);
}

/** Get all rules where the given docType is the TARGET (i.e., other docs validate against this one) */
export function getRulesDependingOn(docType: string): CrossValidationRule[] {
  return CROSS_VALIDATION_RULES.filter(r => r.targetDocType === docType);
}

/** Get only BRD-defined rules (isNew === false) */
export function getBrdRules(): CrossValidationRule[] {
  return CROSS_VALIDATION_RULES.filter(r => !r.isNew);
}

/** Get only newly added rules (isNew === true) */
export function getNewRules(): CrossValidationRule[] {
  return CROSS_VALIDATION_RULES.filter(r => r.isNew);
}

/** Summary: how many rules per doc type */
export function getRuleSummary(): Record<string, { total: number; brd: number; new: number }> {
  const summary: Record<string, { total: number; brd: number; new: number }> = {};
  for (const rule of CROSS_VALIDATION_RULES) {
    if (!summary[rule.sourceDocType]) {
      summary[rule.sourceDocType] = { total: 0, brd: 0, new: 0 };
    }
    summary[rule.sourceDocType].total++;
    if (rule.isNew) summary[rule.sourceDocType].new++;
    else summary[rule.sourceDocType].brd++;
  }
  return summary;
}
