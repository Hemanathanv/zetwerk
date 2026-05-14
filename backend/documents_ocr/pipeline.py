import asyncio
import base64
import json
from dataclasses import dataclass
from typing import Any, TypedDict
from urllib import error, request

from pydantic import ValidationError

from helpers.config import settings
from objectstore import download_bytes

from documents_ocr.sales_invoice.ocr import (
    build_prompt as build_sales_invoice_prompt,
    matches_sales_invoice,
    parse_result as parse_sales_invoice_result,
    persist_extraction as persist_sales_invoice_extraction,
)


@dataclass(frozen=True)
class OcrProcessor:
    matcher: Any
    build_prompt: Any
    parse_result: Any
    persist_extraction: Any


PROCESSORS: tuple[OcrProcessor, ...] = (
    OcrProcessor(
        matcher=matches_sales_invoice,
        build_prompt=build_sales_invoice_prompt,
        parse_result=parse_sales_invoice_result,
        persist_extraction=persist_sales_invoice_extraction,
    ),
)


class PageImage(TypedDict):
    bytes: bytes
    mime_type: str


def _normalize_base_url(url: str | None) -> str:
    cleaned = (url or "https://openrouter.ai/api/v1/chat/completions").strip().rstrip("/")
    for suffix in ("/chat/completions", "/v1/chat/completions", "/responses", "/v1/responses"):
        if cleaned.endswith(suffix):
            cleaned = cleaned[: -len(suffix)]
            break
    if cleaned.endswith("/v1"):
        return cleaned
    return cleaned + "/v1"


def _load_openrouter_config() -> tuple[str, str, str]:
    api_key = (settings.OPENROUTER_API_KEY or "").strip()
    model = (settings.OPENROUTER_MODEL or "").strip()
    base_url = _normalize_base_url(settings.OPENROUTER_API_URL)

    if not api_key:
        raise RuntimeError("Missing OPENROUTER_API_KEY for OCR")
    if not model:
        raise RuntimeError("Missing OPENROUTER_MODEL for OCR")

    return api_key, model, base_url


def _extract_json(text: str) -> dict[str, Any]:
    cleaned = (text or "").strip()
    if not cleaned:
        raise ValueError("Empty response from OCR model")

    for candidate in (cleaned, cleaned.replace("```json", "").replace("```", "").strip()):
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

    start = cleaned.find("{")
    if start == -1:
        raise ValueError("No JSON object found in OCR response")

    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(cleaned)):
        ch = cleaned[index]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                candidate = cleaned[start : index + 1]
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed

    raise ValueError("Could not parse JSON object from OCR response")


def _image_content_item(image_bytes: bytes, mime_type: str = "image/png") -> dict[str, Any]:
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    return {
        "type": "image_url",
        "image_url": {
            "url": f"data:{mime_type};base64,{encoded}",
            "detail": "high",
        },
    }


def _select_processor(*, bucket: str, module: str, document: Any) -> OcrProcessor | None:
    for processor in PROCESSORS:
        if processor.matcher(bucket=bucket, module=module, document=document):
            return processor
    return None


def run_openrouter_ocr(*, page_images: list[PageImage], prompt: str) -> dict[str, Any]:
    api_key, model, base_url = _load_openrouter_config()
    payload = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Extract the full document from all provided pages."},
                    *[
                        _image_content_item(image["bytes"], image["mime_type"])
                        for image in page_images
                    ],
                ],
            },
        ],
    }

    req = request.Request(
        url=f"{base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=180) as response:
            body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"OCR provider error {exc.code}: {detail or exc.reason}") from exc
    except Exception as exc:
        raise RuntimeError(f"Failed to call OCR provider: {exc}") from exc

    response_payload = json.loads(body)
    choices = response_payload.get("choices") or []
    if not choices:
        raise RuntimeError("OCR provider returned no choices")

    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        text = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    else:
        text = str(content or "")

    parsed = _extract_json(text)
    parsed["_usage"] = response_payload.get("usage") or {}
    parsed["_model"] = response_payload.get("model") or model
    return parsed


async def load_page_images_for_document(*, prisma, document_id: str) -> list[PageImage]:
    pages = await prisma.documentpage.find_many(
        where={"documentId": document_id, "isExtractionSource": True},
        order={"pageNo": "asc"},
    )

    if not pages:
        document = await prisma.document.find_unique(where={"id": document_id})
        if not document:
            return []
        return [
            {
                "bytes": await asyncio.to_thread(download_bytes, document.bucket, document.objectKey),
                "mime_type": str(document.contentType or "application/octet-stream"),
            }
        ]

    page_images: list[PageImage] = []
    for page in pages:
        page_images.append(
            {
                "bytes": await asyncio.to_thread(download_bytes, page.bucket, page.objectKey),
                "mime_type": "image/png",
            }
        )
    return page_images


async def run_post_upload_ocr(
    *,
    prisma,
    document,
    bucket: str,
    module: str,
    page_images: list[bytes] | None = None,
) -> dict[str, Any]:
    print(
        f"[pipeline][start] documentId={document.id} bucket={bucket} module={module}",
        flush=True,
    )
    processor = _select_processor(bucket=bucket, module=module, document=document)
    if processor is None:
        print(
            f"[pipeline][skip] documentId={document.id} reason=unsupported_document_type",
            flush=True,
        )
        return {"status": "skipped", "reason": "unsupported_document_type"}

    if page_images is not None:
        images: list[PageImage] = [{"bytes": image_bytes, "mime_type": "image/png"} for image_bytes in page_images]
    else:
        images = await load_page_images_for_document(prisma=prisma, document_id=document.id)
    if not images:
        print(f"[pipeline][skip] documentId={document.id} reason=no_pages", flush=True)
        return {"status": "skipped", "reason": "no_pages"}
    print(f"[pipeline][pages] documentId={document.id} count={len(images)}", flush=True)

    await prisma.document.update(
        where={"id": document.id},
        data={"status": "PROCESSING"},
    )
    print(f"[pipeline][status] documentId={document.id} status=PROCESSING", flush=True)

    try:
        # OpenRouter call is blocking (urllib); run it in a thread so API loop stays responsive.
        raw_result = await asyncio.to_thread(
            run_openrouter_ocr,
            page_images=images,
            prompt=processor.build_prompt(),
        )
        raw_payload = {k: v for k, v in raw_result.items() if not k.startswith("_")}
        structured = processor.parse_result(raw_payload)
    except ValidationError as exc:
        await prisma.document.update(
            where={"id": document.id},
            data={"status": "UPLOADED"},
        )
        print(f"[pipeline][failed] documentId={document.id} reason=validation_error", flush=True)
        return {"status": "failed", "reason": f"validation_error: {exc}"}
    except Exception as exc:
        await prisma.document.update(
            where={"id": document.id},
            data={"status": "UPLOADED"},
        )
        print(f"[pipeline][failed] documentId={document.id} reason={exc}", flush=True)
        return {"status": "failed", "reason": str(exc)}

    extraction = await processor.persist_extraction(
        prisma=prisma,
        document_id=document.id,
        result=structured,
        raw_data=raw_payload,
    )

    await prisma.document.update(
        where={"id": document.id},
        data={"status": "EXTRACTED"},
    )
    print(f"[pipeline][status] documentId={document.id} status=EXTRACTED", flush=True)

    print(
        f"[pipeline][done] documentId={document.id} extractionId={extraction.id}",
        flush=True,
    )
    return {
        "status": "extracted",
        "extractionId": extraction.id,
        "model": raw_result.get("_model"),
        "usage": raw_result.get("_usage"),
    }


__all__ = [
    "ValidationError",
    "load_page_images_for_document",
    "run_openrouter_ocr",
    "run_post_upload_ocr",
]
