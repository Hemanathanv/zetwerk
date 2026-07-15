"""
Keycloak-Only Authentication Router
Pure Keycloak authentication without legacy session system
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from typing import Optional, List

from helpers.config import settings
from helpers.rbac_data_access import doc_type_permissions_for_role
from .keycloak_integration import (
    get_keycloak_user, get_keycloak_roles, check_role, check_any_role,
    get_keycloak_token, get_keycloak_auth_url, create_keycloak_user, get_keycloak_admin,
    refresh_keycloak_token
)

router = APIRouter(prefix=settings.API_SLUG + "/auth", tags=["Auth"])

# =================================================================
# Authentication Models
# =================================================================

class LoginRequest(BaseModel):
    email: EmailStr
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


def _normalize_data_scope(scope: str) -> str:
    normalized = str(scope or "").strip().upper()
    if normalized in {"ALL", "TEAM", "TAGGED"}:
        return normalized
    if normalized in {"ASSIGNED", "ASSIGNED_ONLY"}:
        return "TAGGED"
    return "TEAM"


def _expand_modules(modules: list[str]) -> list[str]:
    expanded = set(modules)
    if "inventory" in expanded:
        expanded.update({"warehouse", "dnd"})
    return sorted(expanded)


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


def _legacy_activity_codes(activities: list[str]) -> list[str]:
    codes = set(activities)
    if "documents.generate_draft" in codes or "documents.approve_draft" in codes:
        codes.add("DOC-003")
    return sorted(codes)


def _permissions_from_role(role: dict) -> dict:
    attrs = role.get("attributes") or {}
    role_name = str(role.get("name") or "USER")
    role_category = _attr_value(attrs, "ewms.category", "org_internal")
    modules = _expand_modules(_attr_values(attrs, "ewms.modules"))
    activities = _legacy_activity_codes(_attr_values(attrs, "ewms.activities"))
    return {
        "modules": modules,
        "gates": [],
        "docTypes": doc_type_permissions_for_role(role_name),
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
        token_response = await get_keycloak_token(request.email, request.password)
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


def _level_at_least(user_level: str, required_level: str) -> bool:
    return LEVEL_ORDER.get(str(user_level or "L1").upper(), 0) >= LEVEL_ORDER.get(str(required_level or "L1").upper(), 0)


def _highest_level(levels: list[str]) -> str:
    return sorted(levels or ["L1"], key=lambda item: LEVEL_ORDER.get(str(item).upper(), 0))[-1]


def _activities_for_level(activities: list[str], user_level: str) -> list[str]:
    expanded = set(activities)
    for activity in activities:
        expanded.update(IMPLIED_ACTIVITY_CODES.get(activity, set()))
    return [
        activity
        for activity in expanded
        if _level_at_least(user_level, ACTIVITY_MIN_LEVELS.get(activity, "L1"))
    ]


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
    Return current user's screen and activity access from Keycloak role attributes.
    """
    role_name = _primary_role_name(roles)
    try:
        keycloak_admin = get_keycloak_admin()
        role = keycloak_admin.get_realm_role(role_name)
        user_level = _user_level_from_keycloak(keycloak_admin, userinfo, role)
    except Exception:
        fallback_modules = ["dashboard", "shipments", "documents", "tasks"]
        role = {
            "name": role_name,
            "attributes": {
                "ewms.displayName": [role_name.replace("_", " ").title()],
                "ewms.category": ["org_internal"],
                "ewms.modules": fallback_modules,
                "ewms.activities": ["shipments.view", "documents.view_extracted"],
                "ewms.dataScope": ["TEAM"],
                "ewms.color": ["#0f766e"],
            },
        }
        user_level = _highest_level(_attr_values(role["attributes"], "ewms.levels"))

    permissions = _permissions_from_role(role)
    permissions["activities"] = _activities_for_level(permissions["activities"], user_level)
    return {"ok": True, "data": permissions}


@router.get("/level")
async def get_level(
    userinfo: dict = Depends(get_keycloak_user),
    roles: List[str] = Depends(get_keycloak_roles),
):
    """
    Return current user's EWMS authority level and level-filtered activities.
    """
    role_name = _primary_role_name(roles)
    try:
        keycloak_admin = get_keycloak_admin()
        role = keycloak_admin.get_realm_role(role_name)
        level = _user_level_from_keycloak(keycloak_admin, userinfo, role)
        activities = _activities_for_level(
            _legacy_activity_codes(_attr_values(role.get("attributes") or {}, "ewms.activities")),
            level,
        )
    except Exception:
        role = {"attributes": {"ewms.levels": ["L1"]}}
        level = _highest_level(_attr_values(role["attributes"], "ewms.levels"))
        activities = []

    return {
        "ok": True,
        "data": {
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
