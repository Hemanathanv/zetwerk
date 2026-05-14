from datetime import datetime
import os
import re
import argparse
from pathlib import Path
from numbers import Number

import gspread
import pandas as pd
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

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


SERVICE_ACCOUNT_PATH = BASE_DIR / "data" / "service_account.json"
INPUT_DIR = BASE_DIR / "data" / "input"
PROCESSED_DIR = BASE_DIR / "data" / "processed"
OUTPUT_DIR = BASE_DIR / "data" / "output"
SPREADSHEET_ID = os.getenv(
    "SPREADSHEET_ID",
    "1Bv8suPDeskEI4kqC_FUj35pBH21cHTsvjNRmQtGX6xs",
)
OUTPUT_FOLDER_ID = "1fDrjLJEnDx2jNKMTNCTKFSnST7Jn5DHa"

# If you know the folder ID for "Unimacts Logistics", set it here.
UNIMACTS_FOLDER_IDS = [
    "1KCbgQVAsyxNFH5rkRIBZab9XaBPVJeao",
    "1pVy84DlaL0nRGidgmCEcO7sx3u0qGDl6",
    "1e2p6kdJx7YHAOCCYEhYON2nBYs_XC1J7",
]
UNIMACTS_FOLDER_NAME = "Unimacts Logistics"


def get_drive_service():
    creds = Credentials.from_service_account_file(
        str(SERVICE_ACCOUNT_PATH),
        scopes=SCOPES,
    )
    return creds, build("drive", "v3", credentials=creds)


def find_folder_id(drive_service, folder_name):
    query = (
        "mimeType='application/vnd.google-apps.folder' "
        f"and name='{folder_name}' and trashed=false"
    )
    results = drive_service.files().list(
        q=query,
        fields="files(id,name,webViewLink)",
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    ).execute()
    folders = results.get("files", [])
    if not folders:
        raise SystemExit(f"Folder not found: {folder_name}")
    if len(folders) > 1:
        names = ", ".join(f"{f['name']} ({f['id']})" for f in folders)
        raise SystemExit(
            f"Multiple folders found named '{folder_name}'. "
            f"Set UNIMACTS_FOLDER_ID to the correct one. Options: {names}"
        )
    return folders[0]["id"]


def list_pdfs_recursive(drive_service, root_folder_id, debug=False):
    pdfs = {}
    queue = [root_folder_id]
    while queue:
        folder_id = queue.pop(0)
        page_token = None
        while True:
            results = drive_service.files().list(
                q=f"'{folder_id}' in parents and trashed=false",
                fields="nextPageToken, files(id,name,mimeType,webViewLink,modifiedTime)",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                pageToken=page_token,
            ).execute()
            for item in results.get("files", []):
                if item["mimeType"] == "application/vnd.google-apps.folder":
                    queue.append(item["id"])
                elif item["mimeType"] == "application/pdf" or item["name"].lower().endswith(".pdf"):
                    name = item["name"]
                    if name not in pdfs:
                        pdfs[name] = {
                            "link": item.get("webViewLink"),
                            "modifiedTime": item.get("modifiedTime"),
                        }
            page_token = results.get("nextPageToken")
            if not page_token:
                break
    if debug:
        print(f"Folder {root_folder_id}: {len(pdfs)} PDFs found")
    return pdfs


def parse_modified_date(value):
    if not value:
        return ""
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.strftime("%d-%m-%Y")
    except Exception:
        return value


def normalize_filename(name):
    if not name:
        return ""
    text = str(name).strip()
    # If value looks like a path, keep only the basename
    text = text.replace("\\", "/")
    if "/" in text:
        text = text.split("/")[-1]
    # Strip extension
    if text.lower().endswith(".pdf"):
        text = text[:-4]
    # Drop appended Drive id suffix like "__<id>"
    if "__" in text:
        base, suffix = text.rsplit("__", 1)
        if len(suffix) >= 8:
            text = base
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text


def clean_source_file_display_name(name):
    if not pd.notna(name):
        return ""
    text = str(name).strip().replace("\\", "/")
    if "/" in text:
        text = text.split("/")[-1]

    # Remove Drive collision suffix: "<name>__<drive_id>.pdf" -> "<name>.pdf"
    text = re.sub(
        r"__[-A-Za-z0-9_]{6,}(?=\.pdf$)",
        "",
        text,
        flags=re.IGNORECASE,
    )
    # Fallback when extension is missing in source value.
    text = re.sub(r"__[-A-Za-z0-9_]{6,}$", "", text)
    return text.strip()


def normalize_filename_loose(name):
    text = normalize_filename(name)
    if not text:
        return ""
    # Keep only alphanumerics to reduce mismatch from punctuation
    text = re.sub(r"[^a-z0-9]+", "", text)
    return text


def normalize_sheet_name(name):
    return re.sub(r"[^a-z0-9]+", "", str(name or "").strip().lower())


def normalize_columns(df):
    rename_map = {}
    for col in df.columns:
        col_str = str(col).strip()
        normalized = re.sub(r"[^a-z0-9]+", " ", col_str.lower()).strip()
        if normalized == "source file":
            rename_map[col] = "Source File"
    if rename_map:
        df = df.rename(columns=rename_map)
    return df


def add_source_path_column(df, link_map, date_map):
    df = df.copy()
    df = normalize_columns(df)
    df.columns = [c.strip() if isinstance(c, str) else c for c in df.columns]
    if "Source File" not in df.columns:
        return df
    source_col = df["Source File"].map(clean_source_file_display_name)
    df["Source File"] = source_col

    # When an input workbook is already "_with_links", preserve existing
    # Source File Path / Date values if no external link/date map is provided.
    if not link_map and not date_map and (
        "Source File Path" in df.columns or "Date" in df.columns
    ):
        if "Source File Path" not in df.columns:
            df["Source File Path"] = ""
        if "Date" not in df.columns:
            df["Date"] = ""
        cols = df.columns.tolist()
        cols = [c for c in cols if c not in ("Source File", "Source File Path", "Date")]
        return df.reindex(columns=["Source File", "Source File Path", "Date"] + cols)

    def lookup_link(x):
        if not pd.notna(x):
            return ""
        key = normalize_filename(x)
        if key in link_map:
            return link_map.get(key, "")
        loose = normalize_filename_loose(x)
        return link_map.get(loose, "")

    def lookup_date(x):
        if not pd.notna(x):
            return ""
        key = normalize_filename(x)
        if key in date_map:
            return parse_modified_date(date_map.get(key))
        loose = normalize_filename_loose(x)
        return parse_modified_date(date_map.get(loose))

    link_col = source_col.map(lookup_link)
    date_col = source_col.map(lookup_date)

    # Drop existing columns to avoid duplicates before reordering.
    for col in ["Source File Path", "Date"]:
        if col in df.columns:
            df = df.drop(columns=[col])

    df.insert(1, "Source File Path", link_col)
    df.insert(2, "Date", date_col)

    # Reorder: Source File, Source File Path, Date, then the rest.
    cols = df.columns.tolist()
    cols.remove("Source File")
    cols.remove("Source File Path")
    cols.remove("Date")
    new_cols = ["Source File", "Source File Path", "Date"] + cols
    return df.reindex(columns=new_cols)


def enforce_source_column_order(cols):
    cols = [c.strip() if isinstance(c, str) else c for c in cols]
    seen = set()
    deduped = []
    for c in cols:
        if c not in seen:
            seen.add(c)
            deduped.append(c)
    cols = deduped

    if "Source File" not in cols:
        return cols
    if "Source File Path" not in cols:
        cols.append("Source File Path")
    if "Date" not in cols:
        cols.append("Date")
    remainder = [c for c in cols if c not in ("Source File", "Source File Path", "Date")]
    return ["Source File", "Source File Path", "Date"] + remainder


def find_or_create_spreadsheet(drive_service, folder_id, name):
    query = (
        f"name='{name}' and '{folder_id}' in parents "
        "and mimeType='application/vnd.google-apps.spreadsheet' "
        "and trashed=false"
    )
    results = drive_service.files().list(
        q=query,
        fields="files(id,name,webViewLink)",
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    ).execute()
    files = results.get("files", [])
    if files:
        return files[0]["id"], files[0].get("webViewLink")

    created = drive_service.files().create(
        body={
            "name": name,
            "mimeType": "application/vnd.google-apps.spreadsheet",
            "parents": [folder_id],
        },
        fields="id,webViewLink",
        supportsAllDrives=True,
    ).execute()
    return created["id"], created.get("webViewLink")


def hyperlinkify_values(values, header, target_col):
    if target_col not in header:
        return values
    col_idx = header.index(target_col)
    for row_idx in range(1, len(values)):
        cell_value = values[row_idx][col_idx]
        if cell_value:
            url = str(cell_value)
            values[row_idx][col_idx] = f'=HYPERLINK("{url}","{url}")'
    return values


def normalize_cell(value):
    if value is None:
        return ""
    if pd.isna(value):
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, Number):
        if isinstance(value, float):
            if value.is_integer():
                return str(int(value))
            return format(value, ".15g")
        return str(value)
    text = str(value).strip()
    if text.startswith("=HYPERLINK("):
        parts = text.split('"')
        if len(parts) >= 2:
            return parts[1]
    # Some Excel values can be exported as escaped formulas.
    if text.startswith("'"):
        text = text[1:].strip()

    # Canonical numeric-like strings (e.g., "1,200.00" == "1200").
    stripped_numeric = text.replace(",", "").replace(" ", "")
    stripped_numeric = re.sub(
        r"^(?:inr|rs\.?|usd|eur|gbp|\$)+",
        "",
        stripped_numeric,
        flags=re.IGNORECASE,
    )
    if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", stripped_numeric):
        try:
            numeric = float(stripped_numeric)
            if numeric.is_integer():
                return str(int(numeric))
            return format(numeric, ".15g")
        except Exception:
            pass

    # Canonical date-like strings (multiple formats collapse to YYYY-MM-DD).
    date_like = bool(
        re.search(r"\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}", text)
        or re.search(r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b", text, flags=re.IGNORECASE)
    )
    if date_like:
        # Parse common formats explicitly to avoid pandas dayfirst warnings.
        date_formats = (
            "%d-%m-%Y",
            "%d/%m/%Y",
            "%d.%m.%Y",
            "%Y-%m-%d",
            "%Y/%m/%d",
            "%Y.%m.%d",
            "%m-%d-%Y",
            "%m/%d/%Y",
            "%d-%b-%Y",
            "%d %b %Y",
            "%d-%B-%Y",
            "%d %B %Y",
        )
        candidate = text.replace(",", " ").strip()
        for fmt in date_formats:
            try:
                parsed = datetime.strptime(candidate, fmt)
                return parsed.strftime("%Y-%m-%d")
            except Exception:
                continue

    text = re.sub(r"\s+", " ", text)
    return text.casefold()


def row_key(row, header):
    # Dedupe across full row content: all columns must match.
    key = []
    for idx, _ in enumerate(header):
        key.append(normalize_cell(row[idx] if idx < len(row) else ""))
    return tuple(key)


def escape_formula_like_cells(rows, header, allow_formula_col):
    if allow_formula_col in header:
        formula_idx = header.index(allow_formula_col)
    else:
        formula_idx = -1
    for r_idx, row in enumerate(rows):
        if r_idx == 0:
            continue  # header
        for c_idx, value in enumerate(row):
            if c_idx == formula_idx:
                continue
            if isinstance(value, str) and value:
                if value[0] in ("=", "+", "-", "@"):
                    row[c_idx] = "'" + value
    return rows


def list_input_excels(input_dir):
    if not input_dir.exists():
        return []
    files = []
    for pattern in ("*.xlsx", "*.xls"):
        files.extend(input_dir.glob(pattern))
    # Skip temporary Excel files like "~$file.xlsx"
    files = [f for f in files if not f.name.startswith("~$")]
    if not files:
        return []

    # Batch order by numeric filename first: 1.xlsx, 2.xlsx, 3.xlsx, ...
    # Non-numeric names are placed after numbered files and sorted by name.
    def sort_key(path):
        stem = path.stem.strip()
        if stem.isdigit():
            return (0, int(stem), path.name.lower())
        m = re.match(r"^(\d+)", stem)
        if m:
            return (0, int(m.group(1)), path.name.lower())
        return (1, float("inf"), path.name.lower())

    return sorted(files, key=sort_key)


def list_output_linked_excels(output_dir):
    if not output_dir.exists():
        return []
    files = []
    for pattern in ("*_with_links.xlsx", "*_with_links.xls"):
        files.extend(output_dir.glob(pattern))
    files = [f for f in files if not f.name.startswith("~$")]
    return sorted(files, key=lambda p: (p.stem.lower(), p.name.lower()))


def resolve_excel_files(input_dir, explicit_paths=None, include_output=False):
    if explicit_paths:
        resolved = []
        for raw in explicit_paths:
            p = resolve_runtime_path(Path(raw))
            if not p.exists() or not p.is_file():
                raise SystemExit(f"Excel file not found: {p}")
            if p.suffix.lower() not in {".xlsx", ".xls"}:
                raise SystemExit(f"Not an Excel file: {p}")
            resolved.append(p)
        return resolved

    files = list_input_excels(input_dir)
    if files:
        return files
    if include_output:
        return list_output_linked_excels(OUTPUT_DIR)
    return []


def write_excel_with_links(workbook, output_path, pdf_link_map, pdf_date_map):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        for sheet_name, df in workbook.items():
            df = add_source_path_column(df, pdf_link_map, pdf_date_map)
            df.to_excel(writer, sheet_name=sheet_name, index=False)
            if "Source File Path" in df.columns:
                ws = writer.sheets[sheet_name]
                col_idx = df.columns.get_loc("Source File Path") + 1
                for row_idx, value in enumerate(
                    df["Source File Path"].tolist(), start=2
                ):
                    if pd.notna(value) and str(value).strip():
                        cell = ws.cell(row=row_idx, column=col_idx)
                        cell.hyperlink = str(value)
                        cell.style = "Hyperlink"


def build_sheet_batches(workbooks, pdf_link_map, pdf_date_map):
    sheet_columns = {}
    for workbook in workbooks:
        for sheet_name, df in workbook.items():
            df = add_source_path_column(df, pdf_link_map, pdf_date_map)
            cols = enforce_source_column_order(df.columns.tolist())
            if sheet_name not in sheet_columns:
                sheet_columns[sheet_name] = cols
            else:
                existing = sheet_columns[sheet_name]
                for col in cols:
                    if col not in existing:
                        existing.append(col)

    sheets = {name: {"header": cols, "batches": []} for name, cols in sheet_columns.items()}

    for workbook in workbooks:
        for sheet_name, df in workbook.items():
            df = add_source_path_column(df, pdf_link_map, pdf_date_map)
            header = enforce_source_column_order(sheet_columns[sheet_name])
            df = df.reindex(columns=header)
            data_rows = df.where(pd.notna(df), "").values.tolist()
            data_rows = hyperlinkify_values(
                [header] + data_rows, header, "Source File Path"
            )[1:]
            sheets[sheet_name]["batches"].append(data_rows)

    return sheets


def merge_headers(existing_header, incoming_header):
    existing = [c.strip() if isinstance(c, str) else c for c in existing_header]
    incoming = [c.strip() if isinstance(c, str) else c for c in incoming_header]
    merged = list(existing)
    for col in incoming:
        if col not in merged:
            merged.append(col)
    return enforce_source_column_order(merged)


def normalize_row_to_header(row, source_header, target_header):
    row = list(row)
    if len(row) < len(source_header):
        row.extend([""] * (len(source_header) - len(row)))
    elif len(row) > len(source_header):
        row = row[: len(source_header)]
    mapped = {source_header[idx]: row[idx] for idx in range(len(source_header))}
    return [mapped.get(col, "") for col in target_header]


def move_to_processed(excel_path, processed_dir):
    processed_dir.mkdir(parents=True, exist_ok=True)
    target = processed_dir / excel_path.name
    if target.exists():
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        target = processed_dir / f"{excel_path.stem}_{ts}{excel_path.suffix}"
    excel_path.replace(target)
    print(f"Moved to processed: {target}")


def append_gsheet_batches(sheets, spreadsheet):
    total_appended_all_sheets = 0

    for sheet_name, payload in sheets.items():
        incoming_header = enforce_source_column_order(payload["header"])
        batches = payload["batches"]
        incoming_rows = sum(len(b) for b in batches)
        print(f"[{sheet_name}] incoming batch rows: {incoming_rows}")

        try:
            worksheet = spreadsheet.worksheet(sheet_name)
        except gspread.WorksheetNotFound:
            normalized_target = normalize_sheet_name(sheet_name)
            worksheet = None
            for ws in spreadsheet.worksheets():
                if normalize_sheet_name(ws.title) == normalized_target:
                    worksheet = ws
                    print(f"[{sheet_name}] matched existing sheet: {ws.title}")
                    break
            if worksheet is None:
                worksheet = spreadsheet.add_worksheet(
                    title=sheet_name,
                    rows=100,
                    cols=max(26, len(incoming_header)),
                )
                worksheet.update(
                    values=[incoming_header],
                    range_name="A1",
                    value_input_option="USER_ENTERED",
                )
                existing_values = [incoming_header]
            else:
                existing_values = worksheet.get_all_values()
        else:
            existing_values = worksheet.get_all_values()

        existing_header = []
        if existing_values:
            existing_header = [
                c.strip() if isinstance(c, str) else c
                for c in existing_values[0]
            ]
        if existing_header:
            header = merge_headers(existing_header, incoming_header)
        else:
            header = incoming_header

        if len(header) > worksheet.col_count:
            worksheet.resize(rows=worksheet.row_count, cols=len(header))

        if not existing_header:
            worksheet.update(
                values=[header],
                range_name="A1",
                value_input_option="USER_ENTERED",
            )
        elif header != existing_header:
            worksheet.update(
                values=[header],
                range_name="A1",
                value_input_option="USER_ENTERED",
            )

        # Anchor append position to column A (Source File) so stray values in far
        # columns do not push appends far below the visible data region.
        first_col_values = worksheet.col_values(1)
        last_used_row = 1
        if first_col_values:
            last_used_row = max(
                1,
                max(
                    idx
                    for idx, val in enumerate(first_col_values, start=1)
                    if str(val).strip()
                ),
            )
        before_last_used_row = last_used_row

        appended_rows = 0
        appended_batches = 0
        has_existing_data = last_used_row > 1

        for batch in batches:
            if not batch:
                continue
            batch_rows = []
            for row in batch:
                row = normalize_row_to_header(row, incoming_header, header)

                # Ignore fully blank rows.
                if not any(str(cell).strip() for cell in row):
                    continue

                batch_rows.append(row)

            if not batch_rows:
                continue

            rows_to_append = []
            if has_existing_data or appended_batches > 0:
                empty_row = [""] * len(header)
                rows_to_append.extend([empty_row, empty_row])
            rows_to_append.extend(batch_rows)

            rows_to_append = escape_formula_like_cells(
                [header] + rows_to_append, header, "Source File Path"
            )[1:]
            start_row = last_used_row + 1
            end_row = start_row + len(rows_to_append) - 1
            if end_row > worksheet.row_count:
                worksheet.resize(rows=end_row, cols=worksheet.col_count)
            print(
                f"[{sheet_name}] writing rows {start_row}-{end_row} "
                f"(rows={len(rows_to_append)})"
            )
            worksheet.update(
                range_name=f"A{start_row}",
                values=rows_to_append,
                value_input_option="USER_ENTERED",
            )
            appended_rows += len(batch_rows)
            appended_batches += 1
            has_existing_data = True
            last_used_row = end_row

        print(
            f"[{sheet_name}] appended rows: {appended_rows} | "
            f"before_last_row: {before_last_used_row} | after_last_row: {last_used_row}"
        )
        total_appended_all_sheets += appended_rows

        # Keep uniform column widths/heights and clip long text.
        max_cols = max(len(header), worksheet.col_count)
        max_rows = max(last_used_row, worksheet.row_count)
        spreadsheet.batch_update(
            {
                "requests": [
                    {
                        "updateDimensionProperties": {
                            "range": {
                                "sheetId": worksheet.id,
                                "dimension": "COLUMNS",
                                "startIndex": 0,
                                "endIndex": max_cols,
                            },
                            "properties": {"pixelSize": 140},
                            "fields": "pixelSize",
                        }
                    },
                    {
                        "updateDimensionProperties": {
                            "range": {
                                "sheetId": worksheet.id,
                                "dimension": "ROWS",
                                "startIndex": 0,
                                "endIndex": max_rows,
                            },
                            "properties": {"pixelSize": 21},
                            "fields": "pixelSize",
                        }
                    },
                    {
                        "repeatCell": {
                            "range": {
                                "sheetId": worksheet.id,
                                "startRowIndex": 0,
                                "endRowIndex": max_rows,
                                "startColumnIndex": 0,
                                "endColumnIndex": max_cols,
                            },
                            "cell": {
                                "userEnteredFormat": {
                                    "wrapStrategy": "CLIP",
                                    "verticalAlignment": "MIDDLE",
                                }
                            },
                            "fields": "userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment",
                        }
                    },
                ]
            }
        )
    return total_appended_all_sheets


def main():
    parser = argparse.ArgumentParser(description="Upload Excel data to Google Sheets.")
    parser.add_argument("--debug", action="store_true", help="Print debug counts for Drive folders.")
    parser.add_argument(
        "--excel",
        action="append",
        default=[],
        help="Specific Excel file path to append. Can be passed multiple times.",
    )
    parser.add_argument(
        "--include-output",
        action="store_true",
        help="If input folder is empty, append *_with_links Excel files from data/output.",
    )
    parser.add_argument(
        "--spreadsheet-id",
        default=SPREADSHEET_ID,
        help="Target Google Spreadsheet ID. Defaults to SPREADSHEET_ID env var or script default.",
    )
    args = parser.parse_args()
    if not SERVICE_ACCOUNT_PATH.exists():
        raise SystemExit(f"Service account file not found: {SERVICE_ACCOUNT_PATH}")
    creds, drive_service = get_drive_service()
    gc = gspread.authorize(creds)

    folder_ids = [f for f in UNIMACTS_FOLDER_IDS if f]
    if not folder_ids:
        folder_ids = [find_folder_id(drive_service, UNIMACTS_FOLDER_NAME)]

    pdf_link_map = {}
    pdf_date_map = {}
    try:
        for folder_id in folder_ids:
            folder_map = list_pdfs_recursive(drive_service, folder_id, debug=args.debug)
            # Keep first-seen link if duplicates exist
            for name, info in folder_map.items():
                if name not in pdf_link_map:
                    key = normalize_filename(name)
                    key_loose = normalize_filename_loose(name)
                    pdf_link_map[key] = info.get("link", "")
                    pdf_date_map[key] = info.get("modifiedTime", "")
                    if key_loose:
                        pdf_link_map[key_loose] = info.get("link", "")
                        pdf_date_map[key_loose] = info.get("modifiedTime", "")
    except Exception as exc:
        print(f"[WARN] Could not build Drive PDF map: {exc}")
    if not pdf_link_map:
        print("[WARN] No PDFs found under configured Drive folders. Existing Source File Path/Date values will be preserved when present.")

    excel_files = resolve_excel_files(
        INPUT_DIR,
        explicit_paths=args.excel,
        include_output=args.include_output,
    )
    if not excel_files:
        raise SystemExit(
            f"No Excel files found in {INPUT_DIR}. "
            "Pass --excel <path> to append a specific file or use --include-output."
        )
    print("Batch order (numeric filename):")
    for idx, excel_path in enumerate(excel_files, start=1):
        print(f"{idx}. {excel_path.name}")

    spreadsheet = None
    spreadsheet_id = (args.spreadsheet_id or "").strip()
    if spreadsheet_id:
        spreadsheet = gc.open_by_key(spreadsheet_id)
        print(f"Connected spreadsheet: {spreadsheet.title} ({spreadsheet_id})")

    for excel_path in excel_files:
        workbook = pd.read_excel(excel_path, sheet_name=None)
        is_prelinked = excel_path.stem.lower().endswith("_with_links")
        if is_prelinked:
            print(f"Using pre-linked Excel as-is: {excel_path}")
        else:
            output_path = OUTPUT_DIR / f"{excel_path.stem}_with_links{excel_path.suffix}"
            write_excel_with_links(workbook, output_path, pdf_link_map, pdf_date_map)
            print(f"Excel written with links: {output_path}")

        if spreadsheet:
            link_map_for_file = pdf_link_map
            date_map_for_file = pdf_date_map
            if is_prelinked:
                link_map_for_file = {}
                date_map_for_file = {}
            sheets = build_sheet_batches([workbook], link_map_for_file, date_map_for_file)
            appended_total = append_gsheet_batches(sheets, spreadsheet)
            if appended_total > 0:
                try:
                    in_input_dir = excel_path.parent.resolve() == INPUT_DIR.resolve()
                except Exception:
                    in_input_dir = False
                if in_input_dir:
                    move_to_processed(excel_path, PROCESSED_DIR)
                else:
                    print(
                        f"Appended rows from {excel_path.name}; "
                        "source file not in input folder, so not moved."
                    )
            else:
                try:
                    in_input_dir = excel_path.parent.resolve() == INPUT_DIR.resolve()
                except Exception:
                    in_input_dir = False
                if in_input_dir:
                    print(
                        f"No new rows appended from {excel_path.name}; "
                        "leaving file in input folder."
                    )
                else:
                    print(f"No new rows appended from {excel_path.name}.")

    if spreadsheet:
        print(
            f"Google Sheet link: https://docs.google.com/spreadsheets/d/{spreadsheet_id}"
        )


if __name__ == "__main__":
    main()
