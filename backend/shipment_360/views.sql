CREATE SCHEMA IF NOT EXISTS shipment_360;

DROP VIEW IF EXISTS shipment_360.shipment_detail_view;
DROP VIEW IF EXISTS shipment_360.shipment_list_view;

CREATE OR REPLACE VIEW shipment_360.shipment_list_view AS
SELECT
  s.id::text AS id,
  s.shipment_number,
  s.status,
  s.blocked_reason,
  s.current_stage,
  s.current_stage_name,
  s.workflow_template_id::text AS workflow_template_id,
  s.vessel_name,
  s.port_of_loading,
  s.port_of_discharge,
  s.exporter_name,
  s.buyer_name,
  s.bol_number AS hbl_number,
  s.mbl_number,
  s.booking_number,
  s.load_type,
  s.incoterms,
  s.project_name,
  s.eta_port,
  s.eta_delivery,
  s.created_at,
  s.updated_at,
  CASE
    WHEN lower(COALESCE(s.status, '')) IN ('cancelled', 'canceled') THEN 'cancelled'
    WHEN lower(COALESCE(s.status, '')) IN ('on_hold', 'hold', 'held') THEN 'hold'
    WHEN COALESCE(stock.total_stock_qty, 0) > 0
      AND COALESCE(stock.outward_qty, 0) >= COALESCE(stock.total_stock_qty, 0)
      THEN 'closed'
    ELSE 'in_progress'
  END AS shipment_list_status,
  COALESCE(docs.documents, '[]'::jsonb) AS documents,
  COALESCE(NULLIF(req.required_documents_total, 0), docs.documents_total, 0)::int AS documents_total,
  CASE
    WHEN COALESCE(req.required_documents_total, 0) > 0
      THEN COALESCE(req.required_documents_approved, 0)::int
    ELSE COALESCE(docs.documents_approved, 0)::int
  END AS documents_approved,
  COALESCE(gates.shipment_gates, '[]'::jsonb) AS shipment_gates,
  sc.shipment_number IS NOT NULL AS safecube_linked,
  sc.current_stage_name AS safecube_current_location,
  sc.status AS safecube_schedule_status,
  COALESCE(
    sc.raw_data->'metadata'->>'shippingStatus',
    sc.status
  ) AS safecube_shipping_status,
  COALESCE(
    sc.raw_data->'route'->'pod'->>'predictiveEta',
    sc.raw_data->'route'->'postpod'->>'predictiveEta'
  ) AS safecube_eta_at,
  0::int AS safecube_alert_count,
  concat_ws(
    ' ',
    s.shipment_number,
    s.mbl_number,
    s.booking_number,
    s.bol_number,
    s.vessel_name,
    s.port_of_loading,
    s.port_of_discharge,
    s.exporter_name,
    s.buyer_name,
    s.project_name
  ) AS search_text
FROM public.shipments s
LEFT JOIN LATERAL (
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'id', d.id::text,
        'documentType', COALESCE(d.document_type, d.doc_type::text),
        'documentNumber', d.document_number,
        'ocrStatus', COALESCE(d.ocr_status, CASE WHEN d.approved_at IS NOT NULL THEN 'completed' ELSE lower(d.status::text) END),
        'validationStatus', d.validation_status,
        'approvedAt', d.approved_at,
        'isGenerated', COALESCE(d.is_generated, false)
      )
      ORDER BY d.created_at ASC
    ) AS documents,
    count(*) AS documents_total,
    count(*) FILTER (WHERE d.approved_at IS NOT NULL OR d.status::text = 'REVIEWED') AS documents_approved
  FROM public.documents d
  WHERE d.shipment_id = s.id
    AND COALESCE(d.is_deleted, false) = false
) docs ON true
LEFT JOIN LATERAL (
  WITH required_types AS (
    SELECT DISTINCT upper(trim(required_doc_type)) AS doc_type
    FROM public.shipment_gates sg
    JOIN public.gate_configs gc ON gc.id = sg.gate_config_id
    CROSS JOIN LATERAL unnest(COALESCE(gc.required_doc_types, ARRAY[]::text[])) AS req_doc(required_doc_type)
    WHERE sg.shipment_id = s.id
      AND trim(required_doc_type) <> ''
    UNION
    SELECT DISTINCT upper(trim(dtg.doc_type)) AS doc_type
    FROM public.shipment_gates sg
    JOIN public.doc_type_gates dtg ON dtg.gate_config_id = sg.gate_config_id
    WHERE sg.shipment_id = s.id
      AND trim(dtg.doc_type) <> ''
  ),
  approved_types AS (
    SELECT DISTINCT upper(trim(COALESCE(d.document_type, d.doc_type::text))) AS doc_type
    FROM public.documents d
    WHERE d.shipment_id = s.id
      AND COALESCE(d.is_deleted, false) = false
      AND (d.approved_at IS NOT NULL OR d.status::text = 'REVIEWED')
      AND trim(COALESCE(d.document_type, d.doc_type::text, '')) <> ''
  )
  SELECT
    count(*)::int AS required_documents_total,
    count(*) FILTER (WHERE rt.doc_type IN (SELECT doc_type FROM approved_types))::int AS required_documents_approved
  FROM required_types rt
) req ON true
LEFT JOIN LATERAL (
  WITH stock_lines AS (
    SELECT
      CASE
        WHEN regexp_replace(COALESCE(pli.total_qty_in_pcs, pli.no_of_bundles, '0'), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN regexp_replace(COALESCE(pli.total_qty_in_pcs, pli.no_of_bundles, '0'), '[^0-9.-]', '', 'g')::numeric
        ELSE 0
      END AS quantity_on_hand
    FROM aiextraction.packing_list_extractions pl
    JOIN public.documents d ON d.id = pl.document_id
    JOIN aiextraction.packing_list_line_items pli ON pli.packing_list_id = pl.id
    WHERE d.shipment_id = s.id
      AND d.doc_type::text = 'PACKING_LIST'
      AND d.status::text IN ('REVIEWED', 'ARCHIVED')
    UNION ALL
    SELECT
      CASE
        WHEN regexp_replace(COALESCE(
          raw_line.item->>'totalQtyInPcs',
          raw_line.item->>'total_qty_in_pcs',
          raw_line.item->>'quantity',
          raw_line.item->>'quantityTotal',
          raw_line.item->>'quantity_total',
          raw_line.item->>'qty',
          raw_line.item->>'noOfBundles',
          raw_line.item->>'no_of_bundles',
          '0'
        ), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN regexp_replace(COALESCE(
          raw_line.item->>'totalQtyInPcs',
          raw_line.item->>'total_qty_in_pcs',
          raw_line.item->>'quantity',
          raw_line.item->>'quantityTotal',
          raw_line.item->>'quantity_total',
          raw_line.item->>'qty',
          raw_line.item->>'noOfBundles',
          raw_line.item->>'no_of_bundles',
          '0'
        ), '[^0-9.-]', '', 'g')::numeric
        ELSE 0
      END AS quantity_on_hand
    FROM aiextraction.packing_list_extractions pl
    JOIN public.documents d ON d.id = pl.document_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(COALESCE(pl.raw_data, '{}'::jsonb)->'lineItems') = 'array'
          THEN COALESCE(pl.raw_data, '{}'::jsonb)->'lineItems'
        WHEN jsonb_typeof(COALESCE(pl.raw_data, '{}'::jsonb)->'line_items') = 'array'
          THEN COALESCE(pl.raw_data, '{}'::jsonb)->'line_items'
        WHEN jsonb_typeof(COALESCE(pl.raw_data, '{}'::jsonb)->'items') = 'array'
          THEN COALESCE(pl.raw_data, '{}'::jsonb)->'items'
        WHEN jsonb_typeof(COALESCE(pl.raw_data, '{}'::jsonb)->'packingList'->'lineItems') = 'array'
          THEN COALESCE(pl.raw_data, '{}'::jsonb)->'packingList'->'lineItems'
        WHEN jsonb_typeof(COALESCE(pl.raw_data, '{}'::jsonb)->'packingListExtraction'->'lineItems') = 'array'
          THEN COALESCE(pl.raw_data, '{}'::jsonb)->'packingListExtraction'->'lineItems'
        ELSE '[]'::jsonb
      END
    ) AS raw_line(item)
    WHERE d.shipment_id = s.id
      AND d.doc_type::text = 'PACKING_LIST'
      AND d.status::text IN ('REVIEWED', 'ARCHIVED')
      AND NOT EXISTS (
        SELECT 1
        FROM aiextraction.packing_list_line_items existing
        WHERE existing.packing_list_id = pl.id
      )
  ),
  outward_lines AS (
    SELECT
      CASE
        WHEN regexp_replace(COALESCE(
          item->>'quantityDispatched',
          item->>'totalQtyInPcs',
          '0'
        ), '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\.[0-9]+)?$'
        THEN regexp_replace(COALESCE(
          item->>'quantityDispatched',
          item->>'totalQtyInPcs',
          '0'
        ), '[^0-9.-]', '', 'g')::numeric
        ELSE 0
      END AS quantity_dispatched
    FROM docgen.drafts dr
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(COALESCE(dr.rendered_payload, '{}'::jsonb)->'lineItems') = 'array'
          THEN COALESCE(dr.rendered_payload, '{}'::jsonb)->'lineItems'
        ELSE '[]'::jsonb
      END
    ) AS line(item)
    WHERE dr.generated_doc_type = 'US_PACKING_LIST'
      AND dr.status IN ('CONFIRMED', 'GENERATED')
      AND item->>'originShipmentId' = s.id::text
  )
  SELECT
    COALESCE((SELECT SUM(quantity_on_hand) FROM stock_lines), 0)::numeric AS total_stock_qty,
    COALESCE((SELECT SUM(quantity_dispatched) FROM outward_lines), 0)::numeric AS outward_qty
) stock ON true
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'gateConfigId', sg.gate_config_id::text,
      'status', sg.status,
      'passedAt', sg.passed_at,
      'blockedReason', sg.blocked_reason,
      'gateConfig', jsonb_build_object(
        'id', gc.id::text,
        'gateNumber', gc.gate_number,
        'gateName', gc.gate_name,
        'gateLabel', gc.gate_label,
        'geography', gc.geography,
        'gateCheckType', gc.gate_check_type,
        'isIdentityGate', gc.is_identity_gate
      )
    )
    ORDER BY gc.gate_number ASC
  ) AS shipment_gates
  FROM public.shipment_gates sg
  JOIN public.gate_configs gc ON gc.id = sg.gate_config_id
  WHERE sg.shipment_id = s.id
) gates ON true
LEFT JOIN LATERAL (
  SELECT ss.*
  FROM dashboard.safecube_shipments ss
  WHERE ss.shipment_number = ANY(
    ARRAY[
      NULLIF(s.mbl_number, ''),
      NULLIF(s.booking_number, ''),
      NULLIF(s.shipment_number, '')
    ]::text[]
  )
  ORDER BY ss.fetched_at DESC
  LIMIT 1
) sc ON true;

CREATE OR REPLACE VIEW shipment_360.shipment_detail_view AS
SELECT
  l.*,
  COALESCE(containers.containers, '[]'::jsonb) AS containers
FROM shipment_360.shipment_list_view l
LEFT JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', bc.id::text,
      'containerNumber', bc.number,
      'containerType', bc.type,
      'containerSize', bc.type,
      'grossWeightKg', bc.gross_weight_kg,
      'netWeightKg', bc.net_weight_kg,
      'packageCount', bc.packages,
      'sealNumber', bc.seal_number
    )
    ORDER BY bc.item_index NULLS LAST, bc.number ASC
  ) AS containers
  FROM aiextraction.bill_of_lading_containers bc
  JOIN aiextraction.bills_of_lading bol ON bol.id = bc.bill_of_lading_id
  JOIN public.documents d ON d.id = bol.document_id
  WHERE d.shipment_id::text = l.id
    AND COALESCE(bc.number, '') <> ''
) containers ON true;
