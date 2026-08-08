import asyncio
import html
import json
import os
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import unquote_plus
from uuid import uuid4

import boto3
import duckdb

from db import close_prisma, get_prisma
from objectstore import s3

REGION = os.getenv("AWS_REGION") or os.getenv("S3_REGION", "ap-south-1")
QUEUE_URL = os.getenv(
    "ZATA_SQS_QUEUE_URL",
    os.getenv("SQS_QUEUE_URL", "https://sqs.ap-south-1.amazonaws.com/006952506255/ewms-zata-upload-queue"),
)
IMPORT_UPLOADED_BY = os.getenv("ZATA_IMPORT_UPLOADED_BY", os.getenv("PARQUET_IMPORT_UPLOADED_BY", "system"))
IMPORT_STATUS = os.getenv("ZATA_IMPORT_STATUS", os.getenv("PARQUET_IMPORT_STATUS", "REVIEWED")).upper()
PREVIEW_PREFIX = os.getenv(
    "ZATA_PREVIEW_PREFIX",
    os.getenv("PARQUET_IMPORT_PREVIEW_PREFIX", "zw-ewms-zata-files/generated-previews/sales-invoice"),
).strip("/")
PROCESSED_PREFIX = os.getenv("ZATA_PROCESSED_PREFIX", "zw-ewms-zata-files/processed").strip("/")
MOVE_TO_PROCESSED = os.getenv("ZATA_MOVE_TO_PROCESSED", os.getenv("PARQUET_IMPORT_MOVE_TO_PROCESSED", "1")) == "1"
POLL_EMPTY_SLEEP_SECONDS = int(os.getenv("ZATA_SQS_EMPTY_SLEEP_SECONDS", "5"))
VISIBILITY_TIMEOUT_SECONDS = int(os.getenv("ZATA_SQS_VISIBILITY_TIMEOUT_SECONDS", "300"))
MAX_MESSAGES = int(os.getenv("ZATA_SQS_MAX_MESSAGES", "10"))
WAIT_TIME_SECONDS = int(os.getenv("ZATA_SQS_WAIT_TIME_SECONDS", "20"))

sqs = boto3.client("sqs", region_name=REGION)

SALES_INVOICE_FIELDS: dict[str, tuple[str, ...]] = {
    "ad_code": ("adnumber", "adcode", "ad_code"),
    "cin_no": ("cinno", "cin_no"),
    "gstin": ("gstno", "gstin"),
    "irn_number": ("irnnumber", "irn_number"),
    "pan_no": ("panno", "pan_no"),
    "rotation_no": ("rotationno", "rotation_no"),
    "signature": ("signature",),
    "buyer_name": ("customer_name", "customername", "buyername", "buyer_name", "buyer"),
    "buyer_address": ("customer_address", "buyeraddress", "buyer_address"),
    "consignee_name": ("consignee_name", "consigneename", "consignee"),
    "consignee_address": ("consignee_address", "consigneeaddress"),
    "exporter_name": ("exporter_name", "exportername", "company", "exporter"),
    "exporter_address": ("exporter_address", "exporteraddress"),
    "iec": ("exporterrefno", "iec"),
    "notify_party": ("notifyaddress_name", "notifyaddress_address", "notifyparty", "notify_party"),
    "ship_to": ("shiptoaddress_name", "shiptoaddress_address", "shipto", "ship_to"),
    "bank_name": ("bankname", "bank_name"),
    "bank_account_no": ("accountno", "bankaccountno", "bank_account_no"),
    "bank_branch": ("bankbranch", "bank_branch"),
    "currency": ("currency",),
    "ifsc_code": ("ifsccode", "ifsc_code"),
    "swift_code": ("swiftcode", "swift_code"),
    "incoterms": ("transportation_term", "transportationterm", "incoterms"),
    "payment_terms": ("payment_term", "paymentterms", "payment_terms"),
    "tax_amount": ("igst_value", "cgst_value", "sgst_value", "taxamount", "tax_amount"),
    "cess": ("cessamount", "cess"),
    "taxable_value": ("value_without_gst", "value_without_gst_inr", "taxablevalue", "taxable_value"),
    "total_amount": ("invoicevalue", "total_value_with_gst_inr", "invoicevalue_inr", "totalamount", "total_amount"),
    "invoice_no": ("invoicenumber", "invoice_no", "invoiceno", "invoice_number"),
    "invoice_date": ("invoicedate", "invoice_date"),
    "buyer_po_no": ("buyersponumber", "buyerpono", "buyer_po_no", "pono", "po_no"),
    "buyer_po_date": ("buyerspodate", "buyerpodate", "buyer_po_date", "podate", "po_date"),
    "zetwerk_ref": ("zetwerkreferencenumber", "contract", "zetwerkref", "zetwerk_ref"),
    "shipping_bill_no": ("shippingbillno", "shipping_bill_no"),
    "shipping_bill_date": ("shippingbilldate", "shipping_bill_date"),
    "exporter_email": ("exporteremail", "exporter_email"),
    "invoice_type": ("invoicetype", "invoice_type"),
    "lut_arn_no": ("lutno", "lutarnno", "lut_arn_no"),
    "issue_date": ("einvoiceacknowledgedate", "lutissuedate", "issuedate", "issue_date"),
    "other_references": ("buyerreferencenumber", "deliverychallannumber", "otherreferences", "other_references"),
    "dispatched_through": ("precarriageby", "dispatchedthrough", "dispatched_through"),
    "country_of_final_destination": ("finaldestination", "countryoffinaldestination", "country_of_final_destination"),
    "country_of_origin": ("goodsorigin", "countryoforigin", "country_of_origin"),
    "final_destination": ("finaldestination", "final_destination"),
    "place_of_receipt": ("preplaceofreceipt", "placeofreceipt", "place_of_receipt"),
    "port_of_discharge": ("dischargeport", "portofdischarge", "port_of_discharge"),
    "port_of_loading": ("loadingport", "portofloading", "port_of_loading"),
    "vessel_flight_no": ("vesselno", "vesselflightno", "vessel_flight_no"),
    "gross_weight": ("grossweight", "gross_weight"),
    "total_quantity": ("quantity", "item_unadjustedquantity", "totalquantity", "total_quantity"),
    "package_description": ("item_packagetype", "packagedescription", "package_description"),
    "pre_carriage_by": ("precarriageby", "pre_carriage_by"),
    "signatory_designation": ("signatorydesignation", "signatory_designation"),
    "signatory_name": ("signatoryname", "signatory_name"),
    "digital_signature_date": ("einvoiceacknowledgedate", "digitalsignaturedate", "digital_signature_date"),
    "digital_signature_location": ("digitalsignaturelocation", "digital_signature_location"),
    "digital_signature_timestamp": ("einvoiceacknowledgedate", "digitalsignaturetimestamp", "digital_signature_timestamp"),
    "receivables_assignment_notice": ("receivablesassignmentnotice", "receivables_assignment_notice"),
    "din_number": ("dinnumber", "din_number"),
    "digital_signature_status": ("irnstatus", "digitalsignaturestatus", "digital_signature_status"),
    "receivables_assignment_beneficiary": ("receivablesassignmentbeneficiary", "receivables_assignment_beneficiary"),
}

LINE_ITEM_FIELDS: dict[str, tuple[str, ...]] = {
    "hsn_code": ("hsncode", "itemhsncode", "itemsaccode", "hsn_code"),
    "hsn_code_destination": ("hsncodedestination", "hsn_code_destination"),
    "product_code": ("itemcode", "productcode", "product_code", "sku", "item_code"),
    "product_description": ("item_description", "item_name", "productdescription", "product_description", "description"),
    "product_specification": ("item_name", "productspecification", "product_specification"),
    "product_marks": ("item_marknumber", "productmarks", "product_marks"),
    "package_description": ("item_packagetype", "packagedescription", "package_description"),
    "no_of_packages": ("item_totalpackages", "noofpackages", "no_of_packages"),
    "quantity": ("quantity", "item_unadjustedquantity", "qty"),
    "quantity_total": ("item_unadjustedquantity", "quantitytotal", "quantity_total", "totalquantity"),
    "unit": ("uom", "unit"),
    "rate": ("unit_rate", "rate", "unitprice", "unit_price"),
    "line_total": ("value_without_gst", "total_value_with_gst_inr", "linetotal", "line_total", "amount"),
    "tax_rate": ("igst_rate", "cgst_rate", "sgst_rate", "taxrate", "tax_rate"),
    "tax_amount_per_line": ("igst_value", "cgst_value", "sgst_value", "taxamountperline", "tax_amount_per_line"),
    "kind_of_pkg": ("item_packagetype", "kindofpkg", "kind_of_pkg"),
    "container_no": ("containerno", "container_no"),
    "seal_no": ("sealno", "seal_no"),
    "bo_code": ("bocode", "bo_code"),
}

REQUIRED_SOURCE_COLUMNS = {
    "invoicenumber",
    "invoicedate",
    "customer_name",
    "exporter_name",
    "itemcode",
    "item_description",
    "quantity",
    "uom",
}
REQUIRED_INVOICE_FIELDS = ("invoice_no", "invoice_date", "buyer_name", "exporter_name")
REQUIRED_LINE_ITEM_FIELDS = ("product_code", "product_description", "quantity", "unit")


def _log(message: str) -> None:
    print(f"[sqs-zata] {message}", flush=True)


def _json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"none", "null", "nan", "nat"}:
        return None
    return text


def _normalized_key(value: str) -> str:
    return value.lower().replace(" ", "").replace("-", "").replace("_", "")


def _pick(row: dict[str, Any], aliases: tuple[str, ...]) -> str | None:
    normalized = {_normalized_key(key): value for key, value in row.items()}
    for alias in aliases:
        value = _clean(normalized.get(_normalized_key(alias)))
        if value is not None:
            return value
    return None


def _first_value(rows: list[dict[str, Any]], aliases: tuple[str, ...]) -> str | None:
    for row in rows:
        value = _pick(row, aliases)
        if value is not None:
            return value
    return None


def _read_parquet_records(local_path: str) -> list[dict[str, Any]]:
    con = duckdb.connect()
    try:
        result = con.execute("SELECT * FROM read_parquet(?)", [local_path])
        columns = [column[0] for column in result.description]
        return [dict(zip(columns, row)) for row in result.fetchall()]
    finally:
        con.close()


def _missing_source_columns(records: list[dict[str, Any]]) -> list[str]:
    if not records:
        return ["<no rows>"]
    return sorted(REQUIRED_SOURCE_COLUMNS - set(records[0].keys()))


def _build_invoice_payload(rows: list[dict[str, Any]]) -> dict[str, str | None]:
    return {column: _first_value(rows, aliases) for column, aliases in SALES_INVOICE_FIELDS.items()}


def _build_line_item_payload(row: dict[str, Any]) -> dict[str, str | None]:
    return {column: _pick(row, aliases) for column, aliases in LINE_ITEM_FIELDS.items()}


def _validation_errors(invoice: dict[str, str | None], line_items: list[dict[str, str | None]]) -> list[str]:
    errors = [f"missing invoice field {field}" for field in REQUIRED_INVOICE_FIELDS if not invoice.get(field)]
    valid_line_items = 0
    for index, item in enumerate(line_items, start=1):
        missing = [field for field in REQUIRED_LINE_ITEM_FIELDS if not item.get(field)]
        if missing:
            errors.append(f"line {index} missing {', '.join(missing)}")
            continue
        valid_line_items += 1
    if valid_line_items == 0:
        errors.append("no valid line items")
    return errors


def _group_by_invoice(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for index, record in enumerate(records):
        invoice_no = _pick(record, SALES_INVOICE_FIELDS["invoice_no"])
        if invoice_no is None:
            _log(f"validation missing invoicenumber row={index}")
            continue
        grouped[invoice_no].append(record)
    return dict(grouped)


def _safe_file_token(value: str) -> str:
    token = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in value.strip())
    return token.strip("-") or "unknown"


def _build_preview_html(invoice: dict[str, str | None], line_items: list[dict[str, str | None]], source_uri: str) -> bytes:
    title = invoice.get("invoice_no") or "Sales Invoice"
    summary_fields = [
        ("Invoice No", invoice.get("invoice_no")),
        ("Invoice Date", invoice.get("invoice_date")),
        ("Buyer", invoice.get("buyer_name")),
        ("Consignee", invoice.get("consignee_name")),
        ("Exporter", invoice.get("exporter_name")),
        ("GSTIN", invoice.get("gstin")),
        ("Total Amount", invoice.get("total_amount")),
        ("PO No", invoice.get("buyer_po_no")),
        ("Zetwerk Ref", invoice.get("zetwerk_ref")),
        ("Port of Loading", invoice.get("port_of_loading")),
        ("Final Destination", invoice.get("final_destination")),
    ]
    summary_html = "".join(
        f"<div><strong>{html.escape(label)}</strong><span>{html.escape(value or '-')}</span></div>"
        for label, value in summary_fields
    )
    rows_html = "".join(
        "<tr>"
        f"<td>{idx}</td>"
        f"<td>{html.escape(item.get('product_code') or '')}</td>"
        f"<td>{html.escape(item.get('product_description') or '')}</td>"
        f"<td>{html.escape(item.get('quantity') or '')}</td>"
        f"<td>{html.escape(item.get('unit') or '')}</td>"
        f"<td>{html.escape(item.get('rate') or '')}</td>"
        f"<td>{html.escape(item.get('line_total') or '')}</td>"
        "</tr>"
        for idx, item in enumerate(line_items, start=1)
    )
    body = f"""<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <title>{html.escape(title)}</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 32px; color: #172026; }}
    h1 {{ font-size: 24px; margin: 0 0 6px; }}
    .source {{ color: #5b6570; font-size: 12px; margin-bottom: 24px; }}
    .grid {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }}
    .grid div {{ border: 1px solid #d8dee4; padding: 10px; border-radius: 6px; }}
    strong {{ display: block; font-size: 11px; color: #5b6570; text-transform: uppercase; margin-bottom: 4px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
    th, td {{ border: 1px solid #d8dee4; padding: 8px; text-align: left; vertical-align: top; }}
    th {{ background: #f6f8fa; }}
  </style>
</head>
<body>
  <h1>Sales Invoice {html.escape(title)}</h1>
  <div class=\"source\">Generated preview from {html.escape(Path(source_uri).name)}</div>
  <section class=\"grid\">{summary_html}</section>
  <table>
    <thead><tr><th>#</th><th>Product Code</th><th>Description</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Total</th></tr></thead>
    <tbody>{rows_html or '<tr><td colspan=\"7\">No line items found.</td></tr>'}</tbody>
  </table>
</body>
</html>"""
    return body.encode("utf-8")


async def _find_existing_invoice(prisma, invoice_no: str) -> dict[str, Any] | None:
    rows = await prisma.query_raw(
        """
        SELECT e.id::text AS extraction_id,
               e.document_id::text AS document_id,
               e.reviewed_at,
               d.status::text AS document_status
        FROM aiextraction.sales_invoice_extractions e
        JOIN public.documents d ON d.id = e.document_id
        WHERE e.invoice_no = $1
          AND COALESCE(d.is_deleted, FALSE) = FALSE
        ORDER BY
          CASE WHEN d.status::text = 'REVIEWED' AND e.reviewed_at IS NOT NULL THEN 0 ELSE 1 END,
          e.updated_at DESC
        LIMIT 1
        """,
        invoice_no,
    )
    return rows[0] if rows else None


def _is_approved_invoice(existing: dict[str, Any]) -> bool:
    return str(existing.get("document_status") or "") == "REVIEWED" and existing.get("reviewed_at") is not None


def _extraction_insert_sql(columns: list[str], placeholders: list[str]) -> str:
    return f"""
        INSERT INTO aiextraction.sales_invoice_extractions
        ({', '.join(columns)})
        VALUES ({', '.join(placeholders)})
    """


def _extraction_update_sql(fields: tuple[str, ...], raw_data_index: int, reviewed_by_index: int) -> str:
    assignments = [f"{field} = ${idx}" for idx, field in enumerate(fields, start=3)]
    assignments.extend([
        f"raw_data = ${raw_data_index}::jsonb",
        "extracted_at = NOW()",
        f"reviewed_by = ${reviewed_by_index}",
        f"reviewed_at = CASE WHEN ${reviewed_by_index} IS NOT NULL THEN NOW() ELSE NULL END",
        "updated_at = NOW()",
    ])
    return f"""
        UPDATE aiextraction.sales_invoice_extractions
        SET {', '.join(assignments)}
        WHERE id = $1::uuid AND document_id = $2::uuid
    """


async def _persist_invoice(
    prisma,
    *,
    bucket: str,
    source_key: str,
    invoice_no: str,
    invoice: dict[str, str | None],
    line_items: list[dict[str, str | None]],
    original_rows: list[dict[str, Any]],
) -> str | None:
    existing = await _find_existing_invoice(prisma, invoice_no)
    if existing and _is_approved_invoice(existing):
        _log(f"existing approved invoice skipped invoiceNo={invoice_no} documentId={existing['document_id']}")
        return None

    is_update = existing is not None
    document_id = str(existing["document_id"] if existing else uuid4())
    extraction_id = str(existing["extraction_id"] if existing else uuid4())
    reviewed_by = IMPORT_UPLOADED_BY if IMPORT_STATUS == "REVIEWED" else None
    preview_html = _build_preview_html(invoice, line_items, f"s3://{bucket}/{source_key}")
    preview_key = f"{PREVIEW_PREFIX}/{_safe_file_token(invoice_no)}-{document_id}.html"
    raw_data = {
        "sourceType": "PARQUET_IMPORT",
        "sourceBucket": bucket,
        "sourceObjectKey": source_key,
        "previewObjectKey": preview_key,
        "invoiceNumber": invoice_no,
        "rowCount": len(original_rows),
        "originalRows": original_rows,
        "importedAt": datetime.now(timezone.utc).isoformat(),
    }

    s3.put_object(Bucket=bucket, Key=preview_key, Body=preview_html, ContentType="text/html; charset=utf-8")

    fields = tuple(SALES_INVOICE_FIELDS.keys())
    field_values = [invoice.get(field) for field in fields]
    raw_json = json.dumps(raw_data, default=_json_default)

    try:
        async with prisma.tx() as tx:
            if is_update:
                await tx.execute_raw(
                    """
                    UPDATE public.documents
                    SET status = $2::public."DocumentStatus",
                        bucket = $3,
                        object_key = $4,
                        file_name = $5,
                        content_type = $6,
                        size_bytes = $7,
                        total_pages = 1,
                        updated_at = NOW()
                    WHERE id = $1::uuid
                    """,
                    document_id,
                    IMPORT_STATUS,
                    bucket,
                    preview_key,
                    f"SI-{_safe_file_token(invoice_no)}.html",
                    "text/html; charset=utf-8",
                    len(preview_html),
                )
                await tx.execute_raw(
                    _extraction_update_sql(fields, raw_data_index=len(field_values) + 3, reviewed_by_index=len(field_values) + 4),
                    extraction_id,
                    document_id,
                    *field_values,
                    raw_json,
                    reviewed_by,
                )
                await tx.execute_raw(
                    "DELETE FROM aiextraction.sales_invoice_line_items WHERE sales_invoice_id = $1::uuid",
                    extraction_id,
                )
            else:
                columns = [
                    "id",
                    "document_id",
                    *fields,
                    "raw_data",
                    "extracted_at",
                    "reviewed_by",
                    "reviewed_at",
                    "created_at",
                    "updated_at",
                ]
                placeholders = ["$1::uuid", "$2::uuid"]
                values: list[Any] = [extraction_id, document_id]
                for value in field_values:
                    values.append(value)
                    placeholders.append(f"${len(values)}")
                values.extend([raw_json, reviewed_by])
                raw_data_placeholder = f"${len(values) - 1}::jsonb"
                reviewed_by_placeholder = f"${len(values)}"
                placeholders.extend([
                    raw_data_placeholder,
                    "NOW()",
                    reviewed_by_placeholder,
                    f"CASE WHEN {reviewed_by_placeholder} IS NOT NULL THEN NOW() ELSE NULL END",
                    "NOW()",
                    "NOW()",
                ])
                await tx.execute_raw(
                    """
                    INSERT INTO public.documents
                    (id, doc_type, status, bucket, object_key, file_name, content_type, size_bytes, total_pages, uploaded_by, is_deleted, created_at, updated_at)
                    VALUES ($1::uuid, 'SALES_INVOICE'::public."DocType", $2::public."DocumentStatus", $3, $4, $5, $6, $7, 1, $8, FALSE, NOW(), NOW())
                    """,
                    document_id,
                    IMPORT_STATUS,
                    bucket,
                    preview_key,
                    f"SI-{_safe_file_token(invoice_no)}.html",
                    "text/html; charset=utf-8",
                    len(preview_html),
                    IMPORT_UPLOADED_BY,
                )
                await tx.execute_raw(_extraction_insert_sql(columns, placeholders), *values)

            for item in line_items:
                await tx.execute_raw(
                    """
                    INSERT INTO aiextraction.sales_invoice_line_items
                    (id, sales_invoice_id, hsn_code, hsn_code_destination, product_code, product_description,
                     product_specification, product_marks, package_description, no_of_packages, quantity,
                     quantity_total, unit, rate, line_total, tax_rate, tax_amount_per_line, kind_of_pkg,
                     container_no, seal_no, bo_code)
                    VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                    """,
                    str(uuid4()),
                    extraction_id,
                    item.get("hsn_code"),
                    item.get("hsn_code_destination"),
                    item.get("product_code"),
                    item.get("product_description"),
                    item.get("product_specification"),
                    item.get("product_marks"),
                    item.get("package_description"),
                    item.get("no_of_packages"),
                    item.get("quantity"),
                    item.get("quantity_total"),
                    item.get("unit"),
                    item.get("rate"),
                    item.get("line_total"),
                    item.get("tax_rate"),
                    item.get("tax_amount_per_line"),
                    item.get("kind_of_pkg"),
                    item.get("container_no"),
                    item.get("seal_no"),
                    item.get("bo_code"),
                )

            await tx.execute_raw(
                """
                INSERT INTO public.document_pages
                (id, document_id, page_no, bucket, object_key, size_bytes, raw_text, is_extraction_source, created_at)
                VALUES ($1::uuid, $2::uuid, 1, $3, $4, $5, $6, TRUE, NOW())
                ON CONFLICT (document_id, page_no)
                DO UPDATE SET bucket = EXCLUDED.bucket,
                              object_key = EXCLUDED.object_key,
                              size_bytes = EXCLUDED.size_bytes,
                              raw_text = EXCLUDED.raw_text,
                              is_extraction_source = TRUE
                """,
                str(uuid4()),
                document_id,
                bucket,
                preview_key,
                len(preview_html),
                json.dumps(invoice, default=_json_default),
            )
    except Exception:
        s3.delete_object(Bucket=bucket, Key=preview_key)
        raise

    action = "updated" if is_update else "inserted"
    _log(f"{action} invoice invoiceNo={invoice_no} documentId={document_id} preview=s3://{bucket}/{preview_key}")
    return document_id


async def import_records(prisma, *, bucket: str, source_key: str, records: list[dict[str, Any]]) -> list[str]:
    missing = _missing_source_columns(records)
    if missing:
        _log(f"validation missing required source columns source=s3://{bucket}/{source_key} columns={', '.join(missing)}")
        return []

    grouped = _group_by_invoice(records)
    _log(f"invoice_count={len(grouped)} source=s3://{bucket}/{source_key}")
    changed_document_ids: list[str] = []
    for invoice_no, invoice_rows in grouped.items():
        invoice = _build_invoice_payload(invoice_rows)
        line_items = [_build_line_item_payload(row) for row in invoice_rows]
        errors = _validation_errors(invoice, line_items)
        if errors:
            _log(f"validation skipped invoiceNo={invoice_no} errors={'; '.join(errors)}")
            continue
        document_id = await _persist_invoice(
            prisma,
            bucket=bucket,
            source_key=source_key,
            invoice_no=invoice_no,
            invoice=invoice,
            line_items=line_items,
            original_rows=invoice_rows,
        )
        if document_id:
            changed_document_ids.append(document_id)
    return changed_document_ids


async def transform_parquet(prisma, bucket: str, key: str) -> list[str]:
    if not key.lower().endswith(".parquet"):
        _log(f"skipping non-parquet object s3://{bucket}/{key}")
        return []

    _log(f"processing s3://{bucket}/{key}")
    with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as tmp:
        local_path = tmp.name
    try:
        s3.download_file(bucket, key, local_path)
        records = _read_parquet_records(local_path)
        return await import_records(prisma, bucket=bucket, source_key=key, records=records)
    finally:
        if os.path.exists(local_path):
            os.remove(local_path)


def move_to_processed(bucket: str, key: str) -> str:
    filename = key.split("/")[-1]
    processed_key = f"{PROCESSED_PREFIX}/{filename}"
    if processed_key == key:
        return key
    s3.copy_object(Bucket=bucket, CopySource={"Bucket": bucket, "Key": key}, Key=processed_key)
    s3.delete_object(Bucket=bucket, Key=key)
    return processed_key


def _s3_records_from_message(message: dict[str, Any]) -> list[tuple[str, str]]:
    body = json.loads(message.get("Body") or "{}")
    if isinstance(body.get("Message"), str):
        try:
            body = json.loads(body["Message"])
        except json.JSONDecodeError:
            pass
    records: list[tuple[str, str]] = []
    for record in body.get("Records", []):
        try:
            bucket = record["s3"]["bucket"]["name"]
            key = unquote_plus(record["s3"]["object"]["key"])
            records.append((bucket, key))
        except Exception as exc:
            _log(f"invalid s3 event record skipped error={exc}")
    return records


async def process_message(prisma, message: dict[str, Any]) -> None:
    for bucket, key in _s3_records_from_message(message):
        changed_document_ids = await transform_parquet(prisma, bucket, key)
        _log(f"changed_documents={len(changed_document_ids)} object=s3://{bucket}/{key}")
        if MOVE_TO_PROCESSED and key.lower().endswith(".parquet"):
            processed_key = move_to_processed(bucket, key)
            _log(f"moved object=s3://{bucket}/{processed_key}")


async def run_worker() -> None:
    prisma = await get_prisma()
    _log(f"worker started queue={QUEUE_URL} region={REGION}")
    try:
        while True:
            response = sqs.receive_message(
                QueueUrl=QUEUE_URL,
                MaxNumberOfMessages=MAX_MESSAGES,
                WaitTimeSeconds=WAIT_TIME_SECONDS,
                VisibilityTimeout=VISIBILITY_TIMEOUT_SECONDS,
            )
            messages = response.get("Messages", [])
            if not messages:
                await asyncio.sleep(POLL_EMPTY_SLEEP_SECONDS)
                continue

            for message in messages:
                try:
                    await process_message(prisma, message)
                    sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=message["ReceiptHandle"])
                    _log("sqs message deleted")
                except Exception as exc:
                    _log(f"message failed error={exc}")
    finally:
        await close_prisma()


if __name__ == "__main__":
    asyncio.run(run_worker())
