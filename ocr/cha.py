import argparse
import base64
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from structured_ocr import (
    align_df_to_template_columns,
    build_page_usage_rows,
    emit_run_metrics,
    extract_usage_tokens,
    get_drive_pdf_entries,
)

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover
    load_dotenv = None

try:
    import fitz  # PyMuPDF
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "PyMuPDF is required. Install with: pip install pymupdf"
    ) from exc

try:
    from openai import OpenAI
except Exception as exc:  # pragma: no cover
    raise SystemExit("OpenAI Python SDK is required. Install with: pip install openai") from exc


BASE_DIR = Path(__file__).resolve().parent


def resolve_runtime_path(path_like):
    path = Path(path_like)
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


SCHEMA_PROMPT_MD = BASE_DIR / "CHA_Bill_OCR_Schema_and_Prompt.md"
SERVICE_ACCOUNT_PATH = BASE_DIR / "data" / "service_account.json"
INPUT_DRIVE_FOLDERS = [
    "1juO4zeNbZIk8xBzBjGnjCEuVoWRjggbi",
    "1xGxNgM7odiVsSEbhS-u43SzKmp__QepI",
]

DRIVE_SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
]
DOC_TITLE = "CHA"


def normalize_base_url(url):
    if not url:
        return url
    cleaned = url.strip().rstrip("/")
    for suffix in ("/chat/completions", "/v1/chat/completions", "/responses", "/v1/responses"):
        if cleaned.endswith(suffix):
            cleaned = cleaned[: -len(suffix)]
            break
    if cleaned.endswith("/v1"):
        return cleaned
    return cleaned + "/v1"


def load_env():
    if load_dotenv is not None:
        load_dotenv(BASE_DIR / ".env", override=False)
        load_dotenv(BASE_DIR / ".env.local", override=False)
        load_dotenv()

    # OpenAI-style
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENAI_KEY")
    model = (
        os.getenv("OPENAI_MODEL")
        or os.getenv("MODEL")
        or os.getenv("OPENAI_DEFAULT_MODEL")
    )
    base_url = os.getenv("OPENAI_BASE_URL")
    organization = os.getenv("OPENAI_ORG")
    project = os.getenv("OPENAI_PROJECT")

    # OpenRouter-style
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


def parse_prompts(md_text):
    def extract_block(title):
        pattern = rf"### {re.escape(title)}[\s\S]*?```[a-zA-Z]*\r?\n([\s\S]*?)```"
        match = re.search(pattern, md_text, re.IGNORECASE)
        if not match:
            raise SystemExit(f"Could not find {title} block in the prompt file.")
        return match.group(1).strip()

    system_prompt = extract_block("SYSTEM PROMPT")
    user_prompt = extract_block("USER PROMPT")
    return system_prompt, user_prompt


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


def extract_json(text):
    if not text:
        raise ValueError("Empty response from model")
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned.strip())
        cleaned = cleaned.strip("` \n")
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
    return json.loads(cleaned[start : end + 1])


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


def build_rows(records, source_files):
    rows = []
    for record, source in zip(records, source_files):
        flat = flatten_record(record)
        flat.pop("source", None)
        flat["source_file"] = source
        rows.append(flat)
    return rows


def with_source_first(df: pd.DataFrame) -> pd.DataFrame:
    if "source_file" not in df.columns:
        return df
    cols = ["source_file"] + [c for c in df.columns if c != "source_file"]
    return df[cols]


def clean_source_name(name):
    if not name:
        return ""
    text = str(name).strip().replace("\\", "/")
    if "/" in text:
        text = text.split("/")[-1]
    # Remove Drive collision suffix: "<name>__<drive_id>.pdf" -> "<name>.pdf"
    text = re.sub(r"__[-A-Za-z0-9_]{6,}(?=\.pdf$)", "", text, flags=re.IGNORECASE)
    return text


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
    return BASE_DIR / "data" / "checkpoints" / f"{slugify(doc_title)}_{digest}.jsonl"


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


def get_pdf_files(input_path):
    if input_path.is_file():
        return [(input_path, input_path.name)]
    if not input_path.exists():
        raise SystemExit(f"Input path not found: {input_path}")
    pdfs = sorted(input_path.glob("*.pdf"))
    if not pdfs:
        raise SystemExit(f"No PDF files found in {input_path}")
    return [(p, p.name) for p in pdfs]


def get_drive_service():
    if not SERVICE_ACCOUNT_PATH.exists():
        raise SystemExit(f"Service account file not found: {SERVICE_ACCOUNT_PATH}")
    creds = Credentials.from_service_account_file(
        str(SERVICE_ACCOUNT_PATH),
        scopes=DRIVE_SCOPES,
    )
    return build("drive", "v3", credentials=creds)


def list_pdfs_recursive(drive_service, root_folder_id):
    pdfs = []
    queue = [root_folder_id]
    while queue:
        folder_id = queue.pop(0)
        page_token = None
        while True:
            results = drive_service.files().list(
                q=f"'{folder_id}' in parents and trashed=false",
                fields="nextPageToken, files(id,name,mimeType)",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
                orderBy="folder,name_natural",
                pageToken=page_token,
            ).execute()
            for item in results.get("files", []):
                if item["mimeType"] == "application/vnd.google-apps.folder":
                    queue.append(item["id"])
                elif item["mimeType"] == "application/pdf":
                    pdfs.append(item)
            page_token = results.get("nextPageToken")
            if not page_token:
                break
    return pdfs


def download_drive_pdfs(folder_ids, download_dir):
    download_dir.mkdir(parents=True, exist_ok=True)
    drive_service = get_drive_service()
    all_files = []
    for folder_id in folder_ids:
        all_files.extend(list_pdfs_recursive(drive_service, folder_id))
    if not all_files:
        raise SystemExit("No PDF files found in the specified Drive folders.")

    local_entries = []
    for item in all_files:
        filename = item["name"]
        target = download_dir / filename
        # Avoid overwrite collisions by appending file id
        if target.exists():
            target = download_dir / f"{target.stem}__{item['id']}{target.suffix}"

        request = drive_service.files().get_media(fileId=item["id"])
        with target.open("wb") as fh:
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
        local_entries.append((target, filename))
    return local_entries


def main():
    parser = argparse.ArgumentParser(description="CHA Bill OCR extraction to Excel.")
    parser.add_argument(
        "--input",
        default="data/input",
        help="PDF file or folder containing PDF files.",
    )
    parser.add_argument(
        "--output",
        default="data/cha_ocr_output.xlsx",
        help="Output Excel file path.",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=300,
        help="Render DPI for PDF pages (higher = better OCR, slower).",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=None,
        help="Maximum pages to send per PDF (default: all).",
    )
    parser.add_argument(
        "--drive",
        action="store_true",
        default=True,
        help="Use Drive folders as input instead of local path.",
    )
    parser.add_argument(
        "--local",
        dest="drive",
        action="store_false",
        help="Use local --input path instead of Drive.",
    )
    args = parser.parse_args()

    if not SCHEMA_PROMPT_MD.exists():
        raise SystemExit(f"Prompt file not found: {SCHEMA_PROMPT_MD}")

    api_key, model, base_url, organization, project, is_openrouter = load_env()

    client_kwargs = {
        "api_key": api_key,
        "base_url": base_url,
        "organization": organization,
        "project": project,
    }
    if is_openrouter:
        env_title = str(
            os.getenv("OPENROUTER_X_TITLE")
            or os.getenv("OCR_RUN_TITLE")
            or ""
        ).strip()
        request_title = env_title or DOC_TITLE
        referer = str(
            os.getenv("OPENROUTER_HTTP_REFERER")
            or "https://example.com"
        ).strip() or "https://example.com"
        client_kwargs["default_headers"] = {
            "HTTP-Referer": referer,
            "X-Title": request_title,
        }
        print(f"OpenRouter request title: {request_title}")
    client = OpenAI(**client_kwargs)

    md_text = SCHEMA_PROMPT_MD.read_text(encoding="utf-8", errors="ignore")
    system_prompt, user_prompt = parse_prompts(md_text)

    input_path = resolve_runtime_path(Path(args.input))
    output_path = resolve_runtime_path(Path(args.output))
    output_path.parent.mkdir(parents=True, exist_ok=True)

    use_drive = args.drive
    if args.drive:
        pdf_files = get_drive_pdf_entries(
            doc_title=DOC_TITLE,
            cache_base=resolve_runtime_path(Path("data/cha_input")),
        )
    else:
        try:
            pdf_files = get_pdf_files(input_path)
        except SystemExit:
            # Fallback to Drive if local folder is empty or missing.
            pdf_files = get_drive_pdf_entries(
                doc_title=DOC_TITLE,
                cache_base=resolve_runtime_path(Path("data/cha_input")),
            )
            use_drive = True

    if not pdf_files:
        print(f"No input PDFs to process for {DOC_TITLE}.")
        return

    checkpoint_path = build_checkpoint_path(DOC_TITLE, input_path, use_drive=use_drive)
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

    total = len(pdf_files)
    interrupted = False
    fully_processed = True
    try:
        max_attempts = max(1, int(os.getenv("OCR_API_RETRY_ATTEMPTS", "3") or "3"))
    except Exception:
        max_attempts = 3
    try:
        retry_delay_seconds = max(
            0.0, float(os.getenv("OCR_API_RETRY_DELAY_SECONDS", "2") or "2")
        )
    except Exception:
        retry_delay_seconds = 2.0
    stop_reason = ""
    run_metrics = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "doc_title": DOC_TITLE,
        "model": model,
        "use_drive": bool(use_drive),
        "pdfs_in_input": total,
        "pdfs_attempted": 0,
        "pdfs_succeeded": 0,
        "pdfs_failed": 0,
        "pdfs_skipped_checkpoint": 0,
        "pdfs_skipped_no_pages": 0,
        "pages": 0,
        "input_tokens": 0,
        "output_tokens": 0,
    }
    page_usage_rows = []

    for idx, (pdf_path, source_name) in enumerate(pdf_files, start=1):
        pdf_key = str(pdf_path)
        if pdf_key in processed_pdf_paths:
            print(f"Skipping already checkpointed {idx}/{total}: {source_name}")
            run_metrics["pdfs_skipped_checkpoint"] += 1
            continue

        try:
            print(f"Processing {idx}/{total}: {source_name}")
            images = pdf_to_images(pdf_path, dpi=args.dpi, max_pages=args.max_pages)
            if not images:
                print(f"Skipping (no pages): {source_name}")
                run_metrics["pdfs_skipped_no_pages"] += 1
                processed_pdf_paths.add(pdf_key)
                continue
            run_metrics["pdfs_attempted"] += 1
            run_metrics["pages"] += len(images)

            content = [{"type": "text", "text": user_prompt}]
            for img in images:
                content.append(
                    {"type": "image_url", "image_url": {"url": img, "detail": "high"}}
                )

            response = None
            last_exc = None
            for attempt in range(1, max_attempts + 1):
                try:
                    response = client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system_prompt},
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
                    doc_title=DOC_TITLE,
                    model=model,
                    source_file=clean_source_name(source_name),
                    page_count=len(images),
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                )
            )

            raw_text = response.choices[0].message.content
            try:
                data = extract_json(raw_text)
            except Exception as exc:
                data = {
                    "document_type": "CHA_BILL",
                    "flags": [f"json_parse_error: {exc}"],
                    "raw_response": raw_text,
                }
            cleaned_source = clean_source_name(source_name)
            records.append(data)
            sources.append(cleaned_source)
            run_metrics["pdfs_succeeded"] += 1
            processed_pdf_paths.add(pdf_key)
            append_checkpoint_record(checkpoint_path, pdf_path, cleaned_source, data)
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
    elif run_metrics["pdfs_succeeded"] == 0:
        run_metrics["run_status"] = "no_records"
    emit_run_metrics(run_metrics, page_usage_rows=page_usage_rows)

    if not records:
        raise SystemExit("No records extracted.")

    if interrupted:
        print("Continuing with partial results and writing output file.")

    rows = build_rows(records, sources)
    df = with_source_first(pd.DataFrame(rows))
    df = align_df_to_template_columns(df, DOC_TITLE)
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name=DOC_TITLE, index=False)
    print(f"Wrote Excel: {output_path}")

    all_done = fully_processed and (len(processed_pdf_paths) >= total)
    if all_done:
        clear_checkpoint(checkpoint_path)
    else:
        print(f"Checkpoint saved at: {checkpoint_path}")


if __name__ == "__main__":
    main()
