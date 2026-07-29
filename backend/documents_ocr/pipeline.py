import asyncio
import base64
import ast
import http.client
import json
import re
import socket
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, TypedDict
from urllib import error, request

from pydantic import ValidationError

from doc_generation.db_setup import ensure_doc_generation_views
from helpers.config import settings
from objectstore import download_bytes

try:
    from json_repair import repair_json
except Exception:  # pragma: no cover - optional hardening dependency.
    repair_json = None

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
from documents_ocr.CBP_FORM_7501.ocr import (
    build_prompt as build_cbp_form_7501_prompt,
    matches_cbp_form_7501,
    parse_result as parse_cbp_form_7501_result,
    persist_extraction as persist_cbp_form_7501_extraction,
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
from documents_ocr.ISF.ocr import (
    build_prompt as build_isf_prompt,
    matches_isf,
    parse_result as parse_isf_result,
    persist_extraction as persist_isf_extraction,
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
    repair_container_assignments_from_grid,
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
        matcher=matches_cbp_form_7501,
        build_prompt=build_cbp_form_7501_prompt,
        parse_result=parse_cbp_form_7501_result,
        persist_extraction=persist_cbp_form_7501_extraction,
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
        matcher=matches_isf,
        build_prompt=build_isf_prompt,
        parse_result=parse_isf_result,
        persist_extraction=persist_isf_extraction,
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


class OcrUsageChunk(TypedDict):
    page_numbers: list[int]
    image_sizes: list[int]
    usage: dict[str, Any]
    model: str | None


MAX_REQUEST_ENCODED_BYTES = max(1 * 1024 * 1024, int(getattr(settings, "OCR_MAX_REQUEST_ENCODED_BYTES", 27 * 1024 * 1024)))
MAX_HEADER_CONTEXT_FIELDS = 120
DEFAULT_OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions"
OCR_CONFIDENCE_PROMPT = (
    "Also return a top-level `document_confidence` number from 0 to 1 that reflects your overall OCR "
    "confidence for this document after reading the provided pages. Base it on legibility, missing/unclear "
    "fields, table quality, and consistency of extracted values. Use 1 only when the extraction is effectively "
    "certain, and use lower values for blurry scans, cut-off pages, handwriting, ambiguous labels, or inferred values."
)

PROCESSOR_BY_DOC_TYPE: dict[str, OcrProcessor] = {
    "BILL_OF_LADING": next(item for item in PROCESSORS if item.parse_result is parse_bill_of_lading_result),
    "CHA_BILL": next(item for item in PROCESSORS if item.parse_result is parse_cha_result),
    "CUSTOMER_BROKER_BILL": next(item for item in PROCESSORS if item.parse_result is parse_customer_broker_bill_result),
    "ENTRY_SUMMARY": next(item for item in PROCESSORS if item.parse_result is parse_cbp_form_7501_result),
    "DRAFT_CBP_FORM_7501_BROKER": next(item for item in PROCESSORS if item.parse_result is parse_cbp_form_7501_result),
    "FREIGHT_FORWARDER_BILL": next(item for item in PROCESSORS if item.parse_result is parse_freight_forward_result),
    "GRN_INBOUND": next(item for item in PROCESSORS if item.parse_result is parse_grn_inbound_result),
    "ISF": next(item for item in PROCESSORS if item.parse_result is parse_isf_result),
    "OCEAN_FREIGHT": next(item for item in PROCESSORS if item.parse_result is parse_ocean_freight_result),
    "PACKING_LIST": next(item for item in PROCESSORS if item.parse_result is parse_packing_list_result),
    "PORT_TO_WH": next(item for item in PROCESSORS if item.parse_result is parse_port_to_wh_result),
    "SALES_INVOICE": next(item for item in PROCESSORS if item.parse_result is parse_sales_invoice_result),
    "SHIPPING_BILL": next(item for item in PROCESSORS if item.parse_result is parse_shipping_bill_result),
    "US_CARGO_RELEASE_ORDER": next(item for item in PROCESSORS if item.parse_result is parse_us_cargo_release_result),
    "US_CUSTOMS_RELEASE_ORDER": next(item for item in PROCESSORS if item.parse_result is parse_us_customs_release_result),
    "US_DELIVERY_ORDER": next(item for item in PROCESSORS if item.parse_result is parse_us_delivery_order_result),
    "US_PACKING_LIST": next(item for item in PROCESSORS if item.parse_result is parse_us_packing_list_result),
    "US_SALES_INVOICE": next(item for item in PROCESSORS if item.parse_result is parse_us_sales_invoice_result),
    "WH_TO_CUSTOMER": next(item for item in PROCESSORS if item.parse_result is parse_wh_to_customer_result),
}


def validate_ocr_schema_coverage() -> dict[str, Any]:
    """Fail startup when an OCR route no longer covers its live Prisma schema."""
    errors: list[str] = []
    processor_reports: list[dict[str, Any]] = []

    unique_processors = set(PROCESSOR_BY_DOC_TYPE.values())
    if len(unique_processors) != len(PROCESSORS):
        errors.append(
            f"unique manual route count ({len(unique_processors)}) does not match "
            f"processor count ({len(PROCESSORS)})"
        )

    for doc_type, processor in PROCESSOR_BY_DOC_TYPE.items():
        schema = processor.parse_result.__globals__.get("_SCHEMA")
        scalar_fields = getattr(schema, "scalar_fields", None)
        array_fields = getattr(schema, "array_fields", None)
        array_item_fields = getattr(schema, "array_item_fields", None)
        if not isinstance(scalar_fields, list) or not isinstance(array_fields, list) or not isinstance(array_item_fields, dict):
            errors.append(f"{doc_type}: parser does not expose a valid Prisma extraction schema")
            continue

        prompt = _build_prisma_anchored_prompt(processor)
        expected_fields = [
            *scalar_fields,
            *array_fields,
            *[
                child_field
                for child_fields in array_item_fields.values()
                for child_field in child_fields
            ],
        ]
        missing = sorted({field for field in expected_fields if field not in prompt})
        if missing:
            errors.append(f"{doc_type}: prompt missing Prisma fields {missing}")

        parser_schema = processor.parse_result.__globals__.get("_SCHEMA")
        persistence_schema = processor.persist_extraction.__globals__.get("_SCHEMA")
        if parser_schema is not persistence_schema:
            errors.append(f"{doc_type}: parser and persistence use different Prisma schemas")

        processor_reports.append(
            {
                "docType": doc_type,
                "processor": processor.parse_result.__module__,
                "scalarFields": len(scalar_fields),
                "arrayFields": len(array_fields),
                "arrayItemFields": sum(len(fields) for fields in array_item_fields.values()),
                "missingFields": missing,
            }
        )

    if errors:
        raise RuntimeError("OCR Prisma schema coverage validation failed: " + "; ".join(errors))
    return {
        "processors": len(processor_reports),
        "routes": len(PROCESSOR_BY_DOC_TYPE),
        "missingFields": 0,
        "details": processor_reports,
    }

SCHEMA_COMPLETENESS_PROMPT = """
SCHEMA COMPLETENESS CHECK (applies to every document type):
- The supplied JSON template is the complete extraction schema for this document. Inspect every page for every template field before returning null.
- Treat printed labels, abbreviations, spacing, punctuation, and capitalization as semantic aliases of schema keys.
- For every array/table, return every visible row and populate every visible cell into its corresponding schema field. Never return count-only or blank placeholder rows when row details are visible.
- Preserve wrapped and multi-line cell text in the same row. Do not move a value to an adjacent row, merge different rows, or stop after extracting only the row count.
- Before responding, compare the JSON against the template and verify that every template key is present and every visibly supported value has been attempted.
""".strip()


def _normalize_chat_completions_url(raw_url: str, *, default_url: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        return default_url
    normalized = url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


def _load_ocr_provider_config() -> tuple[str, str, str]:
    openrouter_api_key = (getattr(settings, "OPENROUTER_API_KEY", "") or "").strip()
    openrouter_model = (getattr(settings, "OPENROUTER_MODEL_PRO", "") or "").strip()
    openrouter_api_url = (getattr(settings, "OPENROUTER_API_URL", "") or "").strip()
    if openrouter_api_key and openrouter_model:
        return (
            openrouter_api_key,
            _normalize_chat_completions_url(
                openrouter_api_url,
                default_url=DEFAULT_OPENROUTER_CHAT_COMPLETIONS_URL,
            ),
            openrouter_model,
        )

    if not openrouter_api_key:
        raise RuntimeError("Missing OPENROUTER_API_KEY for OCR")
    raise RuntimeError("Missing OPENROUTER_MODEL_PRO for OCR")


def _extract_json(text: str) -> dict[str, Any]:
    cleaned = (text or "").strip()
    if not cleaned:
        raise ValueError("Empty response from OCR model")

    candidates: list[str] = [cleaned]
    candidates.append(cleaned.replace("```json", "").replace("```JSON", "").replace("```", "").strip())

    for block in re.findall(r"```(?:json)?\s*(.*?)\s*```", cleaned, flags=re.IGNORECASE | re.DOTALL):
        block_clean = block.strip()
        if block_clean:
            candidates.append(block_clean)

    if len(cleaned) >= 2 and cleaned[0] == '"' and cleaned[-1] == '"':
        try:
            unwrapped = json.loads(cleaned)
            if isinstance(unwrapped, str) and unwrapped.strip():
                candidates.append(unwrapped.strip())
        except Exception:
            pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        candidates.append(cleaned[start : end + 1])

    for candidate in candidates:
        parsed = _parse_json_candidate(candidate)
        if parsed is not None:
            return parsed

    raise ValueError("Could not parse JSON object from OCR response")


def _parse_json_candidate(candidate: str) -> dict[str, Any] | None:
    candidate = candidate.strip()
    cleaned = re.sub(r",\s*([}\]])", r"\1", candidate)
    attempts = [candidate]
    if cleaned != candidate:
        attempts.append(cleaned)

    for value in attempts:
        for parser in (
            lambda raw: json.loads(raw),
            lambda raw: json.loads(raw, strict=False),
            ast.literal_eval,
        ):
            try:
                parsed = parser(value)
                if isinstance(parsed, dict):
                    return parsed
                if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
                    return parsed[0]
            except Exception:
                pass

    if repair_json is None:
        return None

    try:
        repaired = repair_json(candidate, return_objects=True)
        if isinstance(repaired, dict):
            return repaired
        if isinstance(repaired, list) and repaired and isinstance(repaired[0], dict):
            return repaired[0]
    except TypeError:
        try:
            repaired_text = repair_json(candidate)
            parsed = json.loads(repaired_text, strict=False)
            if isinstance(parsed, dict):
                return parsed
            if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
                return parsed[0]
        except Exception:
            return None
    except Exception:
        return None
    return None


def _image_openrouter_part(image_bytes: bytes, mime_type: str = "image/png") -> dict[str, Any]:
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    return {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{encoded}"}}


def _run_openrouter_ocr_chunk(
    *,
    page_images: list[PageImage],
    prompt: str,
    user_text: str,
    document_name: str | None = None,
) -> dict[str, Any]:
    api_key, api_url, model = _load_ocr_provider_config()
    attempts = max(1, int(getattr(settings, "OCR_GEMINI_MAX_ATTEMPTS", 7) or 7))
    timeout_seconds = max(60, int(getattr(settings, "OCR_GEMINI_HTTP_TIMEOUT_SECONDS", 900) or 900))
    retry_backoff_base = max(0.5, float(getattr(settings, "OCR_GEMINI_RETRY_BACKOFF_SECONDS", 2.0) or 2.0))

    content: list[dict[str, Any]] = [
        {"type": "text", "text": prompt},
        *[_image_openrouter_part(img["bytes"], img["mime_type"]) for img in page_images],
        {"type": "text", "text": user_text},
    ]
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    request_title = re.sub(r"[\r\n]+", " ", str(document_name or "")).strip()
    if request_title:
        # OpenRouter displays this value as the request/application title.
        headers["X-Title"] = request_title[:512]

    req = request.Request(
        url=api_url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    for attempt in range(1, attempts + 1):
        try:
            with request.urlopen(req, timeout=timeout_seconds) as response:
                body = response.read().decode("utf-8")
            break
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            # 5xx = provider-side transient (502/503/504), 429 = rate limit. Retry with backoff.
            # 4xx (other than 429) = bad request / auth — won't change on retry, fail fast.
            is_retryable = exc.code >= 500 or exc.code == 429
            if not is_retryable or attempt >= attempts:
                raise RuntimeError(f"OCR provider error {exc.code}: {detail or exc.reason}") from exc
            backoff_s = min(30.0, retry_backoff_base * (2 ** (attempt - 1)))
            print(
                f"[pipeline][ocr-retry] attempt={attempt}/{attempts} status={exc.code} backoff_s={backoff_s}",
                flush=True,
            )
            time.sleep(backoff_s)
        except (http.client.IncompleteRead, TimeoutError, socket.timeout, error.URLError) as exc:
            timeout_like = isinstance(exc, (TimeoutError, socket.timeout, http.client.IncompleteRead))
            if isinstance(exc, error.URLError):
                reason = getattr(exc, "reason", None)
                timeout_like = isinstance(reason, (TimeoutError, socket.timeout)) or "timed out" in str(reason).lower()

            if not timeout_like:
                raise RuntimeError(f"Failed to call OCR provider: {exc}") from exc
            if attempt >= attempts:
                raise RuntimeError(
                    "Failed to call OCR provider after retries due to timeout/network stall. "
                    f"attempts={attempts} timeout_seconds={timeout_seconds} "
                    f"chunk_pages={len(page_images)} max_request_encoded={MAX_REQUEST_ENCODED_BYTES}. "
                    "Try lowering OCR_MAX_REQUEST_ENCODED_BYTES to force smaller chunks."
                ) from exc
            backoff_s = min(20.0, retry_backoff_base * attempt)
            print(
                f"[pipeline][ocr-retry] attempt={attempt}/{attempts} timeout/network backoff_s={backoff_s}",
                flush=True,
            )
            time.sleep(backoff_s)
        except Exception as exc:
            raise RuntimeError(f"Failed to call OCR provider: {exc}") from exc

    response_payload = json.loads(body)
    choices = response_payload.get("choices") or []
    if not choices:
        raise RuntimeError("OCR provider returned no choices")

    finish_reason = choices[0].get("finish_reason")
    message = choices[0].get("message") or {}
    raw_content = message.get("content", "")
    if isinstance(raw_content, str):
        text = raw_content
    elif isinstance(raw_content, list):
        text = "".join(
            part.get("text", "")
            for part in raw_content
            if isinstance(part, dict)
        )
    else:
        text = str(raw_content or "")

    if finish_reason == "length":
        # Output got truncated — JSON will be invalid. Fail clearly instead of
        # raising an opaque parse error so chunking/limit can be tuned upstream.
        raise RuntimeError(
            f"OCR provider response truncated (finish_reason=length, completion_tokens="
            f"{(response_payload.get('usage') or {}).get('completion_tokens')}). "
            "Reduce pages per chunk via MAX_REQUEST_ENCODED_BYTES."
        )

    try:
        parsed = _extract_json(text) if text.strip() else {}
    except Exception as exc:
        preview = (text or "").strip().replace("\n", " ")[:500]
        raise RuntimeError(
            f"Could not parse OCR provider JSON (finish_reason={finish_reason}). "
            f"model_output_preview={preview!r}"
        ) from exc

    usage_meta = response_payload.get("usage") or {}
    parsed["_usage"] = {
        "prompt_tokens": usage_meta.get("prompt_tokens", 0),
        "completion_tokens": usage_meta.get("completion_tokens", 0),
        "total_tokens": usage_meta.get("total_tokens", 0),
    }
    parsed["_model"] = model
    return parsed


def _select_processor(*, bucket: str, module: str, document: Any) -> OcrProcessor | None:
    selected_doc_type = str(getattr(document, "docType", "") or "").strip().upper()
    if selected_doc_type:
        # Manual selection and auto-detect both persist an exact Prisma DocType.
        # Once present, it is authoritative and must never be overridden by a
        # bucket name, filename, or another processor's fuzzy matcher.
        return PROCESSOR_BY_DOC_TYPE.get(selected_doc_type)

    for processor in PROCESSORS:
        if processor.matcher(bucket=bucket, module=module, document=document):
            return processor
    return None


def _build_prisma_anchored_prompt(processor: OcrProcessor) -> str:
    """Append the live Prisma extraction shape to every OCR prompt."""
    prompt = processor.build_prompt()
    schema = processor.parse_result.__globals__.get("_SCHEMA")
    scalar_fields = getattr(schema, "scalar_fields", None)
    array_item_fields = getattr(schema, "array_item_fields", None)
    if not isinstance(scalar_fields, list) or not isinstance(array_item_fields, dict):
        return prompt

    manifest = {
        "scalarFields": scalar_fields,
        "arrayFields": array_item_fields,
    }
    return (
        f"{prompt}\n\n"
        "AUTHORITATIVE PRISMA EXTRACTION MANIFEST:\n"
        f"{json.dumps(manifest, indent=2)}\n"
        "This manifest is generated from the live Prisma schema. Every scalar field "
        "must be attempted, and every visible array row must be returned with every "
        "listed child field. Do not omit a field because its PDF label uses a synonym."
    )


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


def _to_int(value: Any) -> int:
    if value is None or isinstance(value, bool):
        return 0
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def _to_decimal(value: Any) -> Decimal:
    if value is None or isinstance(value, bool):
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def _allocate_count(total: int, weights: list[int]) -> list[int]:
    if not weights:
        return []
    total = max(0, int(total or 0))
    safe_weights = [max(0, int(weight or 0)) for weight in weights]
    weight_sum = sum(safe_weights)
    if total == 0:
        return [0 for _ in safe_weights]
    if weight_sum <= 0:
        base, remainder = divmod(total, len(safe_weights))
        return [base + (1 if index < remainder else 0) for index in range(len(safe_weights))]

    raw_allocations = [(total * weight) / weight_sum for weight in safe_weights]
    allocations = [int(value) for value in raw_allocations]
    remainder = total - sum(allocations)
    if remainder <= 0:
        return allocations

    ranked_indexes = sorted(
        range(len(raw_allocations)),
        key=lambda index: raw_allocations[index] - allocations[index],
        reverse=True,
    )
    for index in ranked_indexes[:remainder]:
        allocations[index] += 1
    return allocations


def _provider_from_model_id(model_id: str | None) -> str:
    model = (model_id or "").strip()
    if "/" in model:
        return model.split("/", 1)[0] or "openrouter"
    return "openrouter"


async def _ensure_ai_model_registry(prisma, *, model_id: str) -> Any:
    existing = await prisma.aimodelregistry.find_unique(where={"modelId": model_id})
    if existing:
        return existing

    provider = _provider_from_model_id(model_id)
    try:
        return await prisma.aimodelregistry.create(
            data={
                "modelId": model_id,
                "provider": provider,
                "displayName": model_id,
                "isActive": True,
                "isLocal": False,
                "inputPricePer1M": Decimal("0"),
                "outputPricePer1M": Decimal("0"),
                "imagePricePer1K": Decimal("0"),
                "supportsVision": True,
                "supportsOcr": True,
            }
        )
    except Exception:
        existing = await prisma.aimodelregistry.find_unique(where={"modelId": model_id})
        if existing:
            return existing
        raise


async def _record_ai_usage_records(
    *,
    prisma,
    document,
    usage_chunks: list[OcrUsageChunk],
    processing_ms: int | None,
) -> None:
    if not usage_chunks:
        return

    page_rows = await prisma.documentpage.find_many(
        where={"documentId": document.id, "isExtractionSource": True},
        order={"pageNo": "asc"},
    )
    page_id_by_no = {int(getattr(page, "pageNo", 0) or 0): str(page.id) for page in page_rows}
    existing_usage_count = await prisma.aiusagerecord.count(where={"documentId": document.id})
    is_retry = existing_usage_count > 0

    for usage_chunk in usage_chunks:
        model_id = str(usage_chunk.get("model") or "").strip()
        if not model_id:
            continue
        model_registry = await _ensure_ai_model_registry(prisma, model_id=model_id)
        provider = str(getattr(model_registry, "provider", "") or _provider_from_model_id(model_id))
        input_price = _to_decimal(getattr(model_registry, "inputPricePer1M", None))
        output_price = _to_decimal(getattr(model_registry, "outputPricePer1M", None))
        image_price = _to_decimal(getattr(model_registry, "imagePricePer1K", None))

        usage = usage_chunk.get("usage") or {}
        prompt_tokens = _to_int(usage.get("prompt_tokens"))
        completion_tokens = _to_int(usage.get("completion_tokens"))
        total_tokens = _to_int(usage.get("total_tokens")) or prompt_tokens + completion_tokens
        page_numbers = [int(page_no) for page_no in usage_chunk.get("page_numbers", [])]
        image_sizes = [int(size) for size in usage_chunk.get("image_sizes", [])]
        if not page_numbers:
            continue

        input_allocations = _allocate_count(prompt_tokens, image_sizes)
        output_allocations = _allocate_count(completion_tokens, image_sizes)
        total_allocations = _allocate_count(total_tokens, image_sizes)
        image_allocations = [1 for _ in page_numbers]

        for index, page_no in enumerate(page_numbers):
            input_tokens = input_allocations[index] if index < len(input_allocations) else 0
            output_tokens = output_allocations[index] if index < len(output_allocations) else 0
            allocated_total = total_allocations[index] if index < len(total_allocations) else input_tokens + output_tokens
            total_for_record = allocated_total or input_tokens + output_tokens
            image_count = image_allocations[index]
            input_cost = (Decimal(input_tokens) * input_price) / Decimal("1000000")
            output_cost = (Decimal(output_tokens) * output_price) / Decimal("1000000")
            image_cost = (Decimal(image_count) * image_price) / Decimal("1000")
            await prisma.aiusagerecord.create(
                data={
                    "documentId": document.id,
                    "pageId": page_id_by_no.get(page_no),
                    "modelRegistryId": model_registry.id,
                    "modelId": model_id,
                    "provider": provider,
                    "inputTokens": input_tokens,
                    "outputTokens": output_tokens,
                    "totalTokens": total_for_record,
                    "imageCount": image_count,
                    "snapshotInputPrice": input_price,
                    "snapshotOutputPrice": output_price,
                    "inputCostUsd": input_cost,
                    "outputCostUsd": output_cost,
                    "imageCostUsd": image_cost,
                    "totalCostUsd": input_cost + output_cost + image_cost,
                    "docType": getattr(document, "docType", None),
                    "taskType": "ocr",
                    "processingMs": processing_ms,
                    "isRetry": is_retry,
                }
            )


def _normalize_document_confidence(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return None
    if confidence > 1:
        confidence = confidence / 100
    return max(0.0, min(1.0, confidence))


def run_ocr(
    *,
    page_images: list[PageImage],
    prompt: str,
    document_name: str | None = None,
) -> dict[str, Any]:
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
    usage_chunks: list[OcrUsageChunk] = []
    model_name: str | None = None

    for chunk_index, chunk in enumerate(chunks, start=1):
        user_text = _build_chunk_user_text(
            chunk_index=chunk_index,
            total_chunks=len(chunks),
            merged_so_far=merged_payload,
        )
        chunk_result = _run_openrouter_ocr_chunk(
            page_images=chunk["images"],
            prompt=f"{prompt}\n\n{SCHEMA_COMPLETENESS_PROMPT}\n\n{OCR_CONFIDENCE_PROMPT}",
            user_text=user_text,
            document_name=document_name,
        )
        chunk_payload = {
            key: value
            for key, value in chunk_result.items()
            if not key.startswith("_")
        }
        merged_payload = merge_extracted_records(merged_payload, chunk_payload)
        merged_usage = _merge_usage(merged_usage, chunk_result.get("_usage"))
        model_name = chunk_result.get("_model") or model_name
        usage_chunks.append(
            {
                "page_numbers": chunk["page_numbers"],
                "image_sizes": [_image_payload_size(image) for image in chunk["images"]],
                "usage": chunk_result.get("_usage") or {},
                "model": chunk_result.get("_model") or model_name,
            }
        )

    final_payload = merged_payload or {}
    final_payload["_usage"] = merged_usage
    final_payload["_usage_chunks"] = usage_chunks
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
    auto_validate: bool = False,
    refresh_generated_drafts: bool = False,
) -> dict[str, Any]:
    print(
        f"[pipeline][start] documentId={document.id} bucket={bucket} module={module}",
        flush=True,
    )
    processor = _select_processor(bucket=bucket, module=module, document=document)
    if processor is None:
        await prisma.document.update(
            where={"id": document.id},
            data={"status": "UPLOADED"},
        )
        print(
            f"[pipeline][skip] documentId={document.id} reason=unsupported_document_type status->UPLOADED",
            flush=True,
        )
        return {"status": "skipped", "reason": "unsupported_document_type"}

    if page_images is not None:
        images: list[PageImage] = [{"bytes": image_bytes, "mime_type": "image/png"} for image_bytes in page_images]
    else:
        images = await load_page_images_for_document(prisma=prisma, document_id=document.id)
    if not images:
        await prisma.document.update(
            where={"id": document.id},
            data={"status": "UPLOADED"},
        )
        print(f"[pipeline][skip] documentId={document.id} reason=no_pages status->UPLOADED", flush=True)
        return {"status": "skipped", "reason": "no_pages"}
    print(f"[pipeline][pages] documentId={document.id} count={len(images)}", flush=True)

    await prisma.document.update(
        where={"id": document.id},
        data={"status": "PROCESSING"},
    )
    print(f"[pipeline][status] documentId={document.id} status=PROCESSING", flush=True)

    try:
        # OCR provider call is blocking (urllib); run it in a thread so API loop stays responsive.
        ocr_started_at = time.perf_counter()
        raw_result = await asyncio.to_thread(
            run_ocr,
            page_images=images,
            prompt=_build_prisma_anchored_prompt(processor),
            document_name=getattr(document, "fileName", None),
        )
        ocr_processing_ms = max(0, int((time.perf_counter() - ocr_started_at) * 1000))
        try:
            await _record_ai_usage_records(
                prisma=prisma,
                document=document,
                usage_chunks=raw_result.get("_usage_chunks") or [],
                processing_ms=ocr_processing_ms,
            )
            print(
                f"[pipeline][usage] documentId={document.id} records_written=True",
                flush=True,
            )
        except Exception as usage_exc:
            print(
                f"[pipeline][usage] warning documentId={document.id} records_write_failed={usage_exc}",
                flush=True,
            )
        raw_payload = {
            k: v
            for k, v in raw_result.items()
            if not k.startswith("_") and k != "document_confidence"
        }
        if processor.parse_result is parse_sales_invoice_result:
            raw_payload = repair_container_assignments_from_grid(
                raw_payload,
                page_images=images,
            )
        structured = processor.parse_result(raw_payload)
        # Persist normalized structured payload so frontend always receives the full
        # expected field shape (including null/default values), not sparse provider output.
        normalized_raw_payload = structured.model_dump(mode="json", exclude_none=False)
        document_confidence = _normalize_document_confidence(raw_result.get("document_confidence"))
        if document_confidence is not None:
            normalized_raw_payload["document_confidence"] = document_confidence
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

        validation_result: dict[str, Any] | None = None
        if auto_validate:
            try:
                from api.v1.uploads.router import auto_review_and_validate_document

                validation_result = await auto_review_and_validate_document(
                    prisma=prisma,
                    document_id=str(document.id),
                    user_id=str(document.uploadedBy),
                )
                print(
                    f"[pipeline][reupload-validation] documentId={document.id} status={validation_result.get('status')}",
                    flush=True,
                )
            except Exception as exc:
                print(
                    f"[pipeline][reupload-validation] warning documentId={document.id} error={exc}",
                    flush=True,
                )

        if refresh_generated_drafts:
            try:
                from api.v1.doc_generation.router import refresh_generated_drafts_for_source_document

                refreshed = await refresh_generated_drafts_for_source_document(
                    prisma=prisma,
                    source_document_id=str(document.id),
                    user_id=str(document.uploadedBy),
                )
                print(
                    f"[docgen][refresh] sourceDocumentId={document.id} refreshed={refreshed.get('updated', 0)}",
                    flush=True,
                )
            except Exception as exc:
                print(
                    f"[docgen][refresh] warning sourceDocumentId={document.id}: {exc}",
                    flush=True,
                )

        if str(getattr(document, "docType", "")).upper() == "SALES_INVOICE":
            try:
                from api.v1.doc_generation.router import ensure_packing_list_draft_for_sales_invoice

                await ensure_doc_generation_views(prisma)
                print(f"[docgen][views] ensured after sales invoice extraction documentId={document.id}", flush=True)
                draft_id = await ensure_packing_list_draft_for_sales_invoice(
                    prisma=prisma,
                    sales_invoice_document_id=str(document.id),
                    user_id=str(document.uploadedBy),
                )
                print(
                    f"[docgen][auto] packing-list draft ready documentId={document.id} draftId={draft_id}",
                    flush=True,
                )
            except Exception as exc:
                print(
                    f"[docgen][auto] warning: could not generate packing-list draft documentId={document.id}: {exc}",
                    flush=True,
                )

        print(
            f"[pipeline][done] documentId={document.id} extractionId={extraction.id}",
            flush=True,
        )
        return {
            "status": "extracted",
            "extractionId": extraction.id,
            "model": raw_result.get("_model"),
            "usage": raw_result.get("_usage"),
            "validation": validation_result,
        }
    except Exception as exc:
        await prisma.document.update(
            where={"id": document.id},
            data={"status": "UPLOADED"},
        )
        print(f"[pipeline][failed] documentId={document.id} reason=persist_error:{exc}", flush=True)
        return {"status": "failed", "reason": f"persist_error: {exc}"}


run_openrouter_ocr = run_ocr  # noqa: E305 — backward-compat alias for sub-package callers

__all__ = [
    "ValidationError",
    "load_page_images_for_document",
    "run_ocr",
    "run_openrouter_ocr",
    "run_post_upload_ocr",
    "validate_ocr_schema_coverage",
]
