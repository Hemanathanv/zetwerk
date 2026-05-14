/**
 * CBP-style Entry Summary (Bill of Entry) — nested lineItems[].tariffLines[].
 */

import type { SchemaRow } from "./entry-summary-schema-types.js";

const ARRAY_SECTIONS = new Set(["Line Items"]);

const CANONICAL_JSON_KEY_BY_FIELD_NAME: Record<string, string> = {
  "Filer Code Entry Number": "filerCodeEntryNumber",
  "B/L or AWB Number": "blOrAwbNumber",
  "Line No": "lineNo",
  "HTSUS Number": "htsusNumber",
  "Invoice Number": "invoiceNumber",
  "Form Number": "formNumber",
  "INV VAL US": "invValUs",
  "INV VAL USD": "invValUs",
  ENTVAL: "entval",
  "Toatal Package": "totalPackage",
  "Total Package": "totalPackage",
};

const DEFAULT_TARIFF_LINE: Record<string, string | null> = {
  htsusNumber: "",
  description: "",
  grossWeight: null,
  netQuantity: null,
  netQuantityUnit: null,
  enteredValue: null,
  rate: "",
  dutyAmount: "",
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

export function fieldNameToJsonKey(
  section: string,
  fieldName: string,
  used: Set<string>,
): string {
  const trimmed = fieldName.trim();
  const canonical = CANONICAL_JSON_KEY_BY_FIELD_NAME[trimmed];
  let base = canonical ?? toCamelCase(tokenizeFieldLabel(trimmed));
  if (!base) base = "field";
  let key = base;
  let n = 2;
  while (used.has(key)) {
    key = `${base}_${n}`;
    n += 1;
  }
  used.add(key);
  return key;
}

export interface EntrySummaryStructuredTemplate {
  sections: { jsonKey: string; label: string }[];
  fieldsBySection: Map<string, { jsonKey: string; fieldName: string }[]>;
  arraySectionKeys: Set<string>;
}

export function buildStructuredTemplate(schema: SchemaRow[]): EntrySummaryStructuredTemplate {
  const bySection = new Map<string, { jsonKey: string; fieldName: string }[]>();
  const sectionOrder: string[] = [];
  const seenSection = new Set<string>();

  for (const row of schema) {
    const sec = row.section.trim() || "General";
    if (!seenSection.has(sec)) {
      seenSection.add(sec);
      sectionOrder.push(sec);
    }
    const used = new Set((bySection.get(sec) ?? []).map((x) => x.jsonKey));
    const jsonKey = fieldNameToJsonKey(sec, row.fieldName, used);
    const list = bySection.get(sec) ?? [];
    list.push({ jsonKey, fieldName: row.fieldName });
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

const NULL_DEFAULT_BY_SECTION: Record<string, Set<string>> = {
  header: new Set([
    "teamNumber",
    "summaryStatus",
    "formVersion",
    "invValUs",
    "entval",
    "totalPackage",
  ]),
  transport: new Set([
    "additionalBls",
    "houseBill",
    "subhouseBill",
    "billQty",
    "billQtyUnit",
    "itNumber",
    "itDate",
    "missingDocs",
  ]),
  parties: new Set(["referenceNumber"]),
  tradeCompliance: new Set([
    "countryOfMeltAndPour",
    "primaryCountryOfSmelt",
    "secondaryCountryOfSmelt",
    "countryOfCast",
  ]),
  lineItems: new Set([
    "charges",
    "relationship",
    "mpfRate",
    "mpfAmount",
    "hmfRate",
    "hmfAmount",
  ]),
  declarant: new Set(["isOwner", "isPurchase", "declarantCompany"]),
};

function emptyTemplateObject(template: EntrySummaryStructuredTemplate): Record<string, unknown> {
  const root: Record<string, unknown> = {
    source: "Gemini",
    documentType: "Entry Summary",
  };

  for (const { jsonKey: sk } of template.sections) {
    const fields = template.fieldsBySection.get(sk);
    if (!fields) continue;
    const nullKeys = NULL_DEFAULT_BY_SECTION[sk];

    if (template.arraySectionKeys.has(sk)) {
      const row: Record<string, unknown> = {};
      for (const f of fields) {
        if (nullKeys?.has(f.jsonKey)) row[f.jsonKey] = null;
        else row[f.jsonKey] = "";
      }
      row.tariffLines = [{ ...DEFAULT_TARIFF_LINE }];
      root[sk] = [row];
    } else {
      const obj: Record<string, string | boolean | null> = {};
      for (const f of fields) {
        if (nullKeys?.has(f.jsonKey)) obj[f.jsonKey] = null;
        else obj[f.jsonKey] = "";
      }
      root[sk] = obj;
    }
  }
  return root;
}

export function buildStructuredEntrySummaryPrompt(schema: SchemaRow[]): string {
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
      sectionLines.push(
        `- **${label}** → \`${jsonKey}\` is a **JSON array**. One object per **CBP/entry line**. Each object **must** include **\`tariffLines\`**: an array of duty/tariff sub-lines (repeat the structure shown in the template). Use \`[]\` only if a line truly has no tariff breakdown; otherwise include at least one element per printed tariff row.\n${fieldList}\n    - **tariffLines[]** → each element: \`htsusNumber\`, \`description\`, \`grossWeight\`, \`netQuantity\`, \`netQuantityUnit\`, \`enteredValue\`, \`rate\`, \`dutyAmount\` (use **null** for absent numeric/quantity cells).`,
      );
    } else {
      sectionLines.push(
        `- **${label}** → \`${jsonKey}\` is a **JSON object**.\n${fieldList}`,
      );
    }
  }

  return `You are a precision extractor for US **Entry Summary** / customs entry documents (e.g. **CBP Form 7501**, entry summary printouts).

OUTPUT RULES (critical):
1. Respond with **one JSON object only** (no markdown fences).
2. Top-level \`source\`: "Gemini", \`documentType\`: "**Entry Summary**".
3. Leaf values: **string**, **boolean** (only where checkboxes apply, e.g. \`declarant.isOwner\` / \`isPurchase\`), or **null**. No confidence or reasoning fields.
4. Use **exact JSON keys** from the template. Map PDF column headers to the closest schema field.
5. **header.formNumber**: capture the printed form id (e.g. "**CBP Form 7501**") when visible.
5a. **header.invValUs** and **header.entval**: extract **all occurrences** from bracketed summary text like \`[INV VAL US : 5,175.60, ENTVAL: 5,176.00]\` when present across the document. Ensure values are captured consistently for each invoice group / line-item group in document order (do not stop at first occurrence).
5b. **header.totalPackage**: capture standalone package token even when no visible column header (examples: \`66 PKG\`, \`34 PCS\`, \`9 BDL\`). Keep format as **"<count> <unit>"** and unit uppercase from {PKG, PCS, BDL}.
6. **lineItems — parent row vs \`tariffLines\`**: The **parent** object’s \`htsusNumber\`, \`merchandiseDescription\`, \`enteredValue\`, and \`netQuantity\` (and \`netQuantityUnit\` when shown) MUST match the **primary merchandise** tariff row — the main product HTSUS line (e.g. chapter 73 steel **7308.xx.xxxx** / **7308909590** style), **not** the first exclusion, Chapter 99, special-program, or split duty-only sub-line. Put **every** printed tariff sub-line (merchandise, exclusions, SPI, additional duties) into \`tariffLines[]\` in document order; the parent row summarizes **only** that primary merchandise line.
7. **tariffLines — weight vs quantity**: On the **merchandise** (primary) HTSUS row, a column value like **"17496.00 KG"** is **net quantity** (mass in kg), **not** gross weight — put the numeric amount in \`netQuantity\` (and unit in \`netQuantityUnit\` / or append " KG" consistently) and leave \`grossWeight\` **null** on that row unless a separate gross column exists. **Gross weight** values usually appear on **exclusion / Chapter 99 / special-duty** sub-lines; those may use \`grossWeight\`.
8. **Declarant**: \`declarantName\` = **individual** signatory only (e.g. **"Wellman, Nicole"**). \`declarantCompany\` = **company** on the declarant block (e.g. **"DAMCO CUSTOMS SERVICES INC"**). Do not put the company name in \`declarantName\`.
9. **Checkboxes**: If the **Owner** (or **Purchase**) box is marked with **X**, a checkmark, or "Yes", set \`declarant.isOwner\` (or \`isPurchase\`) to **true**. If clearly unchecked/empty, **false**. Use boolean, not strings.
10. **Dates**: US slash dates may be **MM/DD/YY** (e.g. **05/06/25**); post-processing normalizes to **DD-MMM-YYYY**.
11. Money, dates, and quantities may be pasted as printed; **post-processing** normalizes common numeric/date formats.
12. If a field is blank on the PDF, use \`null\` where the template shows **null** for that key; otherwise \`""\` is acceptable — empty strings are normalized to \`null\` where appropriate.

SECTION MAPPING:
${sectionLines.join("\n\n")}

TEMPLATE (shape and keys — replace from the PDF):
${JSON.stringify(example, null, 2)}`;
}
