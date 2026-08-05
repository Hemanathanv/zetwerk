from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import get_prisma
from helpers.config import settings
from helpers.dependencies import get_current_user


def _load_dnd_logic():
    logic_path = Path(__file__).resolve().parents[3] / "D&D" / "logic.py"
    spec = importlib.util.spec_from_file_location("ewms_dnd_logic", logic_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load D&D backend logic from {logic_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


dnd_logic = _load_dnd_logic()

router = APIRouter(prefix=settings.API_SLUG + "/dnd", tags=["D&D"])
legacy_router = APIRouter(prefix="/api/dnd", tags=["D&D"])


class LanePairPayload(BaseModel):
    origin: str = Field(min_length=1)
    originName: str | None = None
    dest: str = Field(min_length=1)
    destName: str | None = None


class FreeTimePayload(BaseModel):
    event: str = Field(min_length=1)
    days: list[int] = Field(default_factory=list)


class ExclusionDefaultPayload(BaseModel):
    weekends: bool = False
    holidays: bool = False


class TariffPublishPayload(BaseModel):
    id: str | None = None
    carrier: str = Field(min_length=1)
    scac: str | None = None
    status: str | None = None
    description: str | None = None
    lane: str | None = None
    originCountry: str | None = None
    cargo: str = Field(min_length=1)
    containerType: str | None = None
    weightConfig: str | None = None
    lanePairs: list[LanePairPayload] = Field(min_length=1)
    chargeTypes: list[str] = Field(min_length=1)
    pricingMethods: dict[str, Any] | list[str] = Field(default_factory=dict)
    freeTime: list[FreeTimePayload] = Field(default_factory=list)
    exclusionDefault: ExclusionDefaultPayload = Field(default_factory=ExclusionDefaultPayload)
    effFrom: str | None = None
    effTo: str | None = None


class HolidayUploadRow(BaseModel):
    port: str | None = None
    portCode: str | None = None
    date: str | None = None
    holidayDate: str | None = None
    name: str | None = None
    holidayName: str | None = None
    type: str | None = None
    holidayType: str | None = None


class HolidayUploadPayload(BaseModel):
    rows: list[HolidayUploadRow] = Field(default_factory=list)


class ReturnPayload(BaseModel):
    returnDate: str
    returnDepot: str


def _user_id(user: Any) -> str | None:
    value = getattr(user, "id", None)
    if value is None and isinstance(user, dict):
        value = user.get("id")
    return str(value) if value else None


async def _list_tariffs(user=Depends(get_current_user)):
    prisma = await get_prisma()
    try:
        return {"data": await dnd_logic.list_tariffs(prisma)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list D&D tariffs: {exc}") from exc


async def _publish_tariff(payload: TariffPublishPayload, user=Depends(get_current_user)):
    prisma = await get_prisma()
    try:
        tariff = await dnd_logic.publish_tariff(
            prisma,
            payload.model_dump(mode="json"),
            user_id=_user_id(user),
        )
        return {"data": tariff}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to publish D&D tariff: {exc}") from exc


async def _list_holidays(user=Depends(get_current_user)):
    prisma = await get_prisma()
    try:
        await dnd_logic.ensure_dnd_tables(prisma)
        rows = await dnd_logic.query_raw(
            prisma,
            """
            SELECT *
            FROM public.dnd_holiday_calendar
            ORDER BY holiday_date DESC, port_code ASC
            """,
        )
        return {"data": [dnd_logic.normalize_holiday_row(row) for row in rows]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list D&D holidays: {exc}") from exc


async def _upload_holidays(payload: HolidayUploadPayload, user=Depends(get_current_user)):
    prisma = await get_prisma()
    try:
        report = await dnd_logic.upload_holidays(
            prisma,
            [row.model_dump(mode="json") for row in payload.rows],
            user_id=_user_id(user),
        )
        return {"data": report}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to upload D&D holidays: {exc}") from exc


async def _holiday_template(user=Depends(get_current_user)):
    return {
        "data": {
            "fileName": "holiday_calendar_template.csv",
            "content": (
                "Port Code,Holiday Date,Holiday Name,Year,Type\n"
            ),
        }
    }


async def _active_charges(user=Depends(get_current_user)):
    # Existing frontend D&D monitoring calls this endpoint. The charge engine can
    # hydrate this later from shipment/container tracking; keep the contract live.
    return {"data": []}


async def _alerts(user=Depends(get_current_user)):
    return {"data": {"notifications": [], "audits": []}}


async def _record_return(charge_id: str, payload: ReturnPayload, user=Depends(get_current_user)):
    return {
        "data": {
            "id": charge_id,
            "returnDate": payload.returnDate,
            "returnDepot": payload.returnDepot,
            "status": "CLOSED",
        }
    }


for api_router in (router, legacy_router):
    api_router.add_api_route("/tariffs", _list_tariffs, methods=["GET"])
    api_router.add_api_route("/tariffs/publish", _publish_tariff, methods=["POST"])
    api_router.add_api_route("/holidays", _list_holidays, methods=["GET"])
    api_router.add_api_route("/holidays/upload", _upload_holidays, methods=["POST"])
    api_router.add_api_route("/holidays/template", _holiday_template, methods=["GET"])
    api_router.add_api_route("/active", _active_charges, methods=["GET"])
    api_router.add_api_route("/alerts", _alerts, methods=["GET"])
    api_router.add_api_route("/{charge_id}/return", _record_return, methods=["POST"])
