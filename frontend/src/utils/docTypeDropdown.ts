import type { ConfigTemplate, ConfigDocType } from '@/contexts/ConfigContext';

export type DocTypeOption = { value: string; label: string };
export type DocTypeGroup  = { label: string; options: DocTypeOption[] };

/**
 * Maps DocumentTypeRegistry.typeCode (SCREAMING_SNAKE_CASE from DB)
 * → OCR_TYPES id (snake_case, defined in api/src/routes/ocr-proxy.ts).
 * Extend this list when new OCR processors are added.
 */
const TYPECODE_TO_OCR_ID: Record<string, string> = {
  SALES_INVOICE:                'sales_invoices',
  BILL_OF_LADING:               'bill_of_lading',
  SHIPPING_BILL:                'shipping_bill',
  PACKING_LIST:                 'packing_list',
  OUTWARD_PACKING_LIST:         'packing_list',
  US_PACKING_LIST:              'us_packing_list',
  US_SALES_INVOICE:             'us_sales_invoice',
  DELIVERY_ORDER:               'us_delivery_order',
  US_DELIVERY_ORDER:            'us_delivery_order',
  CARGO_RELEASE:                'us_cargo_release_order',
  US_CARGO_RELEASE:             'us_cargo_release_order',
  US_CUSTOMS_RELEASE:           'us_customs_release_order',
  US_CUSTOMS_RELEASE_ORDER:     'us_customs_release_order',
  CHA:                          'cha',
  CHA_BILL:                     'cha',
  FREIGHT_FORWARDER_BILL:       'freight_forwarder_bill',
  OCEAN_FREIGHT:                'ocean_freight',
  ENTRY_SUMMARY:                'entry_summary',
  DRAFT_CBP_FORM_7501_BROKER:   'draft_cbp_form_7501_broker',
  CUSTOMER_BROKER_BILL:         'customer_broker_bill',
  GRN_INBOUND:                  'grn_inbound',
  PORT_TO_WH:                   'port_to_wh',
  WH_TO_CUSTOMER:               'wh_to_customer',
  STEEL_SUPPLIER_DECLARATION:   'steel_supplier_declaration',
  DELIVERY_DEDUCTION_SHEET:     'delivery_deduction_sheet',
};

/**
 * Convert a DocumentTypeRegistry typeCode to the OCR processor id.
 * Falls back to lowercase typeCode when no explicit mapping exists.
 */
export function toOcrId(typeCode: string): string {
  return TYPECODE_TO_OCR_ID[typeCode] ?? typeCode.toLowerCase();
}

/** Minimal static fallback shown while ConfigContext is still loading */
export const ALL_OCR_OPTIONS: DocTypeOption[] = [
  { value: 'sales_invoices',           label: 'Sales Invoice' },
  { value: 'bill_of_lading',           label: 'Bill of Lading' },
  { value: 'shipping_bill',            label: 'Shipping Bill' },
  { value: 'packing_list',             label: 'Packing List' },
  { value: 'entry_summary',            label: 'CBP FORM 7501' },
  { value: 'draft_cbp_form_7501_broker', label: 'Draft CBP FORM 7501_Broker' },
  { value: 'cha',                      label: 'CHA Bill' },
  { value: 'freight_forwarder_bill',   label: 'Freight Forwarder Bill' },
  { value: 'customer_broker_bill',     label: 'Customs Broker Bill' },
  { value: 'ocean_freight',            label: 'Ocean Freight' },
  { value: 'grn_inbound',              label: 'GRN Inbound' },
  { value: 'port_to_wh',               label: 'Port to Warehouse' },
  { value: 'wh_to_customer',           label: 'Warehouse to Customer' },
  { value: 'us_sales_invoice',         label: 'US Sales Invoice' },
  { value: 'us_packing_list',          label: 'US Packing List' },
  { value: 'us_delivery_order',        label: 'US Delivery Order' },
  { value: 'us_cargo_release_order',   label: 'US Cargo Release Order' },
  { value: 'us_customs_release_order', label: 'US Customs Release Order' },
  { value: 'isf',                      label: 'Importer Security Filing (ISF)' },
];

const STATIC_FALLBACK = ALL_OCR_OPTIONS;

function includeEveryOcr(
  groups: DocTypeGroup[],
  flat: DocTypeOption[],
): { groups: DocTypeGroup[]; flat: DocTypeOption[] } {
  const existing = new Set(flat.map(option => option.value));
  const missing = ALL_OCR_OPTIONS.filter(option => !existing.has(option.value));
  if (!missing.length) return { groups, flat };
  if (!groups.length) return { groups, flat: [...flat, ...missing] };
  return {
    groups: [...groups, { label: 'Other OCR Types', options: missing }],
    flat: [...flat, ...missing],
  };
}

/**
 * Build grouped (and flat) doc-type option lists for upload form selects.
 *
 * Groups come from the active WorkflowTemplate's gate structure.
 * Doc-type names come from ConfigContext.docTypes (the Settings registry).
 * Values are OCR processor ids (suitable for sending as `ocrType` to /api/ocr/run).
 *
 * Generated doc types (isGenerated: true) are excluded — users don't upload those.
 *
 * Returns:
 *   groups — non-empty when an active template with gate assignments exists
 *   flat   — all options flattened (use as fallback when groups is empty)
 */
export function buildDocTypeOptions(
  templates: ConfigTemplate[],
  docTypes: ConfigDocType[],
): { groups: DocTypeGroup[]; flat: DocTypeOption[] } {
  const extractable = docTypes.filter(dt => dt.hasExtraction);

  if (!extractable.length) {
    return { groups: [], flat: STATIC_FALLBACK };
  }

  const active = templates.find(t => t.templateStatus === 'ACTIVE');

  if (!active?.gates?.length) {
    const seenIds = new Set<string>();
    const flat: DocTypeOption[] = [];
    for (const dt of [...extractable].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))) {
      const id = toOcrId(dt.typeCode);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      flat.push({ value: id, label: dt.displayName });
    }
    return includeEveryOcr([], flat);
  }

  const groups: DocTypeGroup[] = [];
  const seenTypeCodes = new Set<string>();
  const seenOcrIds    = new Set<string>();

  const sortedGates = [...active.gates].sort(
    (a, b) => (a.sortOrder ?? a.gateNumber ?? 0) - (b.sortOrder ?? b.gateNumber ?? 0),
  );

  for (const gate of sortedGates) {
    const dtgs = gate.docTypeGates ?? [];
    if (!dtgs.length) continue;

    const options: DocTypeOption[] = [];
    for (const dta of dtgs) {
      if (dta.isGenerated) continue;
      seenTypeCodes.add(dta.docType);
      const dt = extractable.find(d => d.typeCode === dta.docType);
      if (!dt) continue;
      const ocrId = toOcrId(dt.typeCode);
      if (seenOcrIds.has(ocrId)) continue; // deduplicate OCR IDs across gates
      seenOcrIds.add(ocrId);
      options.push({ value: ocrId, label: dt.displayName });
    }
    if (options.length) {
      groups.push({
        label: gate.gateName,
        options,
      });
    }
  }

  const others = extractable
    .filter(dt => !seenTypeCodes.has(dt.typeCode) && !seenOcrIds.has(toOcrId(dt.typeCode)))
    .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))
    .map(dt => ({ value: toOcrId(dt.typeCode), label: dt.displayName }));
  if (others.length) {
    groups.push({ label: 'Other', options: others });
  }

  const flat = groups.flatMap(g => g.options);
  return includeEveryOcr(groups, flat.length ? flat : STATIC_FALLBACK);
}
