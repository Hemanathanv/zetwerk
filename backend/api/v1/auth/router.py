"""
Keycloak-Only Authentication Router
Pure Keycloak authentication without legacy session system
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from typing import Optional, List

from helpers.config import settings
from helpers.rbac_data_access import doc_type_permissions_for_role, role_document_scope_from_attrs
from .keycloak_integration import (
    get_keycloak_user, get_keycloak_roles, check_role, check_any_role,
    get_keycloak_token, get_keycloak_auth_url, create_keycloak_user, get_keycloak_admin,
    refresh_keycloak_token
)

try:
    from api.v1.admin.router import ACTIVITY_DEFINITIONS, MODULE_DEFINITIONS
except Exception:
    ACTIVITY_DEFINITIONS = []
    MODULE_DEFINITIONS = []

router = APIRouter(prefix=settings.API_SLUG + "/auth", tags=["Auth"])

# =================================================================
# Authentication Models
# =================================================================

class LoginRequest(BaseModel):
    email: str
    password: str

class RefreshRequest(BaseModel):
    refresh_token: str

class AuthUrlRequest(BaseModel):
    redirect_uri: str
    state: Optional[str] = None

class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    roles: List[str] = ["user"]


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


def _normalize_data_scope(scope: str) -> str:
    normalized = str(scope or "").strip().upper()
    if normalized in {"ALL", "TEAM", "TAGGED"}:
        return normalized
    if normalized in {"ASSIGNED", "ASSIGNED_ONLY"}:
        return "TAGGED"
    return "TEAM"


def _expand_modules(modules: list[str]) -> list[str]:
    return sorted({str(module).strip() for module in modules if str(module).strip()})


ADMIN_FALLBACK_MODULES = [
    "dashboard",
    "shipments",
    "tasks",
    "documents",
    "inventory",
    "warehouse",
    "dnd",
    "accounting",
    "reports",
    "admin",
    "settings",
]

ALL_ADMIN_MODULES = [
    str(module.get("moduleCode"))
    for module in sorted(MODULE_DEFINITIONS, key=lambda item: int(item.get("sortOrder") or 0))
    if module.get("isActive") and module.get("moduleCode")
] or ADMIN_FALLBACK_MODULES

ALL_ADMIN_ACTIVITIES = sorted({
    str(activity.get("activityCode"))
    for activity in ACTIVITY_DEFINITIONS
    if activity.get("activityCode")
})

def _is_admin_role(role_name: str) -> bool:
    normalized = str(role_name or "").upper().replace("-", "_").replace(" ", "_")
    return normalized in {"ADMIN", "ORG_ADMIN", "SUPER_ADMIN", "SUPER_ADMINISTRATOR"}


ACTIVITY_MODULE_OVERRIDES = {
    "inventory.view_warehouse": "warehouse",
    "inventory.warehouse_inventory_stock_position": "warehouse",
    "inventory.acknowledge_dnd": "dnd",
    "inventory.view_dnd_charges": "dnd",
    "inventory.view_last_free_days_shipment_based": "dnd",
    "inventory.view_lfd_calendar": "dnd",
    "inventory.modify_lfd": "dnd",
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


def _activity_module(activity_code: str) -> str:
    code = str(activity_code or "").strip()
    if code in ACTIVITY_MODULE_OVERRIDES:
        return ACTIVITY_MODULE_OVERRIDES[code]
    prefix = code.split(".", 1)[0]
    if prefix in {"shipments", "documents", "inventory", "dnd", "accounting", "reports", "tasks", "admin"}:
        return prefix
    return ""


def _filter_activities_for_modules(activities: list[str], modules: list[str]) -> list[str]:
    module_set = set(modules)
    configured_activity_modules = {
        str(activity.get("activityCode")): str(activity.get("moduleCode") or activity.get("category") or "")
        for activity in ACTIVITY_DEFINITIONS
        if activity.get("activityCode")
    }
    configured_activity_codes = set(configured_activity_modules)
    configured_activity_codes.update(
        alias
        for source, aliases in LEGACY_ACTIVITY_ALIASES.items()
        if source in configured_activity_modules
        for alias in aliases
    )
    filtered = []
    for activity in activities:
        if configured_activity_modules and activity not in configured_activity_codes:
            continue
        module = _activity_module(activity)
        if not module:
            continue
        if module in module_set or ("partner" in module_set and module in {"documents", "shipments", "inventory", "warehouse"}):
            filtered.append(activity)
    return sorted(set(filtered))


def _primary_role_name(role_names: list[str]) -> str:
    normalized = {role.upper().replace("-", "_").replace(" ", "_"): role for role in role_names}
    for role in ("SUPER_ADMIN", "SUPER_ADMINISTRATOR", "ORG_ADMIN", "ADMIN"):
        if role in normalized:
            return normalized[role]
    for role in role_names:
        normalized_role = role.upper().replace("-", "_").replace(" ", "_")
        if (
            not role.startswith("default-roles-")
            and role not in {"offline_access", "uma_authorization"}
            and normalized_role not in {"USER", "ADMIN", "ORG_ADMIN", "SUPER_ADMIN", "SUPER_ADMINISTRATOR"}
        ):
            return role
    if "USER" in normalized:
        return normalized["USER"]
    return "USER"


def _legacy_activity_codes(activities: list[str]) -> list[str]:
    codes = set(activities)
    if "documents.view" in codes:
        codes.add("documents.view_extracted")
    for activity in list(codes):
        codes.update(LEGACY_ACTIVITY_ALIASES.get(activity, set()))
    return sorted(codes)


def _permissions_from_role(role: dict) -> dict:
    attrs = role.get("attributes") or {}
    role_name = str(role.get("name") or "USER")
    role_category = _attr_value(attrs, "ewms.category", "org_internal")
    if _is_admin_role(role_name):
        modules = ALL_ADMIN_MODULES
        activities = _legacy_activity_codes(ALL_ADMIN_ACTIVITIES)
    else:
        modules = _expand_modules(_attr_values(attrs, "ewms.modules"))
        activities = _filter_activities_for_modules(
            _legacy_activity_codes(_attr_values(attrs, "ewms.activities")),
            modules,
        )
    activity_doc_types = {}
    try:
        parsed_scopes = json.loads(_attr_json_value(attrs, "ewms.docTypeScopes", "{}"))
        if isinstance(parsed_scopes, dict):
            activity_doc_types = {
                str(activity): sorted({str(doc_type) for doc_type in doc_types if str(doc_type)})
                for activity, doc_types in parsed_scopes.items()
                if isinstance(doc_types, list)
            }
    except Exception:
        activity_doc_types = {}
    try:
        parsed_sla = json.loads(_attr_json_value(attrs, "ewms.activitySla", "[]"))
        activity_sla = [
            item for item in parsed_sla
            if isinstance(item, dict)
            and str(item.get("activityCode") or "").strip()
            and str(item.get("activityType") or "").strip()
        ] if isinstance(parsed_sla, list) else []
    except Exception:
        activity_sla = []
    return {
        "modules": modules,
        "gates": [],
        "docTypes": doc_type_permissions_for_role(role_name, attrs),
        "documentScope": sorted(role_document_scope_from_attrs(attrs) or []),
        "activityDocTypes": activity_doc_types,
        "activitySla": activity_sla,
        "ticketCategories": [],
        "activities": activities,
        "dataScope": _normalize_data_scope(_attr_value(attrs, "ewms.dataScope", "TEAM")),
        "role": {
            "id": role_name,
            "name": _attr_value(attrs, "ewms.displayName", role_name.replace("_", " ").title()),
            "category": role_category,
            "color": _attr_value(attrs, "ewms.color", "#0f766e"),
            "systemCode": role_name.lower(),
        },
    }

# =================================================================
# Core Authentication Endpoints
# =================================================================

@router.post("/login")
async def login(request: LoginRequest):
    """
    Login using Keycloak credentials
    """
    try:
        token_response = await get_keycloak_token(request.email.strip(), request.password)
        return {
            "status": "success",
            "access_token": token_response["access_token"],
            "refresh_token": token_response["refresh_token"],
            "expires_in": token_response["expires_in"]
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Keycloak login error: {e}")
        raise HTTPException(status_code=500, detail="Authentication service error")

@router.post("/refresh")
async def refresh_token(request: RefreshRequest):
    """
    Refresh Keycloak access token using the refresh token.
    """
    token_response = await refresh_keycloak_token(request.refresh_token)
    return {
        "status": "success",
        "access_token": token_response["access_token"],
        "refresh_token": token_response.get("refresh_token", request.refresh_token),
        "expires_in": token_response.get("expires_in"),
    }

@router.get("/auth-url")
async def get_auth_url(request: AuthUrlRequest):
    """
    Get Keycloak authentication URL for OAuth flow
    """
    try:
        auth_url = await get_keycloak_auth_url(
            redirect_uri=request.redirect_uri,
            state=request.state
        )
        return {"auth_url": auth_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not generate auth URL")

@router.get("/userinfo")
async def get_userinfo(user: dict = Depends(get_keycloak_user)):
    """
    Get current user information from Keycloak
    """
    return {"user": user}

@router.get("/roles")
async def get_roles(roles: List[str] = Depends(get_keycloak_roles)):
    """
    Get current user's roles from Keycloak
    """
    return {"roles": roles}


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
    "dnd.view_charges": {"dnd.activate"},
    "dnd.save_inputs": {
        "dnd.activate",
        "dnd.activate.start_event_date",
        "dnd.activate.holiday_days",
        "dnd.activate.weekends",
    },
    "dnd.manage_carriers": {"dnd.tariff.create", "dnd.tariff.edit"},
    "dnd.upload_holidays": {"dnd.holiday_calendar.upload"},
    "dnd.publish_tariff": {"dnd.tariff.create"},
    "dnd.force_expire_tariff": {"dnd.tariff.force_expire"},
}

ACTIVITY_MIN_LEVELS = {
    str(activity.get("activityCode")): str(activity.get("minLevel") or "L1").upper()
    for activity in ACTIVITY_DEFINITIONS
    if activity.get("activityCode")
}
for source_activity, legacy_aliases in LEGACY_ACTIVITY_ALIASES.items():
    source_level = ACTIVITY_MIN_LEVELS.get(source_activity)
    if not source_level:
        continue
    for legacy_alias in legacy_aliases:
        ACTIVITY_MIN_LEVELS.setdefault(legacy_alias, source_level)


def _highest_level(levels: list[str]) -> str:
    return sorted(levels or ["L1"], key=lambda item: LEVEL_ORDER.get(str(item).upper(), 0))[-1]


def _level_at_least(user_level: str, required_level: str) -> bool:
    return LEVEL_ORDER.get(str(user_level or "L1").upper(), 0) >= LEVEL_ORDER.get(str(required_level or "L1").upper(), 0)


def _expand_activity_codes(activities: list[str]) -> list[str]:
    expanded = set(activities)
    for activity in activities:
        expanded.update(IMPLIED_ACTIVITY_CODES.get(activity, set()))
    for activity in list(expanded):
        expanded.update(LEGACY_ACTIVITY_ALIASES.get(activity, set()))
    return sorted(expanded)


def _filter_activities_for_level(activities: list[str], user_level: str) -> list[str]:
    return sorted({
        activity
        for activity in activities
        if _level_at_least(user_level, ACTIVITY_MIN_LEVELS.get(activity, "L1"))
    })


def _user_level_from_keycloak(keycloak_admin, userinfo: dict, role: dict) -> str:
    attrs = role.get("attributes") or {}
    default_level = _highest_level(_attr_values(attrs, "ewms.levels"))
    user_id = str(userinfo.get("sub") or "")
    email = str(userinfo.get("email") or userinfo.get("preferred_username") or "").lower()
    try:
        if user_id:
            user = keycloak_admin.get_user(user_id)
        else:
            keycloak_id = keycloak_admin.get_user_id(email)
            user = keycloak_admin.get_user(keycloak_id) if keycloak_id else {}
        return _attr_value(user.get("attributes") or {}, "ewms.level", default_level)
    except Exception:
        return default_level


@router.get("/permissions")
async def get_permissions(
    userinfo: dict = Depends(get_keycloak_user),
    roles: List[str] = Depends(get_keycloak_roles),
):
    """
    Return current user's screen and activity access.
    """
    role_name = _primary_role_name(roles)
    try:
        keycloak_admin = get_keycloak_admin()
        role = keycloak_admin.get_realm_role(role_name)
        user_level = _user_level_from_keycloak(keycloak_admin, userinfo, role)
    except Exception:
        is_admin_role = _is_admin_role(role_name)
        fallback_modules = ADMIN_FALLBACK_MODULES if is_admin_role else []
        role = {
            "name": role_name,
            "attributes": {
                "ewms.displayName": [role_name.replace("_", " ").title()],
                "ewms.category": ["org_internal"],
                "ewms.modules": fallback_modules,
                "ewms.activities": ALL_ADMIN_ACTIVITIES if is_admin_role else [],
                "ewms.levels": ["L4"] if is_admin_role else [],
                "ewms.dataScope": ["TEAM"],
                "ewms.color": ["#0f766e"],
            },
        }
        user_level = _highest_level(_attr_values(role["attributes"], "ewms.levels"))

    permissions = _permissions_from_role(role)
    if _is_admin_role(role_name) and not _attr_values(role.get("attributes") or {}, "ewms.levels"):
        user_level = "L4"
    permissions["activities"] = _expand_activity_codes(permissions["activities"]) if _is_admin_role(role_name) else _filter_activities_for_level(
        _expand_activity_codes(permissions["activities"]),
        user_level,
    )
    return {"ok": True, "data": permissions}


@router.get("/level")
async def get_level(
    userinfo: dict = Depends(get_keycloak_user),
    roles: List[str] = Depends(get_keycloak_roles),
):
    """
    Return current user's EWMS level label and assigned activities.
    """
    role_name = _primary_role_name(roles)
    try:
        keycloak_admin = get_keycloak_admin()
        role = keycloak_admin.get_realm_role(role_name)
        level = _user_level_from_keycloak(keycloak_admin, userinfo, role)
        if _is_admin_role(role_name) and not _attr_values(role.get("attributes") or {}, "ewms.levels"):
            level = "L4"
        if _is_admin_role(role_name):
            level = "L4"
            activities = _expand_activity_codes(_legacy_activity_codes(ALL_ADMIN_ACTIVITIES))
        else:
            role_activities = _attr_values(role.get("attributes") or {}, "ewms.activities")
            role_modules = _expand_modules(_attr_values(role.get("attributes") or {}, "ewms.modules"))
            activities = _filter_activities_for_level(
                _expand_activity_codes(
                    _filter_activities_for_modules(_legacy_activity_codes(role_activities), role_modules)
                ),
                level,
            )
    except Exception:
        role = {"attributes": {"ewms.levels": ["L1"]}}
        level = _highest_level(_attr_values(role["attributes"], "ewms.levels"))
        activities = []

    return {
        "ok": True,
        "data": {
            "level": level,
            "activities": activities,
        },
    }

# =================================================================
# Role-Based Access Control Endpoints
# =================================================================

@router.get("/rbac/check-role")
async def check_role_endpoint(
    role: str,
    roles: List[str] = Depends(get_keycloak_roles),
):
    """
    Check if user has specific role
    """
    if role not in roles:
        raise HTTPException(status_code=403, detail=f"Role '{role}' required")
    return {"status": "success", "has_role": True}

@router.get("/rbac/check-any-role")
async def check_any_user_role_endpoint(
    roles: str,  # Comma-separated list
    user_roles: List[str] = Depends(get_keycloak_roles),
):
    """
    Check if user has any of the specified roles
    """
    required_roles = [role.strip() for role in roles.split(",") if role.strip()]
    if not any(role in user_roles for role in required_roles):
        raise HTTPException(status_code=403, detail=f"One of these roles required: {', '.join(required_roles)}")
    return {"status": "success", "has_any_role": True}

# =================================================================
# User Management Endpoints (Admin Only)
# =================================================================

@router.post("/users")
async def create_user(
    request: CreateUserRequest,
    _ = Depends(check_role("admin"))
):
    """
    Create new user in Keycloak (admin only)
    """
    try:
        user_id = await create_keycloak_user(
            email=request.email,
            password=request.password,
            first_name=request.first_name,
            last_name=request.last_name,
            roles=request.roles
        )
        return {
            "status": "success",
            "user_id": user_id,
            "message": "User created successfully"
        }
    except Exception as e:
        print(f"User creation error: {e}")
        raise HTTPException(status_code=500, detail="Could not create user")

@router.get("/users")
async def list_users(
    _ = Depends(check_role("admin"))
):
    """
    List all users in Keycloak (admin only)
    """
    try:
        keycloak_admin = get_keycloak_admin()
        users = keycloak_admin.get_users({})

        # Enrich with role information
        enriched_users = []
        for user in users:
            user_roles = keycloak_admin.get_realm_roles_of_user(user['id'])
            enriched_users.append({
                **user,
                "roles": user_roles
            })

        return {"users": enriched_users}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not list users")

@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    _ = Depends(check_role("admin"))
):
    """
    Delete user from Keycloak (admin only)
    """
    try:
        keycloak_admin = get_keycloak_admin()
        keycloak_admin.delete_user(user_id)
        return {"status": "success", "message": "User deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not delete user")

@router.post("/users/{user_id}/roles")
async def assign_roles_to_user(
    user_id: str,
    roles: List[str],
    _ = Depends(check_role("admin"))
):
    """
    Assign roles to user (admin only)
    """
    try:
        keycloak_admin = get_keycloak_admin()

        # Get available roles
        realm_roles = keycloak_admin.get_realm_roles()
        roles_to_assign = [role for role in realm_roles if role['name'] in roles]

        if not roles_to_assign:
            raise HTTPException(status_code=404, detail="No valid roles found")

        keycloak_admin.assign_realm_roles(user_id, roles_to_assign)

        return {
            "status": "success",
            "message": f"Assigned {len(roles_to_assign)} roles to user {user_id}",
            "assigned_roles": [role['name'] for role in roles_to_assign]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not assign roles")

@router.delete("/users/{user_id}/roles/{role_name}")
async def remove_role_from_user(
    user_id: str,
    role_name: str,
    _ = Depends(check_role("admin"))
):
    """
    Remove role from user (admin only)
    """
    try:
        keycloak_admin = get_keycloak_admin()

        # Get the role
        realm_roles = keycloak_admin.get_realm_roles()
        role = next((r for r in realm_roles if r['name'] == role_name), None)

        if not role:
            raise HTTPException(status_code=404, detail="Role not found")

        keycloak_admin.delete_realm_roles_of_user(user_id, [role])

        return {
            "status": "success",
            "message": f"Removed role {role_name} from user {user_id}"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not remove role")

# =================================================================
# Role Management Endpoints (Admin Only)
# =================================================================

class CreateRoleRequest(BaseModel):
    name: str
    description: Optional[str] = None

@router.post("/roles")
async def create_role(
    request: CreateRoleRequest,
    _ = Depends(check_role("admin"))
):
    """
    Create new role in Keycloak (admin only)
    """
    try:
        keycloak_admin = get_keycloak_admin()
        role = keycloak_admin.create_realm_role({
            "name": request.name,
            "description": request.description
        })
        return {
            "status": "success",
            "role": role,
            "message": "Role created successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not create role")

@router.get("/roles")
async def list_roles(
    _ = Depends(check_role("admin"))
):
    """
    List all roles in Keycloak (admin only)
    """
    try:
        keycloak_admin = get_keycloak_admin()
        roles = keycloak_admin.get_realm_roles()
        return {"roles": roles}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not list roles")
