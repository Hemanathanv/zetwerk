"""Cross-document OCR validation rules and comparison helpers.

Rules come from Validation_Rules_Breakbulk_Container 1.xlsx, with field keys
and alert/blocking behavior aligned to the legacy cross-validation engine from
ewms-repo1zip (1).zip.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from enum import StrEnum
import re
from typing import Any, Iterable, Mapping


DEFAULT_TEMPLATE_ID = "breakbulk-template"


class MatchType(StrEnum):
    EXACT = "EXACT"
    FUZZY_NAME = "FUZZY_NAME"
    NUMERIC_EXACT = "NUMERIC_EXACT"
    NUMERIC_TOLERANCE = "NUMERIC_TOLERANCE"
    PATTERN = "PATTERN"
    CONTAINS = "CONTAINS"
    SET_MATCH = "SET_MATCH"
    MASTER_DATA = "MASTER_DATA"


class BlockingBehavior(StrEnum):
    BLOCK = "BLOCK"
    WARN = "WARN"
    IGNORE = "IGNORE"


class ValidationStatus(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    WARNING = "WARNING"
    WAITING = "WAITING"
    SKIPPED = "SKIPPED"


@dataclass(frozen=True)
class CrossValidationRule:
    rule_code: str
    description: str
    source_doc_type: str
    source_field: str
    source_field_label: str
    target_doc_type: str
    target_field: str
    target_field_label: str
    match_type: MatchType
    blocking_behavior: BlockingBehavior
    tolerance: float | None = None
    active: bool = True


@dataclass(frozen=True)
class ValidationResult:
    rule_code: str
    status: ValidationStatus
    blocking_behavior: BlockingBehavior
    source_doc_type: str
    target_doc_type: str
    source_field: str
    target_field: str
    source_value: Any = None
    target_value: Any = None
    delta: str | None = None
    alert_level: str | None = None

    @property
    def is_blocking_failure(self) -> bool:
        return self.status == ValidationStatus.FAIL and self.blocking_behavior == BlockingBehavior.BLOCK

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["status"] = self.status.value
        payload["blocking_behavior"] = self.blocking_behavior.value
        return payload


@dataclass(frozen=True)
class ValidationSummary:
    total: int
    passed: int
    failed: int
    warnings: int
    waiting: int
    skipped: int
    blocking_failures: int
    results: list[ValidationResult]
    alerts: list[dict[str, Any]]

    @property
    def ok_to_progress(self) -> bool:
        return self.blocking_failures == 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "passed": self.passed,
            "failed": self.failed,
            "warnings": self.warnings,
            "waiting": self.waiting,
            "skipped": self.skipped,
            "blockingFailures": self.blocking_failures,
            "okToProgress": self.ok_to_progress,
            "alerts": self.alerts,
            "results": [result.to_dict() for result in self.results],
        }


RULES: tuple[CrossValidationRule, ...] = (
    CrossValidationRule("V-INV-01", "Exporter name matches BOL shipper", "SALES_INVOICE", "exporterName", "Exporter Name", "BILL_OF_LADING", "shipperName", "Shipper", MatchType.FUZZY_NAME, BlockingBehavior.BLOCK),
    CrossValidationRule("V-INV-02", "Buyer / consignee matches BOL consignee", "SALES_INVOICE", "buyerName", "Buyer Name", "BILL_OF_LADING", "consigneeName", "Consignee", MatchType.FUZZY_NAME, BlockingBehavior.BLOCK),
    CrossValidationRule("V-INV-03", "Invoice number format is valid", "SALES_INVOICE", "invoiceNo", "Invoice Number", "SELF", r"^(EXP\/|KA\/UM\/|IMM\/EXP\/)", "Pattern: EXP/ or KA/UM/ or IMM/EXP/", MatchType.PATTERN, BlockingBehavior.WARN),
    CrossValidationRule("V-INV-04", "PO number matches Packing List", "SALES_INVOICE", "buyerPoNo", "Buyer PO Number", "PACKING_LIST", "buyerPoNo", "Buyer PO Number", MatchType.EXACT, BlockingBehavior.BLOCK),
    CrossValidationRule("V-INV-05", "HSN code is valid steel code", "SALES_INVOICE", "lineItems[].hsnCode", "HSN Code", "SELF", r"^7308\.90", "Pattern: 7308.90.xx", MatchType.PATTERN, BlockingBehavior.WARN),
    CrossValidationRule("V-INV-06", "Exporter GSTIN matches Packing List GSTIN", "SALES_INVOICE", "gstin", "GSTIN", "PACKING_LIST", "gstin", "GSTIN", MatchType.EXACT, BlockingBehavior.BLOCK),
    CrossValidationRule("V-PL-01", "Invoice number matches Sales Invoice", "PACKING_LIST", "invoiceNo", "Invoice Number", "SALES_INVOICE", "invoiceNo", "Invoice Number", MatchType.EXACT, BlockingBehavior.BLOCK),
    CrossValidationRule("V-PL-02", "PO number matches Sales Invoice", "PACKING_LIST", "buyerPoNo", "Buyer PO Number", "SALES_INVOICE", "buyerPoNo", "PO Number", MatchType.EXACT, BlockingBehavior.BLOCK),
    CrossValidationRule("V-PL-03", "Bundle count matches Sales Invoice", "PACKING_LIST", "totalBundles", "Total Bundles", "SALES_INVOICE", "packageDescription", "Package count", MatchType.NUMERIC_EXACT, BlockingBehavior.BLOCK),
    CrossValidationRule("V-PL-04", "Total quantity matches Sales Invoice", "PACKING_LIST", "totalQty", "Total Qty (PCS)", "SALES_INVOICE", "totalQuantity", "Total Quantity", MatchType.NUMERIC_EXACT, BlockingBehavior.BLOCK),
    CrossValidationRule("V-PL-05", "Product codes match Sales Invoice line items", "PACKING_LIST", "lineItems[].productCode", "Product Code", "SALES_INVOICE", "lineItems[].productCode", "Product Code", MatchType.SET_MATCH, BlockingBehavior.BLOCK),
    CrossValidationRule("V-PL-06", "Gross weight reconcilable with Sales Invoice", "PACKING_LIST", "totalGrossWeightKgs", "Gross Weight (kg)", "SALES_INVOICE", "grossWeight", "Gross Weight", MatchType.NUMERIC_TOLERANCE, BlockingBehavior.WARN, 1.0),
    CrossValidationRule("V-BOL-01", "Shipper matches exporter on Sales Invoice", "BILL_OF_LADING", "shipperName", "Shipper", "SALES_INVOICE", "exporterName", "Exporter", MatchType.FUZZY_NAME, BlockingBehavior.BLOCK),
    CrossValidationRule("V-BOL-02", "Consignee matches buyer on Sales Invoice", "BILL_OF_LADING", "consigneeName", "Consignee", "SALES_INVOICE", "buyerName", "Buyer", MatchType.FUZZY_NAME, BlockingBehavior.BLOCK),
    CrossValidationRule("V-BOL-03", "Invoice numbers on BOL exist as Sales Invoices", "BILL_OF_LADING", "exportInvoiceNumber", "Export Invoice Numbers", "SALES_INVOICE", "invoiceNo", "Invoice Number", MatchType.SET_MATCH, BlockingBehavior.BLOCK),
    CrossValidationRule("V-BOL-04", "Gross weight matches sum of Packing Lists", "BILL_OF_LADING", "grossWeight", "Gross Weight", "PACKING_LIST", "totalGrossWeightKgs", "Gross Weight (sum)", MatchType.NUMERIC_TOLERANCE, BlockingBehavior.BLOCK, 1.0),
    CrossValidationRule("V-BOL-05", "Net weight matches sum of Packing Lists", "BILL_OF_LADING", "netWeight", "Net Weight", "PACKING_LIST", "totalNetWeightKgs", "Net Weight (sum)", MatchType.NUMERIC_TOLERANCE, BlockingBehavior.WARN, 1.0),
    CrossValidationRule("V-BOL-06", "Total packages match across Sales Invoices", "BILL_OF_LADING", "totalPackages", "Total Packages", "SALES_INVOICE", "totalQuantity", "Bundle count (sum)", MatchType.NUMERIC_EXACT, BlockingBehavior.BLOCK),
    CrossValidationRule("V-BOL-07", "Shipping bill numbers match uploaded Shipping Bills", "BILL_OF_LADING", "exportShippingBillNumber", "SB Numbers", "SHIPPING_BILL", "sbNo", "SB Number", MatchType.SET_MATCH, BlockingBehavior.BLOCK),
    CrossValidationRule("V-BOL-08", "Project name consistent with FF Bill", "BILL_OF_LADING", "projectName", "Project Name", "FREIGHT_FORWARDER_BILL", "projectName", "Project Name", MatchType.FUZZY_NAME, BlockingBehavior.WARN),
    CrossValidationRule("V-BOL-09", "Port of loading matches Shipping Bill", "BILL_OF_LADING", "portOfLoading", "Port of Loading", "SHIPPING_BILL", "portOfLoading", "Port of Loading", MatchType.FUZZY_NAME, BlockingBehavior.WARN),
    CrossValidationRule("V-SB-01", "Invoice numbers match Sales Invoice", "SHIPPING_BILL", "invoiceRefs[].invoiceNoAndDate", "Invoice Numbers", "SALES_INVOICE", "invoiceNo", "Invoice Number", MatchType.SET_MATCH, BlockingBehavior.BLOCK),
    CrossValidationRule("V-SB-02", "FOB value matches Sales Invoice total", "SHIPPING_BILL", "sectionCValueSummaryFobValue", "FOB Value", "SALES_INVOICE", "totalAmount", "Invoice Amount", MatchType.NUMERIC_TOLERANCE, BlockingBehavior.BLOCK, 0.5),
    CrossValidationRule("V-SB-03", "Consignee matches BOL", "SHIPPING_BILL", "consigneeNameAddress", "Consignee", "BILL_OF_LADING", "consigneeName", "Consignee", MatchType.FUZZY_NAME, BlockingBehavior.BLOCK),
    CrossValidationRule("V-SB-04", "Port of loading matches BOL", "SHIPPING_BILL", "portOfLoading", "Port of Loading", "BILL_OF_LADING", "portOfLoading", "Port of Loading", MatchType.FUZZY_NAME, BlockingBehavior.BLOCK),
    CrossValidationRule("V-SB-05", "Package count matches Packing List", "SHIPPING_BILL", "pkgCount", "No. of Packets", "PACKING_LIST", "totalBundles", "Total Bundles", MatchType.NUMERIC_EXACT, BlockingBehavior.BLOCK),
    CrossValidationRule("V-SB-06", "Exporter matches Sales Invoice", "SHIPPING_BILL", "exporterNameAddress", "Exporter", "SALES_INVOICE", "exporterName", "Exporter Name", MatchType.FUZZY_NAME, BlockingBehavior.WARN),
    CrossValidationRule("V-BOE-01", "BL number matches BOL", "ENTRY_SUMMARY", "blOrAwbNumber", "BL/AWB Number", "BILL_OF_LADING", "bolNumber", "BOL Number", MatchType.EXACT, BlockingBehavior.BLOCK),
    CrossValidationRule("V-BOE-02", "Importer of Record is expected entity", "ENTRY_SUMMARY", "importerOfRecordName", "Importer of Record", "MASTER_DATA", "importerOfRecord", "Expected importer name", MatchType.MASTER_DATA, BlockingBehavior.BLOCK),
    CrossValidationRule("V-BOE-03", "Total packages match BOL", "ENTRY_SUMMARY", "billQty", "Total Packages", "BILL_OF_LADING", "totalPackages", "Total Packages", MatchType.NUMERIC_EXACT, BlockingBehavior.BLOCK),
    CrossValidationRule("V-BOE-04", "Invoice references match BOL export invoices", "ENTRY_SUMMARY", "lineItems[].invoiceNumber", "Invoice References", "BILL_OF_LADING", "exportInvoices[].invoiceNumber", "Export Invoice Number", MatchType.SET_MATCH, BlockingBehavior.BLOCK),
    CrossValidationRule("V-BOE-05", "Gross weight reconcilable with BOL", "ENTRY_SUMMARY", "lineItems[].grossWeightKg", "Gross Weights (sum)", "BILL_OF_LADING", "grossWeight", "Gross Weight", MatchType.NUMERIC_TOLERANCE, BlockingBehavior.WARN, 2.0),
    CrossValidationRule("V-BOE-06", "Manufacturer ID matches exporter pattern", "ENTRY_SUMMARY", "manufacturerId", "Manufacturer ID", "SELF", "manufacturerIdPattern", "Expected MID pattern", MatchType.PATTERN, BlockingBehavior.WARN),
    CrossValidationRule("V-BOE-07", "Additional BLs match BOL number", "ENTRY_SUMMARY", "additionalBLs", "Additional BLs", "BILL_OF_LADING", "bolNumber", "BOL Number", MatchType.CONTAINS, BlockingBehavior.WARN),
    CrossValidationRule("V-BOE-08", "US port of unlading matches BOL discharge port", "ENTRY_SUMMARY", "usPortOfUnlading", "US Port of Unlading", "BILL_OF_LADING", "portOfDischarge", "Port of Discharge", MatchType.FUZZY_NAME, BlockingBehavior.BLOCK),
    CrossValidationRule("V-CHA-01", "Shipper matches exporter on Sales Invoice", "CHA_BILL", "shipmentShipper", "Shipper", "SALES_INVOICE", "exporterName", "Exporter", MatchType.FUZZY_NAME, BlockingBehavior.WARN),
    CrossValidationRule("V-CHA-02", "Consignee matches BOL consignee", "CHA_BILL", "shipmentConsignee", "Consignee", "BILL_OF_LADING", "consigneeName", "Consignee", MatchType.FUZZY_NAME, BlockingBehavior.WARN),
    CrossValidationRule("V-CHA-03", "Container numbers match BOL", "CHA_BILL", "containers[].containerNumber", "Containers", "BILL_OF_LADING", "containers[].number", "Container list", MatchType.SET_MATCH, BlockingBehavior.WARN),
    CrossValidationRule("V-CHA-04", "Vessel name matches BOL vessel", "CHA_BILL", "shipmentVesselName", "Vessel Name", "BILL_OF_LADING", "vesselName", "Vessel", MatchType.FUZZY_NAME, BlockingBehavior.WARN),
    CrossValidationRule("V-CHA-05", "Customer GSTIN matches Sales Invoice exporter GSTIN", "CHA_BILL", "customerGstin", "Customer GSTIN", "SALES_INVOICE", "gstin", "Exporter GSTIN", MatchType.EXACT, BlockingBehavior.WARN),
    CrossValidationRule("V-CHA-06", "QR total matches printed grand total", "CHA_BILL", "qrTotalInvValue", "QR Total Value", "SELF", "totalsGrandTotalInr", "Grand Total (INR)", MatchType.NUMERIC_EXACT, BlockingBehavior.WARN),
    CrossValidationRule("V-FF-01", "Shipper matches exporter on Sales Invoice", "FREIGHT_FORWARDER_BILL", "shipper", "Shipper", "SALES_INVOICE", "exporterName", "Exporter", MatchType.FUZZY_NAME, BlockingBehavior.WARN),
    CrossValidationRule("V-FF-02", "Consignee matches BOL consignee", "FREIGHT_FORWARDER_BILL", "consignee", "Consignee", "BILL_OF_LADING", "consigneeName", "Consignee", MatchType.FUZZY_NAME, BlockingBehavior.WARN),
    CrossValidationRule("V-FF-03", "Gross weight reconcilable with Packing List", "FREIGHT_FORWARDER_BILL", "cargoGrossWeightKg", "Gross Weight", "PACKING_LIST", "totalGrossWeightKgs", "Total Weight", MatchType.NUMERIC_TOLERANCE, BlockingBehavior.WARN, 1.0),
    CrossValidationRule("V-FF-04", "Container numbers match BOL", "FREIGHT_FORWARDER_BILL", "containers[].containerDetail", "Containers", "BILL_OF_LADING", "containers[].number", "Container list", MatchType.SET_MATCH, BlockingBehavior.WARN),
    CrossValidationRule("V-FF-05", "SB number matches Shipping Bill", "FREIGHT_FORWARDER_BILL", "sbNumbers", "SB Number", "SHIPPING_BILL", "sbNo", "SB Number", MatchType.EXACT, BlockingBehavior.WARN),
    CrossValidationRule("V-FF-06", "House/Master BL matches BOL number", "FREIGHT_FORWARDER_BILL", "houseBol", "House/Master BL", "BILL_OF_LADING", "bolNumber", "BOL Number", MatchType.EXACT, BlockingBehavior.WARN),
    CrossValidationRule("V-FF-07", "Customer invoice numbers match Sales Invoices", "FREIGHT_FORWARDER_BILL", "customerInvoiceNumbers", "Invoice Numbers", "SALES_INVOICE", "invoiceNo", "Invoice Number", MatchType.SET_MATCH, BlockingBehavior.WARN),
    CrossValidationRule("V-FF-08", "Project name matches BOL", "FREIGHT_FORWARDER_BILL", "projectName", "Project Name", "BILL_OF_LADING", "projectName", "Project Name", MatchType.FUZZY_NAME, BlockingBehavior.WARN),
    CrossValidationRule("V-OF-01", "Vessel name matches BOL", "OCEAN_FREIGHT", "vesselName", "Vessel Name", "BILL_OF_LADING", "vesselName", "Vessel", MatchType.FUZZY_NAME, BlockingBehavior.WARN),
    CrossValidationRule("V-OF-02", "Loading port matches BOL", "OCEAN_FREIGHT", "loadingPort", "Loading Port", "BILL_OF_LADING", "portOfLoading", "Port of Loading", MatchType.FUZZY_NAME, BlockingBehavior.WARN),
    CrossValidationRule("V-OF-03", "Container numbers match BOL", "OCEAN_FREIGHT", "containers[].containerDetail", "Containers", "BILL_OF_LADING", "containers[].number", "Container list", MatchType.SET_MATCH, BlockingBehavior.WARN),
    CrossValidationRule("V-OF-04", "Cargo weight reconcilable with BOL", "OCEAN_FREIGHT", "cargoWeightKg", "Cargo Weight", "BILL_OF_LADING", "grossWeight", "Total Cargo Weight", MatchType.NUMERIC_TOLERANCE, BlockingBehavior.WARN, 2.0),
    CrossValidationRule("V-OF-05", "BOL number matches", "OCEAN_FREIGHT", "oceanBol", "Ocean BOL", "BILL_OF_LADING", "bolNumber", "BOL Number", MatchType.EXACT, BlockingBehavior.WARN),
    CrossValidationRule("V-OF-06", "Discharge port matches BOL", "OCEAN_FREIGHT", "dischargingPort", "Discharge Port", "BILL_OF_LADING", "portOfDischarge", "Port of Discharge", MatchType.FUZZY_NAME, BlockingBehavior.WARN),
)

_RULE_OVERRIDES: dict[tuple[str, str], dict[str, Any]] = {}


def load_validation_rule_overrides(overrides: Mapping[tuple[str, str], Mapping[str, Any]]) -> None:
    _RULE_OVERRIDES.clear()
    for key, value in overrides.items():
        template_id, rule_code = key
        _RULE_OVERRIDES[(str(template_id), str(rule_code))] = dict(value)


def validation_rule_id(template_id: str, rule_code: str) -> str:
    return f"{template_id}:{rule_code}"


def split_validation_rule_id(rule_id: str) -> tuple[str, str]:
    template_id, separator, rule_code = str(rule_id or "").partition(":")
    if not separator or not template_id or not rule_code:
        raise ValueError("Validation rule id must be formatted as '<template-id>:<rule-code>'")
    return template_id, rule_code


def materialize_rule(rule: CrossValidationRule, *, template_id: str = DEFAULT_TEMPLATE_ID) -> CrossValidationRule:
    override = _RULE_OVERRIDES.get((template_id, rule.rule_code), {})
    blocking_behavior = override.get("blockingBehavior", rule.blocking_behavior.value)
    try:
        blocking_behavior_value = BlockingBehavior(str(blocking_behavior).upper())
    except ValueError:
        blocking_behavior_value = rule.blocking_behavior
    return replace(
        rule,
        active=bool(override.get("isActive", rule.active)),
        blocking_behavior=blocking_behavior_value,
        tolerance=override.get("tolerance", rule.tolerance),
    )


def validation_rule_row(rule: CrossValidationRule, *, template_id: str = DEFAULT_TEMPLATE_ID) -> dict[str, Any]:
    materialized = materialize_rule(rule, template_id=template_id)
    override = _RULE_OVERRIDES.get((template_id, rule.rule_code), {})
    return {
        "id": validation_rule_id(template_id, rule.rule_code),
        "templateId": template_id,
        "ruleCode": rule.rule_code,
        "description": rule.description,
        "sourceDocType": rule.source_doc_type,
        "sourceField": rule.source_field,
        "sourceFieldLabel": rule.source_field_label,
        "targetDocType": rule.target_doc_type,
        "targetField": rule.target_field,
        "targetFieldLabel": rule.target_field_label,
        "matchType": rule.match_type.value,
        "tolerance": materialized.tolerance,
        "blockingBehavior": materialized.blocking_behavior.value,
        "isActive": materialized.active,
        "statusHistory": override.get("statusHistory", []),
        "updatedAt": override.get("updatedAt"),
    }


def set_validation_rule_override(
    *,
    template_id: str,
    rule: CrossValidationRule,
    is_active: bool | None = None,
    blocking_behavior: str | None = None,
    tolerance: float | None = None,
    changed_by_id: str = "",
    changed_by_name: str = "",
) -> dict[str, Any]:
    from datetime import datetime

    current = validation_rule_row(rule, template_id=template_id)
    override = dict(_RULE_OVERRIDES.get((template_id, rule.rule_code), {}))
    history = list(override.get("statusHistory", []))

    def append_history(field: str, before: Any, after: Any) -> None:
        history.append({
            "field": field,
            "from": before,
            "to": after,
            "changedAt": datetime.utcnow().isoformat(),
            "changedById": changed_by_id,
            "changedByName": changed_by_name,
        })

    if is_active is not None and bool(is_active) != current["isActive"]:
        append_history("isActive", current["isActive"], bool(is_active))
        override["isActive"] = bool(is_active)

    if blocking_behavior is not None:
        behavior = str(blocking_behavior).strip().upper()
        if behavior not in {item.value for item in BlockingBehavior}:
            raise ValueError("Unsupported blocking behavior")
        if behavior != current["blockingBehavior"]:
            append_history("blockingBehavior", current["blockingBehavior"], behavior)
            override["blockingBehavior"] = behavior

    if tolerance is not None:
        override["tolerance"] = tolerance

    override["statusHistory"] = history[-20:]
    override["updatedAt"] = datetime.utcnow().isoformat()
    _RULE_OVERRIDES[(template_id, rule.rule_code)] = override
    return validation_rule_row(rule, template_id=template_id)


def get_rules_for_doc_type(doc_type: str, *, template_id: str = DEFAULT_TEMPLATE_ID) -> list[CrossValidationRule]:
    normalized = _normalize_doc_type(doc_type)
    rules = [materialize_rule(rule, template_id=template_id) for rule in RULES]
    return [rule for rule in rules if rule.active and rule.source_doc_type == normalized]


def run_cross_validation(
    *,
    source_doc_type: str,
    documents_by_type: Mapping[str, Any],
    rules: Iterable[CrossValidationRule] | None = None,
    master_data: Mapping[str, Any] | None = None,
) -> ValidationSummary:
    normalized_source_type = _normalize_doc_type(source_doc_type)
    active_rules = list(rules) if rules is not None else get_rules_for_doc_type(normalized_source_type)
    source_data = _document_data(documents_by_type, normalized_source_type)
    results: list[ValidationResult] = []

    if source_data is None:
        return _build_summary(results)

    for rule in active_rules:
        if not rule.active or rule.source_doc_type != normalized_source_type:
            continue
        source_value = extract_field_value(source_data, rule.source_field)

        if rule.target_doc_type == "SELF":
            if rule.match_type == MatchType.PATTERN:
                result = _compare(rule, source_value, rule.target_field)
            else:
                result = _compare(rule, source_value, extract_field_value(source_data, rule.target_field))
        elif rule.target_doc_type == "MASTER_DATA":
            target_value = extract_field_value(master_data or {}, rule.target_field)
            result = _compare(rule, source_value, target_value)
        else:
            target_data = _document_data(documents_by_type, rule.target_doc_type)
            if target_data is None:
                result = _result(
                    rule,
                    ValidationStatus.WAITING,
                    source_value=source_value,
                    delta=f"Waiting for {rule.target_doc_type}",
                )
            else:
                target_value = extract_field_value(target_data, rule.target_field)
                result = _compare(rule, source_value, target_value)
        results.append(result)

    return _build_summary(results)


def extract_field_value(data: Any, field_path: str | None) -> Any:
    if data is None or not field_path:
        return None
    if field_path.endswith("[]"):
        value = _walk_path(data, field_path[:-2])
        return _flatten(value)
    if "[]." in field_path:
        array_field, item_field = field_path.split("[].", 1)
        rows = _walk_path(data, array_field)
        if not isinstance(rows, list):
            return None
        values = [extract_field_value(row, item_field) for row in rows]
        return [value for value in _flatten(values) if _is_present(value)]
    return _walk_path(data, field_path)


def _compare(rule: CrossValidationRule, source_value: Any, target_value: Any) -> ValidationResult:
    if not _is_present(source_value):
        return _result(rule, ValidationStatus.SKIPPED, source_value=source_value, target_value=target_value, delta="Source field is empty")
    if not _is_present(target_value):
        return _result(rule, ValidationStatus.SKIPPED, source_value=source_value, target_value=target_value, delta="Target field is empty")

    if rule.match_type == MatchType.EXACT:
        status, delta = _exact_match(source_value, target_value)
    elif rule.match_type == MatchType.FUZZY_NAME:
        status, delta = _fuzzy_name_match(source_value, target_value)
    elif rule.match_type == MatchType.NUMERIC_EXACT:
        status, delta = _numeric_exact_match(source_value, target_value)
    elif rule.match_type == MatchType.NUMERIC_TOLERANCE:
        status, delta = _numeric_tolerance_match(source_value, target_value, rule.tolerance or 0)
    elif rule.match_type == MatchType.PATTERN:
        status, delta = _pattern_match(source_value, target_value)
    elif rule.match_type == MatchType.CONTAINS:
        status, delta = _contains_match(source_value, target_value)
    elif rule.match_type == MatchType.SET_MATCH:
        status, delta = _set_match(source_value, target_value)
    elif rule.match_type == MatchType.MASTER_DATA:
        status, delta = _fuzzy_name_match(source_value, target_value)
    else:
        status, delta = ValidationStatus.SKIPPED, f"Unknown match type: {rule.match_type}"

    return _result(rule, status, source_value=source_value, target_value=target_value, delta=delta)


def _exact_match(source: Any, target: Any) -> tuple[ValidationStatus, str | None]:
    source_text = str(source).strip()
    target_text = str(target).strip()
    if source_text == target_text:
        return ValidationStatus.PASS, None
    return ValidationStatus.FAIL, f'"{source_text}" != "{target_text}"'


def _fuzzy_name_match(source: Any, target: Any) -> tuple[ValidationStatus, str | None]:
    source_norm = _normalize_name(str(source))
    target_norm = _normalize_name(str(target))
    if source_norm == target_norm:
        return ValidationStatus.PASS, None
    if source_norm and target_norm and (source_norm in target_norm or target_norm in source_norm):
        return ValidationStatus.PASS, "Partial name match"
    return ValidationStatus.FAIL, f'"{str(source).strip()}" != "{str(target).strip()}" after normalization'


def _numeric_exact_match(source: Any, target: Any) -> tuple[ValidationStatus, str | None]:
    source_number = _to_number(source)
    target_number = _to_number(target)
    if source_number is None or target_number is None:
        return ValidationStatus.SKIPPED, "Non-numeric value"
    if source_number == target_number:
        return ValidationStatus.PASS, None
    return ValidationStatus.FAIL, f"{source_number:g} != {target_number:g} (difference: {abs(source_number - target_number):g})"


def _numeric_tolerance_match(source: Any, target: Any, tolerance_pct: float) -> tuple[ValidationStatus, str | None]:
    source_number = _to_number(source)
    target_number = _to_number(target)
    if source_number is None or target_number is None:
        return ValidationStatus.SKIPPED, "Non-numeric value"
    if source_number == 0 and target_number == 0:
        return ValidationStatus.PASS, None
    if target_number == 0:
        return ValidationStatus.FAIL, f"Target is 0, source is {source_number:g}"

    pct_diff = abs((source_number - target_number) / target_number) * 100
    if pct_diff == 0:
        return ValidationStatus.PASS, None
    if pct_diff <= tolerance_pct:
        return ValidationStatus.WARNING, f"{pct_diff:.2f}% difference within {tolerance_pct:g}% tolerance"
    return ValidationStatus.FAIL, f"{pct_diff:.2f}% difference exceeds {tolerance_pct:g}% tolerance"


def _pattern_match(source: Any, pattern: Any) -> tuple[ValidationStatus, str | None]:
    source_values = _flatten(source)
    pattern_text = str(pattern or "")
    try:
        regex = re.compile(pattern_text)
    except re.error:
        return ValidationStatus.SKIPPED, f"Invalid regex pattern: {pattern_text}"
    failures = [str(value) for value in source_values if _is_present(value) and not regex.search(str(value))]
    if not failures:
        return ValidationStatus.PASS, None
    return ValidationStatus.FAIL, f"Values do not match pattern {pattern_text}: {', '.join(failures[:10])}"


def _contains_match(source: Any, target: Any) -> tuple[ValidationStatus, str | None]:
    source_text = str(source).lower().strip()
    target_text = str(target).lower().strip()
    if source_text in target_text or target_text in source_text:
        return ValidationStatus.PASS, None
    return ValidationStatus.FAIL, f'"{source}" does not contain "{target}"'


def _set_match(source: Any, target: Any) -> tuple[ValidationStatus, str | None]:
    source_set = _to_string_set(source)
    target_set = _to_string_set(target)
    if not source_set or not target_set:
        return ValidationStatus.SKIPPED, "Empty set"
    all_source_in_target = all(_has_set_match(item, target_set) for item in source_set)
    all_target_in_source = all(_has_set_match(item, source_set) for item in target_set)
    if all_source_in_target or all_target_in_source:
        return ValidationStatus.PASS, None
    missing = [item for item in source_set if not _has_set_match(item, target_set)]
    return ValidationStatus.FAIL, f"Missing in target: {', '.join(missing[:10])}"


def _result(
    rule: CrossValidationRule,
    status: ValidationStatus,
    *,
    source_value: Any = None,
    target_value: Any = None,
    delta: str | None = None,
) -> ValidationResult:
    return ValidationResult(
        rule_code=rule.rule_code,
        status=status,
        blocking_behavior=rule.blocking_behavior,
        source_doc_type=rule.source_doc_type,
        target_doc_type=rule.target_doc_type,
        source_field=rule.source_field,
        target_field=rule.target_field,
        source_value=source_value,
        target_value=target_value,
        delta=delta,
        alert_level=_alert_level(rule, status),
    )


def _build_summary(results: list[ValidationResult]) -> ValidationSummary:
    alerts = [_alert_payload(result) for result in results if result.alert_level]
    return ValidationSummary(
        total=len(results),
        passed=sum(result.status == ValidationStatus.PASS for result in results),
        failed=sum(result.status == ValidationStatus.FAIL for result in results),
        warnings=sum(result.status == ValidationStatus.WARNING for result in results),
        waiting=sum(result.status == ValidationStatus.WAITING for result in results),
        skipped=sum(result.status == ValidationStatus.SKIPPED for result in results),
        blocking_failures=sum(result.is_blocking_failure for result in results),
        results=results,
        alerts=alerts,
    )


def _alert_level(rule: CrossValidationRule, status: ValidationStatus) -> str | None:
    if status == ValidationStatus.FAIL and rule.blocking_behavior == BlockingBehavior.BLOCK:
        return "BLOCKER"
    if status in {ValidationStatus.FAIL, ValidationStatus.WARNING}:
        return "WARNING"
    if status == ValidationStatus.WAITING:
        return "INFO"
    return None


def _alert_payload(result: ValidationResult) -> dict[str, Any]:
    return {
        "ruleCode": result.rule_code,
        "level": result.alert_level,
        "status": result.status.value,
        "sourceDocType": result.source_doc_type,
        "targetDocType": result.target_doc_type,
        "message": result.delta or f"{result.rule_code} requires attention",
    }


def _document_data(documents_by_type: Mapping[str, Any], doc_type: str) -> Any:
    if doc_type in documents_by_type:
        return documents_by_type[doc_type]
    return documents_by_type.get(_normalize_doc_type(doc_type))


def _normalize_doc_type(value: str) -> str:
    return str(value or "").strip().upper().replace(" ", "_").replace("-", "_")


def _walk_path(data: Any, field_path: str) -> Any:
    current = data
    for part in field_path.split("."):
        if current is None:
            return None
        if isinstance(current, Mapping):
            current = current.get(part)
        else:
            current = getattr(current, part, None)
    return current


def _flatten(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        flattened: list[Any] = []
        for item in value:
            flattened.extend(_flatten(item))
        return flattened
    if isinstance(value, tuple):
        return _flatten(list(value))
    return [value]


def _is_present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple)):
        return any(_is_present(item) for item in value)
    if isinstance(value, Mapping):
        return any(_is_present(item) for item in value.values())
    return True


def _normalize_name(value: str) -> str:
    text = value.lower()
    text = re.sub(r"\b(pvt|private|ltd|limited|llc|inc|incorporated|co|company|corp|corporation)\b", "", text)
    text = re.sub(r"[.,\-\s]+", " ", text)
    return text.strip()


def _to_number(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    values = _flatten(value)
    if len(values) > 1:
        numbers = [_to_number(item) for item in values]
        clean_numbers = [number for number in numbers if number is not None]
        return sum(clean_numbers) if clean_numbers else None
    text = str(values[0] if values else value)
    match = re.search(r"-?\d+(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def _to_string_set(value: Any) -> list[str]:
    raw_values: list[Any] = []
    for item in _flatten(value):
        if isinstance(item, str):
            raw_values.extend(re.split(r"[,;\n]", item))
        else:
            raw_values.append(item)
    normalized = [str(item).strip().lower() for item in raw_values if _is_present(item)]
    return [item for item in normalized if item]


def _has_set_match(item: str, candidates: Iterable[str]) -> bool:
    return any(item in candidate or candidate in item for candidate in candidates)


__all__ = [
    "BlockingBehavior",
    "CrossValidationRule",
    "DEFAULT_TEMPLATE_ID",
    "MatchType",
    "RULES",
    "ValidationResult",
    "ValidationStatus",
    "ValidationSummary",
    "extract_field_value",
    "get_rules_for_doc_type",
    "load_validation_rule_overrides",
    "materialize_rule",
    "run_cross_validation",
    "set_validation_rule_override",
    "split_validation_rule_id",
    "validation_rule_id",
    "validation_rule_row",
]
