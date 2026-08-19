CREATE TABLE IF NOT EXISTS "public"."document_link_rules" (
  "id" TEXT PRIMARY KEY,
  "trigger_event" TEXT NOT NULL DEFAULT 'document_reviewed',
  "activity_type" TEXT NOT NULL DEFAULT 'upload_document',
  "base_doc_type" TEXT NOT NULL,
  "target_doc_type" TEXT NOT NULL,
  "match_key_types" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "required_target_status" TEXT NOT NULL DEFAULT 'ANY_ACTIVE',
  "assigned_role" TEXT,
  "escalation_config_id" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "public"."task_engine_events" (
  "id" UUID PRIMARY KEY,
  "event_type" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "shipment_id" UUID,
  "actor_id" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" TEXT NOT NULL DEFAULT 'PROCESSED',
  "processed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "public"."task_instances" (
  "id" UUID PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'General',
  "activity_code" TEXT NOT NULL DEFAULT 'TSK-001',
  "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
  "urgency" TEXT NOT NULL DEFAULT 'NORMAL',
  "assigned_role" TEXT,
  "assigned_user_id" TEXT,
  "shipment_id" UUID,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "parent_task_id" UUID,
  "sla_deadline" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "escalation_level" INTEGER NOT NULL DEFAULT 0,
  "escalation_type" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "source_key" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "public"."notifications" (
  "id" UUID PRIMARY KEY,
  "type" TEXT NOT NULL DEFAULT 'info',
  "title" TEXT NOT NULL,
  "message" TEXT,
  "link" TEXT,
  "read" BOOLEAN NOT NULL DEFAULT FALSE,
  "recipient_user_id" TEXT,
  "recipient_role" TEXT,
  "task_id" UUID,
  "source" TEXT NOT NULL DEFAULT 'task',
  "dedupe_key" TEXT UNIQUE,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "public"."task_sla_events" (
  "id" UUID PRIMARY KEY,
  "task_id" UUID NOT NULL,
  "threshold_type" TEXT NOT NULL,
  "threshold_pct" INTEGER NOT NULL,
  "notification_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("task_id", "threshold_type", "threshold_pct")
);

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

ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "task_enabled" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "trigger_category" TEXT;
ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "trigger_logic" TEXT;
ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "task_message" TEXT;
ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "reminder_message" TEXT;
ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "warning_message" TEXT;
ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "escalation_message" TEXT;
ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "blocker_message" TEXT;
ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "reminder_trigger" TEXT;
ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "warning_trigger" TEXT;
ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "escalation_trigger" TEXT;
ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "blocker_trigger" TEXT;
ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "channels" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "public"."escalation_configs" ADD COLUMN IF NOT EXISTS "targets" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS "idx_document_link_rules_trigger_base"
  ON "public"."document_link_rules" ("trigger_event", "base_doc_type", "is_active");
CREATE INDEX IF NOT EXISTS "idx_task_engine_events_entity"
  ON "public"."task_engine_events" ("event_type", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_task_engine_events_shipment"
  ON "public"."task_engine_events" ("shipment_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_task_instances_source_key"
  ON "public"."task_instances" ("source_key") WHERE "source_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_task_instances_open"
  ON "public"."task_instances" ("status", "assigned_role", "assigned_user_id");
CREATE INDEX IF NOT EXISTS "idx_task_instances_shipment"
  ON "public"."task_instances" ("shipment_id");
CREATE INDEX IF NOT EXISTS "idx_notifications_recipient"
  ON "public"."notifications" ("recipient_user_id", "recipient_role", "read", "created_at");
CREATE INDEX IF NOT EXISTS "idx_notifications_task"
  ON "public"."notifications" ("task_id");
CREATE INDEX IF NOT EXISTS "idx_task_sla_events_task"
  ON "public"."task_sla_events" ("task_id");
CREATE INDEX IF NOT EXISTS "idx_activity_task_events_activity_type" ON "public"."activity_task_events" ("activity_type");
CREATE INDEX IF NOT EXISTS "idx_activity_task_events_processed_at" ON "public"."activity_task_events" ("processed_at");
