from datetime import datetime
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pdf2image import convert_from_bytes
from pydantic import BaseModel
from pypdf import PdfReader

from db import get_prisma
from documents_ocr.queue import enqueue_openrouter_job, enqueue_upload_job
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
POPPLER_BIN = Path("/usr/bin")
DEFAULT_MODULE = "uploads"


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
    lineItems: list[dict] | None
    rawData: dict | list | None
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
    salesInvoiceExtraction: DocumentExtractionItem | None


class RetryOcrResponse(BaseModel):
    status: str
    message: str
    documentId: str
    queue: str


def _storage_path(bucket: str, object_key: str) -> str:
    return f"s3://{bucket}/{object_key}"


async def _create_document_record(
    *,
    prisma,
    user_id: str,
    bucket: str,
    object_key: str,
    file_name: str,
    content_type: str,
    size_bytes: int,
    page_count: int,
) -> object:
    return await prisma.document.create(
        data={
            "docType": "SALES_INVOICE",
            "status": "QUEUED",
            "bucket": bucket,
            "objectKey": object_key,
            "fileName": file_name,
            "contentType": content_type,
            "sizeBytes": size_bytes,
            "totalPages": page_count,
            "uploadedBy": user_id,
        }
    )


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
    bucket: str | None = Form(None),
    module: str = Form(DEFAULT_MODULE),
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
    raw_bucket = bucket or DEFAULT_BUCKET or settings.S3_DEFAULT_BUCKET
    target_bucket = normalize_bucket_name(raw_bucket)
    bucket_error = validate_bucket_name(target_bucket)
    if bucket_error:
        raise HTTPException(
            status_code=400,
            detail=f"{bucket_error}. Received bucket value: {raw_bucket!r}",
        )

    created_objects: list[tuple[str, str]] = []
    created_document_id: str | None = None
    created_page_ids: list[str] = []
    upload_time = datetime.now()

    try:
        total_pages = 1
        source_object_key = build_object_key(file_name, module, upload_time)
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

            if not POPPLER_BIN.exists():
                raise HTTPException(
                    status_code=500,
                    detail=f"Poppler not found at: {POPPLER_BIN}",
                )

            images = convert_from_bytes(
                file_bytes,
                dpi=200,
                fmt="png",
                poppler_path=str(POPPLER_BIN),
            )

            if len(images) != total_pages:
                total_pages = len(images)
        else:
            total_pages = 1

        document = await _create_document_record(
            prisma=prisma,
            user_id=user.id,
            bucket=target_bucket,
            object_key=source_object_key,
            file_name=file_name,
            content_type=content_type,
            size_bytes=len(file_bytes),
            page_count=total_pages,
        )
        created_document_id = document.id

        if is_pdf:
            for index, image in enumerate(images, start=1):
                page_file_name = f"{Path(file_name).stem}_page_{index:03d}.png"
                page_buffer = BytesIO()
                image.save(page_buffer, format="PNG")
                page_bytes = page_buffer.getvalue()
                page_object_key = build_object_key(page_file_name, module, upload_time)
                upload_bytes(
                    body=page_bytes,
                    bucket=target_bucket,
                    object_key=page_object_key,
                    content_type="image/png",
                )
                created_objects.append((target_bucket, page_object_key))

                page = await _create_document_page_record(
                    prisma=prisma,
                    document_id=document.id,
                    page_no=index,
                    bucket=target_bucket,
                    object_key=page_object_key,
                    size_bytes=len(page_bytes),
                )
                created_page_ids.append(page.id)

        await enqueue_upload_job(
            document_id=document.id,
            bucket=target_bucket,
            module=module,
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
        for page_id in reversed(created_page_ids):
            try:
                await prisma.documentpage.delete(where={"id": page_id})
            except Exception:
                pass
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
        for page_id in reversed(created_page_ids):
            try:
                await prisma.documentpage.delete(where={"id": page_id})
            except Exception:
                pass
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
                previewUrl=get_download_url(row.bucket, row.objectKey),
            )
            for row in rows
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch documents: {exc}")


@router.get("/documents/{document_id}", response_model=DocumentDetailItem)
async def get_document(document_id: str, user=Depends(get_current_user)):
    prisma = await get_prisma()

    try:
        row = await prisma.document.find_first(
            where={"id": document_id, "uploadedBy": user.id, "isDeleted": False},
            include={
                "pages": True,
                "salesInvoiceExtraction": True,
            },
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch document: {exc}")

    if not row:
        raise HTTPException(status_code=404, detail="Document not found")

    extraction = row.salesInvoiceExtraction
    return DocumentDetailItem(
        id=row.id,
        docType=str(row.docType),
        status=str(row.status),
        bucket=row.bucket,
        objectKey=row.objectKey,
        fileName=row.fileName,
        filePath=_storage_path(row.bucket, row.objectKey),
        contentType=row.contentType,
        sizeBytes=int(row.sizeBytes),
        checksum=row.checksum,
        totalPages=row.totalPages,
        uploadedBy=row.uploadedBy,
        isDeleted=row.isDeleted,
        createdAt=row.createdAt.isoformat() if row.createdAt else "",
        updatedAt=row.updatedAt.isoformat() if row.updatedAt else "",
        previewUrl=get_download_url(row.bucket, row.objectKey),
        pages=[
            DocumentPageItem(
                id=page.id,
                documentId=page.documentId,
                pageNo=page.pageNo,
                bucket=page.bucket,
                objectKey=page.objectKey,
                sizeBytes=int(page.sizeBytes) if page.sizeBytes is not None else None,
                rawText=page.rawText,
                isExtractionSource=page.isExtractionSource,
                createdAt=page.createdAt.isoformat() if page.createdAt else "",
                previewUrl=get_download_url(page.bucket, page.objectKey),
            )
            for page in sorted(row.pages, key=lambda item: item.pageNo)
        ],
        salesInvoiceExtraction=(
            DocumentExtractionItem(
                id=extraction.id,
                documentId=extraction.documentId,
                lineItems=extraction.lineItems,
                rawData=extraction.rawData,
                extractedAt=extraction.extractedAt.isoformat() if extraction.extractedAt else None,
                reviewedBy=extraction.reviewedBy,
                reviewedAt=extraction.reviewedAt.isoformat() if extraction.reviewedAt else None,
            )
            if extraction
            else None
        ),
    )


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

    # Retry route intentionally bypasses upload queue and triggers only openrouter stage.
    await enqueue_openrouter_job(
        document_id=document_id,
        bucket=str(document.bucket),
        module=DEFAULT_MODULE,
    )

    return RetryOcrResponse(
        status="success",
        message="Document OCR retry queued",
        documentId=document_id,
        queue="openrouter_worker",
    )
