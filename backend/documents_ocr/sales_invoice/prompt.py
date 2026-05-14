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


def _build_section_mapping(model: type[BaseModel]) -> list[str]:
    lines: list[str] = []
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

        lines.append(f"- `{field_name}` is a top-level field.")

    return lines


def _build_example_payload(model: type[BaseModel]) -> dict[str, Any]:
    example: dict[str, Any] = {}

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

        default = field_info.default if field_info.default is not None else None
        example[field_name] = default

    return example


def build_sales_invoice_prompt(response_model: type[BaseModel]) -> str:
    schema = response_model.model_json_schema()
    section_mapping = _build_section_mapping(response_model)
    example_payload = _build_example_payload(response_model)

    rules = [
        "You are a precision extractor for Sales Invoice documents.",
        "Return exactly one JSON object and no markdown.",
        "The JSON must follow the provided schema and section structure exactly.",
        "Use the field names from the schema exactly as written.",
        "Use null when a scalar value is not visible.",
        "For `lineItems`, return an array of row objects and include every visible line item.",
        "Do not add explanations, confidence scores, extra keys, or notes.",
        "Read all pages before responding.",
    ]

    return "\n\n".join(
        [
            "\n".join(rules),
            "SECTION MAPPING:\n" + "\n".join(section_mapping),
            "EXAMPLE OUTPUT SHAPE:\n" + json.dumps(example_payload, indent=2),
            "JSON SCHEMA:\n" + json.dumps(schema, indent=2),
        ]
    )


if __name__ == "__main__":
    import sys
    from pathlib import Path

    sys.path.append(
    str(Path(__file__).resolve().parents[3])
)
    from sales_invoice.ocr import (
    SalesInvoiceStructuredResult,
)
    prompt = build_sales_invoice_prompt(
        SalesInvoiceStructuredResult
    )

    print(prompt)

    print("\n" + "=" * 80)
    print("JSON SCHEMA")
    print("=" * 80)

    print(
        SalesInvoiceStructuredResult.model_json_schema()
    )
