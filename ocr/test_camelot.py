"""
test_camelot.py
───────────────
Interactive / CLI test for Camelot-based PDF extraction.

Usage (CLI):
    python test_camelot.py --pdf path/to/document.pdf --type "Bill of Lading"
    python test_camelot.py --pdf path/to/document.pdf --type "Entry Summary" --output out.xlsx
    python test_camelot.py --pdf /folder/with/pdfs --type "Ocean Freight" --batch

Usage (interactive — no arguments):
    python test_camelot.py
    → prompts for PDF path and document type

Supported document types (15):
    Bill of Lading
    Entry Summary
    Entry Summary Tariff Lines
    Steel Supplier Declaration
    Delivery Deduction Sheet
    Ocean Freight
    Packing List
    Sales Invoices
    Freight Forwarder Bill
    CHA
    Shipping Bill
    US Cargo Release Order
    US Customs Release Order
    US Delivery Order
    US Packing List
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from camelot_structure import (
    DOC_TITLES,
    run_camelot_ocr,
    run_camelot_ocr_batch,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _choose_doc_type_interactive() -> str:
    print("\nSupported document types:")
    for idx, title in enumerate(DOC_TITLES, start=1):
        print(f"  {idx:>2}. {title}")
    print()
    while True:
        raw = input("Enter document type (name or number): ").strip()
        if not raw:
            continue
        if raw.isdigit():
            n = int(raw)
            if 1 <= n <= len(DOC_TITLES):
                return DOC_TITLES[n - 1]
            print(f"  Number must be between 1 and {len(DOC_TITLES)}.")
        else:
            # Fuzzy match
            norm = raw.lower()
            matches = [t for t in DOC_TITLES if norm in t.lower()]
            if len(matches) == 1:
                return matches[0]
            if len(matches) > 1:
                print(f"  Ambiguous — matches: {', '.join(matches)}")
            else:
                print(f"  No match found for {raw!r}. Try again.")


def _resolve_doc_type(raw: str) -> str:
    """Exact or case-insensitive match against the 15 doc types."""
    for title in DOC_TITLES:
        if raw.strip().lower() == title.lower():
            return title
    raise SystemExit(
        f"Unknown document type: {raw!r}\n"
        f"Valid types:\n" + "\n".join(f"  {t}" for t in DOC_TITLES)
    )


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Camelot PDF extractor — same fields as Gemini OCR, no API needed.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--pdf",
        metavar="PATH",
        help="PDF file path, or folder path when --batch is used.",
    )
    parser.add_argument(
        "--type",
        metavar="DOC_TYPE",
        help='Document type, e.g. "Bill of Lading". Case-insensitive.',
    )
    parser.add_argument(
        "--output",
        metavar="XLSX_PATH",
        default=None,
        help="Output Excel file path (optional; auto-named when omitted).",
    )
    parser.add_argument(
        "--batch",
        action="store_true",
        default=False,
        help=(
            "Treat --pdf as a folder and process all PDFs inside it, "
            "writing a single combined Excel."
        ),
    )
    parser.add_argument(
        "--list-types",
        action="store_true",
        default=False,
        help="Print all supported document types and exit.",
    )

    args = parser.parse_args()

    # ── --list-types ─────────────────────────────────────────────────────────
    if args.list_types:
        print("Supported document types:")
        for t in DOC_TITLES:
            print(f"  {t}")
        sys.exit(0)

    # ── Interactive mode (no --pdf / --type given) ───────────────────────────
    interactive = not args.pdf and not args.type
    if interactive:
        print("=" * 60)
        print("  Camelot OCR — interactive mode")
        print("=" * 60)

        pdf_raw = input("\nPDF file path (or folder for batch mode): ").strip().strip('"').strip("'")
        if not pdf_raw:
            sys.exit("No path provided.")
        pdf_path = Path(pdf_raw)

        doc_type = _choose_doc_type_interactive()

        out_raw = input("\nOutput Excel path (leave blank to auto-name): ").strip().strip('"').strip("'")
        output_path = Path(out_raw) if out_raw else None

        batch = pdf_path.is_dir()
        if batch:
            print(f"\nDetected folder — running batch mode for all PDFs in: {pdf_path}")
    else:
        if not args.pdf:
            parser.error("--pdf is required unless running in interactive mode.")
        if not args.type:
            parser.error("--type is required unless running in interactive mode.")
        pdf_path = Path(args.pdf)
        doc_type = _resolve_doc_type(args.type)
        output_path = Path(args.output) if args.output else None
        batch = args.batch

    # ── Validation ───────────────────────────────────────────────────────────
    if not pdf_path.exists():
        sys.exit(f"Path not found: {pdf_path}")
    if batch and not pdf_path.is_dir():
        sys.exit(f"--batch requires a folder, got: {pdf_path}")
    if not batch and pdf_path.is_dir():
        print(f"[info] {pdf_path} is a folder — switching to batch mode automatically.")
        batch = True

    # ── Run extraction ───────────────────────────────────────────────────────
    print(f"\nDocument type : {doc_type}")
    print(f"Input         : {pdf_path}")
    if output_path:
        print(f"Output        : {output_path}")
    print()

    try:
        if batch:
            out = run_camelot_ocr_batch(pdf_path, doc_type, output_path)
        else:
            out = run_camelot_ocr(pdf_path, doc_type, output_path)
    except Exception as exc:
        sys.exit(f"Extraction failed: {exc}")

    print(f"\nDone! Excel written to:\n  {out.resolve()}")


if __name__ == "__main__":
    main()
