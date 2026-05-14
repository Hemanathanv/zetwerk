/**
 * Bill of Lading / MTD / Seaway — discovery schema for structured extraction (snake_case JSON).
 * Schema v1.2.1 — audit patch: SOB fallbacks, SB dedupe/empty, title/negotiability, container type/Transcom weights, freight charter, FMC strip, carrier vs vessel, total_packages vs containers.
 * Run: node scripts/bootstrap-bill-of-lading-schema.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output", "schema-discovery", "Bill of Lading.final-schema.json");

/** @param {string[] | undefined} alternateLabels @param {string | undefined} extractionNotes */
function f(section, fieldName, description, required = false, alternateLabels, extractionNotes) {
  const o = { section, fieldName, fieldType: "string", description, required };
  if (alternateLabels?.length) o.alternateLabels = alternateLabels;
  if (extractionNotes) o.notes = extractionNotes;
  return o;
}

const fields = [
  ...[
    [
      "Document",
      "Document Title",
      "**Short** printed format name only (~≤30 chars). Strip negotiability / usage clauses — they belong in negotiability.",
      true,
      undefined,
      "v1.2: Examples: 'GENWAYBILL 2016 NON-NEGOTIABLE GENERAL SEAWAYBILL' → 'GENWAYBILL 2016'; 'BILL OF LADING TO BE USED WITH CHARTER PARTIES' → 'BILL OF LADING'; 'SEAWAY BL NON NEGOTIABLE / DOCUMENT MULTIMODAL TRANSPORT' → 'SEAWAY BL' or 'MULTIMODAL TRANSPORT DOCUMENT' (one title, not merged). Never paste two headings together.",
    ],
    [
      "Document",
      "B/L Number",
      "Primary id: HBL Number, BL/MTD No, B/L No., General Sea Waybill No., MTD No — extract code only",
      true,
      ["HBL Number", "BL/MTD No", "B/L No.", "MTD No", "Sea Waybill No"],
    ],
    ["Document", "Shipment Reference Number", "Secondary ref e.g. Shipment reference no.", false],
    [
      "Document",
      "Negotiability",
      "NON-NEGOTIABLE, FIRST ORIGINAL, Express B/L, TO ORDER, **TO BE USED WITH CHARTER PARTIES**, etc. — never the document title alone",
      true,
      undefined,
      "v1.2: If header says 'TO BE USED WITH CHARTER PARTIES', use that exact phrase. If title is SEAWAY BILL / SEAWAY BL and nothing else stated, use 'NON-NEGOTIABLE'. Do not leave null when any negotiability or seaway title is present.",
    ],
  ].map(([s, n, d, r, alt, note]) => f(s, n, d, r, alt, note)),
  f(
    "Carrier",
    "Company Name",
    "Issuing **carrier / MTO / agent** (letterhead, 'For and on behalf of…', 'As Agents…') — **never** the vessel name",
    true,
    undefined,
    "v1.2 CONGENBILL: Company before 'As Agents, For and on behalf of Master of the vessel' (e.g. ADITYA MARINE LTD., SYNERGY SEAPORTS PVT. LTD.) — not 'MV …'. Ship name → vessel.name.",
  ),
  ...[
    ["Carrier", "MTO Registration Number", "MTO/DGS registration if printed", false],
    f(
      "Carrier",
      "FMC Number",
      "FMC OTI identifier **digits/letters only** — no label prefix",
      false,
      undefined,
      "v1.2: 'FMC No.034101' → '034101'; 'FMC-OTI NO. 026686N' → '026686N'.",
    ),
  ].map((row) => (Array.isArray(row) ? f(row[0], row[1], row[2], row[3]) : row)),
  ...[
    ["Shipper", "Shipper Name", "Shipper / Consignor legal name", true],
    ["Shipper", "Shipper Address", "Full address lines", true],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Consignee", "Consignee Name", "Consignee legal name; may say NOT TO ORDER", true],
    ["Consignee", "Consignee Address", "Full address", true],
    ["Consignee", "Contact Name", "Attention / contact", false],
    ["Consignee", "Consignee Phone", "Phone", false],
    ["Consignee", "Consignee Email", "Email", false],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Notify Party", "Notify Name", "Primary notify party", true],
    ["Notify Party", "Notify Address", "Notify address", false],
    ["Notify Party", "Notify Email", "Email", false],
    ["Notify Party", "Notify Phone", "Phone", false],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Second Notify Party", "Second Notify Name", "2nd notify company", false],
    ["Second Notify Party", "Second Notify Address", "Address", false],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Delivery Agent", "Delivery Agent Name", "To obtain delivery / delivery agent", false],
    ["Delivery Agent", "Delivery Agent Address", "Address", false],
    ["Delivery Agent", "Delivery Agent Phone", "Phone", false],
    ["Delivery Agent", "Delivery Agent Email", "Email", false],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Routing", "Place Of Acceptance", "MTO acceptance (MTD)", false],
    ["Routing", "Port Of Loading", "Port of loading", true],
    ["Routing", "Place Of Receipt", "If distinct from POL", false],
    ["Routing", "Country Of Origin", "Typically INDIA for these flows", true],
    ["Routing", "Port Of Discharge", "Discharge port", true],
    ["Routing", "Final Destination", "If different from POD", false],
    ["Routing", "Place Of Delivery", "Final delivery point (MTD)", false],
    ["Routing", "Transhipment Place", "Transhipment if any", false],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    [
      "Vessel",
      "Vessel Name",
      "Vessel name **only** — if PDF prints `NAME / VOYAGE` on one line (e.g. CMA CGM PHOENIX / 0INKPW1MA), put name before ` / ` and put voyage in Voyage Number",
      true,
    ],
    ["Vessel", "Voyage Number", "Voyage or voyage ref after ` / ` on combined vessel line, or separate field", false],
    f(
      "Vessel",
      "Shipped On Board Date",
      "ISO YYYY-MM-DD. **CONGENBILL / GENWAYBILL:** usually **no** labeled 'Shipped On Board Date'. Take date from **priority**: (1) **Place and date of issue** (e.g. KANDLA PORT, INDIA ON 26.10.2025); (2) **SHIPPED at the port of loading…** / attestation near **signature block**; (3) **Charter Party dated** as last resort. For these formats, **issuance date is the shipped date** when no separate SOB — **never leave null** if issue or charter date exists. **MTD/Seaway:** labeled SOB fields.",
      true,
      undefined,
      "v1.2: Prefer issue-date parsing for Aditya charter/GENWAY when attestation date is ambiguous.",
    ),
    ["Vessel", "Ocean Carrier Name", "CARRIER NAME if distinct (charter B/L)", false],
  ].map((row) => (Array.isArray(row) ? f(row[0], row[1], row[2], row[3]) : row)),
  ...[
    ["Cargo", "Marks And Numbers", "Marks & Nos / bundle ranges — preserve newlines", false],
    ["Cargo", "Package Summary", "e.g. 10 x 40HC … SAID TO CONTAIN", false],
    f(
      "Cargo",
      "Total Packages",
      "Total **cargo** packages/bundles — **not** container count. '7 X 40HC' → total_containers=7; total_packages = sum of per-container **Packages** column or 'TOTAL … PACKAGES' in cargo text",
      false,
      undefined,
      "v1.2: Do not set total_packages to the number of containers.",
    ),
    f(
      "Cargo",
      "Total Containers",
      "Number of **shipping containers** (40HC, 20GP, etc.) for FCL; **null** for breakbulk / charter lots with no box count",
      false,
      undefined,
      "v1.2: Do not swap with total_packages.",
    ),
    ["Cargo", "Goods Description", "DESCRIPTION OF GOODS — full text", true],
    ["Cargo", "Gross Weight", "Numeric gross", true],
    ["Cargo", "Gross Weight Unit", "KG, KGS, or MT", true],
    [
      "Cargo",
      "Net Weight",
      "Total net weight — scan **all pages** including continuation sheets and **per-container** net columns in MTD tables",
      false,
    ],
    ["Cargo", "Net Weight Unit", "KG/KGS/MT", false],
    ["Cargo", "Measurement CBM", "Cube m³ if shown", false],
    ["Cargo", "US HSNC", "USA - HSNC - code prefer US tariff string", false],
    ["Cargo", "IEC Number", "Shipper IEC if listed", false],
  ].map((row) => (Array.isArray(row) ? f(row[0], row[1], row[2], row[3]) : row)),
  f("Project", "Project Name", "Project: / PROJECT NAME: in cargo or particulars", false),
  f(
    "Export Invoices",
    "Invoice Rows",
    "Root `invoices[]`: **only** `{ invoice_number, invoice_date }` per line — **no** shipping bill fields here",
  ),
  f(
    "Shipping Bills",
    "Shipping Bill Rows",
    "Root `shipping_bills[]`: `{ shipping_bill_number, shipping_bill_date }` **only**. **CRITICAL — CONGENBILL/GENWAYBILL:** **unique** SB numbers only (one row per distinct SB); tables repeat the same SB across invoices — **do not duplicate**. **Skip** rows where SB number is blank. **MTD Expo:** parallel `invoices[]` / `shipping_bills[]` **same length** (pair by index).",
    false,
    undefined,
    "v1.2: No empty-string shipping_bill_number entries; each unique SB appears exactly once for charter/GENWAY table layouts.",
  ),
  f(
    "Extraction Metadata",
    "Format Family",
    "Inside `_extraction_metadata.document_format_family`: CONGENBILL_CHARTER | GENWAYBILL_2016 | MTD_EXPO_FREIGHT | MTD_OAK_SHIPPING | SEAWAY_TRANSCOM | SEAWAY_SAFEWATER | SEAWAY_DAHNAY | OTHER",
  ),
  f(
    "Containers",
    "Container Rows",
    "Root `containers` array or null — `{ number, type, seal_number, gross_weight_kg, net_weight_kg, packages, volume_cbm, mode }`. **type:** normalize to **40HC** or **20GP** (map 40' FCL, 40 HIGH CUBE, 40 HQ, 40HC, etc. → 40HC; 20' FCL, 20GP → 20GP). **SEAWAY_TRANSCOM:** continuation page table — columns typically Container, Seals, Type, **Weight** (kg), Volume, Packages, Mode — fill **gross_weight_kg** from Weight when present (page 2+).",
    false,
    undefined,
    "v1.2: Do not leave weights null on Transcom when the continuation table shows them.",
  ),
  ...[
    ["Freight", "Freight Amount", "AS AGREED, COLLECT, PREPAID, or amount", false],
    f(
      "Freight",
      "Freight Payable At",
      "Short place token: DESTINATION, ORIGIN, MUNDRA, etc. **Charter party BOLs:** if freight is per charter party, use **AS PER CHARTER PARTY** — not legal snippets ('accordance therewith') or full 'CHARTER PARTY DATED …' sentences",
      true,
      undefined,
      "v1.2: Set freight_type to AS PER CHARTER PARTY when payable_at is AS PER CHARTER PARTY.",
    ),
    f(
      "Freight",
      "Freight Type",
      "PREPAID, COLLECT, **AS PER CHARTER PARTY**",
      false,
      undefined,
      "v1.2: Align with payable_at for charter-party freight.",
    ),
    ["Freight", "FOB Charges", "If stated separately", false],
  ].map((row) => (Array.isArray(row) ? f(row[0], row[1], row[2], row[3]) : row)),
  ...[
    ["Issuance", "Issue Place", "Place of issue", true],
    ["Issuance", "Issue Date", "Date of issue — normalize ISO YYYY-MM-DD", true],
    ["Issuance", "Number Of Originals", "3(Three), ZERO, SEAWAY BILL", false],
    f(
      "Issuance",
      "Charter Party Date",
      "CONGENBILL / charter-party date if shown — ISO YYYY-MM-DD",
      false,
      undefined,
      "v1.2: If shipped_on_board_date is missing but a single date sits beside Charter Party / master attestation, use it for SOB when it clearly refers to on-board shipment.",
    ),
  ].map((row) => (Array.isArray(row) ? f(row[0], row[1], row[2], row[3]) : row)),
  f(
    "Ship's Remarks",
    "Ship's Remarks",
    "SHIP'S REMARKS / master remarks — cargo condition clauses",
    false,
  ),
];

const doc = {
  documentCategory: "Bill of Lading",
  schemaVersion: "1.2.1",
  source: "Gemini",
  summary:
    "v1.2.1: SOB priority for CONGEN/GENWAY; unique SB + no empties; short document_title; negotiability incl. charter/seaway; container type codes + Transcom weights; charter freight tokens; FMC strip; carrier≠vessel; total_packages≠container count. snake_case. Unimacts India→US steel.",
  statistics: { outputFieldCount: fields.length },
  fields,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log("Wrote", out, "fields:", fields.length);
