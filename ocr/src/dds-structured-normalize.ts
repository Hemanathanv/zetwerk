/**
 * Post-process structured Delivery Deduction Sheet JSON.
 */

import {
  normalizeDateString,
  normalizeSignatureField as _sig,
} from "./sales-invoice-structured-normalize.js";

function isNullish(v: unknown): v is null | undefined { return v == null; }

function asString(v: unknown): string | null {
  if (isNullish(v)) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Strip ALL commas from a numeric string (handles Indian lakh format). */
function stripNumericCommas(s: string): string {
  return s.replace(/,/g, "").trim();
}

/** Strip trailing unit suffixes like "MT", "MTS" from weight strings. */
function stripWeightUnit(s: string): string {
  return s.replace(/\s*[Mm][Tt][Ss]?\s*$/, "").trim();
}

/** Strip leading zeros from a plain integer string ("05" → "5"). Keep "0" as-is. */
function stripLeadingZeros(s: string): string {
  const n = s.replace(/^0+(\d)/, "$1");
  return n || s;
}

/** Strip common label prefixes from a registered address string. */
function stripAddressLabelPrefix(s: string): string {
  return s
    .replace(/^Regd\.?\s*Offic(?:e|er)\s*[:–-]\s*/i, "")
    .replace(/^Registered\s*Offic(?:e|er)\s*[:–-]\s*/i, "")
    .replace(/^Corporate\s*Offic(?:e|er)\s*[:–-]\s*/i, "")
    .replace(/^Address\s*[:–-]\s*/i, "")
    .trim();
}

function normalizeCompany(company: Record<string, unknown>): void {
  for (const key of Object.keys(company)) {
    const v = company[key];
    const s = asString(v);
    if (key === "registeredAddress") {
      company[key] = s ? stripAddressLabelPrefix(s) : null;
    } else {
      company[key] = s ?? null;
    }
  }
}

function normalizeShipmentReference(ref: Record<string, unknown>): void {
  for (const key of Object.keys(ref)) {
    const s = asString(ref[key]);
    ref[key] = s ?? null;
  }
}

function normalizeParties(parties: Record<string, unknown>): void {
  for (const key of Object.keys(parties)) {
    const s = asString(parties[key]);
    parties[key] = s ?? null;
  }
}

function normalizeReferenceInvoiceRow(row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    const v = row[key];
    if (key === "invoiceDate") {
      if (v === null || v === undefined) { row[key] = null; continue; }
      const s = asString(v);
      row[key] = s ? (normalizeDateString(s) ?? s) : null;
      continue;
    }
    const s = asString(v);
    row[key] = s ?? null;
  }
}

function normalizeOriginCharges(charges: Record<string, unknown>): void {
  for (const key of Object.keys(charges)) {
    const v = charges[key];
    const s = asString(v);
    if (s == null) { charges[key] = null; continue; }

    if (key === "inrTotal" || key === "usdTotal") {
      charges[key] = stripNumericCommas(s) || null;
    } else if (key === "totalCargoWeightMt") {
      charges[key] = stripWeightUnit(stripNumericCommas(s)) || null;
    } else if (key === "numContainers") {
      charges[key] = stripLeadingZeros(stripNumericCommas(s)) || null;
    } else {
      charges[key] = s;
    }
  }
}

/** Apply all normalization rules to a parsed DDS payload in-place. */
export function normalizeStructuredDdsPayload(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const company = data.company;
  if (company && typeof company === "object" && !Array.isArray(company))
    normalizeCompany(company as Record<string, unknown>);

  const ref = data.shipmentReference;
  if (ref && typeof ref === "object" && !Array.isArray(ref))
    normalizeShipmentReference(ref as Record<string, unknown>);

  const parties = data.parties;
  if (parties && typeof parties === "object" && !Array.isArray(parties))
    normalizeParties(parties as Record<string, unknown>);

  const invoices = data.referenceInvoices;
  if (Array.isArray(invoices)) {
    for (const r of invoices) {
      if (r && typeof r === "object" && !Array.isArray(r))
        normalizeReferenceInvoiceRow(r as Record<string, unknown>);
    }
  }

  const charges = data.originCharges;
  if (charges && typeof charges === "object" && !Array.isArray(charges))
    normalizeOriginCharges(charges as Record<string, unknown>);

  return data;
}
