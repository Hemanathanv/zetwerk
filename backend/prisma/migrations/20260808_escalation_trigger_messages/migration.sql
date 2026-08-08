ALTER TABLE "public"."escalation_configs"
  ADD COLUMN IF NOT EXISTS "task_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "trigger_category" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "trigger_logic" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "task_message" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "reminder_message" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "warning_message" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "escalation_message" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "blocker_message" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "reminder_trigger" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "warning_trigger" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "escalation_trigger" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "blocker_trigger" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "public"."activity_task_events" (
  "id" UUID PRIMARY KEY,
  "activity_type" TEXT NOT NULL,
  "title" TEXT,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'General',
  "urgency" TEXT NOT NULL DEFAULT 'NORMAL',
  "assigned_role" TEXT,
  "assigned_user_id" TEXT,
  "shipment_id" UUID,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "scope" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "source_key" TEXT UNIQUE,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "processed_at" TIMESTAMPTZ
);
