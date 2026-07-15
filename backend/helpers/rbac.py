from typing import Callable

from fastapi import Depends, HTTPException
from keycloak import KeycloakAdmin, KeycloakOpenID

from helpers.config import settings
from helpers.dependencies import get_session_token


keycloak_openid = KeycloakOpenID(
    server_url=settings.KEYCLOAK_URL,
    client_id=settings.KEYCLOAK_CLIENT_ID,
    realm_name=settings.KEYCLOAK_REALM,
    client_secret_key=settings.KEYCLOAK_CLIENT_SECRET,
)


LEVEL_ORDER = {"L1": 1, "L2": 2, "L3": 3, "L4": 4}

ACTIVITY_MIN_LEVELS = {
    "shipments.view": "L1",
    "shipments.create": "L2",
    "shipments.edit_metadata": "L2",
    "shipments.assign_user": "L3",
    "shipments.archive": "L3",
    "shipments.delete": "L4",
    "shipments.override_blocked_stage": "L4",
    "shipments.tag_partner": "L2",
    "documents.upload": "L1",
    "documents.view_extracted": "L1",
    "documents.download_export": "L1",
    "documents.edit_extracted": "L2",
    "documents.generate_draft": "L2",
    "documents.approve_draft": "L2",
    "documents.override_validation": "L3",
    "documents.reprocess_ocr": "L3",
    "documents.delete": "L4",
    "inventory.view_timeline": "L1",
    "inventory.view_container": "L1",
    "inventory.update_milestone": "L2",
    "inventory.upload_pod": "L2",
    "inventory.acknowledge_dnd": "L2",
    "accounting.view_queue": "L1",
    "accounting.view_ap_aging": "L1",
    "accounting.export_data": "L2",
    "accounting.review_ticket": "L2",
    "accounting.edit_entry": "L2",
    "accounting.reject_ticket": "L2",
    "accounting.post_to_erp": "L3",
    "reports.view_dashboard": "L1",
    "reports.generate_dsr": "L2",
    "reports.export_report": "L2",
    "reports.schedule_auto": "L3",
    "tasks.view": "L1",
    "admin.manage": "L3",
    "users.manage": "L3",
    "roles.view": "L2",
    "roles.manage": "L4",
    "documents.manage": "L2",
    "shipments.manage": "L2",
    "admin.manage_users": "L3",
    "admin.configure_roles": "L4",
    "admin.edit_workflows": "L4",
    "admin.configure_doctypes": "L3",
    "admin.edit_account_mappings": "L3",
    "admin.manage_partners": "L3",
    "admin.view_audit_log": "L3",
    "admin.security_settings": "L4",
}

IMPLIED_ACTIVITY_CODES = {
    "documents.manage": {
        "documents.upload",
        "documents.view_extracted",
        "documents.edit_extracted",
        "documents.generate_draft",
        "documents.approve_draft",
        "documents.override_validation",
        "documents.reprocess_ocr",
        "documents.download_export",
        "documents.delete",
    },
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


def _extract_roles(token_info: dict) -> list[str]:
    roles = list(token_info.get("realm_access", {}).get("roles", []) or [])
    for client_access in (token_info.get("resource_access", {}) or {}).values():
        roles.extend(client_access.get("roles", []) or [])
    return sorted({str(role) for role in roles})


def _primary_role_name(role_names: list[str]) -> str:
    normalized = {role.upper().replace("-", "_"): role for role in role_names}
    for role in ("SUPER_ADMIN", "ADMIN"):
        if role in normalized:
            return normalized[role]
    for role in role_names:
        normalized_role = role.upper().replace("-", "_")
        if (
            not role.startswith("default-roles-")
            and role not in {"offline_access", "uma_authorization"}
            and normalized_role not in {"USER", "ADMIN", "SUPER_ADMIN"}
        ):
            return role
    if "USER" in normalized:
        return normalized["USER"]
    return "USER"


def _highest_level(levels: list[str]) -> str:
    return sorted(levels or ["L1"], key=lambda item: LEVEL_ORDER.get(str(item).upper(), 0))[-1]


def _level_at_least(user_level: str, required_level: str) -> bool:
    return LEVEL_ORDER.get(str(user_level or "L1").upper(), 0) >= LEVEL_ORDER.get(str(required_level or "L1").upper(), 0)


def _expand_activity_codes(activities: set[str]) -> set[str]:
    expanded = set(activities)
    for activity in list(activities):
        expanded.update(IMPLIED_ACTIVITY_CODES.get(activity, set()))
    return expanded


def _admin_client() -> KeycloakAdmin:
    return KeycloakAdmin(
        server_url=settings.KEYCLOAK_URL,
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

    roles = _extract_roles(token_info)
    role_name = _primary_role_name(roles)
    admin = _admin_client()

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

    return {
        "email": str(userinfo.get("email") or userinfo.get("preferred_username") or "").lower(),
        "role": role_name,
        "level": user_level,
        "activities": _expand_activity_codes(set(_attr_values(role_attrs, "ewms.activities"))),
    }


def authorize_activity(token: str, activity_code: str) -> dict:
    context = _authz_context(token)
    if activity_code not in context["activities"]:
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied: missing activity {activity_code}",
        )

    required_level = ACTIVITY_MIN_LEVELS.get(activity_code, "L1")
    if not _level_at_least(str(context["level"]), required_level):
        raise HTTPException(
            status_code=403,
            detail=f"Permission denied: {activity_code} requires {required_level}",
        )

    return context


def require_activity(activity_code: str) -> Callable:
    async def checker(token: str | None = Depends(get_session_token)) -> dict:
        if not token:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return authorize_activity(token, activity_code)

    return checker
