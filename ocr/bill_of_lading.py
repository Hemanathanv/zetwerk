import argparse
import json
import re
from pathlib import Path

import pandas as pd

from structured_ocr import (
    align_df_to_template_columns,
    build_prompt_from_schema,
    extract_prompt_preamble,
    extract_records_with_sources,
    extract_ts_map,
    flatten_record,
    load_schema,
)

DOC_TITLE = "Bill of Lading"
SCHEMA_PATH = Path("data/schemas/bill-of-lading.json")
PROMPT_TS = Path("src/prompts/bill-of-lading-structured-prompt.ts")

SECTION_KEY_MAP = extract_ts_map(PROMPT_TS, "SECTION_JSON_KEY")


def with_source_first(df: pd.DataFrame) -> pd.DataFrame:
    if "source_file" not in df.columns:
        return df
    cols = ["source_file"] + [c for c in df.columns if c != "source_file"]
    return df[cols]


def read_array(record: dict, candidates: list[str]) -> list:
    for key in candidates:
        value = record.get(key)
        if isinstance(value, list):
            return value
    return []


_INV_RAW_RE = re.compile(
    r"INV(?:OICE)?\s*NO[.:\s]+([A-Z0-9][A-Z0-9/\-\.]+)\s+(?:DT|DATE)[.:\s]+([^\n,;]+)",
    re.IGNORECASE,
)
_SB_RAW_RE = re.compile(
    r"S/?B\s*NO[.:\s]+([A-Z0-9][A-Z0-9/\-\.]+)(?:\s+(?:DT|DATE)[.:\s]+([^\n,;]+))?",
    re.IGNORECASE,
)


def parse_raw_invoice_lines(raw: str) -> list[dict]:
    """Parse verbatim 'INV NO: ... DT: ...' lines copied from the PDF."""
    results = []
    for m in _INV_RAW_RE.finditer(raw or ""):
        results.append({"invoice_number": m.group(1).strip(), "invoice_date": m.group(2).strip()})
    return results


def parse_raw_sb_lines(raw: str) -> list[dict]:
    """Parse verbatim 'SB NO: ... DT: ...' lines copied from the PDF."""
    results = []
    for m in _SB_RAW_RE.finditer(raw or ""):
        results.append({"shipping_bill_number": m.group(1).strip(), "shipping_bill_date": (m.group(2) or "").strip()})
    return results


def override_from_raw(structured: list, parsed: list) -> list:
    """Use raw-parsed values when they outnumber or equal the structured array and have distinct values."""
    if not parsed:
        return structured
    parsed_numbers = [list(p.values())[0] for p in parsed]
    if len(set(parsed_numbers)) <= 1:
        # Raw lines all identical too — don't override
        return structured
    # Raw lines are distinct: use them
    return parsed


def explode_rows(items: list, source_file: str) -> list[dict]:
    rows = []
    for idx, item in enumerate(items, start=1):
        if isinstance(item, dict):
            rows.append({"source_file": source_file, **item})
        else:
            rows.append(
                {"source_file": source_file, "row_index": idx, "value": json.dumps(item)}
            )
    return rows


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=f"{DOC_TITLE} OCR extraction")
    parser.add_argument("--input", default="data/input", help="PDF file or folder")
    parser.add_argument(
        "--output",
        default="data/bill_of_lading_ocr_output.xlsx",
        help="Output Excel path",
    )
    parser.add_argument("--schema", default=str(SCHEMA_PATH), help="Schema JSON/CSV/XLSX")
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--max-pages", type=int, default=None)
    parser.add_argument(
        "--drive",
        action="store_true",
        help="Use mapped Google Drive folders for input PDFs.",
    )
    args = parser.parse_args()

    schema_rows = load_schema(Path(args.schema))
    preamble = extract_prompt_preamble(PROMPT_TS)
    prompt = build_prompt_from_schema(
        schema_rows=schema_rows,
        doc_title=DOC_TITLE,
        array_sections=["Export Invoices", "Shipping Bills", "Containers"],
        key_style="snake",
        section_key_map=SECTION_KEY_MAP,
        preamble=preamble,
    )

    records, sources = extract_records_with_sources(
        input_path=Path(args.input),
        prompt_text=prompt,
        doc_title=DOC_TITLE,
        use_drive=args.drive,
        dpi=args.dpi,
        max_pages=args.max_pages,
    )

    bol_rows = []
    container_rows = []
    invoice_rows = []
    shipping_bill_rows = []

    for record, source in zip(records, sources):
        # Extract raw verbatim lines BEFORE flattening so they don't pollute Excel columns.
        raw_text_obj = record.pop("raw_text", None) or {}
        raw_inv = raw_text_obj.get("raw_invoice_lines", "") or ""
        raw_sb = raw_text_obj.get("raw_sb_lines", "") or ""

        # Remove single-object invoice/SB fields — these hold only the first value and would
        # override the per-row invoice_number / shipping_bill_number we set in the loop below.
        record.pop("export_invoice", None)
        record.pop("export_shipping_bill", None)

        flat = flatten_record(record)
        flat.pop("source", None)
        for key in ["containers", "invoices", "shipping_bills", "shippingBills"]:
            flat.pop(key, None)

        invoices = read_array(record, ["invoices"])
        shipping_bills = read_array(record, ["shipping_bills", "shippingBills"])

        # Override structured arrays with verbatim-copied raw lines when the model duplicated values.
        parsed_inv = parse_raw_invoice_lines(raw_inv)
        parsed_sb = parse_raw_sb_lines(raw_sb)
        invoices = override_from_raw(invoices, parsed_inv)
        shipping_bills = override_from_raw(shipping_bills, parsed_sb)

        if not invoices:
            # No invoices — one row per PDF with empty invoice fields
            flat["source_file"] = source
            bol_rows.append(flat)
        else:
            # One row per invoice so each invoice appears on its own row in the main sheet.
            # Document-level fields (shipper, vessel, cargo, etc.) repeat on every row.
            # Shipping bills are paired by index with invoices when arrays are parallel.
            for i, invoice in enumerate(invoices):
                row = dict(flat)
                if isinstance(invoice, dict):
                    # Use bare field names so template suffix-matching aligns them to
                    # "Export Invoice - Invoice Number" / "Export Invoice - Invoice Date".
                    row["invoice_number"] = invoice.get("invoice_number", "")
                    row["invoice_date"] = invoice.get("invoice_date", "")
                # Pair with corresponding shipping bill (parallel-array layouts like MTD).
                if i < len(shipping_bills) and isinstance(shipping_bills[i], dict):
                    sb = shipping_bills[i]
                    row["shipping_bill_number"] = sb.get("shipping_bill_number", "")
                    row["shipping_bill_date"] = sb.get("shipping_bill_date", "")
                row["source_file"] = source
                bol_rows.append(row)

        container_rows.extend(explode_rows(read_array(record, ["containers"]), source))
        invoice_rows.extend(explode_rows(read_array(record, ["invoices"]), source))
        shipping_bill_rows.extend(
            explode_rows(read_array(record, ["shipping_bills", "shippingBills"]), source)
        )

    bol_df = with_source_first(pd.DataFrame(bol_rows))
    cont_df = with_source_first(pd.DataFrame(container_rows))
    inv_df = with_source_first(pd.DataFrame(invoice_rows))
    sb_df = with_source_first(pd.DataFrame(shipping_bill_rows))

    bol_df = align_df_to_template_columns(bol_df, "Bill of Lading")
    cont_df = align_df_to_template_columns(cont_df, "BOL - Containers")
    inv_df = align_df_to_template_columns(inv_df, "BOL - Invoices")
    sb_df = align_df_to_template_columns(sb_df, "BOL - Shipping Bills")

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        bol_df.to_excel(writer, sheet_name="Bill of Lading", index=False)
        cont_df.to_excel(writer, sheet_name="BOL - Containers", index=False)
        inv_df.to_excel(writer, sheet_name="BOL - Invoices", index=False)
        sb_df.to_excel(writer, sheet_name="BOL - Shipping Bills", index=False)

    print(f"Wrote Excel: {out_path}")
