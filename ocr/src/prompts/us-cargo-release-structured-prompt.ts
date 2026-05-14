/**
 * US Cargo Release Order - structured extraction prompt preamble + canonical key map.
 * Python uses the preamble text and this canonical map to build the final schema-driven prompt.
 */

import type { SchemaRow } from "./us-cargo-release-schema-types.js";

const CANONICAL_JSON_KEY_BY_FIELD_NAME: Record<string, string> = {
  "Customs Broker": "customsBroker",
  "Broker Contact": "brokerContact",
  "Broker Address": "brokerAddress",
  "Broker Reference #": "brokerReferenceNumber",
  "Importer & Consignee": "importerAndConsignee",
  "Importer & Consignee Address": "importerAndConsigneeAddress",
  "Release Port": "releasePort",
  "Entry Number": "entryNumber",
  "Port Unlading": "portUnlading",
  "Statement Print Date": "statementPrintDate",
  SCAC: "scac",
  "Truck/Vessel/Flight": "truckVesselFlight",
  "IT Number": "itNumber",
  "Master Bill Of Lading": "masterBillOfLading",
  "House Bill (1 & 2)": "houseBill1And2",
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

export function buildStructuredUsCargoReleasePrompt(_schema: SchemaRow[]): string {
  return `You are a precision extractor for US Cargo Release Order PDFs.

OUTPUT RULES (critical):
1. Respond with one JSON object only (no markdown fences).
2. Top-level keys must include "source": "Gemini" and "documentType": "US Cargo Release Order".
3. Leaf values must be string or null only.
4. Use exact JSON keys from the template and section mapping.
5. Copy values exactly as printed when present.
6. If a field is not visible anywhere in the PDF, set it to null.
7. Do not invent values, expand abbreviations, or infer missing text.
8. Keep IDs and reference numbers as-is, including slashes and dashes.
9. Keep dates as printed; downstream normalization handles format alignment.
10. SCAN ALL PAGES: Fields may appear on any page — check headers, footers, body, and sidebars across the entire document.
11. POSITION-AGNOSTIC: Labels may differ from exact names listed (e.g. "Entry #" = "Entry Number", "B/L No" = "Master Bill Of Lading"). Match semantically equivalent labels.

SECTION MAPPING:`;
}
