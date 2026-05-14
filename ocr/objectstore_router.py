import fastapi
from pydantic import BaseModel, Field

from database import get_db
from backend.objectstore import DEFAULT_BUCKET, delete_document_object, get_download_url, upload_document

router = fastapi.APIRouter(prefix="/api/documents")


class DocumentSelectionPayload(BaseModel):
    ids: list[int] = Field(..., min_length=1)


@router.post("/upload")
async def upload(
    file: fastapi.UploadFile = fastapi.File(...),
    bucket: str = DEFAULT_BUCKET,
    module: str = "finance",
    db=fastapi.Depends(get_db),
):
    doc = await upload_document(file, bucket, module, db)
    return {
        "id": doc["id"],
        "bucket": doc["bucket"],
        "module": doc["module"],
        "file_key": doc["file_key"],
        "file_name": doc["name"],
    }


@router.get("/download-url")
async def download_url(bucket: str, file_key: str):
    url = get_download_url(bucket, file_key)
    return {"url": url, "expires_in": 3600}


@router.get("/")
async def list_documents(module: str = None, db=fastapi.Depends(get_db)):
    if module:
        docs = await db.fetch(
            "SELECT * FROM documents WHERE module=$1 ORDER BY created_at DESC", module
        )
    else:
        docs = await db.fetch("SELECT * FROM documents ORDER BY created_at DESC")
    return [dict(doc) for doc in docs]


@router.post("/select")
async def select_documents(payload: DocumentSelectionPayload, db=fastapi.Depends(get_db)):
    docs = await db.fetch(
        "SELECT * FROM documents WHERE id = ANY($1::int[]) ORDER BY created_at DESC",
        payload.ids,
    )
    return [dict(doc) for doc in docs]


@router.delete("/delete-all")
async def delete_all_documents(module: str | None = None, db=fastapi.Depends(get_db)):
    if module:
        docs = await db.fetch(
            "SELECT id, bucket, file_key FROM documents WHERE module=$1",
            module,
        )
    else:
        docs = await db.fetch("SELECT id, bucket, file_key FROM documents")

    if not docs:
        return {"deleted_ids": [], "count": 0}

    deleted_ids: list[int] = []
    for doc in docs:
        delete_document_object(doc["bucket"], doc["file_key"])
        deleted_ids.append(doc["id"])

    if module:
        await db.execute("DELETE FROM documents WHERE module=$1", module)
    else:
        await db.execute("DELETE FROM documents")

    return {"deleted_ids": deleted_ids, "count": len(deleted_ids)}


@router.delete("/{doc_id}")
async def delete_document(doc_id: int, db=fastapi.Depends(get_db)):
    doc = await db.fetchrow("SELECT * FROM documents WHERE id=$1", doc_id)
    if not doc:
        raise fastapi.HTTPException(status_code=404, detail="Document not found")

    delete_document_object(doc["bucket"], doc["file_key"])
    await db.execute("DELETE FROM documents WHERE id=$1", doc_id)
    return {"deleted_ids": [doc_id], "count": 1}


@router.post("/delete")
async def delete_documents(payload: DocumentSelectionPayload, db=fastapi.Depends(get_db)):
    docs = await db.fetch(
        "SELECT id, bucket, file_key FROM documents WHERE id = ANY($1::int[])",
        payload.ids,
    )
    if not docs:
        raise fastapi.HTTPException(status_code=404, detail="No matching documents found")

    deleted_ids: list[int] = []
    for doc in docs:
        delete_document_object(doc["bucket"], doc["file_key"])
        await db.execute("DELETE FROM documents WHERE id=$1", doc["id"])
        deleted_ids.append(doc["id"])

    return {"deleted_ids": deleted_ids, "count": len(deleted_ids)}
