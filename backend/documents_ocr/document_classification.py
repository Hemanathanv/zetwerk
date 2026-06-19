from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
import json
from pathlib import Path
import re
import shutil
from typing import Any
from urllib import error, request

from PIL import Image
from pdf2image import convert_from_bytes
from pypdf import PdfReader

from helpers.config import settings
from documents_ocr.schema_loader import load_extraction_schema


DEFAULT_CLASSIFIER_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
LOCAL_POPPLER_BIN = Path(__file__).resolve().parents[1] / "poppler" / "Library" / "bin"
LINUX_POPPLER_BIN = Path("/usr/bin")
MAX_FIELD_HINTS = 7
MAX_TEXT_CHARS = 2500
CLASSIFIER_IMAGE_DPI = 300
CLASSIFIER_IMAGE_MAX_EDGE = 1400
CLASSIFIER_IMAGE_JPEG_QUALITY = 55
MAX_SCORE_PHRASES_PER_DOC = 80


def _resolve_poppler_path() -> str | None:
    for candidate in (LOCAL_POPPLER_BIN, LINUX_POPPLER_BIN):
        executable = candidate / ("pdftoppm.exe" if candidate.drive else "pdftoppm")
        if executable.exists():
            return str(candidate)
    if shutil.which("pdftoppm"):
        return None
    return ""


@dataclass(frozen=True)
class ClassifierCandidate:
    doc_type: str
    label: str
    prisma_model: str


@dataclass(frozen=True)
class ClassificationResult:
    doc_type: str
    label: str
    confidence: float
    reasoning: str
    matched_fields: list[str]
    alternatives: list[dict[str, Any]]


CLASSIFIER_CANDIDATES: tuple[ClassifierCandidate, ...] = (
    ClassifierCandidate("CHA_BILL", "CHA Bill", "ChaBillExtraction"),
    ClassifierCandidate("FREIGHT_FORWARDER_BILL", "Freight Forwarder Bill", "FreightForwarderBillExtraction"),
    ClassifierCandidate("CUSTOMER_BROKER_BILL", "Customer Broker Bill", "CustomerBrokerBillExtraction"),
    ClassifierCandidate("OCEAN_FREIGHT", "Ocean Freight", "OceanFreightExtraction"),
    ClassifierCandidate("PORT_TO_WH", "Port to WH", "PortToWhExtraction"),
    ClassifierCandidate("WH_TO_CUSTOMER", "WH to Customer", "WhToCustomerExtraction"),
    ClassifierCandidate("BILL_OF_LADING", "Bill of Lading", "BillOfLading"),
    ClassifierCandidate("PACKING_LIST", "Packing List", "PackingListExtraction"),
    ClassifierCandidate("ENTRY_SUMMARY", "Entry Summary", "EntrySummaryExtraction"),
    ClassifierCandidate("ENTRY_SUMMARY_TARIFF_LINES", "Entry Summary Tariff Lines", "EntrySummaryTariffLineExtraction"),
    ClassifierCandidate("GRN_INBOUND", "GRN Inbound", "GrnInboundExtraction"),
    ClassifierCandidate("US_CARGO_RELEASE_ORDER", "US Cargo Release Order", "UsCargoReleaseExtraction"),
    ClassifierCandidate("US_CUSTOMS_RELEASE_ORDER", "US Customs Release Order", "UsCustomsReleaseExtraction"),
    ClassifierCandidate("US_DELIVERY_ORDER", "US Delivery Order", "UsDeliveryOrderExtraction"),
    ClassifierCandidate("US_PACKING_LIST", "US Packing List", "UsPackingListExtraction"),
    ClassifierCandidate("SHIPPING_BILL", "Shipping Bill", "ShippingBillExtraction"),
    ClassifierCandidate("SALES_INVOICE", "Sales Invoice", "SalesInvoiceExtraction"),
    ClassifierCandidate("US_SALES_INVOICE", "US Sales Invoice", "UsSalesInvoiceExtraction"),
)

CURATED_FINGERPRINTS: dict[str, tuple[str, ...]] = {
    "SALES_INVOICE": ("tax invoice", "buyer", "seller", "gstin", "irn", "taxable value", "eway bill"),
    "BILL_OF_LADING": ("bill of lading", "bl number", "vessel", "voyage", "notify party", "port of loading", "place of delivery"),
    "PACKING_LIST": ("packing list", "net weight", "gross weight", "package", "marks and numbers", "carton", "dimensions"),
    "ENTRY_SUMMARY": ("entry summary", "entry number", "importer of record", "surety", "cbp", "duty", "customs value"),
    "ENTRY_SUMMARY_TARIFF_LINES": ("tariff", "hts", "line no", "duty rate", "mpf", "hmf", "entered value"),
    "OCEAN_FREIGHT": ("ocean freight", "freight charge", "vessel", "container", "bill of lading", "demurrage", "detention"),
    "FREIGHT_FORWARDER_BILL": ("freight forwarder", "freight forwarding", "forwarding agent", "forwarding", "hawb", "mawb", "freight invoice", "origin charges", "destination charges", "handling charges", "air freight", "sea freight", "freight charges", "documentation charges"),
    "CUSTOMER_BROKER_BILL": ("customs broker", "brokerage", "broker fee", "entry number", "customs entry", "entry filing", "disbursement", "duty paid", "customs duty"),
    "GRN_INBOUND": ("goods receipt", "grn", "inbound", "received qty", "warehouse", "po number"),
    "PORT_TO_WH": ("port to wh", "port to warehouse", "transport", "truck", "pickup", "delivery challan"),
    "WH_TO_CUSTOMER": ("wh to customer", "warehouse to customer", "delivery note", "pod", "consignee", "dispatch"),
    "US_SALES_INVOICE": ("commercial invoice", "invoice number", "sold to", "ship to", "ein", "us sales invoice"),
    "US_CARGO_RELEASE_ORDER": ("cargo release", "3461", "entry/immediate delivery", "cbp form 3461", "release date"),
    "US_CUSTOMS_RELEASE_ORDER": ("customs release", "cbp release", "entry number", "customs status", "release order"),
    "US_DELIVERY_ORDER": ("delivery order", "pickup number", "terminal", "container", "last free day", "steamship line"),
    "US_PACKING_LIST": ("packing list", "ship to", "sold to", "carton", "pallet", "net weight", "gross weight"),
    "SHIPPING_BILL": ("shipping bill", "let export order", "iec", "ad code", "dbk", "scheme code", "exporter"),
    "CHA_BILL": ("cha", "custom house agent", "customs house agent", "agency charges", "customs clearance", "container charges", "reimbursement", "cfs charges", "shipping bill charges", "bill of entry charges"),
}

# Only these phrases are allowed to drive auto-detection. Keep this table
# intentionally exclusive: generic words like invoice, charges, container,
# customs clearance, duty, buyer/seller, and entry number are not decisive.
EXCLUSIVE_FINGERPRINTS: dict[str, tuple[str, ...]] = {
    "CHA_BILL": (
        "cha bill",
        "cha invoice",
        "custom house agent",
        "customs house agent",
        "agency charges",
        "cfs charges",
        "shipping bill charges",
        "bill of entry charges",
    ),
    "FREIGHT_FORWARDER_BILL": (
        "freight forwarder",
        "freight forwarding",
        "forwarding agent",
        "hawb",
        "mawb",
        "house air waybill",
        "master air waybill",
        "house bill of lading",
        "master bill of lading",
        "shipment number",
        "consol number",
        "job number",
        "transport mode",
        "shipment type",
        "import customs broker",
    ),
    "CUSTOMER_BROKER_BILL": (
        "customs broker",
        "custom broker",
        "customs broker bill",
        "customs broker invoice",
        "customer broker bill",
        "customer broker invoice",
        "customs brokerage",
        "brokerage invoice",
        "customs broker services",
    ),
    "OCEAN_FREIGHT": (
        "ocean freight",
        "sea freight invoice",
        "freight collect",
        "freight prepaid",
        "demurrage",
        "detention",
    ),
    "PORT_TO_WH": (
        "port to wh",
        "port to warehouse",
        "port transportation",
        "port pickup",
    ),
    "WH_TO_CUSTOMER": (
        "wh to customer",
        "warehouse to customer",
        "proof of delivery",
        "pod number",
    ),
    "BILL_OF_LADING": (
        "bill of lading",
        "bl number",
        "shipped on board",
        "notify party",
        "port of loading",
        "port of discharge",
    ),
    "PACKING_LIST": (
        "packing list",
        "marks and numbers",
        "gross weight",
        "net weight",
        "carton dimensions",
    ),
    "ENTRY_SUMMARY": (
        "entry summary",
        "importer of record",
        "surety number",
        "cbp form 7501",
    ),
    "ENTRY_SUMMARY_TARIFF_LINES": (
        "tariff line",
        "hts number",
        "hts code",
        "mpf",
        "hmf",
    ),
    "GRN_INBOUND": (
        "goods receipt note",
        "grn",
        "inbound receipt",
        "received qty",
    ),
    "US_CARGO_RELEASE_ORDER": (
        "cargo release",
        "cbp form 3461",
        "entry immediate delivery",
    ),
    "US_CUSTOMS_RELEASE_ORDER": (
        "customs release order",
        "cbp release",
        "release order",
    ),
    "US_DELIVERY_ORDER": (
        "delivery order",
        "pickup number",
        "last free day",
        "steamship line",
    ),
    "US_PACKING_LIST": (
        "us packing list",
        "ship to packing list",
        "pallet count",
    ),
    "SHIPPING_BILL": (
        "shipping bill",
        "let export order",
        "ad code",
        "scheme code",
    ),
    "SALES_INVOICE": (
        "tax invoice",
        "irn",
        "eway bill",
        "taxable value",
        "description of goods",
        "hsn code",
    ),
    "US_SALES_INVOICE": (
        "us sales invoice",
        "commercial invoice",
        "ein",
        "sold to",
    ),
}

SALES_INVOICE_REQUIRED_EVIDENCE: tuple[str, ...] = (
    "goods",
    "material",
    "product",
    "description of goods",
    "hsn",
    "quantity",
    "tax invoice",
    "taxable value",
    "igst",
    "cgst",
    "sgst",
    "eway bill",
)

SERVICE_BILL_EVIDENCE: tuple[str, ...] = (
    "agency charges",
    "customs clearance",
    "custom house agent",
    "customs house agent",
    "cfs charges",
    "shipping bill charges",
    "bill of entry charges",
    "freight forwarder",
    "forwarding agent",
    "origin charges",
    "destination charges",
    "handling charges",
    "brokerage",
    "disbursement",
    "transport charges",
    "detention",
    "demurrage",
)

FREIGHT_FORWARDER_DOMINANT_EVIDENCE: tuple[str, ...] = (
    "freight forwarder",
    "freight forwarding",
    "forwarding agent",
    "hawb",
    "mawb",
    "origin charges",
    "destination charges",
    "air freight",
    "sea freight",
)

CUSTOMER_BROKER_DOMINANT_EVIDENCE: tuple[str, ...] = (
    "customs broker",
    "custom broker",
    "customs broker bill",
    "customs broker invoice",
    "customer broker bill",
    "customer broker invoice",
    "customs brokerage",
    "brokerage invoice",
    "customs broker services",
)

CUSTOMER_BROKER_HARD_EVIDENCE: tuple[str, ...] = (
    "customs broker",
    "custom broker",
    "customs broker bill",
    "customs broker invoice",
    "customer broker bill",
    "customer broker invoice",
    "customs brokerage",
    "brokerage invoice",
    "customs broker services",
)

SPECIALIZED_BILL_TYPES: tuple[str, ...] = (
    "CHA_BILL",
    "FREIGHT_FORWARDER_BILL",
    "CUSTOMER_BROKER_BILL",
    "OCEAN_FREIGHT",
    "PORT_TO_WH",
    "WH_TO_CUSTOMER",
)

HIGH_VALUE_FINGERPRINTS: dict[str, dict[str, float]] = {
    "CHA_BILL": {
        "cha": 3.5,
        "custom house agent": 5.0,
        "customs house agent": 5.0,
        "agency charges": 4.0,
        "customs clearance": 1.5,
        "cfs charges": 3.0,
        "shipping bill charges": 3.0,
        "bill of entry charges": 3.0,
    },
    "FREIGHT_FORWARDER_BILL": {
        "freight forwarder": 5.0,
        "freight forwarding": 5.0,
        "forwarding agent": 4.5,
        "forwarding": 2.5,
        "hawb": 3.5,
        "mawb": 3.5,
        "house air waybill": 4.0,
        "master air waybill": 4.0,
        "house bill of lading": 3.5,
        "master bill of lading": 3.5,
        "shipment number": 3.0,
        "consol number": 4.0,
        "job number": 3.0,
        "transport mode": 3.0,
        "shipment type": 3.0,
        "import customs broker": 3.5,
        "origin charges": 3.5,
        "destination charges": 3.5,
        "freight invoice": 3.0,
        "air freight": 3.0,
        "sea freight": 3.0,
        "freight charges": 2.5,
        "documentation charges": 2.0,
    },
    "CUSTOMER_BROKER_BILL": {
        "customs broker": 5.0,
        "custom broker": 5.0,
        "customs broker bill": 5.0,
        "customs broker invoice": 5.0,
        "customer broker bill": 5.0,
        "customer broker invoice": 5.0,
        "customs brokerage": 4.5,
        "brokerage invoice": 4.0,
        "customs broker services": 4.5,
    },
    "SALES_INVOICE": {
        "tax invoice": 2.5,
        "gstin": 2.0,
        "irn": 2.0,
        "taxable value": 2.0,
        "eway bill": 2.0,
        "buyer": 1.0,
        "seller": 1.0,
    },
}


def _normalize_chat_completions_url(raw_url: str) -> str:
    url = (raw_url or "").strip() or DEFAULT_CLASSIFIER_URL
    normalized = url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


def _classifier_config() -> tuple[str, str, str]:
    api_key = (settings.DOC_CLASSIFIER_API_KEY or "").strip()
    model = (settings.DOC_CLASSIFIER_MODEL or "").strip()
    api_url = _normalize_chat_completions_url(settings.DOC_CLASSIFIER_API_URL)
    if not api_key:
        raise RuntimeError("Missing DOC_CLASSIFIER_API_KEY")
    if not model:
        raise RuntimeError("Missing DOC_CLASSIFIER_MODEL")
    return api_key, api_url, model


def _split_field_tokens(field_name: str) -> set[str]:
    normalized = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", field_name)
    return {token.lower() for token in re.split(r"[^A-Za-z0-9]+", normalized) if len(token) >= 3}


def _field_to_phrase(field_name: str) -> str:
    without_array = re.sub(r"\[\]", " ", field_name)
    without_path = without_array.replace(".", " ")
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", without_path)
    return _normalize_search_text(spaced)


def _phrase_priority(phrase: str) -> tuple[int, int]:
    tokens = phrase.split()
    return (len(tokens), len(phrase))


@lru_cache(maxsize=1)
def _build_schema_fingerprints() -> dict[str, list[str]]:
    all_fields: dict[str, list[str]] = {}
    token_doc_counts: dict[str, int] = {}

    for candidate in CLASSIFIER_CANDIDATES:
        try:
            schema = load_extraction_schema(parent_model=candidate.prisma_model)
        except Exception:
            all_fields[candidate.doc_type] = []
            continue
        fields = [field for field in schema.scalar_fields if field != "documentType"]
        fields.extend(schema.array_fields)
        for array_name, item_fields in schema.array_item_fields.items():
            fields.extend(f"{array_name}.{field}" for field in item_fields[:5])
        deduped = list(dict.fromkeys(fields))
        all_fields[candidate.doc_type] = deduped
        seen_tokens: set[str] = set()
        for field in deduped:
            seen_tokens.update(_split_field_tokens(field))
        for token in seen_tokens:
            token_doc_counts[token] = token_doc_counts.get(token, 0) + 1

    fingerprints: dict[str, list[str]] = {}
    for doc_type, fields in all_fields.items():
        def score(field: str) -> tuple[int, int]:
            tokens = _split_field_tokens(field)
            unique_count = sum(1 for token in tokens if token_doc_counts.get(token, 0) <= 2)
            return (unique_count, len(tokens))

        ranked = sorted(fields, key=score, reverse=True)
        fingerprints[doc_type] = ranked[:MAX_FIELD_HINTS]
    return fingerprints


@lru_cache(maxsize=1)
def _build_global_score_phrases() -> dict[str, dict[str, float]]:
    phrase_docs: dict[str, set[str]] = {}
    doc_phrases: dict[str, set[str]] = {}

    for candidate in CLASSIFIER_CANDIDATES:
        phrases: set[str] = set()
        try:
            schema = load_extraction_schema(parent_model=candidate.prisma_model)
            fields = [field for field in schema.scalar_fields if field != "documentType"]
            fields.extend(schema.array_fields)
            for array_name, item_fields in schema.array_item_fields.items():
                fields.extend(f"{array_name}.{field}" for field in item_fields)
            for field in fields:
                phrase = _field_to_phrase(field)
                if len(phrase) >= 4:
                    phrases.add(phrase)
        except Exception:
            pass

        phrases.update(_normalize_search_text(phrase) for phrase in CURATED_FINGERPRINTS.get(candidate.doc_type, ()))
        phrases.update(_normalize_search_text(phrase) for phrase in EXCLUSIVE_FINGERPRINTS.get(candidate.doc_type, ()))
        phrases = {phrase for phrase in phrases if phrase}
        doc_phrases[candidate.doc_type] = phrases
        for phrase in phrases:
            phrase_docs.setdefault(phrase, set()).add(candidate.doc_type)

    weighted: dict[str, dict[str, float]] = {}
    for candidate in CLASSIFIER_CANDIDATES:
        phrase_weights: dict[str, float] = {}
        ranked_phrases = sorted(
            doc_phrases.get(candidate.doc_type, ()),
            key=lambda phrase: (len(phrase_docs.get(phrase, ())), -_phrase_priority(phrase)[0], -_phrase_priority(phrase)[1]),
        )
        for phrase in ranked_phrases[:MAX_SCORE_PHRASES_PER_DOC]:
            doc_count = max(1, len(phrase_docs.get(phrase, ())))
            token_count = len(phrase.split())
            if phrase in HIGH_VALUE_FINGERPRINTS.get(candidate.doc_type, {}):
                weight = HIGH_VALUE_FINGERPRINTS[candidate.doc_type][phrase]
            elif phrase in {_normalize_search_text(item) for item in EXCLUSIVE_FINGERPRINTS.get(candidate.doc_type, ())}:
                weight = 4.0 / doc_count
            elif phrase in {_normalize_search_text(item) for item in CURATED_FINGERPRINTS.get(candidate.doc_type, ())}:
                weight = 2.0 / doc_count
            elif doc_count == 1:
                weight = 2.5 if token_count >= 2 else 1.4
            elif doc_count == 2:
                weight = 1.0
            else:
                weight = 0.25
            phrase_weights[phrase] = max(phrase_weights.get(phrase, 0.0), weight)
        weighted[candidate.doc_type] = phrase_weights
    return weighted


def _score_all_documents(haystack: str) -> list[tuple[float, str, list[str]]]:
    scores: list[tuple[float, str, list[str]]] = []
    has_service_evidence = any(_contains_phrase(haystack, phrase) for phrase in SERVICE_BILL_EVIDENCE)
    has_goods_sale_evidence = any(_contains_phrase(haystack, phrase) for phrase in SALES_INVOICE_REQUIRED_EVIDENCE)
    has_freight_forwarder_evidence = any(_contains_phrase(haystack, phrase) for phrase in FREIGHT_FORWARDER_DOMINANT_EVIDENCE)
    has_customer_broker_hard_evidence = any(_contains_phrase(haystack, phrase) for phrase in CUSTOMER_BROKER_HARD_EVIDENCE)

    for candidate in CLASSIFIER_CANDIDATES:
        matched: list[str] = []
        score = 0.0
        for phrase, weight in _build_global_score_phrases().get(candidate.doc_type, {}).items():
            if _contains_phrase(haystack, phrase):
                matched.append(phrase)
                score += weight

        if candidate.doc_type in {"SALES_INVOICE", "US_SALES_INVOICE"}:
            if has_service_evidence:
                score *= 0.25
            if not has_goods_sale_evidence:
                score *= 0.45
        elif candidate.doc_type == "CUSTOMER_BROKER_BILL":
            if not has_customer_broker_hard_evidence:
                score *= 0.2
            if has_freight_forwarder_evidence:
                score *= 0.45
        elif candidate.doc_type == "FREIGHT_FORWARDER_BILL" and has_freight_forwarder_evidence:
            score += 3.0

        matched.sort(key=lambda phrase: _build_global_score_phrases().get(candidate.doc_type, {}).get(phrase, 0.0), reverse=True)
        scores.append((score, candidate.doc_type, matched[:12]))

    scores.sort(reverse=True)
    return scores


def _safe_schema_fields(parent_model: str) -> list[str]:
    try:
        schema = load_extraction_schema(parent_model=parent_model)
    except Exception:
        return []
    fields = list(schema.scalar_fields)
    for array_name, item_fields in schema.array_item_fields.items():
        fields.append(array_name)
        fields.extend(f"{array_name}.{field}" for field in item_fields[:8])
    return [field for field in fields if field != "documentType"][:MAX_FIELD_HINTS]


def _build_candidate_payload() -> list[dict[str, Any]]:
    return [
        {
            "docType": candidate.doc_type,
            "label": candidate.label,
            "scoreFields": list(_build_global_score_phrases().get(candidate.doc_type, {}).keys())[:18],
            "exclusiveFingerprints": list(EXCLUSIVE_FINGERPRINTS.get(candidate.doc_type, ()))[:8],
        }
        for candidate in CLASSIFIER_CANDIDATES
    ]


def _extract_pdf_text(file_bytes: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(file_bytes))
    except Exception:
        return ""
    chunks: list[str] = []
    for page in reader.pages[:3]:
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        if text.strip():
            chunks.append(text.strip())
    return "\n\n".join(chunks)[:MAX_TEXT_CHARS]


def _image_part(image_bytes: bytes, mime_type: str) -> dict[str, Any]:
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    return {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{encoded}"}}


def _compressed_image_part(image: Image.Image) -> dict[str, Any]:
    converted = image.convert("RGB")
    converted.thumbnail((CLASSIFIER_IMAGE_MAX_EDGE, CLASSIFIER_IMAGE_MAX_EDGE))
    buffer = BytesIO()
    converted.save(buffer, format="JPEG", quality=CLASSIFIER_IMAGE_JPEG_QUALITY, optimize=True)
    return _image_part(buffer.getvalue(), "image/jpeg")


def _document_image_parts(file_bytes: bytes, *, file_name: str, content_type: str) -> list[dict[str, Any]]:
    lower_name = file_name.lower()
    if content_type.startswith("image/"):
        try:
            return [_compressed_image_part(Image.open(BytesIO(file_bytes)))]
        except Exception:
            return [_image_part(file_bytes[:1_500_000], content_type)]
    if not (content_type == "application/pdf" or lower_name.endswith(".pdf")):
        return []
    poppler_path = _resolve_poppler_path()
    if poppler_path == "":
        return []
    try:
        pages = convert_from_bytes(
            file_bytes,
            dpi=CLASSIFIER_IMAGE_DPI,
            first_page=1,
            last_page=1,
            poppler_path=poppler_path,
        )
    except Exception:
        return []
    return [_compressed_image_part(page) for page in pages[:1]]


def _extract_json(text: str) -> dict[str, Any]:
    cleaned = (text or "").strip()
    if not cleaned:
        raise ValueError("Empty classifier response")
    candidates = [cleaned, cleaned.replace("```json", "").replace("```JSON", "").replace("```", "").strip()]
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        candidates.append(cleaned[start : end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue
    raise ValueError("Classifier response did not contain a JSON object")


def _coerce_result(payload: dict[str, Any]) -> ClassificationResult:
    allowed = {candidate.doc_type: candidate for candidate in CLASSIFIER_CANDIDATES}
    doc_type = str(payload.get("docType") or payload.get("doc_type") or "").strip().upper()
    if doc_type not in allowed:
        raise ValueError(f"Classifier returned unsupported docType: {doc_type!r}")
    confidence_raw = payload.get("confidence", 0)
    try:
        confidence = float(confidence_raw)
    except Exception:
        confidence = 0.0
    if confidence > 1:
        confidence = confidence / 100
    matched_fields = payload.get("matchedFields") or payload.get("matched_fields") or []
    if not isinstance(matched_fields, list):
        matched_fields = []
    alternatives = payload.get("alternatives") or []
    if not isinstance(alternatives, list):
        alternatives = []
    return ClassificationResult(
        doc_type=doc_type,
        label=allowed[doc_type].label,
        confidence=max(0.0, min(1.0, confidence)),
        reasoning=str(payload.get("reasoning") or payload.get("reason") or "").strip(),
        matched_fields=[str(field) for field in matched_fields[:12]],
        alternatives=[item for item in alternatives[:5] if isinstance(item, dict)],
    )


def _normalize_search_text(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text.lower())).strip()


def _contains_phrase(haystack: str, phrase: str) -> bool:
    normalized_phrase = _normalize_search_text(phrase)
    if not normalized_phrase:
        return False
    return f" {normalized_phrase} " in f" {haystack} "


def _score_fingerprint_text(haystack: str) -> list[tuple[float, str, list[str]]]:
    return _score_all_documents(haystack)


def _classification_from_scores(
    scores: list[tuple[float, str, list[str]]],
    *,
    reasoning: str,
    min_score: float = 2.5,
) -> ClassificationResult | None:
    if not scores:
        return None
    best_score, best_type, best_matches = scores[0]
    second_score = scores[1][0] if len(scores) > 1 else 0.0

    if best_score < min_score or best_score <= second_score:
        return None

    candidate = next(item for item in CLASSIFIER_CANDIDATES if item.doc_type == best_type)
    confidence = min(0.97, 0.68 + (best_score * 0.05))
    return ClassificationResult(
        doc_type=candidate.doc_type,
        label=candidate.label,
        confidence=confidence,
        reasoning=reasoning,
        matched_fields=best_matches[:8],
        alternatives=[
            {"docType": doc_type, "confidence": max(0.05, min(0.55, score * 0.08))}
            for score, doc_type, _ in scores
            if doc_type != best_type and score > 0
        ][:3],
    )


def _keyword_classify(*, file_name: str, extracted_text: str) -> ClassificationResult | None:
    haystack = _normalize_search_text(f"{file_name} {extracted_text[:MAX_TEXT_CHARS]}")
    if not haystack:
        return None

    return _classification_from_scores(
        _score_fingerprint_text(haystack),
        reasoning="Scored all document types using Prisma fields and weighted fingerprints; selected the highest score.",
    )


def _correct_model_result(
    *,
    result: ClassificationResult,
    file_name: str,
    extracted_text: str,
) -> ClassificationResult:
    source_haystack = _normalize_search_text(f"{file_name} {extracted_text[:MAX_TEXT_CHARS]}")
    source_scores = _score_fingerprint_text(source_haystack)
    source_corrected = _classification_from_scores(
        source_scores,
        reasoning=f"Scored all document types from source text after model response. Original docType={result.doc_type}.",
        min_score=2.5,
    )
    if source_corrected is not None:
        return source_corrected

    evidence_text = " ".join(
        [
            file_name,
            extracted_text[:MAX_TEXT_CHARS],
            result.reasoning,
            " ".join(result.matched_fields),
            " ".join(str(item.get("docType", "")) for item in result.alternatives if isinstance(item, dict)),
        ]
    )
    haystack = _normalize_search_text(evidence_text)

    corrected = _classification_from_scores(
        _score_fingerprint_text(haystack),
        reasoning=f"Scored all document types using model evidence. Original docType={result.doc_type}.",
        min_score=3.0,
    )
    if corrected is None:
        return result
    return corrected


def classify_document_bytes(*, file_bytes: bytes, file_name: str, content_type: str) -> ClassificationResult:
    extracted_text = _extract_pdf_text(file_bytes) if content_type == "application/pdf" or file_name.lower().endswith(".pdf") else ""
    quick_result = _keyword_classify(file_name=file_name, extracted_text=extracted_text)
    if quick_result is not None:
        return quick_result

    api_key, api_url, model = _classifier_config()
    prompt = (
        "Classify the uploaded logistics document into exactly one supported docType. "
        "Score every supported docType against the uploaded document using the Prisma-derived scoreFields and fingerprints below. "
        "Choose the docType with the highest total evidence score. Ignore generic overlapping words like invoice, charges, total, container, customs clearance, duty, entry number, buyer, and seller unless stronger unique fields are also present:\n"
        f"{json.dumps(_build_candidate_payload(), separators=(',', ':'), ensure_ascii=False)}\n\n"
        "Decision rules:\n"
        "0. Compare ALL docTypes together in one scoring pass. Do not classify sequentially. Pick the highest score and include top alternatives.\n"
        "1. SALES_INVOICE is only for sale of goods/materials/products, usually with buyer/seller, HSN, quantity, taxable value, GST/tax totals.\n"
        "2. Do not choose SALES_INVOICE just because the page says invoice, tax invoice, invoice no, bill to, GST, or total.\n"
        "3. If the invoice is for customs clearance, CHA, custom house agent, CFS, bill of entry, shipping bill charges, or reimbursements, choose CHA_BILL.\n"
        "4. If the invoice is for freight forwarding, freight forwarder, forwarding agent, HAWB, MAWB, origin/destination/handling/freight/documentation charges, choose FREIGHT_FORWARDER_BILL even if customs clearance is also mentioned.\n"
        "5. Choose CUSTOMER_BROKER_BILL only when literal broker identity wording is present in the document source: customs broker, custom broker, customs broker bill, customs broker invoice, customer broker bill, customer broker invoice, customs brokerage, brokerage invoice, or customs broker services.\n"
        "6. Never choose CUSTOMER_BROKER_BILL from brokerage line item, broker reference, customs clearance, customs entry, invoice, charges, entry number, duty, container, or disbursement alone.\n"
        "7. Prefer the specialized service-bill type over SALES_INVOICE whenever both are plausible.\n"
        "8. Do not use a docType unless at least one exclusive fingerprint for that docType is present or visually obvious.\n"
        "Return terse JSON only: docType, confidence, reasoning, matchedFields, alternatives."
    )
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    image_parts = [] if extracted_text else _document_image_parts(file_bytes, file_name=file_name, content_type=content_type)
    content.extend(image_parts)
    if extracted_text:
        content.append({"type": "text", "text": f"Text extracted from the first pages:\n{extracted_text}"})
    if not image_parts and not extracted_text:
        encoded = base64.b64encode(file_bytes[:2_500_000]).decode("utf-8")
        content.append({"type": "text", "text": f"File name: {file_name}\nContent type: {content_type}\nBase64 prefix: {encoded}"})

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }
    req = request.Request(
        url=api_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=180) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Document classifier provider error {exc.code}: {detail or exc.reason}") from exc

    choices = response_payload.get("choices") or []
    if not choices:
        raise RuntimeError("Document classifier returned no choices")
    message = choices[0].get("message") or {}
    raw_content = message.get("content", "")
    if isinstance(raw_content, list):
        text = "".join(part.get("text", "") for part in raw_content if isinstance(part, dict))
    else:
        text = str(raw_content or "")
    return _correct_model_result(
        result=_coerce_result(_extract_json(text)),
        file_name=file_name,
        extracted_text=extracted_text,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Classify a logistics document using DOC_CLASSIFIER_* settings.")
    parser.add_argument("file", type=Path)
    parser.add_argument("--content-type", default="")
    args = parser.parse_args()
    file_bytes = args.file.read_bytes()
    result = classify_document_bytes(
        file_bytes=file_bytes,
        file_name=args.file.name,
        content_type=args.content_type or "application/octet-stream",
    )
    print(json.dumps(result.__dict__, indent=2))


if __name__ == "__main__":
    main()
