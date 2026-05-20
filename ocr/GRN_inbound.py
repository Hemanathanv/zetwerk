import argparse
import json
import re
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

DOC_TITLE = "GRN Inbound"
SCHEMA_PATH = Path("data/schemas/grn-inbound.json")
PROMPT_TS = Path("src/prompts/grn-inbound-structured-prompt.ts")

FIELD_KEY_MAP = extract_ts_map(PROMPT_TS, "CANONICAL_JSON_KEY_BY_FIELD_NAME")

MARK_FIELDS = ("piecesPerBundle", "bundleCount", "totalPieces", "color", "rawLabel")
# Matches lines like "24 x 10 = 240 (Yellow)" or "16x12=192 (red)"
MARK_PATTERN = re.compile(
    r"\s*(\d+)\s*[xX*]\s*(\d+)\s*=\s*(\d+)\s*(?:\(([^)]+)\))?",
)


def with_source_first(df: pd.DataFrame) -> pd.DataFrame:
    if "source_file" not in df.columns:
        return df
    cols = ["source_file"] + [c for c in df.columns if c != "source_file"]
    return df[cols]


def read_destination_marks(record: dict) -> list:
    """Read the destinationMarks array directly from the model output, or
    fall back to parsing legacy single-string labels."""
    section = record.get("destinationMarks")
    if isinstance(section, list) and section:
        return section

    # Fallback: legacy "destinationMarksLabels" string in the Quantity section.
    quantity = record.get("quantity") or {}
    legacy = None
    if isinstance(quantity, dict):
        legacy = quantity.get("destinationMarksLabels")
    legacy = legacy or record.get("destinationMarksLabels")
    if not isinstance(legacy, str) or not legacy.strip():
        return []

    items: list[dict] = []
    for line in re.split(r"[\n,;]+", legacy):
        line = line.strip()
        if not line:
            continue
        match = MARK_PATTERN.match(line)
        if match:
            pieces, bundles, total, color = match.groups()
            items.append(
                {
                    "piecesPerBundle": pieces,
                    "bundleCount": bundles,
                    "totalPieces": total,
                    "color": color.strip() if color else None,
                    "rawLabel": line,
                }
            )
        else:
            items.append({k: None for k in MARK_FIELDS} | {"rawLabel": line})
    return items


def expand_destination_marks_to_rows(record: dict, source: str) -> list[dict]:
    base = flatten_record(record)
    base.pop("source", None)
    base.pop("destinationMarks", None)
    base.pop("destination_marks", None)
    base.pop("quantity.destinationMarksLabels", None)

    items = read_destination_marks(record)

    if not items:
        row = dict(base)
        for key in MARK_FIELDS:
            row.setdefault(f"destinationMarks.{key}", None)
        row["source_file"] = source
        return [row]

    rows: list[dict] = []
    for idx, item in enumerate(items, start=1):
        row = dict(base)
        if isinstance(item, dict):
            for key in MARK_FIELDS:
                row[f"destinationMarks.{key}"] = item.get(key)
            for k, v in item.items():
                col = f"destinationMarks.{k}"
                if col not in row:
                    row[col] = v
        else:
            row["destinationMarks.rowIndex"] = idx
            row["destinationMarks.value"] = json.dumps(item, ensure_ascii=False)
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
        default="data/grn_inbound_ocr_output.xlsx",
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
        array_sections=["Destination Marks"],
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
        rows.extend(expand_destination_marks_to_rows(record, source))

    df = with_source_first(pd.DataFrame(rows))
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="GRN INBOUND", index=False)
    print(f"Wrote Excel: {out_path}")
