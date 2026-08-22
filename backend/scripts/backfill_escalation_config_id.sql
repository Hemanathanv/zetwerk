-- Backfill task_instances.metadata.escalationConfigId from activity_code + doc scope.
-- Run after escalation_configs are deduped to activity x document scope.
-- Review counts before/after; test on a backup first.

UPDATE "public"."task_instances" t
SET "metadata" = COALESCE(t."metadata", '{}'::jsonb) || jsonb_build_object('escalationConfigId', ec."id")
FROM (
  SELECT DISTINCT ON (t2."id")
    t2."id" AS task_id,
    ec."id"
  FROM "public"."task_instances" t2
  JOIN "public"."escalation_configs" ec
    ON LOWER(ec."activity_type") = LOWER(t2."activity_code")
   AND ec."base_sla_hours" > 0
   AND COALESCE(ec."task_enabled", TRUE) IS TRUE
   AND (
     COALESCE(NULLIF(TRIM(COALESCE(t2."metadata"->>'docType', t2."metadata"->>'targetDocType')), ''), '') = ''
     OR COALESCE(NULLIF(TRIM(ec."scope"), ''), '') = ''
     OR LOWER(ec."scope") = LOWER(COALESCE(
       NULLIF(TRIM(t2."metadata"->>'docType'), ''),
       NULLIF(TRIM(t2."metadata"->>'targetDocType'), '')
     ))
   )
  WHERE COALESCE(t2."metadata"->>'escalationConfigId', '') = ''
  ORDER BY
    t2."id",
    CASE WHEN LOWER(COALESCE(ec."scope", '')) = LOWER(COALESCE(
      NULLIF(TRIM(t2."metadata"->>'docType'), ''),
      NULLIF(TRIM(t2."metadata"->>'targetDocType'), '')
    )) THEN 0 ELSE 1 END,
    ec."id" ASC
) ec
WHERE t."id" = ec.task_id;
