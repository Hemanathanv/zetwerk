"""
camelot_structure.py
────────────────────
Camelot + PyMuPDF based PDF extraction for all 15 Zetwerk OCR document types.

Accuracy strategy (no LLM):
  1. Comprehensive label-alias search — every field has 5-15 alternate labels
     matching how different PDFs actually print them.
  2. Spatial KV extraction — PyMuPDF word positions find values to the right of
     or below a label, handling layouts where regex alone fails.
  3. Regex KV (3 patterns) as fallback.
  4. Camelot table extraction for array sections with alias-aware column matching.
  5. Rejects pipeline — strips unit suffixes, currency symbols, noise values,
     label-echo, format validators (GSTIN, PAN, IFSC, HSN, container number).
  6. Same dotted camelCase column keys and align_df_to_template_columns() call
     as the Gemini OCR pipeline — output columns are identical to the template.
"""

from __future__ import annotations

import contextlib
import contextvars
import hashlib as _hashlib
import json
import os
import re
import sys as _sys
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd


def _missing_dep(name: str) -> str:
    return (
        f"{name} not found in the active Python environment.\n"
        f"  Active interpreter: {_sys.executable}\n"
        f"  Run from Backend: uv sync && uv run python {Path(__file__).name} ...\n"
        f"  Or activate: source .venv/Scripts/activate (bash) / .venv\\Scripts\\activate.bat (cmd)\n"
        f"  If 'uv run' picks wrong interpreter, unset VIRTUAL_ENV first or call\n"
        f"  .venv/Scripts/python.exe directly."
    )


try:
    import fitz  # PyMuPDF
except ImportError as exc:
    raise SystemExit(_missing_dep("PyMuPDF (pymupdf)")) from exc

try:
    import camelot
except ImportError as exc:
    raise SystemExit(_missing_dep("camelot-py")) from exc

from structured_ocr import (
    align_df_to_template_columns,
    extract_ts_map,
    flatten_record,
    to_camel,
    to_snake,
    tokenize_label,
)

# ── Paths ─────────────────────────────────────────────────────────────────────
BACKEND_DIR = Path(__file__).resolve().parent


# ── Per-doc-type config ───────────────────────────────────────────────────────
DOC_TYPE_CONFIG: dict[str, dict] = {
    "Bill of Lading": {
        "schema_path":     "data/schemas/bill-of-lading.json",
        "prompt_ts":       "src/prompts/bill-of-lading-structured-prompt.ts",
        "section_map_var": "SECTION_JSON_KEY",
        "field_map_var":   None,
        "key_style":       "snake",
        "array_sections":  ["Export Invoices", "Shipping Bills", "Containers"],
        "expand_array_key": "invoices",
        # Template uses "Export Invoice - Invoice Number" (prefix "export_invoice"),
        # not "invoices.*".  We must use this prefix when building the main-sheet rows.
        "expand_prefix":   "export_invoice",
        "template_sheet":  "Bill of Lading",
        "secondary_template_sheets": {
            "containers":     "BOL - Containers",
            "invoices":       "BOL - Invoices",
            "shipping_bills": "BOL - Shipping Bills",
        },
        "include_expand_in_secondary": True,
    },
    "Entry Summary": {
        "schema_path":     "data/schemas/entry-summary.json",
        "prompt_ts":       "src/prompts/entry-summary-structured-prompt.ts",
        "section_map_var": None,
        "field_map_var":   "CANONICAL_JSON_KEY_BY_FIELD_NAME",
        "key_style":       "camel",
        "array_sections":  ["Line Items"],
        "expand_array_key": "lineItems",
        "template_sheet":  "Entry Summary",
    },
    "Entry Summary Tariff Lines": {
        "schema_path":     "data/schemas/entry-summary-tariff-lines.json",
        "prompt_ts":       "src/prompts/entry-summary-structured-prompt.ts",
        "section_map_var": None,
        "field_map_var":   "CANONICAL_JSON_KEY_BY_FIELD_NAME",
        "key_style":       "camel",
        "array_sections":  ["Tariff Line"],
        "expand_array_key": "tariffLine",
        "template_sheet":  "Entry Summary Tariff Lines",
    },
    "Steel Supplier Declaration": {
        "schema_path":     "data/schemas/ssd.json",
        "prompt_ts":       "src/prompts/ssd-structured-prompt.ts",
        "section_map_var": None,
        "field_map_var":   "CANONICAL_JSON_KEY_BY_FIELD_NAME",
        "key_style":       "camel",
        "array_sections":  ["Products", "Reference Invoices"],
        "expand_array_key": "products",
        "template_sheet":  "Steel Supplier Declaration",
        "secondary_template_sheets": {
            "referenceInvoices": "SSD Reference Invoices",
        },
    },
    "Delivery Deduction Sheet": {
        "schema_path":     "data/schemas/dds.json",
        "prompt_ts":       "src/prompts/dds-structured-prompt.ts",
        "section_map_var": None,
        "field_map_var":   "CANONICAL_JSON_KEY",
        "key_style":       "camel",
        "array_sections":  ["Reference Invoices"],
        "expand_array_key": "referenceInvoices",
        "template_sheet":  "Delivery Deduction Sheet",
    },
    "Ocean Freight": {
        "schema_path":     "data/schemas/ocean-freight.json",
        "prompt_ts":       "src/prompts/ocean-freight-structured-prompt.ts",
        "section_map_var": "SECTION_JSON_KEY",
        "field_map_var":   "FIELD_JSON_KEY",
        "key_style":       "camel",
        "array_sections":  ["Charges", "Containers", "Tax Summary"],
        "expand_array_key": "charges",
        "template_sheet":  "Ocean Freight Invoice",
    },
    "Packing List": {
        "schema_path":     "data/schemas/packing-list.json",
        "prompt_ts":       "src/prompts/packing-list-structured-prompt.ts",
        "section_map_var": None,
        "field_map_var":   "CANONICAL_JSON_KEY_BY_FIELD_NAME",
        "key_style":       "camel",
        "array_sections":  ["Line Items"],
        "expand_array_key": "lineItems",
        "template_sheet":  "Packing Lists",
    },
    "Sales Invoices": {
        "schema_path":     "data/schemas/sales-invoice.json",
        "prompt_ts":       "src/prompts/sales-invoice-structured-prompt.ts",
        "section_map_var": None,
        "field_map_var":   "CANONICAL_JSON_KEY_BY_FIELD_NAME",
        "key_style":       "camel",
        "array_sections":  ["Line Items"],
        "expand_array_key": "lineItems",
        "template_sheet":  "Sales Invoices",
    },
    "Freight Forwarder Bill": {
        "schema_path":     "data/schemas/freight-forwarder-bill.json",
        "prompt_ts":       "src/prompts/freight-forwarder-bill-structured-prompt.ts",
        "section_map_var": "SECTION_JSON_KEY",
        "field_map_var":   "FIELD_JSON_KEY",
        "key_style":       "camel",
        "array_sections":  ["Charges", "Containers", "Tax Summary"],
        "expand_array_key": "charges",
        "template_sheet":  "Freight Forwarder Bill",
    },
    "US Cargo Release Order": {
        "schema_path":     "data/schemas/us-cargo-release.json",
        "prompt_ts":       "src/prompts/us-cargo-release-structured-prompt.ts",
        "section_map_var": None,
        "field_map_var":   "CANONICAL_JSON_KEY_BY_FIELD_NAME",
        "key_style":       "camel",
        "array_sections":  [],
        "expand_array_key": None,
        "template_sheet":  "US CARGO RELEASE",
    },
    "US Customs Release Order": {
        "schema_path":     "data/schemas/us-custom-release.json",
        "prompt_ts":       "src/prompts/us-custom-release-structured-prompt.ts",
        "section_map_var": None,
        "field_map_var":   "CANONICAL_JSON_KEY_BY_FIELD_NAME",
        "key_style":       "camel",
        "array_sections":  [],
        "expand_array_key": None,
        "template_sheet":  "US CUSTOM RELEASE",
    },
    "US Delivery Order": {
        "schema_path":     "data/schemas/us-delivery-order.json",
        "prompt_ts":       "src/prompts/us-delivery-order-structured-prompt.ts",
        "section_map_var": None,
        "field_map_var":   "CANONICAL_JSON_KEY_BY_FIELD_NAME",
        "key_style":       "camel",
        "array_sections":  [],
        "expand_array_key": None,
        "template_sheet":  "US DELIVERY ORDER",
    },
    "US Packing List": {
        "schema_path":     "data/schemas/us-packing-list.json",
        "prompt_ts":       "src/prompts/us-packing-list-structured-prompt.ts",
        "section_map_var": None,
        "field_map_var":   "CANONICAL_JSON_KEY_BY_FIELD_NAME",
        "key_style":       "camel",
        "array_sections":  [],
        "expand_array_key": None,
        "template_sheet":  "US PACKING LIST",
    },
    "Shipping Bill": {
        "schema_path":     None,
        "prompt_ts":       "src/prompts/shipping-bill-structured-prompt.ts",
        "section_map_var": None,
        "field_map_var":   None,
        "key_style":       "camel",
        "array_sections":  [],
        "expand_array_key": None,
        "template_sheet":  "Shipping bill",    # exact sheet name in the workbook
    },
    "CHA": {
        "schema_path":     None,
        "prompt_ts":       None,
        "section_map_var": None,
        "field_map_var":   None,
        "key_style":       "camel",
        "array_sections":  ["Charges", "Tax Summary"],
        "expand_array_key": None,    # template stores charges/taxSummary as JSON strings
        "template_sheet":  "CHA",
    },
}

OUTPUT_SHEET_NAMES: dict[str, str] = {
    dt: cfg["template_sheet"] or dt for dt, cfg in DOC_TYPE_CONFIG.items()
}
DOC_TITLES: list[str] = sorted(DOC_TYPE_CONFIG.keys())


_PRODUCT_CODE_PATTERN = re.compile(r"\b[A-Z]{1,4}(?:\.[A-Z0-9]+){3,}\b")
_SPEC_DIMENSION_PATTERN = re.compile(
    r"\b[WHDL]\s*\d+(?:\.\d+)?\s*[Xx]\s*\d+(?:\.\d+)?\b"
)
_SPEC_MARKER_PATTERN = re.compile(
    r"(?:^|,\s*)(HDG|GALV(?:ANIZED)?|GRADE|ASTM|OREGON|SATURN|COATED|PAINTED)\b",
    re.IGNORECASE,
)
_PACKAGE_LINE_PATTERN = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:PKG|PKGS|PACKAGE|PACKAGES|PCS|PC|BUNDLE|BUNDLES|CTN|CTNS|CARTON|CARTONS|BOX|BOXES|PALLET|PALLETS|NOS)\b",
    re.IGNORECASE,
)
_CODE_LIKE_LINE_PATTERN = re.compile(r"^[A-Z]{2,6}\s*-\s*[A-Z0-9][A-Z0-9\s/-]*$")
_BOL_INV_RAW_RE = re.compile(
    r"INV(?:OICE)?\s*NO[.:\s]+([A-Z0-9][A-Z0-9/\-\.]+)\s+(?:DT|DATE)[.:\s]+([^\n,;]+)",
    re.IGNORECASE,
)
_BOL_SB_RAW_RE = re.compile(
    r"S/?B\s*NO[.:\s]+([A-Z0-9][A-Z0-9/\-\.]+)(?:\s+(?:DT|DATE)[.:\s]+([^\n,;]+))?",
    re.IGNORECASE,
)
_HEADER_BLOB_HINTS = (
    "invoice no",
    "invoice date",
    "buyers order",
    "country of origin",
    "country of final destination",
    "port of loading",
    "port of discharge",
    "total qty",
    "net weight",
    "gross weight",
    "no. & kind of pkgs",
    "description of goods",
)


# ── Inline schemas ────────────────────────────────────────────────────────────
# Section names are chosen to produce camelCase keys that suffix-match the
# template workbook column names (e.g. section "Metadata" + field "Port Code"
# → key "metadata.portCode" → normalises to "metadataportcode" which exactly
# matches template column "Metadata - Port Code" after normalisation).
_SHIPPING_BILL_SCHEMA: list[dict] = [
    # ── Part I — Metadata (header summary) ───────────────────────────────────
    {"section": "Metadata", "fieldName": "Port Code"},
    {"section": "Metadata", "fieldName": "Port Name"},
    {"section": "Metadata", "fieldName": "SB No"},
    {"section": "Metadata", "fieldName": "SB Date"},
    {"section": "Metadata", "fieldName": "IEC Br"},
    {"section": "Metadata", "fieldName": "GSTIN Type"},
    {"section": "Metadata", "fieldName": "CB Code"},
    {"section": "Metadata", "fieldName": "Inv Count"},
    {"section": "Metadata", "fieldName": "Item Count"},
    {"section": "Metadata", "fieldName": "Cont Count"},
    {"section": "Metadata", "fieldName": "Pkg Count"},
    {"section": "Metadata", "fieldName": "Gross Weight Kgs"},
    {"section": "Metadata", "fieldName": "Leo No"},
    {"section": "Metadata", "fieldName": "Leo Date"},
    {"section": "Metadata", "fieldName": "Brc Realisation Date"},
    {"section": "Metadata", "fieldName": "Rotn No Date"},
    {"section": "Metadata", "fieldName": "Vessel Name"},
    {"section": "Metadata", "fieldName": "Sez Unit Details"},
    # ── Part I — Section A Status ─────────────────────────────────────────────
    {"section": "Section A Status", "fieldName": "Mode"},
    {"section": "Section A Status", "fieldName": "Assess"},
    {"section": "Section A Status", "fieldName": "Exmn"},
    {"section": "Section A Status", "fieldName": "Jobbing"},
    {"section": "Section A Status", "fieldName": "Meis"},
    {"section": "Section A Status", "fieldName": "DBK"},
    {"section": "Section A Status", "fieldName": "Rodtp"},
    {"section": "Section A Status", "fieldName": "Licence"},
    {"section": "Section A Status", "fieldName": "Dfrc"},
    {"section": "Section A Status", "fieldName": "Re Exp"},
    {"section": "Section A Status", "fieldName": "LUT"},
    {"section": "Section A Status", "fieldName": "Port Of Loading"},
    {"section": "Section A Status", "fieldName": "State Of Origin"},
    {"section": "Section A Status", "fieldName": "Port Of Discharge"},
    {"section": "Section A Status", "fieldName": "Country Of Final Destination"},
    {"section": "Section A Status", "fieldName": "Port Of Final Destination"},
    {"section": "Section A Status", "fieldName": "Country Of Discharge"},
    # ── Part I — Section B Declarant ─────────────────────────────────────────
    {"section": "Section B Declarant", "fieldName": "Exporter Name And Address"},
    {"section": "Section B Declarant", "fieldName": "Type"},
    {"section": "Section B Declarant", "fieldName": "AD Code"},
    {"section": "Section B Declarant", "fieldName": "Rbi Waiver No And Dt"},
    {"section": "Section B Declarant", "fieldName": "CB Name"},
    {"section": "Section B Declarant", "fieldName": "AEO"},
    {"section": "Section B Declarant", "fieldName": "Consignee Name And Address"},
    {"section": "Section B Declarant", "fieldName": "GSTIN Type"},
    {"section": "Section B Declarant", "fieldName": "Forex Bank Ac No"},
    {"section": "Section B Declarant", "fieldName": "DBK Bank Ac No"},
    {"section": "Section B Declarant", "fieldName": "Ifsc No"},
    # ── Part I — Section C Value Summary ─────────────────────────────────────
    {"section": "Section C Value Summary", "fieldName": "FOB Value"},
    {"section": "Section C Value Summary", "fieldName": "Freight"},
    {"section": "Section C Value Summary", "fieldName": "Insurance"},
    {"section": "Section C Value Summary", "fieldName": "Discount"},
    {"section": "Section C Value Summary", "fieldName": "Commission"},
    {"section": "Section C Value Summary", "fieldName": "Deductions"},
    {"section": "Section C Value Summary", "fieldName": "Pc"},
    {"section": "Section C Value Summary", "fieldName": "Duty"},
    {"section": "Section C Value Summary", "fieldName": "Cess"},
    {"section": "Section C Value Summary", "fieldName": "Packing Charges"},
    {"section": "Section C Value Summary", "fieldName": "DBK Claim"},
    {"section": "Section C Value Summary", "fieldName": "IGST Amt"},
    {"section": "Section C Value Summary", "fieldName": "Cess Amt"},
    {"section": "Section C Value Summary", "fieldName": "IGST Value"},
    {"section": "Section C Value Summary", "fieldName": "RoDTEP Amt"},
    {"section": "Section C Value Summary", "fieldName": "Rosctl Amt"},
    # ── Part I — Section D Export Promotion ──────────────────────────────────
    {"section": "Section D Export Promotion", "fieldName": "DBK Claim"},
    {"section": "Section D Export Promotion", "fieldName": "IGST Amt"},
    {"section": "Section D Export Promotion", "fieldName": "Cess Amt"},
    {"section": "Section D Export Promotion", "fieldName": "IGST Value"},
    {"section": "Section D Export Promotion", "fieldName": "RoDTEP Amt"},
    {"section": "Section D Export Promotion", "fieldName": "Rosctl Amt"},
    # ── Part II — Section B Transaction Parties ───────────────────────────────
    {"section": "Section B Transaction Parties", "fieldName": "Exporter Name And Address"},
    {"section": "Section B Transaction Parties", "fieldName": "Buyer Name And Address"},
    {"section": "Section B Transaction Parties", "fieldName": "Third Party Name And Address"},
    {"section": "Section B Transaction Parties", "fieldName": "Buyer AEO Status"},
    # ── Part II — Invoice Ref (Section A) ────────────────────────────────────
    {"section": "Invoice Ref", "fieldName": "Sno"},
    {"section": "Invoice Ref", "fieldName": "Invoice No And Date"},
    {"section": "Invoice Ref", "fieldName": "PO No And Date"},
    {"section": "Invoice Ref", "fieldName": "Loc No And Date"},
    {"section": "Invoice Ref", "fieldName": "Contract No And Date"},
    {"section": "Invoice Ref", "fieldName": "AD Code"},
    {"section": "Invoice Ref", "fieldName": "Invterm"},
    # ── Part II — Valuation (Section C) ──────────────────────────────────────
    {"section": "Valuation", "fieldName": "Invoice Value"},
    {"section": "Valuation", "fieldName": "FOB Value"},
    {"section": "Valuation", "fieldName": "Freight"},
    {"section": "Valuation", "fieldName": "Insurance"},
    {"section": "Valuation", "fieldName": "Discounts"},
    {"section": "Valuation", "fieldName": "Commission"},
    {"section": "Valuation", "fieldName": "Deduct"},
    {"section": "Valuation", "fieldName": "Pc"},
    {"section": "Valuation", "fieldName": "Exchange Rate"},
    # ── Part III — Items ──────────────────────────────────────────────────────
    {"section": "Items", "fieldName": "Invsn"},
    {"section": "Items", "fieldName": "Itemsn"},
    {"section": "Items", "fieldName": "HS Cd"},
    {"section": "Items", "fieldName": "Description"},
    {"section": "Items", "fieldName": "Quantity"},
    {"section": "Items", "fieldName": "UQC"},
    {"section": "Items", "fieldName": "Rate"},
    {"section": "Items", "fieldName": "Value Fc"},
    {"section": "Items", "fieldName": "FOB Inr"},
    {"section": "Items", "fieldName": "Pmv"},
    {"section": "Items", "fieldName": "Duty Amt"},
    {"section": "Items", "fieldName": "Cess Rt"},
    {"section": "Items", "fieldName": "Ces Amt"},
    {"section": "Items", "fieldName": "Dbkclmd"},
    {"section": "Items", "fieldName": "IGST Stat"},
    {"section": "Items", "fieldName": "IGST Value"},
    {"section": "Items", "fieldName": "IGST Amount"},
    {"section": "Items", "fieldName": "Schcod"},
    {"section": "Items", "fieldName": "Scheme Description"},
    {"section": "Items", "fieldName": "Sqc Msr"},
    {"section": "Items", "fieldName": "Sqc UQC"},
    {"section": "Items", "fieldName": "State Of Origin"},
    {"section": "Items", "fieldName": "District Of Origin"},
    {"section": "Items", "fieldName": "Pt Abroad"},
    {"section": "Items", "fieldName": "Fta Benefit Availed"},
    {"section": "Items", "fieldName": "Reward Benefit"},
    {"section": "Items", "fieldName": "Third Party Item"},
]

_CHA_SCHEMA: list[dict] = [
    # ── Issuer (key: "issuer") ─────────────────────────────────────────────────
    # Field names produce keys that exactly match "issuer.<field_snake>" in template.
    {"section": "Issuer", "fieldName": "Company Name"},
    {"section": "Issuer", "fieldName": "Address"},          # was "Company Address" → issuer.address ✓
    {"section": "Issuer", "fieldName": "CIN"},
    {"section": "Issuer", "fieldName": "PAN"},
    {"section": "Issuer", "fieldName": "GSTIN"},
    {"section": "Issuer", "fieldName": "Phone"},
    {"section": "Issuer", "fieldName": "Email"},
    {"section": "Issuer", "fieldName": "Website"},
    {"section": "Issuer", "fieldName": "MSME Udyam"},
    {"section": "Issuer", "fieldName": "State Code"},
    # ── Invoice Identification (key: "invoiceIdentification") ─────────────────
    # Section prefix stripped by suffix-match → flat template columns like
    # "document_type", "invoice_number" etc. are matched correctly.
    {"section": "Invoice Identification", "fieldName": "Document Type"},
    {"section": "Invoice Identification", "fieldName": "Tax Type"},
    {"section": "Invoice Identification", "fieldName": "Document Title"},
    {"section": "Invoice Identification", "fieldName": "Invoice Number"},
    {"section": "Invoice Identification", "fieldName": "Invoice Date"},
    {"section": "Invoice Identification", "fieldName": "Due Date"},
    {"section": "Invoice Identification", "fieldName": "Payment Terms"},
    {"section": "Invoice Identification", "fieldName": "Copy Type"},
    {"section": "Invoice Identification", "fieldName": "IRN"},
    {"section": "Invoice Identification", "fieldName": "IRN Ack Number"},   # was "IRN Acknowledgement Number"
    {"section": "Invoice Identification", "fieldName": "IRN Ack Time"},     # was "IRN Acknowledgement Time"
    # ── Customer (key: "customer") ─────────────────────────────────────────────
    {"section": "Customer", "fieldName": "Name"},            # was "Customer Name" → customer.name ✓
    {"section": "Customer", "fieldName": "Address"},         # was "Customer Address" → customer.address ✓
    {"section": "Customer", "fieldName": "GSTIN"},           # was "Customer GSTIN" → customer.gstin ✓
    {"section": "Customer", "fieldName": "PAN"},             # was "Customer PAN" → customer.pan ✓
    {"section": "Customer", "fieldName": "Customer Id"},
    {"section": "Customer", "fieldName": "State Code"},
    {"section": "Customer", "fieldName": "State Of Supply"},
    {"section": "Customer", "fieldName": "Place Of Supply"},
    {"section": "Customer", "fieldName": "Reverse Charge"},
    {"section": "Customer", "fieldName": "Shipment Number"},
    # ── Shipment (key: "shipment") ─────────────────────────────────────────────
    {"section": "Shipment", "fieldName": "Shipper"},         # was "Consignor Name" → shipment.shipper ✓
    {"section": "Shipment", "fieldName": "Shipper Address"},
    {"section": "Shipment", "fieldName": "Consignee"},       # was "Consignee Name" → shipment.consignee ✓
    {"section": "Shipment", "fieldName": "Consignee Address"},
    {"section": "Shipment", "fieldName": "Order Reference"},
    {"section": "Shipment", "fieldName": "Incoterm"},
    {"section": "Shipment", "fieldName": "Goods Description"},
    {"section": "Shipment", "fieldName": "Commodity Note"},
    {"section": "Shipment", "fieldName": "Gross Weight"},
    {"section": "Shipment", "fieldName": "Gross Weight Unit"},
    {"section": "Shipment", "fieldName": "Volume"},
    {"section": "Shipment", "fieldName": "Chargeable Weight"},
    {"section": "Shipment", "fieldName": "Packages"},
    {"section": "Shipment", "fieldName": "Vessel Voyage IMO"},
    {"section": "Shipment", "fieldName": "Vessel Name"},
    {"section": "Shipment", "fieldName": "MBL"},
    {"section": "Shipment", "fieldName": "HBL"},
    {"section": "Shipment", "fieldName": "Import Customs Broker"},
    {"section": "Shipment", "fieldName": "Origin"},
    {"section": "Shipment", "fieldName": "ETD"},
    {"section": "Shipment", "fieldName": "Destination"},
    {"section": "Shipment", "fieldName": "ETA"},
    # ── Job (key: "job") ───────────────────────────────────────────────────────
    {"section": "Job", "fieldName": "Number"},
    {"section": "Job", "fieldName": "Date"},
    {"section": "Job", "fieldName": "Doc Number"},
    {"section": "Job", "fieldName": "Pol Pod"},
    {"section": "Job", "fieldName": "Project Name"},
    {"section": "Job", "fieldName": "Prepared By"},
    {"section": "Job", "fieldName": "Approved By"},
    # ── Charges (array section — key: "charges") ───────────────────────────────
    {"section": "Charges", "fieldName": "Charge Description"},
    {"section": "Charges", "fieldName": "SAC HSN Code"},
    {"section": "Charges", "fieldName": "Quantity"},
    {"section": "Charges", "fieldName": "Rate"},
    {"section": "Charges", "fieldName": "Currency"},
    {"section": "Charges", "fieldName": "Taxable Amount"},
    {"section": "Charges", "fieldName": "IGST Rate"},
    {"section": "Charges", "fieldName": "IGST Amount"},
    {"section": "Charges", "fieldName": "CGST Rate"},
    {"section": "Charges", "fieldName": "CGST Amount"},
    {"section": "Charges", "fieldName": "SGST Rate"},
    {"section": "Charges", "fieldName": "SGST Amount"},
    {"section": "Charges", "fieldName": "Total Amount"},
    # ── Tax Summary (array section — key: "taxSummary") ────────────────────────
    {"section": "Tax Summary", "fieldName": "HSN SAC Code"},
    {"section": "Tax Summary", "fieldName": "Taxable Amount"},
    {"section": "Tax Summary", "fieldName": "Tax Rate"},
    {"section": "Tax Summary", "fieldName": "IGST Amount"},
    {"section": "Tax Summary", "fieldName": "CGST Amount"},
    {"section": "Tax Summary", "fieldName": "SGST Amount"},
    {"section": "Tax Summary", "fieldName": "Total Tax Amount"},
    # ── Totals (key: "totals") ─────────────────────────────────────────────────
    {"section": "Totals", "fieldName": "Subtotal"},          # was "Subtotal INR" → totals.subtotal ✓
    {"section": "Totals", "fieldName": "IGST Amount"},       # was "IGST Total" → totals.igstAmount ✓
    {"section": "Totals", "fieldName": "CGST Amount"},       # was "CGST Total" → totals.cgstAmount ✓
    {"section": "Totals", "fieldName": "SGST Amount"},       # was "SGST Total" → totals.sgstAmount ✓
    {"section": "Totals", "fieldName": "Grand Total INR"},
    {"section": "Totals", "fieldName": "Invoice Amount Page2"},
    {"section": "Totals", "fieldName": "Amount In Words"},
    {"section": "Totals", "fieldName": "Net Amount"},
    # ── Bank Details (key: "bankDetails") ─────────────────────────────────────
    # Template stores these as a single JSON object under "bank_details";
    # scalar keys like "bankDetails.bankName" are captured but won't align to
    # the single "bank_details" template column — they remain as extra columns.
    {"section": "Bank Details", "fieldName": "Bank Name"},
    {"section": "Bank Details", "fieldName": "Account Number"},
    {"section": "Bank Details", "fieldName": "IFSC Code"},
    {"section": "Bank Details", "fieldName": "Swift Code"},
    {"section": "Bank Details", "fieldName": "Branch Address"},
    # ── QR Code (key: "qrCode") ────────────────────────────────────────────────
    # "QR Code" → camelCase "qrCode" → matches "qr_code.*" template columns ✓
    {"section": "QR Code", "fieldName": "Raw JWT"},
    {"section": "QR Code", "fieldName": "Issuer"},
    {"section": "QR Code", "fieldName": "Seller GSTIN"},
    {"section": "QR Code", "fieldName": "Buyer GSTIN"},
    {"section": "QR Code", "fieldName": "Doc No"},
    {"section": "QR Code", "fieldName": "Doc Type"},
    {"section": "QR Code", "fieldName": "Doc Date"},
    {"section": "QR Code", "fieldName": "Total Inv Value"},
    {"section": "QR Code", "fieldName": "Item Count"},
    {"section": "QR Code", "fieldName": "Main HSN Code"},
    {"section": "QR Code", "fieldName": "IRN"},
    {"section": "QR Code", "fieldName": "IRN Date"},
    {"section": "QR Code", "fieldName": "Signature Algorithm"},
    # ── Misc flat fields (key: "misc") ─────────────────────────────────────────
    # These produce "misc.<field>" keys; suffix-match catches flat template columns
    # like "booking_number", "remarks" etc.
    {"section": "Misc", "fieldName": "Booking Number"},
    {"section": "Misc", "fieldName": "Remarks"},
    {"section": "Misc", "fieldName": "LUT Bond Reference"},
]


# ── Schema loading ────────────────────────────────────────────────────────────

def load_schema(doc_type: str) -> list[dict]:
    if doc_type == "Shipping Bill":
        return _SHIPPING_BILL_SCHEMA
    if doc_type == "CHA":
        return _CHA_SCHEMA
    cfg = DOC_TYPE_CONFIG.get(doc_type)
    if cfg is None:
        raise ValueError(f"Unknown doc type: {doc_type!r}")
    rel_path = cfg["schema_path"]
    if rel_path is None:
        return []
    full_path = BACKEND_DIR / rel_path
    if not full_path.exists():
        raise FileNotFoundError(f"Schema not found: {full_path}")
    data = json.loads(full_path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("rows") or data.get("fields") or []
    return []


# ── Label aliases (high-accuracy field name matching) ─────────────────────────
# Each entry maps a lowercase canonical field name to the list of label strings
# that real PDFs print. Longer/more specific aliases are checked first so "po no"
# does not accidentally match a field labelled only "no".
#
# Used by _get_field_aliases() → find_kv_multi() for scalar KV extraction and
# by _alias_norm_set() in find_best_table() for table column matching.

FIELD_LABEL_ALIASES: dict[str, list[str]] = {
    # ── Invoice identification ───────────────────────────────────────────────
    "invoice no":            ["invoice no", "invoice number", "invoice #", "invoice no.",
                              "inv no", "inv. no", "inv. no.", "tax invoice no",
                              "commercial invoice no", "invoice ref no", "tax invoice number",
                              "proforma invoice no", "proforma invoice number"],
    "invoice number":        ["invoice no", "invoice number", "invoice #", "inv no",
                              "tax invoice no", "commercial invoice no"],
    "invoice date":          ["invoice date", "invoice dt", "inv date", "inv. date",
                              "date", "dated", "date of invoice", "billing date",
                              "issue date"],
    "buyer po no":           ["buyer po no", "buyer po number", "buyer's po no",
                              "buyer's po number", "buyer order no", "buyer's order no",
                              "po no", "po number", "p.o. no", "p.o. number",
                              "purchase order no", "purchase order number",
                              "order no", "order number"],
    "buyer po date":         ["buyer po date", "buyer's po date", "buyer order date",
                              "buyer's order date", "po date", "purchase order date",
                              "order date"],
    "zetwerk ref":           ["zetwerk ref", "zetwerk ref#", "zetwerk reference",
                              "our ref", "our ref no", "our reference",
                              "exporter ref", "exporter's ref", "exporter reference",
                              "seller ref", "reference no", "ref no"],
    "other references":      ["other references", "other reference", "other ref",
                              "other ref no", "your ref"],
    "shipping bill no":      ["shipping bill no", "shipping bill number",
                              "s/b no", "sb no", "s.b. no", "export bill no",
                              "are no", "are-1 no"],
    "shipping bill date":    ["shipping bill date", "s/b date", "sb date",
                              "s.b. date"],
    "rotation no":           ["rotation no", "rotation number"],
    "lut arn no":            ["lut arn no", "lut/arn no", "lut no", "arn no",
                              "lut number", "arn number", "bond no", "lut/arn",
                              "lut ref no", "arn ref"],
    "invoice type":          ["invoice type", "type of invoice", "invoice type declaration",
                              "supply type", "export declaration type"],

    # ── Compliance ───────────────────────────────────────────────────────────
    "gstin":                 ["gstin", "gst no", "gst number", "gstin no",
                              "gstin no.", "gst registration no",
                              "gst registration number", "gst id", "gstin:"],
    "pan no":                ["pan no", "pan", "pan number", "pan no.",
                              "permanent account number", "pan/tan", "income tax pan"],
    "cin no":                ["cin no", "cin", "cin number", "cin no.",
                              "corporate identification number",
                              "corporate identification no"],
    "irn number":            ["irn number", "irn", "irn no", "irn no.",
                              "invoice reference number", "e-invoice irn",
                              "e-invoice reference"],
    "ad code":               ["ad code", "ad code no", "adcode", "ad bank code",
                              "ad code number"],
    "iec":                   ["iec", "iec#", "iec no", "iec code",
                              "importer exporter code", "iec number"],
    "irn acknowledgement number": ["irn ack no", "irn ack number",
                                   "irn acknowledgement no",
                                   "irn acknowledgement number", "ack no"],
    "irn acknowledgement time":   ["irn ack time", "irn acknowledgement time",
                                   "ack date", "ack datetime"],
    "signature":             ["authorised signatory", "authorized signatory",
                              "signature", "signed by", "for and on behalf of"],

    # ── Entities / parties ───────────────────────────────────────────────────
    "buyer name":            ["buyer", "buyer name", "bill to", "sold to",
                              "customer", "customer name", "importer",
                              "ship to", "consignee"],
    "buyer address":         ["buyer address", "buyer's address",
                              "bill to address", "sold to address",
                              "customer address"],
    "consignee name":        ["consignee", "consignee name", "ship to",
                              "deliver to", "delivery name"],
    "consignee address":     ["consignee address", "ship to address",
                              "delivery address"],
    "notify party":          ["notify party", "notify", "also notify",
                              "notify party name"],
    "exporter name":         ["exporter", "exporter name", "seller",
                              "seller name", "shipper", "supplier",
                              "manufacturer", "from", "company name",
                              "sold by"],
    "exporter address":      ["exporter address", "seller address",
                              "shipper address", "supplier address",
                              "company address"],
    "exporter email":        ["exporter email", "seller email", "email",
                              "e-mail", "email id"],
    "company name":          ["company name", "company", "name", "firm name",
                              "organisation name"],

    # ── Financial ────────────────────────────────────────────────────────────
    "bank name":             ["bank name", "bank", "banker", "our bankers",
                              "bankers", "name of bank"],
    "bank account no":       ["account no", "account number", "bank account no",
                              "bank account number", "a/c no", "a/c number",
                              "acct no", "bank a/c no", "bank a/c",
                              "bank a/c number"],
    "bank branch":           ["bank branch", "branch", "branch name",
                              "branch address", "bank branch name"],
    "ifsc code":             ["ifsc code", "ifsc", "ifsc no",
                              "rtgs/neft ifsc", "ifsc code no"],
    "swift code":            ["swift code", "swift", "swift/bic", "bic code",
                              "swift no"],
    "iban":                  ["iban", "iban number", "iban no"],
    "payment terms":         ["payment terms", "payment term",
                              "terms of payment", "terms", "payment condition",
                              "terms of payment:"],
    "total amount":          ["total amount", "grand total", "invoice total",
                              "total invoice amount", "total value",
                              "net amount", "total fob", "total cif",
                              "amount payable", "net payable",
                              "total fob value", "invoice value"],
    "currency":              ["currency", "invoice currency", "currency code",
                              "in currency", "ccy", "curr"],
    "incoterms":             ["incoterms", "inco terms", "trade terms",
                              "terms of delivery", "delivery terms"],
    "taxable value":         ["taxable value", "taxable amount",
                              "assessable value", "fob value"],
    "tax amount":            ["tax amount", "igst amount", "gst amount",
                              "total tax", "tax value"],

    # ── Shipment / routing ───────────────────────────────────────────────────
    "port of loading":       ["port of loading", "pol", "loading port",
                              "port of shipment", "port of lading",
                              "place of loading", "from port",
                              "place of receipt by pre-carrier",
                              "port of loading / icd of loading"],
    "port of discharge":     ["port of discharge", "pod", "discharge port",
                              "destination port", "port of destination",
                              "unloading port", "place of discharge",
                              "final port of discharge"],
    "final destination":     ["final destination", "destination",
                              "place of delivery", "delivery destination",
                              "place of final delivery"],
    "country of final destination": ["country of final destination",
                                     "country of destination",
                                     "destination country",
                                     "country of import"],
    "country of origin":     ["country of origin", "origin",
                              "origin country", "made in",
                              "country of manufacture", "country of production"],
    "vessel flight no":      ["vessel name", "vessel", "vessel/flight no",
                              "vessel/flight", "flight no", "flight number",
                              "carrier name", "ship name", "mv"],
    "vessel name":           ["vessel name", "vessel", "mv", "ship",
                              "ship name", "vessel/voyage"],
    "voyage number":         ["voyage no", "voyage number", "voyage",
                              "voy no", "voy. no"],
    "pre carriage by":       ["pre carriage by", "pre-carriage by",
                              "mode of transport", "transport mode",
                              "mode of conveyance"],
    "place of receipt":      ["place of receipt", "place of receipt by pre-carrier",
                              "pre-carriage place", "origin place"],
    "gross weight":          ["gross weight", "total weight", "gross wt",
                              "g.wt", "g. wt", "gross weight (kg)",
                              "total gross weight", "gw", "g.w."],
    "no of packages":        ["no of packages", "number of packages",
                              "packages", "pkgs", "cartons",
                              "total cartons", "total pkgs",
                              "no. of pkgs", "packages/cartons",
                              "no. of cartons", "total packages"],
    "package description":   ["package description", "kind of packages",
                              "no. & kind of pkgs", "kind of pkg",
                              "type of package", "packing", "kind of packing"],
    "marks and numbers":     ["marks and numbers", "marks & numbers",
                              "marks no", "shipping marks", "mark no",
                              "marks and nos", "marks & nos"],
    "etd":                   ["etd", "est. time of departure",
                              "estimated departure", "date of shipment",
                              "date (etd)", "etd date", "date of loading",
                              "sailing date", "departure date"],
    "eta":                   ["eta", "est. time of arrival",
                              "estimated arrival", "expected arrival",
                              "date (eta)", "eta date", "arrival date"],

    # ── Line item fields (matched against table column headers) ──────────────
    "hsn code":              ["hsn", "hsn code", "hsn/sac", "hs code",
                              "hts", "htsus", "tariff no", "tariff code",
                              "sac", "sac code", "customs tariff heading",
                              "cth", "hsn/sac code", "hs/tariff"],
    "product description":   ["description", "item description",
                              "product description", "goods description",
                              "particulars", "description of goods",
                              "commodity", "item name", "item",
                              "product name", "goods", "details"],
    "product code":          ["product code", "item code", "part no",
                              "part number", "sku", "material code",
                              "article no", "article code", "product ref",
                              "item no"],
    "product specification": ["specification", "product specification",
                              "spec", "technical spec", "grade",
                              "product spec"],
    "quantity":              ["qty", "quantity", "no of units", "nos",
                              "no.", "pcs", "pieces", "number",
                              "units", "amount (qty)", "qty."],
    "qty per bundle":        ["qty per bundle", "qty/bundle", "qty bundle",
                              "bundle qty", "per bundle qty", "pcs per bundle",
                              "bundle pcs", "nos per bundle", "bundle", "budle"],
    "no of bundles":         ["no of bundles", "number of bundles", "bundles",
                              "bundle count", "no. of bundles", "total bundles"],
    "total qty in pcs":      ["total qty in pcs", "total qty", "total pcs",
                              "pcs", "total pieces", "qty in pcs"],
    "unit":                  ["unit", "uom", "uom/unit", "unit of measure",
                              "units", "unit of measurement", "uqc"],
    "product marks":         ["product marks", "marks and numbers", "marks & numbers",
                              "marks & nos", "marks nos", "marks", "marking"],
    "kind of pkg":           ["kind of pkg", "kind of package", "package type",
                              "type of pkg", "pkg", "packing type"],
    "net weight kgs":        ["net weight kgs", "net weight", "net wt", "net kgs",
                              "n.w.", "nw"],
    "gross weight kgs":      ["gross weight kgs", "gross weight", "gross wt", "gross kgs",
                              "g.w.", "gw", "gr weight in kgs", "gr wt"],
    "rate":                  ["rate", "unit price", "price", "price per unit",
                              "basic price", "rate per unit", "unit rate",
                              "rate/unit", "fob unit price", "fob rate"],
    "line total":            ["amount", "total", "line total", "value",
                              "item amount", "line amount", "net amount",
                              "total amount", "ext. amount", "line value",
                              "fob value", "invoice value"],
    "tax rate":              ["tax rate", "gst rate", "igst rate",
                              "rate of tax", "tax %", "tax percent", "igst%",
                              "tax rate %", "cgst%", "sgst%"],
    "tax amount per line":   ["tax amount", "igst amount", "tax value",
                              "tax amount per line", "gst amount"],
    "no of packages (line)": ["no of packages", "packages", "cartons",
                              "pkgs", "no. of pkgs"],
    "kind of pkg":           ["kind of pkg", "kind of package",
                              "package type", "type of pkg"],
    "container no":          ["container no", "container number",
                              "container", "cntr no"],
    "seal no":               ["seal no", "seal number", "seal"],

    # ── Bill of Lading specific ──────────────────────────────────────────────
    "invoice_number":        ["invoice no", "invoice number", "inv no"],
    "shipping_bill_number":  ["sb no", "shipping bill no", "s/b no",
                              "shipping bill number"],
    "container_number":      ["container no", "container number", "cntr no",
                              "container #"],
    "port_of_loading":       ["port of loading", "pol", "loading port"],
    "port_of_discharge":     ["port of discharge", "pod", "discharge port"],
    "bl_number":             ["bl no", "b/l no", "bill of lading no",
                              "mbl", "house bl", "hbl"],

    # ── US documents ─────────────────────────────────────────────────────────
    "entry number":          ["entry number", "entry no", "entry #",
                              "cf entry no", "customs entry no"],
    "port of entry":         ["port of entry", "port of arrival",
                              "entry port"],
    "port of unlading":      ["port of unlading", "port of unloading",
                              "unlading port"],
    "b/l or awb number":     ["b/l", "bol", "bill of lading no",
                              "bl number", "mbl", "master bl",
                              "awb", "airway bill", "bl/awb"],
    "master bill of lading": ["master bill of lading", "mbl",
                              "master bl no", "master bol"],
    "container(s)":          ["container", "container no",
                              "container number", "containers"],
    "importer number":       ["importer number", "importer no",
                              "importer id"],
    "gross weight (us)":     ["gross weight", "gw", "g.w.", "gross wt"],
    "total units":           ["total units", "total pcs", "total qty"],

    # ── DDS specific ─────────────────────────────────────────────────────────
    "booking number":        ["booking no", "booking number", "booking ref",
                              "booking reference", "booking #", "booking no.",
                              "booking ref no"],
    "bol number":            ["bol no", "bol number", "bl no", "bl number",
                              "bill of lading no"],
    "liner":                 ["liner", "shipping line", "carrier",
                              "steamship line", "shipping carrier"],
    "consignee":             ["consignee", "consignee name", "ship to"],
    "sold to":               ["sold to", "buyer", "customer"],
    "inr total":             ["inr total", "total inr", "amount inr",
                              "total amount inr"],
    "usd total":             ["usd total", "total usd", "amount usd",
                              "total amount usd"],

    # ── Freight Forwarder / Ocean Freight ─────────────────────────────────────
    "ocean bol":             ["ocean bol", "mbl", "master bl",
                              "master bill of lading", "ocean bl"],
    "house bol":             ["house bol", "hbl", "house bl",
                              "house bill of lading"],
    "mawb":                  ["mawb", "master awb", "master airway bill"],
    "hawb":                  ["hawb", "house awb", "house airway bill"],
    "description":           ["description", "particulars", "details",
                              "charge description", "item description"],
    "gross weight kg":       ["gross weight", "g.w.", "gw", "gross wt",
                              "gross weight kg", "total weight"],
    "volume cbm":            ["volume", "cbm", "cubic meters",
                              "m3", "vol", "measurement"],
    "num packages":          ["packages", "pkgs", "no of packages",
                              "cartons", "total packages"],
    "subtotal inr":          ["subtotal", "sub total", "subtotal inr",
                              "total before tax", "taxable amount"],
    "total inr":             ["total inr", "total", "grand total",
                              "invoice total", "net payable"],
    "amount in words":       ["amount in words", "rupees in words",
                              "in words", "words", "total in words",
                              "amount in words (inr)", "grand total in words",
                              "invoice amount in words", "amt in words"],
    "grand total inr":       ["grand total inr", "grand total", "total inr",
                              "total in inr", "total amount inr",
                              "invoice total inr", "net total inr",
                              "total in rs", "total rs"],

    # ── SSD (Steel Supplier Declaration) ────────────────────────────────────
    "part number":           ["part number", "part no", "part no.",
                              "item no", "material no"],
    "us hts code":           ["us hts code", "hts code", "hts", "htsus",
                              "us tariff"],
    "contains steel":        ["contains steel", "steel content"],
    "steel content weight kg": ["steel content weight", "steel weight",
                                "steel content weight kg"],
    "steel content value usd": ["steel content value", "steel value",
                                 "steel content value usd"],
    "signatory name":        ["signatory name", "signatory", "signed by",
                              "authorised by", "name"],
    "certification date":    ["certification date", "certified on",
                              "date of certification"],

    # ── CHA — Issuer ─────────────────────────────────────────────────────────
    "address":               ["address", "company address", "registered address",
                              "office address", "regd. address", "regd address",
                              "reg. address", "corporate address", "addr"],
    "branch address":        ["branch address", "bank branch address",
                              "branch", "branch name", "bank branch",
                              "branch/address"],
    "website":               ["website", "web", "url", "web address", "www",
                              "website url", "web url"],
    "msme udyam":            ["msme udyam", "msme", "udyam", "udyam no",
                              "udyam registration", "msme registration",
                              "udyam no.", "msme reg no", "udyam reg no"],
    "state code":            ["state code", "state cd", "state",
                              "state/ut code", "state code no"],

    # ── CHA — Invoice Identification ─────────────────────────────────────────
    "document type":         ["document type", "doc type", "type of document",
                              "invoice type", "type of supply"],
    "document title":        ["document title", "tax invoice", "gst invoice",
                              "invoice title", "type of invoice",
                              "transport tax invoice", "tax invoice no",
                              "document"],
    "tax type":              ["tax type", "type of tax", "gst type",
                              "type of gst", "tax category"],
    "copy type":             ["copy type", "copy", "original", "duplicate",
                              "original/duplicate", "copy no"],
    "irn ack number":        ["irn ack no", "irn ack number",
                              "irn acknowledgement no", "acknowledgement no",
                              "ack no", "ack number", "ack #",
                              "acknowledgement number", "irn ack no.",
                              "ack no."],
    "irn ack time":          ["irn ack time", "irn ack date",
                              "irn acknowledgement time",
                              "acknowledgement time", "ack date",
                              "ack datetime", "ack date & time"],

    # ── CHA — Customer ────────────────────────────────────────────────────────
    "name":                  ["customer name", "name", "customer", "bill to",
                              "sold to", "supply to", "billed to"],
    "customer id":           ["customer id", "customer code", "client id",
                              "client code", "customer ref", "client ref"],
    "state of supply":       ["state of supply", "state of supply code",
                              "supply state", "gst state"],
    "shipment number":       ["shipment number", "shipment no", "shipment #",
                              "shipment ref", "shipment reference",
                              "consignment no", "consignment number"],
    "reverse charge":        ["reverse charge", "reverse charge applicable",
                              "rcm", "reverse charge mechanism"],

    # ── CHA — Shipment ────────────────────────────────────────────────────────
    "shipper":               ["shipper", "consignor", "shipper name",
                              "consignor name", "exporter name"],
    "shipper address":       ["shipper address", "consignor address",
                              "exporter address", "shipper/consignor address"],
    "consignee address":     ["consignee address", "ship to address",
                              "delivery address", "consignee/delivery address"],
    "order reference":       ["order reference", "order ref", "job ref",
                              "job no", "our order no", "ref no"],
    "incoterm":              ["incoterm", "inco terms", "incoterms",
                              "terms of delivery", "delivery terms"],
    "commodity note":        ["commodity note", "commodity", "nature of goods",
                              "goods note"],
    "gross weight unit":     ["gross weight unit", "wt unit", "weight unit"],
    "chargeable weight":     ["chargeable weight", "chargeable wt", "cbw",
                              "chargeable weight kgs"],
    "vessel voyage imo":     ["vessel/voyage/imo", "vessel voyage imo",
                              "vessel voyage", "vessel name & voyage",
                              "voyage number", "voyage no", "voy no",
                              "vessel & voyage", "vessel/voyage"],
    "origin":                ["origin", "port of loading", "pol",
                              "loading port", "from port", "place of loading",
                              "place of origin", "ship from", "origin port"],
    "destination":           ["destination", "port of discharge", "pod",
                              "discharge port", "unloading port",
                              "place of discharge", "delivery port",
                              "to port", "ship to port"],
    "packages":              ["no of packages", "number of packages",
                              "no. of packages", "packages", "no of packs",
                              "number of packs", "no of pkgs", "no. of pkgs",
                              "number of packs", "no. packs",
                              "total packages", "pkg count"],
    "mbl":                   ["mbl", "master bl", "master b/l",
                              "master bill of lading", "master blno",
                              "master no", "master number", "mbl no",
                              "ocean bl", "master bol", "master b.l."],
    "hbl":                   ["hbl", "house bl", "house b/l",
                              "house bill of lading", "house blno",
                              "house no", "hbl no", "house bol",
                              "house b.l.", "hawb no"],
    "goods description":     ["goods description", "description of goods",
                              "description", "commodity", "nature of goods",
                              "goods", "cargo description", "goods details",
                              "cargo details", "item description"],
    "import customs broker": ["import customs broker", "importer customs broker",
                              "icb", "customs broker at destination",
                              "destination customs broker", "customs broker"],

    # ── CHA — Job ─────────────────────────────────────────────────────────────
    "number":                ["job number", "job no", "job ref no",
                              "job reference no", "job id", "job #",
                              "job no.", "job num"],
    "doc number":            ["document number", "doc no", "doc number",
                              "job document no", "document ref", "doc #",
                              "document no.", "doc. no"],
    "pol pod":               ["pol/pod", "pol pod", "port of loading/discharge",
                              "loading/discharge port", "pol / pod",
                              "pol-pod", "loading port/discharge port"],
    "project name":          ["project name", "project", "proj", "house number",
                              "proj name", "job project", "job project name",
                              "project ref", "house no"],
    "prepared by":           ["prepared by", "prepared", "done by",
                              "made by", "checked by"],
    "approved by":           ["approved by", "approved", "authorised by",
                              "verified by", "authorised signatory",
                              "authorized by"],

    # ── CHA — Totals ──────────────────────────────────────────────────────────
    "subtotal":              ["subtotal", "sub total", "sub-total",
                              "total before tax", "taxable total"],
    "invoice amount page2":  ["invoice amount page 2", "invoice amount",
                              "page 2 amount", "amount (page 2)"],
    "net amount":            ["net amount", "net payable", "net total",
                              "amount payable net"],

    # ── CHA — QR Code ─────────────────────────────────────────────────────────
    "raw jwt":               ["qr code", "jwt", "qr jwt", "qr data"],
    "seller gstin":          ["seller gstin", "seller gst no",
                              "supplier gstin"],
    "buyer gstin":           ["buyer gstin", "buyer gst no",
                              "purchaser gstin"],
    "doc no":                ["doc no", "document no", "irn doc no"],
    "doc date":              ["doc date", "document date"],
    "total inv value":       ["total invoice value", "invoice value",
                              "total inv value"],
    "item count":            ["item count", "no of items", "number of items"],
    "main hsn code":         ["main hsn code", "primary hsn", "hsn code"],
    "irn date":              ["irn date", "irn dt", "irn issue date"],
    "signature algorithm":   ["signature algorithm", "sign algorithm"],

    # ── CHA — Misc ────────────────────────────────────────────────────────────
    "lut bond reference":    ["lut bond reference", "lut ref", "bond ref",
                              "lut/bond ref", "lut/arn ref", "lut bond ref",
                              "lut/arn bond reference", "bond reference"],
    "remarks":               ["remarks", "remark", "note", "notes",
                              "special instructions", "additional info",
                              "comment", "comments"],

    # ── Shipping Bill — Metadata ──────────────────────────────────────────────
    "sb no":                 ["sb no", "s/b no", "s.b. no",
                              "shipping bill no", "shipping bill number"],
    "sb date":               ["sb date", "s/b date", "shipping bill date"],
    "iec br":                ["iec br", "iec", "iec code", "iec number",
                              "importer exporter code"],
    "cb code":               ["cb code", "customs broker code", "cha code",
                              "customs house agent code", "cha no"],
    "inv count":             ["inv count", "invoice count", "no of invoices"],
    "item count":            ["item count", "no of items", "items count"],
    "cont count":            ["cont count", "container count",
                              "no of containers", "container nos"],
    "pkg count":             ["pkg count", "package count",
                              "no of packages", "no of pkgs"],
    "gross weight kgs":      ["gross weight kgs", "gross weight",
                              "total weight kgs", "g.w.", "gw"],
    "leo no":                ["leo no", "leo number",
                              "let export order no", "let export order"],
    "leo date":              ["leo date", "let export order date"],
    "brc realisation date":  ["brc realisation date", "brc date",
                              "bank realisation certificate date"],
    "rotn no date":          ["rotation no date", "rotn no", "rotn no & date",
                              "rotation number & date", "rotation no/date"],
    "sez unit details":      ["sez unit details", "sez unit",
                              "special economic zone unit"],

    # ── Shipping Bill — Section A Status ─────────────────────────────────────
    "assess":                ["assess", "assessment", "assess status"],
    "exmn":                  ["exmn", "examination", "exam"],
    "jobbing":               ["jobbing", "job work"],
    "meis":                  ["meis", "merchandise exports"],
    "dbk":                   ["dbk", "drawback", "duty drawback"],
    "rodtp":                 ["rodtp", "rodtep", "rod scheme"],
    "licence":               ["licence", "license", "export licence"],
    "dfrc":                  ["dfrc", "duty free replenishment"],
    "re exp":                ["re exp", "re-export", "re export"],
    "lut":                   ["lut", "letter of undertaking", "lut/bond"],

    # ── Shipping Bill — Section B Declarant ──────────────────────────────────
    "exporter name and address": ["exporter name and address",
                                  "exporter name & address",
                                  "exporter", "exporter details"],
    "rbi waiver no and dt":  ["rbi waiver no and date", "rbi waiver no & dt",
                              "rbi waiver no", "rbi waiver"],
    "cb name":               ["cb name", "customs broker name",
                              "cha name", "customs agent"],
    "aeo":                   ["aeo", "authorised economic operator"],
    "consignee name and address": ["consignee name and address",
                                   "consignee name & address",
                                   "consignee details"],
    "forex bank ac no":      ["forex bank ac no", "forex bank account",
                              "foreign exchange account", "forex a/c no"],
    "dbk bank ac no":        ["dbk bank ac no", "drawback bank account",
                              "dbk account no", "drawback a/c"],
    "ifsc no":               ["ifsc no", "ifsc code", "ifsc"],

    # ── Shipping Bill — Invoice Ref ───────────────────────────────────────────
    "sno":                   ["sno", "s.no", "serial no", "sl no", "sr no"],
    "invoice no and date":   ["invoice no and date", "invoice no & date",
                              "invoice no./date", "inv no & dt"],
    "po no and date":        ["po no and date", "po no & date",
                              "po no./date", "purchase order no & date"],
    "loc no and date":       ["loc no and date", "loc no & date",
                              "lc no and date", "lc no & date",
                              "letter of credit no & date"],
    "contract no and date":  ["contract no and date", "contract no & date",
                              "contract no./date"],
    "invterm":               ["invterm", "invoice term", "payment term",
                              "incoterm", "trade term"],

    # ── Shipping Bill — Items ─────────────────────────────────────────────────
    "invsn":                 ["invsn", "invoice sn", "invoice serial",
                              "inv sn", "inv serial no"],
    "itemsn":                ["itemsn", "item sn", "item serial",
                              "item serial no", "item no"],
    "hs cd":                 ["hs cd", "hs code", "hs", "hts code", "ritc"],
    "value fc":              ["value fc", "value (fc)", "fob value fc",
                              "value in foreign currency"],
    "fob inr":               ["fob inr", "fob value inr", "fob (inr)",
                              "fob value (inr)"],
    "pmv":                   ["pmv", "per unit market value",
                              "market value per unit"],
    "duty amt":              ["duty amt", "duty amount", "total duty"],
    "cess rt":               ["cess rt", "cess rate", "cess %"],
    "ces amt":               ["ces amt", "cess amount", "cess amt",
                              "cess total"],
    "dbkclmd":               ["dbkclmd", "drawback claimed",
                              "dbk claimed", "drawback amount"],
    "igst stat":             ["igst stat", "igst status"],
    "schcod":                ["schcod", "scheme code", "export scheme code"],
    "sqc msr":               ["sqc msr", "sq measure", "statistical quantity"],
    "sqc uqc":               ["sqc uqc", "sq unit", "statistical uqc"],
    "fta benefit availed":   ["fta benefit availed", "fta benefit",
                              "free trade agreement benefit"],
    "reward benefit":        ["reward benefit", "reward", "export reward"],
    "third party item":      ["third party item", "third party",
                              "third party export"],
}

# Aliases for table column headers (used in find_best_table / table_to_records)
# These are checked in addition to FIELD_LABEL_ALIASES for table column matching.
_TABLE_COL_ALIASES: dict[str, list[str]] = {
    "sl no":       ["sl no", "s.no", "sno", "sr no", "sr.", "no.", "#"],
    "description": ["description", "particulars", "details", "goods",
                    "item", "item name", "product name", "commodity"],
    "hsn":         ["hsn", "hsn code", "hsn/sac", "hs code", "sac"],
    "qty":         ["qty", "quantity", "nos", "no.", "pcs", "units", "number"],
    "uom":         ["unit", "uom", "uqc", "unit of measure"],
    "rate":        ["rate", "unit price", "price", "price/unit", "fob rate"],
    "amount":      ["amount", "value", "total", "line total", "line value",
                    "fob value", "invoice value", "taxable value"],
    "igst rate":   ["igst rate", "tax rate", "gst rate", "igst %", "tax %"],
    "igst amount": ["igst amount", "tax amount", "gst amount"],
    "taxable":     ["taxable", "taxable amount", "taxable value",
                    "assessable value"],
}


def _get_field_aliases(field_name: str) -> list[str]:
    """
    Return all label strings to search for `field_name`.
    Always includes the original field_name so the exact label is also tried.
    """
    norm = field_name.strip().lower()
    aliases = list(FIELD_LABEL_ALIASES.get(norm, []))
    # Also try the raw field_name if not already in the list
    if norm not in [a.lower() for a in aliases]:
        aliases.insert(0, field_name)
    return aliases


def _split_key_tokens(key: str) -> list[str]:
    if not key:
        return []
    key = str(key).replace("_", " ")
    key = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", key)
    return [t.lower() for t in re.findall(r"[A-Za-z0-9]+", key)]


def _expand_label_variants(label: str) -> list[str]:
    """
    Generate robust label variants from a base label.
    """
    base = re.sub(r"\s+", " ", str(label).strip())
    if not base:
        return []
    variants: set[str] = {base}
    normalized = base.lower()
    variants.add(normalized)
    variants.add(normalized.replace("&", "and"))
    variants.add(normalized.replace(" and ", " & "))
    variants.add(normalized.replace(" no ", " number "))
    variants.add(normalized.replace(" number ", " no "))
    variants.add(normalized.replace(" no.", " number"))
    variants.add(normalized.replace(" #", " number"))
    variants.add(normalized.replace("/", " "))
    variants.add(normalized.replace("-", " "))
    variants.add(re.sub(r"[^\w\s]", " ", normalized))
    variants.add(re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", normalized)).strip())

    out = []
    seen = set()
    for v in variants:
        vv = re.sub(r"\s+", " ", v).strip(" :.-")
        if not vv or vv in seen:
            continue
        seen.add(vv)
        out.append(vv)
    return out


def build_doc_field_aliases(
    section: str,
    field_name: str,
    field_map: dict,
    key_style: str,
) -> list[str]:
    """
    Build per-field aliases using schema field, section context, and prompt key maps.
    """
    aliases: list[str] = []
    seen: set[str] = set()

    def add(items: list[str]) -> None:
        for item in items:
            v = re.sub(r"\s+", " ", str(item).strip())
            if not v:
                continue
            k = v.lower()
            if k in seen:
                continue
            seen.add(k)
            aliases.append(v)

    base_aliases = _get_field_aliases(field_name)
    add(base_aliases)

    # Section-aware disambiguation for generic fields like Name/Address/Date.
    add(_expand_label_variants(f"{section} {field_name}"))
    add(_expand_label_variants(f"{field_name} {section}"))

    # Include canonical JSON-key words from prompt TS maps.
    json_key = _field_json_key(field_name, field_map, key_style)
    key_tokens = _split_key_tokens(json_key)
    if key_tokens:
        add(_expand_label_variants(" ".join(key_tokens)))
        add(_expand_label_variants(f"{section} {' '.join(key_tokens)}"))

    # Prefer longer, more specific aliases first.
    aliases.sort(key=lambda x: len(x), reverse=True)
    return aliases


# ── Key-map loading and generation ────────────────────────────────────────────

_KEY_MAP_CACHE: dict[str, tuple[dict, dict, str]] = {}


def _get_key_maps(doc_type: str) -> tuple[dict, dict, str]:
    if doc_type in _KEY_MAP_CACHE:
        return _KEY_MAP_CACHE[doc_type]
    cfg        = DOC_TYPE_CONFIG[doc_type]
    key_style  = cfg["key_style"]
    ts_path    = cfg.get("prompt_ts")
    section_map: dict = {}
    field_map: dict   = {}
    if ts_path:
        full_ts = BACKEND_DIR / ts_path
        if cfg.get("section_map_var"):
            section_map = extract_ts_map(full_ts, cfg["section_map_var"])
        if cfg.get("field_map_var"):
            field_map = extract_ts_map(full_ts, cfg["field_map_var"])
    _KEY_MAP_CACHE[doc_type] = (section_map, field_map, key_style)
    return section_map, field_map, key_style


def _make_key(label: str, key_map: dict, key_style: str) -> str:
    if label in key_map:
        return key_map[label]
    tokens = tokenize_label(label)
    return to_snake(tokens) if key_style == "snake" else to_camel(tokens)


def _section_json_key(section: str, section_map: dict, key_style: str) -> str:
    raw = _make_key(section, section_map, key_style)
    if raw.startswith("__root"):
        tail = raw[6:]
        return tail[:1].lower() + tail[1:] if tail else ""
    return raw


def _field_json_key(field_name: str, field_map: dict, key_style: str) -> str:
    return _make_key(field_name, field_map, key_style)


# ── REJECTS ───────────────────────────────────────────────────────────────────

# Context variable: when True, validators and header-blob checks are skipped so
# raw extracted values pass through even if they fail strict format checks.
_lenient_extract: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "camelot_lenient", default=False
)


@contextlib.contextmanager
def lenient_extraction():
    """Relax the rejects filter: skip format validators and header-blob checks.

    Use this to capture raw values that the strict pipeline would drop.
    """
    token = _lenient_extract.set(True)
    try:
        yield
    finally:
        _lenient_extract.reset(token)


_NOISE_VALUES: set[str] = {
    "", ":", "::", ".", "..", "/", "//",
    "-", "--", "—", "–", "n/a", "na", "nil", "none", "null", "tbd",
    "to be advised", "as per attached", "as above", "as agreed", "as per b/l",
    "see attached", "see above", "blank", "x", "xx", "xxx",
}
_NOISE_LINE_PATTERNS: list[re.Pattern] = [
    re.compile(r"^page\s*\d+\s*(of|/)\s*\d+\s*$", re.IGNORECASE),
    re.compile(r"^\s*page\s*\d+\s*$", re.IGNORECASE),
    re.compile(r"^\s*\d+\s*$"),
    re.compile(r"^(grand\s*total|sub[\s-]*total|total)\s*[:.]?\s*$", re.IGNORECASE),
    re.compile(r"^continued\s+(from|on)\s+", re.IGNORECASE),
    re.compile(r"^---+\s*page\s*\d+\s*---+$", re.IGNORECASE),
    re.compile(r"^\s*[*_=\-]{3,}\s*$"),
]
_TOTAL_ROW_TOKENS: set[str] = {
    "total", "totals", "subtotal", "sub total", "sub-total",
    "grand total", "grandtotal", "net total", "amount in words",
    "balance", "balance due", "amount due", "page total",
}
_UNIT_SUFFIXES = re.compile(
    r"\s*(?:kgs?|mts?|lbs?|tons?|cbm|cft|cm|mm|m|pcs?|nos?|pkgs?|cartons?|boxes?|"
    r"units?|sets?|each|ea|kg|kn|ltr|usd|inr|eur|gbp|aed|jpy|cny)\.?\s*$",
    re.IGNORECASE,
)
_CURRENCY_SYMBOLS = re.compile(
    r"^\s*(?:\$|₹|€|£|usd|inr|eur|gbp|rs\.?|aed)\s*", re.IGNORECASE
)
_LABEL_PREFIX_NOISE = re.compile(
    r"^\s*(?:din[-\s]*|attention\s*[:\-]\s*|regd\.?\s*offic(?:e|er)\s*[:\-]\s*|"
    r"ref(?:erence)?\s*(?:no\.?|number)?\s*[:\-]\s*)",
    re.IGNORECASE,
)
_DATE_KEYWORDS    = ("date", "dt", "etd", "eta", "issued", "expiry")
_AMOUNT_KEYWORDS  = ("amount", "value", "total", "subtotal", "rate", "price",
                     "cost", "charge", "fee", "fob", "cif", "freight", "insurance")
_WEIGHT_KEYWORDS  = ("weight", "wt", "quantity", "qty", "volume", "gross",
                     "net", "pcs", "packages")
_PERCENT_KEYWORDS = ("rate%", "%", "igst rate", "cgst rate", "sgst rate", "tax rate")
_CODE_KEYWORDS    = ("hsn", "hs code", "sac", "tariff", "htsus", "code")


def _normalize_col(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def _norm_field(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


def _norm_token(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def _tokenize_for_match(s: str) -> list[str]:
    return [t for t in re.split(r"[^A-Za-z0-9]+", str(s).lower()) if t]


def _env_flag(name: str, default: bool = True) -> bool:
    raw = str(os.getenv(name, "1" if default else "0")).strip().lower()
    return raw not in {"0", "false", "no", "off", ""}


def _looks_like_label(value: str, label: str) -> bool:
    if not value or not label:
        return False
    nv = _normalize_col(value)
    nl = _normalize_col(label)
    return bool(nv and nl and (nv == nl or nv.startswith(nl) or nl.startswith(nv)))


def _is_total_row(first_cell: str) -> bool:
    token = _norm_field(first_cell)
    if token in _TOTAL_ROW_TOKENS:
        return True
    return any(token.startswith(t + " ") for t in _TOTAL_ROW_TOKENS)


def _is_noise_value(value: str) -> bool:
    if value is None:
        return True
    v = value.strip()
    if not v or v.lower() in _NOISE_VALUES:
        return True
    return any(p.match(v) for p in _NOISE_LINE_PATTERNS)


def _strip_label_prefix(value: str) -> str:
    return _LABEL_PREFIX_NOISE.sub("", value).strip()


def _clean_amount(value: str) -> str:
    v = _CURRENCY_SYMBOLS.sub("", value.strip())
    v = _UNIT_SUFFIXES.sub("", v)
    candidate = v.replace(",", "")
    return candidate if re.fullmatch(r"-?\d+(?:\.\d+)?", candidate) else v.strip()


def _clean_percent(value: str) -> str:
    return re.sub(r"\s*%\s*$", "", value.strip()).strip()


def _clean_weight(value: str) -> str:
    v = _UNIT_SUFFIXES.sub("", value.strip())
    candidate = v.replace(",", "")
    return candidate if re.fullmatch(r"-?\d+(?:\.\d+)?", candidate) else v.strip()


def _clean_code(value: str) -> str:
    v = value.strip()
    v = re.sub(r"\.\s+(?=[A-Z0-9])", ".", v)
    if re.fullmatch(r"[A-Z0-9.\-/]+(?:\s+[A-Z0-9.\-/]+)+", v):
        v = re.sub(r"\s+", "", v)
    return v


def _clean_value_for_field(value: str, field_name: str) -> str:
    if not value:
        return value
    v  = _strip_label_prefix(value)
    nf = _norm_field(field_name)
    if any(k in nf for k in _PERCENT_KEYWORDS):
        v = _clean_percent(v)
    if any(k in nf for k in _AMOUNT_KEYWORDS):
        v = _clean_amount(v)
    elif any(k in nf for k in _WEIGHT_KEYWORDS):
        v = _clean_weight(v)
    elif any(k in nf for k in _CODE_KEYWORDS):
        v = _clean_code(v)
    return v.strip().rstrip(",;|").strip()


_HSN_RE       = re.compile(r"^\d{4,10}$")
_GSTIN_RE     = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$", re.IGNORECASE)
_PAN_RE       = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$", re.IGNORECASE)
_CIN_RE       = re.compile(r"^[A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$", re.IGNORECASE)
_CONTAINER_RE = re.compile(r"^[A-Z]{4}\d{7}$", re.IGNORECASE)
_IFSC_RE      = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$", re.IGNORECASE)
_DATE_RE      = re.compile(
    r"\d{1,2}[/.\-\s][A-Za-z0-9]{1,9}[/.\-\s]\d{2,4}|"   # DD/MM/YYYY, DD-Mon-YYYY
    r"\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}|"                   # YYYY-MM-DD
    r"[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|"                 # Month DD, YYYY
    r"\d{1,2}[A-Za-z]{3,9}\d{2,4}|"                        # DDMMMYYYY e.g. 01JAN2024
    r"\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}"                  # DD/MM/YY
)


def _passes_validator(value: str, field_name: str) -> bool:
    nf = _norm_field(field_name)
    v  = value.strip()
    # Numeric/amount fields: reject strings that look like table column headers
    # (e.g. "Rate CGST Rate SGST Rate IGST Total Amount") — 3+ distinct alpha words
    # after cleaning currency/unit symbols means it's almost certainly header text.
    if _field_is_numeric_like(field_name):
        cleaned_num = _clean_amount(v)
        alpha_words = re.findall(r"[A-Za-z]{2,}", cleaned_num)
        if len(alpha_words) >= 3:
            return False
    if "gstin" in nf:
        return bool(_GSTIN_RE.match(v.replace(" ", "")))
    if nf in ("pan", "pan no", "pan number"):
        return bool(_PAN_RE.match(v.replace(" ", "")))
    if "cin" in nf and "machine" not in nf:
        return bool(_CIN_RE.match(v.replace(" ", "")))
    if "ifsc" in nf:
        return bool(_IFSC_RE.match(v.replace(" ", "")))
    if "container number" in nf or nf == "container no":
        return bool(_CONTAINER_RE.match(v.replace(" ", "")))
    if "hsn" in nf or "hs code" in nf or ("sac" in nf and "hsn" in nf):
        digits = re.sub(r"\D", "", v)
        return bool(_HSN_RE.match(digits)) if digits else False
    if any(k in nf for k in _DATE_KEYWORDS):
        return bool(_DATE_RE.search(v))
    return True


def _looks_like_header_blob(value: str) -> bool:
    nv = _normalize_col(value)
    if not nv:
        return False
    hits = 0
    for hint in _HEADER_BLOB_HINTS:
        if _normalize_col(hint) in nv:
            hits += 1
            if hits >= 3:
                return True
    return False


def is_rejected(value: str, field_name: str = "", label: str = "") -> bool:
    if _is_noise_value(value):
        return True
    lenient = _lenient_extract.get()
    if field_name and not _wants_multiline(field_name):
        words = re.findall(r"[A-Za-z0-9]+", value)
        if len(words) > 14 and len(value) > 90:
            return True
        if not lenient and _looks_like_header_blob(value):
            return True
    if label and _looks_like_label(value, label):
        return True
    if field_name and _looks_like_label(value, field_name):
        return True
    if not lenient and field_name and not _passes_validator(value, field_name):
        return True
    return False


def is_noise_row(row_values: list[str]) -> bool:
    if not row_values:
        return True
    cleaned = [str(v).strip() for v in row_values]
    if not any(cleaned):
        return True
    if _is_total_row(cleaned[0]):
        return True
    non_empty = [c for c in cleaned if c]
    if len(non_empty) <= 1 and len(cleaned) >= 3 and all(_is_noise_value(c) for c in non_empty):
        return True
    return all(_is_noise_value(c) for c in cleaned)


def _field_is_numeric_like(field_name: str) -> bool:
    nf = _norm_field(field_name)
    numeric_tokens = (
        "amount",
        "total",
        "rate",
        "value",
        "qty",
        "quantity",
        "weight",
        "duty",
        "tax",
        "count",
        "percent",
    )
    return any(tok in nf for tok in numeric_tokens)


def _anchor_fields_for_section(field_names: list[str]) -> list[str]:
    anchors: list[str] = []
    for fn in field_names:
        nf = _norm_field(fn)
        if any(
            tok in nf
            for tok in (
                "invoice number",
                "invoice no",
                "line no",
                "line number",
                "sno",
                "sr no",
                "serial no",
                "product code",
                "part number",
                "sku",
                "container no",
                "container number",
                "seal no",
                "htsus",
                "hsn",
                "bo code",
            )
        ):
            anchors.append(fn)
    if anchors:
        return anchors
    return field_names[:1]


def _merge_sparse_array_records(
    records: list[dict],
    field_names: list[str],
) -> list[dict]:
    if not records:
        return records

    anchors = _anchor_fields_for_section(field_names)
    merged: list[dict] = []

    for rec in records:
        filled = [f for f in field_names if str(rec.get(f, "")).strip()]
        has_anchor = any(str(rec.get(a, "")).strip() for a in anchors)

        if merged and filled and not has_anchor and len(filled) <= 3:
            prev = merged[-1]
            for f in filled:
                curr_val = str(rec.get(f, "")).strip()
                if not curr_val:
                    continue
                prev_val = str(prev.get(f, "")).strip()
                if not prev_val:
                    prev[f] = curr_val
                    continue
                if _field_is_numeric_like(f):
                    continue
                if curr_val not in prev_val:
                    prev[f] = f"{prev_val} {curr_val}".strip()
            continue

        merged.append(dict(rec))
    return merged


def dedupe_records(records: list[dict], key_fields: list[str] | None = None) -> list[dict]:
    seen: set[tuple] = set()
    out: list[dict] = []
    for rec in records:
        if key_fields:
            key = tuple(str(rec.get(k, "")).strip().lower() for k in key_fields)
            if not any(key):
                continue
        else:
            key = tuple(sorted((k, str(v).strip().lower()) for k, v in rec.items()))
        if key in seen:
            continue
        seen.add(key)
        out.append(rec)
    return out


def _parse_bol_raw_invoice_lines(raw_text: str) -> list[dict]:
    out: list[dict] = []
    for m in _BOL_INV_RAW_RE.finditer(raw_text or ""):
        out.append({"invoice_number": m.group(1).strip(), "invoice_date": m.group(2).strip()})
    return out


def _parse_bol_raw_sb_lines(raw_text: str) -> list[dict]:
    out: list[dict] = []
    for m in _BOL_SB_RAW_RE.finditer(raw_text or ""):
        out.append(
            {
                "shipping_bill_number": m.group(1).strip(),
                "shipping_bill_date": (m.group(2) or "").strip(),
            }
        )
    return out


def _override_from_raw(structured: list, parsed: list) -> list:
    if not parsed:
        return structured
    parsed_numbers = [list(p.values())[0] for p in parsed if isinstance(p, dict) and p]
    if len(set(parsed_numbers)) <= 1:
        return structured
    return parsed


def _postprocess_sales_invoice(record: dict, text: str, set_if_missing) -> None:
    """Override / fill Sales Invoice header fields using targeted regex on the raw text."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    inv_no_re = re.compile(r"\b[A-Z]{2,8}/\d{1,10}/\d{2}-\d{2}\b", re.IGNORECASE)
    po_no_re  = re.compile(r"\b[A-Z0-9]+-PO-[A-Z0-9-]+\b", re.IGNORECASE)
    date_re   = re.compile(r"\b\d{1,2}[-/][A-Za-z0-9]{2,9}[-/]\d{2,4}\b")

    # ── Invoice No / Date ────────────────────────────────────────────────────
    for idx, line in enumerate(lines):
        if "invoice no" in line.lower() and "date" in line.lower():
            window = lines[idx : idx + 12]
            inv_no = next((m.group(0) for s in window for m in [inv_no_re.search(s)] if m), "")
            inv_dt = ""
            for s in window:
                m = re.search(r"\bDT\s+([0-9]{1,2}[-/][A-Za-z]{3,9}[-/][0-9]{4})\b", s, re.IGNORECASE)
                if m:
                    inv_dt = m.group(1)
                    break
                md = date_re.search(s)
                if md and not inv_dt and md.group(0) != inv_no:
                    inv_dt = md.group(0)
            if inv_no:
                record["header.invoiceNo"] = inv_no
            if inv_dt and _DATE_RE.search(inv_dt):
                record["header.invoiceDate"] = inv_dt
            break

    # ── Buyer PO No / Date ───────────────────────────────────────────────────
    for idx, line in enumerate(lines):
        ll = line.lower()
        if ("buyers order" in ll or "buyer's order" in ll or "buyer order" in ll) and "date" in ll:
            window = lines[idx : idx + 14]
            po_no = next((m.group(0) for s in window for m in [po_no_re.search(s)] if m), "")
            po_dt = next((m.group(0) for s in window for m in [date_re.search(s)] if m), "")
            if po_no and "PO" in po_no.upper():
                record["header.buyerPoNo"] = po_no
            if po_dt and _DATE_RE.search(po_dt):
                set_if_missing("header.buyerPoDate", po_dt)
            break

    # ── Bank Details ─────────────────────────────────────────────────────────
    bank_m = re.search(r"Bank\s+Details([\s\S]*?)(?:We\s+declare|$)", text, re.IGNORECASE)
    if bank_m:
        bt = bank_m.group(1)
        for pat, key in [
            (r"Account\s+number\s*:\s*(.+)",           "financial.bankAccountNo"),
            (r"Account\s+name\s*:\s*(.+)",             "financial.bankAccountName"),
            (r"Account\s+bank\s*:\s*(.+)",             "financial.bankName"),
            (r"Currency\s*:\s*(.+)",                   "financial.currency"),
            (r"Branch\s+name\s*:\s*(.+)",              "financial.bankBranch"),
            (r"SWIFT\s*:\s*(.+)",                      "financial.swiftCode"),
            (r"IFSC\s*(?:code|no)?\s*:\s*(.+)",        "financial.ifscCode"),
        ]:
            m = re.search(pat, bt, re.IGNORECASE | re.MULTILINE)
            if m:
                record[key] = m.group(1).strip()

    # ── Incoterms / Payment Terms ────────────────────────────────────────────
    m = re.search(r"Terms\s+of\s+Delivery\s+and\s+Payment\s*\n\s*([^\n]+)", text, re.IGNORECASE)
    if m:
        set_if_missing("financial.incoterms", m.group(1).strip())
    m = re.search(r"PAYMENT\s+TERM\s*[:\-]\s*([^\n]+)", text, re.IGNORECASE)
    if m:
        set_if_missing("financial.paymentTerms", m.group(1).strip())

    # ── Pre-Carriage By ──────────────────────────────────────────────────────
    for idx, line in enumerate(lines):
        if re.search(r"Pre[-\s]+Carriage\s+by\s*$", line, re.IGNORECASE):
            for nl in lines[idx + 1 : idx + 6]:
                if re.search(r"Place|Receipt|Payment|Vessel|Port|Country|Consignee|Buyer|FOB|CIF|CFR", nl, re.IGNORECASE):
                    continue
                if nl:
                    set_if_missing("shipment.preCarriageBy", nl)
                    break
            break

    # ── Place of Receipt ────────────────────────────────────────────────────
    for idx, line in enumerate(lines):
        if re.search(r"Place\s+of\s+Receipt", line, re.IGNORECASE):
            for nl in lines[idx + 1 : idx + 10]:
                if re.search(r"Payment|Vessel|Port|Country|Consignee|Buyer|Invoice|ROAD|AIR|SEA\b", nl, re.IGNORECASE):
                    continue
                if nl and re.search(r"[A-Za-z]{3,}", nl) and "," in nl or len(nl.split()) >= 2:
                    set_if_missing("shipment.placeOfReceipt", nl)
                    break
            break

    # ── Vessel / Port of Loading ─────────────────────────────────────────────
    for idx, line in enumerate(lines):
        if re.search(r"Vessel\s*/\s*Flight\s+No", line, re.IGNORECASE):
            vessel_set = False
            for nl in lines[idx + 1 : idx + 8]:
                if re.search(r"Port\s+of\s+Loading", nl, re.IGNORECASE):
                    break
                if nl:
                    if not vessel_set:
                        set_if_missing("shipment.vesselFlightNo", nl)
                        vessel_set = True
                    else:
                        set_if_missing("shipment.portOfLoading", nl)
                        break
            break

    # ── Port of Discharge / Final Destination ────────────────────────────────
    m = re.search(
        r"Port\s+of\s+Discharge\s*\n\s*Final\s+Destination\s*\n\s*([^\n]+)\s*\n\s*([^\n]+)",
        text, re.IGNORECASE,
    )
    if m:
        set_if_missing("shipment.portOfDischarge", m.group(1).strip())
        set_if_missing("shipment.finalDestination", m.group(2).strip())
    else:
        m = re.search(r"Port\s+of\s+Discharge\s*\n\s*([^\n]+)", text, re.IGNORECASE)
        if m:
            set_if_missing("shipment.portOfDischarge", m.group(1).strip())
        m = re.search(r"Final\s+Destination\s*\n\s*([^\n]+)", text, re.IGNORECASE)
        if m:
            set_if_missing("shipment.finalDestination", m.group(1).strip())

    # ── Exporter Name ────────────────────────────────────────────────────────
    for idx, line in enumerate(lines):
        if line.lower() == "exporter" and idx + 1 < len(lines):
            set_if_missing("entities.exporterName", lines[idx + 1])
            break

    # ── Consignee Name ───────────────────────────────────────────────────────
    for idx, line in enumerate(lines):
        if line.lower() == "consignee" and idx + 1 < len(lines):
            val = lines[idx + 1]
            if val and not re.search(r"^(Marks|No\.|Container|BO Code|Product|Description|Quantity)", val, re.IGNORECASE):
                record["entities.consigneeName"] = val
            break

    # ── Buyer Name ───────────────────────────────────────────────────────────
    for idx, line in enumerate(lines):
        ll = line.lower()
        if ll.startswith("buyer") and "other" not in ll and "order" not in ll and "consignee" not in ll:
            if ":" in line:
                val = line.split(":", 1)[1].strip()
                if not val and idx + 1 < len(lines):
                    val = lines[idx + 1]
            else:
                val = lines[idx + 1] if idx + 1 < len(lines) else ""
            if val and not re.search(r"if other|other than", val, re.IGNORECASE):
                record["entities.buyerName"] = val
            break

    # ── Country of Origin / Final Destination ────────────────────────────────
    country_m = re.search(
        r"(?:^|\n)(INDIA|USA|CHINA|GERMANY|JAPAN|UK|UAE|SINGAPORE|AUSTRALIA|CANADA|FRANCE|ITALY|SOUTH KOREA)"
        r"\s*\n\s*(USA|INDIA|CHINA|GERMANY|JAPAN|UK|UAE|SINGAPORE|AUSTRALIA|CANADA|FRANCE|ITALY|SOUTH KOREA)",
        text, re.IGNORECASE,
    )
    if country_m:
        set_if_missing("shipment.countryOfOrigin", country_m.group(1).strip().upper())
        set_if_missing("shipment.countryOfFinalDestination", country_m.group(2).strip().upper())

    # ── Clear obviously wrong values ─────────────────────────────────────────
    sbno = _clean_text(record.get("header.shippingBillNo", ""))
    if sbno and (len(sbno) > 25 or re.search(r"\b(correct|declare|invoice shows|particulars)\b", sbno, re.IGNORECASE)):
        record["header.shippingBillNo"] = ""

    for key in (
        "entities.buyerName", "entities.exporterName", "entities.consigneeName",
        "header.invoiceNo", "header.buyerPoNo", "header.zetwerkRef", "header.exporterName",
        "financial.incoterms", "financial.paymentTerms", "financial.currency",
        "shipment.countryOfOrigin", "shipment.countryOfFinalDestination",
        "shipment.portOfLoading", "shipment.portOfDischarge", "shipment.placeOfReceipt",
        "shipment.finalDestination", "shipment.preCarriageBy", "shipment.vesselFlightNo",
        "footer.signatoryName",
    ):
        val = _clean_text(record.get(key, ""))
        if val and ("dtype" in val or val.startswith("\\n") or len(val) > 250):
            record[key] = ""


def _postprocess_cha(record: dict, text: str) -> None:
    """
    CHA-specific post-processing.

    Handles two common CHA invoice layouts via targeted regex on the raw text:

    Format A (freight-company, BE-XXXX style):
      Right column "Label : Value" pairs — colon sometimes a separate text span.
      Core extraction usually works; this pass cleans garbled values and fills gaps.

    Format B (GST Tax Invoice, BLRCH style):
      Uses abbreviated labels: "Inv #", "Job #", "Doc #", "ACK #", "ACK Date",
      "IRN #" — the "#" is stripped by the tokenizer, so generic alias lookup
      misses them.  Explicit regex patterns here fill those fields.
    """
    def _clean(v: object) -> str:
        return re.sub(r"\s+", " ", str(v or "").strip())

    def _is_garbled(v: str) -> bool:
        """True when the stored value is a mis-captured label blob or separator."""
        if not v:
            return False
        # Any embedded newline is a symptom of multi-field merging
        if "\n" in v:
            return True
        # Starts with orphaned separator characters or dash-space artifacts
        if v.lstrip().startswith((":", "#", "/")):
            return True
        if re.match(r"^[-–—]\s", v.lstrip()):
            return True
        # Ends with a colon  →  value is actually a label text
        if v.rstrip().endswith(":"):
            return True
        # Multi-word alphabetic blob that looks like header/label text
        alpha_words = re.findall(r"[A-Za-z]{3,}", v)
        if len(alpha_words) >= 5 and len(v) > 60:
            return True
        return False

    def _set_if_empty(dot_key: str, value: str) -> None:
        """Write value only when the key is absent, empty, or currently garbled."""
        v = value.strip()
        if not v:
            return
        curr = _clean(record.get(dot_key, ""))
        if (not curr) or _is_garbled(curr):
            record[dot_key] = v

    # ── Step 1: Clear all garbled scalar values upfront ──────────────────────
    for k, v in list(record.items()):
        if isinstance(v, list):
            continue
        sv = str(v)
        if _is_garbled(sv):
            record[k] = ""

    # ── Step 2: Sanity-check specific fields — clear wrong-type values ────────
    # Date-typed fields: no valid date is more than 25 chars; clear long imposters
    # (NOTE: don't use _DATE_RE here — its patterns match decimal numbers as false positives)
    for fk in ("shipment.eta", "shipment.etd", "invoiceIdentification.invoiceDate",
               "invoiceIdentification.dueDate", "job.date"):
        cv = _clean(record.get(fk, ""))
        if cv and (len(cv) > 25 or not _DATE_RE.search(cv)):
            record[fk] = ""
    # irnAckTime can include time "07/11/2025 13:55" — allow up to 20 chars
    cv = _clean(record.get("invoiceIdentification.irnAckTime", ""))
    if cv and (len(cv) > 20 or not _DATE_RE.search(cv)):
        record["invoiceIdentification.irnAckTime"] = ""

    # Voyage number: short alphanumeric code, clear if multi-word or long
    cv = _clean(record.get("shipment.vesselVoyageImo", ""))
    if cv and (len(cv) > 30 or len(cv.split()) > 4):
        record["shipment.vesselVoyageImo"] = ""

    # State of supply: short code, clear if it mixes GSTIN noise with label text
    cv = _clean(record.get("customer.stateOfSupply", ""))
    if cv and len(re.findall(r"[A-Za-z]{3,}", cv)) >= 3 and len(cv) > 25:
        record["customer.stateOfSupply"] = ""

    # Document title: short label, clear if too long or looks like an address
    cv = _clean(record.get("invoiceIdentification.documentTitle", ""))
    if cv and (len(cv) > 40 or re.search(r"\b(NEAR|ROAD|STREET|NAGAR|AREA)\b", cv, re.IGNORECASE)):
        record["invoiceIdentification.documentTitle"] = ""

    # copyType / stateCode: clear if starts with separator artifact "- "
    for fk in ("invoiceIdentification.copyType", "customer.stateCode"):
        cv = _clean(record.get(fk, ""))
        if cv and re.match(r"^[-–—]\s", cv):
            record[fk] = ""

    # Clear company-name fields that captured label echoes: short slash-separated tokens
    # like "PoL/Pod" or "Inv/No" — no real company has that form
    for fk in ("issuer.companyName", "customer.name"):
        cv = _clean(record.get(fk, ""))
        if cv and (len(cv) < 8 or re.match(r'^[A-Za-z]{1,5}(?:/[A-Za-z]{1,5})+$', cv)):
            record[fk] = ""

    # ── Format B (BLRCH / GST Tax Invoice) patterns ───────────────────────────
    # The "#" in label names like "Inv #" is a non-word character; patterns allow
    # optional whitespace or newline between the label and the value.
    _NL = r"[\s\n]*"   # relaxed whitespace/newline bridge

    # Invoice number  →  "Inv #  BLRCH2526SI00137"
    m = re.search(rf"\bInv(?:oice)?\s*#{_NL}([A-Z0-9][A-Z0-9/\-\.]{{0,35}})", text, re.IGNORECASE)
    if m:
        _set_if_empty("invoiceIdentification.invoiceNumber", m.group(1))

    # Invoice date  →  standalone "Date  07/11/2025" in top-left block
    m = re.search(r"(?<!\w)Date\s+(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})(?!\d)", text, re.IGNORECASE)
    if m:
        _set_if_empty("invoiceIdentification.invoiceDate", m.group(1))

    # Job number  →  "Job #  CHA/33"
    # Always use regex for "#"-label fields since the "#" is stripped from spatial tokens.
    m = re.search(rf"\bJob\s*#{_NL}([A-Z0-9][A-Z0-9/\-\.]{{0,35}})", text, re.IGNORECASE)
    if m:
        curr = _clean(record.get("job.number", ""))
        if not curr or _is_garbled(curr) or not re.search(r"[A-Z]{2,}/\d", curr):
            record["job.number"] = m.group(1)

    # Doc number  →  "Doc #  EBKG14546986.4X40"  or  "Doc #  ARROYO PH2."
    # Allow spaces so multi-word project references are captured fully
    m = re.search(rf"\bDoc(?:ument)?\s*#{_NL}(.+?)(?=\n|\Z)", text, re.IGNORECASE)
    if m:
        val = m.group(1).strip().rstrip(".")
        curr = _clean(record.get("job.docNumber", ""))
        if val and (not curr or _is_garbled(curr)):
            record["job.docNumber"] = val

    # IRN hash  →  "IRN #  44a2ef..."
    m = re.search(rf"\bIRN\s*#{_NL}([a-f0-9]{{20,64}})", text, re.IGNORECASE)
    if m:
        _set_if_empty("invoiceIdentification.irn", m.group(1))

    # IRN ack number  →  "ACK #  112527550640660"
    m = re.search(rf"\bACK\s*#{_NL}(\d{{8,18}})", text, re.IGNORECASE)
    if m:
        _set_if_empty("invoiceIdentification.irnAckNumber", m.group(1))

    # IRN ack time  →  "ACK Date  07/11/2025 13:55"
    m = re.search(
        r"\bACK\s+Date\s+(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}(?:\s+\d{1,2}:\d{2})?)",
        text, re.IGNORECASE,
    )
    if m:
        _set_if_empty("invoiceIdentification.irnAckTime", m.group(1))

    # PoL / PoD  →  "PoL/Pod   MUNDRA / OAKLAND"
    m = re.search(r"\bPoL\s*/\s*Po[Dd]\s+(.+?)(?:\n|$)", text, re.IGNORECASE)
    if m:
        _set_if_empty("job.polPod", m.group(1).strip())

    # Vessel name  →  "Vessel   MSC SIENA"  (Format B)
    m = re.search(r"(?<!\w)Vessel\s+([A-Z][A-Z ]{2,35})(?:\n|$)", text, re.IGNORECASE)
    if m:
        _set_if_empty("shipment.vesselName", m.group(1).strip())

    # ETD  →  "Date (ETD)  15/10/2025"
    m = re.search(r"\bDate\s*\(ETD\)\s+(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})", text, re.IGNORECASE)
    if m:
        _set_if_empty("shipment.etd", m.group(1))

    # No of Pkgs  →  "No of Pkgs  4 CONTAINER"
    m = re.search(r"\bNo\s+of\s+Pkgs\s+(.+?)(?:\n|Gross|$)", text, re.IGNORECASE)
    if m:
        _set_if_empty("shipment.packages", m.group(1).strip())

    # Gross Wt  →  "Gross Wt  xxx.xx"
    m = re.search(r"\bGross\s+Wt\s+([\d,.]+)", text, re.IGNORECASE)
    if m:
        _set_if_empty("shipment.grossWeight", m.group(1).replace(",", ""))

    # Description / goods  →  "Description  I-BEAMS"
    m = re.search(r"(?<!\w)Description\s+([A-Z][A-Z0-9 ,\-]{2,60})(?:\n|Prepared|$)", text, re.IGNORECASE)
    if m:
        _set_if_empty("shipment.goodsDescription", m.group(1).strip())

    # ── Format B: company name, consignee, shipper ───────────────────────────
    # Issuer company name = first company-name line in BLRCH PDFs (before "TAX INVOICE")
    # Use re.search + MULTILINE so the "--- Page N ---" prefix doesn't block the match
    m = re.search(
        r"^([A-Z][A-Z ]{5,60}(?:PRIVATE\s+LIMITED|PVT\.?\s*LTD\.?|LIMITED|LTD|LLC|INC))\s*$",
        text, re.IGNORECASE | re.MULTILINE,
    )
    if m:
        _set_if_empty("issuer.companyName", m.group(1).strip())

    # Customer name from "Bill To" section  →  "Bill To\n<company name>"
    m = re.search(r"\bBill\s+To\s*\n([^\n]{4,80})", text, re.IGNORECASE)
    if m:
        val = m.group(1).strip()
        if val and len(re.findall(r"[A-Za-z]{3,}", val)) >= 2:
            curr = _clean(record.get("customer.name", ""))
            if not curr or _is_garbled(curr) or len(curr) < 8 or re.match(r'^[A-Za-z]{1,5}(?:/[A-Za-z]{1,5})+$', curr):
                record["customer.name"] = val

    # Consignee  →  "Consignee\n<name>"  (line below label, not same-line)
    m = re.search(r"\bConsignee\s*\n([^\n]{4,80})", text, re.IGNORECASE)
    if m:
        val = m.group(1).strip()
        # Reject if it looks like a sub-label or address continuation
        if val and not re.search(r"\b(GST|Code|State|GSTIN|PAN)\b", val, re.IGNORECASE):
            curr = _clean(record.get("shipment.consignee", ""))
            # Overwrite short project-code artifacts (real consignees have multiple words)
            if not curr or _is_garbled(curr) or len(re.findall(r"[A-Za-z]{3,}", curr)) < 2:
                record["shipment.consignee"] = val

    # Shipper  →  "Shipper\n<name>"  (line below label)
    m = re.search(r"\bShipper\s*\n([^\n]{4,80})", text, re.IGNORECASE)
    if m:
        val = m.group(1).strip()
        if val and not re.search(r"\b(GST|Code|State|GSTIN|PAN)\b", val, re.IGNORECASE):
            _set_if_empty("shipment.shipper", val)

    # ── Format A (BE-XXXX / freight company) patterns ─────────────────────────

    # Invoice number  →  "Invoice Number : 705-258861000551"
    m = re.search(r"\bInvoice\s+Number\s*[:\-]\s*([A-Z0-9][A-Z0-9\-/.]{3,})", text, re.IGNORECASE)
    if m:
        _set_if_empty("invoiceIdentification.invoiceNumber", m.group(1))

    # Invoice date  →  "Invoice Date / Date : 25-AUG-2025"
    m = re.search(
        r"\bInvoice\s+Date\s*(?:/\s*Date)?\s*[:\-]\s*(\d{1,2}[A-Za-z/\-]\S{1,12})",
        text, re.IGNORECASE,
    )
    if m and _DATE_RE.search(m.group(1)):
        _set_if_empty("invoiceIdentification.invoiceDate", m.group(1))

    # Job number  →  "Job Number : BE-250888610006-1"
    m = re.search(r"\bJob\s+Number\s*[:\-]\s*([A-Z0-9][A-Z0-9\-/.]{2,})", text, re.IGNORECASE)
    if m:
        _set_if_empty("job.number", m.group(1))

    # Job date  →  "Job Date : 16-AUG-2025"
    m = re.search(r"\bJob\s+Date\s*[:\-]\s*(\d{1,2}[A-Za-z/\-]\S{1,12})", text, re.IGNORECASE)
    if m and _DATE_RE.search(m.group(1)):
        _set_if_empty("job.date", m.group(1))

    # Due date  →  "Payment Due Date : 25-AUG-2025"
    m = re.search(
        r"\bPayment\s+Due\s+Date\s*[:\-]\s*(\d{1,2}[A-Za-z/\-]\S{1,12})",
        text, re.IGNORECASE,
    )
    if m and _DATE_RE.search(m.group(1)):
        _set_if_empty("invoiceIdentification.dueDate", m.group(1))

    # House Number / Project Name  →  "House Number : PROJ : ROCK CREEK"
    m = re.search(
        r"\bHouse\s+Number\s*[:\-]\s*(?:PROJ\s*[:\-]\s*)?([A-Z][A-Z0-9 ]{1,40})(?:\n|Master|$)",
        text, re.IGNORECASE,
    )
    if m:
        _set_if_empty("job.projectName", m.group(1).strip())

    # Master Number (MBL)  →  "Master Number : XXXX"
    m = re.search(r"\bMaster\s+Number\s*[:\-]\s*([A-Z0-9][A-Z0-9\-/.]{3,})", text, re.IGNORECASE)
    if m:
        _set_if_empty("shipment.mbl", m.group(1))

    # Voyage Number  →  "Voyage Number : 518"
    m = re.search(r"\bVoyage\s+Number\s*[:\-]\s*(\w[\w\-/.]{0,20})", text, re.IGNORECASE)
    if m:
        _set_if_empty("shipment.vesselVoyageImo", m.group(1))

    # Vessel (Format A)  →  "VESSEL : AFRICAN LUNDE"
    m = re.search(r"(?<!\w)VESSEL\s*[:\-]\s*([A-Z][A-Z ]{2,35})(?:\n|$)", text, re.IGNORECASE)
    if m:
        _set_if_empty("shipment.vesselName", m.group(1).strip())

    # Total in INR  →  "Total in INR : 1432649.00"
    m = re.search(r"\bTotal\s+in\s+INR\s*[:\-]?\s*([\d,]+(?:\.\d+)?)", text, re.IGNORECASE)
    if m:
        _set_if_empty("totals.grandTotalInr", m.group(1).replace(",", ""))

    # Amount in words  →  "Amount in Words : Fourteen Lakh..."  or  end of invoice
    m = re.search(
        r"\b(?:Amount|Total)\s+[Ii]n\s+[Ww]ords?\s*[:\-]?\s*(.{10,200}?)(?:\n|$)",
        text, re.IGNORECASE,
    )
    if m:
        _set_if_empty("totals.amountInWords", m.group(1).strip())


def _postprocess_extracted_record(doc_type: str, record: dict, raw_text: str) -> dict:
    def _value_is_labelish(text: str) -> bool:
        if not text:
            return True
        t = text.lower()
        if _looks_like_header_blob(text):
            return True
        return any(
            hint in t
            for hint in (
                "exporter's ref",
                "buyers order",
                "gst no",
                "invoice no",
                "& date",
            )
        )

    def _set_scalar_if_missing(dot_key: str, value: str) -> None:
        if not value:
            return
        existing = _clean_text(record.get(dot_key))
        if (not existing) or _looks_like_label(existing, dot_key) or _value_is_labelish(existing):
            record[dot_key] = value.strip()

    if doc_type != "Bill of Lading":
        if doc_type == "CHA":
            _postprocess_cha(record, raw_text or "")
            return record
        if doc_type == "Sales Invoices":
            _postprocess_sales_invoice(record, raw_text or "", _set_scalar_if_missing)
            return record
        if doc_type == "Packing List":
            text = raw_text or ""
            best_inv_no = ""
            best_inv_dt = ""
            best_po_no = ""
            best_po_dt = ""
            inv_match = re.search(
                r"Invoice\s*No\.?\s*&\s*Date[\s\S]{0,180}?\n([A-Z0-9][A-Z0-9/\-]+)\s*\n(?:DT\s*)?([0-9]{1,2}[-/][A-Za-z0-9]{2,9}[-/][0-9]{2,4})",
                text,
                flags=re.IGNORECASE,
            )
            if inv_match:
                best_inv_no = inv_match.group(1).strip()
                best_inv_dt = inv_match.group(2).strip()

            po_match = re.search(
                r"Buyers?\s*Order\s*No\.?\s*&\s*Date[\s\S]{0,220}?([A-Z0-9][A-Z0-9/\-]{5,})[\s\S]{0,80}?([0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4})",
                text,
                flags=re.IGNORECASE,
            )
            if po_match:
                best_po_no = po_match.group(1).strip()
                best_po_dt = po_match.group(2).strip()

            # Line-oriented fallback for highly wrapped headers.
            lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
            inv_no_re = re.compile(r"\b[A-Z]{2,8}/\d{1,10}/\d{2}-\d{2}\b", re.IGNORECASE)
            po_no_re = re.compile(r"\b[A-Z0-9]+-PO-[A-Z0-9-]+\b", re.IGNORECASE)
            date_re = re.compile(r"\b\d{1,2}[-/][A-Za-z0-9]{2,9}[-/]\d{2,4}\b")

            for idx, line in enumerate(lines):
                lline = line.lower()
                if "invoice no" in lline and "date" in lline:
                    window = lines[idx : idx + 10]
                    inv_no = next((m.group(0) for s in window for m in [inv_no_re.search(s)] if m), "")
                    inv_dt = ""
                    for s in window:
                        m = re.search(r"\bDT\s*([0-9]{1,2}[-/][A-Za-z0-9]{2,9}[-/][0-9]{2,4})\b", s, flags=re.IGNORECASE)
                        if m:
                            inv_dt = m.group(1)
                            break
                        md = date_re.search(s)
                        if md and not inv_dt:
                            inv_dt = md.group(0)
                    if inv_no:
                        best_inv_no = inv_no
                    if inv_dt:
                        best_inv_dt = inv_dt
                    break

            for idx, line in enumerate(lines):
                lline = line.lower()
                if "buyers order" in lline and "date" in lline:
                    window = lines[idx : idx + 12]
                    po_no = next((m.group(0) for s in window for m in [po_no_re.search(s)] if m), "")
                    po_dt = next((m.group(0) for s in window for m in [date_re.search(s)] if m), "")
                    if po_no:
                        best_po_no = po_no
                    if po_dt:
                        best_po_dt = po_dt
                    break

            if best_inv_no:
                record["header.invoiceNo"] = best_inv_no
            if best_inv_dt and _DATE_RE.search(best_inv_dt):
                record["header.invoiceDate"] = best_inv_dt
            if best_po_no and "PO" in best_po_no.upper():
                record["header.buyerPoNo"] = best_po_no
            if best_po_dt and _DATE_RE.search(best_po_dt):
                record["header.buyerPoDate"] = best_po_dt
        return record

    invoices = record.get("invoices")
    if not isinstance(invoices, list):
        invoices = []

    sb_key = "shipping_bills" if isinstance(record.get("shipping_bills"), list) else "shippingBills"
    shipping_bills = record.get(sb_key)
    if not isinstance(shipping_bills, list):
        shipping_bills = []

    parsed_inv = _parse_bol_raw_invoice_lines(raw_text or "")
    parsed_sb = _parse_bol_raw_sb_lines(raw_text or "")
    record["invoices"] = _override_from_raw(invoices, parsed_inv)
    record[sb_key] = _override_from_raw(shipping_bills, parsed_sb)
    return record


# ── PDF extraction ────────────────────────────────────────────────────────────

_OCR_STATE = {"missing_runtime_warned": False}


def _get_page_ocr_textpage(page, dpi: int = 250):
    """
    Return a PyMuPDF OCR textpage when tesseract is available, else None.
    """
    try:
        return page.get_textpage_ocr(flags=0, language="eng", dpi=dpi, full=True)
    except Exception as exc:
        msg = str(exc).lower()
        if (
            "tesseract" in msg or "tessdata" in msg
        ) and not _OCR_STATE["missing_runtime_warned"]:
            print(
                "[camelot_ocr][warn] OCR fallback requested but Tesseract is not "
                "installed/configured. Continuing with text-layer extraction only."
            )
            _OCR_STATE["missing_runtime_warned"] = True
        return None


def extract_pdf_context(
    pdf_path: str | Path,
    use_ocr_fallback: bool | None = None,
    ocr_dpi: int = 250,
) -> tuple[str, list[dict], dict]:
    """
    Extract text + words in one pass.
    Falls back to per-page OCR for image/scanned pages when enabled.
    """
    if use_ocr_fallback is None:
        use_ocr_fallback = _env_flag("CAMELOT_ENABLE_TESSERACT_OCR", default=True)

    pdf_path = Path(pdf_path)
    pages_text: list[str] = []
    words: list[dict] = []
    stats = {
        "pages_total": 0,
        "pages_with_text_layer": 0,
        "pages_with_ocr_fallback": 0,
        "words_total": 0,
    }

    with fitz.open(str(pdf_path)) as doc:
        for page_num, page in enumerate(doc):
            stats["pages_total"] += 1
            page_text = (page.get_text("text") or "").strip()
            page_words = page.get_text("words") or []
            used_ocr = False

            if use_ocr_fallback and (not page_text or not page_words):
                ocr_textpage = _get_page_ocr_textpage(page, dpi=ocr_dpi)
                if ocr_textpage is not None:
                    used_ocr = True
                    if not page_text:
                        page_text = (page.get_text("text", textpage=ocr_textpage) or "").strip()
                    if not page_words:
                        page_words = page.get_text("words", textpage=ocr_textpage) or []

            if page_text:
                pages_text.append(f"--- Page {page_num + 1} ---\n{page_text}")
                if not used_ocr:
                    stats["pages_with_text_layer"] += 1
            if used_ocr:
                stats["pages_with_ocr_fallback"] += 1

            for w in page_words:
                x0, y0, x1, y1, text, *_ = w
                t = str(text).strip()
                if not t:
                    continue
                words.append(
                    {
                        "page": page_num,
                        "x0": x0,
                        "y0": y0,
                        "x1": x1,
                        "y1": y1,
                        "text": t,
                    }
                )
                stats["words_total"] += 1

    return "\n\n".join(pages_text), words, stats


def extract_text_fitz(pdf_path: str | Path) -> str:
    text, _, _ = extract_pdf_context(pdf_path)
    return text


def extract_words_fitz(pdf_path: str | Path) -> list[dict]:
    _, words, _ = extract_pdf_context(pdf_path)
    return words


def _dedup_tables(tables: list[pd.DataFrame]) -> list[pd.DataFrame]:
    """Drop tables whose normalised column set is a proper subset of another larger table."""
    if len(tables) <= 1:
        return tables
    norm_cols = [
        frozenset(_normalize_col(str(c)) for c in df.columns if str(c).strip())
        for df in tables
    ]
    keep: list[pd.DataFrame] = []
    for i, df_a in enumerate(tables):
        cols_a = norm_cols[i]
        if not cols_a:
            keep.append(df_a)
            continue
        dominated = any(
            i != j
            and cols_a < norm_cols[j]
            and len(tables[j]) >= len(df_a)
            for j in range(len(tables))
        )
        if not dominated:
            keep.append(df_a)
    return keep if keep else tables


def extract_tables_camelot(pdf_path: str | Path) -> list[pd.DataFrame]:
    """Extract all tables, lattice first then stream (with better stream parameters)."""
    pdf_str = str(Path(pdf_path))
    results: list[pd.DataFrame] = []
    flavor_kwargs: dict[str, dict] = {
        "lattice": {},
        "stream": {"edge_tol": 500, "row_tol": 15},
    }
    for flavor, extra_kwargs in flavor_kwargs.items():
        try:
            tables = camelot.read_pdf(pdf_str, pages="all", flavor=flavor, **extra_kwargs)
            for tbl in tables:
                df = tbl.df.copy()
                if df.empty:
                    continue
                header_idx = _find_best_header_row_idx(df)
                if header_idx is not None:
                    header_row = [str(v).strip() for v in df.iloc[header_idx].tolist()]
                    df.columns = header_row
                    df = df.iloc[header_idx + 1 :].reset_index(drop=True)
                df = _promote_subheader_row(df)
                df = df.replace("", pd.NA).dropna(how="all").dropna(axis=1, how="all")
                df = df.fillna("").reset_index(drop=True)
                if not df.empty:
                    results.append(df)
        except Exception:
            pass
    return _dedup_tables(results)


def _find_best_header_row_idx(df: pd.DataFrame, max_scan_rows: int = 8) -> int | None:
    """Pick the most probable header row by scoring alias overlap."""
    if df.empty:
        return None

    target_tokens: set[str] = set()
    for aliases in _TABLE_COL_ALIASES.values():
        for alias in aliases:
            target_tokens.add(_normalize_col(alias))
    for field_name, aliases in FIELD_LABEL_ALIASES.items():
        target_tokens.add(_normalize_col(field_name))
        for alias in aliases:
            target_tokens.add(_normalize_col(alias))

    best_idx: int | None = None
    best_score = 0
    scan_rows = min(max_scan_rows, len(df))
    for ridx in range(scan_rows):
        row = df.iloc[ridx].tolist()
        score = 0
        non_empty = 0
        for cell in row:
            text = str(cell).strip()
            if not text:
                continue
            non_empty += 1
            nc = _normalize_col(text)
            if not nc:
                continue
            if nc in target_tokens:
                score += 3
            elif any(nc.endswith(tok) or tok.endswith(nc) for tok in target_tokens):
                score += 1
        if non_empty and score > best_score:
            best_score = score
            best_idx = ridx

    min_score = 2 if len(df.columns) <= 4 else 3
    return best_idx if best_score >= min_score else None


def _dedupe_header_names(headers: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out: list[str] = []
    for raw in headers:
        name = str(raw).strip()
        if not name:
            name = "col"
        count = seen.get(name, 0) + 1
        seen[name] = count
        out.append(name if count == 1 else f"{name}_{count}")
    return out


def _promote_subheader_row(df: pd.DataFrame) -> pd.DataFrame:
    """
    If columns are mostly blank but first data row looks like header fragments,
    merge both rows into a better header and drop the consumed row.
    """
    if df.empty:
        return df
    col_names = [str(c).strip() for c in df.columns]
    if sum(1 for c in col_names if c) >= len(col_names) - 1:
        return df

    first_row = [str(v).strip() for v in df.iloc[0].tolist()]
    if sum(1 for v in first_row if v) < 2:
        return df

    merged: list[str] = []
    for base, sub in zip(col_names, first_row):
        nbase = _normalize_col(base)
        nsub = _normalize_col(sub)
        if not base and sub:
            merged.append(sub)
        elif base and sub and nsub and nsub != nbase:
            merged.append(f"{base} {sub}")
        else:
            merged.append(base)

    if len({_normalize_col(m) for m in merged if m.strip()}) < 2:
        return df

    df = df.copy()
    df.columns = _dedupe_header_names(merged)
    return df.iloc[1:].reset_index(drop=True)


def _find_label_in_words(
    words: list[dict],
    label: str,
    row_tol: float = 4.0,
) -> list[dict]:
    """
    Return the list of word dicts where `label` starts.
    Matches multi-word labels by checking consecutive words on the same line.
    """
    label_tokens = _tokenize_for_match(label)
    if not label_tokens:
        return []
    first_tok = _norm_token(label_tokens[0])
    hits: list[dict] = []

    for i, w in enumerate(words):
        if _norm_token(w["text"]) != first_tok:
            continue
        if len(label_tokens) == 1:
            hits.append(w)
            continue
        # Verify remaining tokens appear consecutively on the same line/page
        matched = True
        last_x1 = w["x1"]
        page    = w["page"]
        j = i + 1
        for tok in label_tokens[1:]:
            tok_norm = _norm_token(tok)
            found = False
            while j < len(words):
                nw = words[j]
                if nw["page"] != page or nw["y0"] > w["y1"] + row_tol:
                    matched = False
                    break
                j += 1
                if _norm_token(nw["text"]) == tok_norm and nw["x0"] >= last_x1 - 4:
                    last_x1 = nw["x1"]
                    found = True
                    break
            if not found:
                matched = False
                break
        if matched:
            hits.append(w)
    return hits


def find_kv_spatial(
    words: list[dict],
    label: str,
    field_name: str,
    same_line_x_gap: float = 260.0,
    next_line_y_gap: float = 40.0,
    row_tol: float = 4.0,
) -> str:
    """
    Spatial value extraction: find `label` in word positions, then collect
    value words immediately to its right (same line) or directly below.
    Handles PDF layouts where colons are absent or the value is across the table.
    """
    label_hits = _find_label_in_words(words, label, row_tol)
    for hit in label_hits:
        page = hit["page"]
        ly0 = hit["y0"]
        ly1 = hit["y1"]
        line_words = [
            w for w in words
            if w["page"] == page and abs(w["y0"] - ly0) <= row_tol
        ]
        line_words = sorted(line_words, key=lambda x: x["x0"])
        label_x1 = _infer_label_end_x1(line_words, hit, label)

        same_line: list[str] = []
        for w in line_words:
            if w["x0"] <= label_x1:
                continue
            if w["x0"] > label_x1 + same_line_x_gap:
                break
            t = w["text"].strip(":=- \t")
            if t:
                if (t.endswith(":") or w["text"].rstrip().endswith(":")) and same_line:
                    break
                same_line.append(t)  # use cleaned token, not raw (avoids ": value" artifacts)
        multiline = _wants_multiline(field_name)

        if same_line:
            val = " ".join(same_line).strip().lstrip(":=- ")
            if multiline:
                # Augment with continuation lines (e.g. multi-line addresses)
                cont = _collect_continuation_lines(
                    words, page, ly1, hit["x0"], row_tol, next_line_y_gap, max_lines=3
                )
                if cont:
                    val = val + " " + " ".join(cont)
            cleaned = _clean_value_for_field(val, field_name)
            if not is_rejected(cleaned, field_name=field_name, label=label):
                return cleaned

        # Below-value collection — wider x-range, multi-line for address/description fields
        max_below_lines = 4 if multiline else 1
        below_y_max = ly1 + next_line_y_gap * max_below_lines
        x_lo = hit["x0"] - 50
        x_hi = hit["x1"] + (340 if multiline else 180)

        below_by_y: dict[float, list[tuple[float, str]]] = {}
        for w in words:
            if w["page"] != page:
                continue
            if w["y0"] < ly1:
                continue
            if w["y0"] > below_y_max:
                continue
            if w["x0"] < x_lo or w["x0"] > x_hi:
                continue
            t = w["text"].strip()
            if not t:
                continue
            gy = round(w["y0"] / row_tol) * row_tol
            below_by_y.setdefault(gy, []).append((w["x0"], t))

        if below_by_y:
            below_parts: list[str] = []
            for gy in sorted(below_by_y.keys()):
                row_words = sorted(below_by_y[gy], key=lambda x: x[0])
                line_text = " ".join(t for _, t in row_words).strip()
                if not line_text:
                    continue
                # Stop if this looks like a bare new label
                if line_text.endswith(":") and not re.search(r"\w{3,}.*\w", line_text[:-1].strip()):
                    break
                below_parts.append(line_text)
                if not multiline:
                    break
            if below_parts:
                val = " ".join(below_parts).strip()
                cleaned = _clean_value_for_field(val, field_name)
                if not is_rejected(cleaned, field_name=field_name, label=label):
                    return cleaned

    return ""


def _infer_label_end_x1(line_words: list[dict], hit: dict, label: str) -> float:
    """Estimate the right edge of a multi-token label on a line."""
    label_tokens = [_norm_token(t) for t in _tokenize_for_match(label)]
    if not label_tokens:
        return hit["x1"]

    hit_idx = None
    for idx, w in enumerate(line_words):
        if (
            w["x0"] == hit["x0"]
            and w["x1"] == hit["x1"]
            and w["page"] == hit["page"]
        ):
            hit_idx = idx
            break
    if hit_idx is None:
        return hit["x1"]

    cursor = hit_idx
    end_x1 = hit["x1"]
    for tok in label_tokens[1:]:
        found = False
        j = cursor + 1
        while j < len(line_words):
            nw = line_words[j]
            if nw["x0"] - end_x1 > 80:
                break
            if _norm_token(nw["text"]) == tok:
                end_x1 = nw["x1"]
                cursor = j
                found = True
                break
            j += 1
        if not found:
            break
    return end_x1


_KV_CACHE: dict[str, str] = {}

# Fields whose values span multiple lines (addresses, descriptions, declarations).
_MULTILINE_FIELD_KWS: frozenset[str] = frozenset({
    "address", "description", "goods", "declaration", "statement",
    "remark", "narration", "particulars", "note",
})


def _wants_multiline(field_name: str) -> bool:
    nf = _norm_field(field_name)
    return any(kw in nf for kw in _MULTILINE_FIELD_KWS)


def _collect_continuation_lines(
    words: list[dict],
    page: int,
    y_start: float,
    x_ref: float,
    row_tol: float,
    line_gap: float,
    max_lines: int = 3,
) -> list[str]:
    """Collect text lines immediately below y_start, roughly right of x_ref.
    Stops when it hits a bare label line (ending in ':' with no real content).
    """
    lines_by_y: dict[float, list[tuple[float, str]]] = {}
    y_limit = y_start + line_gap * max_lines
    for w in words:
        if w["page"] != page:
            continue
        if w["y0"] < y_start + row_tol:
            continue
        if w["y0"] > y_limit:
            continue
        if w["x0"] < x_ref - 20:
            continue
        t = w["text"].strip()
        if not t:
            continue
        gy = round(w["y0"] / row_tol) * row_tol
        lines_by_y.setdefault(gy, []).append((w["x0"], t))

    result: list[str] = []
    for gy in sorted(lines_by_y.keys()):
        row_words = sorted(lines_by_y[gy], key=lambda x: x[0])
        line_text = " ".join(t for _, t in row_words).strip()
        if not line_text:
            continue
        # Stop if this line looks like a bare field label (ends ':' with no real value before it)
        if line_text.endswith(":") and not re.search(r"\w{3,}.*\w", line_text[:-1].strip()):
            break
        result.append(line_text)
    return result


def find_kv(text: str, label: str, field_name: str | None = None) -> str:
    """
    Regex-based KV extraction for a single label string.
    Tries: "Label: value" → "Label\\nvalue" → "Label value".
    """
    field_name = field_name or label
    cache_key  = f"{_normalize_col(label)}||{_normalize_col(field_name)}||{_hashlib.md5(text[:2000].encode('utf-8', errors='ignore')).hexdigest()[:12]}"
    if cache_key in _KV_CACHE:
        return _KV_CACHE[cache_key]

    safe = re.escape(label).replace(r"\ ", r"[\s\-_/]*")
    patterns = (
        rf"{safe}\s*[:\-]\s*([^\n|]{{1,120}})",   # same-line colon/dash
        rf"{safe}\s*\n+\s*([^\n]{{1,120}})",       # value on next line
        rf"{safe}\s+([A-Za-z0-9][^\n]{{2,80}})",    # inline no colon
    )
    for pat in patterns:
        for m in re.finditer(pat, text, re.IGNORECASE):
            raw     = m.group(1).strip().rstrip("|").strip()
            cleaned = _clean_value_for_field(raw, field_name)
            if not is_rejected(cleaned, field_name=field_name, label=label):
                _KV_CACHE[cache_key] = cleaned
                return cleaned

    _KV_CACHE[cache_key] = ""
    return ""


def build_lines_from_words(words: list[dict], row_tol: float = 3.5) -> list[dict]:
    """
    Build ordered text lines from word boxes for fallback KV extraction.
    """
    if not words:
        return []
    ordered = sorted(words, key=lambda w: (w["page"], round(w["y0"], 1), w["x0"]))
    lines: list[dict] = []
    current = None
    for w in ordered:
        if current is None:
            current = {
                "page": w["page"],
                "y0": w["y0"],
                "y1": w["y1"],
                "words": [w],
            }
            continue
        if w["page"] == current["page"] and abs(w["y0"] - current["y0"]) <= row_tol:
            current["words"].append(w)
            current["y1"] = max(current["y1"], w["y1"])
        else:
            line_words = sorted(current["words"], key=lambda x: x["x0"])
            line_text = " ".join(str(x["text"]).strip() for x in line_words).strip()
            lines.append(
                {
                    "page": current["page"],
                    "y0": current["y0"],
                    "y1": current["y1"],
                    "text": line_text,
                }
            )
            current = {
                "page": w["page"],
                "y0": w["y0"],
                "y1": w["y1"],
                "words": [w],
            }
    if current is not None:
        line_words = sorted(current["words"], key=lambda x: x["x0"])
        line_text = " ".join(str(x["text"]).strip() for x in line_words).strip()
        lines.append(
            {
                "page": current["page"],
                "y0": current["y0"],
                "y1": current["y1"],
                "text": line_text,
            }
        )
    return lines


def find_kv_linewise(
    lines: list[dict],
    label: str,
    field_name: str,
    max_next_lines: int = 2,
) -> str:
    """
    Fallback line-based KV extraction for layouts where spatial/regex miss.
    """
    if not lines:
        return ""
    safe = re.escape(label).replace(r"\ ", r"[\s\W_]*")
    label_pat = re.compile(rf"{safe}\s*[:\-]?\s*(.*)$", re.IGNORECASE)

    for idx, line in enumerate(lines):
        line_text = str(line.get("text", "")).strip()
        if not line_text:
            continue
        m = label_pat.search(line_text)
        if not m:
            continue

        same_line_val = (m.group(1) or "").strip()
        if same_line_val:
            cleaned = _clean_value_for_field(same_line_val, field_name)
            if not is_rejected(cleaned, field_name=field_name, label=label):
                return cleaned

        base_page = line["page"]
        for j in range(idx + 1, min(len(lines), idx + 1 + max_next_lines)):
            nxt = lines[j]
            if nxt["page"] != base_page:
                break
            cand = str(nxt.get("text", "")).strip()
            if not cand or cand.endswith(":"):
                continue
            cleaned = _clean_value_for_field(cand, field_name)
            if not is_rejected(cleaned, field_name=field_name, label=label):
                return cleaned
    return ""


def find_kv_multi(
    text: str,
    words: list[dict],
    field_name: str,
    field_name_for_key: str | None = None,
    lines: list[dict] | None = None,
    aliases_override: list[str] | None = None,
) -> str:
    """
    High-accuracy extraction for `field_name`:
      1. Try spatial extraction for each alias.
      2. Try regex extraction for each alias.
    Returns the first non-empty, non-rejected value.
    """
    fname_key = field_name_for_key or field_name
    aliases = aliases_override or _get_field_aliases(field_name)

    # Spatial pass (most reliable for complex layouts)
    for alias in aliases:
        val = find_kv_spatial(words, alias, fname_key)
        if val:
            return val

    # Line-wise pass (helps with key-value blocks in tables)
    if lines:
        _max_next = 4 if _wants_multiline(field_name) else 2
        for alias in aliases:
            val = find_kv_linewise(lines, alias, fname_key, max_next_lines=_max_next)
            if val:
                return val

    # Regex pass
    for alias in aliases:
        val = find_kv(text, alias, fname_key)
        if val:
            return val

    return ""


# ── Table matching ────────────────────────────────────────────────────────────

def _alias_norm_set(field_names: list[str]) -> set[str]:
    """Normalised set of all aliases for `field_names` (for table scoring)."""
    norms: set[str] = set()
    for fn in field_names:
        norms.add(_normalize_col(fn))
        for alias in _get_field_aliases(fn):
            norms.add(_normalize_col(alias))
    # Add generic table column aliases
    for aliases in _TABLE_COL_ALIASES.values():
        for a in aliases:
            norms.add(_normalize_col(a))
    return norms


def find_best_table(tables: list[pd.DataFrame], field_names: list[str]) -> pd.DataFrame | None:
    """
    Return the DataFrame whose column headers best overlap with `field_names`
    (including aliases).
    """
    norm_fields = _alias_norm_set(field_names)
    best_df: pd.DataFrame | None = None
    best_score = 0

    for df in tables:
        score = 0
        for col in df.columns:
            nc = _normalize_col(str(col))
            if any(nc == nf or nc.endswith(nf) or nf.endswith(nc)
                   for nf in norm_fields):
                score += 1
        if score > best_score:
            best_score = score
            best_df = df

    return best_df if best_score > 0 else None


def find_all_candidate_tables(
    tables: list[pd.DataFrame],
    field_names: list[str],
    min_score: int = 2,
) -> list[pd.DataFrame]:
    """
    Return all tables with meaningful overlap for target fields.
    Useful for split/multi-page array tables.
    """
    norm_fields = _alias_norm_set(field_names)
    candidates: list[tuple[int, pd.DataFrame]] = []
    for df in tables:
        score = 0
        for col in df.columns:
            nc = _normalize_col(str(col))
            if any(nc == nf or nc.endswith(nf) or nf.endswith(nc)
                   for nf in norm_fields):
                score += 1
        if score >= min_score:
            candidates.append((score, df))
    candidates.sort(key=lambda x: x[0], reverse=True)
    return [df for _, df in candidates]


def _extract_value_after_label(text: str) -> str:
    if not text:
        return ""
    parts = re.split(r"\s*[:\-]\s*", text, maxsplit=1)
    if len(parts) == 2:
        return parts[1].strip()
    return ""


def find_kv_from_tables(
    tables: list[pd.DataFrame],
    aliases: list[str],
    field_name: str,
) -> str:
    alias_norms = [_normalize_col(a) for a in aliases if _normalize_col(a)]
    if not alias_norms:
        return ""

    for df in tables:
        if df.empty:
            continue
        # Use positional indexing to avoid pandas returning a Series for duplicate column names.
        col_count = len(df.columns)
        rows = []
        for _, row in df.iterrows():
            cells = []
            for i in range(col_count):
                try:
                    val = row.iloc[i]
                    cells.append(str(val).strip() if pd.notna(val) else "")
                except Exception:
                    cells.append("")
            rows.append(cells)

        for ridx, cells in enumerate(rows):
            for cidx, cell in enumerate(cells):
                if not cell:
                    continue
                ncell = _normalize_col(cell)
                if not ncell:
                    continue
                matched = False
                for alias_norm in alias_norms:
                    if ncell == alias_norm or ncell.startswith(alias_norm) or alias_norm in ncell:
                        matched = True
                        break
                if not matched:
                    continue

                # For multi-line cells containing several "label: value" pairs,
                # search within the cell's own lines for the specific alias first.
                candidate = ""
                if "\n" in cell:
                    for ln in cell.split("\n"):
                        ln = ln.strip()
                        if not ln:
                            continue
                        nln = _normalize_col(ln)
                        for alias_norm in alias_norms:
                            if alias_norm in nln or nln.startswith(alias_norm):
                                val = _extract_value_after_label(ln)
                                if val:
                                    candidate = val
                                    break
                        if candidate:
                            break

                if not candidate:
                    candidate = _extract_value_after_label(cell)
                if not candidate:
                    for j in range(cidx + 1, len(cells)):
                        right = cells[j].strip()
                        if right:
                            candidate = right
                            break
                if not candidate and ridx + 1 < len(rows):
                    below = rows[ridx + 1][cidx].strip() if cidx < len(rows[ridx + 1]) else ""
                    if below:
                        candidate = below

                if not candidate:
                    continue
                cleaned = _clean_value_for_field(candidate, field_name)
                if not is_rejected(cleaned, field_name=field_name, label=" ".join(aliases[:1])):
                    return cleaned
    return ""


def _match_col_to_field(col: str, field_names: list[str]) -> str | None:
    """Return the best-matching field name for a table column, or None."""
    nc = _normalize_col(col)
    if not nc:
        return None
    # 1. Exact match
    for fn in field_names:
        if nc == _normalize_col(fn):
            return fn
    # 2. Alias exact match
    for fn in field_names:
        for alias in _get_field_aliases(fn):
            if nc == _normalize_col(alias):
                return fn
    # 3. Suffix match (e.g. "Total Amount" ends with "Amount")
    for fn in field_names:
        nf = _normalize_col(fn)
        if len(nc) >= 3 and len(nf) >= 3 and (nc.endswith(nf) or nf.endswith(nc)):
            return fn
    # 4. Alias suffix match
    for fn in field_names:
        for alias in _get_field_aliases(fn):
            na = _normalize_col(alias)
            if len(nc) >= 3 and len(na) >= 3 and (nc.endswith(na) or na.endswith(nc)):
                return fn

    # 5. Fuzzy string similarity fallback (handles OCR typos like "BUDLE")
    best_field: str | None = None
    best_score = 0.0
    for fn in field_names:
        for alias in [fn, *_get_field_aliases(fn)]:
            na = _normalize_col(alias)
            if not na:
                continue
            score = SequenceMatcher(None, nc, na).ratio()
            if score > best_score:
                best_score = score
                best_field = fn
    if best_field and best_score >= 0.78:
        return best_field

    # 6. Token overlap fallback for long, noisy headers.
    col_tokens = set(_tokenize_for_match(col))
    if col_tokens:
        best_field = None
        best_overlap = 0
        for fn in field_names:
            for alias in [fn, *_get_field_aliases(fn)]:
                alias_tokens = set(_tokenize_for_match(alias))
                overlap = len(col_tokens & alias_tokens)
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_field = fn
        if best_field and best_overlap >= 2:
            return best_field
    return None


def table_to_records(df: pd.DataFrame, field_names: list[str]) -> list[dict]:
    """
    Map a Camelot DataFrame to a list of dicts keyed by human-readable
    `field_names` using alias-aware column matching.
    Drops noise rows; cleans and validates each cell.
    """
    col_map: dict[str, str] = {}
    for col in df.columns:
        matched = _match_col_to_field(str(col), field_names)
        col_map[col] = matched if matched else str(col)

    records: list[dict] = []
    for _, row in df.iterrows():
        row_values = [str(row.get(c, "")).strip() for c in df.columns]
        if is_noise_row(row_values):
            continue

        rec: dict[str, str] = {fn: "" for fn in field_names}
        matched_any = False
        for col, fname in col_map.items():
            if fname not in rec:
                continue
            raw = str(row.get(col, "")).strip()
            if not raw:
                continue
            cleaned = _clean_value_for_field(raw, fname)
            if is_rejected(cleaned, field_name=fname, label=str(col)):
                continue
            rec[fname] = cleaned
            matched_any = True

        if matched_any and any(v for v in rec.values()):
            records.append(rec)

    records = _merge_sparse_array_records(records, field_names)
    return dedupe_records(records)


def extract_document(pdf_path: str | Path, doc_type: str) -> dict:
    """
    Extract all fields for `doc_type` from `pdf_path`.

    Returns a flat dict with dotted camelCase keys identical to Gemini's
    flatten_record() output, e.g. "header.invoiceNo", "lineItems" (list).
    """
    pdf_path = Path(pdf_path)
    schema = load_schema(doc_type)
    text, words, ctx_stats = extract_pdf_context(pdf_path)
    lines = build_lines_from_words(words)
    tables = extract_tables_camelot(pdf_path)

    section_map, field_map, key_style = _get_key_maps(doc_type)
    array_section_names = set(DOC_TYPE_CONFIG[doc_type]["array_sections"])

    by_section: dict[str, list[dict]] = {}
    section_order: list[str] = []
    for row in schema:
        sec = (row.get("section") or "General").strip()
        if sec not in by_section:
            by_section[sec] = []
            section_order.append(sec)
        by_section[sec].append(row)

    record: dict = {"source_file": pdf_path.name}

    for sec in section_order:
        fields   = by_section[sec]
        sec_jkey = _section_json_key(sec, section_map, key_style)
        fnames   = [f["fieldName"] for f in fields]

        if sec in array_section_names:
            # ?????? Array section ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
            candidate_tables = find_all_candidate_tables(tables, fnames)
            if candidate_tables:
                raw_rows: list[dict] = []
                for tdf in candidate_tables:
                    raw_rows.extend(table_to_records(tdf, fnames))
                raw_rows = dedupe_records(raw_rows)
            else:
                kv_row: dict[str, str] = {}
                for fname in fnames:
                    aliases = build_doc_field_aliases(sec, fname, field_map, key_style)
                    val = find_kv_multi(
                        text,
                        words,
                        fname,
                        lines=lines,
                        aliases_override=aliases,
                    )
                    if val:
                        kv_row[fname] = val
                raw_rows = [kv_row] if kv_row else []
            # Translate human field names → canonical JSON keys
            json_rows = [
                {_field_json_key(k, field_map, key_style): v
                 for k, v in r.items() if v}
                for r in raw_rows
            ]
            record[sec_jkey] = json_rows

        else:
            # ── Scalar section ─────────────────────────────────────────────
            for fname in fnames:
                fj  = _field_json_key(fname, field_map, key_style)
                key = f"{sec_jkey}.{fj}" if sec_jkey else fj
                aliases = build_doc_field_aliases(sec, fname, field_map, key_style)
                table_val = find_kv_from_tables(
                    tables=tables,
                    aliases=aliases,
                    field_name=fname,
                )
                if table_val:
                    record[key] = table_val
                else:
                    record[key] = find_kv_multi(
                        text,
                        words,
                        fname,
                        fname,
                        lines=lines,
                        aliases_override=aliases,
                    )

    if (
        ctx_stats.get("words_total", 0) == 0
        and ctx_stats.get("pages_with_ocr_fallback", 0) == 0
    ):
        print(
            "[camelot_ocr][warn] No text extracted from PDF pages. "
            "Install/configure Tesseract and set CAMELOT_ENABLE_TESSERACT_OCR=1 "
            "for scanned/image PDFs."
        )
    return _postprocess_extracted_record(doc_type, record, text)


def extract_document_lenient(pdf_path: str | Path, doc_type: str) -> dict:
    """Strict extraction first; for any empty scalar field, re-extracts with
    lenient rejects (validators + header-blob checks disabled) as a fallback.

    This ensures raw values that fail format validators still get captured
    rather than left blank.
    """
    strict = extract_document(pdf_path, doc_type)

    empty_keys = {
        k for k, v in strict.items()
        if not isinstance(v, list) and not str(v).strip()
    }
    if not empty_keys:
        return strict

    with lenient_extraction():
        raw = extract_document(pdf_path, doc_type)

    merged = dict(strict)
    for k in empty_keys:
        raw_val = raw.get(k, "")
        if raw_val and str(raw_val).strip():
            merged[k] = raw_val
    return merged


# ── Row expansion ─────────────────────────────────────────────────────────────

def _expand_rows(
    record: dict,
    expand_key: str,
    source: str,
    prefix: str | None = None,
    doc_type: str | None = None,
) -> list[dict]:
    """
    Expand the list at record[expand_key] into one dict per item.

    prefix controls the column-name prefix for expanded item fields:
      - None (default): use expand_key itself  e.g. "lineItems.hsnCode"
      - explicit str:   use that prefix        e.g. "export_invoice.invoice_number"
    This lets per-doc configs override the prefix to match template column headings.
    """
    flat = flatten_record(record)
    flat.pop("source", None)

    base: dict[str, object] = dict(flat)
    base.pop("source_file", None)
    base["source_file"] = source
    base.pop(expand_key, None)

    items = record.get(expand_key)
    if not isinstance(items, list) or not items:
        if doc_type == "Sales Invoices":
            total_quantity = _compute_total_quantity(items if isinstance(items, list) else [])
            if total_quantity:
                base["shipment.noOfPackages"] = total_quantity
        return [base]

    col_prefix = prefix if prefix is not None else expand_key
    prepared_items = items
    if doc_type == "Sales Invoices" and col_prefix == "lineItems":
        prepared_items = []
        for raw_item in items:
            if not isinstance(raw_item, dict):
                prepared_items.append(raw_item)
                continue
            repaired = _repair_sales_invoice_line_item_fields(dict(raw_item))
            if _is_sales_line_item_aggregate(repaired):
                continue
            prepared_items.append(repaired)
        total_quantity = _compute_total_quantity([it for it in prepared_items if isinstance(it, dict)])
        if total_quantity:
            base["shipment.noOfPackages"] = total_quantity

    bol_sbs: list = []
    if doc_type == "Bill of Lading":
        for sb_key in ("shipping_bills", "shippingBills"):
            maybe = record.get(sb_key)
            if isinstance(maybe, list):
                bol_sbs = maybe
                break

    def _pick(d: dict, keys: list[str]) -> str:
        for key in keys:
            val = d.get(key)
            if val is None:
                continue
            txt = str(val).strip()
            if txt:
                return txt
        return ""

    rows: list[dict[str, object]] = []
    for idx, item in enumerate(prepared_items, start=1):
        row = dict(base)
        if isinstance(item, dict):
            for k, v in item.items():
                row[f"{col_prefix}.{k}"] = v
            if doc_type == "Bill of Lading":
                row["invoice_number"] = _pick(item, ["invoice_number", "invoiceNumber"])
                row["invoice_date"] = _pick(item, ["invoice_date", "invoiceDate"])
                sb_item = bol_sbs[idx - 1] if idx - 1 < len(bol_sbs) and isinstance(bol_sbs[idx - 1], dict) else {}
                row["shipping_bill_number"] = _pick(sb_item, ["shipping_bill_number", "shippingBillNumber"])
                row["shipping_bill_date"] = _pick(sb_item, ["shipping_bill_date", "shippingBillDate"])
        else:
            row[f"{col_prefix}.rowIndex"] = idx
            row[f"{col_prefix}.value"] = json.dumps(item, ensure_ascii=False)
        rows.append(row)
    return rows


def _clean_text(value: object) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() in {"nan", "none", "null"}:
        return ""
    return re.sub(r"\s+", " ", text)


def _split_description_and_spec(text: str) -> tuple[str, str]:
    cleaned = _clean_text(text)
    if not cleaned:
        return "", ""

    dim_match = _SPEC_DIMENSION_PATTERN.search(cleaned)
    if dim_match and dim_match.start() > 2:
        left = cleaned[: dim_match.start()].strip(" ,;:-")
        right = cleaned[dim_match.start() :].strip(" ,;:-")
        if left and right:
            return left, right

    marker_match = _SPEC_MARKER_PATTERN.search(cleaned)
    if marker_match and marker_match.start() > 2:
        left = cleaned[: marker_match.start()].strip(" ,;:-")
        right = cleaned[marker_match.start() :].strip(" ,;:-")
        if left and right:
            return left, right

    return cleaned, ""


def _repair_sales_invoice_line_item_fields(item: dict) -> dict:
    code = _clean_text(item.get("productCode"))
    desc = _clean_text(item.get("productDescription"))
    spec = _clean_text(item.get("productSpecification"))

    if not code:
        for source_name, source_value in (("desc", desc), ("spec", spec)):
            if not source_value:
                continue
            leading = _PRODUCT_CODE_PATTERN.match(source_value)
            if not leading:
                continue
            code = leading.group(0)
            remainder = source_value[leading.end() :].strip(" ,;:-")
            if source_name == "desc":
                desc = remainder
            else:
                spec = remainder
            break

    if code:
        leading = _PRODUCT_CODE_PATTERN.match(code)
        if leading:
            trailing = code[leading.end() :].strip(" ,;:-")
            code = leading.group(0)
            if trailing and not desc:
                desc = trailing

    if desc:
        leading = _PRODUCT_CODE_PATTERN.match(desc)
        if leading:
            if not code:
                code = leading.group(0)
            desc = desc[leading.end() :].strip(" ,;:-")

    if desc and not spec:
        split_desc, split_spec = _split_description_and_spec(desc)
        if split_spec:
            desc = split_desc
            spec = split_spec

    _repair_sales_invoice_quantity_and_unit(item)
    _repair_sales_invoice_combined_package_fields(item)

    item["productCode"] = code
    item["productDescription"] = desc
    item["productSpecification"] = spec
    return item


def _normalize_missing_marker(text: str) -> str:
    cleaned = _clean_text(text)
    if cleaned in {"-", "--", "—", "NA", "N/A", "na", "n/a"}:
        return ""
    return cleaned


def _repair_sales_invoice_quantity_and_unit(item: dict) -> None:
    raw_qty = item.get("quantity")
    raw_text = str(raw_qty or "")
    lines = [_clean_text(x) for x in raw_text.splitlines() if _clean_text(x)]
    qty = _clean_text(raw_qty)
    unit = _clean_text(item.get("unit"))

    if len(lines) >= 2:
        first, second = lines[0], lines[1]
        if re.search(r"\d", second) and not re.search(r"\d", first):
            unit = unit or first
            qty = second
        elif re.search(r"\d", first) and not re.search(r"\d", second):
            qty = first
            unit = unit or second

    if not qty:
        qty = _clean_text(raw_qty)

    if qty:
        numeric_match = re.search(r"-?\d[\d,]*(?:\.\d+)?", qty)
        if numeric_match:
            qty = numeric_match.group(0).replace(",", "")

    if not unit:
        joined = " ".join(lines) if lines else _clean_text(raw_qty)
        if joined:
            m = re.search(
                r"(?:^|\s)(NOS|PCS|PKGS?|BUNDLES?|CTNS?|BOXES?|CARTONS?|PALLETS?)\b",
                joined,
                flags=re.IGNORECASE,
            )
            if m:
                unit = m.group(1).upper()

    # Derive quantity when only rate and line total are present.
    if not qty:
        rate_val = _parse_numeric_quantity(item.get("rate"))
        total_val = _parse_numeric_quantity(item.get("lineTotal"))
        if rate_val and total_val:
            derived = total_val / rate_val if rate_val else None
            if derived is not None:
                if abs(round(derived) - derived) < 0.01:
                    qty = str(int(round(derived)))
                else:
                    qty = f"{derived:.3f}".rstrip("0").rstrip(".")

    item["quantity"] = qty
    if unit:
        item["unit"] = unit


def _is_sales_line_item_aggregate(item: dict) -> bool:
    if not isinstance(item, dict):
        return False
    identity_fields = (
        "productCode",
        "productDescription",
        "productMarks",
        "noOfPackages",
        "quantity",
    )
    if any(_clean_text(item.get(k)) for k in identity_fields):
        return False
    numeric_fields = ("lineTotal", "rate", "taxAmountPerLine", "taxAmount")
    present_numeric = [k for k in numeric_fields if _clean_text(item.get(k))]
    return bool(present_numeric)


def _repair_sales_invoice_combined_package_fields(item: dict) -> None:
    blob = _clean_text(item.get("noOfPackages"))
    if not blob:
        return

    stop_tokens = (
        "bank details",
        "we declare",
        "account number",
        "swift:",
        "account name:",
        "branch name:",
    )
    lines = [
        _normalize_missing_marker(part)
        for part in re.split(r"[\r\n]+", str(item.get("noOfPackages") or ""))
    ]
    cleaned_lines: list[str] = []
    for line in lines:
        if not line:
            continue
        ll = line.lower()
        if any(tok in ll for tok in stop_tokens):
            break
        cleaned_lines.append(line)
    lines = cleaned_lines
    if not lines:
        return

    package_idx = next((i for i, line in enumerate(lines) if _PACKAGE_LINE_PATTERN.search(line)), None)
    if package_idx is None:
        package_idx = 1 if len(lines) > 1 else 0

    marks_parts = lines[:package_idx] if package_idx > 0 else []
    no_of_packages = lines[package_idx] if package_idx < len(lines) else ""
    tail = lines[package_idx + 1 :] if package_idx + 1 < len(lines) else []

    container_no = ""
    seal_no = ""
    bo_code = ""

    if tail:
        first = tail.pop(0)
        if first.startswith("-"):
            marks_parts.append(first.strip("- ").strip())
        elif "/" in first and not first.startswith("http"):
            left, right = first.split("/", 1)
            container_no = _normalize_missing_marker(left)
            seal_no = _normalize_missing_marker(right)
        else:
            container_no = _normalize_missing_marker(first)

    if tail and not seal_no:
        seal_no = _normalize_missing_marker(tail.pop(0))
    if tail:
        bo_code = _normalize_missing_marker(tail.pop(0))

    if container_no and marks_parts and marks_parts[-1].endswith("-") and _CODE_LIKE_LINE_PATTERN.match(container_no) and not seal_no and not bo_code:
        marks_parts[-1] = f"{marks_parts[-1]} {container_no}".replace("  ", " ").strip()
        container_no = ""
    if bo_code and marks_parts and marks_parts[-1].endswith("-") and _CODE_LIKE_LINE_PATTERN.match(bo_code):
        marks_parts[-1] = f"{marks_parts[-1]} {bo_code}".replace("  ", " ").strip()
        bo_code = ""

    product_marks = _clean_text(" ".join(marks_parts))
    if product_marks and not _clean_text(item.get("productMarks")):
        item["productMarks"] = product_marks

    if no_of_packages:
        item["noOfPackages"] = no_of_packages

    def _ok_token(text: str) -> bool:
        t = _clean_text(text)
        if not t:
            return False
        if len(t) > 20:
            return False
        if " " in t:
            return False
        if any(ch in t for ch in (":", ",")):
            return False
        return bool(re.search(r"[A-Z0-9]", t, flags=re.IGNORECASE))

    container_no = container_no if _ok_token(container_no) else ""
    seal_no = seal_no if _ok_token(seal_no) else ""
    bo_code = bo_code if _ok_token(bo_code) else ""

    if container_no and not _clean_text(item.get("containerNo")):
        item["containerNo"] = container_no
    if seal_no and not _clean_text(item.get("sealNo")):
        item["sealNo"] = seal_no
    if bo_code and not _clean_text(item.get("boCode")):
        item["boCode"] = bo_code

    if no_of_packages:
        unit_match = re.search(
            r"(PKG|PKGS|PCS|BUNDLE|BUNDLES|CTN|CTNS|BOX|BOXES|CARTON|CARTONS|PALLET|PALLETS|NOS)\b",
            no_of_packages,
            flags=re.IGNORECASE,
        )
        if unit_match and not _clean_text(item.get("kindOfPkg")):
            item["kindOfPkg"] = unit_match.group(1).upper()


def _parse_numeric_quantity(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    match = re.search(r"-?\d[\d,]*(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except Exception:
        return None


def _compute_total_quantity(items: list[object]) -> str:
    total = 0.0
    has_any = False
    for item in items:
        if not isinstance(item, dict):
            continue
        qty = _parse_numeric_quantity(item.get("quantity"))
        if qty is None:
            continue
        total += qty
        has_any = True

    if not has_any:
        return ""
    if float(total).is_integer():
        return str(int(total))
    return f"{total:.3f}".rstrip("0").rstrip(".")


def _postprocess_main_df(doc_type: str, raw_df: pd.DataFrame, df: pd.DataFrame) -> pd.DataFrame:
    if doc_type != "Sales Invoices":
        return df

    for col in ("parse_error", "flags", "raw_response"):
        if col in raw_df.columns and col not in df.columns:
            df[col] = raw_df[col]

    if "Shipment - No Of Packages" in df.columns:
        old_col = "Shipment - No Of Packages"
        insert_at = df.columns.get_loc(old_col)
        df.insert(insert_at, "Shipment - Total Quantity", df[old_col])
        df = df.drop(columns=[old_col])

    # When template matching maps "Shipment - No Of Packages" from line-item columns,
    # recompute invoice-level total quantity from raw expanded line items.
    if "Shipment - Total Quantity" in df.columns and "lineItems.quantity" in raw_df.columns:
        totals_by_source: dict[str, str] = {}
        if "source_file" in raw_df.columns:
            for src, g in raw_df.groupby("source_file", dropna=False):
                total = _compute_total_quantity(
                    [{"quantity": v} for v in g["lineItems.quantity"].tolist()]
                )
                totals_by_source[str(src)] = total
        source_col = "Source File" if "Source File" in df.columns else None
        if source_col:
            for idx in df.index:
                existing = _clean_text(df.at[idx, "Shipment - Total Quantity"])
                if existing:
                    continue
                src = str(df.at[idx, source_col])
                fill_val = totals_by_source.get(src, "")
                if fill_val:
                    df.at[idx, "Shipment - Total Quantity"] = fill_val
    return df


def _prepare_secondary_rows(
    doc_type: str,
    sec_key: str,
    rows: list,
    record: dict,
    source_file: str,
) -> list[dict]:
    prepared: list[dict] = []
    cert = record.get("certification") if isinstance(record, dict) else None
    cert_fields = {}
    if isinstance(cert, dict):
        cert_fields = {
            "referenceNumber": cert.get("referenceNumber", ""),
            "referenceType": cert.get("referenceType", ""),
        }

    for item in rows:
        if isinstance(item, dict):
            out = dict(item)
        else:
            out = {"value": json.dumps(item, ensure_ascii=False)}
        out["source_file"] = source_file
        if doc_type == "Steel Supplier Declaration" and sec_key == "referenceInvoices":
            if "referenceNumber" not in out:
                out["referenceNumber"] = cert_fields.get("referenceNumber", "")
            if "referenceType" not in out:
                out["referenceType"] = cert_fields.get("referenceType", "")
        prepared.append(out)
    return prepared


# ── Excel output ──────────────────────────────────────────────────────────────

def run_camelot_ocr(
    pdf_path: str | Path,
    doc_type: str,
    output_path: str | Path | None = None,
) -> Path:
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    if doc_type not in DOC_TYPE_CONFIG:
        raise ValueError(f"Unknown doc type {doc_type!r}. Valid: {', '.join(sorted(DOC_TYPE_CONFIG))}")

    if output_path is None:
        safe = re.sub(r"[^a-z0-9]+", "_", doc_type.lower()).strip("_")
        output_path = pdf_path.parent / f"{pdf_path.stem}__{safe}_camelot.xlsx"
    output_path = Path(output_path)

    print(f"[camelot_ocr] Extracting '{doc_type}' from: {pdf_path.name}")
    record     = extract_document(pdf_path, doc_type)
    cfg        = DOC_TYPE_CONFIG[doc_type]
    expand_key = cfg["expand_array_key"]
    expand_pfx = cfg.get("expand_prefix")   # optional column prefix override
    include_expand_secondary = bool(cfg.get("include_expand_in_secondary", False))
    tmpl_sheet = cfg["template_sheet"]
    sec_tmpl   = cfg.get("secondary_template_sheets", {})
    sheet_name = (OUTPUT_SHEET_NAMES.get(doc_type) or doc_type)[:31]

    main_rows = (_expand_rows(record, expand_key, pdf_path.name, prefix=expand_pfx, doc_type=doc_type)
                 if expand_key else
                 [{**flatten_record(record), "source_file": pdf_path.name}])

    raw_main_df = pd.DataFrame(main_rows)
    main_df = raw_main_df
    if tmpl_sheet:
        main_df = align_df_to_template_columns(raw_main_df, tmpl_sheet)
    main_df = _postprocess_main_df(doc_type, raw_main_df, main_df)

    secondary: dict[str, list[dict]] = {
        k: v for k, v in record.items()
        if isinstance(v, list) and (k != expand_key or include_expand_secondary)
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        main_df.to_excel(writer, sheet_name=sheet_name, index=False)
        sec_keys_to_write = sorted(set(secondary.keys()) | set(sec_tmpl.keys()))
        for sec_key in sec_keys_to_write:
            rows = _prepare_secondary_rows(
                doc_type=doc_type,
                sec_key=sec_key,
                rows=secondary.get(sec_key, []),
                record=record,
                source_file=pdf_path.name,
            )
            arr_df = pd.DataFrame(rows)
            # Apply template alignment when a secondary template sheet is configured
            sec_sheet = sec_tmpl.get(sec_key)
            if sec_sheet:
                arr_df    = align_df_to_template_columns(arr_df, sec_sheet)
                out_name  = sec_sheet[:31]
            else:
                out_name  = re.sub(r"[^a-z0-9 ]+", "", sec_key.lower()).strip()[:31] or "data"
            arr_df.to_excel(writer, sheet_name=out_name, index=False)

    print(f"[camelot_ocr] Wrote -> {output_path}")
    return output_path


def run_camelot_ocr_batch(
    pdf_folder: str | Path,
    doc_type: str,
    output_path: str | Path | None = None,
) -> Path:
    pdf_folder = Path(pdf_folder)
    pdfs = sorted(pdf_folder.glob("*.pdf"))
    if not pdfs:
        raise FileNotFoundError(f"No PDFs found in: {pdf_folder}")
    if doc_type not in DOC_TYPE_CONFIG:
        raise ValueError(f"Unknown doc type: {doc_type!r}")

    if output_path is None:
        safe = re.sub(r"[^a-z0-9]+", "_", doc_type.lower()).strip("_")
        output_path = pdf_folder / f"{safe}_batch_camelot.xlsx"
    output_path = Path(output_path)

    cfg        = DOC_TYPE_CONFIG[doc_type]
    expand_key = cfg["expand_array_key"]
    expand_pfx = cfg.get("expand_prefix")
    include_expand_secondary = bool(cfg.get("include_expand_in_secondary", False))
    tmpl_sheet = cfg["template_sheet"]
    sec_tmpl   = cfg.get("secondary_template_sheets", {})
    sheet_name = (OUTPUT_SHEET_NAMES.get(doc_type) or doc_type)[:31]

    all_main: list[dict]           = []
    all_secondary: dict[str, list] = {}

    for pdf_path in pdfs:
        print(f"[camelot_ocr] Processing: {pdf_path.name}")
        try:
            record = extract_document(pdf_path, doc_type)
        except Exception as exc:
            print(f"[WARN] Failed {pdf_path.name}: {exc}")
            continue

        rows = (_expand_rows(record, expand_key, pdf_path.name, prefix=expand_pfx, doc_type=doc_type)
                if expand_key else
                [{**flatten_record(record), "source_file": pdf_path.name}])
        all_main.extend(rows)

        for k, v in record.items():
            if isinstance(v, list) and (k != expand_key or include_expand_secondary) and v:
                prepared = _prepare_secondary_rows(
                    doc_type=doc_type,
                    sec_key=k,
                    rows=v,
                    record=record,
                    source_file=pdf_path.name,
                )
                all_secondary.setdefault(k, []).extend(prepared)

    raw_main_df = pd.DataFrame(all_main)
    main_df = raw_main_df
    if tmpl_sheet:
        main_df = align_df_to_template_columns(raw_main_df, tmpl_sheet)
    main_df = _postprocess_main_df(doc_type, raw_main_df, main_df)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        main_df.to_excel(writer, sheet_name=sheet_name, index=False)
        sec_keys_to_write = sorted(set(all_secondary.keys()) | set(sec_tmpl.keys()))
        for sec_key in sec_keys_to_write:
            rows = all_secondary.get(sec_key, [])
            arr_df = pd.DataFrame(rows)
            sec_sheet = sec_tmpl.get(sec_key)
            if sec_sheet:
                arr_df   = align_df_to_template_columns(arr_df, sec_sheet)
                out_name = sec_sheet[:31]
            else:
                out_name = re.sub(r"[^a-z0-9 ]+", "", sec_key.lower()).strip()[:31] or "data"
            arr_df.to_excel(writer, sheet_name=out_name, index=False)

    print(f"[camelot_ocr] Batch done -> {output_path} ({len(pdfs)} PDFs)")
    return output_path
