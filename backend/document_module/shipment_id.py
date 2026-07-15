"""Generate deterministic shipment IDs from approved Bill of Lading data."""

from __future__ import annotations

from datetime import date, datetime
import re
from typing import Any


SHIPMENT_ID_PREFIX = "ZTW"

_DATE_FORMATS = (
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%m/%d/%Y",
    "%m-%d-%Y",
    "%d %b %Y",
    "%d %B %Y",
    "%d-%b-%Y",
    "%d-%B-%Y",
    "%b %d %Y",
    "%B %d %Y",
)


def _parse_shipped_on_board_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value is None:
        raise ValueError("BOL shipped-on-board date is required")

    raw = str(value).strip()
    if not raw:
        raise ValueError("BOL shipped-on-board date is required")

    normalized = re.sub(r"(?<=\d)(st|nd|rd|th)\b", "", raw, flags=re.IGNORECASE)
    normalized = re.sub(r"[,]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    iso_candidate = normalized.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(iso_candidate).date()
    except ValueError:
        pass

    for date_format in _DATE_FORMATS:
        try:
            return datetime.strptime(normalized, date_format).date()
        except ValueError:
            continue
    raise ValueError(f"Unsupported BOL shipped-on-board date: {value!r}")


def generate_shipment_id(
    reference_number: Any,
    shipped_on_board_date: Any,
) -> str:
    """
    Return ``ZTW-YYMMDD-NNNN``.

    YYMMDD comes from the BOL Vessel/Shipped On Board Date. NNNN is the
    final four alphanumeric characters of the MBL/booking reference, falling
    back to HBL only when no master reference exists.
    """
    normalized_reference = re.sub(r"[^A-Za-z0-9]", "", str(reference_number or "")).upper()
    if len(normalized_reference) < 4:
        raise ValueError("Shipment reference must contain at least four characters")

    shipped_date = _parse_shipped_on_board_date(shipped_on_board_date)
    return f"{SHIPMENT_ID_PREFIX}-{shipped_date:%y%m%d}-{normalized_reference[-4:]}"


def _normalized_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _find_value(data: Any, accepted_keys: set[str]) -> Any | None:
    if isinstance(data, str):
        stripped = data.strip()
        if stripped.startswith(("{", "[")):
            try:
                import json

                return _find_value(json.loads(stripped), accepted_keys)
            except (ValueError, TypeError):
                return None
        return None
    if isinstance(data, list):
        for item in data:
            found = _find_value(item, accepted_keys)
            if found not in (None, ""):
                return found
        return None
    if not isinstance(data, dict):
        return None

    for key, value in data.items():
        if _normalized_key(str(key)) in accepted_keys and value not in (None, ""):
            return value
    for value in data.values():
        found = _find_value(value, accepted_keys)
        if found not in (None, ""):
            return found
    return None


def generate_shipment_id_from_bol_data(extracted_data: Any) -> str:
    """Generate an ID from typed BOL columns or nested OCR ``raw_data``."""
    raw_data = None
    if isinstance(extracted_data, dict):
        raw_data = (
            extracted_data.get("raw_data")
            or extracted_data.get("rawData")
        )
    preferred_data = raw_data if raw_data not in (None, "", {}) else extracted_data

    master_reference_keys = {
        "mblnumber",
        "masterblnumber",
        "masterbolnumber",
        "masterbillofladingnumber",
        "bookingreferencenumber",
        "bookingreference",
        "bookingnumber",
        "bookingno",
    }
    fallback_hbl_keys = {
        "bolnumber",
        "billofladingnumber",
        "blnumber",
        "hblnumber",
        "houseblnumber",
        "housebillofladingnumber",
    }
    date_keys = {
        "shippedonboarddate",
        "onboarddate",
        "shippeddate",
        "vesselshippedonboarddate",
    }
    reference_number = _find_value(
        preferred_data,
        master_reference_keys,
    ) or _find_value(
        extracted_data,
        master_reference_keys,
    ) or _find_value(
        preferred_data,
        fallback_hbl_keys,
    ) or _find_value(
        extracted_data,
        fallback_hbl_keys,
    )
    shipped_on_board_date = _find_value(
        preferred_data,
        date_keys,
    ) or _find_value(
        extracted_data,
        date_keys,
    )
    return generate_shipment_id(reference_number, shipped_on_board_date)
