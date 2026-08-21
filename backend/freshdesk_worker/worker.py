from __future__ import annotations

import asyncio
import base64
import json
import os
import socket
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from prisma import Prisma

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env", override=False)

POLL_INTERVAL_SECONDS = max(1, int(os.getenv("FRESHDESK_WORKER_POLL_SECONDS", "5")))
BATCH_SIZE = max(1, int(os.getenv("FRESHDESK_WORKER_BATCH_SIZE", "10")))
WORKER_ID = os.getenv("FRESHDESK_WORKER_ID", f"freshdesk-worker:{socket.gethostname()}")
FRESHDESK_API_KEY = os.getenv("FRESHDESK_API_KEY", "").strip()
FRESHDESK_BASE_URL = os.getenv("FRESHDESK_BASE_URL", "").strip().rstrip("/")
FRESHDESK_REQUESTER_EMAIL = os.getenv("FRESHDESK_REQUESTER_EMAIL", "").strip()
FRESHDESK_GROUP_ID = os.getenv("FRESHDESK_GROUP_ID", "").strip()
FRESHDESK_STAGING_BASE_URL = os.getenv("DEFAULT_STAGING_BASE_URL", "").strip().rstrip("/")
FRESHDESK_PRODUCTION_BASE_URL = os.getenv("DEFAULT_PRODUCTION_BASE_URL", "").strip().rstrip("/")
FRESHDESK_STAGING_GROUP_ID = os.getenv("DEFAULT_STAGING_GROUP_ID", "").strip()
FRESHDESK_PRODUCTION_GROUP_ID = os.getenv("DEFAULT_PRODUCTION_GROUP_ID", "").strip()
FRESHDESK_PRIORITY = os.getenv("FRESHDESK_PRIORITY", "").strip()
FRESHDESK_STATUS = os.getenv("FRESHDESK_STATUS", "").strip()
FRESHDESK_SOURCE = os.getenv("FRESHDESK_SOURCE", "").strip()
FRESHDESK_TICKET_TYPE = os.getenv("FRESHDESK_TICKET_TYPE", "").strip()
FRESHDESK_BU_UNIT_NAME = (os.getenv("FRESHDESK_BU_UNIT_NAME") or os.getenv("DEFAULT_BU_UNIT_NAME") or "").strip()
FRESHDESK_TICKET_CATEGORY = (os.getenv("FRESHDESK_TICKET_CATEGORY") or os.getenv("DEFAULT_TICKET_CATEGORY") or "").strip()
FRESHDESK_NO_OF_INSTANCES = os.getenv("FRESHDESK_NO_OF_INSTANCES", "").strip()
FRESHDESK_LOCATION = os.getenv("FRESHDESK_LOCATION", "").strip()
FRESHDESK_INCLUDE_LOCATION_FIELD = os.getenv("FRESHDESK_INCLUDE_LOCATION_FIELD", "").strip().lower() in {"1", "true", "yes", "on"}
FRESHDESK_TIMEOUT_SECONDS = max(1, int(os.getenv("FRESHDESK_TIMEOUT_SECONDS", "30")))
OPTIONAL_CUSTOM_FIELDS = {"cf_unimact_location"}


def log(message: str, **fields: Any) -> None:
    suffix = f" {json.dumps(fields, default=str, sort_keys=True)}" if fields else ""
    print(f"[freshdesk-worker] {message}{suffix}", flush=True)


def _json(value: Any, fallback: Any = None) -> Any:
    if value is None:
        return fallback
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return value


class FreshdeskConfigError(RuntimeError):
    pass


class FreshdeskApiError(RuntimeError):
    def __init__(self, status_code: int, response: dict[str, Any]):
        self.status_code = status_code
        self.response = response
        super().__init__(f"Freshdesk HTTP {status_code}: {json.dumps(response, default=str)[:600]}")


def _required_env(name: str, value: str) -> str:
    if not value:
        raise FreshdeskConfigError(f"Missing {name} in backend/.env")
    return value


def _optional_int(value: str, name: str) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise FreshdeskConfigError(f"{name} must be an integer") from exc


def _auth_header(api_key: str) -> str:
    token = base64.b64encode(f"{api_key}:X".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


def _invalid_custom_fields(response: dict[str, Any]) -> set[str]:
    errors = response.get("errors") if isinstance(response, dict) else None
    if not isinstance(errors, list):
        return set()
    return {
        str(error.get("field") or "").strip()
        for error in errors
        if isinstance(error, dict)
        and str(error.get("code") or "") == "invalid_field"
        and str(error.get("field") or "").strip()
    }


def _freshdesk_request(method: str, path: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    base_url = _required_env("FRESHDESK_BASE_URL", FRESHDESK_BASE_URL)
    api_key = _required_env("FRESHDESK_API_KEY", FRESHDESK_API_KEY)
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": _auth_header(api_key),
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=FRESHDESK_TIMEOUT_SECONDS) as response:
            response_body = response.read().decode("utf-8")
            parsed = json.loads(response_body) if response_body else {}
            return response.status, parsed
    except urllib.error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(response_body) if response_body else {}
        except json.JSONDecodeError:
            parsed = {"raw": response_body}
        return exc.code, parsed


def _freshdesk_group_id() -> str:
    if FRESHDESK_GROUP_ID:
        return FRESHDESK_GROUP_ID
    if FRESHDESK_BASE_URL and FRESHDESK_BASE_URL == FRESHDESK_PRODUCTION_BASE_URL:
        return FRESHDESK_PRODUCTION_GROUP_ID
    if FRESHDESK_BASE_URL and FRESHDESK_BASE_URL == FRESHDESK_STAGING_BASE_URL:
        return FRESHDESK_STAGING_GROUP_ID
    return ""


def _custom_fields() -> dict[str, Any]:
    fields: dict[str, Any] = {}
    no_of_instances = _optional_int(FRESHDESK_NO_OF_INSTANCES, "FRESHDESK_NO_OF_INSTANCES")
    if no_of_instances is not None:
        fields["cf_no_of_instances244571"] = no_of_instances
    if FRESHDESK_BU_UNIT_NAME:
        fields["cf_bu_unit_name"] = FRESHDESK_BU_UNIT_NAME
    if FRESHDESK_TICKET_CATEGORY:
        fields["cf_ticket_category"] = FRESHDESK_TICKET_CATEGORY
    if FRESHDESK_INCLUDE_LOCATION_FIELD and FRESHDESK_LOCATION:
        fields["cf_unimact_location"] = FRESHDESK_LOCATION
    return fields


def build_freshdesk_payload(delivery: dict[str, Any], *, include_optional_fields: bool = True) -> dict[str, Any]:
    payload_data = _json(delivery.get("payload"), {}) or {}
    metadata = payload_data.get("metadata") if isinstance(payload_data.get("metadata"), dict) else {}
    threshold = str(delivery.get("threshold_type") or metadata.get("threshold") or "").strip()
    subject = str(delivery.get("title") or "").strip()
    description = str(delivery.get("message") or subject).strip()
    task_id = str(delivery.get("task_id") or "").strip()
    if threshold or task_id:
        description = f"{description}\n\nTask ID: {task_id}\nSLA level: {threshold or '-'}"

    freshdesk_payload: dict[str, Any] = {
        "subject": subject,
        "description": description,
        "email": _required_env("FRESHDESK_REQUESTER_EMAIL", FRESHDESK_REQUESTER_EMAIL),
    }
    for key, value in (
        ("group_id", _optional_int(_freshdesk_group_id(), "FRESHDESK_GROUP_ID or matching DEFAULT_*_GROUP_ID")),
        ("priority", _optional_int(FRESHDESK_PRIORITY, "FRESHDESK_PRIORITY")),
        ("status", _optional_int(FRESHDESK_STATUS, "FRESHDESK_STATUS")),
        ("source", _optional_int(FRESHDESK_SOURCE, "FRESHDESK_SOURCE")),
    ):
        if value is not None:
            freshdesk_payload[key] = value
    if FRESHDESK_TICKET_TYPE:
        freshdesk_payload["type"] = FRESHDESK_TICKET_TYPE
    fields = _custom_fields()
    if not include_optional_fields:
        for field in OPTIONAL_CUSTOM_FIELDS:
            fields.pop(field, None)
    if fields:
        freshdesk_payload["custom_fields"] = fields
    return freshdesk_payload


def send_freshdesk_ticket(delivery: dict[str, Any], *, existing_ticket_id: str | None) -> tuple[str, str, dict[str, Any]]:
    action = "update_ticket" if existing_ticket_id else "create_ticket"
    method = "PUT" if existing_ticket_id else "POST"
    path = f"/api/v2/tickets/{existing_ticket_id}" if existing_ticket_id else "/api/v2/tickets"
    payload = build_freshdesk_payload(delivery)
    status_code, response = _freshdesk_request(method, path, payload)
    retry_fields = _invalid_custom_fields(response).intersection(OPTIONAL_CUSTOM_FIELDS)
    if retry_fields:
        payload = build_freshdesk_payload(delivery, include_optional_fields=False)
        status_code, response = _freshdesk_request(method, path, payload)
    if not 200 <= status_code < 300:
        raise FreshdeskApiError(status_code, response)
    ticket_id = str(response.get("id") or existing_ticket_id or "").strip()
    if not ticket_id:
        raise FreshdeskApiError(status_code, {"error": "Freshdesk response did not include ticket id", "response": response})
    return action, ticket_id, {"statusCode": status_code, "response": response}


async def claim_deliveries(prisma: Prisma, limit: int) -> list[dict[str, Any]]:
    rows = await prisma.query_raw(
        """
        WITH picked AS (
          SELECT "id"
          FROM "public"."notification_deliveries"
          WHERE "channel" = 'freshdesk'
            AND "status" IN ('PENDING', 'RETRY')
            AND "next_attempt_at" <= NOW()
            AND "attempts" < "max_attempts"
          ORDER BY "created_at" ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "public"."notification_deliveries" d
        SET "status" = 'PROCESSING',
            "locked_at" = NOW(),
            "locked_by" = $2,
            "attempts" = d."attempts" + 1,
            "updated_at" = NOW()
        FROM picked
        WHERE d."id" = picked."id"
        RETURNING d.*
        """,
        limit,
        WORKER_ID,
    )
    return [dict(row) for row in rows]


async def existing_ticket_id(prisma: Prisma, provider_thread_key: str | None) -> str | None:
    if not provider_thread_key:
        return None
    rows = await prisma.query_raw(
        """
        SELECT "provider_delivery_id"
        FROM "public"."notification_deliveries"
        WHERE "channel" = 'freshdesk'
          AND "provider_thread_key" = $1
          AND "status" = 'SENT'
          AND COALESCE("provider_delivery_id", '') <> ''
        ORDER BY "sent_at" ASC, "created_at" ASC
        LIMIT 1
        """,
        provider_thread_key,
    )
    return str(rows[0].get("provider_delivery_id")) if rows else None


async def mark_sent(prisma: Prisma, delivery_id: str, provider_ticket_id: str, action: str) -> None:
    await prisma.execute_raw(
        """
        UPDATE "public"."notification_deliveries"
        SET "status" = 'SENT',
            "provider_delivery_id" = $2,
            "sent_at" = NOW(),
            "failed_at" = NULL,
            "last_error" = NULL,
            "payload" = COALESCE("payload", '{}'::jsonb) || $3::jsonb,
            "updated_at" = NOW()
        WHERE "id" = $1::uuid
        """,
        delivery_id,
        provider_ticket_id,
        json.dumps({"freshdeskAction": action, "processedBy": WORKER_ID, "processedAt": datetime.now(timezone.utc).isoformat()}),
    )


async def mark_failed(prisma: Prisma, delivery: dict[str, Any], exc: Exception) -> None:
    attempts = int(delivery.get("attempts") or 0)
    max_attempts = int(delivery.get("max_attempts") or 5)
    final = attempts >= max_attempts
    status = "FAILED" if final else "RETRY"
    delay_seconds = min(3600, 30 * (2 ** max(0, attempts - 1)))
    await prisma.execute_raw(
        """
        UPDATE "public"."notification_deliveries"
        SET "status" = $2,
            "failed_at" = CASE WHEN $2 = 'FAILED' THEN NOW() ELSE "failed_at" END,
            "last_error" = $3,
            "next_attempt_at" = CASE WHEN $2 = 'RETRY' THEN NOW() + ($4::text || ' seconds')::interval ELSE "next_attempt_at" END,
            "updated_at" = NOW()
        WHERE "id" = $1::uuid
        """,
        str(delivery["id"]),
        status,
        str(exc),
        delay_seconds,
    )
    log("delivery.failed", delivery_id=str(delivery.get("id")), status=status, attempts=attempts, error=str(exc))


async def process_delivery(prisma: Prisma, delivery: dict[str, Any]) -> None:
    delivery_id = str(delivery["id"])
    thread_key = str(delivery.get("provider_thread_key") or "")
    existing_id = await existing_ticket_id(prisma, thread_key)
    action, ticket_id, provider_result = await asyncio.to_thread(
        send_freshdesk_ticket,
        delivery,
        existing_ticket_id=existing_id,
    )
    log(
        action,
        delivery_id=delivery_id,
        ticket_id=ticket_id,
        task_id=str(delivery.get("task_id") or ""),
        notification_id=str(delivery.get("notification_id") or ""),
        threshold=delivery.get("threshold_type"),
        threshold_pct=delivery.get("threshold_pct"),
        recipient_role=delivery.get("recipient_role"),
        title=delivery.get("title"),
        http_status=provider_result.get("statusCode"),
    )
    await mark_sent(prisma, delivery_id, ticket_id, action)


async def poll_once(prisma: Prisma) -> int:
    deliveries = await claim_deliveries(prisma, BATCH_SIZE)
    if not deliveries:
        return 0
    log("claimed", count=len(deliveries), worker_id=WORKER_ID)
    for delivery in deliveries:
        try:
            await process_delivery(prisma, delivery)
        except Exception as exc:
            await mark_failed(prisma, delivery, exc)
    return len(deliveries)


async def run_forever() -> None:
    prisma = Prisma()
    await prisma.connect()
    log("started", poll_seconds=POLL_INTERVAL_SECONDS, batch_size=BATCH_SIZE, worker_id=WORKER_ID)
    try:
        while True:
            try:
                processed = await poll_once(prisma)
                if processed:
                    log("poll.done", processed=processed)
            except Exception as exc:
                log("poll.error", error=str(exc))
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
    finally:
        await prisma.disconnect()
        log("stopped")


def main() -> None:
    try:
        asyncio.run(run_forever())
    except KeyboardInterrupt:
        log("interrupted")


if __name__ == "__main__":
    main()
