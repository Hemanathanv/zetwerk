"""
Keycloak Integration Module
Provides authentication and authorization services using Keycloak
"""
from keycloak import KeycloakOpenID, KeycloakAdmin
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from helpers.config import settings
from typing import Optional, List

# Keycloak OpenID client for authentication
keycloak_openid = KeycloakOpenID(
    server_url=settings.KEYCLOAK_URL,
    client_id=settings.KEYCLOAK_CLIENT_ID,
    realm_name=settings.KEYCLOAK_REALM,
    client_secret_key=settings.KEYCLOAK_CLIENT_SECRET
)

# OAuth2 scheme for token authentication
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.KEYCLOAK_URL}/realms/{settings.KEYCLOAK_REALM}/protocol/openid-connect/token"
)


def _extract_roles(token_info: dict) -> List[str]:
    roles = list(token_info.get("realm_access", {}).get("roles", []) or [])
    resource_access = token_info.get("resource_access", {}) or {}
    for client_access in resource_access.values():
        roles.extend(client_access.get("roles", []) or [])
    return sorted({str(role) for role in roles})


def _has_role(roles: List[str], required_role: str) -> bool:
    normalized_roles = {str(role).upper().replace("-", "_") for role in roles}
    normalized_required = required_role.upper().replace("-", "_")
    return normalized_required in normalized_roles

def get_keycloak_admin():
    """Get Keycloak admin client for user management"""
    return KeycloakAdmin(
        server_url=settings.KEYCLOAK_URL,
        username=settings.KEYCLOAK_ADMIN_USERNAME,
        password=settings.KEYCLOAK_ADMIN_PASSWORD,
        realm_name=settings.KEYCLOAK_REALM,
        user_realm_name="master",
        client_id="admin-cli",
        verify=True
    )

async def get_keycloak_user(token: str = Depends(oauth2_scheme)):
    """
    Get current user information from Keycloak token

    Returns:
        dict: User information from Keycloak

    Raises:
        HTTPException: 401 if token is invalid
    """
    try:
        userinfo = keycloak_openid.userinfo(token)
        return userinfo
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def get_keycloak_roles(token: str = Depends(oauth2_scheme)) -> List[str]:
    """
    Get current user's roles from Keycloak token

    Returns:
        List[str]: List of user roles

    Raises:
        HTTPException: 401 if token is invalid
    """
    try:
        token_info = keycloak_openid.decode_token(
            token,
            keycloak_openid.public_key()
        )
        return _extract_roles(token_info)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )

def check_role(required_role: str):
    """
    Dependency to check if user has a specific role

    Args:
        required_role (str): Role to check for

    Returns:
        callable: Dependency function
    """
    async def role_checker(roles: List[str] = Depends(get_keycloak_roles)):
        if not _has_role(roles, required_role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{required_role}' required"
            )
        return True
    return role_checker

def check_any_role(required_roles: List[str]):
    """
    Dependency to check if user has any of the specified roles

    Args:
        required_roles (List[str]): List of roles to check for

    Returns:
        callable: Dependency function
    """
    async def role_checker(roles: List[str] = Depends(get_keycloak_roles)):
        if not any(_has_role(roles, role) for role in required_roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"One of these roles required: {', '.join(required_roles)}"
            )
        return True
    return role_checker

async def create_keycloak_user(email: str, password: str, first_name: str, last_name: str, roles: List[str] = None):
    """
    Create a new user in Keycloak

    Args:
        email (str): User email
        password (str): User password
        first_name (str): User first name
        last_name (str): User last name
        roles (List[str]): List of roles to assign

    Returns:
        str: Created user ID
    """
    keycloak_admin = get_keycloak_admin()

    # Create user
    user_id = keycloak_admin.create_user({
        "username": email,
        "email": email,
        "firstName": first_name,
        "lastName": last_name,
        "enabled": True,
        "credentials": [{
            "type": "password",
            "value": password,
            "temporary": False
        }]
    })

    # Assign roles if provided
    if roles:
        realm_roles = keycloak_admin.get_realm_roles()
        roles_to_assign = [role for role in realm_roles if role['name'] in roles]
        if roles_to_assign:
            keycloak_admin.assign_realm_roles(user_id, roles_to_assign)

    return user_id

async def sync_keycloak_roles(user_id: str, roles: List[str]):
    """
    Sync user roles in Keycloak

    Args:
        user_id (str): Keycloak user ID
        roles (List[str]): Roles to assign
    """
    keycloak_admin = get_keycloak_admin()

    # Get all realm roles
    realm_roles = keycloak_admin.get_realm_roles()
    roles_to_assign = [role for role in realm_roles if role['name'] in roles]

    if roles_to_assign:
        keycloak_admin.assign_realm_roles(user_id, roles_to_assign)

async def get_keycloak_token(username: str, password: str) -> dict:
    """
    Get Keycloak token for username/password

    Args:
        username (str): Username
        password (str): Password

    Returns:
        dict: Token response
    """
    try:
        return keycloak_openid.token(
            username=username,
            grant_type="password",
            password=password
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )


async def refresh_keycloak_token(refresh_token: str) -> dict:
    """
    Refresh a Keycloak access token using a refresh token.
    """
    try:
        return keycloak_openid.refresh_token(refresh_token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token"
        )

async def get_keycloak_auth_url(redirect_uri: str, state: Optional[str] = None) -> str:
    """
    Get Keycloak authentication URL for OAuth flow

    Args:
        redirect_uri (str): Redirect URI
        state (str): Optional state parameter

    Returns:
        str: Authentication URL
    """
    return keycloak_openid.auth_url(
        redirect_uri=redirect_uri,
        state=state or "default_state"
    )
