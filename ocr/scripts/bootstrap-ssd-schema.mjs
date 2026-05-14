/**
 * One-shot: writes output/schema-discovery/Steel Supplier Declaration.final-schema.json
 * Run: node scripts/bootstrap-ssd-schema.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output", "schema-discovery", "Steel Supplier Declaration.final-schema.json");

function f(section, fieldName, description, required = false, alternateLabels) {
  const o = {
    section,
    fieldName,
    fieldType: "string",
    description,
    required,
  };
  if (alternateLabels?.length) o.alternateLabels = alternateLabels;
  return o;
}

const fields = [
  ...[
    ["Company", "Company Name", "Exporter / supplier company name from letterhead", true],
    ["Company", "CIN", "Company Identification Number (null for Zetwerk SSDs)"],
    ["Company", "Registered Address", "Registered address from letterhead"],
    ["Company", "GST Number", "GST/GSTIN registration number"],
    ["Company", "Email", "Company email (null for Zetwerk SSDs)"],
    ["Company", "Phone", "Company phone number (null for Zetwerk SSDs)"],
  ].map(([s, n, d, r, a]) => f(s, n, d, r, a)),
  ...[
    ["Products", "Part Number", "Product SKU / part number (e.g. WB.G.FG.CB02.6120.1425.A.IN)", true],
    ["Products", "US HTS Code", "US HTSUS tariff code with dots (e.g. 7308.90.95.90)", false, ["HTS Code", "HTSUS"]],
    ["Products", "Contains Steel", "Boolean — whether the part contains steel (Yes/No checkbox or column)"],
    ["Products", "Melted Poured In US", "Boolean — whether steel was melted and poured in the US"],
    ["Products", "Finished Part Price USD", "Finished part price in USD (strip $ prefix)"],
    ["Products", "Steel Content Value USD", "Value of steel content in USD (strip $ prefix)"],
    ["Products", "Steel Content Weight Kg", "Weight of steel content in kg (strip Kgs/kg suffix)"],
    ["Products", "Invoice Numbers Raw", "Original invoice cell text exactly as printed (e.g. 'EXP/1038,1042,1057')"],
    ["Products", "Invoice Numbers", "Expanded full invoice number array (e.g. [\"EXP/1038\",\"EXP/1042\"])"],
  ].map(([s, n, d, r, a]) => f(s, n, d, r, a)),
  ...[
    ["Certification", "Statement", "Full certification statement text (the 'I, [company], certify...' paragraph)"],
    ["Certification", "Reference Type", "Type of reference number: 'BL' or 'Booking'"],
    ["Certification", "Reference Number", "BL or Booking reference number (e.g. SH000003979)"],
    ["Certification", "Signatory Name", "Name of typed signatory (from typed Name field, left block)"],
    ["Certification", "Signatory Title", "Title/designation of typed signatory"],
    ["Certification", "Signatory Email", "Email of typed signatory"],
    ["Certification", "Certification Date", "Date from typed Date field, normalize to DD-MMM-YYYY"],
    ["Certification", "Stamp Company Name", "Company name from rubber stamp / signature block (right block, may differ from header)"],
    ["Certification", "Stamp Signatory Name", "Name from stamp block (may differ from typed signatory name)"],
    ["Certification", "Stamp Designation", "Designation from stamp block (e.g. Managing Director)"],
    ["Certification", "Stamp DIN Number", "DIN number from stamp block (strip 'DIN-' prefix, digits only)"],
    ["Certification", "Signature", "Boolean — true if wet signature, stamp, or any signature mark is visible"],
  ].map(([s, n, d, r, a]) => f(s, n, d, r, a)),
  ...[
    ["Reference Invoices", "Invoice Number", "Full invoice number from the reference invoice table (e.g. EXP/1038/25-26)"],
    ["Reference Invoices", "Invoice Date", "Invoice date from the table, normalize to DD-MMM-YYYY"],
  ].map(([s, n, d, r, a]) => f(s, n, d, r, a)),
];

const doc = {
  documentCategory: "Steel Supplier Declaration",
  source: "Gemini",
  summary:
    "US-bound steel supplier declaration (metal content / Section 232): company header, product table with steel content, certification block with typed and stamp sections, and reference invoice table.",
  statistics: { outputFieldCount: fields.length },
  fields,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log("Wrote", out, "fields:", fields.length);
