/**
 * US Customs Release Order - structured extraction prompt preamble + canonical key map.
 * Python uses the preamble text and this canonical map to build the final schema-driven prompt.
 */

import type { SchemaRow } from "./us-custom-release-schema-types.js";

const CANONICAL_JSON_KEY_BY_FIELD_NAME: Record<string, string> = {
  "Customs Broker": "customsBroker",
  "Broker Contact": "brokerContact",
  "Broker Address": "brokerAddress",
  "Importer Number": "importerNumber",
  "Importer Name and Address": "importerNameAndAddress",
  "Bond Type": "bondType",
  "Entry Type": "entryType",
  "Surety Code": "suretyCode",
  "Consignee / Buying Party": "consigneeBuyingParty",
  "Port of Entry": "portOfEntry",
  "Entry Number": "entryNumber",
  "Bond Value": "bondValue",
  "Port of Unlading": "portOfUnlading",
  "Mode of Transportation": "modeOfTransportation",
  "Location of Goods (FIRMS)": "locationOfGoodsFirms",
  "Conveyance Name/FTZ Zone ID": "conveyanceNameFtzZoneId",
  "Reference ID Code / Number": "referenceIdCodeNumber",
  Manufacturer: "manufacturer",
  "Gross Weight": "grossWeight",
  "Total Units": "totalUnits",
  "Container(s)": "containers",
  "Bill of Lading Information (Master & House)": "billOfLadingInformationMasterHouse",
  "Signature of Applicant & Date": "signatureOfApplicantAndDate",
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

export function buildStructuredUsCustomReleasePrompt(_schema: SchemaRow[]): string {
  return `You are a precision extractor for US Customs Release Order PDFs.

OUTPUT RULES (critical):
1. Respond with one JSON object only (no markdown fences).
2. Top-level keys must include "source": "Gemini" and "documentType": "US Customs Release Order".
3. Leaf values must be string or null only.
4. Use exact JSON keys from the template and section mapping.
5. Copy values exactly as printed when present.
6. If a field is not visible anywhere in the PDF, set it to null.
7. Do not invent values or infer content from context.
8. Keep identifiers and codes exactly as printed.
9. Keep dates and signature/date text exactly as printed.
10. SCAN ALL PAGES: Fields may appear on any page — scan headers, footers, body, and sidebars across the entire document.
11. POSITION-AGNOSTIC: Labels may differ from exact names listed (e.g. "Entry #" = "Entry Number", "Gross Wt" = "Gross Weight"). Match semantically equivalent labels regardless of position.

SECTION MAPPING:`;
}
