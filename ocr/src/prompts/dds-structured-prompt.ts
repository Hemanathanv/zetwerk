/**
 * Delivery Deduction Sheet — structured extraction prompt.
 * Sections: company (flat), shipmentReference (flat), parties (flat),
 *           referenceInvoices[] (array), originCharges (flat).
 */

import type { SchemaRow } from "./dds-schema-types.js";

const ARRAY_SECTIONS = new Set(["Reference Invoices"]);

const CANONICAL_JSON_KEY: Record<string, string> = {
  "Company Name": "companyName",
  "CIN": "cin",
  "Registered Address": "registeredAddress",
  "GST Number": "gstNumber",
  "Email": "email",
  "Phone": "phone",
  "Booking Number": "bookingNumber",
  "BOL Number": "bolNumber",
  "Liner": "liner",
  "Vessel Name": "vesselName",
  "Sold To": "soldTo",
  "Consignee": "consignee",
  "Port Of Loading": "portOfLoading",
  "Invoice Number": "invoiceNumber",
  "Invoice Date": "invoiceDate",
  "Description": "description",
  "Num Containers": "numContainers",
  "Total Cargo Weight Mt": "totalCargoWeightMt",
  "INR Total": "inrTotal",
  "USD Total": "usdTotal",
};

function tokenize(s: string): string[] {
  return s
    .replace(/\s*[/|,]\s*/g, " ")
    .split(/\s+/)
    .flatMap((w) => w.match(/[A-Za-z0-9]+/g) ?? [])
    .filter(Boolean);
}

function toCamel(tokens: string[]): string {
  if (!tokens.length) return "field";
  const [first, ...rest] = tokens;
  return first!.toLowerCase() + rest.map((t) => t[0]!.toUpperCase() + t.slice(1).toLowerCase()).join("");
}

function sectionToKey(section: string): string {
  return toCamel(tokenize(section));
}

function fieldToKey(fieldName: string): string {
  return CANONICAL_JSON_KEY[fieldName.trim()] ?? toCamel(tokenize(fieldName));
}

export interface DdsStructuredTemplate {
  sections: { jsonKey: string; label: string }[];
  fieldsBySection: Map<string, { jsonKey: string; fieldName: string }[]>;
  arraySectionKeys: Set<string>;
}

export function buildStructuredTemplate(schema: SchemaRow[]): DdsStructuredTemplate {
  const bySection = new Map<string, { jsonKey: string; fieldName: string }[]>();
  const sectionOrder: string[] = [];
  const seen = new Set<string>();

  for (const row of schema) {
    const sec = row.section.trim() || "General";
    if (!seen.has(sec)) { seen.add(sec); sectionOrder.push(sec); }
    const list = bySection.get(sec) ?? [];
    list.push({ jsonKey: fieldToKey(row.fieldName), fieldName: row.fieldName });
    bySection.set(sec, list);
  }

  const arraySectionKeys = new Set<string>();
  for (const sec of sectionOrder) {
    if (ARRAY_SECTIONS.has(sec)) arraySectionKeys.add(sectionToKey(sec));
  }

  return {
    sections: sectionOrder.map((label) => ({ jsonKey: sectionToKey(label), label })),
    fieldsBySection: new Map([...bySection.entries()].map(([s, f]) => [sectionToKey(s), f])),
    arraySectionKeys,
  };
}

const NULL_DEFAULTS: Record<string, Set<string>> = {
  company: new Set(["cin", "registeredAddress", "gstNumber", "email", "phone"]),
  shipmentReference: new Set(["bookingNumber", "bolNumber", "liner", "vesselName"]),
  originCharges: new Set(["numContainers"]),
};

function emptyTemplate(template: DdsStructuredTemplate): Record<string, unknown> {
  const root: Record<string, unknown> = {
    source: "Gemini",
    documentType: "Delivery Deduction Sheet",
  };
  for (const { jsonKey: sk } of template.sections) {
    const fields = template.fieldsBySection.get(sk);
    if (!fields) continue;
    const nullKeys = NULL_DEFAULTS[sk];
    if (template.arraySectionKeys.has(sk)) {
      const row: Record<string, unknown> = {};
      for (const f of fields) row[f.jsonKey] = "";
      root[sk] = [row];
    } else {
      const obj: Record<string, unknown> = {};
      for (const f of fields) obj[f.jsonKey] = nullKeys?.has(f.jsonKey) ? null : "";
      root[sk] = obj;
    }
  }
  return root;
}

export function buildStructuredDdsPrompt(schema: SchemaRow[]): string {
  const template = buildStructuredTemplate(schema);
  const example = emptyTemplate(template);

  const sectionLines: string[] = [];
  for (const { jsonKey, label } of template.sections) {
    const fields = template.fieldsBySection.get(jsonKey)!;
    const isArr = template.arraySectionKeys.has(jsonKey);
    const fieldList = fields.map((f) => `    - JSON key \`${f.jsonKey}\` ← **${f.fieldName}**`).join("\n");
    sectionLines.push(
      isArr
        ? `- **${label}** → \`${jsonKey}\` is a **JSON array**. One object per invoice row.\n${fieldList}`
        : `- **${label}** → \`${jsonKey}\` is a **JSON object** (flat).\n${fieldList}`,
    );
  }

  return `You are a precision extractor for **Delivery Deduction Sheets** (also titled "FREIGHT & TRANSPORTATION SUMMARY SHEET") — 1-2 page PDFs used with Indian export shipments to summarize freight charges.

OUTPUT RULES (critical):
1. Respond with **one JSON object only** (no markdown fences).
2. Top-level \`source\`: "Gemini", \`documentType\`: "Delivery Deduction Sheet".
3. Leaf values: **string** or **null**. No booleans, no numbers, no confidence/evidence fields.
4. Use **exact JSON keys** from the template.

FIELD RULES:
5. **\`shipmentReference\`** — all four fields are optional; set to **null** when not present on the PDF. Do NOT assume which fields appear based on shipment type:
   - \`bookingNumber\`: label "BOOKING NO:" — extract if present, else null.
   - \`bolNumber\`: label "Bill of Lading No:" or "BL No" — extract if present, else null.
   - \`liner\`: label "Liner :" — extract if present, else null.
   - \`vesselName\`: label "Vessel Name:" — extract if present, else null.
   Some PDFs have only BL + Liner, some have only Booking, some have Booking + Liner.
6. **\`originCharges.numContainers\`**: extract the count from the "No of Containers" column if it exists; set to **null** if the column is absent (break-bulk shipments).
7. **\`originCharges.inrTotal\` / \`usdTotal\`**: strip ALL commas (Indian lakh formatting — e.g. "13,56,484.80" → "1356484.80"). Store plain decimal string.
8. **\`originCharges.totalCargoWeightMt\`**: strip "MT" unit if present; store plain number string.
9. **\`originCharges.numContainers\`**: strip leading zeros ("05" → "5").
10. **Dates** (\`referenceInvoices[].invoiceDate\`): extract as printed; post-processing normalizes to DD-MMM-YYYY.
11. **\`company.registeredAddress\`**: strip any "Regd. Officer :", "Registered Office:", or similar label prefix before the address.

INVOICE TABLE — COMPLETE EXTRACTION (critical):
12. **EXTRACT ALL ROWS FROM ALL PAGES**: The invoice table may span multiple pages — scan every page of the PDF and include every invoice row. Do NOT stop after the first page or first table. Count the rows you see and ensure your output matches that count.
13. **DUAL-COLUMN LAYOUT**: The invoice table often has **two (Invoice No, Date) pairs per row** — a left pair and a right pair. Extract **both** as separate \`referenceInvoices[]\` entries. Do NOT skip the right column. If a row has only a left entry and the right cells are blank, add only one entry for that row.
14. **POSITION-AGNOSTIC**: The invoice table may appear anywhere on the page, in any column layout (1-column, 2-column, or multi-column). Labels such as "Invoice No", "Invoice Number", "Inv No", "Bill No" all map to \`invoiceNumber\`. Extract regardless of table position.

NULL VS EMPTY:
15. Use **null** for fields absent from the PDF. Do NOT use empty string "" for missing optional fields.

SECTION MAPPING:
${sectionLines.join("\n\n")}

TEMPLATE (shape and keys — replace values from the PDF):
${JSON.stringify(example, null, 2)}`;
}
