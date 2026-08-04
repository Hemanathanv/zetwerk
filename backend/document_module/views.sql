CREATE SCHEMA IF NOT EXISTS document_module;

CREATE OR REPLACE FUNCTION document_module.generate_shipment_id(
  bol_number TEXT,
  shipped_on_board_date TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN NULLIF(regexp_replace(COALESCE(bol_number, ''), '[^A-Za-z0-9]', '', 'g'), '') IS NULL
      OR length(regexp_replace(COALESCE(bol_number, ''), '[^A-Za-z0-9]', '', 'g')) < 4
      OR shipped_on_board_date IS NULL
    THEN NULL
    ELSE 'ZTW-' ||
      CASE
        WHEN trim(shipped_on_board_date) ~ '^\d{4}[-/]\d{2}[-/]\d{2}'
          THEN substring(trim(shipped_on_board_date), 3, 2)
            || substring(trim(shipped_on_board_date), 6, 2)
            || substring(trim(shipped_on_board_date), 9, 2)
        WHEN upper(trim(shipped_on_board_date)) ~ '^\d{1,2}-[A-Z]{3,9}-\d{4}$'
          THEN to_char(to_date(upper(trim(shipped_on_board_date)), 'DD-MON-YYYY'), 'YYMMDD')
        WHEN trim(shipped_on_board_date) ~ '^\d{1,2}[/. -]\d{1,2}[/. -]\d{4}$'
          THEN to_char(
            to_date(regexp_replace(trim(shipped_on_board_date), '[. /]', '-', 'g'), 'DD-MM-YYYY'),
            'YYMMDD'
          )
        ELSE NULL
      END
      || '-' || right(
        upper(regexp_replace(bol_number, '[^A-Za-z0-9]', '', 'g')),
        4
      )
  END
$$;

CREATE OR REPLACE VIEW document_module.v_shipment_gate_documents AS
SELECT
  d.id::text AS document_id,
  d.uploaded_by,
  d.doc_type::text AS doc_type,
  d.file_name,
  NULL::text AS document_number,
  CASE d.doc_type::text
    WHEN 'PACKING_LIST' THEN 1
    WHEN 'SALES_INVOICE' THEN 1
    WHEN 'SHIPPING_BILL' THEN 1
    WHEN 'CHA_BILL' THEN 1
    WHEN 'BILL_OF_LADING' THEN 2
    WHEN 'FREIGHT_FORWARDER_BILL' THEN 2
    WHEN 'ISF' THEN 3
    WHEN 'ENTRY_SUMMARY' THEN 3
    WHEN 'US_CARGO_RELEASE_ORDER' THEN 3
    WHEN 'US_CUSTOMS_RELEASE_ORDER' THEN 3
    WHEN 'OCEAN_FREIGHT' THEN 3
    WHEN 'CUSTOMER_BROKER_BILL' THEN 3
    WHEN 'US_DELIVERY_ORDER' THEN 4
    WHEN 'GRN_INBOUND' THEN 4
    WHEN 'PORT_TO_WH' THEN 4
    WHEN 'US_PACKING_LIST' THEN 5
    WHEN 'US_SALES_INVOICE' THEN 5
    WHEN 'WH_TO_CUSTOMER' THEN 5
    ELSE NULL
  END AS gate_number,
  CASE d.doc_type::text
    WHEN 'PACKING_LIST' THEN 'PL'
    WHEN 'SALES_INVOICE' THEN 'SI'
    WHEN 'SHIPPING_BILL' THEN 'SB'
    WHEN 'BILL_OF_LADING' THEN 'BL'
    WHEN 'ISF' THEN 'IS'
    WHEN 'ENTRY_SUMMARY' THEN 'BE'
    WHEN 'US_CARGO_RELEASE_ORDER' THEN 'CR'
    WHEN 'US_CUSTOMS_RELEASE_ORDER' THEN 'CU'
    WHEN 'US_DELIVERY_ORDER' THEN 'DO'
    WHEN 'GRN_INBOUND' THEN 'GR'
    WHEN 'US_PACKING_LIST' THEN 'UP'
    WHEN 'US_SALES_INVOICE' THEN 'UI'
    WHEN 'CHA_BILL' THEN 'CH'
    WHEN 'OCEAN_FREIGHT' THEN 'OF'
    WHEN 'FREIGHT_FORWARDER_BILL' THEN 'FF'
    WHEN 'CUSTOMER_BROKER_BILL' THEN 'BB'
    WHEN 'PORT_TO_WH' THEN 'PW'
    WHEN 'WH_TO_CUSTOMER' THEN 'WC'
    ELSE LEFT(d.doc_type::text, 3)
  END AS gate_code,
  d.doc_type::text IN (
    'CHA_BILL', 'OCEAN_FREIGHT', 'FREIGHT_FORWARDER_BILL',
    'CUSTOMER_BROKER_BILL', 'PORT_TO_WH', 'WH_TO_CUSTOMER'
  ) AS is_parallel,
  extraction.reviewed_at AS approved_at,
  extraction.extracted_at,
  extraction.extracted_data,
  CASE
    WHEN d.doc_type::text = 'BILL_OF_LADING' THEN
      document_module.generate_shipment_id(
        COALESCE(
          extraction.extracted_data->'raw_data'->>'mblNumber',
          extraction.extracted_data->'raw_data'->>'mbl_number',
          extraction.extracted_data->'raw_data'->>'masterBlNumber',
          extraction.extracted_data->'raw_data'->>'masterBillOfLadingNumber',
          extraction.extracted_data->'raw_data'->>'bookingReferenceNumber',
          extraction.extracted_data->'raw_data'->>'booking_reference_number',
          extraction.extracted_data->'rawData'->>'mblNumber',
          extraction.extracted_data->'rawData'->>'mbl_number',
          extraction.extracted_data->'rawData'->>'masterBlNumber',
          extraction.extracted_data->'rawData'->>'masterBillOfLadingNumber',
          extraction.extracted_data->'rawData'->>'bookingReferenceNumber',
          extraction.extracted_data->'rawData'->>'booking_reference_number',
          extraction.extracted_data->>'mbl_number',
          extraction.extracted_data->>'mblNumber',
          extraction.extracted_data->>'master_bl_number',
          extraction.extracted_data->>'masterBlNumber',
          extraction.extracted_data->>'booking_reference_number',
          extraction.extracted_data->>'bookingReferenceNumber',
          extraction.extracted_data->'raw_data'->>'bolNumber',
          extraction.extracted_data->'raw_data'->>'bol_number',
          extraction.extracted_data->'rawData'->>'bolNumber',
          extraction.extracted_data->>'bol_number',
          extraction.extracted_data->>'bolNumber'
        ),
        COALESCE(
          extraction.extracted_data->'raw_data'->>'shippedOnBoardDate',
          extraction.extracted_data->'raw_data'->>'shipped_on_board_date',
          extraction.extracted_data->'rawData'->>'shippedOnBoardDate',
          extraction.extracted_data->>'shipped_on_board_date',
          extraction.extracted_data->>'shippedOnBoardDate'
        )
      )
    ELSE NULL
  END AS shipment_id,
  3::integer AS mapping_version
FROM public.documents d
JOIN LATERAL (
  SELECT reviewed_at, extracted_at, to_jsonb(e) AS extracted_data
  FROM aiextraction.sales_invoice_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e)
    || jsonb_build_object(
      'export_invoices', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM aiextraction.bill_of_lading_export_invoices x WHERE x.bill_of_lading_id = e.id), '[]'::jsonb),
      'shipping_bills', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM aiextraction.bill_of_lading_shipping_bills x WHERE x.bill_of_lading_id = e.id), '[]'::jsonb)
    ) FROM aiextraction.bills_of_lading e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.packing_list_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.entry_summary_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.ocean_freight_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.freight_forwarder_bill_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.customer_broker_bill_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.grn_inbound_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.port_to_wh_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.wh_to_customer_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.us_sales_invoice_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.us_cargo_release_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.us_customs_release_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.us_delivery_order_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.us_packing_list_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.isf_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e)
    || jsonb_build_object(
      'invoice_references', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM aiextraction.shipping_bill_invoice_refs x WHERE x.shipping_bill_id = e.id), '[]'::jsonb)
    ) FROM aiextraction.shipping_bill_extractions e WHERE e.document_id = d.id
  UNION ALL SELECT reviewed_at, extracted_at, to_jsonb(e) FROM aiextraction.cha_bill_extractions e WHERE e.document_id = d.id
) extraction ON TRUE
WHERE d.is_deleted = FALSE
  AND d.status::text = 'REVIEWED'
  AND extraction.reviewed_at IS NOT NULL;
