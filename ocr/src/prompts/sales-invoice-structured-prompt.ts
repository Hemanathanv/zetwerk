/**
 * Hierarchical Sales Invoices extraction prompt: nested objects + lineItems[].
 * Keys are derived from schema section / fieldName (camelCase); values are raw source text only.
 */

import type { SchemaRow } from "./sales-invoice-schema-types.js";

const ARRAY_SECTIONS = new Set(["Line Items"]);

/**
 * One clean camelCase key per bloated or merged schema label (exact `fieldName` match).
 * Keeps extraction JSON stable when the XLSX/JSON schema still uses long slash-separated titles.
 */
const CANONICAL_JSON_KEY_BY_FIELD_NAME: Record<string, string> = {
  "Invoice No / Invoice No. /": "invoiceNo",
  "Buyer Order No. / Buyer PO No / Buyer's PO No": "buyerPoNo",
  "Buyers Order No / Buyers Order No.": "buyersOrderNo",
  "Buyers Order Date": "buyerPoDate",
  "Bank A/c No / Bank Account Number / Bank Account No.": "bankAccountNo",
  "Invoice Type / Invoice Type Declaration /  Supply Type / Export Declaration Type":
    "invoiceType",
  "Payment Terms / Payment Term": "paymentTerms",
  "Total Amount": "totalAmount",
  "GST No. / GSTIN": "gstin",
  "GST No.": "gstin",
  "IEC# / IEC": "iec",
  "Bank Branch /Bank Branch Name / Branch Name": "bankBranch",
  "Buyer's PO No": "buyerPoNo",
  "Buyer's PO Date": "buyerPoDate",
  "Assignment Clause / Receivables Assignment / Receivables Assignment Clause / Receivables Assignment Note / Receivables Assignment Notice":
    "receivablesAssignmentNotice",
  "Marks & Numbers / Mark No / Mark No.": "marksAndNumbers",
  "No. & Kind of Pkgs": "packageDescription",
  "Product Code / Internal Product Code": "productCode",
  "Invoice type": "invoiceType",
  "Receivables assignment notice": "receivablesAssignmentNotice",
  "Buyer PO No": "buyerPoNo",
  "Buyer PO Date": "buyerPoDate",
  "Bank account no": "bankAccountNo",
  "Bank branch": "bankBranch",
  "Payment terms": "paymentTerms",
  "Total value in words": "totalValueInWords",
  "Marks and numbers": "marksAndNumbers",
  "Package description": "packageDescription",
  "Product code": "productCode",
  "Line total": "lineTotal",
  "PAN / PAN No": "panNo",
  "PAN No": "panNo",
  "Other references": "otherReferences",
  "Other Reference(s)": "otherReferences",
  "Zetwerk Ref": "zetwerkRef",
  "Zetwerk Ref#": "zetwerkRef",
  "LUT/ARN No": "lutArnNo",
  "Tax rate": "taxRate",
  "Tax Percentage / Tax Rate": "taxRate",
  "Tax amount per line": "taxAmountPerLine",
  "Tax Amount per Line": "taxAmountPerLine",
  "CIN No": "cinNo",
  "Buyer Address": "buyerAddress",
  "Container No": "containerNo",
  "Seal No": "sealNo",
  "BO Code": "boCode",
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

/** Stable top-level JSON key for a schema section label. */
export function sectionToJsonKey(section: string): string {
  return toCamelCase(tokenizeFieldLabel(section.trim()) || ["section"]);
}

/** Property key for a field within a section (unique per section in practice). */
export function fieldNameToJsonKey(
  section: string,
  fieldName: string,
  used: Set<string>,
): string {
  const trimmed = fieldName.trim();
  const sec = section.trim() || "General";
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

export interface SalesInvoiceStructuredTemplate {
  /** Ordered list of { jsonKey, human section label } */
  sections: { jsonKey: string; label: string }[];
  /** jsonKey -> field list */
  fieldsBySection: Map<string, { jsonKey: string; fieldName: string }[]>;
  arraySectionKeys: Set<string>;
}

export function buildStructuredTemplate(schema: SchemaRow[]): SalesInvoiceStructuredTemplate {
  const bySection = new Map<string, { jsonKey: string; fieldName: string }[]>();
  const sectionOrder: string[] = [];
  const seenSection = new Set<string>();

  for (const row of schema) {
    const sec = row.section.trim() || "General";
    if (!seenSection.has(sec)) {
      seenSection.add(sec);
      sectionOrder.push(sec);
    }
    const used = new Set(
      (bySection.get(sec) ?? []).map((x) => x.jsonKey),
    );
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
      [...bySection.entries()].map(([sec, fields]) => [
        sectionToJsonKey(sec),
        fields,
      ]),
    ),
    arraySectionKeys,
  };
}

function emptyTemplateObject(
  template: SalesInvoiceStructuredTemplate,
): Record<string, unknown> {
  const root: Record<string, unknown> = {
    source: "Gemini",
    documentType: "Sales Invoices",
  };

  for (const { jsonKey: sk } of template.sections) {
    const fields = template.fieldsBySection.get(sk);
    if (!fields) continue;
    if (template.arraySectionKeys.has(sk)) {
      const row: Record<string, string> = {};
      for (const f of fields) row[f.jsonKey] = "";
      root[sk] = [row];
    } else {
      const obj: Record<string, string | boolean> = {};
      for (const f of fields) {
        obj[f.jsonKey] =
          sk === "compliance" && f.jsonKey === "signature" ? false : "";
      }
      root[sk] = obj;
    }
  }
  return root;
}

export function buildStructuredSalesInvoicePrompt(schema: SchemaRow[]): string {
  const template = buildStructuredTemplate(schema);
  const example = emptyTemplateObject(template);

  const sectionLines: string[] = [];
  for (const { jsonKey, label } of template.sections) {
    const fields = template.fieldsBySection.get(jsonKey)!;
    const isArr = template.arraySectionKeys.has(jsonKey);
    const fieldList = fields
      .map((f) => `    - JSON key \`${f.jsonKey}\` ← schema field **${f.fieldName}**`)
      .join("\n");
    sectionLines.push(
      isArr
        ? `- **${label}** → top-level key \`${jsonKey}\` is a **JSON array**. One object per **invoice line row** in the PDF table (same columns repeated). If only one line, use length 1. If no line table, use [].\n${fieldList}`
        : `- **${label}** → top-level key \`${jsonKey}\` is a **JSON object** (flat key/value).\n${fieldList}`,
    );
  }

  return `You are a precision extractor for **Sales Invoices** (export / commercial / e-invoice PDFs).

OUTPUT RULES (critical):
1. Respond with **one JSON object only** (no markdown fences).
2. Top-level keys **must** include \`source\`: "Gemini" and \`documentType\`: "Sales Invoices".
3. **Raw values only**: every leaf value is a **string**, **boolean** (only for \`compliance.signature\`), or **null**. No confidence, evidence, notes, status, or reasoning in JSON.
4. Use the **JSON keys** exactly as in the template (camelCase). Map PDF labels using schema field names and alternate labels.
5. **lineItems**: one object per invoice line row; same property set each row.
6. **Single location per concept** (schema is deduplicated): e.g. **GSTIN** only under \`compliance\`; **IEC** only under \`entities\`; **invoiceNo** / **invoiceDate** only under \`header\`; **buyerPoNo** / **buyerPoDate** only under \`header\`; bank/SWIFT/IFSC/**bankName** only under \`financial\`; shipping bill no/date only under \`header\`; **countryOfOrigin** only under \`shipment\`.
7. **compliance.signature**: set **true** if any authorized signatory stamp, wet signature, or signature block is **visible** on the PDF; **false** only if clearly absent.
8. **Line items — three distinct fields**: \`productCode\` = SKU / internal part code only (e.g. \`WB.G.FG.CB141.6085.1300.A.IN\`). \`productDescription\` = **short** product **name** only (e.g. “INTERIOR PILE”) — no full SKU, no long spec. \`productSpecification\` = **technical** spec only (dimensions, grade, material, finish, length) — **not** origin/certificate sentences (e.g. not “100% Indian steel, smelted in India”). **Never** put HSN in \`productDescription\` — use \`hsnCode\` / \`hsnCodeDestination\` only.
9. **compliance.irnNumber**: when the PDF has an e-invoice **IRN** (label “IRN Number” / “IRN”, metadata block, or **QR** payload / embedded IRN string), you **must** extract it — do not omit when visible.
10. **financial.incoterms**: incoterm **code** only (e.g. FOB, EXW) when possible; put longer “terms of delivery” prose in \`financial.paymentTerms\` if needed.
11. **header.invoiceType**: for Zetwerk-style PDFs, use the **full export/supply banner** (e.g. “SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX”), **not** the generic section heading “Tax Invoice”.
12. **lineItems**: use **\`rate\` only** for unit price (no separate \`unitPrice\`). Fill **\`noOfPackages\`** per line when the table shows a package count per row. Fill **\`kindOfPkg\`** (e.g. PKGS) whenever the line shows a package type. **Marks**: put per-line marks in **\`productMarks\`**. Extract **\`boCode\`** from BO Code. For combined headers like **CONTAINER NO / SEAL NO**, split into **\`containerNo\`** and **\`sealNo\`** on the same line item row. If the invoice has **only one line**, set **\`shipment.marksAndNumbers\` to \`null\`** — all marks go in that line’s \`productMarks\` (even when the PDF prints them near shipment). For **multiple** lines, \`shipment.marksAndNumbers\` may hold invoice-level combined marks when shown once for the whole invoice.
13. **footer.digitalSignatureTimestamp**: **clock time only** (e.g. \`11:58:14\`, \`20:48:50\`) — **no** date in this field; use \`footer.digitalSignatureDate\` for the date.
14. **entities.buyerAddress**: fill when buyer block has an address distinct from consignee; may match consignee when same party.
15. **footer.receivablesAssignmentBeneficiary**: if the PDF includes a **receivables assignment** clause (same text as \`receivablesAssignmentNotice\`), you **must** extract the **named assignee entity** (e.g. “Linklogis International Company Limited”) into \`receivablesAssignmentBeneficiary\` — never leave it null when the clause is present.
16. Amounts/dates: you may output print-style strings; **post-processing** normalizes money, ISO currency, DD-Mon-YYYY dates, HSN dots, **consignee/buyer address comma spacing**, **time-only** digital signature timestamp, **single-line shipment marks → line + null shipment**, strips origin phrasing from \`productSpecification\`, and may **infer beneficiary from notice text** if you omitted it (see pipeline).

SECTION MAPPING:
${sectionLines.join("\n\n")}

TEMPLATE (shape and keys — replace values from the PDF):
${JSON.stringify(example, null, 2)}`;
}
