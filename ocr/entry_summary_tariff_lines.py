import argparse
import os
import re
from pathlib import Path

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
    extract_ts_map,
    get_pdf_entries,
    get_template_columns,
    load_schema,
)

DOC_TITLE = "Entry Summary Tariff Lines"
SCHEMA_PATH = Path("data/schemas/entry-summary-tariff-lines.json")
PROMPT_TS = Path("src/prompts/entry-summary-structured-prompt.ts")

FIELD_KEY_MAP = extract_ts_map(PROMPT_TS, "CANONICAL_JSON_KEY_BY_FIELD_NAME")

FALLBACK_OUTPUT_COLUMNS = [
    "Source File",
    "Header - Filer Code Entry Number",
    "Line No",
    "Line Merchandise Description",
    "Line HTSUS Number",
    "Tariff Line - HTSUS Number",
    "Tariff Line - Description",
    "Tariff Line - Gross Weight",
    "Tariff Line - Net Quantity",
    "Tariff Line - Net Quantity Unit",
    "Tariff Line - Entered Value",
    "Tariff Line - Rate",
    "Tariff Line - Duty Amount",
]

TARIFF_EXTRACTION_PREAMBLE = """
You are a precision extractor for US Entry Summary tariff-line documents.

Critical rules:
1. Read every page and search every required header and value.
2. Return one JSON object only (no markdown fences).
3. Include top-level keys: source, header, general, tariffLine.
4. header.filerCodeEntryNumber must be extracted when visible.
5. general should contain one or more entry lines (lineNo, lineMerchandiseDescription, lineHtsusNumber).
6. tariffLine should contain every tariff row (htsusNumber, description, grossWeight, netQuantity, netQuantityUnit, enteredValue, rate, dutyAmount).
7. Keep values exactly as printed where possible; blanks should be null or empty string.
"""


def normalize_label(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def normalize_space(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def clean_source_name(name):
    text = str(name or "").strip().replace("\\", "/")
    if "/" in text:
        text = text.split("/")[-1]
    return re.sub(r"__[-A-Za-z0-9_]{6,}(?=\.pdf$)", "", text, flags=re.IGNORECASE)


def is_empty(value):
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return len(value) == 0
    if isinstance(value, dict):
        return len(value) == 0
    return False


def safe_value(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return str(value)
    return value


def lookup_key_fuzzy(obj, target_key):
    if not isinstance(obj, dict):
        return None
    if target_key in obj:
        return obj.get(target_key)
    target_norm = normalize_label(target_key)
    for key, value in obj.items():
        if normalize_label(key) == target_norm:
            return value
    return None


def first_non_empty(obj, aliases):
    for alias in aliases:
        value = lookup_key_fuzzy(obj, alias)
        if not is_empty(value):
            return safe_value(value)
    return ""


def ensure_dict_list(value):
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def extract_line_items(record):
    if not isinstance(record, dict):
        return []
    for key in ("lineItems", "lineItem", "general", "lines", "items"):
        items = ensure_dict_list(lookup_key_fuzzy(record, key))
        if items:
            return items
    return []


def extract_tariff_entries(container):
    if not isinstance(container, dict):
        return []
    for key in (
        "tariffLines",
        "tariffLine",
        "tariffs",
        "dutyLines",
        "dutyLine",
    ):
        rows = ensure_dict_list(lookup_key_fuzzy(container, key))
        if rows:
            return rows

    # Treat the object itself as a tariff row if tariff-like fields are present.
    if any(
        not is_empty(lookup_key_fuzzy(container, k))
        for k in (
            "htsusNumber",
            "description",
            "grossWeight",
            "netQuantity",
            "enteredValue",
            "rate",
            "dutyAmount",
        )
    ):
        return [container]
    return []


def evenly_split(items, buckets):
    if buckets <= 0:
        return []
    out = [[] for _ in range(buckets)]
    if not items:
        return out
    base, rem = divmod(len(items), buckets)
    idx = 0
    for i in range(buckets):
        take = base + (1 if i < rem else 0)
        out[i] = items[idx : idx + take]
        idx += take
    return out


def make_empty_row(source_file):
    return {col: (source_file if col == "Source File" else "") for col in FALLBACK_OUTPUT_COLUMNS}


def row_has_data(row):
    for key, value in row.items():
        if key == "Source File":
            continue
        if not is_empty(value):
            return True
    return False


def parse_tariff_rows_from_pdf(pdf_path, source_file, max_pages=None):
    try:
        with fitz.open(str(pdf_path)) as doc:
            page_count = len(doc) if max_pages is None else min(len(doc), max(1, max_pages))
            lines = []
            for i in range(page_count):
                for raw in (doc[i].get_text("text") or "").splitlines():
                    line = normalize_space(raw)
                    if line:
                        lines.append(line)
    except Exception:
        return [make_empty_row(source_file)]

    if not lines:
        return [make_empty_row(source_file)]

    filer_code = ""
    for idx, line in enumerate(lines):
        if "filer code/entry number" in line.lower():
            if idx + 1 < len(lines):
                candidate = normalize_space(lines[idx + 1])
                if candidate:
                    filer_code = candidate
                    break
    if not filer_code:
        for line in lines:
            match = re.search(r"\b([A-Z0-9]{2,4}\s+\d{6,})\b", line)
            if match:
                filer_code = normalize_space(match.group(1))
                break

    hts_pattern = re.compile(
        r"^(\d{4}\.\d{2}\.\d{2}(?:\.\d{2})?)\s+([0-9][0-9,]*(?:\.\d+)?)?(?:\s+([0-9][0-9,]*(?:\.\d+)?))?$"
    )
    line_no_pattern = re.compile(r"^\d{1,3}$")

    blocks = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line_no_pattern.fullmatch(line):
            lookahead = lines[i + 1 : i + 8]
            if any(hts_pattern.match(x) for x in lookahead):
                line_no = line
                j = i + 1
                while j < len(lines):
                    if line_no_pattern.fullmatch(lines[j]):
                        next_lookahead = lines[j + 1 : j + 8]
                        if any(hts_pattern.match(x) for x in next_lookahead):
                            break
                    j += 1
                blocks.append((line_no, lines[i + 1 : j]))
                i = j
                continue
        i += 1

    if not blocks:
        base = make_empty_row(source_file)
        base["Header - Filer Code Entry Number"] = filer_code
        return [base]

    rows = []
    for line_no, block in blocks:
        tariffs = []
        for idx, line in enumerate(block):
            match = hts_pattern.match(line)
            if not match:
                continue
            htsus = normalize_space(match.group(1))
            entered_value = normalize_space(match.group(2) or "")
            qty = normalize_space(match.group(3) or "")
            description = ""
            for candidate in block[idx + 1 : idx + 4]:
                if hts_pattern.match(candidate):
                    break
                if re.fullmatch(r"[\d\.,$%]+", candidate):
                    continue
                if candidate.upper() in {"INV", "NDC", "EV"}:
                    continue
                description = candidate
                break
            tariffs.append(
                {
                    "htsus": htsus,
                    "description": description,
                    "entered_value": entered_value,
                    "net_quantity": qty,
                }
            )

        if not tariffs:
            base = make_empty_row(source_file)
            base["Header - Filer Code Entry Number"] = filer_code
            base["Line No"] = line_no
            rows.append(base)
            continue

        primary = next((t for t in reversed(tariffs) if not t["htsus"].startswith("99")), tariffs[-1])
        for tariff in tariffs:
            row = make_empty_row(source_file)
            row["Header - Filer Code Entry Number"] = filer_code
            row["Line No"] = line_no
            row["Line Merchandise Description"] = primary.get("description", "")
            row["Line HTSUS Number"] = primary.get("htsus", "")
            row["Tariff Line - HTSUS Number"] = tariff.get("htsus", "")
            row["Tariff Line - Description"] = tariff.get("description", "")
            row["Tariff Line - Net Quantity"] = tariff.get("net_quantity", "")
            row["Tariff Line - Entered Value"] = tariff.get("entered_value", "")
            rows.append(row)
    return rows or [make_empty_row(source_file)]


def build_rows(records, sources, pdf_path_by_source, max_pages=None):
    rows = []
    for record, source_file in zip(records, sources):
        source_file = clean_source_name(source_file)
        record_rows = []
        header_obj = {}
        if isinstance(record, dict):
            maybe_header = lookup_key_fuzzy(record, "header")
            if isinstance(maybe_header, dict):
                header_obj = maybe_header

        filer_code = first_non_empty(
            header_obj if header_obj else (record if isinstance(record, dict) else {}),
            ["filerCodeEntryNumber", "filerCodeEntryNo", "entryNumber", "filerCode"],
        )

        line_items = extract_line_items(record) if isinstance(record, dict) else []
        top_tariffs = extract_tariff_entries(record) if isinstance(record, dict) else []

        line_level_tariffs = {}
        unassigned_tariffs = []
        for tariff in top_tariffs:
            line_no = normalize_space(
                str(
                    first_non_empty(
                        tariff,
                        ["lineNo", "lineNumber", "line"],
                    )
                )
            )
            if line_no:
                line_level_tariffs.setdefault(line_no, []).append(tariff)
            else:
                unassigned_tariffs.append(tariff)

        distributed_tariffs = []
        if line_items and unassigned_tariffs:
            distributed_tariffs = evenly_split(unassigned_tariffs, len(line_items))

        if line_items:
            for idx, line_item in enumerate(line_items):
                line_no = first_non_empty(line_item, ["lineNo", "lineNumber", "line"])
                line_desc = first_non_empty(
                    line_item,
                    [
                        "lineMerchandiseDescription",
                        "merchandiseDescription",
                        "lineDescription",
                        "description",
                    ],
                )
                line_htsus = first_non_empty(
                    line_item,
                    ["lineHtsusNumber", "htsusNumber", "lineHtsus", "hsCode"],
                )

                tariffs = extract_tariff_entries(line_item)
                if not tariffs:
                    tariffs = line_level_tariffs.get(normalize_space(str(line_no)), [])
                if not tariffs and distributed_tariffs:
                    tariffs = distributed_tariffs[idx]
                if not tariffs:
                    tariffs = [{}]

                for tariff in tariffs:
                    row = make_empty_row(source_file)
                    row["Header - Filer Code Entry Number"] = filer_code
                    row["Line No"] = safe_value(line_no)
                    row["Line Merchandise Description"] = safe_value(line_desc)
                    row["Line HTSUS Number"] = safe_value(line_htsus)
                    row["Tariff Line - HTSUS Number"] = first_non_empty(
                        tariff,
                        ["htsusNumber", "lineHtsusNumber", "htsus", "hsCode"],
                    )
                    row["Tariff Line - Description"] = first_non_empty(
                        tariff, ["description", "tariffDescription", "lineMerchandiseDescription"]
                    )
                    row["Tariff Line - Gross Weight"] = first_non_empty(
                        tariff, ["grossWeight", "grossWt", "weight"]
                    )
                    row["Tariff Line - Net Quantity"] = first_non_empty(
                        tariff, ["netQuantity", "quantity", "netQty"]
                    )
                    row["Tariff Line - Net Quantity Unit"] = first_non_empty(
                        tariff, ["netQuantityUnit", "quantityUnit", "unit"]
                    )
                    row["Tariff Line - Entered Value"] = first_non_empty(
                        tariff, ["enteredValue", "entryValue", "entval", "value"]
                    )
                    row["Tariff Line - Rate"] = first_non_empty(
                        tariff, ["rate", "dutyRate", "htsusRate"]
                    )
                    row["Tariff Line - Duty Amount"] = first_non_empty(
                        tariff, ["dutyAmount", "duty", "amount", "htsusDuty"]
                    )
                    record_rows.append(row)
        else:
            base = make_empty_row(source_file)
            base["Header - Filer Code Entry Number"] = filer_code
            general_obj = (
                lookup_key_fuzzy(record, "general")
                if isinstance(record, dict)
                else None
            )
            if isinstance(general_obj, dict):
                base["Line No"] = first_non_empty(general_obj, ["lineNo", "lineNumber", "line"])
                base["Line Merchandise Description"] = first_non_empty(
                    general_obj,
                    [
                        "lineMerchandiseDescription",
                        "merchandiseDescription",
                        "lineDescription",
                        "description",
                    ],
                )
                base["Line HTSUS Number"] = first_non_empty(
                    general_obj, ["lineHtsusNumber", "htsusNumber", "lineHtsus", "hsCode"]
                )

            tariffs = top_tariffs or [{}]
            for tariff in tariffs:
                row = dict(base)
                if isinstance(tariff, dict):
                    row["Tariff Line - HTSUS Number"] = first_non_empty(
                        tariff, ["htsusNumber", "lineHtsusNumber", "htsus", "hsCode"]
                    )
                    row["Tariff Line - Description"] = first_non_empty(
                        tariff, ["description", "tariffDescription", "lineMerchandiseDescription"]
                    )
                    row["Tariff Line - Gross Weight"] = first_non_empty(
                        tariff, ["grossWeight", "grossWt", "weight"]
                    )
                    row["Tariff Line - Net Quantity"] = first_non_empty(
                        tariff, ["netQuantity", "quantity", "netQty"]
                    )
                    row["Tariff Line - Net Quantity Unit"] = first_non_empty(
                        tariff, ["netQuantityUnit", "quantityUnit", "unit"]
                    )
                    row["Tariff Line - Entered Value"] = first_non_empty(
                        tariff, ["enteredValue", "entryValue", "entval", "value"]
                    )
                    row["Tariff Line - Rate"] = first_non_empty(
                        tariff, ["rate", "dutyRate", "htsusRate"]
                    )
                    row["Tariff Line - Duty Amount"] = first_non_empty(
                        tariff, ["dutyAmount", "duty", "amount", "htsusDuty"]
                    )
                record_rows.append(row)

        if not record_rows or all(not row_has_data(r) for r in record_rows):
            fallback_pdf = (
                pdf_path_by_source.get(source_file)
                or pdf_path_by_source.get(str(source_file))
                or pdf_path_by_source.get(clean_source_name(source_file))
            )
            if fallback_pdf:
                record_rows = parse_tariff_rows_from_pdf(
                    fallback_pdf,
                    source_file=source_file,
                    max_pages=max_pages,
                )
            elif not record_rows:
                record_rows = [make_empty_row(source_file)]

        rows.extend(record_rows)

    if not rows:
        rows = [make_empty_row("")]
    return rows


def get_output_columns():
    columns = get_template_columns("Entry Summary Tariff Lines")
    if not columns:
        columns = list(FALLBACK_OUTPUT_COLUMNS)
    if "Source File" not in columns:
        columns = ["Source File"] + [c for c in columns if c != "Source File"]
    missing_required = [c for c in FALLBACK_OUTPUT_COLUMNS if c not in columns]
    if missing_required:
        columns.extend(missing_required)
    return columns


def preserve_required_columns(aligned_df, original_df, required_columns):
    df = aligned_df.copy()
    for col in required_columns:
        if col in df.columns:
            continue
        if col in original_df.columns:
            df[col] = original_df[col]
        else:
            df[col] = ""
    ordered = [c for c in df.columns if c not in required_columns] + required_columns
    return df[ordered]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=f"{DOC_TITLE} OCR extraction")
    parser.add_argument("--input", default="data/input", help="PDF file or folder containing PDF files.")
    parser.add_argument(
        "--output",
        default="data/entry_summary_tariff_lines_ocr_output.xlsx",
        help="Output Excel file path.",
    )
    parser.add_argument("--schema", default=str(SCHEMA_PATH), help="Schema file path (.json/.csv/.xlsx).")
    parser.add_argument("--dpi", type=int, default=300, help="Render DPI for PDF pages.")
    parser.add_argument("--max-pages", type=int, default=None)
    parser.add_argument(
        "--model",
        default=None,
        help="Override model id for this run (example: google/gemini-3.1-pro-preview).",
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

    if args.model:
        os.environ["OPENAI_MODEL"] = args.model.strip()
        print(f"Using model override: {os.environ['OPENAI_MODEL']}")
    elif not args.no_prefer_pro_model:
        pro_model = os.getenv("OPENROUTER_MODEL_PRO", "").strip()
        if pro_model:
            os.environ["OPENAI_MODEL"] = pro_model
            print(f"Using high-accuracy model from OPENROUTER_MODEL_PRO: {pro_model}")

    schema_rows = load_schema(Path(args.schema))
    preamble_from_ts = extract_prompt_preamble(PROMPT_TS)
    preamble = "\n\n".join([x for x in [TARIFF_EXTRACTION_PREAMBLE.strip(), preamble_from_ts] if x])
    prompt = build_prompt_from_schema(
        schema_rows=schema_rows,
        doc_title=DOC_TITLE,
        array_sections=["General", "Tariff Line"],
        key_style="camel",
        field_key_map=FIELD_KEY_MAP,
        preamble=preamble,
        add_tariff_lines=False,
    )

    records, sources = extract_records_with_sources(
        input_path=Path(args.input),
        prompt_text=prompt,
        doc_title=DOC_TITLE,
        use_drive=args.drive,
        dpi=args.dpi,
        max_pages=args.max_pages,
    )

    pdf_entries = get_pdf_entries(
        input_path=Path(args.input),
        doc_title=DOC_TITLE,
        use_drive=args.drive,
    )
    pdf_path_by_source = {}
    for pdf_path, source_name in pdf_entries:
        pdf_path_by_source[source_name] = pdf_path
        pdf_path_by_source[clean_source_name(source_name)] = pdf_path
        pdf_path_by_source[str(source_name)] = pdf_path

    output_columns = get_output_columns()
    rows = build_rows(
        records=records,
        sources=sources,
        pdf_path_by_source=pdf_path_by_source,
        max_pages=args.max_pages,
    )

    df = pd.DataFrame(rows, columns=output_columns)
    pre_aligned_df = df.copy()
    df = align_df_to_template_columns(df, "Entry Summary Tariff Lines")
    df = preserve_required_columns(df, pre_aligned_df, FALLBACK_OUTPUT_COLUMNS)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Entry Summary Tariff Lines", index=False)
    print(f"Wrote Excel: {out_path}")
