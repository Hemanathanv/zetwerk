/**
 * Post-process structured Entry Summary JSON (CBP-style).
 */

import {
  normalizeAddressCommaSpacing,
  normalizeDateString,
  normalizeHsnString,
  normalizeMoneyString,
  normalizeSignatureField,
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

const DATE_KEYS = new Set([
  "summaryDate",
  "entryDate",
  "importDate",
  "exportDate",
  "itDate",
  "declarantDate",
]);

const ADDRESS_KEYS = new Set([
  "ultimateConsigneeAddress",
  "importerOfRecordAddress",
  "brokerAddress",
]);

const HEADER_MONEY = new Set<string>(["invValUs", "entval"]);
const TRANSPORT_MONEY = new Set<string>();

const PARTIES_MONEY = new Set<string>();

const LINE_MONEY = new Set([
  "grossWeightKg",
  "netQuantity",
  "enteredValue",
  "htsusDuty",
  "invoiceValueUsd",
  "deductionCharge",
  "totalEnteredValueInvoice",
  "mpfAmount",
  "hmfAmount",
]);

const TARIFF_MONEY = new Set([
  "grossWeight",
  "netQuantity",
  "enteredValue",
  "dutyAmount",
]);

const FEES_MONEY = new Set(["mpfTotal", "hmfTotal", "totalOtherFees"]);

const TOTALS_MONEY = new Set([
  "totalEnteredValue",
  "totalDuty",
  "totalTax",
  "totalOther",
  "grandTotal",
]);

const RATE_KEYS = new Set([
  "htsusRate",
  "mpfRate",
  "hmfRate",
  "rate",
]);

const PACKAGE_UNIT_KEYS = new Set(["totalPackage"]);

function tariffEnteredValueNumeric(v: unknown): number {
  const s = asString(v);
  if (s == null) return NaN;
  const cleaned = s.replace(/,/g, "").replace(/^\$/, "").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function htsDigitCount(row: Record<string, unknown>): number {
  const h = asString(row.htsusNumber);
  if (h == null) return 0;
  return (h.match(/\d/g) ?? []).length;
}

/** Prefer the merchandise row (largest entered value; tie-breaker: richer HTS digits). */
function primaryTariffLineIndex(lines: Record<string, unknown>[]): number {
  if (lines.length === 0) return -1;
  if (lines.length === 1) return 0;
  let bestI = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < lines.length; i++) {
    const n = tariffEnteredValueNumeric(lines[i]!.enteredValue);
    if (!Number.isFinite(n)) continue;
    if (
      n > bestVal ||
      (n === bestVal && htsDigitCount(lines[i]!) > htsDigitCount(lines[bestI]!))
    ) {
      bestVal = n;
      bestI = i;
    }
  }
  if (Number.isFinite(bestVal) && bestVal > -Infinity) return bestI;
  let bestHts = htsDigitCount(lines[0]!);
  for (let i = 1; i < lines.length; i++) {
    const L = htsDigitCount(lines[i]!);
    if (L > bestHts) {
      bestHts = L;
      bestI = i;
    }
  }
  return bestHts >= 6 ? bestI : 0;
}

/** Merchandise-row "17496.00 KG" in grossWeight is net quantity, not gross. */
function moveKgFromGrossToNetIfNeeded(row: Record<string, unknown>): void {
  const netEmpty = asString(row.netQuantity) == null;
  if (!netEmpty) return;
  const gwRaw = asString(row.grossWeight);
  if (gwRaw == null) return;
  const m = gwRaw.match(/^([\d,]+(?:\.\d+)?)\s*(?:KG|KGS)\b/i);
  if (!m) return;
  row.netQuantity = m[1]!.replace(/,/g, "");
  row.grossWeight = null;
}

function syncLineItemParentFromPrimaryTariff(
  row: Record<string, unknown>,
  primaryIdx: number,
): void {
  const tl = row.tariffLines;
  if (!Array.isArray(tl) || primaryIdx < 0 || primaryIdx >= tl.length) return;
  const p = tl[primaryIdx];
  if (!p || typeof p !== "object" || Array.isArray(p)) return;
  const pr = p as Record<string, unknown>;
  const hts = pr.htsusNumber;
  const desc = pr.description;
  const ev = pr.enteredValue;
  const nq = pr.netQuantity;
  const nqu = pr.netQuantityUnit;
  if (hts != null && String(hts).trim() !== "") row.htsusNumber = hts;
  if (desc != null && String(desc).trim() !== "") row.merchandiseDescription = desc;
  if (ev != null && String(ev).trim() !== "") row.enteredValue = ev;
  if (nq != null && String(nq).trim() !== "") row.netQuantity = nq;
  if (nqu != null && String(nqu).trim() !== "") row.netQuantityUnit = nqu;
}

function normalizeLineItemTariffParentFields(row: Record<string, unknown>): void {
  const tl = row.tariffLines;
  if (!Array.isArray(tl) || tl.length === 0) return;
  const lines = tl.filter(
    (t): t is Record<string, unknown> =>
      Boolean(t) && typeof t === "object" && !Array.isArray(t),
  ) as Record<string, unknown>[];
  if (lines.length === 0) return;
  const idx = primaryTariffLineIndex(lines);
  if (idx < 0) return;
  // Use same index into row.tariffLines (filtered list may omit holes; indices must align).
  const tlArr = tl as unknown[];
  let objectIndex = -1;
  let tlIdx = -1;
  for (let i = 0; i < tlArr.length; i++) {
    const t = tlArr[i];
    if (t && typeof t === "object" && !Array.isArray(t)) {
      objectIndex += 1;
      if (objectIndex === idx) {
        tlIdx = i;
        break;
      }
    }
  }
  if (tlIdx < 0) return;
  moveKgFromGrossToNetIfNeeded(tlArr[tlIdx] as Record<string, unknown>);
  syncLineItemParentFromPrimaryTariff(row, tlIdx);
}

/** Recursively turn "" into null (optional fields should not use empty strings). */
function emptyStringsToNullDeep(value: unknown): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const el = value[i];
      if (el === "") value[i] = null;
      else emptyStringsToNullDeep(el);
    }
    return;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v === "") o[k] = null;
      else emptyStringsToNullDeep(v);
    }
  }
}

function normalizeHtsus(raw: string | null): string | null {
  if (raw == null) return null;
  const fromHsn = normalizeHsnString(raw);
  if (fromHsn != null) return fromHsn;
  const t = raw.trim();
  return t || null;
}

function normalizeFlatSection(
  obj: Record<string, unknown>,
  moneyKeys: Set<string>,
  htsusKeys: Set<string>,
): void {
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (key === "isOwner" || key === "isPurchase") {
      const b = normalizeSignatureField(v);
      obj[key] = typeof b === "boolean" ? b : v === null ? null : b;
      continue;
    }
    const s = asString(v);
    if (s == null) continue;
    if (ADDRESS_KEYS.has(key)) obj[key] = normalizeAddressCommaSpacing(s) ?? s;
    else if (DATE_KEYS.has(key)) obj[key] = normalizeDateString(s) ?? s;
    else if (htsusKeys.has(key)) obj[key] = normalizeHtsus(s) ?? s;
    else if (PACKAGE_UNIT_KEYS.has(key)) obj[key] = normalizePackageToken(s) ?? s;
    else if (moneyKeys.has(key) || RATE_KEYS.has(key))
      obj[key] = normalizeMoneyString(s) ?? s;
    else obj[key] = s;
  }
}

function normalizePackageToken(raw: string | null): string | null {
  if (raw == null) return null;
  const t = raw.trim().toUpperCase();
  if (!t) return null;
  const m = t.match(/^(\d+)\s*([A-Z]{2,4})$/);
  if (!m) return raw.trim();
  const unit = m[2]!;
  if (!["PKG", "PCS", "BDL"].includes(unit)) return `${m[1]} ${unit}`;
  return `${m[1]} ${unit}`;
}

function normalizeTariffRow(row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    const v = row[key];
    const s = asString(v);
    if (s == null && v !== null && v !== undefined) continue;
    if (s == null) continue;
    if (key === "htsusNumber") row[key] = normalizeHtsus(s) ?? s;
    else if (TARIFF_MONEY.has(key) || key === "rate")
      row[key] = normalizeMoneyString(s) ?? s;
    else row[key] = s;
  }
}

function normalizeLineRow(row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    if (key === "tariffLines") continue;
    const v = row[key];
    const s = asString(v);
    if (s == null && v !== null) continue;
    if (s == null) continue;
    if (key === "htsusNumber") row[key] = normalizeHtsus(s) ?? s;
    else if (LINE_MONEY.has(key) || RATE_KEYS.has(key))
      row[key] = normalizeMoneyString(s) ?? s;
    else row[key] = s;
  }
  const tl = row.tariffLines;
  if (Array.isArray(tl)) {
    for (const t of tl) {
      if (t && typeof t === "object" && !Array.isArray(t))
        normalizeTariffRow(t as Record<string, unknown>);
    }
  }
}

const HTSUS_HEADER = new Set<string>();
const HTSUS_TRANSPORT = new Set<string>();
const HTSUS_PARTIES = new Set<string>();

export function normalizeStructuredEntrySummaryPayload(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const lineItemsPre = data.lineItems;
  if (Array.isArray(lineItemsPre)) {
    for (const raw of lineItemsPre) {
      if (raw && typeof raw === "object" && !Array.isArray(raw))
        normalizeLineItemTariffParentFields(raw as Record<string, unknown>);
    }
  }

  const header = data.header as Record<string, unknown> | undefined;
  if (header && typeof header === "object" && !Array.isArray(header))
    normalizeFlatSection(header, HEADER_MONEY, HTSUS_HEADER);

  const transport = data.transport as Record<string, unknown> | undefined;
  if (transport && typeof transport === "object" && !Array.isArray(transport))
    normalizeFlatSection(transport, TRANSPORT_MONEY, HTSUS_TRANSPORT);

  const parties = data.parties as Record<string, unknown> | undefined;
  if (parties && typeof parties === "object" && !Array.isArray(parties))
    normalizeFlatSection(parties, PARTIES_MONEY, HTSUS_PARTIES);

  const tradeCompliance = data.tradeCompliance as Record<string, unknown> | undefined;
  if (
    tradeCompliance &&
    typeof tradeCompliance === "object" &&
    !Array.isArray(tradeCompliance)
  ) {
    normalizeFlatSection(tradeCompliance, new Set(), new Set());
  }

  const fees = data.fees as Record<string, unknown> | undefined;
  if (fees && typeof fees === "object" && !Array.isArray(fees))
    normalizeFlatSection(fees, FEES_MONEY, new Set());

  const totals = data.totals as Record<string, unknown> | undefined;
  if (totals && typeof totals === "object" && !Array.isArray(totals))
    normalizeFlatSection(totals, TOTALS_MONEY, new Set());

  const declarant = data.declarant as Record<string, unknown> | undefined;
  if (declarant && typeof declarant === "object" && !Array.isArray(declarant))
    normalizeFlatSection(declarant, new Set(), new Set());

  const broker = data.broker as Record<string, unknown> | undefined;
  if (broker && typeof broker === "object" && !Array.isArray(broker))
    normalizeFlatSection(broker, new Set(), new Set());

  const lineItems = data.lineItems;
  if (Array.isArray(lineItems)) {
    for (const raw of lineItems) {
      if (raw && typeof raw === "object" && !Array.isArray(raw))
        normalizeLineRow(raw as Record<string, unknown>);
    }
  }

  emptyStringsToNullDeep(data);

  return data;
}
