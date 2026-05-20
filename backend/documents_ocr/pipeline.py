import asyncio
import base64
import ast
import http.client
import json
import re
import time
from dataclasses import dataclass
from typing import Any, TypedDict
from urllib import error, request

from pydantic import ValidationError

from helpers.config import settings
from objectstore import download_bytes

from documents_ocr.Bill_of_lading.ocr import (
    build_prompt as build_bill_of_lading_prompt,
    matches_billoflading,
    parse_result as parse_bill_of_lading_result,
    persist_extraction as persist_bill_of_lading_extraction,
)
from documents_ocr.CHA.ocr import (
    build_prompt as build_cha_prompt,
    matches_cha,
    parse_result as parse_cha_result,
    persist_extraction as persist_cha_extraction,
)
from documents_ocr.Customer_broker_bill.ocr import (
    build_prompt as build_customer_broker_bill_prompt,
    matches_customerbrokerbill,
    parse_result as parse_customer_broker_bill_result,
    persist_extraction as persist_customer_broker_bill_extraction,
)
from documents_ocr.Entry_summary.ocr import (
    build_prompt as build_entry_summary_prompt,
    matches_entrysummary,
    parse_result as parse_entry_summary_result,
    persist_extraction as persist_entry_summary_extraction,
)
from documents_ocr.Entry_summary_tarifflines.ocr import (
    build_prompt as build_entry_summary_tarifflines_prompt,
    matches_entrysummarytarifflines,
    parse_result as parse_entry_summary_tarifflines_result,
    persist_extraction as persist_entry_summary_tarifflines_extraction,
)
from documents_ocr.Freight_forward.ocr import (
    build_prompt as build_freight_forward_prompt,
    matches_freightforward,
    parse_result as parse_freight_forward_result,
    persist_extraction as persist_freight_forward_extraction,
)
from documents_ocr.GRN_inbound.ocr import (
    build_prompt as build_grn_inbound_prompt,
    matches_grninbound,
    parse_result as parse_grn_inbound_result,
    persist_extraction as persist_grn_inbound_extraction,
)
from documents_ocr.Ocean_freight.ocr import (
    build_prompt as build_ocean_freight_prompt,
    matches_oceanfreight,
    parse_result as parse_ocean_freight_result,
    persist_extraction as persist_ocean_freight_extraction,
)
from documents_ocr.Packing_list.ocr import (
    build_prompt as build_packing_list_prompt,
    matches_packinglist,
    parse_result as parse_packing_list_result,
    persist_extraction as persist_packing_list_extraction,
)
from documents_ocr.Port_to_WH.ocr import (
    build_prompt as build_port_to_wh_prompt,
    matches_porttowh,
    parse_result as parse_port_to_wh_result,
    persist_extraction as persist_port_to_wh_extraction,
)
from documents_ocr.Shipping_bill.ocr import (
    build_prompt as build_shipping_bill_prompt,
    matches_shippingbill,
    parse_result as parse_shipping_bill_result,
    persist_extraction as persist_shipping_bill_extraction,
)
from documents_ocr.US_cargo_release_order.ocr import (
    build_prompt as build_us_cargo_release_prompt,
    matches_uscargoreleaseorder,
    parse_result as parse_us_cargo_release_result,
    persist_extraction as persist_us_cargo_release_extraction,
)
from documents_ocr.US_customs_release_order.ocr import (
    build_prompt as build_us_customs_release_prompt,
    matches_uscustomsreleaseorder,
    parse_result as parse_us_customs_release_result,
    persist_extraction as persist_us_customs_release_extraction,
)
from documents_ocr.US_delivery_order.ocr import (
    build_prompt as build_us_delivery_order_prompt,
    matches_usdeliveryorder,
    parse_result as parse_us_delivery_order_result,
    persist_extraction as persist_us_delivery_order_extraction,
)
from documents_ocr.US_packing_list.ocr import (
    build_prompt as build_us_packing_list_prompt,
    matches_uspackinglist,
    parse_result as parse_us_packing_list_result,
    persist_extraction as persist_us_packing_list_extraction,
)
from documents_ocr.US_sales_invoice.ocr import (
    build_prompt as build_us_sales_invoice_prompt,
    matches_ussalesinvoice,
    parse_result as parse_us_sales_invoice_result,
    persist_extraction as persist_us_sales_invoice_extraction,
)
from documents_ocr.WH_to_customer.ocr import (
    build_prompt as build_wh_to_customer_prompt,
    matches_whtocustomer,
    parse_result as parse_wh_to_customer_result,
    persist_extraction as persist_wh_to_customer_extraction,
)
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
        matcher=matches_billoflading,
        build_prompt=build_bill_of_lading_prompt,
        parse_result=parse_bill_of_lading_result,
        persist_extraction=persist_bill_of_lading_extraction,
    ),
    OcrProcessor(
        matcher=matches_cha,
        build_prompt=build_cha_prompt,
        parse_result=parse_cha_result,
        persist_extraction=persist_cha_extraction,
    ),
    OcrProcessor(
        matcher=matches_customerbrokerbill,
        build_prompt=build_customer_broker_bill_prompt,
        parse_result=parse_customer_broker_bill_result,
        persist_extraction=persist_customer_broker_bill_extraction,
    ),
    OcrProcessor(
        matcher=matches_entrysummary,
        build_prompt=build_entry_summary_prompt,
        parse_result=parse_entry_summary_result,
        persist_extraction=persist_entry_summary_extraction,
    ),
    OcrProcessor(
        matcher=matches_entrysummarytarifflines,
        build_prompt=build_entry_summary_tarifflines_prompt,
        parse_result=parse_entry_summary_tarifflines_result,
        persist_extraction=persist_entry_summary_tarifflines_extraction,
    ),
    OcrProcessor(
        matcher=matches_freightforward,
        build_prompt=build_freight_forward_prompt,
        parse_result=parse_freight_forward_result,
        persist_extraction=persist_freight_forward_extraction,
    ),
    OcrProcessor(
        matcher=matches_grninbound,
        build_prompt=build_grn_inbound_prompt,
        parse_result=parse_grn_inbound_result,
        persist_extraction=persist_grn_inbound_extraction,
    ),
    OcrProcessor(
        matcher=matches_oceanfreight,
        build_prompt=build_ocean_freight_prompt,
        parse_result=parse_ocean_freight_result,
        persist_extraction=persist_ocean_freight_extraction,
    ),
    OcrProcessor(
        matcher=matches_packinglist,
        build_prompt=build_packing_list_prompt,
        parse_result=parse_packing_list_result,
        persist_extraction=persist_packing_list_extraction,
    ),
    OcrProcessor(
        matcher=matches_porttowh,
        build_prompt=build_port_to_wh_prompt,
        parse_result=parse_port_to_wh_result,
        persist_extraction=persist_port_to_wh_extraction,
    ),
    OcrProcessor(
        matcher=matches_sales_invoice,
        build_prompt=build_sales_invoice_prompt,
        parse_result=parse_sales_invoice_result,
        persist_extraction=persist_sales_invoice_extraction,
    ),
    OcrProcessor(
        matcher=matches_shippingbill,
        build_prompt=build_shipping_bill_prompt,
        parse_result=parse_shipping_bill_result,
        persist_extraction=persist_shipping_bill_extraction,
    ),
    OcrProcessor(
        matcher=matches_uscargoreleaseorder,
        build_prompt=build_us_cargo_release_prompt,
        parse_result=parse_us_cargo_release_result,
        persist_extraction=persist_us_cargo_release_extraction,
    ),
    OcrProcessor(
        matcher=matches_uscustomsreleaseorder,
        build_prompt=build_us_customs_release_prompt,
        parse_result=parse_us_customs_release_result,
        persist_extraction=persist_us_customs_release_extraction,
    ),
    OcrProcessor(
        matcher=matches_usdeliveryorder,
        build_prompt=build_us_delivery_order_prompt,
        parse_result=parse_us_delivery_order_result,
        persist_extraction=persist_us_delivery_order_extraction,
    ),
    OcrProcessor(
        matcher=matches_uspackinglist,
        build_prompt=build_us_packing_list_prompt,
        parse_result=parse_us_packing_list_result,
        persist_extraction=persist_us_packing_list_extraction,
    ),
    OcrProcessor(
        matcher=matches_ussalesinvoice,
        build_prompt=build_us_sales_invoice_prompt,
        parse_result=parse_us_sales_invoice_result,
        persist_extraction=persist_us_sales_invoice_extraction,
    ),
    OcrProcessor(
        matcher=matches_whtocustomer,
        build_prompt=build_wh_to_customer_prompt,
        parse_result=parse_wh_to_customer_result,
        persist_extraction=persist_wh_to_customer_extraction,
    ),
)


class PageImage(TypedDict):
    bytes: bytes
    mime_type: str


class OcrImageChunk(TypedDict):
    images: list[PageImage]
    page_numbers: list[int]
    includes_first_page: bool


MAX_REQUEST_ENCODED_BYTES = 27 * 1024 * 1024
MAX_HEADER_CONTEXT_FIELDS = 120


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

    candidates: list[str] = [cleaned]
    # Common markdown wrappers
    candidates.append(cleaned.replace("```json", "").replace("```JSON", "").replace("```", "").strip())

    # Fenced JSON blocks (case-insensitive)
    for block in re.findall(r"```(?:json)?\s*(.*?)\s*```", cleaned, flags=re.IGNORECASE | re.DOTALL):
        block_clean = block.strip()
        if block_clean:
            candidates.append(block_clean)

    # JSON serialized as a string literal: "{\"a\":1}"
    if len(cleaned) >= 2 and cleaned[0] == '"' and cleaned[-1] == '"':
        try:
            unwrapped = json.loads(cleaned)
            if isinstance(unwrapped, str) and unwrapped.strip():
                candidates.append(unwrapped.strip())
        except Exception:
            pass

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
            if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
                return parsed[0]
        except Exception:
            pass
        # Fallback for python-dict style responses using single quotes.
        try:
            parsed = ast.literal_eval(candidate)
            if isinstance(parsed, dict):
                return parsed
            if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
                return parsed[0]
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
                if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
                    return parsed[0]

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


def _encoded_len(raw_bytes: bytes) -> int:
    return ((len(raw_bytes) + 2) // 3) * 4


def _image_payload_size(image: PageImage) -> int:
    mime_type = str(image.get("mime_type") or "image/png")
    return len(f"data:{mime_type};base64,") + _encoded_len(image["bytes"])


def _chunk_images_with_size_cap(
    indexed_images: list[tuple[int, PageImage]],
    *,
    max_request_encoded: int,
) -> list[list[tuple[int, PageImage]]]:
    chunks: list[list[tuple[int, PageImage]]] = []
    current: list[tuple[int, PageImage]] = []
    current_size = 0
    for page_no, image in indexed_images:
        size = _image_payload_size(image)
        if current and current_size + size > max_request_encoded:
            chunks.append(current)
            current = [(page_no, image)]
            current_size = size
        else:
            current.append((page_no, image))
            current_size += size
    if current:
        chunks.append(current)
    return chunks or [[]]


def _chunk_page_images_for_ocr(
    page_images: list[PageImage],
    *,
    max_request_encoded: int = MAX_REQUEST_ENCODED_BYTES,
) -> list[OcrImageChunk]:
    if not page_images:
        return []

    indexed = [(idx + 1, image) for idx, image in enumerate(page_images)]
    if len(indexed) == 1:
        page_no, image = indexed[0]
        return [{"images": [image], "page_numbers": [page_no], "includes_first_page": True}]

    first_page_no, first_page = indexed[0]
    first_page_size = _image_payload_size(first_page)
    remaining = indexed[1:]
    remaining_budget = max_request_encoded - first_page_size

    # Preferred strategy: repeat page-1 in every chunk so continuation chunks
    # still see field headers/labels from the first page.
    if remaining_budget > 0 and all(_image_payload_size(image) <= remaining_budget for _, image in remaining):
        continuation_chunks = _chunk_images_with_size_cap(
            remaining,
            max_request_encoded=remaining_budget,
        )
        chunks: list[OcrImageChunk] = []
        for continuation_chunk in continuation_chunks:
            pages = [first_page_no] + [page_no for page_no, _ in continuation_chunk]
            images = [first_page] + [image for _, image in continuation_chunk]
            chunks.append(
                {
                    "images": images,
                    "page_numbers": pages,
                    "includes_first_page": True,
                }
            )
        return chunks

    # Fallback when page-1 cannot be safely repeated under the cap.
    base_chunks = _chunk_images_with_size_cap(indexed, max_request_encoded=max_request_encoded)
    return [
        {
            "images": [image for _, image in chunk],
            "page_numbers": [page_no for page_no, _ in chunk],
            "includes_first_page": any(page_no == 1 for page_no, _ in chunk),
        }
        for chunk in base_chunks
    ]


def merge_extracted_records(existing: dict[str, Any] | None, incoming: dict[str, Any] | None) -> dict[str, Any]:
    if existing is None:
        return dict(incoming or {})
    if not isinstance(incoming, dict):
        return existing

    def is_empty(value: Any) -> bool:
        return value is None or value == "" or value == [] or value == {}

    for key, new_val in incoming.items():
        if key not in existing or is_empty(existing.get(key)):
            existing[key] = new_val
            continue
        old_val = existing[key]
        if isinstance(old_val, list) and isinstance(new_val, list):
            existing[key] = old_val + new_val
        elif isinstance(old_val, dict) and isinstance(new_val, dict):
            existing[key] = merge_extracted_records(old_val, new_val)
    return existing


def _collect_scalar_context(payload: dict[str, Any]) -> dict[str, Any]:
    context: dict[str, Any] = {}

    def walk(value: Any, prefix: str = "") -> None:
        if isinstance(value, dict):
            for key, nested in value.items():
                next_prefix = f"{prefix}.{key}" if prefix else key
                walk(nested, next_prefix)
            return
        if isinstance(value, list):
            return
        if value in (None, ""):
            return
        if prefix:
            context[prefix] = value

    walk(payload)
    if len(context) <= MAX_HEADER_CONTEXT_FIELDS:
        return context

    trimmed: dict[str, Any] = {}
    for index, key in enumerate(sorted(context.keys())):
        if index >= MAX_HEADER_CONTEXT_FIELDS:
            break
        trimmed[key] = context[key]
    return trimmed


def _build_chunk_user_text(*, chunk_index: int, total_chunks: int, merged_so_far: dict[str, Any] | None) -> str:
    if chunk_index == 1:
        return (
            "Extract the full document from these pages.\n"
            "The first page may be repeated in continuation requests for header context.\n"
            "Do not duplicate line-items/array rows across repeated pages."
        )

    header_summary = _collect_scalar_context(merged_so_far or {})
    return (
        "This is a CONTINUATION of the same document.\n"
        "Page 1 may be included again only to preserve field-header context.\n"
        "Do NOT overwrite previously extracted scalar/header fields.\n"
        "Extract only NEW array/table entries that appear in the continuation pages.\n"
        "Avoid duplicate rows already captured from earlier chunks.\n\n"
        "Previously extracted scalar context (for reference only):\n"
        f"{json.dumps(header_summary, indent=2, ensure_ascii=False)}"
    )


def _merge_usage(existing: dict[str, Any], incoming: Any) -> dict[str, Any]:
    if not isinstance(incoming, dict):
        return existing
    merged = dict(existing)
    for key, value in incoming.items():
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            merged[key] = int(merged.get(key, 0)) + int(value)
        elif key not in merged:
            merged[key] = value
    return merged


def _run_openrouter_ocr_chunk(
    *,
    page_images: list[PageImage],
    prompt: str,
    user_text: str,
) -> dict[str, Any]:
    api_key, model, base_url = _load_openrouter_config()
    payload = {
        "model": model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text},
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

    attempts = 3
    for attempt in range(1, attempts + 1):
        try:
            with request.urlopen(req, timeout=180) as response:
                body = response.read().decode("utf-8")
            break
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"OCR provider error {exc.code}: {detail or exc.reason}") from exc
        except (http.client.IncompleteRead, TimeoutError) as exc:
            if attempt >= attempts:
                raise RuntimeError(f"Failed to call OCR provider: {exc}") from exc
            time.sleep(1.5 * attempt)
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

    # Compatibility fallbacks across provider variants where text may be stored
    # outside message.content or returned as an empty string.
    if not text.strip():
        choice_text = choices[0].get("text")
        if isinstance(choice_text, str) and choice_text.strip():
            text = choice_text
    if not text.strip():
        output_text = response_payload.get("output_text")
        if isinstance(output_text, str) and output_text.strip():
            text = output_text

    try:
        if not text.strip():
            # Graceful fallback: persist an empty extraction shape instead of
            # failing the full OCR pipeline when provider returns blank output.
            parsed = {}
        else:
            parsed = _extract_json(text)
    except Exception as exc:
        preview = (text or "").strip().replace("\n", " ")[:500]
        raise RuntimeError(f"Could not parse OCR JSON. model_output_preview={preview!r}") from exc
    parsed["_usage"] = response_payload.get("usage") or {}
    parsed["_model"] = response_payload.get("model") or model
    return parsed


def run_openrouter_ocr(*, page_images: list[PageImage], prompt: str) -> dict[str, Any]:
    chunks = _chunk_page_images_for_ocr(page_images)
    if not chunks:
        return {"_usage": {}, "_model": None}

    if len(chunks) > 1:
        print(
            f"[pipeline][chunking] split_requests={len(chunks)} pages_per_request="
            f"{[len(chunk['page_numbers']) for chunk in chunks]}",
            flush=True,
        )

    merged_payload: dict[str, Any] | None = None
    merged_usage: dict[str, Any] = {}
    model_name: str | None = None

    for chunk_index, chunk in enumerate(chunks, start=1):
        user_text = _build_chunk_user_text(
            chunk_index=chunk_index,
            total_chunks=len(chunks),
            merged_so_far=merged_payload,
        )
        chunk_result = _run_openrouter_ocr_chunk(
            page_images=chunk["images"],
            prompt=prompt,
            user_text=user_text,
        )
        chunk_payload = {
            key: value
            for key, value in chunk_result.items()
            if not key.startswith("_")
        }
        merged_payload = merge_extracted_records(merged_payload, chunk_payload)
        merged_usage = _merge_usage(merged_usage, chunk_result.get("_usage"))
        model_name = chunk_result.get("_model") or model_name

    final_payload = merged_payload or {}
    final_payload["_usage"] = merged_usage
    final_payload["_model"] = model_name
    return final_payload


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
        # Persist normalized structured payload so frontend always receives the full
        # expected field shape (including null/default values), not sparse provider output.
        normalized_raw_payload = structured.model_dump(mode="json", exclude_none=False)
    except ValidationError as exc:
        await prisma.document.update(
            where={"id": document.id},
            data={"status": "UPLOADED"},
        )
        print(
            f"[pipeline][failed] documentId={document.id} reason=validation_error details={exc}",
            flush=True,
        )
        return {"status": "failed", "reason": f"validation_error: {exc}"}
    except Exception as exc:
        await prisma.document.update(
            where={"id": document.id},
            data={"status": "UPLOADED"},
        )
        print(f"[pipeline][failed] documentId={document.id} reason={exc}", flush=True)
        return {"status": "failed", "reason": str(exc)}

    try:
        extraction = await processor.persist_extraction(
            prisma=prisma,
            document_id=document.id,
            result=structured,
            raw_data=normalized_raw_payload,
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
    except Exception as exc:
        await prisma.document.update(
            where={"id": document.id},
            data={"status": "UPLOADED"},
        )
        print(f"[pipeline][failed] documentId={document.id} reason=persist_error:{exc}", flush=True)
        return {"status": "failed", "reason": f"persist_error: {exc}"}


__all__ = [
    "ValidationError",
    "load_page_images_for_document",
    "run_openrouter_ocr",
    "run_post_upload_ocr",
]
