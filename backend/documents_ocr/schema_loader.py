"""Parse Prisma schema for a parent extraction model + its array relations.

Single source of truth: each extractor declares its Prisma model name and this
module derives scalar fields, array relations, and each array's item fields by
reading prisma/schema.prisma directly. Keeps Python field lists in sync with
DB schema without hand-editing two places.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import json
import re


PRISMA_SCHEMA_FILE = Path(__file__).resolve().parents[1] / "prisma" / "schema.prisma"

DEFAULT_EXCLUDED_FIELDS: frozenset[str] = frozenset(
    {
        "id",
        "documentId",
        "rawData",
        "extractedAt",
        "reviewedBy",
        "reviewedAt",
        "createdAt",
        "updatedAt",
        "document",
    }
)

# Child models reference back to their parent via these names; never extract.
_CHILD_BACKREF_SUFFIXES = (
    "billOfLading",
    "billOfLadingId",
    "salesInvoice",
    "salesInvoiceId",
    "entrySummary",
    "entrySummaryId",
    "oceanFreight",
    "oceanFreightId",
    "packingList",
    "packingListId",
    "customerBrokerBill",
    "customerBrokerBillId",
    "grnInbound",
    "grnInboundId",
    "portToWh",
    "portToWhId",
    "whToCustomer",
    "whToCustomerId",
    "usSalesInvoice",
    "usSalesInvoiceId",
    "usCargoRelease",
    "usCargoReleaseId",
    "usCustomsRelease",
    "usCustomsReleaseId",
    "usDeliveryOrder",
    "usDeliveryOrderId",
    "usPackingList",
    "usPackingListId",
    "freightForwarder",
    "freightForwarderId",
    "freightForwarderBill",
    "freightForwarderBillId",
    "shippingBill",
    "shippingBillId",
    "chaBill",
    "chaBillId",
    "isfExtraction",
    "isfExtractionId",
)


@dataclass(frozen=True)
class ExtractionSchema:
    """Schema derived from Prisma for one parent extraction model."""

    parent_model: str
    scalar_fields: list[str]
    array_fields: list[str]
    array_item_fields: dict[str, list[str]]
    array_child_models: dict[str, str]
    array_parent_fields: dict[str, str]


def _read_schema(schema_path: Path) -> list[str]:
    return schema_path.read_text(encoding="utf-8").splitlines()


def _iter_model_block(lines: list[str], model_name: str) -> list[str]:
    """Return the body lines of `model <model_name> { ... }`."""
    body: list[str] = []
    in_model = False
    for raw in lines:
        line = raw.strip()
        if not in_model:
            if line.startswith(f"model {model_name} ") and line.endswith("{"):
                in_model = True
            continue
        if line == "}":
            return body
        body.append(line)
    if not in_model:
        raise RuntimeError(f"Model {model_name} not found in Prisma schema")
    return body


def _is_relation_type(type_token: str) -> tuple[bool, str | None, bool]:
    """Inspect a Prisma type token.

    Returns (is_relation, target_model, is_array). Treats `String`, `Int`,
    `Decimal`, `Json`, `DateTime`, `Boolean`, `BigInt` (and their `?` variants)
    as scalars; anything else starting with an uppercase letter is a relation.
    """
    base = type_token.rstrip("?")
    is_array = base.endswith("[]")
    base = base.removesuffix("[]")
    scalar_types = {"String", "Int", "Decimal", "Json", "DateTime", "Boolean", "BigInt", "Float", "Bytes"}
    if base in scalar_types:
        return False, None, False
    if base and base[0].isupper():
        return True, base, is_array
    return False, None, False


def _parse_model_fields(
    body_lines: list[str],
    *,
    excluded: frozenset[str],
) -> tuple[list[str], list[tuple[str, str]]]:
    """Return (scalar_field_names, [(array_field_name, child_model), ...])."""
    scalars: list[str] = []
    arrays: list[tuple[str, str]] = []

    for line in body_lines:
        if not line or line.startswith("//") or line.startswith("@@") or line.startswith("@"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        field_name, type_token = parts[0], parts[1]
        if field_name in excluded:
            continue
        if field_name in _CHILD_BACKREF_SUFFIXES:
            continue
        is_rel, target, is_array = _is_relation_type(type_token)
        if is_rel:
            if is_array and target:
                arrays.append((field_name, target))
            # scalar relations (back-refs to parent) are skipped — child models
            # only appear as `[]` arrays on the parent extraction model.
            continue
        scalars.append(field_name)

    return scalars, arrays


def _parent_fk_field(body_lines: list[str], parent_model: str) -> str | None:
    for line in body_lines:
        if not line or line.startswith("//") or line.startswith("@@") or line.startswith("@"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        field_name, type_token = parts[0], parts[1].rstrip("?")
        if type_token == parent_model and "@relation" in line:
            match = re.search(r"fields:\s*\[([A-Za-z0-9_]+)\]", line)
            if match:
                return match.group(1)
            return f"{field_name}Id"
    return None


def prisma_accessor_name(model_name: str) -> str:
    return model_name.lower()


def _coerce_child_value(value: Any) -> Any:
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, (dict, list, tuple, set)):
        return json.dumps(value, ensure_ascii=False, default=str)
    return str(value)


def split_parent_and_child_data(
    *,
    schema: ExtractionSchema,
    extraction_data: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
    parent_data = dict(extraction_data)
    child_rows: dict[str, list[dict[str, Any]]] = {}

    for array_name in schema.array_fields:
        value = parent_data.pop(array_name, None)
        if not isinstance(value, list):
            continue
        allowed_fields = set(schema.array_item_fields.get(array_name, []))
        rows: list[dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            row = {
                key: _coerce_child_value(val)
                for key, val in item.items()
                if key in allowed_fields and val is not None
            }
            if row:
                rows.append(row)
        child_rows[array_name] = rows

    return parent_data, child_rows


def _unknown_field_from_error(error_text: str) -> str | None:
    path_match = re.search(r"Could not find field at `[^`]*\.(\w+)`", error_text)
    if path_match:
        return path_match.group(1)
    path_match = re.search(r"`[^`]*\.(\w+)`", error_text)
    if path_match and "Field does not exist in enclosing type" in error_text:
        return path_match.group(1)
    unknown_match = re.search(r"Unknown (?:arg|field) `(\w+)`", error_text)
    if unknown_match:
        return unknown_match.group(1)
    return None


async def upsert_extraction_with_children(
    *,
    prisma,
    model_accessor_name: str,
    schema: ExtractionSchema,
    document_id: str,
    extraction_data: dict[str, Any],
    strict_children: bool = False,
) -> Any:
    parent_data, child_rows = split_parent_and_child_data(schema=schema, extraction_data=extraction_data)
    create_data = {
        **parent_data,
        "documentId": document_id,
        "document": {"connect": {"id": document_id}},
    }
    model_accessor = getattr(prisma, model_accessor_name)

    extraction = None
    if not parent_data:
        extraction = await model_accessor.find_unique(where={"documentId": document_id})
    if extraction is None:
        for _ in range(20):
            try:
                extraction = await model_accessor.upsert(
                    where={"documentId": document_id},
                    data={
                        "create": create_data,
                        "update": parent_data,
                    },
                )
                break
            except Exception as exc:
                field_name = _unknown_field_from_error(str(exc))
                if not field_name:
                    raise
                had_update_field = field_name in parent_data
                had_create_field = field_name in create_data
                parent_data.pop(field_name, None)
                create_data.pop(field_name, None)
                if not had_update_field and not had_create_field:
                    raise
    if extraction is None:
        raise RuntimeError("Failed to persist extraction after dropping unsupported fields")

    extraction_id = str(getattr(extraction, "id"))
    for array_name, rows in child_rows.items():
        child_model = schema.array_child_models.get(array_name)
        parent_fk = schema.array_parent_fields.get(array_name)
        if not child_model or not parent_fk:
            continue
        child_accessor = getattr(prisma, prisma_accessor_name(child_model), None)
        if child_accessor is None:
            continue
        try:
            await child_accessor.delete_many(where={parent_fk: extraction_id})
        except Exception:
            if strict_children:
                raise
        for row in rows:
            try:
                await child_accessor.create(data={**row, parent_fk: extraction_id})
            except Exception:
                if strict_children:
                    raise

    return await model_accessor.find_unique(where={"documentId": document_id}) or extraction


def load_extraction_schema(
    *,
    parent_model: str,
    schema_path: Path = PRISMA_SCHEMA_FILE,
    excluded_fields: frozenset[str] = DEFAULT_EXCLUDED_FIELDS,
    extra_excluded_per_child: dict[str, frozenset[str]] | None = None,
) -> ExtractionSchema:
    """Parse the Prisma schema for `parent_model` and its array relations.

    `extra_excluded_per_child` lets a caller drop FK back-ref fields on a
    specific child model (e.g. `{"BillOfLadingExportInvoice": {"billOfLadingId"}}`).
    """
    lines = _read_schema(schema_path)

    parent_body = _iter_model_block(lines, parent_model)
    scalar_fields, array_refs = _parse_model_fields(parent_body, excluded=excluded_fields)

    array_fields: list[str] = []
    array_item_fields: dict[str, list[str]] = {}
    array_child_models: dict[str, str] = {}
    array_parent_fields: dict[str, str] = {}
    per_child = extra_excluded_per_child or {}

    for array_name, child_model in array_refs:
        child_body = _iter_model_block(lines, child_model)
        child_excluded = excluded_fields | per_child.get(child_model, frozenset())
        child_scalars, _ = _parse_model_fields(child_body, excluded=child_excluded)
        array_fields.append(array_name)
        array_item_fields[array_name] = child_scalars
        array_child_models[array_name] = child_model
        parent_fk = _parent_fk_field(child_body, parent_model)
        if parent_fk:
            array_parent_fields[array_name] = parent_fk

    return ExtractionSchema(
        parent_model=parent_model,
        scalar_fields=scalar_fields,
        array_fields=array_fields,
        array_item_fields=array_item_fields,
        array_child_models=array_child_models,
        array_parent_fields=array_parent_fields,
    )


__all__ = [
    "ExtractionSchema",
    "PRISMA_SCHEMA_FILE",
    "DEFAULT_EXCLUDED_FIELDS",
    "load_extraction_schema",
    "prisma_accessor_name",
    "split_parent_and_child_data",
    "upsert_extraction_with_children",
]
