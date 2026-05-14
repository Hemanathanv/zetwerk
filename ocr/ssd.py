import argparse
import json
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

DOC_TITLE = "Steel Supplier Declaration"
SCHEMA_PATH = Path("data/schemas/ssd.json")
PROMPT_TS = Path("src/prompts/ssd-structured-prompt.ts")

FIELD_KEY_MAP = extract_ts_map(PROMPT_TS, "CANONICAL_JSON_KEY_BY_FIELD_NAME")


def with_source_first(df: pd.DataFrame) -> pd.DataFrame:
    if "source_file" not in df.columns:
        return df
    cols = ["source_file"] + [c for c in df.columns if c != "source_file"]
    return df[cols]


def to_reference_rows(record: dict, source_file: str) -> list[dict]:
    refs = record.get("referenceInvoices")
    if refs is None:
        refs = record.get("reference_invoices")
    if not isinstance(refs, list):
        return []

    cert = record.get("certification") or {}
    cert_fields = {
        k: v for k, v in cert.items()
        if k in ("referenceNumber", "referenceType")
    }

    out = []
    for idx, ref in enumerate(refs, start=1):
        if isinstance(ref, dict):
            row = {"source_file": source_file, **cert_fields, **ref}
        else:
            row = {"source_file": source_file, **cert_fields, "row_index": idx, "value": json.dumps(ref)}
        out.append(row)
    return out


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=f"{DOC_TITLE} OCR extraction")
    parser.add_argument("--input", default="data/input", help="PDF file or folder")
    parser.add_argument(
        "--output",
        default="data/steel_supplier_declaration_ocr_output.xlsx",
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
        array_sections=["Products", "Reference Invoices"],
        key_style="camel",
        field_key_map=FIELD_KEY_MAP,
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

    ssd_rows = []
    ref_rows = []
    for record, source in zip(records, sources):
        flat = flatten_record(record)
        flat.pop("source", None)
        flat.pop("products", None)
        flat.pop("referenceInvoices", None)
        flat.pop("reference_invoices", None)

        products = record.get("products") or []
        if not isinstance(products, list):
            products = []

        if not products:
            flat["source_file"] = source
            ssd_rows.append(flat)
        else:
            for product in products:
                row = dict(flat)
                if isinstance(product, dict):
                    for k, v in product.items():
                        row[f"products.{k}"] = v
                row["source_file"] = source
                ssd_rows.append(row)

        ref_rows.extend(to_reference_rows(record, source))

    ssd_df = with_source_first(pd.DataFrame(ssd_rows))
    ref_df = with_source_first(pd.DataFrame(ref_rows))
    ssd_df = align_df_to_template_columns(ssd_df, "Steel Supplier Declaration")
    ref_df = align_df_to_template_columns(ref_df, "SSD Reference Invoices")

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        ssd_df.to_excel(writer, sheet_name="Steel Supplier Declaration", index=False)
        ref_df.to_excel(writer, sheet_name="SSD Reference Invoices", index=False)

    print(f"Wrote Excel: {out_path}")
