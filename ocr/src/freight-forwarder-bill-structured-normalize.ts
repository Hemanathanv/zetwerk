/**
 * Post-process Freight Forwarder Bill JSON (single or multiInvoice + invoices[]).
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

const TRANSPORT_MODE_ENUM = new Set(["SEA", "AIR", "ROAD", "RAIL", "MULTIMODAL"]);

/** Infer SEA when mode omitted but ocean shipment fields are populated (EFL sea freight). */
function deriveTransportModeIfMissing(o: Record<string, unknown>): void {
  const tm = asString(o.transportMode);
  if (tm) {
    const u = tm.toUpperCase();
    if (TRANSPORT_MODE_ENUM.has(u)) o.transportMode = u;
    return;
  }
  const hasSeaSignal =
    !!(asString(o.vesselName) || asString(o.voyageNumber) || asString(o.imoNumber) || asString(o.oceanBol));
  if (hasSeaSignal) o.transportMode = "SEA";
}

/**
 * When no standalone HS column exists, EFL often embeds HSN in the goods block, e.g. "HSNC - 7308909590".
 * Only fills `hsCode` when it is still empty after extraction.
 */
function inferHsCodeFromGoodsDescriptionText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const patterns: RegExp[] = [
    /\bHSNC\s*[-–—:#]\s*(\d{8,10})\b/gi,
    /\bHSN\s*[-–—:#]\s*(\d{8,10})\b/gi,
    /\bHSNC\s+(\d{8,10})\b/gi,
    /\bHSN\s+CODE\s*[-–—:#]?\s*(\d{8,10})\b/gi,
    /\bHS\s*CODE\s*[-–—:#]?\s*(\d{8,10})\b/gi,
    /\bHSN\s*\/\s*HSNC\s*[-–—:#]?\s*(\d{8,10})\b/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    const m = re.exec(t);
    if (m?.[1]) return m[1]!;
  }
  return null;
}

function backfillShipmentHsCodeFromGoodsDescription(o: Record<string, unknown>): void {
  if (asString(o.hsCode)) return;
  const desc = asString(o.goodsDescription);
  if (!desc) return;
  const code = inferHsCodeFromGoodsDescriptionText(desc);
  if (code) o.hsCode = code;
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
  const grossRaw = asString(o.grossWeightKg);
  const legacyWk = asString((o as Record<string, unknown>).weightKg as unknown);
  const wuRaw = asString(o.weightUnit);
  const raw = grossRaw ?? legacyWk;
  if (raw) {
    const { kg, unit } = splitWeightAndUnit(raw);
    const num = normalizeMoneyString(kg) ?? kg;
    o.grossWeightKg = num || null;
    o.weightUnit = normalizeWeightUnit(wuRaw ?? unit ?? null);
  } else {
    o.grossWeightKg = null;
    o.weightUnit = normalizeWeightUnit(wuRaw);
  }
  if ("weightKg" in o) delete (o as Record<string, unknown>).weightKg;
  normalizeNetWeightKg(o);
  for (const key of ["volumeCbm", "numPackages"] as const) {
    const s = asString(o[key]);
    o[key] = s ? (normalizeMoneyString(stripNumericCommas(s)) ?? stripNumericCommas(s)) : null;
  }
  o.packageType = asString(o.packageType) ?? null;
  o.chargeable = asString(o.chargeable) ?? null;
}

const CHARGE_MONEY_KEYS = new Set([
  "amountInr",
  "taxableAmountInr",
  "foreignCurrencyAmount",
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

function migrateChargeRowLegacy(row: Record<string, unknown>): void {
  const legacyUsd = row.amountUsd;
  if (legacyUsd != null && legacyUsd !== "" && (row.amountInr == null || row.amountInr === "")) {
    row.amountInr = legacyUsd;
  }
  if ("amountUsd" in row) delete row.amountUsd;

  const legacyCur = row.currencyAmount;
  if (legacyCur != null && legacyCur !== "" && (row.foreignCurrencyAmount == null || row.foreignCurrencyAmount === "")) {
    row.foreignCurrencyAmount = legacyCur;
  }
  if ("currencyAmount" in row) delete row.currencyAmount;
}

function normalizeChargeRow(row: Record<string, unknown>): void {
  migrateChargeRowLegacy(row);
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

function migrateTotalsLegacy(o: Record<string, unknown>): void {
  if ((o.subtotalInr == null || o.subtotalInr === "") && o.subtotalUsd != null) o.subtotalInr = o.subtotalUsd;
  if ("subtotalUsd" in o) delete o.subtotalUsd;
  if ((o.totalInr == null || o.totalInr === "") && o.totalUsd != null) o.totalInr = o.totalUsd;
  if ("totalUsd" in o) delete o.totalUsd;
}

function normalizeTotals(o: Record<string, unknown>): void {
  migrateTotalsLegacy(o);
  for (const key of Object.keys(o)) {
    const v = o[key];
    if (key === "amountInWords") {
      o[key] = asString(v) ?? null;
      continue;
    }
    if (key === "currency") {
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

/** EFL page 2 "Account Name:" sometimes missed; issuer legal name is the usual payee. */
function backfillBankBeneficiaryFromIssuer(bank: Record<string, unknown>, issuer: Record<string, unknown> | null): void {
  if (asString(bank.beneficiaryName)) return;
  const company = issuer ? asString(issuer.companyName) : null;
  if (company) bank.beneficiaryName = company;
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

function normalizeTaxSummaryRow(row: Record<string, unknown>): void {
  const money = new Set(["taxableValue", "igstAmount", "cgstAmount", "sgstAmount", "totalTax"]);
  const rate = new Set(["igstRate", "cgstRate", "sgstRate"]);
  for (const key of Object.keys(row)) {
    const v = row[key];
    if (money.has(key)) {
      const s = asString(v);
      row[key] = s ? (normalizeMoneyString(stripNumericCommas(s)) ?? stripNumericCommas(s)) : null;
      continue;
    }
    if (rate.has(key)) {
      row[key] = normalizeTaxRateString(asString(v));
      continue;
    }
    row[key] = asString(v) ?? null;
  }
}

/** Normalize root `taxSummary`: `{ rows: [...] }`, legacy array, or JSON string. */
function normalizeTaxSummaryField(data: Record<string, unknown>): void {
  let v: unknown = data.taxSummary;
  if (v === null || v === undefined) {
    data.taxSummary = null;
    return;
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") {
      data.taxSummary = null;
      return;
    }
    try {
      v = JSON.parse(t) as unknown;
    } catch {
      data.taxSummary = t;
      return;
    }
  }
  if (Array.isArray(v)) {
    data.taxSummary = { rows: v };
    v = data.taxSummary;
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const rows = o.rows;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row && typeof row === "object" && !Array.isArray(row)) normalizeTaxSummaryRow(row as Record<string, unknown>);
      }
    }
    data.taxSummary = o;
    return;
  }
  data.taxSummary = asString(v);
}

function parseEflDigitalSignatureBlock(text: string): Record<string, string> | null {
  const m = text.match(
    /Signed\s+by\s+(.+?)\s+on\s+behalf\s+of\s+(.+?),\s*Date:\s*([^,]+),\s*(.+)/is,
  );
  if (!m?.[1] || !m[2] || !m[3] || !m[4]) return null;
  return {
    signedBy: m[1].trim(),
    onBehalfOf: m[2].trim(),
    signatureDate: m[3].trim(),
    signatureTime: m[4].trim(),
  };
}

function normalizeDigitalSignature(raw: unknown): Record<string, string | null> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    return {
      signedBy: asString(o.signedBy) ?? null,
      onBehalfOf: asString(o.onBehalfOf) ?? null,
      signatureDate: asString(o.signatureDate) ?? null,
      signatureTime: asString(o.signatureTime) ?? null,
    };
  }
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  try {
    const p = JSON.parse(t) as unknown;
    if (p && typeof p === "object" && !Array.isArray(p)) return normalizeDigitalSignature(p);
  } catch {
    /* plain text */
  }
  const block = parseEflDigitalSignatureBlock(t);
  if (block) {
    return {
      signedBy: block.signedBy,
      onBehalfOf: block.onBehalfOf,
      signatureDate: block.signatureDate,
      signatureTime: block.signatureTime,
    };
  }
  return null;
}

function normalizeFooter(o: Record<string, unknown>): void {
  for (const key of Object.keys(o)) {
    if (key === "digitalSignature") continue;
    const s = asString(o[key]);
    o[key] = s ?? null;
  }
  const ds = normalizeDigitalSignature(o.digitalSignature);
  o.digitalSignature = ds;
}

function commaStringToContainers(raw: string): Record<string, string>[] {
  const parts = raw.split(",").map((x) => x.trim()).filter((x) => x.length > 0);
  const out: Record<string, string>[] = [];
  for (const part of parts) {
    const tokens = part.split(/\s+/).filter((x) => x.length > 0);
    if (tokens.length >= 2) {
      out.push({ containerNumber: tokens[0]!, containerType: tokens.slice(1).join(" ") });
    } else if (tokens.length === 1) {
      out.push({ containerNumber: tokens[0]!, containerType: "" });
    }
  }
  return out;
}

function normalizeContainersField(data: Record<string, unknown>): void {
  const c = data.containers;
  if (c === null || c === undefined) {
    data.containers = null;
    return;
  }
  if (Array.isArray(c)) {
    for (const item of c) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const row = item as Record<string, unknown>;
        row.containerNumber = asString(row.containerNumber) ?? null;
        row.containerType = asString(row.containerType) ?? null;
      }
    }
    const tc = asString(data.totalContainers);
    if (tc == null && c.length > 0) data.totalContainers = String(c.length);
    return;
  }
  if (typeof c === "string") {
    const t = c.trim();
    if (t === "") {
      data.containers = null;
      return;
    }
    const parsed = commaStringToContainers(t);
    data.containers = parsed.length > 0 ? parsed : t;
    const tc = asString(data.totalContainers);
    if (tc == null && parsed.length > 0) data.totalContainers = String(parsed.length);
    return;
  }
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const o = c as Record<string, unknown>;
    if (asString(o.containerNumber)) {
      data.containers = [o];
      o.containerNumber = asString(o.containerNumber) ?? null;
      o.containerType = asString(o.containerType) ?? null;
      const tc = asString(data.totalContainers);
      if (tc == null) data.totalContainers = "1";
    } else {
      data.containers = null;
    }
    return;
  }
  data.containers = null;
}

function moneyToNumber(s: string | null | undefined): number | null {
  const t = asString(s);
  if (!t) return null;
  const n = Number(stripNumericCommas(t));
  return Number.isFinite(n) ? n : null;
}

/** Sum taxable + IGST + CGST + SGST for line-total fallback (PDF-first in extraction; this is post-fix only). */
function computedLineTotalInr(row: Record<string, unknown>): string | null {
  const t = moneyToNumber(asString(row.taxableAmountInr));
  if (t === null) return null;
  let sum = t;
  for (const k of ["igstAmount", "cgstAmount", "sgstAmount"] as const) {
    const n = moneyToNumber(asString(row[k]));
    if (n !== null) sum += n;
  }
  const out = normalizeMoneyString(String(sum)) ?? String(sum);
  return out || null;
}

/**
 * Prefer printed `amountInr`. Fallback: (1) missing amount → sum of taxable + taxes when components exist;
 * (2) amount equals taxable while any tax amount &gt; 0 → treat as extraction error and set sum (EFL mis-copy).
 */
function fallbackChargeLineAmountInr(row: Record<string, unknown>): void {
  const taxableStr = asString(row.taxableAmountInr);
  const igstN = moneyToNumber(asString(row.igstAmount)) ?? 0;
  const cgstN = moneyToNumber(asString(row.cgstAmount)) ?? 0;
  const sgstN = moneyToNumber(asString(row.sgstAmount)) ?? 0;
  const taxPositive = igstN + cgstN + sgstN > 0.004;

  const amountStr = asString(row.amountInr);
  if (!amountStr && taxableStr) {
    if (taxPositive) {
      const sum = computedLineTotalInr(row);
      if (sum) row.amountInr = sum;
    } else {
      row.amountInr = row.taxableAmountInr;
    }
    return;
  }
  if (!amountStr || !taxableStr || !taxPositive) return;

  const amtN = moneyToNumber(amountStr);
  const taxN = moneyToNumber(taxableStr);
  if (amtN === null || taxN === null) return;
  if (Math.abs(amtN - taxN) >= 0.01) return;

  const sum = computedLineTotalInr(row);
  if (sum) row.amountInr = sum;
}

function backfillChargeLineMeta(charges: unknown): void {
  if (!Array.isArray(charges)) return;
  for (let i = 0; i < charges.length; i++) {
    const row = charges[i];
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    if (!asString(r.lineNumber)) r.lineNumber = String(i + 1);
    if (!asString(r.taxableAmountInr) && asString(r.amountInr)) r.taxableAmountInr = r.amountInr;
  }
}

function applyChargeLineAmountInrFallbacks(charges: unknown): void {
  if (!Array.isArray(charges)) return;
  for (const row of charges) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    fallbackChargeLineAmountInr(row as Record<string, unknown>);
  }
}

export function normalizeFreightForwarderBillBody(data: Record<string, unknown>): void {
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
  if (shipment && typeof shipment === "object" && !Array.isArray(shipment)) {
    const sh = shipment as Record<string, unknown>;
    normalizeShipment(sh);
    deriveTransportModeIfMissing(sh);
    backfillShipmentHsCodeFromGoodsDescription(sh);
  }

  const cargo = data.cargo;
  if (cargo && typeof cargo === "object" && !Array.isArray(cargo)) normalizeCargo(cargo as Record<string, unknown>);

  normalizeContainersField(data);
  const cStr = asString(data.containers);
  if (typeof data.containers === "string" && cStr) {
    let tc = asString(data.totalContainers);
    if (tc == null) {
      const n = countContainersInList(cStr);
      if (n > 0) tc = String(n);
    }
    data.totalContainers = tc ?? null;
  } else if (data.totalContainers == null && Array.isArray(data.containers) && data.containers.length > 0) {
    data.totalContainers = String(data.containers.length);
  }

  const charges = data.charges;
  if (Array.isArray(charges)) {
    for (const row of charges) {
      if (row && typeof row === "object" && !Array.isArray(row)) normalizeChargeRow(row as Record<string, unknown>);
    }
    backfillChargeLineMeta(charges);
    applyChargeLineAmountInrFallbacks(charges);
  }

  normalizeTaxSummaryField(data);

  const totals = data.totals;
  if (totals && typeof totals === "object" && !Array.isArray(totals)) normalizeTotals(totals as Record<string, unknown>);

  const bank = data.bankDetails;
  if (bank && typeof bank === "object" && !Array.isArray(bank)) {
    const b = bank as Record<string, unknown>;
    normalizeBank(b);
    const ir = data.issuer;
    const issuerObj =
      ir && typeof ir === "object" && !Array.isArray(ir) ? (ir as Record<string, unknown>) : null;
    backfillBankBeneficiaryFromIssuer(b, issuerObj);
  }

  const bank2 = data.additionalBankDetails;
  if (bank2 && typeof bank2 === "object" && !Array.isArray(bank2)) normalizeBank(bank2 as Record<string, unknown>);

  const footer = data.footer;
  if (footer && typeof footer === "object" && !Array.isArray(footer)) normalizeFooter(footer as Record<string, unknown>);
}

export function normalizeStructuredFreightForwarderBillPayload(data: Record<string, unknown>): Record<string, unknown> {
  const multi = data.multiInvoice === true;
  if (multi && Array.isArray(data.invoices)) {
    for (const inv of data.invoices) {
      if (inv && typeof inv === "object" && !Array.isArray(inv))
        normalizeFreightForwarderBillBody(inv as Record<string, unknown>);
    }
  } else {
    normalizeFreightForwarderBillBody(data);
  }

  emptyStringsToNullDeep(data);
  return data;
}
