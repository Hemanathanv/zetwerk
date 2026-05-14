/**
 * Generate a single client-review Excel from output/extraction-gemini/*.json
 * One sheet per category (Entry Summary, Packing Lists, Sales Invoices, Shipping Bill)
 * One row per line item; parent document fields repeated on every row.
 * No model / cost / token / internal fields shown.
 *
 * Run: node scripts/generate-client-review-excel.mjs
 *      node scripts/generate-client-review-excel.mjs --out "output/client-review.xlsx"
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const geminiDir = path.join(root, "output", "extraction-gemini");

// ── Parse CLI ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let outFile = path.join(root, "output", "client-review.xlsx");
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--out" && argv[i + 1]) outFile = path.resolve(argv[++i]);
}

// ── Excluded / internal keys ───────────────────────────────────────────────────
const SKIP_KEYS = new Set([
  "source", "documentType", "modelUsed", "pdfEngine", "temperature",
  "maxTokens", "reasoningEffort", "extractionMode", "valueNormalization",
  "usage", "schemaJsonPath", "pdfPath",
]);

// ── Label helpers ──────────────────────────────────────────────────────────────
const ACRONYMS = new Map([
  ["htsus","HTSUS"], ["mpf","MPF"], ["hmf","HMF"], ["fob","FOB"],
  ["bl","B/L"], ["awb","AWB"], ["iec","IEC"], ["irn","IRN"], ["gstin","GSTIN"],
  ["pan","PAN"], ["din","DIN"], ["usd","USD"], ["hs","HS"], ["hsn","HSN"],
  ["po","PO"], ["arn","ARN"], ["it","IT"], ["lut","LUT"], ["rodtep","RoDTEP"],
  ["dbk","DBK"], ["igst","IGST"], ["aeo","AEO"], ["ad","AD"], ["cin","CIN"],
  ["ior","IOR"], ["id","ID"], ["url","URL"], ["no","No"], ["qty","Qty"],
  ["uqc","UQC"], ["fob","FOB"], ["sb","SB"], ["cb","CB"],
  ["hts","HTS"], ["ssd","SSD"], ["mawb","MAWB"], ["hawb","HAWB"], ["imo","IMO"],
  ["cbm","CBM"], ["etd","ETD"], ["eta","ETA"],
]);

function camelToLabel(s) {
  // Split camelCase into words
  const words = s
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .split(/[\s_]+/);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return ACRONYMS.get(lower);
      return i === 0
        ? w.charAt(0).toUpperCase() + w.slice(1)
        : w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function sectionLabel(key) {
  const map = {
    header: "Header", transport: "Transport", parties: "Parties",
    tradeCompliance: "Trade Compliance", fees: "Fees", totals: "Totals",
    declarant: "Declarant", broker: "Broker", compliance: "Compliance",
    entities: "Entities", financial: "Financial", footer: "Footer",
    shipment: "Shipment",
    part1ShippingBillSummary: "Part 1 Summary",
    part2InvoiceDetails: "Part 2 Invoice",
    company: "Company", certification: "Certification",
    products: "Products", referenceInvoices: "Reference Invoices",
    shipmentReference: "Shipment Reference", parties: "Parties",
    originCharges: "Origin Charges",
    issuer: "Issuer",
    invoiceIdentification: "Invoice Identification",
    customer: "Customer",
    cargo: "Cargo",
    totals: "Totals",
    bankDetails: "Bank Details",
    charges: "Charges",
    containers: "Containers",
    taxSummary: "Tax Summary",
    additionalBankDetails: "Additional Bank Details",
    document: "Document",
    carrier: "Carrier",
    notify_party: "Notify Party",
    second_notify_party: "Second Notify",
    delivery_agent: "Delivery Agent",
    routing: "Routing",
    vessel: "Vessel",
    freight: "Freight",
    issuance: "Issuance",
    exportInvoice: "Export Invoice",
    exportShippingBill: "Export Shipping Bill",
    extractionMetadata: "Extraction Metadata",
    containersBlob: "Containers",
    invoicesBlob: "Invoices",
    shippingBillsBlob: "Shipping Bills",
  };
  return map[key] ?? camelToLabel(key);
}

function col(section, field) {
  return `${sectionLabel(section)} - ${camelToLabel(field)}`;
}

// ── Flatten a flat (non-array) object with section prefix ──────────────────────
function flattenSection(sectionKey, obj, target) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      // nested arrays inside a section → stringify compactly
      target[col(sectionKey, k)] = v.length ? JSON.stringify(v) : null;
    } else if (v && typeof v === "object") {
      // nested object inside section → prefix further
      for (const [k2, v2] of Object.entries(v)) {
        if (Array.isArray(v2)) {
          target[col(sectionKey, `${k} ${k2}`)] = v2.length ? JSON.stringify(v2) : null;
        } else {
          target[col(sectionKey, `${k} ${k2}`)] = v2 ?? null;
        }
      }
    } else {
      target[col(sectionKey, k)] = v ?? null;
    }
  }
}

// ── Format tariff lines as readable text ───────────────────────────────────────
function formatTariffLines(tariffLines) {
  if (!Array.isArray(tariffLines) || tariffLines.length === 0) return null;
  return tariffLines
    .map((t, i) => {
      const parts = [];
      if (t.htsusNumber) parts.push(`HTSUS: ${t.htsusNumber}`);
      if (t.description) parts.push(`Desc: ${t.description}`);
      if (t.enteredValue != null && t.enteredValue !== "") parts.push(`Value: ${t.enteredValue}`);
      if (t.netQuantity != null && t.netQuantity !== "") parts.push(`Net Qty: ${t.netQuantity}`);
      if (t.rate != null && t.rate !== "") parts.push(`Rate: ${t.rate}%`);
      if (t.dutyAmount != null && t.dutyAmount !== "") parts.push(`Duty: ${t.dutyAmount}`);
      return `[${i + 1}] ${parts.join(" | ")}`;
    })
    .join("\n");
}

// ── Column width helper ────────────────────────────────────────────────────────
function colWidths(rows, headers) {
  const widths = {};
  for (const h of headers) widths[h] = Math.min(h.length + 2, 45);
  for (const row of rows) {
    for (const h of headers) {
      const v = row[h];
      if (v == null) continue;
      const len = String(v).split("\n")[0].length;
      widths[h] = Math.min(Math.max(widths[h] ?? 10, len + 2), 60);
    }
  }
  return headers.map((h) => ({ wch: widths[h] ?? 15 }));
}

// ── Write a sheet ──────────────────────────────────────────────────────────────
function writeSheet(wb, sheetName, rows) {
  if (rows.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["No data"]]), sheetName.slice(0, 31));
    return;
  }
  // Collect all headers in insertion order
  const headerSet = new Set();
  for (const r of rows) for (const k of Object.keys(r)) headerSet.add(k);
  const headers = [...headerSet];

  // Build array-of-arrays for xlsx (header row + data rows)
  const aoa = [headers];
  for (const row of rows) {
    aoa.push(headers.map((h) => row[h] ?? null));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Auto column widths
  ws["!cols"] = colWidths(rows, headers);

  // Freeze header row
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  console.log(`  Sheet "${sheetName}": ${rows.length} rows, ${headers.length} columns`);
}

// ── SOURCE FILE NAME ───────────────────────────────────────────────────────────
function sourceFile(pdfPath) {
  if (!pdfPath) return null;
  return path.basename(String(pdfPath));
}

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY PROCESSORS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Entry Summary ──────────────────────────────────────────────────────────────
function processEntrySummary(json) {
  const docBase = { "Source File": sourceFile(json.pdfPath) };
  const DOC_SECTIONS = ["header","transport","parties","tradeCompliance","fees","totals","declarant","broker"];
  for (const s of DOC_SECTIONS) {
    if (json[s] && typeof json[s] === "object") flattenSection(s, json[s], docBase);
  }

  const lineItems = json.lineItems;
  if (!Array.isArray(lineItems) || lineItems.length === 0) return { lineRows: [docBase], tariffRows: [] };

  const filerCode = json.header?.filerCodeEntryNumber ?? null;

  const lineRows = lineItems.map((li) => {
    const row = { ...docBase };
    const LINE_FIELDS = [
      "lineNo","invoiceNumber","merchandiseDescription","htsusNumber",
      "grossWeightKg","netQuantity","netQuantityUnit","enteredValue","charges",
      "relationship","htsusRate","htsusDuty","invoiceValueUsd","deductionCharge",
      "totalEnteredValueInvoice","mpfRate","mpfAmount","hmfRate","hmfAmount",
    ];
    for (const f of LINE_FIELDS) {
      row[col("lineItems", f)] = li[f] ?? null;
    }
    return row;
  });

  const tariffRows = [];
  for (const li of lineItems) {
    if (!Array.isArray(li.tariffLines)) continue;
    for (const tl of li.tariffLines) {
      const row = {
        "Source File": sourceFile(json.pdfPath),
        "Header - Filer Code Entry Number": filerCode,
        "Line No": li.lineNo ?? null,
        "Line Merchandise Description": li.merchandiseDescription ?? null,
        "Line HTSUS Number": li.htsusNumber ?? null,
      };
      const TL_FIELDS = [
        "htsusNumber","description","grossWeight","netQuantity",
        "netQuantityUnit","enteredValue","rate","dutyAmount",
      ];
      for (const f of TL_FIELDS) {
        row[col("Tariff Line", f)] = tl[f] ?? null;
      }
      tariffRows.push(row);
    }
  }

  return { lineRows, tariffRows };
}

// ── Packing Lists ──────────────────────────────────────────────────────────────
function processPackingLists(json) {
  const docBase = { "Source File": sourceFile(json.pdfPath) };
  const DOC_SECTIONS = ["compliance","entities","header","totals","shipment","footer"];
  for (const s of DOC_SECTIONS) {
    if (json[s] && typeof json[s] === "object") flattenSection(s, json[s], docBase);
  }

  const lineItems = json.lineItems;
  if (!Array.isArray(lineItems) || lineItems.length === 0) return [docBase];

  return lineItems.map((li) => {
    const row = { ...docBase };
    const LINE_FIELDS = [
      "hsnCode","productCode","productDescription","productSpecification",
      "productMarks","qtyPerBundle","noOfBundles","totalQtyInPcs",
      "netWeightKgs","grossWeightKgs","kindOfPkg",
    ];
    for (const f of LINE_FIELDS) {
      row[col("lineItems", f)] = li[f] ?? null;
    }
    return row;
  });
}

// ── Sales Invoices ─────────────────────────────────────────────────────────────
function processSalesInvoices(json) {
  const docBase = { "Source File": sourceFile(json.pdfPath) };
  const DOC_SECTIONS = ["compliance","entities","financial","header","shipment","footer"];
  for (const s of DOC_SECTIONS) {
    if (json[s] && typeof json[s] === "object") flattenSection(s, json[s], docBase);
  }

  const lineItems = json.lineItems;
  if (!Array.isArray(lineItems) || lineItems.length === 0) return [docBase];

  return lineItems.map((li) => {
    const row = { ...docBase };
    const LINE_FIELDS = [
      "hsnCode","hsnCodeDestination","productCode","productDescription",
      "productSpecification","productPartNumber","productSku","productMarks",
      "noOfPackages","quantity","unit","rate","lineTotal",
      "taxRate","taxAmountPerLine","kindOfPkg",
    ];
    for (const f of LINE_FIELDS) {
      row[col("lineItems", f)] = li[f] ?? null;
    }
    return row;
  });
}

// ── Shipping Bill ──────────────────────────────────────────────────────────────
// Focus: Part 1 summary (metadata, status, value, export promotion) as doc fields;
//        Part 3 items as line items; Part 2 invoice refs and valuation as doc fields.
function processShippingBill(json) {
  const docBase = { "Source File": sourceFile(json.pdfPath) };

  // Part 1 — flat sub-sections
  const p1 = json.part1ShippingBillSummary;
  if (p1 && typeof p1 === "object") {
    const P1_FLAT = ["metadata","sectionAStatus","sectionBDeclarant","sectionCValueSummary","sectionDExportPromotion"];
    for (const sub of P1_FLAT) {
      if (p1[sub] && typeof p1[sub] === "object" && !Array.isArray(p1[sub])) {
        flattenSection(sub, p1[sub], docBase);
      }
    }
  }

  // Part 2 — transaction parties and valuation
  const p2 = json.part2InvoiceDetails;
  if (p2 && typeof p2 === "object") {
    if (p2.sectionBTransactionParties) {
      flattenSection("sectionBTransactionParties", p2.sectionBTransactionParties, docBase);
    }
    if (Array.isArray(p2.sectionARef) && p2.sectionARef.length > 0) {
      const ref = p2.sectionARef[0];
      for (const [k, v] of Object.entries(ref)) {
        docBase[col("Invoice Ref", k)] = v ?? null;
      }
    }
    if (Array.isArray(p2.sectionCValuation) && p2.sectionCValuation.length > 0) {
      const val = p2.sectionCValuation[0];
      for (const [k, v] of Object.entries(val)) {
        docBase[col("Valuation", k)] = v ?? null;
      }
    }
  }

  // Part 3 — item details (main line items)
  const items = json.part3ItemDetails;
  if (!Array.isArray(items) || items.length === 0) return [docBase];

  return items.map((li) => {
    const row = { ...docBase };
    const LINE_FIELDS = [
      "invsn","itemsn","hsCd","description","quantity","uqc","rate","valueFc",
      "fobInr","pmv","dutyAmt","cessRt","cesAmt","dbkclmd","igstStat",
      "igstValue","igstAmount","schcod","schemeDescription","sqcMsr","sqcUqc",
      "stateOfOrigin","districtOfOrigin","ptAbroad","ftaBenefitAvailed",
      "rewardBenefit","thirdPartyItem",
    ];
    for (const f of LINE_FIELDS) {
      row[col("Items", f)] = li[f] ?? null;
    }
    return row;
  });
}

// ── Steel Supplier Declaration ─────────────────────────────────────────────────
// Main sheet: one row per product (company + certification fields repeated).
// Reference Invoices sheet: one row per referenceInvoice, cross-referenced.
function processSsd(json) {
  const docBase = { "Source File": sourceFile(json.pdfPath) };

  // Flatten company fields
  const company = json.company;
  if (company && typeof company === "object") {
    for (const [k, v] of Object.entries(company)) {
      docBase[col("company", k)] = v ?? null;
    }
  }

  // Flatten certification fields (keep stamp fields separate from typed fields)
  const cert = json.certification;
  if (cert && typeof cert === "object") {
    for (const [k, v] of Object.entries(cert)) {
      docBase[col("certification", k)] = v ?? null;
    }
  }

  // Products array → one row each
  const products = Array.isArray(json.products) ? json.products : [];
  const productRows = products.length > 0
    ? products.map((p) => {
        const row = { ...docBase };
        const PROD_FIELDS = [
          "partNumber","usHtsCode","containsSteel","meltedPouredInUs",
          "finishedPartPriceUsd","steelContentValueUsd","steelContentWeightKg",
          "invoiceNumbersRaw","invoiceNumbers",
        ];
        for (const f of PROD_FIELDS) {
          const v = p[f];
          row[col("products", f)] = Array.isArray(v) ? v.join(", ") : (v ?? null);
        }
        return row;
      })
    : [docBase];

  // Reference invoices sheet
  const refInvoiceRows = [];
  for (const ri of (Array.isArray(json.referenceInvoices) ? json.referenceInvoices : [])) {
    refInvoiceRows.push({
      "Source File": sourceFile(json.pdfPath),
      "Certification - Reference Number": cert?.referenceNumber ?? null,
      "Certification - Reference Type": cert?.referenceType ?? null,
      [col("referenceInvoices", "invoiceNumber")]: ri.invoiceNumber ?? null,
      [col("referenceInvoices", "invoiceDate")]: ri.invoiceDate ?? null,
    });
  }

  return { productRows, refInvoiceRows };
}

// ── Delivery Deduction Sheet ───────────────────────────────────────────────────
// One row per reference invoice; company + shipment + parties + originCharges repeated.
function processDds(json) {
  const docBase = { "Source File": sourceFile(json.pdfPath) };

  if (json.company && typeof json.company === "object")
    for (const [k, v] of Object.entries(json.company)) docBase[col("company", k)] = v ?? null;

  if (json.shipmentReference && typeof json.shipmentReference === "object")
    for (const [k, v] of Object.entries(json.shipmentReference)) docBase[col("shipmentReference", k)] = v ?? null;

  if (json.parties && typeof json.parties === "object")
    for (const [k, v] of Object.entries(json.parties)) docBase[col("parties", k)] = v ?? null;

  if (json.originCharges && typeof json.originCharges === "object")
    for (const [k, v] of Object.entries(json.originCharges)) docBase[col("originCharges", k)] = v ?? null;

  const invoices = Array.isArray(json.referenceInvoices) ? json.referenceInvoices : [];
  if (invoices.length === 0) return [docBase];
  return invoices.map((inv) => {
    const row = { ...docBase };
    row[col("referenceInvoices", "invoiceNumber")] = inv.invoiceNumber ?? null;
    row[col("referenceInvoices", "invoiceDate")] = inv.invoiceDate ?? null;
    return row;
  });
}

// ── Ocean Freight Invoice ─────────────────────────────────────────────────────
// One row per charge line; multiInvoice PDFs → repeat per sub-invoice body.
function processOceanFreight(json) {
  const sf = sourceFile(json.pdfPath);
  const multi = json.multiInvoice === true && Array.isArray(json.invoices);
  const bodies = multi ? json.invoices : [json];
  const rows = [];
  let subIdx = 0;
  const CHARGE_FIELDS = [
    "lineNumber", "sacHsnCode", "description", "currency", "ratePerUnit", "units", "roe",
    "currencyAmount", "taxableAmountInr", "amountUsd", "igstRate", "igstAmount", "cgstRate",
    "cgstAmount", "sgstRate", "sgstAmount", "detentionDetails", "taxInfo",
  ];
  for (const inv of bodies) {
    subIdx += 1;
    const docBase = { "Source File": sf };
    if (multi) docBase["Sub-Invoice Index"] = subIdx;
    if (inv.issuer && typeof inv.issuer === "object") flattenSection("issuer", inv.issuer, docBase);
    if (inv.invoiceIdentification && typeof inv.invoiceIdentification === "object")
      flattenSection("invoiceIdentification", inv.invoiceIdentification, docBase);
    if (inv.customer && typeof inv.customer === "object") flattenSection("customer", inv.customer, docBase);
    if (inv.shipment && typeof inv.shipment === "object") flattenSection("shipment", inv.shipment, docBase);
    if (inv.cargo && typeof inv.cargo === "object") flattenSection("cargo", inv.cargo, docBase);
    docBase[col("containers", "list")] = inv.containers ?? null;
    docBase[col("containers", "totalCount")] = inv.totalContainers ?? null;
    const ts = inv.taxSummary;
    docBase[col("taxSummary", "entries")] =
      ts == null || ts === "" ? null : typeof ts === "object" ? JSON.stringify(ts) : ts;
    if (inv.totals && typeof inv.totals === "object") flattenSection("totals", inv.totals, docBase);
    if (inv.bankDetails && typeof inv.bankDetails === "object") flattenSection("bankDetails", inv.bankDetails, docBase);
    if (inv.additionalBankDetails && typeof inv.additionalBankDetails === "object")
      flattenSection("additionalBankDetails", inv.additionalBankDetails, docBase);
    if (inv.footer && typeof inv.footer === "object") flattenSection("footer", inv.footer, docBase);

    const charges = inv.charges;
    if (!Array.isArray(charges) || charges.length === 0) {
      rows.push(docBase);
      continue;
    }
    for (const ch of charges) {
      const row = { ...docBase };
      for (const f of CHARGE_FIELDS) row[col("charges", f)] = ch?.[f] ?? null;
      rows.push(row);
    }
  }
  return rows;
}

function formatContainersForReview(c) {
  if (c == null || c === "") return null;
  if (Array.isArray(c)) return JSON.stringify(c);
  return c;
}

function bolReviewHasText(v) {
  if (v == null) return false;
  if (typeof v === "number" && Number.isFinite(v)) return true;
  return String(v).trim() !== "";
}

/** Pair invoices[] + shipping_bills[]; migrate legacy single-array Gemini output for client review. */
function bolReviewParallelInvoicesShippingBills(json) {
  let invs = Array.isArray(json.invoices) ? json.invoices : [];
  let sbs = Array.isArray(json.shipping_bills) ? json.shipping_bills : [];
  if (sbs.length > 0) return { invs, sbs };
  const rows = invs.filter((r) => r && typeof r === "object");
  const anySb = rows.some((r) => bolReviewHasText(r.shipping_bill_number) || bolReviewHasText(r.shipping_bill_date));
  if (!anySb) return { invs, sbs };

  let splitAt = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const hasInv = bolReviewHasText(r.invoice_number) || bolReviewHasText(r.invoice_date);
    const hasSb = bolReviewHasText(r.shipping_bill_number) || bolReviewHasText(r.shipping_bill_date);
    if (hasSb && !hasInv) {
      splitAt = i;
      break;
    }
  }
  if (splitAt > 0 && splitAt < rows.length) {
    const invPart = rows.slice(0, splitAt);
    const sbPart = rows.slice(splitAt);
    const invClean = invPart.every((r) => !bolReviewHasText(r.shipping_bill_number) && !bolReviewHasText(r.shipping_bill_date));
    const sbClean = sbPart.every((r) => !bolReviewHasText(r.invoice_number) && !bolReviewHasText(r.invoice_date));
    if (invClean && sbClean) {
      return {
        invs: invPart.map((r) => ({ invoice_number: r.invoice_number ?? null, invoice_date: r.invoice_date ?? null })),
        sbs: sbPart.map((r) => ({
          shipping_bill_number: r.shipping_bill_number ?? null,
          shipping_bill_date: r.shipping_bill_date ?? null,
        })),
      };
    }
  }
  return {
    invs: rows.map((r) => ({ invoice_number: r.invoice_number ?? null, invoice_date: r.invoice_date ?? null })),
    sbs: rows.map((r) => ({
      shipping_bill_number: r.shipping_bill_number ?? null,
      shipping_bill_date: r.shipping_bill_date ?? null,
    })),
  };
}

// ── Bill of Lading (snake_case JSON) ─────────────────────────────────────────
// One row per paired export-invoice / shipping-bill index (parallel arrays); one summary row if both empty.
function processBillOfLading(json) {
  const sf = sourceFile(json.pdfPath);
  const docBase = { "Source File": sf };
  const meta = json._extraction_metadata && typeof json._extraction_metadata === "object" ? json._extraction_metadata : null;
  if (meta) {
    docBase[col("extractionMetadata", "document_format_family")] = meta.document_format_family ?? null;
    docBase[col("extractionMetadata", "confidence_score")] = meta.confidence_score ?? null;
    docBase[col("extractionMetadata", "page_count")] = meta.page_count ?? null;
  }
  flattenSection(
    "document",
    {
      document_title: json.document_title ?? null,
      bol_number: json.bol_number ?? null,
      shipment_reference_number: json.shipment_reference_number ?? null,
      negotiability: json.negotiability ?? null,
      project_name: json.project_name ?? null,
      ships_remarks: json.ships_remarks ?? null,
      document_category: json.document_category ?? null,
    },
    docBase,
  );
  if (json.carrier && typeof json.carrier === "object") flattenSection("carrier", json.carrier, docBase);
  if (json.shipper && typeof json.shipper === "object") flattenSection("shipper", json.shipper, docBase);
  if (json.consignee && typeof json.consignee === "object") flattenSection("consignee", json.consignee, docBase);
  if (json.notify_party && typeof json.notify_party === "object") flattenSection("notify_party", json.notify_party, docBase);
  if (json.second_notify_party && typeof json.second_notify_party === "object")
    flattenSection("second_notify_party", json.second_notify_party, docBase);
  if (json.delivery_agent && typeof json.delivery_agent === "object")
    flattenSection("delivery_agent", json.delivery_agent, docBase);
  if (json.routing && typeof json.routing === "object") flattenSection("routing", json.routing, docBase);
  if (json.vessel && typeof json.vessel === "object") flattenSection("vessel", json.vessel, docBase);
  if (json.cargo && typeof json.cargo === "object") flattenSection("cargo", json.cargo, docBase);
  if (json.freight && typeof json.freight === "object") flattenSection("freight", json.freight, docBase);
  if (json.issuance && typeof json.issuance === "object") flattenSection("issuance", json.issuance, docBase);
  docBase[col("containersBlob", "all_json")] = formatContainersForReview(json.containers);
  const { invs, sbs } = bolReviewParallelInvoicesShippingBills(json);
  docBase[col("invoicesBlob", "all_json")] = invs.length ? JSON.stringify(invs) : null;
  docBase[col("shippingBillsBlob", "all_json")] = sbs.length ? JSON.stringify(sbs) : null;
  const n = Math.max(invs.length, sbs.length, 1);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const row = { ...docBase };
    const inv = invs[i];
    const sb = sbs[i];
    row[col("exportInvoice", "invoice_number")] = inv?.invoice_number ?? null;
    row[col("exportInvoice", "invoice_date")] = inv?.invoice_date ?? null;
    row[col("exportShippingBill", "shipping_bill_number")] = sb?.shipping_bill_number ?? null;
    row[col("exportShippingBill", "shipping_bill_date")] = sb?.shipping_bill_date ?? null;
    rows.push(row);
  }
  return rows;
}

// ── Freight Forwarder Bill ─────────────────────────────────────────────────────
function processFreightForwarderBill(json) {
  const sf = sourceFile(json.pdfPath);
  const multi = json.multiInvoice === true && Array.isArray(json.invoices);
  const bodies = multi ? json.invoices : [json];
  const rows = [];
  let subIdx = 0;
  const CHARGE_FIELDS = [
    "lineNumber", "sacHsnCode", "description", "currency", "ratePerUnit", "units", "roe",
    "foreignCurrencyCode", "foreignCurrencyAmount", "taxableAmountInr", "amountInr", "igstRate", "igstAmount",
    "cgstRate", "cgstAmount", "sgstRate", "sgstAmount", "detentionDetails", "taxInfo",
  ];
  for (const inv of bodies) {
    subIdx += 1;
    const docBase = { "Source File": sf };
    if (multi) docBase["Sub-Invoice Index"] = subIdx;
    if (inv.issuer && typeof inv.issuer === "object") flattenSection("issuer", inv.issuer, docBase);
    if (inv.invoiceIdentification && typeof inv.invoiceIdentification === "object")
      flattenSection("invoiceIdentification", inv.invoiceIdentification, docBase);
    if (inv.customer && typeof inv.customer === "object") flattenSection("customer", inv.customer, docBase);
    if (inv.shipment && typeof inv.shipment === "object") flattenSection("shipment", inv.shipment, docBase);
    if (inv.cargo && typeof inv.cargo === "object") flattenSection("cargo", inv.cargo, docBase);
    docBase[col("containers", "list")] = formatContainersForReview(inv.containers);
    docBase[col("containers", "totalCount")] = inv.totalContainers ?? null;
    const ts = inv.taxSummary;
    docBase[col("taxSummary", "entries")] =
      ts == null || ts === "" ? null : typeof ts === "object" ? JSON.stringify(ts) : ts;
    if (inv.totals && typeof inv.totals === "object") flattenSection("totals", inv.totals, docBase);
    if (inv.bankDetails && typeof inv.bankDetails === "object") flattenSection("bankDetails", inv.bankDetails, docBase);
    if (inv.additionalBankDetails && typeof inv.additionalBankDetails === "object")
      flattenSection("additionalBankDetails", inv.additionalBankDetails, docBase);
    if (inv.footer && typeof inv.footer === "object") flattenSection("footer", inv.footer, docBase);

    const charges = inv.charges;
    if (!Array.isArray(charges) || charges.length === 0) {
      rows.push(docBase);
      continue;
    }
    for (const ch of charges) {
      const row = { ...docBase };
      for (const f of CHARGE_FIELDS) row[col("charges", f)] = ch?.[f] ?? null;
      rows.push(row);
    }
  }
  return rows;
}

function processFile(filename, json) {
  if (filename.startsWith("Entry_Summary_")) {
    const { lineRows, tariffRows } = processEntrySummary(json);
    return [
      ["Entry Summary", lineRows],
      ["Entry Summary Tariff Lines", tariffRows],
    ];
  }
  if (filename.startsWith("Steel_Supplier_Declaration_")) {
    const { productRows, refInvoiceRows } = processSsd(json);
    return [
      ["Steel Supplier Declaration", productRows],
      ["SSD Reference Invoices", refInvoiceRows],
    ];
  }
  if (filename.startsWith("Delivery_Deduction_Sheet_")) return [["Delivery Deduction Sheet", processDds(json)]];
  if (filename.startsWith("Ocean_Freight_Invoice_")) return [["Ocean Freight Invoice", processOceanFreight(json)]];
  if (filename.startsWith("Bill_of_Lading_")) return [["Bill of Lading", processBillOfLading(json)]];
  if (filename.startsWith("Freight_Forwarder_Bill_")) return [["Freight Forwarder Bill", processFreightForwarderBill(json)]];
  if (filename.startsWith("Packing_Lists_")) return [["Packing Lists", processPackingLists(json)]];
  if (filename.startsWith("Sales_Invoices_")) return [["Sales Invoices", processSalesInvoices(json)]];
  if (filename.startsWith("Shipping_Bill_")) return [["Shipping Bill", processShippingBill(json)]];
  return [["Other", [{ "Source File": sourceFile(json.pdfPath) }]]];
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
function main() {
  const files = fs.readdirSync(geminiDir).filter((f) => f.endsWith(".json")).sort();
  console.log(`Found ${files.length} JSON files in ${geminiDir}`);

  /** @type {Map<string, Record<string,any>[]>} */
  const byCategory = new Map();
  let errors = 0;

  for (const f of files) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(path.join(geminiDir, f), "utf8"));
    } catch {
      console.warn(`  Skip (invalid JSON): ${f}`);
      errors++;
      continue;
    }
    const pairs = processFile(f, json);
    for (const [cat, rows] of pairs) {
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(...rows);
    }
  }

  const wb = XLSX.utils.book_new();
  const SHEET_ORDER = [
    "Entry Summary", "Entry Summary Tariff Lines",
    "Steel Supplier Declaration", "SSD Reference Invoices",
    "Delivery Deduction Sheet",
    "Ocean Freight Invoice",
    "Bill of Lading",
    "Freight Forwarder Bill",
    "Packing Lists", "Sales Invoices", "Shipping Bill",
  ];
  for (const cat of SHEET_ORDER) {
    if (byCategory.has(cat)) writeSheet(wb, cat, byCategory.get(cat));
  }
  for (const [cat, rows] of byCategory) {
    if (!SHEET_ORDER.includes(cat)) writeSheet(wb, cat, rows);
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  XLSX.writeFile(wb, outFile);
  console.log(`\nWrote: ${outFile}`);
  if (errors) console.warn(`Skipped ${errors} invalid files.`);
}

main();
