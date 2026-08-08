import json
from typing import Any, Callable

from fastapi import Depends, HTTPException
from keycloak import KeycloakAdmin, KeycloakOpenID

from helpers.config import settings
from helpers.dependencies import get_session_token


KEYCLOAK_SERVER_URL = f"{settings.KEYCLOAK_URL.rstrip(chr(47))}/"
keycloak_openid = KeycloakOpenID(
    server_url=KEYCLOAK_SERVER_URL,
    client_id=settings.KEYCLOAK_CLIENT_ID,
    realm_name=settings.KEYCLOAK_REALM,
    client_secret_key=settings.KEYCLOAK_CLIENT_SECRET,
)


LEVEL_ORDER = {"L1": 1, "L2": 2, "L3": 3, "L4": 4}

ADMIN_ROLE_NAMES = {"ADMIN", "ORG_ADMIN", "SPR_ADMIN", "SUPER_ADMIN", "SUPER_ADMINISTRATOR"}

ACTIVITY_MODULE_OVERRIDES = {
    "inventory.view_warehouse": "warehouse",
    "inventory.warehouse_inventory_stock_position": "warehouse",
    "inventory.acknowledge_dnd": "dnd",
    "inventory.view_dnd_charges": "dnd",
    "inventory.view_last_free_days_shipment_based": "dnd",
    "inventory.view_lfd_calendar": "dnd",
    "inventory.modify_lfd": "dnd",
    "documents.dnd_inputs": "documents",
    "documents.dnd_inputs.start_event": "documents",
    "documents.dnd_inputs.exclude_holidays": "documents",
    "documents.dnd_inputs.exclude_weekends": "documents",
    "dnd.activate": "dnd",
    "dnd.activate.start_event_date": "dnd",
    "dnd.activate.holiday_days": "dnd",
    "dnd.activate.weekends": "dnd",
    "dnd.tariff.create": "dnd",
    "dnd.tariff.edit": "dnd",
    "dnd.tariff.view": "dnd",
    "dnd.tariff.force_expire": "dnd",
    "dnd.holiday_calendar.upload": "dnd",
    "users.manage": "admin",
    "roles.view": "admin",
    "roles.manage": "admin",
    "SHP-001": "shipments",
    "SHP-002": "shipments",
    "SHP-003": "shipments",
    "SHP-005": "shipments",
    "GATE-001": "inventory",
    "GATE-002": "shipments",
    "DOC-003": "documents",
    "ACC-001": "accounting",
    "ACC-003": "accounting",
    "ACC-004": "accounting",
    "TSK-001": "tasks",
    "TSK-002": "tasks",
    "TSK-003": "tasks",
    "TSK-004": "tasks",
    "TSK-007": "tasks",
}

IMPLIED_ACTIVITY_CODES = {
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
    "shipments.manage": {
        "shipments.view",
        "shipments.create",
        "shipments.edit_metadata",
        "shipments.assign_user",
        "shipments.archive",
        "shipments.delete",
        "shipments.override_blocked_stage",
        "shipments.tag_partner",
    },
}

LEGACY_ACTIVITY_ALIASES = {
    "shipments.view": {"SHP-001"},
    "shipments.create": {"SHP-002"},
    "shipments.edit_metadata": {"SHP-003", "GATE-002"},
    "shipments.override_blocked_stage": {"SHP-005"},
    "inventory.view_timeline": {"GATE-001"},
    "documents.generate_draft": {"DOC-003"},
    "documents.approve_draft": {"DOC-003"},
    "accounting.view_queue": {"ACC-001"},
    "accounting.export_data": {"ACC-003"},
    "accounting.review_ticket": {"ACC-004"},
    "tasks.view": {"TSK-001"},
    "tasks.update": {"TSK-002"},
    "tasks.assign": {"TSK-003"},
    "tasks.escalate": {"TSK-004"},
    "tasks.delegate": {"TSK-007"},
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


def _extract_roles(token_info: dict) -> list[str]:
    roles = list(token_info.get("realm_access", {}).get("roles", []) or [])
    for client_access in (token_info.get("resource_access", {}) or {}).values():
        roles.extend(client_access.get("roles", []) or [])
    return sorted({str(role) for role in roles})


def _primary_role_name(role_names: list[str]) -> str:
    normalized = {role.upper().replace("-", "_").replace(" ", "_"): role for role in role_names}
    for role in ("SUPER_ADMIN", "SUPER_ADMINISTRATOR", "ORG_ADMIN", "SPR_ADMIN", "ADMIN"):
        if role in normalized:
            return normalized[role]
    for role in role_names:
        normalized_role = role.upper().replace("-", "_").replace(" ", "_")
        if (
            not role.startswith("default-roles-")
            and role not in {"offline_access", "uma_authorization"}
            and normalized_role not in {"USER", *ADMIN_ROLE_NAMES}
        ):
            return role
    if "USER" in normalized:
        return normalized["USER"]
    return "USER"


def _highest_level(levels: list[str]) -> str:
    return sorted(levels or ["L1"], key=lambda item: LEVEL_ORDER.get(str(item).upper(), 0))[-1]


def _expand_activity_codes(activities: set[str]) -> set[str]:
    expanded = set(activities)
    if "documents.view" in expanded:
        expanded.add("documents.view_extracted")
    for activity in list(activities):
        expanded.update(IMPLIED_ACTIVITY_CODES.get(activity, set()))
    for activity in list(expanded):
        expanded.update(LEGACY_ACTIVITY_ALIASES.get(activity, set()))
    return expanded


def _activity_module(activity_code: str) -> str:
    code = str(activity_code or "").strip()
    if code in ACTIVITY_MODULE_OVERRIDES:
        return ACTIVITY_MODULE_OVERRIDES[code]
    prefix = code.split(".", 1)[0]
    if prefix in {"shipments", "documents", "inventory", "dnd", "accounting", "reports", "tasks", "admin"}:
        return prefix
    return ""


def _filter_activities_for_modules(activities: set[str], modules: set[str]) -> set[str]:
    filtered: set[str] = set()
    for activity in activities:
        module = _activity_module(activity)
        if (
            module in modules
            or (module == "admin" and "settings" in modules)
            or ("partner" in modules and module in {"documents", "shipments", "inventory", "warehouse"})
        ):
            filtered.add(activity)
    return filtered


MODULE_OPENING_ACTIVITY_CODES = {
    "shipments": ("shipments.view",),
    "tasks": ("tasks.view",),
    "documents": ("documents.view",),
    "inventory": ("inventory.view_container",),
    "warehouse": ("inventory.view_warehouse",),
    "dnd": ("inventory.view_dnd_charges",),
    "accounting": ("accounting.view_queue",),
    "reports": ("reports.view_dashboard",),
    "admin": ("roles.view",),
    "settings": ("roles.view",),
}


def _ensure_module_opening_activities(activities: set[str], modules: set[str]) -> set[str]:
    codes = set(activities)
    for module in modules:
        openers = MODULE_OPENING_ACTIVITY_CODES.get(str(module), ())
        if openers and not any(opener in codes for opener in openers):
            codes.add(openers[0])
    return codes


def _current_user_role_names(admin: KeycloakAdmin, userinfo: dict, token_roles: list[str]) -> list[str]:
    user_id = str(userinfo.get("sub") or "")
    email = str(userinfo.get("email") or userinfo.get("preferred_username") or "").lower()
    try:
        if user_id:
            assigned_roles = admin.get_realm_roles_of_user(user_id)
        else:
            keycloak_id = admin.get_user_id(email)
            assigned_roles = admin.get_realm_roles_of_user(keycloak_id) if keycloak_id else []
        role_names = [
            str(role.get("name") or "")
            for role in assigned_roles
            if str(role.get("name") or "").strip()
        ]
        if role_names:
            return role_names
    except Exception:
        pass
    return token_roles


def _admin_client() -> KeycloakAdmin:
    return KeycloakAdmin(
        server_url=KEYCLOAK_SERVER_URL,
        username=settings.KEYCLOAK_ADMIN_USERNAME,
        password=settings.KEYCLOAK_ADMIN_PASSWORD,
        realm_name=settings.KEYCLOAK_REALM,
        user_realm_name="master",
        client_id="admin-cli",
        verify=True,
    )


def _authz_context(token: str) -> dict:
    try:
        userinfo = keycloak_openid.userinfo(token)
        token_info = keycloak_openid.decode_token(token, keycloak_openid.public_key())
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    admin = _admin_client()
    roles = _current_user_role_names(admin, userinfo, _extract_roles(token_info))
    role_name = _primary_role_name(roles)

    try:
        role = admin.get_realm_role(role_name)
    except Exception:
        raise HTTPException(status_code=403, detail=f"Role is not configured in Keycloak: {role_name}")

    role_attrs = role.get("attributes") or {}
    default_level = _highest_level(_attr_values(role_attrs, "ewms.levels"))
    try:
        keycloak_user = admin.get_user(str(userinfo.get("sub") or ""))
        user_level = _attr_value(keycloak_user.get("attributes") or {}, "ewms.level", default_level)
    except Exception:
        user_level = default_level

    modules = {str(module).strip() for module in _attr_values(role_attrs, "ewms.modules") if str(module).strip()}
    activities = _expand_activity_codes(set(_attr_values(role_attrs, "ewms.activities")))
    normalized_role = str(role_name or "").upper().replace("-", "_").replace(" ", "_")
    if normalized_role not in ADMIN_ROLE_NAMES:
        activities = _filter_activities_for_modules(activities, modules)
    activities = _ensure_module_opening_activities(activities, modules)

    return {
        "email": str(userinfo.get("email") or userinfo.get("preferred_username") or "").lower(),
        "role": role_name,
        "level": user_level,
        "modules": sorted(modules),
        "activities": activities,
    }


def authorize_activity(token: str, activity_code: str) -> dict:
    context = _authz_context(token)
    normalized_role = str(context.get("role") or "").upper().replace("-", "_").replace(" ", "_")
    if normalized_role in ADMIN_ROLE_NAMES:
        return context
    if activity_code not in context["activities"]:
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied: missing activity {activity_code}",
        )

    return context


def require_activity(activity_code: str) -> Callable:
    async def checker(token: str | None = Depends(get_session_token)) -> dict:
        if not token:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return authorize_activity(token, activity_code)

    return checker


def require_any_activity(*activity_codes: str) -> Callable:
    async def checker(token: str | None = Depends(get_session_token)) -> dict:
        if not token:
            raise HTTPException(status_code=401, detail="Not authenticated")
        last_error: HTTPException | None = None
        for activity_code in activity_codes:
            try:
                return authorize_activity(token, activity_code)
            except HTTPException as exc:
                last_error = exc
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied: missing one of activities {', '.join(activity_codes)}",
        ) from last_error

    return checker
