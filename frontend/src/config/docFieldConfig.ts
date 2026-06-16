/**
 * EWMS Document Field Configuration
 * Maps each of the 18 document types to its field sections for the approval popup.
 * 
 * Usage:
 *   import { DOC_FIELD_CONFIG } from '@/config/docFieldConfig';
 *   const config = DOC_FIELD_CONFIG['SALES_INVOICE'];
 *   config.sections.forEach(section => { ... });
 * 
 * Each field has:
 *   - key: the Prisma model field name (camelCase)
 *   - label: human-readable label shown in the approval UI
 *   - mono?: true if the value should render in JetBrains Mono (IDs, numbers, amounts)
 *   - critical?: true if this field is used in cross-validation rules (highlighted in UI)
 */

// ---------------------------------------------------------------
// Types
// ---------------------------------------------------------------

export interface FieldDef {
  key: string;
  label: string;
  mono?: boolean;
  critical?: boolean;
}

export interface SectionDef {
  sectionLabel: string;
  fields: FieldDef[];
}

export interface DocTypeConfig {
  docType: string;
  displayName: string;
  shortCode: string;          // 2-letter badge code for DocBadge component
  geography: 'INDIA' | 'US' | 'BOTH';
  crossValidationRules: string[];  // rule codes e.g. ['V-INV-01','V-INV-02',...]
  sections: SectionDef[];
}

// ---------------------------------------------------------------
// 1. SALES INVOICE
// ---------------------------------------------------------------

const SALES_INVOICE: DocTypeConfig = {
  docType: 'SALES_INVOICE',
  displayName: 'Sales Invoice',
  shortCode: 'SI',
  geography: 'INDIA',
  crossValidationRules: ['V-INV-01', 'V-INV-02', 'V-INV-03', 'V-INV-04', 'V-INV-05'],
  sections: [
    {
      sectionLabel: 'Invoice Details',
      fields: [
        { key: 'invoiceNo', label: 'Invoice Number', mono: true, critical: true },
        { key: 'invoiceDate', label: 'Invoice Date', mono: true },
        { key: 'invoiceType', label: 'Invoice Type' },
        { key: 'issueDate', label: 'Issue Date', mono: true },
        { key: 'currency', label: 'Currency', mono: true },
        { key: 'irnNumber', label: 'IRN Number', mono: true },
      ],
    },
    {
      sectionLabel: 'Exporter',
      fields: [
        { key: 'exporterName', label: 'Exporter Name', critical: true },
        { key: 'exporterAddress', label: 'Exporter Address' },
        { key: 'exporterEmail', label: 'Email' },
        { key: 'gstin', label: 'GSTIN', mono: true },
        { key: 'panNo', label: 'PAN', mono: true },
        { key: 'iec', label: 'IEC Number', mono: true },
        { key: 'cinNo', label: 'CIN', mono: true },
        { key: 'adCode', label: 'AD Code', mono: true },
      ],
    },
    {
      sectionLabel: 'Buyer / Consignee',
      fields: [
        { key: 'buyerName', label: 'Buyer Name', critical: true },
        { key: 'buyerAddress', label: 'Buyer Address' },
        { key: 'consigneeName', label: 'Consignee Name', critical: true },
        { key: 'consigneeAddress', label: 'Consignee Address' },
        { key: 'notifyParty', label: 'Notify Party' },
        { key: 'shipTo', label: 'Ship To' },
      ],
    },
    {
      sectionLabel: 'Order Reference',
      fields: [
        { key: 'buyerPoNo', label: 'Buyer PO Number', mono: true, critical: true },
        { key: 'buyerPoDate', label: 'PO Date', mono: true },
        { key: 'zetwerkRef', label: 'Zetwerk Reference', mono: true },
        { key: 'otherReferences', label: 'Other References' },
      ],
    },
    {
      sectionLabel: 'Shipping',
      fields: [
        { key: 'portOfLoading', label: 'Port of Loading' },
        { key: 'portOfDischarge', label: 'Port of Discharge' },
        { key: 'countryOfOrigin', label: 'Country of Origin' },
        { key: 'countryOfFinalDestination', label: 'Final Destination Country' },
        { key: 'finalDestination', label: 'Final Destination' },
        { key: 'placeOfReceipt', label: 'Place of Receipt' },
        { key: 'vesselFlightNo', label: 'Vessel / Flight No' },
        { key: 'preCarriageBy', label: 'Pre-Carriage By' },
        { key: 'incoterms', label: 'Incoterms' },
        { key: 'shippingBillNo', label: 'Shipping Bill No', mono: true },
        { key: 'shippingBillDate', label: 'Shipping Bill Date', mono: true },
      ],
    },
    {
      sectionLabel: 'Financials',
      fields: [
        { key: 'taxableValue', label: 'Taxable Value', mono: true },
        { key: 'taxAmount', label: 'Tax Amount', mono: true },
        { key: 'cess', label: 'Cess', mono: true },
        { key: 'totalAmount', label: 'Total Amount', mono: true, critical: true },
        { key: 'grossWeight', label: 'Gross Weight', mono: true, critical: true },
        { key: 'totalQuantity', label: 'Total Quantity', mono: true, critical: true },
        { key: 'packageDescription', label: 'Package Description' },
        { key: 'marksAndNumbers', label: 'Marks & Numbers' },
      ],
    },
    {
      sectionLabel: 'Banking',
      fields: [
        { key: 'bankName', label: 'Bank Name' },
        { key: 'bankAccountNo', label: 'Account Number', mono: true },
        { key: 'bankBranch', label: 'Branch' },
        { key: 'ifscCode', label: 'IFSC Code', mono: true },
        { key: 'swiftCode', label: 'SWIFT Code', mono: true },
        { key: 'paymentTerms', label: 'Payment Terms' },
      ],
    },
    {
      sectionLabel: 'Signatory',
      fields: [
        { key: 'signatoryName', label: 'Signatory Name' },
        { key: 'signatoryDesignation', label: 'Designation' },
        { key: 'dinNumber', label: 'DIN Number', mono: true },
        { key: 'rotationNo', label: 'Rotation Number', mono: true },
        { key: 'lutArnNo', label: 'LUT/ARN Number', mono: true },
      ],
    },
    {
      sectionLabel: 'Digital Signature',
      fields: [
        { key: 'digitalSignatureDate', label: 'Signature Date', mono: true },
        { key: 'digitalSignatureLocation', label: 'Location' },
        { key: 'digitalSignatureStatus', label: 'Status' },
        { key: 'digitalSignatureTimestamp', label: 'Timestamp', mono: true },
      ],
    },
  ],
};

// ---------------------------------------------------------------
// 2. PACKING LIST
// ---------------------------------------------------------------

const PACKING_LIST: DocTypeConfig = {
  docType: 'PACKING_LIST',
  displayName: 'Packing List',
  shortCode: 'PL',
  geography: 'INDIA',
  crossValidationRules: ['V-PL-01', 'V-PL-02', 'V-PL-03', 'V-PL-04', 'V-PL-05'],
  sections: [
    {
      sectionLabel: 'Document Details',
      fields: [
        { key: 'invoiceNo', label: 'Invoice Number', mono: true, critical: true },
        { key: 'invoiceDate', label: 'Invoice Date', mono: true },
        { key: 'buyerPoNo', label: 'Buyer PO Number', mono: true, critical: true },
        { key: 'buyerPoDate', label: 'PO Date', mono: true },
        { key: 'zetwerkRef', label: 'Zetwerk Reference', mono: true },
        { key: 'otherReferences', label: 'Other References' },
      ],
    },
    {
      sectionLabel: 'Parties',
      fields: [
        { key: 'exporterName', label: 'Exporter', critical: true },
        { key: 'exporterAddress', label: 'Exporter Address' },
        { key: 'buyerName', label: 'Buyer' },
        { key: 'buyerAddress', label: 'Buyer Address' },
        { key: 'consigneeName', label: 'Consignee' },
        { key: 'consigneeAddress', label: 'Consignee Address' },
        { key: 'gstin', label: 'GSTIN', mono: true },
        { key: 'iec', label: 'IEC', mono: true },
        { key: 'shipTo', label: 'Ship To' },
        { key: 'pickupAddress', label: 'Pickup Address' },
      ],
    },
    {
      sectionLabel: 'Shipping',
      fields: [
        { key: 'portOfLoading', label: 'Port of Loading' },
        { key: 'portOfDischarge', label: 'Port of Discharge' },
        { key: 'countryOfOrigin', label: 'Country of Origin' },
        { key: 'countryOfFinalDestination', label: 'Final Destination Country' },
        { key: 'finalDestination', label: 'Final Destination' },
        { key: 'placeOfReceipt', label: 'Place of Receipt' },
        { key: 'vesselFlightNo', label: 'Vessel / Flight No' },
        { key: 'preCarriageBy', label: 'Pre-Carriage By' },
      ],
    },
    {
      sectionLabel: 'Totals',
      fields: [
        { key: 'totalBundles', label: 'Total Bundles', mono: true, critical: true },
        { key: 'totalQty', label: 'Total Quantity (pcs)', mono: true, critical: true },
        { key: 'totalNetWeightKgs', label: 'Net Weight (kg)', mono: true },
        { key: 'totalGrossWeightKgs', label: 'Gross Weight (kg)', mono: true },
      ],
    },
    {
      sectionLabel: 'Signatory',
      fields: [
        { key: 'signatoryName', label: 'Signatory Name' },
        { key: 'signatoryDesignation', label: 'Designation' },
        { key: 'dinNumber', label: 'DIN Number', mono: true },
        { key: 'signature', label: 'Signature Present' },
      ],
    },
  ],
};

// ---------------------------------------------------------------
// 3. BILL OF LADING
// ---------------------------------------------------------------

const BILL_OF_LADING: DocTypeConfig = {
  docType: 'BILL_OF_LADING',
  displayName: 'Bill of Lading',
  shortCode: 'BL',
  geography: 'BOTH',
  crossValidationRules: ['V-BOL-01', 'V-BOL-02', 'V-BOL-03', 'V-BOL-04', 'V-BOL-05', 'V-BOL-06', 'V-BOL-07', 'V-BOL-08'],
  sections: [
    {
      sectionLabel: 'BOL Details',
      fields: [
        { key: 'bolNumber', label: 'BOL Number', mono: true, critical: true },
        { key: 'shipmentReferenceNumber', label: 'Shipment Reference', mono: true },
        { key: 'negotiability', label: 'Negotiability' },
        { key: 'projectName', label: 'Project Name', critical: true },
        { key: 'documentCategory', label: 'Document Category' },
        { key: 'issuanceDate', label: 'Issuance Date', mono: true },
        { key: 'issuancePlace', label: 'Issuance Place' },
        { key: 'numberOfOriginals', label: 'Number of Originals', mono: true },
      ],
    },
    {
      sectionLabel: 'Carrier',
      fields: [
        { key: 'carrierCompanyName', label: 'Carrier Name' },
        { key: 'carrierMtoRegistrationNumber', label: 'MTO Registration', mono: true },
        { key: 'carrierFmcNumber', label: 'FMC Number', mono: true },
      ],
    },
    {
      sectionLabel: 'Shipper / Consignee',
      fields: [
        { key: 'shipperName', label: 'Shipper Name', critical: true },
        { key: 'shipperAddress', label: 'Shipper Address' },
        { key: 'consigneeName', label: 'Consignee Name', critical: true },
        { key: 'consigneeAddress', label: 'Consignee Address' },
        { key: 'consigneeContactName', label: 'Consignee Contact' },
        { key: 'consigneePhone', label: 'Phone', mono: true },
        { key: 'consigneeEmail', label: 'Email' },
        { key: 'notifyPartyName', label: 'Notify Party' },
        { key: 'notifyPartyAddress', label: 'Notify Address' },
        { key: 'secondNotifyName', label: 'Second Notify' },
        { key: 'deliveryAgentName', label: 'Delivery Agent' },
        { key: 'deliveryAgentAddress', label: 'Delivery Agent Address' },
      ],
    },
    {
      sectionLabel: 'Route',
      fields: [
        { key: 'placeOfAcceptance', label: 'Place of Acceptance' },
        { key: 'portOfLoading', label: 'Port of Loading' },
        { key: 'placeOfReceipt', label: 'Place of Receipt' },
        { key: 'countryOfOrigin', label: 'Country of Origin' },
        { key: 'portOfDischarge', label: 'Port of Discharge' },
        { key: 'finalDestination', label: 'Final Destination' },
        { key: 'placeOfDelivery', label: 'Place of Delivery' },
        { key: 'transhipmentPlace', label: 'Transhipment Place' },
      ],
    },
    {
      sectionLabel: 'Vessel',
      fields: [
        { key: 'vesselName', label: 'Vessel Name', critical: true },
        { key: 'vesselVoyageNumber', label: 'Voyage Number', mono: true },
        { key: 'shippedOnBoardDate', label: 'Shipped on Board Date', mono: true },
        { key: 'vesselCarrierName', label: 'Vessel Carrier' },
        { key: 'charterPartyDate', label: 'Charter Party Date', mono: true },
      ],
    },
    {
      sectionLabel: 'Cargo',
      fields: [
        { key: 'marksAndNumbers', label: 'Marks & Numbers' },
        { key: 'packageSummary', label: 'Package Summary' },
        { key: 'totalPackages', label: 'Total Packages', mono: true, critical: true },
        { key: 'totalContainers', label: 'Total Containers', mono: true },
        { key: 'goodsDescription', label: 'Goods Description' },
        { key: 'grossWeight', label: 'Gross Weight', mono: true, critical: true },
        { key: 'grossWeightUnit', label: 'Gross Weight Unit' },
        { key: 'netWeight', label: 'Net Weight', mono: true, critical: true },
        { key: 'netWeightUnit', label: 'Net Weight Unit' },
        { key: 'measurementCbm', label: 'Measurement (CBM)', mono: true },
        { key: 'usHsnc', label: 'US HS Code', mono: true },
        { key: 'iecNumber', label: 'IEC Number', mono: true },
      ],
    },
    {
      sectionLabel: 'Freight',
      fields: [
        { key: 'freightAmount', label: 'Freight Amount', mono: true },
        { key: 'freightPayableAt', label: 'Freight Payable At' },
        { key: 'freightType', label: 'Freight Type' },
        { key: 'fobCharges', label: 'FOB Charges', mono: true },
      ],
    },
    {
      sectionLabel: 'Export References',
      fields: [
        { key: 'exportInvoiceNumber', label: 'Export Invoice Number', mono: true, critical: true },
        { key: 'exportInvoiceDate', label: 'Export Invoice Date', mono: true },
        { key: 'exportShippingBillNumber', label: 'Shipping Bill Number', mono: true, critical: true },
        { key: 'exportShippingBillDate', label: 'Shipping Bill Date', mono: true },
        { key: 'shipsRemarks', label: 'Ships Remarks' },
      ],
    },
  ],
};

// ---------------------------------------------------------------
// 4. SHIPPING BILL
// ---------------------------------------------------------------

const SHIPPING_BILL: DocTypeConfig = {
  docType: 'SHIPPING_BILL',
  displayName: 'Shipping Bill',
  shortCode: 'SB',
  geography: 'INDIA',
  crossValidationRules: ['V-SB-01', 'V-SB-02', 'V-SB-03', 'V-SB-04', 'V-SB-05'],
  sections: [
    {
      sectionLabel: 'Shipping Bill Details',
      fields: [
        { key: 'sbNo', label: 'SB Number', mono: true, critical: true },
        { key: 'sbDate', label: 'SB Date', mono: true },
        { key: 'portCode', label: 'Port Code', mono: true },
        { key: 'portName', label: 'Port Name' },
        { key: 'iecBr', label: 'IEC/BR', mono: true },
        { key: 'gstinType', label: 'GSTIN Type' },
        { key: 'cbCode', label: 'CB Code', mono: true },
        { key: 'cbName', label: 'CB Name' },
        { key: 'leoNo', label: 'LEO Number', mono: true },
        { key: 'leoDate', label: 'LEO Date', mono: true },
        { key: 'rotnNoDate', label: 'Rotation No/Date', mono: true },
      ],
    },
    {
      sectionLabel: 'Parties',
      fields: [
        { key: 'exporterNameAddress', label: 'Exporter', critical: true },
        { key: 'consigneeNameAddress', label: 'Consignee', critical: true },
      ],
    },
    {
      sectionLabel: 'Shipping',
      fields: [
        { key: 'vesselName', label: 'Vessel Name' },
        { key: 'portOfLoading', label: 'Port of Loading', critical: true },
        { key: 'portOfDischarge', label: 'Port of Discharge' },
        { key: 'countryOfFinalDest', label: 'Country of Final Destination' },
      ],
    },
    {
      sectionLabel: 'Cargo Summary',
      fields: [
        { key: 'grossWeightKgs', label: 'Gross Weight (kg)', mono: true },
        { key: 'pkgCount', label: 'Package Count', mono: true, critical: true },
        { key: 'invCount', label: 'Invoice Count', mono: true },
        { key: 'itemCount', label: 'Item Count', mono: true },
        { key: 'contCount', label: 'Container Count', mono: true },
      ],
    },
    {
      sectionLabel: 'Value Summary',
      fields: [
        { key: 'sectionCValueSummaryFobValue', label: 'FOB Value', mono: true, critical: true },
        { key: 'sectionCValueSummaryFreight', label: 'Freight', mono: true },
        { key: 'sectionCValueSummaryInsurance', label: 'Insurance', mono: true },
        { key: 'sectionCValueSummaryIgstAmt', label: 'IGST Amount', mono: true },
        { key: 'sectionCValueSummaryDbkClaim', label: 'Drawback Claim', mono: true },
      ],
    },
  ],
};

// ---------------------------------------------------------------
// 5. CHA BILL
// ---------------------------------------------------------------

const CHA_BILL: DocTypeConfig = {
  docType: 'CHA_BILL',
  displayName: 'CHA Bill',
  shortCode: 'CH',
  geography: 'INDIA',
  crossValidationRules: ['V-CHA-01', 'V-CHA-02', 'V-CHA-03', 'V-CHA-04'],
  sections: [
    {
      sectionLabel: 'Invoice Details',
      fields: [
        { key: 'invoiceNumber', label: 'Invoice Number', mono: true },
        { key: 'invoiceDate', label: 'Invoice Date', mono: true },
        { key: 'dueDate', label: 'Due Date', mono: true },
        { key: 'paymentTerms', label: 'Payment Terms' },
        { key: 'documentType', label: 'Document Type' },
        { key: 'taxType', label: 'Tax Type' },
        { key: 'copyType', label: 'Copy Type' },
      ],
    },
    {
      sectionLabel: 'Issuer',
      fields: [
        { key: 'issuerCompanyName', label: 'Company Name' },
        { key: 'issuerAddress', label: 'Address' },
        { key: 'issuerGstin', label: 'GSTIN', mono: true },
        { key: 'issuerPan', label: 'PAN', mono: true },
        { key: 'issuerCin', label: 'CIN', mono: true },
        { key: 'issuerPhone', label: 'Phone', mono: true },
        { key: 'issuerEmail', label: 'Email' },
        { key: 'issuerStateCode', label: 'State Code', mono: true },
      ],
    },
    {
      sectionLabel: 'Customer',
      fields: [
        { key: 'customerName', label: 'Customer Name' },
        { key: 'customerAddress', label: 'Address' },
        { key: 'customerGstin', label: 'GSTIN', mono: true },
        { key: 'customerPan', label: 'PAN', mono: true },
        { key: 'customerStateCode', label: 'State Code', mono: true },
        { key: 'customerPlaceOfSupply', label: 'Place of Supply' },
        { key: 'customerShipmentNumber', label: 'Shipment Number', mono: true },
      ],
    },
    {
      sectionLabel: 'Shipment',
      fields: [
        { key: 'shipmentShipper', label: 'Shipper', critical: true },
        { key: 'shipmentConsignee', label: 'Consignee', critical: true },
        { key: 'shipmentVesselName', label: 'Vessel Name', critical: true },
        { key: 'shipmentMbl', label: 'Master BL', mono: true },
        { key: 'shipmentHbl', label: 'House BL', mono: true },
        { key: 'shipmentGrossWeight', label: 'Gross Weight', mono: true },
        { key: 'shipmentGrossWeightUnit', label: 'Weight Unit' },
        { key: 'shipmentPackages', label: 'Packages', mono: true },
        { key: 'shipmentOrigin', label: 'Origin' },
        { key: 'shipmentDestination', label: 'Destination' },
        { key: 'shipmentEtd', label: 'ETD', mono: true },
        { key: 'shipmentEta', label: 'ETA', mono: true },
        { key: 'shipmentIncoterm', label: 'Incoterm' },
        { key: 'shipmentOrderReference', label: 'Order Reference', mono: true },
        { key: 'shipmentGoodsDescription', label: 'Goods Description' },
      ],
    },
    {
      sectionLabel: 'Job Details',
      fields: [
        { key: 'jobNumber', label: 'Job Number', mono: true },
        { key: 'jobDate', label: 'Job Date', mono: true },
        { key: 'jobProjectName', label: 'Project Name' },
        { key: 'jobPolPod', label: 'POL / POD' },
        { key: 'jobPreparedBy', label: 'Prepared By' },
        { key: 'jobApprovedBy', label: 'Approved By' },
        { key: 'bookingNumber', label: 'Booking Number', mono: true },
      ],
    },
    {
      sectionLabel: 'Financials',
      fields: [
        { key: 'totalsSubtotal', label: 'Subtotal', mono: true },
        { key: 'totalsIgstAmount', label: 'IGST Amount', mono: true },
        { key: 'totalsCgstAmount', label: 'CGST Amount', mono: true },
        { key: 'totalsSgstAmount', label: 'SGST Amount', mono: true },
        { key: 'totalsGrandTotalInr', label: 'Grand Total (INR)', mono: true },
        { key: 'totalsAmountInWords', label: 'Amount in Words' },
      ],
    },
    {
      sectionLabel: 'IRN / QR Verification',
      fields: [
        { key: 'irn', label: 'IRN', mono: true },
        { key: 'irnAckNumber', label: 'IRN Ack Number', mono: true },
        { key: 'irnAckTime', label: 'IRN Ack Time', mono: true },
        { key: 'qrSellerGstin', label: 'QR Seller GSTIN', mono: true },
        { key: 'qrBuyerGstin', label: 'QR Buyer GSTIN', mono: true },
        { key: 'qrDocNo', label: 'QR Doc Number', mono: true },
        { key: 'qrTotalInvValue', label: 'QR Total Value', mono: true },
        { key: 'qrIrn', label: 'QR IRN', mono: true },
      ],
    },
  ],
};

// ---------------------------------------------------------------
// 6. FREIGHT FORWARDER BILL
// ---------------------------------------------------------------

const FREIGHT_FORWARDER_BILL: DocTypeConfig = {
  docType: 'FREIGHT_FORWARDER_BILL',
  displayName: 'Freight Forwarder Bill',
  shortCode: 'FF',
  geography: 'INDIA',
  crossValidationRules: ['V-FF-01', 'V-FF-02', 'V-FF-03', 'V-FF-04', 'V-FF-05', 'V-FF-06', 'V-FF-07', 'V-FF-08'],
  sections: [
    {
      sectionLabel: 'Invoice Details',
      fields: [
        { key: 'invoiceNumber', label: 'Invoice Number', mono: true },
        { key: 'invoiceDate', label: 'Invoice Date', mono: true },
        { key: 'currency', label: 'Currency', mono: true },
        { key: 'dueDate', label: 'Due Date', mono: true },
        { key: 'paymentTerms', label: 'Payment Terms' },
        { key: 'irn', label: 'IRN', mono: true },
        { key: 'irnAckNumber', label: 'IRN Ack Number', mono: true },
        { key: 'documentVariant', label: 'Document Variant' },
      ],
    },
    {
      sectionLabel: 'Issuer',
      fields: [
        { key: 'issuerCompanyName', label: 'Company Name' },
        { key: 'issuerAddress', label: 'Address' },
        { key: 'issuerGstNumber', label: 'GST Number', mono: true },
        { key: 'issuerPanNumber', label: 'PAN', mono: true },
        { key: 'issuerCinNumber', label: 'CIN', mono: true },
      ],
    },
    {
      sectionLabel: 'Customer',
      fields: [
        { key: 'customerName', label: 'Customer Name' },
        { key: 'customerAddress', label: 'Address' },
        { key: 'customerGstNumber', label: 'GST', mono: true },
      ],
    },
    {
      sectionLabel: 'Shipment',
      fields: [
        { key: 'shipper', label: 'Shipper', critical: true },
        { key: 'consignee', label: 'Consignee', critical: true },
        { key: 'vesselName', label: 'Vessel Name' },
        { key: 'voyageNumber', label: 'Voyage', mono: true },
        { key: 'oceanBol', label: 'Ocean BOL', mono: true, critical: true },
        { key: 'houseBol', label: 'House BOL', mono: true, critical: true },
        { key: 'loadingPort', label: 'Loading Port' },
        { key: 'dischargingPort', label: 'Discharge Port' },
        { key: 'etd', label: 'ETD', mono: true },
        { key: 'eta', label: 'ETA', mono: true },
        { key: 'projectName', label: 'Project Name', critical: true },
        { key: 'orderReference', label: 'Order Reference', mono: true },
        { key: 'sbNumbers', label: 'SB Numbers', mono: true, critical: true },
        { key: 'customerInvoiceNumbers', label: 'Invoice Numbers', mono: true, critical: true },
      ],
    },
    {
      sectionLabel: 'Cargo',
      fields: [
        { key: 'cargoGrossWeightKg', label: 'Gross Weight (kg)', mono: true, critical: true },
        { key: 'cargoNetWeightKg', label: 'Net Weight (kg)', mono: true },
        { key: 'cargoVolumeCbm', label: 'Volume (CBM)', mono: true },
        { key: 'cargoNumPackages', label: 'Packages', mono: true },
        { key: 'containersTotalCount', label: 'Container Count', mono: true, critical: true },
        { key: 'goodsDescription', label: 'Goods Description' },
      ],
    },
    {
      sectionLabel: 'Financials',
      fields: [
        { key: 'subtotalInr', label: 'Subtotal (INR)', mono: true },
        { key: 'igstAmount', label: 'IGST', mono: true },
        { key: 'totalInr', label: 'Total (INR)', mono: true },
        { key: 'netPayable', label: 'Net Payable', mono: true },
        { key: 'amountInWords', label: 'Amount in Words' },
      ],
    },
  ],
};

// ---------------------------------------------------------------
// 7. OCEAN FREIGHT INVOICE
// ---------------------------------------------------------------

const OCEAN_FREIGHT: DocTypeConfig = {
  docType: 'OCEAN_FREIGHT',
  displayName: 'Ocean Freight Invoice',
  shortCode: 'OF',
  geography: 'INDIA',
  crossValidationRules: ['V-OF-01', 'V-OF-02', 'V-OF-03', 'V-OF-04', 'V-OF-05'],
  sections: [
    {
      sectionLabel: 'Invoice Details',
      fields: [
        { key: 'invoiceNumber', label: 'Invoice Number', mono: true },
        { key: 'invoiceDate', label: 'Invoice Date', mono: true },
        { key: 'dueDate', label: 'Due Date', mono: true },
        { key: 'paymentTerms', label: 'Payment Terms' },
        { key: 'irn', label: 'IRN', mono: true },
        { key: 'shipmentNumber', label: 'Shipment Number', mono: true },
      ],
    },
    {
      sectionLabel: 'Issuer',
      fields: [
        { key: 'issuerCompanyName', label: 'Company' },
        { key: 'issuerAddress', label: 'Address' },
        { key: 'issuerGstNumber', label: 'GST', mono: true },
      ],
    },
    {
      sectionLabel: 'Shipment',
      fields: [
        { key: 'vesselName', label: 'Vessel Name', critical: true },
        { key: 'voyageNumber', label: 'Voyage', mono: true },
        { key: 'loadingPort', label: 'Loading Port', critical: true },
        { key: 'dischargingPort', label: 'Discharge Port' },
        { key: 'oceanBol', label: 'Ocean BOL', mono: true, critical: true },
        { key: 'houseBol', label: 'House BOL', mono: true },
        { key: 'etd', label: 'ETD', mono: true },
        { key: 'eta', label: 'ETA', mono: true },
        { key: 'projectName', label: 'Project Name' },
      ],
    },
    {
      sectionLabel: 'Cargo',
      fields: [
        { key: 'cargoWeightKg', label: 'Weight (kg)', mono: true, critical: true },
        { key: 'cargoVolumeCbm', label: 'Volume (CBM)', mono: true },
        { key: 'cargoNumPackages', label: 'Packages', mono: true },
        { key: 'containersTotalCount', label: 'Container Count', mono: true, critical: true },
        { key: 'goodsDescription', label: 'Goods Description' },
      ],
    },
    {
      sectionLabel: 'Financials',
      fields: [
        { key: 'subtotalUsd', label: 'Subtotal (USD)', mono: true },
        { key: 'totalUsd', label: 'Total (USD)', mono: true },
        { key: 'amountInWords', label: 'Amount in Words' },
      ],
    },
  ],
};

// ---------------------------------------------------------------
// 8. ENTRY SUMMARY (BOE)
// ---------------------------------------------------------------

const ENTRY_SUMMARY: DocTypeConfig = {
  docType: 'ENTRY_SUMMARY',
  displayName: 'Entry Summary (BOE)',
  shortCode: 'BE',
  geography: 'US',
  crossValidationRules: ['V-BOE-01', 'V-BOE-02', 'V-BOE-03', 'V-BOE-04', 'V-BOE-05', 'V-BOE-06', 'V-BOE-07', 'V-BOE-08'],
  sections: [
    {
      sectionLabel: 'Entry Details',
      fields: [
        { key: 'filerCodeEntryNumber', label: 'Entry Number', mono: true, critical: true },
        { key: 'entryType', label: 'Entry Type' },
        { key: 'entryDate', label: 'Entry Date', mono: true },
        { key: 'summaryDate', label: 'Summary Date', mono: true },
        { key: 'summaryStatus', label: 'Summary Status' },
        { key: 'portCode', label: 'Port Code', mono: true },
        { key: 'suretyNumber', label: 'Surety Number', mono: true },
        { key: 'bondType', label: 'Bond Type' },
      ],
    },
    {
      sectionLabel: 'Transport',
      fields: [
        { key: 'importingCarrier', label: 'Importing Carrier' },
        { key: 'modeOfTransport', label: 'Mode of Transport' },
        { key: 'importDate', label: 'Import Date', mono: true },
        { key: 'blOrAwbNumber', label: 'BL/AWB Number', mono: true, critical: true },
        { key: 'additionalBLs', label: 'Additional BLs', mono: true, critical: true },
        { key: 'houseBill', label: 'House Bill', mono: true },
        { key: 'foreignPortOfLading', label: 'Foreign Port of Lading' },
        { key: 'usPortOfUnlading', label: 'US Port of Unlading', critical: true },
      ],
    },
    {
      sectionLabel: 'Importer',
      fields: [
        { key: 'importerOfRecordName', label: 'Importer of Record', critical: true },
        { key: 'importerOfRecordAddress', label: 'Address' },
        { key: 'importerNumber', label: 'Importer Number', mono: true },
        { key: 'ultimateConsigneeName', label: 'Ultimate Consignee' },
        { key: 'ultimateConsigneeAddress', label: 'Address' },
      ],
    },
    {
      sectionLabel: 'Origin / Manufacturer',
      fields: [
        { key: 'countryOfOrigin', label: 'Country of Origin' },
        { key: 'exportingCountry', label: 'Exporting Country' },
        { key: 'exportDate', label: 'Export Date', mono: true },
        { key: 'manufacturerId', label: 'Manufacturer ID', mono: true, critical: true },
        { key: 'billQty', label: 'Bill Quantity', mono: true },
        { key: 'billQtyUnit', label: 'Quantity Unit' },
      ],
    },
    {
      sectionLabel: 'Steel Melt & Pour (Section 232)',
      fields: [
        { key: 'countryOfMeltAndPour', label: 'Country of Melt & Pour' },
        { key: 'primaryCountryOfSmelt', label: 'Primary Smelt Country' },
        { key: 'secondaryCountryOfSmelt', label: 'Secondary Smelt Country' },
        { key: 'countryOfCast', label: 'Country of Cast' },
      ],
    },
    {
      sectionLabel: 'Cargo',
      fields: [
        { key: 'totalPackages', label: 'Total Packages', mono: true, critical: true },
        { key: 'totalEnteredValue', label: 'Total Entered Value', mono: true, critical: true },
        { key: 'locationOfGoods', label: 'Location of Goods' },
      ],
    },
    {
      sectionLabel: 'Duties & Fees',
      fields: [
        { key: 'totalDuty', label: 'Total Duty', mono: true },
        { key: 'totalTax', label: 'Total Tax', mono: true },
        { key: 'mpfTotal', label: 'MPF Total', mono: true },
        { key: 'hmfTotal', label: 'HMF Total', mono: true },
        { key: 'totalOtherFees', label: 'Other Fees', mono: true },
        { key: 'totalOther', label: 'Total Other', mono: true },
        { key: 'grandTotal', label: 'Grand Total', mono: true },
      ],
    },
    {
      sectionLabel: 'Broker / Declarant',
      fields: [
        { key: 'brokerName', label: 'Broker Name' },
        { key: 'brokerAddress', label: 'Broker Address' },
        { key: 'brokerPhone', label: 'Phone', mono: true },
        { key: 'declarantName', label: 'Declarant Name' },
        { key: 'declarantCompany', label: 'Declarant Company' },
        { key: 'declarantDate', label: 'Declaration Date', mono: true },
      ],
    },
  ],
};

// ---------------------------------------------------------------
// 9. CUSTOMER BROKER BILL
// ---------------------------------------------------------------

const CUSTOMER_BROKER_BILL: DocTypeConfig = {
  docType: 'CUSTOMER_BROKER_BILL',
  displayName: 'US Customs Broker Bill',
  shortCode: 'BB',
  geography: 'US',
  crossValidationRules: [],
  sections: [
    {
      sectionLabel: 'Invoice',
      fields: [
        { key: 'invoiceNumber', label: 'Invoice Number', mono: true },
        { key: 'invoiceDate', label: 'Invoice Date', mono: true },
        { key: 'dueDate', label: 'Due Date', mono: true },
        { key: 'paymentTerms', label: 'Payment Terms' },
      ],
    },
    {
      sectionLabel: 'Parties',
      fields: [
        { key: 'billTo', label: 'Bill To' },
        { key: 'billToAddress', label: 'Bill To Address' },
        { key: 'shipper', label: 'Shipper' },
        { key: 'consignee', label: 'Consignee' },
      ],
    },
    {
      sectionLabel: 'Shipment',
      fields: [
        { key: 'vesselVoyage', label: 'Vessel / Voyage' },
        { key: 'origin', label: 'Origin' },
        { key: 'destination', label: 'Destination' },
        { key: 'oceanBol', label: 'Ocean BOL', mono: true },
        { key: 'houseBol', label: 'House BOL', mono: true },
        { key: 'bookingNumber', label: 'Booking', mono: true },
        { key: 'entryNumber', label: 'Entry Number', mono: true },
        { key: 'declarationNumber', label: 'Declaration', mono: true },
        { key: 'containers', label: 'Containers', mono: true },
        { key: 'poNumberProjectReference', label: 'PO / Project', mono: true },
        { key: 'supplierInvoiceNumbers', label: 'Supplier Invoices', mono: true },
      ],
    },
    {
      sectionLabel: 'Financials',
      fields: [
        { key: 'subtotal', label: 'Subtotal', mono: true },
        { key: 'totalAmount', label: 'Total Amount', mono: true },
      ],
    },
  ],
};

// ---------------------------------------------------------------
// 10. GRN INBOUND
// ---------------------------------------------------------------

const GRN_INBOUND: DocTypeConfig = {
  docType: 'GRN_INBOUND',
  displayName: 'GRN Inbound (3PL)',
  shortCode: 'GR',
  geography: 'US',
  crossValidationRules: [],
  sections: [
    {
      sectionLabel: 'Receipt Details',
      fields: [
        { key: 'documentType', label: 'Document Type' },
        { key: 'logisticsProvider', label: 'Logistics Provider' },
        { key: 'accountName', label: 'Account Name' },
        { key: 'dateReceived', label: 'Date Received', mono: true },
        { key: 'location', label: 'Location' },
        { key: 'receivedBy', label: 'Received By' },
      ],
    },
    {
      sectionLabel: 'Container',
      fields: [
        { key: 'containerNumber', label: 'Container Number', mono: true },
        { key: 'containerSize', label: 'Size' },
        { key: 'containerType', label: 'Type' },
        { key: 'sealNumber', label: 'Seal Number', mono: true },
      ],
    },
    {
      sectionLabel: 'References',
      fields: [
        { key: 'truckingCo', label: 'Trucking Company' },
        { key: 'freightBillNumber', label: 'Freight Bill', mono: true },
        { key: 'brokerReference', label: 'Broker Reference', mono: true },
        { key: 'customerReference', label: 'Customer Reference', mono: true },
        { key: 'rateQuoteNumber', label: 'Rate Quote', mono: true },
      ],
    },
    {
      sectionLabel: 'Cargo',
      fields: [
        { key: 'totalPieces', label: 'Total Pieces', mono: true },
        { key: 'typeOfPackaging', label: 'Packaging Type' },
        { key: 'totalPartsCount', label: 'Parts Count', mono: true },
        { key: 'weight', label: 'Weight', mono: true },
        { key: 'dimensions', label: 'Dimensions' },
        { key: 'numberOfPallets', label: 'Pallets', mono: true },
        { key: 'floorLoaded', label: 'Floor Loaded' },
        { key: 'palletizedCargo', label: 'Palletized' },
      ],
    },
  ],
};

// ---------------------------------------------------------------
// 11-18. REMAINING DOCUMENT TYPES (abbreviated)
// ---------------------------------------------------------------

const PORT_TO_WH: DocTypeConfig = {
  docType: 'PORT_TO_WH',
  displayName: 'Port to Warehouse Bill',
  shortCode: 'PW',
  geography: 'US',
  crossValidationRules: [],
  sections: [
    {
      sectionLabel: 'Bill Details',
      fields: [
        { key: 'invoice', label: 'Invoice', mono: true },
        { key: 'invoiceDate', label: 'Invoice Date', mono: true },
        { key: 'dueDate', label: 'Due Date', mono: true },
        { key: 'paymentTerms', label: 'Payment Terms' },
        { key: 'vendor', label: 'Vendor' },
      ],
    },
    {
      sectionLabel: 'Shipment',
      fields: [
        { key: 'shipmentId', label: 'Shipment ID', mono: true },
        { key: 'orderNumber', label: 'Order Number', mono: true },
        { key: 'customerReferenceNumber', label: 'Customer Ref', mono: true },
        { key: 'mbl', label: 'Master BL', mono: true },
        { key: 'containerNumber', label: 'Container', mono: true },
        { key: 'containerType', label: 'Container Type' },
      ],
    },
    {
      sectionLabel: 'Route',
      fields: [
        { key: 'pickupLocation', label: 'Pickup Location' },
        { key: 'pickupDate', label: 'Pickup Date', mono: true },
        { key: 'deliveryLocation', label: 'Delivery Location' },
        { key: 'deliveryDate', label: 'Delivery Date', mono: true },
      ],
    },
    {
      sectionLabel: 'Financials',
      fields: [
        { key: 'weightLbs', label: 'Weight (lbs)', mono: true },
        { key: 'subtotal', label: 'Subtotal', mono: true },
        { key: 'tax1', label: 'Tax 1', mono: true },
        { key: 'tax2', label: 'Tax 2', mono: true },
        { key: 'totalCharge', label: 'Total Charge', mono: true },
      ],
    },
  ],
};

const WH_TO_CUSTOMER: DocTypeConfig = {
  docType: 'WH_TO_CUSTOMER',
  displayName: 'Warehouse to Customer Bill',
  shortCode: 'WC',
  geography: 'US',
  crossValidationRules: [],
  sections: [
    {
      sectionLabel: 'Bill Details',
      fields: [
        { key: 'invoiceNumber', label: 'Invoice Number', mono: true },
        { key: 'invoiceDate', label: 'Invoice Date', mono: true },
        { key: 'dueDate', label: 'Due Date', mono: true },
        { key: 'vendor', label: 'Vendor' },
        { key: 'poNumber', label: 'PO Number', mono: true },
        { key: 'shipmentNumber', label: 'Shipment Number', mono: true },
      ],
    },
    {
      sectionLabel: 'Parties',
      fields: [
        { key: 'shipper', label: 'Shipper' },
        { key: 'consignee', label: 'Consignee' },
        { key: 'billTo', label: 'Bill To' },
      ],
    },
    {
      sectionLabel: 'Route',
      fields: [
        { key: 'departureLocation', label: 'Departure' },
        { key: 'destinationLocation', label: 'Destination' },
        { key: 'pickupDate', label: 'Pickup Date', mono: true },
        { key: 'deliveryDate', label: 'Delivery Date', mono: true },
      ],
    },
    {
      sectionLabel: 'Cargo & Financials',
      fields: [
        { key: 'weightLbs', label: 'Weight (lbs)', mono: true },
        { key: 'volumeFt3', label: 'Volume (ft3)', mono: true },
        { key: 'piecesUnits', label: 'Pieces / Units', mono: true },
        { key: 'totalAmount', label: 'Total Amount', mono: true },
      ],
    },
  ],
};

const US_SALES_INVOICE: DocTypeConfig = {
  docType: 'US_SALES_INVOICE',
  displayName: 'US Sales Invoice',
  shortCode: 'UI',
  geography: 'US',
  crossValidationRules: [],
  sections: [
    {
      sectionLabel: 'Invoice',
      fields: [
        { key: 'invoiceNo', label: 'Invoice Number', mono: true },
        { key: 'date', label: 'Date', mono: true },
        { key: 'soNo', label: 'SO Number', mono: true },
        { key: 'poNo', label: 'PO Number', mono: true },
        { key: 'paymentTerms', label: 'Payment Terms' },
      ],
    },
    {
      sectionLabel: 'Seller',
      fields: [
        { key: 'sellerCompany', label: 'Company' },
        { key: 'sellerStreet', label: 'Address' },
        { key: 'sellerCity', label: 'City' },
        { key: 'sellerState', label: 'State' },
        { key: 'sellerCountry', label: 'Country' },
      ],
    },
    {
      sectionLabel: 'Ship To',
      fields: [
        { key: 'shipToCompany', label: 'Company' },
        { key: 'shipToStreet', label: 'Address' },
        { key: 'shipToCity', label: 'City' },
        { key: 'shipToState', label: 'State' },
      ],
    },
    {
      sectionLabel: 'Financials',
      fields: [
        { key: 'salesSubtotal', label: 'Subtotal', mono: true },
        { key: 'totalDiscount', label: 'Discount', mono: true },
        { key: 'totalCharges', label: 'Charges', mono: true },
        { key: 'netAmount', label: 'Net Amount', mono: true },
        { key: 'salesTax', label: 'Sales Tax', mono: true },
        { key: 'total', label: 'Total', mono: true },
        { key: 'balanceDue', label: 'Balance Due', mono: true },
      ],
    },
  ],
};

const US_CARGO_RELEASE: DocTypeConfig = {
  docType: 'US_CARGO_RELEASE_ORDER',
  displayName: 'US Cargo Release Order',
  shortCode: 'CR',
  geography: 'US',
  crossValidationRules: [],
  sections: [
    {
      sectionLabel: 'Release Details',
      fields: [
        { key: 'customsBroker', label: 'Customs Broker' },
        { key: 'brokerReferenceNumber', label: 'Broker Ref', mono: true },
        { key: 'releasePort', label: 'Release Port' },
        { key: 'entryNumber', label: 'Entry Number', mono: true },
        { key: 'portUnlading', label: 'Port of Unlading' },
        { key: 'statementPrintDate', label: 'Statement Date', mono: true },
      ],
    },
    {
      sectionLabel: 'Transport',
      fields: [
        { key: 'masterBillOfLading', label: 'Master BL', mono: true },
        { key: 'houseBill1And2', label: 'House Bills', mono: true },
        { key: 'scac', label: 'SCAC Code', mono: true },
        { key: 'truckVesselFlight', label: 'Truck/Vessel/Flight' },
        { key: 'itNumber', label: 'IT Number', mono: true },
      ],
    },
    {
      sectionLabel: 'Importer',
      fields: [
        { key: 'importerAndConsignee', label: 'Importer / Consignee' },
        { key: 'importerAndConsigneeAddress', label: 'Address' },
      ],
    },
  ],
};

const US_CUSTOMS_RELEASE: DocTypeConfig = {
  docType: 'US_CUSTOMS_RELEASE_ORDER',
  displayName: 'US Customs Release Order',
  shortCode: 'CU',
  geography: 'US',
  crossValidationRules: [],
  sections: [
    {
      sectionLabel: 'Entry',
      fields: [
        { key: 'entryNumber', label: 'Entry Number', mono: true },
        { key: 'entryType', label: 'Entry Type' },
        { key: 'portOfEntry', label: 'Port of Entry' },
        { key: 'portOfUnlading', label: 'Port of Unlading' },
        { key: 'bondType', label: 'Bond Type' },
        { key: 'bondValue', label: 'Bond Value', mono: true },
        { key: 'suretyCode', label: 'Surety Code', mono: true },
      ],
    },
    {
      sectionLabel: 'Importer',
      fields: [
        { key: 'importerNameAndAddress', label: 'Importer' },
        { key: 'importerNumber', label: 'Importer Number', mono: true },
        { key: 'consigneeBuyingParty', label: 'Consignee / Buying Party' },
        { key: 'manufacturer', label: 'Manufacturer' },
      ],
    },
    {
      sectionLabel: 'Cargo',
      fields: [
        { key: 'grossWeight', label: 'Gross Weight', mono: true },
        { key: 'totalUnits', label: 'Total Units', mono: true },
        { key: 'containers', label: 'Containers', mono: true },
        { key: 'billOfLadingInformation', label: 'BOL Information', mono: true },
        { key: 'locationOfGoodsFirms', label: 'Location / FIRMS' },
      ],
    },
  ],
};

const US_DELIVERY_ORDER: DocTypeConfig = {
  docType: 'US_DELIVERY_ORDER',
  displayName: 'US Delivery Order',
  shortCode: 'DO',
  geography: 'US',
  crossValidationRules: [],
  sections: [
    {
      sectionLabel: 'Delivery Order',
      fields: [
        { key: 'deliveryOrderDate', label: 'DO Date', mono: true },
        { key: 'doReferenceNumberDamco', label: 'DO Reference', mono: true },
        { key: 'doFileNumberKpm', label: 'File Number', mono: true },
        { key: 'itNumber', label: 'IT Number', mono: true },
        { key: 'entryNumber', label: 'Entry Number', mono: true },
        { key: 'blOrAwbNumber', label: 'BL/AWB Number', mono: true },
        { key: 'masterNumber', label: 'Master Number', mono: true },
        { key: 'houseBillNumbers', label: 'House Bills', mono: true },
      ],
    },
    {
      sectionLabel: 'Parties',
      fields: [
        { key: 'shipperName', label: 'Shipper' },
        { key: 'consigneeName', label: 'Consignee' },
        { key: 'billToParty', label: 'Bill To' },
        { key: 'issuedByCustomsBroker', label: 'Issued By' },
      ],
    },
    {
      sectionLabel: 'Transport',
      fields: [
        { key: 'importingCarrier', label: 'Importing Carrier' },
        { key: 'deliveringCarrier', label: 'Delivering Carrier' },
        { key: 'portOfLoadingOrigin', label: 'Port of Loading' },
        { key: 'portOfDischargeDestination', label: 'Port of Discharge' },
        { key: 'finalDestination', label: 'Final Destination' },
        { key: 'arrivalDate', label: 'Arrival Date', mono: true },
        { key: 'freeTimeExpirationDate', label: 'Free Time Expiry', mono: true },
      ],
    },
    {
      sectionLabel: 'Cargo',
      fields: [
        { key: 'numberOfPackages', label: 'Packages', mono: true },
        { key: 'containerNumber', label: 'Container', mono: true },
        { key: 'containerSealNumbers', label: 'Seal Numbers', mono: true },
        { key: 'totalWeightKg', label: 'Weight (kg)', mono: true },
        { key: 'pickupLocation', label: 'Pickup Location' },
        { key: 'deliveryLocation', label: 'Delivery Location' },
      ],
    },
  ],
};

const US_PACKING_LIST: DocTypeConfig = {
  docType: 'US_PACKING_LIST',
  displayName: 'US Packing List',
  shortCode: 'UP',
  geography: 'US',
  crossValidationRules: [],
  sections: [
    {
      sectionLabel: 'Document',
      fields: [
        { key: 'packingSlipNumber', label: 'Packing Slip Number', mono: true },
        { key: 'documentDate', label: 'Date', mono: true },
        { key: 'documentStatus', label: 'Status' },
        { key: 'soNumber', label: 'SO Number', mono: true },
        { key: 'poNumber', label: 'PO Number', mono: true },
        { key: 'bolNumber', label: 'BOL Number', mono: true },
        { key: 'projectName', label: 'Project Name' },
        { key: 'projectId', label: 'Project ID', mono: true },
      ],
    },
    {
      sectionLabel: 'Parties',
      fields: [
        { key: 'shipperName', label: 'Shipper' },
        { key: 'shipperLocation', label: 'Shipper Location' },
        { key: 'shipToName', label: 'Ship To' },
        { key: 'shipToAddress', label: 'Ship To Address' },
        { key: 'consigneeName', label: 'Consignee' },
        { key: 'consigneeAddress', label: 'Consignee Address' },
      ],
    },
    {
      sectionLabel: 'Shipping',
      fields: [
        { key: 'countryOfOrigin', label: 'Country of Origin' },
        { key: 'carrierName', label: 'Carrier' },
        { key: 'estimatedDeliveryDate', label: 'Est. Delivery', mono: true },
        { key: 'appointmentTime', label: 'Appointment', mono: true },
      ],
    },
    {
      sectionLabel: 'Totals',
      fields: [
        { key: 'totalLines', label: 'Total Lines', mono: true },
        { key: 'totalPiecesAggregate', label: 'Total Pieces', mono: true },
        { key: 'totalBundlesAggregate', label: 'Total Bundles', mono: true },
        { key: 'totalWeightLbs', label: 'Total Weight (lbs)', mono: true },
      ],
    },
  ],
};

const ENTRY_SUMMARY_TARIFF_LINES: DocTypeConfig = {
  docType: 'ENTRY_SUMMARY_TARIFF_LINES',
  displayName: 'Entry Summary Tariff Lines',
  shortCode: 'TL',
  geography: 'US',
  crossValidationRules: [],
  sections: [
    {
      sectionLabel: 'Tariff Line',
      fields: [
        { key: 'filerCodeEntryNumber', label: 'Entry Number', mono: true },
        { key: 'lineNo', label: 'Line Number', mono: true },
        { key: 'lineMerchandiseDescription', label: 'Merchandise Description' },
        { key: 'lineHtsusNumber', label: 'HTSUS Number', mono: true },
      ],
    },
  ],
};

// ---------------------------------------------------------------
// MASTER CONFIG MAP
// ---------------------------------------------------------------

export const DOC_FIELD_CONFIG: Record<string, DocTypeConfig> = {
  SALES_INVOICE,
  PACKING_LIST,
  BILL_OF_LADING,
  SHIPPING_BILL,
  CHA_BILL,
  FREIGHT_FORWARDER_BILL,
  OCEAN_FREIGHT,
  ENTRY_SUMMARY,
  ENTRY_SUMMARY_TARIFF_LINES,
  CUSTOMER_BROKER_BILL,
  GRN_INBOUND,
  PORT_TO_WH,
  WH_TO_CUSTOMER,
  US_SALES_INVOICE,
  US_CARGO_RELEASE_ORDER: US_CARGO_RELEASE,
  US_CUSTOMS_RELEASE_ORDER: US_CUSTOMS_RELEASE,
  US_DELIVERY_ORDER,
  US_PACKING_LIST,
};

// Convenience: get config by DocType enum string
export function getDocConfig(docType: string): DocTypeConfig | undefined {
  return DOC_FIELD_CONFIG[docType];
}

// Get all fields marked as critical (used in cross-validation)
export function getCriticalFields(docType: string): FieldDef[] {
  const config = getDocConfig(docType);
  if (!config) return [];
  return config.sections.flatMap(s => s.fields.filter(f => f.critical));
}

// Get total field count for a doc type
export function getFieldCount(docType: string): number {
  const config = getDocConfig(docType);
  if (!config) return 0;
  return config.sections.reduce((sum, s) => sum + s.fields.length, 0);
}
