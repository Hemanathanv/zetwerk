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

DOC_TITLE = "Sales Invoices"
SCHEMA_PATH = Path("data/schemas/sales-invoice.json")
PROMPT_TS = Path("src/prompts/sales-invoice-structured-prompt.ts")

FIELD_KEY_MAP = extract_ts_map(PROMPT_TS, "CANONICAL_JSON_KEY_BY_FIELD_NAME")

PRODUCT_CODE_PATTERN = re.compile(r"\b[A-Z]{1,4}(?:\.[A-Z0-9]+){3,}\b")
SPEC_DIMENSION_PATTERN = re.compile(
    r"\b[WHDL]\s*\d+(?:\.\d+)?\s*[Xx]\s*\d+(?:\.\d+)?\b"
)
SPEC_MARKER_PATTERN = re.compile(
    r"(?:^|,\s*)(HDG|GALV(?:ANIZED)?|GRADE|ASTM|OREGON|SATURN|COATED|PAINTED)\b",
    re.IGNORECASE,
)


def clean_text(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() in {"nan", "none", "null"}:
        return ""
    return re.sub(r"\s+", " ", text)


def split_description_and_spec(text: str) -> tuple[str, str]:
    text = clean_text(text)
    if not text:
        return "", ""

    dim_match = SPEC_DIMENSION_PATTERN.search(text)
    if dim_match and dim_match.start() > 2:
        left = text[: dim_match.start()].strip(" ,;:-")
        right = text[dim_match.start() :].strip(" ,;:-")
        if left and right:
            return left, right

    marker_match = SPEC_MARKER_PATTERN.search(text)
    if marker_match and marker_match.start() > 2:
        left = text[: marker_match.start()].strip(" ,;:-")
        right = text[marker_match.start() :].strip(" ,;:-")
        if left and right:
            return left, right

    return text, ""


def repair_line_item_fields(item: dict) -> dict:
    code = clean_text(item.get("productCode"))
    desc = clean_text(item.get("productDescription"))
    spec = clean_text(item.get("productSpecification"))

    # If code is missing but description/spec starts with a code token, recover it.
    if not code:
        for source_name, source_value in (("desc", desc), ("spec", spec)):
            if not source_value:
                continue
            leading = PRODUCT_CODE_PATTERN.match(source_value)
            if not leading:
                continue
            code = leading.group(0)
            remainder = source_value[leading.end() :].strip(" ,;:-")
            if source_name == "desc":
                desc = remainder
            else:
                spec = remainder
            break

    # If code field itself has extra trailing text, keep only code and shift trailing text to desc.
    if code:
        leading = PRODUCT_CODE_PATTERN.match(code)
        if leading:
            trailing = code[leading.end() :].strip(" ,;:-")
            code = leading.group(0)
            if trailing and not desc:
                desc = trailing

    # If description still includes a leading code, strip it now.
    if desc:
        leading = PRODUCT_CODE_PATTERN.match(desc)
        if leading:
            if not code:
                code = leading.group(0)
            desc = desc[leading.end() :].strip(" ,;:-")

    # Split combined description/spec text when spec is empty.
    if desc and not spec:
        split_desc, split_spec = split_description_and_spec(desc)
        if split_spec:
            desc = split_desc
            spec = split_spec

    item["productCode"] = code
    item["productDescription"] = desc
    item["productSpecification"] = spec
    return item


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


def parse_numeric_quantity(value) -> float | None:
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


def compute_total_quantity(items: list) -> str:
    total = 0.0
    has_any = False
    for item in items:
        if not isinstance(item, dict):
            continue
        qty = parse_numeric_quantity(item.get("quantity"))
        if qty is None:
            continue
        total += qty
        has_any = True

    if not has_any:
        return ""
    if float(total).is_integer():
        return str(int(total))
    return f"{total:.3f}".rstrip("0").rstrip(".")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=f"{DOC_TITLE} OCR extraction")
    parser.add_argument("--input", default="data/input", help="PDF file or folder")
    parser.add_argument(
        "--output",
        default="data/sales_invoices_ocr_output.xlsx",
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

    rows = []
    for record, source in zip(records, sources):
        base = flatten_record(record)
        base.pop("source", None)
        base.pop("lineItems", None)
        base.pop("line_items", None)

        items = read_line_items(record)
        total_quantity = compute_total_quantity(items)
        if total_quantity:
            # Populate shipment quantity as total quantity across line items.
            base["shipment.noOfPackages"] = total_quantity

        if not items:
            row = dict(base)
            row["source_file"] = source
            rows.append(row)
            continue

        for idx, item in enumerate(items, start=1):
            row = dict(base)
            if isinstance(item, dict):
                item = repair_line_item_fields(dict(item))
                for k, v in item.items():
                    row[f"lineItems.{k}"] = v
            else:
                row["lineItems.rowIndex"] = idx
                row["lineItems.value"] = json.dumps(item, ensure_ascii=False)
            row["source_file"] = source
            rows.append(row)

    raw_df = with_source_first(pd.DataFrame(rows))
    df = align_df_to_template_columns(raw_df, "Sales Invoices")

    # Keep newly added Sales Invoice line-item fields even if the local template
    # workbook has not yet been updated with those headers.
    for col in (
        "lineItems.containerNo",
        "lineItems.sealNo",
        "lineItems.boCode",
    ):
        if col in raw_df.columns and col not in df.columns:
            df[col] = raw_df[col]

    # Keep parse diagnostics visible when model output is malformed JSON,
    # otherwise the mapped template can appear fully blank except Source File.
    for col in ("parse_error", "flags", "raw_response"):
        if col in raw_df.columns and col not in df.columns:
            df[col] = raw_df[col]

    if "Shipment - No Of Packages" in df.columns:
        old_col = "Shipment - No Of Packages"
        insert_at = df.columns.get_loc(old_col)
        df.insert(insert_at, "Shipment - Total Quantity", df[old_col])
        df = df.drop(columns=[old_col])
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Sales Invoices", index=False)
    print(f"Wrote Excel: {out_path}")
