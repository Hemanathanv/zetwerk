from uuid import NAMESPACE_URL, uuid5

from api.v1.doc_generation.router import (
    SHARED_DOCGEN_SOURCE_ROLES,
    _build_payload,
    _persist_draft,
    _query_raw,
    _select_source_row,
)
from doc_generation.db_setup import ensure_doc_generation_views


async def ensure_entry_summary_draft_for_bol(
    *,
    prisma,
    bol_document_id: str,
    user_id: str,
    user_role: str | None = None,
) -> str:
    """Create the Entry Summary / Draft BOE draft for a BOL exactly once."""
    await ensure_doc_generation_views(prisma)
    shared_sources = (user_role or "").upper().replace("-", "_").replace(" ", "_") in SHARED_DOCGEN_SOURCE_ROLES
    created_by_filter = "" if shared_sources else "AND created_by::text = $2::text"
    existing = await _query_raw(
        prisma,
        f"""
        SELECT id
        FROM docgen.drafts
        WHERE generated_doc_type = 'ENTRY_SUMMARY'
          AND source_document_ids ->> 'BILL_OF_LADING' = $1
          AND schema_version >= 2
          {created_by_filter}
        ORDER BY created_at DESC
        LIMIT 1
        """,
        bol_document_id,
        user_id,
    )
    if existing:
        return str(existing[0]["id"])

    row = await _select_source_row(
        prisma,
        "ENTRY_SUMMARY",
        {"BILL_OF_LADING": bol_document_id},
        user_id,
        user_role,
    )
    deterministic_id = str(
        uuid5(
            NAMESPACE_URL,
            f"ewms:entry-summary:{user_id}:{bol_document_id}",
        )
    )
    payload = _build_payload("ENTRY_SUMMARY", deterministic_id, row)
    try:
        await _persist_draft(prisma, payload, user_id)
    except Exception:
        created = await _query_raw(
            prisma,
            """
            SELECT id
            FROM docgen.drafts
            WHERE id::text = $1::text
              AND ($3::boolean OR created_by::text = $2::text)
            LIMIT 1
            """,
            deterministic_id,
            user_id,
            shared_sources,
        )
        if not created:
            raise
    return payload.draftId


async def ensure_entry_summary_drafts_for_all_eligible_bols(prisma) -> dict[str, int]:
    """Materialize Entry Summary / Draft BOE drafts for every eligible historical BOL."""
    await ensure_doc_generation_views(prisma)
    rows = await _query_raw(
        prisma,
        """
        SELECT DISTINCT v.bol_document_id, bol_doc.uploaded_by
        FROM docgen.v_entry_summary_source v
        JOIN public.documents bol_doc ON bol_doc.id = v.bol_document_id
        WHERE bol_doc.uploaded_by IS NOT NULL
        ORDER BY v.bol_document_id DESC
        """,
    )
    created_or_existing = 0
    skipped = 0
    for row in rows:
        bol_document_id = row.get("bol_document_id")
        uploaded_by = row.get("uploaded_by")
        if not bol_document_id or not uploaded_by:
            skipped += 1
            continue
        try:
            await ensure_entry_summary_draft_for_bol(
                prisma=prisma,
                bol_document_id=str(bol_document_id),
                user_id=str(uploaded_by),
            )
            created_or_existing += 1
        except Exception as exc:
            skipped += 1
            print(f"[docgen][entry-summary-backfill] skipped bolDocumentId={bol_document_id} error={exc}", flush=True)
    return {"eligible": len(rows), "ready": created_or_existing, "skipped": skipped}
