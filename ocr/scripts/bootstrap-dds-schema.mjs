/**
 * One-shot: writes output/schema-discovery/Delivery Deduction Sheet.final-schema.json
 * Run: node scripts/bootstrap-dds-schema.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output", "schema-discovery", "Delivery Deduction Sheet.final-schema.json");

function f(section, fieldName, description, required = false, alternateLabels) {
  const o = { section, fieldName, fieldType: "string", description, required };
  if (alternateLabels?.length) o.alternateLabels = alternateLabels;
  return o;
}

const fields = [
  f("Company", "Company Name", "Exporter / supplier company name from letterhead", true),
  f("Company", "CIN", "Company Identification Number (both Immadi and Zetwerk have this)"),
  f("Company", "Registered Address", "Registered address — strip 'Regd. Officer :' or 'Registered Office:' label prefix"),
  f("Company", "GST Number", "GST/GSTIN number (Immadi only; null for Zetwerk)"),
  f("Company", "Email", "Company email (Immadi only; null for Zetwerk)"),
  f("Company", "Phone", "Company phone number (Immadi only; null for Zetwerk)"),

  f("Shipment Reference", "Booking Number", "Booking reference number (label: 'BOOKING NO:') — null when not present", false, ["BOOKING NO"]),
  f("Shipment Reference", "BOL Number", "Bill of Lading number (label: 'Bill of Lading No:') — null when not present", false, ["Bill of Lading No", "BL No", "B/L No"]),
  f("Shipment Reference", "Liner", "Liner/shipping line name (label: 'Liner :') — null when not present"),
  f("Shipment Reference", "Vessel Name", "Vessel name (label: 'Vessel Name:') — null when not present, typically break-bulk"),

  f("Parties", "Sold To", "Buyer / sold-to party name (label: 'Sold to.:' or 'Sold To')", true, ["Sold to.:", "Sold To"]),
  f("Parties", "Consignee", "Consignee name (label: 'Consignee:')", true),
  f("Parties", "Port Of Loading", "Port of loading (label: 'Port of Loading:')", true, ["Port of Loading"]),

  f("Reference Invoices", "Invoice Number", "Full invoice number (e.g. 'EXP/1048/25-26' or 'KA/UM/2526/00768')", true),
  f("Reference Invoices", "Invoice Date", "Invoice date — normalize to DD-MMM-YYYY", true),

  f("Origin Charges", "Description", "Charge type descriptions (e.g. 'Inland Haulage Charges, CFS Charges, ...')", true),
  f("Origin Charges", "Num Containers", "Number of containers (null for break-bulk shipments without container column)", false, ["No of Containers", "Containers"]),
  f("Origin Charges", "Total Cargo Weight Mt", "Total cargo weight in MT (strip units, plain number)", true, ["Total Cargo Weight", "Weight (MT)"]),
  f("Origin Charges", "INR Total", "Total amount in INR (strip Indian-format commas, plain number e.g. '1356484.8')", true, ["INR Total", "Total (INR)"]),
  f("Origin Charges", "USD Total", "Total amount in USD (strip commas, plain number e.g. '14744.4')", true, ["USD Total", "Total (USD)"]),
];

const doc = {
  documentCategory: "Delivery Deduction Sheet",
  source: "Gemini",
  summary: "Freight & Transportation Summary Sheet (DDS): company header, shipment reference (booking/BL/liner/vessel), invoice table (dual-column layout), party details, and origin charges.",
  statistics: { outputFieldCount: fields.length },
  fields,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n", "utf8");
console.log("Wrote", out, "fields:", fields.length);
