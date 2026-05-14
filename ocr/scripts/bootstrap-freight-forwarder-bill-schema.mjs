/**
 * Writes output/schema-discovery/Freight Forwarder Bill.final-schema.json (v2 — INR naming, containers array, attention, customs broker).
 * Run: node scripts/bootstrap-freight-forwarder-bill-schema.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output", "schema-discovery", "Freight Forwarder Bill.final-schema.json");

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
      "PAN (Indian). EFL: often Registered Office / footer page 2 — scan all pages",
    ],
    ["Issuer", "CIN Number", "CIN; EFL footer page 2 — scan all pages"],
    ["Issuer", "LUT Number", "Letter of Undertaking"],
    ["Issuer", "TAN Number", "Tax Deduction Account Number"],
    ["Issuer", "State Code", "State code; derive from GSTIN first 2 digits if omitted"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Invoice Identification", "Invoice Number", "Invoice number", true],
    ["Invoice Identification", "Invoice Date", "DD-MMM-YYYY", true],
    [
      "Invoice Identification",
      "Document Currency",
      "Document currency e.g. INR for Indian tax invoices; USD only if invoice is truly USD",
    ],
    ["Invoice Identification", "Due Date", "Due date"],
    ["Invoice Identification", "Payment Terms", "e.g. Net 30"],
    ["Invoice Identification", "Pay Reference", "EFL Pay Ref etc."],
    ["Invoice Identification", "Customer ID", "EFL CUSTOMER ID"],
    ["Invoice Identification", "Shipment Number", "EFL SHIPMENT — not HBL"],
    ["Invoice Identification", "Consol Number", "Consolidation number (EFL)"],
    ["Invoice Identification", "Job Number", "Job / file number"],
    ["Invoice Identification", "Job Date", "Job date"],
    ["Invoice Identification", "IRN", "E-invoice IRN or null"],
    ["Invoice Identification", "IRN Ack Number", "IRN acknowledgement number"],
    ["Invoice Identification", "IRN Ack Time", "IRN ack time as printed"],
    [
      "Invoice Identification",
      "Document Variant",
      'ORIGINAL vs COPY — extract ORIGINAL only; value "ORIGINAL"',
    ],
    ["Invoice Identification", "Page Info", "Page x of y"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Customer", "Name", "Bill-to legal name", true],
    [
      "Customer",
      "Attention Name",
      "Contact from ATTENTION line e.g. MR. RAMA KRISHNA IMMADI (without ATTENTION: prefix)",
    ],
    ["Customer", "Address", "Customer address"],
    ["Customer", "Agent Code", "Agent code"],
    ["Customer", "GST Number", "Customer GSTIN"],
    ["Customer", "PAN Number", "Customer PAN"],
    ["Customer", "Client GID", "Client GID / CIN-style id (EFL)"],
    ["Customer", "Customer Code", "Logistic First style code"],
    ["Customer", "State Code", "Place of supply state code"],
    ["Customer", "Place of Supply", "Place of supply"],
    ["Customer", "RCM", "Reverse charge YES/NO or text"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Shipment", "Shipper", "Shipper name"],
    ["Shipment", "Shipper Address", "Shipper address"],
    ["Shipment", "Consignee", "Consignee name"],
    ["Shipment", "Consignee Address", "Consignee address"],
    ["Shipment", "Consignee Contact", "Consignee contact"],
    ["Shipment", "Second Notify", "2nd notify party"],
    [
      "Shipment",
      "Import Customs Broker",
      "Labeled Import Customs Broker field — null if blank on PDF",
    ],
    [
      "Shipment",
      "Transport Mode",
      'SEA / AIR / ROAD / RAIL / MULTIMODAL. If blank on form but vessel/voyage/IMO/Ocean B/L present → SEA.',
    ],
    ["Shipment", "Shipment Type", "FCL/LCL etc."],
    ["Shipment", "Cargo Type", "Cargo type"],
    ["Shipment", "Inco Terms", "Incoterms"],
    ["Shipment", "Origin", "Origin"],
    ["Shipment", "Place of Receipt", "Place of receipt"],
    ["Shipment", "Place of Acceptance", "Place of acceptance"],
    ["Shipment", "Loading Port", "POL", true],
    ["Shipment", "Discharging Port", "POD", true],
    ["Shipment", "Place of Delivery", "Place of delivery"],
    ["Shipment", "Destination", "Destination"],
    ["Shipment", "ETD", "ETD"],
    ["Shipment", "ETA", "ETA"],
    ["Shipment", "BL Date", "B/L date"],
    ["Shipment", "CP Date", "CP date"],
    ["Shipment", "Vessel Name", "Vessel"],
    ["Shipment", "Voyage Number", "Voyage"],
    ["Shipment", "IMO Number", "IMO"],
    ["Shipment", "Vessel Flag", "Flag"],
    ["Shipment", "Carrier", "Carrier"],
    ["Shipment", "Ocean BOL", "Ocean B/L"],
    ["Shipment", "House BOL", "House B/L"],
    ["Shipment", "MAWB", "MAWB"],
    ["Shipment", "HAWB", "HAWB"],
    ["Shipment", "Project Name", "Project; parse from EFL goods block if embedded"],
    ["Shipment", "Order Reference", "PO ref"],
    ["Shipment", "Goods Description", "Full goods block"],
    [
      "Shipment",
      "HS Code",
      "HS/HSN; if no column, parse from goods text (e.g. EFL 'HSNC - 7308909590')",
    ],
    ["Shipment", "SB Numbers", "Comma-separated SB numbers"],
    ["Shipment", "SB Dates", "Comma-separated SB dates"],
    ["Shipment", "Customer Invoice Numbers", "Comma-separated export invoice numbers"],
    ["Shipment", "Customer Invoice Dates", "Comma-separated dates"],
    ["Shipment", "Note", "Notes"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Cargo", "Gross Weight Kg", "Gross weight KG"],
    ["Cargo", "Weight Unit", "KG / MT"],
    ["Cargo", "Net Weight Kg", "Net weight KG"],
    ["Cargo", "Volume Cbm", "CBM"],
    ["Cargo", "Num Packages", "Package count"],
    ["Cargo", "Package Type", "Package type"],
    ["Cargo", "Chargeable", "Chargeable W/M"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  f(
    "Containers",
    "Container Entries",
    "Root `containers`: JSON array of {containerNumber, containerType}. Not comma string. Null break-bulk/air.",
  ),
  f("Containers", "Total Containers", "Count string; post-processing from array length"),
  ...[
    ["Charges", "Line Number", "Sequential '1','2',… — always populate"],
    ["Charges", "SAC HSN Code", "SAC/HSN"],
    ["Charges", "Description", "Full line text", true],
    ["Charges", "Line Currency", "Line currency e.g. INR"],
    ["Charges", "Rate Per Unit", "Unit rate; parse from description if column blank"],
    ["Charges", "Units", "Units / qty"],
    ["Charges", "ROE", "ROE; null if 1.00000 and INR line"],
    ["Charges", "Foreign Currency Code", "e.g. USD if converted line"],
    ["Charges", "Foreign Currency Amount", "Amount in foreign currency before conversion"],
    ["Charges", "Taxable Amount INR", "Pre-tax INR — must populate for Indian GST lines"],
    [
      "Charges",
      "Amount INR",
      "Printed line total INR (taxable + IGST or +CGST/SGST) — copy from PDF column; never duplicate taxable when PDF shows a higher total. Compute only if no total column.",
      true,
    ],
    ["Charges", "IGST Rate", "Numeric string without %"],
    ["Charges", "IGST Amount", "IGST INR"],
    ["Charges", "CGST Rate", "CGST % string"],
    ["Charges", "CGST Amount", "CGST amount"],
    ["Charges", "SGST Rate", "SGST % string"],
    ["Charges", "SGST Amount", "SGST amount"],
    ["Charges", "Detention Details", "Detention breakdown"],
    ["Charges", "Tax Info", "Unstructured tax fallback"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  f(
    "Tax Summary",
    "Summary Object",
    "Root `taxSummary`: object { rows: [...] } or null; rows = HSN/SAC summary lines",
  ),
  ...[
    ["Totals", "Totals Currency", "e.g. INR"],
    ["Totals", "Subtotal INR", "Subtotal before tax", true],
    ["Totals", "IGST Amount", "Total IGST"],
    ["Totals", "Add CGST", "Total CGST"],
    ["Totals", "Add SGST", "Total SGST"],
    ["Totals", "Total INR", "Grand total including tax", true],
    ["Totals", "Net Payable", "Net payable if distinct"],
    ["Totals", "Amount In Words", "In words"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    [
      "Bank Details",
      "Beneficiary Name",
      "Beneficiary / Account Name — all pages; EFL page 2 'Account Name:' maps here",
    ],
    ["Bank Details", "Bank Name", "Bank name (label may exist with blank value)"],
    ["Bank Details", "Account Number", "Account"],
    ["Bank Details", "Swift Code", "SWIFT"],
    ["Bank Details", "IFSC Code", "IFSC"],
    ["Bank Details", "IBAN", "IBAN"],
    ["Bank Details", "Routing Number", "Routing"],
    ["Bank Details", "Branch", "Branch"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Additional Bank Details", "Beneficiary Name", "Second bank beneficiary"],
    ["Additional Bank Details", "Bank Name", "Second bank name"],
    ["Additional Bank Details", "Account Number", "Second account"],
    ["Additional Bank Details", "Swift Code", "Second SWIFT"],
    ["Additional Bank Details", "IFSC Code", "Second IFSC"],
    ["Additional Bank Details", "IBAN", "Second IBAN"],
    ["Additional Bank Details", "Routing Number", "Second routing"],
    ["Additional Bank Details", "Branch", "Second branch"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
  ...[
    ["Footer", "Registered Office Address", "Registered office"],
    ["Footer", "Terms And Conditions", "T&C"],
    [
      "Footer",
      "Digital Signature",
      "Object {signedBy, onBehalfOf, signatureDate, signatureTime} when EFL/DahNAY stamp present — never skip when visible",
    ],
    ["Footer", "Issued By", "Issued by"],
    ["Footer", "Printed By", "Printed by"],
  ].map(([s, n, d, r]) => f(s, n, d, r)),
];

const doc = {
  documentCategory: "Freight Forwarder Bill",
  source: "Gemini",
  summary:
    "v2: INR charge/total naming, containers[], attentionName, importCustomsBroker, structured digitalSignature, taxSummary.rows.",
  statistics: { outputFieldCount: fields.length },
  fields,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log("Wrote", out, "fields:", fields.length);
