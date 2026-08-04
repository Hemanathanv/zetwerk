CREATE SCHEMA IF NOT EXISTS docgen;

CREATE OR REPLACE VIEW docgen.v_packing_list_source AS
SELECT
  d.id AS source_document_id,
  d.uploaded_by,
  d.created_at,
  si.id AS sales_invoice_id,
  si.invoice_no,
  si.invoice_date,
  si.buyer_po_no,
  si.buyer_po_date,
  si.zetwerk_ref,
  si.other_references,
  si.exporter_name,
  si.exporter_address,
  si.buyer_name,
  si.buyer_address,
  si.consignee_name,
  si.consignee_address,
  si.gstin,
  si.iec,
  si.ship_to,
  si.port_of_loading,
  si.port_of_discharge,
  si.country_of_origin,
  si.country_of_final_destination,
  si.final_destination,
  si.place_of_receipt,
  si.vessel_flight_no,
  si.gross_weight,
  si.total_quantity,
  si.pre_carriage_by,
  si.signatory_name,
  si.signatory_designation,
  si.din_number,
  si.raw_data,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'hsnCode', li.hsn_code,
        'productCode', li.product_code,
        'productDescription', li.product_description,
        'productSpecification', li.product_specification,
        'packageDescription', li.package_description,
        'productMarks', li.product_marks,
        'quantity', li.quantity,
        'quantityTotal', li.quantity_total,
        'noOfPackages', li.no_of_packages,
        'kindOfPkg', li.kind_of_pkg,
        'containerNo', li.container_no,
        'sealNo', li.seal_no,
        'lineTotal', li.line_total
      )
      ORDER BY li.id
    ) FILTER (WHERE li.id IS NOT NULL),
    '[]'::jsonb
  ) AS line_items
FROM public.documents d
JOIN aiextraction.sales_invoice_extractions si ON si.document_id = d.id
LEFT JOIN aiextraction.sales_invoice_line_items li ON li.sales_invoice_id = si.id
WHERE d.is_deleted = false
GROUP BY d.id, si.id;

CREATE OR REPLACE VIEW docgen.v_us_packing_list_source AS
SELECT
  pl_doc.id AS packing_list_document_id,
  bol_doc.id AS bol_document_id,
  pl.id AS packing_list_id,
  bol.id AS bill_of_lading_id,
  pl.invoice_no,
  pl.buyer_po_no,
  pl.zetwerk_ref,
  pl.country_of_origin,
  pl.pickup_address,
  pl.total_qty,
  pl.total_bundles,
  pl.total_gross_weight_kgs,
  bol.bol_number,
  bol.project_name,
  bol.carrier_company_name,
  bol.shipper_name,
  bol.consignee_name,
  bol.consignee_address,
  COALESCE(
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'productCode', pli.product_code,
        'productDescription', pli.product_description,
        'totalQtyInPcs', pli.total_qty_in_pcs,
        'noOfBundles', pli.no_of_bundles,
        'grossWeightKgs', pli.gross_weight_kgs,
        'netWeightKgs', pli.net_weight_kgs,
        'containerNo', pli.container_no,
        'sealNo', pli.seal_no
      )
    ) FILTER (WHERE pli.id IS NOT NULL),
    '[]'::jsonb
  ) AS line_items,
  COALESCE(
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'containerNumber', bc.number,
        'sealNumber', bc.seal_number,
        'containerSize', bc.type,
        'grossWeightKg', bc.gross_weight_kg,
        'netWeightKg', bc.net_weight_kg,
        'packages', bc.packages
      )
    ) FILTER (WHERE bc.id IS NOT NULL),
    '[]'::jsonb
  ) AS containers
FROM public.documents pl_doc
JOIN aiextraction.packing_list_extractions pl ON pl.document_id = pl_doc.id
JOIN aiextraction.bills_of_lading bol
  ON bol.export_invoice_number = pl.invoice_no
  OR bol.shipment_reference_number = pl.zetwerk_ref
  OR bol.export_invoice_number IS NULL
JOIN public.documents bol_doc ON bol_doc.id = bol.document_id AND bol_doc.is_deleted = false
LEFT JOIN aiextraction.packing_list_line_items pli ON pli.packing_list_id = pl.id
LEFT JOIN aiextraction.bill_of_lading_containers bc ON bc.bill_of_lading_id = bol.id
WHERE pl_doc.is_deleted = false
GROUP BY pl_doc.id, bol_doc.id, pl.id, bol.id;

CREATE OR REPLACE VIEW docgen.v_entry_summary_source AS
SELECT
  bol_doc.id AS bol_document_id,
  si_doc.id AS sales_invoice_document_id,
  bol.id AS bill_of_lading_id,
  si.id AS sales_invoice_id,
  bol.bol_number,
  bol.carrier_company_name,
  bol.shipped_on_board_date,
  bol.port_of_loading,
  bol.port_of_discharge,
  bol.consignee_name,
  bol.consignee_address,
  bol.notify_party_name,
  bol.country_of_origin AS bol_country_of_origin,
  bol.total_packages,
  bol.gross_weight_unit,
  si.invoice_no,
  si.total_amount,
  si.country_of_origin AS invoice_country_of_origin,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'productDescription', li.product_description,
        'lineTotal', li.line_total,
        'quantity', li.quantity,
        'unit', li.unit,
        'hsnCodeDestination', li.hsn_code_destination
      )
      ORDER BY li.id
    ) FILTER (WHERE li.id IS NOT NULL),
    '[]'::jsonb
  ) AS line_items,
  bol.export_shipping_bill_date,
  bol.country_of_origin,
  bol.notify_party_address,
  si.taxable_value,
  si.tax_amount,
  si.exporter_name,
  si.exporter_address
FROM public.documents bol_doc
JOIN aiextraction.bills_of_lading bol ON bol.document_id = bol_doc.id
JOIN aiextraction.sales_invoice_extractions si
  ON si.invoice_no = bol.export_invoice_number
  OR si.zetwerk_ref = bol.shipment_reference_number
  OR bol.export_invoice_number IS NULL
JOIN public.documents si_doc ON si_doc.id = si.document_id AND si_doc.is_deleted = false
LEFT JOIN aiextraction.sales_invoice_line_items li ON li.sales_invoice_id = si.id
WHERE bol_doc.is_deleted = false
GROUP BY bol_doc.id, si_doc.id, bol.id, si.id;

CREATE INDEX IF NOT EXISTS idx_docgen_documents_type_status_user
  ON public.documents (doc_type, status, uploaded_by, created_at)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_docgen_sales_invoice_invoice_no
  ON aiextraction.sales_invoice_extractions (invoice_no);

CREATE INDEX IF NOT EXISTS idx_docgen_sales_invoice_zetwerk_ref
  ON aiextraction.sales_invoice_extractions (zetwerk_ref);

CREATE INDEX IF NOT EXISTS idx_docgen_packing_list_invoice_no
  ON aiextraction.packing_list_extractions (invoice_no);

CREATE INDEX IF NOT EXISTS idx_docgen_packing_list_zetwerk_ref
  ON aiextraction.packing_list_extractions (zetwerk_ref);

CREATE INDEX IF NOT EXISTS idx_docgen_bol_number
  ON aiextraction.bills_of_lading (bol_number);

CREATE INDEX IF NOT EXISTS idx_docgen_bol_export_invoice_number
  ON aiextraction.bills_of_lading (export_invoice_number);

CREATE INDEX IF NOT EXISTS idx_docgen_bol_shipment_reference_number
  ON aiextraction.bills_of_lading (shipment_reference_number);
