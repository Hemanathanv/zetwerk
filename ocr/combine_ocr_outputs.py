import argparse
import re
from pathlib import Path

import pandas as pd


BASE_DIR = Path(__file__).resolve().parent


def resolve_runtime_path(path_like):
    path = Path(path_like).expanduser()
    if path.is_absolute():
        return path

    cwd_candidate = Path.cwd() / path
    base_candidate = BASE_DIR / path
    if cwd_candidate.exists():
        return cwd_candidate
    if base_candidate.exists():
        return base_candidate
    if path.parts and path.parts[0].lower() in {"data", "src", "output"}:
        return base_candidate
    return cwd_candidate


DEFAULT_TEMPLATE = Path(r"C:\Users\Admin\Downloads\Copy of Zetwerk Logistics OCR.xlsx")
DEFAULT_OUTPUT = BASE_DIR / "data" / "consolidated_all_ocr.xlsx"


def normalize_col_name(value: str) -> str:
    text = str(value or "").strip().lower()
    return "".join(ch for ch in text if ch.isalnum())


def clean_source_name(name: str) -> str:
    text = str(name or "").strip().replace("\\", "/")
    if "/" in text:
        text = text.split("/")[-1]
    return re.sub(r"__[-A-Za-z0-9_]{6,}(?=\.pdf$)", "", text, flags=re.IGNORECASE)


def read_first_sheet(path: Path) -> pd.DataFrame:
    workbook = pd.read_excel(path, sheet_name=None)
    if not workbook:
        return pd.DataFrame()
    first_sheet = next(iter(workbook))
    return workbook[first_sheet]


def load_source_sheet(file_path: Path, sheet_name: str | None) -> pd.DataFrame:
    if not file_path.exists():
        print(f"[WARN] Missing source file: {file_path}")
        return pd.DataFrame()

    if sheet_name is None:
        return read_first_sheet(file_path)

    workbook = pd.read_excel(file_path, sheet_name=None)
    if sheet_name not in workbook:
        print(f"[WARN] Missing sheet '{sheet_name}' in {file_path.name}")
        return pd.DataFrame()
    return workbook[sheet_name]


def pick_matching_column(
    target_col: str,
    source_col_by_norm: dict[str, list[str]],
    fallback_map: dict[str, list[str]],
) -> str | None:
    target_norm = normalize_col_name(target_col)

    for key in [target_norm] + fallback_map.get(target_norm, []):
        options = source_col_by_norm.get(key)
        if options:
            return options[0]
    return None


def align_to_template_columns(
    source_df: pd.DataFrame,
    template_columns: list[str],
) -> tuple[pd.DataFrame, int]:
    if source_df.empty:
        return pd.DataFrame(columns=template_columns), 0

    source_col_by_norm: dict[str, list[str]] = {}
    for col in source_df.columns:
        source_col_by_norm.setdefault(normalize_col_name(col), []).append(col)

    fallback_map: dict[str, list[str]] = {
        normalize_col_name("Source File"): [normalize_col_name("source_file")],
        normalize_col_name("Source File Path"): [
            normalize_col_name("source_file_path"),
            normalize_col_name("sourcepath"),
            normalize_col_name("file_path"),
        ],
        normalize_col_name("Date"): [
            normalize_col_name("updated_date"),
            normalize_col_name("modified_date"),
        ],
    }

    out = pd.DataFrame(index=source_df.index)
    matched = 0
    for col in template_columns:
        source_col = pick_matching_column(col, source_col_by_norm, fallback_map)
        if source_col is None:
            out[col] = ""
        else:
            out[col] = source_df[source_col]
            matched += 1

    source_col_norm = normalize_col_name("Source File")
    if source_col_norm in [normalize_col_name(c) for c in out.columns]:
        for c in out.columns:
            if normalize_col_name(c) == source_col_norm:
                out[c] = out[c].map(clean_source_name)
                break
    return out, matched


def ensure_entry_summary_extra_columns(sheet_name, template_columns):
    if sheet_name != "Entry Summary":
        return template_columns

    cols = list(template_columns)
    extras = ["Header - INV VAL US", "Header - ENTVAL", "Header - Total Package"]
    insert_after = "Header - Form Number"
    for extra in extras:
        if extra in cols:
            continue
        if insert_after in cols:
            idx = cols.index(insert_after) + 1
            cols.insert(idx, extra)
            insert_after = extra
        else:
            cols.append(extra)
    return cols


def build_sheet_map() -> dict[str, tuple[Path, str | None]]:
    return {
        "Entry Summary": (resolve_runtime_path(Path("data/entry_summary_ocr_output.xlsx")), None),
        "Entry Summary Tariff Lines": (
            resolve_runtime_path(Path("data/entry_summary_tariff_lines_ocr_output.xlsx")),
            None,
        ),
        "Steel Supplier Declaration": (
            resolve_runtime_path(Path("data/steel_supplier_declaration_ocr_output.xlsx")),
            "Steel Supplier Declaration",
        ),
        "SSD Reference Invoices": (
            resolve_runtime_path(Path("data/steel_supplier_declaration_ocr_output.xlsx")),
            "SSD Reference Invoices",
        ),
        "Shipping Bill": (resolve_runtime_path(Path("data/shipping_bill_ocr_output.xlsx")), None),
        "Delivery Deduction Sheet": (
            resolve_runtime_path(Path("data/delivery_deduction_sheet_ocr_output.xlsx")),
            None,
        ),
        "Ocean Freight Invoice": (resolve_runtime_path(Path("data/ocean_freight_ocr_output.xlsx")), None),
        "Packing Lists": (resolve_runtime_path(Path("data/packing_list_ocr_output.xlsx")), None),
        "Sales Invoices": (resolve_runtime_path(Path("data/sales_invoices_ocr_output.xlsx")), None),
        "Freight Forwarder Bill": (
            resolve_runtime_path(Path("data/freight_forwarder_bill_ocr_output.xlsx")),
            None,
        ),
        "Bill of Lading": (resolve_runtime_path(Path("data/bill_of_lading_ocr_output.xlsx")), "Bill of Lading"),
        "BOL - Containers": (resolve_runtime_path(Path("data/bill_of_lading_ocr_output.xlsx")), "BOL - Containers"),
        "BOL - Invoices": (resolve_runtime_path(Path("data/bill_of_lading_ocr_output.xlsx")), "BOL - Invoices"),
        "BOL - Shipping Bills": (
            resolve_runtime_path(Path("data/bill_of_lading_ocr_output.xlsx")),
            "BOL - Shipping Bills",
        ),
        "CHA": (resolve_runtime_path(Path("data/cha_ocr_output.xlsx")), None),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Merge all OCR Python outputs into one Excel using a template sheet/column layout."
    )
    parser.add_argument(
        "--template",
        default=str(DEFAULT_TEMPLATE),
        help="Template workbook path (used for target sheet names and column names).",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Output merged workbook path.",
    )
    args = parser.parse_args()

    template_path = resolve_runtime_path(Path(args.template))
    output_path = resolve_runtime_path(Path(args.output))
    if not template_path.exists():
        raise SystemExit(f"Template not found: {template_path}")

    template_workbook = pd.read_excel(template_path, sheet_name=None, nrows=0)
    sheet_sources = build_sheet_map()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        for sheet_name, template_df in template_workbook.items():
            template_cols = [str(c) for c in template_df.columns]
            template_cols = ensure_entry_summary_extra_columns(sheet_name, template_cols)
            src_file, src_sheet = sheet_sources.get(sheet_name, (None, None))

            if src_file is None:
                aligned = pd.DataFrame(columns=template_cols)
                matched = 0
            else:
                source_df = load_source_sheet(src_file, src_sheet)
                aligned, matched = align_to_template_columns(source_df, template_cols)

            aligned.to_excel(writer, sheet_name=sheet_name, index=False)
            print(
                f"{sheet_name}: rows={len(aligned)}, matched_cols={matched}/{len(template_cols)}"
            )

    print(f"\nWrote consolidated workbook: {output_path}")


if __name__ == "__main__":
    main()
