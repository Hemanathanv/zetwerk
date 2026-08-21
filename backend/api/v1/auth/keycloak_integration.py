"""
Keycloak Integration Module
Provides authentication and authorization services using Keycloak
"""
import json

from keycloak import KeycloakOpenID, KeycloakAdmin
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from helpers.config import settings
from typing import Optional, List

KEYCLOAK_URL_BASE = settings.KEYCLOAK_URL.rstrip("/")
KEYCLOAK_SERVER_URL = f"{KEYCLOAK_URL_BASE}/"


def _keycloak_server_url_candidates() -> list[str]:
    configured = f"{settings.KEYCLOAK_URL.rstrip('/')}/"
    candidates = [configured]
    if configured.rstrip('/').endswith('/keycloak'):
        candidates.append(f"{configured.rstrip('/')[:-len('/keycloak')]}/")
    else:
        candidates.append(f"{configured.rstrip('/')}/keycloak/")
    seen: set[str] = set()
    return [url for url in candidates if not (url in seen or seen.add(url))]


def _openid_client(server_url: str) -> KeycloakOpenID:
    return KeycloakOpenID(
        server_url=server_url,
        client_id=settings.KEYCLOAK_CLIENT_ID,
        realm_name=settings.KEYCLOAK_REALM,
        client_secret_key=settings.KEYCLOAK_CLIENT_SECRET,
    )


# Keycloak OpenID client for authentication
keycloak_openid = _openid_client(KEYCLOAK_SERVER_URL)

# OAuth2 scheme for token authentication
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{KEYCLOAK_URL_BASE}/realms/{settings.KEYCLOAK_REALM}/protocol/openid-connect/token",
    auto_error=False,
)

ACCESS_TOKEN_COOKIE = "access_token"


def _extract_token(request: Request, token: Optional[str]) -> Optional[str]:
    """Extract access token from Authorization header or httpOnly cookie."""
    if token:
        return token
    return request.cookies.get(ACCESS_TOKEN_COOKIE)


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

def _keycloak_exception_message(exc: Exception) -> str:
    for attr in ("response_body", "error_message"):
        value = getattr(exc, attr, None)
        if isinstance(value, bytes):
            value = value.decode("utf-8", "replace")
        if not value:
            continue
        text = str(value)
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                description = parsed.get("error_description") or parsed.get("error")
                if description:
                    return str(description)[:500]
        except Exception:
            pass
        return text[:500]
    return str(exc)[:500]


def _keycloak_login_user_state(login_identifier: str) -> str:
    identifier = str(login_identifier or "").strip()
    if not identifier:
        return ""
    try:
        admin = get_keycloak_admin()
        matches = []
        if "@" in identifier:
            matches = admin.get_users({"email": identifier, "exact": True, "max": 3}) or []
        if not matches:
            matches = admin.get_users({"username": identifier, "exact": True, "max": 3}) or []
        if not matches:
            return ""
        user = admin.get_user(str(matches[0].get("id") or "")) or matches[0]
        state_bits = []
        if user.get("enabled") is False:
            state_bits.append("disabled")
        if user.get("emailVerified") is False:
            state_bits.append("email not verified")
        actions = user.get("requiredActions") or []
        if actions:
            state_bits.append(f"required actions: {', '.join(str(action) for action in actions)}")
        if len(matches) > 1:
            state_bits.append(f"duplicate matches: {len(matches)}")
        return "; ".join(state_bits)
    except Exception:
        return ""


def get_keycloak_admin():
    """Get Keycloak admin client for user management"""
    first_error: Exception | None = None
    for server_url in _keycloak_server_url_candidates():
        admin = KeycloakAdmin(
            server_url=server_url,
            username=settings.KEYCLOAK_ADMIN_USERNAME,
            password=settings.KEYCLOAK_ADMIN_PASSWORD,
            realm_name=settings.KEYCLOAK_REALM,
            user_realm_name="master",
            client_id="admin-cli",
            verify=True,
        )
        try:
            admin.get_realm(settings.KEYCLOAK_REALM)
            return admin
        except Exception as exc:
            if first_error is None:
                first_error = exc
    if first_error is not None:
        raise first_error
    return KeycloakAdmin(
        server_url=KEYCLOAK_SERVER_URL,
        username=settings.KEYCLOAK_ADMIN_USERNAME,
        password=settings.KEYCLOAK_ADMIN_PASSWORD,
        realm_name=settings.KEYCLOAK_REALM,
        user_realm_name="master",
        client_id="admin-cli",
        verify=True,
    )

async def get_keycloak_user(request: Request, token: Optional[str] = Depends(oauth2_scheme)):
    """
    Get current user information from a Keycloak access token.
    Reads from Authorization header or httpOnly cookie.
    """
    resolved_token = _extract_token(request, token)
    if not resolved_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        token_info = keycloak_openid.decode_token(
            resolved_token,
            keycloak_openid.public_key(),
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        userinfo = keycloak_openid.userinfo(resolved_token)
        return {**token_info, **userinfo}
    except Exception:
        return token_info

async def get_keycloak_roles(request: Request, token: Optional[str] = Depends(oauth2_scheme)) -> List[str]:
    """
    Get current user's roles from Keycloak token

    Returns:
        List[str]: List of user roles

    Raises:
        HTTPException: 401 if token is invalid
    """
    resolved_token = _extract_token(request, token)
    if not resolved_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        token_info = keycloak_openid.decode_token(
            resolved_token,
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

def _safe_last_name(value: str | None) -> str:
    return str(value or "").strip() or "-"


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
        "lastName": _safe_last_name(last_name),
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
    login_identifier = str(username or "").strip()
    candidate_usernames = [login_identifier]
    if "@" in login_identifier:
        try:
            matches = get_keycloak_admin().get_users({"email": login_identifier, "exact": True, "max": 2})
            for user in matches or []:
                resolved_username = str(user.get("username") or "").strip()
                if resolved_username and resolved_username not in candidate_usernames:
                    candidate_usernames.append(resolved_username)
        except Exception:
            pass

    errors: list[str] = []
    for server_url in _keycloak_server_url_candidates():
        openid = _openid_client(server_url)
        for candidate_username in candidate_usernames:
            try:
                return openid.token(
                    username=candidate_username,
                    grant_type="password",
                    password=password,
                )
            except Exception as exc:
                message = _keycloak_exception_message(exc)
                if message and message not in errors:
                    errors.append(message)
                continue

    detail = "Invalid username or password"
    if errors:
        detail = f"Keycloak login failed: {errors[0]}"
    user_state = _keycloak_login_user_state(login_identifier)
    if user_state:
        detail = f"{detail} ({user_state})"
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
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
