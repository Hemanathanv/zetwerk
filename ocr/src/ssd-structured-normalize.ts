/**
 * Post-process structured Steel Supplier Declaration JSON.
 */

import {
  normalizeDateString,
  normalizeDinString,
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

/** Strip "$" / "USD" currency prefix from monetary strings. */
function stripCurrencyPrefix(s: string): string {
  return s.replace(/^\s*\$\s*/, "").replace(/^\s*USD\s*/i, "").trim();
}

/**
 * Strip "Kgs" / "kg" / "KGS" suffix and thousands commas from weight strings.
 * "88,320.00 Kgs" → "88320.00"   "27360.00 Kgs" → "27360.00"
 */
function stripWeightSuffix(s: string): string {
  return s.replace(/\s*[Kk][Gg][Ss]?\s*$/, "").replace(/,/g, "").trim();
}

/** Normalize a US HTSUS code — keep dots, strip extra spaces. */
function normalizeUsShtCode(raw: string): string | null {
  if (!raw.trim()) return null;
  return raw.trim();
}

/**
 * Expand abbreviated invoice numbers.
 * "EXP/1038,1042,1057" → ["EXP/1038","EXP/1042","EXP/1057"]
 * "KA/UM/2526/00616,615,632" → ["KA/UM/2526/00616","KA/UM/2526/00615","KA/UM/2526/00632"]
 */
function expandInvoiceNumbers(raw: string): string[] | null {
  const t = raw.trim();
  if (!t) return null;
  const parts = t.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return [parts[0]!];

  const first = parts[0]!;
  // Extract prefix (everything up to and including last "/" before the numeric tail)
  const prefixMatch = first.match(/^(.*\/)(\d+)$/);
  if (!prefixMatch) {
    // Can't determine prefix — return as-is
    return parts;
  }
  const prefix = prefixMatch[1]!;
  const firstNum = prefixMatch[2]!;
  const padLen = firstNum.length;

  return parts.map((p, i) => {
    if (i === 0) return first;
    // If already looks like a full number (contains "/"), keep as-is
    if (p.includes("/")) return p;
    // Pad to match first number length if needed
    const padded = p.padStart(padLen, "0");
    return prefix + padded;
  });
}

function normalizeProductRow(row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    const v = row[key];

    if (key === "containsSteel" || key === "meltedPouredInUs") {
      row[key] = normalizeSignatureField(v) as unknown;
      continue;
    }

    if (key === "invoiceNumbers") {
      // Already an array or null — validate/expand if it's a string
      if (typeof v === "string") {
        const s = v.trim();
        row[key] = s ? expandInvoiceNumbers(s) : null;
      }
      continue;
    }

    if (key === "invoiceNumbersRaw") {
      const s = asString(v);
      row[key] = s ?? null;
      continue;
    }

    const s = asString(v);
    if (s == null) continue;

    if (key === "usHtsCode") {
      row[key] = normalizeUsShtCode(s);
    } else if (key === "partNumber") {
      // Remove spaces introduced by line-wrapping (e.g. "CB141. 6085" → "CB141.6085")
      row[key] = s.replace(/\.\s+/g, ".").replace(/\s+\./g, ".");
    } else if (
      key === "finishedPartPriceUsd" ||
      key === "steelContentValueUsd"
    ) {
      const stripped = stripCurrencyPrefix(s);
      row[key] = normalizeMoneyString(stripped) ?? (stripped || null);
    } else if (key === "steelContentWeightKg") {
      const stripped = stripWeightSuffix(s);
      row[key] = normalizeMoneyString(stripped) ?? (stripped || null);
    } else {
      row[key] = s;
    }
  }
}

function normalizeCertification(cert: Record<string, unknown>): void {
  for (const key of Object.keys(cert)) {
    const v = cert[key];

    if (key === "signature") {
      cert[key] = normalizeSignatureField(v) as unknown;
      continue;
    }

    const s = asString(v);
    if (s == null) {
      cert[key] = null;
      continue;
    }

    if (key === "certificationDate") {
      cert[key] = normalizeDateString(s) ?? s;
    } else if (key === "stampDinNumber") {
      cert[key] = normalizeDinString(s.replace(/^DIN[-\s]*/i, "")) ?? s.replace(/^DIN[-\s]*/i, "");
    } else {
      cert[key] = s;
    }
  }
}

function normalizeReferenceInvoiceRow(row: Record<string, unknown>): void {
  for (const key of Object.keys(row)) {
    const v = row[key];
    if (key === "invoiceDate") {
      // null is valid — Zetwerk inline-list format has no dates
      if (v === null || v === undefined) { row[key] = null; continue; }
      const s = asString(v);
      row[key] = s ? (normalizeDateString(s) ?? s) : null;
      continue;
    }
    const s = asString(v);
    if (s == null) { row[key] = null; continue; }
    row[key] = s;
  }
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

/** Apply all normalization rules to a parsed SSD payload in-place. */
export function normalizeStructuredSsdPayload(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const company = data.company as Record<string, unknown> | undefined;
  if (company && typeof company === "object" && !Array.isArray(company)) {
    normalizeCompany(company);
  }

  const products = data.products;
  if (Array.isArray(products)) {
    for (const p of products) {
      if (p && typeof p === "object" && !Array.isArray(p)) {
        normalizeProductRow(p as Record<string, unknown>);
      }
    }
  }

  const certification = data.certification as Record<string, unknown> | undefined;
  if (certification && typeof certification === "object" && !Array.isArray(certification)) {
    normalizeCertification(certification);
  }

  const referenceInvoices = data.referenceInvoices;
  if (Array.isArray(referenceInvoices)) {
    for (const r of referenceInvoices) {
      if (r && typeof r === "object" && !Array.isArray(r)) {
        normalizeReferenceInvoiceRow(r as Record<string, unknown>);
      }
    }
  }

  return data;
}
