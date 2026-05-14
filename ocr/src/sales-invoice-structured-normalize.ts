/**
 * Post-process structured Sales Invoices JSON: normalized formats per project rules.
 *
 * Division of responsibility:
 * - **Model (AI)**: invoiceType banner vs “Tax Invoice” label; per-line productMarks when shown;
 *   kindOfPkg when visible on the row; buyerAddress when buyer ≠ consignee; line noOfPackages from table.
 * - **Post (this file)**: money/currency/dates/HSN/units; comma spacing on addresses; drop legacy
 *   `unitPrice`; **single-line** invoices: move `shipment.marksAndNumbers` into `lineItems[0].productMarks`
 *   when the line is blank, then set shipment marks to **null**; strip origin/cert phrasing from
 *   `productSpecification`; `digitalSignatureTimestamp` → time-only; drop removed footer keys if the model
 *   emits them; light `kindOfPkg` heuristic from `unit` / shipment text;
 *   infer `footer.receivablesAssignmentBeneficiary` from notice when notice is set but beneficiary empty;
 *   strip removed `financial.totalValueInWords` if the model emits it.
 */

const MONTH_TITLE: Record<string, string> = {
  JAN: "Jan",
  FEB: "Feb",
  MAR: "Mar",
  APR: "Apr",
  MAY: "May",
  JUN: "Jun",
  JUL: "Jul",
  AUG: "Aug",
  SEP: "Sep",
  OCT: "Oct",
  NOV: "Nov",
  DEC: "Dec",
};

function isNullish(v: unknown): v is null | undefined {
  return v == null;
}

function asString(v: unknown): string | null {
  if (isNullish(v)) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** "USA , Las Vegas , Nevada" → "USA, Las Vegas, Nevada" */
export function normalizeAddressCommaSpacing(raw: string | null): string | null {
  if (raw == null) return null;
  const parts = raw.split(",").map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Strip currency symbols, commas, spaces; keep optional leading minus and decimal. */
export function normalizeMoneyString(raw: string | null): string | null {
  if (raw == null) return null;
  let s = raw.replace(/[,\s]/g, "").replace(/[^\d.\-+eE]/g, "");
  if (s === "" || s === "." || s === "-" || s === "+") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return raw.trim();
  return String(n);
}

export function normalizeCountryString(raw: string | null): string | null {
  if (raw == null) return null;
  const u = raw.trim();
  if (!u) return null;
  const up = u.toUpperCase();
  if (up === "INDIA") return "India";
  if (up === "USA" || up === "U.S.A." || up === "US") return "United States of America";
  if (up === "UK" || up === "U.K.") return "United Kingdom";
  return u;
}

export function normalizeHsnString(raw: string | null): string | null {
  if (raw == null) return null;
  return raw.replace(/\./g, "").replace(/\s+/g, "").trim() || null;
}

export function normalizePackageCountString(raw: string | null): string | null {
  if (raw == null) return null;
  const m = raw.trim().match(/^(\d+)/);
  return m ? m[1]! : raw.trim() || null;
}

export function normalizeDinString(raw: string | null): string | null {
  if (raw == null) return null;
  return raw.replace(/^DIN[-\s]*/i, "").trim() || null;
}

export function normalizeProductCodeString(raw: string | null): string | null {
  if (raw == null) return null;
  return raw.replace(/(\d)\s+(?=\d)/g, "$1").trim() || null;
}

function cleanText(raw: unknown): string {
  const s = asString(raw);
  return s ? s.replace(/\s+/g, " ").trim() : "";
}

const PRODUCT_CODE_RE = /\b[A-Z]{1,4}(?:\.[A-Z0-9]+){3,}\b/;
const SPEC_DIMENSION_RE = /\b[WHDL]\s*\d+(?:\.\d+)?\s*[Xx]\s*\d+(?:\.\d+)?\b/;
const SPEC_MARKER_RE = /(?:^|,\s*)(HDG|GALV(?:ANIZED)?|GRADE|ASTM|OREGON|SATURN|COATED|PAINTED)\b/i;

function splitDescriptionAndSpec(raw: string): { description: string; specification: string } {
  const text = cleanText(raw);
  if (!text) return { description: "", specification: "" };

  const dim = text.match(SPEC_DIMENSION_RE);
  if (dim && typeof dim.index === "number" && dim.index > 2) {
    const description = text.slice(0, dim.index).replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
    const specification = text.slice(dim.index).replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
    if (description && specification) return { description, specification };
  }

  const marker = text.match(SPEC_MARKER_RE);
  if (marker && typeof marker.index === "number" && marker.index > 2) {
    const description = text.slice(0, marker.index).replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
    const specification = text.slice(marker.index).replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
    if (description && specification) return { description, specification };
  }

  return { description: text, specification: "" };
}

function repairLineItemCodeDescriptionSpec(row: Record<string, unknown>): void {
  let code = cleanText(row.productCode);
  let description = cleanText(row.productDescription);
  let specification = cleanText(row.productSpecification);

  if (!code) {
    const fromDescription = description.match(PRODUCT_CODE_RE);
    if (fromDescription && fromDescription.index === 0) {
      code = fromDescription[0];
      description = description.slice(code.length).replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
    } else {
      const fromSpecification = specification.match(PRODUCT_CODE_RE);
      if (fromSpecification && fromSpecification.index === 0) {
        code = fromSpecification[0];
        specification = specification.slice(code.length).replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
      }
    }
  }

  if (code) {
    const leadingCode = code.match(PRODUCT_CODE_RE);
    if (leadingCode && leadingCode.index === 0) {
      const onlyCode = leadingCode[0];
      const trailing = code.slice(onlyCode.length).replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
      code = onlyCode;
      if (trailing && !description) description = trailing;
    }
  }

  if (description) {
    const descCode = description.match(PRODUCT_CODE_RE);
    if (descCode && descCode.index === 0) {
      if (!code) code = descCode[0];
      description = description.slice(descCode[0].length).replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
    }
  }

  if (description && !specification) {
    const split = splitDescriptionAndSpec(description);
    if (split.specification) {
      description = split.description;
      specification = split.specification;
    }
  }

  row.productCode = code || null;
  row.productDescription = description || null;
  row.productSpecification = specification || null;
}

export function normalizeDateString(raw: string | null): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;

  const slash4 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash4) {
    const mm = parseInt(slash4[1]!, 10);
    const dd = parseInt(slash4[2]!, 10);
    const yyyy = slash4[3]!;
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)
      return `${String(dd).padStart(2, "0")}-${mon[mm - 1]!}-${yyyy}`;
  }

  const slash2 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (slash2) {
    const mm = parseInt(slash2[1]!, 10);
    const dd = parseInt(slash2[2]!, 10);
    const yy = parseInt(slash2[3]!, 10);
    const yyyy = String(2000 + yy);
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)
      return `${String(dd).padStart(2, "0")}-${mon[mm - 1]!}-${yyyy}`;
  }

  // DD.MM.YYYY (European / MUR Shipping etc., e.g. "29.09.2025")
  const dotDmy = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotDmy) {
    const dd = parseInt(dotDmy[1]!, 10);
    const mm = parseInt(dotDmy[2]!, 10);
    const yyyy = dotDmy[3]!;
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)
      return `${String(dd).padStart(2, "0")}-${mon[mm - 1]!}-${yyyy}`;
  }

  // MMM DD YYYY or full month name (e.g. "Oct 29 2025", "Jul 08 2025")
  const monDayYear = t.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/);
  if (monDayYear) {
    const monWord = monDayYear[1]!;
    const dd = parseInt(monDayYear[2]!, 10);
    const yyyy = monDayYear[3]!;
    const monKey = monWord.toUpperCase().slice(0, 3);
    const mon = MONTH_TITLE[monKey];
    if (mon && dd >= 1 && dd <= 31) return `${String(dd).padStart(2, "0")}-${mon}-${yyyy}`;
  }

  const parts = t.split(/[-./]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (a && b && c && /^\d{4}$/.test(c) && /[A-Za-z]{3,}/.test(b)) {
      const day = a.padStart(2, "0");
      const monKey = b.toUpperCase().slice(0, 3);
      const mon = MONTH_TITLE[monKey] ?? b.charAt(0).toUpperCase() + b.slice(1).toLowerCase();
      return `${day}-${mon}-${c}`;
    }
    // DD-MMM-YY (2-digit year, e.g. "16-Feb-26")
    if (a && b && c && /^\d{2}$/.test(c) && /[A-Za-z]{3,}/.test(b)) {
      const day = a.padStart(2, "0");
      const monKey = b.toUpperCase().slice(0, 3);
      const mon = MONTH_TITLE[monKey] ?? b.charAt(0).toUpperCase() + b.slice(1).toLowerCase();
      const yyyy = String(2000 + parseInt(c, 10));
      return `${day}-${mon}-${yyyy}`;
    }
  }
  return t;
}

function normalizeCurrencyCode(raw: string | null): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s) return null;
  if (s === "$" || /\bUSD\b/i.test(s) || /dollar/i.test(s)) return "USD";
  if (s === "₹" || s === "INR" || /rupee/i.test(s)) return "INR";
  if (s === "€" || /\bEUR\b/i.test(s)) return "EUR";
  return s.toUpperCase();
}

function normalizeUnitString(raw: string | null): string | null {
  if (raw == null) return null;
  const u = raw.trim().toUpperCase();
  if (u === "NOS" || u === "NO" || u === "NOS." || u === "PCS" || u === "PC") return "NOS";
  return u;
}

export function stripHsnFromDescription(raw: string | null): string | null {
  if (raw == null) return null;
  let s = raw;
  s = s.replace(/\b\d{4}\.\d{2}\.\d{2}\b/g, " ");
  s = s.replace(/\b\d{8,10}\b/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s || null;
}

/** Remove origin / certification prose from technical product spec (keep dimensions, grade, etc.). */
export function stripOriginCertificationFromProductSpec(raw: string | null): string | null {
  if (raw == null) return null;
  let s = raw;
  const patterns = [
    /\b100%\s*Indian\s+steel[^,;.]*(?:[,;.]|$)/gi,
    /\bsmelted\s+in\s+India[^,;.]*(?:[,;.]|$)/gi,
    /\b(?:made|manufactured|produced)\s+in\s+India[^,;.]*(?:[,;.]|$)/gi,
    /\bcountry\s+of\s+origin[^,;.]*(?:[,;.]|$)/gi,
    /\bcertificate\s+of\s+origin[^,;.]*(?:[,;.]|$)/gi,
    /\bCOO\s*[:-]\s*[^,;.]+(?:[,;.]|$)/gi,
    /\b(?:fully\s+)?Indian\s+origin[^,;.]*(?:[,;.]|$)/gi,
  ];
  for (const re of patterns) s = s.replace(re, " ");
  s = s.replace(/\s+/g, " ").replace(/^\s*[,.;]\s*|\s*[,.;]\s*$/g, "").trim();
  return s || null;
}

/** Keep clock time only (HH:MM:SS); date belongs in `digitalSignatureDate`. */
export function extractTimeOnlyFromDigitalSignatureTimestamp(raw: string | null): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;
  const matches = [...t.matchAll(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    const h = parseInt(m[1]!, 10);
    if (h < 0 || h > 23) continue;
    const mm = m[2]!;
    const ss = m[3] ?? "00";
    return `${String(h).padStart(2, "0")}:${mm}:${ss}`;
  }
  return t;
}

export function normalizeSignatureField(v: unknown): boolean | string | null {
  if (v === true || v === false) return v;
  const s = asString(v);
  if (s == null) return null;
  const low = s.toLowerCase();
  if (low === "true" || low === "yes" || low === "y" || low === "1") return true;
  if (low === "x" || low === "☒" || low === "✓" || low === "✔" || low === "checked") return true;
  if (low === "false" || low === "no" || low === "n" || low === "0") return false;
  if (/sign|stamp|authori/i.test(s)) return true;
  return s;
}

const FINANCIAL_MONEY = new Set(["totalAmount", "taxAmount", "taxableValue", "cess"]);
const LINE_MONEY = new Set(["rate", "lineTotal", "taxAmountPerLine"]);
const DATE_KEYS = new Set([
  "invoiceDate",
  "buyerPoDate",
  "shippingBillDate",
  "issueDate",
  "digitalSignatureDate",
]);
const COUNTRY_KEYS = new Set(["countryOfFinalDestination", "countryOfOrigin"]);

function stripLegacyFinancialFields(data: Record<string, unknown>): void {
  const fin = data.financial as Record<string, unknown> | undefined;
  if (fin && typeof fin === "object") delete fin.totalValueInWords;
}

/** Schema no longer includes these footer fields; drop if the model still emits them. */
function stripRemovedFooterFields(data: Record<string, unknown>): void {
  const footer = data.footer as Record<string, unknown> | undefined;
  if (!footer || typeof footer !== "object") return;
  delete footer.originStatement;
  delete footer.declaration;
  delete footer.rodtepDeclaration;
}

/**
 * If assignment clause text exists but beneficiary is empty, parse assignee name
 * (e.g. "assigned to Linklogis International Company Limited").
 */
export function inferReceivablesBeneficiaryFromNotice(notice: string | null): string | null {
  if (notice == null) return null;
  const t = notice.trim();
  if (!t) return null;

  const assigned = t.match(/\bassigned\s+to\s+(.+)/i);
  if (assigned) {
    let name = assigned[1]!.trim().replace(/\s+/g, " ");
    name = name.replace(/[.;]+$/g, "").trim();
    return name || null;
  }

  const linklogis = t.match(
    /Linklogis[\w\s]*(?:International[\w\s]*)?(?:Company[\w\s]*)?(?:Limited|Ltd\.?|Inc\.?)?/i,
  );
  if (linklogis) return linklogis[0]!.trim().replace(/\s+/g, " ");

  return null;
}

function ensureReceivablesBeneficiaryFromNotice(data: Record<string, unknown>): void {
  const footer = data.footer as Record<string, unknown> | undefined;
  if (!footer || typeof footer !== "object") return;
  const notice = asString(footer.receivablesAssignmentNotice);
  if (!notice) return;
  if (asString(footer.receivablesAssignmentBeneficiary)) return;
  const inferred = inferReceivablesBeneficiaryFromNotice(notice);
  if (inferred) footer.receivablesAssignmentBeneficiary = inferred;
}

function stripLegacyUnitPriceFromLineItems(data: Record<string, unknown>): void {
  const lineItems = data.lineItems;
  if (!Array.isArray(lineItems)) return;
  for (const row of lineItems) {
    if (row && typeof row === "object")
      delete (row as Record<string, unknown>).unitPrice;
  }
}

/**
 * Single-line invoices: marks live in `lineItems[0].productMarks` only; `shipment.marksAndNumbers` must be null.
 * If marks only appear on the shipment block, copy into the line then clear shipment.
 */
function normalizeMarksForSingleLineInvoice(data: Record<string, unknown>): void {
  const lineItems = data.lineItems as unknown[] | undefined;
  if (!Array.isArray(lineItems) || lineItems.length !== 1) return;
  const shipment = data.shipment as Record<string, unknown> | undefined;
  if (!shipment || typeof shipment !== "object") return;
  const marks = asString(shipment.marksAndNumbers);
  const row = lineItems[0] as Record<string, unknown>;
  if (row && typeof row === "object" && marks && !asString(row.productMarks)) {
    row.productMarks = marks;
  }
  shipment.marksAndNumbers = null;
}

/** If kindOfPkg still empty, infer PKGS from unit column or shipment package description. */
function inferKindOfPkgForLineItems(data: Record<string, unknown>): void {
  const lineItems = data.lineItems as unknown[] | undefined;
  if (!Array.isArray(lineItems)) return;
  const pkgDesc = asString((data.shipment as Record<string, unknown> | undefined)?.packageDescription);
  const pkgHint = pkgDesc && /\bPKGS\b/i.test(pkgDesc) ? "PKGS" : null;

  for (const raw of lineItems) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (asString(row.kindOfPkg)) continue;
    const u = asString(row.unit)?.toUpperCase() ?? "";
    if (/\bPKGS?\b/.test(u)) {
      row.kindOfPkg = "PKGS";
      continue;
    }
    if (pkgHint) row.kindOfPkg = pkgHint;
  }
}

function normalizeFlatObject(
  obj: Record<string, unknown>,
  moneyKeys: Set<string>,
): void {
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (key === "signature") {
      obj[key] = normalizeSignatureField(v) as unknown;
      continue;
    }
    const s = asString(v);
    if (s == null) continue;
    if (key === "consigneeAddress" || key === "buyerAddress") {
      obj[key] = normalizeAddressCommaSpacing(s) ?? s;
      continue;
    }
    if (moneyKeys.has(key)) obj[key] = normalizeMoneyString(s) ?? s;
    else if (DATE_KEYS.has(key)) obj[key] = normalizeDateString(s) ?? s;
    else if (COUNTRY_KEYS.has(key)) obj[key] = normalizeCountryString(s) ?? s;
    else if (key === "currency") obj[key] = normalizeCurrencyCode(s) ?? s;
    else if (key === "unit") obj[key] = normalizeUnitString(s) ?? s;
    else if (key === "hsnCode" || key === "hsnCodeDestination")
      obj[key] = normalizeHsnString(s) ?? s;
    else if (key === "noOfPackages") obj[key] = normalizePackageCountString(s) ?? s;
    else if (key === "dinNumber") obj[key] = normalizeDinString(s) ?? s;
    else if (key === "productCode") obj[key] = normalizeProductCodeString(s) ?? s;
    else if (key === "productDescription") obj[key] = stripHsnFromDescription(s) ?? s;
    else if (key === "productSpecification")
      obj[key] = stripOriginCertificationFromProductSpec(s) ?? s;
    else if (key === "digitalSignatureTimestamp")
      obj[key] = extractTimeOnlyFromDigitalSignatureTimestamp(s) ?? s;
    else if (key === "taxRate") obj[key] = s.replace(/%/g, "").trim() || s;
  }
}

export function normalizeStructuredSalesInvoicePayload(
  data: Record<string, unknown>,
): Record<string, unknown> {
  stripLegacyFinancialFields(data);
  stripRemovedFooterFields(data);
  stripLegacyUnitPriceFromLineItems(data);
  normalizeMarksForSingleLineInvoice(data);
  ensureReceivablesBeneficiaryFromNotice(data);
  inferKindOfPkgForLineItems(data);

  const financial = data.financial;
  if (financial && typeof financial === "object" && !Array.isArray(financial))
    normalizeFlatObject(financial as Record<string, unknown>, FINANCIAL_MONEY);

  const header = data.header;
  if (header && typeof header === "object" && !Array.isArray(header))
    normalizeFlatObject(header as Record<string, unknown>, new Set());

  const footer = data.footer;
  if (footer && typeof footer === "object" && !Array.isArray(footer))
    normalizeFlatObject(footer as Record<string, unknown>, new Set());

  const shipment = data.shipment;
  if (shipment && typeof shipment === "object" && !Array.isArray(shipment))
    normalizeFlatObject(shipment as Record<string, unknown>, new Set());

  const compliance = data.compliance;
  if (compliance && typeof compliance === "object" && !Array.isArray(compliance))
    normalizeFlatObject(compliance as Record<string, unknown>, new Set());

  const entities = data.entities;
  if (entities && typeof entities === "object" && !Array.isArray(entities))
    normalizeFlatObject(entities as Record<string, unknown>, new Set());

  const lineItems = data.lineItems;
  if (Array.isArray(lineItems)) {
    for (const row of lineItems) {
      if (row && typeof row === "object") {
        repairLineItemCodeDescriptionSpec(row as Record<string, unknown>);
        normalizeFlatObject(row as Record<string, unknown>, LINE_MONEY);
      }
    }
  }

  return data;
}
