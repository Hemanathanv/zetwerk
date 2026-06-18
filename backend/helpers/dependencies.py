from typing import Optional, Callable
from datetime import datetime, timezone
from functools import wraps
from fastapi import Request, HTTPException, Depends, Cookie, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from keycloak import KeycloakOpenID
from db import get_prisma
from helpers.config import settings

bearer_scheme = HTTPBearer(auto_error=False)
keycloak_openid = KeycloakOpenID(
    server_url=settings.KEYCLOAK_URL,
    client_id=settings.KEYCLOAK_CLIENT_ID,
    realm_name=settings.KEYCLOAK_REALM,
    client_secret_key=settings.KEYCLOAK_CLIENT_SECRET,
)

KEYCLOAK_ADMIN_EMAILS = {"admin@sprconsultech.com"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def get_session_token(
    request: Request,
    session_token: Optional[str] = Cookie(None, alias="session_token"),
    credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_scheme),
) -> Optional[str]:
    """Extract session token from cookie or Authorization header."""
    # Try cookie first
    if session_token:
        return session_token

    # Swagger's Authorize button sends a bearer token through the security scheme.
    if credentials and credentials.scheme.lower() == "bearer":
        return credentials.credentials

    # Fallback for manually supplied Authorization headers.
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header[7:]
    
    return None


async def is_authenticated(
    token: Optional[str] = Depends(get_session_token)
) -> bool:
    """
    Check if user is authenticated. Returns True or False.
    
    Can be used as a decorator:
        @router.get("/protected")
        @is_authenticated
        async def protected_route():
            return {"message": "You are authenticated"}
    
    Or as a dependency:
        @router.get("/protected")
        async def protected_route(authenticated = Depends(is_authenticated)):
            if not authenticated:
                raise HTTPException(status_code=401, detail="Not authenticated")
            return {"message": "You are authenticated"}
    
    Returns:
        bool: True if user is authenticated, False otherwise
    """
    if not token:
        return False
    
    try:
        user = await _get_session_user(token)
        if user:
            return True
        user = await _get_keycloak_local_user(token)
        return bool(user)
    except Exception:
        return False


def authenticate(func: Callable) -> Callable:
    """
    Decorator to check authentication and raise error if not authenticated.
    Returns True/False from is_authenticated().
    
    Usage:
        @router.get("/protected")
        @authenticate
        async def protected_route():
            return {"message": "You are authenticated"}
    
    Raises:
        HTTPException (401): If user is not authenticated or inactive
    """
    @wraps(func)
    async def wrapper(*args, **kwargs):
        is_auth = await is_authenticated()
        if not is_auth:
            raise HTTPException(
                status_code=401,
                detail="Not authenticated"
            )
        return await func(*args, **kwargs)
    return wrapper


async def get_current_user(
    token: Optional[str] = Depends(get_session_token)
):
    """
    Get the current authenticated user from session token.
    Raises HTTPException if not authenticated.
    """
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated"
        )
    
    try:
        session_user = await _get_session_user(token)
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Authentication service unavailable",
        )

    if session_user:
        return session_user

    keycloak_user = await _get_keycloak_local_user(token)
    if keycloak_user:
        return keycloak_user

    raise HTTPException(
        status_code=401,
        detail="Invalid or expired session",
    )


async def _get_session_user(token: str):
    prisma = await get_prisma()
    session = await prisma.session.find_first(
        where={
            "token": token,
            "expiresAt": {"gt": utc_now()}
        },
        include={"user": True}
    )
    if not session or not session.user:
        return None
    if not session.user.isActive:
        raise HTTPException(
            status_code=403,
            detail="User account is inactive"
        )
    return session.user


def _role_from_keycloak_roles(roles: list[str]) -> str:
    normalized = {str(role).upper().replace("-", "_") for role in roles}
    if "SUPER_ADMIN" in normalized:
        return "SUPER_ADMIN"
    if "ADMIN" in normalized:
        return "ADMIN"
    return "USER"


def _extract_keycloak_roles(token_info: dict) -> list[str]:
    roles = list(token_info.get("realm_access", {}).get("roles", []) or [])
    resource_access = token_info.get("resource_access", {}) or {}
    for client_access in resource_access.values():
        roles.extend(client_access.get("roles", []) or [])
    return sorted({str(role) for role in roles})


async def _get_keycloak_local_user(token: str):
    try:
        userinfo = keycloak_openid.userinfo(token)
        token_info = keycloak_openid.decode_token(
            token,
            keycloak_openid.public_key(),
        )
        roles = _extract_keycloak_roles(token_info)
    except Exception:
        return None

    email = str(userinfo.get("email") or "").strip().lower()
    if not email:
        return None

    name = (
        str(userinfo.get("name") or "").strip()
        or " ".join(
            part
            for part in [
                str(userinfo.get("given_name") or "").strip(),
                str(userinfo.get("family_name") or "").strip(),
            ]
            if part
        )
        or str(userinfo.get("preferred_username") or email).strip()
    )
    role = "ADMIN" if email in KEYCLOAK_ADMIN_EMAILS else _role_from_keycloak_roles(roles)
    prisma = await get_prisma()
    existing = await prisma.user.find_unique(where={"email": email})
    if existing:
        if not existing.isActive:
            raise HTTPException(status_code=403, detail="User account is inactive")
        try:
            return await prisma.user.update(
                where={"id": existing.id},
                data={"name": name, "role": role},
            )
        except Exception:
            return existing

    return await prisma.user.create(
        data={
            "name": name,
            "email": email,
            "passwordHash": f"keycloak:{userinfo.get('sub') or email}",
            "role": role,
            "isActive": True,
        }
    )


async def get_admin_user(user=Depends(get_current_user)):
    role = getattr(user, "role", None)
    normalized_role = getattr(role, "value", None) or str(role)

    if normalized_role not in {"ADMIN", "SUPER_ADMIN"}:
        raise HTTPException(
            status_code=403,
            detail="Admin access required",
        )

    return user

async def validate_token(token: str) -> bool:
    """
    Check if a given token is valid or not.
    Returns only boolean response.
    
    Usage:
        # In your code
        is_valid = await validate_token(user_token)
        if is_valid:
            print("Token is valid")
        else:
            print("Token is invalid")
    
    Args:
        token (str): The token string to validate
    
    Returns:
        bool: True if token is valid, False otherwise
    
    Checks:
        - Token exists in database
        - Token has not expired
        - User account is active
    """
    
    
    print(token, "TOKENNN")
    if not token or not isinstance(token, str) or token.strip() == "":
        return False
    
    try:
        prisma = await get_prisma()
        
        session = await prisma.session.find_first(
            where={
                "token": token.strip(),
                "expiresAt": {"gt": utc_now()}
            },
            include={"user": True}
        )
        
        print(session, "SESSION")
        if not session or not session.user:
            return False
        
        if not session.user.isActive:
            return False
        
        return True
         
    except Exception:
        return False
