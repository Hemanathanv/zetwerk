"""
Keycloak-Only Authentication Router
Pure Keycloak authentication without legacy session system
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from typing import Optional, List

from helpers.config import settings
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
