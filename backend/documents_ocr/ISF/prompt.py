"""High-precision prompt builder for Importer Security Filing (ISF / 10+2)."""

from __future__ import annotations

import json
from typing import Any, get_args, get_origin

from pydantic import BaseModel


# Realistic values teach the OCR model the expected shape without constraining
# it to one carrier, broker, or form layout.
CURATED_EXAMPLES: dict[str, str] = {
    "source": "OpenRouter",
    "documentType": "ISF",
    "importerName": "ACME IMPORTS LLC",
    "formSubmittedByName": "JANE SMITH",
    "formSubmittedByCompany": "GLOBAL CUSTOMS BROKERS INC",
    "telephone": "+1 312-555-0188",
    "fax": "+1 312-555-0199",
    "email": "jane.smith@example.com",
    "transactionId": "ISF-123456789012",
    "blType": "House Bill of Lading",
    "masterBlNumber": "MAEU123456789",
    "bondType": "Importer",
    "bondTerm": "Continuous",
    "haveABondWithCbp": "Yes",
    "filerDocumentNumber": "12-345678900",
    "filerDocumentType": "EIN",
    "agentFilerCode": "ABC",
    "scacCode": "MAEU",
    "houseBlNumber": "HBL123456789",
    "masterBlType": "Master",
    "containerNumber": "MSCU1234567",
    "vesselNameAndVoyage": "MAERSK SENTOSA / 428W",
    "sailingDate": "06/15/2026",
    "destinationPort": "LOS ANGELES, CA (USLAX)",
    "estimatedDateArrivalPort": "07/02/2026",
    "consigneeName": "ACME IMPORTS LLC",
    "consigneeIrsTaxId": "12-3456789",
    "manufacturerName": "SHANGHAI COMPONENTS CO LTD",
    "poNumber": "PO-4500123456",
    "htsCode": "7308.90.9590",
    "productCode": "ZWK-COMP-1001",
    "countryOfOrigin": "CHINA",
}


def _address_examples(prefix: str, *, foreign: bool = False) -> dict[str, str]:
    return {
        f"{prefix}StreetAddress1": "88 INDUSTRIAL ROAD" if foreign else "1200 MARKET STREET",
        f"{prefix}StreetAddress2": "BUILDING 5" if foreign else "SUITE 400",
        f"{prefix}City": "SHANGHAI" if foreign else "CHICAGO",
        f"{prefix}{'Province' if foreign else 'State'}": "SHANGHAI" if foreign else "IL",
        f"{prefix}PostalCode": "200120" if foreign else "60601",
        f"{prefix}Country": "CHINA" if foreign else "UNITED STATES",
        f"{prefix}Contact": "JOHN DOE",
        f"{prefix}Telephone": "+86 21 5555 0100" if foreign else "+1 312-555-0100",
    }


for _prefix in ("consignee", "buyer", "shipTo"):
    CURATED_EXAMPLES.update(_address_examples(_prefix))
for _prefix in ("seller", "consolidator", "stuffingLocation"):
    CURATED_EXAMPLES.update(_address_examples(_prefix, foreign=True))
CURATED_EXAMPLES.update(
    {
        "buyerName": "ACME BUYING LLC",
        "shipToName": "ACME DISTRIBUTION CENTER",
        "sellerName": "GLOBAL EXPORTS LTD",
        "consolidatorName": "ASIA CONSOLIDATION SERVICES LTD",
        "stuffingLocationName": "SHANGHAI BONDED WAREHOUSE",
        "streetAddress1": "88 INDUSTRIAL ROAD",
        "streetAddress2": "BUILDING 5",
        "city": "SHANGHAI",
        "province": "SHANGHAI",
        "postalCode": "200120",
        "country": "CHINA",
    }
)


FIELD_GUIDANCE: dict[str, str] = {
    "transactionId": "CBP-generated ISF transaction identifier; never substitute a BL number.",
    "blType": "The BL type shown in the ISF Shipment and Filer Reference block, such as House Bill of Lading.",
    "masterBlNumber": "Master bill number only; do not put the type label here.",
    "masterBlType": "Master BL type/qualifier only; do not put the master BL number here.",
    "houseBlNumber": "House BL / HBL / B/L # when it identifies the house bill.",
    "bondType": "Bond owner/type exactly as printed, not the bond term.",
    "bondTerm": "Continuous or Single Transaction when printed.",
    "haveABondWithCbp": "Capture the printed Yes/No or equivalent response.",
    "filerDocumentNumber": "Document Number adjacent to Document Type in the filer-reference block.",
    "filerDocumentType": "Document Type adjacent to the filer Document Number, such as EIN/IRS/SSN.",
    "agentFilerCode": "Agent/Filer Code, filer code, or ABI filer code.",
    "scacCode": "Four-letter Standard Carrier Alpha Code; preserve capitalization.",
    "containerNumber": "ISO container number; do not return a seal number.",
    "vesselNameAndVoyage": "Keep vessel and voyage together exactly as printed.",
    "estimatedDateArrivalPort": "ETA/estimated arrival at the destination port, not sailing date.",
    "consigneeIrsTaxId": "Consignee IRS Tax ID/EIN; preserve punctuation and leading zeros.",
    "manufacturers": "One object per Manufacturer of Goods block, including every continuation page.",
    "htsCode": "HTS/HTSUS classification associated with this manufacturer/product; preserve dots.",
    "countryOfOrigin": "Country of origin of goods for this manufacturer entry, not seller address country.",
}


def _unwrap(annotation: Any) -> Any:
    origin = get_origin(annotation)
    if origin is None:
        return annotation
    args = get_args(annotation)
    if type(None) not in args:
        return annotation
    non_none = [arg for arg in args if arg is not type(None)]
    return non_none[0] if len(non_none) == 1 else annotation


def _list_item_model(annotation: Any) -> type[BaseModel] | None:
    target = _unwrap(annotation)
    if get_origin(target) is not list:
        return None
    args = get_args(target)
    if not args:
        return None
    item = _unwrap(args[0])
    return item if isinstance(item, type) and issubclass(item, BaseModel) else None


def _example(field_name: str) -> str:
    return CURATED_EXAMPLES.get(field_name, "Sample value")


def _build_template(model: type[BaseModel]) -> dict[str, Any]:
    template: dict[str, Any] = {}
    for field_name, field_info in model.model_fields.items():
        item_model = _list_item_model(field_info.annotation)
        if item_model is not None:
            template[field_name] = [
                {item_name: _example(item_name) for item_name in item_model.model_fields}
            ]
            continue
        default = field_info.default
        template[field_name] = default if isinstance(default, str) and default else _example(field_name)
    return template


def _field_guide() -> str:
    rows = [f"- `{field}`: {guidance}" for field, guidance in FIELD_GUIDANCE.items()]
    return "\n".join(rows)


def build_isf_prompt(result_model: type[BaseModel]) -> str:
    template = _build_template(result_model)
    return f"""You are a precision OCR extractor for US Importer Security Filing (ISF / 10+2) documents.
Your job is exhaustive transcription into the exact JSON shape below. Accuracy is more important than guessing.

OUTPUT RULES (critical):
1. Return one valid JSON object only. No markdown, explanation, prefixes, or trailing text.
2. Every key in the TEMPLATE must appear once, with exactly the same camelCase spelling and nesting.
3. Every scalar leaf must be a string or null. Never emit numbers, booleans, objects, or empty placeholder strings as scalar values.
4. TEMPLATE values are format examples only. Never copy an example unless that exact value is visible in the document.
5. Copy printed values faithfully, preserving punctuation, spaces, leading zeros, date style, ID separators, and capitalization.
6. Use null only after checking every page. Do not infer, calculate, translate, normalize, or invent missing values.
7. Match semantic label variants: B/L or BL means Bill of Lading; Phone/Tel means Telephone; Zip means Postal Code; Agent/Filer means filer code.
8. Keep each party in its own prefix. Never move a Seller address into Buyer, Consignee, Ship To, Consolidator, or Stuffing Location.
9. For repeated generic labels such as Name, City, Country, Contact, and Telephone, use the nearest section heading and visual boundary.
10. Read tables row-by-row and blocks top-to-bottom. Preserve the association between manufacturer, PO, HTS/product code, and country of origin.
11. `manufacturers` must contain one object per visible Manufacturer of Goods entry. Scan continuation pages and do not merge different manufacturers.
12. Do not duplicate a manufacturer because a header or first page is repeated in a continuation OCR request.
13. If no manufacturer is visible, return an empty `manufacturers` array. Within a manufacturer row, use null for a genuinely blank cell.
14. Set `source` to "OpenRouter" and `documentType` to "ISF".

CBP CONFIRMATION / ALTERNATE-LAYOUT RULES:
- In “ISF Shipment and Filer Reference”, map Transaction ID, BL Type, BL Number, Master Bill of Lading, Bond Type, Bond Term, bond response, Document Number, Document Type, and Agent/Filer Code to their dedicated keys.
- A CBP Transaction ID is not a house or master BL number.
- When two Buying Party entries appear, map them to Buyer and Ship To in printed order unless explicit headings say otherwise.
- Map the first Selling Party to Seller. Map the corresponding manufacturer/manufacturer-of-goods block to `manufacturers`.
- Seller, Consolidator, Stuffing Location, and Manufacturer addresses may be foreign. Capture them as printed without forcing US address conventions.

FIELD-SPECIFIC GUIDANCE:
{_field_guide()}

SELF-CHECK BEFORE RESPONDING:
- Output parses as JSON.
- All TEMPLATE keys are present and no extra keys were added.
- `manufacturers` is always an array of objects with the exact manufacturer key set.
- No example value remains unless it was actually printed.
- Transaction ID, house BL, master BL, SCAC, container, filer document, and IRS Tax ID were not confused.
- Every page was checked for additional manufacturers and party details.

TEMPLATE (replace examples with document values; use null when absent):
{json.dumps(template, indent=2, ensure_ascii=False)}
"""


__all__ = ["CURATED_EXAMPLES", "FIELD_GUIDANCE", "build_isf_prompt"]
