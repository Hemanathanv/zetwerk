export type DocumentGateRole = 'PRIMARY' | 'PARALLEL';

export interface DocumentGateDocDef {
  docType: string;
  code: string;
  label: string;
  role: DocumentGateRole;
}

export interface DocumentGateDef {
  gateNumber: number;
  label: string;
  docs: DocumentGateDocDef[];
}

export const DOCUMENT_GATE_DEFS: DocumentGateDef[] = [
  {
    gateNumber: 1,
    label: 'Shipment Initiation',
    docs: [
      { docType: 'SALES_INVOICE', code: 'SI', label: 'Sales Invoice', role: 'PRIMARY' },
      { docType: 'PACKING_LIST', code: 'PL', label: 'Packing List', role: 'PRIMARY' },
      { docType: 'SHIPPING_BILL', code: 'SB', label: 'Shipping Bill', role: 'PRIMARY' },
      { docType: 'CHA_BILL', code: 'CH', label: 'CHA Bill', role: 'PARALLEL' },
    ],
  },
  {
    gateNumber: 2,
    label: 'India Port Exit',
    docs: [
      { docType: 'BILL_OF_LADING', code: 'BL', label: 'Bill of Lading', role: 'PRIMARY' },
      { docType: 'DRAFT_CBP_FORM_7501_BROKER', code: 'CB', label: 'Draft CBP FORM 7501 Broker', role: 'PRIMARY' },
      { docType: 'FREIGHT_FORWARDER_BILL', code: 'FF', label: 'Freight Forwarder Bill', role: 'PARALLEL' },
    ],
  },
  {
    gateNumber: 3,
    label: 'US Port Entry',
    docs: [
      { docType: 'ISF', code: 'IS', label: 'ISF Filing', role: 'PRIMARY' },
      { docType: 'ENTRY_SUMMARY', code: 'CBP', label: 'CBP FORM 7501', role: 'PRIMARY' },
      { docType: 'US_CARGO_RELEASE_ORDER', code: 'CR', label: 'Cargo Release Order', role: 'PRIMARY' },
      { docType: 'US_CUSTOMS_RELEASE_ORDER', code: 'CU', label: 'Customs Release Order', role: 'PRIMARY' },
      { docType: 'CUSTOMER_BROKER_BILL', code: 'BB', label: 'US Custom Broker Bill', role: 'PARALLEL' },
      { docType: 'OCEAN_FREIGHT', code: 'OF', label: 'Ocean Freight Invoice', role: 'PARALLEL' },
    ],
  },
  {
    gateNumber: 4,
    label: '3PL Warehouse Entry',
    docs: [
      { docType: 'US_DELIVERY_ORDER', code: 'DO', label: 'Delivery Order', role: 'PRIMARY' },
      { docType: 'GRN_INBOUND', code: 'GR', label: 'GRN Inbound', role: 'PRIMARY' },
      { docType: 'PORT_TO_WH', code: 'PW', label: 'Port to Warehouse Bill', role: 'PARALLEL' },
    ],
  },
  {
    gateNumber: 5,
    label: 'Customer Delivery',
    docs: [
      { docType: 'US_PACKING_LIST', code: 'UP', label: 'US Packing List', role: 'PRIMARY' },
      { docType: 'OUTWARD_GRN', code: 'OG', label: 'Outward GRN', role: 'PRIMARY' },
      { docType: 'US_SALES_INVOICE', code: 'UI', label: 'US Sales Invoice', role: 'PRIMARY' },
      { docType: 'WH_TO_CUSTOMER', code: 'WC', label: 'Warehouse to Customer Bill', role: 'PARALLEL' },
    ],
  },
];

export const DOCUMENT_GATE_LABELS: Record<number, string> = Object.fromEntries(
  DOCUMENT_GATE_DEFS.map(gate => [gate.gateNumber, gate.label]),
);

export const DOCUMENT_EXPECTED_DOCS_BY_GATE: Record<number, string[]> = Object.fromEntries(
  DOCUMENT_GATE_DEFS.map(gate => [gate.gateNumber, gate.docs.map(doc => doc.docType)]),
);

export const DOCUMENT_PARALLEL_DOC_TYPES = new Set(
  DOCUMENT_GATE_DEFS.flatMap(gate => gate.docs.filter(doc => doc.role === 'PARALLEL').map(doc => doc.docType)),
);

export function documentGateDocDef(docType: string): DocumentGateDocDef | undefined {
  const normalized = docType.toUpperCase();
  return DOCUMENT_GATE_DEFS.flatMap(gate => gate.docs).find(doc => doc.docType === normalized);
}

export function documentGateForDocType(docType: string): { gateNumber: number; doc: DocumentGateDocDef } | undefined {
  const normalized = docType.toUpperCase();
  for (const gate of DOCUMENT_GATE_DEFS) {
    const doc = gate.docs.find(item => item.docType === normalized);
    if (doc) return { gateNumber: gate.gateNumber, doc };
  }
  return undefined;
}
