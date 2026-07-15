from __future__ import annotations

from typing import Any
from uuid import uuid4

from document_module.shipment_id import generate_shipment_id_from_bol_data


DEFAULT_GATE_CONFIGS: tuple[tuple[str, int, str, str, list[str]], ...] = (
    ("11111111-1111-4111-8111-111111111111", 1, "UPLOAD_PROCESS", "Upload & Process", ["BILL_OF_LADING"]),
    ("22222222-2222-4222-8222-222222222222", 2, "FIELD_APPROVAL", "Field approval", ["BILL_OF_LADING"]),
    ("33333333-3333-4333-8333-333333333333", 3, "CROSS_VALIDATION", "Cross-validation", ["BILL_OF_LADING"]),
    ("44444444-4444-4444-8444-444444444444", 4, "CUSTOMS_TRANSIT", "Customs & transit", []),
    ("55555555-5555-4555-8555-555555555555", 5, "COMPLETE", "Complete", []),
)

DEFAULT_DOC_TYPE_GATES: tuple[tuple[str, str, str, str], ...] = (
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "11111111-1111-4111-8111-111111111111", "BILL_OF_LADING", "PRIMARY"),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "22222222-2222-4222-8222-222222222222", "BILL_OF_LADING", "PRIMARY"),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", "33333333-3333-4333-8333-333333333333", "ENTRY_SUMMARY", "PRIMARY"),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", "33333333-3333-4333-8333-333333333333", "OCEAN_FREIGHT", "PRIMARY"),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", "33333333-3333-4333-8333-333333333333", "CUSTOMER_BROKER_BILL", "PRIMARY"),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6", "44444444-4444-4444-8444-444444444444", "US_CARGO_RELEASE_ORDER", "PRIMARY"),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7", "44444444-4444-4444-8444-444444444444", "US_DELIVERY_ORDER", "PRIMARY"),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8", "55555555-5555-4555-8555-555555555555", "US_PACKING_LIST", "PRIMARY"),
)
_OPERATIONAL_TABLES_READY = False


async def _execute_raw(prisma: Any, sql: str, *params: Any) -> Any:
    execute_raw = getattr(prisma, "execute_raw", None)
    if execute_raw is None:
        raise RuntimeError("Prisma client has no execute_raw")
    return await execute_raw(sql, *params)


async def _query_raw(prisma: Any, sql: str, *params: Any) -> list[dict[str, Any]]:
    query_raw = getattr(prisma, "query_raw", None)
    if query_raw is None:
        raise RuntimeError("Prisma client has no query_raw")
    return [dict(row) for row in await query_raw(sql, *params)]


def _clean(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _shipment_number_from_bol(bol: dict[str, Any]) -> str | None:
    try:
        return generate_shipment_id_from_bol_data(bol)
    except Exception:
        pass
    reference_number = (
        _clean(bol.get("mbl_number"))
        or _clean(bol.get("booking_reference_number"))
        or _clean(bol.get("bol_number"))
    )
    if not reference_number:
        return None
    suffix = "".join(ch for ch in reference_number.upper() if ch.isalnum())[-4:]
    return f"ZTW-PENDING-{suffix}" if suffix else None


async def ensure_operational_shipment_tables(prisma: Any) -> None:
    global _OPERATIONAL_TABLES_READY
    if _OPERATIONAL_TABLES_READY:
        return
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "public"."shipments" (
          "id" UUID PRIMARY KEY,
          "shipment_number" TEXT NOT NULL UNIQUE,
          "status" TEXT NOT NULL DEFAULT 'ACTIVE',
          "blocked_reason" TEXT,
          "current_stage" INTEGER NOT NULL DEFAULT 1,
          "current_stage_name" TEXT,
          "workflow_template_id" UUID,
          "vessel_name" TEXT,
          "port_of_loading" TEXT,
          "port_of_discharge" TEXT,
          "exporter_name" TEXT,
          "buyer_name" TEXT,
          "bol_number" TEXT,
          "mbl_number" TEXT,
          "booking_number" TEXT,
          "load_type" TEXT,
          "incoterms" TEXT,
          "project_name" TEXT,
          "eta_port" TIMESTAMPTZ,
          "eta_delivery" TIMESTAMPTZ,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    await _execute_raw(prisma, 'ALTER TABLE "public"."documents" ADD COLUMN IF NOT EXISTS "shipment_id" UUID')
    await _execute_raw(prisma, 'ALTER TABLE "public"."documents" ADD COLUMN IF NOT EXISTS "document_type" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."documents" ADD COLUMN IF NOT EXISTS "document_number" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."documents" ADD COLUMN IF NOT EXISTS "ocr_status" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."documents" ADD COLUMN IF NOT EXISTS "validation_status" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."documents" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMPTZ')
    await _execute_raw(prisma, 'ALTER TABLE "public"."documents" ADD COLUMN IF NOT EXISTS "is_generated" BOOLEAN NOT NULL DEFAULT FALSE')
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "public"."gate_configs" (
          "id" UUID PRIMARY KEY,
          "gate_number" INTEGER NOT NULL UNIQUE,
          "gate_code" TEXT NOT NULL UNIQUE,
          "gate_name" TEXT NOT NULL,
          "gate_label" TEXT,
          "geography" TEXT,
          "required_doc_types" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          "gate_check_type" TEXT NOT NULL DEFAULT 'DOCUMENT_REVIEW',
          "is_identity_gate" BOOLEAN NOT NULL DEFAULT FALSE,
          "is_parallel" BOOLEAN NOT NULL DEFAULT FALSE,
          "parallel_group" TEXT,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    await _execute_raw(prisma, 'ALTER TABLE "public"."gate_configs" ADD COLUMN IF NOT EXISTS "gate_label" TEXT')
    await _execute_raw(prisma, 'ALTER TABLE "public"."gate_configs" ADD COLUMN IF NOT EXISTS "geography" TEXT')
    for gate_id, gate_number, gate_code, gate_name, required_doc_types in DEFAULT_GATE_CONFIGS:
        await _execute_raw(
            prisma,
            """
            INSERT INTO "public"."gate_configs" (
              "id", "gate_number", "gate_code", "gate_name", "required_doc_types"
            )
            VALUES ($1::uuid, $2, $3, $4, $5::text[])
            ON CONFLICT ("id") DO UPDATE SET
              "gate_number" = EXCLUDED."gate_number",
              "gate_code" = EXCLUDED."gate_code",
              "gate_name" = EXCLUDED."gate_name",
              "required_doc_types" = EXCLUDED."required_doc_types",
              "updated_at" = NOW()
            """,
            gate_id,
            gate_number,
            gate_code,
            gate_name,
            required_doc_types,
        )
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "public"."doc_type_gates" (
          "id" UUID PRIMARY KEY,
          "gate_config_id" UUID NOT NULL REFERENCES "public"."gate_configs"("id") ON DELETE CASCADE,
          "doc_type" TEXT NOT NULL,
          "role_in_gate" TEXT NOT NULL DEFAULT 'PRIMARY',
          "is_generated" BOOLEAN NOT NULL DEFAULT FALSE,
          "mandatory_photo" BOOLEAN NOT NULL DEFAULT FALSE,
          "sla_override_days" INTEGER,
          "sort_order" INTEGER,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE ("gate_config_id", "doc_type", "role_in_gate")
        )
        """,
    )
    for sort_order, (row_id, gate_id, doc_type, role_in_gate) in enumerate(DEFAULT_DOC_TYPE_GATES, start=1):
        await _execute_raw(
            prisma,
            """
            INSERT INTO "public"."doc_type_gates" (
              "id", "gate_config_id", "doc_type", "role_in_gate", "sort_order"
            )
            VALUES ($1::uuid, $2::uuid, $3, $4, $5)
            ON CONFLICT ("gate_config_id", "doc_type", "role_in_gate") DO UPDATE SET
              "sort_order" = EXCLUDED."sort_order",
              "updated_at" = NOW()
            """,
            row_id,
            gate_id,
            doc_type,
            role_in_gate,
            sort_order,
        )
    await _execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS "public"."shipment_gates" (
          "id" UUID PRIMARY KEY,
          "shipment_id" UUID NOT NULL REFERENCES "public"."shipments"("id") ON DELETE CASCADE,
          "gate_config_id" UUID NOT NULL REFERENCES "public"."gate_configs"("id"),
          "status" TEXT NOT NULL DEFAULT 'FUTURE',
          "passed_at" TIMESTAMPTZ,
          "skipped_at" TIMESTAMPTZ,
          "failure_reason" TEXT,
          "blocked_reason" TEXT,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE ("shipment_id", "gate_config_id")
        )
        """,
    )
    await _execute_raw(prisma, 'CREATE INDEX IF NOT EXISTS "idx_shipments_number" ON "public"."shipments"("shipment_number")')
    await _execute_raw(prisma, 'CREATE INDEX IF NOT EXISTS "idx_documents_shipment_id" ON "public"."documents"("shipment_id")')
    await _execute_raw(prisma, 'UPDATE "public"."shipment_gates" SET "status" = \'OPEN\' WHERE "status" = \'ACTIVE\'')
    _OPERATIONAL_TABLES_READY = True


async def create_or_update_shipment_from_bol_document(prisma: Any, document_id: str) -> str | None:
    await ensure_operational_shipment_tables(prisma)
    rows = await _query_raw(
        prisma,
        """
        SELECT bol.*, d."doc_type"::text AS doc_type
        FROM "aiextraction"."bills_of_lading" bol
        JOIN "public"."documents" d ON d."id" = bol."document_id"
        WHERE bol."document_id" = $1
        LIMIT 1
        """,
        document_id,
    )
    if not rows:
        return None

    bol = rows[0]
    shipment_number = _shipment_number_from_bol(bol)
    if not shipment_number:
        return None
    shipment_id = str(uuid4())
    document_number = _clean(bol.get("bol_number")) or shipment_number
    existing_rows = await _query_raw(
        prisma,
        """
        SELECT "id"::text AS id
        FROM "public"."shipments"
        WHERE ($1::text IS NOT NULL AND "mbl_number" = $1::text)
           OR ($2::text IS NOT NULL AND "booking_number" = $2::text)
           OR ($3::text IS NOT NULL AND "bol_number" = $3::text)
           OR "shipment_number" = $4
        ORDER BY "created_at" ASC
        LIMIT 1
        """,
        _clean(bol.get("mbl_number")),
        _clean(bol.get("booking_reference_number")),
        _clean(bol.get("bol_number")),
        shipment_number,
    )

    common_params = (
        shipment_number,
        _clean(bol.get("vessel_name")),
        _clean(bol.get("port_of_loading") or bol.get("place_of_receipt")),
        _clean(bol.get("port_of_discharge") or bol.get("final_destination") or bol.get("place_of_delivery")),
        _clean(bol.get("shipper_name")),
        _clean(bol.get("consignee_name") or bol.get("notify_party_name")),
        _clean(bol.get("bol_number")),
        _clean(bol.get("mbl_number")),
        _clean(bol.get("booking_reference_number")),
        "FCL" if _clean(bol.get("total_containers")) else None,
        _clean(bol.get("freight_type")),
        _clean(bol.get("project_name")),
    )
    if existing_rows:
        shipment_rows = await _query_raw(
            prisma,
            """
            UPDATE "public"."shipments"
            SET "shipment_number" = $2,
                "vessel_name" = COALESCE($3, "vessel_name"),
                "port_of_loading" = COALESCE($4, "port_of_loading"),
                "port_of_discharge" = COALESCE($5, "port_of_discharge"),
                "exporter_name" = COALESCE($6, "exporter_name"),
                "buyer_name" = COALESCE($7, "buyer_name"),
                "bol_number" = COALESCE($8, "bol_number"),
                "mbl_number" = COALESCE($9, "mbl_number"),
                "booking_number" = COALESCE($10, "booking_number"),
                "load_type" = COALESCE($11, "load_type"),
                "incoterms" = COALESCE($12, "incoterms"),
                "project_name" = COALESCE($13, "project_name"),
                "updated_at" = NOW()
            WHERE "id" = $1::uuid
            RETURNING "id"::text AS id
            """,
            existing_rows[0]["id"],
            *common_params,
        )
    else:
        shipment_rows = await _query_raw(
            prisma,
            """
            INSERT INTO "public"."shipments" (
              "id", "shipment_number", "status", "current_stage", "current_stage_name",
              "vessel_name", "port_of_loading", "port_of_discharge",
              "exporter_name", "buyer_name", "bol_number", "mbl_number",
              "booking_number", "load_type", "incoterms", "project_name", "updated_at"
            )
            VALUES (
              $1::uuid, $2, 'ACTIVE', 2, 'Field approval',
              $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW()
            )
            ON CONFLICT ("shipment_number") DO UPDATE SET
              "vessel_name" = COALESCE(EXCLUDED."vessel_name", "public"."shipments"."vessel_name"),
              "port_of_loading" = COALESCE(EXCLUDED."port_of_loading", "public"."shipments"."port_of_loading"),
              "port_of_discharge" = COALESCE(EXCLUDED."port_of_discharge", "public"."shipments"."port_of_discharge"),
              "exporter_name" = COALESCE(EXCLUDED."exporter_name", "public"."shipments"."exporter_name"),
              "buyer_name" = COALESCE(EXCLUDED."buyer_name", "public"."shipments"."buyer_name"),
              "bol_number" = COALESCE(EXCLUDED."bol_number", "public"."shipments"."bol_number"),
              "mbl_number" = COALESCE(EXCLUDED."mbl_number", "public"."shipments"."mbl_number"),
              "booking_number" = COALESCE(EXCLUDED."booking_number", "public"."shipments"."booking_number"),
              "load_type" = COALESCE(EXCLUDED."load_type", "public"."shipments"."load_type"),
              "incoterms" = COALESCE(EXCLUDED."incoterms", "public"."shipments"."incoterms"),
              "project_name" = COALESCE(EXCLUDED."project_name", "public"."shipments"."project_name"),
              "updated_at" = NOW()
            RETURNING "id"::text AS id
            """,
            shipment_id,
            *common_params,
        )
    resolved_shipment_id = str(shipment_rows[0]["id"]) if shipment_rows else shipment_id

    await _execute_raw(
        prisma,
        """
        UPDATE "public"."documents"
        SET
          "shipment_id" = $2::uuid,
          "document_type" = COALESCE("document_type", "doc_type"::text),
          "document_number" = COALESCE($3, "document_number"),
          "ocr_status" = 'completed',
          "validation_status" = 'approved',
          "approved_at" = COALESCE("approved_at", NOW()),
          "updated_at" = NOW()
        WHERE "id" = $1
        """,
        document_id,
        resolved_shipment_id,
        document_number,
    )

    for index, (gate_id, _gate_number, _gate_code, _gate_name, _required_doc_types) in enumerate(DEFAULT_GATE_CONFIGS):
        await _execute_raw(
            prisma,
            """
            INSERT INTO "public"."shipment_gates" ("id", "shipment_id", "gate_config_id", "status")
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
            ON CONFLICT ("shipment_id", "gate_config_id") DO NOTHING
            """,
            str(uuid4()),
            resolved_shipment_id,
            gate_id,
            "OPEN" if index == 0 else "FUTURE",
        )

    return resolved_shipment_id


async def sync_reviewed_bols_as_shipments(prisma: Any, *, limit: int = 500) -> int:
    await ensure_operational_shipment_tables(prisma)
    rows = await _query_raw(
        prisma,
        """
        SELECT bol."document_id"
        FROM "aiextraction"."bills_of_lading" bol
        JOIN "public"."documents" d ON d."id" = bol."document_id"
        WHERE d."status"::text IN ('REVIEWED', 'ARCHIVED')
        ORDER BY d."updated_at" DESC
        LIMIT $1
        """,
        limit,
    )
    synced = 0
    for row in rows:
        if await create_or_update_shipment_from_bol_document(prisma, str(row["document_id"])):
            synced += 1
    await _execute_raw(
        prisma,
        """
        DELETE FROM "public"."shipments" hbl
        WHERE hbl."mbl_number" IS NULL
          AND hbl."booking_number" IS NULL
          AND hbl."bol_number" IS NOT NULL
          AND hbl."shipment_number" = hbl."bol_number"
          AND EXISTS (
            SELECT 1
            FROM "public"."shipments" mbl
            WHERE mbl."id" <> hbl."id"
              AND mbl."bol_number" = hbl."bol_number"
              AND (mbl."mbl_number" IS NOT NULL OR mbl."booking_number" IS NOT NULL)
          )
        """
    )
    return synced
