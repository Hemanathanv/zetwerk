import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

try:
    import fitz  # PyMuPDF
except Exception as exc:  # pragma: no cover
    raise SystemExit("PyMuPDF is required. Install with: pip install pymupdf") from exc


@dataclass(frozen=True)
class RouteRule:
    doc_type: str
    script_name: str
    filename_terms: tuple[str, ...]
    text_patterns: tuple[tuple[str, int], ...]


ROUTE_RULES: tuple[RouteRule, ...] = (
    RouteRule(
        doc_type="Entry Summary Tariff Lines",
        script_name="entry_summary_tariff_lines.py",
        filename_terms=(
            "entry_summary_tariff_lines",
            "entry summary tariff lines",
            "tariff lines",
            "hts lines",
            "7501",
        ),
        text_patterns=(
            (r"\bentry summary\b", 6),
            (r"\btariff lines?\b", 10),
            (r"\bline items?\b", 8),
            (r"\bhts(?:us)?\b", 8),
            (r"\bduty amount\b", 4),
            (r"\brate\b", 3),
        ),
    ),
    RouteRule(
        doc_type="Entry Summary",
        script_name="entry_summary.py",
        filename_terms=("entry_summary", "entry summary", "boe", "7501"),
        text_patterns=(
            (r"\bentry summary\b", 8),
            (r"\bcbp form 7501\b", 8),
            (r"\bimporter of record\b", 4),
            (r"\bfiler code\b", 3),
            (r"\bsummary date\b", 3),
            (r"\bentry number\b", 3),
        ),
    ),
    RouteRule(
        doc_type="Shipping Bill",
        script_name="shipping_bill.py",
        filename_terms=("shipping_bill", "shipping bill", "icegate"),
        text_patterns=(
            (r"\bshipping bill\b", 8),
            (r"\bicegate\b", 8),
            (r"\bleo\b", 4),
            (r"\bep copy\b", 4),
            (r"\bdrawback\b", 3),
        ),
    ),
    RouteRule(
        doc_type="US Cargo Release Order",
        script_name="us_cargo_release.py",
        filename_terms=(
            "us cargo release",
            "cargo release",
            "release order",
        ),
        text_patterns=(
            (r"\bus cargo release order\b", 10),
            (r"\bcargo release order\b", 8),
            (r"\brelease port\b", 4),
            (r"\bstatement print date\b", 4),
            (r"\bbroker reference\b", 3),
            (r"\btruck/?vessel/?flight\b", 3),
            (r"\bmaster bill of lading\b", 3),
        ),
    ),
    RouteRule(
        doc_type="US Customs Release Order",
        script_name="us_custom_release.py",
        filename_terms=(
            "us custom release",
            "us customs release",
            "custom release",
            "customs release",
            "release order",
        ),
        text_patterns=(
            (r"\bus customs release order\b", 10),
            (r"\bus custom release order\b", 10),
            (r"\bcustoms release order\b", 8),
            (r"\bbond type\b", 4),
            (r"\bsurety code\b", 4),
            (r"\blocation of goods\s*\(firms\)\b", 4),
            (r"\bsignature of applicant\b", 4),
        ),
    ),
    RouteRule(
        doc_type="US Delivery Order",
        script_name="us_delivery_order.py",
        filename_terms=(
            "us delivery order",
            "delivery order",
            "do reference",
            "damco",
        ),
        text_patterns=(
            (r"\bus delivery order\b", 10),
            (r"\bdelivery order\b", 8),
            (r"\bdo reference number\b", 5),
            (r"\bdo file number\b", 5),
            (r"\bbill to party\b", 3),
            (r"\bit number\b", 3),
        ),
    ),
    RouteRule(
        doc_type="US Packing List",
        script_name="us_packing_list.py",
        filename_terms=(
            "us packing list",
            "packing slip",
            "packinglist",
        ),
        text_patterns=(
            (r"\bus packing list\b", 10),
            (r"\bpacking slip number\b", 8),
            (r"\btrailer loaded\b", 5),
            (r"\bfreight counted\b", 5),
            (r"\bliability limitation notice\b", 4),
            (r"\bproperty value declared\b", 4),
        ),
    ),
    RouteRule(
        doc_type="CHA Bill",
        script_name="cha.py",
        filename_terms=("cha", "blrch", "customs house agent"),
        text_patterns=(
            (r"\bcustoms house agent\b", 8),
            (r"\bcha invoice\b", 7),
            (r"\bcha bill\b", 7),
            (r"\bjob no\.?\b", 3),
            (r"\bcha\b", 2),
        ),
    ),
    RouteRule(
        doc_type="Delivery Deduction Sheet",
        script_name="dds.py",
        filename_terms=("dds", "deduction"),
        text_patterns=(
            (r"\bdelivery deduction sheet\b", 10),
            (r"\bdeduction sheet\b", 6),
            (r"\bdds\b", 5),
            (r"\bshipment reference\b", 2),
        ),
    ),
    RouteRule(
        doc_type="Steel Supplier Declaration",
        script_name="ssd.py",
        filename_terms=("ssd", "metal content", "supplier declaration"),
        text_patterns=(
            (r"\bsteel supplier declaration\b", 10),
            (r"\bmetal content\b", 8),
            (r"\bcountry of melt\b", 6),
            (r"\bcountry of pour\b", 6),
            (r"\bssd\b", 4),
        ),
    ),
    RouteRule(
        doc_type="Bill of Lading",
        script_name="bill_of_lading.py",
        filename_terms=("bill_of_lading", "bill of lading", "bol"),
        text_patterns=(
            (r"\bbill of lading\b", 10),
            (r"\bnotify party\b", 4),
            (r"\bbl no\.?\b", 3),
            (r"\bshipper\b", 2),
            (r"\bconsignee\b", 2),
        ),
    ),
    RouteRule(
        doc_type="Ocean Freight",
        script_name="ocean_freight.py",
        filename_terms=("ocean freight", "sea freight"),
        text_patterns=(
            (r"\bocean freight\b", 9),
            (r"\bsea freight\b", 7),
            (r"\bfreight charges?\b", 3),
            (r"\bvessel\b", 2),
            (r"\bvoyage\b", 2),
        ),
    ),
    RouteRule(
        doc_type="Freight Forwarder Bill",
        script_name="freight_forward.py",
        filename_terms=("freight forwarder", "forwarder"),
        text_patterns=(
            (r"\bfreight forwarder\b", 9),
            (r"\bhouse bill\b", 4),
            (r"\bmaster bill\b", 4),
            (r"\bhouse bol\b", 4),
            (r"\bdebit note\b", 3),
        ),
    ),
    RouteRule(
        doc_type="Packing List",
        script_name="packing_list.py",
        filename_terms=("packing list", "packing_list", "pkl"),
        text_patterns=(
            (r"\bpacking list\b", 10),
            (r"\bno\.?\s*of packages\b", 4),
            (r"\bgross weight\b", 3),
            (r"\bnet weight\b", 3),
            (r"\bmarks?\s+and\s+numbers?\b", 2),
        ),
    ),
    RouteRule(
        doc_type="Sales Invoices",
        script_name="sales_invoice.py",
        filename_terms=("sales invoice", "commercial invoice", "tax inv", "invoice"),
        text_patterns=(
            (r"\bsales invoice\b", 8),
            (r"\bcommercial invoice\b", 8),
            (r"\btax invoice\b", 6),
            (r"\binvoice no\.?\b", 2),
            (r"\binvoice date\b", 2),
        ),
    ),
)

OCR_SCRIPT_MAP = {
    "cha": "cha.py",
    "dds": "dds.py",
    "ssd": "ssd.py",
    "entry_summary": "entry_summary.py",
    "entry_summary_tariff_lines": "entry_summary_tariff_lines.py",
    "shipping_bill": "shipping_bill.py",
    "bill_of_lading": "bill_of_lading.py",
    "ocean_freight": "ocean_freight.py",
    "freight_forward": "freight_forward.py",
    "packing_list": "packing_list.py",
    "sales_invoice": "sales_invoice.py",
    "us_cargo_release": "us_cargo_release.py",
    "us_custom_release": "us_custom_release.py",
    "us_delivery_order": "us_delivery_order.py",
    "us_packing_list": "us_packing_list.py",
}

SCRIPT_SCHEMA_MAP: dict[str, str] = {
    "dds.py": "data/schemas/dds.json",
    "sales_invoice.py": "data/schemas/sales-invoice.json",
    "bill_of_lading.py": "data/schemas/bill-of-lading.json",
    "ocean_freight.py": "data/schemas/ocean-freight.json",
    "freight_forward.py": "data/schemas/freight-forwarder-bill.json",
    "packing_list.py": "data/schemas/packing-list.json",
    "entry_summary.py": "data/schemas/entry-summary.json",
    "entry_summary_tariff_lines.py": "data/schemas/entry-summary-tariff-lines.json",
    "ssd.py": "data/schemas/ssd.json",
    "us_cargo_release.py": "data/schemas/us-cargo-release.json",
    "us_custom_release.py": "data/schemas/us-custom-release.json",
    "us_delivery_order.py": "data/schemas/us-delivery-order.json",
    "us_packing_list.py": "data/schemas/us-packing-list.json",
}

OCR_METRICS_PREFIX = "OCR_METRICS_JSON: "
TEST_OCR_RESULT_PREFIX = "TEST_OCR_RESULT_JSON: "
DEFAULT_TEST_METRICS_LOG_PATH = Path("data/ocr_run_metrics_pagewise.jsonl")
DEFAULT_TEST_METRICS_EXCEL_PATH = Path("data/ocr_run_metrics_pagewise.xlsx")
DEFAULT_TEST_METRICS_RUN_SHEET = "test_run_metrics"
DEFAULT_TEST_METRICS_PAGEWISE_SHEET = "test_pagewise_metrics"
SCRIPT_DIR = Path(__file__).resolve().parent


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").lower()).strip()


def extract_pdf_text(pdf_path: Path, max_pages: int) -> str:
    parts: list[str] = []
    with fitz.open(str(pdf_path)) as doc:
        page_count = min(len(doc), max_pages)
        for page_idx in range(page_count):
            parts.append(doc[page_idx].get_text("text"))
    return normalize_text("\n".join(parts))


def score_rule(rule: RouteRule, filename_text: str, content_text: str) -> tuple[int, list[str]]:
    score = 0
    hits: list[str] = []

    for term in rule.filename_terms:
        if term in filename_text:
            score += 5
            hits.append(f"filename:{term}")

    for pattern, weight in rule.text_patterns:
        if re.search(pattern, content_text):
            score += weight
            hits.append(f"text:{pattern}")

    return score, hits


def confidence_label(top_score: int, second_score: int) -> str:
    margin = top_score - second_score
    if top_score >= 12 and margin >= 5:
        return "high"
    if top_score >= 7 and margin >= 3:
        return "medium"
    return "low"


def recommend_script(pdf_path: Path, max_pages: int) -> tuple[dict, list[dict], bool]:
    filename_text = normalize_text(pdf_path.name.replace("_", " "))
    content_text = extract_pdf_text(pdf_path, max_pages=max_pages)
    no_text_extracted = not bool(content_text.strip())

    results: list[dict] = []
    for rule in ROUTE_RULES:
        score, hits = score_rule(rule, filename_text=filename_text, content_text=content_text)
        results.append(
            {
                "doc_type": rule.doc_type,
                "script_name": rule.script_name,
                "score": score,
                "hits": hits,
            }
        )

    results.sort(key=lambda item: item["score"], reverse=True)
    return results[0], results, no_text_extracted


def print_recommendation(best: dict, ranked: list[dict], pdf_path: Path, no_text_extracted: bool) -> int:
    second_score = ranked[1]["score"] if len(ranked) > 1 else 0
    if best["score"] <= 0:
        print(f"File: {pdf_path}")
        print("OCR recommendation: UNKNOWN")
        print("Reason: no strong keyword match found for any OCR script.")
        return 2

    confidence = confidence_label(best["score"], second_score)
    print(f"File: {pdf_path}")
    print(f"OCR recommendation: {best['script_name']} ({best['doc_type']})")
    print(f"Confidence: {confidence} (score={best['score']}, runner-up={second_score})")

    if no_text_extracted:
        print("Note: PDF text layer appears empty; recommendation is mostly filename-based.")

    if best["hits"]:
        print("Matched signals:")
        for hit in best["hits"][:8]:
            print(f"- {hit}")

    print(
        f"Suggested command: {sys.executable} {best['script_name']} --input \"{pdf_path}\""
    )

    alternatives = [row for row in ranked[1:4] if row["score"] > 0]
    if alternatives:
        print("Other close matches:")
        for row in alternatives:
            print(f"- {row['script_name']} ({row['doc_type']}): score={row['score']}")
    return 0


def prompt_if_missing(value: str | None, label: str) -> str:
    if value:
        return value
    return input(label).strip()


def clean_user_path(raw_path: str) -> Path:
    text = (raw_path or "").strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in ("'", '"'):
        text = text[1:-1].strip()
    return Path(text).expanduser()


def _safe_int(value) -> int:
    try:
        if value is None:
            return 0
        return int(value)
    except Exception:
        return 0


def split_tokens_across_pages(total_tokens: int, page_count: int) -> list[int]:
    page_count = max(0, _safe_int(page_count))
    total_tokens = _safe_int(total_tokens)
    if page_count <= 0:
        return []
    base, rem = divmod(total_tokens, page_count)
    return [base + (1 if i < rem else 0) for i in range(page_count)]


def extract_ocr_metrics(output_lines: list[str]) -> dict | None:
    for line in reversed(output_lines):
        if not line.startswith(OCR_METRICS_PREFIX):
            continue
        payload = line[len(OCR_METRICS_PREFIX) :].strip()
        try:
            parsed = json.loads(payload)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None
    return None


def _norm_col(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value).lower())


def load_schema_fields(schema_path: Path) -> list[dict]:
    try:
        data = json.loads(schema_path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("rows", data.get("fields", []))
    return []


def check_field_coverage(output_excel_path: Path, schema_path: Path) -> dict:
    try:
        import pandas as pd
    except Exception:
        return {}

    fields = load_schema_fields(schema_path)
    if not fields:
        return {}

    try:
        all_sheets = pd.read_excel(output_excel_path, sheet_name=None)
    except Exception:
        return {}

    if not all_sheets:
        return {}

    # Build combined column→dataframe map across all sheets (first sheet wins on duplicates).
    col_norm_map: dict[str, str] = {}
    col_to_df: dict[str, pd.DataFrame] = {}
    for sheet_df in all_sheets.values():
        for col in sheet_df.columns:
            norm = _norm_col(col)
            if norm not in col_norm_map:
                col_norm_map[norm] = col
                col_to_df[norm] = sheet_df

    filled: list[dict] = []
    empty: list[dict] = []
    missing: list[dict] = []

    for field in fields:
        field_name = (field.get("fieldName") or "").strip()
        section = (field.get("section") or "").strip()
        required = bool(field.get("required", False))
        if not field_name:
            continue

        norm = _norm_col(field_name)
        matched_col = col_norm_map.get(norm)
        matched_df = col_to_df.get(norm)

        if matched_col is None:
            for cn, actual in col_norm_map.items():
                if cn.endswith(norm) and len(cn) > len(norm):
                    matched_col = actual
                    matched_df = col_to_df[cn]
                    break

        entry = {"section": section, "field": field_name, "required": required}

        if matched_col is None:
            missing.append(entry)
        else:
            series = matched_df[matched_col].dropna().astype(str).str.strip()
            has_data = not series.isin(["", "nan", "None"]).all()
            if has_data:
                filled.append({**entry, "column": matched_col})
            else:
                empty.append({**entry, "column": matched_col})

    total = len(filled) + len(empty) + len(missing)
    coverage_pct = round(len(filled) / total * 100, 1) if total > 0 else 0.0

    return {
        "total_schema_fields": total,
        "filled": len(filled),
        "empty": len(empty),
        "missing_columns": len(missing),
        "coverage_pct": coverage_pct,
        "filled_fields": [f["field"] for f in filled],
        "empty_fields": [f["field"] for f in empty],
        "missing_fields": [f["field"] for f in missing],
        "required_empty": [f["field"] for f in empty if f["required"]],
        "required_missing": [f["field"] for f in missing if f["required"]],
    }


def append_jsonl_rows(log_path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def append_rows_to_excel(excel_path: Path, sheet_name: str, rows: list[dict]) -> None:
    if not rows:
        return
    try:
        import pandas as pd
    except Exception as exc:
        print(f"[WARN] Could not write Excel metrics (pandas missing): {exc}")
        return

    excel_path.parent.mkdir(parents=True, exist_ok=True)
    existing_sheets = {}
    if excel_path.exists():
        try:
            existing_sheets = pd.read_excel(excel_path, sheet_name=None)
        except Exception:
            existing_sheets = {}

    existing_df = existing_sheets.get(sheet_name)
    if existing_df is None:
        existing_df = pd.DataFrame()

    new_df = pd.DataFrame(rows)
    existing_sheets[sheet_name] = pd.concat([existing_df, new_df], ignore_index=True)

    try:
        with pd.ExcelWriter(excel_path, engine="openpyxl") as writer:
            for name, df in existing_sheets.items():
                if df is None:
                    df = pd.DataFrame()
                if not isinstance(df, pd.DataFrame):
                    df = pd.DataFrame(df)
                df.to_excel(writer, sheet_name=name[:31], index=False)
    except Exception as exc:
        print(f"[WARN] Could not write Excel metrics to {excel_path.resolve()}: {exc}")


def script_to_doc_type(script_name: str) -> str:
    for rule in ROUTE_RULES:
        if rule.script_name == script_name:
            return rule.doc_type
    return "Unknown"


def persist_test_run_metrics(
    *,
    script_name: str,
    pdf_path: Path,
    return_code: int,
    elapsed_seconds: float,
    metrics: dict | None,
    log_path: Path,
    excel_path: Path,
    run_sheet: str,
    page_sheet: str,
) -> None:
    run_id = datetime.now(timezone.utc).strftime("test_ocr_%Y%m%dT%H%M%SZ")
    run_timestamp_utc = datetime.now(timezone.utc).isoformat()
    pages = _safe_int((metrics or {}).get("pages"))
    input_tokens = _safe_int((metrics or {}).get("input_tokens"))
    output_tokens = _safe_int((metrics or {}).get("output_tokens"))
    status = "success" if return_code == 0 else "failed"

    run_row = {
        "run_id": run_id,
        "run_timestamp_utc": run_timestamp_utc,
        "status": status,
        "return_code": return_code,
        "script_name": script_name,
        "doc_title": script_to_doc_type(script_name),
        "pdf_path": str(pdf_path.resolve()),
        "pdf_name": pdf_path.name,
        "pdf_size_bytes": _safe_int(pdf_path.stat().st_size if pdf_path.exists() else 0),
        "elapsed_seconds": round(elapsed_seconds, 3),
        "model": (metrics or {}).get("model"),
        "run_status": (metrics or {}).get("run_status"),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "pages": pages,
        "input_tokens_per_page": (metrics or {}).get("input_tokens_per_page", 0),
        "output_tokens_per_page": (metrics or {}).get("output_tokens_per_page", 0),
    }

    page_rows: list[dict] = []
    if pages > 0:
        per_page_input = split_tokens_across_pages(input_tokens, pages)
        per_page_output = split_tokens_across_pages(output_tokens, pages)
        for idx in range(pages):
            page_rows.append(
                {
                    "run_id": run_id,
                    "run_timestamp_utc": run_timestamp_utc,
                    "script_name": script_name,
                    "doc_title": script_to_doc_type(script_name),
                    "pdf_path": str(pdf_path.resolve()),
                    "pdf_name": pdf_path.name,
                    "page_no": idx + 1,
                    "input_tokens": per_page_input[idx],
                    "output_tokens": per_page_output[idx],
                }
            )

    append_jsonl_rows(log_path, [run_row])
    append_rows_to_excel(excel_path, run_sheet, [run_row])
    append_rows_to_excel(excel_path, page_sheet, page_rows)
    print(f"Saved test OCR metrics JSONL: {log_path.resolve()}")
    print(
        f"Saved test OCR metrics Excel: {excel_path.resolve()} "
        f"(sheet: {run_sheet})"
    )
    if page_rows:
        print(
            "Saved test OCR pagewise metrics Excel: "
            f"{excel_path.resolve()} (sheet: {page_sheet})"
        )


def select_script_name(ocr_choice: str, pdf_path: Path, max_pages: int) -> tuple[str | None, int]:
    choice = (ocr_choice or "auto").strip().lower()
    if choice in ("auto", "classify", "suggest"):
        best, ranked, no_text_extracted = recommend_script(pdf_path, max_pages=max_pages)
        code = print_recommendation(best, ranked, pdf_path, no_text_extracted)
        if best["score"] <= 0:
            return None, code
        return best["script_name"], code

    script_name = OCR_SCRIPT_MAP.get(choice)
    if not script_name:
        valid = ", ".join(["auto"] + sorted(OCR_SCRIPT_MAP.keys()))
        raise SystemExit(f"Unknown OCR type '{ocr_choice}'. Use one of: {valid}")

    print(f"File: {pdf_path}")
    print(f"OCR selected by user: {choice} -> {script_name}")
    print(f"Suggested command: {sys.executable} {script_name} --input \"{pdf_path}\"")
    return script_name, 0


def emit_test_result(payload: dict) -> None:
    print(f"{TEST_OCR_RESULT_PREFIX}{json.dumps(payload, ensure_ascii=False)}")


def main() -> int:
    # Keep all relative paths stable regardless of where command is launched from.
    os.chdir(SCRIPT_DIR)

    parser = argparse.ArgumentParser(
        description="Test OCR helper: choose OCR type manually or auto-classify one PDF."
    )
    parser.add_argument("--input", help="Path to a single PDF file")
    parser.add_argument(
        "--ocr",
        default="auto",
        help=(
            "OCR type: auto, cha, dds, ssd, entry_summary, entry_summary_tariff_lines, shipping_bill, "
            "bill_of_lading, ocean_freight, freight_forward, packing_list, sales_invoice, "
            "us_cargo_release, us_custom_release, us_delivery_order, us_packing_list"
        ),
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=2,
        help="Pages to scan for text signals (default: 2)",
    )
    parser.add_argument(
        "--run",
        action="store_true",
        help="Run the selected/recommended OCR script immediately.",
    )
    parser.add_argument(
        "--metrics-log-path",
        default=str(
            (SCRIPT_DIR / Path(
                os.getenv("OCR_TEST_METRICS_LOG_PATH")
                or DEFAULT_TEST_METRICS_LOG_PATH
            )).resolve()
        ),
        help="JSONL path for test OCR run metrics.",
    )
    parser.add_argument(
        "--metrics-excel-path",
        default=str(
            (SCRIPT_DIR / Path(
                os.getenv("OCR_TEST_METRICS_EXCEL_PATH")
                or DEFAULT_TEST_METRICS_EXCEL_PATH
            )).resolve()
        ),
        help="Excel path for test OCR run + pagewise metrics.",
    )
    parser.add_argument(
        "--metrics-run-sheet",
        default=os.getenv("OCR_TEST_METRICS_RUN_SHEET", DEFAULT_TEST_METRICS_RUN_SHEET),
        help="Excel sheet name for run-level metrics.",
    )
    parser.add_argument(
        "--metrics-pagewise-sheet",
        default=os.getenv(
            "OCR_TEST_METRICS_PAGEWISE_SHEET",
            DEFAULT_TEST_METRICS_PAGEWISE_SHEET,
        ),
        help="Excel sheet name for pagewise token metrics.",
    )
    args = parser.parse_args()

    input_path = args.input
    ocr_choice = args.ocr
    should_run = args.run

    if not input_path:
        if not sys.stdin.isatty():
            raise SystemExit("Missing --input. Pass --input or run interactively.")
        input_path = prompt_if_missing(None, "Enter PDF path: ")
        ocr_choice = (
            prompt_if_missing(
                None,
                (
                    "Enter OCR type (auto/cha/dds/ssd/entry_summary/shipping_bill/"
                    "entry_summary_tariff_lines/bill_of_lading/ocean_freight/freight_forward/"
                    "packing_list/sales_invoice/"
                    "us_cargo_release/us_custom_release/us_delivery_order/us_packing_list): "
                ),
            )
            or "auto"
        )
        run_choice = prompt_if_missing(None, "Run OCR now? (y/n): ").lower()
        should_run = run_choice in ("y", "yes")

    pdf_path = clean_user_path(input_path)
    if not pdf_path.exists() or not pdf_path.is_file():
        raise SystemExit(f"Input file not found: {pdf_path}")
    if pdf_path.suffix.lower() != ".pdf":
        raise SystemExit("Input must be a .pdf file")

    script_name, code = select_script_name(
        ocr_choice=ocr_choice,
        pdf_path=pdf_path,
        max_pages=max(1, args.max_pages),
    )

    if should_run and script_name:
        test_output_path = SCRIPT_DIR / "data" / f"{Path(script_name).stem}_test_output.xlsx"
        # cha.py uses --local flag; all cli_main-based scripts use OCR_FORCE_LOCAL_INPUT env var
        local_flags = ["--local"] if script_name == "cha.py" else []
        cmd = [
            sys.executable, script_name,
            "--input", str(pdf_path),
            *local_flags,
            "--output", str(test_output_path),
        ]
        subprocess_env = {**os.environ, "OCR_FORCE_LOCAL_INPUT": "1"}
        print(f"Running: {' '.join(cmd)}")
        start = time.time()
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=subprocess_env,
        )

        output_lines: list[str] = []
        assert proc.stdout is not None
        for line in proc.stdout:
            clean = line.rstrip("\n")
            output_lines.append(clean)
            print(clean)
        return_code = proc.wait()
        elapsed_seconds = time.time() - start

        metrics = extract_ocr_metrics(output_lines)
        if metrics is None:
            print(
                "[WARN] OCR_METRICS_JSON not found in script output; "
                "saving run row with zero token/page metrics."
            )

        # Field coverage check
        coverage: dict = {}
        schema_rel = SCRIPT_SCHEMA_MAP.get(script_name)
        if schema_rel and return_code == 0 and test_output_path.exists():
            coverage = check_field_coverage(test_output_path, SCRIPT_DIR / schema_rel)
            if coverage:
                total = coverage["total_schema_fields"]
                filled = coverage["filled"]
                pct = coverage["coverage_pct"]
                print(f"\n--- Field Coverage: {filled}/{total} fields ({pct}%) ---")
                if coverage["filled_fields"]:
                    print(f"Filled  : {', '.join(coverage['filled_fields'])}")
                if coverage["empty_fields"]:
                    print(f"Empty   : {', '.join(coverage['empty_fields'])}")
                if coverage["required_empty"]:
                    print(f"[WARN] Required fields empty   : {', '.join(coverage['required_empty'])}")
                if coverage["required_missing"]:
                    print(f"[WARN] Required fields missing : {', '.join(coverage['required_missing'])}")

        persist_test_run_metrics(
            script_name=script_name,
            pdf_path=pdf_path,
            return_code=return_code,
            elapsed_seconds=elapsed_seconds,
            metrics=metrics,
            log_path=Path(args.metrics_log_path).resolve(),
            excel_path=Path(args.metrics_excel_path).resolve(),
            run_sheet=args.metrics_run_sheet,
            page_sheet=args.metrics_pagewise_sheet,
        )
        emit_test_result(
            {
                "requested_ocr": (ocr_choice or "").strip().lower(),
                "resolved_script_name": script_name,
                "resolved_doc_type": script_to_doc_type(script_name),
                "input_pdf": str(pdf_path.resolve()),
                "output_excel": str(test_output_path),
                "run": True,
                "return_code": return_code,
                "metrics_found": bool(metrics),
                "input_tokens": _safe_int((metrics or {}).get("input_tokens")),
                "output_tokens": _safe_int((metrics or {}).get("output_tokens")),
                "pages": _safe_int((metrics or {}).get("pages")),
                "field_coverage": coverage or None,
            }
        )
        return return_code

    if script_name:
        emit_test_result(
            {
                "requested_ocr": (ocr_choice or "").strip().lower(),
                "resolved_script_name": script_name,
                "resolved_doc_type": script_to_doc_type(script_name),
                "input_pdf": str(pdf_path.resolve()),
                "run": False,
                "return_code": code,
            }
        )

    return code


if __name__ == "__main__":
    raise SystemExit(main())
