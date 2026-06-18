"""
Seed Keycloak realm/client/roles and the default EWMS admin user.

Run from repo root or backend directory:
    python backend/helpers/keycloak_seed.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

CURRENT_FILE = Path(__file__).resolve()
BACKEND_DIR = CURRENT_FILE.parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from keycloak import KeycloakAdmin

from helpers.config import settings


DEFAULT_ADMIN_EMAIL = "admin@sprconsultech.com"
DEFAULT_ADMIN_PASSWORD = "admin123"
DEFAULT_ADMIN_FIRST_NAME = "EWMS"
DEFAULT_ADMIN_LAST_NAME = "Admin"
DEFAULT_ROLES = ("admin", "user", "ADMIN", "USER", "SUPER_ADMIN")


def _admin_client(*, realm_name: str = "master") -> KeycloakAdmin:
    return KeycloakAdmin(
        server_url=settings.KEYCLOAK_URL,
        username=settings.KEYCLOAK_ADMIN_USERNAME,
        password=settings.KEYCLOAK_ADMIN_PASSWORD,
        realm_name=realm_name,
        user_realm_name="master",
        client_id="admin-cli",
        verify=True,
    )


def _ensure_realm(admin: KeycloakAdmin) -> None:
    try:
        admin.get_realm(settings.KEYCLOAK_REALM)
        print(f"Keycloak realm exists: {settings.KEYCLOAK_REALM}")
    except Exception:
        admin.create_realm(
            {
                "realm": settings.KEYCLOAK_REALM,
                "enabled": True,
                "registrationAllowed": False,
                "loginWithEmailAllowed": True,
                "duplicateEmailsAllowed": False,
                "resetPasswordAllowed": True,
            },
            skip_exists=True,
        )
        print(f"Created Keycloak realm: {settings.KEYCLOAK_REALM}")


def _ensure_client(admin: KeycloakAdmin) -> None:
    client_uuid = admin.get_client_id(settings.KEYCLOAK_CLIENT_ID)
    payload = {
        "clientId": settings.KEYCLOAK_CLIENT_ID,
        "name": "EWMS Backend",
        "enabled": True,
        "publicClient": not bool(settings.KEYCLOAK_CLIENT_SECRET),
        "directAccessGrantsEnabled": True,
        "standardFlowEnabled": True,
        "serviceAccountsEnabled": bool(settings.KEYCLOAK_CLIENT_SECRET),
        "protocol": "openid-connect",
        "redirectUris": ["http://localhost:5173/*", "http://127.0.0.1:5173/*", "http://192.168.10.100:5173/*"],
        "webOrigins": ["http://localhost:5173", "http://127.0.0.1:5173", "http://192.168.10.100:5173"],
    }
    if client_uuid:
        admin.update_client(client_uuid, payload)
        print(f"Updated Keycloak client: {settings.KEYCLOAK_CLIENT_ID}")
    else:
        admin.create_client(payload, skip_exists=True)
        print(f"Created Keycloak client: {settings.KEYCLOAK_CLIENT_ID}")


def _ensure_roles(admin: KeycloakAdmin) -> None:
    for role in DEFAULT_ROLES:
        try:
            admin.get_realm_role(role)
            print(f"Keycloak role exists: {role}")
        except Exception:
            admin.create_realm_role({"name": role}, skip_exists=True)
            print(f"Created Keycloak role: {role}")


def _ensure_admin_user(admin: KeycloakAdmin) -> None:
    email = DEFAULT_ADMIN_EMAIL.lower()
    user_id = admin.get_user_id(email)
    payload = {
        "username": email,
        "email": email,
        "firstName": DEFAULT_ADMIN_FIRST_NAME,
        "lastName": DEFAULT_ADMIN_LAST_NAME,
        "enabled": True,
        "emailVerified": True,
        "credentials": [
            {
                "type": "password",
                "value": DEFAULT_ADMIN_PASSWORD,
                "temporary": False,
            }
        ],
    }
    if user_id:
        admin.update_user(user_id, payload)
        admin.set_user_password(user_id, DEFAULT_ADMIN_PASSWORD, temporary=False)
        print(f"Updated Keycloak user and password: {email}")
    else:
        user_id = admin.create_user(payload, exist_ok=True)
        print(f"Created Keycloak user: {email}")

    roles = [admin.get_realm_role(role) for role in ("admin", "user", "ADMIN", "USER", "SUPER_ADMIN")]
    existing_role_names = {role.get("name") for role in admin.get_realm_roles_of_user(user_id)}
    roles_to_assign = [role for role in roles if role.get("name") not in existing_role_names]
    if roles_to_assign:
        admin.assign_realm_roles(user_id, roles_to_assign)
        print(f"Assigned Keycloak roles to {email}: {', '.join(role['name'] for role in roles_to_assign)}")
    else:
        print(f"Keycloak roles already assigned for: {email}")


async def main() -> None:
    master_admin = _admin_client(realm_name="master")
    _ensure_realm(master_admin)

    realm_admin = _admin_client(realm_name=settings.KEYCLOAK_REALM)
    _ensure_client(realm_admin)
    _ensure_roles(realm_admin)
    _ensure_admin_user(realm_admin)
    print("Keycloak seed complete.")


if __name__ == "__main__":
    asyncio.run(main())
