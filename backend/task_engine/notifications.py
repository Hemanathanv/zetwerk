from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from .repository import debug, execute_raw


async def insert_notification(
    prisma,
    *,
    task_id: str,
    notification_type: str,
    title: str,
    message: str,
    recipient_role: str | None,
    recipient_user_id: str | None = None,
    source: str = "task_engine",
    dedupe_key: str,
    metadata: dict[str, Any] | None = None,
) -> str:
    notification_id = str(uuid4())
    await execute_raw(
        prisma,
        """
        INSERT INTO "public"."notifications" (
          "id", "type", "title", "message", "link", "recipient_user_id", "recipient_role",
          "task_id", "source", "dedupe_key", "metadata"
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid, $9, $10, $11::jsonb)
        ON CONFLICT ("dedupe_key") DO UPDATE SET
          "type" = EXCLUDED."type",
          "title" = EXCLUDED."title",
          "message" = EXCLUDED."message",
          "recipient_user_id" = EXCLUDED."recipient_user_id",
          "recipient_role" = EXCLUDED."recipient_role",
          "metadata" = EXCLUDED."metadata"
        """,
        notification_id,
        notification_type,
        title,
        message,
        f"/tasks?taskId={task_id}",
        recipient_user_id,
        recipient_role,
        task_id,
        source,
        dedupe_key,
        json.dumps(metadata or {}),
    )
    debug(
        "notification.saved",
        notification_id=notification_id,
        task_id=task_id,
        type=notification_type,
        recipient_role=recipient_role,
        recipient_user_id=recipient_user_id,
        dedupe_key=dedupe_key,
        source=source,
    )
    return notification_id


def _parse_channels(channels: Any) -> dict[str, Any]:
    raw = channels
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raw = {}
    return raw if isinstance(raw, dict) else {}


def _channel_enabled(channels: Any, level: str, channel: str) -> bool:
    raw = _parse_channels(channels)
    level_cfg = raw.get(level)
    if not isinstance(level_cfg, dict):
        return False
    return bool(level_cfg.get(channel))


async def enqueue_notification_delivery(
    prisma,
    *,
    channel: str,
    provider: str,
    notification_id: str,
    task_id: str,
    level: str,
    threshold_pct: int | None,
    title: str,
    message: str,
    recipient_role: str | None,
    recipient_user_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> str:
    delivery_id = str(uuid4())
    provider_thread_key = f"{provider}:task:{task_id}"
    dedupe_key = f"{provider}:{task_id}:{level}:{threshold_pct if threshold_pct is not None else 'na'}"
    await execute_raw(
        prisma,
        """
        INSERT INTO "public"."notification_deliveries" (
          "id", "channel", "provider", "status", "task_id", "notification_id",
          "threshold_type", "threshold_pct", "provider_thread_key", "title", "message",
          "recipient_role", "recipient_user_id", "payload", "dedupe_key"
        )
        VALUES (
          $1::uuid, $2, $3, 'PENDING', $4::uuid, $5::uuid,
          $6, $7, $8, $9, $10,
          $11, $12, $13::jsonb, $14
        )
        ON CONFLICT ("dedupe_key") DO UPDATE SET
          "title" = EXCLUDED."title",
          "message" = EXCLUDED."message",
          "recipient_role" = EXCLUDED."recipient_role",
          "recipient_user_id" = EXCLUDED."recipient_user_id",
          "payload" = EXCLUDED."payload",
          "notification_id" = EXCLUDED."notification_id",
          "updated_at" = NOW()
        """,
        delivery_id,
        channel,
        provider,
        task_id,
        notification_id,
        level,
        threshold_pct,
        provider_thread_key,
        title,
        message,
        recipient_role,
        recipient_user_id,
        json.dumps(payload or {}),
        dedupe_key,
    )
    debug(
        "notification.delivery.enqueued",
        delivery_id=delivery_id,
        channel=channel,
        provider=provider,
        task_id=task_id,
        level=level,
        threshold_pct=threshold_pct,
        dedupe_key=dedupe_key,
    )
    print(
        f"[notification-delivery][enqueue] {json.dumps({'delivery_id': delivery_id, 'channel': channel, 'provider': provider, 'task_id': task_id, 'level': level, 'threshold_pct': threshold_pct, 'dedupe_key': dedupe_key}, default=str, sort_keys=True)}",
        flush=True,
    )
    return delivery_id


async def dispatch_notification_channels(
    prisma,
    *,
    channels: Any,
    notification_id: str,
    task_id: str,
    level: str,
    title: str,
    message: str,
    recipient_role: str | None,
    recipient_user_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    if _channel_enabled(channels, level, "email"):
        payload = {
            "notification_id": notification_id,
            "task_id": task_id,
            "level": level,
            "title": title,
            "recipient_role": recipient_role,
            "recipient_user_id": recipient_user_id,
        }
        debug("email.mock.queued", **payload)
        print(f"[notification-channel][email][mock] queued {json.dumps(payload, default=str, sort_keys=True)}", flush=True)

    if _channel_enabled(channels, level, "freshdesk"):
        await enqueue_notification_delivery(
            prisma,
            channel="freshdesk",
            provider="freshdesk",
            notification_id=notification_id,
            task_id=task_id,
            level=level,
            threshold_pct=int((metadata or {}).get("thresholdPct") or 0) if (metadata or {}).get("thresholdPct") is not None else None,
            title=title,
            message=message,
            recipient_role=recipient_role,
            recipient_user_id=recipient_user_id,
            payload={"metadata": metadata or {}, "source": "task_engine_sla"},
        )
