from __future__ import annotations

from typing import Any
from uuid import uuid4

from document_module.shipment_id import generate_shipment_id_from_bol_data
from project.service import sync_project_for_shipment, sync_projects_from_shipments


DEFAULT_GATE_CONFIGS: tuple[tuple[str, int, str, str, list[str]], ...] = (
    ("11111111-1111-4111-8111-111111111111", 1, "SHIPMENT_INITIATION", "Shipment Initiation", ["SALES_INVOICE", "PACKING_LIST", "SHIPPING_BILL"]),
    ("22222222-2222-4222-8222-222222222222", 2, "INDIA_PORT_EXIT", "India Port Exit", ["BILL_OF_LADING", "ENTRY_SUMMARY", "DRAFT_CBP_FORM_7501_BROKER"]),
    ("33333333-3333-4333-8333-333333333333", 3, "US_PORT_ENTRY", "US Port Entry", ["ISF", "ENTRY_SUMMARY", "US_CARGO_RELEASE_ORDER", "US_CUSTOMS_RELEASE_ORDER"]),
    ("44444444-4444-4444-8444-444444444444", 4, "WAREHOUSE_ENTRY", "3PL Warehouse Entry", ["US_DELIVERY_ORDER", "GRN_INBOUND"]),
    ("55555555-5555-4555-8555-555555555555", 5, "CUSTOMER_DELIVERY", "Customer Delivery", ["US_SALES_INVOICE", "US_PACKING_LIST"]),
)

DEFAULT_DOC_TYPE_GATES: tuple[tuple[str, str, str, str, bool], ...] = (
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "11111111-1111-4111-8111-111111111111", "SALES_INVOICE", "PRIMARY", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "11111111-1111-4111-8111-111111111111", "PACKING_LIST", "PRIMARY", True),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", "11111111-1111-4111-8111-111111111111", "SHIPPING_BILL", "PRIMARY", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", "11111111-1111-4111-8111-111111111111", "CHA_BILL", "PARALLEL", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", "22222222-2222-4222-8222-222222222222", "BILL_OF_LADING", "PRIMARY", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6", "22222222-2222-4222-8222-222222222222", "ENTRY_SUMMARY", "PRIMARY", True),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7", "22222222-2222-4222-8222-222222222222", "DRAFT_CBP_FORM_7501_BROKER", "PRIMARY", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8", "22222222-2222-4222-8222-222222222222", "FREIGHT_FORWARDER_BILL", "PARALLEL", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9", "33333333-3333-4333-8333-333333333333", "ISF", "PRIMARY", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10", "33333333-3333-4333-8333-333333333333", "ENTRY_SUMMARY", "PRIMARY", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11", "33333333-3333-4333-8333-333333333333", "US_CARGO_RELEASE_ORDER", "PRIMARY", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12", "33333333-3333-4333-8333-333333333333", "US_CUSTOMS_RELEASE_ORDER", "PRIMARY", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13", "33333333-3333-4333-8333-333333333333", "CUSTOMER_BROKER_BILL", "PARALLEL", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa14", "33333333-3333-4333-8333-333333333333", "OCEAN_FREIGHT", "PARALLEL", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa15", "44444444-4444-4444-8444-444444444444", "US_DELIVERY_ORDER", "PRIMARY", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa16", "44444444-4444-4444-8444-444444444444", "GRN_INBOUND", "PRIMARY", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa17", "44444444-4444-4444-8444-444444444444", "PORT_TO_WH", "PARALLEL", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa18", "55555555-5555-4555-8555-555555555555", "US_SALES_INVOICE", "PRIMARY", False),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa19", "55555555-5555-4555-8555-555555555555", "US_PACKING_LIST", "PRIMARY", True),
    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20", "55555555-5555-4555-8555-555555555555", "WH_TO_CUSTOMER", "PARALLEL", False),
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


def _norm_key(value: Any) -> str | None:
    text = "".join(ch.lower() for ch in str(value or "") if ch.isalnum())
    return text or None


def _add_key(keys: set[str], value: Any) -> None:
    normalized = _norm_key(value)
    if normalized:
        keys.add(normalized)


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


def _bol_raw_data(bol: dict[str, Any]) -> dict[str, Any]:
    raw_data = bol.get("raw_data")
    return raw_data if isinstance(raw_data, dict) else {}


def _bol_is_shipment_eligible(bol: dict[str, Any]) -> bool:
    return bool(
        _clean(bol.get("mbl_number"))
        or _clean(bol.get("booking_reference_number"))
        or _clean(bol.get("bol_number"))
    )


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
    for sort_order, (row_id, gate_id, doc_type, role_in_gate, is_generated) in enumerate(DEFAULT_DOC_TYPE_GATES, start=1):
        await _execute_raw(
            prisma,
            """
            INSERT INTO "public"."doc_type_gates" (
              "id", "gate_config_id", "doc_type", "role_in_gate", "is_generated", "sort_order"
            )
            VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
            ON CONFLICT ("id") DO UPDATE SET
              "gate_config_id" = EXCLUDED."gate_config_id",
              "doc_type" = EXCLUDED."doc_type",
              "role_in_gate" = EXCLUDED."role_in_gate",
              "is_generated" = EXCLUDED."is_generated",
              "sort_order" = EXCLUDED."sort_order",
              "updated_at" = NOW()
            """,
            row_id,
            gate_id,
            doc_type,
            role_in_gate,
            is_generated,
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
    if not _bol_is_shipment_eligible(bol):
        return None

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
    try:
        await sync_project_for_shipment(prisma, resolved_shipment_id)
    except Exception as exc:
        print(f"[projects] warning: could not sync project for shipment {resolved_shipment_id}: {exc}", flush=True)

    await _execute_raw(
        prisma,
        """
        UPDATE "public"."documents"
        SET
          "shipment_id" = $2::uuid,
          "document_type" = COALESCE("document_type", "doc_type"::text),
          "document_number" = COALESCE($3, "document_number"),
          "ocr_status" = 'completed',
          "validation_status" = CASE
            WHEN UPPER(COALESCE("validation_status", '')) IN ('PASSED', 'WARNING', 'WARNED', 'BLOCKED', 'FAILED', 'WAITING')
              THEN "validation_status"
            ELSE 'WAITING'
          END,
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
            "PASSED" if index < 2 else "OPEN" if index == 2 else "FUTURE",
        )

    await link_documents_to_shipment_by_keys(prisma, resolved_shipment_id)

    return resolved_shipment_id


async def _shipment_document_link_keys(prisma: Any, shipment_id: str) -> dict[str, list[str]]:
    rows = await _query_raw(
        prisma,
        """
        SELECT
          bol."bol_number",
          bol."shipment_reference_number",
          bol."mbl_number",
          bol."booking_reference_number",
          bol."project_name",
          bol."export_invoice_number",
          bol."export_shipping_bill_number",
          bol."raw_data"->>'bolNumber' AS raw_bol_number,
          bol."raw_data"->>'bol_number' AS raw_bol_number_snake,
          bol."raw_data"->>'hblNumber' AS raw_hbl_number,
          bol."raw_data"->>'hbl_number' AS raw_hbl_number_snake,
          bol."raw_data"->>'houseBlNumber' AS raw_house_bl_number,
          bol."raw_data"->>'house_bl_number' AS raw_house_bl_number_snake,
          bol."raw_data"->>'mblNumber' AS raw_mbl_number,
          bol."raw_data"->>'mbl_number' AS raw_mbl_number_snake,
          bol."raw_data"->>'masterBlNumber' AS raw_master_bl_number,
          bol."raw_data"->>'master_bl_number' AS raw_master_bl_number_snake,
          bol."raw_data"->>'bookingReferenceNumber' AS raw_booking_reference_number,
          bol."raw_data"->>'booking_reference_number' AS raw_booking_reference_number_snake,
          bol."raw_data"->>'projectName' AS raw_project_name,
          bol."raw_data"->>'project_name' AS raw_project_name_snake,
          bei."invoice_number" AS child_invoice_number,
          bsb."shipping_bill_number" AS child_shipping_bill_number,
          bc."number" AS container_number,
          es."filer_code_entry_number",
          es."bl_or_awb_number",
          upl."packing_slip_number",
          si."invoice_no" AS sales_invoice_number,
          si."shipping_bill_no" AS sales_invoice_shipping_bill_number,
          pl."invoice_no" AS packing_list_invoice_number,
          sb."sb_no" AS linked_shipping_bill_number,
          sbir."invoice_no_and_date" AS shipping_bill_invoice_reference,
          ussi."invoice_no" AS us_sales_invoice_no,
          ussi."so_no" AS us_sales_so_number,
          ussi."po_no" AS us_sales_po_number
        FROM "public"."documents" d
        LEFT JOIN "aiextraction"."bills_of_lading" bol ON bol."document_id" = d."id"
        LEFT JOIN "aiextraction"."bill_of_lading_export_invoices" bei ON bei."bill_of_lading_id" = bol."id"
        LEFT JOIN "aiextraction"."bill_of_lading_shipping_bills" bsb ON bsb."bill_of_lading_id" = bol."id"
        LEFT JOIN "aiextraction"."bill_of_lading_containers" bc ON bc."bill_of_lading_id" = bol."id"
        LEFT JOIN "aiextraction"."entry_summary_extractions" es ON es."document_id" = d."id"
        LEFT JOIN "aiextraction"."us_packing_list_extractions" upl ON upl."document_id" = d."id"
        LEFT JOIN "aiextraction"."sales_invoice_extractions" si ON si."document_id" = d."id"
        LEFT JOIN "aiextraction"."packing_list_extractions" pl ON pl."document_id" = d."id"
        LEFT JOIN "aiextraction"."shipping_bill_extractions" sb ON sb."document_id" = d."id"
        LEFT JOIN "aiextraction"."shipping_bill_invoice_refs" sbir ON sbir."shipping_bill_id" = sb."id"
        LEFT JOIN "aiextraction"."us_sales_invoice_extractions" ussi ON ussi."document_id" = d."id"
        WHERE d."shipment_id" = $1::uuid
          AND d."is_deleted" = FALSE
        """,
        shipment_id,
    )
    keys = {
        "invoice": set(),
        "shipping_bill": set(),
        "bl": set(),
        "container": set(),
        "entry": set(),
        "project": set(),
        "packing_slip": set(),
    }
    for row in rows:
        _add_key(keys["invoice"], row.get("export_invoice_number"))
        _add_key(keys["invoice"], row.get("child_invoice_number"))
        _add_key(keys["invoice"], row.get("sales_invoice_number"))
        _add_key(keys["invoice"], row.get("packing_list_invoice_number"))
        _add_key(keys["invoice"], row.get("shipping_bill_invoice_reference"))
        _add_key(keys["invoice"], row.get("us_sales_invoice_no"))
        _add_key(keys["shipping_bill"], row.get("export_shipping_bill_number"))
        _add_key(keys["shipping_bill"], row.get("child_shipping_bill_number"))
        _add_key(keys["shipping_bill"], row.get("sales_invoice_shipping_bill_number"))
        _add_key(keys["shipping_bill"], row.get("linked_shipping_bill_number"))
        _add_key(keys["bl"], row.get("bol_number"))
        _add_key(keys["bl"], row.get("shipment_reference_number"))
        _add_key(keys["bl"], row.get("mbl_number"))
        _add_key(keys["bl"], row.get("booking_reference_number"))
        _add_key(keys["bl"], row.get("bl_or_awb_number"))
        _add_key(keys["bl"], row.get("raw_bol_number"))
        _add_key(keys["bl"], row.get("raw_bol_number_snake"))
        _add_key(keys["bl"], row.get("raw_hbl_number"))
        _add_key(keys["bl"], row.get("raw_hbl_number_snake"))
        _add_key(keys["bl"], row.get("raw_house_bl_number"))
        _add_key(keys["bl"], row.get("raw_house_bl_number_snake"))
        _add_key(keys["bl"], row.get("raw_mbl_number"))
        _add_key(keys["bl"], row.get("raw_mbl_number_snake"))
        _add_key(keys["bl"], row.get("raw_master_bl_number"))
        _add_key(keys["bl"], row.get("raw_master_bl_number_snake"))
        _add_key(keys["bl"], row.get("raw_booking_reference_number"))
        _add_key(keys["bl"], row.get("raw_booking_reference_number_snake"))
        _add_key(keys["container"], row.get("container_number"))
        _add_key(keys["entry"], row.get("filer_code_entry_number"))
        _add_key(keys["project"], row.get("project_name"))
        _add_key(keys["project"], row.get("raw_project_name"))
        _add_key(keys["project"], row.get("raw_project_name_snake"))
        _add_key(keys["packing_slip"], row.get("packing_slip_number"))
        _add_key(keys["packing_slip"], row.get("us_sales_so_number"))
        _add_key(keys["packing_slip"], row.get("us_sales_po_number"))
    return {name: sorted(values) for name, values in keys.items()}


async def _shipment_reference_link_keys(prisma: Any, shipment_id: str) -> dict[str, list[str]]:
    rows = await _query_raw(
        prisma,
        """
        SELECT "shipment_number", "bol_number", "mbl_number", "booking_number", "project_name"
        FROM "public"."shipments"
        WHERE "id" = $1::uuid
        LIMIT 1
        """,
        shipment_id,
    )
    keys = {
        "invoice": set(),
        "shipping_bill": set(),
        "bl": set(),
        "container": set(),
        "entry": set(),
        "project": set(),
        "packing_slip": set(),
    }
    if rows:
        row = rows[0]
        _add_key(keys["bl"], row.get("shipment_number"))
        _add_key(keys["bl"], row.get("bol_number"))
        _add_key(keys["bl"], row.get("mbl_number"))
        _add_key(keys["bl"], row.get("booking_number"))
        _add_key(keys["project"], row.get("project_name"))
    return {name: sorted(values) for name, values in keys.items()}


def _merge_link_keys(*sources: dict[str, list[str]]) -> dict[str, list[str]]:
    merged: dict[str, set[str]] = {}
    for source in sources:
        for name, values in source.items():
            merged.setdefault(name, set()).update(value for value in values if value)
    return {name: sorted(values) for name, values in merged.items()}


async def _link_by_query(
    prisma: Any,
    *,
    shipment_id: str,
    sql: str,
    keys: list[str],
) -> int:
    if not keys:
        return 0
    rows = await _query_raw(prisma, sql, shipment_id, keys)
    return int(rows[0].get("linked_count") or 0) if rows else 0


async def _link_packing_lists_from_bol_container_mapping(prisma: Any, shipment_id: str) -> int:
    rows = await _query_raw(
        prisma,
        """
        WITH mapped_pl_docs AS (
          SELECT DISTINCT item.value->>'packingListDocumentId' AS document_id
          FROM "public"."documents" bol_doc
          JOIN "aiextraction"."bills_of_lading" bol ON bol."document_id" = bol_doc."id"
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(bol."raw_data"->'containerMappingRows', '[]'::jsonb)) AS item(value)
          WHERE bol_doc."shipment_id" = $1::uuid
            AND bol_doc."is_deleted" = FALSE
            AND COALESCE(bol."raw_data"->>'containerMappingApproved', 'false') = 'true'
            AND item.value->>'packingListDocumentId' ~* '^[0-9a-f-]{36}$'
        ),
        updated AS (
          UPDATE "public"."documents" d
          SET
            "shipment_id" = $1::uuid,
            "document_type" = COALESCE(d."document_type", d."doc_type"::text),
            "ocr_status" = CASE
              WHEN d."status"::text IN ('REVIEWED', 'ARCHIVED') THEN 'completed'
              ELSE COALESCE(d."ocr_status", lower(d."status"::text))
            END,
            "validation_status" = COALESCE(d."validation_status", 'WAITING'),
            "approved_at" = COALESCE(
              d."approved_at",
              pl."reviewed_at",
              CASE WHEN d."status"::text IN ('REVIEWED', 'ARCHIVED') THEN NOW() ELSE NULL END
            ),
            "updated_at" = NOW()
          FROM mapped_pl_docs mapped
          JOIN "aiextraction"."packing_list_extractions" pl ON pl."document_id" = mapped.document_id
          WHERE d."id"::text = mapped.document_id::text
            AND d."doc_type"::text = 'PACKING_LIST'
            AND d."is_deleted" = FALSE
            AND (d."shipment_id" IS NULL OR d."shipment_id" = $1::uuid)
          RETURNING d."id"
        )
        SELECT COUNT(*)::int AS linked_count FROM updated
        """,
        shipment_id,
    )
    return int(rows[0].get("linked_count") or 0) if rows else 0


async def _link_reviewed_documents_from_validation(prisma: Any, shipment_id: str) -> int:
    rows = await _query_raw(
        prisma,
        """
        WITH validation_docs AS (
          SELECT DISTINCT cvd."document_id" AS document_id
          FROM "document_ocr"."cross_validation_details" cvd
          WHERE cvd."shipment_id"::text = $1::text
            AND cvd."document_id" ~* '^[0-9a-f-]{36}$'
          UNION
          SELECT DISTINCT cvd."target_document_id" AS document_id
          FROM "document_ocr"."cross_validation_details" cvd
          WHERE cvd."shipment_id"::text = $1::text
            AND cvd."target_document_id" ~* '^[0-9a-f-]{36}$'
          UNION
          SELECT DISTINCT vr."document_id" AS document_id
          FROM "document_module"."validation_results" vr
          JOIN "public"."documents" target_doc
            ON target_doc."id"::text = vr."target_document_id"::text
          WHERE target_doc."shipment_id" = $1::uuid
            AND vr."document_id" ~* '^[0-9a-f-]{36}$'
          UNION
          SELECT DISTINCT vr."target_document_id" AS document_id
          FROM "document_module"."validation_results" vr
          JOIN "public"."documents" source_doc
            ON source_doc."id"::text = vr."document_id"::text
          WHERE source_doc."shipment_id" = $1::uuid
            AND vr."target_document_id" ~* '^[0-9a-f-]{36}$'
          UNION
          SELECT DISTINCT cvd."document_id" AS document_id
          FROM "document_ocr"."cross_validation_details" cvd
          JOIN "public"."documents" target_doc
            ON target_doc."id"::text = cvd."target_document_id"::text
          WHERE target_doc."shipment_id" = $1::uuid
            AND cvd."document_id" ~* '^[0-9a-f-]{36}$'
          UNION
          SELECT DISTINCT cvd."target_document_id" AS document_id
          FROM "document_ocr"."cross_validation_details" cvd
          JOIN "public"."documents" source_doc
            ON source_doc."id"::text = cvd."document_id"::text
          WHERE source_doc."shipment_id" = $1::uuid
            AND cvd."target_document_id" ~* '^[0-9a-f-]{36}$'
        ),
        updated AS (
          UPDATE "public"."documents" d
          SET
            "shipment_id" = $1::uuid,
            "document_type" = COALESCE(d."document_type", d."doc_type"::text),
            "ocr_status" = CASE
              WHEN d."status"::text IN ('REVIEWED', 'ARCHIVED') THEN 'completed'
              ELSE COALESCE(d."ocr_status", lower(d."status"::text))
            END,
            "validation_status" = COALESCE(d."validation_status", 'WAITING'),
            "approved_at" = COALESCE(d."approved_at", CASE WHEN d."status"::text IN ('REVIEWED', 'ARCHIVED') THEN NOW() ELSE NULL END),
            "updated_at" = NOW()
          FROM validation_docs vd
          WHERE d."id"::text = vd.document_id::text
            AND d."is_deleted" = FALSE
            AND d."status"::text IN ('REVIEWED', 'ARCHIVED')
            AND (d."shipment_id" IS NULL OR d."shipment_id" = $1::uuid)
          RETURNING d."id"
        )
        SELECT COUNT(*)::int AS linked_count FROM updated
        """,
        shipment_id,
    )
    return int(rows[0].get("linked_count") or 0) if rows else 0


async def link_documents_to_shipment_by_keys(prisma: Any, shipment_id: str) -> int:
    """Attach documents to a shipment using the Sheet3 document link keys.

    This intentionally does not read cross-validation results. A document already
    linked to another shipment is left untouched.
    """
    await ensure_operational_shipment_tables(prisma)
    linked = 0
    normalize_sql = "LOWER(REGEXP_REPLACE(COALESCE({field}, ''), '[^A-Za-z0-9]+', '', 'g'))"
    base_doc_filter = """
        d."is_deleted" = FALSE
        AND (d."shipment_id" IS NULL OR d."shipment_id" = $1::uuid)
    """

    async def link(table: str, doc_types: tuple[str, ...], fields: tuple[str, ...], key_names: tuple[str, ...]) -> int:
        merged_keys = sorted({key for name in key_names for key in keys.get(name, [])})
        if not merged_keys:
            return 0
        field_checks = []
        for field in fields:
            normalized_field = normalize_sql.format(field=f'e."{field}"')
            field_checks.append(
                "EXISTS ("
                "SELECT 1 FROM unnest($2::text[]) AS key(value) "
                f"WHERE {normalized_field} = key.value "
                f"OR (length(key.value) >= 5 AND position(key.value in {normalized_field}) > 0)"
                ")"
            )
        field_checks.append(
            "EXISTS ("
            "SELECT 1 FROM unnest($2::text[]) AS key(value) "
            "WHERE length(key.value) >= 5 "
            "AND position(key.value in LOWER(REGEXP_REPLACE(COALESCE(e.\"raw_data\"::text, ''), '[^A-Za-z0-9]+', '', 'g'))) > 0"
            ")"
        )
        field_checks.append(
            "EXISTS ("
            "SELECT 1 FROM unnest($2::text[]) AS key(value) "
            "WHERE length(key.value) >= 5 "
            "AND ("
            "position(key.value in LOWER(REGEXP_REPLACE(COALESCE(d.\"file_name\", ''), '[^A-Za-z0-9]+', '', 'g'))) > 0 "
            "OR position(key.value in LOWER(REGEXP_REPLACE(COALESCE(d.\"document_number\", ''), '[^A-Za-z0-9]+', '', 'g'))) > 0"
            ")"
            ")"
        )
        doc_type_values = ", ".join(f"'{doc_type}'" for doc_type in doc_types)
        return await _link_by_query(
            prisma,
            shipment_id=shipment_id,
            keys=merged_keys,
            sql=f"""
            WITH matched AS (
              SELECT d."id", e."reviewed_at"
              FROM "public"."documents" d
              JOIN "aiextraction"."{table}" e ON e."document_id" = d."id"
              WHERE {base_doc_filter}
                AND d."doc_type"::text IN ({doc_type_values})
                AND ({" OR ".join(field_checks)})
            ),
            updated AS (
              UPDATE "public"."documents" d
              SET
                "shipment_id" = $1::uuid,
                "document_type" = COALESCE(d."document_type", d."doc_type"::text),
                "ocr_status" = CASE
                  WHEN d."status"::text IN ('REVIEWED', 'ARCHIVED') THEN 'completed'
                  ELSE COALESCE(d."ocr_status", lower(d."status"::text))
                END,
                "validation_status" = COALESCE(d."validation_status", 'WAITING'),
                "approved_at" = COALESCE(
                  d."approved_at",
                  matched."reviewed_at",
                  CASE WHEN d."status"::text IN ('REVIEWED', 'ARCHIVED') THEN NOW() ELSE NULL END
                ),
                "updated_at" = NOW()
              FROM matched
              WHERE d."id" = matched."id"
              RETURNING d."id"
            )
            SELECT COUNT(*)::int AS linked_count FROM updated
            """,
        )

    for _ in range(3):
        keys = _merge_link_keys(
            await _shipment_reference_link_keys(prisma, shipment_id),
            await _shipment_document_link_keys(prisma, shipment_id),
        )
        pass_count = 0
        try:
            pass_count += await _link_reviewed_documents_from_validation(prisma, shipment_id)
        except Exception:
            pass
        pass_count += await _link_packing_lists_from_bol_container_mapping(prisma, shipment_id)
        pass_count += await link("sales_invoice_extractions", ("SALES_INVOICE",), ("invoice_no", "shipping_bill_no"), ("invoice", "shipping_bill"))
        pass_count += await link("packing_list_extractions", ("PACKING_LIST",), ("invoice_no",), ("invoice", "shipping_bill"))
        pass_count += await link("shipping_bill_extractions", ("SHIPPING_BILL",), ("sb_no",), ("shipping_bill",))
        pass_count += await link("entry_summary_extractions", ("ENTRY_SUMMARY", "DRAFT_CBP_FORM_7501_BROKER"), ("bl_or_awb_number", "filer_code_entry_number"), ("bl", "entry"))
        pass_count += await link("isf_extractions", ("ISF",), ("master_bl_number", "house_bl_number", "container_number"), ("bl", "container"))
        pass_count += await link("us_cargo_release_extractions", ("US_CARGO_RELEASE_ORDER",), ("entry_number", "master_bill_of_lading", "house_bill_1_and_2"), ("entry", "bl"))
        pass_count += await link("us_customs_release_extractions", ("US_CUSTOMS_RELEASE_ORDER",), ("entry_number", "bill_of_lading_information", "containers"), ("entry", "bl", "container"))
        pass_count += await link("us_delivery_order_extractions", ("US_DELIVERY_ORDER",), ("entry_number", "bl_or_awb_number", "master_number", "house_bill_numbers", "container_number"), ("entry", "bl", "container"))
        pass_count += await link("grn_inbound_extractions", ("GRN_INBOUND",), ("container_number",), ("container",))
        pass_count += await link("port_to_wh_extractions", ("PORT_TO_WH",), ("shipment_id", "mbl", "container_number", "customer_reference_number"), ("bl", "container", "project"))
        pass_count += await link("wh_to_customer_extractions", ("WH_TO_CUSTOMER",), ("shipment_number", "po_number"), ("packing_slip", "invoice", "project"))
        pass_count += await link("ocean_freight_extractions", ("OCEAN_FREIGHT",), ("ocean_bol", "house_bol", "invoice_number"), ("bl", "invoice"))
        pass_count += await link("freight_forwarder_bill_extractions", ("FREIGHT_FORWARDER_BILL",), ("ocean_bol", "house_bol", "customer_invoice_numbers", "invoice_number", "project_name"), ("bl", "invoice", "project"))
        pass_count += await link("customer_broker_bill_extractions", ("CUSTOMER_BROKER_BILL",), ("ocean_bol", "house_bol", "entry_number", "supplier_invoice_numbers", "invoice_number"), ("bl", "entry", "invoice"))
        pass_count += await link(
            "cha_bill_extractions",
            ("CHA_BILL",),
            (
                "shipment_mbl",
                "shipment_hbl",
                "booking_number",
                "customer_shipment_number",
                "shipment_order_reference",
                "job_doc_number",
                "job_project_name",
                "invoice_number",
            ),
            ("bl", "invoice", "shipping_bill", "project"),
        )
        pass_count += await link("us_packing_list_extractions", ("US_PACKING_LIST",), ("packing_slip_number", "bol_number", "project_name"), ("packing_slip", "bl", "project"))
        pass_count += await link("us_sales_invoice_extractions", ("US_SALES_INVOICE",), ("invoice_no", "so_no", "po_no"), ("packing_slip", "invoice"))
        linked += pass_count
        if pass_count == 0:
            break
    return linked


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
    try:
        await sync_projects_from_shipments(prisma, limit=limit)
    except Exception as exc:
        print(f"[projects] warning: could not sync projects after shipment sync: {exc}", flush=True)
    return synced
