/**
 * Customer Broker Bill - structured extraction prompt preamble + canonical key map.
 * Python uses the preamble text and this canonical map to build the final schema-driven prompt.
 */

import type { SchemaRow } from "./customer-broker-bill-schema-types.js";

const CANONICAL_JSON_KEY_BY_FIELD_NAME: Record<string, string> = {
  "Invoice #": "invoiceNumber",
  "Invoice Date": "invoiceDate",
  "Customer ID": "customerId",
  "Payment Terms": "paymentTerms",
  "Due Date": "dueDate",
  "Bill To": "billTo",
  "Bill To Address": "billToAddress",
  Shipper: "shipper",
  Consignee: "consignee",
  "Vessel/Voyage": "vesselVoyage",
  Origin: "origin",
  Destination: "destination",
  "Origin ETD + Destination ETA": "originEtdDestinationEta",
  "Ocean BOL": "oceanBol",
  "House BOL": "houseBol",
  "Booking Number": "bookingNumber",
  "IMO/Lloyds": "imoLloyds",
  Containers: "containers",
  "Goods Description": "goodsDescription",
  "Weight (kg/lbs) + Pieces/Units": "weightPiecesUnits",
  Volume: "volume",
  "PO # + Project Reference": "poNumberProjectReference",
  "Supplier Invoice Numbers": "supplierInvoiceNumbers",
  "Declaration #": "declarationNumber",
  "Entry Number": "entryNumber",
  "Charge Description": "chargeDescription",
  Quantity: "quantity",
  "Unit Price": "unitPrice",
  Amount: "amount",
  Subtotal: "subtotal",
  "Total Amount": "totalAmount",
  "Bank Name": "bankName",
  "Account # + ABA/Routing #": "accountNumberAbaRouting",
  "SWIFT Code + Wire Reference": "swiftCodeWireReference",
  "Remit To Address": "remitToAddress",
  "Contact Name": "contactName",
  "Contact Phone": "contactPhone",
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

export function buildStructuredCustomerBrokerBillPrompt(_schema: SchemaRow[]): string {
  return `You are a precision extractor for Customs / Customer Broker Bill PDFs.

OUTPUT RULES (critical):
1. Respond with one JSON object only (no markdown fences).
2. Top-level keys must include "source": "Gemini" and "documentType": "Customer Broker Bill".
3. Leaf values must be string or null only.
4. Use exact JSON keys from the template and section mapping.
5. Copy values exactly as printed when present (preserve currency symbols, punctuation, casing).
6. If a field is not visible anywhere in the PDF, set it to null.
7. Do not invent values, expand abbreviations, or infer missing text.
8. Keep invoice numbers, BOL numbers, declaration numbers, and entry numbers exactly as printed.
9. Keep dates as printed; downstream normalization handles format alignment.
10. The "lineItems" array holds ONE OBJECT PER CHARGE ROW. Each object must contain the keys chargeDescription, quantity, unitPrice, amount — populate each key independently from its own column on that row. Never concatenate multiple charge rows into a single object, and never put all descriptions/amounts into one entry. If a column is blank for a row, set that key to null but still emit a separate object for the row. Extract every charge row from every page.
11. SCAN ALL PAGES: Fields may appear on any page — check headers, footers, body, and sidebars across the entire document.
12. POSITION-AGNOSTIC: Labels may differ from exact names listed (e.g. "Invoice No." = "Invoice #", "MBL" = "Ocean BOL", "HBL" = "House BOL", "Ref" = "PO # + Project Reference"). Match semantically equivalent labels.

SECTION MAPPING:`;
}
