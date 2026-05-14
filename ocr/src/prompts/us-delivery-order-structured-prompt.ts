/**
 * US Delivery Order - structured extraction prompt preamble + canonical key map.
 * Python uses the preamble text and this canonical map to build the final schema-driven prompt.
 */

import type { SchemaRow } from "./us-delivery-order-schema-types.js";

const CANONICAL_JSON_KEY_BY_FIELD_NAME: Record<string, string> = {
  "Shipper Name": "shipperName",
  "Shipper Address": "shipperAddress",
  "Shipper Contact": "shipperContact",
  "Consignee Name": "consigneeName",
  "Consignee Address": "consigneeAddress",
  "Consignee Contact": "consigneeContact",
  "Bill To Party": "billToParty",
  "Bill To Address": "billToAddress",
  "Bill To Contact": "billToContact",
  "Delivery Order Date": "deliveryOrderDate",
  "DO Reference Number (DAMCO)": "doReferenceNumberDamco",
  "DO File Number (KPM)": "doFileNumberKpm",
  "IT Number": "itNumber",
  "IT Date": "itDate",
  "Importing Carrier": "importingCarrier",
  "Delivering Carrier": "deliveringCarrier",
  "Carrier's Local Agent": "carriersLocalAgent",
  "Port of Loading (Origin)": "portOfLoadingOrigin",
  "Port of Discharge (Destination)": "portOfDischargeDestination",
  "Final Destination": "finalDestination",
  "B/L or AWB Number": "blOrAwbNumber",
  "Master Number": "masterNumber",
  "House Bill Numbers": "houseBillNumbers",
  "Entry Number": "entryNumber",
  "Customer Reference": "customerReference",
  "Arrival Date": "arrivalDate",
  "Free Time Expiration Date": "freeTimeExpirationDate",
  "Cargo Description (Commodity)": "cargoDescriptionCommodity",
  "HS Code": "hsCode",
  "Number of Packages": "numberOfPackages",
  "Container Number": "containerNumber",
  "Container Seal Numbers": "containerSealNumbers",
  "Total Weight (KG)": "totalWeightKg",
  "Total Weight Unit": "totalWeightUnit",
  "Flight / Voyage": "flightVoyage",
  "Pickup Location": "pickupLocation",
  "Delivery Location": "deliveryLocation",
  "Issued By (Customs Broker)": "issuedByCustomsBroker",
  "Delivery Clerk / Preparer": "deliveryClerkPreparer",
  "Freight Charges Account": "freightChargesAccount",
  "Seal Status": "sealStatus",
  "Condition Statement": "conditionStatement",
  "Carrier Signature Requirement": "carrierSignatureRequirement",
  "Consignee Signature Requirement": "consigneeSignatureRequirement",
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

export function buildStructuredUsDeliveryOrderPrompt(_schema: SchemaRow[]): string {
  return `You are a precision extractor for US Delivery Order PDFs.

OUTPUT RULES (critical):
1. Respond with one JSON object only (no markdown fences).
2. Top-level keys must include "source": "Gemini" and "documentType": "US Delivery Order".
3. Leaf values must be string or null only.
4. Use exact JSON keys from the template and section mapping.
5. Copy values exactly as printed when present.
6. If a field is not visible anywhere in the PDF, set it to null.
7. Do not invent values or infer missing content.
8. Keep DO/IT identifiers exactly as printed.
9. Keep dates as printed.
10. SCAN ALL PAGES: Fields may appear on any page — scan headers, footers, body, and sidebars across the entire document.
11. POSITION-AGNOSTIC: Labels may differ from exact names listed (e.g. "Delivery Order #" = "DO Reference Number", "B/L No." = "B/L or AWB Number", "Vessel/Voyage" = "Flight / Voyage"). Match semantically equivalent labels.

SECTION MAPPING:`;
}
