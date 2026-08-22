-- Replace transient document edit statuses with explicit edit locks.
-- Runs in one transaction: normalize rows, add lock columns, temporarily recreate views
-- that depend on public.documents.status, then recreate DocumentStatus without edit-only values.
BEGIN;

UPDATE "public"."documents"
SET "status" = 'EXTRACTED'::"public"."DocumentStatus"
WHERE "status"::text IN ('EDITING', 'SUBMITTED_FOR_REVIEW');

ALTER TABLE "public"."documents"
  ADD COLUMN IF NOT EXISTS "editing_by_id" TEXT,
  ADD COLUMN IF NOT EXISTS "editing_started_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "editing_expires_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "edit_version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "idx_documents_editing_by_id" ON "public"."documents" ("editing_by_id");
CREATE INDEX IF NOT EXISTS "idx_documents_editing_expires_at" ON "public"."documents" ("editing_expires_at");

CREATE TEMP TABLE _document_status_view_defs ON COMMIT DROP AS
WITH RECURSIVE dependent_views AS (
  SELECT DISTINCT
    dependent_view.oid,
    dependent_ns.nspname AS schema_name,
    dependent_view.relname AS view_name,
    1 AS depth
  FROM pg_depend dep
  JOIN pg_rewrite rw ON rw.oid = dep.objid
  JOIN pg_class dependent_view ON dependent_view.oid = rw.ev_class
  JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_view.relnamespace
  JOIN pg_attribute a ON a.attrelid = dep.refobjid AND a.attnum = dep.refobjsubid
  WHERE dep.refobjid = 'public.documents'::regclass
    AND a.attname = 'status'
    AND dependent_view.relkind = 'v'
  UNION
  SELECT DISTINCT
    next_view.oid,
    next_ns.nspname AS schema_name,
    next_view.relname AS view_name,
    dependent_views.depth + 1 AS depth
  FROM dependent_views
  JOIN pg_depend dep ON dep.refobjid = dependent_views.oid
  JOIN pg_rewrite rw ON rw.oid = dep.objid
  JOIN pg_class next_view ON next_view.oid = rw.ev_class
  JOIN pg_namespace next_ns ON next_ns.oid = next_view.relnamespace
  WHERE next_view.relkind = 'v'
    AND next_view.oid <> dependent_views.oid
)
SELECT
  oid,
  schema_name,
  view_name,
  pg_get_viewdef(oid, true) AS view_definition,
  max(depth) AS depth
FROM dependent_views
GROUP BY oid, schema_name, view_name;

DO $$
DECLARE
  view_row record;
BEGIN
  FOR view_row IN
    SELECT * FROM _document_status_view_defs ORDER BY depth DESC, schema_name, view_name
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS %I.%I', view_row.schema_name, view_row.view_name);
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public'
      AND t.typname = 'DocumentStatus'
      AND e.enumlabel IN ('EDITING', 'SUBMITTED_FOR_REVIEW')
  ) THEN
    ALTER TABLE "public"."documents" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TYPE "public"."DocumentStatus" RENAME TO "DocumentStatus_old";
    CREATE TYPE "public"."DocumentStatus" AS ENUM (
      'UPLOADED',
      'QUEUED',
      'PROCESSING',
      'EXTRACTED',
      'REVIEWED',
      'REJECTED',
      'REPROCESSING',
      'ARCHIVED'
    );
    ALTER TABLE "public"."documents"
      ALTER COLUMN "status" TYPE "public"."DocumentStatus"
      USING "status"::text::"public"."DocumentStatus";
    ALTER TABLE "public"."documents"
      ALTER COLUMN "status" SET DEFAULT 'UPLOADED'::"public"."DocumentStatus";
    DROP TYPE "public"."DocumentStatus_old";
  END IF;

  FOR view_row IN
    SELECT * FROM _document_status_view_defs ORDER BY depth ASC, schema_name, view_name
  LOOP
    EXECUTE format('CREATE VIEW %I.%I AS %s', view_row.schema_name, view_row.view_name, view_row.view_definition);
  END LOOP;
END $$;

COMMIT;
