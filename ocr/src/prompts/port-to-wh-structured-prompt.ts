/**
 * Transporter Bill (Port to Warehouse) - structured extraction prompt preamble + canonical key map.
 * Python uses the preamble text and this canonical map to build the final schema-driven prompt.
 */

import type { SchemaRow } from "./port-to-wh-schema-types.js";

const CANONICAL_JSON_KEY_BY_FIELD_NAME: Record<string, string> = {
  Invoice: "invoice",
  "Invoice Date": "invoiceDate",
  "Due Date": "dueDate",
  "Payment Terms": "paymentTerms",
  Vendor: "vendor",
  "Shipment ID": "shipmentId",
  "Order Number": "orderNumber",
  "Customer Reference Number": "customerReferenceNumber",
  "Pickup Location": "pickupLocation",
  "Pickup Date": "pickupDate",
  "Delivery Location": "deliveryLocation",
  "Delivery Date": "deliveryDate",
  "Container Type": "containerType",
  MBL: "mbl",
  "Container Number": "containerNumber",
  "Weight Lbs": "weightLbs",
  "Charge Description": "chargeDescription",
  Units: "units",
  "Unit Rate": "unitRate",
  Subtotal: "subtotal",
  "Tax 1": "tax1",
  "Tax 2": "tax2",
  "Total Charge": "totalCharge",
  "Storage Days": "storageDays",
  "Permit Weight": "permitWeight",
};

function tokenizeFieldLabel(s: string): string[] {
  return s
    .replace(/\s*[/|,&()#-]\s*/g, " ")
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

export function fieldNameToJsonKey(fieldName: string): string {
  const trimmed = fieldName.trim();
  return CANONICAL_JSON_KEY_BY_FIELD_NAME[trimmed] ?? toCamelCase(tokenizeFieldLabel(trimmed));
}

export function buildStructuredTransporterBillPrompt(_schema: SchemaRow[]): string {
  return `You are a precision extractor for Transporter / Trucking Bill (Port to Warehouse) PDFs.

OUTPUT RULES (critical):
1. Respond with one JSON object only (no markdown fences).
2. Top-level keys must include "source": "Gemini" and "documentType": "Transporter Bill".
3. Leaf values must be string or null only.
4. Use exact JSON keys from the template and section mapping.
5. Copy values exactly as printed when present (preserve currency symbols, units like "lbs", and numeric formatting).
6. If a field is not visible anywhere in the PDF, set it to null.
7. Do not invent values, expand abbreviations, or infer missing text.
8. Keep invoice numbers, MBL numbers, container numbers, and shipment IDs exactly as printed.
9. Keep dates as printed; downstream normalization handles format alignment.
10. The "lineItems" array holds ONE OBJECT PER CHARGE ROW. Each object must contain the keys chargeDescription, units, unitRate, subtotal — populate each key independently from its own column on that row. Never concatenate multiple charge rows into a single object, and never put all descriptions/subtotals into one entry. If a column is blank for a row, set that key to null but still emit a separate object for the row. Extract every charge row from every page.
11. SCAN ALL PAGES: Fields may appear on any page — check headers, footers, body, and sidebars across the entire document.
12. POSITION-AGNOSTIC: Labels may differ from exact names listed (e.g. "Inv #" = "Invoice", "B/L" = "MBL", "Container #" = "Container Number", "Cust Ref" = "Customer Reference Number"). Match semantically equivalent labels.

SECTION MAPPING:`;
}
