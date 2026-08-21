CREATE TABLE IF NOT EXISTS "public"."notification_deliveries" (
  "id" UUID NOT NULL,
  "channel" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'freshdesk',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "task_id" UUID,
  "notification_id" UUID,
  "threshold_type" TEXT,
  "threshold_pct" INTEGER,
  "provider_thread_key" TEXT,
  "provider_delivery_id" TEXT,
  "title" TEXT NOT NULL,
  "message" TEXT,
  "recipient_role" TEXT,
  "recipient_user_id" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "locked_at" TIMESTAMPTZ,
  "locked_by" TEXT,
  "sent_at" TIMESTAMPTZ,
  "failed_at" TIMESTAMPTZ,
  "last_error" TEXT,
  "dedupe_key" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_dedupe_key_key"
  ON "public"."notification_deliveries" ("dedupe_key");

CREATE INDEX IF NOT EXISTS "idx_notification_deliveries_pending"
  ON "public"."notification_deliveries" ("channel", "status", "next_attempt_at");

CREATE INDEX IF NOT EXISTS "idx_notification_deliveries_task"
  ON "public"."notification_deliveries" ("task_id");

CREATE INDEX IF NOT EXISTS "idx_notification_deliveries_notification"
  ON "public"."notification_deliveries" ("notification_id");

CREATE INDEX IF NOT EXISTS "idx_notification_deliveries_thread"
  ON "public"."notification_deliveries" ("provider_thread_key");
