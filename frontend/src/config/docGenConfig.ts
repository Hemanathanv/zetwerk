export type MappingType = 'direct' | 'derived' | 'contextual' | 'manual' | 'conditional';
export type Severity   = 'critical' | 'warning' | 'info';

export interface FieldMapping {
  targetField:         string;
  targetLabel:         string;
  sourceDoc:           string;
  sourceField:         string;
  sourceLabel:         string;
  mappingType:         MappingType;
  transformation?:     string;
  validation?:         string;
  validationSeverity?: Severity;
  mono?:               boolean;
  isLineItem?:         boolean;
}

export interface GenSection {
  sectionLabel: string;
  renderAs:     'fields' | 'table';
  condition?:   string;
  mappings:     FieldMapping[];
}

export interface DocGenSchema {
  docType:          string;
  displayName:      string;
  triggerCondition: string;
  sourceDocs:       { docType: string; label: string }[];
  humanAction:      string;
  fieldCounts:      { auto: number; calculated: number; manual: number; total: number };
  sections:         GenSection[];
  mockData: {
    fields: Record<string, string>;
    tables: Record<string, Record<string, string>[]>;
  };
}

// ─── Schema 1: Packing List ───────────────────────────────────────────────────

const PACKING_LIST_SCHEMA: DocGenSchema = {
  docType:          'packing-list',
  displayName:      'Packing List',
  triggerCondition: 'Sales Invoice extraction approved',
  sourceDocs: [{ docType: 'SALES_INVOICE', label: 'Sales Invoice' }],
  humanAction:  'Review bundle allocation, confirm weights',
  fieldCounts:  { auto: 32, calculated: 7, manual: 7, total: 46 },

  sections: [
    {
      sectionLabel: 'Header',
      renderAs: 'fields',
      mappings: [
        { targetField: 'invoiceNo',        targetLabel: 'Invoice Number',      sourceDoc: 'SALES_INVOICE', sourceField: 'invoiceNo',        sourceLabel: 'Invoice Number',      mappingType: 'direct',     validation: 'NOT NULL',             validationSeverity: 'critical', mono: true },
        { targetField: 'invoiceDate',      targetLabel: 'Invoice Date',        sourceDoc: 'SALES_INVOICE', sourceField: 'invoiceDate',      sourceLabel: 'Invoice Date',        mappingType: 'direct',     validation: 'NOT NULL; date ≤ today', validationSeverity: 'critical', mono: true },
        { targetField: 'buyerPoNo',        targetLabel: 'Buyer PO Number',     sourceDoc: 'SALES_INVOICE', sourceField: 'buyerPoNo',        sourceLabel: 'Buyer PO Number',     mappingType: 'direct',     mono: true },
        { targetField: 'buyerPoDate',      targetLabel: 'PO Date',             sourceDoc: 'SALES_INVOICE', sourceField: 'buyerPoDate',      sourceLabel: 'PO Date',             mappingType: 'direct',     mono: true },
        { targetField: 'exporterRef',      targetLabel: 'Exporter Reference',  sourceDoc: 'SALES_INVOICE', sourceField: 'zetwerkRef',       sourceLabel: 'Exporter Reference',  mappingType: 'direct',     mono: true },
        { targetField: 'otherReferences',  targetLabel: 'Other References',    sourceDoc: 'SALES_INVOICE', sourceField: 'otherReferences',  sourceLabel: 'Other References',    mappingType: 'direct' },
        { targetField: 'pickupAddress',    targetLabel: 'Pickup Address',      sourceDoc: 'SALES_INVOICE', sourceField: 'exporterAddress',  sourceLabel: 'Exporter Address',    mappingType: 'contextual', transformation: 'Map exporter address as pickup location' },
      ],
    },
    {
      sectionLabel: 'Parties',
      renderAs: 'fields',
      mappings: [
        { targetField: 'exporterName',       targetLabel: 'Exporter Name',        sourceDoc: 'SALES_INVOICE', sourceField: 'exporterName',       sourceLabel: 'Exporter Name',       mappingType: 'direct',     validation: 'NOT NULL', validationSeverity: 'critical' },
        { targetField: 'exporterAddress',    targetLabel: 'Exporter Address',     sourceDoc: 'SALES_INVOICE', sourceField: 'exporterAddress',    sourceLabel: 'Exporter Address',    mappingType: 'direct' },
        { targetField: 'buyerName',          targetLabel: 'Buyer Name',           sourceDoc: 'SALES_INVOICE', sourceField: 'buyerName',          sourceLabel: 'Buyer Name',          mappingType: 'direct',     validation: 'NOT NULL', validationSeverity: 'critical' },
        { targetField: 'buyerAddress',       targetLabel: 'Buyer Address',        sourceDoc: 'SALES_INVOICE', sourceField: 'buyerAddress',       sourceLabel: 'Buyer Address',       mappingType: 'direct' },
        { targetField: 'consigneeName',      targetLabel: 'Consignee Name',       sourceDoc: 'SALES_INVOICE', sourceField: 'consigneeName',      sourceLabel: 'Consignee Name',      mappingType: 'direct',     validation: 'NOT NULL', validationSeverity: 'critical' },
        { targetField: 'consigneeAddress',   targetLabel: 'Consignee Address',    sourceDoc: 'SALES_INVOICE', sourceField: 'consigneeAddress',   sourceLabel: 'Consignee Address',   mappingType: 'direct' },
        { targetField: 'gstin',              targetLabel: 'GSTIN',                sourceDoc: 'SALES_INVOICE', sourceField: 'gstin',              sourceLabel: 'GSTIN',               mappingType: 'direct',     mono: true },
        { targetField: 'iec',               targetLabel: 'IEC Number',           sourceDoc: 'SALES_INVOICE', sourceField: 'iec',               sourceLabel: 'IEC',                 mappingType: 'direct',     mono: true },
        { targetField: 'shipTo',             targetLabel: 'Ship To',              sourceDoc: 'SALES_INVOICE', sourceField: 'shipTo',             sourceLabel: 'Ship To',             mappingType: 'direct' },
      ],
    },
    {
      sectionLabel: 'Shipping',
      renderAs: 'fields',
      mappings: [
        { targetField: 'portOfLoading',             targetLabel: 'Port of Loading',       sourceDoc: 'SALES_INVOICE', sourceField: 'portOfLoading',             sourceLabel: 'Port of Loading',       mappingType: 'direct' },
        { targetField: 'portOfDischarge',           targetLabel: 'Port of Discharge',     sourceDoc: 'SALES_INVOICE', sourceField: 'portOfDischarge',           sourceLabel: 'Port of Discharge',     mappingType: 'direct' },
        { targetField: 'countryOfOrigin',           targetLabel: 'Country of Origin',     sourceDoc: 'SALES_INVOICE', sourceField: 'countryOfOrigin',           sourceLabel: 'Country of Origin',     mappingType: 'direct' },
        { targetField: 'countryOfFinalDestination', targetLabel: 'Final Destination Country', sourceDoc: 'SALES_INVOICE', sourceField: 'countryOfFinalDestination', sourceLabel: 'Final Destination Country', mappingType: 'direct' },
        { targetField: 'finalDestination',          targetLabel: 'Final Destination',     sourceDoc: 'SALES_INVOICE', sourceField: 'finalDestination',          sourceLabel: 'Final Destination',     mappingType: 'direct' },
        { targetField: 'placeOfReceipt',            targetLabel: 'Place of Receipt',      sourceDoc: 'SALES_INVOICE', sourceField: 'placeOfReceipt',            sourceLabel: 'Place of Receipt',      mappingType: 'direct' },
        { targetField: 'vesselFlightNo',            targetLabel: 'Vessel / Flight No',    sourceDoc: 'SALES_INVOICE', sourceField: 'vesselFlightNo',            sourceLabel: 'Vessel / Flight No',    mappingType: 'direct' },
        { targetField: 'preCarriageBy',             targetLabel: 'Pre-Carriage By',       sourceDoc: 'SALES_INVOICE', sourceField: 'preCarriageBy',             sourceLabel: 'Pre-Carriage By',       mappingType: 'direct' },
      ],
    },
    {
      sectionLabel: 'Line Items',
      renderAs: 'table',
      mappings: [
        { targetField: 'hsnCode',          targetLabel: 'HSN Code',       sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].hsnCode',          sourceLabel: 'HSN Code',        mappingType: 'direct',      validation: 'NOT NULL', validationSeverity: 'critical', mono: true,  isLineItem: true },
        { targetField: 'productCode',      targetLabel: 'Product Code',   sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].productCode',      sourceLabel: 'Product Code',    mappingType: 'direct',      validation: 'NOT NULL', validationSeverity: 'critical', mono: true,  isLineItem: true },
        { targetField: 'productDesc',      targetLabel: 'Description',    sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].productDescription', sourceLabel: 'Description',   mappingType: 'direct',      isLineItem: true },
        { targetField: 'totalQtyInPcs',    targetLabel: 'Qty (PCS)',      sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].quantity',         sourceLabel: 'Quantity',        mappingType: 'direct',      validation: '> 0',      validationSeverity: 'critical', mono: true,  isLineItem: true },
        { targetField: 'containerNo',      targetLabel: 'Container No',    sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].containerNo',      sourceLabel: 'Container No',    mappingType: 'direct',      mono: true, isLineItem: true },
        { targetField: 'sealNo',           targetLabel: 'Seal No',         sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].sealNo',           sourceLabel: 'Seal No',         mappingType: 'direct',      mono: true, isLineItem: true },
        { targetField: 'kindOfPkg',        targetLabel: 'Package Type',   sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].kindOfPkg',        sourceLabel: 'Kind of Pkg',     mappingType: 'direct',      isLineItem: true },
        { targetField: 'noOfBundles',      targetLabel: 'Bundles',        sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].noOfBundles',      sourceLabel: 'No of Bundles',   mappingType: 'conditional', transformation: 'Use bundle count only; do not use package count', validation: 'NOT NULL or flagged', validationSeverity: 'warning', mono: true, isLineItem: true },
        { targetField: 'qtyPerBundle',     targetLabel: 'Qty/Bundle',     sourceDoc: 'CALCULATED',    sourceField: 'quantity / noOfBundles',       sourceLabel: 'Derived',         mappingType: 'derived',     transformation: 'qty ÷ bundles when bundles entered', validation: 'qtyPerBundle × bundles = qty', validationSeverity: 'critical', mono: true, isLineItem: true },
        { targetField: 'netWeightKgs',     targetLabel: 'Net Wt (kg)',    sourceDoc: 'CALCULATED',    sourceField: 'grossWeight − tareWeight',     sourceLabel: 'Derived or manual', mappingType: 'derived',   transformation: 'grossWeight − tare; manual if tare unavailable', validation: 'netWeight ≤ grossWeight', validationSeverity: 'warning', mono: true, isLineItem: true },
        { targetField: 'grossWeightKgs',   targetLabel: 'Gross Wt (kg)',  sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].grossWeight',      sourceLabel: 'Gross Weight',    mappingType: 'conditional', transformation: 'Copy if available; otherwise manual', validation: '> 0', validationSeverity: 'warning', mono: true, isLineItem: true },
      ],
    },
    {
      sectionLabel: 'Totals',
      renderAs: 'fields',
      mappings: [
        { targetField: 'totalBundles',       targetLabel: 'Total Bundles',      sourceDoc: 'CALCULATED', sourceField: 'SUM(lineItems.noOfBundles)',   sourceLabel: 'Sum of line bundles',    mappingType: 'derived', validation: 'Total ≥ count(lineItems)',   validationSeverity: 'critical', mono: true },
        { targetField: 'totalQty',           targetLabel: 'Total Quantity',     sourceDoc: 'CALCULATED', sourceField: 'SUM(lineItems.quantity)',      sourceLabel: 'Sum of line quantities', mappingType: 'derived', validation: 'Total ≥ max(lineItems.qty)', validationSeverity: 'critical', mono: true },
        { targetField: 'totalNetWeightKgs',  targetLabel: 'Net Weight (kg)',    sourceDoc: 'CALCULATED', sourceField: 'SUM(lineItems.netWeightKgs)', sourceLabel: 'Sum of line net weights', mappingType: 'derived', validation: 'Net ≤ Gross',               validationSeverity: 'critical', mono: true },
        { targetField: 'totalGrossWeightKgs', targetLabel: 'Gross Weight (kg)', sourceDoc: 'CALCULATED', sourceField: 'SUM(lineItems.grossWeightKgs)', sourceLabel: 'Sum of line gross weights', mappingType: 'derived', validation: 'Gross ≥ Net',             validationSeverity: 'critical', mono: true },
      ],
    },
    {
      sectionLabel: 'Signatory',
      renderAs: 'fields',
      mappings: [
        { targetField: 'signatoryName',        targetLabel: 'Signatory Name', sourceDoc: 'SALES_INVOICE', sourceField: 'signatoryName',        sourceLabel: 'Signatory Name', mappingType: 'direct' },
        { targetField: 'signatoryDesignation', targetLabel: 'Designation',    sourceDoc: 'SALES_INVOICE', sourceField: 'signatoryDesignation', sourceLabel: 'Designation',    mappingType: 'direct' },
        { targetField: 'dinNumber',            targetLabel: 'DIN Number',     sourceDoc: 'SALES_INVOICE', sourceField: 'dinNumber',            sourceLabel: 'DIN Number',     mappingType: 'direct', mono: true },
      ],
    },
  ],

  mockData: {
    fields: {
      invoiceNo:                  'KA/UM/2526/00773',
      invoiceDate:                '27-Jan-2026',
      buyerPoNo:                  'J44CES25090019',
      buyerPoDate:                '15-Dec-2025',
      exporterRef:                'ZW-EXP-25260084',
      otherReferences:            '',
      pickupAddress:              'Survey No 133, Jigani Hobli, Bangalore 560105',
      exporterName:               'Exporter Co. — SS Division',
      exporterAddress:            'Survey No 133, Jigani Hobli, Bangalore 560105',
      buyerName:                  'Buyer Corporation Inc.',
      buyerAddress:               '1234 Commerce St, Los Angeles, CA 90001',
      consigneeName:              'Buyer Corporation Inc.',
      consigneeAddress:           '1234 Commerce St, Los Angeles, CA 90001',
      gstin:                      '29AABCZ4521G1ZM',
      iec:                        '0417028743',
      shipTo:                     '1234 Commerce St, Los Angeles, CA 90001',
      portOfLoading:              'JNPT, Nhava Sheva',
      portOfDischarge:            'Los Angeles, CA',
      countryOfOrigin:            'India',
      countryOfFinalDestination:  'United States of America',
      finalDestination:           'Los Angeles, CA, USA',
      placeOfReceipt:             'Bangalore ICD',
      vesselFlightNo:             'TBD',
      preCarriageBy:              'Road',
      totalBundles:               'SUM(noOfBundles) — enter bundles above',
      totalQty:                   '5,600',
      totalNetWeightKgs:          '—',
      totalGrossWeightKgs:        '20,774.40',
      signatoryName:              'Rajesh Kumar',
      signatoryDesignation:       'Director',
      dinNumber:                  '02845931',
    },
    tables: {
      'Line Items': [
        { hsnCode: '7308.90', productCode: 'ZT-MNT-34A', productDesc: 'Steel mounting rail 2100mm',     totalQtyInPcs: '1,248', kindOfPkg: 'BUNDLES', noOfBundles: '', qtyPerBundle: '', netWeightKgs: '', grossWeightKgs: '15,475.20' },
        { hsnCode: '7308.90', productCode: 'ZT-CLP-12',  productDesc: 'End clamp stainless 35mm',       totalQtyInPcs: '3,840', kindOfPkg: 'CARTONS', noOfBundles: '', qtyPerBundle: '', netWeightKgs: '', grossWeightKgs: '3,148.80'  },
        { hsnCode: '7308.90', productCode: 'ZT-PRL-58',  productDesc: 'Purlin bracket powder-coat steel', totalQtyInPcs: '512', kindOfPkg: 'BUNDLES', noOfBundles: '', qtyPerBundle: '', netWeightKgs: '', grossWeightKgs: '2,150.40'  },
      ],
    },
  },
};

// ─── Schema 2: Outward GRN (Outward Packing List) ────────────────────────────

const OUTWARD_PL_SCHEMA: DocGenSchema = {
  docType:          'outward-pl',
  displayName:      'Outward GRN',
  triggerCondition: 'Packing List approved + Bill of Lading extracted',
  sourceDocs: [
    { docType: 'PACKING_LIST',   label: 'Packing List' },
    { docType: 'BILL_OF_LADING', label: 'Bill of Lading' },
  ],
  humanAction:  'Assign containers to line items, enter 3PL details',
  fieldCounts:  { auto: 22, calculated: 4, manual: 8, total: 34 },

  sections: [
    {
      sectionLabel: 'Document Header',
      renderAs: 'fields',
      mappings: [
        { targetField: 'plRef',       targetLabel: 'Packing List Ref', sourceDoc: 'PACKING_LIST', sourceField: 'invoiceNo',    sourceLabel: 'Invoice Number',      mappingType: 'direct',  mono: true },
        { targetField: 'plDate',      targetLabel: 'PL Date',          sourceDoc: 'PACKING_LIST', sourceField: 'invoiceDate',  sourceLabel: 'Invoice Date',        mappingType: 'direct',  mono: true },
        { targetField: 'bolRef',      targetLabel: 'BOL Reference',    sourceDoc: 'BILL_OF_LADING', sourceField: 'bolNumber', sourceLabel: 'BOL Number',          mappingType: 'direct',  mono: true },
        { targetField: 'buyerPoNo',   targetLabel: 'Buyer PO Number',  sourceDoc: 'PACKING_LIST', sourceField: 'buyerPoNo',   sourceLabel: 'Buyer PO Number',     mappingType: 'direct',  mono: true },
        { targetField: 'exporterRef', targetLabel: 'Exporter Reference', sourceDoc: 'PACKING_LIST', sourceField: 'exporterRef', sourceLabel: 'Exporter Reference', mappingType: 'direct',  mono: true },
        { targetField: 'grnDate',     targetLabel: 'GRN Date',         sourceDoc: 'MANUAL',       sourceField: 'manual',       sourceLabel: 'Manual',              mappingType: 'manual',  mono: true },
      ],
    },
    {
      sectionLabel: 'Parties',
      renderAs: 'fields',
      mappings: [
        { targetField: 'shipperName',     targetLabel: 'Shipper',            sourceDoc: 'BILL_OF_LADING', sourceField: 'shipperName',    sourceLabel: 'Shipper Name',    mappingType: 'direct' },
        { targetField: 'shipperAddress',  targetLabel: 'Shipper Address',    sourceDoc: 'BILL_OF_LADING', sourceField: 'shipperAddress', sourceLabel: 'Shipper Address', mappingType: 'direct' },
        { targetField: 'consigneeName',   targetLabel: 'Consignee',          sourceDoc: 'BILL_OF_LADING', sourceField: 'consigneeName',  sourceLabel: 'Consignee Name',  mappingType: 'direct' },
        { targetField: 'consigneeAddress',targetLabel: 'Consignee Address',  sourceDoc: 'BILL_OF_LADING', sourceField: 'consigneeAddress', sourceLabel: 'Consignee Address', mappingType: 'direct' },
        { targetField: 'notifyParty',     targetLabel: 'Notify Party',       sourceDoc: 'BILL_OF_LADING', sourceField: 'notifyPartyName', sourceLabel: 'Notify Party',   mappingType: 'direct' },
        { targetField: 'threePlName',     targetLabel: '3PL / Warehouse',    sourceDoc: 'MANUAL',        sourceField: 'manual',         sourceLabel: 'Manual',          mappingType: 'manual', validation: 'NOT NULL', validationSeverity: 'warning' },
        { targetField: 'threePlAddress',  targetLabel: '3PL Address',        sourceDoc: 'MANUAL',        sourceField: 'manual',         sourceLabel: 'Manual',          mappingType: 'manual' },
      ],
    },
    {
      sectionLabel: 'Shipping',
      renderAs: 'fields',
      mappings: [
        { targetField: 'vesselName',      targetLabel: 'Vessel Name',        sourceDoc: 'BILL_OF_LADING', sourceField: 'vesselName',     sourceLabel: 'Vessel Name',     mappingType: 'direct', mono: true },
        { targetField: 'voyageNumber',    targetLabel: 'Voyage',             sourceDoc: 'BILL_OF_LADING', sourceField: 'vesselVoyageNumber', sourceLabel: 'Voyage Number', mappingType: 'direct', mono: true },
        { targetField: 'portOfLoading',   targetLabel: 'Port of Loading',    sourceDoc: 'BILL_OF_LADING', sourceField: 'portOfLoading',  sourceLabel: 'Port of Loading', mappingType: 'direct' },
        { targetField: 'portOfDischarge', targetLabel: 'Port of Discharge',  sourceDoc: 'BILL_OF_LADING', sourceField: 'portOfDischarge', sourceLabel: 'Port of Discharge', mappingType: 'direct' },
        { targetField: 'eta',             targetLabel: 'ETA',                sourceDoc: 'BILL_OF_LADING', sourceField: 'shippedOnBoardDate', sourceLabel: 'Ship Date',   mappingType: 'contextual', transformation: 'Estimated arrival: ship date + transit days (lookup: port pair table)', mono: true },
        { targetField: 'countryOfOrigin', targetLabel: 'Country of Origin',  sourceDoc: 'BILL_OF_LADING', sourceField: 'countryOfOrigin', sourceLabel: 'Country of Origin', mappingType: 'direct' },
        { targetField: 'incoterms',       targetLabel: 'Incoterms',          sourceDoc: 'BILL_OF_LADING', sourceField: 'freightType',    sourceLabel: 'Freight Type',    mappingType: 'contextual', transformation: 'Map freight type to Incoterms code via lookup table' },
      ],
    },
    {
      sectionLabel: 'Container Allocation',
      renderAs: 'table',
      mappings: [
        { targetField: 'containerNo',  targetLabel: 'Container No',    sourceDoc: 'BILL_OF_LADING', sourceField: 'containers[].containerNo',  sourceLabel: 'Container No',  mappingType: 'direct',  mono: true, isLineItem: true },
        { targetField: 'sealNumber',   targetLabel: 'Seal No',         sourceDoc: 'BILL_OF_LADING', sourceField: 'containers[].sealNo',       sourceLabel: 'Seal No',       mappingType: 'direct',  mono: true, isLineItem: true },
        { targetField: 'containerType',targetLabel: 'Type',            sourceDoc: 'BILL_OF_LADING', sourceField: 'containers[].type',         sourceLabel: 'Type',          mappingType: 'direct',  isLineItem: true },
        { targetField: 'assignedItems',targetLabel: 'Items Assigned',  sourceDoc: 'MANUAL',         sourceField: 'manual',                   sourceLabel: 'Manual',        mappingType: 'manual',  isLineItem: true },
        { targetField: 'containerWt',  targetLabel: 'Gross Wt (kg)',   sourceDoc: 'CALCULATED',     sourceField: 'SUM(assignedItems.grossWt)', sourceLabel: 'Derived',      mappingType: 'derived', transformation: 'Sum of assigned line item gross weights', mono: true, isLineItem: true },
      ],
    },
    {
      sectionLabel: 'Line Items',
      renderAs: 'table',
      mappings: [
        { targetField: 'hsnCode',        targetLabel: 'HSN Code',       sourceDoc: 'PACKING_LIST', sourceField: 'lineItems[].hsnCode',       sourceLabel: 'HSN Code',      mappingType: 'direct',  mono: true,  isLineItem: true },
        { targetField: 'productCode',    targetLabel: 'Product Code',   sourceDoc: 'PACKING_LIST', sourceField: 'lineItems[].productCode',   sourceLabel: 'Product Code',  mappingType: 'direct',  mono: true,  isLineItem: true },
        { targetField: 'productDesc',    targetLabel: 'Description',    sourceDoc: 'PACKING_LIST', sourceField: 'lineItems[].productDesc',   sourceLabel: 'Description',   mappingType: 'direct',               isLineItem: true },
        { targetField: 'totalQtyInPcs',  targetLabel: 'Qty (PCS)',      sourceDoc: 'PACKING_LIST', sourceField: 'lineItems[].totalQtyInPcs', sourceLabel: 'Quantity',      mappingType: 'direct',  mono: true,  isLineItem: true },
        { targetField: 'noOfBundles',    targetLabel: 'Bundles',        sourceDoc: 'PACKING_LIST', sourceField: 'lineItems[].noOfBundles',   sourceLabel: 'Bundles',       mappingType: 'direct',  mono: true,  isLineItem: true },
        { targetField: 'netWeightKgs',   targetLabel: 'Net Wt (kg)',    sourceDoc: 'PACKING_LIST', sourceField: 'lineItems[].netWeightKgs',  sourceLabel: 'Net Weight kg', mappingType: 'direct',  mono: true,  isLineItem: true },
        { targetField: 'grossWeightKgs', targetLabel: 'Gross Wt (kg)',  sourceDoc: 'PACKING_LIST', sourceField: 'lineItems[].grossWeightKgs', sourceLabel: 'Gross Weight kg', mappingType: 'direct', mono: true, isLineItem: true },
        { targetField: 'grossWeightLbs', targetLabel: 'Gross Wt (lbs)', sourceDoc: 'CALCULATED',  sourceField: 'grossWeightKgs × 2.20462',  sourceLabel: 'Derived',       mappingType: 'derived', transformation: 'grossWeightKgs × 2.20462 → lbs', mono: true, isLineItem: true },
      ],
    },
    {
      sectionLabel: 'Totals',
      renderAs: 'fields',
      mappings: [
        { targetField: 'totalBundles',       targetLabel: 'Total Bundles',       sourceDoc: 'CALCULATED', sourceField: 'SUM(lineItems.noOfBundles)',    sourceLabel: 'Derived', mappingType: 'derived', mono: true },
        { targetField: 'totalQty',           targetLabel: 'Total Quantity',      sourceDoc: 'CALCULATED', sourceField: 'SUM(lineItems.totalQtyInPcs)',  sourceLabel: 'Derived', mappingType: 'derived', mono: true },
        { targetField: 'totalNetWeightLbs',  targetLabel: 'Total Net Wt (lbs)', sourceDoc: 'CALCULATED', sourceField: 'SUM(netWeightKgs) × 2.20462',   sourceLabel: 'Derived', mappingType: 'derived', validation: 'Net ≤ Gross', validationSeverity: 'critical', mono: true },
        { targetField: 'totalGrossWeightLbs', targetLabel: 'Total Gross Wt (lbs)', sourceDoc: 'CALCULATED', sourceField: 'SUM(grossWeightKgs) × 2.20462', sourceLabel: 'Derived', mappingType: 'derived', mono: true },
      ],
    },
    {
      sectionLabel: 'Signatures',
      renderAs: 'fields',
      mappings: [
        { targetField: 'receivedBy',      targetLabel: 'Received By',    sourceDoc: 'MANUAL', sourceField: 'manual', sourceLabel: 'Manual', mappingType: 'manual' },
        { targetField: 'receivedDate',    targetLabel: 'Receipt Date',   sourceDoc: 'MANUAL', sourceField: 'manual', sourceLabel: 'Manual', mappingType: 'manual', mono: true },
        { targetField: 'warehouseCode',   targetLabel: 'Warehouse Code', sourceDoc: 'MANUAL', sourceField: 'manual', sourceLabel: 'Manual', mappingType: 'manual', mono: true },
        { targetField: 'poReference',     targetLabel: 'PO Reference',   sourceDoc: 'MANUAL', sourceField: 'manual', sourceLabel: 'Manual', mappingType: 'manual', mono: true },
      ],
    },
  ],

  mockData: {
    fields: {
      plRef:            'KA/UM/2526/00773',
      plDate:           '27-Jan-2026',
      bolRef:           'COSU1234567890',
      buyerPoNo:        'J44CES25090019',
      exporterRef:      'ZW-EXP-25260084',
      grnDate:          '',
      shipperName:      'Exporter Co. — SS Division',
      shipperAddress:   'Survey No 133, Jigani Hobli, Bangalore 560105',
      consigneeName:    'Buyer Corporation Inc.',
      consigneeAddress: '1234 Commerce St, Los Angeles, CA 90001',
      notifyParty:      'Buyer Corporation Inc., Los Angeles, CA',
      threePlName:      '',
      threePlAddress:   '',
      vesselName:       'MV ESL DACHAN BAY',
      voyageNumber:     '0035W',
      portOfLoading:    'JNPT, Nhava Sheva',
      portOfDischarge:  'Los Angeles, CA',
      eta:              '26-Feb-2026',
      countryOfOrigin:  'India',
      incoterms:        'CFR Los Angeles',
      totalBundles:     'SUM(noOfBundles)',
      totalQty:         '5,600',
      totalNetWeightLbs: '—',
      totalGrossWeightLbs: '45,802 lbs',
      receivedBy: '', receivedDate: '', warehouseCode: '', poReference: '',
    },
    tables: {
      'Container Allocation': [
        { containerNo: 'TXGU5683192', sealNumber: 'SL12345678', containerType: '40ft HC', assignedItems: '', containerWt: '' },
        { containerNo: 'MSCU8812034', sealNumber: 'SL98765432', containerType: '40ft HC', assignedItems: '', containerWt: '' },
      ],
      'Line Items': [
        { hsnCode: '7308.90', productCode: 'ZT-MNT-34A', productDesc: 'Steel mounting rail 2100mm',       totalQtyInPcs: '1,248', noOfBundles: '13', netWeightKgs: '14,524.00', grossWeightKgs: '15,475.20', grossWeightLbs: '34,117 lbs' },
        { hsnCode: '7308.90', productCode: 'ZT-CLP-12',  productDesc: 'End clamp stainless 35mm',         totalQtyInPcs: '3,840', noOfBundles: '4',  netWeightKgs: '2,956.80',  grossWeightKgs: '3,148.80',  grossWeightLbs: '6,942 lbs'  },
        { hsnCode: '7308.90', productCode: 'ZT-PRL-58',  productDesc: 'Purlin bracket powder-coat steel', totalQtyInPcs: '512',   noOfBundles: '8',  netWeightKgs: '2,017.92',  grossWeightKgs: '2,150.40',  grossWeightLbs: '4,740 lbs'  },
      ],
    },
  },
};

// ─── Schema 3: Draft Bill of Entry ────────────────────────────────────────────

const DRAFT_BOE_SCHEMA: DocGenSchema = {
  docType:          'draft-boe',
  displayName:      'Draft BOE',
  triggerCondition: 'Bill of Lading + Sales Invoice both extracted and approved',
  sourceDocs: [
    { docType: 'BILL_OF_LADING', label: 'Bill of Lading' },
    { docType: 'SALES_INVOICE',  label: 'Sales Invoice' },
  ],
  humanAction:  'Review tariff lines, enter HTS codes, confirm duty rates',
  fieldCounts:  { auto: 28, calculated: 5, manual: 14, total: 47 },

  sections: [
    {
      sectionLabel: 'Entry Details',
      renderAs: 'fields',
      mappings: [
        { targetField: 'entryType',     targetLabel: 'Entry Type',       sourceDoc: 'MANUAL',         sourceField: 'manual',            sourceLabel: 'Manual',            mappingType: 'manual',     validation: 'Must match CBP entry type codes', validationSeverity: 'critical' },
        { targetField: 'portOfEntry',   targetLabel: 'Port of Entry',    sourceDoc: 'BILL_OF_LADING', sourceField: 'portOfDischarge',   sourceLabel: 'Port of Discharge', mappingType: 'contextual', transformation: 'Map port name to CBP port code via port-code-lookup table', mono: true },
        { targetField: 'entryDate',     targetLabel: 'Entry Date',       sourceDoc: 'MANUAL',         sourceField: 'manual',            sourceLabel: 'Manual',            mappingType: 'manual',     mono: true },
        { targetField: 'bondType',      targetLabel: 'Bond Type',        sourceDoc: 'MANUAL',         sourceField: 'manual',            sourceLabel: 'Manual',            mappingType: 'manual' },
        { targetField: 'importerEIN',   targetLabel: 'Importer EIN',     sourceDoc: 'MANUAL',         sourceField: 'manual',            sourceLabel: 'Manual',            mappingType: 'manual',     validation: 'Valid EIN format (##-#######)', validationSeverity: 'critical', mono: true },
      ],
    },
    {
      sectionLabel: 'Transport',
      renderAs: 'fields',
      mappings: [
        { targetField: 'vesselName',    targetLabel: 'Vessel Name',        sourceDoc: 'BILL_OF_LADING', sourceField: 'vesselName',           sourceLabel: 'Vessel Name',      mappingType: 'direct',  mono: true },
        { targetField: 'voyageNumber',  targetLabel: 'Voyage',             sourceDoc: 'BILL_OF_LADING', sourceField: 'vesselVoyageNumber',   sourceLabel: 'Voyage Number',    mappingType: 'direct',  mono: true },
        { targetField: 'portOfLoading', targetLabel: 'Port of Lading',     sourceDoc: 'BILL_OF_LADING', sourceField: 'portOfLoading',        sourceLabel: 'Port of Loading',  mappingType: 'direct' },
        { targetField: 'arrivalDate',   targetLabel: 'Arrival Date',       sourceDoc: 'BILL_OF_LADING', sourceField: 'shippedOnBoardDate',   sourceLabel: 'Ship on Board Date', mappingType: 'contextual', transformation: 'Estimate arrival via transit-time lookup; update when actual available', mono: true },
        { targetField: 'masterBol',     targetLabel: 'Master BOL',         sourceDoc: 'BILL_OF_LADING', sourceField: 'bolNumber',            sourceLabel: 'BOL Number',       mappingType: 'direct',  mono: true },
        { targetField: 'houseBol',      targetLabel: 'House BOL',          sourceDoc: 'BILL_OF_LADING', sourceField: 'exportShippingBillNumber', sourceLabel: 'Shipping Bill', mappingType: 'direct',  mono: true },
      ],
    },
    {
      sectionLabel: 'Importer',
      renderAs: 'fields',
      mappings: [
        { targetField: 'importerName',    targetLabel: 'Importer Name',    sourceDoc: 'BILL_OF_LADING', sourceField: 'consigneeName',    sourceLabel: 'Consignee Name',    mappingType: 'direct',     validation: 'NOT NULL', validationSeverity: 'critical' },
        { targetField: 'importerAddress', targetLabel: 'Importer Address', sourceDoc: 'BILL_OF_LADING', sourceField: 'consigneeAddress', sourceLabel: 'Consignee Address', mappingType: 'direct' },
        { targetField: 'importerContact', targetLabel: 'Contact',          sourceDoc: 'BILL_OF_LADING', sourceField: 'consigneeContactName', sourceLabel: 'Contact Name',  mappingType: 'direct' },
        { targetField: 'brokerFirm',      targetLabel: 'Customs Broker',   sourceDoc: 'MANUAL',         sourceField: 'manual',           sourceLabel: 'Manual',            mappingType: 'manual',     validation: 'Licensed CBP broker required', validationSeverity: 'warning' },
      ],
    },
    {
      sectionLabel: 'Origin & Manufacturer',
      renderAs: 'fields',
      mappings: [
        { targetField: 'countryOfOrigin',  targetLabel: 'Country of Origin', sourceDoc: 'BILL_OF_LADING', sourceField: 'countryOfOrigin', sourceLabel: 'Country of Origin', mappingType: 'direct',     validation: 'ISO 3166-1 alpha-2', validationSeverity: 'critical' },
        { targetField: 'manufacturerName', targetLabel: 'Manufacturer Name', sourceDoc: 'SALES_INVOICE',  sourceField: 'exporterName',    sourceLabel: 'Exporter Name',     mappingType: 'contextual', transformation: 'Map exporter name to registered manufacturer via manufacturer-registry lookup' },
        { targetField: 'manufacturerID',   targetLabel: 'Manufacturer ID',   sourceDoc: 'SALES_INVOICE',  sourceField: 'exporterName',    sourceLabel: 'Exporter Name',     mappingType: 'contextual', transformation: 'Look up MID code from manufacturer-registry table by exporter name + country', mono: true },
        { targetField: 'exporterGSTIN',    targetLabel: 'Exporter GSTIN',    sourceDoc: 'SALES_INVOICE',  sourceField: 'gstin',           sourceLabel: 'GSTIN',             mappingType: 'direct',     mono: true },
      ],
    },
    {
      sectionLabel: 'Steel Melt & Pour',
      renderAs: 'fields',
      condition: 'steelImport',
      mappings: [
        { targetField: 'meltCountry',       targetLabel: 'Country of Melt',  sourceDoc: 'MANUAL', sourceField: 'manual', sourceLabel: 'Manual', mappingType: 'manual', validation: 'Required for Section 232 steel — ISO country code', validationSeverity: 'critical' },
        { targetField: 'pourCountry',       targetLabel: 'Country of Pour',  sourceDoc: 'MANUAL', sourceField: 'manual', sourceLabel: 'Manual', mappingType: 'manual', validation: 'Required for Section 232 steel — ISO country code', validationSeverity: 'critical' },
        { targetField: 'certificationDate', targetLabel: 'Cert. Date',       sourceDoc: 'MANUAL', sourceField: 'manual', sourceLabel: 'Manual', mappingType: 'manual', mono: true },
        { targetField: 'certificationRef',  targetLabel: 'Cert. Reference',  sourceDoc: 'MANUAL', sourceField: 'manual', sourceLabel: 'Manual', mappingType: 'manual', mono: true },
      ],
    },
    {
      sectionLabel: 'Cargo',
      renderAs: 'fields',
      mappings: [
        { targetField: 'goodsDescription', targetLabel: 'Goods Description', sourceDoc: 'BILL_OF_LADING', sourceField: 'goodsDescription', sourceLabel: 'Goods Description', mappingType: 'direct' },
        { targetField: 'grossWeight',      targetLabel: 'Gross Weight',      sourceDoc: 'BILL_OF_LADING', sourceField: 'grossWeight',       sourceLabel: 'Gross Weight',      mappingType: 'direct',  mono: true },
        { targetField: 'netWeight',        targetLabel: 'Net Weight',        sourceDoc: 'BILL_OF_LADING', sourceField: 'netWeight',         sourceLabel: 'Net Weight',        mappingType: 'direct',  mono: true },
        { targetField: 'totalPackages',    targetLabel: 'Total Packages',    sourceDoc: 'BILL_OF_LADING', sourceField: 'totalPackages',     sourceLabel: 'Total Packages',    mappingType: 'direct',  mono: true },
        { targetField: 'containerCount',   targetLabel: 'Containers',        sourceDoc: 'BILL_OF_LADING', sourceField: 'totalContainers',   sourceLabel: 'Total Containers',  mappingType: 'direct',  mono: true },
        { targetField: 'measurementCbm',   targetLabel: 'Volume (CBM)',      sourceDoc: 'BILL_OF_LADING', sourceField: 'measurementCbm',    sourceLabel: 'Measurement CBM',   mappingType: 'direct',  mono: true },
      ],
    },
    {
      sectionLabel: 'Tariff Lines',
      renderAs: 'table',
      mappings: [
        { targetField: 'htsusCode',      targetLabel: 'HTSUS Code',        sourceDoc: 'MANUAL',        sourceField: 'manual',                       sourceLabel: 'Manual',           mappingType: 'manual',     validation: 'Valid 10-digit HTSUS code', validationSeverity: 'critical', mono: true, isLineItem: true },
        { targetField: 'lineDesc',       targetLabel: 'Description',       sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].productDescription', sourceLabel: 'Product Desc',    mappingType: 'direct',                                                                               isLineItem: true },
        { targetField: 'qty',            targetLabel: 'Qty',               sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].quantity',          sourceLabel: 'Quantity',         mappingType: 'direct',     mono: true, isLineItem: true },
        { targetField: 'qtyUnit',        targetLabel: 'Unit',              sourceDoc: 'MANUAL',        sourceField: 'manual',                        sourceLabel: 'Manual',           mappingType: 'manual',     isLineItem: true },
        { targetField: 'enteredValue',   targetLabel: 'Entered Value (USD)', sourceDoc: 'SALES_INVOICE', sourceField: 'lineItems[].unitPrice × qty', sourceLabel: 'Derived from SI', mappingType: 'derived',    transformation: 'unit price × quantity, converted to USD via exchange-rate lookup', mono: true, isLineItem: true },
        { targetField: 'dutyRate',       targetLabel: 'Duty Rate',         sourceDoc: 'CALCULATED',    sourceField: 'hts-duty-rate-lookup[htsusCode]', sourceLabel: 'HTS Lookup',    mappingType: 'contextual', transformation: 'Look up column 1 (general) duty rate from HTS schedule for htsusCode', mono: true, isLineItem: true },
        { targetField: 'calculatedDuty', targetLabel: 'Calculated Duty',   sourceDoc: 'CALCULATED',    sourceField: 'enteredValue × dutyRate',        sourceLabel: 'Derived',         mappingType: 'derived',    transformation: 'enteredValue × parsed duty rate', mono: true, isLineItem: true },
      ],
    },
    {
      sectionLabel: 'Duties & Fees',
      renderAs: 'fields',
      mappings: [
        { targetField: 'totalDutyAmount',   targetLabel: 'Total Duty',          sourceDoc: 'CALCULATED', sourceField: 'SUM(tariffLines.calculatedDuty)', sourceLabel: 'Derived', mappingType: 'derived', transformation: 'Sum of all calculated duties across tariff lines', mono: true },
        { targetField: 'section232Rate',    targetLabel: 'Section 232 Rate',    sourceDoc: 'CALCULATED', sourceField: 'section232-rate-lookup[htsusCode]', sourceLabel: 'Lookup', mappingType: 'contextual', transformation: 'Look up current Section 232 rate from trade-remedy-lookup table for commodity', mono: true },
        { targetField: 'section232Amount',  targetLabel: 'Section 232 Amount',  sourceDoc: 'CALCULATED', sourceField: 'totalEnteredValue × section232Rate', sourceLabel: 'Derived', mappingType: 'derived', transformation: 'totalEnteredValue × section232Rate', mono: true },
        { targetField: 'mpfAmount',         targetLabel: 'MPF',                 sourceDoc: 'CALCULATED', sourceField: '0.3464% of entered value (min $31.67, max $614.35)', sourceLabel: 'Derived', mappingType: 'derived', transformation: 'Merchandise Processing Fee — 0.3464% capped to CBP schedule', mono: true },
        { targetField: 'totalAmountDue',    targetLabel: 'Total Amount Due',    sourceDoc: 'CALCULATED', sourceField: 'duty + section232 + mpf',           sourceLabel: 'Derived', mappingType: 'derived', transformation: 'totalDuty + section232Amount + mpfAmount', validation: 'Must match CBP 7501 line 31', validationSeverity: 'critical', mono: true },
      ],
    },
    {
      sectionLabel: 'Broker',
      renderAs: 'fields',
      mappings: [
        { targetField: 'brokerFirmName',   targetLabel: 'Broker Firm',       sourceDoc: 'MANUAL', sourceField: 'manual', sourceLabel: 'Manual', mappingType: 'manual' },
        { targetField: 'brokerLicenseNo',  targetLabel: 'License No',        sourceDoc: 'MANUAL', sourceField: 'manual', sourceLabel: 'Manual', mappingType: 'manual', mono: true },
        { targetField: 'brokerSignatory',  targetLabel: 'Signatory',         sourceDoc: 'MANUAL', sourceField: 'manual', sourceLabel: 'Manual', mappingType: 'manual' },
        { targetField: 'signatureDate',    targetLabel: 'Signature Date',    sourceDoc: 'MANUAL', sourceField: 'manual', sourceLabel: 'Manual', mappingType: 'manual', mono: true },
      ],
    },
  ],

  mockData: {
    fields: {
      entryType:         '01 — Formal Consumption',
      portOfEntry:       'Los Angeles (2704)',
      entryDate:         '',
      bondType:          'Single Transaction',
      importerEIN:       '98-7654321',
      vesselName:        'MV ESL DACHAN BAY',
      voyageNumber:      '0035W',
      portOfLoading:     'JNPT, Nhava Sheva',
      arrivalDate:       '26-Feb-2026',
      masterBol:         'COSU1234567890',
      houseBol:          '9685801',
      importerName:      'Buyer Corporation Inc.',
      importerAddress:   '1234 Commerce St, Los Angeles, CA 90001',
      importerContact:   '',
      brokerFirm:        '',
      countryOfOrigin:   'IN',
      manufacturerName:  'Exporter Co. — SS Division',
      manufacturerID:    'IND-MFR-84721',
      exporterGSTIN:     '29AABCZ4521G1ZM',
      meltCountry:       '',
      pourCountry:       '',
      certificationDate: '',
      certificationRef:  '',
      goodsDescription:  'Stainless Steel Flat-Rolled Products — Cold-Rolled',
      grossWeight:       '97,873 kg',
      netWeight:         '95,240 kg',
      totalPackages:     '48',
      containerCount:    '2',
      measurementCbm:    '61.52 CBM',
      totalDutyAmount:   'SUM(tariffLines.calculatedDuty)',
      section232Rate:    '25% (active — trade-remedy-lookup)',
      section232Amount:  'totalEnteredValue × 25%',
      mpfAmount:         '0.3464% of entered value',
      totalAmountDue:    'duty + section232 + mpf',
      brokerFirmName:    '', brokerLicenseNo: '', brokerSignatory: '', signatureDate: '',
    },
    tables: {
      'Tariff Lines': [
        { htsusCode: '', lineDesc: 'Steel mounting rail 2100mm',       qty: '1,248', qtyUnit: '', enteredValue: '$19,300.80', dutyRate: '', calculatedDuty: '' },
        { htsusCode: '', lineDesc: 'End clamp stainless 35mm',         qty: '3,840', qtyUnit: '', enteredValue: '$29,491.20', dutyRate: '', calculatedDuty: '' },
        { htsusCode: '', lineDesc: 'Purlin bracket powder-coat steel',  qty: '512',   qtyUnit: '', enteredValue: '$7,372.80',  dutyRate: '', calculatedDuty: '' },
      ],
    },
  },
};

// ─── Master export ────────────────────────────────────────────────────────────

export const DOC_GEN_SCHEMAS: Record<string, DocGenSchema> = {
  'packing-list': PACKING_LIST_SCHEMA,
  'outward-pl':   OUTWARD_PL_SCHEMA,
  'draft-boe':    DRAFT_BOE_SCHEMA,
};
