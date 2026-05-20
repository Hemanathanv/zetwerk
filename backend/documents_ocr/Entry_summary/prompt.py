import json
from typing import Any, get_args, get_origin

from pydantic import BaseModel


def _unwrap_annotation(annotation: Any) -> Any:
    origin = get_origin(annotation)
    if origin is None:
        return annotation

    args = [arg for arg in get_args(annotation) if arg is not type(None)]
    if len(args) == 1:
        return _unwrap_annotation(args[0])
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
    return bool(args) and _is_model_type(args[0])


def _field_name_to_label(name: str) -> str:
    label = []
    for index, char in enumerate(name):
        if index > 0 and char.isupper() and not name[index - 1].isupper():
            label.append(" ")
        label.append(char)
    return "".join(label).strip()


def _array_field_schema(model: type[BaseModel]) -> dict[str, list[str]]:
    schema = getattr(model, "__array_field_schema__", None)
    return schema if isinstance(schema, dict) else {}


def _build_section_mapping(model: type[BaseModel]) -> list[str]:
    lines: list[str] = []
    array_schema = _array_field_schema(model)

    for field_name, field_info in model.model_fields.items():
        annotation = field_info.annotation

        if _is_model_type(annotation):
            nested_model = _unwrap_annotation(annotation)
            nested_fields = ", ".join(nested_model.model_fields.keys())
            lines.append(
                f"- `{field_name}` is an object section for {_field_name_to_label(field_name)} with fields: {nested_fields}."
            )
            continue

        if _is_list_of_models(annotation):
            item_model = _unwrap_annotation(get_args(_unwrap_annotation(annotation))[0])
            item_fields = ", ".join(item_model.model_fields.keys())
            lines.append(
                f"- `{field_name}` is an array of objects. Each row must use these fields: {item_fields}."
            )
            continue

        if field_name in array_schema:
            item_fields = ", ".join(array_schema[field_name])
            lines.append(
                f"- `{field_name}` is an array of objects. Each row must use these fields: {item_fields}."
            )
            continue

        lines.append(f"- `{field_name}` is a top-level field.")

    return lines


def _build_example_payload(model: type[BaseModel]) -> dict[str, Any]:
    example: dict[str, Any] = {}
    array_schema = _array_field_schema(model)

    for field_name, field_info in model.model_fields.items():
        annotation = field_info.annotation

        if _is_model_type(annotation):
            nested_model = _unwrap_annotation(annotation)
            example[field_name] = {
                nested_name: None for nested_name in nested_model.model_fields.keys()
            }
            continue

        if _is_list_of_models(annotation):
            item_model = _unwrap_annotation(get_args(_unwrap_annotation(annotation))[0])
            example[field_name] = [
                {nested_name: None for nested_name in item_model.model_fields.keys()}
            ]
            continue

        if field_name in array_schema:
            example[field_name] = [
                {nested_name: None for nested_name in array_schema[field_name]}
            ]
            continue

        default = field_info.default
        if field_info.is_required() or default.__class__.__name__ == "PydanticUndefinedType":
            default = None
        example[field_name] = default

    return example


def _collect_paths(model: type[BaseModel]) -> set[str]:
    paths: set[str] = set()
    array_schema = _array_field_schema(model)

    for field_name, field_info in model.model_fields.items():
        annotation = field_info.annotation

        if _is_model_type(annotation):
            nested_model = _unwrap_annotation(annotation)
            paths.add(field_name)
            for nested_name in nested_model.model_fields.keys():
                paths.add(f"{field_name}.{nested_name}")
            continue

        if _is_list_of_models(annotation):
            item_model = _unwrap_annotation(get_args(_unwrap_annotation(annotation))[0])
            paths.add(field_name)
            for nested_name in item_model.model_fields.keys():
                paths.add(f"{field_name}.{nested_name}")
            continue

        if field_name in array_schema:
            paths.add(field_name)
            for nested_name in array_schema[field_name]:
                paths.add(f"{field_name}.{nested_name}")
            continue

        paths.add(field_name)

    return paths


def _resolve_document_type(model: type[BaseModel], fallback: str) -> str:
    field = model.model_fields.get("documentType")
    if field is None:
        return fallback
    default = field.default
    if isinstance(default, str) and default.strip():
        return default.strip()
    return fallback


def _build_output_rules(model: type[BaseModel], document_type: str) -> str:
    paths = _collect_paths(model)
    has = paths.__contains__

    rules: list[str] = [
        "Respond with **one JSON object only** (no markdown fences).",
        f'Top-level keys **must** include `source`: "OpenRouter" and `documentType`: "{document_type}".',
        "**Raw values only**: every leaf value is a **string**, **boolean** (only for `compliance.signature`), or **null**. No confidence, evidence, notes, status, or reasoning in JSON.",
        "Use the **JSON keys** exactly as in the template (camelCase). Map PDF labels using schema field names and alternate labels.",
        "Include **every schema key exactly once** in the output JSON; never omit keys even when values are unavailable.",
    ]

    if has("lineItems"):
        rules.append("**lineItems**: one object per invoice/document line row; same property set each row.")

    single_location_chunks: list[str] = []
    if has("compliance.gstin"):
        single_location_chunks.append("**GSTIN** only under `compliance`")
    if has("entities.iec"):
        single_location_chunks.append("**IEC** only under `entities`")
    if has("header.invoiceNo") or has("header.invoiceDate"):
        single_location_chunks.append("**invoiceNo** / **invoiceDate** only under `header`")
    if has("header.buyerPoNo") or has("header.buyerPoDate"):
        single_location_chunks.append("**buyerPoNo** / **buyerPoDate** only under `header`")
    if any(has(path) for path in ("financial.bankName", "financial.swiftCode", "financial.ifscCode")):
        single_location_chunks.append("bank/SWIFT/IFSC/**bankName** only under `financial`")
    if has("header.shippingBillNo") or has("header.shippingBillDate"):
        single_location_chunks.append("shipping bill no/date only under `header`")
    if has("shipment.countryOfOrigin"):
        single_location_chunks.append("**countryOfOrigin** only under `shipment`")

    if single_location_chunks:
        rules.append(
            "**Single location per concept** (schema is deduplicated): " + "; ".join(single_location_chunks) + "."
        )

    if has("compliance.signature"):
        rules.append(
            "**compliance.signature**: set **true** if any authorized signatory stamp, wet signature, or signature block is **visible** on the PDF; **false** only if clearly absent."
        )

    if all(has(path) for path in ("lineItems.productCode", "lineItems.productDescription", "lineItems.productSpecification")):
        rules.append(
            "**Line items — three distinct fields**: `productCode` = SKU / internal part code only (e.g. `WB.G.FG.CB141.6085.1300.A.IN`). `productDescription` = **short** product **name** only (e.g. \"INTERIOR PILE\") — no full SKU, no long spec. `productSpecification` = **technical** spec only (dimensions, grade, material, finish, length) — **not** origin/certificate sentences. **Never** put HSN in `productDescription` — use `hsnCode` / `hsnCodeDestination` only."
        )

    if has("compliance.irnNumber"):
        rules.append(
            "**compliance.irnNumber**: when the PDF has an e-invoice **IRN** (label \"IRN Number\" / \"IRN\", metadata block, or **QR** payload / embedded IRN string), you **must** extract it — do not omit when visible."
        )

    if has("financial.incoterms"):
        rules.append(
            "**financial.incoterms**: incoterm **code** only (e.g. FOB, EXW) when possible; put longer terms-of-delivery prose in `financial.paymentTerms` if needed."
        )

    if has("header.invoiceType"):
        rules.append(
            "**header.invoiceType**: for Zetwerk-style PDFs, use the **full export/supply banner** (e.g. \"SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX\"), **not** the generic section heading \"Tax Invoice\"."
        )

    if has("lineItems.rate"):
        rule = "**lineItems**: use **`rate` only** for unit price (no separate `unitPrice`)."
        optional_chunks: list[str] = []
        if has("lineItems.noOfPackages"):
            optional_chunks.append("Fill **`noOfPackages`** per line when shown")
        if has("lineItems.kindOfPkg"):
            optional_chunks.append("Fill **`kindOfPkg`** (e.g. PKGS) when shown")
        if has("lineItems.productMarks"):
            optional_chunks.append("Put per-line marks in **`productMarks`**")
        if has("lineItems.boCode"):
            optional_chunks.append("Extract **`boCode`** from BO Code")
        if has("lineItems.containerNo") and has("lineItems.sealNo"):
            optional_chunks.append("Split combined CONTAINER NO / SEAL NO into **`containerNo`** and **`sealNo`**")
        if has("shipment.marksAndNumbers") and has("lineItems.productMarks"):
            optional_chunks.append("If only one line, set `shipment.marksAndNumbers` to `null` and keep marks in that line's `productMarks`")
        if optional_chunks:
            rule = rule + " " + "; ".join(optional_chunks) + "."
        rules.append(rule)

    if has("footer.digitalSignatureTimestamp") and has("footer.digitalSignatureDate"):
        rules.append(
            "**footer.digitalSignatureTimestamp**: **clock time only** (e.g. `11:58:14`, `20:48:50`) — **no** date in this field; use `footer.digitalSignatureDate` for the date."
        )

    if has("entities.buyerAddress"):
        rules.append(
            "**entities.buyerAddress**: fill when buyer block has an address distinct from consignee; may match consignee when same party."
        )

    if has("footer.receivablesAssignmentBeneficiary") and has("footer.receivablesAssignmentNotice"):
        rules.append(
            "**footer.receivablesAssignmentBeneficiary**: if the PDF includes a **receivables assignment** clause (same text as `receivablesAssignmentNotice`), you **must** extract the **named assignee entity** into `receivablesAssignmentBeneficiary` — never leave it null when the clause is present."
        )

    post_process_chunks: list[str] = ["Amounts/dates: you may output print-style strings"]
    if has("financial.currency"):
        post_process_chunks.append("ISO currency normalization")
    if has("header.invoiceDate"):
        post_process_chunks.append("DD-Mon-YYYY date normalization")
    if has("lineItems.hsnCode") or has("lineItems.hsnCodeDestination"):
        post_process_chunks.append("HSN dots/format cleanup")
    if has("entities.consigneeAddress") or has("entities.buyerAddress"):
        post_process_chunks.append("consignee/buyer address comma spacing")
    if has("footer.digitalSignatureTimestamp"):
        post_process_chunks.append("time-only digital signature timestamp")
    if has("shipment.marksAndNumbers") and has("lineItems.productMarks"):
        post_process_chunks.append("single-line shipment marks -> line + null shipment")
    if has("lineItems.productSpecification"):
        post_process_chunks.append("strip origin phrasing from `productSpecification`")
    if has("footer.receivablesAssignmentNotice") and has("footer.receivablesAssignmentBeneficiary"):
        post_process_chunks.append("infer beneficiary from notice text when missing")
    rules.append(
        "**Post-processing aware**: "
        + ", ".join(post_process_chunks[:-1])
        + (", and " + post_process_chunks[-1] if len(post_process_chunks) > 1 else post_process_chunks[0])
        + "."
    )

    numbered = [f"{index}. {rule}" for index, rule in enumerate(rules, start=1)]
    return "OUTPUT RULES (critical):\n" + "\n".join(numbered)


def _build_dynamic_ocr_prompt(*, response_model: type[BaseModel], extractor_label: str) -> str:
    schema = response_model.model_json_schema()
    section_mapping = _build_section_mapping(response_model)
    example_payload = _build_example_payload(response_model)
    document_type = _resolve_document_type(response_model, extractor_label)

    intro = f"You are a precision extractor for {extractor_label} documents."
    rules = _build_output_rules(response_model, document_type)

    return "\n\n".join(
        [
            intro,
            rules,
            "SECTION MAPPING:\n" + "\n".join(section_mapping),
            "TEMPLATE (shape and keys — replace values from the PDF):\n" + json.dumps(example_payload, indent=2),
            "JSON SCHEMA:\n" + json.dumps(schema, indent=2),
        ]
    )


def build_entry_summary_prompt(response_model: type[BaseModel]) -> str:
    return _build_dynamic_ocr_prompt(response_model=response_model, extractor_label="Entry Summary")
