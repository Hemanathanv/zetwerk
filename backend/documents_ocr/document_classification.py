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
import fitz

from helpers.config import settings
from documents_ocr.schema_loader import load_extraction_schema


DEFAULT_CLASSIFIER_MODEL = "google/gemini-2.5-flash-lite"
DEFAULT_CLASSIFIER_URL = "https://openrouter.ai/api/v1/chat/completions"
LOCAL_POPPLER_BIN = Path(__file__).resolve().parents[1] / "poppler" / "Library" / "bin"
LINUX_POPPLER_BIN = Path("/usr/bin")
MAX_FIELD_HINTS = 7
MAX_TEXT_CHARS = 2500
MAX_MODEL_SCORE_FIELDS = 24
MIN_CLASSIFICATION_SCORE = 1.0
MIN_CLASSIFICATION_GAP = 0.5
CLASSIFIER_IMAGE_DPI = 150
CLASSIFIER_IMAGE_MAX_EDGE = 1400
CLASSIFIER_IMAGE_JPEG_QUALITY = 55
CLASSIFIER_MAX_OUTPUT_TOKENS = 900


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
    ClassifierCandidate("CUSTOMER_BROKER_BILL", "Customs Broker Bill", "CustomerBrokerBillExtraction"),
    ClassifierCandidate("OCEAN_FREIGHT", "Ocean Freight", "OceanFreightExtraction"),
    ClassifierCandidate("PORT_TO_WH", "Port to WH", "PortToWhExtraction"),
    ClassifierCandidate("WH_TO_CUSTOMER", "WH to Customer", "WhToCustomerExtraction"),
    ClassifierCandidate("BILL_OF_LADING", "Bill of Lading", "BillOfLading"),
    ClassifierCandidate("PACKING_LIST", "Packing List", "PackingListExtraction"),
    ClassifierCandidate("ENTRY_SUMMARY", "CBP FORM-7501", "EntrySummaryExtraction"),
    ClassifierCandidate("GRN_INBOUND", "GRN Inbound", "GrnInboundExtraction"),
    ClassifierCandidate("US_CARGO_RELEASE_ORDER", "US Cargo Release Order", "UsCargoReleaseExtraction"),
    ClassifierCandidate("US_CUSTOMS_RELEASE_ORDER", "US Customs Release Order", "UsCustomsReleaseExtraction"),
    ClassifierCandidate("US_DELIVERY_ORDER", "US Delivery Order", "UsDeliveryOrderExtraction"),
    ClassifierCandidate("US_PACKING_LIST", "US Packing List", "UsPackingListExtraction"),
    ClassifierCandidate("ISF", "Importer Security Filing (ISF)", "IsfExtraction"),
    ClassifierCandidate("SHIPPING_BILL", "Shipping Bill", "ShippingBillExtraction"),
    ClassifierCandidate("SALES_INVOICE", "Sales Invoice", "SalesInvoiceExtraction"),
    ClassifierCandidate("US_SALES_INVOICE", "US Sales Invoice", "UsSalesInvoiceExtraction"),
)

CURATED_FINGERPRINTS: dict[str, tuple[str, ...]] = {
    "SALES_INVOICE": ("tax invoice", "buyer", "seller", "gstin", "irn", "taxable value", "eway bill"),
    "BILL_OF_LADING": ("bill of lading", "bl number", "vessel", "voyage", "notify party", "port of loading", "place of delivery"),
    "PACKING_LIST": ("packing list", "net weight", "gross weight", "package", "marks and numbers", "carton", "dimensions"),
    "ENTRY_SUMMARY": (
        "entry summary", "entry number", "importer of record", "surety", "cbp",
        "cbp form 7501", "duty", "customs value", "tariff", "hts", "line no",
        "duty rate", "mpf", "hmf", "entered value",
    ),
    "OCEAN_FREIGHT": ("ocean freight", "freight charge", "vessel", "container", "bill of lading", "demurrage", "detention"),
    "FREIGHT_FORWARDER_BILL": ("freight forwarder", "freight forwarding", "forwarding agent", "forwarding", "hawb", "mawb", "freight invoice", "origin charges", "destination charges", "handling charges", "air freight", "sea freight", "freight charges", "documentation charges"),
    "CUSTOMER_BROKER_BILL": ("customs broker", "custom broker", "customes broker", "brokerage", "broker fee", "entry number", "customs entry", "entry filing", "disbursement", "duty paid", "customs duty"),
    "GRN_INBOUND": ("goods receipt", "grn", "inbound", "received qty", "warehouse", "po number"),
    "PORT_TO_WH": ("port to wh", "port to warehouse", "transport", "truck", "pickup", "delivery challan"),
    "WH_TO_CUSTOMER": ("wh to customer", "warehouse to customer", "delivery note", "pod", "consignee", "dispatch"),
    "US_SALES_INVOICE": ("commercial invoice", "invoice number", "sold to", "ship to", "ein", "us sales invoice"),
    "US_CARGO_RELEASE_ORDER": ("cargo release", "3461", "entry/immediate delivery", "cbp form 3461", "release date"),
    "US_CUSTOMS_RELEASE_ORDER": ("customs release", "cbp release", "entry number", "customs status", "release order"),
    "US_DELIVERY_ORDER": ("delivery order", "pickup number", "terminal", "container", "last free day", "steamship line"),
    "US_PACKING_LIST": ("packing list", "ship to", "sold to", "carton", "pallet", "net weight", "gross weight"),
    "ISF": ("importer security filing", "isf 10+2", "isf shipment and filer reference", "agent/filer code", "have a bond with cbp", "manufacturer of goods"),
    "SHIPPING_BILL": ("shipping bill", "let export order", "iec", "ad code", "dbk", "scheme code", "exporter"),
    "CHA_BILL": ("cha", "tax inv", "tax invoice", "custom house agent", "customs house agent", "agency charges", "customs clearance", "container charges", "reimbursement", "cfs charges", "shipping bill charges", "bill of entry charges"),
}

DETECTION_SUPPORTING_FINGERPRINTS: dict[str, tuple[str, ...]] = {
    "CHA_BILL": (
        "tax invoice",
        "customs clearance",
        "container charges",
        "reimbursement",
        "detention",
        "transport",
    ),
    "FREIGHT_FORWARDER_BILL": (
        "shipment number",
        "consol number",
        "job number",
        "transport mode",
        "shipment type",
        "house bill of lading",
        "master bill of lading",
        "origin charges",
        "destination charges",
        "handling charges",
        "freight charges",
        "documentation charges",
    ),
    "CUSTOMER_BROKER_BILL": (
        "entry number",
        "customs entry",
        "entry filing",
        "duty paid",
        "customs duty",
        "disbursement",
        "broker fee",
        "brokerage",
        "remit to",
    ),
    "OCEAN_FREIGHT": (
        "vessel",
        "container",
        "bill of lading",
        "freight charge",
        "freight invoice",
    ),
    "PORT_TO_WH": (
        "truck",
        "pickup",
        "delivery challan",
        "transport charges",
        "port",
        "warehouse",
    ),
    "WH_TO_CUSTOMER": (
        "delivery note",
        "consignee",
        "dispatch",
        "delivery",
        "customer",
    ),
    "BILL_OF_LADING": (
        "vessel",
        "voyage",
        "container",
        "place of delivery",
        "shipper",
        "consignee",
    ),
    "PACKING_LIST": (
        "package",
        "carton",
        "dimensions",
        "pieces",
        "pallet",
    ),
    "ENTRY_SUMMARY": (
        "entry summary",
        "entry number",
        "duty",
        "customs value",
        "entered value",
        "mpf",
        "hmf",
    ),
    "GRN_INBOUND": (
        "warehouse",
        "po number",
        "received",
        "receipt",
    ),
    "US_CARGO_RELEASE_ORDER": (
        "release date",
        "entry number",
        "customs",
    ),
    "US_CUSTOMS_RELEASE_ORDER": (
        "customs status",
        "entry number",
        "release",
    ),
    "US_DELIVERY_ORDER": (
        "terminal",
        "container",
        "steamship line",
        "last free day",
    ),
    "US_PACKING_LIST": (
        "carton",
        "pallet",
        "net weight",
        "gross weight",
    ),
    "SHIPPING_BILL": (
        "iec",
        "ad code",
        "dbk",
        "exporter",
    ),
    "SALES_INVOICE": (
        "tax invoice",
        "buyer",
        "seller",
        "gstin",
        "quantity",
        "taxable value",
    ),
    "US_SALES_INVOICE": (
        "invoice number",
        "sold to",
        "ship to",
        "ein",
    ),
}

# These phrases are allowed to decide the document type. Keep this table
# intentionally narrow: generic words like invoice, charges, vessel, packages,
# duty, entry number, buyer/seller, and container are supporting evidence only.
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
    ),
    "CUSTOMER_BROKER_BILL": (
        "customs broker",
        "custom broker",
        "customes broker",
        "custom broker services",
        "customes broker bill",
        "custom broker invoice",
        "customes broker invoice",
        "customs broker bill",
        "customs broker invoice",
        "customs brokerage",
        "customs brokerage invoice",
        "brokerage invoice",
        "broker invoice",
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
        "b l number",
        "shipped on board",
        "original bill of lading",
        "negotiable bill of lading",
        "non negotiable bill of lading",
    ),
    "PACKING_LIST": (
        "packing list",
        "marks and numbers",
        "gross weight",
        "net weight",
        "carton dimensions",
    ),
    "ENTRY_SUMMARY": (
        "importer of record",
        "surety number",
        "cbp form 7501",
        "form 7501",
        "filer code entry number",
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
    "ISF": (
        "importer security filing",
        "isf 10 2",
        "isf shipment and filer reference",
        "isf transaction number",
        "agent filer code",
        "manufacturer of goods",
        "container stuffing location",
        "consolidator stuffer",
    ),
    "SHIPPING_BILL": (
        "shipping bill",
        "let export order",
        "ad code",
        "scheme code",
    ),
    "SALES_INVOICE": (
        "irn",
        "eway bill",
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

GOODS_SALE_CONTENT_EVIDENCE: tuple[str, ...] = (
    "goods",
    "material",
    "product",
    "description of goods",
    "hsn",
    "hsn code",
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

BILLING_DOCUMENT_EVIDENCE: tuple[str, ...] = (
    "inv",
    "invoice",
    "tax invoice",
    "invoice number",
    "invoice date",
    "total amount",
    "amount due",
    "remit to",
    "payment terms",
    "disbursement",
    "duty paid",
)

CUSTOMER_BROKER_BILLING_PATTERN_EVIDENCE: tuple[str, ...] = (
    "entry summary",
    "entry number",
    "customs entry",
    "entry filing",
    "duty",
    "duty paid",
    "customs duty",
    "cbp",
    "disbursement",
    "brokerage",
    "broker fee",
)

CUSTOMER_BROKER_STRONG_BILLING_EVIDENCE: tuple[str, ...] = (
    "customs entry",
    "entry filing",
    "duty paid",
    "customs duty",
    "disbursement",
    "brokerage",
    "broker fee",
)

ENTRY_SUMMARY_STRONG_EVIDENCE: tuple[str, ...] = (
    "surety number",
    "cbp form 7501",
    "form 7501",
    "filer code entry number",
)

BILL_OF_LADING_TRANSPORT_EVIDENCE: tuple[str, ...] = (
    "bl number",
    "b l number",
    "shipped on board",
    "original bill of lading",
    "negotiable bill of lading",
    "non negotiable bill of lading",
)

BILL_OF_LADING_REFERENCE_ONLY_EVIDENCE: tuple[str, ...] = (
    "hbl",
    "mbl",
    "house bol",
    "ocean bol",
    "house bill of lading",
    "master bill of lading",
    "ocean bill of lading",
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

FREIGHT_FORWARDER_STRUCTURAL_EVIDENCE: tuple[str, ...] = (
    "customer id",
    "client gid",
    "customer client gid",
    "client gstin",
    "client pan",
    "attention",
    "shipment",
    "shipment number",
    "consol number",
    "job number",
    "transport mode",
    "shipment type",
)


def _has_freight_forwarder_structure(haystack: str) -> bool:
    has_shipment_anchor = any(
        _contains_phrase(haystack, phrase)
        for phrase in ("shipment", "shipment number", "consol number", "job number")
    )
    matched = sum(
        _contains_phrase(haystack, phrase)
        for phrase in FREIGHT_FORWARDER_STRUCTURAL_EVIDENCE
    )
    return has_shipment_anchor and matched >= 3


CUSTOMER_BROKER_DOMINANT_EVIDENCE: tuple[str, ...] = (
    "customs broker",
    "custom broker",
    "customes broker",
    "customs broker bill",
    "customs broker invoice",
    "customs brokerage",
    "brokerage invoice",
    "customs broker services",
)

CUSTOMER_BROKER_HARD_EVIDENCE: tuple[str, ...] = (
    "customs broker",
    "custom broker",
    "customes broker",
    "customs broker bill",
    "customs broker invoice",
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
        "tax inv": 1.5,
        "tax invoice": 1.5,
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
        "shipment": 2.5,
        "consol number": 4.0,
        "job number": 3.0,
        "transport mode": 3.0,
        "shipment type": 3.0,
        "customer id": 2.0,
        "client gid": 3.0,
        "client gstin": 2.0,
        "client pan": 2.0,
        "attention": 1.5,
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
        "customes broker": 5.0,
        "custom broker services": 5.0,
        "customes broker bill": 5.0,
        "custom broker invoice": 5.0,
        "customes broker invoice": 5.0,
        "customs broker bill": 5.0,
        "customs broker invoice": 5.0,
        "customs brokerage": 4.5,
        "customs brokerage invoice": 5.0,
        "brokerage invoice": 4.0,
        "broker invoice": 3.5,
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

CUSTOMER_BROKER_IDENTITY_EVIDENCE: tuple[str, ...] = (
    "customs broker",
    "custom broker",
    "customes broker",
    "custom broker services",
    "customes broker bill",
    "custom broker invoice",
    "customes broker invoice",
    "customs broker bill",
    "customs broker invoice",
    "customs brokerage",
    "customs brokerage invoice",
    "brokerage invoice",
    "broker invoice",
    "customs broker services",
    "broker fee",
)

CUSTOMER_BROKER_DOCUMENT_IDENTITY_EVIDENCE: tuple[str, ...] = (
    "custom broker services",
    "customes broker bill",
    "custom broker invoice",
    "customes broker invoice",
    "customs broker bill",
    "customs broker invoice",
    "customs brokerage",
    "customs brokerage invoice",
    "brokerage invoice",
    "broker invoice",
    "customs broker services",
    "broker fee",
)

CHA_IDENTITY_EVIDENCE: tuple[str, ...] = (
    "cha",
    "cha bill",
    "cha invoice",
    "custom house agent",
    "customs house agent",
)

CHA_DECISIVE_EVIDENCE: tuple[str, ...] = tuple(
    dict.fromkeys(
        (
            "cha",
            *EXCLUSIVE_FINGERPRINTS["CHA_BILL"],
        )
    )
)

CHA_STRONG_SERVICE_EVIDENCE: tuple[str, ...] = (
    "custom house agent",
    "customs house agent",
    "agency charges",
    "cfs charges",
    "shipping bill charges",
    "bill of entry charges",
)

ENTRY_SUMMARY_DECISIVE_EVIDENCE: tuple[str, ...] = EXCLUSIVE_FINGERPRINTS["ENTRY_SUMMARY"]
BILL_OF_LADING_DECISIVE_EVIDENCE: tuple[str, ...] = EXCLUSIVE_FINGERPRINTS["BILL_OF_LADING"]
OCEAN_FREIGHT_DECISIVE_EVIDENCE: tuple[str, ...] = EXCLUSIVE_FINGERPRINTS["OCEAN_FREIGHT"]

US_DOC_TYPE_REQUIRED_EVIDENCE: dict[str, tuple[str, ...]] = {
    "US_SALES_INVOICE": (
        "us sales invoice",
        "ein",
        "sold to",
        "ship to",
    ),
    "US_PACKING_LIST": (
        "us packing list",
        "sold to",
        "ship to",
    ),
}

MANUAL_DISTINCT_FIELDS: dict[str, tuple[str, ...]] = {
    "FREIGHT_FORWARDER_BILL": (
        "shipment number",
        "consol number",
        "job number",
        "transport mode",
        "shipment type",
        "import customs broker",
        "house bol",
        "ocean bol",
        "mawb",
        "hawb",
        "freight charges",
        "documentation charges",
        "origin charges",
        "destination charges",
    ),
    "CUSTOMER_BROKER_BILL": (
        "customs brokerage",
        "customs broker invoice",
        "customs broker services",
        "brokerage invoice",
        "broker invoice",
        "broker fee",
        "declaration number",
        "entry number",
        "duty paid",
        "disbursement",
        "remit to",
    ),
}


def _is_native_gemini_url(raw_url: str) -> bool:
    normalized = (raw_url or "").strip().lower()
    return (
        "generativelanguage.googleapis.com" in normalized
        and "/openai" not in normalized
        and not normalized.endswith("/chat/completions")
    )


def _normalize_chat_completions_url(raw_url: str) -> str:
    url = (raw_url or "").strip() or DEFAULT_CLASSIFIER_URL
    normalized = url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


def _normalize_gemini_url(raw_url: str, model: str) -> str:
    normalized = (raw_url or "").strip().rstrip("/")
    normalized = normalized.replace("{model}", model)
    if ":generateContent" in normalized:
        return normalized
    if re.search(r"/models/[^/?]+$", normalized):
        return f"{normalized}:generateContent"
    if normalized.endswith("/models"):
        return f"{normalized}/{model}:generateContent"
    if normalized.endswith("/v1") or normalized.endswith("/v1beta"):
        return f"{normalized}/models/{model}:generateContent"
    return f"{normalized}/v1beta/models/{model}:generateContent"


def _openrouter_classifier_model(raw_model: str) -> str:
    model = (raw_model or "").strip()
    if not model or model == (settings.OPENROUTER_MODEL_PRO or "").strip():
        return DEFAULT_CLASSIFIER_MODEL
    if model.startswith("gemini-"):
        return DEFAULT_CLASSIFIER_MODEL
    return model


def _classifier_config() -> tuple[str, str, str, str]:
    openrouter_api_key = (settings.OPENROUTER_API_KEY or "").strip()
    if openrouter_api_key:
        model = _openrouter_classifier_model(settings.DOC_CLASSIFIER_MODEL)
        raw_url = (settings.OPENROUTER_API_URL or "").strip() or DEFAULT_CLASSIFIER_URL
        return openrouter_api_key, _normalize_chat_completions_url(raw_url), model, "openai-compatible"

    api_key = (settings.DOC_CLASSIFIER_API_KEY or "").strip()
    model = (settings.DOC_CLASSIFIER_MODEL or "").strip() or DEFAULT_CLASSIFIER_MODEL
    raw_url = (settings.DOC_CLASSIFIER_API_URL or "").strip() or DEFAULT_CLASSIFIER_URL
    provider = "gemini" if _is_native_gemini_url(raw_url) else "openai-compatible"
    api_url = (
        _normalize_gemini_url(raw_url, model)
        if provider == "gemini"
        else _normalize_chat_completions_url(raw_url)
    )
    if not api_key:
        raise RuntimeError("Missing OPENROUTER_API_KEY or DOC_CLASSIFIER_API_KEY")
    if not model:
        raise RuntimeError("Missing DOC_CLASSIFIER_MODEL")
    return api_key, api_url, model, provider


def _split_field_tokens(field_name: str) -> set[str]:
    normalized = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", field_name)
    return {token.lower() for token in re.split(r"[^A-Za-z0-9]+", normalized) if len(token) >= 3}


def _field_to_phrase(field_name: str) -> str:
    without_array = re.sub(r"\[\]", " ", field_name)
    without_path = without_array.replace(".", " ")
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", without_path)
    return _normalize_search_text(spaced)


def _field_to_label_phrase(field_name: str) -> str:
    phrase = _field_to_phrase(field_name)
    replacements = {
        "bol": "bill of lading",
        "bl": "bill of lading",
        "awb": "air waybill",
        "po": "purchase order",
        "so": "sales order",
        "grn": "goods receipt note",
        "gstin": "gstin",
        "hsn": "hsn",
        "iec": "iec",
        "cha": "cha",
        "cbp": "cbp",
        "hts": "hts",
        "mpf": "mpf",
        "hmf": "hmf",
    }
    tokens = phrase.split()
    expanded: list[str] = []
    for token in tokens:
        expanded.extend(replacements.get(token, token).split())
    return _normalize_search_text(" ".join(expanded))


def _field_alias_phrases(field_name: str) -> set[str]:
    phrases = {_field_to_phrase(field_name), _field_to_label_phrase(field_name)}
    tokens = _field_to_phrase(field_name).split()
    section_tokens = {
        "bank",
        "charges",
        "containers",
        "customer",
        "flags",
        "issuer",
        "job",
        "line",
        "qr",
        "shipment",
        "tax",
        "totals",
    }

    if len(tokens) >= 2 and tokens[0] in section_tokens:
        phrases.add(" ".join(tokens[1:]))
    if len(tokens) >= 3 and tokens[0] in section_tokens:
        phrases.add(" ".join(tokens[1:3]))
    if len(tokens) >= 4 and tokens[0] in section_tokens:
        phrases.add(" ".join(tokens[2:]))

    label_tokens = _field_to_label_phrase(field_name).split()
    if len(label_tokens) >= 2 and label_tokens[0] in section_tokens:
        phrases.add(" ".join(label_tokens[1:]))
    if len(label_tokens) >= 3 and label_tokens[0] in section_tokens:
        phrases.add(" ".join(label_tokens[1:3]))
    if len(label_tokens) >= 4 and label_tokens[0] in section_tokens:
        phrases.add(" ".join(label_tokens[2:]))

    return {phrase for phrase in phrases if len(phrase) >= 4}


@lru_cache(maxsize=1)
def _schema_distinct_score_phrases() -> dict[str, dict[str, float]]:
    doc_phrases: dict[str, set[str]] = {}
    phrase_doc_types: dict[str, set[str]] = {}
    generic_tokens = {
        "address",
        "amount",
        "bank",
        "bill",
        "charge",
        "charges",
        "consignee",
        "container",
        "currency",
        "customer",
        "date",
        "description",
        "destination",
        "email",
        "invoice",
        "name",
        "number",
        "origin",
        "phone",
        "shipper",
        "subtotal",
        "total",
        "vessel",
        "voyage",
        "weight",
    }

    for candidate in CLASSIFIER_CANDIDATES:
        phrases: set[str] = set()
        try:
            schema = load_extraction_schema(parent_model=candidate.prisma_model)
            fields = [field for field in schema.scalar_fields if field != "documentType"]
            fields.extend(schema.array_fields)
            for array_name, item_fields in schema.array_item_fields.items():
                fields.extend(f"{array_name}.{field}" for field in item_fields)
            for field in fields:
                for phrase in _field_alias_phrases(field):
                    tokens = set(phrase.split())
                    if tokens and tokens.issubset(generic_tokens):
                        continue
                    phrases.add(phrase)
        except Exception:
            pass

        doc_phrases[candidate.doc_type] = phrases
        for phrase in phrases:
            phrase_doc_types.setdefault(phrase, set()).add(candidate.doc_type)

    weighted: dict[str, dict[str, float]] = {}
    for doc_type, phrases in doc_phrases.items():
        phrase_weights: dict[str, float] = {}
        for phrase in phrases:
            doc_count = len(phrase_doc_types.get(phrase, ()))
            token_count = len(phrase.split())
            if doc_count == 1:
                phrase_weights[phrase] = 2.5 if token_count >= 2 else 1.4
            elif doc_count == 2 and token_count >= 2:
                phrase_weights[phrase] = 0.6
        weighted[doc_type] = phrase_weights
    return weighted


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
    weighted: dict[str, dict[str, float]] = {}
    schema_phrases = _schema_distinct_score_phrases()
    for candidate in CLASSIFIER_CANDIDATES:
        phrase_weights: dict[str, float] = {}
        for phrase, weight in schema_phrases.get(candidate.doc_type, {}).items():
            phrase_weights[phrase] = max(phrase_weights.get(phrase, 0.0), weight)
        for phrase in DETECTION_SUPPORTING_FINGERPRINTS.get(candidate.doc_type, ()):
            normalized = _normalize_search_text(phrase)
            if normalized:
                phrase_weights[normalized] = max(phrase_weights.get(normalized, 0.0), 1.0)
        for phrase in CURATED_FINGERPRINTS.get(candidate.doc_type, ()):
            normalized = _normalize_search_text(phrase)
            if normalized:
                phrase_weights[normalized] = max(phrase_weights.get(normalized, 0.0), 1.2)
        for phrase in EXCLUSIVE_FINGERPRINTS.get(candidate.doc_type, ()):
            normalized = _normalize_search_text(phrase)
            if normalized:
                phrase_weights[normalized] = max(phrase_weights.get(normalized, 0.0), 6.0)
        for phrase, weight in HIGH_VALUE_FINGERPRINTS.get(candidate.doc_type, {}).items():
            normalized = _normalize_search_text(phrase)
            if normalized in phrase_weights:
                phrase_weights[normalized] = max(phrase_weights[normalized], weight)
        weighted[candidate.doc_type] = phrase_weights
    return weighted


def _score_all_documents(haystack: str) -> list[tuple[float, str, list[str]]]:
    scores: list[tuple[float, str, list[str]]] = []
    has_service_evidence = any(_contains_phrase(haystack, phrase) for phrase in SERVICE_BILL_EVIDENCE)
    has_goods_sale_evidence = any(_contains_phrase(haystack, phrase) for phrase in SALES_INVOICE_REQUIRED_EVIDENCE)
    has_goods_sale_content_evidence = any(_contains_phrase(haystack, phrase) for phrase in GOODS_SALE_CONTENT_EVIDENCE)
    has_billing_document_evidence = any(_contains_phrase(haystack, phrase) for phrase in BILLING_DOCUMENT_EVIDENCE)
    has_customer_broker_billing_pattern = (
        has_billing_document_evidence
        and any(_contains_phrase(haystack, phrase) for phrase in CUSTOMER_BROKER_BILLING_PATTERN_EVIDENCE)
        and any(_contains_phrase(haystack, phrase) for phrase in CUSTOMER_BROKER_STRONG_BILLING_EVIDENCE)
        and not any(_contains_phrase(haystack, phrase) for phrase in ENTRY_SUMMARY_STRONG_EVIDENCE)
    )
    has_bill_of_lading_transport_evidence = any(
        _contains_phrase(haystack, phrase)
        for phrase in BILL_OF_LADING_TRANSPORT_EVIDENCE
    )
    has_bill_of_lading_reference_only_evidence = any(
        _contains_phrase(haystack, phrase)
        for phrase in BILL_OF_LADING_REFERENCE_ONLY_EVIDENCE
    )
    has_customer_broker_identity = any(
        _contains_phrase(haystack, phrase)
        for phrase in CUSTOMER_BROKER_IDENTITY_EVIDENCE
    )
    has_customer_broker_document_identity = any(
        _contains_phrase(haystack, phrase)
        for phrase in CUSTOMER_BROKER_DOCUMENT_IDENTITY_EVIDENCE
    )
    has_freight_forwarder_evidence = (
        any(
            _contains_phrase(haystack, phrase)
            for phrase in FREIGHT_FORWARDER_DOMINANT_EVIDENCE
        )
        or _has_freight_forwarder_structure(haystack)
    )
    has_cha_identity = any(
        _contains_phrase(haystack, phrase)
        for phrase in CHA_IDENTITY_EVIDENCE
    )
    has_cha_decisive_evidence = any(
        _contains_phrase(haystack, phrase)
        for phrase in CHA_DECISIVE_EVIDENCE
    )
    has_cha_strong_service_evidence = any(
        _contains_phrase(haystack, phrase)
        for phrase in CHA_STRONG_SERVICE_EVIDENCE
    )
    has_entry_summary_decisive_evidence = any(
        _contains_phrase(haystack, phrase)
        for phrase in ENTRY_SUMMARY_DECISIVE_EVIDENCE
    )
    has_bill_of_lading_decisive_evidence = any(
        _contains_phrase(haystack, phrase)
        for phrase in BILL_OF_LADING_DECISIVE_EVIDENCE
    )
    has_ocean_freight_decisive_evidence = any(
        _contains_phrase(haystack, phrase)
        for phrase in OCEAN_FREIGHT_DECISIVE_EVIDENCE
    )
    has_packing_list_title = _contains_phrase(haystack, "packing list")

    for candidate in CLASSIFIER_CANDIDATES:
        matched: list[str] = []
        score = 0.0
        for phrase, weight in _build_global_score_phrases().get(candidate.doc_type, {}).items():
            if _contains_phrase(haystack, phrase):
                matched.append(phrase)
                score += weight

        if candidate.doc_type in {"SALES_INVOICE", "US_SALES_INVOICE"}:
            if has_service_evidence and not has_goods_sale_content_evidence:
                score *= 0.05
            elif not has_goods_sale_evidence:
                score *= 0.35
        elif (
            candidate.doc_type == "CUSTOMER_BROKER_BILL"
            and has_customer_broker_billing_pattern
            and not (has_freight_forwarder_evidence and not has_customer_broker_document_identity)
        ):
            score += 8.0
            for phrase in CUSTOMER_BROKER_BILLING_PATTERN_EVIDENCE:
                if _contains_phrase(haystack, phrase) and phrase not in matched:
                    matched.append(phrase)
            for phrase in BILLING_DOCUMENT_EVIDENCE:
                if _contains_phrase(haystack, phrase) and phrase not in matched:
                    matched.append(phrase)
        elif (
            candidate.doc_type == "CUSTOMER_BROKER_BILL"
            and has_freight_forwarder_evidence
            and not has_customer_broker_document_identity
        ):
            score *= 0.05
        elif candidate.doc_type == "CUSTOMER_BROKER_BILL" and not has_customer_broker_identity:
            score *= 0.05
        elif candidate.doc_type == "FREIGHT_FORWARDER_BILL" and has_freight_forwarder_evidence:
            score += 4.0
            for phrase in (
                *FREIGHT_FORWARDER_DOMINANT_EVIDENCE,
                *FREIGHT_FORWARDER_STRUCTURAL_EVIDENCE,
            ):
                if _contains_phrase(haystack, phrase) and phrase not in matched:
                    matched.append(phrase)
        elif candidate.doc_type == "PACKING_LIST" and has_billing_document_evidence and not has_packing_list_title:
            # Service invoices commonly include shipment weights. A lone net or
            # gross weight must not make the invoice a Packing List.
            score *= 0.03
        elif (
            candidate.doc_type == "CHA_BILL"
            and has_freight_forwarder_evidence
            and not has_cha_strong_service_evidence
        ):
            # Freight invoices can mention an import/customs broker and vessel
            # context. Those are not proof that the document is a CHA bill.
            score *= 0.02
        elif candidate.doc_type == "CHA_BILL" and not has_cha_decisive_evidence:
            score *= 0.05
        elif candidate.doc_type == "CHA_BILL" and has_customer_broker_identity and not has_cha_identity:
            score *= 0.45
        elif candidate.doc_type == "ENTRY_SUMMARY" and not has_entry_summary_decisive_evidence:
            score *= 0.05
        elif candidate.doc_type == "ENTRY_SUMMARY" and has_customer_broker_billing_pattern:
            score *= 0.02
        elif candidate.doc_type == "BILL_OF_LADING" and not has_bill_of_lading_decisive_evidence:
            score *= 0.05
        elif candidate.doc_type == "BILL_OF_LADING" and has_bill_of_lading_reference_only_evidence and not has_bill_of_lading_transport_evidence:
            score *= 0.02
        elif candidate.doc_type == "BILL_OF_LADING" and has_billing_document_evidence and not has_bill_of_lading_transport_evidence:
            score *= 0.02
        elif candidate.doc_type == "OCEAN_FREIGHT" and not has_ocean_freight_decisive_evidence:
            score *= 0.05

        matched.sort(key=lambda phrase: _build_global_score_phrases().get(candidate.doc_type, {}).get(phrase, 0.0), reverse=True)
        scores.append((score, candidate.doc_type, matched[:12]))

    scores.sort(key=lambda item: item[0], reverse=True)
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
    def distinct_fields_for(doc_type: str) -> list[str]:
        manual = list(MANUAL_DISTINCT_FIELDS.get(doc_type, ()))
        schema = [
            phrase
            for phrase, _ in sorted(
                _schema_distinct_score_phrases().get(doc_type, {}).items(),
                key=lambda item: (item[1], len(item[0].split()), len(item[0])),
                reverse=True,
            )
        ]
        return list(dict.fromkeys([*manual, *schema]))[:12]

    def decisive_evidence_for(doc_type: str) -> list[str]:
        if doc_type == "CUSTOMER_BROKER_BILL":
            return list(CUSTOMER_BROKER_DOCUMENT_IDENTITY_EVIDENCE)[:10]
        return list(EXCLUSIVE_FINGERPRINTS.get(doc_type, ()))[:10]

    return [
        {
            "docType": candidate.doc_type,
            "label": candidate.label,
            "distinctFields": distinct_fields_for(candidate.doc_type),
            "decisiveEvidence": decisive_evidence_for(candidate.doc_type),
            "supportingEvidence": list(DETECTION_SUPPORTING_FINGERPRINTS.get(candidate.doc_type, ()))[:10],
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
    if poppler_path != "":
        try:
            pages = convert_from_bytes(
                file_bytes,
                dpi=CLASSIFIER_IMAGE_DPI,
                first_page=1,
                last_page=1,
                poppler_path=poppler_path,
            )
            if pages:
                return [_compressed_image_part(page) for page in pages[:1]]
        except Exception:
            pass

    try:
        with fitz.open(stream=file_bytes, filetype="pdf") as doc:
            if len(doc) < 1:
                return []
            page = doc.load_page(0)
            scale = CLASSIFIER_IMAGE_DPI / 72
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            return [_compressed_image_part(Image.open(BytesIO(pixmap.tobytes("png"))))]
    except Exception:
        return []


def _gemini_content_parts(openai_parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    for part in openai_parts:
        if part.get("type") == "text":
            parts.append({"text": str(part.get("text") or "")})
            continue
        data_url = str((part.get("image_url") or {}).get("url") or "")
        match = re.match(r"^data:([^;]+);base64,(.+)$", data_url, flags=re.DOTALL)
        if match:
            parts.append(
                {
                    "inline_data": {
                        "mime_type": match.group(1),
                        "data": match.group(2),
                    }
                }
            )
    return parts


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


def _text_from_content_parts(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        chunks: list[str] = []
        for item in value:
            if isinstance(item, str):
                chunks.append(item)
            elif isinstance(item, dict):
                chunks.append(str(item.get("text") or item.get("content") or ""))
        return "".join(chunks)
    if isinstance(value, dict):
        if "parts" in value:
            return _text_from_content_parts(value.get("parts"))
        return str(value.get("text") or value.get("content") or "")
    return ""


def _extract_classifier_response_text(response_payload: dict[str, Any]) -> str:
    provider_error = response_payload.get("error")
    if provider_error:
        if isinstance(provider_error, dict):
            detail = provider_error.get("message") or json.dumps(provider_error, ensure_ascii=False)
        else:
            detail = str(provider_error)
        raise RuntimeError(f"Document classifier provider error: {detail[:500]}")

    choices = response_payload.get("choices")
    if isinstance(choices, list):
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            message = choice.get("message") or {}
            if isinstance(message, dict):
                text = _text_from_content_parts(message.get("content"))
                if text.strip():
                    return text
            text = _text_from_content_parts(choice.get("text") or choice.get("delta"))
            if text.strip():
                return text

    # Gemini native responses use candidates/content/parts rather than choices.
    candidates = response_payload.get("candidates")
    if isinstance(candidates, list):
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            text = _text_from_content_parts(candidate.get("content"))
            if text.strip():
                return text
        block_reason = response_payload.get("promptFeedback") or response_payload.get("prompt_feedback")
        if block_reason:
            raise RuntimeError(f"Document classifier provider blocked the request: {str(block_reason)[:500]}")

    # OpenAI Responses API shape.
    output = response_payload.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            text = _text_from_content_parts(item.get("content"))
            if text.strip():
                return text

    keys = ", ".join(sorted(str(key) for key in response_payload.keys())) or "none"
    preview = json.dumps(response_payload, ensure_ascii=False)[:500]
    raise RuntimeError(f"Document classifier returned no usable text. Response keys: {keys}. Response preview: {preview}")


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


def _stringify_evidence(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return " field boundary ".join(_stringify_evidence(item) for item in value)
    if isinstance(value, dict):
        return " field boundary ".join(
            f"{key} {_stringify_evidence(nested)}"
            for key, nested in value.items()
        )
    return str(value)


def _classification_from_model_payload(
    *,
    payload: dict[str, Any],
    file_name: str,
    extracted_text: str,
) -> ClassificationResult:
    evidence_text = " ".join(
        filter(
            None,
            [
                file_name,
                extracted_text[:MAX_TEXT_CHARS],
                _stringify_evidence(payload.get("visibleDocumentTitle")),
                _stringify_evidence(payload.get("visibleText")),
                _stringify_evidence(payload.get("visibleLabels")),
                _stringify_evidence(payload.get("visiblePhrases")),
                _stringify_evidence(payload.get("matchedFields")),
                _stringify_evidence(payload.get("matched_fields")),
            ],
        )
    )
    normalized_evidence = _normalize_search_text(evidence_text)
    explicit_freight_evidence = any(
        _contains_phrase(normalized_evidence, phrase)
        for phrase in FREIGHT_FORWARDER_DOMINANT_EVIDENCE
    )
    freight_structure = _has_freight_forwarder_structure(normalized_evidence)
    explicit_cha_title = any(
        _contains_phrase(normalized_evidence, phrase)
        for phrase in ("cha bill", "custom house agent", "customs house agent")
    )
    if (explicit_freight_evidence or freight_structure) and not explicit_cha_title:
        candidate = next(
            item for item in CLASSIFIER_CANDIDATES
            if item.doc_type == "FREIGHT_FORWARDER_BILL"
        )
        return ClassificationResult(
            doc_type=candidate.doc_type,
            label=candidate.label,
            confidence=0.96 if explicit_freight_evidence else 0.90,
            reasoning="Freight-forwarder identity/structure takes precedence over incidental customs or CHA charge wording.",
            matched_fields=[
                phrase
                for phrase in (
                    *FREIGHT_FORWARDER_DOMINANT_EVIDENCE,
                    *FREIGHT_FORWARDER_STRUCTURAL_EVIDENCE,
                )
                if _contains_phrase(normalized_evidence, phrase)
            ][:8],
            alternatives=[],
        )

    scored = _classification_from_scores(
        _score_fingerprint_text(normalized_evidence),
        reasoning="Scored every document type against model-visible labels and all configured extraction fields.",
        min_score=MIN_CLASSIFICATION_SCORE,
    )
    if scored is not None:
        return scored

    proposed_type = str(payload.get("docType") or "").strip().upper()
    try:
        proposed_confidence = float(payload.get("confidence") or 0)
    except (TypeError, ValueError):
        proposed_confidence = 0.0
    if proposed_confidence > 1:
        proposed_confidence /= 100
    allowed = {candidate.doc_type: candidate for candidate in CLASSIFIER_CANDIDATES}
    evidence_items: list[str] = []
    for key in ("visibleDocumentTitle", "visibleLabels", "visiblePhrases"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            evidence_items.append(value.strip())
        elif isinstance(value, list):
            evidence_items.extend(str(item).strip() for item in value if str(item).strip())
    evidence_items = list(dict.fromkeys(evidence_items))

    # A controlled visual-model fallback handles layouts whose printed wording
    # does not exactly match our deterministic phrases. It still requires
    # multiple visible evidence items and blocks the historically ambiguous
    # types unless their strong rules also pass.
    guarded_types = {"CHA_BILL", "PACKING_LIST", "CUSTOMER_BROKER_BILL"}
    proposed_haystack = _normalize_search_text(evidence_text)
    passes_guard = (
        proposed_type not in guarded_types
        or _has_decisive_evidence(proposed_type, proposed_haystack)
    )
    if (
        proposed_type in allowed
        and proposed_confidence >= 0.85
        and len(evidence_items) >= 2
        and passes_guard
    ):
        candidate = allowed[proposed_type]
        return ClassificationResult(
            doc_type=candidate.doc_type,
            label=candidate.label,
            confidence=min(0.92, proposed_confidence),
            reasoning="Gemini selected the type from the supported registry and supplied multiple visible evidence items.",
            matched_fields=evidence_items[:8],
            alternatives=[],
        )

    raise RuntimeError(
        "Auto-detect could not confirm a document type from distinct visible evidence. "
        "Select the document type manually instead of accepting an uncertain guess."
    )


def _normalize_search_text(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text.lower())).strip()


def _contains_phrase(haystack: str, phrase: str) -> bool:
    normalized_phrase = _normalize_search_text(phrase)
    if not normalized_phrase:
        return False
    return f" {normalized_phrase} " in f" {haystack} "


def _has_distinct_schema_evidence(doc_type: str, haystack: str) -> bool:
    matches = [
        phrase
        for phrase, weight in _schema_distinct_score_phrases().get(doc_type, {}).items()
        if weight >= 2.5 and _contains_phrase(haystack, phrase)
    ]
    return len(matches) >= 2


def _has_decisive_evidence(doc_type: str, haystack: str) -> bool:
    if doc_type == "CUSTOMER_BROKER_BILL":
        has_broker_identity = any(
            _contains_phrase(haystack, phrase)
            for phrase in CUSTOMER_BROKER_DOCUMENT_IDENTITY_EVIDENCE
        )
        has_broker_invoice_pattern = (
            any(_contains_phrase(haystack, phrase) for phrase in BILLING_DOCUMENT_EVIDENCE)
            and any(_contains_phrase(haystack, phrase) for phrase in CUSTOMER_BROKER_BILLING_PATTERN_EVIDENCE)
            and any(_contains_phrase(haystack, phrase) for phrase in CUSTOMER_BROKER_STRONG_BILLING_EVIDENCE)
            and not any(_contains_phrase(haystack, phrase) for phrase in ENTRY_SUMMARY_STRONG_EVIDENCE)
            and not any(_contains_phrase(haystack, phrase) for phrase in FREIGHT_FORWARDER_DOMINANT_EVIDENCE)
        )
        return has_broker_identity or has_broker_invoice_pattern
    if doc_type == "CHA_BILL":
        return any(
            _contains_phrase(haystack, phrase)
            for phrase in CHA_STRONG_SERVICE_EVIDENCE
        )
    if doc_type == "FREIGHT_FORWARDER_BILL":
        return (
            any(
                _contains_phrase(haystack, phrase)
                for phrase in FREIGHT_FORWARDER_DOMINANT_EVIDENCE
            )
            or _has_freight_forwarder_structure(haystack)
        )
    if doc_type in US_DOC_TYPE_REQUIRED_EVIDENCE:
        return any(
            _contains_phrase(haystack, phrase)
            for phrase in US_DOC_TYPE_REQUIRED_EVIDENCE[doc_type]
        )
    if doc_type == "PACKING_LIST":
        if _contains_phrase(haystack, "packing list"):
            return True
        packing_evidence = (
            "marks and numbers",
            "gross weight",
            "net weight",
            "carton dimensions",
            "package",
            "carton",
            "pallet",
        )
        return sum(_contains_phrase(haystack, phrase) for phrase in packing_evidence) >= 2
    has_exclusive_evidence = any(
        _contains_phrase(haystack, phrase)
        for phrase in EXCLUSIVE_FINGERPRINTS.get(doc_type, ())
    )
    return has_exclusive_evidence or _has_distinct_schema_evidence(doc_type, haystack)


def _score_fingerprint_text(haystack: str) -> list[tuple[float, str, list[str]]]:
    return _score_all_documents(haystack)


def _classification_from_scores(
    scores: list[tuple[float, str, list[str]]],
    *,
    reasoning: str,
    min_score: float = MIN_CLASSIFICATION_SCORE,
) -> ClassificationResult | None:
    if not scores:
        return None
    eligible_scores = [
        (score, doc_type, matches)
        for score, doc_type, matches in scores
        if score >= min_score and _has_decisive_evidence(doc_type, " ".join(matches))
    ]
    if not eligible_scores:
        return None

    best_score, best_type, best_matches = eligible_scores[0]
    second_score = eligible_scores[1][0] if len(eligible_scores) > 1 else 0.0
    if len(eligible_scores) > 1 and best_score - second_score < MIN_CLASSIFICATION_GAP:
        return None

    candidate = next(item for item in CLASSIFIER_CANDIDATES if item.doc_type == best_type)
    gap = best_score - second_score
    confidence = min(0.97, 0.55 + (best_score * 0.03) + (gap * 0.04))
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
    normalized_stem = _normalize_search_text(Path(file_name).stem)
    raw_stem = Path(file_name).stem.lower()
    explicit_bill_of_lading_name = (
        "bill of lading" in normalized_stem
        or re.search(r"(?:^|[-_\s])bol(?:$|[-_\s])", raw_stem) is not None
        or re.search(r"(?:^|[-_\s])bl(?:$|[-_\s])", raw_stem) is not None
    )
    if explicit_bill_of_lading_name:
        candidate = next(item for item in CLASSIFIER_CANDIDATES if item.doc_type == "BILL_OF_LADING")
        return ClassificationResult(
            doc_type=candidate.doc_type,
            label=candidate.label,
            confidence=0.97,
            reasoning="The file name explicitly identifies this document as a Bill of Lading.",
            matched_fields=["bill of lading file name"],
            alternatives=[],
        )

    haystack = _normalize_search_text(f"{file_name} {extracted_text[:MAX_TEXT_CHARS]}")
    if not haystack:
        return None

    return _classification_from_scores(
        _score_fingerprint_text(haystack),
        reasoning="Scored every document type against all configured extraction fields; selected the highest score.",
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
        reasoning=f"Scored every document type against all configured extraction fields from source text. Original docType={result.doc_type}.",
        min_score=MIN_CLASSIFICATION_SCORE,
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
        reasoning=f"Scored every document type against all configured extraction fields using model-visible evidence. Original docType={result.doc_type}.",
        min_score=MIN_CLASSIFICATION_SCORE,
    )
    if corrected is None:
        return result
    return corrected


def classify_document_bytes(*, file_bytes: bytes, file_name: str, content_type: str) -> ClassificationResult:
    extracted_text = _extract_pdf_text(file_bytes) if content_type == "application/pdf" or file_name.lower().endswith(".pdf") else ""
    quick_result = _keyword_classify(file_name=file_name, extracted_text=extracted_text)
    if quick_result is not None:
        return quick_result

    api_key, api_url, model, provider = _classifier_config()
    prompt = (
        "First act as a strict document evidence transcriber, then select one supported document type. "
        "Read the uploaded logistics document and copy only words that are actually visible on the page. "
        "Never invent, expand, normalize, or autocomplete abbreviations. "
        "Do not return candidate type names unless that exact title is visibly printed in the document.\n\n"
        "Return JSON only with:\n"
        "- visibleDocumentTitle: the exact printed document heading, or null\n"
        "- visibleText: a compact transcription of the most distinctive visible header and body text\n"
        "- visibleLabels: separate exact field labels, preserving their printed wording\n"
        "- visiblePhrases: exact service descriptions, charge descriptions, form names, and transport references\n\n"
        "Also return docType as exactly one value from this registry:\n"
        f"{json.dumps([candidate.doc_type for candidate in CLASSIFIER_CANDIDATES])}\n"
        "Return confidence from 0 to 1. Use at least 0.85 only when multiple visible items support that type. "
        "If the evidence is ambiguous, return confidence below 0.85.\n\n"
        "Keep neighboring labels separate. Include invoice/form numbers, parties, shipment references, airway/bill references, "
        "charge descriptions, tax labels, packing/weight labels, customs identifiers, and warehouse/delivery labels only when visible. "
        "Do not extract tables, totals, line items, or full OCR content; this is only document type classification. "
        "Do not include candidate names inside visibleText, visibleLabels, or visiblePhrases unless those words are printed on the page."
    )
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    image_parts = [] if extracted_text else _document_image_parts(file_bytes, file_name=file_name, content_type=content_type)
    content.extend(image_parts)
    if extracted_text:
        content.append({"type": "text", "text": f"Text extracted from the first pages:\n{extracted_text}"})
    if not image_parts and not extracted_text:
        raise RuntimeError(
            "Could not read text or render a preview from this document. "
            "Install Poppler for PDF auto-detect, or select the document type manually."
        )

    if provider == "gemini":
        payload = {
            "contents": [{"role": "user", "parts": _gemini_content_parts(content)}],
            "generationConfig": {
                "temperature": 0,
                "maxOutputTokens": CLASSIFIER_MAX_OUTPUT_TOKENS,
                "responseMimeType": "application/json",
            },
        }
        headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}
    else:
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "temperature": 0,
            "max_tokens": CLASSIFIER_MAX_OUTPUT_TOKENS,
            "response_format": {"type": "json_object"},
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "X-Title": "doc auto detect",
        }
    req = request.Request(
        url=api_url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=300) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Document classifier provider error {exc.code}: {detail or exc.reason}") from exc

    text = _extract_classifier_response_text(response_payload)
    return _classification_from_model_payload(
        payload=_extract_json(text),
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
