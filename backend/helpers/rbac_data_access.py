from __future__ import annotations

import json
from typing import Any, Final


ALL_DOCUMENT_ACCESS_ROLES: Final[set[str]] = {"SUPER_ADMIN", "ADMIN", "OPS_MANAGER"}

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
        "ISF",
        "US_SALES_INVOICE",
        "US_CARGO_RELEASE_ORDER",
        "US_CUSTOMS_RELEASE_ORDER",
        "US_DELIVERY_ORDER",
        "US_PACKING_LIST",
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
        "PORT_TO_WH",
        "WH_TO_CUSTOMER",
    },
}

ROLE_DOC_TYPE_ACTIONS: Final[dict[str, dict[str, set[str]]]] = {
    "SUPER_ADMIN": {
        "upload": {"*"},
        "approve_extraction": {"*"},
        "review_generation": {"*"},
        "view": {"*"},
    },
    "ADMIN": {
        "upload": {"*"},
        "approve_extraction": {"*"},
        "review_generation": {"*"},
        "view": {"*"},
    },
    "OPS_MANAGER": {
        "upload": {"*"},
        "approve_extraction": {"*"},
        "review_generation": {"*"},
        "view": {"*"},
    },
    "INDIA_LOGISTICS": {
        "upload": {"SALES_INVOICE", "PACKING_LIST", "SHIPPING_BILL", "BILL_OF_LADING"},
        "approve_extraction": {"SALES_INVOICE", "PACKING_LIST", "SHIPPING_BILL", "BILL_OF_LADING"},
        "review_generation": {"PACKING_LIST"},
        "view": ROLE_DOCUMENT_TYPES["INDIA_LOGISTICS"],
    },
    "US_LOGISTICS": {
        "upload": {"ENTRY_SUMMARY", "US_CARGO_RELEASE_ORDER", "US_CUSTOMS_RELEASE_ORDER", "US_DELIVERY_ORDER", "US_PACKING_LIST"},
        "approve_extraction": set(),
        "review_generation": {"US_PACKING_LIST"},
        "view": ROLE_DOCUMENT_TYPES["US_LOGISTICS"],
    },
    "FINANCE_AP_INDIA": {
        "upload": set(),
        "approve_extraction": set(),
        "review_generation": set(),
        "view": ROLE_DOCUMENT_TYPES["FINANCE_AP_INDIA"],
    },
    "THREE_PL_PARTNER": {
        "upload": {"GRN_INBOUND", "PORT_TO_WH", "WH_TO_CUSTOMER"},
        "approve_extraction": set(),
        "review_generation": set(),
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
    "ORG_ADMIN": "ADMIN",
    "ORG ADMIN": "ADMIN",
    "ADMIN": "ADMIN",
    "OPS_MANAGER": "OPS_MANAGER",
    "OPS MANAGER": "OPS_MANAGER",
    "INDIA_LOGISTICS": "INDIA_LOGISTICS",
    "INDIA LOGISTICS": "INDIA_LOGISTICS",
    "US_LOGISTICS": "US_LOGISTICS",
    "US LOGISTICS": "US_LOGISTICS",
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
    if isinstance(raw, list):
        return [str(item) for item in raw if str(item)]
    return [str(raw)] if str(raw) else []


def _attr_value(attributes: dict | None, key: str, default: str = "") -> str:
    values = _attr_values(attributes, key)
    return values[0] if values else default


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
    raw = _attr_value(attributes, "ewms.docTypeScopes", "")
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
    "approve_extraction": ("documents.approve_draft", "documents.edit_extracted"),
    "review_generation": (
        "documents.generate_draft",
        "documents.approve_generated_document",
        "documents.approve_draft",
    ),
    "view": ("documents.view", "documents.view_extracted", "documents.download_export"),
}


def _scoped_doc_types_for_action(attributes: dict | None, action: str) -> set[str]:
    scopes = role_doc_type_scopes_from_attrs(attributes)
    if not scopes:
        return set()
    scoped: set[str] = set()
    for activity_code in DOC_TYPE_ACTION_ACTIVITY_CODES.get(action, (action,)):
        scoped.update(scopes.get(activity_code, set()))
    return scoped


def can_access_all_documents(user: Any) -> bool:
    attrs = getattr(user, "keycloakRoleAttributes", None)
    explicit_scope = role_document_scope_from_attrs(attrs)
    return explicit_scope is None and access_role(user) in ALL_DOCUMENT_ACCESS_ROLES


def document_type_scope(user: Any) -> set[str] | None:
    attrs = getattr(user, "keycloakRoleAttributes", None)
    explicit_scope = role_document_scope_from_attrs(attrs)
    if explicit_scope is not None:
        return explicit_scope
    return ROLE_DOCUMENT_TYPES.get(access_role(user))


def doc_type_permissions_for_role(role_name: str, attributes: dict | None = None) -> dict[str, list[str]]:
    explicit_document_scope = role_document_scope_from_attrs(attributes)
    explicit_activity_scopes = role_doc_type_scopes_from_attrs(attributes)
    if explicit_document_scope is not None or explicit_activity_scopes:
        return {
            "upload": sorted(_scoped_doc_types_for_action(attributes, "upload")),
            "approve_extraction": sorted(_scoped_doc_types_for_action(attributes, "approve_extraction")),
            "review_generation": sorted(_scoped_doc_types_for_action(attributes, "review_generation")),
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
    if explicit_document_scope is not None or explicit_activity_scopes:
        if action == "view":
            return explicit_document_scope or _scoped_doc_types_for_action(attrs, action)
        return _scoped_doc_types_for_action(attrs, action)
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
