-- Merge the former ENTRY_SUMMARY and ENTRY_SUMMARY_TARIFF_LINES persistence
-- paths into one CBP FORM-7501 / EntrySummaryExtraction aggregate.
--
-- This migration preserves existing tariff rows. It also creates an
-- EntrySummaryExtraction parent for any legacy tariff-only document.

BEGIN;

ALTER TABLE aiextraction.entry_summary_tariff_line_items
  ADD COLUMN IF NOT EXISTS entry_summary_id TEXT,
  ADD COLUMN IF NOT EXISTS line_no TEXT;

-- A tariff-only upload may not yet have an entry_summary_extractions row.
-- Reuse the legacy extraction UUID and audit values when creating its parent.
INSERT INTO aiextraction.entry_summary_extractions (
  id,
  document_id,
  filer_code_entry_number,
  raw_data,
  extracted_at,
  reviewed_by,
  reviewed_at,
  created_at,
  updated_at
)
SELECT
  legacy.id,
  legacy.document_id,
  legacy.filer_code_entry_number,
  legacy.raw_data,
  legacy.extracted_at,
  legacy.reviewed_by,
  legacy.reviewed_at,
  legacy.created_at,
  legacy.updated_at
FROM aiextraction.entry_summary_tariff_line_extractions AS legacy
WHERE NOT EXISTS (
  SELECT 1
  FROM aiextraction.entry_summary_extractions AS merged
  WHERE merged.document_id = legacy.document_id
);

-- Some legacy OCR responses stored their only tariff line directly on the
-- extraction parent. Materialize that row before removing the parent table.
INSERT INTO aiextraction.entry_summary_tariff_line_items (
  entry_summary_tariff_line_id,
  htsus_number,
  description
)
SELECT
  legacy.id,
  legacy.line_htsus_number,
  legacy.line_merchandise_description
FROM aiextraction.entry_summary_tariff_line_extractions AS legacy
WHERE (
    legacy.line_no IS NOT NULL
    OR legacy.line_htsus_number IS NOT NULL
    OR legacy.line_merchandise_description IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM aiextraction.entry_summary_tariff_line_items AS child
    WHERE child.entry_summary_tariff_line_id = legacy.id
  );

-- Repoint children to the canonical extraction. The three legacy parent
-- line fields are folded into their canonical child fields to avoid duplicates.
UPDATE aiextraction.entry_summary_tariff_line_items AS child
SET
  entry_summary_id = merged.id,
  line_no = COALESCE(child.line_no, legacy.line_no),
  description = COALESCE(child.description, legacy.line_merchandise_description),
  htsus_number = COALESCE(child.htsus_number, legacy.line_htsus_number)
FROM aiextraction.entry_summary_tariff_line_extractions AS legacy
JOIN aiextraction.entry_summary_extractions AS merged
  ON merged.document_id = legacy.document_id
WHERE child.entry_summary_tariff_line_id = legacy.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM aiextraction.entry_summary_tariff_line_items
    WHERE entry_summary_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'CBP FORM-7501 migration stopped: one or more tariff rows could not be linked';
  END IF;
END
$$;

-- Drop the legacy child FK without relying on Prisma's generated constraint name.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint AS con
    JOIN pg_class AS rel ON rel.oid = con.conrelid
    JOIN pg_namespace AS ns ON ns.oid = rel.relnamespace
    JOIN pg_attribute AS attr
      ON attr.attrelid = rel.oid
     AND attr.attnum = ANY(con.conkey)
    WHERE ns.nspname = 'aiextraction'
      AND rel.relname = 'entry_summary_tariff_line_items'
      AND con.contype = 'f'
      AND attr.attname = 'entry_summary_tariff_line_id'
  LOOP
    EXECUTE format(
      'ALTER TABLE aiextraction.entry_summary_tariff_line_items DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END
$$;

ALTER TABLE aiextraction.entry_summary_tariff_line_items
  ALTER COLUMN entry_summary_id SET NOT NULL,
  ADD CONSTRAINT entry_summary_tariff_line_items_entry_summary_id_fkey
    FOREIGN KEY (entry_summary_id)
    REFERENCES aiextraction.entry_summary_extractions(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  DROP COLUMN entry_summary_tariff_line_id;

DROP TABLE aiextraction.entry_summary_tariff_line_extractions;

-- All legacy documents now use the single merged document type.
UPDATE public.documents
SET doc_type = 'ENTRY_SUMMARY'
WHERE doc_type::text = 'ENTRY_SUMMARY_TARIFF_LINES';

UPDATE aiextraction.ai_usage_records
SET doc_type = 'ENTRY_SUMMARY'
WHERE doc_type::text = 'ENTRY_SUMMARY_TARIFF_LINES';

-- PostgreSQL cannot remove an enum member directly, so recreate the enum.
ALTER TYPE public."DocType" RENAME TO "DocType_legacy_cbp";

CREATE TYPE public."DocType" AS ENUM (
  'SALES_INVOICE',
  'BILL_OF_LADING',
  'PACKING_LIST',
  'ENTRY_SUMMARY',
  'OCEAN_FREIGHT',
  'FREIGHT_FORWARDER_BILL',
  'CUSTOMER_BROKER_BILL',
  'GRN_INBOUND',
  'PORT_TO_WH',
  'WH_TO_CUSTOMER',
  'US_SALES_INVOICE',
  'US_CARGO_RELEASE_ORDER',
  'US_CUSTOMS_RELEASE_ORDER',
  'US_DELIVERY_ORDER',
  'US_PACKING_LIST',
  'ISF',
  'SHIPPING_BILL',
  'CHA_BILL'
);

ALTER TABLE public.documents
  ALTER COLUMN doc_type TYPE public."DocType"
  USING (doc_type::text::public."DocType");

ALTER TABLE aiextraction.ai_usage_records
  ALTER COLUMN doc_type TYPE public."DocType"
  USING (doc_type::text::public."DocType");

DROP TYPE public."DocType_legacy_cbp";

COMMIT;
