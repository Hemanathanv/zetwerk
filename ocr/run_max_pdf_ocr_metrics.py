import argparse
import hashlib
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from structured_ocr import (
    DOC_INPUT_FOLDERS,
    download_drive_files,
    find_named_folders_global,
    find_named_folders_under_roots,
    get_drive_service,
    resolve_drive_root_ids,
)


OCR_METRICS_PREFIX = "OCR_METRICS_JSON: "
DEFAULT_DRIVE_CACHE_ROOT = Path("data/drive_input")
DEFAULT_OUTPUT_DIR = Path("data/processed/max_pdf_ocr")
DEFAULT_METRICS_LOG_PATH = Path("data/ocr_run_metrics_pagewise.jsonl")
DEFAULT_METRICS_EXCEL_PATH = Path("data/ocr_run_metrics_pagewise.xlsx")
RUN_METRICS_SHEET = "run_metrics"
PAGEWISE_METRICS_SHEET = "pagewise_metrics"
SUMMARY_SHEET = "ocr_summary"


JOBS = [
    ("Entry Summary", "Entry Summary", "entry_summary.py"),
    (
        "Entry Summary Tariff Lines",
        "Entry Summary Tariff Lines",
        "entry_summary_tariff_lines.py",
    ),
    ("Steel Supplier Declaration", "Steel Supplier Declaration", "ssd.py"),
    ("Shipping Bill", "Shipping Bill", "shipping_bill.py"),
    ("Delivery Deduction Sheet", "Delivery Deduction Sheet", "dds.py"),
    ("Ocean Freight", "Ocean Freight", "ocean_freight.py"),
    ("Packing List", "Packing List", "packing_list.py"),
    ("Sales Invoices", "Sales Invoices", "sales_invoice.py"),
    ("Bill of Lading", "Bill of Lading", "bill_of_lading.py"),
    ("Freight Forwarder Bill", "Freight Forwarder Bill", "freight_forward.py"),
    ("CHA", "CHA", "cha.py"),
    ("US Cargo Release Order", "US Cargo Release Order", "us_cargo_release.py"),
    ("US Customs Release Order", "US Customs Release Order", "us_custom_release.py"),
    ("US Delivery Order", "US Delivery Order", "us_delivery_order.py"),
    ("US Packing List", "US Packing List", "us_packing_list.py"),
]


CHA_DRIVE_FOLDER_IDS = [
    "1juO4zeNbZIk8xBzBjGnjCEuVoWRjggbi",
    "1xGxNgM7odiVsSEbhS-u43SzKmp__QepI",
]


def utc_now_text():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def progress(message):
    print(f"[{utc_now_text()}] {message}")


def slugify(value):
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").lower()).strip("_") or "doc"


def safe_int(value):
    try:
        if value is None:
            return 0
        return int(value)
    except Exception:
        return 0


def safe_float(value):
    try:
        if value is None:
            return 0.0
        return float(value)
    except Exception:
        return 0.0


def format_bytes(n):
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(max(0, n))
    for unit in units:
        if value < 1024.0 or unit == units[-1]:
            return f"{value:.2f} {unit}"
        value /= 1024.0
    return f"{n} B"


def metrics_from_output(lines):
    for line in reversed(lines):
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


def build_checkpoint_path(doc_title, input_path):
    try:
        resolved = str(Path(input_path).resolve())
    except Exception:
        resolved = str(input_path)
    run_key = f"local::{resolved}"
    digest = hashlib.md5(run_key.encode("utf-8", errors="ignore")).hexdigest()[:12]
    return Path("data/checkpoints") / f"{slugify(doc_title)}_{digest}.jsonl"


def clear_checkpoint_for_job(doc_title, input_path):
    path = build_checkpoint_path(doc_title, input_path)
    if path.exists():
        path.unlink()
        return path
    return None


def split_tokens_across_pages(total_tokens, page_count):
    page_count = max(0, safe_int(page_count))
    total_tokens = safe_int(total_tokens)
    if page_count <= 0:
        return []
    base, rem = divmod(total_tokens, page_count)
    return [base + (1 if i < rem else 0) for i in range(page_count)]


def append_rows_to_excel(excel_path, sheet_name, rows):
    if not rows:
        return

    excel_path = Path(excel_path)
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
    combined_df = pd.concat([existing_df, new_df], ignore_index=True)
    existing_sheets[sheet_name] = combined_df

    with pd.ExcelWriter(excel_path, engine="openpyxl") as writer:
        for name, df in existing_sheets.items():
            if df is None:
                df = pd.DataFrame()
            if not isinstance(df, pd.DataFrame):
                df = pd.DataFrame(df)
            df.to_excel(writer, sheet_name=name[:31], index=False)


def append_jsonl_rows(log_path, rows):
    if not rows:
        return
    log_path = Path(log_path)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def list_pdfs_recursive_from_folders_with_size(drive_service, folder_ids):
    pdfs = {}
    queue = list(folder_ids)
    seen = set()
    visited_folders = 0

    progress(
        f"Scanning Drive folders recursively for PDFs (root folders: {len(folder_ids)})"
    )
    while queue:
        folder_id = queue.pop(0)
        if folder_id in seen:
            continue
        seen.add(folder_id)
        visited_folders += 1
        if visited_folders % 20 == 0:
            progress(
                f"Drive scan progress: visited {visited_folders} folders, "
                f"found {len(pdfs)} PDFs so far"
            )

        page_token = None
        while True:
            results = (
                drive_service.files()
                .list(
                    q=f"'{folder_id}' in parents and trashed=false",
                    fields="nextPageToken, files(id,name,mimeType,size)",
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
                    orderBy="folder,name_natural",
                    pageToken=page_token,
                    pageSize=1000,
                )
                .execute()
            )
            for item in results.get("files", []):
                mime = item.get("mimeType")
                if mime == "application/vnd.google-apps.folder":
                    queue.append(item["id"])
                    continue
                name = item.get("name", "")
                if mime == "application/pdf" or name.lower().endswith(".pdf"):
                    item["size"] = safe_int(item.get("size"))
                    pdfs[item["id"]] = item
            page_token = results.get("nextPageToken")
            if not page_token:
                break

    progress(
        f"Drive scan complete: visited {visited_folders} folders, "
        f"found {len(pdfs)} PDFs"
    )
    return list(pdfs.values())


def resolve_folder_ids_for_doc(drive_service, doc_title):
    if doc_title == "CHA":
        progress(
            f"[{doc_title}] Using fixed CHA Drive folder IDs: "
            f"{', '.join(CHA_DRIVE_FOLDER_IDS)}"
        )
        return list(CHA_DRIVE_FOLDER_IDS), ["CHA_CONFIGURED_FOLDER_IDS"]

    target_names = DOC_INPUT_FOLDERS.get(doc_title) or []
    if not target_names:
        return [], []

    progress(f"[{doc_title}] Resolving Drive folders by name: {', '.join(target_names)}")
    matched = find_named_folders_global(drive_service, target_names)
    if not matched:
        progress(f"[{doc_title}] Global name lookup empty; trying under configured roots")
        root_ids = resolve_drive_root_ids(drive_service)
        matched = find_named_folders_under_roots(drive_service, root_ids, target_names)
    folder_ids = [folder_id for folder_id, _ in matched]
    folder_names = sorted({name for _, name in matched})
    progress(
        f"[{doc_title}] Resolved {len(folder_ids)} Drive folders: "
        f"{', '.join(folder_names) if folder_names else 'none'}"
    )
    return folder_ids, folder_names


def select_largest_pdf_from_drive(drive_service, doc_title, cache_root):
    folder_ids, folder_names = resolve_folder_ids_for_doc(drive_service, doc_title)
    if not folder_ids:
        return None, {
            "reason": "missing_drive_mapping_or_folder",
            "folder_names": folder_names,
            "folder_ids": folder_ids,
        }

    pdfs = list_pdfs_recursive_from_folders_with_size(drive_service, folder_ids)
    if not pdfs:
        return None, {
            "reason": "no_pdf_in_mapped_folders",
            "folder_names": folder_names,
            "folder_ids": folder_ids,
        }

    largest = max(pdfs, key=lambda item: safe_int(item.get("size")))
    progress(
        f"[{doc_title}] Largest PDF selected: {largest.get('name', '')} "
        f"({format_bytes(safe_int(largest.get('size')))}), downloading..."
    )
    download_dir = Path(cache_root) / slugify(doc_title)
    entries = download_drive_files(drive_service, [largest], download_dir)
    if not entries:
        return None, {
            "reason": "download_failed",
            "folder_names": folder_names,
            "folder_ids": folder_ids,
        }
    local_path, source_name = entries[0]
    progress(f"[{doc_title}] Downloaded selected PDF to cache: {local_path}")
    return {
        "local_path": Path(local_path).resolve(),
        "source_name": source_name,
        "drive_file_id": largest.get("id", ""),
        "drive_file_name": largest.get("name", ""),
        "drive_file_size": safe_int(largest.get("size")),
        "folder_names": folder_names,
        "folder_ids": folder_ids,
    }, None


def run_job(
    *,
    python_executable,
    job_name,
    doc_title,
    script_name,
    input_pdf,
    output_dir,
    env,
    max_pages=None,
    dpi=None,
    progress_interval_seconds=20,
):
    script_path = Path(script_name)
    if not script_path.exists():
        return {
            "job_name": job_name,
            "doc_title": doc_title,
            "script_name": script_name,
            "return_code": 1,
            "elapsed_seconds": 0.0,
            "metrics": None,
            "error": f"Script not found: {script_name}",
        }

    output_path = output_dir / f"{slugify(doc_title)}_ocr_output.xlsx"
    cmd = [
        python_executable,
        script_name,
        "--input",
        str(input_pdf),
        "--output",
        str(output_path),
    ]
    if dpi is not None:
        cmd.extend(["--dpi", str(int(dpi))])
    if max_pages is not None:
        cmd.extend(["--max-pages", str(int(max_pages))])

    print(f"\n[{job_name}] START -> {' '.join(cmd)}")
    start = time.time()
    lines = []

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=env,
    )
    assert proc.stdout is not None
    out_q = queue.Queue()

    def _reader_thread():
        for raw_line in proc.stdout:
            out_q.put(raw_line)
        out_q.put(None)

    reader = threading.Thread(target=_reader_thread, daemon=True)
    reader.start()

    last_heartbeat = time.time()
    while True:
        try:
            item = out_q.get(timeout=1.0)
        except queue.Empty:
            if proc.poll() is None and (time.time() - last_heartbeat) >= max(
                5, int(progress_interval_seconds)
            ):
                elapsed = time.time() - start
                print(
                    f"[{job_name}] still running... elapsed={elapsed:.0f}s "
                    "(waiting for OCR output)"
                )
                last_heartbeat = time.time()
            continue

        if item is None:
            break

        clean = item.rstrip("\n")
        lines.append(clean)
        print(f"[{job_name}] {clean}")
        last_heartbeat = time.time()

    rc = proc.wait()
    reader.join(timeout=1.0)
    elapsed = time.time() - start
    status = "OK" if rc == 0 else "FAIL"
    print(f"[{job_name}] {status} ({elapsed:.1f}s)")

    metrics = metrics_from_output(lines)
    return {
        "job_name": job_name,
        "doc_title": doc_title,
        "script_name": script_name,
        "return_code": rc,
        "elapsed_seconds": round(elapsed, 3),
        "metrics": metrics,
        "error": "",
    }


def main():
    # Make relative paths stable even when script is launched from another cwd.
    script_dir = Path(__file__).resolve().parent
    os.chdir(script_dir)

    parser = argparse.ArgumentParser(
        description=(
            "Run each OCR using the largest PDF from its mapped Drive folders "
            "and store per-OCR + pagewise token metrics."
        )
    )
    parser.add_argument(
        "--drive-cache-root",
        default=str(DEFAULT_DRIVE_CACHE_ROOT),
        help="Local cache root where selected Drive PDFs are downloaded.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Folder to store OCR output xlsx files produced by each OCR script.",
    )
    parser.add_argument(
        "--metrics-log-path",
        default=str(DEFAULT_METRICS_LOG_PATH),
        help="JSONL file to store aggregated per-OCR metrics.",
    )
    parser.add_argument(
        "--metrics-excel-path",
        default=str(DEFAULT_METRICS_EXCEL_PATH),
        help="Excel file to store run and pagewise metrics.",
    )
    parser.add_argument(
        "--python",
        default=sys.executable,
        help="Python executable to use for running child OCR scripts.",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=None,
        help="Optional max pages passed to each OCR script.",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=None,
        help="Optional DPI passed to each OCR script.",
    )
    parser.add_argument(
        "--keep-checkpoints",
        action="store_true",
        help="Do not clear per-script checkpoint before each run.",
    )
    parser.add_argument(
        "--stop-on-fail",
        action="store_true",
        help="Stop immediately when one OCR script fails.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only show the selected largest Drive PDF for each OCR.",
    )
    parser.add_argument(
        "--progress-interval-seconds",
        type=int,
        default=20,
        help="Heartbeat interval while each OCR process is running.",
    )
    args = parser.parse_args()

    cache_root = Path(args.drive_cache_root)
    output_dir = Path(args.output_dir)
    metrics_log_path = Path(args.metrics_log_path)
    metrics_excel_path = Path(args.metrics_excel_path)
    cache_root.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    progress("Connecting to Google Drive using service account...")
    drive_service = get_drive_service()
    progress("Drive connection ready.")

    selected = []
    skipped = []
    total_jobs = len(JOBS)
    for idx, (job_name, doc_title, script_name) in enumerate(JOBS, start=1):
        progress(f"[{idx}/{total_jobs}] Selecting largest PDF for {job_name}")
        chosen, err = select_largest_pdf_from_drive(drive_service, doc_title, cache_root)
        if err is not None:
            progress(
                f"[{idx}/{total_jobs}] Skipped {job_name}: {err.get('reason')}"
            )
            skipped.append((job_name, doc_title, script_name, err))
            continue
        progress(f"[{idx}/{total_jobs}] Selection complete for {job_name}")
        selected.append((job_name, doc_title, script_name, chosen))

    print("Per-OCR largest PDF selection from Drive mappings:")
    for job_name, doc_title, _, chosen in selected:
        folder_info = ", ".join(chosen.get("folder_names") or []) or "N/A"
        print(
            f"- {job_name}: {chosen['local_path']} ({format_bytes(chosen['drive_file_size'])}) "
            f"[drive_file={chosen['drive_file_name']}; folder={folder_info}]"
        )
    if skipped:
        print("\nSkipped OCR selections:")
        for job_name, doc_title, _, err in skipped:
            print(
                f"- {job_name} ({doc_title}): {err.get('reason')} "
                f"[folders={','.join(err.get('folder_names') or [])}]"
            )

    if args.dry_run:
        return

    run_id = datetime.now(timezone.utc).strftime("per_ocr_max_%Y%m%dT%H%M%SZ")
    run_timestamp = datetime.now(timezone.utc).isoformat()
    env = os.environ.copy()
    env["OCR_RUN_METRICS_PATH"] = str(metrics_log_path)
    env["OCR_RUN_METRICS_EXCEL_PATH"] = str(metrics_excel_path)
    env["OCR_RUN_METRICS_EXCEL_SHEET"] = RUN_METRICS_SHEET

    summary_rows = []
    pagewise_rows = []
    failures = []

    selected_total = len(selected)
    for idx, (job_name, doc_title, script_name, chosen) in enumerate(selected, start=1):
        progress(f"[RUN {idx}/{selected_total}] Starting OCR for {job_name}")
        input_pdf = chosen["local_path"]
        if not args.keep_checkpoints:
            removed = clear_checkpoint_for_job(doc_title, input_pdf)
            if removed is not None:
                print(f"[{job_name}] Cleared checkpoint: {removed}")

        result = run_job(
            python_executable=args.python,
            job_name=job_name,
            doc_title=doc_title,
            script_name=script_name,
            input_pdf=input_pdf,
            output_dir=output_dir,
            env=env,
            max_pages=args.max_pages,
            dpi=args.dpi,
            progress_interval_seconds=args.progress_interval_seconds,
        )

        metrics = result.get("metrics") or {}
        input_tokens = safe_int(metrics.get("input_tokens"))
        output_tokens = safe_int(metrics.get("output_tokens"))
        pages = safe_int(metrics.get("pages"))
        input_tokens_per_page = safe_float(metrics.get("input_tokens_per_page"))
        output_tokens_per_page = safe_float(metrics.get("output_tokens_per_page"))
        status = "success" if result["return_code"] == 0 else "failed"

        if result["return_code"] != 0:
            failures.append(job_name)

        summary_rows.append(
            {
                "run_id": run_id,
                "run_timestamp_utc": run_timestamp,
                "job_name": job_name,
                "doc_title": doc_title,
                "script_name": script_name,
                "status": status,
                "return_code": result["return_code"],
                "elapsed_seconds": result["elapsed_seconds"],
                "drive_folder_names": ",".join(chosen.get("folder_names") or []),
                "drive_folder_ids": ",".join(chosen.get("folder_ids") or []),
                "drive_file_id": chosen.get("drive_file_id", ""),
                "drive_file_name": chosen.get("drive_file_name", ""),
                "pdf_path": str(input_pdf),
                "pdf_name": input_pdf.name,
                "pdf_size_bytes": safe_int(chosen.get("drive_file_size")),
                "model": metrics.get("model"),
                "run_status": metrics.get("run_status"),
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "pages": pages,
                "input_tokens_per_page": input_tokens_per_page,
                "output_tokens_per_page": output_tokens_per_page,
            }
        )

        if pages > 0:
            input_parts = split_tokens_across_pages(input_tokens, pages)
            output_parts = split_tokens_across_pages(output_tokens, pages)
            for idx in range(pages):
                pagewise_rows.append(
                    {
                        "run_id": run_id,
                        "run_timestamp_utc": run_timestamp,
                        "job_name": job_name,
                        "doc_title": doc_title,
                        "script_name": script_name,
                        "pdf_path": str(input_pdf),
                        "pdf_name": input_pdf.name,
                        "page_no": idx + 1,
                        "input_tokens": input_parts[idx],
                        "output_tokens": output_parts[idx],
                    }
                )

        if result["return_code"] != 0 and args.stop_on_fail:
            break

        progress(f"[RUN {idx}/{selected_total}] Finished OCR for {job_name}")

    for job_name, doc_title, script_name, err in skipped:
        summary_rows.append(
            {
                "run_id": run_id,
                "run_timestamp_utc": run_timestamp,
                "job_name": job_name,
                "doc_title": doc_title,
                "script_name": script_name,
                "status": f"skipped_{err.get('reason')}",
                "return_code": None,
                "elapsed_seconds": 0,
                "drive_folder_names": ",".join(err.get("folder_names") or []),
                "drive_folder_ids": ",".join(err.get("folder_ids") or []),
                "drive_file_id": "",
                "drive_file_name": "",
                "pdf_path": "",
                "pdf_name": "",
                "pdf_size_bytes": 0,
                "model": "",
                "run_status": "",
                "input_tokens": 0,
                "output_tokens": 0,
                "pages": 0,
                "input_tokens_per_page": 0,
                "output_tokens_per_page": 0,
            }
        )

    append_jsonl_rows(metrics_log_path, summary_rows)
    progress(f"Wrote summary rows to JSONL: {metrics_log_path}")
    append_rows_to_excel(metrics_excel_path, SUMMARY_SHEET, summary_rows)
    append_rows_to_excel(metrics_excel_path, PAGEWISE_METRICS_SHEET, pagewise_rows)
    progress(
        f"Wrote summary/pagewise sheets to Excel: {metrics_excel_path}"
    )

    print("\n=== Per-OCR Largest PDF Metrics Summary ===")
    print(f"Run ID: {run_id}")
    print(f"Selected OCR jobs: {len(selected)}")
    print(f"Skipped OCR jobs: {len(skipped)}")
    print(f"Summary rows written: {len(summary_rows)}")
    print(f"Pagewise rows written: {len(pagewise_rows)}")
    print(f"Metrics JSONL: {metrics_log_path}")
    print(f"Metrics Excel: {metrics_excel_path}")

    completed_rows = [r for r in summary_rows if r.get("status") == "success"]
    if completed_rows:
        best = max(completed_rows, key=lambda r: safe_int(r.get("input_tokens")))
        print(
            "Max input tokens OCR: "
            f"{best['job_name']} (input_tokens={best['input_tokens']}, pages={best['pages']})"
        )

    if failures:
        print(f"Failed OCR jobs: {len(failures)}")
        for name in failures:
            print(f"- {name}")
        raise SystemExit(1)

    print("Completed all selected OCR jobs.")


if __name__ == "__main__":
    main()
