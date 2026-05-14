/**
 * Post-process Bill of Lading structured JSON (snake_case): dates toward ISO, null cleanup, empty nested objects.
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

/** DD-Mon-YYYY (from normalizeDateString) → YYYY-MM-DD when parseable. */
function toIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const n = normalizeDateString(t);
  if (!n) return t;
  const m = n.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return n;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = months.indexOf(m[2]!);
  if (mi < 0) return n;
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1]}`;
}

function normalizeDateField(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  return toIsoDate(s) ?? normalizeDateString(s) ?? s;
}

function normalizeScalarObject(o: Record<string, unknown>, dateKeys: Set<string>): void {
  for (const key of Object.keys(o)) {
    const v = o[key];
    if (dateKeys.has(key)) {
      o[key] = normalizeDateField(v);
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) continue;
    if (v === null || v === undefined) {
      o[key] = null;
      continue;
    }
    o[key] = asString(v);
  }
}

function pruneEmptyNestedObject(o: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!o || typeof o !== "object") return null;
  let any = false;
  for (const v of Object.values(o)) {
    if (v != null && v !== "") {
      any = true;
      break;
    }
  }
  return any ? o : null;
}

function peekDocumentFormatFamily(data: Record<string, unknown>): string | null {
  const m = data._extraction_metadata;
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  return asString((m as Record<string, unknown>).document_format_family);
}

function isCongenOrGenwayFamily(family: string | null): boolean {
  if (!family) return false;
  const u = family.toUpperCase();
  return u === "CONGENBILL_CHARTER" || u === "GENWAYBILL_2016";
}

/** Strip negotiability / merged headings from document_title (v1.2 post-process). */
function clampDocumentTitle(title: string | null): string | null {
  if (!title) return null;
  let t = title.replace(/\s+/g, " ").trim();
  const patterns = [
    /\s+NON[\s\-]?NEGOTIABLE\b/i,
    /\s+TO BE USED WITH CHARTER PARTIES\b/i,
    /\s+GENERAL SEAWAYBILL\b/i,
    /\s+\/\s*DOCUMENT MULTIMODAL\b/i,
    /\s+DOCUMENT MULTIMODAL TRANSPORT\b/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.index != null && m.index > 0) {
      t = t.slice(0, m.index).trim();
      break;
    }
  }
  if (t.length > 30) {
    const idx = t.search(/\s+(?:NON|TO BE)\b/i);
    if (idx > 0) t = t.slice(0, idx).trim();
    else t = t.slice(0, 30).trim();
  }
  return t || null;
}

function stripFmcPrefix(raw: string): string {
  return raw.replace(/^FMC[\s.\-]*(?:No\.?|OTI\s*(?:NO\.?)?\s*)?/i, "").trim();
}

/** Map common container type strings to 40HC / 20GP. */
function normalizeBolContainerType(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const u = s.toUpperCase().replace(/[''`´]/g, "").replace(/\s+/g, " ").trim();
  if (/\b20\b/.test(u) && (/\bGP\b|\bDV\b|FCL|20\s*GP|\b20'/.test(u) || /^20[\s']/i.test(s))) return "20GP";
  if (
    /\b40\b/.test(u) &&
    (/\bHC\b|\bHQ\b|HIGH\s*CUBE|HIGHCUBE|FCL|\b40HC\b|40\s*'|40'/.test(u) || /^40[\s']/i.test(s))
  )
    return "40HC";
  if (/^40HC$/i.test(s.trim())) return "40HC";
  if (/^20GP$/i.test(s.trim())) return "20GP";
  return s;
}

function filterAndDedupeShippingBills(data: Record<string, unknown>): void {
  const sba = data.shipping_bills;
  if (!Array.isArray(sba)) return;
  const dedupe = isCongenOrGenwayFamily(peekDocumentFormatFamily(data));
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of sba) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const num = asString(r.shipping_bill_number);
    if (!num) continue;
    if (dedupe) {
      const key = num.toUpperCase().replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(r);
  }
  data.shipping_bills = out;
}

function applyCongenGenwayShippedOnBoardFallback(data: Record<string, unknown>): void {
  if (!isCongenOrGenwayFamily(peekDocumentFormatFamily(data))) return;
  const vessel = data.vessel as Record<string, unknown> | undefined;
  if (!vessel) return;
  if (asString(vessel.shipped_on_board_date)) return;
  const issuance = data.issuance as Record<string, unknown> | undefined;
  const issueDate = issuance ? asString(issuance.date) : null;
  const cp = issuance ? asString(issuance.charter_party_date) : null;
  if (issueDate) vessel.shipped_on_board_date = issueDate;
  else if (cp) vessel.shipped_on_board_date = cp;
}

function sanitizeFreightCharterBoilerplate(data: Record<string, unknown>): void {
  const fr = data.freight as Record<string, unknown> | undefined;
  if (!fr) return;
  const p = asString(fr.payable_at);
  if (!p) return;
  const lower = p.toLowerCase();
  if (
    lower.includes("accordance therewith") ||
    /^charter party dated\b/i.test(p) ||
    (lower.includes("charter party") && p.length > 40)
  ) {
    fr.payable_at = "AS PER CHARTER PARTY";
    if (!asString(fr.freight_type)) fr.freight_type = "AS PER CHARTER PARTY";
  }
}

const VESSEL_DATE_KEYS = new Set(["shipped_on_board_date"]);
const ISSUANCE_DATE_KEYS = new Set(["date", "charter_party_date"]);
/** When model used one array: first rows invoice-only, later rows SB-only — split into parallel arrays. */
function trySplitInterleavedInvoiceSbRows(rows: Record<string, unknown>[]): { invoices: Record<string, unknown>[]; shipping_bills: Record<string, unknown>[] } | null {
  let splitAt = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const hasInv = Boolean(asString(r.invoice_number) || r.invoice_date != null && String(r.invoice_date).trim() !== "");
    const hasSb = Boolean(asString(r.shipping_bill_number) || r.shipping_bill_date != null && String(r.shipping_bill_date).trim() !== "");
    if (hasSb && !hasInv) {
      splitAt = i;
      break;
    }
  }
  if (splitAt <= 0 || splitAt >= rows.length) return null;
  const invPart = rows.slice(0, splitAt);
  const sbPart = rows.slice(splitAt);
  const invClean = invPart.every((r) => !asString(r.shipping_bill_number) && (r.shipping_bill_date == null || String(r.shipping_bill_date).trim() === ""));
  const sbClean = sbPart.every((r) => !asString(r.invoice_number) && (r.invoice_date == null || String(r.invoice_date).trim() === ""));
  if (!invClean || !sbClean) return null;
  return {
    invoices: invPart.map((r) => ({ invoice_number: r.invoice_number ?? "", invoice_date: r.invoice_date ?? null })),
    shipping_bills: sbPart.map((r) => ({
      shipping_bill_number: r.shipping_bill_number ?? "",
      shipping_bill_date: r.shipping_bill_date ?? null,
    })),
  };
}

/** Legacy rows with both invoice + SB on same object → parallel arrays. */
function pairRowsToParallelArrays(rows: Record<string, unknown>[]): {
  invoices: Record<string, unknown>[];
  shipping_bills: Record<string, unknown>[];
} {
  const invoices: Record<string, unknown>[] = [];
  const shipping_bills: Record<string, unknown>[] = [];
  for (const r of rows) {
    invoices.push({ invoice_number: r.invoice_number ?? "", invoice_date: r.invoice_date ?? null });
    shipping_bills.push({
      shipping_bill_number: r.shipping_bill_number ?? "",
      shipping_bill_date: r.shipping_bill_date ?? null,
    });
  }
  return { invoices, shipping_bills };
}

function migrateInvoicesAndShippingBills(data: Record<string, unknown>): void {
  const hasSbArray = Array.isArray(data.shipping_bills) && (data.shipping_bills as unknown[]).length > 0;
  const inv = data.invoices;
  if (!Array.isArray(inv)) {
    data.invoices = [];
    if (!hasSbArray) data.shipping_bills = [];
    return;
  }
  const rows = inv.filter((r) => r && typeof r === "object" && !Array.isArray(r)) as Record<string, unknown>[];
  const anySbOnInvoice = rows.some((r) => asString(r.shipping_bill_number) || (r.shipping_bill_date != null && String(r.shipping_bill_date).trim() !== ""));

  if (hasSbArray && !anySbOnInvoice) return;

  if (hasSbArray && anySbOnInvoice) {
    for (const row of rows) {
      delete row.shipping_bill_number;
      delete row.shipping_bill_date;
    }
    data.invoices = rows;
    return;
  }

  if (anySbOnInvoice) {
    const split = trySplitInterleavedInvoiceSbRows(rows);
    if (split) {
      data.invoices = split.invoices;
      data.shipping_bills = split.shipping_bills;
      return;
    }
    const paired = pairRowsToParallelArrays(rows);
    data.invoices = paired.invoices;
    data.shipping_bills = paired.shipping_bills;
    return;
  }

  if (!hasSbArray) data.shipping_bills = [];
}

function normalizeInvoiceRow(row: Record<string, unknown>): void {
  row.invoice_number = asString(row.invoice_number) ?? "";
  row.invoice_date = normalizeDateField(row.invoice_date);
  delete row.shipping_bill_number;
  delete row.shipping_bill_date;
}

function normalizeShippingBillRow(row: Record<string, unknown>): void {
  row.shipping_bill_number = asString(row.shipping_bill_number) ?? "";
  row.shipping_bill_date = normalizeDateField(row.shipping_bill_date);
  delete row.invoice_number;
  delete row.invoice_date;
}

function splitVesselNameIfCombined(vessel: Record<string, unknown>): void {
  const name = asString(vessel.name);
  const voy = asString(vessel.voyage_number);
  if (!name || voy) return;
  const sep = " / ";
  const idx = name.indexOf(sep);
  if (idx < 0) return;
  const left = name.slice(0, idx).trim();
  const right = name.slice(idx + sep.length).trim();
  if (left && right) {
    vessel.name = left;
    vessel.voyage_number = right;
  }
}

function normalizeExtractionMetadataBlock(data: Record<string, unknown>): void {
  let meta = data._extraction_metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    data._extraction_metadata = { document_format_family: null, confidence_score: null, page_count: null };
    meta = data._extraction_metadata as Record<string, unknown>;
  }
  const m = meta as Record<string, unknown>;
  m.document_format_family = asString(m.document_format_family) ?? null;
  if (m.confidence_score != null && m.confidence_score !== "") {
    const n = typeof m.confidence_score === "number" ? m.confidence_score : Number(m.confidence_score);
    m.confidence_score = Number.isFinite(n) ? n : null;
  } else m.confidence_score = null;
  if (m.page_count != null && m.page_count !== "") {
    const n = typeof m.page_count === "number" ? m.page_count : parseInt(String(m.page_count), 10);
    m.page_count = Number.isFinite(n) ? n : null;
  } else m.page_count = null;
}

export interface BillOfLadingPipelineMeta {
  pdfPath?: string;
  schemaJsonPath?: string;
  modelUsed?: string;
  pdfEngine?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string | undefined;
  extractionMode?: string;
  valueNormalization?: string;
  usage?: Record<string, unknown>;
  extractionDateIso?: string;
}

/** Merge run / pipeline fields into `_extraction_metadata` (model may already set document_format_family, etc.). */
export function mergeBillOfLadingPipelineIntoMetadata(parsed: Record<string, unknown>, pipeline: BillOfLadingPipelineMeta): void {
  normalizeExtractionMetadataBlock(parsed);
  const m = parsed._extraction_metadata as Record<string, unknown>;
  if (pipeline.pdfPath !== undefined) m.source_filename = pipeline.pdfPath;
  if (pipeline.schemaJsonPath !== undefined) m.schema_json_path = pipeline.schemaJsonPath;
  if (pipeline.modelUsed !== undefined) m.model_used = pipeline.modelUsed;
  if (pipeline.pdfEngine !== undefined) m.pdf_engine = pipeline.pdfEngine;
  if (pipeline.temperature !== undefined) m.temperature = pipeline.temperature;
  if (pipeline.maxTokens !== undefined) m.max_tokens = pipeline.maxTokens;
  if (pipeline.reasoningEffort !== undefined) m.reasoning_effort = pipeline.reasoningEffort ?? null;
  if (pipeline.extractionMode !== undefined) m.extraction_mode = pipeline.extractionMode;
  if (pipeline.valueNormalization !== undefined) m.value_normalization = pipeline.valueNormalization;
  if (pipeline.usage !== undefined) m.usage = pipeline.usage ?? null;
  m.extraction_date = pipeline.extractionDateIso ?? new Date().toISOString();
}

function normalizeContainerRow(row: Record<string, unknown>): void {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (k === "type") {
      row[k] = normalizeBolContainerType(v);
      continue;
    }
    if (k === "gross_weight_kg" || k === "net_weight_kg" || k === "volume_cbm" || k === "packages") {
      if (typeof v === "number" && Number.isFinite(v)) continue;
      const s = asString(v);
      if (!s) {
        row[k] = null;
        continue;
      }
      const m = normalizeMoneyString(stripNumericCommas(s));
      const n = m != null ? Number(m) : Number(stripNumericCommas(s));
      row[k] = Number.isFinite(n) ? n : null;
      continue;
    }
    row[k] = asString(v) ?? v;
  }
}

function normalizeCargoBlock(c: Record<string, unknown>): void {
  for (const key of Object.keys(c)) {
    const v = c[key];
    if (key === "total_packages" || key === "total_containers") {
      if (typeof v === "number" && Number.isFinite(v)) continue;
      const s = asString(v);
      if (!s) {
        c[key] = null;
        continue;
      }
      const n = parseInt(stripNumericCommas(s), 10);
      c[key] = Number.isFinite(n) ? n : null;
      continue;
    }
    if (key === "gross_weight" || key === "net_weight" || key === "measurement_cbm") {
      if (typeof v === "number" && Number.isFinite(v)) continue;
      const s = asString(v);
      if (!s) {
        c[key] = null;
        continue;
      }
      const m = normalizeMoneyString(stripNumericCommas(s));
      const n = m != null ? Number(m) : Number(stripNumericCommas(s));
      c[key] = Number.isFinite(n) ? n : null;
      continue;
    }
    c[key] = asString(v) ?? v;
  }
  const u = asString(c.gross_weight_unit);
  if (u) {
    const up = u.toUpperCase();
    if (up === "KG") c.gross_weight_unit = "KGS";
    else c.gross_weight_unit = up;
  }
  const nu = asString(c.net_weight_unit);
  if (nu) {
    const up = nu.toUpperCase();
    c.net_weight_unit = up === "KG" ? "KGS" : up;
  }
}

export function normalizeBillOfLadingBody(data: Record<string, unknown>): void {
  migrateInvoicesAndShippingBills(data);

  const rawDocumentTitle = asString(data.document_title);
  data.negotiability = asString(data.negotiability) ?? null;
  if (!data.negotiability && rawDocumentTitle) {
    const tl = rawDocumentTitle.toLowerCase();
    if (tl.includes("to be used with charter parties")) data.negotiability = "TO BE USED WITH CHARTER PARTIES";
    else if (/\bseaway\s*(bill|bl)\b/i.test(tl) || /\bseaway bl\b/i.test(tl)) data.negotiability = "NON-NEGOTIABLE";
  }
  data.document_title = clampDocumentTitle(rawDocumentTitle) ?? null;
  data.bol_number = asString(data.bol_number) ?? null;
  data.shipment_reference_number = asString(data.shipment_reference_number) ?? null;
  data.project_name = asString(data.project_name) ?? null;
  data.ships_remarks = asString(data.ships_remarks) ?? null;

  const carrier = data.carrier;
  if (carrier && typeof carrier === "object" && !Array.isArray(carrier)) {
    normalizeScalarObject(carrier as Record<string, unknown>, new Set());
    const cr = carrier as Record<string, unknown>;
    const fmc = asString(cr.fmc_number);
    if (fmc) cr.fmc_number = stripFmcPrefix(fmc) || fmc;
  }

  for (const key of ["shipper", "consignee", "notify_party"] as const) {
    const o = data[key];
    if (o && typeof o === "object" && !Array.isArray(o)) normalizeScalarObject(o as Record<string, unknown>, new Set());
  }

  const sn = data.second_notify_party;
  if (sn && typeof sn === "object" && !Array.isArray(sn)) {
    normalizeScalarObject(sn as Record<string, unknown>, new Set());
    data.second_notify_party = pruneEmptyNestedObject(sn as Record<string, unknown>);
  } else if (sn === undefined) data.second_notify_party = null;

  const da = data.delivery_agent;
  if (da && typeof da === "object" && !Array.isArray(da)) {
    normalizeScalarObject(da as Record<string, unknown>, new Set());
    data.delivery_agent = pruneEmptyNestedObject(da as Record<string, unknown>);
  } else if (da === undefined) data.delivery_agent = null;

  const routing = data.routing;
  if (routing && typeof routing === "object" && !Array.isArray(routing))
    normalizeScalarObject(routing as Record<string, unknown>, new Set());

  const vessel = data.vessel;
  if (vessel && typeof vessel === "object" && !Array.isArray(vessel)) {
    normalizeScalarObject(vessel as Record<string, unknown>, VESSEL_DATE_KEYS);
    splitVesselNameIfCombined(vessel as Record<string, unknown>);
  }

  const cargo = data.cargo;
  if (cargo && typeof cargo === "object" && !Array.isArray(cargo)) normalizeCargoBlock(cargo as Record<string, unknown>);

  const freight = data.freight;
  if (freight && typeof freight === "object" && !Array.isArray(freight))
    normalizeScalarObject(freight as Record<string, unknown>, new Set());
  sanitizeFreightCharterBoilerplate(data);

  const issuance = data.issuance;
  if (issuance && typeof issuance === "object" && !Array.isArray(issuance))
    normalizeScalarObject(issuance as Record<string, unknown>, ISSUANCE_DATE_KEYS);

  applyCongenGenwayShippedOnBoardFallback(data);

  const inv = data.invoices;
  if (Array.isArray(inv)) {
    for (const row of inv) {
      if (row && typeof row === "object" && !Array.isArray(row)) normalizeInvoiceRow(row as Record<string, unknown>);
    }
    if (inv.length === 1) {
      const only = inv[0] as Record<string, unknown>;
      const empty = !asString(only.invoice_number) && only.invoice_date == null;
      if (empty) data.invoices = [];
    }
  } else {
    data.invoices = [];
  }

  const sba = data.shipping_bills;
  if (Array.isArray(sba)) {
    for (const row of sba) {
      if (row && typeof row === "object" && !Array.isArray(row)) normalizeShippingBillRow(row as Record<string, unknown>);
    }
    if (sba.length === 1) {
      const only = sba[0] as Record<string, unknown>;
      const empty = !asString(only.shipping_bill_number) && only.shipping_bill_date == null;
      if (empty) data.shipping_bills = [];
    }
  } else {
    data.shipping_bills = [];
  }

  filterAndDedupeShippingBills(data);

  const cont = data.containers;
  if (cont === undefined) data.containers = null;
  else if (Array.isArray(cont)) {
    for (const row of cont) {
      if (row && typeof row === "object" && !Array.isArray(row)) normalizeContainerRow(row as Record<string, unknown>);
    }
    if (cont.length === 1) {
      const only = cont[0] as Record<string, unknown>;
      if (!asString(only.number)) data.containers = null;
    }
  }

  data.document_category = asString(data.document_category) ?? "Bill of Lading";

  normalizeExtractionMetadataBlock(data);

  if (!asString(data.negotiability)) {
    const fam = peekDocumentFormatFamily(data)?.toUpperCase() ?? "";
    if (fam.startsWith("SEAWAY_")) data.negotiability = "NON-NEGOTIABLE";
  }
}

export function normalizeStructuredBillOfLadingPayload(data: Record<string, unknown>): Record<string, unknown> {
  normalizeBillOfLadingBody(data);
  return data;
}
