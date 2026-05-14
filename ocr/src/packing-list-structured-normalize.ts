/**
 * Post-process structured Packing Lists JSON (shared rules with sales invoice where fields overlap).
 */

import {
  normalizeAddressCommaSpacing,
  normalizeCountryString,
  normalizeDateString,
  normalizeDinString,
  normalizeHsnString,
  normalizeMoneyString,
  normalizeProductCodeString,
  normalizeSignatureField,
  stripHsnFromDescription,
  stripOriginCertificationFromProductSpec,
} from "./sales-invoice-structured-normalize.js";

function isNullish(v: unknown): v is null | undefined {
  return v == null;
}

function asString(v: unknown): string | null {
  if (isNullish(v)) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v).trim();
  return s === "" ? null : s;
}

const DATE_KEYS = new Set(["invoiceDate", "buyerPoDate"]);
const COUNTRY_KEYS = new Set(["countryOfFinalDestination", "countryOfOrigin"]);
const ADDRESS_KEYS = new Set([
  "buyerAddress",
  "consigneeAddress",
  "exporterAddress",
]);
/** Numeric-ish strings: strip commas, normalize decimals */
const TOTALS_NUMERIC = new Set([
  "totalBundles",
  "totalQty",
  "totalNetWeightKgs",
  "totalGrossWeightKgs",
]);
const LINE_NUMERIC = new Set([
  "qtyPerBundle",
  "noOfBundles",
  "totalQtyInPcs",
  "netWeightKgs",
  "grossWeightKgs",
]);

function normalizeFlatObject(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (key === "signature") {
      obj[key] = normalizeSignatureField(v) as unknown;
      continue;
    }
    const s = asString(v);
    if (s == null) {
      if (v === null || v === undefined) continue;
      continue;
    }
    if (ADDRESS_KEYS.has(key)) obj[key] = normalizeAddressCommaSpacing(s) ?? s;
    else if (DATE_KEYS.has(key)) obj[key] = normalizeDateString(s) ?? s;
    else if (COUNTRY_KEYS.has(key)) obj[key] = normalizeCountryString(s) ?? s;
    else if (TOTALS_NUMERIC.has(key)) obj[key] = normalizeMoneyString(s) ?? s;
    else if (key === "dinNumber") obj[key] = normalizeDinString(s) ?? s;
    else obj[key] = s;
  }
}

function normalizeLineItemRow(row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    const v = row[key];
    const s = asString(v);
    if (s == null) continue;
    if (key === "hsnCode") row[key] = normalizeHsnString(s) ?? s;
    else if (key === "productCode") row[key] = normalizeProductCodeString(s) ?? s;
    else if (key === "productDescription") row[key] = stripHsnFromDescription(s) ?? s;
    else if (key === "productSpecification")
      row[key] = stripOriginCertificationFromProductSpec(s) ?? s;
    else if (key === "kindOfPkg") row[key] = s.trim().toUpperCase() || s;
    else if (LINE_NUMERIC.has(key)) row[key] = normalizeMoneyString(s) ?? s;
    else row[key] = s;
  }
}

export function normalizeStructuredPackingListPayload(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const compliance = data.compliance as Record<string, unknown> | undefined;
  if (compliance && typeof compliance === "object" && !Array.isArray(compliance))
    normalizeFlatObject(compliance);

  const entities = data.entities as Record<string, unknown> | undefined;
  if (entities && typeof entities === "object" && !Array.isArray(entities))
    normalizeFlatObject(entities);

  const header = data.header as Record<string, unknown> | undefined;
  if (header && typeof header === "object" && !Array.isArray(header))
    normalizeFlatObject(header);

  const totals = data.totals as Record<string, unknown> | undefined;
  if (totals && typeof totals === "object" && !Array.isArray(totals))
    normalizeFlatObject(totals);

  const shipment = data.shipment as Record<string, unknown> | undefined;
  if (shipment && typeof shipment === "object" && !Array.isArray(shipment))
    normalizeFlatObject(shipment);

  const footer = data.footer as Record<string, unknown> | undefined;
  if (footer && typeof footer === "object" && !Array.isArray(footer))
    normalizeFlatObject(footer);

  const lineItems = data.lineItems;
  if (Array.isArray(lineItems)) {
    for (const raw of lineItems) {
      if (raw && typeof raw === "object" && !Array.isArray(raw))
        normalizeLineItemRow(raw as Record<string, unknown>);
    }
  }

  return data;
}
