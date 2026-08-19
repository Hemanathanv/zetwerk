from __future__ import annotations

import re
from typing import Any


def normalize_doc_type(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", str(value or "").strip().upper()).strip("_")


def normalize_key(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]+", "", str(value or "").upper())


def display_doc_type(doc_type: str | None) -> str:
    return normalize_doc_type(doc_type).replace("_", " ").title()


EXTRACTION_KEY_SOURCES: dict[str, dict[str, Any]] = {
    "SALES_INVOICE": {
        "table": "sales_invoice_extractions",
        "fields": {
            "invoice": ("invoice_no",),
            "shipping_bill": ("shipping_bill_no",),
            "project": ("zetwerk_ref",),
        },
    },
    "BILL_OF_LADING": {
        "table": "bills_of_lading",
        "fields": {
            "invoice": ("export_invoice_number",),
            "shipping_bill": ("export_shipping_bill_number",),
            "bl": ("bol_number", "shipment_reference_number", "mbl_number", "booking_reference_number"),
            "project": ("project_name",),
        },
    },
    "PACKING_LIST": {
        "table": "packing_list_extractions",
        "fields": {
            "invoice": ("invoice_no",),
        },
    },
    "SHIPPING_BILL": {
        "table": "shipping_bill_extractions",
        "fields": {
            "shipping_bill": ("sb_no",),
        },
    },
    "ENTRY_SUMMARY": {
        "table": "entry_summary_extractions",
        "fields": {
            "entry": ("filer_code_entry_number",),
            "bl": ("bl_or_awb_number", "additional_bls", "house_bill"),
        },
    },
    "DRAFT_CBP_FORM_7501_BROKER": {
        "table": "entry_summary_extractions",
        "fields": {
            "entry": ("filer_code_entry_number",),
            "bl": ("bl_or_awb_number", "additional_bls", "house_bill"),
        },
    },
    "US_SALES_INVOICE": {
        "table": "us_sales_invoice_extractions",
        "fields": {
            "invoice": ("invoice_no",),
            "packing_slip": ("so_no", "po_no"),
        },
    },
    "US_PACKING_LIST": {
        "table": "us_packing_list_extractions",
        "fields": {
            "packing_slip": ("packing_slip_number",),
            "bl": ("bol_number",),
            "project": ("project_name",),
        },
    },
    "ISF": {
        "table": "isf_extractions",
        "fields": {
            "bl": ("master_bl_number", "house_bl_number"),
            "container": ("container_number",),
        },
    },
    "US_CARGO_RELEASE_ORDER": {
        "table": "us_cargo_release_extractions",
        "fields": {
            "entry": ("entry_number",),
            "bl": ("master_bill_of_lading", "house_bill_1_and_2"),
        },
    },
    "US_CUSTOMS_RELEASE_ORDER": {
        "table": "us_customs_release_extractions",
        "fields": {
            "entry": ("entry_number",),
            "bl": ("bill_of_lading_information",),
            "container": ("containers",),
        },
    },
    "US_DELIVERY_ORDER": {
        "table": "us_delivery_order_extractions",
        "fields": {
            "entry": ("entry_number",),
            "bl": ("bl_or_awb_number", "master_number", "house_bill_numbers"),
            "container": ("container_number",),
        },
    },
    "GRN_INBOUND": {
        "table": "grn_inbound_extractions",
        "fields": {
            "container": ("container_number",),
        },
    },
    "PORT_TO_WH": {
        "table": "port_to_wh_extractions",
        "fields": {
            "bl": ("shipment_id", "mbl", "customer_reference_number"),
            "container": ("container_number",),
            "project": ("customer_reference_number",),
        },
    },
    "WH_TO_CUSTOMER": {
        "table": "wh_to_customer_extractions",
        "fields": {
            "packing_slip": ("shipment_number", "po_number"),
            "invoice": ("po_number",),
            "project": ("shipment_number",),
        },
    },
    "OCEAN_FREIGHT": {
        "table": "ocean_freight_extractions",
        "fields": {
            "bl": ("ocean_bol", "house_bol"),
            "invoice": ("invoice_number",),
        },
    },
    "FREIGHT_FORWARDER_BILL": {
        "table": "freight_forwarder_bill_extractions",
        "fields": {
            "bl": ("ocean_bol", "house_bol"),
            "invoice": ("customer_invoice_numbers", "invoice_number"),
            "project": ("project_name",),
        },
    },
    "CUSTOMER_BROKER_BILL": {
        "table": "customer_broker_bill_extractions",
        "fields": {
            "bl": ("ocean_bol", "house_bol"),
            "entry": ("entry_number",),
            "invoice": ("supplier_invoice_numbers", "invoice_number"),
        },
    },
    "CHA_BILL": {
        "table": "cha_bill_extractions",
        "fields": {
            "bl": ("shipment_mbl", "shipment_hbl", "booking_number"),
            "invoice": ("invoice_number",),
            "shipping_bill": ("job_doc_number",),
            "project": ("job_project_name", "customer_shipment_number", "shipment_order_reference"),
        },
    },
}


def extraction_source(doc_type: str | None) -> dict[str, Any] | None:
    return EXTRACTION_KEY_SOURCES.get(normalize_doc_type(doc_type))


def all_key_types() -> list[str]:
    values: set[str] = set()
    for source in EXTRACTION_KEY_SOURCES.values():
        values.update(source["fields"].keys())
    return sorted(values)
