/**
 * Freight Forwarder Bill — structured extraction (v2: INR fields, containers[], attention, customs broker).
 */

import type { SchemaRow } from "./freight-forwarder-bill-schema-types.js";

const ARRAY_SECTION = "Charges";

const SECTION_JSON_KEY: Record<string, string> = {
  Issuer: "issuer",
  "Invoice Identification": "invoiceIdentification",
  Customer: "customer",
  Shipment: "shipment",
  Cargo: "cargo",
  Containers: "__rootContainers",
  Charges: "charges",
  "Tax Summary": "__rootTaxSummary",
  Totals: "totals",
  "Bank Details": "bankDetails",
  "Additional Bank Details": "additionalBankDetails",
  Footer: "footer",
};

const FIELD_JSON_KEY: Record<string, string> = {
  "Company Name": "companyName",
  Address: "address",
  Phone: "phone",
  Email: "email",
  Website: "website",
  "VAT Number": "vatNumber",
  "GST Number": "gstNumber",
  "PAN Number": "panNumber",
  "CIN Number": "cinNumber",
  "LUT Number": "lutNumber",
  "TAN Number": "tanNumber",
  "State Code": "stateCode",
  "Invoice Number": "invoiceNumber",
  "Invoice Date": "invoiceDate",
  "Document Currency": "currency",
  "Due Date": "dueDate",
  "Payment Terms": "paymentTerms",
  "Pay Reference": "payReference",
  "Customer ID": "customerId",
  "Shipment Number": "shipmentNumber",
  "Consol Number": "consolNumber",
  "Job Number": "jobNumber",
  "Job Date": "jobDate",
  IRN: "irn",
  "IRN Ack Number": "irnAckNumber",
  "IRN Ack Time": "irnAckTime",
  "Document Variant": "documentVariant",
  "Page Info": "pageInfo",
  Name: "name",
  "Attention Name": "attentionName",
  "Agent Code": "agentCode",
  "Client GID": "clientGid",
  "Customer Code": "customerCode",
  "Place of Supply": "placeOfSupply",
  RCM: "rcm",
  Shipper: "shipper",
  "Shipper Address": "shipperAddress",
  Consignee: "consignee",
  "Consignee Address": "consigneeAddress",
  "Consignee Contact": "consigneeContact",
  "Second Notify": "secondNotify",
  "Import Customs Broker": "importCustomsBroker",
  "Transport Mode": "transportMode",
  "Shipment Type": "shipmentType",
  "Cargo Type": "cargoType",
  "Inco Terms": "incoTerms",
  Origin: "origin",
  "Place of Receipt": "placeOfReceipt",
  "Place of Acceptance": "placeOfAcceptance",
  "Loading Port": "loadingPort",
  "Discharging Port": "dischargingPort",
  "Place of Delivery": "placeOfDelivery",
  Destination: "destination",
  ETD: "etd",
  ETA: "eta",
  "BL Date": "blDate",
  "CP Date": "cpDate",
  "Vessel Name": "vesselName",
  "Voyage Number": "voyageNumber",
  "IMO Number": "imoNumber",
  "Vessel Flag": "vesselFlag",
  Carrier: "carrier",
  "Ocean BOL": "oceanBol",
  "House BOL": "houseBol",
  MAWB: "mawb",
  HAWB: "hawb",
  "Project Name": "projectName",
  "Order Reference": "orderReference",
  "Goods Description": "goodsDescription",
  "HS Code": "hsCode",
  "SB Numbers": "sbNumbers",
  "SB Dates": "sbDates",
  "Customer Invoice Numbers": "customerInvoiceNumbers",
  "Customer Invoice Dates": "customerInvoiceDates",
  Note: "note",
  "Gross Weight Kg": "grossWeightKg",
  "Weight Unit": "weightUnit",
  "Net Weight Kg": "netWeightKg",
  "Volume Cbm": "volumeCbm",
  "Num Packages": "numPackages",
  "Package Type": "packageType",
  Chargeable: "chargeable",
  "Container Entries": "containers",
  "Total Containers": "totalContainers",
  "Line Number": "lineNumber",
  "SAC HSN Code": "sacHsnCode",
  Description: "description",
  "Line Currency": "currency",
  "Rate Per Unit": "ratePerUnit",
  Units: "units",
  ROE: "roe",
  "Foreign Currency Code": "foreignCurrencyCode",
  "Foreign Currency Amount": "foreignCurrencyAmount",
  "Taxable Amount INR": "taxableAmountInr",
  "Amount INR": "amountInr",
  "IGST Rate": "igstRate",
  "IGST Amount": "igstAmount",
  "CGST Rate": "cgstRate",
  "CGST Amount": "cgstAmount",
  "SGST Rate": "sgstRate",
  "SGST Amount": "sgstAmount",
  "Detention Details": "detentionDetails",
  "Tax Info": "taxInfo",
  "Totals Currency": "currency",
  "Subtotal INR": "subtotalInr",
  "Total INR": "totalInr",
  "Net Payable": "netPayable",
  "Amount In Words": "amountInWords",
  "Add CGST": "addCgst",
  "Add SGST": "addSgst",
  "Beneficiary Name": "beneficiaryName",
  "Bank Name": "bankName",
  "Account Number": "accountNumber",
  "Swift Code": "swiftCode",
  "IFSC Code": "ifscCode",
  IBAN: "iban",
  "Routing Number": "routingNumber",
  Branch: "branch",
  "Registered Office Address": "registeredOfficeAddress",
  "Terms And Conditions": "termsAndConditions",
  "Digital Signature": "digitalSignature",
  "Issued By": "issuedBy",
  "Printed By": "printedBy",
};

function fieldKey(fieldName: string): string {
  return FIELD_JSON_KEY[fieldName.trim()] ?? fieldName.replace(/\s+/g, "").replace(/^./, (c) => c.toLowerCase());
}

function chargeRowTemplate(): Record<string, string | null> {
  return {
    lineNumber: null,
    sacHsnCode: null,
    description: "",
    currency: null,
    ratePerUnit: null,
    units: null,
    roe: null,
    foreignCurrencyCode: null,
    foreignCurrencyAmount: null,
    taxableAmountInr: null,
    amountInr: "",
    igstRate: null,
    igstAmount: null,
    cgstRate: null,
    cgstAmount: null,
    sgstRate: null,
    sgstAmount: null,
    detentionDetails: null,
    taxInfo: null,
  };
}

function buildEmptySingleInvoiceShape(): Record<string, unknown> {
  const issuer: Record<string, string | null> = {
    companyName: "",
    address: null,
    phone: null,
    email: null,
    website: null,
    vatNumber: null,
    gstNumber: null,
    panNumber: null,
    cinNumber: null,
    lutNumber: null,
    tanNumber: null,
    stateCode: null,
  };
  const invoiceIdentification: Record<string, string | null> = {
    invoiceNumber: "",
    invoiceDate: "",
    currency: null,
    dueDate: null,
    paymentTerms: null,
    payReference: null,
    customerId: null,
    shipmentNumber: null,
    consolNumber: null,
    jobNumber: null,
    jobDate: null,
    irn: null,
    irnAckNumber: null,
    irnAckTime: null,
    documentVariant: null,
    pageInfo: null,
  };
  const customer: Record<string, string | null> = {
    name: "",
    attentionName: null,
    address: null,
    agentCode: null,
    gstNumber: null,
    panNumber: null,
    clientGid: null,
    customerCode: null,
    stateCode: null,
    placeOfSupply: null,
    rcm: null,
  };
  const shipment: Record<string, string | null> = {
    shipper: null,
    shipperAddress: null,
    consignee: null,
    consigneeAddress: null,
    consigneeContact: null,
    secondNotify: null,
    importCustomsBroker: null,
    transportMode: null,
    shipmentType: null,
    cargoType: null,
    incoTerms: null,
    origin: null,
    placeOfReceipt: null,
    placeOfAcceptance: null,
    loadingPort: "",
    dischargingPort: "",
    placeOfDelivery: null,
    destination: null,
    etd: null,
    eta: null,
    blDate: null,
    cpDate: null,
    vesselName: null,
    voyageNumber: null,
    imoNumber: null,
    vesselFlag: null,
    carrier: null,
    oceanBol: null,
    houseBol: null,
    mawb: null,
    hawb: null,
    projectName: null,
    orderReference: null,
    goodsDescription: null,
    hsCode: null,
    sbNumbers: null,
    sbDates: null,
    customerInvoiceNumbers: null,
    customerInvoiceDates: null,
    note: null,
  };
  const cargo: Record<string, string | null> = {
    grossWeightKg: null,
    weightUnit: null,
    netWeightKg: null,
    volumeCbm: null,
    numPackages: null,
    packageType: null,
    chargeable: null,
  };
  const totals: Record<string, string | null> = {
    currency: null,
    subtotalInr: "",
    igstAmount: null,
    addCgst: null,
    addSgst: null,
    totalInr: "",
    netPayable: null,
    amountInWords: null,
  };
  const bankDetails: Record<string, string | null> = {
    beneficiaryName: null,
    bankName: null,
    accountNumber: null,
    swiftCode: null,
    ifscCode: null,
    iban: null,
    routingNumber: null,
    branch: null,
  };
  const additionalBankDetails: Record<string, string | null> = { ...bankDetails };
  const footer: Record<string, unknown> = {
    registeredOfficeAddress: null,
    termsAndConditions: null,
    digitalSignature: null,
    issuedBy: null,
    printedBy: null,
  };

  return {
    issuer,
    invoiceIdentification,
    customer,
    shipment,
    cargo,
    containers: null,
    totalContainers: null,
    charges: [chargeRowTemplate()],
    taxSummary: null,
    totals,
    bankDetails,
    additionalBankDetails,
    footer,
  };
}

export function buildStructuredFreightForwarderBillPrompt(schema: SchemaRow[]): string {
  const single = buildEmptySingleInvoiceShape();

  const sectionOrder = [
    "Issuer",
    "Invoice Identification",
    "Customer",
    "Shipment",
    "Cargo",
    "Containers",
    "Charges",
    "Tax Summary",
    "Totals",
    "Bank Details",
    "Additional Bank Details",
    "Footer",
  ];

  const sectionLines: string[] = [];
  const bySec = new Map<string, SchemaRow[]>();
  for (const row of schema) {
    const sec = row.section.trim();
    if (!bySec.has(sec)) bySec.set(sec, []);
    bySec.get(sec)!.push(row);
  }

  for (const sec of sectionOrder) {
    const rows = bySec.get(sec);
    if (!rows?.length) continue;
    const sk = SECTION_JSON_KEY[sec];
    if (sec === "Containers") {
      sectionLines.push(
        `- **Containers** (root):\n` +
          `  - \`containers\` ← **Container Entries** — **JSON array** of \`{ "containerNumber", "containerType" }\` (e.g. 40HC). **null** if break-bulk/air. Do **not** use a comma-separated string.\n` +
          `  - \`totalContainers\` ← **Total Containers** (string count; post-processing may set from array length).`,
      );
      continue;
    }
    if (sec === "Tax Summary") {
      sectionLines.push(
        `- **Tax Summary** (root): \`taxSummary\` ← **Summary Object** — object \`{ "rows": [ ... ] }\` for HSN/SAC table rows, or **null**. May be a JSON string; post-processing normalizes.`,
      );
      continue;
    }
    if (sec === ARRAY_SECTION) {
      const fl = rows.map((r) => `    - \`${fieldKey(r.fieldName)}\` ← **${r.fieldName}**`).join("\n");
      sectionLines.push(`- **${sec}** → \`${sk}\` **array** (one object per line).\n${fl}`);
    } else {
      const fl = rows.map((r) => `    - \`${fieldKey(r.fieldName)}\` ← **${r.fieldName}**`).join("\n");
      sectionLines.push(`- **${sec}** → \`${sk}\` **object**.\n${fl}`);
    }
  }

  const singleExample = {
    source: "Gemini",
    documentType: "Freight Forwarder Bill",
    multiInvoice: false,
    ...single,
  };
  const multiExample = {
    source: "Gemini",
    documentType: "Freight Forwarder Bill",
    multiInvoice: true,
    invoices: [single, { ...single, invoiceIdentification: { ...(single.invoiceIdentification as object), invoiceNumber: "" } }],
  };

  return `You are a precision extractor for **Freight Forwarder Bills** (v2 — Indian GST freight / tax invoices, EFL, DahNAY, Zeeber, Logistic First, etc.).

**New / critical fields (do not omit when printed):**
- \`customer.attentionName\`: text after **ATTENTION:** (e.g. "MR. RAMA KRISHNA IMMADI") — strip the "ATTENTION:" prefix.
- \`shipment.importCustomsBroker\`: labeled **Import Customs Broker** (null if blank).
- \`footer.digitalSignature\`: when the PDF shows **Signed by … on behalf of …, Date: …, time + TZ**, output a **JSON object** \`{ "signedBy", "onBehalfOf", "signatureDate", "signatureTime" }\` — **never leave null** if that block is visible (EFL bottom-left).
- \`containers\`: **array** of \`{ "containerNumber", "containerType" }\`, not a comma string.
- **INR naming**: Use \`charges[].taxableAmountInr\` for the **pre-tax** base (CHARGES IN INR / taxable column). Use \`charges[].amountInr\` for the **line total in INR** (taxable + IGST, or + CGST/SGST if intra-state). **Critical — \`amountInr\` from the PDF only:** copy the **exact printed** line total from the invoice table (column often labeled total / amount / Amt in INR including tax). **Never** set \`amountInr\` equal to \`taxableAmountInr\` when the PDF shows a larger total with IGST. **Do not** compute \`amountInr\` in your head unless no total column exists — only then derive taxable + IGST (± CGST/SGST). Do **not** use \`amountUsd\` (legacy removed).
- \`totals.subtotalInr\`, \`totals.totalInr\`, \`totals.currency\` (e.g. "INR"). Do **not** use subtotalUsd/totalUsd.
- \`invoiceIdentification.currency\`: document currency (usually "INR" for these tax invoices).
- \`cargo.grossWeightKg\` for gross mass; \`cargo.netWeightKg\` for net.

**Issuer PAN / CIN:** scan **all pages** — EFL often puts PAN/CIN in **Registered Office / page 2 footer**. Derive \`issuer.stateCode\` from GSTIN first two digits when not printed.

**Charge lines:** \`lineNumber\` = **"1"**, **"2"**, … for every line in order. \`foreignCurrencyCode\` / \`foreignCurrencyAmount\` only for converted FX lines. \`igstRate\` without **%**. \`ratePerUnit\` from description if column empty (INR …/CN, @ …).

**Amount mapping:** \`taxableAmountInr\` = pre-tax column. \`amountInr\` = **printed** line total (including tax). If the PDF shows both, they must differ whenever IGST (or CGST+SGST) is non-zero. ROE null when INR and 1.00000.

**\`shipment.transportMode\`:** Use enum **SEA** | **AIR** | **ROAD** | **RAIL** | **MULTIMODAL**. If the form leaves mode blank but the document is clearly **ocean** (vessel name, voyage, IMO, Ocean B/L, container types, loading/discharging ports), set **SEA** — do **not** leave null.

**\`bankDetails.beneficiaryName\`:** Scan **all pages** of the PDF. Map labels **Beneficiary**, **Beneficiary Name**, **Account Name**, **Account Holder** (EFL page 2 bank block: "Account Name: …") to \`bankDetails.beneficiaryName\`. Must match the printed account name when present (often the forwarder legal name).

**\`shipment.hsCode\`:** Use a dedicated HS/HSN column when present. If there is **no** separate field but the **goods description** embeds HSN (e.g. **"HSNC - 7308909590"**, "HSN:", "HS CODE"), extract that numeric code into \`hsCode\` — do **not** leave null when the text clearly contains it.

**ORIGINAL vs COPY:** EFL — extract ORIGINAL only; \`documentVariant\` = "ORIGINAL".

**Sea vs air, EFL goods block parsing, dual banks, taxSummary.rows** — same rules as before.

**Leaf values:** string or null for scalars; \`containers\` is **array** or null; \`taxSummary\` object or null; \`footer.digitalSignature\` **object** or null. No \`amountUsd\`.

NORMALIZATION: legacy \`amountUsd\` → \`amountInr\`; comma container strings → array; missing \`lineNumber\` / \`taxableAmountInr\` backfilled when possible; \`amountInr\` only computed from tax components when missing or when it wrongly equals taxable while tax is non-zero; \`transportMode\` → SEA if inferred from vessel/BoL; \`hsCode\` from \`goodsDescription\` when embedded (e.g. HSNC - …); digital signature text parsed to object.

OUTPUT SHAPE:
1. Single invoice: \`multiInvoice\`: false; top-level issuer … footer; \`documentType\`: "Freight Forwarder Bill".
2. Multi-invoice: \`invoices\`[] full objects through footer.

SECTION MAPPING:
${sectionLines.join("\n\n")}

SINGLE-INVOICE TEMPLATE:
${JSON.stringify(singleExample, null, 2)}

MULTI-INVOICE TEMPLATE:
${JSON.stringify(multiExample, null, 2)}

Respond with **one JSON object** only (no markdown fences).`;
}
