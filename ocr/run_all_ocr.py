import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


JOBS = [
    ("Entry Summary", "entry_summary.py"),
    ("Entry Summary Tariff Lines", "entry_summary_tariff_lines.py"),
    ("Steel Supplier Declaration", "ssd.py"),
    ("Shipping Bill", "shipping_bill.py"),
    ("Delivery Deduction Sheet", "dds.py"),
    ("Ocean Freight", "ocean_freight.py"),
    ("Packing List", "packing_list.py"),
    ("Sales Invoices", "sales_invoice.py"),
    ("Bill of Lading", "bill_of_lading.py"),
    ("Freight Forwarder Bill", "freight_forward.py"),
]
OCR_METRICS_PREFIX = "OCR_METRICS_JSON: "
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


def build_command(script_name, use_drive, input_path):
    cmd = [sys.executable, script_name]
    if use_drive:
        cmd.append("--drive")
    elif input_path:
        cmd.extend(["--input", str(input_path)])
    return cmd


def run_job(name, script_name, use_drive, input_path):
    script_path = resolve_runtime_path(Path(script_name))
    if not script_path.exists():
        return name, 1, f"Script not found: {script_name}"

    cmd = build_command(str(script_path), use_drive, input_path)
    start = time.time()
    print(f"[{name}] START -> {' '.join(cmd)}")

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    output_lines = []
    assert proc.stdout is not None
    for line in proc.stdout:
        clean = line.rstrip("\n")
        output_lines.append(clean)
        print(f"[{name}] {clean}")

    rc = proc.wait()
    elapsed = time.time() - start
    status = "OK" if rc == 0 else "FAIL"
    print(f"[{name}] {status} ({elapsed:.1f}s)")
    metrics = None
    for line in reversed(output_lines):
        if not line.startswith(OCR_METRICS_PREFIX):
            continue
        payload = line[len(OCR_METRICS_PREFIX) :].strip()
        try:
            metrics = json.loads(payload)
        except Exception:
            metrics = None
        break
    return name, rc, "\n".join(output_lines), metrics


def main():
    parser = argparse.ArgumentParser(description="Run all OCR scripts in parallel.")
    parser.add_argument(
        "--max-workers",
        type=int,
        default=3,
        help="Parallel workers (recommended 2-4 to avoid API rate limits).",
    )
    parser.add_argument(
        "--drive",
        dest="drive",
        action="store_true",
        default=True,
        help="Use Google Drive mapped inputs for all OCR scripts.",
    )
    parser.add_argument(
        "--local",
        dest="drive",
        action="store_false",
        help="Use local --input path instead of Drive.",
    )
    parser.add_argument(
        "--input",
        default="data/input",
        help="Local input path used when --drive is not passed.",
    )
    args = parser.parse_args()

    input_path = resolve_runtime_path(Path(args.input))

    failed = []
    job_metrics = {}
    with ThreadPoolExecutor(max_workers=max(1, args.max_workers)) as pool:
        futures = [
            pool.submit(run_job, name, script, args.drive, input_path)
            for name, script in JOBS
        ]
        for future in as_completed(futures):
            name, rc, _, metrics = future.result()
            if rc != 0:
                failed.append(name)
            if isinstance(metrics, dict):
                job_metrics[name] = metrics

    print("\n=== OCR Run Summary ===")
    if job_metrics:
        print("\n=== OCR Usage Summary ===")
        total_input_tokens = 0
        total_output_tokens = 0
        total_pages = 0
        total_pdfs = 0
        for name, _ in JOBS:
            metrics = job_metrics.get(name)
            if not metrics:
                continue
            input_tokens = int(metrics.get("input_tokens", 0) or 0)
            output_tokens = int(metrics.get("output_tokens", 0) or 0)
            pages = int(metrics.get("pages", 0) or 0)
            input_tokens_per_page = float(metrics.get("input_tokens_per_page", 0) or 0)
            output_tokens_per_page = float(metrics.get("output_tokens_per_page", 0) or 0)
            pdfs = int(metrics.get("pdfs_succeeded", 0) or 0)

            total_input_tokens += input_tokens
            total_output_tokens += output_tokens
            total_pages += pages
            total_pdfs += pdfs
            print(
                f"- {name}: input_tokens={input_tokens}, output_tokens={output_tokens}, "
                f"pages={pages}, input_tokens_per_page={input_tokens_per_page}, "
                f"output_tokens_per_page={output_tokens_per_page}, no_of_pdfs={pdfs}"
            )
        total_input_tokens_per_page = (
            (total_input_tokens / total_pages) if total_pages > 0 else 0
        )
        total_output_tokens_per_page = (
            (total_output_tokens / total_pages) if total_pages > 0 else 0
        )
        print(
            "TOTAL: "
            f"input_tokens={total_input_tokens}, "
            f"output_tokens={total_output_tokens}, "
            f"pages={total_pages}, "
            f"input_tokens_per_page={total_input_tokens_per_page}, "
            f"output_tokens_per_page={total_output_tokens_per_page}, "
            f"no_of_pdfs={total_pdfs}"
        )

    if failed:
        print(f"Failed: {len(failed)}")
        for name in failed:
            print(f"- {name}")
        raise SystemExit(1)

    print(f"All done. Completed {len(JOBS)} OCR jobs successfully.")


if __name__ == "__main__":
    main()
