from datetime import datetime, timezone
from io import BytesIO
import asyncio
import json
from pathlib import Path
import re
from typing import Any, Final
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from pypdf import PdfReader

from db import get_prisma
from documents_ocr.queue import (
    cancel_ocr_job,
    enqueue_detection_job,
    enqueue_ocr_job,
    enqueue_upload_job,
    get_detection_status,
)
from doc_generation.db_setup import ensure_doc_generation_views
from document_module.db_setup import ensure_document_module_views
from documents_ocr.schema_loader import (
    load_extraction_schema,
    prisma_accessor_name,
    upsert_extraction_with_children,
)
from documents_ocr.mandatory import validate_mandatory_fields
from documents_ocr.cross_validation import (
    get_rules_for_doc_type,
    load_validation_rule_overrides,
    run_cross_validation,
)
from documents_ocr.Bill_of_lading.container_mapping import (
    build_container_mapping,
    save_container_mapping,
)
from helpers.config import settings
from helpers.dependencies import get_current_user
from helpers.rbac_data_access import (
    can_do_doc_type_action,
    document_module_sql_where,
    document_prisma_where,
    document_sql_where,
    has_role_document_scope,
    user_id,
)
from helpers.rbac import require_activity
from helpers.shipment_operational import create_or_update_shipment_from_bol_document, ensure_operational_shipment_tables
from objectstore import (
    DEFAULT_BUCKET,
    S3_ENDPOINT,
    build_object_key,
    delete_document_object,
    get_download_url,
    normalize_bucket_name,
    upload_bytes,
    validate_bucket_name,
)

router = APIRouter(prefix=settings.API_SLUG + "/uploads", tags=["Uploads"])
legacy_router = APIRouter(prefix="/api/uploads", tags=["Uploads"])
validation_router = APIRouter(prefix="/api/validation", tags=["Validation"])

BACKEND_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MODULE = "uploads"
DETECTION_STAGING_MODULE = "auto-detect"
MAX_BULK_CLASSIFY_FILES = 10
ACTIVE_DOCUMENT_STALE_SECONDS = 15 * 60
DOC_TYPE_VALUES: Final[set[str]] = {
    "SALES_INVOICE",
    "BILL_OF_LADING",
    "PACKING_LIST",
    "ENTRY_SUMMARY",
    "DRAFT_CBP_FORM_7501_BROKER",
    "OCEAN_FREIGHT",
    "FREIGHT_FORWARDER_BILL",
    "CUSTOMER_BROKER_BILL",
    "GRN_INBOUND",
    "PORT_TO_WH",
    "WH_TO_CUSTOMER",
    "US_SALES_INVOICE",
    "US_CARGO_RELEASE_ORDER",
    "US_CUSTOMS_RELEASE_ORDER",
    "US_DELIVERY_ORDER",
    "US_PACKING_LIST",
    "ISF",
    "SHIPPING_BILL",
    "CHA_BILL",
}


class UploadDocumentItem(BaseModel):
    id: str
    bucket: str
    objectKey: str
    fileName: str
    filePath: str
    pageCount: int | None
    isPDF: bool
    s3Endpoint: str
    ocrStatus: str | None = None
    extractionId: str | None = None
    ocrReason: str | None = None


class UploadResponse(BaseModel):
    status: str
    message: str
    documents: list[UploadDocumentItem]


class DocumentClassificationJobItem(BaseModel):
    classificationJobId: str
    fileName: str
    status: str
    message: str


class DocumentClassificationQueuedResponse(BaseModel):
    status: str
    message: str
    classificationJobId: str
    fileName: str


class DocumentClassificationBulkResponse(BaseModel):
    status: str
    message: str
    jobs: list[DocumentClassificationJobItem]


class DocumentClassificationStatusResponse(BaseModel):
    status: str
    message: str
    classificationJobId: str
    fileName: str
    docType: str | None = None
    label: str | None = None
    confidence: float | None = None
    reasoning: str | None = None
    matchedFields: list[str] = Field(default_factory=list)
    alternatives: list[dict[str, Any]] = Field(default_factory=list)


class DocumentListItem(BaseModel):
    id: str
    docType: str
    status: str
    validationStatus: str | None = None
    validationSummary: dict[str, Any] | None = None
    validationResults: list[dict[str, Any]] = Field(default_factory=list)
    filePath: str
    fileName: str
    bucket: str
    objectKey: str
    contentType: str
    sizeBytes: int
    createdAt: str
    updatedAt: str
    pageCount: int | None
    isPDF: bool
    previewUrl: str | None
    ocrConfidence: float | None = None


class DocumentListPagination(BaseModel):
    page: int
    pageSize: int
    total: int
    totalPages: int
    hasNextPage: bool
    hasPreviousPage: bool


class DocumentListCounts(BaseModel):
    total: int = 0
    needsApproval: int = 0
    processing: int = 0
    crossValidating: int = 0
    draftReview: int = 0
    done: int = 0


class DocumentListResponse(BaseModel):
    documents: list[DocumentListItem]
    pagination: DocumentListPagination
    counts: DocumentListCounts


class DocumentPageItem(BaseModel):
    id: str
    documentId: str
    pageNo: int
    bucket: str
    objectKey: str
    sizeBytes: int | None
    rawText: str | None
    isExtractionSource: bool
    createdAt: str
    previewUrl: str | None


class DocumentExtractionItem(BaseModel):
    id: str
    documentId: str
    lineItems: list[dict[str, Any]] | None
    arrays: dict[str, list[dict[str, Any]]] | None = None
    rawData: Any | None
    extractedAt: str | None
    reviewedBy: str | None
    reviewedAt: str | None


class DocumentDetailItem(BaseModel):
    id: str
    docType: str
    status: str
    validationStatus: str | None = None
    validationSummary: dict[str, Any] | None = None
    validationResults: list[dict[str, Any]] = Field(default_factory=list)
    bucket: str
    objectKey: str
    fileName: str
    filePath: str
    contentType: str
    sizeBytes: int
    checksum: str | None
    totalPages: int | None
    uploadedBy: str
    isDeleted: bool
    createdAt: str
    updatedAt: str
    previewUrl: str | None
    pages: list[DocumentPageItem]
    extraction: DocumentExtractionItem | None
    salesInvoiceExtraction: DocumentExtractionItem | None


class RetryOcrResponse(BaseModel):
    status: str
    message: str
    documentId: str
    queue: str


class ReuploadDocumentResponse(BaseModel):
    status: str
    message: str
    documentId: str
    queue: str


class StopOcrResponse(BaseModel):
    status: str
    message: str
    documentId: str
    aborted: bool


class UpdateExtractionRequest(BaseModel):
    fields: dict[str, Any] = Field(default_factory=dict)
    arrays: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)


class ContainerAssignment(BaseModel):
    lineItemId: str
    containerNo: str | None = None


class SaveContainerMappingRequest(BaseModel):
    assignments: list[ContainerAssignment]


class SaveWarehouseMappingRequest(BaseModel):
    warehouseId: str | None = None


class ApproveDocumentResponse(BaseModel):
    status: str
    message: str
    documentId: str
    validation: dict[str, Any] | None = None


def _storage_path(bucket: str, object_key: str) -> str:
    return f"s3://{bucket}/{object_key}"


def _sql_quote(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def _safe_download_url(bucket: str, object_key: str) -> str | None:
    try:
        return get_download_url(bucket, object_key)
    except Exception:
        return None


def _require_doc_type_action(user: Any, action: str, doc_type: str) -> None:
    if not can_do_doc_type_action(user, action, doc_type):
        raise HTTPException(
            status_code=403,
            detail="Access denied for this doc",
        )


DOC_TYPE_TO_EXTRACTION_RELATION: Final[dict[str, str]] = {
    "SALES_INVOICE": "salesInvoiceExtraction",
    "BILL_OF_LADING": "bolExtraction",
    "PACKING_LIST": "packingListExtraction",
    "ENTRY_SUMMARY": "entrySummaryExtraction",
    "DRAFT_CBP_FORM_7501_BROKER": "entrySummaryExtraction",
    "OCEAN_FREIGHT": "oceanFreightExtraction",
    "FREIGHT_FORWARDER_BILL": "freightForwarderBillExtraction",
    "CUSTOMER_BROKER_BILL": "customerBrokerBillExtraction",
    "GRN_INBOUND": "grnInboundExtraction",
    "PORT_TO_WH": "portToWhExtraction",
    "WH_TO_CUSTOMER": "whToCustomerExtraction",
    "US_SALES_INVOICE": "usSalesInvoiceExtraction",
    "US_CARGO_RELEASE_ORDER": "usCargoReleaseExtraction",
    "US_CUSTOMS_RELEASE_ORDER": "usCustomsReleaseExtraction",
    "US_DELIVERY_ORDER": "usDeliveryOrderExtraction",
    "US_PACKING_LIST": "usPackingListExtraction",
    "ISF": "isfExtraction",
    "SHIPPING_BILL": "shippingBillExtraction",
    "CHA_BILL": "chaBillExtraction",
}
DOC_TYPE_TO_EXTRACTION_ACCESSOR: Final[dict[str, str]] = {
    "SALES_INVOICE": "salesinvoiceextraction",
    "BILL_OF_LADING": "billoflading",
    "PACKING_LIST": "packinglistextraction",
    "ENTRY_SUMMARY": "entrysummaryextraction",
    "DRAFT_CBP_FORM_7501_BROKER": "entrysummaryextraction",
    "OCEAN_FREIGHT": "oceanfreightextraction",
    "FREIGHT_FORWARDER_BILL": "freightforwarderbillextraction",
    "CUSTOMER_BROKER_BILL": "customerbrokerbillextraction",
    "GRN_INBOUND": "grninboundextraction",
    "PORT_TO_WH": "porttowhextraction",
    "WH_TO_CUSTOMER": "whtocustomerextraction",
    "US_SALES_INVOICE": "ussalesinvoiceextraction",
    "US_CARGO_RELEASE_ORDER": "uscargoreleaseextraction",
    "US_CUSTOMS_RELEASE_ORDER": "uscustomsreleaseextraction",
    "US_DELIVERY_ORDER": "usdeliveryorderextraction",
    "US_PACKING_LIST": "uspackinglistextraction",
    "ISF": "isfextraction",
    "SHIPPING_BILL": "shippingbillextraction",
    "CHA_BILL": "chabillextraction",
}
DOC_TYPE_TO_PRISMA_PARENT_MODEL: Final[dict[str, str]] = {
    "SALES_INVOICE": "SalesInvoiceExtraction",
    "BILL_OF_LADING": "BillOfLading",
    "PACKING_LIST": "PackingListExtraction",
    "ENTRY_SUMMARY": "EntrySummaryExtraction",
    "DRAFT_CBP_FORM_7501_BROKER": "EntrySummaryExtraction",
    "OCEAN_FREIGHT": "OceanFreightExtraction",
    "FREIGHT_FORWARDER_BILL": "FreightForwarderBillExtraction",
    "CUSTOMER_BROKER_BILL": "CustomerBrokerBillExtraction",
    "GRN_INBOUND": "GrnInboundExtraction",
    "PORT_TO_WH": "PortToWhExtraction",
    "WH_TO_CUSTOMER": "WhToCustomerExtraction",
    "US_SALES_INVOICE": "UsSalesInvoiceExtraction",
    "US_CARGO_RELEASE_ORDER": "UsCargoReleaseExtraction",
    "US_CUSTOMS_RELEASE_ORDER": "UsCustomsReleaseExtraction",
    "US_DELIVERY_ORDER": "UsDeliveryOrderExtraction",
    "US_PACKING_LIST": "UsPackingListExtraction",
    "ISF": "IsfExtraction",
    "SHIPPING_BILL": "ShippingBillExtraction",
    "CHA_BILL": "ChaBillExtraction",
}
DOCUMENT_DETAIL_INCLUDE_FIELDS: Final[tuple[str, ...]] = (
    "pages",
    "bolExtraction",
    "salesInvoiceExtraction",
    "packingListExtraction",
    "entrySummaryExtraction",
    "oceanFreightExtraction",
    "freightForwarderBillExtraction",
    "customerBrokerBillExtraction",
    "grnInboundExtraction",
    "portToWhExtraction",
    "whToCustomerExtraction",
    "usSalesInvoiceExtraction",
    "usCargoReleaseExtraction",
    "usCustomsReleaseExtraction",
    "usDeliveryOrderExtraction",
    "usPackingListExtraction",
    "isfExtraction",
    "shippingBillExtraction",
    "chaBillExtraction",
)
LINE_ITEM_CANDIDATE_KEYS: Final[tuple[str, ...]] = (
    "lineItems",
    "destinationMarks",
    "otherReferences",
    "tariffLines",
    "charges",
    "containers",
    "containersList",
    "part2InvoiceDetails",
    "part3ItemDetails",
    "manufacturers",
)


def _extract_line_items(extraction: object | None) -> list[dict] | None:
    if not extraction:
        return None
    direct = getattr(extraction, "lineItems", None)
    if isinstance(direct, list):
        return direct
    raw = getattr(extraction, "rawData", None)
    if isinstance(raw, dict):
        for key in LINE_ITEM_CANDIDATE_KEYS:
            value = raw.get(key)
            if isinstance(value, list):
                return value
    return None


def _coerce_json_compatible(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _coerce_json_compatible(val) for key, val in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_coerce_json_compatible(item) for item in value]
    if hasattr(value, "model_dump"):
        try:
            return _coerce_json_compatible(value.model_dump(mode="json", exclude_none=False))
        except Exception:
            pass
    if hasattr(value, "dict"):
        try:
            return _coerce_json_compatible(value.dict())
        except Exception:
            pass
    if hasattr(value, "__dict__"):
        try:
            return _coerce_json_compatible(vars(value))
        except Exception:
            pass
    return str(value)


def _coerce_line_items(value) -> list[dict] | None:
    if not isinstance(value, list):
        return None
    rows: list[dict] = []
    for item in value:
        coerced = _coerce_json_compatible(item)
        if isinstance(coerced, dict):
            rows.append(coerced)
        elif coerced is not None:
            rows.append({"value": coerced})
    return rows


def _coerce_confidence(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return None
    if confidence > 1:
        confidence = confidence / 100
    return max(0.0, min(1.0, confidence))


def _extract_ocr_confidence(extraction: object | None) -> float | None:
    if not extraction:
        return None
    raw = getattr(extraction, "rawData", None)
    if not isinstance(raw, dict):
        return None
    for key in ("document_confidence", "documentConfidence", "ocr_confidence", "ocrConfidence", "confidence"):
        confidence = _coerce_confidence(raw.get(key))
        if confidence is not None:
            return confidence
    return None


def _to_iso(value) -> str | None:
    if value is None:
        return None
    try:
        return value.isoformat()
    except Exception:
        return str(value)


async def _status_from_db_with_stale_recovery(*, prisma, row: Any) -> str:
    status = str(getattr(row, "status", "") or "")
    normalized = status.upper()
    if normalized not in {"QUEUED", "PROCESSING", "REPROCESSING"}:
        return status

    updated_at = getattr(row, "updatedAt", None)
    if not isinstance(updated_at, datetime):
        return status
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    age_seconds = (datetime.now(timezone.utc) - updated_at.astimezone(timezone.utc)).total_seconds()
    if age_seconds < ACTIVE_DOCUMENT_STALE_SECONDS:
        return status

    try:
        await prisma.document.update(
            where={"id": str(row.id)},
            data={"status": "UPLOADED"},
        )
        return "UPLOADED"
    except Exception:
        return status


def _safe_pages(row) -> list[DocumentPageItem]:
    pages_value = getattr(row, "pages", None)
    if not isinstance(pages_value, list):
        return []

    normalized_pages: list[DocumentPageItem] = []
    for page in sorted(pages_value, key=lambda item: getattr(item, "pageNo", 0) or 0):
        try:
            normalized_pages.append(
                DocumentPageItem(
                    id=str(getattr(page, "id", "")),
                    documentId=str(getattr(page, "documentId", "")),
                    pageNo=int(getattr(page, "pageNo", 0) or 0),
                    bucket=str(getattr(page, "bucket", "")),
                    objectKey=str(getattr(page, "objectKey", "")),
                    sizeBytes=(
                        int(getattr(page, "sizeBytes"))
                        if getattr(page, "sizeBytes", None) is not None
                        else None
                    ),
                    rawText=(
                        str(getattr(page, "rawText"))
                        if getattr(page, "rawText", None) is not None
                        else None
                    ),
                    isExtractionSource=bool(getattr(page, "isExtractionSource", False)),
                    createdAt=_to_iso(getattr(page, "createdAt", None)) or "",
                    previewUrl=_safe_download_url(
                        str(getattr(page, "bucket", "")),
                        str(getattr(page, "objectKey", "")),
                    ),
                )
            )
        except Exception:
            continue
    return normalized_pages


async def _fetch_extraction_direct(*, prisma, doc_type: str, document_id: str):
    accessor = DOC_TYPE_TO_EXTRACTION_ACCESSOR.get(doc_type)
    if not accessor:
        return None
    try:
        model_accessor = getattr(prisma, accessor, None)
        if model_accessor is None:
            return None
        return await model_accessor.find_unique(where={"documentId": document_id})
    except Exception:
        return None


def _serialize_extraction(
    extraction: object | None,
    *,
    doc_type: str | None = None,
    child_arrays: dict[str, list[dict]] | None = None,
) -> DocumentExtractionItem | None:
    if not extraction:
        return None
    arrays = child_arrays or {}
    line_items: list[dict] | None = None
    for key in LINE_ITEM_CANDIDATE_KEYS:
        if arrays.get(key):
            line_items = arrays[key]
            break
    if line_items is None:
        line_items = _coerce_line_items(_extract_line_items(extraction))

    raw_data = _coerce_json_compatible(getattr(extraction, "rawData", None))
    raw_data = dict(raw_data) if isinstance(raw_data, dict) else {}
    parent_model = DOC_TYPE_TO_PRISMA_PARENT_MODEL.get(str(doc_type or ""))
    if parent_model:
        try:
            schema = load_extraction_schema(parent_model=parent_model)
            for field_name in schema.scalar_fields:
                raw_data[field_name] = _coerce_json_compatible(
                    getattr(extraction, field_name, raw_data.get(field_name))
                )
        except Exception:
            pass
    raw_data.update(arrays)

    return DocumentExtractionItem(
        id=getattr(extraction, "id"),
        documentId=getattr(extraction, "documentId"),
        lineItems=line_items,
        arrays=arrays or None,
        rawData=raw_data,
        extractedAt=(
            getattr(extraction, "extractedAt").isoformat()
            if getattr(extraction, "extractedAt", None)
            else None
        ),
        reviewedBy=getattr(extraction, "reviewedBy", None),
        reviewedAt=(
            getattr(extraction, "reviewedAt").isoformat()
            if getattr(extraction, "reviewedAt", None)
            else None
        ),
    )



def _unknown_include_field(error_text: str) -> str | None:
    path_match = re.search(r"Could not find field at `[^`]*\.(\w+)`", error_text)
    if path_match:
        return path_match.group(1)
    unknown_match = re.search(r"Unknown (?:arg|field) `(\w+)`", error_text)
    if unknown_match:
        return unknown_match.group(1)
    include_match = re.search(r"Unknown field `(\w+)` for include", error_text)
    if include_match:
        return include_match.group(1)
    return None


async def _find_document_with_include_fallback(*, prisma, document_id: str, user_id: str):
    include_fields = list(DOCUMENT_DETAIL_INCLUDE_FIELDS)
    for _ in range(len(include_fields) + 1):
        include_map = {field: True for field in include_fields}
        try:
            return await prisma.document.find_first(
                where={"id": document_id, "uploadedBy": user_id, "isDeleted": False},
                include=include_map,
            )
        except Exception as exc:
            field_name = _unknown_include_field(str(exc))
            if field_name and field_name in include_fields and field_name != "pages":
                include_fields.remove(field_name)
                continue
            raise
    return None


async def _create_document_record(
    *,
    prisma,
    user_id: str,
    doc_type: str,
    bucket: str,
    object_key: str,
    file_name: str,
    content_type: str,
    size_bytes: int,
    page_count: int,
) -> object:
    base_data = {
        "status": "QUEUED",
        "bucket": bucket,
        "objectKey": object_key,
        "fileName": file_name,
        "contentType": content_type,
        "sizeBytes": size_bytes,
        "totalPages": page_count,
        "uploadedBy": user_id,
    }

    if doc_type == "DRAFT_CBP_FORM_7501_BROKER":
        return await _create_document_record_raw(
            prisma=prisma,
            user_id=user_id,
            doc_type=doc_type,
            bucket=bucket,
            object_key=object_key,
            file_name=file_name,
            content_type=content_type,
            size_bytes=size_bytes,
            page_count=page_count,
        )

    last_exc: Exception | None = None
    attempt_errors: list[str] = []
    for doc_type_key in ("docType", "doc_type", "doctype"):
        try:
            return await prisma.document.create(
                data={
                    **base_data,
                    doc_type_key: doc_type,
                }
            )
        except Exception as exc:
            last_exc = exc
            attempt_errors.append(f"{doc_type_key}: {exc}")
            # Try all naming variants before failing.
            continue

    # Fallback: create_many can succeed in some stale-client situations where
    # create() fails input-type matching. We pre-generate ID and fetch it back.
    fallback_id = str(uuid4())
    create_many_payloads = [
        {
            "id": fallback_id,
            **base_data,
            "docType": doc_type,
        },
        {
            "id": fallback_id,
            "status": "QUEUED",
            "bucket": bucket,
            "object_key": object_key,
            "file_name": file_name,
            "content_type": content_type,
            "size_bytes": size_bytes,
            "total_pages": page_count,
            "uploaded_by": user_id,
            "docType": doc_type,
        },
    ]
    for idx, payload in enumerate(create_many_payloads, start=1):
        try:
            result = await prisma.document.create_many(data=[payload])
            created_count = int(result or 0)
            if created_count > 0:
                created = await prisma.document.find_unique(where={"id": fallback_id})
                if created is not None:
                    return created
        except Exception as exc:
            attempt_errors.append(f"create_many[{idx}]: {exc}")
            continue

    # Final fallback: raw SQL insert, bypassing Prisma input-shape drift.
    return await _create_document_record_raw(
        prisma=prisma,
        user_id=user_id,
        doc_type=doc_type,
        bucket=bucket,
        object_key=object_key,
        file_name=file_name,
        content_type=content_type,
        size_bytes=size_bytes,
        page_count=page_count,
        attempt_errors=attempt_errors,
        last_exc=last_exc,
    )


async def _create_document_record_raw(
    *,
    prisma,
    user_id: str,
    doc_type: str,
    bucket: str,
    object_key: str,
    file_name: str,
    content_type: str,
    size_bytes: int,
    page_count: int,
    attempt_errors: list[str] | None = None,
    last_exc: Exception | None = None,
) -> object:
    attempt_errors = attempt_errors or []
    fallback_id = str(uuid4())
    raw_insert_sql = (
        'INSERT INTO "public"."documents" '
        '("id","doc_type","status","bucket","object_key","file_name","content_type","size_bytes","total_pages","uploaded_by","is_deleted","created_at","updated_at") '
        "VALUES ($1::uuid, $2::text::\"public\".\"DocType\", $3::text::\"public\".\"DocumentStatus\", $4, $5, $6, $7, $8, $9, $10, FALSE, NOW(), NOW())"
    )
    try:
        execute_raw = getattr(prisma, "execute_raw", None)
        if execute_raw is None:
            raise RuntimeError("Prisma client has no execute_raw")
        await execute_raw(
            raw_insert_sql,
            fallback_id,
            doc_type,
            "QUEUED",
            bucket,
            object_key,
            file_name,
            content_type,
            int(size_bytes),
            int(page_count),
            user_id,
        )
        created = await prisma.document.find_unique(where={"id": fallback_id})
        if created is not None:
            return created
        raise RuntimeError("raw_sql_insert_succeeded_but_record_not_found")
    except Exception as exc:
        attempt_errors.append(f"raw_sql[parametrized]: {exc}")

    # Backup raw fallback without parameters (for runtime variants that don't
    # support execute_raw bindings in this environment).
    fallback_id = str(uuid4())
    raw_insert_sql_unbound = (
        'INSERT INTO "public"."documents" '
        '("id","doc_type","status","bucket","object_key","file_name","content_type","size_bytes","total_pages","uploaded_by","is_deleted","created_at","updated_at") '
        f"VALUES ({_sql_quote(fallback_id)}::uuid, {_sql_quote(doc_type)}::text::\"public\".\"DocType\", {_sql_quote('QUEUED')}::text::\"public\".\"DocumentStatus\", "
        f"{_sql_quote(bucket)}, {_sql_quote(object_key)}, {_sql_quote(file_name)}, {_sql_quote(content_type)}, "
        f"{_sql_quote(int(size_bytes))}, {_sql_quote(int(page_count))}, {_sql_quote(user_id)}, FALSE, NOW(), NOW())"
    )
    try:
        execute_raw = getattr(prisma, "execute_raw", None)
        if execute_raw is None:
            raise RuntimeError("Prisma client has no execute_raw")
        await execute_raw(raw_insert_sql_unbound)
        created = await prisma.document.find_unique(where={"id": fallback_id})
        if created is not None:
            return created
        raise RuntimeError("raw_sql_unbound_insert_succeeded_but_record_not_found")
    except Exception as exc:
        attempt_errors.append(f"raw_sql[unbound]: {exc}")

    if last_exc is not None:
        raise RuntimeError(
            "Failed to create document record after docType compatibility retries. "
            + " | ".join(attempt_errors)
        ) from last_exc
    raise RuntimeError("Unable to create document record")


def _bucket_slug_from_doc_type(doc_type: str) -> str:
    normalized_doc_type = str(doc_type or "").strip().upper()
    if normalized_doc_type == "CUSTOMER_BROKER_BILL":
        return "customs-broker-bill"
    if normalized_doc_type == "DRAFT_CBP_FORM_7501_BROKER":
        return _bucket_slug_from_doc_type("ENTRY_SUMMARY")
    return normalize_bucket_name(doc_type.lower().replace("_", "-"))


async def _create_document_page_record(
    *,
    prisma,
    document_id: str,
    page_no: int,
    bucket: str,
    object_key: str,
    size_bytes: int,
) -> object:
    return await prisma.documentpage.create(
        data={
            "documentId": document_id,
            "pageNo": page_no,
            "bucket": bucket,
            "objectKey": object_key,
            "sizeBytes": size_bytes,
            "isExtractionSource": True,
        }
    )


_DOC_TYPE_ENUM_CACHE: set[str] | None = None


async def _database_doc_type_values(prisma) -> set[str]:
    global _DOC_TYPE_ENUM_CACHE
    if _DOC_TYPE_ENUM_CACHE is not None:
        return _DOC_TYPE_ENUM_CACHE
    rows = await prisma.query_raw(
        """
        SELECT enumlabel AS value
        FROM pg_enum
        WHERE enumtypid = '"public"."DocType"'::regtype
        """
    )
    _DOC_TYPE_ENUM_CACHE = {
        str((row.get("value") if isinstance(row, dict) else getattr(row, "value", "")) or "")
        for row in rows
    }
    return _DOC_TYPE_ENUM_CACHE


async def _add_database_doc_type_value(prisma, doc_type: str) -> None:
    global _DOC_TYPE_ENUM_CACHE
    execute_raw = getattr(prisma, "execute_raw", None)
    if execute_raw is None:
        raise RuntimeError("Prisma client has no execute_raw")
    await execute_raw(f'ALTER TYPE "public"."DocType" ADD VALUE IF NOT EXISTS {_sql_quote(doc_type)}')
    _DOC_TYPE_ENUM_CACHE = None


async def _ensure_database_doc_type_supported(prisma, doc_type: str) -> None:
    try:
        values = await _database_doc_type_values(prisma)
    except Exception:
        return
    if doc_type not in values:
        try:
            await _add_database_doc_type_value(prisma, doc_type)
            values = await _database_doc_type_values(prisma)
        except Exception as exc:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Database DocType enum does not include {doc_type}, and the backend could not add it automatically. "
                    "Run the Prisma migration backend/prisma/migrations/"
                    f"20260729_draft_cbp_form_7501_broker/migration.sql on the active database. Detail: {exc}"
                ),
            ) from exc
        if doc_type not in values:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Database DocType enum does not include {doc_type}. "
                    "Run the Prisma migration backend/prisma/migrations/"
                    "20260729_draft_cbp_form_7501_broker/migration.sql on the active database."
                ),
            )


async def _stage_detection_file(*, file: UploadFile, user_id: str) -> DocumentClassificationQueuedResponse:
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    file_name = Path(file.filename or "upload").name
    content_type = (file.content_type or "application/octet-stream").lower()
    bucket = normalize_bucket_name(DEFAULT_BUCKET or settings.S3_DEFAULT_BUCKET)
    bucket_error = validate_bucket_name(bucket)
    if bucket_error:
        raise HTTPException(status_code=400, detail=f"{bucket_error}. Received bucket value: {bucket!r}")

    object_key = build_object_key(file_name, DETECTION_STAGING_MODULE, datetime.now())
    try:
        upload_bytes(
            body=file_bytes,
            bucket=bucket,
            object_key=object_key,
            content_type=content_type,
        )
        job_id = await enqueue_detection_job(
            bucket=bucket,
            object_key=object_key,
            file_name=file_name,
            content_type=content_type,
            user_id=str(user_id),
        )
    except HTTPException:
        raise
    except Exception as exc:
        try:
            delete_document_object(bucket, object_key)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to queue document classification: {exc}")

    return DocumentClassificationQueuedResponse(
        status="queued",
        message="Document classification queued.",
        classificationJobId=job_id,
        fileName=file_name,
    )


def _serialize_detection_status(payload: dict[str, Any]) -> DocumentClassificationStatusResponse:
    return DocumentClassificationStatusResponse(
        status=str(payload.get("status") or "queued"),
        message=str(payload.get("message") or "Document classification queued."),
        classificationJobId=str(payload.get("classificationJobId") or ""),
        fileName=str(payload.get("fileName") or ""),
        docType=(str(payload.get("docType")) if payload.get("docType") is not None else None),
        label=(str(payload.get("label")) if payload.get("label") is not None else None),
        confidence=(float(payload.get("confidence")) if payload.get("confidence") is not None else None),
        reasoning=(str(payload.get("reasoning")) if payload.get("reasoning") is not None else None),
        matchedFields=payload.get("matchedFields") if isinstance(payload.get("matchedFields"), list) else [],
        alternatives=payload.get("alternatives") if isinstance(payload.get("alternatives"), list) else [],
    )


@legacy_router.post("/classify", response_model=DocumentClassificationQueuedResponse)
@router.post("/classify", response_model=DocumentClassificationQueuedResponse)
async def classify_upload_document(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
    _authz=Depends(require_activity("documents.upload")),
):
    return await _stage_detection_file(file=file, user_id=user.id)


@legacy_router.post("/classify/bulk", response_model=DocumentClassificationBulkResponse)
@router.post("/classify/bulk", response_model=DocumentClassificationBulkResponse)
async def classify_upload_documents_bulk(
    files: list[UploadFile] = File(...),
    user=Depends(get_current_user),
    _authz=Depends(require_activity("documents.upload")),
):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    if len(files) > MAX_BULK_CLASSIFY_FILES:
        raise HTTPException(status_code=400, detail=f"Bulk auto-detect supports at most {MAX_BULK_CLASSIFY_FILES} files")

    jobs: list[DocumentClassificationJobItem] = []
    for file in files:
        queued = await _stage_detection_file(file=file, user_id=user.id)
        jobs.append(
            DocumentClassificationJobItem(
                classificationJobId=queued.classificationJobId,
                fileName=queued.fileName,
                status=queued.status,
                message=queued.message,
            )
        )

    return DocumentClassificationBulkResponse(
        status="queued",
        message=f"{len(jobs)} document classification job{'s' if len(jobs) != 1 else ''} queued.",
        jobs=jobs,
    )


@legacy_router.get("/classify/jobs/{classification_job_id}", response_model=DocumentClassificationStatusResponse)
@router.get("/classify/jobs/{classification_job_id}", response_model=DocumentClassificationStatusResponse)
async def get_classification_job_status(classification_job_id: str, user=Depends(get_current_user)):
    payload = await get_detection_status(classification_job_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Classification job not found")
    if str(payload.get("userId") or "") != str(user.id):
        raise HTTPException(status_code=404, detail="Classification job not found")
    return _serialize_detection_status(payload)


@router.post("/upload", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    docType: str = Form(...),
    bucket: str | None = Form(None),
    module: str | None = Form(None),
    user=Depends(get_current_user),
    _authz=Depends(require_activity("documents.upload")),
):
    prisma = await get_prisma()

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    file_name = Path(file.filename or "upload").name
    suffix = Path(file_name).suffix.lower()
    content_type = (file.content_type or "application/octet-stream").lower()
    is_pdf = suffix == ".pdf" or content_type == "application/pdf"
    normalized_doc_type = str(docType or "").strip().upper()
    if normalized_doc_type not in DOC_TYPE_VALUES:
        raise HTTPException(status_code=400, detail=f"Unsupported docType: {docType!r}")
    _require_doc_type_action(user, "upload", normalized_doc_type)
    await _ensure_database_doc_type_supported(prisma, normalized_doc_type)

    default_bucket_from_doc_type = _bucket_slug_from_doc_type(normalized_doc_type)
    raw_bucket = bucket or default_bucket_from_doc_type or DEFAULT_BUCKET or settings.S3_DEFAULT_BUCKET
    target_bucket = normalize_bucket_name(raw_bucket)
    bucket_error = validate_bucket_name(target_bucket)
    if bucket_error:
        raise HTTPException(
            status_code=400,
            detail=f"{bucket_error}. Received bucket value: {raw_bucket!r}",
        )

    target_module = (module or default_bucket_from_doc_type or DEFAULT_MODULE).strip() or DEFAULT_MODULE

    created_objects: list[tuple[str, str]] = []
    created_document_id: str | None = None
    upload_time = datetime.now()

    try:
        total_pages = 1
        source_object_key = build_object_key(file_name, target_module, upload_time)
        upload_bytes(
            body=file_bytes,
            bucket=target_bucket,
            object_key=source_object_key,
            content_type=content_type,
        )
        created_objects.append((target_bucket, source_object_key))

        if is_pdf:
            try:
                total_pages = len(PdfReader(BytesIO(file_bytes)).pages)
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Invalid PDF file: {exc}")
        else:
            total_pages = 1

        document = await _create_document_record(
            prisma=prisma,
            user_id=user.id,
            doc_type=normalized_doc_type,
            bucket=target_bucket,
            object_key=source_object_key,
            file_name=file_name,
            content_type=content_type,
            size_bytes=len(file_bytes),
            page_count=total_pages,
        )
        created_document_id = document.id
        if normalized_doc_type == "SALES_INVOICE":
            try:
                await ensure_doc_generation_views(prisma)
                print("[docgen][views] ensured after sales invoice upload", flush=True)
            except Exception as exc:
                print(f"[docgen][views] warning: could not ensure views after sales invoice upload: {exc}", flush=True)

        await asyncio.wait_for(
            enqueue_upload_job(
                document_id=document.id,
                bucket=target_bucket,
                module=target_module,
            ),
            timeout=10,
        )

        return UploadResponse(
            status="success",
            message="File uploaded successfully",
            documents=[
                UploadDocumentItem(
                    id=document.id,
                    bucket=document.bucket,
                    objectKey=document.objectKey,
                    fileName=document.fileName,
                    filePath=_storage_path(document.bucket, document.objectKey),
                    pageCount=document.totalPages,
                    isPDF=is_pdf,
                    s3Endpoint=S3_ENDPOINT or "",
                    ocrStatus="queued",
                    extractionId=None,
                    ocrReason=None,
                )
            ],
        )
    except HTTPException:
        if created_document_id:
            try:
                await prisma.document.delete(where={"id": created_document_id})
            except Exception:
                pass
        for object_bucket, object_key in reversed(created_objects):
            try:
                delete_document_object(object_bucket, object_key)
            except Exception:
                pass
        raise
    except Exception as exc:
        if created_document_id:
            try:
                await prisma.document.delete(where={"id": created_document_id})
            except Exception:
                pass
        for object_bucket, object_key in reversed(created_objects):
            try:
                delete_document_object(object_bucket, object_key)
            except Exception:
                pass
        if "InvalidBucketName" in str(exc):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid bucket name after normalization. "
                    f"Use lowercase letters, numbers, dots, or hyphens only. Bucket: {target_bucket!r}"
                ),
            )
        if isinstance(exc, asyncio.TimeoutError):
            raise HTTPException(
                status_code=503,
                detail="Upload could not start OCR because queue enqueue timed out. Check Redis and the upload/ocr workers.",
            )
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")


DOCUMENT_LIST_PAGE_SIZE = 20
DOCUMENT_SECTION_STATUS_FILTERS: Final[dict[str, set[str]]] = {
    "needs-approval": {"EXTRACTED"},
    "processing": {"QUEUED", "PROCESSING", "REPROCESSING"},
    "cross-validating": {"REVIEWED"},
    "draft-review": {"UPLOADED"},
    "done": {"ARCHIVED", "REVIEWED"},
}
_DOCUMENT_QUEUE_INDEXES_READY = False


async def _ensure_document_queue_indexes(prisma) -> None:
    global _DOCUMENT_QUEUE_INDEXES_READY
    if _DOCUMENT_QUEUE_INDEXES_READY:
        return
    try:
        await prisma.execute_raw(
            """
            CREATE INDEX IF NOT EXISTS "idx_documents_queue_user_created"
            ON "public"."documents" ("uploaded_by", "is_deleted", "created_at" DESC)
            """
        )
        await prisma.execute_raw(
            """
            CREATE INDEX IF NOT EXISTS "idx_documents_queue_status_created"
            ON "public"."documents" ("status", "is_deleted", "created_at" DESC)
            """
        )
        _DOCUMENT_QUEUE_INDEXES_READY = True
    except Exception:
        # Queue loading must still work if this DB user cannot create indexes.
        _DOCUMENT_QUEUE_INDEXES_READY = True


def _document_section_where(*, user: Any, section: str) -> dict[str, Any]:
    where: dict[str, Any] = document_prisma_where(user)
    statuses = DOCUMENT_SECTION_STATUS_FILTERS.get(section)
    if statuses:
        where["status"] = {"in": sorted(statuses)}
    return where


def _validation_active_clause(document_alias: str = "d") -> str:
    return f"""
        (
          UPPER(COALESCE({document_alias}."validation_status", '')) IN ('BLOCKED', 'WAITING')
          OR EXISTS (
            SELECT 1
            FROM "document_module"."document_validation_status" dvs
            WHERE dvs."document_id" = {document_alias}."id"::text
              AND dvs."status" IN ('BLOCKED', 'WAITING')
          )
        )
    """


async def _document_count(*, prisma, user: Any, section: str) -> int:
    if has_role_document_scope(user):
        try:
            access_where, access_params, next_param = document_sql_where("d", user)
            if section == "all":
                rows = await prisma.query_raw(
                    f'SELECT COUNT(*) AS count FROM "public"."documents" d WHERE {access_where}',
                    *access_params,
                )
                return int((rows[0] if rows else {}).get("count") or 0)

            if section in {"cross-validating", "done"}:
                await _ensure_cross_validation_tables(prisma)
                validation_active_clause = _validation_active_clause("d")
                if section == "done":
                    section_clause = (
                        f"""(d."status"::text = 'ARCHIVED'
                        OR (d."status"::text = 'REVIEWED' AND NOT {validation_active_clause}))"""
                    )
                else:
                    section_clause = f"""d."status"::text = 'REVIEWED' AND {validation_active_clause}"""
                rows = await prisma.query_raw(
                    f'SELECT COUNT(*) AS count FROM "public"."documents" d WHERE {access_where} AND {section_clause}',
                    *access_params,
                )
                return int((rows[0] if rows else {}).get("count") or 0)

            statuses = DOCUMENT_SECTION_STATUS_FILTERS.get(section) or set()
            rows = await prisma.query_raw(
                f"""
                SELECT COUNT(*) AS count
                FROM "public"."documents" d
                WHERE {access_where}
                  AND d."status"::text = ANY(${next_param}::text[])
                """,
                *access_params,
                sorted(statuses),
            )
            return int((rows[0] if rows else {}).get("count") or 0)
        except Exception:
            return 0

    current_user_id = user_id(user)
    if section in {"cross-validating", "done"}:
        validation_active_clause = _validation_active_clause("d")
        if section == "done":
            sql = f"""
                SELECT COUNT(*) AS count
                FROM "public"."documents" d
                WHERE d."uploaded_by"::text = $1::text
                  AND d."is_deleted" = false
                  AND (
                    d."status"::text = 'ARCHIVED'
                    OR (d."status"::text = 'REVIEWED' AND NOT {validation_active_clause})
                  )
            """
        else:
            sql = f"""
                SELECT COUNT(*) AS count
                FROM "public"."documents" d
                WHERE d."uploaded_by"::text = $1::text
                  AND d."is_deleted" = false
                  AND d."status"::text = 'REVIEWED'
                  AND {validation_active_clause}
            """
        try:
            await _ensure_cross_validation_tables(prisma)
            rows = await prisma.query_raw(sql, current_user_id)
            return int((rows[0] if rows else {}).get("count") or 0)
        except Exception:
            return 0
    try:
        return int(await prisma.document.count(where=_document_section_where(user=user, section=section)))
    except Exception:
        return 0


def _document_matches_section(status: str, validation_status: str | None, section: str) -> bool:
    normalized_status = str(status or "").upper()
    normalized_validation = str(validation_status or "").upper()
    validation_active = normalized_validation in {"BLOCKED", "WAITING"}
    if section == "all":
        return True
    if section == "done":
        return normalized_status == "ARCHIVED" or (normalized_status == "REVIEWED" and not validation_active)
    if section == "cross-validating":
        return normalized_status == "REVIEWED" and validation_active
    statuses = DOCUMENT_SECTION_STATUS_FILTERS.get(section)
    return normalized_status in (statuses or set())


async def _document_validation_statuses(prisma, document_ids: list[str]) -> dict[str, str]:
    if not document_ids:
        return {}
    try:
        await _ensure_cross_validation_tables(prisma)
        rows = await prisma.query_raw(
            """
            SELECT "document_id", "status"
            FROM "document_module"."document_validation_status"
            WHERE "document_id" = ANY($1::text[])
            """,
            document_ids,
        )
        return {str(row["document_id"]): str(row.get("status") or "") for row in rows}
    except Exception:
        return {}


async def _document_validation_snapshots(prisma, document_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not document_ids:
        return {}
    try:
        await _ensure_cross_validation_tables(prisma)
        status_rows = await prisma.query_raw(
            """
            SELECT "document_id", "status", "summary", "total_rules",
                   "blocking_failures", "warnings", "waiting"
            FROM "document_module"."document_validation_status"
            WHERE "document_id" = ANY($1::text[])
            """,
            document_ids,
        )
        snapshots: dict[str, dict[str, Any]] = {}
        for row in status_rows:
            document_id = str(row["document_id"])
            summary = row.get("summary") or {}
            if not isinstance(summary, dict):
                summary = {}
            snapshots[document_id] = {
                "status": str(row.get("status") or ""),
                "summary": {
                    **summary,
                    "total": int(row.get("total_rules") or summary.get("total") or 0),
                    "blockingFailures": int(row.get("blocking_failures") or summary.get("blockingFailures") or 0),
                    "warnings": int(row.get("warnings") or summary.get("warnings") or 0),
                    "waiting": int(row.get("waiting") or summary.get("waiting") or 0),
                },
                "results": [],
            }

        result_rows = await prisma.query_raw(
            """
            SELECT
              "document_id", "target_document_id", "rule_code", "source_doc_type",
              "target_doc_type", "source_field", "target_field", "match_type",
              "blocking_behavior", "status", "source_value", "target_value",
              "delta", "alert_level", "result_payload", "updated_at"
            FROM "document_module"."validation_results"
            WHERE "document_id" = ANY($1::text[])
            ORDER BY "document_id" ASC, "rule_code" ASC
            """,
            document_ids,
        )
        for row in result_rows:
            document_id = str(row.get("document_id") or "")
            if not document_id:
                continue
            payload = row.get("result_payload") or {}
            if not isinstance(payload, dict):
                payload = {}
            snapshots.setdefault(document_id, {"status": "", "summary": None, "results": []})
            snapshots[document_id]["results"].append(
                {
                    "targetDocumentId": row.get("target_document_id"),
                    "ruleCode": row.get("rule_code"),
                    "description": payload.get("description") or payload.get("rule_description") or row.get("rule_code"),
                    "sourceDocType": row.get("source_doc_type"),
                    "targetDocType": row.get("target_doc_type"),
                    "sourceField": row.get("source_field"),
                    "targetField": row.get("target_field"),
                    "matchType": row.get("match_type"),
                    "blockingBehavior": row.get("blocking_behavior"),
                    "status": row.get("status"),
                    "sourceValue": row.get("source_value"),
                    "targetValue": row.get("target_value"),
                    "delta": row.get("delta"),
                    "alertLevel": row.get("alert_level"),
                    "updatedAt": _to_iso(row.get("updated_at")),
                }
            )
        return snapshots
    except Exception:
        return {}


def _validation_snapshot_needs_refresh(snapshot: dict[str, Any]) -> bool:
    if not snapshot.get("status"):
        return True
    summary = snapshot.get("summary") or {}
    if int(summary.get("total") or 0) == 0:
        return True
    if str(snapshot.get("status") or "").upper() == "WAITING" or int(summary.get("waiting") or 0) > 0:
        return True
    stale_paths = {
        "lineItems[].invoiceReferences",
        "lineItems[].grossWeights",
        "containersRaw",
        "containers[]",
    }
    for result in snapshot.get("results") or []:
        if result.get("sourceField") in stale_paths or result.get("targetField") in stale_paths:
            return True
    return False


@router.get("/documents", response_model=DocumentListResponse)
async def list_documents(
    page: int = Query(1, ge=1),
    page_size: int = Query(DOCUMENT_LIST_PAGE_SIZE, alias="pageSize", ge=1, le=DOCUMENT_LIST_PAGE_SIZE),
    section: str = Query("all"),
    user=Depends(get_current_user),
):
    prisma = await get_prisma()
    normalized_section = (section or "all").strip().lower()
    if normalized_section not in {"all", *DOCUMENT_SECTION_STATUS_FILTERS.keys()}:
        raise HTTPException(status_code=400, detail=f"Unsupported document section: {section!r}")

    try:
        await _ensure_document_queue_indexes(prisma)
        where = _document_section_where(user=user, section=normalized_section)
        total = int(await prisma.document.count(where=where))
        total_pages = max(1, (total + page_size - 1) // page_size)
        safe_page = min(page, total_pages)
        skip = (safe_page - 1) * page_size
        rows = await prisma.document.find_many(
            where=where,
            order={"createdAt": "desc"},
            skip=skip,
            take=page_size,
        )
        validation_snapshots = await _document_validation_snapshots(
            prisma,
            [str(row.id) for row in rows],
        )
        documents: list[DocumentListItem] = []
        for row in rows:
            status = await _status_from_db_with_stale_recovery(prisma=prisma, row=row)
            validation_snapshot = validation_snapshots.get(str(row.id), {})
            validation_status = validation_snapshot.get("status") or getattr(row, "validationStatus", None)
            if not _document_matches_section(status, validation_status, normalized_section):
                continue
            extraction = await _fetch_extraction_direct(
                prisma=prisma,
                doc_type=str(row.docType),
                document_id=str(row.id),
            )
            documents.append(
                DocumentListItem(
                    id=row.id,
                    docType=str(row.docType),
                    filePath=_storage_path(row.bucket, row.objectKey),
                    fileName=row.fileName,
                    bucket=row.bucket,
                    objectKey=row.objectKey,
                    contentType=row.contentType,
                    sizeBytes=int(row.sizeBytes),
                    createdAt=row.createdAt.isoformat() if row.createdAt else "",
                    updatedAt=row.updatedAt.isoformat() if row.updatedAt else "",
                    validationStatus=validation_status,
                    validationSummary=validation_snapshot.get("summary"),
                    validationResults=validation_snapshot.get("results") or [],
                    status=status,
                    pageCount=row.totalPages,
                    isPDF=row.contentType == "application/pdf" or row.fileName.lower().endswith(".pdf"),
                    previewUrl=_safe_download_url(row.bucket, row.objectKey),
                    ocrConfidence=_extract_ocr_confidence(extraction),
                )
            )
        (
            total_count,
            needs_approval_count,
            processing_count,
            cross_validating_count,
            draft_review_count,
            done_count,
        ) = await asyncio.gather(
            _document_count(prisma=prisma, user=user, section="all"),
            _document_count(prisma=prisma, user=user, section="needs-approval"),
            _document_count(prisma=prisma, user=user, section="processing"),
            _document_count(prisma=prisma, user=user, section="cross-validating"),
            _document_count(prisma=prisma, user=user, section="draft-review"),
            _document_count(prisma=prisma, user=user, section="done"),
        )
        counts = DocumentListCounts(
            total=total_count,
            needsApproval=needs_approval_count,
            processing=processing_count,
            crossValidating=cross_validating_count,
            draftReview=draft_review_count,
            done=done_count,
        )
        return DocumentListResponse(
            documents=documents,
            counts=counts,
            pagination=DocumentListPagination(
                page=safe_page,
                pageSize=page_size,
                total=total,
                totalPages=total_pages,
                hasNextPage=safe_page < total_pages,
                hasPreviousPage=safe_page > 1,
            ),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch documents: {exc}")


@router.get("/documents-approved")
async def list_approved_documents_for_shipments(user=Depends(get_current_user)):
    """Read the automatically updated document-module SQL view."""
    prisma = await get_prisma()
    await ensure_document_module_views(prisma)
    access_where, access_params, _ = document_module_sql_where("d", user)
    projection = await prisma.query_raw(
        f"""
        SELECT v.document_id, v.doc_type, v.file_name, v.document_number,
               v.gate_number, v.gate_code, v.is_parallel, v.approved_at,
               v.extracted_at, v.extracted_data, v.shipment_id,
               COALESCE(dvs."status", d."validation_status") AS validation_status
        FROM document_module.v_shipment_gate_documents v
        JOIN public.documents d ON d.id = v.document_id
        LEFT JOIN document_module.document_validation_status dvs
          ON dvs."document_id"::text = v.document_id::text
        WHERE {access_where}
        ORDER BY v.approved_at DESC
        """,
        *access_params,
    )
    documents: list[dict[str, Any]] = []
    for row in projection:
        extracted_data = row.get("extracted_data") or {}
        documents.append({
            "id": str(row["document_id"]),
            "documentType": row["doc_type"],
            "documentNumber": row.get("document_number"),
            "fileName": row["file_name"],
            "status": "REVIEWED",
            "approvedAt": _to_iso(row.get("approved_at")),
            "extractedAt": _to_iso(row.get("extracted_at")),
            "validationStatus": row.get("validation_status"),
            "extractedData": extracted_data,
            "shipmentId": row.get("shipment_id"),
            "gateNumber": row.get("gate_number"),
            "gateCode": row.get("gate_code"),
            "isParallel": bool(row.get("is_parallel")),
            "isGenerated": False,
        })

    generated_rows = await prisma.query_raw(
        """
        SELECT id, generated_doc_type, source_document_ids, rendered_payload,
               updated_at
        FROM docgen.drafts
        WHERE status = 'GENERATED'::docgen."DocGenerationStatus"
          AND created_by::text = $1::text
        ORDER BY updated_at DESC
        """,
        str(user.id),
    )
    for row in generated_rows:
        payload = row.get("rendered_payload") or {}
        payload = payload if isinstance(payload, dict) else {}
        generated_type = str(row.get("generated_doc_type") or "")
        if not can_do_doc_type_action(user, "view", generated_type):
            continue
        flattened_fields: dict[str, Any] = {}
        for section in payload.get("sections", []):
            if not isinstance(section, dict):
                continue
            for field in section.get("fields", []):
                if isinstance(field, dict) and field.get("targetField"):
                    flattened_fields[str(field["targetField"])] = field.get("value")
        extracted_data = {
            **payload,
            **flattened_fields,
            "sourceDocumentIds": row.get("source_document_ids") or {},
        }
        display_name = str(payload.get("displayName") or generated_type.replace("_", " ").title())
        documents.append({
            "id": str(row["id"]),
            "documentType": generated_type,
            "documentNumber": flattened_fields.get("invoiceNo"),
            "fileName": f"{display_name}.pdf",
            "status": "REVIEWED",
            "approvedAt": _to_iso(row.get("updated_at")),
            "extractedAt": _to_iso(row.get("updated_at")),
            "extractedData": extracted_data,
            "shipmentId": None,
            "gateNumber": 1 if generated_type == "PACKING_LIST" else (
                3 if generated_type == "ENTRY_SUMMARY" else 5
            ),
            "gateCode": "PL" if generated_type == "PACKING_LIST" else (
                "BE" if generated_type == "ENTRY_SUMMARY" else "UP"
            ),
            "isParallel": False,
            "isGenerated": True,
        })
    return {"ok": True, "data": documents, "meta": {"total": len(documents)}}


@router.get("/documents/{document_id}/queue-item", response_model=DocumentListItem)
async def get_document_queue_item(document_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    where = document_prisma_where(user)
    where["id"] = document_id
    row = await prisma.document.find_first(
        where=where,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")

    validation_snapshot = (await _document_validation_snapshots(prisma, [str(row.id)])).get(str(row.id), {})
    extraction = await _fetch_extraction_direct(
        prisma=prisma,
        doc_type=str(row.docType),
        document_id=str(row.id),
    )
    status = await _status_from_db_with_stale_recovery(prisma=prisma, row=row)
    return DocumentListItem(
        id=row.id,
        docType=str(row.docType),
        filePath=_storage_path(row.bucket, row.objectKey),
        fileName=row.fileName,
        bucket=row.bucket,
        objectKey=row.objectKey,
        contentType=row.contentType,
        sizeBytes=int(row.sizeBytes),
        createdAt=row.createdAt.isoformat() if row.createdAt else "",
        updatedAt=row.updatedAt.isoformat() if row.updatedAt else "",
        validationStatus=validation_snapshot.get("status"),
        validationSummary=validation_snapshot.get("summary"),
        validationResults=validation_snapshot.get("results") or [],
        status=status,
        pageCount=row.totalPages,
        isPDF=row.contentType == "application/pdf" or row.fileName.lower().endswith(".pdf"),
        previewUrl=_safe_download_url(row.bucket, row.objectKey),
        ocrConfidence=_extract_ocr_confidence(extraction),
    )


@router.get("/documents/{document_id}", response_model=DocumentDetailItem)
async def get_document(document_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    where = document_prisma_where(user)
    where["id"] = document_id

    try:
        row = await prisma.document.find_first(
            where=where,
            include={"pages": True},
        )
    except Exception:
        row = await prisma.document.find_first(
            where=where,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")

    doc_type = str(row.docType)
    extraction_obj = await _fetch_extraction_direct(
        prisma=prisma,
        doc_type=doc_type,
        document_id=str(row.id),
    )
    try:
        child_arrays = await _fetch_extraction_child_arrays(
            prisma=prisma,
            doc_type=doc_type,
            extraction=extraction_obj,
        )
        extraction = _serialize_extraction(
            extraction_obj,
            doc_type=doc_type,
            child_arrays=child_arrays,
        )
    except Exception:
        extraction = None

    sales_invoice_extraction = extraction if doc_type == "SALES_INVOICE" else None
    try:
        status = await _status_from_db_with_stale_recovery(prisma=prisma, row=row)
        validation_snapshot = (await _document_validation_snapshots(prisma, [str(row.id)])).get(str(row.id), {})
        return DocumentDetailItem(
            id=str(row.id),
            docType=str(row.docType),
            status=status,
            validationStatus=validation_snapshot.get("status"),
            validationSummary=validation_snapshot.get("summary"),
            validationResults=validation_snapshot.get("results") or [],
            bucket=str(row.bucket),
            objectKey=str(row.objectKey),
            fileName=str(row.fileName),
            filePath=_storage_path(str(row.bucket), str(row.objectKey)),
            contentType=str(row.contentType),
            sizeBytes=int(row.sizeBytes),
            checksum=(str(row.checksum) if row.checksum is not None else None),
            totalPages=(int(row.totalPages) if row.totalPages is not None else None),
            uploadedBy=str(row.uploadedBy),
            isDeleted=bool(row.isDeleted),
            createdAt=_to_iso(getattr(row, "createdAt", None)) or "",
            updatedAt=_to_iso(getattr(row, "updatedAt", None)) or "",
            previewUrl=_safe_download_url(str(row.bucket), str(row.objectKey)),
            pages=_safe_pages(row),
            extraction=extraction,
            salesInvoiceExtraction=sales_invoice_extraction,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to serialize document detail: {exc}")


@router.patch("/documents/{document_id}/extraction")
async def update_document_extraction(
    document_id: str,
    payload: UpdateExtractionRequest,
    user=Depends(get_current_user),
    _authz=Depends(require_activity("documents.edit_extracted")),
):
    prisma = await get_prisma()
    where = document_prisma_where(user)
    where["id"] = document_id
    document = await prisma.document.find_first(
        where=where,
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    doc_type = str(document.docType)
    _require_doc_type_action(user, "approve_extraction", doc_type)
    parent_model = DOC_TYPE_TO_PRISMA_PARENT_MODEL.get(doc_type)
    accessor_name = DOC_TYPE_TO_EXTRACTION_ACCESSOR.get(doc_type)
    if not parent_model or not accessor_name:
        raise HTTPException(status_code=400, detail=f"Editing is not configured for {doc_type}")

    schema = load_extraction_schema(parent_model=parent_model)
    unknown_fields = set(payload.fields) - set(schema.scalar_fields)
    unknown_arrays = set(payload.arrays) - set(schema.array_fields)
    if unknown_fields or unknown_arrays:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Unsupported extraction fields",
                "fields": sorted(unknown_fields),
                "arrays": sorted(unknown_arrays),
            },
        )

    extraction_data: dict[str, Any] = {
        key: (None if value in ("", None) else str(value))
        for key, value in payload.fields.items()
    }
    for array_name, rows in payload.arrays.items():
        allowed = set(schema.array_item_fields.get(array_name, []))
        extraction_data[array_name] = [
            {
                key: (None if value in ("", None) else str(value))
                for key, value in row.items()
                if key in allowed
            }
            for row in rows
        ]

    extraction = await upsert_extraction_with_children(
        prisma=prisma,
        model_accessor_name=accessor_name,
        schema=schema,
        document_id=document_id,
        extraction_data=extraction_data,
        strict_children=True,
    )
    return {
        "ok": True,
        "documentId": document_id,
        "extractionId": str(extraction.id),
    }


@router.get("/documents/{document_id}/container-mapping")
async def get_bol_container_mapping(
    document_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, alias="pageSize", ge=1, le=100),
    unmapped_only: bool = Query(False, alias="unmappedOnly"),
    user=Depends(get_current_user),
):
    try:
        return await build_container_mapping(
            prisma=await get_prisma(),
            bol_document_id=document_id,
            uploaded_by=str(user.id),
            page=page,
            page_size=page_size,
            unmapped_only=unmapped_only,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.patch("/documents/{document_id}/container-mapping")
async def update_bol_container_mapping(
    document_id: str,
    payload: SaveContainerMappingRequest,
    user=Depends(get_current_user),
    _authz=Depends(require_activity("documents.approve_draft")),
):
    _require_doc_type_action(user, "approve_extraction", "BILL_OF_LADING")
    try:
        return await save_container_mapping(
            prisma=await get_prisma(),
            bol_document_id=document_id,
            uploaded_by=str(user.id),
            assignments=[assignment.model_dump() for assignment in payload.assignments],
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


async def _ensure_document_warehouse_mapping_table(prisma) -> None:
    await _execute_raw(prisma, 'CREATE SCHEMA IF NOT EXISTS "document_module"')
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "document_module"."document_warehouse_mappings" (
          "document_id" TEXT PRIMARY KEY,
          "warehouse_id" TEXT NOT NULL,
          "warehouse_name" TEXT NOT NULL,
          "mapped_by" TEXT,
          "mapped_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )


async def _get_warehouse_mapping_row(prisma, document_id: str) -> dict[str, Any] | None:
    await _ensure_document_warehouse_mapping_table(prisma)
    rows = await _query_raw(
        prisma,
        """
        SELECT
          "document_id", "warehouse_id", "warehouse_name",
          "mapped_by", "mapped_at", "updated_at"
        FROM "document_module"."document_warehouse_mappings"
        WHERE "document_id" = $1
        LIMIT 1
        """,
        document_id,
    )
    return rows[0] if rows else None


def _shipment_reference_candidates_from_payload(payload: Any) -> list[str]:
    accepted_keys = {
        "blorawbnumber",
        "additionalbls",
        "additionalbl",
        "mblnumber",
        "masterbl",
        "masterblnumber",
        "bolnumber",
        "billofladingnumber",
        "bookingnumber",
        "bookingreferencenumber",
        "shipmentnumber",
        "shipmentid",
    }
    candidates: list[str] = []

    def add_value(value: Any) -> None:
        if value in (None, ""):
            return
        if isinstance(value, list):
            for item in value:
                add_value(item)
            return
        text = str(value).strip()
        if not text:
            return
        for token in re.split(r"[,;/\n\r\t]+", text):
            clean_token = token.strip()
            if clean_token and clean_token not in candidates:
                candidates.append(clean_token)

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                normalized_key = re.sub(r"[^a-z0-9]", "", str(key).lower())
                if normalized_key in accepted_keys:
                    add_value(item)
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(payload)
    expanded = list(candidates)
    for candidate in candidates:
        normalized = re.sub(r"[^A-Za-z0-9]", "", candidate).upper()
        if normalized and normalized not in expanded:
            expanded.append(normalized)
        if candidate.upper().startswith("BOL-"):
            parts = [part for part in candidate.split("-") if part]
            if len(parts) >= 2 and parts[1] not in expanded:
                expanded.append(parts[1])
    return expanded


async def _resolve_operational_shipment_for_document(prisma, document_id: str) -> dict[str, Any] | None:
    await ensure_operational_shipment_tables(prisma)
    direct_rows = await _query_raw(
        prisma,
        """
        SELECT s."id"::text AS "shipment_id", s."shipment_number"
        FROM "public"."documents" d
        JOIN "public"."shipments" s ON s."id" = d."shipment_id"
        WHERE d."id"::text = $1::text
        LIMIT 1
        """,
        document_id,
    )
    if direct_rows:
        return direct_rows[0]

    await _ensure_cross_validation_tables(prisma)
    linked_bol_rows = await _query_raw(
        prisma,
        """
        SELECT s."id"::text AS "shipment_id", s."shipment_number"
        FROM "document_module"."validation_results" vr
        JOIN "public"."documents" bol_doc ON bol_doc."id"::text = vr."target_document_id"::text
        JOIN "public"."shipments" s ON s."id" = bol_doc."shipment_id"
        WHERE vr."document_id"::text = $1::text
          AND vr."target_doc_type" = 'BILL_OF_LADING'
        ORDER BY vr."updated_at" DESC
        LIMIT 1
        """,
        document_id,
    )
    if linked_bol_rows:
        return linked_bol_rows[0]

    detail_bol_rows = await _query_raw(
        prisma,
        """
        SELECT s."id"::text AS "shipment_id", s."shipment_number"
        FROM "document_ocr"."cross_validation_details" cvd
        JOIN "public"."documents" bol_doc ON bol_doc."id"::text = cvd."target_document_id"::text
        JOIN "public"."shipments" s ON s."id" = bol_doc."shipment_id"
        WHERE cvd."document_id"::text = $1::text
          AND cvd."target_doc_type" = 'BILL_OF_LADING'
        ORDER BY cvd."updated_at" DESC
        LIMIT 1
        """,
        document_id,
    )
    if detail_bol_rows:
        return detail_bol_rows[0]

    document_rows = await _query_raw(
        prisma,
        """
        SELECT "doc_type"::text AS "doc_type"
        FROM "public"."documents"
        WHERE "id"::text = $1::text
        LIMIT 1
        """,
        document_id,
    )
    if document_rows:
        try:
            payload = await _validation_payload_for_document(
                prisma,
                doc_type=str(document_rows[0].get("doc_type") or ""),
                document_id=document_id,
            )
        except Exception:
            payload = {}
        reference_candidates = _shipment_reference_candidates_from_payload(payload)
        if reference_candidates:
            reference_rows = await _query_raw(
                prisma,
                """
                SELECT "id"::text AS "shipment_id", "shipment_number"
                FROM "public"."shipments"
                WHERE "shipment_number" = ANY($1::text[])
                   OR "mbl_number" = ANY($1::text[])
                   OR "booking_number" = ANY($1::text[])
                   OR "bol_number" = ANY($1::text[])
                ORDER BY "updated_at" DESC
                LIMIT 1
                """,
                reference_candidates,
            )
            if reference_rows:
                return reference_rows[0]

    validation_rows = await _query_raw(
        prisma,
        """
        SELECT
          COALESCE(s."id"::text, dvs."shipment_id") AS "shipment_id",
          COALESCE(s."shipment_number", dvs."shipment_id") AS "shipment_number"
        FROM "document_module"."document_validation_status" dvs
        LEFT JOIN "public"."shipments" s
          ON s."shipment_number" = dvs."shipment_id"
          OR s."id"::text = dvs."shipment_id"
        WHERE dvs."document_id"::text = $1::text
        LIMIT 1
        """,
        document_id,
    )
    return validation_rows[0] if validation_rows else None


async def _serialize_warehouse_mapping(prisma, document_id: str) -> dict[str, Any]:
    row = await _get_warehouse_mapping_row(prisma, document_id)
    shipment = await _resolve_operational_shipment_for_document(prisma, document_id)
    shipment_number = shipment.get("shipment_number") if shipment else None
    operational_shipment_id = shipment.get("shipment_id") if shipment else None
    if not row:
        return {
            "documentId": document_id,
            "shipmentId": shipment_number,
            "operationalShipmentId": operational_shipment_id,
            "warehouseId": None,
            "warehouseName": None,
            "mappedAt": None,
            "updatedAt": None,
        }
    return {
        "documentId": str(row.get("document_id") or document_id),
        "shipmentId": shipment_number,
        "operationalShipmentId": operational_shipment_id,
        "warehouseId": row.get("warehouse_id"),
        "warehouseName": row.get("warehouse_name"),
        "mappedBy": row.get("mapped_by"),
        "mappedAt": _to_iso(row.get("mapped_at")),
        "updatedAt": _to_iso(row.get("updated_at")),
    }


@router.get("/documents/{document_id}/warehouse-mapping")
async def get_document_warehouse_mapping(document_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    where = document_prisma_where(user)
    where["id"] = document_id
    document = await prisma.document.find_first(where=where)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if str(document.docType) != "US_CARGO_RELEASE_ORDER":
        raise HTTPException(status_code=400, detail="Warehouse mapping is only available for US Cargo Release Order")
    return {"ok": True, "data": await _serialize_warehouse_mapping(prisma, document_id)}


@router.patch("/documents/{document_id}/warehouse-mapping")
async def update_document_warehouse_mapping(
    document_id: str,
    payload: SaveWarehouseMappingRequest,
    user=Depends(get_current_user),
    _authz=Depends(require_activity("documents.approve_draft")),
):
    prisma = await get_prisma()
    where = document_prisma_where(user)
    where["id"] = document_id
    document = await prisma.document.find_first(where=where)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    _require_doc_type_action(user, "approve_extraction", str(document.docType))
    if str(document.docType) != "US_CARGO_RELEASE_ORDER":
        raise HTTPException(status_code=400, detail="Warehouse mapping is only available for US Cargo Release Order")

    await _ensure_document_warehouse_mapping_table(prisma)
    warehouse_id = (payload.warehouseId or "").strip()
    if not warehouse_id:
        await _execute_raw(
            prisma,
            'DELETE FROM "document_module"."document_warehouse_mappings" WHERE "document_id" = $1',
            document_id,
        )
        return {"ok": True, "data": await _serialize_warehouse_mapping(prisma, document_id)}

    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "public"."warehouse_locations" (
          "id" TEXT PRIMARY KEY,
          "name" TEXT NOT NULL,
          "address" TEXT,
          "firms_code" TEXT,
          "port_locode" TEXT,
          "inbound_sla_hrs" DOUBLE PRECISION,
          "outbound_sla_hrs" DOUBLE PRECISION,
          "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
          "location_type" TEXT NOT NULL DEFAULT 'WAREHOUSE',
          "qc_checklist" JSONB NOT NULL DEFAULT '{"items":[]}'::jsonb,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    warehouse_rows = await _query_raw(
        prisma,
        """
        SELECT "id", "name"
        FROM "public"."warehouse_locations"
        WHERE "id" = $1 AND "is_active" = TRUE
        LIMIT 1
        """,
        warehouse_id,
    )
    if not warehouse_rows:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    warehouse_name = str(warehouse_rows[0].get("name") or warehouse_id)

    await _execute_raw(
        prisma,
        """
        INSERT INTO "document_module"."document_warehouse_mappings" (
          "document_id", "warehouse_id", "warehouse_name", "mapped_by", "mapped_at", "updated_at"
        )
        VALUES ($1, $2, $3, $4, NOW(), NOW())
        ON CONFLICT ("document_id") DO UPDATE SET
          "warehouse_id" = EXCLUDED."warehouse_id",
          "warehouse_name" = EXCLUDED."warehouse_name",
          "mapped_by" = EXCLUDED."mapped_by",
          "updated_at" = NOW()
        """,
        document_id,
        warehouse_id,
        warehouse_name,
        str(user.id),
    )
    return {"ok": True, "data": await _serialize_warehouse_mapping(prisma, document_id)}


@router.post("/documents/{document_id}/retry", response_model=RetryOcrResponse)
async def retry_document_ocr(
    document_id: str,
    user=Depends(get_current_user),
    _authz=Depends(require_activity("documents.reprocess_ocr")),
):
    prisma = await get_prisma()
    where = document_prisma_where(user)
    where["id"] = document_id
    document = await prisma.document.find_first(
        where=where,
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    await prisma.document.update(
        where={"id": document_id},
        data={"status": "REPROCESSING"},
    )

    # Retry route intentionally bypasses upload queue and triggers only the OCR stage.
    await enqueue_ocr_job(
        document_id=document_id,
        bucket=str(document.bucket),
        module=_bucket_slug_from_doc_type(str(document.docType)),
        force_reprocess=True,
    )

    return RetryOcrResponse(
        status="success",
        message="Document OCR retry queued",
        documentId=document_id,
        queue="ocr_worker",
    )


@router.post("/documents/{document_id}/reupload", response_model=ReuploadDocumentResponse)
async def reupload_document_for_validation(
    document_id: str,
    file: UploadFile = File(...),
    refreshGeneratedDrafts: bool = Form(False),
    user=Depends(get_current_user),
    _authz=Depends(require_activity("documents.upload")),
):
    prisma = await get_prisma()
    where = document_prisma_where(user)
    where["id"] = document_id
    document = await prisma.document.find_first(
        where=where,
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    file_name = Path(file.filename or "reupload").name
    suffix = Path(file_name).suffix.lower()
    content_type = (file.content_type or "application/octet-stream").lower()
    is_pdf = suffix == ".pdf" or content_type == "application/pdf"
    total_pages = 1
    if is_pdf:
        try:
            total_pages = len(PdfReader(BytesIO(file_bytes)).pages)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid PDF file: {exc}") from exc

    doc_type = str(document.docType)
    _require_doc_type_action(user, "upload", doc_type)
    target_bucket = str(document.bucket)
    target_module = _bucket_slug_from_doc_type(doc_type)
    upload_time = datetime.now()
    object_key = build_object_key(file_name, target_module, upload_time)

    try:
        upload_bytes(
            body=file_bytes,
            bucket=target_bucket,
            object_key=object_key,
            content_type=content_type,
        )
        await prisma.documentpage.delete_many(where={"documentId": document_id})
        accessor = DOC_TYPE_TO_EXTRACTION_ACCESSOR.get(doc_type)
        model_accessor = getattr(prisma, accessor, None) if accessor else None
        if model_accessor is not None:
            existing_extraction = await model_accessor.find_unique(where={"documentId": document_id})
            if existing_extraction:
                await model_accessor.update(
                    where={"documentId": document_id},
                    data={"reviewedBy": None, "reviewedAt": None},
                )
        await prisma.document.update(
            where={"id": document_id},
            data={
                "status": "REPROCESSING",
                "objectKey": object_key,
                "fileName": file_name,
                "contentType": content_type,
                "sizeBytes": len(file_bytes),
                "totalPages": total_pages,
            },
        )
        await enqueue_upload_job(
            document_id=document_id,
            bucket=target_bucket,
            module=target_module,
            force_reprocess=True,
            auto_validate=False,
            refresh_generated_drafts=refreshGeneratedDrafts,
        )
    except Exception as exc:
        try:
            delete_document_object(target_bucket, object_key)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to re-upload document: {exc}") from exc

    return ReuploadDocumentResponse(
        status="success",
        message="Document re-upload queued for OCR and re-approval",
        documentId=document_id,
        queue="upload_worker",
    )


@router.post("/documents/{document_id}/stop", response_model=StopOcrResponse)
async def stop_document_ocr(
    document_id: str,
    user=Depends(get_current_user),
    _authz=Depends(require_activity("documents.reprocess_ocr")),
):
    prisma = await get_prisma()
    access_where, access_params, _next_param = document_sql_where("d", user, first_param=2)
    documents = await _query_raw(
        prisma,
        f"""
        SELECT d."id"::text AS id, d."status"::text AS status
        FROM "public"."documents" d
        WHERE d."id"::text = $1::text
          AND {access_where}
        LIMIT 1
        """,
        document_id,
        *access_params,
    )
    document = documents[0] if documents else None
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    current_status = str(document.get("status") or "").upper()
    if current_status not in {"UPLOADED", "QUEUED", "PROCESSING", "REPROCESSING"}:
        raise HTTPException(
            status_code=409,
            detail=f"OCR cannot be stopped while document status is {current_status}",
        )

    aborted = await cancel_ocr_job(document_id)
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."documents"
        SET "status" = 'REJECTED'::"public"."DocumentStatus",
            "updated_at" = NOW()
        WHERE "id"::text = $1::text
        """,
        document_id,
    )
    return StopOcrResponse(
        status="success",
        message="OCR extraction stopped",
        documentId=document_id,
        aborted=aborted,
    )


async def _fetch_extraction_child_arrays(
    *,
    prisma,
    doc_type: str,
    extraction: object | None,
) -> dict[str, list[dict]]:
    if extraction is None:
        return {}
    parent_model = DOC_TYPE_TO_PRISMA_PARENT_MODEL.get(doc_type)
    if not parent_model:
        return {}
    try:
        schema = load_extraction_schema(parent_model=parent_model)
    except Exception:
        return {}
    extraction_id = str(getattr(extraction, "id", "") or "")
    if not extraction_id:
        return {}

    result: dict[str, list[dict]] = {}
    for array_name in schema.array_fields:
        child_model = schema.array_child_models.get(array_name)
        parent_fk = schema.array_parent_fields.get(array_name)
        fields = schema.array_item_fields.get(array_name, [])
        if not child_model or not parent_fk or not fields:
            continue
        child_accessor = getattr(prisma, prisma_accessor_name(child_model), None)
        if child_accessor is None:
            continue
        try:
            rows = await child_accessor.find_many(where={parent_fk: extraction_id})
        except Exception:
            continue
        normalized_rows: list[dict] = []
        for row in rows or []:
            normalized = {
                field: _coerce_json_compatible(getattr(row, field, None))
                for field in fields
                if getattr(row, field, None) is not None
            }
            if normalized:
                normalized_rows.append(normalized)
        if normalized_rows:
            result[array_name] = normalized_rows
    return result


async def _query_raw(prisma, sql: str, *params) -> list[dict[str, Any]]:
    query_raw = getattr(prisma, "query_raw", None)
    if query_raw is None:
        raise RuntimeError("Prisma client has no query_raw")
    return [dict(row) for row in await query_raw(sql, *params)]


async def _execute_raw(prisma, sql: str, *params) -> Any:
    execute_raw = getattr(prisma, "execute_raw", None)
    if execute_raw is None:
        raise RuntimeError("Prisma client has no execute_raw")
    return await execute_raw(sql, *params)


def _json_dumps(value: Any) -> str:
    return json.dumps(_coerce_json_compatible(value), default=str)


def _validation_value_text(value: Any) -> str | None:
    if value is None:
        return None
    coerced = _coerce_json_compatible(value)
    if isinstance(coerced, (dict, list)):
        return _json_dumps(coerced)
    return str(coerced)


async def _ensure_cross_validation_tables(prisma) -> None:
    await _execute_raw(prisma, 'CREATE SCHEMA IF NOT EXISTS "document_module"')
    await _execute_raw(prisma, 'CREATE SCHEMA IF NOT EXISTS "document_ocr"')
    await _execute_raw(prisma, 'DROP VIEW IF EXISTS "document_ocr"."v_cross_validation_details"')
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "document_module"."validation_rule_overrides" (
          "template_id" TEXT NOT NULL,
          "rule_code" TEXT NOT NULL,
          "is_active" BOOLEAN,
          "blocking_behavior" TEXT,
          "tolerance" DOUBLE PRECISION,
          "status_history" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY ("template_id", "rule_code")
        )
        """,
    )
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "document_module"."validation_results" (
          "id" TEXT PRIMARY KEY,
          "shipment_id" TEXT NOT NULL,
          "document_id" TEXT NOT NULL,
          "target_document_id" TEXT,
          "rule_code" TEXT NOT NULL,
          "source_doc_type" TEXT NOT NULL,
          "target_doc_type" TEXT NOT NULL,
          "source_field" TEXT NOT NULL,
          "target_field" TEXT NOT NULL,
          "match_type" TEXT,
          "blocking_behavior" TEXT NOT NULL,
          "status" TEXT NOT NULL,
          "source_value" TEXT,
          "target_value" TEXT,
          "delta" TEXT,
          "alert_level" TEXT,
          "result_payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE ("shipment_id", "document_id", "rule_code")
        )
        """,
    )
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "document_module"."validation_tasks" (
          "id" TEXT PRIMARY KEY,
          "shipment_id" TEXT NOT NULL,
          "document_id" TEXT NOT NULL,
          "validation_result_id" TEXT,
          "rule_code" TEXT NOT NULL,
          "alert_level" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'OPEN',
          "title" TEXT NOT NULL,
          "description" TEXT,
          "assigned_role" TEXT,
          "created_by" TEXT,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE ("shipment_id", "document_id", "rule_code")
        )
        """,
    )
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "document_module"."document_validation_status" (
          "document_id" TEXT PRIMARY KEY,
          "shipment_id" TEXT NOT NULL,
          "status" TEXT NOT NULL,
          "summary" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "total_rules" INTEGER NOT NULL DEFAULT 0,
          "blocking_failures" INTEGER NOT NULL DEFAULT 0,
          "warnings" INTEGER NOT NULL DEFAULT 0,
          "waiting" INTEGER NOT NULL DEFAULT 0,
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "document_ocr"."cross_validation_details" (
          "id" TEXT PRIMARY KEY,
          "shipment_id" TEXT NOT NULL,
          "document_id" TEXT NOT NULL,
          "target_document_id" TEXT,
          "rule_code" TEXT NOT NULL,
          "description" TEXT,
          "source_doc_type" TEXT NOT NULL,
          "target_doc_type" TEXT NOT NULL,
          "source_field" TEXT NOT NULL,
          "target_field" TEXT NOT NULL,
          "match_type" TEXT,
          "blocking_behavior" TEXT NOT NULL,
          "status" TEXT NOT NULL,
          "display_status" TEXT NOT NULL,
          "display_order" INTEGER NOT NULL DEFAULT 50,
          "source_value" TEXT,
          "target_value" TEXT,
          "delta" TEXT,
          "alert_level" TEXT,
          "result_payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE ("shipment_id", "document_id", "rule_code")
        )
        """,
    )
    await _execute_raw(
        prisma,
        """
        INSERT INTO "document_ocr"."cross_validation_details" (
          "id", "shipment_id", "document_id", "target_document_id", "rule_code",
          "description", "source_doc_type", "target_doc_type", "source_field", "target_field",
          "match_type", "blocking_behavior", "status", "display_status", "display_order",
          "source_value", "target_value", "delta", "alert_level", "result_payload", "updated_at"
        )
        SELECT
          vr."id", vr."shipment_id", vr."document_id", vr."target_document_id", vr."rule_code",
          COALESCE(
            vr."result_payload" ->> 'description',
            vr."result_payload" ->> 'ruleDescription',
            vr."result_payload" ->> 'rule_description',
            vr."rule_code"
          ),
          vr."source_doc_type", vr."target_doc_type", vr."source_field", vr."target_field",
          vr."match_type", vr."blocking_behavior", vr."status",
          CASE
            WHEN vr."status" = 'PASS' THEN 'PASSED'
            WHEN vr."status" = 'WAITING' THEN 'WAITING'
            WHEN vr."blocking_behavior" = 'BLOCK' AND vr."status" IN ('FAIL', 'SKIPPED') THEN 'BLOCKED'
            WHEN vr."blocking_behavior" = 'WARN' AND vr."status" IN ('FAIL', 'WARNING', 'SKIPPED') THEN 'WARNED'
            WHEN vr."status" = 'SKIPPED' THEN 'SKIPPED'
            ELSE vr."status"
          END,
          CASE
            WHEN vr."blocking_behavior" = 'BLOCK' AND vr."status" IN ('FAIL', 'SKIPPED') THEN 10
            WHEN vr."blocking_behavior" = 'WARN' AND vr."status" IN ('FAIL', 'WARNING', 'SKIPPED') THEN 20
            WHEN vr."status" = 'WAITING' THEN 30
            WHEN vr."status" = 'PASS' THEN 40
            ELSE 50
          END,
          vr."source_value", vr."target_value", vr."delta", vr."alert_level", vr."result_payload", vr."updated_at"
        FROM "document_module"."validation_results" vr
        ON CONFLICT ("shipment_id", "document_id", "rule_code") DO UPDATE SET
          "id" = EXCLUDED."id",
          "target_document_id" = EXCLUDED."target_document_id",
          "description" = EXCLUDED."description",
          "source_doc_type" = EXCLUDED."source_doc_type",
          "target_doc_type" = EXCLUDED."target_doc_type",
          "source_field" = EXCLUDED."source_field",
          "target_field" = EXCLUDED."target_field",
          "match_type" = EXCLUDED."match_type",
          "blocking_behavior" = EXCLUDED."blocking_behavior",
          "status" = EXCLUDED."status",
          "display_status" = EXCLUDED."display_status",
          "display_order" = EXCLUDED."display_order",
          "source_value" = EXCLUDED."source_value",
          "target_value" = EXCLUDED."target_value",
          "delta" = EXCLUDED."delta",
          "alert_level" = EXCLUDED."alert_level",
          "result_payload" = EXCLUDED."result_payload",
          "updated_at" = EXCLUDED."updated_at"
        """,
    )


async def _load_validation_rule_overrides_from_db(prisma) -> None:
    rows = await _query_raw(
        prisma,
        """
        SELECT "template_id", "rule_code", "is_active", "blocking_behavior",
               "tolerance", "status_history", "updated_at"
        FROM "document_module"."validation_rule_overrides"
        """,
    )
    overrides: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        override: dict[str, Any] = {}
        if row.get("is_active") is not None:
            override["isActive"] = bool(row["is_active"])
        if row.get("blocking_behavior"):
            override["blockingBehavior"] = str(row["blocking_behavior"])
        if row.get("tolerance") is not None:
            override["tolerance"] = float(row["tolerance"])
        override["statusHistory"] = row.get("status_history") or []
        override["updatedAt"] = _to_iso(row.get("updated_at"))
        overrides[(str(row["template_id"]), str(row["rule_code"]))] = override
    load_validation_rule_overrides(overrides)


def _document_is_reviewed(row: Any) -> bool:
    status = row.get("status") if isinstance(row, dict) else getattr(row, "status", "")
    return "REVIEWED" in str(status or "").upper()


def _document_row_doc_type(row: Any) -> str:
    if isinstance(row, dict):
        return str(row.get("doc_type") or row.get("docType") or "").upper()
    return str(getattr(row, "docType", "") or "").upper()


def _document_row_id(row: Any) -> str:
    return str((row.get("id") if isinstance(row, dict) else getattr(row, "id", "")) or "")


def _validation_payload_from_serialized(extraction: DocumentExtractionItem | None) -> dict[str, Any]:
    if extraction is None:
        return {}
    raw_data = extraction.rawData if isinstance(extraction.rawData, dict) else {}
    payload = dict(raw_data)
    if extraction.arrays:
        payload.update(extraction.arrays)
    if extraction.lineItems and not payload.get("lineItems"):
        payload["lineItems"] = extraction.lineItems
    return payload


def _non_empty_text(value: Any) -> str:
    return str(value or "").strip()


def _bol_container_mapping_approved(extraction: Any) -> bool:
    raw_data = getattr(extraction, "rawData", None)
    if not isinstance(raw_data, dict):
        return False
    return raw_data.get("containerMappingApproved") is True


def _bol_has_tracking_reference(extraction: Any) -> bool:
    return bool(
        _non_empty_text(getattr(extraction, "mblNumber", None))
        or _non_empty_text(getattr(extraction, "bookingReferenceNumber", None))
    )


def _bol_approval_blockers(extraction: Any) -> list[str]:
    blockers: list[str] = []
    if not _bol_container_mapping_approved(extraction):
        blockers.append("approve the BOL container mapping")
    if not _bol_has_tracking_reference(extraction):
        blockers.append("enter either MBL number or booking reference number")
    return blockers


def _raise_bol_approval_blockers(extraction: Any) -> None:
    blockers = _bol_approval_blockers(extraction)
    if blockers:
        raise HTTPException(
            status_code=400,
            detail="BOL approval blocked: " + "; ".join(blockers) + ".",
        )


def _sum_generated_line_item_numbers(line_items: list[dict[str, Any]], *keys: str) -> str | None:
    total = 0.0
    found = False
    for item in line_items:
        for key in keys:
            value = item.get(key)
            if value in (None, ""):
                continue
            match = re.search(r"-?\d+(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?", str(value))
            if not match:
                continue
            total += float(match.group(0).replace(",", ""))
            found = True
            break
    return f"{total:g}" if found else None


def _validation_payload_from_generated_draft(payload: dict[str, Any]) -> dict[str, Any]:
    flattened: dict[str, Any] = {}
    for section in payload.get("sections") or []:
        if not isinstance(section, dict):
            continue
        for field in section.get("fields") or []:
            if isinstance(field, dict) and field.get("targetField"):
                flattened[str(field["targetField"])] = field.get("value")

    line_items = [item for item in payload.get("lineItems") or [] if isinstance(item, dict)]
    flattened["lineItems"] = line_items
    flattened["sourceDocumentIds"] = payload.get("sourceDocumentIds") or {}
    if line_items:
        flattened.setdefault("totalBundles", _sum_generated_line_item_numbers(line_items, "noOfBundles", "bundles"))
        flattened.setdefault("totalQty", _sum_generated_line_item_numbers(line_items, "totalQtyInPcs", "quantity"))
        flattened.setdefault("totalGrossWeightKgs", _sum_generated_line_item_numbers(line_items, "grossWeightKgs", "grossWeight"))
        flattened.setdefault("totalNetWeightKgs", _sum_generated_line_item_numbers(line_items, "netWeightKgs", "netWeight"))
    return {key: value for key, value in flattened.items() if value not in (None, "")}


async def _validation_payload_for_document(prisma, *, doc_type: str, document_id: str) -> dict[str, Any]:
    extraction = await _fetch_extraction_direct(prisma=prisma, doc_type=doc_type, document_id=document_id)
    if extraction is None:
        return {}
    child_arrays = await _fetch_extraction_child_arrays(
        prisma=prisma,
        doc_type=doc_type,
        extraction=extraction,
    )
    serialized = _serialize_extraction(extraction, doc_type=doc_type, child_arrays=child_arrays)
    return _validation_payload_from_serialized(serialized)


async def _collect_generated_validation_documents(
    prisma,
    *,
    uploaded_by: str,
    documents_by_type: dict[str, Any],
    document_ids_by_type: dict[str, str],
) -> None:
    needed_types = {"PACKING_LIST", "ENTRY_SUMMARY", "US_PACKING_LIST"} - set(documents_by_type)
    if not needed_types:
        return
    try:
        rows = await _query_raw(
            prisma,
            """
            SELECT id, generated_doc_type, rendered_payload
            FROM docgen.drafts
            WHERE generated_doc_type = ANY($1::text[])
              AND status IN ('CONFIRMED'::docgen."DocGenerationStatus", 'GENERATED'::docgen."DocGenerationStatus")
              AND created_by::text = $2::text
            ORDER BY updated_at DESC
            """,
            sorted(needed_types),
            uploaded_by,
        )
    except Exception as exc:
        print(f"[cross-validation] generated draft collection skipped: {exc}", flush=True)
        return
    for row in rows:
        generated_doc_type = str(row.get("generated_doc_type") or "")
        if not generated_doc_type or generated_doc_type in documents_by_type:
            continue
        payload = row.get("rendered_payload") or {}
        if not isinstance(payload, dict):
            continue
        validation_payload = _validation_payload_from_generated_draft(payload)
        if validation_payload:
            documents_by_type[generated_doc_type] = validation_payload
            document_ids_by_type[generated_doc_type] = str(row.get("id") or "")


def _shipment_id_from_payloads(*, source_doc_type: str, source_payload: dict[str, Any], documents_by_type: dict[str, Any], uploaded_by: str) -> str:
    bol_payload = source_payload if source_doc_type == "BILL_OF_LADING" else documents_by_type.get("BILL_OF_LADING") or {}
    bol_number = str(bol_payload.get("bolNumber") or bol_payload.get("billOfLadingNo") or "").strip()
    shipped_date = str(bol_payload.get("shippedOnBoardDate") or bol_payload.get("bolDate") or "").strip()
    if bol_number:
        clean_bol = re.sub(r"[^A-Za-z0-9]+", "-", bol_number).strip("-")
        clean_date = re.sub(r"[^A-Za-z0-9]+", "-", shipped_date).strip("-") if shipped_date else "pending-date"
        return f"BOL-{clean_bol}-{clean_date}"
    fallback = str(source_payload.get("shipmentId") or source_payload.get("projectName") or "").strip()
    if fallback:
        return f"SHIP-{re.sub(r'[^A-Za-z0-9]+', '-', fallback).strip('-')}"
    return f"USER-{uploaded_by}"


async def _collect_reviewed_validation_documents(
    prisma,
    *,
    uploaded_by: str,
    current_document_id: str,
    current_doc_type: str,
    current_payload: dict[str, Any],
    preferred_document_ids_by_type: dict[str, str] | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    rows = await _query_raw(
        prisma,
        """
        SELECT id::text AS id, doc_type::text AS doc_type, status::text AS status
        FROM "public"."documents"
        WHERE uploaded_by::text = $1::text
          AND is_deleted = FALSE
        ORDER BY updated_at DESC
        """,
        uploaded_by,
    )
    documents_by_type: dict[str, Any] = {current_doc_type: current_payload}
    document_ids_by_type: dict[str, str] = {current_doc_type: current_document_id}
    preferred_types = {
        str(doc_type or "").upper(): str(document_id or "")
        for doc_type, document_id in (preferred_document_ids_by_type or {}).items()
        if doc_type and document_id
    }
    for preferred_doc_type, preferred_document_id in preferred_types.items():
        if preferred_doc_type in documents_by_type:
            continue
        preferred_rows = await _query_raw(
            prisma,
            """
            SELECT id::text AS id, doc_type::text AS doc_type, status::text AS status
            FROM "public"."documents"
            WHERE id::text = $1::text
              AND uploaded_by::text = $2::text
              AND is_deleted = FALSE
              AND doc_type::text = $3::text
            LIMIT 1
            """,
            preferred_document_id,
            uploaded_by,
            preferred_doc_type,
        )
        row = preferred_rows[0] if preferred_rows else None
        if not row or not _document_is_reviewed(row):
            continue
        payload = await _validation_payload_for_document(
            prisma,
            doc_type=preferred_doc_type,
            document_id=preferred_document_id,
        )
        if payload:
            documents_by_type[preferred_doc_type] = payload
            document_ids_by_type[preferred_doc_type] = preferred_document_id
    for row in rows or []:
        doc_type = _document_row_doc_type(row)
        row_document_id = _document_row_id(row)
        if not doc_type or not row_document_id or doc_type in documents_by_type:
            continue
        if doc_type in preferred_types:
            continue
        if not _document_is_reviewed(row):
            continue
        payload = await _validation_payload_for_document(prisma, doc_type=doc_type, document_id=row_document_id)
        if payload:
            documents_by_type[doc_type] = payload
            document_ids_by_type[doc_type] = row_document_id
    await _collect_generated_validation_documents(
        prisma,
        uploaded_by=uploaded_by,
        documents_by_type=documents_by_type,
        document_ids_by_type=document_ids_by_type,
    )
    return documents_by_type, document_ids_by_type


def _validation_overall_status(summary_dict: dict[str, Any]) -> str:
    if int(summary_dict.get("blockingFailures") or 0) > 0:
        return "BLOCKED"
    if int(summary_dict.get("waiting") or 0) > 0:
        return "WAITING"
    if int(summary_dict.get("warnings") or 0) > 0:
        return "WARNING"
    return "PASSED"


def _validation_display_status_and_order(*, status: str, blocking_behavior: str) -> tuple[str, int]:
    normalized_status = str(status or "").upper()
    normalized_behavior = str(blocking_behavior or "").upper()
    if normalized_status == "PASS":
        return "PASSED", 40
    if normalized_status == "WAITING":
        return "WAITING", 30
    if normalized_behavior == "BLOCK" and normalized_status in {"FAIL", "SKIPPED"}:
        return "BLOCKED", 10
    if normalized_behavior == "WARN" and normalized_status in {"FAIL", "WARNING", "SKIPPED"}:
        return "WARNED", 20
    if normalized_status == "SKIPPED":
        return "SKIPPED", 50
    return normalized_status or "UNKNOWN", 50


async def _persist_cross_validation_detail(
    prisma,
    *,
    validation_result_id: str,
    shipment_id: str,
    document_id: str,
    target_document_id: str | None,
    result: dict[str, Any],
) -> None:
    status = str(result.get("status") or "")
    blocking_behavior = str(result.get("blocking_behavior") or "")
    display_status, display_order = _validation_display_status_and_order(
        status=status,
        blocking_behavior=blocking_behavior,
    )
    await _execute_raw(
        prisma,
        """
        INSERT INTO "document_ocr"."cross_validation_details" (
          "id", "shipment_id", "document_id", "target_document_id", "rule_code",
          "description", "source_doc_type", "target_doc_type", "source_field", "target_field",
          "match_type", "blocking_behavior", "status", "display_status", "display_order",
          "source_value", "target_value", "delta", "alert_level", "result_payload", "updated_at"
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20::jsonb, NOW()
        )
        ON CONFLICT ("shipment_id", "document_id", "rule_code") DO UPDATE SET
          "id" = EXCLUDED."id",
          "target_document_id" = EXCLUDED."target_document_id",
          "description" = EXCLUDED."description",
          "source_doc_type" = EXCLUDED."source_doc_type",
          "target_doc_type" = EXCLUDED."target_doc_type",
          "source_field" = EXCLUDED."source_field",
          "target_field" = EXCLUDED."target_field",
          "match_type" = EXCLUDED."match_type",
          "blocking_behavior" = EXCLUDED."blocking_behavior",
          "status" = EXCLUDED."status",
          "display_status" = EXCLUDED."display_status",
          "display_order" = EXCLUDED."display_order",
          "source_value" = EXCLUDED."source_value",
          "target_value" = EXCLUDED."target_value",
          "delta" = EXCLUDED."delta",
          "alert_level" = EXCLUDED."alert_level",
          "result_payload" = EXCLUDED."result_payload",
          "updated_at" = NOW()
        """,
        validation_result_id,
        shipment_id,
        document_id,
        target_document_id,
        str(result.get("rule_code") or ""),
        str(result.get("description") or result.get("rule_code") or ""),
        str(result.get("source_doc_type") or ""),
        str(result.get("target_doc_type") or ""),
        str(result.get("source_field") or ""),
        str(result.get("target_field") or ""),
        str(result.get("match_type") or ""),
        blocking_behavior,
        status,
        display_status,
        display_order,
        _validation_value_text(result.get("source_value")),
        _validation_value_text(result.get("target_value")),
        _validation_value_text(result.get("delta")),
        result.get("alert_level"),
        _json_dumps(result),
    )


async def _persist_validation_result(
    prisma,
    *,
    shipment_id: str,
    document_id: str,
    target_document_id: str | None,
    result: dict[str, Any],
) -> str:
    rows = await _query_raw(
        prisma,
        """
        INSERT INTO "document_module"."validation_results" (
          "id", "shipment_id", "document_id", "target_document_id", "rule_code",
          "source_doc_type", "target_doc_type", "source_field", "target_field",
          "match_type", "blocking_behavior", "status", "source_value", "target_value",
          "delta", "alert_level", "result_payload", "updated_at"
        )
        VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13, $14,
          $15, $16, $17::jsonb, NOW()
        )
        ON CONFLICT ("shipment_id", "document_id", "rule_code") DO UPDATE SET
          "target_document_id" = EXCLUDED."target_document_id",
          "source_doc_type" = EXCLUDED."source_doc_type",
          "target_doc_type" = EXCLUDED."target_doc_type",
          "source_field" = EXCLUDED."source_field",
          "target_field" = EXCLUDED."target_field",
          "match_type" = EXCLUDED."match_type",
          "blocking_behavior" = EXCLUDED."blocking_behavior",
          "status" = EXCLUDED."status",
          "source_value" = EXCLUDED."source_value",
          "target_value" = EXCLUDED."target_value",
          "delta" = EXCLUDED."delta",
          "alert_level" = EXCLUDED."alert_level",
          "result_payload" = EXCLUDED."result_payload",
          "updated_at" = NOW()
        RETURNING "id"
        """,
        str(uuid4()),
        shipment_id,
        document_id,
        target_document_id,
        str(result.get("rule_code") or ""),
        str(result.get("source_doc_type") or ""),
        str(result.get("target_doc_type") or ""),
        str(result.get("source_field") or ""),
        str(result.get("target_field") or ""),
        str(result.get("match_type") or ""),
        str(result.get("blocking_behavior") or ""),
        str(result.get("status") or ""),
        _validation_value_text(result.get("source_value")),
        _validation_value_text(result.get("target_value")),
        _validation_value_text(result.get("delta")),
        result.get("alert_level"),
        _json_dumps(result),
    )
    return str(rows[0]["id"]) if rows else ""


async def _upsert_validation_task(
    prisma,
    *,
    shipment_id: str,
    document_id: str,
    validation_result_id: str,
    result: dict[str, Any],
    created_by: str,
) -> None:
    alert_level = result.get("alert_level")
    rule_code = str(result.get("rule_code") or "")
    if not alert_level:
        await _execute_raw(
            prisma,
            """
            UPDATE "document_module"."validation_tasks"
            SET "status" = 'RESOLVED', "updated_at" = NOW()
            WHERE "shipment_id" = $1 AND "document_id" = $2 AND "rule_code" = $3 AND "status" = 'OPEN'
            """,
            shipment_id,
            document_id,
            rule_code,
        )
        return

    title = f"{alert_level}: {rule_code}"
    description = str(result.get("delta") or f"{rule_code} requires attention")
    await _execute_raw(
        prisma,
        """
        INSERT INTO "document_module"."validation_tasks" (
          "id", "shipment_id", "document_id", "validation_result_id", "rule_code",
          "alert_level", "status", "title", "description", "assigned_role", "created_by", "updated_at"
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8, 'ADMIN', $9, NOW())
        ON CONFLICT ("shipment_id", "document_id", "rule_code") DO UPDATE SET
          "validation_result_id" = EXCLUDED."validation_result_id",
          "alert_level" = EXCLUDED."alert_level",
          "status" = 'OPEN',
          "title" = EXCLUDED."title",
          "description" = EXCLUDED."description",
          "assigned_role" = EXCLUDED."assigned_role",
          "updated_at" = NOW()
        """,
        str(uuid4()),
        shipment_id,
        document_id,
        validation_result_id,
        rule_code,
        str(alert_level),
        title,
        description,
        created_by,
    )


async def _run_and_persist_document_validation(
    prisma,
    *,
    document_id: str,
    doc_type: str,
    uploaded_by: str,
    user_id: str,
    current_payload: dict[str, Any] | None = None,
    recheck_waiting_sources: bool = True,
    ) -> dict[str, Any]:
    await _ensure_cross_validation_tables(prisma)
    await _load_validation_rule_overrides_from_db(prisma)
    await _execute_raw(
        prisma,
        """
        DELETE FROM "document_ocr"."cross_validation_details"
        WHERE "document_id" = $1
        """,
        document_id,
    )
    await _execute_raw(
        prisma,
        """
        DELETE FROM "document_module"."validation_tasks"
        WHERE "document_id" = $1
        """,
        document_id,
    )
    await _execute_raw(
        prisma,
        """
        DELETE FROM "document_module"."validation_results"
        WHERE "document_id" = $1
        """,
        document_id,
    )
    source_payload = current_payload or await _validation_payload_for_document(
        prisma,
        doc_type=doc_type,
        document_id=document_id,
    )
    documents_by_type, document_ids_by_type = await _collect_reviewed_validation_documents(
        prisma,
        uploaded_by=uploaded_by,
        current_document_id=document_id,
        current_doc_type=doc_type,
        current_payload=source_payload,
    )
    shipment_id = _shipment_id_from_payloads(
        source_doc_type=doc_type,
        source_payload=source_payload,
        documents_by_type=documents_by_type,
        uploaded_by=uploaded_by,
    )
    rules = get_rules_for_doc_type(doc_type, template_id="breakbulk-template")
    summary = run_cross_validation(
        source_doc_type=doc_type,
        documents_by_type=documents_by_type,
        rules=rules,
        master_data={
            "importerOfRecord": "Unimacts Global LLC",
        },
    )
    summary_dict = summary.to_dict()
    for result_obj in summary.results:
        result = result_obj.to_dict()
        rule = next((item for item in rules if item.rule_code == result_obj.rule_code), None)
        result["match_type"] = rule.match_type.value if rule else ""
        result["description"] = rule.description if rule else result.get("rule_code")
        target_doc_type = str(result.get("target_doc_type") or "")
        target_document_id = None if target_doc_type in {"SELF", "MASTER_DATA"} else document_ids_by_type.get(target_doc_type)
        validation_result_id = await _persist_validation_result(
            prisma,
            shipment_id=shipment_id,
            document_id=document_id,
            target_document_id=target_document_id,
            result=result,
        )
        await _persist_cross_validation_detail(
            prisma,
            validation_result_id=validation_result_id,
            shipment_id=shipment_id,
            document_id=document_id,
            target_document_id=target_document_id,
            result=result,
        )
        await _upsert_validation_task(
            prisma,
            shipment_id=shipment_id,
            document_id=document_id,
            validation_result_id=validation_result_id,
            result=result,
            created_by=user_id,
        )

    overall_status = _validation_overall_status(summary_dict)
    await _execute_raw(
        prisma,
        """
        INSERT INTO "document_module"."document_validation_status" (
          "document_id", "shipment_id", "status", "summary", "total_rules",
          "blocking_failures", "warnings", "waiting", "updated_at"
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, NOW())
        ON CONFLICT ("document_id") DO UPDATE SET
          "shipment_id" = EXCLUDED."shipment_id",
          "status" = EXCLUDED."status",
          "summary" = EXCLUDED."summary",
          "total_rules" = EXCLUDED."total_rules",
          "blocking_failures" = EXCLUDED."blocking_failures",
          "warnings" = EXCLUDED."warnings",
          "waiting" = EXCLUDED."waiting",
          "updated_at" = NOW()
        """,
        document_id,
        shipment_id,
        overall_status,
        _json_dumps(summary_dict),
        int(summary_dict.get("total") or 0),
        int(summary_dict.get("blockingFailures") or 0),
        int(summary_dict.get("warnings") or 0),
        int(summary_dict.get("waiting") or 0),
    )
    await _execute_raw(
        prisma,
        """
        UPDATE "public"."documents"
        SET "validation_status" = $2, "updated_at" = NOW()
        WHERE "id"::text = $1::text
        """,
        document_id,
        overall_status,
    )

    if recheck_waiting_sources:
        waiting_sources = await _query_raw(
            prisma,
            """
            SELECT DISTINCT vr."document_id", d."doc_type"::text AS "doc_type"
            FROM "document_module"."validation_results" vr
            JOIN "public"."documents" d ON d."id"::text = vr."document_id"
            WHERE vr."status" = 'WAITING'
              AND vr."target_doc_type" = $1
              AND d."uploaded_by"::text = $2::text
              AND vr."document_id" <> $3
            LIMIT 20
            """,
            doc_type,
            uploaded_by,
            document_id,
        )
        for row in waiting_sources:
            await _run_and_persist_document_validation(
                prisma,
                document_id=str(row["document_id"]),
                doc_type=str(row["doc_type"]),
                uploaded_by=uploaded_by,
                user_id=user_id,
                recheck_waiting_sources=False,
            )

    return {
        "shipmentId": shipment_id,
        "status": overall_status,
        **summary_dict,
    }


async def auto_review_and_validate_document(
    *,
    prisma,
    document_id: str,
    user_id: str,
) -> dict[str, Any]:
    document = await prisma.document.find_first(
        where={"id": document_id, "uploadedBy": user_id, "isDeleted": False},
    )
    if not document:
        raise LookupError("Document not found")

    doc_type = str(document.docType)
    accessor = DOC_TYPE_TO_EXTRACTION_ACCESSOR.get(doc_type)
    if not accessor:
        raise ValueError(f"Approval is not configured for {doc_type}")

    model_accessor = getattr(prisma, accessor, None)
    if model_accessor is None:
        raise ValueError(f"Extraction model is not available for {doc_type}")

    extraction = await model_accessor.find_unique(where={"documentId": document_id})
    if not extraction:
        raise LookupError("Extraction data not found for this document")

    if doc_type == "BILL_OF_LADING":
        _raise_bol_approval_blockers(extraction)

    reviewed_at = datetime.now()
    await model_accessor.update(
        where={"documentId": document_id},
        data={"reviewedBy": user_id, "reviewedAt": reviewed_at},
    )
    await prisma.document.update(
        where={"id": document_id},
        data={"status": "REVIEWED"},
    )
    child_arrays = await _fetch_extraction_child_arrays(
        prisma=prisma,
        doc_type=doc_type,
        extraction=extraction,
    )
    current_payload = _validation_payload_from_serialized(
        _serialize_extraction(extraction, doc_type=doc_type, child_arrays=child_arrays)
    )
    return await _run_and_persist_document_validation(
        prisma,
        document_id=document_id,
        doc_type=doc_type,
        uploaded_by=str(document.uploadedBy),
        user_id=user_id,
        current_payload=current_payload,
    )


@router.post("/documents/{document_id}/approve", response_model=ApproveDocumentResponse)
async def approve_document_extraction(
    document_id: str,
    user=Depends(get_current_user),
    authz=Depends(require_activity("documents.approve_draft")),
):
    prisma = await get_prisma()
    where = document_prisma_where(user)
    where["id"] = document_id
    document = await prisma.document.find_first(
        where=where,
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    doc_type = str(document.docType)
    _require_doc_type_action(user, "approve_extraction", doc_type)
    accessor = DOC_TYPE_TO_EXTRACTION_ACCESSOR.get(doc_type)
    if not accessor:
        raise HTTPException(status_code=400, detail=f"Approval is not configured for {doc_type}")

    model_accessor = getattr(prisma, accessor, None)
    if model_accessor is None:
        raise HTTPException(status_code=400, detail=f"Extraction model is not available for {doc_type}")

    extraction = await model_accessor.find_unique(where={"documentId": document_id})
    if not extraction:
        raise HTTPException(status_code=404, detail="Extraction data not found for this document")

    if doc_type == "BILL_OF_LADING":
        _raise_bol_approval_blockers(extraction)

    parent_model = DOC_TYPE_TO_PRISMA_PARENT_MODEL.get(doc_type)
    if not parent_model:
        raise HTTPException(status_code=400, detail=f"Approval schema is not configured for {doc_type}")
    schema = load_extraction_schema(parent_model=parent_model)
    child_arrays = await _fetch_extraction_child_arrays(
        prisma=prisma,
        doc_type=doc_type,
        extraction=extraction,
    )
    mandatory_result = validate_mandatory_fields(
        parent_model=parent_model,
        schema=schema,
        extraction=extraction,
        child_arrays=child_arrays,
    )
    can_override_missing_fields = (
        str(authz.get("role") or "").upper().replace("-", "_") in {"ADMIN", "SUPER_ADMIN"}
        or "documents.override_validation" in set(authz.get("activities") or [])
    )
    if not mandatory_result.ok and not can_override_missing_fields:
        missing = ", ".join(mandatory_result.missing_fields)
        raise HTTPException(
            status_code=400,
            detail=f"Missing mandatory fields before approval: {missing}",
        )

    reviewed_at = datetime.now()
    await model_accessor.update(
        where={"documentId": document_id},
        data={"reviewedBy": user.id, "reviewedAt": reviewed_at},
    )
    await prisma.document.update(
        where={"id": document_id},
        data={"status": "REVIEWED"},
    )
    current_payload = _validation_payload_from_serialized(
        _serialize_extraction(extraction, doc_type=doc_type, child_arrays=child_arrays)
    )
    validation = await _run_and_persist_document_validation(
        prisma,
        document_id=document_id,
        doc_type=doc_type,
        uploaded_by=str(document.uploadedBy),
        user_id=str(user.id),
        current_payload=current_payload,
    )
    if doc_type == "BILL_OF_LADING":
        try:
            await create_or_update_shipment_from_bol_document(prisma, document_id)
        except Exception as exc:
            print(f"[shipments] warning: could not create shipment from approved BOL {document_id}: {exc}", flush=True)

    return ApproveDocumentResponse(
        status="success",
        message="Document extraction approved",
        documentId=document_id,
        validation=validation,
    )


async def _validation_results_for_user(prisma, *, uploaded_by: str, shipment_id: str | None = None, document_id: str | None = None) -> list[dict[str, Any]]:
    await _ensure_cross_validation_tables(prisma)
    filters = ['d."uploaded_by"::text = $1::text']
    params: list[Any] = [uploaded_by]
    if shipment_id:
        params.append(shipment_id)
        filters.append(f'v."shipment_id" = ${len(params)}')
    if document_id:
        params.append(document_id)
        filters.append(f'v."document_id" = ${len(params)}')
    rows = await _query_raw(
        prisma,
        f"""
        SELECT
          v."id",
          v."shipment_id",
          v."document_id",
          v."target_document_id",
          v."rule_code",
          v."description",
          v."source_doc_type",
          v."target_doc_type",
          v."source_field",
          v."target_field",
          v."match_type",
          v."blocking_behavior",
          v."status",
          v."display_status",
          v."source_value",
          v."target_value",
          v."delta",
          v."alert_level",
          v."result_payload",
          v."updated_at"
        FROM "document_ocr"."cross_validation_details" v
        JOIN "public"."documents" d ON d."id"::text = v."document_id"
        WHERE {" AND ".join(filters)}
        ORDER BY v."display_order" ASC, v."rule_code" ASC
        """,
        *params,
    )
    return [
        {
            "id": row.get("id"),
            "shipmentId": row.get("shipment_id"),
            "documentId": row.get("document_id"),
            "targetDocumentId": row.get("target_document_id"),
            "ruleCode": row.get("rule_code"),
            "description": row.get("description"),
            "sourceDocType": row.get("source_doc_type"),
            "targetDocType": row.get("target_doc_type"),
            "sourceField": row.get("source_field"),
            "targetField": row.get("target_field"),
            "matchType": row.get("match_type"),
            "blockingBehavior": row.get("blocking_behavior"),
            "status": row.get("status"),
            "displayStatus": row.get("display_status"),
            "sourceValue": row.get("source_value"),
            "targetValue": row.get("target_value"),
            "delta": row.get("delta"),
            "alertLevel": row.get("alert_level"),
            "payload": row.get("result_payload") or {},
            "updatedAt": _to_iso(row.get("updated_at")),
        }
        for row in rows
    ]


@validation_router.get("/shipments/{shipment_id}")
async def list_validation_results_for_shipment(shipment_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    return {
        "ok": True,
        "data": await _validation_results_for_user(
            prisma,
            uploaded_by=str(user.id),
            shipment_id=shipment_id,
        ),
    }


@validation_router.get("/documents/{document_id}")
async def list_validation_results_for_document(document_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    return {
        "ok": True,
        "data": await _validation_results_for_user(
            prisma,
            uploaded_by=str(user.id),
            document_id=document_id,
        ),
    }


@validation_router.get("/generated-drafts/{draft_id}")
async def validate_generated_draft(draft_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    await _ensure_cross_validation_tables(prisma)
    await _load_validation_rule_overrides_from_db(prisma)

    rows = await _query_raw(
        prisma,
        """
        SELECT id, generated_doc_type, source_document_ids, rendered_payload
        FROM docgen.drafts
        WHERE id::text = $1::text
          AND created_by::text = $2::text
        LIMIT 1
        """,
        draft_id,
        str(user.id),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Draft not found")

    row = rows[0]
    doc_type = str(row.get("generated_doc_type") or "").upper()
    if doc_type not in {"PACKING_LIST", "US_PACKING_LIST", "ENTRY_SUMMARY"}:
        raise HTTPException(status_code=400, detail=f"Validation is not configured for generated {doc_type or 'draft'}")

    payload = row.get("rendered_payload") or {}
    if not isinstance(payload, dict):
        raise HTTPException(status_code=500, detail="Draft payload is invalid")

    source_document_ids = payload.get("sourceDocumentIds") if isinstance(payload.get("sourceDocumentIds"), dict) else {}
    if not source_document_ids and isinstance(row.get("source_document_ids"), dict):
        source_document_ids = row.get("source_document_ids") or {}
        payload["sourceDocumentIds"] = source_document_ids

    current_payload = _validation_payload_from_generated_draft(payload)
    documents_by_type, _document_ids_by_type = await _collect_reviewed_validation_documents(
        prisma,
        uploaded_by=str(user.id),
        current_document_id=draft_id,
        current_doc_type=doc_type,
        current_payload=current_payload,
        preferred_document_ids_by_type={
            str(source_doc_type).upper(): str(source_document_id)
            for source_doc_type, source_document_id in source_document_ids.items()
            if source_doc_type and source_document_id
        },
    )

    rules = get_rules_for_doc_type(doc_type, template_id="breakbulk-template")
    summary = run_cross_validation(
        source_doc_type=doc_type,
        documents_by_type=documents_by_type,
        rules=rules,
        master_data={
            "importerOfRecord": "Unimacts Global LLC",
        },
    )
    summary_dict = summary.to_dict()
    enriched_results: list[dict[str, Any]] = []
    for result_obj in summary.results:
        result = result_obj.to_dict()
        rule = next((item for item in rules if item.rule_code == result_obj.rule_code), None)
        enriched_results.append(
            {
                "ruleCode": result.get("rule_code"),
                "description": rule.description if rule else result.get("rule_code"),
                "sourceDocType": result.get("source_doc_type"),
                "targetDocType": result.get("target_doc_type"),
                "sourceField": result.get("source_field"),
                "targetField": result.get("target_field"),
                "matchType": rule.match_type.value if rule else result.get("match_type"),
                "blockingBehavior": result.get("blocking_behavior"),
                "status": result.get("status"),
                "sourceValue": _validation_value_text(result.get("source_value")),
                "targetValue": _validation_value_text(result.get("target_value")),
                "delta": result.get("delta"),
                "alertLevel": result.get("alert_level"),
            }
        )
    summary_dict["results"] = enriched_results
    return {
        "ok": True,
        "data": {
            "status": _validation_overall_status(summary_dict),
            **summary_dict,
        },
    }
