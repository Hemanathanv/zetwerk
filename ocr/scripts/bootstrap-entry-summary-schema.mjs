/**
 * One-shot: writes output/schema-discovery/Entry Summary.final-schema.json
 * Run: node scripts/bootstrap-entry-summary-schema.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output", "schema-discovery", "Entry Summary.final-schema.json");

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
    ["Header", "Filer Code Entry Number", "CBP filer code + entry number as printed"],
    ["Header", "Entry Type", "Entry type code / classification"],
    ["Header", "Summary Date", "Summary date"],
    ["Header", "Surety Number", "Surety number if present"],
    ["Header", "Bond Type", "Bond type"],
    ["Header", "Port Code", "Port code"],
    ["Header", "Entry Date", "Entry date"],
    ["Header", "Team Number", "Team number if present"],
    ["Header", "Summary Status", "Summary status"],
    ["Header", "Form Version", "Form version"],
    [
      "Header",
      "Form Number",
      'Form identifier e.g. "CBP Form 7501"',
      false,
      ["CBP Form 7501", "7501"],
    ],
  ].map(([s, n, d, r, a]) => f(s, n, d, r, a)),
  ...[
    ["Transport", "Importing Carrier", "Carrier name"],
    ["Transport", "Mode of Transport", "Mode of transport"],
    ["Transport", "Import Date", "Import date"],
    ["Transport", "B/L or AWB Number", "Master B/L or AWB", false, ["B/L", "AWB", "Bill of Lading"]],
    ["Transport", "Additional B/Ls", "Additional B/L references"],
    ["Transport", "House Bill", "House bill"],
    ["Transport", "Subhouse Bill", "Subhouse bill"],
    ["Transport", "Bill Qty", "Bill quantity"],
    ["Transport", "Bill Qty Unit", "Bill quantity unit"],
    ["Transport", "Manufacturer ID", "Manufacturer ID"],
    ["Transport", "Exporting Country", "Exporting country"],
    ["Transport", "Export Date", "Export date"],
    ["Transport", "IT Number", "IT / immediate delivery number"],
    ["Transport", "IT Date", "IT date"],
    ["Transport", "Missing Docs", "Missing documents note"],
    ["Transport", "Foreign Port of Lading", "Foreign port of lading"],
    ["Transport", "US Port of Unlading", "US port of unlading"],
  ].map(([s, n, d, r, a]) => f(s, n, d, r, a)),
  ...[
    ["Parties", "Country of Origin", "Country of origin"],
    ["Parties", "Location of Goods", "Location of goods / FIRMS"],
    ["Parties", "Consignee Number", "Consignee number"],
    ["Parties", "Importer Number", "Importer number (e.g. IRS/EIN context)"],
    ["Parties", "Reference Number", "Other reference"],
    ["Parties", "Ultimate Consignee Name", "Ultimate consignee name"],
    ["Parties", "Ultimate Consignee Address", "Street address line"],
    ["Parties", "Ultimate Consignee City", "City"],
    ["Parties", "Ultimate Consignee State", "State"],
    ["Parties", "Ultimate Consignee Zip", "ZIP"],
    ["Parties", "Importer of Record Name", "IOR name"],
    ["Parties", "Importer of Record Address", "IOR street address"],
    ["Parties", "Importer of Record City", "IOR city"],
    ["Parties", "Importer of Record State", "IOR state"],
    ["Parties", "Importer of Record Zip", "IOR ZIP"],
  ].map(([s, n, d, r, a]) => f(s, n, d, r, a)),
  ...[
    ["Trade Compliance", "Country of Melt and Pour", "Steel melt & pour country if declared"],
    ["Trade Compliance", "Primary Country of Smelt", "Primary smelt country"],
    ["Trade Compliance", "Secondary Country of Smelt", "Secondary smelt country"],
    ["Trade Compliance", "Country of Cast", "Country of cast"],
  ].map(([s, n, d, r, a]) => f(s, n, d, r, a)),
  ...[
    ["Line Items", "Line No", "CBP line number"],
    ["Line Items", "Invoice Number", "Commercial invoice number"],
    ["Line Items", "Merchandise Description", "Line merchandise description"],
    ["Line Items", "HTSUS Number", "Primary HTSUS for line", false, ["HTS", "Tariff"]],
    ["Line Items", "Gross Weight Kg", "Gross weight (kg)"],
    ["Line Items", "Net Quantity", "Net quantity"],
    ["Line Items", "Net Quantity Unit", "UOM"],
    ["Line Items", "Entered Value", "Entered value"],
    ["Line Items", "Charges", "Charges"],
    ["Line Items", "Relationship", "Relationship code / note"],
    ["Line Items", "HTSUS Rate", "Duty rate"],
    ["Line Items", "HTSUS Duty", "Duty amount"],
    ["Line Items", "Invoice Value USD", "Invoice value USD"],
    ["Line Items", "Deduction Charge", "Deduction / charge"],
    ["Line Items", "Total Entered Value Invoice", "Total entered value for invoice"],
    ["Line Items", "MPF Rate", "MPF rate"],
    ["Line Items", "MPF Amount", "MPF amount"],
    ["Line Items", "HMF Rate", "HMF rate"],
    ["Line Items", "HMF Amount", "HMF amount"],
  ].map(([s, n, d, r, a]) => f(s, n, d, r, a)),
  ...[
    ["Fees", "MPF Total", "Total MPF"],
    ["Fees", "HMF Total", "Total HMF"],
    ["Fees", "Total Other Fees", "Other fees total"],
  ].map(([s, n, d, r, a]) => f(s, n, d, r, a)),
  ...[
    ["Totals", "Total Entered Value", "Total entered value"],
    ["Totals", "Total Duty", "Total duty"],
    ["Totals", "Total Tax", "Total tax"],
    ["Totals", "Total Other", "Total other"],
    ["Totals", "Grand Total", "Grand total"],
  ].map(([s, n, d, r, a]) => f(s, n, d, r, a)),
  ...[
    ["Declarant", "Declarant Name", "Signatory individual name (e.g. Last, First)"],
    [
      "Declarant",
      "Declarant Company",
      "Declarant / broker company name as printed (e.g. customs broker legal name)",
    ],
    ["Declarant", "Declarant Title", "Title"],
    ["Declarant", "Declarant Date", "Signature date"],
    ["Declarant", "Is Owner", "Owner checkbox / declaration"],
    ["Declarant", "Is Purchase", "Purchase checkbox / declaration"],
  ].map(([s, n, d, r, a]) => f(s, n, d, r, a)),
  ...[
    ["Broker", "Broker Name", "Customs broker name"],
    ["Broker", "Broker Address", "Broker address"],
    ["Broker", "Broker Phone", "Broker phone"],
    ["Broker", "Broker Importer File Number", "Broker / importer file no."],
  ].map(([s, n, d, r, a]) => f(s, n, d, r, a)),
];

const doc = {
  documentCategory: "Entry Summary",
  source: "Gemini",
  summary:
    "US CBP-style entry summary (e.g. 7501): header, transport, parties, trade compliance, line items with nested tariffLines[], fees, totals, declarant, broker.",
  statistics: { outputFieldCount: fields.length },
  fields,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log("Wrote", out, "fields:", fields.length);
