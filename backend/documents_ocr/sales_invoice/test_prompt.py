import argparse
import asyncio
import json
import mimetypes
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pdf2image import convert_from_bytes

from documents_ocr.pipeline import run_openrouter_ocr
from documents_ocr.sales_invoice.ocr import SalesInvoiceStructuredResult, parse_result
from documents_ocr.sales_invoice.prompt import build_sales_invoice_prompt


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


def _output_dir(base: Path, label: str | None) -> Path:
    run_id = _utc_stamp()
    suffix = f"_{label}" if label else ""
    path = base / f"{run_id}{suffix}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _page_images_from_input(input_path: Path) -> list[dict[str, bytes | str]]:
    data = input_path.read_bytes()
    mime_type, _ = mimetypes.guess_type(str(input_path))
    mime_type = mime_type or "application/octet-stream"

    if mime_type == "application/pdf" or input_path.suffix.lower() == ".pdf":
        images = convert_from_bytes(data, dpi=200, fmt="png")
        payload: list[dict[str, bytes | str]] = []
        for image in images:
            from io import BytesIO

            buf = BytesIO()
            image.save(buf, format="PNG")
            payload.append({"bytes": buf.getvalue(), "mime_type": "image/png"})
        return payload

    return [{"bytes": data, "mime_type": mime_type}]


def _prompt_for_input_path() -> Path:
    while True:
        try:
            raw = input("Enter path to PDF / PNG / JPG for Sales Invoice OCR: ").strip().strip('"').strip("'")
        except (EOFError, KeyboardInterrupt):
            print("\n[abort]", file=sys.stderr)
            sys.exit(1)
        if not raw:
            print("[error] Path cannot be empty. Try again.", file=sys.stderr)
            continue
        path = Path(raw).expanduser()
        if not path.exists():
            print(f"[error] File not found: {path}. Try again.", file=sys.stderr)
            continue
        return path


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate prompt artifacts and optionally run OpenRouter OCR for Sales Invoice."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=None,
        help="Optional file path (.pdf/.png/.jpg) to run through OpenRouter. If omitted, you will be prompted.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("backend/documents_ocr/sales_invoice/runs"),
        help="Base output directory for timestamped run artifacts.",
    )
    parser.add_argument(
        "--label",
        type=str,
        default=None,
        help="Optional suffix to append to run folder name (example: v2_prompt).",
    )
    args = parser.parse_args()

    output_dir = _output_dir(args.out, args.label)

    prompt = build_sales_invoice_prompt(SalesInvoiceStructuredResult)
    schema = SalesInvoiceStructuredResult.model_json_schema()
    (output_dir / "prompt.txt").write_text(prompt, encoding="utf-8")
    _write_json(output_dir / "schema.json", schema)

    print(f"[saved] {output_dir / 'prompt.txt'}")
    print(f"[saved] {output_dir / 'schema.json'}")

    if not args.input:
        args.input = _prompt_for_input_path()

    if not args.input.exists():
        raise FileNotFoundError(f"Input file not found: {args.input}")

    page_images = _page_images_from_input(args.input)
    print(f"[run] Calling OpenRouter with {len(page_images)} page(s) from {args.input}")

    raw_result = await asyncio.to_thread(
        run_openrouter_ocr,
        page_images=page_images,
        prompt=prompt,
    )
    print("\n===== RAW MODEL OUTPUT =====")
    print(json.dumps(raw_result, indent=2, ensure_ascii=False, default=str))
    _write_json(output_dir / "model_output.json", raw_result)
    print(f"[saved] {output_dir / 'model_output.json'}")

    raw_payload = {k: v for k, v in raw_result.items() if not str(k).startswith("_")}
    parsed = parse_result(raw_payload)
    print("\n===== PARSED STRUCTURED OUTPUT =====")
    print(json.dumps(parsed.model_dump(mode="json"), indent=2, ensure_ascii=False))
    _write_json(output_dir / "parsed_output.json", parsed.model_dump(mode="json"))
    print(f"[saved] {output_dir / 'parsed_output.json'}")

    usage_payload = {"model": raw_result.get("_model"), "usage": raw_result.get("_usage")}
    _write_json(output_dir / "usage.json", usage_payload)
    print(f"[saved] {output_dir / 'usage.json'}")

    print(f"[done] Run artifacts are in: {output_dir}")


if __name__ == "__main__":
    asyncio.run(main())
