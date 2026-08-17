CREATE SCHEMA IF NOT EXISTS "project";

CREATE TABLE IF NOT EXISTS "project"."projects" (
  "id" UUID PRIMARY KEY,
  "project_name" TEXT NOT NULL,
  "project_key" TEXT NOT NULL UNIQUE,
  "customer_name" TEXT,
  "buyer_org_name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "shipment_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "project"."projects"
  ADD COLUMN IF NOT EXISTS "customer_name" TEXT,
  ADD COLUMN IF NOT EXISTS "buyer_org_name" TEXT,
  ADD COLUMN IF NOT EXISTS "notes" TEXT;

ALTER TABLE "public"."shipments"
  ADD COLUMN IF NOT EXISTS "project_id" UUID;

CREATE INDEX IF NOT EXISTS "idx_projects_project_key"
  ON "project"."projects" ("project_key");

CREATE INDEX IF NOT EXISTS "idx_shipments_project_id"
  ON "public"."shipments" ("project_id");

CREATE INDEX IF NOT EXISTS "idx_shipments_project_name"
  ON "public"."shipments" ("project_name");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_shipments_project_id'
      AND conrelid = '"public"."shipments"'::regclass
  ) THEN
    ALTER TABLE "public"."shipments"
      ADD CONSTRAINT "fk_shipments_project_id"
      FOREIGN KEY ("project_id")
      REFERENCES "project"."projects"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
