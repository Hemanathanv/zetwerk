/**
 * Bill of Lading / GENWAYBILL / Seaway BL / MTD — structured extraction (snake_case JSON per schema v1.2).
 */

import type { SchemaRow } from "./bol-schema-types.js";

const SECTION_ORDER = [
  "Document",
  "Carrier",
  "Shipper",
  "Consignee",
  "Notify Party",
  "Second Notify Party",
  "Delivery Agent",
  "Routing",
  "Vessel",
  "Cargo",
  "Project",
  "Export Invoices",
  "Shipping Bills",
  "Containers",
  "Freight",
  "Issuance",
  "Ship's Remarks",
  "Extraction Metadata",
];

const SECTION_JSON_KEY: Record<string, string> = {
  Document: "__rootDocument",
  Carrier: "carrier",
  Shipper: "shipper",
  Consignee: "consignee",
  "Notify Party": "notify_party",
  "Second Notify Party": "second_notify_party",
  "Delivery Agent": "delivery_agent",
  Routing: "routing",
  Vessel: "vessel",
  Cargo: "cargo",
  Project: "__rootProject",
  "Export Invoices": "invoices",
  "Shipping Bills": "shipping_bills",
  Containers: "containers",
  Freight: "freight",
  Issuance: "issuance",
  "Ship's Remarks": "__rootRemarks",
  "Extraction Metadata": "_extraction_metadata",
};

const FIELD_KEY: Record<string, Record<string, string>> = {
  Document: {
    "Document Title": "document_title",
    "B/L Number": "bol_number",
    "Shipment Reference Number": "shipment_reference_number",
    Negotiability: "negotiability",
  },
  Carrier: {
    "Company Name": "company_name",
    "MTO Registration Number": "mto_registration_number",
    "FMC Number": "fmc_number",
  },
  Shipper: {
    "Shipper Name": "name",
    "Shipper Address": "address",
  },
  Consignee: {
    "Consignee Name": "name",
    "Consignee Address": "address",
    "Contact Name": "contact_name",
    "Consignee Phone": "phone",
    "Consignee Email": "email",
  },
  "Notify Party": {
    "Notify Name": "name",
    "Notify Address": "address",
    "Notify Email": "email",
    "Notify Phone": "phone",
  },
  "Second Notify Party": {
    "Second Notify Name": "name",
    "Second Notify Address": "address",
  },
  "Delivery Agent": {
    "Delivery Agent Name": "name",
    "Delivery Agent Address": "address",
    "Delivery Agent Phone": "phone",
    "Delivery Agent Email": "email",
  },
  Routing: {
    "Place Of Acceptance": "place_of_acceptance",
    "Port Of Loading": "port_of_loading",
    "Place Of Receipt": "place_of_receipt",
    "Country Of Origin": "country_of_origin",
    "Port Of Discharge": "port_of_discharge",
    "Final Destination": "final_destination",
    "Place Of Delivery": "place_of_delivery",
    "Transhipment Place": "transhipment_place",
  },
  Vessel: {
    "Vessel Name": "name",
    "Voyage Number": "voyage_number",
    "Shipped On Board Date": "shipped_on_board_date",
    "Ocean Carrier Name": "carrier_name",
  },
  Cargo: {
    "Marks And Numbers": "marks_and_numbers",
    "Package Summary": "package_summary",
    "Total Packages": "total_packages",
    "Total Containers": "total_containers",
    "Goods Description": "goods_description",
    "Gross Weight": "gross_weight",
    "Gross Weight Unit": "gross_weight_unit",
    "Net Weight": "net_weight",
    "Net Weight Unit": "net_weight_unit",
    "Measurement CBM": "measurement_cbm",
    "US HSNC": "us_hsnc",
    "IEC Number": "iec_number",
  },
  Project: {
    "Project Name": "project_name",
  },
  Freight: {
    "Freight Amount": "amount",
    "Freight Payable At": "payable_at",
    "Freight Type": "freight_type",
    "FOB Charges": "fob_charges",
  },
  Issuance: {
    "Issue Place": "place",
    "Issue Date": "date",
    "Number Of Originals": "number_of_originals",
    "Charter Party Date": "charter_party_date",
  },
  "Ship's Remarks": {
    "Ship's Remarks": "ships_remarks",
  },
  "Extraction Metadata": {
    "Format Family": "document_format_family",
  },
};

function fieldJsonKey(section: string, fieldName: string): string {
  const per = FIELD_KEY[section]?.[fieldName.trim()];
  if (per) return per;
  return fieldName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function fieldPromptLine(section: string, r: SchemaRow): string {
  const k = fieldJsonKey(section, r.fieldName);
  let line = `    - \`${k}\` ← **${r.fieldName}**`;
  const note = r.schemaNotes?.trim();
  if (note) line += ` — ${note}`;
  return line;
}

function invoiceRowTemplate(): Record<string, unknown> {
  return { invoice_number: "", invoice_date: null };
}

function shippingBillRowTemplate(): Record<string, unknown> {
  return { shipping_bill_number: "", shipping_bill_date: null };
}

function containerRowTemplate(): Record<string, unknown> {
  return {
    number: "",
    type: null,
    seal_number: null,
    gross_weight_kg: null,
    net_weight_kg: null,
    packages: null,
    volume_cbm: null,
    mode: null,
  };
}

function extractionMetadataTemplate(): Record<string, unknown> {
  return {
    document_format_family: null,
    confidence_score: null,
    page_count: null,
  };
}

function buildEmptyBolShape(): Record<string, unknown> {
  return {
    document_title: null,
    bol_number: "",
    shipment_reference_number: null,
    negotiability: null,
    carrier: {
      company_name: "",
      mto_registration_number: null,
      fmc_number: null,
    },
    shipper: { name: "", address: null },
    consignee: {
      name: "",
      address: null,
      contact_name: null,
      phone: null,
      email: null,
    },
    notify_party: {
      name: "",
      address: null,
      email: null,
      phone: null,
    },
    second_notify_party: null,
    delivery_agent: null,
    routing: {
      place_of_acceptance: null,
      port_of_loading: "",
      place_of_receipt: null,
      country_of_origin: "INDIA",
      port_of_discharge: "",
      final_destination: null,
      place_of_delivery: null,
      transhipment_place: null,
    },
    vessel: {
      name: "",
      voyage_number: null,
      shipped_on_board_date: null,
      carrier_name: null,
    },
    cargo: {
      marks_and_numbers: null,
      package_summary: null,
      total_packages: null,
      total_containers: null,
      goods_description: "",
      gross_weight: null,
      gross_weight_unit: "KGS",
      net_weight: null,
      net_weight_unit: null,
      measurement_cbm: null,
      us_hsnc: null,
      iec_number: null,
    },
    project_name: null,
    invoices: [
      { invoice_number: "<FIRST_INVOICE_NO_from_PDF>", invoice_date: "YYYY-MM-DD" },
      { invoice_number: "<SECOND_INVOICE_NO_from_PDF — DIFFERENT from first>", invoice_date: "YYYY-MM-DD" },
    ],
    shipping_bills: [
      { shipping_bill_number: "<FIRST_SB_NO_from_PDF>", shipping_bill_date: "YYYY-MM-DD" },
      { shipping_bill_number: "<SECOND_SB_NO_from_PDF — DIFFERENT from first>", shipping_bill_date: "YYYY-MM-DD" },
    ],
    containers: null,
    freight: {
      amount: null,
      payable_at: "",
      freight_type: null,
      fob_charges: null,
    },
    issuance: {
      place: "",
      date: null,
      number_of_originals: null,
      charter_party_date: null,
    },
    ships_remarks: null,
    _extraction_metadata: extractionMetadataTemplate(),
  };
}

export function buildStructuredBillOfLadingPrompt(schema: SchemaRow[]): string {
  const empty = buildEmptyBolShape();
  const bySec = new Map<string, SchemaRow[]>();
  for (const row of schema) {
    const sec = row.section.trim();
    if (!bySec.has(sec)) bySec.set(sec, []);
    bySec.get(sec)!.push(row);
  }

  const sectionLines: string[] = [];
  for (const sec of SECTION_ORDER) {
    const rows = bySec.get(sec);
    if (!rows?.length) continue;

    if (sec === "Document") {
      const fl = rows.map((r) => fieldPromptLine(sec, r)).join("\n");
      sectionLines.push(
        `- **Document** (root keys):\n${fl}\n` +
          `  - \`bol_number\` polymorphism: **HBL Number**, **BL/MTD No**, **B/L No.**, **General Sea Waybill No.**, **MTD No** — extract **only** the code.`,
      );
      continue;
    }
    if (sec === "Project") {
      sectionLines.push(`- **Project** (root): \`project_name\` ← **Project Name**.`);
      continue;
    }
    if (sec === "Ship's Remarks") {
      sectionLines.push(`- **Ship's Remarks** (root): \`ships_remarks\` ← full clause text or null.`);
      continue;
    }
    if (sec === "Export Invoices") {
      sectionLines.push(
        `- **Export Invoices** → root \`invoices\` **array** of \`{ invoice_number, invoice_date }\` **only** (ISO dates). **Do not** put shipping bill numbers here.\n` +
          `  - **EXTRACT ALL INVOICE ROWS — THREE FORMATS:**\n` +
          `    1. **Inline list** (most common): Each invoice appears as its own line in the cargo/description block in the format \`INV NO: EXP/1/26-27 DT:1-APR-26\` or \`INV NO: KA/UM/2526/00578 DATE: 01-Apr-2026\`. Every such line is a SEPARATE entry. If the PDF shows 2 "INV NO:" lines → 2 entries in the array. If it shows 5 → 5 entries. Do not stop after the first "INV NO:" occurrence.\n` +
          `    2. **Table format**: An invoice table with columns for invoice number and date. One row per entry. Extract ALL rows from ALL pages.\n` +
          `    3. **Dual-column table**: Two invoice pairs per row (left + right). Extract both as separate entries.\n` +
          `  - **COMPLETENESS**: Count every "INV NO:" or "INVOICE NO:" occurrence in the entire document and ensure your array has the same count.`,
      );
      continue;
    }
    if (sec === "Shipping Bills") {
      sectionLines.push(
        `- **Shipping Bills** → root \`shipping_bills\` **array** of \`{ shipping_bill_number, shipping_bill_date }\` **only**.\n` +
          `  - **CONGENBILL / GENWAYBILL:** Invoice tables repeat the **same SB** on many rows — output **one row per distinct SB** (document order, first-seen date). **No** duplicate SB numbers. **No** entries with empty or null \`shipping_bill_number\`.\n` +
          `  - **MTD (Expo / separate blocks):** **Parallel** arrays with \`invoices[]\` — **same length**, index \`i\` pairs invoice \`i\` with SB \`i\`. Never one array with half invoice-only and half SB-only rows.\n` +
          `  - **READ EACH SB LINE CHARACTER-BY-CHARACTER**: Each "SB NO:" or "S/B No:" line in the PDF has its own distinct number. Do not duplicate entry 0 into entry 1. Numbers that look alike (e.g. 2052501 vs 2052502) differ in the last digits — read what is literally printed on each line.\n` +
          `  - \`invoices[]\` still has **one row per export invoice line** in table layouts.\n` +
          `  - **SCAN ALL PAGES**: Shipping bill tables may continue across multiple pages — extract every row.`,
      );
      continue;
    }
    if (sec === "Containers") {
      sectionLines.push(
        `- **Containers** → \`containers\` **array** of \`{ number, type, seal_number, gross_weight_kg, net_weight_kg, packages, volume_cbm, mode }\` or **null** for breakbulk.\n` +
          `  - **type:** Normalize to **40HC** or **20GP** (40' FCL / HIGH CUBE / HQ → 40HC).\n` +
          `  - **SEAWAY_TRANSCOM:** Weights often on **page 2+** — extract **Weight** column into \`gross_weight_kg\` when shown.`,
      );
      continue;
    }
    if (sec === "Extraction Metadata") {
      sectionLines.push(
        `- Root \`_extraction_metadata\` object (**required**):\n` +
          `    - \`document_format_family\` ← **Format Family** — one of: **CONGENBILL_CHARTER**, **GENWAYBILL_2016**, **MTD_EXPO_FREIGHT**, **MTD_OAK_SHIPPING**, **SEAWAY_TRANSCOM**, **SEAWAY_SAFEWATER**, **SEAWAY_DAHNAY**, **OTHER**.\n` +
          `    - \`confidence_score\` (optional number 0–1), \`page_count\` (optional integer if inferable from PDF).\n` +
          `  - Post-processing will add \`source_filename\`, \`model_used\`, \`extraction_date\`, \`usage\`, etc. inside this object.`,
      );
      continue;
    }

    if (sec === "Carrier" || sec === "Vessel" || sec === "Freight" || sec === "Cargo") {
      const sk = SECTION_JSON_KEY[sec];
      const fl = rows.map((r) => fieldPromptLine(sec, r)).join("\n");
      sectionLines.push(`- **${sec}** → \`${sk}\` **object**.\n${fl}`);
      continue;
    }

    const sk = SECTION_JSON_KEY[sec];
    const fl = rows.map((r) => `    - \`${fieldJsonKey(sec, r.fieldName)}\` ← **${r.fieldName}**`).join("\n");
    sectionLines.push(`- **${sec}** → \`${sk}\` **object**.\n${fl}`);
  }

  const example = {
    source: "Gemini",
    document_category: "Bill of Lading",
    ...empty,
  };

  return `You are a precision extractor for **Bills of Lading** and related documents: **CONGENBILL** (charter party), **GENWAYBILL 2016**, **Seaway Bill / Seaway BL**, **Multimodal Transport Document (MTD)**. Carriers include Aditya Marine, Expo Freight, Transcom, Safewater, DahNAY, Oak Shipping. Cargo context: Unimacts Global steel imports from India.

**Output rules**
- Return **one JSON object** with **snake_case** keys (no camelCase).
- Include \`document_category\`: **"Bill of Lading"**, \`source\`: **"Gemini"**, and \`_extraction_metadata\` with **document_format_family** set from the list above.
- **Dates:** ISO \`YYYY-MM-DD\` where possible (invoice_date, shipping_bill_date, shipped_on_board_date, issuance, charter party).
- **Vessel line:** If the PDF prints \`VESSEL NAME / VOYAGE\` (e.g. \`CMA CGM PHOENIX / 0INKPW1MA\`), split on **\` / \`**: \`vessel.name\` = text **before** the slash, \`vessel.voyage_number\` = text **after** (trimmed). If already separate fields, keep both.
- **Cargo net weight:** Extract **total** and/or **per-container** net weight when shown. Check **continuation pages** and container detail tables (Expo MTDs often list net kg per box).
- **B/L number** — extract code only, not the label.
- **Shipped on board (CONGENBILL / GENWAYBILL):** Rarely a labeled field — use **place & date of issue** first, then attestation **SHIPPED at the port of loading…** near signatures, then **Charter Party dated**; do **not** leave null if issue or charter date exists.
- **Containers:** FCL → array; breakbulk charter → \`null\`.
- **second_notify_party** / **delivery_agent**: object or **null**.

**Invoices vs shipping bills (critical)**
- \`invoices[]\` = export invoice lines **only** — include **every** invoice visible anywhere in the document across all pages.
- \`shipping_bills[]\` = Indian SB lines **only** (lines starting with \`SB NO:\` or \`S/B No:\`). Do not put SB numbers into \`invoices[]\`.
- **INLINE FORMAT** (very common): When the cargo description block contains repeated lines like \`INV NO: EXP/1/26-27 DT:1-APR-26\` and \`INV NO: EXP/2/26-27 DT:1-APR-26\`, each "INV NO:" line is a **separate entry** in \`invoices[]\`. Two "INV NO:" lines = two entries. Three lines = three entries. Never collapse them into one.
- **READ EACH INVOICE LINE INDIVIDUALLY — DO NOT DUPLICATE**: Every "INV NO:" line has its own DISTINCT invoice number printed on that line. Read the number character-by-character from the PDF — do not copy the first number into later entries. In the example above: line 1 = \`EXP/1/26-27\`, line 2 = \`EXP/2/26-27\`. These differ in the digit before the slash (1 vs 2). The pattern \`EXP/<N>/YY-YY\` increments N for each new invoice. Extract exactly what is printed on each line.
- **READ EACH SB LINE INDIVIDUALLY — DO NOT DUPLICATE**: Every "SB NO:" or "S/B No:" line has its own DISTINCT shipping bill number. Read each number character-by-character from the PDF. Do not copy the first SB number into subsequent entries. If the PDF shows two "SB NO:" lines with numbers that look similar (e.g. \`2052501\` and \`2052502\`), they are different — extract the exact digits printed on each line. Never output the same SB number twice unless the document literally repeats the identical number on multiple lines.
- For separate INVOICE and SB sections, **parallel arrays** same length; do **not** interleave into one array with nulls.
- **INVOICE COMPLETENESS CHECK**: Count every "INV NO:", "INVOICE NO:", or "Invoice Number" occurrence in the entire document. Your \`invoices[]\` array must have exactly that many entries, each with the distinct number from its own line.
- **SB COMPLETENESS CHECK**: Count every "SB NO:" or "S/B No:" occurrence in the entire document. Your \`shipping_bills[]\` array must have exactly that many entries (for MTD parallel layouts), each with the distinct number from its own line.
- **`raw_text.raw_invoice_lines`** — copy **every** "INV NO:" or "INVOICE NO:" line from the PDF verbatim, one per line, exactly as printed. Do not paraphrase. Example: \`INV NO: EXP/1/26-27 DT:1-APR-26\nINV NO: EXP/2/26-27 DT:1-APR-26\`.
- **`raw_text.raw_sb_lines`** — copy **every** "SB NO:" or "S/B No:" line from the PDF verbatim, one per line, exactly as printed. Do not paraphrase.

SECTION MAPPING:
${sectionLines.join("\n\n")}

TEMPLATE:
${JSON.stringify(example, null, 2)}

Respond with **one JSON object** only (no markdown fences).`;
}
