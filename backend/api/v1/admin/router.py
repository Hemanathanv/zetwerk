from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db import get_prisma
from helpers.config import settings
from helpers.dependencies import get_admin_user
from objectstore import delete_document_object, get_download_url, list_buckets, list_prefix

router = APIRouter(prefix=settings.API_SLUG + "/admin", tags=["Admin"])


class StorageFileItem(BaseModel):
    key: str
    name: str
    sizeBytes: int
    lastModified: str | None
    downloadUrl: str
    previewUrl: str | None
    contentType: str | None


class StorageListingResponse(BaseModel):
    bucket: str
    prefix: str
    breadcrumbs: list[str]
    folders: list[str]
    files: list[StorageFileItem]


class BucketListResponse(BaseModel):
    buckets: list[str]


class DeleteFileRequest(BaseModel):
    bucket: str
    key: str


class DeleteDocumentResponse(BaseModel):
    status: str
    message: str
    documentId: str
    deletedObjectKeys: list[str]
    storageDeleteErrors: list[str] = []


def _guess_content_type(name: str) -> str | None:
    suffix = Path(name).suffix.lower()
    if suffix == ".pdf":
        return "application/pdf"
    if suffix in {".png"}:
        return "image/png"
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".txt":
        return "text/plain"
    return None


async def _delete_document_with_related_and_storage(*, prisma, document_id: str) -> DeleteDocumentResponse:
    document = await prisma.document.find_unique(
        where={"id": document_id},
        include={"pages": True},
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    object_refs: list[tuple[str, str]] = []
    object_refs.append((str(document.bucket), str(document.objectKey)))
    for page in document.pages:
        object_refs.append((str(page.bucket), str(page.objectKey)))

    await prisma.document.delete(where={"id": document_id})

    storage_delete_errors: list[str] = []
    deleted_keys: list[str] = []
    for bucket, key in object_refs:
        try:
            delete_document_object(bucket, key)
            deleted_keys.append(key)
        except Exception as exc:
            storage_delete_errors.append(f"{bucket}/{key}: {exc}")

    return DeleteDocumentResponse(
        status="success",
        message="Document and related records deleted",
        documentId=document_id,
        deletedObjectKeys=deleted_keys,
        storageDeleteErrors=storage_delete_errors,
    )


@router.get("/storage/buckets", response_model=BucketListResponse)
async def get_storage_buckets(_user=Depends(get_admin_user)):
    try:
        return BucketListResponse(buckets=list_buckets())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list buckets: {exc}")


@router.get("/storage", response_model=StorageListingResponse)
async def get_storage_listing(
    bucket: str = Query(...),
    prefix: str = Query(""),
    _user=Depends(get_admin_user),
):
    try:
        folders, files = list_prefix(bucket=bucket, prefix=prefix)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list storage objects: {exc}")

    normalized_prefix = prefix.strip("/")
    breadcrumbs = [part for part in normalized_prefix.split("/") if part]

    return StorageListingResponse(
        bucket=bucket,
        prefix=normalized_prefix,
        breadcrumbs=breadcrumbs,
        folders=sorted(folders),
        files=[
            StorageFileItem(
                key=str(item["key"]),
                name=str(item["name"]),
                sizeBytes=int(item["sizeBytes"]),
                lastModified=(
                    item["lastModified"].isoformat()
                    if isinstance(item.get("lastModified"), datetime)
                    else None
                ),
                downloadUrl=get_download_url(bucket, str(item["key"])),
                previewUrl=get_download_url(bucket, str(item["key"])),
                contentType=_guess_content_type(str(item["name"])),
            )
            for item in files
        ],
    )


@router.delete("/storage/file")
async def delete_storage_file(request: DeleteFileRequest, _user=Depends(get_admin_user)):
    prisma = await get_prisma()

    page = await prisma.documentpage.find_first(
        where={"bucket": request.bucket, "objectKey": request.key},
    )
    if page:
        return await _delete_document_with_related_and_storage(
            prisma=prisma,
            document_id=str(page.documentId),
        )

    document = await prisma.document.find_first(
        where={"bucket": request.bucket, "objectKey": request.key},
    )
    if document:
        return await _delete_document_with_related_and_storage(
            prisma=prisma,
            document_id=str(document.id),
        )

    try:
        delete_document_object(request.bucket, request.key)
        return {"status": "success", "message": "Storage object deleted (no DB document mapping found)"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete storage object: {exc}")


@router.delete("/documents/{document_id}", response_model=DeleteDocumentResponse)
async def delete_document(document_id: str, _user=Depends(get_admin_user)):
    prisma = await get_prisma()
    return await _delete_document_with_related_and_storage(
        prisma=prisma,
        document_id=document_id,
    )
