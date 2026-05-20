/**
 * Hierarchical Packing Lists extraction prompt: nested objects + lineItems[].
 */

import type { SchemaRow } from "./packing-list-schema-types.js";
import { buildPrismaBackedSingleLocationRule } from "./prisma-rule-helper.js";

const ARRAY_SECTIONS = new Set(["Line Items"]);

const CANONICAL_JSON_KEY_BY_FIELD_NAME: Record<string, string> = {
  "Invoice No": "invoiceNo",
  "Invoice Date": "invoiceDate",
  "Buyer PO No": "buyerPoNo",
  "Buyer PO Date": "buyerPoDate",
  "Zetwerk Ref": "zetwerkRef",
  "Other References": "otherReferences",
  "Pickup Address": "pickupAddress",
  "Product code": "productCode",
  "GSTIN": "gstin",
  "IEC": "iec",
  "Marks and numbers": "productMarks",
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

export interface PackingListStructuredTemplate {
  sections: { jsonKey: string; label: string }[];
  fieldsBySection: Map<string, { jsonKey: string; fieldName: string }[]>;
  arraySectionKeys: Set<string>;
}

export function buildStructuredTemplate(schema: SchemaRow[]): PackingListStructuredTemplate {
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

/** Schema-nullable fields default to null in the template example. */
const NULL_DEFAULT_BY_SECTION: Record<string, Set<string>> = {
  entities: new Set(["shipTo"]),
  header: new Set(["zetwerkRef", "otherReferences", "pickupAddress"]),
  footer: new Set(["dinNumber"]),
};

function emptyTemplateObject(template: PackingListStructuredTemplate): Record<string, unknown> {
  const root: Record<string, unknown> = {
    source: "Gemini",
    documentType: "Packing Lists",
  };

  for (const { jsonKey: sk } of template.sections) {
    const fields = template.fieldsBySection.get(sk);
    if (!fields) continue;
    const nullKeys = NULL_DEFAULT_BY_SECTION[sk];
    if (template.arraySectionKeys.has(sk)) {
      const row: Record<string, string | null> = {};
      for (const f of fields) {
        row[f.jsonKey] = "";
      }
      root[sk] = [row];
    } else {
      const obj: Record<string, string | boolean | null> = {};
      for (const f of fields) {
        if (sk === "compliance" && f.jsonKey === "signature") {
          obj[f.jsonKey] = false;
        } else if (nullKeys?.has(f.jsonKey)) {
          obj[f.jsonKey] = null;
        } else {
          obj[f.jsonKey] = "";
        }
      }
      root[sk] = obj;
    }
  }
  return root;
}

export function buildStructuredPackingListPrompt(schema: SchemaRow[]): string {
  const template = buildStructuredTemplate(schema);
  const example = emptyTemplateObject(template);
  const sectionsByField = new Map<string, string>();
  for (const { jsonKey: sectionKey } of template.sections) {
    for (const field of template.fieldsBySection.get(sectionKey) ?? []) {
      sectionsByField.set(field.jsonKey, sectionKey);
    }
  }
  const singleLocationRule = buildPrismaBackedSingleLocationRule({
    modelName: "PackingListExtraction",
    sectionsByField,
  });

  const sectionLines: string[] = [];
  for (const { jsonKey, label } of template.sections) {
    const fields = template.fieldsBySection.get(jsonKey)!;
    const isArr = template.arraySectionKeys.has(jsonKey);
    const fieldList = fields
      .map((f) => `    - JSON key \`${f.jsonKey}\` ← schema field **${f.fieldName}**`)
      .join("\n");
    sectionLines.push(
      isArr
        ? `- **${label}** → top-level key \`${jsonKey}\` is a **JSON array**. One object per **packing list line row** (same columns repeated). If one row, length 1. If no table, use [].\n${fieldList}`
        : `- **${label}** → top-level key \`${jsonKey}\` is a **JSON object** (flat key/value).\n${fieldList}`,
    );
  }

  return `You are a precision extractor for export / commercial **Packing Lists** (PDFs).

OUTPUT RULES (critical):
1. Respond with **one JSON object only** (no markdown fences).
2. Top-level keys **must** include \`source\`: "Gemini" and \`documentType\`: "Packing Lists".
3. **Raw values only**: every leaf value is a **string**, **boolean** (only for \`compliance.signature\`), or **null**. No confidence, evidence, notes, or reasoning in JSON.
4. Use the **JSON keys** exactly as in the template. Map PDF labels using schema field names and alternate labels.
5. **lineItems**: one object per table row; same property set on each row.
6. **compliance.signature**: **true** if any authorized signatory stamp, wet signature, or signature block is **visible**; **false** only if clearly absent.
7. **Line items**: \`productDescription\` = short name; \`productSpecification\` = technical spec (dimensions, grade, material, finish) — **not** origin/certificate marketing text. **HSN** only in \`hsnCode\`. \`productCode\` = SKU/part code.
8. **totals**: fill document-level totals when printed (\`totalBundles\`, \`totalQty\`, weights); use **null** only when the PDF has no such total line.
9. ${singleLocationRule}
10. **shipment**: logistics legs (ports, vessel/flight, countries) as printed.
11. Amounts/dates/weights may be print-style strings; **post-processing** normalizes numbers, dates (DD-Mon-YYYY where applicable), HSN dots, address comma spacing, and \`compliance.signature\` boolean.

SECTION MAPPING:
${sectionLines.join("\n\n")}

TEMPLATE (shape and keys — replace values from the PDF):
${JSON.stringify(example, null, 2)}`;
}
