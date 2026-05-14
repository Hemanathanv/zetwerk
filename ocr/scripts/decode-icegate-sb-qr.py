#!/usr/bin/env python3
"""
Decode the decimal digit payload from a CBIC Final LEO Shipping Bill QR (ICEGATE).

Decode chain (documented in Initial_Information.md):
  QR symbol -> library yields decimal digit string
  -> int (big integer)
  -> minimal big-endian bytes
  -> split on byte 0x1b (ESC) into segments

Leading segments are usually ASCII: format version, document type "SB", SB reference
chunk (combines with printed "SB22..." prefix on the PDF), port code (e.g. INMAA1),
SB number, SB date, IEC-related fields, FOB, drawback, challan/CIN, package counts, etc.
Cross-check each value against the printed Shipping Bill.

Trailing segment(s) are binary: typically includes a **2048-bit RSA signature** (256 bytes)
from CBIC; ICETRAK verifies this with the board public key. Some PDFs split additional
binary material across multiple trailing segments — treat lengths as format-dependent.

Usage:
  python scripts/decode-icegate-sb-qr.py "3766602117..."
  python scripts/decode-icegate-sb-qr.py --file payload.txt
  python scripts/decode-icegate-sb-qr.py --pdf "Input/Shipping Bill/foo.pdf"   # needs pymupdf, opencv, numpy
"""

from __future__ import annotations

import argparse
import json
import re
import sys

SEP = bytes([0x1B])

# Heuristic labels for format version "13" ASCII tail before first binary segment (may vary by notice).
_V13_HINTS = [
    "format_version",
    "document_type_sb",
    "sb_reference_body",  # printed SB number often SB22 + this body
    "port_code",  # e.g. INMAA1
    "sb_number_fragment",  # verify on form
    "sb_date",
    "iec_label_or_field",
    "iec_suffix_or_fragment",
    "fob_value",
    "drawback_or_duty_field",
    "packages_or_count",
    "challan_or_cin",
    "extra_numeric_1",
    "extra_numeric_2",
]


def digits_only(s: str) -> str:
    return "".join(c for c in s if c.isdigit())


def decode_from_decimal(decimal_str: str) -> dict:
    s = digits_only(decimal_str)
    if not s:
        raise ValueError("No decimal digits in input")
    n = int(s)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    parts = raw.split(SEP)
    segments: list[dict] = []
    first_binary = None
    for i, p in enumerate(parts):
        seg: dict = {"index": i, "lengthBytes": len(p)}
        try:
            text = p.decode("ascii")
            seg["encoding"] = "ascii"
            seg["value"] = text
            if i < len(_V13_HINTS) and (first_binary is None):
                seg["hint"] = _V13_HINTS[i]
        except UnicodeDecodeError:
            seg["encoding"] = "binary"
            seg["hex"] = p.hex()
            if first_binary is None:
                first_binary = i
        segments.append(seg)
    return {
        "decimalDigitCount": len(s),
        "payloadByteLength": len(raw),
        "segmentCount": len(parts),
        "firstBinarySegmentIndex": first_binary,
        "segments": segments,
    }


def try_read_pdf_qr(pdf_path: str) -> str:
    import fitz  # pymupdf
    import cv2
    import numpy as np

    doc = fitz.open(pdf_path)
    det = cv2.QRCodeDetector()
    for pi in range(len(doc)):
        page = doc[pi]
        for scale in (3, 4, 5):
            mat = fitz.Matrix(scale, scale)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
                pix.height, pix.width, pix.n
            )
            if pix.n == 4:
                img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
            elif pix.n == 1:
                img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
            data, _, _ = det.detectAndDecode(img)
            if data and data.isdigit():
                doc.close()
                return data
    doc.close()
    raise RuntimeError("No numeric QR payload found in PDF pages")


def main() -> None:
    ap = argparse.ArgumentParser(description="Decode ICEGATE Shipping Bill QR decimal payload")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("decimal", nargs="?", help="Decimal digit string from QR decoder")
    g.add_argument("--file", "-f", metavar="PATH", help="File containing digit string")
    g.add_argument("--pdf", metavar="PATH", help="PDF path; extract first numeric QR")
    ap.add_argument("--json", action="store_true", help="Print JSON only")
    args = ap.parse_args()

    if args.pdf:
        text = try_read_pdf_qr(args.pdf)
    elif args.file:
        text = open(args.file, encoding="utf-8", errors="ignore").read()
    else:
        text = args.decimal or ""

    m = re.search(r"\d{100,}", text)
    if m:
        text = m.group(0)

    result = decode_from_decimal(text)
    if args.json:
        print(json.dumps(result, indent=2))
        return

    print("Payload byte length:", result["payloadByteLength"])
    print("Segments:", result["segmentCount"])
    print("First binary segment index:", result["firstBinarySegmentIndex"])
    print()
    for seg in result["segments"]:
        idx = seg["index"]
        enc = seg["encoding"]
        if enc == "ascii":
            hint = f" ({seg['hint']})" if "hint" in seg else ""
            print(f"  [{idx:2}] ASCII ({seg['lengthBytes']} B){hint}: {seg['value']!r}")
        else:
            h = seg["hex"]
            print(
                f"  [{idx:2}] BINARY ({seg['lengthBytes']} B): {h[:64]}..."
                if len(h) > 64
                else f"  [{idx:2}] BINARY ({seg['lengthBytes']} B): {h}"
            )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(e, file=sys.stderr)
        sys.exit(1)
