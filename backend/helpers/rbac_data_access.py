from __future__ import annotations

import json
from typing import Any, Final


ALL_DOCUMENT_ACCESS_ROLES: Final[set[str]] = {"SUPER_ADMIN", "ADMIN", "SPR_ADMIN", "OPS_MANAGER"}

ROLE_DOCUMENT_TYPES: Final[dict[str, set[str]]] = {
    "INDIA_LOGISTICS": {
        "SALES_INVOICE",
        "PACKING_LIST",
        "BILL_OF_LADING",
        "SHIPPING_BILL",
        "CHA_BILL",
        "FREIGHT_FORWARDER_BILL",
        "OCEAN_FREIGHT",
        "GRN_INBOUND",
        "PORT_TO_WH",
        "WH_TO_CUSTOMER",
    },
    "US_LOGISTICS": {
        "BILL_OF_LADING",
        "PACKING_LIST",
        "ENTRY_SUMMARY",
        "DRAFT_CBP_FORM_7501_BROKER",
        "ISF",
        "US_SALES_INVOICE",
        "US_CARGO_RELEASE_ORDER",
        "US_CUSTOMS_RELEASE_ORDER",
        "US_DELIVERY_ORDER",
        "US_PACKING_LIST",
        "OUTWARD_GRN",
    },
    "US_BROKER": {
        "ENTRY_SUMMARY",
        "DRAFT_CBP_FORM_7501_BROKER",
        "ISF",
        "US_CARGO_RELEASE_ORDER",
        "US_CUSTOMS_RELEASE_ORDER",
        "US_DELIVERY_ORDER",
        "US_PACKING_LIST",
        "OUTWARD_GRN",
    },
    "FINANCE_AP_INDIA": {
        "BILL_OF_LADING",
        "SALES_INVOICE",
        "OCEAN_FREIGHT",
        "FREIGHT_FORWARDER_BILL",
        "CUSTOMER_BROKER_BILL",
        "CHA_BILL",
    },
    "THREE_PL_PARTNER": {
        "BILL_OF_LADING",
        "PACKING_LIST",
        "GRN_INBOUND",
        "OUTWARD_GRN",
        "PORT_TO_WH",
        "WH_TO_CUSTOMER",
    },
}

ROLE_DOC_TYPE_ACTIONS: Final[dict[str, dict[str, set[str]]]] = {
    "SUPER_ADMIN": {
        "upload": {"*"},
        "approve_extraction": {"*"},
        "edit_extracted": {"*"},
        "submit_for_approval": {"*"},
        "approve_draft": {"*"},
        "reject_extraction": {"*"},
        "override_approved_fields": {"*"},
        "review_generation": {"*"},
        "container_mapping": {"*"},
        "re_upload_document": {"*"},
        "reprocess_ocr": {"*"},
        "view": {"*"},
    },
    "ADMIN": {
        "upload": {"*"},
        "approve_extraction": {"*"},
        "edit_extracted": {"*"},
        "submit_for_approval": {"*"},
        "approve_draft": {"*"},
        "reject_extraction": {"*"},
        "override_approved_fields": {"*"},
        "review_generation": {"*"},
        "container_mapping": {"*"},
        "re_upload_document": {"*"},
        "reprocess_ocr": {"*"},
        "view": {"*"},
    },
    "OPS_MANAGER": {
        "upload": {"*"},
        "approve_extraction": {"*"},
        "edit_extracted": {"*"},
        "submit_for_approval": {"*"},
        "approve_draft": {"*"},
        "reject_extraction": {"*"},
        "override_approved_fields": {"*"},
        "review_generation": {"*"},
        "container_mapping": {"*"},
        "re_upload_document": {"*"},
        "reprocess_ocr": {"*"},
        "view": {"*"},
    },
    "INDIA_LOGISTICS": {
        "upload": {"SALES_INVOICE", "PACKING_LIST", "SHIPPING_BILL", "BILL_OF_LADING"},
        "approve_extraction": {"SALES_INVOICE", "PACKING_LIST", "SHIPPING_BILL", "BILL_OF_LADING"},
        "edit_extracted": {"SALES_INVOICE", "PACKING_LIST", "SHIPPING_BILL", "BILL_OF_LADING"},
        "submit_for_approval": {"SALES_INVOICE", "PACKING_LIST", "SHIPPING_BILL", "BILL_OF_LADING"},
        "approve_draft": {"SALES_INVOICE", "PACKING_LIST", "SHIPPING_BILL", "BILL_OF_LADING"},
        "reject_extraction": {"SALES_INVOICE", "PACKING_LIST", "SHIPPING_BILL", "BILL_OF_LADING"},
        "override_approved_fields": {"SALES_INVOICE", "PACKING_LIST", "SHIPPING_BILL", "BILL_OF_LADING"},
        "review_generation": {"PACKING_LIST"},
        "container_mapping": {"BILL_OF_LADING"},
        "re_upload_document": {"SALES_INVOICE", "PACKING_LIST", "SHIPPING_BILL", "BILL_OF_LADING"},
        "reprocess_ocr": {"SALES_INVOICE", "PACKING_LIST", "SHIPPING_BILL", "BILL_OF_LADING"},
        "view": ROLE_DOCUMENT_TYPES["INDIA_LOGISTICS"],
    },
    "US_LOGISTICS": {
        "upload": {"ENTRY_SUMMARY", "DRAFT_CBP_FORM_7501_BROKER", "US_CARGO_RELEASE_ORDER", "US_CUSTOMS_RELEASE_ORDER", "US_DELIVERY_ORDER", "US_PACKING_LIST", "OUTWARD_GRN"},
        "approve_extraction": set(),
        "edit_extracted": set(),
        "submit_for_approval": set(),
        "approve_draft": set(),
        "reject_extraction": set(),
        "override_approved_fields": set(),
        "review_generation": {"US_PACKING_LIST", "OUTWARD_GRN"},
        "container_mapping": {"BILL_OF_LADING"},
        "re_upload_document": {"ENTRY_SUMMARY", "DRAFT_CBP_FORM_7501_BROKER", "US_CARGO_RELEASE_ORDER", "US_CUSTOMS_RELEASE_ORDER", "US_DELIVERY_ORDER", "US_PACKING_LIST", "OUTWARD_GRN"},
        "reprocess_ocr": {"ENTRY_SUMMARY", "DRAFT_CBP_FORM_7501_BROKER", "US_CARGO_RELEASE_ORDER", "US_CUSTOMS_RELEASE_ORDER", "US_DELIVERY_ORDER", "US_PACKING_LIST", "OUTWARD_GRN"},
        "view": ROLE_DOCUMENT_TYPES["US_LOGISTICS"],
    },
    "US_BROKER": {
        "upload": {"ENTRY_SUMMARY", "DRAFT_CBP_FORM_7501_BROKER", "ISF"},
        "approve_extraction": set(),
        "edit_extracted": set(),
        "submit_for_approval": set(),
        "approve_draft": set(),
        "reject_extraction": set(),
        "override_approved_fields": set(),
        "review_generation": set(),
        "re_upload_document": {"ENTRY_SUMMARY", "DRAFT_CBP_FORM_7501_BROKER", "ISF"},
        "reprocess_ocr": {"ENTRY_SUMMARY", "DRAFT_CBP_FORM_7501_BROKER", "ISF"},
        "view": ROLE_DOCUMENT_TYPES["US_BROKER"],
    },
    "FINANCE_AP_INDIA": {
        "upload": set(),
        "approve_extraction": set(),
        "edit_extracted": set(),
        "submit_for_approval": set(),
        "approve_draft": set(),
        "reject_extraction": set(),
        "override_approved_fields": set(),
        "review_generation": set(),
        "re_upload_document": set(),
        "reprocess_ocr": set(),
        "view": ROLE_DOCUMENT_TYPES["FINANCE_AP_INDIA"],
    },
    "THREE_PL_PARTNER": {
        "upload": {"GRN_INBOUND", "OUTWARD_GRN", "PORT_TO_WH", "WH_TO_CUSTOMER"},
        "approve_extraction": set(),
        "edit_extracted": set(),
        "submit_for_approval": set(),
        "approve_draft": set(),
        "reject_extraction": set(),
        "override_approved_fields": set(),
        "review_generation": set(),
        "container_mapping": {"BILL_OF_LADING"},
        "re_upload_document": {"GRN_INBOUND", "OUTWARD_GRN", "PORT_TO_WH", "WH_TO_CUSTOMER"},
        "reprocess_ocr": {"GRN_INBOUND", "OUTWARD_GRN", "PORT_TO_WH", "WH_TO_CUSTOMER"},
        "view": ROLE_DOCUMENT_TYPES["THREE_PL_PARTNER"],
    },
}


def user_id(user: Any) -> str:
    if isinstance(user, dict):
        return str(user.get("id") or "")
    return str(getattr(user, "id", "") or "")


ROLE_ALIASES: Final[dict[str, str]] = {
    "SUPER_ADMIN": "SUPER_ADMIN",
    "SUPER_ADMINISTRATOR": "SUPER_ADMIN",
    "SUPER ADMIN": "SUPER_ADMIN",
    "SPR_ADMIN": "SPR_ADMIN",
    "SPR ADMIN": "SPR_ADMIN",
    "ORG_ADMIN": "ADMIN",
    "ORG ADMIN": "ADMIN",
    "ADMIN": "ADMIN",
    "OPS_MANAGER": "OPS_MANAGER",
    "OPS MANAGER": "OPS_MANAGER",
    "INDIA_LOGISTICS": "INDIA_LOGISTICS",
    "INDIA LOGISTICS": "INDIA_LOGISTICS",
    "US_LOGISTICS": "US_LOGISTICS",
    "US LOGISTICS": "US_LOGISTICS",
    "US_BROKER": "US_BROKER",
    "US BROKER": "US_BROKER",
    "FINANCE_AP_INDIA": "FINANCE_AP_INDIA",
    "FINANCE AP INDIA": "FINANCE_AP_INDIA",
    "THREE_PL_PARTNER": "THREE_PL_PARTNER",
    "3PL_PARTNER": "THREE_PL_PARTNER",
    "3PL PARTNER": "THREE_PL_PARTNER",
}


def normalize_role_name(role_name: Any) -> str:
    role_value = getattr(role_name, "value", None) or str(role_name or "")
    normalized = role_value.strip().upper().replace("-", "_")
    underscored = normalized.replace(" ", "_")
    return ROLE_ALIASES.get(underscored, ROLE_ALIASES.get(normalized, underscored))


def access_role(user: Any) -> str:
    role = getattr(user, "keycloakPrimaryRole", None) or getattr(user, "role", None)
    return normalize_role_name(role)


def _attr_values(attributes: dict | None, key: str) -> list[str]:
    raw = (attributes or {}).get(key)
    if raw is None:
        return []
    values: list[Any]
    if isinstance(raw, list):
        values = raw
    else:
        values = [raw]
    normalized: list[str] = []
    for item in values:
        text = str(item or "").strip()
        if not text:
            continue
        if text.startswith("[") and text.endswith("]"):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    normalized.extend(str(value).strip() for value in parsed if str(value).strip())
                    continue
            except Exception:
                pass
        if "," in text:
            normalized.extend(part.strip() for part in text.split(",") if part.strip())
            continue
        normalized.append(text)
    return normalized


def _attr_value(attributes: dict | None, key: str, default: str = "") -> str:
    values = _attr_values(attributes, key)
    return values[0] if values else default


def _attr_json_value(attributes: dict | None, key: str, default: str = "") -> str:
    chunk_count_text = _attr_value(attributes, f"{key}.__chunks", "")
    if chunk_count_text.isdigit():
        chunk_count = int(chunk_count_text)
        if chunk_count == 0:
            return _attr_value(attributes, key, default)
        chunks = [_attr_value(attributes, f"{key}.{index}", "") for index in range(chunk_count)]
        if all(chunks):
            return "".join(chunks)
        return default
    chunks: list[tuple[int, str]] = []
    prefix = f"{key}."
    for attr_key in (attributes or {}):
        attr_key_text = str(attr_key)
        if not attr_key_text.startswith(prefix):
            continue
        suffix = attr_key_text[len(prefix):]
        if not suffix.isdigit():
            continue
        chunk = _attr_value(attributes, attr_key_text, "")
        if chunk:
            chunks.append((int(suffix), chunk))
    if not chunks:
        return _attr_value(attributes, key, default)
    return "".join(chunk for _, chunk in sorted(chunks))


def _normalize_document_scope(values: list[str]) -> set[str]:
    scope: set[str] = set()
    for value in values:
        for item in str(value).replace(";", ",").split(","):
            doc_type = item.strip().upper().replace("-", "_").replace(" ", "_")
            if doc_type and doc_type != "*":
                scope.add(doc_type)
    return scope


def role_document_scope_from_attrs(attributes: dict | None) -> set[str] | None:
    if not attributes or "ewms.documentScope" not in attributes:
        return None
    return _normalize_document_scope(_attr_values(attributes, "ewms.documentScope"))


def role_doc_type_scopes_from_attrs(attributes: dict | None) -> dict[str, set[str]]:
    raw = _attr_json_value(attributes, "ewms.docTypeScopes", "")
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}
    scopes: dict[str, set[str]] = {}
    for activity_code, values in parsed.items():
        if isinstance(values, list):
            scopes[str(activity_code)] = _normalize_document_scope([str(item) for item in values])
    return scopes


DOC_TYPE_ACTION_ACTIVITY_CODES: Final[dict[str, tuple[str, ...]]] = {
    "upload": ("documents.upload",),
    "re_upload_document": ("documents.re_upload_document",),
    "reprocess_ocr": ("documents.reprocess_ocr", "documents.reject_extraction"),
    "edit_extracted": ("documents.edit_extracted",),
    "submit_for_approval": ("documents.submit_for_approval",),
    "approve_draft": ("documents.approve_draft",),
    "reject_extraction": ("documents.reject_extraction",),
    "override_approved_fields": ("documents.override_approved_fields",),
    "approve_extraction": (
        "documents.approve_draft",
        "documents.edit_extracted",
        "documents.submit_for_approval",
        "documents.reject_extraction",
        "documents.override_approved_fields",
    ),
    "review_generation": (
        "documents.generate_draft",
        "documents.view_draft",
        "documents.fill_manual_fields",
        "documents.modify_generated_fields",
        "documents.save_draft",
        "documents.submit_for_review",
        "documents.approve_generated_document",
        "documents.reject_generated_document",
        "documents.re_trigger_generation",
        "documents.discard_draft",
        "documents.approve_draft",
    ),
    "view": ("documents.view", "documents.view_extracted", "documents.download_export"),
    "container_mapping": ("documents.map_container_to_sku",),
}

IMPLIED_ACTIVITY_CODES: Final[dict[str, set[str]]] = {
    "documents.manage": {
        "documents.upload",
        "documents.view_extracted",
        "documents.edit_extracted",
        "documents.generate_draft",
        "documents.approve_draft",
        "documents.submit_for_approval",
        "documents.reject_extraction",
        "documents.override_approved_fields",
        "documents.override_validation",
        "documents.reprocess_ocr",
        "documents.download_export",
        "documents.delete",
        "documents.map_container_to_sku",
        "documents.submit_mapping_for_approval",
        "documents.approve_container_mapping",
        "documents.reject_container_mapping",
        "documents.dnd_inputs",
    },
    "documents.view_draft": {"documents.generate_draft", "DOC-003"},
    "documents.fill_manual_fields": {"documents.generate_draft", "DOC-003"},
    "documents.modify_generated_fields": {"documents.generate_draft", "DOC-003"},
    "documents.save_draft": {"documents.generate_draft", "DOC-003"},
    "documents.submit_for_review": {"documents.generate_draft", "DOC-003"},
    "documents.approve_generated_document": {"documents.generate_draft", "DOC-003"},
    "documents.reject_generated_document": {"documents.generate_draft", "DOC-003"},
    "documents.re_trigger_generation": {"documents.generate_draft", "DOC-003"},
    "documents.discard_draft": {"documents.generate_draft", "DOC-003"},
    "documents.reject_extraction": {"documents.reprocess_ocr"},
}

LEGACY_ACTIVITY_ALIASES: Final[dict[str, set[str]]] = {
    "documents.generate_draft": {"DOC-003"},
    "documents.approve_draft": {"DOC-003"},
    "dnd.view_tariffs": {"dnd.tariff.view"},
    "dnd.view_charges": {"dnd.activate", "documents.dnd_inputs"},
    "dnd.activate": {"documents.dnd_inputs"},
    "dnd.activate.start_event_date": {"documents.dnd_inputs.start_event"},
    "dnd.activate.holiday_days": {"documents.dnd_inputs.exclude_holidays"},
    "dnd.activate.weekends": {"documents.dnd_inputs.exclude_weekends"},
    "documents.dnd_inputs": {"dnd.activate"},
    "documents.dnd_inputs.start_event": {"dnd.activate.start_event_date"},
    "documents.dnd_inputs.exclude_holidays": {"dnd.activate.holiday_days"},
    "documents.dnd_inputs.exclude_weekends": {"dnd.activate.weekends"},
    "dnd.save_inputs": {
        "dnd.activate",
        "dnd.activate.start_event_date",
        "dnd.activate.holiday_days",
        "dnd.activate.weekends",
        "documents.dnd_inputs",
        "documents.dnd_inputs.start_event",
        "documents.dnd_inputs.exclude_holidays",
        "documents.dnd_inputs.exclude_weekends",
    },
    "dnd.manage_carriers": {"dnd.tariff.create", "dnd.tariff.edit"},
    "dnd.upload_holidays": {"dnd.holiday_calendar.upload"},
    "dnd.publish_tariff": {"dnd.tariff.create"},
    "dnd.force_expire_tariff": {"dnd.tariff.force_expire"},
}

GENERATED_DOC_SOURCE_TYPES: Final[dict[str, set[str]]] = {
    "PACKING_LIST": {"SALES_INVOICE"},
    "US_PACKING_LIST": {"PACKING_LIST", "BILL_OF_LADING"},
    "ENTRY_SUMMARY": {"BILL_OF_LADING", "SALES_INVOICE"},
}


def _expand_activity_codes(activities: set[str]) -> set[str]:
    expanded = set(activities)
    for activity in list(expanded):
        expanded.update(IMPLIED_ACTIVITY_CODES.get(activity, set()))
    for activity in list(expanded):
        expanded.update(LEGACY_ACTIVITY_ALIASES.get(activity, set()))
    return expanded


def role_has_activity(user: Any, activity_code: str) -> bool:
    attrs = getattr(user, "keycloakRoleAttributes", None)
    activities = _expand_activity_codes(set(_attr_values(attrs, "ewms.activities")))
    if activity_code in activities:
        return True
    if access_role(user) in ALL_DOCUMENT_ACCESS_ROLES and activity_code == "documents.generate_draft":
        return True
    return False


def _scoped_doc_types_for_action(attributes: dict | None, action: str) -> set[str]:
    scopes = role_doc_type_scopes_from_attrs(attributes)
    if not scopes:
        return set()
    scoped: set[str] = set()
    for activity_code in DOC_TYPE_ACTION_ACTIVITY_CODES.get(action, (action,)):
        scoped.update(scopes.get(activity_code, set()))
    return scoped


def _action_scope_or_document_scope(attributes: dict | None, action: str) -> set[str]:
    scoped = _scoped_doc_types_for_action(attributes, action)
    if scoped:
        return scoped
    return role_document_scope_from_attrs(attributes) or set()


def can_access_all_documents(user: Any) -> bool:
    return access_role(user) in ALL_DOCUMENT_ACCESS_ROLES


def document_type_scope(user: Any) -> set[str] | None:
    if access_role(user) in ALL_DOCUMENT_ACCESS_ROLES:
        return None
    attrs = getattr(user, "keycloakRoleAttributes", None)
    explicit_scope = role_document_scope_from_attrs(attrs)
    if explicit_scope is not None:
        return explicit_scope
    return ROLE_DOCUMENT_TYPES.get(access_role(user))


def doc_type_permissions_for_role(role_name: str, attributes: dict | None = None) -> dict[str, list[str]]:
    explicit_document_scope = role_document_scope_from_attrs(attributes)
    explicit_activity_scopes = role_doc_type_scopes_from_attrs(attributes)
    if explicit_document_scope is not None and not explicit_activity_scopes:
        scope = sorted(explicit_document_scope)
        return {
            "upload": scope,
            "re_upload_document": scope,
            "reprocess_ocr": scope,
            "edit_extracted": scope,
            "submit_for_approval": scope,
            "approve_draft": scope,
            "reject_extraction": scope,
            "override_approved_fields": scope,
            "approve_extraction": scope,
            "review_generation": scope,
            "container_mapping": scope,
            "view": scope,
        }
    if explicit_document_scope is not None or explicit_activity_scopes:
        return {
            "upload": sorted(_action_scope_or_document_scope(attributes, "upload")),
            "re_upload_document": sorted(_action_scope_or_document_scope(attributes, "re_upload_document")),
            "reprocess_ocr": sorted(_action_scope_or_document_scope(attributes, "reprocess_ocr")),
            "edit_extracted": sorted(_action_scope_or_document_scope(attributes, "edit_extracted")),
            "submit_for_approval": sorted(_action_scope_or_document_scope(attributes, "submit_for_approval")),
            "approve_draft": sorted(_action_scope_or_document_scope(attributes, "approve_draft")),
            "reject_extraction": sorted(_action_scope_or_document_scope(attributes, "reject_extraction")),
            "override_approved_fields": sorted(_action_scope_or_document_scope(attributes, "override_approved_fields")),
            "approve_extraction": sorted(_action_scope_or_document_scope(attributes, "approve_extraction")),
            "review_generation": sorted(_action_scope_or_document_scope(attributes, "review_generation")),
            "container_mapping": sorted(_action_scope_or_document_scope(attributes, "container_mapping")),
            "view": sorted(explicit_document_scope or _scoped_doc_types_for_action(attributes, "view")),
        }
    actions = ROLE_DOC_TYPE_ACTIONS.get(normalize_role_name(role_name), {})
    return {
        action: sorted(values)
        for action, values in actions.items()
    }


def doc_type_action_scope(user: Any, action: str) -> set[str] | None:
    attrs = getattr(user, "keycloakRoleAttributes", None)
    explicit_document_scope = role_document_scope_from_attrs(attrs)
    explicit_activity_scopes = role_doc_type_scopes_from_attrs(attrs)
    if explicit_document_scope is not None and not explicit_activity_scopes:
        return explicit_document_scope
    if explicit_document_scope is not None or explicit_activity_scopes:
        if action == "view":
            return explicit_document_scope or _scoped_doc_types_for_action(attrs, action)
        return _action_scope_or_document_scope(attrs, action)
    actions = ROLE_DOC_TYPE_ACTIONS.get(access_role(user), {})
    scope = actions.get(action)
    if scope is None:
        return set()
    if "*" in scope:
        return None
    return set(scope)


def can_do_doc_type_action(user: Any, action: str, doc_type: Any) -> bool:
    normalized_doc_type = str(doc_type or "").strip().upper().replace("-", "_").replace(" ", "_")
    if not normalized_doc_type:
        return False
    scope = doc_type_action_scope(user, action)
    return scope is None or normalized_doc_type in scope


def can_generate_document_type(user: Any, generated_doc_type: Any) -> bool:
    normalized_doc_type = str(generated_doc_type or "").strip().upper().replace("-", "_").replace(" ", "_")
    if not normalized_doc_type:
        return False
    scope = doc_type_action_scope(user, "review_generation")
    if scope is None:
        return True
    if normalized_doc_type in scope:
        return True
    source_types = GENERATED_DOC_SOURCE_TYPES.get(normalized_doc_type, set())
    return bool(source_types) and source_types.issubset(scope)


def has_role_document_scope(user: Any) -> bool:
    return can_access_all_documents(user) or document_type_scope(user) is not None


def document_prisma_where(user: Any) -> dict[str, Any]:
    if can_access_all_documents(user):
        return {"isDeleted": False}
    scoped_types = document_type_scope(user)
    if scoped_types is not None:
        return {"isDeleted": False, "docType": {"in": sorted(scoped_types)}}
    return {"uploadedBy": user_id(user), "isDeleted": False}


def document_sql_where(alias: str, user: Any, *, first_param: int = 1) -> tuple[str, list[Any], int]:
    quoted_alias = alias.strip()
    if can_access_all_documents(user):
        return f'{quoted_alias}."is_deleted" = false', [], first_param

    scoped_types = document_type_scope(user)
    if scoped_types is not None:
        return (
            f'{quoted_alias}."is_deleted" = false AND {quoted_alias}."doc_type"::text = ANY(${first_param}::text[])',
            [sorted(scoped_types)],
            first_param + 1,
        )

    return (
        f'{quoted_alias}."uploaded_by"::text = ${first_param}::text AND {quoted_alias}."is_deleted" = false',
        [user_id(user)],
        first_param + 1,
    )


def document_module_sql_where(alias: str, user: Any, *, first_param: int = 1) -> tuple[str, list[Any], int]:
    quoted_alias = alias.strip()
    if can_access_all_documents(user):
        return f'{quoted_alias}."is_deleted" = false', [], first_param
    scoped_types = document_type_scope(user)
    if scoped_types is not None:
        return (
            f'{quoted_alias}."is_deleted" = false AND {quoted_alias}."doc_type"::text = ANY(${first_param}::text[])',
            [sorted(scoped_types)],
            first_param + 1,
        )
    return (
        f'{quoted_alias}."uploaded_by"::text = ${first_param}::text AND {quoted_alias}."is_deleted" = false',
        [user_id(user)],
        first_param + 1,
    )
