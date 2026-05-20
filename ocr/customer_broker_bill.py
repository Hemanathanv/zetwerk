import argparse
import json
from pathlib import Path

import pandas as pd

from structured_ocr import (
    build_prompt_from_schema,
    extract_prompt_preamble,
    extract_records_with_sources,
    extract_ts_map,
    flatten_record,
    load_schema,
)

DOC_TITLE = "Customer Broker Bill"
SCHEMA_PATH = Path("data/schemas/customer-broker-bill.json")
PROMPT_TS = Path("src/prompts/customer-broker-bill-structured-prompt.ts")

FIELD_KEY_MAP = extract_ts_map(PROMPT_TS, "CANONICAL_JSON_KEY_BY_FIELD_NAME")

LINE_ITEM_FIELDS = ("chargeDescription", "quantity", "unitPrice", "amount")


def with_source_first(df: pd.DataFrame) -> pd.DataFrame:
    if "source_file" not in df.columns:
        return df
    cols = ["source_file"] + [c for c in df.columns if c != "source_file"]
    return df[cols]


def read_line_items(record: dict) -> list:
    for key in ("lineItems", "line_items"):
        value = record.get(key)
        if isinstance(value, list):
            return value
    return []


def expand_line_items_to_rows(record: dict, source: str) -> list[dict]:
    base = flatten_record(record)
    base.pop("source", None)
    base.pop("lineItems", None)
    base.pop("line_items", None)

    items = read_line_items(record)

    if not items:
        row = dict(base)
        for key in LINE_ITEM_FIELDS:
            row.setdefault(f"lineItems.{key}", None)
        row["source_file"] = source
        return [row]

    rows: list[dict] = []
    for idx, item in enumerate(items, start=1):
        row = dict(base)
        if isinstance(item, dict):
            for key in LINE_ITEM_FIELDS:
                row[f"lineItems.{key}"] = item.get(key)
            for k, v in item.items():
                col = f"lineItems.{k}"
                if col not in row:
                    row[col] = v
        else:
            row["lineItems.rowIndex"] = idx
            row["lineItems.value"] = json.dumps(item, ensure_ascii=False)
        row["source_file"] = source
        rows.append(row)
    return rows


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=f"{DOC_TITLE} OCR extraction")
    parser.add_argument(
        "--input",
        default="data/input",
        help="PDF file or folder containing PDF files.",
    )
    parser.add_argument(
        "--output",
        default="data/customer_broker_bill_ocr_output.xlsx",
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
        array_sections=["Line Items"],
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

    rows: list[dict] = []
    for record, source in zip(records, sources):
        rows.extend(expand_line_items_to_rows(record, source))

    df = with_source_first(pd.DataFrame(rows))
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="CUSTOMER BROKER BILL", index=False)
    print(f"Wrote Excel: {out_path}")
