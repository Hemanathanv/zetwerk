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
    "documents.view_draft": {"documents.generate_draft", "DOC-003"},
    "documents.fill_manual_fields": {"documents.generate_draft", "DOC-003"},
    "documents.modify_generated_fields": {"documents.generate_draft", "DOC-003"},
    "documents.save_draft": {"documents.generate_draft", "DOC-003"},
    "documents.submit_for_review": {"documents.generate_draft", "DOC-003"},
    "documents.approve_generated_document": {"documents.generate_draft", "DOC-003"},
    "documents.reject_generated_document": {"documents.generate_draft", "DOC-003"},
    "documents.re_trigger_generation": {"documents.generate_draft", "DOC-003"},
    "documents.discard_draft": {"documents.generate_draft", "DOC-003"},
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


def _expand_activity_codes(activities: set[str]) -> set[str]:
    expanded = set(activities)
    if "documents.view" in expanded:
        expanded.add("documents.view_extracted")
    for activity in list(activities):
        expanded.update(IMPLIED_ACTIVITY_CODES.get(activity, set()))
    for activity in list(expanded):
        expanded.update(LEGACY_ACTIVITY_ALIASES.get(activity, set()))
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

    return context


def require_activity(activity_code: str) -> Callable:
    async def checker(token: str | None = Depends(get_session_token)) -> dict:
        if not token:
            raise HTTPException(status_code=401, detail="Not authenticated")
        return authorize_activity(token, activity_code)

    return checker
