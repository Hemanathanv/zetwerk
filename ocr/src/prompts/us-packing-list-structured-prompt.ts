/**
 * US Packing List - structured extraction prompt preamble + canonical key map.
 * Python uses the preamble text and this canonical map to build the final schema-driven prompt.
 */

import type { SchemaRow } from "./us-packing-list-schema-types.js";

const CANONICAL_JSON_KEY_BY_FIELD_NAME: Record<string, string> = {
  "Packing Slip Number": "packingSlipNumber",
  "Document Status": "documentStatus",
  "SO Number": "soNumber",
  "Document Date": "documentDate",
  "Shipper Name": "shipperName",
  "Shipper Location": "shipperLocation",
  "Ship-To Name": "shipToName",
  "Ship-To Address": "shipToAddress",
  "Consignee Name": "consigneeName",
  "Consignee Address": "consigneeAddress",
  "PO Number": "poNumber",
  "Project Name": "projectName",
  "Project ID": "projectId",
  "BOL Number": "bolNumber",
  "Country of Origin": "countryOfOrigin",
  "Estimated Delivery Date": "estimatedDeliveryDate",
  "Carrier Name": "carrierName",
  "Appointment Time": "appointmentTime",
  "Trailer Loaded (Shipper Confirmed)": "trailerLoadedShipperConfirmed",
  "Freight Counted (Shipper Confirmed)": "freightCountedShipperConfirmed",
  "Trailer Loaded (Driver Confirmed)": "trailerLoadedDriverConfirmed",
  "Freight Counted (Driver Confirmed)": "freightCountedDriverConfirmed",
  "Total Lines": "totalLines",
  "Total Pieces (Aggregate)": "totalPiecesAggregate",
  "Total Bundles (Aggregate)": "totalBundlesAggregate",
  "Total Weight (lbs)": "totalWeightLbs",
  "Gross Weight Unit": "grossWeightUnit",
  "Received By (Name)": "receivedByName",
  "Shipper Signature": "shipperSignature",
  "Shipper Signature Date": "shipperSignatureDate",
  "Carrier Signature": "carrierSignature",
  "Carrier Signature Date": "carrierSignatureDate",
  "Liability Limitation Notice": "liabilityLimitationNotice",
  "Condition Statement": "conditionStatement",
  "Property Value Declared (Shipper)": "propertyValueDeclaredShipper",
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

export function buildStructuredUsPackingListPrompt(_schema: SchemaRow[]): string {
  return `You are a precision extractor for US Packing List PDFs.

OUTPUT RULES (critical):
1. Respond with one JSON object only (no markdown fences).
2. Top-level keys must include "source": "Gemini" and "documentType": "US Packing List".
3. Leaf values must be string or null only.
4. Use exact JSON keys from the template and section mapping.
5. Copy values exactly as printed when present.
6. If a field is not visible anywhere in the PDF, set it to null.
7. Do not invent values or infer missing content.
8. Keep IDs and references exactly as printed.
9. Keep dates and times as printed.
10. SCAN ALL PAGES: Fields may appear on any page — scan headers, footers, body, and sidebars across the entire document.
11. POSITION-AGNOSTIC: Labels may differ from exact names listed (e.g. "Slip #" = "Packing Slip Number", "Ship To" = "Ship-To Name", "Total Wt" = "Total Weight (lbs)"). Match semantically equivalent labels.

SECTION MAPPING:`;
}
