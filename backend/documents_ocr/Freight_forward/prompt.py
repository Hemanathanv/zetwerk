"""Prompt generation for Freight Forward OCR.

Self-contained, FLAT structure: every scalar field is a top-level key in the
TEMPLATE the LLM sees. Section grouping inside the pydantic model is for
persistence only — exposing sections to the LLM caused fields to silently
drop when the heuristic bucketed them into the wrong section.

To improve extraction for a specific Freight Forward field that's coming back null
or mis-formatted, add an entry to CURATED_EXAMPLES below with the format
you want the LLM to mimic.
"""

from __future__ import annotations

import json
from typing import Any, get_args, get_origin

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Field examples — what the TEMPLATE shows the LLM as a format anchor.
# LLMs reproduce the SHAPE of example values (date style, ID pattern, units),
# so realistic placeholders produce far better extraction than bare `null`s.
# ---------------------------------------------------------------------------

# Field-name -> example. Wins over heuristics. For fields with strict formats
# (regulatory IDs, ISO codes, container/HSN/port patterns). Add entries here
# when you spot LLM mis-formats in real runs of Freight Forward docs.
CURATED_EXAMPLES: dict[str, str] = {
    "gstin": "29ABCDE1234F1Z5",
    "gstNumber": "29ABCDE1234F1Z5",
    "panNo": "ABCDE1234F",
    "panNumber": "ABCDE1234F",
    "cinNo": "U70200KA2020PTC123456",
    "cinNumber": "U70200KA2020PTC123456",
    "iec": "0312345678",
    "iecNumber": "0312345678",
    "irn": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
    "irnNumber": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
    "lutArnNo": "AD0723240012345",
    "lutNumber": "AD0723240012345",
    "tanNumber": "BLRX12345Y",
    "adCode": "0510079",
    "vatNumber": "GB123456789",
    "hsnCode": "73089030",
    "hsnCodeDestination": "73089030",
    "hsCode": "73089030",
    "htsCode": "7308.30.5050",
    "usHsnc": "7308.30.5050",
    "lineHtsusNumber": "7308.30.5050",
    "swiftCode": "HDFCINBBXXX",
    "bankSwiftCode": "HDFCINBBXXX",
    "swift": "HDFCINBBXXX",
    "ifscCode": "HDFC0001234",
    "bankIfscCode": "HDFC0001234",
    "bankIban": "GB29NWBK60161331926819",
    "bankRoutingNumber": "021000021",
    "routingNumber": "021000021",
    "accountNumber": "00123456789012",
    "bankAccountNo": "00123456789012",
    "bankAccountNumber": "00123456789012",
    "bankName": "HDFC Bank Ltd",
    "bankBranch": "Whitefield, Bangalore",
    "containerNumber": "MSCU1234567",
    "containerNo": "MSCU1234567",
    "sealNumber": "SEAL789456",
    "sealNo": "SEAL789456",
    "vesselName": "MAERSK SENTOSA",
    "vesselFlag": "Singapore",
    "voyageNumber": "VOY-2024-128W",
    "vesselVoyageNumber": "VOY-2024-128W",
    "imoNumber": "9778791",
    "imoLloyds": "9778791",
    "mawb": "020-12345678",
    "hawb": "HAWB123456789",
    "blDate": "15-Mar-2024",
    "oceanBol": "MEDUMK1234567",
    "houseBol": "HBL-IN-2024-0987",
    "bolNumber": "MEDUMK1234567",
    "portOfLoading": "NHAVA SHEVA (INNSA1)",
    "loadingPort": "NHAVA SHEVA (INNSA1)",
    "portOfDischarge": "LOS ANGELES (USLAX)",
    "dischargingPort": "LOS ANGELES (USLAX)",
    "placeOfReceipt": "BANGALORE, INDIA",
    "placeOfAcceptance": "BANGALORE, INDIA",
    "placeOfDelivery": "LOS ANGELES, CA, USA",
    "finalDestination": "LOS ANGELES, CA, USA",
    "transhipmentPlace": "SINGAPORE",
    "countryOfOrigin": "INDIA",
    "countryOfFinalDestination": "UNITED STATES",
    "incoterms": "FOB",
    "incoTerms": "FOB",
    "paymentTerms": "Net 30 days from B/L date",
    "currency": "USD",
    "vesselFlightNo": "MAERSK SENTOSA / 128W",
    "signature": "true",
    "negotiability": "NEGOTIABLE",
    "documentCategory": "ORIGINAL",
    "freightPayableAt": "BANGALORE, INDIA",
    "freightType": "PREPAID",
    "freightAmount": "1250.00",
    "fobCharges": "FOB MUMBAI",
    "totalPackages": "10",
    "totalContainers": "2",
    "numberOfOriginals": "3",
    "issuancePlace": "BANGALORE, INDIA",
    "issuanceDate": "15-Mar-2024",
    "packageSummary": "10 WOODEN CASES",
    "grossWeight": "12450.500",
    "grossWeightKg": "12450.500",
    "netWeight": "11890.000",
    "netWeightKg": "11890.000",
    "grossWeightUnit": "KGS",
    "netWeightUnit": "KGS",
    "weight": "12450.500 KGS",
    "weightLbs": "27450.50",
    "measurementCbm": "28.450",
    "cargoVolumeCbm": "28.450",
    "volumeFt3": "1004.5",
    "volume": "28.450 CBM",
    "cargoWeightKg": "12450.500",
    "cargoNetWeightKg": "11890.000",
    "cargoGrossWeightKg": "12450.500",
}


# Ordered (token_set, example). First match wins, so specific tokens (date,
# email, address) come before generic ones (number, no, code).
HEURISTIC_RULES: tuple[tuple[tuple[str, ...], str], ...] = (
    (("date", "etd", "eta"), "15-Mar-2024"),
    (("timestamp",), "11:58:14"),
    (("email",), "operations@example.com"),
    (("phone", "contactphone"), "+1-555-123-4567"),
    (("website",), "https://example.com"),
    (("address",), "1234 Industrial Park Rd, Houston, TX 77002, USA"),
    (("city",), "Houston"),
    (("state",), "TX"),
    (("zip",), "77002"),
    (("country",), "INDIA"),
    (("amount", "subtotal", "duty", "tax", "value", "balance", "discount", "credit", "rate", "cost", "fee"), "12500.00"),
    (("percent",), "5.00"),
    (("days",), "30"),
    (("quantity", "qty", "pieces", "pcs", "packages", "bundles", "pallets", "count", "units"), "150"),
    (("contactname", "signatoryname", "declarantname", "receivedby", "preparedby", "name"), "Acme Logistics Pvt Ltd"),
    (("designation", "title"), "Director"),
    (("invoiceno", "invoicenumber"), "INV-2024-00123"),
    (("ponumber", "pono", "buyerpono"), "PO-2024-987654"),
    (("sono",), "SO-2024-456"),
    (("ordernumber", "orderreference"), "ORD-2024-7890"),
    (("shipmentnumber", "shipmentid"), "SHP-2024-1122"),
    (("jobnumber",), "JOB-2024-5566"),
    (("entrynumber",), "112-3456789-0"),
    (("filercodeentrynumber",), "ABC-1234567-8"),
    (("declarationnumber",), "DECL-2024-77889"),
    (("rotationno",), "ROT-2024-0042"),
    (("bookingnumber",), "BKG-2024-3344"),
    (("consolnumber",), "CONS-2024-2211"),
    (("ackreference", "referencenumber", "customerreference", "brokerreference", "ourreference",
      "customerid"), "REF-2024-9988"),
    (("zetwerkref",), "ZW-2024-12345"),
    (("shippingbillno", "shippingbillnumber"), "1234567"),
    (("freightbillnumber",), "FB-2024-7766"),
    (("dinnumber",), "01234567"),
    (("description", "remarks", "notes", "note", "goods"), "Steel structural components, IS 2062 Grade E250, ASTM A36"),
    (("specification",), "MS Steel plate, 12mm thick, 2500x1250 mm, Grade IS 2062 E250"),
    (("marks",), "ZWK-PO-987654 / 1 OF 10"),
    (("packaging", "kindofpkg"), "WOODEN CASES"),
    (("packagesummary", "packagedescription"), "10 WOODEN CASES"),
    (("partcode", "productcode", "itemcode", "boCode", "portcode", "formcode"), "WB-G-FG-CB141-6085"),
    (("number", "no", "ref", "id", "code", "index"), "REF-2024-9988"),
)


def example_for_field(field_name: str) -> str:
    """Realistic example value for the given camelCase field name."""
    if field_name in CURATED_EXAMPLES:
        return CURATED_EXAMPLES[field_name]
    lowered = field_name.lower()
    for tokens, example in HEURISTIC_RULES:
        for token in tokens:
            if token in lowered:
                return example
    return "Sample value"


# ---------------------------------------------------------------------------
# Pydantic-model introspection -> FLAT example payload
# ---------------------------------------------------------------------------

def _unwrap_annotation(annotation: Any) -> Any:
    """Strip Optional[...] / Union[..., None] wrappers only."""
    origin = get_origin(annotation)
    if origin is None:
        return annotation
    args = get_args(annotation)
    if type(None) not in args:
        return annotation
    non_none_args = [arg for arg in args if arg is not type(None)]
    if len(non_none_args) == 1:
        return non_none_args[0]
    return annotation


def _is_model_type(annotation: Any) -> bool:
    target = _unwrap_annotation(annotation)
    return isinstance(target, type) and issubclass(target, BaseModel)


def _is_list_of_models(annotation: Any) -> bool:
    target = _unwrap_annotation(annotation)
    origin = get_origin(target)
    if origin not in (list, tuple):
        return False
    args = get_args(target)
    if not args:
        return False
    item = _unwrap_annotation(args[0])
    return isinstance(item, type) and issubclass(item, BaseModel)


def _array_field_schema(model: type[BaseModel]) -> dict[str, list[str]]:
    schema = getattr(model, "__array_field_schema__", None)
    return schema if isinstance(schema, dict) else {}


def _example_value_for_leaf(field_name: str, default: Any) -> Any:
    """Use the model's default if it's a real string (enum-like); else an example."""
    if isinstance(default, str) and default.strip():
        return default
    return example_for_field(field_name)


def _build_flat_example_payload(model: type[BaseModel]) -> dict[str, Any]:
    """All scalar fields lift to top-level keys. Arrays stay nested."""
    example: dict[str, Any] = {}
    array_schema = _array_field_schema(model)

    for field_name, field_info in model.model_fields.items():
        annotation = field_info.annotation

        if _is_model_type(annotation):
            # Section sub-model: lift its scalar fields to the top level.
            nested_model = _unwrap_annotation(annotation)
            for nested_name, nested_info in nested_model.model_fields.items():
                nested_default = nested_info.default
                if nested_info.is_required() or nested_default.__class__.__name__ == "PydanticUndefinedType":
                    nested_default = None
                example[nested_name] = _example_value_for_leaf(nested_name, nested_default)
            continue

        if _is_list_of_models(annotation):
            item_model = _unwrap_annotation(get_args(_unwrap_annotation(annotation))[0])
            example[field_name] = [
                {nested_name: example_for_field(nested_name) for nested_name in item_model.model_fields.keys()}
            ]
            continue

        if field_name in array_schema:
            example[field_name] = [
                {nested_name: example_for_field(nested_name) for nested_name in array_schema[field_name]}
            ]
            continue

        default = field_info.default
        if field_info.is_required() or default.__class__.__name__ == "PydanticUndefinedType":
            default = None
        example[field_name] = _example_value_for_leaf(field_name, default)

    for array_name, nested_fields in array_schema.items():
        if array_name in example:
            continue
        example[array_name] = [
            {nested_name: example_for_field(nested_name) for nested_name in nested_fields}
        ]

    return example


def _collect_array_names(model: type[BaseModel]) -> list[str]:
    arrays: list[str] = []
    array_schema = _array_field_schema(model)
    for field_name, field_info in model.model_fields.items():
        if _is_list_of_models(field_info.annotation):
            arrays.append(field_name)
        elif field_name in array_schema:
            arrays.append(field_name)

    for array_name in array_schema:
        if array_name not in arrays:
            arrays.append(array_name)

    return arrays


def _resolve_document_type(model: type[BaseModel], fallback: str) -> str:
    field = model.model_fields.get("documentType")
    if field is None:
        return fallback
    default = field.default
    if isinstance(default, str) and default.strip():
        return default.strip()
    return fallback


def _build_output_rules(model: type[BaseModel], document_type: str, extractor_label: str) -> str:
    arrays = _collect_array_names(model)

    rules: list[str] = [
        "Return **one JSON object only** (no markdown fences, no commentary).",
        f'Top-level JSON must include `documentType`: "{document_type}".',
        "**Every key from the TEMPLATE must appear in the output, in the same place, with the same name.** Do not rename, drop, or wrap keys.",
        "**Every scalar leaf is a string** (camelCase keys, string values). Use `null` only when the field is genuinely absent from the PDF.",
        "**TEMPLATE values are FORMAT EXAMPLES** (date style, ID patterns, units) — do not copy them. Replace each example with the actual value visible in the PDF. If you cannot find a value, use `null`.",
        "Map PDF labels to the schema field name using semantic match (e.g. \"B/L No.\" -> `bolNumber`, \"Vessel/Voyage\" -> `vesselName`/`vesselVoyageNumber`). Synonyms and abbreviations count.",
        "Extract every visible value. Do not skip fields that look unimportant; partial extraction is the most common failure mode.",
    ]

    if arrays:
        names = ", ".join(f"`{n}`" for n in arrays)
        rules.append(
            f"**Arrays ({names})**: emit one object per row visible in the PDF, with the same property set in each row. Fill every cell in each row; use `null` only for cells that are truly blank."
        )
    if "containersList" in arrays:
        rules.append(
            "**containersList**: return one object per visible container. Split combined entries into `containerNumber` and `containerType` (for example `HASU5195236 40HC` or `HASU5195236/40HC` -> `containerNumber`: `HASU5195236`, `containerType`: `40HC`). Do not return a raw JSON string or comma-separated list."
        )
    if "charges" in arrays:
        rules.append(
            "**charges**: extract every visible charge row and every charge `description` from the table. Do not stop after the first charge. If a charge description wraps onto the next line, append it to the same row unless the next line clearly starts a new charge row. If the document shows N charge rows, output N objects in `charges`."
        )

    numbered = [f"{index}. {rule}" for index, rule in enumerate(rules, start=1)]
    return "OUTPUT RULES (critical):\n" + "\n".join(numbered)


def _build_dynamic_ocr_prompt(*, response_model: type[BaseModel], extractor_label: str) -> str:
    example_payload = _build_flat_example_payload(response_model)
    document_type = _resolve_document_type(response_model, extractor_label)

    intro = f"You are a precision OCR extractor for {extractor_label} documents. Extract every field visible in the PDF."
    rules = _build_output_rules(response_model, document_type, extractor_label)

    return "\n\n".join(
        [
            intro,
            rules,
            "TEMPLATE (the exact JSON shape to return — replace example values with real values from the PDF; use null when truly absent):\n"
            + json.dumps(example_payload, indent=2),
        ]
    )


def build_freight_forward_prompt(response_model: type[BaseModel]) -> str:
    return _build_dynamic_ocr_prompt(response_model=response_model, extractor_label="Freight Forward")


__all__ = ["build_freight_forward_prompt"]
