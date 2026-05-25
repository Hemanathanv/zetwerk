import asyncio
import json
import mimetypes
import sys
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pdf2image import convert_from_bytes

from documents_ocr.Ocean_freight.ocr import build_prompt, parse_result
from documents_ocr.pipeline import run_ocr


def _page_images_from_input(input_path: Path) -> list[dict]:
    data = input_path.read_bytes()
    mime_type, _ = mimetypes.guess_type(str(input_path))
    mime_type = mime_type or "application/octet-stream"

    if mime_type == "application/pdf" or input_path.suffix.lower() == ".pdf":
        images = convert_from_bytes(data, dpi=200, fmt="png")
        pages: list[dict] = []
        for image in images:
            buf = BytesIO()
            image.save(buf, format="PNG")
            pages.append({"bytes": buf.getvalue(), "mime_type": "image/png"})
        return pages

    return [{"bytes": data, "mime_type": mime_type}]


def _prompt_for_input_path() -> Path:
    while True:
        try:
            raw = input("Enter path to PDF / PNG / JPG for Ocean Freight OCR: ").strip().strip('"').strip("'")
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
    input_path = _prompt_for_input_path()

    page_images = _page_images_from_input(input_path)
    print(f"[run] OCR on {len(page_images)} page(s) from {input_path}")

    prompt = build_prompt()
    raw_result = await asyncio.to_thread(run_ocr, page_images=page_images, prompt=prompt)

    print("\n===== RAW MODEL OUTPUT =====")
    print(json.dumps(raw_result, indent=2, ensure_ascii=False, default=str))

    raw_payload = {k: v for k, v in raw_result.items() if not str(k).startswith("_")}
    parsed = parse_result(raw_payload)

    print("\n===== PARSED STRUCTURED OUTPUT =====")
    print(json.dumps(parsed.model_dump(mode="json"), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
