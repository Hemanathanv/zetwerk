/**
 * Steel Supplier Declaration — structured extraction prompt.
 * Sections: company (flat), products[] (array), certification (flat), referenceInvoices[] (array).
 */

import type { SchemaRow } from "./ssd-schema-types.js";

const ARRAY_SECTIONS = new Set(["Products", "Reference Invoices"]);

const CANONICAL_JSON_KEY_BY_FIELD_NAME: Record<string, string> = {
  "Company Name": "companyName",
  "CIN": "cin",
  "Registered Address": "registeredAddress",
  "GST Number": "gstNumber",
  "Email": "email",
  "Phone": "phone",
  "Part Number": "partNumber",
  "US HTS Code": "usHtsCode",
  "Contains Steel": "containsSteel",
  "Melted Poured In US": "meltedPouredInUs",
  "Finished Part Price USD": "finishedPartPriceUsd",
  "Steel Content Value USD": "steelContentValueUsd",
  "Steel Content Weight Kg": "steelContentWeightKg",
  "Invoice Numbers Raw": "invoiceNumbersRaw",
  "Invoice Numbers": "invoiceNumbers",
  "Statement": "statement",
  "Reference Type": "referenceType",
  "Reference Number": "referenceNumber",
  "Signatory Name": "signatoryName",
  "Signatory Title": "signatoryTitle",
  "Signatory Email": "signatoryEmail",
  "Certification Date": "certificationDate",
  "Stamp Company Name": "stampCompanyName",
  "Stamp Signatory Name": "stampSignatoryName",
  "Stamp Designation": "stampDesignation",
  "Stamp DIN Number": "stampDinNumber",
  "Signature": "signature",
  "Invoice Number": "invoiceNumber",
  "Invoice Date": "invoiceDate",
};

function tokenizeFieldLabel(s: string): string[] {
  return s
    .replace(/\s*[/|,]\s*/g, " ")
    .split(/\s+/)
    .flatMap((w) => w.match(/[A-Za-z0-9]+/g) ?? [])
    .map((w) => w.trim())
    .filter(Boolean);
}

function toCamelCase(tokens: string[]): string {
  if (tokens.length === 0) return "field";
  const [first, ...rest] = tokens;
  return (
    first!.toLowerCase() +
    rest.map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()).join("")
  );
}

export function sectionToJsonKey(section: string): string {
  return toCamelCase(tokenizeFieldLabel(section.trim()) || ["section"]);
}

export function fieldNameToJsonKey(fieldName: string): string {
  const trimmed = fieldName.trim();
  const canonical = CANONICAL_JSON_KEY_BY_FIELD_NAME[trimmed];
  return canonical ?? toCamelCase(tokenizeFieldLabel(trimmed));
}

export interface SsdStructuredTemplate {
  sections: { jsonKey: string; label: string }[];
  fieldsBySection: Map<string, { jsonKey: string; fieldName: string }[]>;
  arraySectionKeys: Set<string>;
}

export function buildStructuredTemplate(schema: SchemaRow[]): SsdStructuredTemplate {
  const bySection = new Map<string, { jsonKey: string; fieldName: string }[]>();
  const sectionOrder: string[] = [];
  const seenSection = new Set<string>();

  for (const row of schema) {
    const sec = row.section.trim() || "General";
    if (!seenSection.has(sec)) {
      seenSection.add(sec);
      sectionOrder.push(sec);
    }
    const list = bySection.get(sec) ?? [];
    list.push({ jsonKey: fieldNameToJsonKey(row.fieldName), fieldName: row.fieldName });
    bySection.set(sec, list);
  }

  const arraySectionKeys = new Set<string>();
  for (const sec of sectionOrder) {
    if (ARRAY_SECTIONS.has(sec)) arraySectionKeys.add(sectionToJsonKey(sec));
  }

  const sections = sectionOrder.map((label) => ({
    jsonKey: sectionToJsonKey(label),
    label,
  }));

  return {
    sections,
    fieldsBySection: new Map(
      [...bySection.entries()].map(([sec, fields]) => [sectionToJsonKey(sec), fields]),
    ),
    arraySectionKeys,
  };
}

const NULL_DEFAULTS: Record<string, Set<string>> = {
  company: new Set(["cin", "registeredAddress", "gstNumber", "email", "phone"]),
  certification: new Set([
    "stampCompanyName", "stampSignatoryName", "stampDesignation", "stampDinNumber",
  ]),
  products: new Set(["invoiceNumbersRaw", "invoiceNumbers"]),
};

const BOOL_FIELDS = new Set(["containsSteel", "meltedPouredInUs", "signature"]);

function emptyTemplateObject(template: SsdStructuredTemplate): Record<string, unknown> {
  const root: Record<string, unknown> = {
    source: "Gemini",
    documentType: "Steel Supplier Declaration",
  };

  for (const { jsonKey: sk } of template.sections) {
    const fields = template.fieldsBySection.get(sk);
    if (!fields) continue;
    const nullKeys = NULL_DEFAULTS[sk];

    if (template.arraySectionKeys.has(sk)) {
      const row: Record<string, unknown> = {};
      for (const f of fields) {
        if (sk === "products" && BOOL_FIELDS.has(f.jsonKey)) row[f.jsonKey] = false;
        else if (sk === "products" && f.jsonKey === "invoiceNumbers") row[f.jsonKey] = null;
        else if (nullKeys?.has(f.jsonKey)) row[f.jsonKey] = null;
        else row[f.jsonKey] = "";
      }
      root[sk] = [row];
    } else {
      const obj: Record<string, unknown> = {};
      for (const f of fields) {
        if (sk === "certification" && f.jsonKey === "signature") obj[f.jsonKey] = false;
        else if (nullKeys?.has(f.jsonKey)) obj[f.jsonKey] = null;
        else obj[f.jsonKey] = "";
      }
      root[sk] = obj;
    }
  }
  return root;
}

export function buildStructuredSsdPrompt(schema: SchemaRow[]): string {
  const template = buildStructuredTemplate(schema);
  const example = emptyTemplateObject(template);

  const sectionLines: string[] = [];
  for (const { jsonKey, label } of template.sections) {
    const fields = template.fieldsBySection.get(jsonKey)!;
    const isArr = template.arraySectionKeys.has(jsonKey);
    const fieldList = fields
      .map((f) => `    - JSON key \`${f.jsonKey}\` ← **${f.fieldName}**`)
      .join("\n");
    if (isArr) {
      if (jsonKey === "products") {
        sectionLines.push(
          `- **${label}** → \`${jsonKey}\` is a **JSON array**. One object per row in the steel content product table.\n${fieldList}`,
        );
      } else {
        sectionLines.push(
          `- **${label}** → \`${jsonKey}\` is a **JSON array**. One object per row in the reference invoice table.\n${fieldList}`,
        );
      }
    } else {
      sectionLines.push(
        `- **${label}** → \`${jsonKey}\` is a **JSON object** (flat key/value).\n${fieldList}`,
      );
    }
  }

  return `You are a precision extractor for **Steel Supplier Declarations** (SSD / Metal Content Declarations) — 1-2 page PDFs submitted with US customs entries under Section 232 steel requirements.

OUTPUT RULES (critical):
1. Respond with **one JSON object only** (no markdown fences).
2. Top-level \`source\`: "Gemini", \`documentType\`: "**Steel Supplier Declaration**".
3. Leaf values: **string**, **boolean** (for \`containsSteel\`, \`meltedPouredInUs\`, \`signature\`), **array** (for \`invoiceNumbers\`), or **null**. No confidence/evidence/notes fields.
4. Use **exact JSON keys** from the template.

FIELD-LEVEL RULES:
5. **\`products[].containsSteel\` / \`meltedPouredInUs\`**: "Yes"/"✓"/"X"/true → **true**; "No"/blank/false → **false**.
6. **\`products[].usHtsCode\`**: keep dots as printed (e.g. "7308.90.95.90"). Do NOT strip dots.
7. **\`products[].finishedPartPriceUsd\` / \`steelContentValueUsd\`**: strip any leading "$" or currency symbol. Store plain numeric string (e.g. "80.10").
8. **\`products[].steelContentWeightKg\`**: strip "Kgs", "kg", "KGS" suffix AND thousands commas. Store plain numeric string only.
   - "88,320.00 Kgs" → "88320.00" | "27360.00 Kgs" → "27360.00"
9. **\`products[].partNumber\`**: remove any spaces introduced by line-wrapping around dots.
   - "WB.G.FG.CB141. 6085.1300.A.IN" → "WB.G.FG.CB141.6085.1300.A.IN"
10. **\`products[].invoiceNumbersRaw\`**: copy the invoice cell text **exactly as printed** (e.g. "EXP/1038,1042,1057,1062"). Set to **null** if no invoice column exists on the PDF.
11. **\`products[].invoiceNumbers\`**: expand abbreviated invoice numbers using the prefix of the first full number:
    - "EXP/1038,1042,1057" → ["EXP/1038","EXP/1042","EXP/1057"]
    - "KA/UM/2526/00616,615,632" → ["KA/UM/2526/00616","KA/UM/2526/00615","KA/UM/2526/00632"]
    - Prefix = everything up to and including the last "/" before the first numeric segment.
    - Set to **null** if no invoice column exists.
12. **\`certification.referenceType\`**: set to "BL" if the label says "BL No#" or "B/L"; set to "Booking" if it says "Booking No#".
13. **\`certification.stampDinNumber\`**: strip "DIN-" prefix; store digits only (e.g. "10160427"). Null if not present.
14. **\`certification.signature\`**: **true** if any wet ink signature, rubber stamp, circular seal, or signature mark is visible; **false** only if clearly absent.

ZETWERK STAMP (circular seal only):
15. Some Zetwerk SSDs have only a circular rubber seal with no company name text, no signatory name, and no DIN number in the stamp block. In that case:
    - \`stampCompanyName\` = **null**, \`stampSignatoryName\` = **null**, \`stampDesignation\` = **null**, \`stampDinNumber\` = **null**
    - \`signature\` = **true** (the seal counts as a signature mark)

REFERENCE INVOICES — COMPLETE EXTRACTION (critical):
16. **EXTRACT ALL INVOICE ENTRIES FROM ALL PAGES**: Scan every page of the PDF. Invoice tables and lists can appear on any page, including page 2 and beyond. Do NOT stop after the first page or after the first few entries. Count the invoices you see in the PDF and verify your output contains exactly that many entries.

17. **Table format** (Immadi / 2-page SSDs, page 2): A 2-column table whose headers and data appear as **alternating lines** in the text layer:
    - Column 1 header: **"Export Invoice No"** (or "Invoice No", "Invoice Number", "Inv No", or similar)
    - Column 2 header: **"Export Invoice Date"** (or "Invoice Date", "Inv Date", etc.) — this header is sometimes **split across 2 lines** due to narrow column width, e.g. `"Export"` on one line and `"Invoice Date"` on the next, or `"Export Invoice"` on one line and `"Date"` on the next. Treat consecutive lines that together form a date-column label as a single column header — NOT as a new data column.
    - After the headers, data lines alternate: **invoice number** line, then **date** line, then invoice number, then date, and so on.
    - Extract **one `referenceInvoices[]` entry per (invoice number + date) pair**. Each pair = one `invoiceNumber` value and one `invoiceDate` value.
    - Example text layer order: `Export Invoice No → Export Invoice Date → EXP/49/26-27 → 8-Apr-26` → produces one entry `{invoiceNumber: "EXP/49/26-27", invoiceDate: "8-Apr-26"}`.
    - **Extract ALL pairs from ALL pages.** Do not stop after the first entry or first page. Continue scanning until you have reached the end of the document.
    - **DUAL-COLUMN LAYOUT (rare):** Some tables have 4 columns — left (Invoice No + Date) and right (Invoice No + Date). Extract both pairs per row as separate entries.
    - Do NOT confuse the split column header lines with data lines.
18. **Inline text format** (Zetwerk / single-page SSDs): invoices appear as a comma-separated list in a sentence like "Invoice No. KA/UM/2526/00578, KA/UM/2526/00610, ..." next to the BL reference. Parse **each invoice number** into a separate \`referenceInvoices[]\` entry with \`invoiceDate: null\`. Do not combine multiple invoice numbers into one entry.

DATES:
19. **\`certificationDate\`** and **\`referenceInvoices[].invoiceDate\`**: extract as printed; post-processing normalizes to DD-MMM-YYYY. Set \`invoiceDate\` to **null** when no date column exists.

NULL VS EMPTY:
20. Use **null** for fields absent from the PDF. Use "" only as a last resort for present-but-blank fields.

SECTION MAPPING:
${sectionLines.join("\n\n")}

TEMPLATE (shape and keys — replace values from the PDF):
${JSON.stringify(example, null, 2)}`;
}
