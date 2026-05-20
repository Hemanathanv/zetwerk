/**
 * GRN Inbound (Goods Receipt Note - Inbound) - structured extraction prompt preamble + canonical key map.
 * Python uses the preamble text and this canonical map to build the final schema-driven prompt.
 */

import type { SchemaRow } from "./grn-inbound-schema-types.js";

const CANONICAL_JSON_KEY_BY_FIELD_NAME: Record<string, string> = {
  "Document Type": "documentType",
  "Logistics Provider": "logisticsProvider",
  "Account Name": "accountName",
  "Document Title": "documentTitle",
  "Container Number": "containerNumber",
  "Container Size": "containerSize",
  "Container Type": "containerType",
  "Seal Number": "sealNumber",
  "Trucking Co": "truckingCo",
  "Freight Bill Number": "freightBillNumber",
  "Broker Reference": "brokerReference",
  "Customer Reference": "customerReference",
  Location: "location",
  "TI Tie": "tiTie",
  Beam: "beam",
  "Date Received": "dateReceived",
  "Rate Quote Number": "rateQuoteNumber",
  "Floor Loaded": "floorLoaded",
  Frozen: "frozen",
  "Palletized Cargo": "palletizedCargo",
  "Number of Pallets": "numberOfPallets",
  "Company Owned Pallets": "companyOwnedPallets",
  "Total Pieces": "totalPieces",
  "Type of Packaging": "typeOfPackaging",
  "Total Parts Count": "totalPartsCount",
  "Pieces Per Bundle": "piecesPerBundle",
  "Bundle Count": "bundleCount",
  Color: "color",
  "Raw Label": "rawLabel",
  "PCS Line 1": "pcsLine1",
  Dimensions: "dimensions",
  Weight: "weight",
  "Received By": "receivedBy",
  "Number of Employees": "numberOfEmployees",
  "Total Receiving Time": "totalReceivingTime",
  Notes: "notes",
  "Liability Limit": "liabilityLimit",
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

export function buildStructuredGrnInboundPrompt(_schema: SchemaRow[]): string {
  return `You are a precision extractor for GRN Inbound (Warehouse Receipt) PDFs.

OUTPUT RULES (critical):
1. Respond with one JSON object only (no markdown fences).
2. Top-level keys must include "source": "Gemini" and "documentType": "GRN Inbound".
3. Leaf values must be string or null only.
4. Use exact JSON keys from the template and section mapping.
5. Copy values exactly as printed when present (preserve units like "lbs", "kg", colors, container codes).
6. If a field is not visible anywhere in the PDF, set it to null. If a field is explicitly marked "blank", "N/A", or struck out, return null.
7. Do not invent values, expand abbreviations, or infer missing text.
8. Keep container numbers and seal numbers exactly as printed (preserve any spaces or dashes).
9. Keep dates as printed.
10. For Y/N style fields ("Floor Loaded", "Frozen", "Palletized Cargo"), copy the value as printed (e.g. "Y", "N", "Y (Yes)").
11. The "destinationMarks" array holds ONE OBJECT PER MARK / LABEL LINE printed in the "Destination Marks / Labels" block (e.g. "24 x 10 = 240 (Yellow)" is one row, "9 x 2 = 18 (Purple)" is the next row). For each line populate:
    - piecesPerBundle: left multiplier before "x" (e.g. "24")
    - bundleCount: right multiplier between "x" and "=" (e.g. "10")
    - totalPieces: number after "=" (e.g. "240")
    - color: text inside parentheses (e.g. "Yellow")
    - rawLabel: the exact original line, untouched
   If the line does not match the "A x B = C (color)" shape, leave the parsed keys null and just set rawLabel. Do NOT concatenate multiple lines into one entry, and do NOT put the "Total NNN" summary inside this array — that goes into the "totalPartsCount" field.
11. SCAN ALL PAGES: Fields may appear on any page — check headers, footers, body, and sidebars across the entire document.
12. POSITION-AGNOSTIC: Labels may differ from exact names listed (e.g. "Cont #" = "Container Number", "Recd By" = "Received By", "Total Pcs" = "Total Pieces"). Match semantically equivalent labels.

SECTION MAPPING:`;
}
