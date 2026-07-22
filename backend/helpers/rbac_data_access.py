from __future__ import annotations

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
    explicit_scope = role_document_scope_from_attrs(attributes)
    if explicit_scope is not None:
        return {
            "upload": sorted(explicit_scope),
            "approve_extraction": sorted(explicit_scope),
            "review_generation": sorted(explicit_scope),
            "view": sorted(explicit_scope),
        }
    actions = ROLE_DOC_TYPE_ACTIONS.get(normalize_role_name(role_name), {})
    return {
        action: sorted(values)
        for action, values in actions.items()
    }


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
    if has_role_document_scope(user):
        return f'{quoted_alias}."is_deleted" = false', [], first_param
    return (
        f'{quoted_alias}."uploaded_by"::text = ${first_param}::text AND {quoted_alias}."is_deleted" = false',
        [user_id(user)],
        first_param + 1,
    )
