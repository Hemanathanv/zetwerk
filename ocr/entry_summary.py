import argparse
import json
import re
import os
from pathlib import Path
from datetime import datetime

import pandas as pd
try:
    import fitz  # PyMuPDF
except Exception as exc:  # pragma: no cover
    raise SystemExit("PyMuPDF is required. Install with: pip install pymupdf") from exc

from structured_ocr import (
    align_df_to_template_columns,
    build_prompt_from_schema,
    extract_prompt_preamble,
    extract_records_with_sources,
    get_pdf_entries,
    extract_ts_map,
    load_schema,
    to_camel,
    tokenize_label,
)

DOC_TITLE = "Entry Summary"
SCHEMA_PATH = Path("data/schemas/entry-summary.json")
PROMPT_TS = Path("src/prompts/entry-summary-structured-prompt.ts")
TEMPLATE_PATH = Path(r"C:\Users\Admin\Downloads\Copy of Zetwerk Logistics OCR.xlsx")

FIELD_KEY_MAP = extract_ts_map(PROMPT_TS, "CANONICAL_JSON_KEY_BY_FIELD_NAME")

EXTRA_HEADER_FIELDS = [
    {
        "section": "Header",
        "fieldName": "INV VAL US",
        "fieldType": "string",
        "required": False,
        "description": "Invoice value (US) shown near header summary block.",
    },
    {
        "section": "Header",
        "fieldName": "ENTVAL",
        "fieldType": "string",
        "required": False,
        "description": "Entered value shown near header summary block.",
    },
    {
        "section": "Header",
        "fieldName": "Total Package",
        "fieldType": "string",
        "required": False,
        "description": "Standalone package summary (e.g. 66 PKG / 34 PCS / 9 BDL).",
    },
]

EXTRA_OUTPUT_COLUMNS = [
    "Header - INV VAL US",
    "Header - ENTVAL",
    "Header - Total Package",
]

EXTRA_FIELD_FALLBACK_KEYS = {
    "invvalus": ["invValUs", "invValUsd", "inv_val_us", "inv_val_usd"],
    "entval": ["entval", "entVal", "enteredValue", "entered_value"],
    "totalpackage": [
        "totalPackage",
        "toatalPackage",
        "total_package",
        "toatal_package",
        "totalPackages",
    ],
}

FALLBACK_COLUMNS = [
    "Source File",
    "Header - Filer Code Entry Number",
    "Header - Entry Type",
    "Header - Summary Date",
    "Header - Surety Number",
    "Header - Bond Type",
    "Header - Port Code",
    "Header - Entry Date",
    "Header - Team Number",
    "Header - Summary Status",
    "Header - Form Version",
    "Header - Form Number",
    "Transport - Importing Carrier",
    "Transport - Mode Of Transport",
    "Transport - Import Date",
    "Transport - B/L Or AWB Number",
    "Transport - Additional B Ls",
    "Transport - House Bill",
    "Transport - Subhouse Bill",
    "Transport - Bill Qty",
    "Transport - Bill Qty Unit",
    "Transport - Manufacturer ID",
    "Transport - Exporting Country",
    "Transport - Export Date",
    "Transport - IT Number",
    "Transport - IT Date",
    "Transport - Missing Docs",
    "Transport - Foreign Port Of Lading",
    "Transport - Us Port Of Unlading",
    "Parties - Country Of Origin",
    "Parties - Location Of Goods",
    "Parties - Consignee Number",
    "Parties - Importer Number",
    "Parties - Reference Number",
    "Parties - Ultimate Consignee Name",
    "Parties - Ultimate Consignee Address",
    "Parties - Ultimate Consignee City",
    "Parties - Ultimate Consignee State",
    "Parties - Ultimate Consignee Zip",
    "Parties - Importer Of Record Name",
    "Parties - Importer Of Record Address",
    "Parties - Importer Of Record City",
    "Parties - Importer Of Record State",
    "Parties - Importer Of Record Zip",
    "Trade Compliance - Country Of Melt And Pour",
    "Trade Compliance - Primary Country Of Smelt",
    "Trade Compliance - Secondary Country Of Smelt",
    "Trade Compliance - Country Of Cast",
    "Fees - MPF Total",
    "Fees - HMF Total",
    "Fees - Total Other Fees",
    "Totals - Total Entered Value",
    "Totals - Total Duty",
    "Totals - Total Tax",
    "Totals - Total Other",
    "Totals - Grand Total",
    "Declarant - Declarant Name",
    "Declarant - Declarant Company",
    "Declarant - Declarant Title",
    "Declarant - Declarant Date",
    "Declarant - Is Owner",
    "Declarant - Is Purchase",
    "Broker - Broker Name",
    "Broker - Broker Address",
    "Broker - Broker Phone",
    "Broker - Broker Importer File Number",
    "Line Items - Line No",
    "Line Items - Invoice Number",
    "Line Items - Units",
    "Line Items - Merchandise Description",
    "Line Items - HTSUS Number",
    "Line Items - Gross Weight Kg",
    "Line Items - Net Quantity",
    "Line Items - Net Quantity Unit",
    "Line Items - Entered Value",
    "Line Items - Charges",
    "Line Items - Relationship",
    "Line Items - HTSUS Rate",
    "Line Items - HTSUS Duty",
    "Line Items - Invoice Value USD",
    "Line Items - Deduction Charge",
    "Line Items - Total Entered Value Invoice",
    "Line Items - MPF Rate",
    "Line Items - MPF Amount",
    "Line Items - HMF Rate",
    "Line Items - HMF Amount",
]


def normalize_label(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def schema_field_to_key(field_name):
    direct = FIELD_KEY_MAP.get(field_name)
    if direct:
        return direct
    return to_camel(tokenize_label(field_name))


def section_to_key(section_name):
    return to_camel(tokenize_label(section_name))


def ensure_extra_entry_summary_fields(schema_rows):
    rows = list(schema_rows)
    existing_keys = {
        (normalize_label(r.get("section")), normalize_label(r.get("fieldName")))
        for r in rows
    }
    normalized_field_names = {
        normalize_label(r.get("fieldName"))
        for r in rows
        if normalize_label(r.get("section")) == "header"
    }
    max_index = 0
    for r in rows:
        idx = r.get("index")
        if isinstance(idx, int):
            max_index = max(max_index, idx)

    for field in EXTRA_HEADER_FIELDS:
        sec = normalize_label(field["section"])
        fld = normalize_label(field["fieldName"])
        if fld == "totalpackage" and (
            "toatalpackage" in normalized_field_names or "totalpackage" in normalized_field_names
        ):
            continue
        if (sec, fld) in existing_keys:
            continue
        max_index += 1
        row = {"index": max_index, **field}
        rows.append(row)
        existing_keys.add((sec, fld))
        normalized_field_names.add(fld)
    return rows


def load_output_columns():
    cols = []
    if TEMPLATE_PATH.exists():
        wb = pd.read_excel(TEMPLATE_PATH, sheet_name="Entry Summary", nrows=0)
        cols = [str(c) for c in wb.columns]
    if not cols:
        cols = list(FALLBACK_COLUMNS)

    # OCR extraction output should not include upload-enrichment columns.
    cols = [c for c in cols if c not in {"Source File Path", "Date"}]

    if "Source File" not in cols:
        cols.insert(0, "Source File")

    # Force custom Entry Summary columns as the final three columns.
    cols = [c for c in cols if c not in EXTRA_OUTPUT_COLUMNS]
    cols.extend(EXTRA_OUTPUT_COLUMNS)
    return cols


def build_column_path_map(schema_rows):
    path_map = {}
    for row in schema_rows:
        section = str(row.get("section") or "").strip()
        field = str(row.get("fieldName") or "").strip()
        if not section or not field:
            continue
        sec_key = section_to_key(section)
        fld_key = schema_field_to_key(field)
        sec_norm = normalize_label(section)
        fld_norm = normalize_label(field)
        path_map[(sec_norm, fld_norm)] = (sec_key, fld_key)
        if fld_norm == "toatalpackage":
            path_map[(sec_norm, "totalpackage")] = (sec_key, fld_key)
        if fld_norm == "invvalusd":
            path_map[(sec_norm, "invvalus")] = (sec_key, fld_key)
        if fld_norm == "invvalus":
            path_map[(sec_norm, "invvalusd")] = (sec_key, fld_key)

    manual_line_items = {
        "units": ("lineItems", "units"),
    }
    for field_norm, (_, fld_key) in manual_line_items.items():
        path_map[("lineitems", field_norm)] = ("lineItems", fld_key)
    return path_map


def safe_value(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return value


def is_empty(value):
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    return False


def normalize_space(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def extract_extra_header_values_from_pdf(pdf_path: Path, max_pages: int | None = None) -> dict[str, object]:
    values = {col: "" for col in EXTRA_OUTPUT_COLUMNS}
    values["_inv_ent_pairs"] = []
    values["_invoice_pair_map"] = {}
    try:
        with fitz.open(str(pdf_path)) as doc:
            if len(doc) == 0:
                return values
            if max_pages is None:
                pages_to_read = len(doc)
            else:
                pages_to_read = min(len(doc), max(1, max_pages))
            page_texts = [doc[i].get_text("text") or "" for i in range(pages_to_read)]
    except Exception:
        return values

    full_text = normalize_space(" ".join(page_texts))
    first_page_text = normalize_space(page_texts[0] if page_texts else "")

    # Pattern example: [INV VAL US : 5,175.60, ENTVAL: 5,176.00]
    combined_pairs = re.findall(
        r"INV\s*VAL\s*US(?:D)?\s*[:=]\s*([0-9][0-9,]*(?:\.\d+)?)\s*[,;]?\s*ENTVAL\s*[:=]\s*([0-9][0-9,]*(?:\.\d+)?)",
        full_text,
        flags=re.IGNORECASE,
    )
    pairs = [(inv.strip(), ent.strip()) for inv, ent in combined_pairs]

    if not pairs:
        inv_match = re.search(
            r"INV\s*VAL\s*US(?:D)?\s*[:=]\s*([0-9][0-9,]*(?:\.\d+)?)",
            full_text,
            flags=re.IGNORECASE,
        )
        ent_match = re.search(
            r"ENTVAL\s*[:=]\s*([0-9][0-9,]*(?:\.\d+)?)",
            full_text,
            flags=re.IGNORECASE,
        )
        if inv_match:
            values["Header - INV VAL US"] = inv_match.group(1).strip()
        if ent_match:
            values["Header - ENTVAL"] = ent_match.group(1).strip()
    else:
        values["Header - INV VAL US"] = pairs[0][0]
        values["Header - ENTVAL"] = pairs[0][1]
        values["_inv_ent_pairs"] = pairs

    # Total Package is commonly a standalone token like "66 PKG", "34 PCS", "9 BDL".
    # Prefer first page / header zone.
    header_zone = first_page_text[:2500]
    package_match = re.search(
        r"\b(\d{1,5})\s*(PKG|PCS|BDL)\b",
        header_zone,
        flags=re.IGNORECASE,
    )
    if not package_match:
        package_match = re.search(
            r"\b(\d{1,5})\s*(PKG|PCS|BDL)\b",
            full_text,
            flags=re.IGNORECASE,
        )
    if package_match:
        values["Header - Total Package"] = (
            f"{package_match.group(1).strip()} {package_match.group(2).upper()}"
        )

    # Secondary fallback: pair standalone INV/ENT sequences by index.
    if not values["_inv_ent_pairs"]:
        inv_values = re.findall(
            r"INV\s*VAL\s*US(?:D)?\s*[:=]\s*([0-9][0-9,]*(?:\.\d+)?)",
            full_text,
            flags=re.IGNORECASE,
        )
        ent_values = re.findall(
            r"ENTVAL\s*[:=]\s*([0-9][0-9,]*(?:\.\d+)?)",
            full_text,
            flags=re.IGNORECASE,
        )
        pair_count = min(len(inv_values), len(ent_values))
        if pair_count:
            values["_inv_ent_pairs"] = [
                (inv_values[i].strip(), ent_values[i].strip()) for i in range(pair_count)
            ]
            if is_empty(values["Header - INV VAL US"]):
                values["Header - INV VAL US"] = values["_inv_ent_pairs"][0][0]
            if is_empty(values["Header - ENTVAL"]):
                values["Header - ENTVAL"] = values["_inv_ent_pairs"][0][1]

    # Map pairs to invoice numbers in document order when possible.
    invoice_numbers = re.findall(
        r"\b[A-Z]{2,10}/\d{1,10}/\d{2}-\d{2}\b",
        full_text,
        flags=re.IGNORECASE,
    )
    ordered_unique_invoices = []
    seen = set()
    for inv in invoice_numbers:
        key = inv.strip().upper()
        if key in seen:
            continue
        seen.add(key)
        ordered_unique_invoices.append(key)

    pairs = values.get("_inv_ent_pairs", [])
    if ordered_unique_invoices and pairs:
        for idx, inv in enumerate(ordered_unique_invoices):
            if idx >= len(pairs):
                break
            values["_invoice_pair_map"][inv] = pairs[idx]

    return values


def find_section_obj(record, sec_key):
    section_obj = record.get(sec_key)
    if isinstance(section_obj, dict):
        return section_obj

    sec_norm = normalize_label(sec_key)
    for key, value in record.items():
        if isinstance(value, dict) and normalize_label(key) == sec_norm:
            return value
    return {}


def lookup_key_fuzzy(obj, target_key):
    if not isinstance(obj, dict):
        return None
    if target_key in obj and not is_empty(obj.get(target_key)):
        return obj.get(target_key)
    target_norm = normalize_label(target_key)
    for key, value in obj.items():
        if normalize_label(key) == target_norm and not is_empty(value):
            return value
    return None


def parse_column(column_name):
    if " - " not in column_name:
        return None, None
    sec, field = column_name.split(" - ", 1)
    return sec.strip(), field.strip()


def extract_top_value(record, sec_key, fld_key):
    section_obj = find_section_obj(record, sec_key)

    direct = lookup_key_fuzzy(section_obj, fld_key)
    if not is_empty(direct):
        return safe_value(direct)

    fld_norm = normalize_label(fld_key)
    for alt_key in EXTRA_FIELD_FALLBACK_KEYS.get(fld_norm, []):
        alt_value = lookup_key_fuzzy(section_obj, alt_key)
        if not is_empty(alt_value):
            return safe_value(alt_value)

    # Final fallback: sometimes model emits these fields at root level.
    root_value = lookup_key_fuzzy(record, fld_key)
    if not is_empty(root_value):
        return safe_value(root_value)
    for alt_key in EXTRA_FIELD_FALLBACK_KEYS.get(fld_norm, []):
        root_alt = lookup_key_fuzzy(record, alt_key)
        if not is_empty(root_alt):
            return safe_value(root_alt)

    return ""


def extract_line_value(line_item, fld_key):
    if not isinstance(line_item, dict):
        return ""
    value = lookup_key_fuzzy(line_item, fld_key)
    if is_empty(value):
        return ""
    return safe_value(value)


def build_rows(records, sources, schema_rows, output_columns, extra_values_by_source=None):
    path_map = build_column_path_map(schema_rows)
    rows = []
    extra_values_by_source = extra_values_by_source or {}
    if isinstance(sources, tuple):
        sources = list(sources)

    line_item_columns = [c for c in output_columns if c.startswith("Line Items - ")]
    top_columns = [c for c in output_columns if c not in line_item_columns]

    for record, source_file in zip(records, sources):
        base = {c: "" for c in output_columns}
        base["Source File"] = source_file

        for col in top_columns:
            if col == "Source File":
                continue
            sec_label, field_label = parse_column(col)
            if not sec_label:
                continue
            sec_norm = normalize_label(sec_label)
            fld_norm = normalize_label(field_label)
            mapped = path_map.get((sec_norm, fld_norm))
            if not mapped:
                continue
            sec_key, fld_key = mapped
            base[col] = extract_top_value(record, sec_key, fld_key)

        # Fallback fill for custom header fields from PDF text extraction.
        source_extra = extra_values_by_source.get(source_file, {})
        inv_ent_pairs = source_extra.get("_inv_ent_pairs", [])
        invoice_pair_map = source_extra.get("_invoice_pair_map", {})
        for extra_col in EXTRA_OUTPUT_COLUMNS:
            # These can be row-specific; fill inside line-item loop from pair list.
            if extra_col in {"Header - INV VAL US", "Header - ENTVAL"} and inv_ent_pairs:
                continue
            if is_empty(base.get(extra_col)) and not is_empty(source_extra.get(extra_col)):
                base[extra_col] = source_extra.get(extra_col)

        line_items = record.get("lineItems")
        if not isinstance(line_items, list) or not line_items:
            if inv_ent_pairs:
                base["Header - INV VAL US"] = inv_ent_pairs[0][0]
                base["Header - ENTVAL"] = inv_ent_pairs[0][1]
            rows.append(base)
            continue

        invoice_field_key = None
        invoice_mapping = path_map.get(("lineitems", "invoicenumber"))
        if invoice_mapping:
            _, invoice_field_key = invoice_mapping

        # Precompute invoice order + last row index per invoice group.
        ordered_invoice_keys = []
        seen_invoice_keys = set()
        invoice_last_idx = {}
        for row_idx, item in enumerate(line_items):
            inv_text = ""
            if invoice_field_key:
                inv_text = normalize_space(extract_line_value(item, invoice_field_key))
            inv_key = inv_text.upper()
            if not inv_key:
                continue
            invoice_last_idx[inv_key] = row_idx
            if inv_key not in seen_invoice_keys:
                seen_invoice_keys.add(inv_key)
                ordered_invoice_keys.append(inv_key)

        # Choose which pair belongs to which invoice.
        invoice_to_pair = {}
        pair_idx = 0
        for inv_key in ordered_invoice_keys:
            if inv_key in invoice_pair_map:
                invoice_to_pair[inv_key] = invoice_pair_map[inv_key]
            elif pair_idx < len(inv_ent_pairs):
                invoice_to_pair[inv_key] = inv_ent_pairs[pair_idx]
                pair_idx += 1

        for idx, item in enumerate(line_items):
            row = dict(base)
            for col in line_item_columns:
                sec_label, field_label = parse_column(col)
                if not sec_label:
                    continue
                sec_norm = normalize_label(sec_label)
                fld_norm = normalize_label(field_label)
                mapped = path_map.get((sec_norm, fld_norm))
                if not mapped:
                    continue
                _, fld_key = mapped
                row[col] = extract_line_value(item, fld_key)

            if inv_ent_pairs:
                # Default blank per line; fill only on the first line of an invoice group.
                row["Header - INV VAL US"] = ""
                row["Header - ENTVAL"] = ""

                invoice_value = normalize_space(row.get("Line Items - Invoice Number", ""))
                invoice_key = invoice_value.upper()
                chosen_pair = invoice_to_pair.get(invoice_key)

                # Fill value only on last row of each invoice group.
                if (
                    invoice_key
                    and chosen_pair is not None
                    and invoice_last_idx.get(invoice_key) == idx
                ):
                    row["Header - INV VAL US"] = chosen_pair[0]
                    row["Header - ENTVAL"] = chosen_pair[1]
                elif not invoice_key and idx < len(inv_ent_pairs):
                    # Fallback for rows where invoice number is missing.
                    row["Header - INV VAL US"] = inv_ent_pairs[idx][0]
                    row["Header - ENTVAL"] = inv_ent_pairs[idx][1]

            rows.append(row)

    return rows


def build_extra_values_by_source(raw_sources, cleaned_sources, pdf_entries, max_pages):
    values_by_source = {}
    if len(raw_sources) != len(pdf_entries):
        return values_by_source

    for raw_source, cleaned_source, (pdf_path, entry_source_name) in zip(
        raw_sources, cleaned_sources, pdf_entries
    ):
        values = extract_extra_header_values_from_pdf(
            pdf_path=pdf_path,
            max_pages=max_pages,
        )
        if not values:
            continue
        keys = {
            str(raw_source),
            str(cleaned_source),
            str(entry_source_name),
            clean_source_name(entry_source_name),
        }
        for key in keys:
            values_by_source[key] = values
    return values_by_source


def clean_source_name(name):
    text = str(name or "").strip().replace("\\", "/")
    if "/" in text:
        text = text.split("/")[-1]
    return re.sub(r"__[-A-Za-z0-9_]{6,}(?=\.pdf$)", "", text, flags=re.IGNORECASE)


def preserve_required_columns(
    aligned_df: pd.DataFrame,
    original_df: pd.DataFrame,
    required_columns: list[str],
) -> pd.DataFrame:
    df = aligned_df.copy()
    for col in required_columns:
        if col in df.columns:
            continue
        if col in original_df.columns:
            df[col] = original_df[col]
        else:
            df[col] = ""

    # Keep required extra columns as the last columns for stable output.
    ordered = [c for c in df.columns if c not in required_columns] + required_columns
    return df[ordered]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=f"{DOC_TITLE} OCR extraction")
    parser.add_argument("--input", default="data/input", help="PDF file or folder containing PDF files.")
    parser.add_argument(
        "--output",
        default="data/entry_summary_ocr_output.xlsx",
        help="Output Excel file path.",
    )
    parser.add_argument("--schema", default=str(SCHEMA_PATH), help="Schema file path (.json/.csv/.xlsx).")
    parser.add_argument("--dpi", type=int, default=300, help="Render DPI for PDF pages (higher = better OCR, slower).")
    parser.add_argument("--max-pages", type=int, default=None)
    parser.add_argument(
        "--model",
        default=None,
        help="Override model id for this run (example: openrouter/gpt-4.1).",
    )
    parser.add_argument(
        "--no-prefer-pro-model",
        action="store_true",
        help="Do not auto-switch to OPENROUTER_MODEL_PRO from .env.",
    )
    parser.add_argument(
        "--drive",
        action="store_true",
        help="Use mapped Google Drive folders for input PDFs.",
    )
    args = parser.parse_args()

    # Accuracy-first model selection:
    # 1) explicit --model wins
    # 2) otherwise prefer OPENROUTER_MODEL_PRO unless disabled
    if args.model:
        os.environ["OPENAI_MODEL"] = args.model.strip()
        print(f"Using model override: {os.environ['OPENAI_MODEL']}")
    elif not args.no_prefer_pro_model:
        pro_model = os.getenv("OPENROUTER_MODEL_PRO", "").strip()
        if pro_model:
            os.environ["OPENAI_MODEL"] = pro_model
            print(f"Using high-accuracy model from OPENROUTER_MODEL_PRO: {pro_model}")

    schema_rows = ensure_extra_entry_summary_fields(load_schema(Path(args.schema)))
    preamble = extract_prompt_preamble(PROMPT_TS)
    prompt = build_prompt_from_schema(
        schema_rows=schema_rows,
        doc_title=DOC_TITLE,
        array_sections=["Line Items"],
        key_style="camel",
        field_key_map=FIELD_KEY_MAP,
        preamble=preamble,
        add_tariff_lines=True,
    )

    records, sources = extract_records_with_sources(
        input_path=Path(args.input),
        prompt_text=prompt,
        doc_title=DOC_TITLE,
        use_drive=args.drive,
        dpi=args.dpi,
        max_pages=args.max_pages,
    )

    raw_sources = list(sources)
    sources = [clean_source_name(s) for s in raw_sources]
    pdf_entries = get_pdf_entries(
        input_path=Path(args.input),
        doc_title=DOC_TITLE,
        use_drive=args.drive,
    )
    extra_values_by_source = build_extra_values_by_source(
        raw_sources=raw_sources,
        cleaned_sources=sources,
        pdf_entries=pdf_entries,
        max_pages=args.max_pages,
    )

    output_columns = load_output_columns()
    rows = build_rows(
        records,
        sources,
        schema_rows,
        output_columns,
        extra_values_by_source=extra_values_by_source,
    )

    df = pd.DataFrame(rows, columns=output_columns)
    pre_aligned_df = df.copy()
    df = align_df_to_template_columns(df, "Entry Summary")
    df = preserve_required_columns(df, pre_aligned_df, EXTRA_OUTPUT_COLUMNS)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name="Entry Summary", index=False)
        print(f"Wrote Excel: {out_path}")
    except PermissionError:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        fallback = out_path.with_name(f"{out_path.stem}_{ts}{out_path.suffix}")
        with pd.ExcelWriter(fallback, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name="Entry Summary", index=False)
        print(
            f"Output file is in use: {out_path}. "
            f"Wrote Excel to fallback path: {fallback}"
        )
