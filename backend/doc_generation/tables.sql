CREATE SCHEMA IF NOT EXISTS docgen;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE IF EXISTS aiextraction.sales_invoice_line_items
  ADD COLUMN IF NOT EXISTS container_no text,
  ADD COLUMN IF NOT EXISTS seal_no text,
  ADD COLUMN IF NOT EXISTS package_description text,
  ADD COLUMN IF NOT EXISTS quantity_total text;

ALTER TABLE IF EXISTS aiextraction.packing_list_line_items
  ADD COLUMN IF NOT EXISTS container_no text,
  ADD COLUMN IF NOT EXISTS seal_no text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'docgen'::regnamespace AND typname = 'DocGenerationStatus') THEN
    CREATE TYPE docgen."DocGenerationStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'CONFIRMED', 'GENERATED', 'ARCHIVED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'docgen'::regnamespace AND typname = 'DocGenerationMappingType') THEN
    CREATE TYPE docgen."DocGenerationMappingType" AS ENUM ('direct', 'derived', 'contextual', 'manual', 'conditional');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'docgen'::regnamespace AND typname = 'DocGenerationSeverity') THEN
    CREATE TYPE docgen."DocGenerationSeverity" AS ENUM ('critical', 'warning', 'info');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS docgen.schemas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_doc_type text NOT NULL,
  display_name text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  trigger_condition text,
  source_docs jsonb NOT NULL,
  human_action text,
  total_fields integer NOT NULL DEFAULT 0,
  auto_populated integer NOT NULL DEFAULT 0,
  calculated integer NOT NULL DEFAULT 0,
  manual_input integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (generated_doc_type, schema_version)
);

CREATE TABLE IF NOT EXISTS docgen.field_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_id uuid NOT NULL REFERENCES docgen.schemas(id) ON DELETE CASCADE,
  section_label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  target_field text NOT NULL,
  target_label text NOT NULL,
  source_doc text NOT NULL,
  source_field text,
  source_label text,
  mapping_type docgen."DocGenerationMappingType" NOT NULL,
  transformation text,
  validation text,
  validation_severity docgen."DocGenerationSeverity",
  mono boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS docgen.drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_doc_type text NOT NULL,
  schema_id uuid REFERENCES docgen.schemas(id) ON DELETE SET NULL,
  schema_version integer NOT NULL DEFAULT 1,
  status docgen."DocGenerationStatus" NOT NULL DEFAULT 'DRAFT',
  source_document_ids jsonb NOT NULL,
  rendered_payload jsonb NOT NULL,
  created_by uuid NOT NULL,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS docgen.draft_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES docgen.drafts(id) ON DELETE CASCADE,
  section_label text NOT NULL,
  target_field text NOT NULL,
  target_label text NOT NULL,
  value text,
  source_doc text NOT NULL,
  source_document_id uuid,
  source_field text,
  source_label text,
  mapping_type docgen."DocGenerationMappingType" NOT NULL,
  validation text,
  validation_severity docgen."DocGenerationSeverity",
  validation_status text NOT NULL DEFAULT 'pending',
  override_value text,
  override_reason text,
  mono boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS docgen.draft_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES docgen.drafts(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS docgen.container_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES docgen.drafts(id) ON DELETE CASCADE,
  container_number text,
  seal_number text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_docgen_drafts_type ON docgen.drafts (generated_doc_type);
CREATE INDEX IF NOT EXISTS idx_docgen_drafts_created_by ON docgen.drafts (created_by);
CREATE INDEX IF NOT EXISTS idx_docgen_draft_fields_draft ON docgen.draft_fields (draft_id);
CREATE INDEX IF NOT EXISTS idx_docgen_draft_line_items_draft ON docgen.draft_line_items (draft_id);
CREATE INDEX IF NOT EXISTS idx_docgen_container_allocations_draft ON docgen.container_allocations (draft_id);
