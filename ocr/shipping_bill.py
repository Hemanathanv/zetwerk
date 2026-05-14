from pathlib import Path
import re

from structured_ocr import resolve_ocr_path, run_ocr

DOC_TITLE = "Shipping Bill"
PROMPT_TS = Path("src/prompts/shipping-bill-structured-prompt.ts")


def extract_full_prompt(ts_path: Path) -> str:
    ts_path = resolve_ocr_path(ts_path)
    text = ts_path.read_text(encoding="utf-8", errors="ignore")
    match = re.search(r"return `([\s\S]*?)`;", text)
    if not match:
        raise SystemExit("Unable to extract Shipping Bill prompt from TS file.")
    return match.group(1)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Shipping Bill OCR extraction")
    parser.add_argument(
        "--input",
        default="data/input",
        help="PDF file or folder containing PDF files.",
    )
    parser.add_argument(
        "--output",
        default="data/shipping_bill_ocr_output.xlsx",
        help="Output Excel file path.",
    )
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--max-pages", type=int, default=None)
    parser.add_argument(
        "--drive",
        action="store_true",
        help="Use mapped Google Drive folders for input PDFs.",
    )
    args = parser.parse_args()

    prompt = extract_full_prompt(PROMPT_TS)
    run_ocr(
        Path(args.input),
        Path(args.output),
        prompt,
        doc_title=DOC_TITLE,
        use_drive=args.drive,
        dpi=args.dpi,
        max_pages=args.max_pages,
    )
