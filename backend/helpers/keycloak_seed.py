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
ALL_ACTIVITY_CODES = [
    "shipments.create", "shipments.view", "shipments.edit_metadata", "shipments.assign_user",
    "shipments.archive", "shipments.delete", "shipments.override_blocked_stage", "shipments.tag_partner",
    "documents.upload", "documents.view_extracted", "documents.edit_extracted",
    "documents.generate_draft", "documents.approve_draft", "documents.override_validation",
    "documents.reprocess_ocr", "documents.download_export", "documents.delete",
    "inventory.view_timeline", "inventory.update_milestone", "inventory.upload_pod",
    "inventory.acknowledge_dnd", "inventory.view_container",
    "accounting.view_queue", "accounting.review_ticket", "accounting.edit_entry",
    "accounting.post_to_erp", "accounting.reject_ticket", "accounting.view_ap_aging",
    "accounting.export_data",
    "reports.view_dashboard", "reports.generate_dsr", "reports.export_report", "reports.schedule_auto",
    "tasks.view",
    "admin.manage", "users.manage", "roles.view", "roles.manage", "documents.manage", "shipments.manage",
    "admin.manage_users", "admin.configure_roles", "admin.edit_workflows", "admin.configure_doctypes",
    "admin.edit_account_mappings", "admin.manage_partners", "admin.view_audit_log", "admin.security_settings",
]
DEFAULT_ROLE_PAYLOADS = {
    "admin": {"name": "admin"},
    "user": {"name": "user"},
    "SUPER_ADMIN": {
        "name": "SUPER_ADMIN",
        "description": "Full platform administration.",
        "attributes": {
            "ewms.displayName": ["Super Admin"],
            "ewms.category": ["platform"],
            "ewms.color": ["#0f766e"],
            "ewms.levels": ["L1", "L2", "L3", "L4"],
            "ewms.dataScope": ["ALL"],
            "ewms.modules": ["dashboard", "shipments", "documents", "tasks", "accounting", "inventory", "reports", "admin"],
            "ewms.activities": ALL_ACTIVITY_CODES,
            "ewms.managedBy": ["ewms-admin"],
        },
    },
    "ADMIN": {
        "name": "ADMIN",
        "description": "Organisation administration and operations control.",
        "attributes": {
            "ewms.displayName": ["Org Admin"],
            "ewms.category": ["org_admin"],
            "ewms.color": ["#2563eb"],
            "ewms.levels": ["L2", "L3", "L4"],
            "ewms.dataScope": ["ALL"],
            "ewms.modules": ["dashboard", "shipments", "documents", "tasks", "accounting", "inventory", "reports", "admin"],
            "ewms.activities": ["users.manage", "roles.view", "documents.manage", "shipments.manage"],
            "ewms.managedBy": ["ewms-admin"],
        },
    },
    "USER": {
        "name": "USER",
        "description": "Standard operational user.",
        "attributes": {
            "ewms.displayName": ["User"],
            "ewms.category": ["org_internal"],
            "ewms.color": ["#64748b"],
            "ewms.levels": ["L1", "L2"],
            "ewms.dataScope": ["TEAM"],
            "ewms.modules": ["dashboard", "shipments", "documents", "tasks", "inventory", "reports"],
            "ewms.activities": ["documents.view", "shipments.view", "tasks.view"],
            "ewms.managedBy": ["ewms-admin"],
        },
    },
    "OPS_MANAGER": {
        "name": "OPS_MANAGER",
        "description": "Operations manager for cross-region logistics.",
        "attributes": {
            "ewms.displayName": ["Ops Manager"],
            "ewms.category": ["org_internal"],
            "ewms.color": ["#0ea5a0"],
            "ewms.levels": ["L3", "L4"],
            "ewms.dataScope": ["ALL"],
            "ewms.modules": ["dashboard", "shipments", "documents", "tasks", "inventory", "reports"],
            "ewms.activities": [
                "shipments.create", "shipments.view", "shipments.edit_metadata", "shipments.assign_user",
                "shipments.archive", "shipments.override_blocked_stage", "shipments.tag_partner",
                "documents.upload", "documents.view_extracted", "documents.edit_extracted",
                "documents.generate_draft", "documents.approve_draft", "documents.override_validation",
                "documents.reprocess_ocr", "documents.download_export",
                "inventory.view_timeline", "inventory.update_milestone", "inventory.upload_pod",
                "inventory.acknowledge_dnd", "inventory.view_container",
                "accounting.view_queue",
                "reports.view_dashboard", "reports.generate_dsr", "reports.export_report", "reports.schedule_auto",
            ],
            "ewms.managedBy": ["ewms-admin"],
        },
    },
    "INDIA_LOGISTICS": {
        "name": "INDIA_LOGISTICS",
        "description": "India logistics operations.",
        "attributes": {
            "ewms.displayName": ["India Logistics"],
            "ewms.category": ["org_internal"],
            "ewms.color": ["#0ea5a0"],
            "ewms.levels": ["L2"],
            "ewms.dataScope": ["ASSIGNED"],
            "ewms.modules": ["dashboard", "shipments", "documents", "tasks", "inventory", "reports"],
            "ewms.activities": [
                "shipments.view", "shipments.create", "shipments.edit_metadata",
                "documents.upload", "documents.view_extracted", "documents.edit_extracted",
                "documents.approve_draft", "documents.generate_draft", "documents.download_export",
                "inventory.view_timeline", "inventory.update_milestone",
                "reports.view_dashboard",
            ],
            "ewms.managedBy": ["ewms-admin"],
        },
    },
    "US_LOGISTICS": {
        "name": "US_LOGISTICS",
        "description": "US logistics operations.",
        "attributes": {
            "ewms.displayName": ["US Logistics"],
            "ewms.category": ["org_internal"],
            "ewms.color": ["#0ea5a0"],
            "ewms.levels": ["L2"],
            "ewms.dataScope": ["ASSIGNED"],
            "ewms.modules": ["dashboard", "shipments", "documents", "tasks", "inventory", "reports"],
            "ewms.activities": [
                "shipments.view", "shipments.edit_metadata", "shipments.tag_partner",
                "documents.upload", "documents.view_extracted", "documents.download_export",
                "inventory.view_timeline", "inventory.update_milestone", "inventory.upload_pod",
                "inventory.acknowledge_dnd", "inventory.view_container",
                "reports.view_dashboard",
            ],
            "ewms.managedBy": ["ewms-admin"],
        },
    },
    "FINANCE_AP_INDIA": {
        "name": "FINANCE_AP_INDIA",
        "description": "India accounts payable finance.",
        "attributes": {
            "ewms.displayName": ["Finance AP India"],
            "ewms.category": ["org_internal"],
            "ewms.color": ["#0ea5a0"],
            "ewms.levels": ["L2"],
            "ewms.dataScope": ["ALL"],
            "ewms.modules": ["dashboard", "documents", "accounting"],
            "ewms.activities": [
                "shipments.view",
                "documents.view_extracted", "documents.download_export",
                "accounting.view_queue", "accounting.review_ticket", "accounting.edit_entry",
                "accounting.post_to_erp", "accounting.reject_ticket", "accounting.view_ap_aging",
                "accounting.export_data",
                "reports.view_dashboard", "reports.generate_dsr",
            ],
            "ewms.managedBy": ["ewms-admin"],
        },
    },
    "THREE_PL_PARTNER": {
        "name": "THREE_PL_PARTNER",
        "description": "Third-party logistics partner access.",
        "attributes": {
            "ewms.displayName": ["3PL Partner"],
            "ewms.category": ["org_external"],
            "ewms.color": ["#0ea5a0"],
            "ewms.levels": ["L1"],
            "ewms.dataScope": ["TAGGED"],
            "ewms.modules": ["partner", "inventory"],
            "ewms.activities": [
                "shipments.view",
                "documents.upload", "documents.view_extracted",
                "inventory.view_timeline", "inventory.view_container", "inventory.update_milestone",
            ],
            "ewms.managedBy": ["ewms-admin"],
        },
    },
}

DEFAULT_USERS = [
    {
        "email": "admin@sprconsultech.com",
        "password": "admin123",
        "full_name": "SPR Admin",
        "roles": ["SUPER_ADMIN", "ADMIN", "USER", "admin", "user"],
        "level": "L4",
        "data_scope": "ALL",
        "user_type": "internal",
    },
    {
        "email": "ops@zetwerk.com",
        "password": "ops123",
        "full_name": "Manish Agarwal",
        "roles": ["OPS_MANAGER", "USER", "user"],
        "level": "L4",
        "data_scope": "TAGGED",
        "user_type": "internal",
    },
    {
        "email": "us@zetwerk.com",
        "password": "us123",
        "full_name": "Mike US Logistics",
        "roles": ["US_LOGISTICS", "USER", "user"],
        "level": "L2",
        "data_scope": "TAGGED",
        "user_type": "internal",
    },
    {
        "email": "3pl@pacific-dist.com",
        "password": "3pl123",
        "full_name": "Pacific Distribution - 3PL",
        "roles": ["THREE_PL_PARTNER", "USER", "user"],
        "level": "L1",
        "data_scope": "TAGGED",
        "user_type": "external",
    },
    {
        "email": "india@zetwerk.com",
        "password": "india123",
        "full_name": "Priya Logistics",
        "roles": ["INDIA_LOGISTICS", "USER", "user"],
        "level": "L2",
        "data_scope": "TAGGED",
        "user_type": "internal",
    },
    {
        "email": "finance@zetwerk.com",
        "password": "finance123",
        "full_name": "Ravi Finance",
        "roles": ["FINANCE_AP_INDIA", "USER", "user"],
        "level": "L2",
        "data_scope": "TAGGED",
        "user_type": "internal",
    },
]


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
    for role, payload in DEFAULT_ROLE_PAYLOADS.items():
        try:
            admin.get_realm_role(role)
            admin.update_realm_role(role, payload)
            print(f"Keycloak role exists: {role}")
        except Exception:
            admin.create_realm_role(payload, skip_exists=True)
            print(f"Created Keycloak role: {role}")


def _split_full_name(full_name: str) -> tuple[str, str]:
    first_name, _, last_name = full_name.strip().partition(" ")
    return first_name or full_name.strip(), last_name


def _ensure_user(admin: KeycloakAdmin, user: dict) -> None:
    email = str(user["email"]).lower()
    first_name, last_name = _split_full_name(str(user["full_name"]))
    attributes = {
        "ewms.level": [str(user["level"])],
        "ewms.dataScope": [str(user["data_scope"])],
        "ewms.orgId": ["default-org"],
        "ewms.userType": [str(user["user_type"])],
    }
    payload = {
        "username": email,
        "email": email,
        "firstName": first_name,
        "lastName": last_name,
        "enabled": True,
        "emailVerified": True,
        "attributes": attributes,
        "credentials": [
            {
                "type": "password",
                "value": user["password"],
                "temporary": False,
            }
        ],
    }
    user_id = admin.get_user_id(email)
    if not user_id:
        matches = admin.get_users({"email": email, "exact": True})
        user_id = matches[0].get("id") if matches else None
    if user_id:
        update_payload = {key: value for key, value in payload.items() if key not in {"username", "credentials"}}
        admin.update_user(user_id, update_payload)
        admin.set_user_password(user_id, user["password"], temporary=False)
        print(f"Updated Keycloak user and password: {email}")
    else:
        user_id = admin.create_user(payload, exist_ok=True)
        print(f"Created Keycloak user: {email}")

    roles = [admin.get_realm_role(role) for role in user["roles"]]
    existing_role_names = {role.get("name") for role in admin.get_realm_roles_of_user(user_id)}
    roles_to_assign = [role for role in roles if role.get("name") not in existing_role_names]
    if roles_to_assign:
        admin.assign_realm_roles(user_id, roles_to_assign)
        print(f"Assigned Keycloak roles to {email}: {', '.join(role['name'] for role in roles_to_assign)}")
    else:
        print(f"Keycloak roles already assigned for: {email}")


def _ensure_users(admin: KeycloakAdmin) -> None:
    for user in DEFAULT_USERS:
        _ensure_user(admin, user)


async def main() -> None:
    master_admin = _admin_client(realm_name="master")
    _ensure_realm(master_admin)

    realm_admin = _admin_client(realm_name=settings.KEYCLOAK_REALM)
    _ensure_client(realm_admin)
    _ensure_roles(realm_admin)
    _ensure_users(realm_admin)
    print("Keycloak seed complete.")


if __name__ == "__main__":
    asyncio.run(main())
