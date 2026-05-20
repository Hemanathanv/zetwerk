/**
 * US Sales Invoice - structured extraction prompt preamble + canonical key map.
 * Python uses the preamble text and this canonical map to build the final schema-driven prompt.
 */

import type { SchemaRow } from "./us-sales-invoice-schema-types.js";

const CANONICAL_JSON_KEY_BY_FIELD_NAME: Record<string, string> = {
  Company: "company",
  "Document Type": "documentType",
  Date: "date",
  "Invoice No": "invoiceNo",

  Street: "street",
  City: "city",
  State: "state",
  ZIP: "zip",
  Country: "country",

  Email: "email",

  "SO No": "soNo",
  "PO No": "poNo",
  "Payment Terms": "paymentTerms",

  "Item ID": "itemId",
  "Cust Part Num": "custPartNum",
  Description: "description",
  Remarks: "remarks",
  "BOL No": "bolNo",
  Qty: "qty",
  Unit: "unit",
  "Unit Price": "unitPrice",
  "Sales Tax %": "salesTaxPercent",
  "Discount Percent": "discountPercent",
  "Discount Amount": "discountAmount",
  Amount: "amount",

  "Sales Subtotal": "salesSubtotal",
  "Total Discount": "totalDiscount",
  "Total Charges": "totalCharges",
  "Net Amount": "netAmount",
  "Sales Tax": "salesTax",
  Total: "total",
  "Payments Credit": "paymentsCredit",
  "Balance Due": "balanceDue",

  "Bank Name": "bankName",
  "Account Number": "accountNumber",
  "SWIFT Code": "swiftCode",
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

export function buildStructuredUsSalesInvoicePrompt(_schema: SchemaRow[]): string {
  return `You are a precision extractor for US Sales Invoice PDFs (commercial / customer-facing invoices issued in the United States).

OUTPUT RULES (critical):
1. Respond with one JSON object only (no markdown fences).
2. Top-level keys must include "source": "Gemini" and "documentType": "US Sales Invoice". (Note: the nested invoiceDetails.documentType field captures the document-type LABEL printed on the invoice itself — e.g. "Commercial Invoice" — separate from the top-level documentType which is always "US Sales Invoice".)
3. Leaf values must be string or null only.
4. Use exact JSON keys from the template and section mapping.
5. Copy values exactly as printed when present (preserve currency symbols like "$", percent signs, units, and decimals as shown).
6. If a field is not visible anywhere in the PDF, set it to null. Do NOT guess, infer, or default to "0" / "0.00".
7. Do not invent values, expand abbreviations, or fabricate missing text.
8. Keep invoice numbers, PO numbers, SO numbers, BOL numbers, item IDs, and bank/account/SWIFT codes exactly as printed.
9. Keep dates as printed; downstream normalization handles format alignment.
10. SCAN ALL PAGES: Fields may appear on any page — headers, footers, body, sidebars, watermarks.
11. POSITION-AGNOSTIC labels: match semantically equivalent labels (e.g. "Inv #" = "Invoice No", "Customer PO" = "PO No", "Order #" / "Sales Order #" = "SO No", "Sold To" / "Bill To" = "Bill To", "Ship To" / "Deliver To" / "Consignee" = "Ship To", "Sub Total" = "Sales Subtotal", "Tax" = "Sales Tax", "Total Due" / "Amount Due" / "Invoice Total" = "Total", "Payments" / "Credits Applied" = "Payments Credit", "Remit To" / vendor letterhead = "Seller").

ADDRESS PARSING RULES:
12. For Seller Address and Ship To address blocks, SPLIT the printed multi-line address into the structured fields (Street, City, State, ZIP, Country). Do NOT dump the whole address into Street.
    - Street = full street line (street number + name; combine suite/unit on the same field only if not on its own labeled row).
    - City = city only.
    - State = US state abbreviation or full state name as printed (e.g. "TX", "Texas").
    - ZIP = ZIP code (5-digit or ZIP+4) exactly as printed.
    - Country = country as printed; if the address is clearly US (state + ZIP) and no country is printed, output "USA".
13. NEVER duplicate the company name into Street.
14. The "Bill To" section in this schema captures ONLY the Bill-To Email. If the document prints a separate Bill-To address that differs from Ship To, do NOT try to force it into other fields — just capture the email here. The Ship-To address goes into Ship To.

REFERENCE FIELD DISAMBIGUATION:
15. "PO No" (poNo) = the CUSTOMER'S purchase order number. Map labels: "PO", "PO #", "PO No", "PO Number", "Purchase Order", "Customer PO", "Cust PO", "Buyer PO".
16. "SO No" (soNo) = the SELLER'S sales / order number. Map labels: "SO", "SO #", "SO No", "Sales Order", "Sales Order #", "Order #", "Order Number", "Our Order #".
17. If only a single ambiguous "Order #" is printed, prefer mapping it to soNo unless context (e.g. "Customer Order") clearly identifies it as the buyer's PO.
18. DO NOT map Remarks / Notes / Memo / Description / Terms text to poNo or soNo.

LINE ITEMS RULES:
19. "lineItems" is a JSON ARRAY. Emit one object per line/row in the invoice's item table. Extract every row from every page; do not stop after page 1 or after a partial table.
20. Per-line fields:
    - itemId = the seller's SKU / item code / part number column.
    - custPartNum = the customer-side part number column (often "Cust Part #", "Customer Part No", "Buyer Part #"). Set null if the table has no such column.
    - description = product description / item description column.
    - remarks = any per-line remark, note, or comment shown beneath or beside the line. Set null when none.
    - bolNo = per-line BOL / Bill of Lading number if the table prints one per row. Set null when none.
    - qty = quantity shipped/invoiced for the line.
    - unit = unit of measure (EA, PCS, LBS, FT, KG, etc.). Set null when not shown.
    - unitPrice = unit price exactly as printed (keep currency symbol if shown).
    - salesTaxPercent = per-line sales tax percent (e.g. "8.25%"). Set null when not shown per line.
    - discountPercent = per-line discount percent. Set null when not shown.
    - discountAmount = per-line discount amount. Set null when not shown.
    - amount = line total / extended price exactly as printed.
21. If the invoice has no item table at all, return lineItems as an empty array [].
22. Do NOT roll line-total numbers up into Totals — Totals fields come from the dedicated totals/summary block at the bottom of the invoice.

TOTALS / PAYMENT RULES:
23. Money fields ("Sales Subtotal", "Total Discount", "Total Charges", "Net Amount", "Sales Tax", "Total", "Payments Credit", "Balance Due"): copy the amount EXACTLY as printed including currency symbol if shown. If a field is not printed on the invoice (e.g. no discount row), set it to null — do NOT default to "0" or "0.00".
24. "Total" is the invoice grand total / total due (often labeled "Total", "Invoice Total", "Total Due", "Amount Due"). "Balance Due" is what remains after "Payments Credit" — if no payments are shown, Balance Due usually equals Total.
25. "Bank Name" / "Account Number" / "SWIFT Code" fields belong to the Payment Instructions / Remit-To / Wire Instructions block. Do NOT confuse the seller's general letterhead address with banking details.

SECTION MAPPING:`;
}
