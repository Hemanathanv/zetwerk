from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db import get_prisma
from helpers.config import settings
from helpers.dependencies import get_current_user
from helpers.shipment_operational import ensure_operational_shipment_tables, link_documents_to_shipment_by_keys
from project.db_setup import ensure_project_tables


router = APIRouter(prefix=settings.API_SLUG + "/projects", tags=["Projects"])


class UpdateProjectRequest(BaseModel):
    projectName: str | None = None
    customerName: str | None = None
    notes: str | None = None
    status: str | None = None


class LinkShipmentRequest(BaseModel):
    shipmentId: str


async def _query_raw(prisma, sql: str, *params) -> list[dict[str, Any]]:
    query_raw = getattr(prisma, "query_raw", None)
    if query_raw is None:
        raise RuntimeError("Prisma client has no query_raw")
    return [dict(row) for row in await query_raw(sql, *params)]


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _shipment_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "shipmentNumber": row.get("shipment_number"),
        "status": row.get("status"),
        "currentStage": row.get("current_stage") or 1,
        "currentStageName": row.get("current_stage_name"),
        "vesselName": row.get("vessel_name"),
        "portOfLoading": row.get("port_of_loading"),
        "portOfDischarge": row.get("port_of_discharge"),
        "exporterName": row.get("exporter_name"),
        "buyerName": row.get("buyer_name"),
        "blNumber": row.get("bol_number") or row.get("hbl_number"),
        "bolNumber": row.get("bol_number") or row.get("hbl_number"),
        "hblNumber": row.get("hbl_number"),
        "mblNumber": row.get("mbl_number"),
        "bookingNumber": row.get("booking_number"),
        "loadType": row.get("load_type"),
        "incoterms": row.get("incoterms"),
        "projectId": str(row["project_id"]) if row.get("project_id") else None,
        "projectName": row.get("project_name"),
        "etaPort": _iso(row.get("eta_port")),
        "etaDelivery": _iso(row.get("eta_delivery")),
        "updatedAt": _iso(row.get("updated_at")),
        "_count": {
            "documents": int(row.get("document_count") or 0),
            "documentsApproved": int(row.get("approved_document_count") or 0),
        },
    }


def _project_list_payload(row: dict[str, Any]) -> dict[str, Any]:
    shipment_count = int(row.get("shipment_count") or 0)
    completed_count = int(row.get("completed_count") or 0)
    active_count = max(shipment_count - completed_count, 0)
    return {
        "id": str(row["id"]),
        "projectCode": row.get("project_name"),
        "projectName": row.get("project_name"),
        "projectKey": row.get("project_key"),
        "customerName": row.get("customer_name"),
        "buyerOrgName": row.get("buyer_org_name"),
        "status": row.get("status") or "ACTIVE",
        "notes": row.get("notes"),
        "shipmentCount": shipment_count,
        "completedCount": completed_count,
        "activeCount": active_count,
        "completionPct": round((completed_count / shipment_count) * 100) if shipment_count else 0,
        "createdAt": _iso(row.get("created_at") or row.get("first_shipment_at") or row.get("updated_at")),
        "updatedAt": _iso(row.get("updated_at")),
        "firstShipmentAt": _iso(row.get("first_shipment_at")),
        "lastShipmentAt": _iso(row.get("last_shipment_at")),
    }


def _detail_shipment_payload(row: dict[str, Any]) -> dict[str, Any]:
    approved = int(row.get("approved_document_count") or 0)
    total = int(row.get("document_count") or 0)
    return {
        "id": str(row["id"]),
        "shipmentNumber": row.get("shipment_number"),
        "vesselName": row.get("vessel_name"),
        "portOfLoading": row.get("port_of_loading"),
        "portOfDischarge": row.get("port_of_discharge"),
        "status": row.get("status") or "ACTIVE",
        "gateProgress": row.get("gate_progress") or [],
        "docApproved": approved,
        "docTotal": total,
        "docPendingReview": max(total - approved, 0),
        "inventoryKg": None,
        "inventoryQt": None,
        "inventoryUom": None,
        "inventoryLocationLabel": None,
        "etaAt": _iso(row.get("eta_delivery") or row.get("eta_port")),
        "etaLabel": None,
        "scheduleStatus": None,
        "shippingStatus": None,
        "dndAccruedUsd": 0,
    }


async def _project_row(prisma, project_ref: str) -> dict[str, Any] | None:
    rows = await _query_raw(
        prisma,
        """
        SELECT
          p."id"::text AS id,
          p."project_name",
          p."project_key",
          p."customer_name",
          p."buyer_org_name",
          p."status",
          p."notes",
          p."shipment_count",
          p."created_at",
          p."updated_at",
          COUNT(s."id") FILTER (WHERE s."status"::text = 'COMPLETED')::int AS completed_count,
          MIN(s."created_at") AS first_shipment_at,
          MAX(s."updated_at") AS last_shipment_at
        FROM "project"."projects" p
        LEFT JOIN "public"."shipments" s ON s."project_id" = p."id"
        WHERE p."id"::text = $1::text
           OR p."project_key" = regexp_replace(lower($1::text), '[^a-z0-9]+', '', 'g')
        GROUP BY p."id", p."project_name", p."project_key", p."customer_name",
                 p."buyer_org_name", p."status", p."notes", p."shipment_count",
                 p."created_at", p."updated_at"
        LIMIT 1
        """,
        project_ref,
    )
    return rows[0] if rows else None


async def _project_shipment_rows(prisma, project_id: str, *, limit: int, offset: int) -> list[dict[str, Any]]:
    return await _query_raw(
        prisma,
        """
        SELECT
          s."id"::text AS id,
          s."shipment_number",
          s."status",
          s."current_stage",
          s."current_stage_name",
          s."vessel_name",
          s."port_of_loading",
          s."port_of_discharge",
          s."exporter_name",
          s."buyer_name",
          s."bol_number",
          s."mbl_number",
          s."booking_number",
          s."load_type",
          s."incoterms",
          s."project_id"::text AS project_id,
          s."project_name",
          s."eta_port",
          s."eta_delivery",
          s."updated_at",
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'gateNumber', gc."gate_number",
                'gateName', gc."gate_name",
                'status', sg."status"
              )
            ) FILTER (WHERE gc."id" IS NOT NULL),
            '[]'::jsonb
          ) AS gate_progress,
          COUNT(DISTINCT d."id")::int AS document_count,
          COUNT(DISTINCT d."id") FILTER (
            WHERE d."status"::text IN ('REVIEWED', 'ARCHIVED') OR d."approved_at" IS NOT NULL
          )::int AS approved_document_count
        FROM "public"."shipments" s
        LEFT JOIN "public"."documents" d
          ON d."shipment_id" = s."id"
         AND COALESCE(d."is_deleted", false) = false
        LEFT JOIN "public"."shipment_gates" sg ON sg."shipment_id" = s."id"
        LEFT JOIN "public"."gate_configs" gc ON gc."id" = sg."gate_config_id"
        WHERE s."project_id"::text = $1::text
          AND lower(COALESCE(s."status", '')) NOT IN ('cancelled', 'canceled')
        GROUP BY s."id"
        ORDER BY s."updated_at" DESC
        LIMIT $2 OFFSET $3
        """,
        project_id,
        limit,
        offset,
    )


async def _project_detail_payload(prisma, project_ref: str) -> dict[str, Any]:
    project = await _project_row(prisma, project_ref)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    shipment_rows = await _project_shipment_rows(prisma, str(project["id"]), limit=500, offset=0)
    shipments = [_detail_shipment_payload(row) for row in shipment_rows]
    total_documents = sum(shipment["docTotal"] for shipment in shipments)
    approved_documents = sum(shipment["docApproved"] for shipment in shipments)
    pending_review = sum(shipment["docPendingReview"] for shipment in shipments)
    return {
        "project": {
            "id": str(project["id"]),
            "projectCode": project.get("project_name"),
            "projectName": project.get("project_name"),
            "customerName": project.get("customer_name"),
            "buyerOrgName": project.get("buyer_org_name"),
            "status": project.get("status") or "ACTIVE",
            "notes": project.get("notes"),
            "createdAt": _iso(project.get("created_at") or project.get("first_shipment_at") or project.get("updated_at")),
        },
        "summary": {
            "totalShipments": len(shipments),
            "deliveredShipments": sum(1 for shipment in shipments if shipment["status"] == "COMPLETED"),
            "totalDocuments": total_documents,
            "approvedDocuments": approved_documents,
            "pendingReviewDocuments": pending_review,
            "totalInventoryKg": None,
            "totalInventoryUom": None,
            "totalInventoryQt": None,
            "deliveredInventoryKg": None,
            "inTransitInventoryKg": None,
            "totalDndAccruedUsd": 0,
            "activeDndContainerCount": 0,
            "activeDndLfds": [],
            "totalApApprovedUsd": 0,
            "totalApOverdueCount": 0,
            "totalFreightUsd": None,
            "totalDndUsd": 0,
        },
        "attentionItems": [],
        "shipments": shipments,
        "financials": {
            "contractValueUsd": None,
            "apInvoicesUsd": None,
            "apApprovedCount": 0,
            "apOverdueCount": 0,
            "freightCostsUsd": None,
            "dndAccruedUsd": 0,
            "revenueRecognisedUsd": None,
            "outstandingUsd": None,
        },
    }


@router.get("")
async def list_projects(
    q: str | None = Query(default=None),
    search: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _user=Depends(get_current_user),
):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    await ensure_project_tables(prisma)
    query_text = (search or q or "").strip()
    status_text = (status or "").strip().upper()
    total_rows = await _query_raw(
        prisma,
        """
        SELECT COUNT(*)::int AS total
        FROM "project"."projects" p
        WHERE ($1::text = ''
           OR p."project_name" ILIKE ('%' || $1::text || '%'))
          AND ($2::text = '' OR p."status"::text = $2::text)
        """,
        query_text,
        status_text,
    )
    rows = await _query_raw(
        prisma,
        """
        SELECT
          p."id"::text AS id,
          p."project_name",
          p."project_key",
          p."customer_name",
          p."buyer_org_name",
          p."status",
          p."notes",
          p."shipment_count",
          p."created_at",
          p."updated_at",
          COUNT(s."id") FILTER (WHERE s."status"::text = 'COMPLETED')::int AS completed_count,
          MIN(s."created_at") AS first_shipment_at,
          MAX(s."updated_at") AS last_shipment_at
        FROM "project"."projects" p
        LEFT JOIN "public"."shipments" s ON s."project_id" = p."id"
        WHERE ($1::text = ''
           OR p."project_name" ILIKE ('%' || $1::text || '%'))
          AND ($4::text = '' OR p."status"::text = $4::text)
        GROUP BY p."id", p."project_name", p."project_key", p."customer_name",
                 p."buyer_org_name", p."status", p."notes", p."shipment_count",
                 p."created_at", p."updated_at"
        ORDER BY p."updated_at" DESC
        LIMIT $2 OFFSET $3
        """,
        query_text,
        limit,
        offset,
        status_text,
    )
    total = int((total_rows[0] or {}).get("total") or 0) if total_rows else 0
    return {
        "ok": True,
        "data": [_project_list_payload(row) for row in rows],
        "meta": {
            "total": total,
            "limit": limit,
            "offset": offset,
            "hasNext": offset + len(rows) < total,
            "hasPrev": offset > 0,
        },
    }


@router.get("/{project_id}")
async def get_project(project_id: str, _user=Depends(get_current_user)):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    await ensure_project_tables(prisma)
    project = await _project_row(prisma, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"ok": True, "data": _project_list_payload(project)}


@router.get("/{project_id}/detail")
async def get_project_detail(project_id: str, _user=Depends(get_current_user)):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    await ensure_project_tables(prisma)
    return {"ok": True, "data": await _project_detail_payload(prisma, project_id)}


@router.put("/{project_id}")
async def update_project(project_id: str, request: UpdateProjectRequest, _user=Depends(get_current_user)):
    prisma = await get_prisma()
    await ensure_project_tables(prisma)
    project = await _project_row(prisma, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    rows = await _query_raw(
        prisma,
        """
        UPDATE "project"."projects"
        SET "project_name" = COALESCE(NULLIF($2::text, ''), "project_name"),
            "customer_name" = $3,
            "notes" = $4,
            "status" = COALESCE(NULLIF($5::text, ''), "status"),
            "updated_at" = NOW()
        WHERE "id"::text = $1::text
        RETURNING *
        """,
        project["id"],
        request.projectName,
        request.customerName,
        request.notes,
        request.status,
    )
    return {"ok": True, "data": _project_list_payload(rows[0]) if rows else None}


@router.post("/{project_id}/link-shipment")
async def link_project_shipment(project_id: str, request: LinkShipmentRequest, _user=Depends(get_current_user)):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    await ensure_project_tables(prisma)
    project = await _project_row(prisma, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    updated = await _query_raw(
        prisma,
        """
        UPDATE "public"."shipments"
        SET "project_id" = $2::uuid,
            "project_name" = COALESCE(NULLIF("project_name", ''), $3),
            "updated_at" = NOW()
        WHERE "id"::text = $1::text
        RETURNING "id"::text AS id
        """,
        request.shipmentId,
        project["id"],
        project.get("project_name"),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return {"ok": True, "data": {"shipmentId": str(updated[0]["id"]), "projectId": str(project["id"])}}


@router.get("/{project_id}/shipments")
async def list_project_shipments(
    project_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    _user=Depends(get_current_user),
):
    prisma = await get_prisma()
    await ensure_operational_shipment_tables(prisma)
    await ensure_project_tables(prisma)
    project_rows = await _query_raw(
        prisma,
        """
        SELECT "id"::text AS id, "project_name", "shipment_count", "status", "updated_at"
        FROM "project"."projects"
        WHERE "id"::text = $1::text OR "project_key" = regexp_replace(lower($1::text), '[^a-z0-9]+', '', 'g')
        LIMIT 1
        """,
        project_id,
    )
    if not project_rows:
        raise HTTPException(status_code=404, detail="Project not found")
    project = project_rows[0]

    shipment_rows = await _query_raw(
        prisma,
        """
        SELECT
          s."id"::text AS id,
          s."shipment_number",
          s."status",
          s."current_stage",
          s."current_stage_name",
          s."vessel_name",
          s."port_of_loading",
          s."port_of_discharge",
          s."exporter_name",
          s."buyer_name",
          s."bol_number",
          s."mbl_number",
          s."booking_number",
          s."load_type",
          s."incoterms",
          s."project_id"::text AS project_id,
          s."project_name",
          s."eta_port",
          s."eta_delivery",
          s."updated_at",
          COUNT(d."id")::int AS document_count,
          COUNT(d."id") FILTER (
            WHERE d."status"::text IN ('REVIEWED', 'ARCHIVED') OR d."approved_at" IS NOT NULL
          )::int AS approved_document_count
        FROM "public"."shipments" s
        LEFT JOIN "public"."documents" d
          ON d."shipment_id" = s."id"
         AND COALESCE(d."is_deleted", false) = false
        WHERE s."project_id"::text = $1::text
          AND lower(COALESCE(s."status", '')) NOT IN ('cancelled', 'canceled')
        GROUP BY s."id"
        ORDER BY s."updated_at" DESC
        LIMIT $2 OFFSET $3
        """,
        project["id"],
        limit,
        offset,
    )
    for row in shipment_rows:
        try:
            await link_documents_to_shipment_by_keys(prisma, str(row["id"]))
        except Exception as exc:
            print(f"[projects] warning: could not refresh shipment document links {row.get('id')}: {exc}", flush=True)

    return {
        "ok": True,
        "project": {
            "id": str(project["id"]),
            "projectName": project.get("project_name"),
            "status": project.get("status"),
            "shipmentCount": int(project.get("shipment_count") or 0),
            "updatedAt": _iso(project.get("updated_at")),
        },
        "data": [_shipment_payload(row) for row in shipment_rows],
        "meta": {
            "total": int(project.get("shipment_count") or len(shipment_rows)),
            "limit": limit,
            "offset": offset,
            "hasNext": offset + len(shipment_rows) < int(project.get("shipment_count") or 0),
            "hasPrev": offset > 0,
        },
    }
