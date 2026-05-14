/**
 * Post-process Ocean Freight Invoice JSON (single or multiInvoice + invoices[]).
 */

import { normalizeDateString, normalizeMoneyString } from "./sales-invoice-structured-normalize.js";

function isNullish(v: unknown): v is null | undefined {
  return v == null;
}

function asString(v: unknown): string | null {
  if (isNullish(v)) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function stripNumericCommas(s: string): string {
  return s.replace(/,/g, "").trim();
}

function splitWeightAndUnit(raw: string): { kg: string; unit: string | null } {
  const t = raw.trim();
  const m = t.match(/^([\d.,]+)\s*([A-Za-z/]+)?\s*$/);
  if (!m) return { kg: stripNumericCommas(t), unit: null };
  const num = stripNumericCommas(m[1]!);
  const u = m[2]?.trim();
  return { kg: num, unit: u && u.length ? u : null };
}

function normalizeWeightUnit(raw: string | null): string | null {
  if (raw == null) return null;
  const t = raw.trim().replace(/\./g, "");
  if (!t) return null;
  const u = t.toUpperCase().replace(/\s+/g, "");
  if (/^(KGS?|KILO(?:GRAM)?S?)$/.test(u)) return "KG";
  if (/^(MTS?|TONNES?|TNE)$/.test(u)) return "MT";
  if (u === "T" || u === "TON") return "MT";
  return t.toUpperCase();
}

const DATE_KEYS_INVOICE_ID = new Set(["invoiceDate", "dueDate", "jobDate"]);
const DATE_KEYS_SHIPMENT = new Set(["etd", "eta", "blDate", "cpDate"]);
const DATE_LIST_KEYS_SHIPMENT = new Set(["sbDates", "customerInvoiceDates"]);

function normalizeCommaSeparatedDates(raw: string): string | null {
  const parts = raw.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const out = parts.map((p) => normalizeDateString(p) ?? p);
  return out.join(", ");
}

function countContainersInList(raw: string): number {
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0).length;
}

function normalizeIssuer(o: Record<string, unknown>): void {
  for (const key of Object.keys(o)) {
    const s = asString(o[key]);
    o[key] = s ?? null;
  }
}

/** GSTIN is 15 chars; state code = first two digits. */
function deriveIssuerStateCodeFromGst(o: Record<string, unknown>): void {
  if (asString(o.stateCode)) return;
  const gst = asString(o.gstNumber);
  if (!gst || gst.length !== 15) return;
  if (!/^\d{2}/.test(gst)) return;
  o.stateCode = gst.slice(0, 2);
}

/** Strip % and normalize tax rate to numeric string (e.g. "18%" → "18"). */
function normalizeTaxRateString(raw: string | null): string | null {
  if (raw == null) return null;
  const t = raw.replace(/%/g, "").trim();
  if (!t) return null;
  const n = normalizeMoneyString(stripNumericCommas(t)) ?? stripNumericCommas(t);
  return n || null;
}

/** EFL-style "INR 17140.00/CN" or "@ 110.00" in description. */
function inferRatePerUnitFromDescription(description: string): string | null {
  const d = description.trim();
  if (!d) return null;
  let m = d.match(/\bINR\s*([\d,]+(?:\.\d+)?)\s*\/\s*[A-Za-z0-9]{1,8}\b/i);
  if (m?.[1]) {
    const x = stripNumericCommas(m[1]);
    const out = normalizeMoneyString(x) ?? x;
    return out || null;
  }
  m = d.match(/@\s*([\d,]+(?:\.\d+)?)(?:\s|$|[^\d.,])/);
  if (m?.[1]) {
    const x = stripNumericCommas(m[1]);
    const out = normalizeMoneyString(x) ?? x;
    return out || null;
  }
  return null;
}

const CHARGE_TAX_RATE_KEYS = new Set(["igstRate", "cgstRate", "sgstRate"]);

function normalizeInvoiceIdentification(o: Record<string, unknown>): void {
  for (const key of Object.keys(o)) {
    const v = o[key];
    if (DATE_KEYS_INVOICE_ID.has(key)) {
      if (v === null || v === undefined) {
        o[key] = null;
        continue;
      }
      const s = asString(v);
      o[key] = s ? (normalizeDateString(s) ?? s) : null;
      continue;
    }
    const s = asString(v);
    o[key] = s ?? null;
  }
}

function normalizeCustomer(o: Record<string, unknown>): void {
  for (const key of Object.keys(o)) {
    const s = asString(o[key]);
    o[key] = s ?? null;
  }
}

function normalizeShipment(o: Record<string, unknown>): void {
  for (const key of Object.keys(o)) {
    const v = o[key];
    if (DATE_KEYS_SHIPMENT.has(key)) {
      if (v === null || v === undefined) {
        o[key] = null;
        continue;
      }
      const s = asString(v);
      o[key] = s ? (normalizeDateString(s) ?? s) : null;
      continue;
    }
    if (DATE_LIST_KEYS_SHIPMENT.has(key)) {
      const s = asString(v);
      o[key] = s ? (normalizeCommaSeparatedDates(s) ?? s) : null;
      continue;
    }
    const s = asString(v);
    o[key] = s ?? null;
  }
}

function normalizeNetWeightKg(o: Record<string, unknown>): void {
  const nwk = asString(o.netWeightKg);
  if (nwk) {
    const { kg, unit } = splitWeightAndUnit(nwk);
    const num = normalizeMoneyString(kg) ?? kg;
    o.netWeightKg = num || null;
    if (unit && !asString(o.weightUnit)) o.weightUnit = normalizeWeightUnit(unit);
  } else {
    o.netWeightKg = null;
  }
}

function normalizeCargo(o: Record<string, unknown>): void {
  const wkRaw = asString(o.weightKg);
  const wuRaw = asString(o.weightUnit);
  if (wkRaw) {
    const { kg, unit } = splitWeightAndUnit(wkRaw);
    const num = normalizeMoneyString(kg) ?? kg;
    o.weightKg = num || null;
    o.weightUnit = normalizeWeightUnit(wuRaw ?? unit ?? null);
  } else {
    o.weightKg = null;
    o.weightUnit = normalizeWeightUnit(wuRaw);
  }
  normalizeNetWeightKg(o);
  for (const key of ["volumeCbm", "numPackages"] as const) {
    const s = asString(o[key]);
    o[key] = s ? (normalizeMoneyString(stripNumericCommas(s)) ?? stripNumericCommas(s)) : null;
  }
  o.packageType = asString(o.packageType) ?? null;
  o.chargeable = asString(o.chargeable) ?? null;
}

const CHARGE_MONEY_KEYS = new Set([
  "amountUsd",
  "taxableAmountInr",
  "currencyAmount",
  "igstAmount",
  "cgstAmount",
  "sgstAmount",
  "ratePerUnit",
]);

function roeShouldNull(s: string): boolean {
  const t = stripNumericCommas(s);
  const n = Number(t);
  return Number.isFinite(n) && Math.abs(n - 1) < 1e-6;
}

function normalizeChargeRow(row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    const v = row[key];
    if (key === "roe") {
      const s = asString(v);
      row[key] = s && !roeShouldNull(s) ? (normalizeMoneyString(stripNumericCommas(s)) ?? stripNumericCommas(s)) : null;
      continue;
    }
    if (CHARGE_TAX_RATE_KEYS.has(key)) {
      row[key] = normalizeTaxRateString(asString(v));
      continue;
    }
    if (CHARGE_MONEY_KEYS.has(key)) {
      const s = asString(v);
      row[key] = s ? (normalizeMoneyString(stripNumericCommas(s)) ?? stripNumericCommas(s)) : null;
      continue;
    }
    if (key === "units") {
      const s = asString(v);
      row[key] = s ?? null;
      continue;
    }
    const s = asString(v);
    row[key] = s ?? null;
  }
  const desc = asString(row.description) ?? "";
  if (!asString(row.ratePerUnit) && desc) {
    const inferred = inferRatePerUnitFromDescription(desc);
    if (inferred) row.ratePerUnit = inferred;
  }
}

function normalizeTotals(o: Record<string, unknown>): void {
  for (const key of Object.keys(o)) {
    const v = o[key];
    if (key === "amountInWords") {
      o[key] = asString(v) ?? null;
      continue;
    }
    const s = asString(v);
    if (s == null) {
      o[key] = null;
      continue;
    }
    o[key] = normalizeMoneyString(stripNumericCommas(s)) ?? stripNumericCommas(s);
  }
}

function normalizeBank(o: Record<string, unknown>): void {
  for (const key of Object.keys(o)) {
    const s = asString(o[key]);
    o[key] = s ?? null;
  }
}

function emptyStringsToNullDeep(value: unknown): void {
  if (value === "") return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (value[i] === "") value[i] = null;
      else emptyStringsToNullDeep(value[i]);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value as Record<string, unknown>)) {
      const v = (value as Record<string, unknown>)[k];
      if (v === "") (value as Record<string, unknown>)[k] = null;
      else emptyStringsToNullDeep(v);
    }
  }
}

/** Normalize root `taxSummary`: keep null, or trim JSON string; empty → null. */
function normalizeTaxSummaryField(data: Record<string, unknown>): void {
  const v = data.taxSummary;
  if (v === null || v === undefined) {
    data.taxSummary = null;
    return;
  }
  if (typeof v === "string") {
    const t = v.trim();
    data.taxSummary = t === "" ? null : t;
    return;
  }
  if (typeof v === "object") {
    data.taxSummary = JSON.stringify(v);
    return;
  }
  data.taxSummary = asString(v);
}

export function normalizeOceanFreightInvoiceBody(data: Record<string, unknown>): void {
  const issuer = data.issuer;
  if (issuer && typeof issuer === "object" && !Array.isArray(issuer)) {
    const ir = issuer as Record<string, unknown>;
    normalizeIssuer(ir);
    deriveIssuerStateCodeFromGst(ir);
  }

  const invId = data.invoiceIdentification;
  if (invId && typeof invId === "object" && !Array.isArray(invId))
    normalizeInvoiceIdentification(invId as Record<string, unknown>);

  const customer = data.customer;
  if (customer && typeof customer === "object" && !Array.isArray(customer))
    normalizeCustomer(customer as Record<string, unknown>);

  const shipment = data.shipment;
  if (shipment && typeof shipment === "object" && !Array.isArray(shipment))
    normalizeShipment(shipment as Record<string, unknown>);

  const cargo = data.cargo;
  if (cargo && typeof cargo === "object" && !Array.isArray(cargo)) normalizeCargo(cargo as Record<string, unknown>);

  const c = asString(data.containers);
  data.containers = c ?? null;
  let tc = asString(data.totalContainers);
  if (c && tc == null) {
    const n = countContainersInList(c);
    if (n > 0) tc = String(n);
  }
  data.totalContainers = tc ?? null;

  const charges = data.charges;
  if (Array.isArray(charges)) {
    for (const row of charges) {
      if (row && typeof row === "object" && !Array.isArray(row)) normalizeChargeRow(row as Record<string, unknown>);
    }
  }

  normalizeTaxSummaryField(data);

  const totals = data.totals;
  if (totals && typeof totals === "object" && !Array.isArray(totals)) normalizeTotals(totals as Record<string, unknown>);

  const bank = data.bankDetails;
  if (bank && typeof bank === "object" && !Array.isArray(bank)) normalizeBank(bank as Record<string, unknown>);

  const bank2 = data.additionalBankDetails;
  if (bank2 && typeof bank2 === "object" && !Array.isArray(bank2)) normalizeBank(bank2 as Record<string, unknown>);

  const footer = data.footer;
  if (footer && typeof footer === "object" && !Array.isArray(footer)) normalizeBank(footer as Record<string, unknown>);
}

export function normalizeStructuredOceanFreightPayload(data: Record<string, unknown>): Record<string, unknown> {
  const multi = data.multiInvoice === true;
  if (multi && Array.isArray(data.invoices)) {
    for (const inv of data.invoices) {
      if (inv && typeof inv === "object" && !Array.isArray(inv))
        normalizeOceanFreightInvoiceBody(inv as Record<string, unknown>);
    }
  } else {
    normalizeOceanFreightInvoiceBody(data);
  }

  emptyStringsToNullDeep(data);
  return data;
}
