/**
 * Writes output/schema-discovery/Ocean Freight Invoice.final-schema.json
 * Run: node scripts/bootstrap-ocean-freight-schema.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output", "schema-discovery", "Ocean Freight Invoice.final-schema.json");

function f(section, fieldName, description, required = false, alternateLabels) {
  const o = { section, fieldName, fieldType: "string", description, required };
  if (alternateLabels?.length) o.alternateLabels = alternateLabels;
  return o;
}

const fields = [
  ...[
    ["Issuer", "Company Name", "Forwarder / issuer legal name from letterhead", true],
    ["Issuer", "Address", "Issuer full address"],
    ["Issuer", "Phone", "Issuer phone"],
    ["Issuer", "Email", "Issuer email"],
    ["Issuer", "Website", "Issuer website"],
    ["Issuer", "VAT Number", "VAT / tax ID (non-Indian)"],
    ["Issuer", "GST Number", "GSTIN (Indian); 15 chars — first 2 digits are state code if state not printed"],
    [
      "Issuer",
      "PAN Number",
      "PAN (Indian). EFL/Expo Freight: often only in Registered Office / footer on page 2 (e.g. PAN : AAACE2126J) — scan all pages",
    ],
    [
      "Issuer",
      "CIN Number",
      "CIN. EFL: often only in footer / Registered Office block on page 2 — scan all pages",
    ],
    ["Issuer", "LUT Number", "Letter of Undertaking"],
    ["Issuer", "TAN Number", "Tax Deduction Account Number"],
    [
      "Issuer",
      "State Code",
      "State code (Indian); if omitted on PDF derive from first 2 characters of GSTIN",
    ],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Invoice Identification", "Invoice Number", "Invoice number", true],
    ["Invoice Identification", "Invoice Date", "Invoice date — normalize DD-MMM-YYYY", true],
    ["Invoice Identification", "Due Date", "Due date"],
    ["Invoice Identification", "Payment Terms", "e.g. Net 30"],
    ["Invoice Identification", "Pay Reference", "Payment reference (EFL Pay Ref etc.)"],
    ["Invoice Identification", "Customer ID", "Customer / account code (EFL CUSTOMER ID)"],
    ["Invoice Identification", "Shipment Number", "Shipment ref (DahNAY Shipment No., EFL SHIPMENT) — not HBL"],
    ["Invoice Identification", "Consol Number", "Consolidation number (EFL)"],
    ["Invoice Identification", "Job Number", "Job / file number (Zeeber, Logistic First); not HBL for DahNAY"],
    ["Invoice Identification", "Job Date", "Job date"],
    ["Invoice Identification", "IRN", "E-invoice IRN hash or null if not generated"],
    ["Invoice Identification", "IRN Ack Number", "IRN acknowledgement number"],
    ["Invoice Identification", "IRN Ack Time", "IRN ack timestamp as printed (not normalized)"],
    [
      "Invoice Identification",
      "Document Variant",
      'ORIGINAL vs COPY — extract ORIGINAL only; set "ORIGINAL" when ignoring COPY pages',
    ],
    ["Invoice Identification", "Page Info", "Page x of y if useful"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Customer", "Name", "Bill-to customer legal name", true],
    ["Customer", "Address", "Customer address"],
    ["Customer", "Agent Code", "Agent code"],
    ["Customer", "GST Number", "Customer GSTIN"],
    ["Customer", "PAN Number", "Customer PAN"],
    ["Customer", "Client GID", "Client GID / CIN-style id (EFL)"],
    ["Customer", "Customer Code", "Customer code (Logistic First PAN-style)"],
    ["Customer", "State Code", "Place of supply state code"],
    ["Customer", "Place of Supply", "Place of supply"],
    ["Customer", "RCM", "Reverse charge text or flag as string"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Shipment", "Shipper", "Shipper name"],
    ["Shipment", "Shipper Address", "Shipper address"],
    ["Shipment", "Consignee", "Consignee name"],
    ["Shipment", "Consignee Address", "Consignee address"],
    ["Shipment", "Consignee Contact", "Consignee contact"],
    ["Shipment", "Second Notify", "Second notify party (EFL embedded or dedicated)"],
    ["Shipment", "Transport Mode", 'SEA or AIR — use "SEA" / "AIR" when clear'],
    ["Shipment", "Shipment Type", "FCL/LCL etc. if labeled"],
    ["Shipment", "Cargo Type", "Cargo type if labeled"],
    ["Shipment", "Inco Terms", "Incoterms"],
    ["Shipment", "Origin", "Origin location"],
    ["Shipment", "Place of Receipt", "Place of receipt"],
    ["Shipment", "Place of Acceptance", "Place of acceptance"],
    ["Shipment", "Loading Port", "POL", true],
    ["Shipment", "Discharging Port", "POD", true],
    ["Shipment", "Place of Delivery", "Place of delivery"],
    ["Shipment", "Destination", "Final destination"],
    ["Shipment", "ETD", "Estimated departure"],
    ["Shipment", "ETA", "Estimated arrival"],
    ["Shipment", "BL Date", "B/L date"],
    ["Shipment", "CP Date", "Charter party date"],
    ["Shipment", "Vessel Name", "Vessel (ocean)"],
    ["Shipment", "Voyage Number", "Voyage — note Logistic First may label as Flight Number for sea"],
    ["Shipment", "IMO Number", "IMO"],
    ["Shipment", "Vessel Flag", "Flag state"],
    ["Shipment", "Carrier", "Carrier name (DahNAY dedicated field)"],
    ["Shipment", "Ocean BOL", "Master / ocean B/L"],
    ["Shipment", "House BOL", "House B/L"],
    ["Shipment", "MAWB", "Master AWB (air)"],
    ["Shipment", "HAWB", "House AWB (air)"],
    ["Shipment", "Project Name", "Project name — also parse from EFL goods block"],
    ["Shipment", "Order Reference", "PO / order ref"],
    ["Shipment", "Goods Description", "Full goods / cargo description (keep full EFL block)"],
    ["Shipment", "HS Code", "HSN — parse from goods text when embedded (EFL)"],
    ["Shipment", "SB Numbers", "Shipping bill numbers comma-separated"],
    ["Shipment", "SB Dates", "SB dates comma-separated; normalize to DD-MMM-YYYY"],
    [
      "Shipment",
      "Customer Invoice Numbers",
      "Commercial invoice numbers comma-separated (critical for linking)",
    ],
    ["Shipment", "Customer Invoice Dates", "Matching invoice dates comma-separated"],
    ["Shipment", "Note", "Shipment notes"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Cargo", "Weight Kg", "Gross weight numeric"],
    ["Cargo", "Weight Unit", "KG / MT etc."],
    ["Cargo", "Net Weight Kg", "Net weight (EFL NET WT in goods block)"],
    ["Cargo", "Volume Cbm", "Volume CBM"],
    ["Cargo", "Num Packages", "Package count"],
    ["Cargo", "Package Type", "Package type"],
    ["Cargo", "Chargeable", "Chargeable weight / W/M"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  f(
    "Containers",
    "Containers List",
    "Comma-separated e.g. 'CMAU4455553 - 40HC, CMAU5861515 - 40HC'. Null break-bulk/air.",
  ),
  f("Containers", "Total Containers", "Count string; post-processing fills from list if null"),
  ...[
    ["Charges", "Line Number", "Line number if shown"],
    ["Charges", "SAC HSN Code", "SAC or HSN on line (Indian)"],
    ["Charges", "Description", "Full line description as printed", true],
    ["Charges", "Currency", "Line currency"],
    [
      "Charges",
      "Rate Per Unit",
      "Unit rate from column; if blank parse from same-line description (e.g. INR 17140.00/CN, @ 110.00)",
    ],
    ["Charges", "Units", "Units / qty basis"],
    ["Charges", "ROE", "Rate of exchange; null when 1.00000 and charge already INR"],
    ["Charges", "Currency Amount", "Amount in foreign currency before ROE if split out"],
    ["Charges", "Taxable Amount INR", "INR pre-tax (DahNAY Amount, EFL CHARGES IN INR, Taxable Amt)"],
    [
      "Charges",
      "Amount USD",
      "Primary line amount: USD for USD docs; for INR docs post-tax total including tax (see prompt)",
      true,
    ],
    ["Charges", "IGST Rate", "IGST percent as numeric string without % (e.g. 18)"],
    ["Charges", "IGST Amount", "IGST amount"],
    ["Charges", "CGST Rate", "CGST percent as numeric string without %"],
    ["Charges", "CGST Amount", "CGST amount"],
    ["Charges", "SGST Rate", "SGST percent as numeric string without %"],
    ["Charges", "SGST Amount", "SGST amount"],
    ["Charges", "Detention Details", "Per-container detention breakdown text (EFL)"],
    ["Charges", "Tax Info", "Unstructured tax text fallback"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  f(
    "Tax Summary",
    "Entries JSON",
    "HSN/SAC tax summary table as JSON array string, or null (Logistic First / Zeeber)",
  ),
  ...[
    ["Totals", "Subtotal USD", "Total before tax (subtotalUsd)", true],
    ["Totals", "IGST Amount", "Total IGST if separate"],
    ["Totals", "Add CGST", "Total CGST"],
    ["Totals", "Add SGST", "Total SGST"],
    ["Totals", "Total USD", "Grand total including tax", true],
    ["Totals", "Net Payable", "Net payable if distinct"],
    ["Totals", "Amount In Words", "Amount in words"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Bank Details", "Beneficiary Name", "Primary account beneficiary"],
    ["Bank Details", "Bank Name", "Bank name"],
    ["Bank Details", "Account Number", "Account number"],
    ["Bank Details", "Swift Code", "SWIFT/BIC"],
    ["Bank Details", "IFSC Code", "IFSC"],
    ["Bank Details", "IBAN", "IBAN"],
    ["Bank Details", "Routing Number", "US routing"],
    ["Bank Details", "Branch", "Branch name"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Additional Bank Details", "Beneficiary Name", "Second bank (DahNAY) — beneficiary"],
    ["Additional Bank Details", "Bank Name", "Second bank name"],
    ["Additional Bank Details", "Account Number", "Second account number"],
    ["Additional Bank Details", "Swift Code", "Second SWIFT"],
    ["Additional Bank Details", "IFSC Code", "Second IFSC"],
    ["Additional Bank Details", "IBAN", "Second IBAN"],
    ["Additional Bank Details", "Routing Number", "Second routing"],
    ["Additional Bank Details", "Branch", "Second branch"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Footer", "Registered Office Address", "Registered office if in footer"],
    ["Footer", "Terms And Conditions", "T&C text"],
    [
      "Footer",
      "Digital Signature",
      "Signature metadata JSON string (DahNAY/EFL) or null for computer-generated only",
    ],
    ["Footer", "Issued By", "Issued by"],
    ["Footer", "Printed By", "Printed by"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
];

const doc = {
  documentCategory: "Ocean Freight Invoice",
  source: "Gemini",
  summary:
    "Ocean/air freight invoices: Indian and global issuers, GST, dual banks, EFL embedded fields, tax summary, multi-invoice PDFs, ORIGINAL vs COPY, sea vs air.",
  statistics: { outputFieldCount: fields.length },
  fields,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log("Wrote", out, "fields:", fields.length);
