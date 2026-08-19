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
