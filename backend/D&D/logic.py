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


def normalize_charge_types(values: list[str]) -> list[str]:
    return [value for value in values if value in CHARGE_TYPES]


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
    rows = await query_raw(
        prisma,
        """
        SELECT *
        FROM public.dnd_tariffs
        ORDER BY updated_at DESC, created_at DESC
        """,
    )
    return [normalize_tariff_row(row) for row in rows]


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
    overlapping = await find_overlapping_active_tariff(prisma, payload)
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
    await execute_raw(
        prisma,
        """
        INSERT INTO public.dnd_tariffs (
          id, carrier, scac, lane, cargo, status, version, lane_pairs, charge_types,
          pricing_methods, free_time, exclusion_default, metadata, effective_from, effective_to,
          linked_shipments, created_by, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, 'Active', $6, $7::jsonb, $8::jsonb,
          $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::date, $14::date,
          0, $15, NOW(), NOW()
        )
        """,
        tariff_id,
        str(payload.get("carrier") or "").strip().upper(),
        str(payload.get("scac") or "").strip().upper() or None,
        payload.get("lane"),
        payload.get("cargo"),
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
