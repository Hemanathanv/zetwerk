from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from typing import Any
from uuid import uuid4


TARIFF_STATUSES = {"Active", "Draft", "Sunsetting", "Expired"}
CHARGE_TYPES = {"Demurrage", "Detention", "Storage"}
PRICING_METHODS = {"flat", "tier", "slab"}
VALID_CARGO = {"FCL", "Breakbulk", "Container", "Break Bulk"}
DEFAULT_CARRIERS = (
    ("MAERSK", "MAEU"),
    ("MSC", "MSCU"),
    ("CMA CGM", "CMDU"),
    ("ONE", "ONEY"),
)
SHIPMENT_INPUT_STATES = {"PENDING_SELECTION", "ACTIVATED", "CARRIER_REVIEW", "NO_MATCHING_TARIFF"}


async def query_raw(prisma, sql: str, *params: Any) -> list[dict[str, Any]]:
    rows = await prisma.query_raw(sql, *params)
    return [dict(row) for row in rows]


async def execute_raw(prisma, sql: str, *params: Any) -> Any:
    return await prisma.execute_raw(sql, *params)


def coerce_json(value: Any, fallback: Any = None) -> Any:
    if value is None:
        return fallback
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                return json.loads(stripped)
            except json.JSONDecodeError:
                return fallback if fallback is not None else value
    return value


def iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


async def ensure_dnd_tables(prisma) -> None:
    await execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS public.dnd_tariffs (
          id TEXT PRIMARY KEY,
          carrier TEXT NOT NULL,
          scac TEXT,
          lane TEXT,
          cargo TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'Draft',
          version INTEGER NOT NULL DEFAULT 1,
          lane_pairs JSONB NOT NULL DEFAULT '[]'::jsonb,
          charge_types JSONB NOT NULL DEFAULT '[]'::jsonb,
          pricing_methods JSONB NOT NULL DEFAULT '{}'::jsonb,
          free_time JSONB NOT NULL DEFAULT '[]'::jsonb,
          exclusion_default JSONB NOT NULL DEFAULT '{}'::jsonb,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          effective_from DATE,
          effective_to DATE,
          linked_shipments INTEGER NOT NULL DEFAULT 0,
          created_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    await execute_raw(
        prisma,
        "ALTER TABLE public.dnd_tariffs ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb",
    )
    await execute_raw(
        prisma,
        """
        CREATE INDEX IF NOT EXISTS idx_dnd_tariffs_match
        ON public.dnd_tariffs (carrier, cargo, status)
        """,
    )
    await execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS public.dnd_activity_audit (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          description TEXT NOT NULL,
          entity_type TEXT,
          entity_id TEXT,
          user_id TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    await execute_raw(
        prisma,
        """
        CREATE INDEX IF NOT EXISTS idx_dnd_activity_audit_created
        ON public.dnd_activity_audit (created_at DESC)
        """,
    )
    await execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS public.dnd_holiday_calendar (
          id TEXT PRIMARY KEY,
          port_code TEXT NOT NULL,
          holiday_date DATE NOT NULL,
          holiday_name TEXT NOT NULL,
          year INTEGER NOT NULL,
          holiday_type TEXT,
          created_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (port_code, year, holiday_date)
        )
        """,
    )
    await execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS public.dnd_carrier_master (
          id TEXT PRIMARY KEY,
          carrier_name TEXT NOT NULL,
          scac TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (carrier_name, scac)
        )
        """,
    )
    await execute_raw(
        prisma,
        """
        CREATE INDEX IF NOT EXISTS idx_dnd_carrier_master_name
        ON public.dnd_carrier_master (carrier_name, is_active)
        """,
    )
    await execute_raw(
        prisma,
        """
        CREATE TABLE IF NOT EXISTS public.dnd_shipment_inputs (
          shipment_id TEXT PRIMARY KEY,
          carrier_name TEXT,
          scac TEXT,
          start_event TEXT,
          free_days TEXT,
          pricing_method TEXT,
          start_date DATE,
          end_date DATE,
          exclude_weekends BOOLEAN NOT NULL DEFAULT TRUE,
          exclude_holidays BOOLEAN NOT NULL DEFAULT TRUE,
          carrier_state TEXT NOT NULL DEFAULT 'matched',
          dnd_status TEXT NOT NULL DEFAULT 'PENDING_SELECTION',
          matched_tariff_id TEXT,
          chargeable_days INTEGER,
          last_free_day DATE,
          estimated_charge NUMERIC,
          currency TEXT,
          basis TEXT,
          saved_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """,
    )
    for column_sql in (
        "ALTER TABLE public.dnd_shipment_inputs ADD COLUMN IF NOT EXISTS dnd_status TEXT NOT NULL DEFAULT 'PENDING_SELECTION'",
        "ALTER TABLE public.dnd_shipment_inputs ADD COLUMN IF NOT EXISTS matched_tariff_id TEXT",
        "ALTER TABLE public.dnd_shipment_inputs ADD COLUMN IF NOT EXISTS chargeable_days INTEGER",
        "ALTER TABLE public.dnd_shipment_inputs ADD COLUMN IF NOT EXISTS last_free_day DATE",
        "ALTER TABLE public.dnd_shipment_inputs ADD COLUMN IF NOT EXISTS estimated_charge NUMERIC",
        "ALTER TABLE public.dnd_shipment_inputs ADD COLUMN IF NOT EXISTS currency TEXT",
        "ALTER TABLE public.dnd_shipment_inputs ADD COLUMN IF NOT EXISTS basis TEXT",
    ):
        await execute_raw(prisma, column_sql)
    for carrier_name, scac in DEFAULT_CARRIERS:
        await execute_raw(
            prisma,
            """
            INSERT INTO public.dnd_carrier_master (
              id, carrier_name, scac, is_active, created_at, updated_at
            )
            VALUES ($1, $2, $3, TRUE, NOW(), NOW())
            ON CONFLICT (carrier_name, scac) DO NOTHING
            """,
            str(uuid4()),
            carrier_name,
            scac,
        )


async def record_audit(
    prisma,
    *,
    action: str,
    description: str,
    entity_type: str | None = None,
    entity_id: str | None = None,
    user_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    await execute_raw(
        prisma,
        """
        INSERT INTO public.dnd_activity_audit (
          id, action, description, entity_type, entity_id, user_id, metadata, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
        """,
        str(uuid4()),
        action,
        description,
        entity_type,
        entity_id,
        user_id,
        json.dumps(metadata or {}),
    )


async def list_activity_audit(prisma, limit: int = 50) -> list[dict[str, Any]]:
    await ensure_dnd_tables(prisma)
    rows = await query_raw(
        prisma,
        """
        SELECT *
        FROM public.dnd_activity_audit
        ORDER BY created_at DESC
        LIMIT $1
        """,
        limit,
    )
    return [
        {
            "id": row.get("id"),
            "action": row.get("action"),
            "description": row.get("description"),
            "entityType": row.get("entity_type"),
            "entityId": row.get("entity_id"),
            "userName": row.get("user_id") or "system",
            "createdAt": iso(row.get("created_at")),
            "metadata": coerce_json(row.get("metadata"), {}),
        }
        for row in rows
    ]


def normalize_tariff_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "carrier": row.get("carrier"),
        "scac": row.get("scac"),
        "lane": row.get("lane"),
        "cargo": row.get("cargo"),
        "status": row.get("status"),
        "version": row.get("version"),
        "lanePairs": coerce_json(row.get("lane_pairs"), []),
        "chargeTypes": coerce_json(row.get("charge_types"), []),
        "pricingMethods": coerce_json(row.get("pricing_methods"), {}),
        "freeTime": coerce_json(row.get("free_time"), []),
        "exclusionDefault": coerce_json(row.get("exclusion_default"), {}),
        "metadata": coerce_json(row.get("metadata"), {}),
        "effFrom": iso(row.get("effective_from")),
        "effTo": iso(row.get("effective_to")),
        "linkedShipments": row.get("linked_shipments") or 0,
        "createdAt": iso(row.get("created_at")),
        "updatedAt": iso(row.get("updated_at")),
    }


def normalize_holiday_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "port": row.get("port_code"),
        "date": iso(row.get("holiday_date")),
        "name": row.get("holiday_name"),
        "year": row.get("year"),
        "type": row.get("holiday_type"),
        "createdAt": iso(row.get("created_at")),
        "updatedAt": iso(row.get("updated_at")),
    }


def normalize_carrier_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "carrierName": row.get("carrier_name"),
        "scac": row.get("scac"),
        "isActive": bool(row.get("is_active")),
        "createdAt": iso(row.get("created_at")),
        "updatedAt": iso(row.get("updated_at")),
    }


DND_APPROACHING_LFD_DAYS = 3
DND_STATUS_MEANINGS = {
    "In Free Time": "Shipment is currently under D&D monitoring within free time.",
    "Approaching LFD": "Shipment is nearing the Last Free Day based on the configured threshold.",
    "Charges Accruing": "Shipment has exceeded the LFD and D&D charges are being incurred.",
    "Completed": "Container has been picked up or returned and D&D calculation is complete.",
    "Inactive": "D&D tracking is not applicable or has been disabled.",
}


def dnd_management_status(row: dict[str, Any]) -> str:
    raw_status = str(row.get("dnd_status") or "").upper()
    if raw_status and raw_status != "ACTIVATED":
        return "Inactive"
    if row.get("end_date"):
        return "Completed"
    lfd = parse_iso_date(row.get("last_free_day"))
    if lfd:
        today = datetime.now(timezone.utc).date()
        diff = (lfd - today).days
        if diff < 0:
            return "Charges Accruing"
        if diff <= DND_APPROACHING_LFD_DAYS:
            return "Approaching LFD"
    return "In Free Time"


def normalize_shipment_inputs_row(row: dict[str, Any]) -> dict[str, Any]:
    management_status = dnd_management_status(row)
    return {
        "shipmentId": row.get("shipment_id"),
        "carrierName": row.get("carrier_name"),
        "scac": row.get("scac"),
        "startEvent": row.get("start_event") or "",
        "freeDays": row.get("free_days") or "",
        "pricingMethod": row.get("pricing_method") or "",
        "startDate": iso(row.get("start_date")) or "",
        "endDate": iso(row.get("end_date")) or "",
        "excludeWeekends": bool(row.get("exclude_weekends")),
        "excludeHolidays": bool(row.get("exclude_holidays")),
        "carrierState": row.get("carrier_state") or "matched",
        "dndStatus": row.get("dnd_status") or "PENDING_SELECTION",
        "matchedTariffId": row.get("matched_tariff_id"),
        "chargeableDays": row.get("chargeable_days"),
        "lastFreeDay": iso(row.get("last_free_day")),
        "managementStatus": management_status,
        "managementStatusMeaning": DND_STATUS_MEANINGS[management_status],
        "estimatedCharge": float(row["estimated_charge"]) if row.get("estimated_charge") is not None else None,
        "currency": row.get("currency"),
        "basis": row.get("basis"),
        "savedBy": row.get("saved_by"),
        "createdAt": iso(row.get("created_at")),
        "updatedAt": iso(row.get("updated_at")),
    }


def normalize_charge_types(values: list[str]) -> list[str]:
    return [value for value in values if value in CHARGE_TYPES]


def parse_iso_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    try:
        return date.fromisoformat(str(value)[:10])
    except Exception:
        return None


def free_days_int(value: Any) -> int:
    match = re.search(r"\d+", str(value or ""))
    return int(match.group(0)) if match else 0


def charge_basis_label(*, exclude_weekends: bool, exclude_holidays: bool) -> str:
    if exclude_weekends and exclude_holidays:
        return "Working Days (weekends & holidays excluded)"
    if exclude_weekends:
        return "Working Days (weekends excluded)"
    if exclude_holidays:
        return "Calendar Days (holidays excluded)"
    return "Calendar Days"


def is_usa_scope(payload: dict[str, Any]) -> bool:
    lane = str(payload.get("lane") or "")
    pairs = payload.get("lanePairs") or []
    pair_scope = " ".join(
        f"{pair.get('origin', '')} {pair.get('dest', '')}"
        for pair in pairs
        if isinstance(pair, dict)
    )
    return bool(re.search(r"USLAX|USNYC|USA|US[A-Z]{3}", f"{lane} {pair_scope}", re.IGNORECASE))


def enabled_pricing_methods(payload: dict[str, Any]) -> list[str]:
    pricing_methods = payload.get("pricingMethods") or {}
    if isinstance(pricing_methods, list):
        return [method for method in pricing_methods if method in PRICING_METHODS]
    if isinstance(pricing_methods, dict):
        return [
            key
            for key, value in pricing_methods.items()
            if key in PRICING_METHODS and value and (not isinstance(value, dict) or value.get("enabled", True))
        ]
    return []


def validate_free_time(payload: dict[str, Any]) -> None:
    groups = payload.get("freeTime") or []
    if not isinstance(groups, list) or not groups:
        raise ValueError("At least one free-time start event is required")
    seen_events: set[str] = set()
    for group in groups:
        event = str(group.get("event") or "").strip() if isinstance(group, dict) else ""
        days = group.get("days") if isinstance(group, dict) else []
        if not event:
            raise ValueError("Free-time start event is required")
        if event in seen_events:
            raise ValueError("Duplicate free-time start events are not allowed")
        seen_events.add(event)
        if not isinstance(days, list) or not days:
            raise ValueError(f"At least one free-day value is required for {event}")
        normalized_days = [int(day) for day in days if isinstance(day, (int, float)) or str(day).isdigit()]
        if len(normalized_days) != len(days) or len(normalized_days) != len(set(normalized_days)) or any(day < 1 for day in normalized_days):
            raise ValueError(f"Free-day values for {event} must be positive and unique")


def validate_pricing_methods(payload: dict[str, Any]) -> list[str]:
    pricing_methods = payload.get("pricingMethods") or {}
    enabled = enabled_pricing_methods(payload)
    if not enabled:
        raise ValueError("At least one pricing method is required")
    warnings: list[str] = []
    if isinstance(pricing_methods, list):
        return warnings
    if not isinstance(pricing_methods, dict):
        raise ValueError("Pricing methods must be an object or list")

    flat = pricing_methods.get("flat") or {}
    if "flat" in enabled and float(flat.get("rate") or 0) < 0:
        raise ValueError("Flat daily rate cannot be negative")

    tier = pricing_methods.get("tier") or {}
    if "tier" in enabled:
        if float(tier.get("rate") or 0) < 0:
            raise ValueError("Tier daily rate cannot be negative")
        if int(float(tier.get("threshold") or 0)) < 1:
            raise ValueError("Tier threshold must be at least 1 day")
        if float(tier.get("mult") or 0) <= 0:
            raise ValueError("Tier multiplier must be greater than 0")

    slab = pricing_methods.get("slab") or {}
    if "slab" in enabled:
        rows = slab.get("rows") or []
        if not isinstance(rows, list) or not rows:
            raise ValueError("At least one slab row is required")
        sorted_rows = sorted(rows, key=lambda item: int(float(item.get("from") or 0)))
        for index, row in enumerate(sorted_rows, start=1):
            from_day = int(float(row.get("from") or 0))
            to_day = int(float(row.get("to") or 0))
            rate = float(row.get("rate") or 0)
            if from_day < 1 or to_day < from_day:
                raise ValueError(f"Invalid day range in slab row {index}")
            if rate < 0:
                raise ValueError(f"Slab row {index} rate cannot be negative")
        for index in range(len(sorted_rows) - 1):
            current_to = int(float(sorted_rows[index].get("to") or 0))
            next_from = int(float(sorted_rows[index + 1].get("from") or 0))
            if current_to >= next_from:
                raise ValueError(f"Slab overlap: row {index + 1} To {current_to} meets row {index + 2} From {next_from}")
            if next_from - current_to > 1:
                warnings.append(f"Slab gap: uncovered range between day {current_to} and {next_from}")
    return warnings


def validate_tariff_payload(payload: dict[str, Any]) -> None:
    if not str(payload.get("carrier") or "").strip():
        raise ValueError("Carrier is required")
    if payload.get("cargo") not in VALID_CARGO:
        raise ValueError("Cargo must be FCL or Breakbulk")
    lane_pairs = payload.get("lanePairs") or []
    if not isinstance(lane_pairs, list) or not lane_pairs:
        raise ValueError("At least one lane pair is required")
    for pair in lane_pairs:
        if not isinstance(pair, dict) or not str(pair.get("origin") or "").strip() or not str(pair.get("dest") or "").strip():
            raise ValueError("Each lane pair requires origin and destination")
    charge_types = normalize_charge_types(payload.get("chargeTypes") or [])
    if not charge_types:
        raise ValueError("At least one valid charge type is required")
    validate_free_time(payload)
    validate_pricing_methods(payload)


async def list_tariffs(prisma) -> list[dict[str, Any]]:
    await ensure_dnd_tables(prisma)
    await refresh_tariff_lifecycle(prisma)
    rows = await query_raw(
        prisma,
        """
        SELECT *
        FROM public.dnd_tariffs
        ORDER BY updated_at DESC, created_at DESC
        """,
    )
    return [normalize_tariff_row(row) for row in rows]


async def refresh_tariff_lifecycle(prisma) -> None:
    await execute_raw(
        prisma,
        """
        UPDATE public.dnd_tariffs
        SET status = CASE
              WHEN linked_shipments > 0 THEN 'Sunsetting'
              ELSE 'Expired'
            END,
            updated_at = NOW()
        WHERE status = 'Active'
          AND effective_to IS NOT NULL
          AND effective_to < CURRENT_DATE
        """,
    )
    await execute_raw(
        prisma,
        """
        UPDATE public.dnd_tariffs
        SET status = 'Expired', updated_at = NOW()
        WHERE status = 'Sunsetting'
          AND linked_shipments <= 0
        """,
    )


async def force_expire_tariff(prisma, tariff_id: str, user_id: str | None = None) -> dict[str, Any]:
    await ensure_dnd_tables(prisma)
    await execute_raw(
        prisma,
        """
        UPDATE public.dnd_tariffs
        SET status = 'Expired',
            metadata = metadata || $2::jsonb,
            updated_at = NOW()
        WHERE id = $1
        """,
        tariff_id,
        json.dumps({"forceExpiredBy": user_id, "forceExpiredAt": datetime.utcnow().isoformat()}),
    )
    rows = await query_raw(prisma, "SELECT * FROM public.dnd_tariffs WHERE id = $1 LIMIT 1", tariff_id)
    if not rows:
        raise ValueError("Tariff not found")
    tariff = normalize_tariff_row(rows[0])
    await record_audit(
        prisma,
        action="force_expire",
        description=f"Force expired D&D tariff {tariff['id']} v{tariff['version']}",
        entity_type="tariff",
        entity_id=tariff["id"],
        user_id=user_id,
        metadata={"status": tariff.get("status"), "carrier": tariff.get("carrier")},
    )
    return tariff


async def list_active_charges(prisma) -> list[dict[str, Any]]:
    await ensure_dnd_tables(prisma)
    rows = await query_raw(
        prisma,
        """
        SELECT *
        FROM public.dnd_shipment_inputs
        WHERE dnd_status = 'ACTIVATED'
        ORDER BY updated_at DESC
        """,
    )
    return [normalize_shipment_inputs_row(row) for row in rows]


async def list_alerts(prisma) -> dict[str, list[dict[str, Any]]]:
    await ensure_dnd_tables(prisma)
    rows = await query_raw(
        prisma,
        """
        SELECT *
        FROM public.dnd_shipment_inputs
        WHERE dnd_status IN ('CARRIER_REVIEW', 'NO_MATCHING_TARIFF')
        ORDER BY updated_at DESC
        """,
    )
    notifications = []
    for row in rows:
        item = normalize_shipment_inputs_row(row)
        is_carrier_review = item["dndStatus"] == "CARRIER_REVIEW"
        notifications.append({
            "id": f"dnd-{item['shipmentId']}",
            "type": "escalation" if is_carrier_review else "warning",
            "title": "Carrier review required" if is_carrier_review else "No matching D&D tariff",
            "message": (
                "Carrier could not be matched from BOL."
                if is_carrier_review
                else "No Published D&D tariff matches Carrier + Lane + Cargo + Charge."
            ),
            "shipmentId": item["shipmentId"],
            "createdAt": item["updatedAt"],
        })
    return {"notifications": notifications, "audits": []}


async def list_carriers(prisma) -> list[dict[str, Any]]:
    await ensure_dnd_tables(prisma)
    rows = await query_raw(
        prisma,
        """
        SELECT *
        FROM public.dnd_carrier_master
        WHERE is_active = TRUE
        ORDER BY carrier_name ASC, scac ASC
        """,
    )
    return [normalize_carrier_row(row) for row in rows]


async def create_carrier(prisma, payload: dict[str, Any], user_id: str | None = None) -> dict[str, Any]:
    await ensure_dnd_tables(prisma)
    carrier_name = str(payload.get("carrierName") or payload.get("carrier") or "").strip().upper()
    scac = str(payload.get("scac") or "").strip().upper()
    if not carrier_name:
        raise ValueError("Carrier name is required")
    if not scac:
        raise ValueError("SCAC code is required")
    if not re.fullmatch(r"[A-Z0-9]{2,6}", scac):
        raise ValueError("SCAC code must be 2-6 letters or numbers")
    carrier_id = str(uuid4())
    await execute_raw(
        prisma,
        """
        INSERT INTO public.dnd_carrier_master (
          id, carrier_name, scac, is_active, created_by, created_at, updated_at
        )
        VALUES ($1, $2, $3, TRUE, $4, NOW(), NOW())
        ON CONFLICT (carrier_name, scac) DO UPDATE SET
          is_active = TRUE,
          updated_at = NOW()
        """,
        carrier_id,
        carrier_name,
        scac,
        user_id,
    )
    rows = await query_raw(
        prisma,
        """
        SELECT *
        FROM public.dnd_carrier_master
        WHERE carrier_name = $1 AND scac = $2
        LIMIT 1
        """,
        carrier_name,
        scac,
    )
    carrier = normalize_carrier_row(rows[0])
    await record_audit(
        prisma,
        action="carrier_master_upsert",
        description=f"Saved D&D carrier mapping {carrier['carrierName']} / {carrier['scac']}",
        entity_type="carrier",
        entity_id=carrier["id"],
        user_id=user_id,
    )
    return carrier


async def get_shipment_inputs(prisma, shipment_id: str) -> dict[str, Any] | None:
    await ensure_dnd_tables(prisma)
    rows = await query_raw(
        prisma,
        """
        SELECT *
        FROM public.dnd_shipment_inputs
        WHERE shipment_id = $1
        LIMIT 1
        """,
        shipment_id,
    )
    return normalize_shipment_inputs_row(rows[0]) if rows else None


async def match_tariff(
    prisma,
    *,
    carrier: str,
    origin: str | None,
    destination: str | None,
    cargo: str,
    charge_types: list[str] | None = None,
) -> dict[str, Any] | None:
    await ensure_dnd_tables(prisma)
    await refresh_tariff_lifecycle(prisma)
    normalized_charge_types = normalize_charge_types(charge_types or ["Demurrage", "Detention"])
    rows = await query_raw(
        prisma,
        """
        SELECT *
        FROM public.dnd_tariffs
        WHERE status = 'Active'
          AND upper(carrier) = upper($1)
          AND cargo = $2
          AND (
            $3::text IS NULL OR $4::text IS NULL OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(lane_pairs) pair
              WHERE upper(pair->>'origin') = upper($3)
                AND upper(pair->>'dest') = upper($4)
            )
          )
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(charge_types) charge
            WHERE charge = ANY($5::text[])
          )
        ORDER BY version DESC, updated_at DESC
        LIMIT 1
        """,
        str(carrier or "").strip().upper(),
        cargo,
        str(origin).strip().upper() if origin else None,
        str(destination).strip().upper() if destination else None,
        normalized_charge_types,
    )
    return normalize_tariff_row(rows[0]) if rows else None


def tariff_options(tariff: dict[str, Any] | None) -> dict[str, Any]:
    if not tariff:
        return {
            "events": [],
            "freeDaysByEvent": {},
            "pricingMethods": [],
            "exclusionDefault": {"weekends": True, "holidays": False},
            "chargeTypes": [],
        }
    free_time = tariff.get("freeTime") or []
    pricing_methods = tariff.get("pricingMethods") or {}
    return {
        "events": [group.get("event") for group in free_time if isinstance(group, dict) and group.get("event")],
        "freeDaysByEvent": {
            str(group.get("event")): [f"{day} Free Days" for day in group.get("days", [])]
            for group in free_time
            if isinstance(group, dict) and group.get("event")
        },
        "pricingMethods": enabled_pricing_methods({"pricingMethods": pricing_methods}),
        "exclusionDefault": tariff.get("exclusionDefault") or {"weekends": True, "holidays": False},
        "chargeTypes": tariff.get("chargeTypes") or [],
    }


async def get_holiday_dates(prisma, port_code: str | None, start: date, end: date) -> set[date]:
    if not port_code:
        return set()
    rows = await query_raw(
        prisma,
        """
        SELECT holiday_date
        FROM public.dnd_holiday_calendar
        WHERE port_code = $1
          AND holiday_date BETWEEN $2::date AND $3::date
        """,
        str(port_code).strip().upper(),
        start.isoformat(),
        end.isoformat(),
    )
    return {parsed for row in rows if (parsed := parse_iso_date(row.get("holiday_date")))}


def count_chargeable_days(start_date: date, end_date: date, *, exclude_weekends: bool, holiday_dates: set[date]) -> int:
    if end_date < start_date:
        return 0
    current = start_date
    count = 0
    while current <= end_date:
        if exclude_weekends and current.weekday() >= 5:
            current += timedelta(days=1)
            continue
        if current in holiday_dates:
            current += timedelta(days=1)
            continue
        count += 1
        current += timedelta(days=1)
    return count


def calculate_pricing(tariff: dict[str, Any], method: str, chargeable_days: int) -> dict[str, Any]:
    pricing_methods = tariff.get("pricingMethods") or {}
    config = pricing_methods.get(method) if isinstance(pricing_methods, dict) else None
    if not isinstance(config, dict) or config.get("enabled") is False:
        raise ValueError("Selected pricing method is not enabled on the matched tariff")
    currency = str(config.get("currency") or "USD")
    if method == "flat":
        return {"amount": chargeable_days * float(config.get("rate") or 0), "currency": currency}
    if method == "tier":
        rate = float(config.get("rate") or 0)
        threshold = int(float(config.get("threshold") or 0))
        multiplier = float(config.get("mult") or 0)
        base_days = min(chargeable_days, threshold)
        tier_days = max(chargeable_days - threshold, 0)
        return {"amount": base_days * rate + tier_days * rate * multiplier, "currency": currency}
    if method == "slab":
        rows = sorted((config.get("rows") or []), key=lambda item: int(float(item.get("from") or 0)))
        amount = 0.0
        for day in range(1, chargeable_days + 1):
            row = next(
                (
                    item for item in rows
                    if int(float(item.get("from") or 0)) <= day <= int(float(item.get("to") or 0))
                ),
                rows[-1] if rows else None,
            )
            amount += float(row.get("rate") or 0) if row else 0
        return {"amount": amount, "currency": currency}
    raise ValueError("Unsupported pricing method")


async def save_shipment_inputs(
    prisma,
    shipment_id: str,
    payload: dict[str, Any],
    user_id: str | None = None,
) -> dict[str, Any]:
    await ensure_dnd_tables(prisma)
    carrier_name = str(payload.get("carrierName") or "").strip().upper()
    origin = payload.get("origin")
    destination = payload.get("destination")
    cargo = str(payload.get("cargo") or "FCL")
    tariff = None
    if payload.get("matchedTariffId"):
        rows = await query_raw(prisma, "SELECT * FROM public.dnd_tariffs WHERE id = $1 LIMIT 1", str(payload.get("matchedTariffId")))
        tariff = normalize_tariff_row(rows[0]) if rows else None
    elif carrier_name:
        tariff = await match_tariff(
            prisma,
            carrier=carrier_name,
            origin=str(origin).strip().upper() if origin else None,
            destination=str(destination).strip().upper() if destination else None,
            cargo=cargo,
            charge_types=payload.get("chargeTypes") or None,
        )

    options = tariff_options(tariff)
    start_event = str(payload.get("startEvent") or "").strip()
    free_days = str(payload.get("freeDays") or "").strip()
    pricing_method = str(payload.get("pricingMethod") or "").strip()
    carrier_state = str(payload.get("carrierState") or "matched").strip() or "matched"
    if carrier_state == "unrecognized":
        dnd_status = "CARRIER_REVIEW"
    elif carrier_name and not tariff:
        dnd_status = "NO_MATCHING_TARIFF"
        carrier_state = "no-tariff"
    elif start_event and free_days and pricing_method:
        dnd_status = "ACTIVATED"
    else:
        dnd_status = "PENDING_SELECTION"

    if tariff:
        if start_event and start_event not in options["events"]:
            raise ValueError("Start Event must be selected from the matched tariff")
        if free_days and free_days not in options["freeDaysByEvent"].get(start_event, []):
            raise ValueError("Free Days must be selected from the matched tariff event")
        if pricing_method and pricing_method not in options["pricingMethods"]:
            raise ValueError("Pricing Method must be enabled on the matched tariff")

    start_date = parse_iso_date(payload.get("startDate"))
    end_date = parse_iso_date(payload.get("endDate"))
    exclude_weekends = bool(payload.get("excludeWeekends", True))
    exclude_holidays = bool(payload.get("excludeHolidays", True))
    holidays: set[date] = set()
    if start_date and exclude_holidays:
        horizon = end_date or (start_date + timedelta(days=max(free_days_int(free_days), 30) + 30))
        holidays = await get_holiday_dates(prisma, str(destination).strip().upper() if destination else None, start_date, horizon)
    last_free_day = (
        calculate_lfd(start_date, free_days_int(free_days), exclude_weekends=exclude_weekends, holiday_dates=holidays)
        if start_date and free_days_int(free_days) > 0
        else None
    )
    total_days = (
        count_chargeable_days(start_date, end_date, exclude_weekends=exclude_weekends, holiday_dates=holidays)
        if start_date and end_date
        else None
    )
    chargeable_days = max((total_days or 0) - free_days_int(free_days), 0) if total_days is not None else None
    estimated_charge = None
    currency = None
    if tariff and pricing_method and chargeable_days is not None:
        pricing = calculate_pricing(tariff, pricing_method, chargeable_days)
        estimated_charge = pricing["amount"]
        currency = pricing["currency"]

    await execute_raw(
        prisma,
        """
        INSERT INTO public.dnd_shipment_inputs (
          shipment_id, carrier_name, scac, start_event, free_days, pricing_method,
          start_date, end_date, exclude_weekends, exclude_holidays, carrier_state,
          dnd_status, matched_tariff_id, chargeable_days, last_free_day,
          estimated_charge, currency, basis, saved_by, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11,
          $12, $13, $14, $15::date, $16, $17, $18, $19, NOW(), NOW()
        )
        ON CONFLICT (shipment_id) DO UPDATE SET
          carrier_name = EXCLUDED.carrier_name,
          scac = EXCLUDED.scac,
          start_event = EXCLUDED.start_event,
          free_days = EXCLUDED.free_days,
          pricing_method = EXCLUDED.pricing_method,
          start_date = EXCLUDED.start_date,
          end_date = EXCLUDED.end_date,
          exclude_weekends = EXCLUDED.exclude_weekends,
          exclude_holidays = EXCLUDED.exclude_holidays,
          carrier_state = EXCLUDED.carrier_state,
          dnd_status = EXCLUDED.dnd_status,
          matched_tariff_id = EXCLUDED.matched_tariff_id,
          chargeable_days = EXCLUDED.chargeable_days,
          last_free_day = EXCLUDED.last_free_day,
          estimated_charge = EXCLUDED.estimated_charge,
          currency = EXCLUDED.currency,
          basis = EXCLUDED.basis,
          saved_by = EXCLUDED.saved_by,
          updated_at = NOW()
        """,
        shipment_id,
        carrier_name or None,
        str(payload.get("scac") or "").strip().upper() or None,
        start_event or None,
        free_days or None,
        pricing_method or None,
        start_date.isoformat() if start_date else None,
        end_date.isoformat() if end_date else None,
        exclude_weekends,
        exclude_holidays,
        carrier_state,
        dnd_status,
        tariff.get("id") if tariff else None,
        chargeable_days,
        last_free_day.isoformat() if last_free_day else None,
        estimated_charge,
        currency,
        charge_basis_label(exclude_weekends=exclude_weekends, exclude_holidays=exclude_holidays),
        user_id,
    )
    saved = await get_shipment_inputs(prisma, shipment_id)
    await record_audit(
        prisma,
        action="save_inputs",
        description=f"Saved D&D inputs for shipment {shipment_id}",
        entity_type="shipment_inputs",
        entity_id=shipment_id,
        user_id=user_id,
        metadata={"dndStatus": dnd_status, "matchedTariffId": tariff.get("id") if tariff else None},
    )
    return saved or {}


async def find_overlapping_active_tariff(prisma, payload: dict[str, Any]) -> dict[str, Any] | None:
    carrier = str(payload.get("carrier") or "").strip().upper()
    cargo = str(payload.get("cargo") or "").strip()
    lane_pairs = payload.get("lanePairs") or []
    charge_types = normalize_charge_types(payload.get("chargeTypes") or [])
    rows = await query_raw(
        prisma,
        """
        SELECT *
        FROM public.dnd_tariffs
        WHERE status = 'Active'
          AND upper(carrier) = $1
          AND cargo = $2
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(lane_pairs) pair
            WHERE EXISTS (
              SELECT 1
              FROM jsonb_to_recordset($3::jsonb) AS incoming(origin text, dest text)
              WHERE upper(pair->>'origin') = upper(incoming.origin)
                AND upper(pair->>'dest') = upper(incoming.dest)
            )
          )
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(charge_types) charge
            WHERE charge = ANY($4::text[])
          )
        ORDER BY version DESC, updated_at DESC
        LIMIT 1
        """,
        carrier,
        cargo,
        json.dumps(lane_pairs),
        charge_types,
    )
    return rows[0] if rows else None


async def publish_tariff(prisma, payload: dict[str, Any], user_id: str | None = None) -> dict[str, Any]:
    await ensure_dnd_tables(prisma)
    validate_tariff_payload(payload)
    pricing_warnings = validate_pricing_methods(payload)
    requested_status = "Draft" if str(payload.get("status") or "").lower() == "draft" else "Active"
    exclusion_default = payload.get("exclusionDefault") or {}
    if isinstance(exclusion_default, dict) and not is_usa_scope(payload):
        exclusion_default = {**exclusion_default, "holidays": False}
    metadata = {
        "status": payload.get("status"),
        "description": payload.get("description"),
        "originCountry": payload.get("originCountry"),
        "containerType": payload.get("containerType"),
        "weightConfig": payload.get("weightConfig"),
        "pricingWarnings": pricing_warnings,
    }
    overlapping = await find_overlapping_active_tariff(prisma, payload) if requested_status == "Active" else None
    version = int(overlapping.get("version") or 1) + 1 if overlapping else 1
    tariff_id = payload.get("id") or f"T-{datetime.utcnow().strftime('%y%m%d')}-{str(uuid4())[:8].upper()}"
    if overlapping:
        await execute_raw(
            prisma,
            """
            UPDATE public.dnd_tariffs
            SET status = 'Sunsetting', updated_at = NOW()
            WHERE id = $1
            """,
            str(overlapping["id"]),
        )
        await record_audit(
            prisma,
            action="sunset_version",
            description=f"Moved D&D tariff {overlapping['id']} to Sunsetting during version fork",
            entity_type="tariff",
            entity_id=str(overlapping["id"]),
            user_id=user_id,
            metadata={"newTariffId": tariff_id},
        )
    await execute_raw(
        prisma,
        """
        INSERT INTO public.dnd_tariffs (
          id, carrier, scac, lane, cargo, status, version, lane_pairs, charge_types,
          pricing_methods, free_time, exclusion_default, metadata, effective_from, effective_to,
          linked_shipments, created_by, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
          $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::date, $15::date,
          0, $16, NOW(), NOW()
        )
        """,
        tariff_id,
        str(payload.get("carrier") or "").strip().upper(),
        str(payload.get("scac") or "").strip().upper() or None,
        payload.get("lane"),
        payload.get("cargo"),
        requested_status,
        version,
        json.dumps(payload.get("lanePairs") or []),
        json.dumps(normalize_charge_types(payload.get("chargeTypes") or [])),
        json.dumps(payload.get("pricingMethods") or {}),
        json.dumps(payload.get("freeTime") or []),
        json.dumps(exclusion_default),
        json.dumps(metadata),
        payload.get("effFrom"),
        payload.get("effTo"),
        user_id,
    )
    rows = await query_raw(prisma, "SELECT * FROM public.dnd_tariffs WHERE id = $1 LIMIT 1", tariff_id)
    result = normalize_tariff_row(rows[0])
    result["sunsetTariffId"] = str(overlapping["id"]) if overlapping else None
    result["pricingWarnings"] = pricing_warnings
    await record_audit(
        prisma,
        action="save_draft" if requested_status == "Draft" else "publish",
        description=f"{'Saved draft' if requested_status == 'Draft' else 'Published'} D&D tariff {result['id']} v{result['version']}",
        entity_type="tariff",
        entity_id=result["id"],
        user_id=user_id,
        metadata={"carrier": result.get("carrier"), "status": result.get("status")},
    )
    return result


def is_usa_port(port_code: str) -> bool:
    return str(port_code or "").upper().startswith("US")


async def upload_holidays(prisma, rows: list[dict[str, Any]], user_id: str | None = None) -> dict[str, Any]:
    await ensure_dnd_tables(prisma)
    report: list[dict[str, Any]] = []
    seen: set[tuple[str, int, str]] = set()
    accepted = 0
    rejected = 0
    for index, row in enumerate(rows, start=1):
        port = str(row.get("port") or row.get("portCode") or row.get("port_code") or "").strip().upper()
        raw_date = str(row.get("date") or row.get("holidayDate") or row.get("holiday_date") or "").strip()
        name = str(row.get("name") or row.get("holidayName") or row.get("holiday_name") or "").strip()
        holiday_type = str(row.get("type") or row.get("holidayType") or row.get("holiday_type") or "").strip() or None
        reason = ""
        parsed_date: date | None = None
        try:
            parsed_date = date.fromisoformat(raw_date)
        except Exception:
            reason = "Invalid holiday date"
        year = parsed_date.year if parsed_date else None
        key = (port, year or 0, raw_date)
        if not reason and not is_usa_port(port):
            reason = "Port country is not USA"
        if not reason and not name:
            reason = "Holiday name is required"
        if not reason and key in seen:
            reason = "Duplicate in upload for Port + Year + Date"
        if not reason:
            existing = await query_raw(
                prisma,
                """
                SELECT id
                FROM public.dnd_holiday_calendar
                WHERE port_code = $1 AND year = $2 AND holiday_date = $3::date
                LIMIT 1
                """,
                port,
                year,
                raw_date,
            )
            if existing:
                reason = "Duplicate for Port + Year + Date"
        if reason:
            rejected += 1
            report.append({"row": index, "port": port, "date": raw_date, "name": name, "result": "Rejected", "reason": reason})
            continue
        seen.add(key)
        await execute_raw(
            prisma,
            """
            INSERT INTO public.dnd_holiday_calendar (
              id, port_code, holiday_date, holiday_name, year, holiday_type, created_by, created_at, updated_at
            )
            VALUES ($1, $2, $3::date, $4, $5, $6, $7, NOW(), NOW())
            """,
            str(uuid4()),
            port,
            raw_date,
            name,
            year,
            holiday_type,
            user_id,
        )
        accepted += 1
        report.append({"row": index, "port": port, "date": raw_date, "name": name, "result": "Accepted", "reason": "-"})
    if accepted or rejected:
        await record_audit(
            prisma,
            action="upload_holidays",
            description=f"Uploaded D&D holiday calendar rows: {accepted} accepted, {rejected} rejected",
            entity_type="holiday_calendar",
            entity_id=None,
            user_id=user_id,
            metadata={"accepted": accepted, "rejected": rejected},
        )
    return {"accepted": accepted, "rejected": rejected, "rows": report}


def calculate_lfd(start_date: date, free_days: int, *, exclude_weekends: bool, holiday_dates: set[date] | None = None) -> date:
    holidays = holiday_dates or set()
    current = start_date
    added = 0
    while added < free_days:
        current = current + timedelta(days=1)
        if exclude_weekends and current.weekday() >= 5:
            continue
        if current in holidays:
            continue
        added += 1
    return current
