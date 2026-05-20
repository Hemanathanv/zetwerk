/**
 * Warehouse to Customer Bill - structured extraction prompt preamble + canonical key map.
 * Python uses the preamble text and this canonical map to build the final schema-driven prompt.
 */

import type { SchemaRow } from "./wh-to-customer-schema-types.js";

const CANONICAL_JSON_KEY_BY_FIELD_NAME: Record<string, string> = {
  "Invoice #": "invoiceNumber",
  Vendor: "vendor",
  "Invoice Date": "invoiceDate",
  "Due Date": "dueDate",
  "Payment Terms": "paymentTerms",
  "Bill To": "billTo",
  "Bill To Address": "billToAddress",
  "PO /subject/ CUST REF NO./ Customer Ref #": "poNumber",
  "Shipment #": "shipmentNumber",
  Label: "label",
  Value: "value",
  Shipper: "shipper",
  "Shipper Address": "shipperAddress",
  Consignee: "consignee",
  "Consignee Address": "consigneeAddress",
  "Pickup Date": "pickupDate",
  "Delivery Date": "deliveryDate",
  "Departure Location": "departureLocation",
  "Destination Location": "destinationLocation",
  "Commodity Description": "commodityDescription",
  "Pieces/Units": "piecesUnits",
  "Weight (lbs)": "weightLbs",
  "Volume (ft3)": "volumeFt3",
  Dimensions: "dimensions",
  "Service Type": "serviceType",
  "Charge Description": "chargeDescription",
  "Rate Type": "rateType",
  "Rate/Per Unit": "ratePerUnit",
  Quantity: "quantity",
  Amount: "amount",
  "FSC (%)": "fscPercent",
  "FSC Amount": "fscAmount",
  "Total Amount": "totalAmount",
  "Contact Name": "contactName",
  "Contact Phone": "contactPhone",
  "Contact Email": "contactEmail",
  "Bank Name": "bankName",
  "Account Number": "accountNumber",
  "Routing Number": "routingNumber",
  SWIFT: "swift",
  "Remit To Address": "remitToAddress",
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

export function buildStructuredWhToCustomerPrompt(_schema: SchemaRow[]): string {
  return `You are a precision extractor for Warehouse-to-Customer (final-mile / outbound freight) bill PDFs.

OUTPUT RULES (critical):
1. Respond with one JSON object only (no markdown fences).
2. Top-level keys must include "source": "Gemini" and "documentType": "WH to Customer".
3. Leaf values must be string or null only.
4. Use exact JSON keys from the template and section mapping.
5. Copy values exactly as printed when present (preserve currency symbols, units like "lbs" and "ft3", and percentages).
6. If a field is not visible anywhere in the PDF, set it to null.
7. Do not invent values, expand abbreviations, or infer missing text.
8. Keep invoice numbers, reference numbers, PO numbers, and shipment numbers exactly as printed.
9. Keep dates as printed; downstream normalization handles format alignment.
10. The "lineItems" array holds one entry per charge row (Charge Description, Rate Type, Rate Per Unit, Quantity, Amount). Extract every charge row from every page.
11. SCAN ALL PAGES: Fields may appear on any page — check headers, footers, body, and sidebars across the entire document.
12. POSITION-AGNOSTIC: Labels may differ from exact names listed (e.g. "Inv #" = "Invoice #", "Fuel Surcharge" = "FSC (%)", "Wt (lbs)" = "Weight (lbs)"). Match semantically equivalent labels.
13. REFERENCE FIELD DISAMBIGUATION:
    - "PO /subject/ CUST REF NO./ Customer Ref #" (poNumber) is ONE combined field. The STRICT allow-list of labels that map to poNumber is EXACTLY: "PO", "Subject", "CUST REF NO.", "Customer Ref #". Case-insensitive matching is allowed, and trailing punctuation/whitespace is allowed. NO OTHER labels qualify.
    - poNumber EXCLUSIONS — DO NOT map any of the following to poNumber, even though they sound similar: "Customer Reference", "Customer Ref" (without the "#"), "Cust Ref", "Reference", "Ref #", "Ref No", "Our Ref", "Your Ref", "PO #", "PO Number", "Purchase Order", "Order #", "Order Number", "SO", "SO Number", "BOL", "BOL #", "Ship Ref", "Ship Ref #", "Packing Slip", "File #", "Job #", "Remarks", "Remark", "Notes", "Note", "Comments", "Description", "Memo", "Special Instructions", "Terms", "Message". If the only candidate value is under one of these labels, set poNumber to null and put the value into "otherReferences" instead.
    - A poNumber value must look like a reference identifier (alphanumeric code, often with dashes/slashes), NOT a free-text sentence. If the candidate value reads as prose or contains multiple words of natural language, set poNumber to null.
    - "Other References" (otherReferences) is a JSON ARRAY. Emit one object per distinct OTHER reference label printed on the document — i.e. any labeled reference whose label is NOT in the strict poNumber allow-list above and is NOT the Shipment # and NOT remarks/notes/comments. Each object has: "label" = the exact label as printed (e.g. "Customer Reference", "Ship Ref #", "Packing Slip Number", "SO Number", "BOL #", "Carrier Ref", "Our Ref", "File #", "Job #"), "value" = the printed value exactly as shown.
    - DO NOT join multiple references into one string. DO NOT use separators like " | " or commas. Each labeled reference must be its own array entry.
    - If a single label has multiple values printed (e.g. "Ship Ref#: UNMF-PS-000015662 / UNMF-IJ-0004866"), keep them together in the "value" field exactly as printed for that one entry.
    - If no "other" references appear, return an empty array [] for otherReferences.

SECTION MAPPING:`;
}
