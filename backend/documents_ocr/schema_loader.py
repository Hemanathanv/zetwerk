"""Parse Prisma schema for a parent extraction model + its array relations.

Single source of truth: each extractor declares its Prisma model name and this
module derives scalar fields, array relations, and each array's item fields by
reading prisma/schema.prisma directly. Keeps Python field lists in sync with
DB schema without hand-editing two places.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


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
)


@dataclass(frozen=True)
class ExtractionSchema:
    """Schema derived from Prisma for one parent extraction model."""

    parent_model: str
    scalar_fields: list[str]
    array_fields: list[str]
    array_item_fields: dict[str, list[str]]


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
    per_child = extra_excluded_per_child or {}

    for array_name, child_model in array_refs:
        child_body = _iter_model_block(lines, child_model)
        child_excluded = excluded_fields | per_child.get(child_model, frozenset())
        child_scalars, _ = _parse_model_fields(child_body, excluded=child_excluded)
        array_fields.append(array_name)
        array_item_fields[array_name] = child_scalars

    return ExtractionSchema(
        parent_model=parent_model,
        scalar_fields=scalar_fields,
        array_fields=array_fields,
        array_item_fields=array_item_fields,
    )


__all__ = [
    "ExtractionSchema",
    "PRISMA_SCHEMA_FILE",
    "DEFAULT_EXCLUDED_FIELDS",
    "load_extraction_schema",
]
