/**
 * Ocean Freight Invoice — structured extraction (ocean/air; Indian GST + global issuers).
 */

import type { SchemaRow } from "./ocean-freight-schema-types.js";

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
  "Weight Kg": "weightKg",
  "Weight Unit": "weightUnit",
  "Net Weight Kg": "netWeightKg",
  "Volume Cbm": "volumeCbm",
  "Num Packages": "numPackages",
  "Package Type": "packageType",
  Chargeable: "chargeable",
  "Containers List": "containers",
  "Total Containers": "totalContainers",
  "Line Number": "lineNumber",
  "SAC HSN Code": "sacHsnCode",
  Description: "description",
  Currency: "currency",
  "Rate Per Unit": "ratePerUnit",
  Units: "units",
  ROE: "roe",
  "Currency Amount": "currencyAmount",
  "Taxable Amount INR": "taxableAmountInr",
  "Amount USD": "amountUsd",
  "IGST Rate": "igstRate",
  "IGST Amount": "igstAmount",
  "CGST Rate": "cgstRate",
  "CGST Amount": "cgstAmount",
  "SGST Rate": "sgstRate",
  "SGST Amount": "sgstAmount",
  "Detention Details": "detentionDetails",
  "Tax Info": "taxInfo",
  "Subtotal USD": "subtotalUsd",
  "Total USD": "totalUsd",
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
    currencyAmount: null,
    taxableAmountInr: null,
    amountUsd: "",
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
    weightKg: null,
    weightUnit: null,
    netWeightKg: null,
    volumeCbm: null,
    numPackages: null,
    packageType: null,
    chargeable: null,
  };
  const totals: Record<string, string | null> = {
    subtotalUsd: "",
    igstAmount: null,
    addCgst: null,
    addSgst: null,
    totalUsd: "",
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
  const footer: Record<string, string | null> = {
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

export function buildStructuredOceanFreightPrompt(schema: SchemaRow[]): string {
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
          `  - \`containers\` ← **Containers List**\n` +
          `  - \`totalContainers\` ← **Total Containers**`,
      );
      continue;
    }
    if (sec === "Tax Summary") {
      sectionLines.push(
        `- **Tax Summary** (root): \`taxSummary\` ← **Entries JSON** (JSON **string** of an array of row objects, or **null**).`,
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
    documentType: "Ocean Freight Invoice",
    multiInvoice: false,
    ...single,
  };
  const multiExample = {
    source: "Gemini",
    documentType: "Ocean Freight Invoice",
    multiInvoice: true,
    invoices: [single, { ...single, invoiceIdentification: { ...(single.invoiceIdentification as object), invoiceNumber: "" } }],
  };

  return `You are a precision extractor for **Ocean Freight Invoices** (and air freight that shares this layout): forwarder and carrier bills with very high layout variance — LEMAN USA, MUR Shipping, EFL/Expo Freight, DahNAY, Zeeber, Logistic First, AJS, Logistics Plus, etc. Identify issuer by **letterhead company name**; new layouts will appear.

**Issuer PAN / CIN / GST (recall — scan whole PDF):**
- **Read every page.** Indian issuers often put **PAN** and **CIN** only in the **Registered Office Address** or **footer / statutory block** on **page 2** (or last page), **not** on the page-1 letterhead.
- **EFL / Expo Freight**: PAN and CIN routinely appear as lines like \`PAN : AAACE2126J\` and \`CIN : U60231TN1996PTC036702\` in that footer block — you **must** copy them into \`issuer.panNumber\` and \`issuer.cinNumber\` even when missing from the header.
- **issuer.stateCode**: If not printed explicitly, **derive** from the **first two characters** of \`issuer.gstNumber\` when it is a valid 15-character GSTIN (e.g. \`24AAACE2126J...\` → \`issuer.stateCode\` = \`"24"\`).

**Charge lines — consistency:**
- **igstRate / cgstRate / sgstRate**: Store as a **numeric string without \`%\`** (e.g. \`"18"\`, not \`"18%"\`). Post-processing normalizes this.
- **ratePerUnit**: If the rate column is blank but the **description** states a unit rate (e.g. \`INR 17140.00/CN\`, \`@ 110.00\`, \`Frt 1958.783 MT @ 110.00\`), **extract that number** into \`ratePerUnit\` — do not leave null when the rate is visible in the same line’s description.

OUTPUT SHAPE:
1. **Single invoice**: \`multiInvoice\`: false; top-level: issuer, invoiceIdentification, customer, shipment, cargo, containers, totalContainers, charges, taxSummary, totals, bankDetails, additionalBankDetails, footer; plus source:"Gemini", documentType:"Ocean Freight Invoice".
2. **Multi-invoice PDF** (invoice number changes per page, e.g. MUR): \`multiInvoice\`: true; \`invoices\`[] of full objects (same keys as single invoice: through \`footer\`, \`taxSummary\`, \`additionalBankDetails\`). Repeat shared vessel/bank on each. No issuer-only-at-root.
3. **ORIGINAL vs COPY** (EFL): extract **ORIGINAL** pages only; \`invoiceIdentification.documentVariant\` = **"ORIGINAL"**.
4. **Sea vs air**: **SEA** → vessel/voyage/IMO/flag, oceanBol/houseBol; mawb/hawb null. **AIR** → mawb/hawb; ocean fields null. **transportMode** "SEA" or "AIR". **Exception**: Logistic First may label sea voyage as "Flight Number" — if value looks like vessel/voyage (e.g. "CMA CGM VERDI / 0INLW1MA"), treat as ocean.
5. **Charges[]**: keep **full description** text. Indian lines: sacHsnCode, currency, ratePerUnit, units, roe, currencyAmount, taxableAmountInr, igst/cgst/sgst rate & amount, detentionDetails, taxInfo as available.
6. **Amount mapping (critical)**: \`charges[].amountUsd\` is the **primary** line amount: USD lines → USD amount; **INR lines** → final INR **including tax** (DahNAY "Total", Zeeber/Logistic First "Amt in INR", EFL: taxable + IGST). \`taxableAmountInr\` = pre-tax INR. **ROE**: null when charge is already INR and ROE is 1.00000.
7. **Totals**: \`subtotalUsd\` = before tax; \`totalUsd\` = grand total **including** tax; \`igstAmount\` at totals level when shown separately.
8. **Containers**: one comma-separated string in \`containers\`; \`totalContainers\` count string or null — post-processing may count commas if null.
9. **EFL goodsDescription**: keep **full** text; also **parse out** to fields: hsCode (HSNC), customerInvoiceNumbers/Dates, sbNumbers/Dates, projectName, netWeightKg → \`cargo.netWeightKg\`, secondNotify.
10. **customerInvoiceNumbers** / **Dates**: comma-separated strings for cross-doc linking (Zeeber, Logistic First, EFL embedded).
11. **Dual banks (DahNAY)**: \`bankDetails\` = primary; \`additionalBankDetails\` = second (same keys).
12. **Digital signature**: DahNAY/EFL structured stamp → \`footer.digitalSignature\` as **JSON string**; "computer generated" disclaimers → null.
13. **taxSummary**: JSON **string** of array of HSN/SAC summary rows, or null.
14. **unmappedLabels** (optional root string[]): labeled values with no schema field.
15. Leaf values: **string** or **null** only (except taxSummary may be stringified JSON). No bare numbers/booleans.

NORMALIZATION (post-processing): commas stripped from money fields; **tax rates** (\`igstRate\`/\`cgstRate\`/\`sgstRate\`) → strip \`%\` and keep numeric string; **issuer.stateCode** filled from first two digits of \`issuer.gstNumber\` when still blank; **ratePerUnit** backfilled from description when missing (e.g. \`INR …/CN\`); dates → DD-MMM-YYYY; cargo weights/units; empty optional strings → null; container count backfill.

SECTION MAPPING:
${sectionLines.join("\n\n")}

SINGLE-INVOICE TEMPLATE:
${JSON.stringify(singleExample, null, 2)}

MULTI-INVOICE TEMPLATE:
${JSON.stringify(multiExample, null, 2)}

Respond with **one JSON object** only (no markdown fences).`;
}
