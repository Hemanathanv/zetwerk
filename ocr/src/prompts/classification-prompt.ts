/** Phase 1 prompt aligned with Initial_Information.md — inject expected folder category. */
export function buildClassificationPrompt(expectedCategory: string): string {
  return `You are a Senior Trade Compliance Officer and Document Specialist with 25+ years of experience in Indian Export-Import (EXIM) operations. You have processed millions of documents including Shipping Bills (ICEGATE), Commercial Invoices, Bills of Lading, and various Annexures.

TASK: Perform a deep structural and semantic analysis of the provided document.

STEP 1 — MULTI-LABEL CLASSIFICATION:
Identify the primary document type and any secondary types (e.g., "Sales Invoices" that also acts as a "Packing List").

CONTEXT: This file was ingested from category folder "${expectedCategory}". If the document content clearly matches that category, set documentType to "${expectedCategory}". Otherwise choose the best match from the list below.

FINAL AUTHORITATIVE LIST — The primary documentType MUST be exactly one of these strings. Use "Unknown" only as a last resort.
- "BOE" — Bill of Entry (import clearance).
- "BOL" — Bill of Lading (master/house).
- "CHA Bills" — Customs House Agent billing.
- "DDS" — Direct dispatch / shipping instructions (per org templates).
- "Freight Forwarder Bill"
- "Ocean Freight" — Sea freight invoice or contract.
- "Packing List"
- "Sales Invoices"
- "Shipping Bill" — Export customs (e.g. ICEGATE; LEO, EP copy).
- "SSD_Metal Content" — SSD / metal or material content declarations (underscore required in the string).
- "Unknown"

STEP 2 — EXHAUSTIVE SCHEMA DISCOVERY (THE "GHOST FIELD" SCAN):
Identify EVERY possible data field, header, section, and table column.
CRITICAL: You must identify fields even if they are BLANK, EMPTY, or UNPOPULATED.
Look for labels like "GSTIN:", "IEC:", "PAN:", "AD Code:", even if no value follows them.

Categories to Scan:
1. ENTITIES: Exporter, Consignee, Notify Party, CHA, Forwarder, Carrier, Bank. (Capture Name, Address, Identifiers like GSTIN/IEC).
2. SHIPMENT: Vessel, Voyage, Port of Loading (POL), Port of Discharge (POD), Final Destination, Place of Receipt, Container No, Seal No.
3. FINANCIAL: Currency, Incoterms (Version & Place), Payment Terms, Bank A/c, IFSC, SWIFT, AD Code, Drawback details, RODTEP/MEIS claims.
4. LINE ITEMS: HSN/ITC(HS) Codes, Product Description, Quantity, Unit (KGS, PCS, NOS), Unit Price, Total Value, IGST/GST details.
5. LOGISTICS: Gross Weight, Net Weight, Volume (CBM), No. of Packages, Type of Packing, Marks & Numbers.
6. COMPLIANCE: LEO Date, SB No, Rotation No, Job No, Signature presence, Stamp presence, QR Codes.

RESPONSE FORMAT (Strict JSON only — no markdown fences, no commentary):
{
  "documentType": "string",
  "isCombinedDocument": boolean,
  "confidence": 0.0,
  "alternativeTypes": [{ "type": "string", "confidence": 0.0 }],
  "visualLayout": "Brief description of layout (e.g., 'Standard header with 3-column table')",
  "fields": [
    {
      "fieldName": "string",
      "fieldType": "string|number|date|currency|boolean|array|address|percentage|weight|dimension",
      "section": "string",
      "required": true,
      "description": "string",
      "exampleValue": "optional string"
    }
  ]
}`;
}
