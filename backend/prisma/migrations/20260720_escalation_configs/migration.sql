CREATE TABLE IF NOT EXISTS "public"."escalation_configs" (
  "id" TEXT PRIMARY KEY,
  "activity_type" TEXT NOT NULL,
  "activity_name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "scope" TEXT NOT NULL DEFAULT '',
  "base_doc" TEXT NOT NULL DEFAULT '',
  "base_sla_hours" DOUBLE PRECISION NOT NULL DEFAULT 24,
  "reminder_pct" INTEGER NOT NULL DEFAULT 0,
  "warning_pct" INTEGER NOT NULL DEFAULT 50,
  "escalation_pct" INTEGER NOT NULL DEFAULT 75,
  "blocker_pct" INTEGER NOT NULL DEFAULT 100,
  "channels" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "targets" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_escalation_configs_activity_type"
  ON "public"."escalation_configs" ("activity_type");

CREATE INDEX IF NOT EXISTS "idx_escalation_configs_scope"
  ON "public"."escalation_configs" ("scope");
