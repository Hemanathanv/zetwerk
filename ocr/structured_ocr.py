import argparse
import ast
import base64
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover
    load_dotenv = None

try:
    import fitz  # PyMuPDF
except Exception as exc:  # pragma: no cover
    raise SystemExit("PyMuPDF is required. Install with: pip install pymupdf") from exc

try:
    from openai import OpenAI
except Exception as exc:  # pragma: no cover
    raise SystemExit("OpenAI Python SDK is required. Install with: pip install openai") from exc


BACKEND_DIR = Path(__file__).resolve().parent


def resolve_ocr_path(path_like):
    path = Path(path_like)
    if path.is_absolute():
        return path

    cwd_candidate = Path.cwd() / path
    backend_candidate = BACKEND_DIR / path
    if cwd_candidate.exists():
        return cwd_candidate
    if backend_candidate.exists():
        return backend_candidate

    # For project assets, default to Backend-relative resolution.
    if path.parts and path.parts[0].lower() in {"data", "src", "output"}:
        return backend_candidate
    return cwd_candidate


SERVICE_ACCOUNT_PATH = BACKEND_DIR / "data/service_account.json"


def resolve_template_workbook_path() -> Path:
    """Prefer explicit env override, else newest Zetwerk template workbook in Downloads."""
    env_path = (
        os.getenv("OCR_TEMPLATE_WORKBOOK_PATH")
        or os.getenv("TEMPLATE_WORKBOOK_PATH")
        or ""
    ).strip()
    if env_path:
        return Path(env_path)

    downloads = Path.home() / "Downloads"
    candidates: list[Path] = []
    for pattern in (
        "Zetwerk Logistics OCR (1).xlsx",
        "Zetwerk Logistics OCR.xlsx",
        "Zetwerk Logistics OCR*.xlsx",
        "Copy of Zetwerk Logistics OCR*.xlsx",
    ):
        candidates.extend(downloads.glob(pattern))

    existing = [p for p in candidates if p.exists()]
    if existing:
        return max(existing, key=lambda p: p.stat().st_mtime)

    return downloads / "Zetwerk Logistics OCR.xlsx"


TEMPLATE_WORKBOOK_PATH = resolve_template_workbook_path()
SPREADSHEET_ID = os.getenv(
    "SPREADSHEET_ID",
    "1Bv8suPDeskEI4kqC_FUj35pBH21cHTsvjNRmQtGX6xs",
)
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
DEFAULT_DRIVE_ROOT_FOLDER_IDS = [
    "1e2p6kdJx7YHAOCCYEhYON2nBYs_XC1J7",  # EXPORTS UNX_1
]
DEFAULT_DRIVE_ROOT_FOLDER_NAMES = [
    "EXPORTS UNX_1",
]
DOC_INPUT_FOLDERS = {
    # Strict one-folder-per-OCR mapping to avoid cross-document contamination.
    "Entry Summary": ["Entry Summary"],
    "Entry Summary Tariff Lines": ["Entry Summary Tariff Lines"],
    "Steel Supplier Declaration": ["Steel Supplier Declaration"],
    "Shipping Bill": ["Shipping Bill"],
    "Delivery Deduction Sheet": ["Delivery Deduction Sheet"],
    "Ocean Freight": ["Ocean Freight"],
    "Packing List": ["Packing List"],
    "Sales Invoices": ["Sales Invoices"],
    "Bill of Lading": ["Bill of Lading"],
    "Freight Forwarder Bill": ["Freight Forwarder Bill"],
    "CHA": ["CHA"],
    "US Cargo Release Order": ["US Cargo Release Order"],
    "US Customs Release Order": ["US Customs Release Order"],
    "US Delivery Order": ["US Delivery Order"],
    "US Packing List": ["US Packing List"],
}

OUTPUT_SHEET_NAME_BY_DOC_TITLE = {
    "Entry Summary": "Entry Summary",
    "Entry Summary Tariff Lines": "Entry Summary Tariff Lines",
    "Steel Supplier Declaration": "Steel Supplier Declaration",
    "Shipping Bill": "Shipping bill",
    "Delivery Deduction Sheet": "Delivery Deduction Sheet",
    "Ocean Freight": "Ocean Freight Invoice",
    "Packing List": "Packing Lists",
    "Sales Invoices": "Sales Invoices",
    "Bill of Lading": "Bill of Lading",
    "Freight Forwarder Bill": "Freight Forwarder Bill",
    "CHA": "CHA",
    "US Cargo Release Order": "US CARGO RELEASE",
    "US Customs Release Order": "US CUSTOM RELEASE",
    "US Delivery Order": "US DELIVERY ORDER",
    "US Packing List": "US PACKING LIST",
}

DOC_TO_TEMPLATE_SHEET = {
    "Entry Summary": "Entry Summary",
    "Entry Summary Tariff Lines": "Entry Summary Tariff Lines",
    "Steel Supplier Declaration": "Steel Supplier Declaration",
    "Shipping Bill": "Shipping bill",
    "Delivery Deduction Sheet": "Delivery Deduction Sheet",
    "Ocean Freight": "Ocean Freight Invoice",
    "Packing List": "Packing Lists",
    "Sales Invoices": "Sales Invoices",
    "Freight Forwarder Bill": "Freight Forwarder Bill",
    "CHA": "CHA",
    "US Cargo Release Order": "US CARGO RELEASE",
    "US Customs Release Order": "US CUSTOM RELEASE",
    "US Delivery Order": "US DELIVERY ORDER",
    "US Packing List": "US PACKING LIST",
}

_TEMPLATE_COLUMNS_CACHE = {}
DEFAULT_OCR_METRICS_LOG_PATH = BACKEND_DIR / "data/ocr_run_metrics.jsonl"
DEFAULT_OCR_METRICS_EXCEL_PATH = BACKEND_DIR / "data/ocr_run_metrics.xlsx"
DEFAULT_OCR_METRICS_SHEET_NAME = "run_metrics"
OCR_METRICS_PREFIX = "OCR_METRICS_JSON: "
OCR_METRICS_COLUMN_ORDER = [
    "timestamp_utc",
    "doc_title",
    "model",
    "pdfs_in_input",
    "input_tokens",
    "output_tokens",
    "input_tokens_per_page",
    "output_tokens_per_page",
]
OCR_METRICS_EXCEL_EXCLUDED_COLUMNS = {
    "use_drive",
    "run_status",
    "pages",
    "pdfs_attempted",
    "pdfs_succeeded",
    "pdfs_failed",
    "pdfs_skipped_checkpoint",
    "pdfs_skipped_no_pages",
}


def _safe_int(value):
    try:
        if value is None:
            return 0
        return int(value)
    except Exception:
        return 0


def _safe_float(value):
    try:
        if value is None:
            return 0.0
        return float(value)
    except Exception:
        return 0.0


def enrich_page_level_metrics(metrics):
    pages = _safe_int(metrics.get("pages"))
    input_tokens = _safe_int(metrics.get("input_tokens"))
    output_tokens = _safe_int(metrics.get("output_tokens"))
    if pages > 0:
        metrics["input_tokens_per_page"] = round(input_tokens / pages, 4)
        metrics["output_tokens_per_page"] = round(output_tokens / pages, 4)
    else:
        metrics["input_tokens_per_page"] = 0.0
        metrics["output_tokens_per_page"] = 0.0
    return metrics


def extract_usage_tokens(response):
    usage = getattr(response, "usage", None)
    if usage is None and isinstance(response, dict):
        usage = response.get("usage")
    if not usage:
        return 0, 0

    if isinstance(usage, dict):
        input_tokens = usage.get("prompt_tokens", usage.get("input_tokens"))
        output_tokens = usage.get("completion_tokens", usage.get("output_tokens"))
    else:
        input_tokens = getattr(usage, "prompt_tokens", None)
        if input_tokens is None:
            input_tokens = getattr(usage, "input_tokens", None)
        output_tokens = getattr(usage, "completion_tokens", None)
        if output_tokens is None:
            output_tokens = getattr(usage, "output_tokens", None)

    return _safe_int(input_tokens), _safe_int(output_tokens)


def build_page_usage_rows(
    *,
    timestamp_utc,
    doc_title,
    model,
    source_file,
    page_count,
    input_tokens,
    output_tokens,
):
    page_count = max(0, _safe_int(page_count))
    if page_count <= 0:
        return []

    input_tokens = _safe_int(input_tokens)
    output_tokens = _safe_int(output_tokens)

    input_base, input_rem = divmod(input_tokens, page_count)
    output_base, output_rem = divmod(output_tokens, page_count)

    rows = []
    for page_no in range(1, page_count + 1):
        rows.append(
            {
                "timestamp_utc": timestamp_utc,
                "doc_title": doc_title,
                "model": model,
                "source_file": source_file,
                "page_no": page_no,
                "input_tokens": input_base + (1 if page_no <= input_rem else 0),
                "output_tokens": output_base + (1 if page_no <= output_rem else 0),
            }
        )
    return rows


def _resolve_metrics_log_path():
    configured = str(os.getenv("OCR_RUN_METRICS_PATH") or "").strip()
    if configured:
        return resolve_ocr_path(Path(configured))
    return DEFAULT_OCR_METRICS_LOG_PATH


def _resolve_metrics_excel_path():
    configured = str(os.getenv("OCR_RUN_METRICS_EXCEL_PATH") or "").strip()
    if configured:
        return resolve_ocr_path(Path(configured))
    return DEFAULT_OCR_METRICS_EXCEL_PATH


def _resolve_metrics_sheet_name():
    configured = str(os.getenv("OCR_RUN_METRICS_EXCEL_SHEET") or "").strip()
    if configured:
        return configured
    return DEFAULT_OCR_METRICS_SHEET_NAME


def _sanitize_excel_sheet_name(raw_name, fallback="page_metrics"):
    name = str(raw_name or "").strip().lower()
    name = re.sub(r"[\[\]\*\?:/\\]", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    if not name:
        name = fallback
    return name[:31]


def _acquire_lock(lock_path, timeout_seconds=30, stale_seconds=600):
    deadline = time.time() + max(1, timeout_seconds)
    while time.time() < deadline:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
            return fd
        except FileExistsError:
            try:
                age = time.time() - lock_path.stat().st_mtime
                if age > stale_seconds:
                    lock_path.unlink(missing_ok=True)
                    continue
            except Exception:
                pass
            time.sleep(0.2)
    return None


def _release_lock(lock_path, lock_fd):
    try:
        if lock_fd is not None:
            os.close(lock_fd)
    except Exception:
        pass
    try:
        lock_path.unlink(missing_ok=True)
    except Exception:
        pass


def _append_metrics_to_excel(metrics, page_usage_rows=None):
    excel_path = _resolve_metrics_excel_path()
    sheet_name = _resolve_metrics_sheet_name()
    detail_sheet_name = _sanitize_excel_sheet_name(metrics.get("doc_title"))
    excel_path.parent.mkdir(parents=True, exist_ok=True)

    lock_path = Path(str(excel_path) + ".lock")
    lock_fd = _acquire_lock(lock_path)
    if lock_fd is None:
        raise RuntimeError(f"Could not acquire lock for metrics Excel: {excel_path}")
    try:
        ordered_row = {}
        for key in OCR_METRICS_COLUMN_ORDER:
            if key in OCR_METRICS_EXCEL_EXCLUDED_COLUMNS:
                continue
            ordered_row[key] = metrics.get(key)
        for key in sorted(metrics.keys()):
            if key in OCR_METRICS_EXCEL_EXCLUDED_COLUMNS:
                continue
            if key not in ordered_row:
                ordered_row[key] = metrics.get(key)
        row_df = pd.DataFrame([ordered_row])

        existing_sheets = {}
        if excel_path.exists():
            try:
                existing_sheets = pd.read_excel(excel_path, sheet_name=None)
            except Exception:
                existing_sheets = {}

        existing_df = existing_sheets.get(sheet_name)
        if existing_df is None:
            existing_df = pd.DataFrame()

        drop_cols_existing = [
            c for c in OCR_METRICS_EXCEL_EXCLUDED_COLUMNS if c in existing_df.columns
        ]
        if drop_cols_existing:
            existing_df = existing_df.drop(columns=drop_cols_existing)

        combined_df = pd.concat([existing_df, row_df], ignore_index=True)
        drop_cols_combined = [
            c for c in OCR_METRICS_EXCEL_EXCLUDED_COLUMNS if c in combined_df.columns
        ]
        if drop_cols_combined:
            combined_df = combined_df.drop(columns=drop_cols_combined)
        existing_sheets[sheet_name] = combined_df

        if page_usage_rows:
            page_rows_df = pd.DataFrame(page_usage_rows)
            existing_page_df = existing_sheets.get(detail_sheet_name)
            if existing_page_df is None:
                existing_page_df = pd.DataFrame()
            combined_page_df = pd.concat(
                [existing_page_df, page_rows_df], ignore_index=True
            )
            existing_sheets[detail_sheet_name] = combined_page_df

        with pd.ExcelWriter(excel_path, engine="openpyxl") as writer:
            for existing_sheet_name, existing_sheet_df in existing_sheets.items():
                df_to_write = existing_sheet_df
                if df_to_write is None:
                    df_to_write = pd.DataFrame()
                if not isinstance(df_to_write, pd.DataFrame):
                    df_to_write = pd.DataFrame(df_to_write)
                df_to_write.to_excel(
                    writer, sheet_name=existing_sheet_name, index=False
                )
    finally:
        _release_lock(lock_path, lock_fd)

    return excel_path, sheet_name, detail_sheet_name if page_usage_rows else None


def emit_run_metrics(metrics, page_usage_rows=None):
    enrich_page_level_metrics(metrics)

    print("\n=== OCR Usage Summary ===")
    print(f"Input tokens: {metrics.get('input_tokens', 0)}")
    print(f"Output tokens: {metrics.get('output_tokens', 0)}")
    print(f"Pages: {metrics.get('pages', 0)}")
    print(f"Input tokens/page: {metrics.get('input_tokens_per_page', 0)}")
    print(f"Output tokens/page: {metrics.get('output_tokens_per_page', 0)}")
    print(f"No. of PDFs: {metrics.get('pdfs_succeeded', 0)}")

    log_path = _resolve_metrics_log_path()
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(metrics, ensure_ascii=False) + "\n")
        print(f"Saved metrics log: {log_path}")
    except Exception as exc:
        print(f"[WARN] Failed to write OCR metrics log: {exc}")

    try:
        excel_path, sheet_name, detail_sheet = _append_metrics_to_excel(
            metrics, page_usage_rows=page_usage_rows
        )
        print(f"Saved metrics Excel: {excel_path} (sheet: {sheet_name})")
        if detail_sheet:
            print(
                f"Saved pagewise metrics sheet: {excel_path} (sheet: {detail_sheet})"
            )
    except Exception as exc:
        print(f"[WARN] Failed to write OCR metrics Excel: {exc}")

    print(f"{OCR_METRICS_PREFIX}{json.dumps(metrics, ensure_ascii=False)}")


def normalize_base_url(url):
    if not url:
        return url
    cleaned = url.strip().rstrip("/")
    for suffix in (
        "/chat/completions",
        "/v1/chat/completions",
        "/responses",
        "/v1/responses",
    ):
        if cleaned.endswith(suffix):
            cleaned = cleaned[: -len(suffix)]
            break
    if cleaned.endswith("/v1"):
        return cleaned
    return cleaned + "/v1"


def load_env():
    if load_dotenv is not None:
        load_dotenv(BACKEND_DIR / ".env", override=False)
        load_dotenv(BACKEND_DIR / ".env.local", override=False)
        load_dotenv()

    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_KEY")
    model = (
        os.getenv("OPENAI_MODEL")
        or os.getenv("MODEL")
        or os.getenv("OPENAI_DEFAULT_MODEL")
    )
    base_url = os.getenv("OPENAI_BASE_URL")
    organization = os.getenv("OPENAI_ORG")
    project = os.getenv("OPENAI_PROJECT")

    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        api_key = openrouter_key
    if not base_url:
        base_url = os.getenv("OPENROUTER_API_URL")
    if not model:
        model = os.getenv("OPENROUTER_MODEL_PRO") or os.getenv(
            "OPENROUTER_MODEL_FLASH"
        )

    base_url_text = str(base_url or "").strip().lower()
    is_openrouter = bool(openrouter_key) or ("openrouter" in base_url_text)
    if is_openrouter:
        base_url = (
            normalize_base_url(base_url)
            if base_url
            else "https://openrouter.ai/api/v1"
        )

    # Accuracy-first default: prefer the configured Pro model unless disabled.
    prefer_pro = os.getenv("OCR_PREFER_PRO_MODEL", "1").strip().lower() not in {
        "0",
        "false",
        "no",
    }
    pro_model = (
        os.getenv("OPENROUTER_MODEL_PRO")
        or os.getenv("OPENAI_MODEL_PRO")
        or ""
    ).strip()
    if prefer_pro and pro_model:
        model = pro_model

    if not api_key:
        raise SystemExit(
            "API key missing. Set OPENAI_API_KEY or OPENROUTER_API_KEY in .env"
        )
    if not model:
        raise SystemExit(
            "Model missing. Set OPENAI_MODEL or OPENROUTER_MODEL_PRO/FLASH in .env"
        )
    return api_key, model, base_url, organization, project, is_openrouter


def normalize_name(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def normalize_source_filename(name):
    text = str(name or "").strip().replace("\\", "/")
    if "/" in text:
        text = text.split("/")[-1]
    if text.lower().endswith(".pdf"):
        text = text[:-4]
    if "__" in text:
        base, suffix = text.rsplit("__", 1)
        if len(suffix) >= 8:
            text = base
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text


def normalize_col_name(value):
    text = str(value or "").strip().lower()
    return "".join(ch for ch in text if ch.isalnum())


def slugify(value):
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").lower()).strip("_") or "doc"


def build_checkpoint_path(doc_title, input_path, use_drive=False):
    if use_drive:
        run_key = f"drive::{doc_title}"
    else:
        try:
            resolved = str(Path(input_path).resolve())
        except Exception:
            resolved = str(input_path)
        run_key = f"local::{resolved}"
    digest = hashlib.md5(run_key.encode("utf-8", errors="ignore")).hexdigest()[:12]
    return BACKEND_DIR / "data" / "checkpoints" / f"{slugify(doc_title)}_{digest}.jsonl"


def load_checkpoint_records(checkpoint_path):
    records = []
    sources = []
    processed_pdf_paths = set()
    if not checkpoint_path.exists():
        return records, sources, processed_pdf_paths

    for raw_line in checkpoint_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except Exception:
            # Ignore torn/corrupt trailing lines from abrupt termination.
            continue

        record = payload.get("record")
        source = payload.get("source")
        pdf_path = payload.get("pdf_path")
        if not isinstance(record, dict) or not isinstance(source, str):
            continue

        records.append(record)
        sources.append(source)
        if isinstance(pdf_path, str) and pdf_path.strip():
            processed_pdf_paths.add(pdf_path.strip())

    return records, sources, processed_pdf_paths


def append_checkpoint_record(checkpoint_path, pdf_path, source_name, record):
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "pdf_path": str(pdf_path),
        "source": source_name,
        "record": record,
    }
    with checkpoint_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
        fh.flush()
        try:
            os.fsync(fh.fileno())
        except Exception:
            pass


def clear_checkpoint(checkpoint_path):
    try:
        if checkpoint_path.exists():
            checkpoint_path.unlink()
    except Exception:
        pass


def get_drive_service():
    if not SERVICE_ACCOUNT_PATH.exists():
        raise SystemExit(f"Service account file not found: {SERVICE_ACCOUNT_PATH}")
    try:
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
    except Exception as exc:  # pragma: no cover
        raise SystemExit(
            "Google Drive SDK missing. Install with: pip install google-api-python-client"
        ) from exc

    creds = Credentials.from_service_account_file(
        str(SERVICE_ACCOUNT_PATH),
        scopes=DRIVE_SCOPES,
    )
    return build("drive", "v3", credentials=creds)


def get_sheets_service():
    if not SERVICE_ACCOUNT_PATH.exists():
        raise SystemExit(f"Service account file not found: {SERVICE_ACCOUNT_PATH}")
    try:
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
    except Exception as exc:  # pragma: no cover
        raise SystemExit(
            "Google Sheets SDK missing. Install with: pip install google-api-python-client"
        ) from exc

    creds = Credentials.from_service_account_file(
        str(SERVICE_ACCOUNT_PATH),
        scopes=SHEETS_SCOPES,
    )
    return build("sheets", "v4", credentials=creds)


def get_existing_source_keys_from_gsheet(doc_title):
    sheet_name = OUTPUT_SHEET_NAME_BY_DOC_TITLE.get(doc_title, doc_title)
    if not SPREADSHEET_ID:
        return set()
    try:
        service = get_sheets_service()
        result = (
            service.spreadsheets()
            .values()
            .get(
                spreadsheetId=SPREADSHEET_ID,
                range=f"'{sheet_name}'!A2:A",
                majorDimension="COLUMNS",
            )
            .execute()
        )
        values = result.get("values", [])
        if not values:
            return set()
        return {
            normalize_source_filename(v)
            for v in values[0]
            if str(v).strip()
        }
    except Exception as exc:
        print(
            f"[WARN] Could not read existing Source File values from Google Sheet "
            f"tab '{sheet_name}': {exc}"
        )
        return set()


def query_folder_ids_by_name(drive_service, folder_name):
    safe_name = folder_name.replace("'", "\\'")
    query = (
        "mimeType='application/vnd.google-apps.folder' "
        f"and name='{safe_name}' and trashed=false"
    )
    results = drive_service.files().list(
        q=query,
        fields="files(id,name)",
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
        orderBy="name_natural",
        pageSize=1000,
    ).execute()
    return [f["id"] for f in results.get("files", [])]


def resolve_drive_root_ids(drive_service):
    ids = []
    env_ids = os.getenv("DRIVE_ROOT_FOLDER_IDS", "").strip()
    if env_ids:
        ids.extend([x.strip() for x in env_ids.split(",") if x.strip()])
    else:
        ids.extend(DEFAULT_DRIVE_ROOT_FOLDER_IDS)

    for name in DEFAULT_DRIVE_ROOT_FOLDER_NAMES:
        try:
            ids.extend(query_folder_ids_by_name(drive_service, name))
        except Exception:
            pass

    unique = []
    seen = set()
    for folder_id in ids:
        if folder_id not in seen:
            seen.add(folder_id)
            unique.append(folder_id)
    return unique


def list_children(drive_service, folder_id):
    items = []
    page_token = None
    while True:
        results = drive_service.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            fields="nextPageToken, files(id,name,mimeType,size)",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
            orderBy="folder,name_natural",
            pageToken=page_token,
            pageSize=1000,
        ).execute()
        items.extend(results.get("files", []))
        page_token = results.get("nextPageToken")
        if not page_token:
            break
    return items


def find_named_folders_global(drive_service, target_folder_names):
    matched = []
    seen = set()
    for name in target_folder_names:
        safe_name = name.replace("'", "\\'")
        query = (
            "mimeType='application/vnd.google-apps.folder' "
            f"and name='{safe_name}' and trashed=false"
        )
        try:
            page_token = None
            while True:
                results = drive_service.files().list(
                    q=query,
                    fields="nextPageToken, files(id,name)",
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                    orderBy="name_natural",
                    pageToken=page_token,
                    pageSize=1000,
                ).execute()
                for item in results.get("files", []):
                    item_id = item["id"]
                    if item_id in seen:
                        continue
                    seen.add(item_id)
                    matched.append((item_id, item.get("name", "")))
                page_token = results.get("nextPageToken")
                if not page_token:
                    break
        except Exception as exc:
            print(f"[WARN] Could not query folder name '{name}': {exc}")
    return matched


def find_named_folders_under_roots(drive_service, root_ids, target_folder_names):
    targets = {normalize_name(name) for name in target_folder_names}
    matched = []
    queue = list(root_ids)
    seen = set()

    while queue:
        folder_id = queue.pop(0)
        if folder_id in seen:
            continue
        seen.add(folder_id)
        try:
            children = list_children(drive_service, folder_id)
        except Exception as exc:
            print(f"[WARN] Skipping folder {folder_id}: {exc}")
            continue

        for item in children:
            if item.get("mimeType") != "application/vnd.google-apps.folder":
                continue
            child_id = item["id"]
            child_name = item.get("name", "")
            if normalize_name(child_name) in targets:
                matched.append((child_id, child_name))
            queue.append(child_id)

    return matched


def list_pdfs_recursive_from_folders(drive_service, folder_ids):
    pdfs = {}
    queue = list(folder_ids)
    seen = set()

    while queue:
        folder_id = queue.pop(0)
        if folder_id in seen:
            continue
        seen.add(folder_id)
        try:
            children = list_children(drive_service, folder_id)
        except Exception as exc:
            print(f"[WARN] Could not list folder {folder_id}: {exc}")
            continue

        for item in children:
            mime = item.get("mimeType")
            name = str(item.get("name", ""))
            if mime == "application/vnd.google-apps.folder":
                queue.append(item["id"])
            else:
                is_pdf_mime = mime == "application/pdf"
                is_pdf_extension = name.lower().endswith(".pdf") and not str(
                    mime or ""
                ).startswith("application/vnd.google-apps.")
                if not (is_pdf_mime or is_pdf_extension):
                    continue
                pdfs[item["id"]] = item

    return list(pdfs.values())


def _cached_file_size(path):
    try:
        return path.stat().st_size
    except Exception:
        return 0


def _is_valid_cached_pdf(path):
    if not path.exists():
        return False
    if _cached_file_size(path) <= 0:
        return False
    try:
        with fitz.open(str(path)) as doc:
            return doc.page_count > 0
    except Exception:
        return False


def _should_redownload_cached_file(path, expected_size):
    if not path.exists():
        return True
    actual_size = _cached_file_size(path)
    if actual_size <= 0:
        return True
    if expected_size > 0 and actual_size != expected_size:
        return True
    if not _is_valid_cached_pdf(path):
        return True
    return False


def download_drive_files(drive_service, files, download_dir):
    local_entries = []
    for item in files:
        file_id = str(item.get("id", "")).strip()
        file_name = str(item.get("name", "")).strip()
        expected_size = _safe_int(item.get("size"))
        if not file_id or not file_name:
            continue

        file_dir = download_dir / file_id
        file_dir.mkdir(parents=True, exist_ok=True)
        target = file_dir / file_name
        try:
            if _should_redownload_cached_file(target, expected_size):
                temp_target = target.with_suffix(target.suffix + ".part")
                if temp_target.exists():
                    temp_target.unlink()

                request = drive_service.files().get_media(fileId=file_id)
                with temp_target.open("wb") as fh:
                    try:
                        from googleapiclient.http import MediaIoBaseDownload
                    except Exception as exc:  # pragma: no cover
                        raise SystemExit(
                            "Google Drive SDK missing. Install with: pip install google-api-python-client"
                        ) from exc
                    downloader = MediaIoBaseDownload(fh, request)
                    done = False
                    while not done:
                        _, done = downloader.next_chunk()

                if _cached_file_size(temp_target) <= 0:
                    temp_target.unlink(missing_ok=True)
                    print(
                        f"[WARN] Downloaded empty file from Drive; skipping: {file_name} (id={file_id})"
                    )
                    continue
                temp_target.replace(target)

            if not _is_valid_cached_pdf(target):
                target.unlink(missing_ok=True)
                print(
                    f"[WARN] Invalid/corrupt cached PDF after download; skipping: {file_name} (id={file_id})"
                )
                continue

            local_entries.append((target, file_name))
        except Exception as exc:
            print(
                f"[WARN] Failed to download/use Drive file {file_name} (id={file_id}): {exc}"
            )
            try:
                target.unlink(missing_ok=True)
            except Exception:
                pass

    return local_entries


def get_drive_pdf_entries(doc_title, cache_base=None):
    if cache_base is None:
        cache_base = BACKEND_DIR / "data" / "drive_input"
    target_names = DOC_INPUT_FOLDERS.get(doc_title)
    if not target_names:
        raise SystemExit(
            f"No Drive folder mapping configured for document '{doc_title}'. "
            "Run with --input for local PDFs or add mapping in DOC_INPUT_FOLDERS."
        )

    drive_service = get_drive_service()
    root_ids = resolve_drive_root_ids(drive_service)
    if not root_ids:
        raise SystemExit(
            "No Drive root folders found. Set DRIVE_ROOT_FOLDER_IDS in .env with comma-separated folder IDs."
        )

    matched = find_named_folders_under_roots(drive_service, root_ids, target_names)
    if not matched:
        raise SystemExit(
            f"No matching folders found for {doc_title}: {target_names} "
            f"under roots {root_ids}"
        )

    folder_ids = [folder_id for folder_id, _ in matched]
    unique_names = sorted({name for _, name in matched})
    print(f"Using Drive folders for {doc_title}: {', '.join(unique_names)}")

    pdfs = list_pdfs_recursive_from_folders(drive_service, folder_ids)
    if not pdfs:
        raise SystemExit(
            f"No PDF files found in mapped Drive folders for {doc_title}: {target_names}"
        )

    existing_source_keys = get_existing_source_keys_from_gsheet(doc_title)
    if existing_source_keys:
        before = len(pdfs)
        pdfs = [
            item
            for item in pdfs
            if normalize_source_filename(item.get("name", "")) not in existing_source_keys
        ]
        skipped = before - len(pdfs)
        if skipped > 0:
            print(
                f"Skipping {skipped} already-appended PDFs for {doc_title} "
                f"based on Google Sheet Source File values."
            )
    if not pdfs:
        print(
            f"No new PDFs to process for {doc_title}; all mapped Drive PDFs are already present "
            "in Google Sheet."
        )
        return []

    download_dir = cache_base / slugify(doc_title)
    entries = download_drive_files(drive_service, pdfs, download_dir)
    if not entries:
        print(
            f"No valid PDFs could be downloaded for {doc_title} after filtering and validation."
        )
    return entries


def _is_default_input_folder(input_path):
    path = resolve_ocr_path(Path(input_path))
    if path.is_file():
        return False
    parts = [str(part).lower() for part in path.parts]
    return len(parts) >= 2 and parts[-2:] == ["data", "input"]


def pdf_to_images(pdf_path, dpi=300, max_pages=None):
    doc = fitz.open(pdf_path)
    images = []
    for idx, page in enumerate(doc):
        if max_pages is not None and idx >= max_pages:
            break
        pix = page.get_pixmap(dpi=dpi)
        img_bytes = pix.tobytes("png")
        b64 = base64.b64encode(img_bytes).decode("ascii")
        images.append(f"data:image/png;base64,{b64}")
    doc.close()
    return images


def _stringify_response_content(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, dict):
        direct_text = value.get("text")
        if isinstance(direct_text, str):
            return direct_text
        if isinstance(direct_text, dict):
            nested_text = direct_text.get("value")
            if isinstance(nested_text, str):
                return nested_text
        nested_content = value.get("content")
        if isinstance(nested_content, str):
            return nested_content
        if isinstance(nested_content, list):
            return _stringify_response_content(nested_content)
        try:
            return json.dumps(value, ensure_ascii=False)
        except Exception:
            return str(value)
    if isinstance(value, list):
        parts = []
        for item in value:
            text = _stringify_response_content(item)
            if text:
                parts.append(text)
        if parts:
            return "\n".join(parts)
        try:
            return json.dumps(value, ensure_ascii=False)
        except Exception:
            return str(value)
    try:
        return str(value)
    except Exception:
        return ""


def _normalize_parsed_json(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        if len(value) == 1 and isinstance(value[0], dict):
            return value[0]
        for item in value:
            if isinstance(item, dict):
                return item
    return None


def _iter_balanced_json_fragments(text):
    fragments = []
    stack = []
    start = None
    in_string = False
    escaping = False

    for idx, ch in enumerate(text):
        if in_string:
            if escaping:
                escaping = False
                continue
            if ch == "\\":
                escaping = True
                continue
            if ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
            continue

        if ch in "{[":
            if not stack:
                start = idx
            stack.append("}" if ch == "{" else "]")
            continue

        if ch in "}]":
            if not stack:
                continue
            expected = stack.pop()
            if ch != expected:
                stack.clear()
                start = None
                continue
            if not stack and start is not None:
                fragments.append(text[start : idx + 1])
                start = None

    return fragments


def _iter_json_parse_variants(text):
    if not text:
        return []

    variants = []
    seen = set()

    def add(candidate):
        candidate = str(candidate).strip()
        if not candidate or candidate in seen:
            return
        seen.add(candidate)
        variants.append(candidate)

    add(text)
    add(
        text.replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2018", "'")
        .replace("\u2019", "'")
    )
    add(re.sub(r",\s*([}\]])", r"\1", text))

    return variants


def attempt_json_repair_with_model(client, model, raw_text):
    repaired = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "Return one valid JSON object only. "
                    "Do not include markdown, comments, or extra text."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Repair this response into strict JSON object form while keeping "
                    "the same keys and values where possible:\n\n"
                    + str(raw_text or "")
                ),
            },
        ],
        temperature=0,
    )
    repaired_text = _stringify_response_content(repaired.choices[0].message.content)
    repaired_json = extract_json(repaired_text)
    return repaired_json, repaired_text


def extract_json(text):
    normalized = _normalize_parsed_json(text)
    if normalized is not None:
        return normalized

    if isinstance(text, list):
        text = _stringify_response_content(text)

    cleaned = _stringify_response_content(text).strip()
    if not cleaned:
        raise ValueError("Empty response from model")

    candidates = []
    seen = set()

    def add_candidate(candidate):
        candidate = _stringify_response_content(candidate).strip()
        if not candidate or candidate in seen:
            return
        seen.add(candidate)
        candidates.append(candidate)

    add_candidate(cleaned)

    if cleaned.startswith("```"):
        stripped = re.sub(r"^```(?:json)?", "", cleaned.strip(), flags=re.IGNORECASE)
        stripped = stripped.strip("` \n")
        add_candidate(stripped)

    for fragment in _iter_balanced_json_fragments(cleaned):
        add_candidate(fragment)

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        add_candidate(cleaned[start : end + 1])

    for candidate in candidates:
        for variant in _iter_json_parse_variants(candidate):
            try:
                parsed = json.loads(variant)
            except Exception:
                continue
            normalized = _normalize_parsed_json(parsed)
            if normalized is not None:
                return normalized

    for candidate in candidates:
        for variant in _iter_json_parse_variants(candidate):
            try:
                parsed = ast.literal_eval(variant)
            except Exception:
                continue
            normalized = _normalize_parsed_json(parsed)
            if normalized is not None:
                return normalized

    raise ValueError("Could not parse response as JSON object")


def _extract_pdf_text_layer(pdf_path, max_pages=None, max_chars=24000):
    chunks = []
    consumed = 0
    try:
        with fitz.open(str(pdf_path)) as doc:
            for idx, page in enumerate(doc):
                if max_pages is not None and idx >= max_pages:
                    break
                page_text = (page.get_text("text") or "").strip()
                if not page_text:
                    continue
                chunk = f"--- Page {idx + 1} ---\n{page_text}"
                if consumed + len(chunk) > max_chars:
                    remaining = max_chars - consumed
                    if remaining > 0:
                        chunks.append(chunk[:remaining])
                    break
                chunks.append(chunk)
                consumed += len(chunk)
    except Exception:
        return ""
    return "\n\n".join(chunks).strip()


def _string_has_payload(value):
    text = str(value or "").strip()
    if not text:
        return False
    return text.lower() not in {
        "na",
        "n/a",
        "none",
        "null",
        "unknown",
        "not available",
        "not_applicable",
    }


def _record_has_meaningful_payload(value):
    if value is None:
        return False
    if isinstance(value, str):
        return _string_has_payload(value)
    if isinstance(value, (int, float, bool)):
        return True
    if isinstance(value, list):
        for item in value:
            if _record_has_meaningful_payload(item):
                return True
        return False
    if isinstance(value, dict):
        for key, nested in value.items():
            key_norm = re.sub(r"[^a-z0-9]+", "", str(key).lower())
            if key_norm in {
                "source",
                "flags",
                "parseerror",
                "rawresponse",
            }:
                continue
            if _record_has_meaningful_payload(nested):
                return True
        return False
    return _string_has_payload(value)


def _append_flag(record, flag_text):
    if not isinstance(record, dict):
        return
    if not _string_has_payload(flag_text):
        return
    existing = record.get("flags")
    normalized = []
    if isinstance(existing, list):
        for item in existing:
            item_text = str(item or "").strip()
            if item_text:
                normalized.append(item_text)
    elif isinstance(existing, str) and existing.strip():
        normalized = [existing.strip()]
    if flag_text not in normalized:
        normalized.append(flag_text)
    record["flags"] = normalized


def _ensure_record_diagnostics(record, doc_title, reason, raw_text=""):
    if not isinstance(record, dict):
        record = {}
    if _string_has_payload(reason) and not _string_has_payload(record.get("parse_error")):
        record["parse_error"] = str(reason).strip()
    _append_flag(record, f"extraction_warning: {reason}")
    if _string_has_payload(raw_text) and not _string_has_payload(record.get("raw_response")):
        record["raw_response"] = raw_text
    return record


def flatten_record(record):
    flat = {}

    def walk(prefix, value):
        if isinstance(value, dict):
            for k, v in value.items():
                walk(prefix + [k], v)
        elif isinstance(value, list):
            flat[".".join(prefix)] = json.dumps(value, ensure_ascii=False)
        else:
            flat[".".join(prefix)] = value

    walk([], record)
    return flat


def with_source_file_first(df: pd.DataFrame) -> pd.DataFrame:
    if "source_file" not in df.columns:
        return df
    cols = ["source_file"] + [c for c in df.columns if c != "source_file"]
    return df[cols]


def get_template_columns(sheet_name: str) -> list[str]:
    if not TEMPLATE_WORKBOOK_PATH.exists():
        return []
    if sheet_name in _TEMPLATE_COLUMNS_CACHE:
        return list(_TEMPLATE_COLUMNS_CACHE[sheet_name])
    try:
        df = pd.read_excel(TEMPLATE_WORKBOOK_PATH, sheet_name=sheet_name, nrows=0)
    except Exception:
        return []
    cols = [str(c).strip() for c in df.columns]
    filtered = []
    for c in cols:
        if not c or c.startswith("Unnamed:"):
            continue
        if c in {"Source File Path", "Date"}:
            continue
        filtered.append(c)
    _TEMPLATE_COLUMNS_CACHE[sheet_name] = list(filtered)
    return filtered


def pick_matching_column(target_col, source_col_by_norm, fallback_map):
    target_norm = normalize_col_name(target_col)
    for key in [target_norm] + fallback_map.get(target_norm, []):
        options = source_col_by_norm.get(key)
        if options:
            return options[0]
    # Fallback: suffix matching in both directions.
    # Direction 1: source-prefixed source key matches plain template field.
    #   e.g. template "Part Number" <- source "products.partNumber" (productspartnumber ends with partnumber)
    # Direction 2: template has section prefix, source is the bare field name.
    #   e.g. template "Reference Invoices - Invoice Number" <- source "invoiceNumber"
    #        (referenceinvoicesinvoicenumber ends with invoicenumber)
    suffix_matches = []
    for norm_key, options in source_col_by_norm.items():
        if norm_key.endswith(target_norm) or target_norm.endswith(norm_key):
            suffix_matches.extend(options)
    if suffix_matches:
        return suffix_matches[0]
    return None


def align_df_to_template_columns(df: pd.DataFrame, sheet_name: str) -> pd.DataFrame:
    template_columns = get_template_columns(sheet_name)
    if not template_columns:
        return with_source_file_first(df)

    source_col_by_norm = {}
    for col in df.columns:
        source_col_by_norm.setdefault(normalize_col_name(col), []).append(col)

    fallback_map = {
        normalize_col_name("Source File"): [normalize_col_name("source_file")],
    }

    out = pd.DataFrame(index=df.index)
    for col in template_columns:
        source_col = pick_matching_column(col, source_col_by_norm, fallback_map)
        if source_col is None:
            out[col] = ""
        else:
            out[col] = df[source_col]

    if "Source File" in out.columns:
        cols = ["Source File"] + [c for c in out.columns if c != "Source File"]
        out = out[cols]
    return out


def tokenize_label(s):
    return re.findall(r"[A-Za-z0-9]+", str(s))


def to_camel(tokens):
    if not tokens:
        return "field"
    first, *rest = tokens
    return first.lower() + "".join(t.title() for t in rest)


def to_snake(tokens):
    if not tokens:
        return "field"
    return "_".join(t.lower() for t in tokens)


def build_prompt_from_schema(
    schema_rows,
    doc_title,
    array_sections,
    key_style="camel",
    section_key_map=None,
    field_key_map=None,
    preamble="",
    add_tariff_lines=False,
):
    section_key_map = section_key_map or {}
    field_key_map = field_key_map or {}

    def section_key(label):
        if label in section_key_map:
            return section_key_map[label]
        tokens = tokenize_label(label)
        return to_snake(tokens) if key_style == "snake" else to_camel(tokens)

    def field_key(label):
        if label in field_key_map:
            return field_key_map[label]
        tokens = tokenize_label(label)
        return to_snake(tokens) if key_style == "snake" else to_camel(tokens)

    by_section = {}
    section_order = []
    for row in schema_rows:
        section = (row.get("section") or "General").strip()
        if section not in by_section:
            by_section[section] = []
            section_order.append(section)
        by_section[section].append(row)

    section_lines = []
    template = {"source": "Gemini"}

    for sec in section_order:
        sec_key = section_key(sec)
        rows = by_section[sec]
        fields = []
        for r in rows:
            fname = r.get("fieldName") or ""
            fkey = field_key(fname)
            fields.append((fkey, fname))

        if sec in array_sections:
            row_obj = {k: "" for k, _ in fields}
            if add_tariff_lines and sec.lower() == "line items":
                row_obj["tariffLines"] = [
                    {
                        "htsusNumber": "",
                        "description": "",
                        "grossWeight": None,
                        "netQuantity": None,
                        "netQuantityUnit": None,
                        "enteredValue": None,
                        "rate": "",
                        "dutyAmount": "",
                    }
                ]
            template[sec_key] = [row_obj]
            field_list = "\n".join([f"    - JSON key `{k}` ← **{n}**" for k, n in fields])
            section_lines.append(
                f"- **{sec}** → `{sec_key}` is a **JSON array**.\n{field_list}"
            )
        else:
            obj = {k: "" for k, _ in fields}
            template[sec_key] = obj
            field_list = "\n".join([f"    - JSON key `{k}` ← **{n}**" for k, n in fields])
            section_lines.append(
                f"- **{sec}** → `{sec_key}` is a **JSON object**.\n{field_list}"
            )

    universal_rule = (
        "UNIVERSAL EXTRACTION RULE:\n"
        "1. SCAN EVERY PAGE: Read the full document from page 1 to the last page. "
        "Fields and tables may appear on any page, in headers, footers, sidebars, or body — "
        "do not stop after the first page.\n"
        "2. POSITION-AGNOSTIC: Field labels and data may appear in any layout — "
        "top-right blocks, left-side labels, inline key:value pairs, rotated text, footnotes. "
        "Do not assume a fixed position for any field.\n"
        "3. FUZZY LABEL MATCHING: Column headers and field labels in the document may differ "
        "from the exact names listed below — treat any semantically equivalent label as a match "
        "(e.g. \"Export Invoice No\" = \"Invoice Number\", \"Inv Date\" = \"Invoice Date\", "
        "\"Booking #\" = \"Booking Number\", \"No of Containers\" = \"Total Containers\", etc.).\n"
        "4. NEVER TRUNCATE ARRAYS: For every array/table section, extract ALL rows from ALL pages — "
        "do not stop at the first page, first table, or after a few rows. "
        "If a table continues on subsequent pages, include every continuation row.\n"
        "5. NEVER LEAVE EMPTY: Never leave a field empty or null when the corresponding data is "
        "clearly visible in the PDF, even if the label wording differs slightly from this prompt."
    )

    prompt = preamble.strip()
    if prompt:
        prompt += "\n\n"
    prompt += universal_rule
    prompt += "\n\nSECTION MAPPING:\n" + "\n\n".join(section_lines)
    prompt += "\n\nTEMPLATE:\n" + json.dumps(template, indent=2)
    prompt += "\n\nRespond with **one JSON object** only (no markdown fences)."
    return prompt


def load_schema(path):
    resolved_path = resolve_ocr_path(Path(path))
    if not resolved_path.exists():
        raise SystemExit(f"Schema file not found: {path} (resolved: {resolved_path})")
    if resolved_path.suffix.lower() in {".json"}:
        data = json.loads(resolved_path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and "rows" in data:
            return data["rows"]
        if isinstance(data, dict) and "fields" in data:
            return data["fields"]
        if isinstance(data, list):
            return data
        raise SystemExit("Schema JSON must be a list of rows or {rows:[...]} or {fields:[...]}")
    if resolved_path.suffix.lower() in {".csv"}:
        return pd.read_csv(resolved_path).to_dict(orient="records")
    if resolved_path.suffix.lower() in {".xlsx", ".xls"}:
        df = pd.read_excel(resolved_path)
        return df.to_dict(orient="records")
    raise SystemExit("Unsupported schema file type. Use .json, .csv, or .xlsx.")


def get_local_pdf_entries(input_path):
    input_path = resolve_ocr_path(Path(input_path))
    if input_path.is_file():
        return [(input_path, input_path.name)]
    if not input_path.exists():
        raise SystemExit(f"Input path not found: {input_path}")
    pdfs = sorted(input_path.glob("*.pdf"))
    if not pdfs:
        raise SystemExit(f"No PDF files found in {input_path}")
    return [(p, p.name) for p in pdfs]


def get_pdf_entries(input_path, doc_title, use_drive=False):
    resolved_input = resolve_ocr_path(Path(input_path))
    force_local = str(os.getenv("OCR_FORCE_LOCAL_INPUT", "0")).strip().lower() in {
        "1",
        "true",
        "yes",
    }
    auto_use_drive = (
        (doc_title in DOC_INPUT_FOLDERS)
        and _is_default_input_folder(resolved_input)
        and not force_local
    )

    if use_drive or auto_use_drive:
        if auto_use_drive and not use_drive:
            print(
                f"Auto-selecting Drive input for {doc_title} (default input path detected). "
                "Set OCR_FORCE_LOCAL_INPUT=1 to force local data/input."
            )
        return get_drive_pdf_entries(doc_title)

    try:
        return get_local_pdf_entries(resolved_input)
    except SystemExit as exc:
        if doc_title in DOC_INPUT_FOLDERS:
            print(f"{exc}. Falling back to Drive folders for {doc_title}.")
            return get_drive_pdf_entries(doc_title)
        raise


def run_ocr(
    input_path,
    output_path,
    prompt_text,
    doc_title,
    use_drive=False,
    dpi=300,
    max_pages=None,
    output_sheet_name=None,
    expand_array_key=None,
):
    input_path = resolve_ocr_path(Path(input_path))
    output_path = resolve_ocr_path(Path(output_path))
    records, sources = extract_records_with_sources(
        input_path=input_path,
        prompt_text=prompt_text,
        doc_title=doc_title,
        use_drive=use_drive,
        dpi=dpi,
        max_pages=max_pages,
    )

    rows = []
    for record, source in zip(records, sources):
        flat = flatten_record(record)
        flat.pop("source", None)

        if expand_array_key:
            items = record.get(expand_array_key) or []
            if not isinstance(items, list):
                items = []
            flat.pop(expand_array_key, None)
            flat["source_file"] = source
            if not items:
                rows.append(flat)
            else:
                for item in items:
                    row = dict(flat)
                    if isinstance(item, dict):
                        for k, v in item.items():
                            row[f"{expand_array_key}.{k}"] = v
                    rows.append(row)
        else:
            flat["source_file"] = source
            rows.append(flat)

    df = pd.DataFrame(rows)
    template_sheet = DOC_TO_TEMPLATE_SHEET.get(doc_title)
    if template_sheet:
        df = align_df_to_template_columns(df, template_sheet)
    else:
        df = with_source_file_first(df)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet_name = (
        output_sheet_name
        or OUTPUT_SHEET_NAME_BY_DOC_TITLE.get(doc_title)
        or doc_title
    )
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name=sheet_name, index=False)
    print(f"Wrote Excel: {output_path}")


def extract_records_with_sources(
    input_path,
    prompt_text,
    doc_title,
    use_drive=False,
    dpi=300,
    max_pages=None,
):
    api_key, model, base_url, organization, project, is_openrouter = load_env()
    client_kwargs = {
        "api_key": api_key,
        "base_url": base_url,
        "organization": organization,
        "project": project,
    }
    if is_openrouter:
        title = str(doc_title or "zetwerk-structured-ocr").strip()
        env_title = str(
            os.getenv("OPENROUTER_X_TITLE")
            or os.getenv("OCR_RUN_TITLE")
            or ""
        ).strip()
        request_title = env_title or title or "zetwerk-structured-ocr"
        referer = str(
            os.getenv("OPENROUTER_HTTP_REFERER")
            or "https://invoice.ai.in"
        ).strip() or "https://invoice.ai.in"
        client_kwargs["default_headers"] = {
            "HTTP-Referer": referer,
            "X-OpenRouter-Title": request_title,
        }
        print(f"OpenRouter request title: {request_title}")
    client = OpenAI(**client_kwargs)

    pdf_entries = get_pdf_entries(input_path, doc_title=doc_title, use_drive=use_drive)
    if not pdf_entries:
        print(f"No input PDFs to process for {doc_title}.")
        return [], []

    effective_use_drive = bool(use_drive)
    if not effective_use_drive and doc_title in DOC_INPUT_FOLDERS:
        if _is_default_input_folder(input_path):
            effective_use_drive = True
        elif pdf_entries:
            first_path_text = str(pdf_entries[0][0]).replace("\\", "/").lower()
            if "/drive_input/" in first_path_text:
                effective_use_drive = True

    checkpoint_path = build_checkpoint_path(
        doc_title, input_path, use_drive=effective_use_drive
    )
    records, sources, processed_pdf_paths = load_checkpoint_records(checkpoint_path)
    if records:
        print(
            f"Resuming from checkpoint: {len(records)} previously extracted PDF(s) "
            f"loaded from {checkpoint_path}."
        )

    def is_credit_error(exc: Exception) -> bool:
        text = str(exc).lower()
        return (
            "error code: 402" in text
            or "requires more credits" in text
            or "can only afford" in text
            or "insufficient quota" in text
            or "insufficient credits" in text
        )

    total = len(pdf_entries)
    interrupted = False
    fully_processed = True
    max_attempts = max(1, _safe_int(os.getenv("OCR_API_RETRY_ATTEMPTS") or 3))
    retry_delay_seconds = max(0.0, _safe_float(os.getenv("OCR_API_RETRY_DELAY_SECONDS") or 2))
    stop_reason = ""
    run_metrics = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "doc_title": doc_title,
        "model": model,
        "use_drive": bool(effective_use_drive),
        "pdfs_in_input": total,
        "pdfs_attempted": 0,
        "pdfs_succeeded": 0,
        "pdfs_failed": 0,
        "pdfs_skipped_checkpoint": 0,
        "pdfs_skipped_no_pages": 0,
        "pages": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "json_parse_failures": 0,
        "json_repair_attempts": 0,
        "json_repair_successes": 0,
        "empty_json_outputs": 0,
        "empty_json_salvage_attempts": 0,
        "empty_json_salvage_successes": 0,
    }
    page_usage_rows = []
    failed_sources = []

    for idx, (pdf_path, source_name) in enumerate(pdf_entries, start=1):
        pdf_key = str(pdf_path)
        if pdf_key in processed_pdf_paths:
            print(f"Skipping already checkpointed {idx}/{total}: {source_name}")
            run_metrics["pdfs_skipped_checkpoint"] += 1
            continue

        try:
            print(f"Processing {idx}/{total}: {source_name}")
            images = pdf_to_images(pdf_path, dpi=dpi, max_pages=max_pages)
            if not images:
                print(f"Skipping (no pages): {source_name}")
                run_metrics["pdfs_skipped_no_pages"] += 1
                processed_pdf_paths.add(pdf_key)
                continue
            run_metrics["pdfs_attempted"] += 1
            run_metrics["pages"] += len(images)

            content = [{"type": "text", "text": "Extract the document using the instructions."}]
            for img in images:
                content.append({"type": "image_url", "image_url": {"url": img, "detail": "high"}})

            response = None
            last_exc = None
            for attempt in range(1, max_attempts + 1):
                try:
                    response = client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": prompt_text},
                            {"role": "user", "content": content},
                        ],

                        temperature=0,
                    )
                    break
                except Exception as exc:
                    last_exc = exc
                    if is_credit_error(exc):
                        raise
                    if attempt >= max_attempts:
                        raise
                    print(
                        f"[WARN] API call failed for {source_name} "
                        f"(attempt {attempt}/{max_attempts}): {exc}. Retrying..."
                    )
                    if retry_delay_seconds > 0:
                        time.sleep(retry_delay_seconds)
            if response is None and last_exc is not None:
                raise last_exc
            input_tokens, output_tokens = extract_usage_tokens(response)
            run_metrics["input_tokens"] += input_tokens
            run_metrics["output_tokens"] += output_tokens
            page_usage_rows.extend(
                build_page_usage_rows(
                    timestamp_utc=run_metrics["timestamp_utc"],
                    doc_title=doc_title,
                    model=model,
                    source_file=source_name,
                    page_count=len(images),
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                )
            )

            raw_text = _stringify_response_content(response.choices[0].message.content)
            parse_error_text = ""
            try:
                data = extract_json(raw_text)
            except Exception as exc:
                run_metrics["json_parse_failures"] += 1
                parse_error_text = str(exc)
                repaired_data = None

                run_metrics["json_repair_attempts"] += 1
                try:
                    repaired_data, _ = attempt_json_repair_with_model(
                        client=client,
                        model=model,
                        raw_text=raw_text,
                    )
                except Exception as repair_exc:
                    print(
                        f"[WARN] JSON repair call failed for {source_name}: {repair_exc}"
                    )

                if repaired_data is not None:
                    data = repaired_data
                    run_metrics["json_repair_successes"] += 1
                    print(f"[INFO] Auto-repaired JSON formatting for {source_name}.")
                else:
                    data = {
                        "parse_error": parse_error_text,
                        "flags": [f"json_parse_error: {parse_error_text}"],
                        "raw_response": raw_text,
                    }

            if not _record_has_meaningful_payload(data):
                run_metrics["empty_json_outputs"] += 1
                text_layer_dump = _extract_pdf_text_layer(
                    pdf_path=pdf_path, max_pages=max_pages
                )
                recovered_from_salvage = False
                salvage_raw_text = ""

                if text_layer_dump:
                    run_metrics["empty_json_salvage_attempts"] += 1
                    salvage_response = None
                    salvage_last_exc = None
                    for attempt in range(1, max_attempts + 1):
                        try:
                            salvage_response = client.chat.completions.create(
                                model=model,
                                messages=[
                                    {"role": "system", "content": prompt_text},
                                    {
                                        "role": "user",
                                        "content": (
                                            "Previous extraction output was empty or unusable. "
                                            "Re-extract from this PDF text-layer dump and return "
                                            "one strict JSON object matching the required "
                                            "mapping/template.\n\n"
                                            "PDF text layer dump:\n"
                                            + text_layer_dump
                                        ),
                                    },
                                ],
                                temperature=0,
                            )
                            break
                        except Exception as exc:
                            salvage_last_exc = exc
                            if is_credit_error(exc):
                                raise
                            if attempt >= max_attempts:
                                break
                            print(
                                f"[WARN] Empty-record salvage API call failed for {source_name} "
                                f"(attempt {attempt}/{max_attempts}): {exc}. Retrying..."
                            )
                            if retry_delay_seconds > 0:
                                time.sleep(retry_delay_seconds)

                    if salvage_response is not None:
                        salvage_in, salvage_out = extract_usage_tokens(salvage_response)
                        run_metrics["input_tokens"] += salvage_in
                        run_metrics["output_tokens"] += salvage_out
                        salvage_raw_text = _stringify_response_content(
                            salvage_response.choices[0].message.content
                        )

                        salvage_data = None
                        try:
                            salvage_data = extract_json(salvage_raw_text)
                        except Exception as exc:
                            run_metrics["json_parse_failures"] += 1
                            salvage_parse_error = str(exc)
                            run_metrics["json_repair_attempts"] += 1
                            try:
                                salvage_data, _ = attempt_json_repair_with_model(
                                    client=client,
                                    model=model,
                                    raw_text=salvage_raw_text,
                                )
                                if salvage_data is not None:
                                    run_metrics["json_repair_successes"] += 1
                                    print(
                                        f"[INFO] Auto-repaired JSON formatting for "
                                        f"{source_name} during text-layer salvage pass."
                                    )
                            except Exception as repair_exc:
                                print(
                                    f"[WARN] JSON repair failed during text-layer salvage for "
                                    f"{source_name}: {repair_exc}"
                                )
                                _append_flag(
                                    data,
                                    (
                                        "text_layer_salvage_json_parse_error: "
                                        f"{salvage_parse_error}"
                                    ),
                                )

                        if salvage_data is not None and _record_has_meaningful_payload(
                            salvage_data
                        ):
                            data = salvage_data
                            recovered_from_salvage = True
                            run_metrics["empty_json_salvage_successes"] += 1
                            print(
                                f"[WARN] Recovered empty extraction for {source_name} "
                                "using text-layer salvage pass."
                            )
                    elif salvage_last_exc is not None:
                        print(
                            f"[WARN] Empty-record salvage failed for {source_name}: "
                            f"{salvage_last_exc}"
                        )

                if not recovered_from_salvage:
                    reason = (
                        "Model returned JSON with no usable extracted values."
                    )
                    if _string_has_payload(parse_error_text):
                        reason = (
                            f"{reason} Primary parse error: {parse_error_text}"
                        )
                    data = _ensure_record_diagnostics(
                        data,
                        doc_title=doc_title,
                        reason=reason,
                        raw_text=raw_text,
                    )
                    if not text_layer_dump:
                        _append_flag(data, "text_layer_unavailable")
                    elif _string_has_payload(salvage_raw_text):
                        _append_flag(data, "text_layer_salvage_failed")
                        if not _string_has_payload(data.get("raw_response")):
                            data["raw_response"] = salvage_raw_text

            records.append(data)
            sources.append(source_name)
            run_metrics["pdfs_succeeded"] += 1
            processed_pdf_paths.add(pdf_key)
            append_checkpoint_record(checkpoint_path, pdf_path, source_name, data)
        except KeyboardInterrupt:
            interrupted = True
            fully_processed = False
            print(
                f"Interrupted by user. Returning partial output for {len(records)} "
                f"processed PDF(s) out of {total}."
            )
            break
        except Exception as exc:
            if is_credit_error(exc):
                fully_processed = False
                print(
                    "Stopping due to API credit/quota limit. "
                    f"Returning partial output. Details: {exc}"
                )
                break
            fully_processed = False
            run_metrics["pdfs_failed"] += 1
            stop_reason = f"{source_name}: {exc}"
            failed_sources.append(stop_reason)
            print(
                f"[WARN] Skipping failed PDF and continuing: {stop_reason}"
            )
            continue

    run_metrics["run_status"] = "success"
    if interrupted:
        run_metrics["run_status"] = "interrupted"
    elif not fully_processed:
        run_metrics["run_status"] = "partial"
        if stop_reason:
            run_metrics["stop_reason"] = stop_reason
        if failed_sources:
            run_metrics["failed_pdf_count"] = len(failed_sources)
            run_metrics["failed_pdf_examples"] = " | ".join(failed_sources[:5])
    elif run_metrics["pdfs_succeeded"] == 0:
        run_metrics["run_status"] = "no_records"
    emit_run_metrics(run_metrics, page_usage_rows=page_usage_rows)

    if not records:
        raise SystemExit("No records extracted.")

    if interrupted:
        print("Continuing with partial results and writing output file.")

    all_done = fully_processed and (len(processed_pdf_paths) >= total)
    if all_done:
        clear_checkpoint(checkpoint_path)
    else:
        print(f"Checkpoint saved at: {checkpoint_path}")

    return records, sources


def extract_prompt_preamble(ts_path):
    if not ts_path:
        return ""
    ts_path = resolve_ocr_path(Path(ts_path))
    if not ts_path.exists():
        return ""
    text = ts_path.read_text(encoding="utf-8", errors="ignore")
    match = re.search(r"return `([\s\S]*?)`;", text)
    if not match:
        return ""
    raw = match.group(1)
    raw = re.sub(r"\$\{[\s\S]*?\}", "", raw)
    if "SECTION MAPPING:" in raw:
        raw = raw.split("SECTION MAPPING:")[0]
    return raw.strip()


def extract_ts_map(ts_path, var_name):
    if not ts_path:
        return {}
    resolved_ts_path = resolve_ocr_path(Path(ts_path))
    if not resolved_ts_path.exists():
        return {}
    text = resolved_ts_path.read_text(encoding="utf-8", errors="ignore")
    pattern = rf"const\s+{re.escape(var_name)}\s*:\s*Record<[^>]+>\s*=\s*\{{([\s\S]*?)\}};"
    match = re.search(pattern, text)
    if not match:
        return {}
    block = match.group(1)
    entries = {}
    for line in block.splitlines():
        line = line.strip().rstrip(",")
        if not line or ":" not in line:
            continue
        m = re.match(r"""(["'])(.*?)\1\s*:\s*(["'])(.*?)\3""", line)
        if not m:
            m = re.match(
                r"""([A-Za-z_][A-Za-z0-9_]*)\s*:\s*['"]([^'"]*)['"]""",
                line,
            )
        if not m:
            continue
        if m.lastindex == 4:
            entries[m.group(2)] = m.group(4)
        else:
            entries[m.group(1)] = m.group(2)
    return entries


def cli_main(
    doc_title,
    schema_path,
    prompt_ts_path,
    array_sections,
    key_style="camel",
    section_key_map=None,
    field_key_map=None,
    add_tariff_lines=False,
    expand_array_key=None,
):
    parser = argparse.ArgumentParser(description=f"{doc_title} OCR extraction")
    parser.add_argument(
        "--input",
        default="data/input",
        help="PDF file or folder containing PDF files.",
    )
    parser.add_argument(
        "--output",
        default=f"data/{doc_title.replace(' ', '_').lower()}_ocr_output.xlsx",
        help="Output Excel file path.",
    )
    parser.add_argument(
        "--schema",
        default=str(schema_path) if schema_path else "",
        help="Schema file path (.json/.csv/.xlsx).",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=300,
        help="Render DPI for PDF pages (higher = better OCR, slower).",
    )
    parser.add_argument("--max-pages", type=int, default=None)
    parser.add_argument(
        "--drive",
        action="store_true",
        default=False,
        help="Use mapped Google Drive folders for input PDFs.",
    )
    parser.add_argument(
        "--local",
        dest="drive",
        action="store_false",
        help="Use local --input path instead of Drive.",
    )
    args = parser.parse_args()

    if not args.schema:
        raise SystemExit("Schema path is required for this document type.")
    schema_rows = load_schema(Path(args.schema))
    preamble = extract_prompt_preamble(Path(prompt_ts_path)) if prompt_ts_path else ""
    prompt = build_prompt_from_schema(
        schema_rows=schema_rows,
        doc_title=doc_title,
        array_sections=array_sections,
        key_style=key_style,
        section_key_map=section_key_map,
        field_key_map=field_key_map,
        preamble=preamble,
        add_tariff_lines=add_tariff_lines,
    )

    run_ocr(
        Path(args.input),
        Path(args.output),
        prompt,
        doc_title=doc_title,
        use_drive=args.drive,
        dpi=args.dpi,
        max_pages=args.max_pages,
        expand_array_key=expand_array_key,
    )
