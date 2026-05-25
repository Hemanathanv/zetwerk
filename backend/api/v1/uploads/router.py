from datetime import datetime
from io import BytesIO
from pathlib import Path
import re
from typing import Any, Final
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from pypdf import PdfReader

from db import get_prisma
from documents_ocr.queue import enqueue_ocr_job, enqueue_upload_job
from helpers.config import settings
from helpers.dependencies import get_current_user
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

BACKEND_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MODULE = "uploads"
DOC_TYPE_VALUES: Final[set[str]] = {
    "SALES_INVOICE",
    "BILL_OF_LADING",
    "PACKING_LIST",
    "ENTRY_SUMMARY",
    "ENTRY_SUMMARY_TARIFF_LINES",
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


class DocumentListItem(BaseModel):
    id: str
    docType: str
    status: str
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
    rawData: Any | None
    extractedAt: str | None
    reviewedBy: str | None
    reviewedAt: str | None


class DocumentDetailItem(BaseModel):
    id: str
    docType: str
    status: str
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


DOC_TYPE_TO_EXTRACTION_RELATION: Final[dict[str, str]] = {
    "SALES_INVOICE": "salesInvoiceExtraction",
    "BILL_OF_LADING": "bolExtraction",
    "PACKING_LIST": "packingListExtraction",
    "ENTRY_SUMMARY": "entrySummaryExtraction",
    "ENTRY_SUMMARY_TARIFF_LINES": "entrySummaryTariffLineExtraction",
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
    "SHIPPING_BILL": "shippingBillExtraction",
    "CHA_BILL": "chaBillExtraction",
}
DOC_TYPE_TO_EXTRACTION_ACCESSOR: Final[dict[str, str]] = {
    "SALES_INVOICE": "salesinvoiceextraction",
    "BILL_OF_LADING": "billoflading",
    "PACKING_LIST": "packinglistextraction",
    "ENTRY_SUMMARY": "entrysummaryextraction",
    "ENTRY_SUMMARY_TARIFF_LINES": "entrysummarytarifflineextraction",
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
    "SHIPPING_BILL": "shippingbillextraction",
    "CHA_BILL": "chabillextraction",
}
DOCUMENT_DETAIL_INCLUDE_FIELDS: Final[tuple[str, ...]] = (
    "pages",
    "bolExtraction",
    "salesInvoiceExtraction",
    "packingListExtraction",
    "entrySummaryExtraction",
    "entrySummaryTariffLineExtraction",
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


def _to_iso(value) -> str | None:
    if value is None:
        return None
    try:
        return value.isoformat()
    except Exception:
        return str(value)


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


def _serialize_extraction(extraction: object | None) -> DocumentExtractionItem | None:
    if not extraction:
        return None
    line_items = _coerce_line_items(_extract_line_items(extraction))
    raw_data = _coerce_json_compatible(getattr(extraction, "rawData", None))
    return DocumentExtractionItem(
        id=getattr(extraction, "id"),
        documentId=getattr(extraction, "documentId"),
        lineItems=line_items,
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


@router.post("/upload", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    docType: str = Form(...),
    bucket: str | None = Form(None),
    module: str | None = Form(None),
    user=Depends(get_current_user),
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

        await enqueue_upload_job(
            document_id=document.id,
            bucket=target_bucket,
            module=target_module,
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
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")


@router.get("/documents", response_model=list[DocumentListItem])
async def list_documents(user=Depends(get_current_user)):
    prisma = await get_prisma()
    try:
        rows = await prisma.document.find_many(
            where={"uploadedBy": user.id, "isDeleted": False},
            order={"createdAt": "desc"},
        )
        return [
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
                status=str(row.status),
                pageCount=row.totalPages,
                isPDF=row.contentType == "application/pdf" or row.fileName.lower().endswith(".pdf"),
                previewUrl=_safe_download_url(row.bucket, row.objectKey),
            )
            for row in rows
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch documents: {exc}")


@router.get("/documents/{document_id}", response_model=DocumentDetailItem)
async def get_document(document_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()

    base_row = None
    try:
        base_row = await prisma.document.find_first(
            where={"id": document_id, "uploadedBy": user.id, "isDeleted": False},
        )
        if not base_row:
            raise HTTPException(status_code=404, detail="Document not found")

        row = await _find_document_with_include_fallback(
            prisma=prisma,
            document_id=document_id,
            user_id=user.id,
        )
        if not row:
            row = base_row
    except HTTPException:
        raise
    except Exception:
        # Fail-open for viewer: return minimum metadata even if include/extraction
        # loading fails, so frontend can still open and preview the document.
        if not base_row:
            try:
                base_row = await prisma.document.find_first(
                    where={"id": document_id, "uploadedBy": user.id, "isDeleted": False},
                )
            except Exception:
                base_row = None
        if not base_row:
            raise HTTPException(status_code=404, detail="Document not found")
        row = base_row

    doc_type = str(row.docType)
    relation_name = DOC_TYPE_TO_EXTRACTION_RELATION.get(doc_type, "")
    extraction_obj = getattr(row, relation_name, None) if relation_name else None
    if extraction_obj is None:
        extraction_obj = await _fetch_extraction_direct(
            prisma=prisma,
            doc_type=doc_type,
            document_id=str(row.id),
        )
    try:
        extraction = _serialize_extraction(extraction_obj)
    except Exception:
        extraction = None

    sales_invoice_extraction = extraction if doc_type == "SALES_INVOICE" else None
    try:
        return DocumentDetailItem(
            id=str(row.id),
            docType=str(row.docType),
            status=str(row.status),
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


@router.post("/documents/{document_id}/retry", response_model=RetryOcrResponse)
async def retry_document_ocr(document_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()
    document = await prisma.document.find_first(
        where={"id": document_id, "uploadedBy": user.id, "isDeleted": False},
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
        module=DEFAULT_MODULE,
        force_reprocess=True,
    )

    return RetryOcrResponse(
        status="success",
        message="Document OCR retry queued",
        documentId=document_id,
        queue="ocr_worker",
    )
