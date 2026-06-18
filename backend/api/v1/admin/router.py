from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db import get_prisma
from helpers.config import settings
from helpers.dependencies import get_admin_user, get_current_user
from helpers.utils import hash_password
from objectstore import delete_document_object, get_download_url, list_buckets, list_prefix

router = APIRouter(prefix=settings.API_SLUG + "/admin", tags=["Admin"])


ROLE_DEFINITIONS = [
    {
        "id": "SUPER_ADMIN",
        "name": "Super Admin",
        "roleCategory": "admin",
        "modules": ["reports", "shipments", "documents", "inventory", "accounting", "admin", "settings"],
    },
    {
        "id": "ADMIN",
        "name": "Org Admin",
        "roleCategory": "admin",
        "modules": ["reports", "shipments", "documents", "inventory", "accounting", "admin", "settings"],
    },
    {
        "id": "USER",
        "name": "User",
        "roleCategory": "user",
        "modules": ["reports", "shipments", "documents", "inventory", "accounting", "settings"],
    },
]

ROLE_ALIASES = {
    "role-org-admin": "ADMIN",
    "role-admin": "ADMIN",
    "admin": "ADMIN",
    "org admin": "ADMIN",
    "super_admin": "SUPER_ADMIN",
    "super-admin": "SUPER_ADMIN",
    "super admin": "SUPER_ADMIN",
    "role-super-admin": "SUPER_ADMIN",
    "role-viewer": "USER",
    "role-user": "USER",
    "viewer": "USER",
    "user": "USER",
}


class StorageFileItem(BaseModel):
    key: str
    name: str
    sizeBytes: int
    lastModified: str | None
    downloadUrl: str
    previewUrl: str | None
    contentType: str | None


class StorageListingResponse(BaseModel):
    bucket: str
    prefix: str
    breadcrumbs: list[str]
    folders: list[str]
    files: list[StorageFileItem]


class BucketListResponse(BaseModel):
    buckets: list[str]


class DeleteFileRequest(BaseModel):
    bucket: str
    key: str


class DeleteDocumentResponse(BaseModel):
    status: str
    message: str
    documentId: str
    deletedObjectKeys: list[str]
    storageDeleteErrors: list[str] = []


class InviteUserRequest(BaseModel):
    email: str
    fullName: str
    roleId: str
    password: str | None = None


def _role_value(role) -> str:
    return getattr(role, "value", None) or str(role)


def _role_definition(role) -> dict:
    role_value = _role_from_request(_role_value(role))
    return next((item for item in ROLE_DEFINITIONS if item["id"] == role_value), ROLE_DEFINITIONS[-1])


def _role_from_request(role_id: str) -> str:
    normalized = role_id.strip()
    return ROLE_ALIASES.get(normalized.lower(), normalized if normalized in {"SUPER_ADMIN", "ADMIN", "USER"} else "USER")


def _display_role_name(role_name: str) -> str:
    return role_name.replace("_", " ").replace("-", " ").title()


def _role_category(role_name: str) -> str:
    normalized = _role_from_request(role_name)
    if normalized in {"ADMIN", "SUPER_ADMIN"}:
        return "admin"
    return "user"


def _local_role_from_keycloak_roles(roles: list[str], email: str = "") -> str:
    if email.lower() == "admin@sprconsultech.com":
        return "ADMIN"
    normalized = {role.upper().replace("-", "_") for role in roles}
    if "SUPER_ADMIN" in normalized:
        return "SUPER_ADMIN"
    if "ADMIN" in normalized:
        return "ADMIN"
    return "USER"


def _keycloak_user_name(user: dict) -> str:
    full_name = " ".join(
        str(user.get(part) or "").strip()
        for part in ("firstName", "lastName")
        if str(user.get(part) or "").strip()
    ).strip()
    return full_name or str(user.get("username") or user.get("email") or "")


def _keycloak_user_row(user: dict, roles: list[dict]) -> dict:
    role_names = [str(role.get("name")) for role in roles if role.get("name")]
    primary_role = next(
        (role for role in role_names if _role_from_request(role) in {"SUPER_ADMIN", "ADMIN"}),
        role_names[0] if role_names else "USER",
    )
    return {
        "id": str(user.get("id") or ""),
        "email": str(user.get("email") or user.get("username") or ""),
        "fullName": _keycloak_user_name(user),
        "status": "active" if user.get("enabled", False) else "inactive",
        "lastLoginAt": None,
        "keycloakRoles": role_names,
        "role": {
            "id": primary_role,
            "name": _display_role_name(primary_role),
            "roleCategory": _role_category(primary_role),
        },
    }


async def _sync_local_user_from_keycloak(*, prisma, keycloak_user: dict, roles: list[dict]):
    email = str(keycloak_user.get("email") or keycloak_user.get("username") or "").strip().lower()
    if not email:
        return None

    name = _keycloak_user_name(keycloak_user)
    role_names = [str(role.get("name")) for role in roles if role.get("name")]
    local_role = _local_role_from_keycloak_roles(role_names, email)
    existing = await prisma.user.find_unique(where={"email": email})
    if existing:
        user = await prisma.user.update(
            where={"id": existing.id},
            data={
                "name": name or email,
                "role": local_role,
                "isActive": bool(keycloak_user.get("enabled", True)),
            },
        )
    else:
        user = await prisma.user.create(
            data={
                "name": name or email,
                "email": email,
                "passwordHash": f"keycloak:{keycloak_user.get('id') or email}",
                "role": local_role,
                "isActive": bool(keycloak_user.get("enabled", True)),
            }
        )

    first_name = str(keycloak_user.get("firstName") or "").strip() or None
    last_name = str(keycloak_user.get("lastName") or "").strip() or None
    if first_name or last_name:
        await prisma.profile.upsert(
            where={"userId": user.id},
            data={
                "update": {
                    "firstName": first_name,
                    "lastName": last_name,
                },
                "create": {
                    "user": {"connect": {"id": user.id}},
                    "firstName": first_name,
                    "lastName": last_name,
                },
            },
        )
    return user


def _user_row(user) -> dict:
    profile = getattr(user, "profile", None)
    name = getattr(user, "name", "") or ""
    if profile:
        profile_name = " ".join(
            part
            for part in [
                getattr(profile, "firstName", None),
                getattr(profile, "lastName", None),
            ]
            if part
        ).strip()
        name = profile_name or name

    role_definition = _role_definition(getattr(user, "role", "USER"))
    return {
        "id": str(user.id),
        "email": str(user.email),
        "fullName": name or str(user.email),
        "status": "active" if getattr(user, "isActive", False) else "inactive",
        "lastLoginAt": None,
        "role": {
            "id": role_definition["id"],
            "name": role_definition["name"],
            "roleCategory": role_definition["roleCategory"],
        },
    }


def _guess_content_type(name: str) -> str | None:
    suffix = Path(name).suffix.lower()
    if suffix == ".pdf":
        return "application/pdf"
    if suffix in {".png"}:
        return "image/png"
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".txt":
        return "text/plain"
    return None


@router.get("/users")
async def list_admin_users(_user=Depends(get_admin_user)):
    prisma = await get_prisma()
    keycloak_admin = get_keycloak_admin()
    try:
        users = keycloak_admin.get_users({})
        rows = []
        for keycloak_user in users:
            roles = keycloak_admin.get_realm_roles_of_user(keycloak_user["id"])
            await _sync_local_user_from_keycloak(
                prisma=prisma,
                keycloak_user=keycloak_user,
                roles=roles,
            )
            rows.append(_keycloak_user_row(keycloak_user, roles))
        rows.sort(key=lambda item: item["email"].lower())
        return {"ok": True, "data": rows}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not sync users from Keycloak: {exc}")


@router.get("/roles")
async def list_admin_roles(_user=Depends(get_admin_user)):
    keycloak_admin = get_keycloak_admin()
    try:
        roles = keycloak_admin.get_realm_roles()
        filtered_roles = [
            role for role in roles
            if role.get("name") and not str(role["name"]).startswith("default-roles-")
        ]
        return {
            "ok": True,
            "data": [
                {
                    "id": str(role["name"]),
                    "name": _display_role_name(str(role["name"])),
                    "roleCategory": _role_category(str(role["name"])),
                }
                for role in sorted(filtered_roles, key=lambda item: str(item.get("name", "")).lower())
            ],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not sync roles from Keycloak: {exc}")


@router.post("/users/invite")
async def invite_admin_user(request: InviteUserRequest, admin_user=Depends(get_admin_user)):
    email = request.email.strip().lower()
    full_name = request.fullName.strip()
    if not email or not full_name:
        return {"ok": False, "error": "Email and full name are required."}

    prisma = await get_prisma()
    keycloak_admin = get_keycloak_admin()

    first_name, _, last_name = full_name.partition(" ")
    role_name = request.roleId.strip()
    if not role_name:
        return {"ok": False, "error": "Role is required."}

    try:
        role = keycloak_admin.get_realm_role(role_name)
    except Exception:
        local_role = _role_from_request(role_name)
        try:
            role = keycloak_admin.get_realm_role(local_role)
            role_name = local_role
        except Exception:
            return {"ok": False, "error": f"Role not found in Keycloak: {request.roleId}"}

    try:
        user_id = keycloak_admin.get_user_id(email)
        payload = {
            "username": email,
            "email": email,
            "firstName": first_name or full_name,
            "lastName": last_name or "",
            "enabled": True,
            "emailVerified": True,
        }
        if user_id:
            keycloak_admin.update_user(user_id, payload)
        else:
            user_id = keycloak_admin.create_user(
                {
                    **payload,
                    "credentials": [
                        {
                            "type": "password",
                            "value": request.password or "ChangeMe123!",
                            "temporary": False,
                        }
                    ],
                },
                exist_ok=True,
            )
        if request.password:
            keycloak_admin.set_user_password(user_id, request.password, temporary=False)

        existing_roles = keycloak_admin.get_realm_roles_of_user(user_id)
        existing_role_names = {str(existing_role.get("name")) for existing_role in existing_roles}
        if role_name not in existing_role_names:
            keycloak_admin.assign_realm_roles(user_id, [role])

        keycloak_user = {
            "id": user_id,
            **payload,
        }
        synced_user = await _sync_local_user_from_keycloak(
            prisma=prisma,
            keycloak_user=keycloak_user,
            roles=keycloak_admin.get_realm_roles_of_user(user_id),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not sync user with Keycloak: {exc}")

    local_role = getattr(synced_user, "role", "USER") if synced_user else "USER"
    if _role_from_request(_role_value(local_role)) in {"ADMIN", "SUPER_ADMIN"} and synced_user:
        try:
            buckets = list_buckets()
        except Exception:
            buckets = []

        for bucket in buckets:
            existing_policy = await prisma.s3userpolicy.find_first(
                where={"userId": synced_user.id, "bucket": bucket}
            )
            if existing_policy:
                await prisma.s3userpolicy.update(
                    where={"id": existing_policy.id},
                    data={"permission": "ADMIN", "grantedBy": admin_user.id},
                )
            else:
                await prisma.s3userpolicy.create(
                    data={
                        "userId": synced_user.id,
                        "bucket": bucket,
                        "permission": "ADMIN",
                        "grantedBy": admin_user.id,
                    }
                )

    return {
        "ok": True,
        "data": _keycloak_user_row(
            {"id": user_id, "email": email, "username": email, "firstName": first_name, "lastName": last_name, "enabled": True},
            keycloak_admin.get_realm_roles_of_user(user_id),
        ),
    }


async def _delete_document_with_related_and_storage(*, prisma, document_id: str) -> DeleteDocumentResponse:
    document = await prisma.document.find_unique(
        where={"id": document_id},
        include={"pages": True},
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    object_refs: list[tuple[str, str]] = []
    object_refs.append((str(document.bucket), str(document.objectKey)))
    for page in document.pages:
        object_refs.append((str(page.bucket), str(page.objectKey)))

    await prisma.document.delete(where={"id": document_id})

    storage_delete_errors: list[str] = []
    deleted_keys: list[str] = []
    for bucket, key in object_refs:
        try:
            delete_document_object(bucket, key)
            deleted_keys.append(key)
        except Exception as exc:
            storage_delete_errors.append(f"{bucket}/{key}: {exc}")

    return DeleteDocumentResponse(
        status="success",
        message="Document and related records deleted",
        documentId=document_id,
        deletedObjectKeys=deleted_keys,
        storageDeleteErrors=storage_delete_errors,
    )


@router.get("/storage/buckets", response_model=BucketListResponse)
async def get_storage_buckets(_user=Depends(get_admin_user)):
    try:
        return BucketListResponse(buckets=list_buckets())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list buckets: {exc}")


@router.get("/storage", response_model=StorageListingResponse)
async def get_storage_listing(
    bucket: str = Query(...),
    prefix: str = Query(""),
    _user=Depends(get_admin_user),
):
    try:
        folders, files = list_prefix(bucket=bucket, prefix=prefix)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list storage objects: {exc}")

    normalized_prefix = prefix.strip("/")
    breadcrumbs = [part for part in normalized_prefix.split("/") if part]

    return StorageListingResponse(
        bucket=bucket,
        prefix=normalized_prefix,
        breadcrumbs=breadcrumbs,
        folders=sorted(folders),
        files=[
            StorageFileItem(
                key=str(item["key"]),
                name=str(item["name"]),
                sizeBytes=int(item["sizeBytes"]),
                lastModified=(
                    item["lastModified"].isoformat()
                    if isinstance(item.get("lastModified"), datetime)
                    else None
                ),
                downloadUrl=get_download_url(bucket, str(item["key"])),
                previewUrl=get_download_url(bucket, str(item["key"])),
                contentType=_guess_content_type(str(item["name"])),
            )
            for item in files
        ],
    )


@router.delete("/storage/file")
async def delete_storage_file(request: DeleteFileRequest, _user=Depends(get_admin_user)):
    prisma = await get_prisma()

    page = await prisma.documentpage.find_first(
        where={"bucket": request.bucket, "objectKey": request.key},
    )
    if page:
        return await _delete_document_with_related_and_storage(
            prisma=prisma,
            document_id=str(page.documentId),
        )

    document = await prisma.document.find_first(
        where={"bucket": request.bucket, "objectKey": request.key},
    )
    if document:
        return await _delete_document_with_related_and_storage(
            prisma=prisma,
            document_id=str(document.id),
        )

    try:
        delete_document_object(request.bucket, request.key)
        return {"status": "success", "message": "Storage object deleted (no DB document mapping found)"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete storage object: {exc}")


@router.delete("/documents/{document_id}", response_model=DeleteDocumentResponse)
async def delete_document(document_id: str, _user=Depends(get_admin_user)):
    prisma = await get_prisma()
    return await _delete_document_with_related_and_storage(
        prisma=prisma,
        document_id=document_id,
    )

# =================================================================
# Keycloak Multi-Tenant Admin Integration
# =================================================================

from keycloak import KeycloakAdmin
from helpers.config import settings

def get_keycloak_admin():
    """Get Keycloak admin client with proper configuration"""
    return KeycloakAdmin(
        server_url=settings.KEYCLOAK_URL,
        username=settings.KEYCLOAK_ADMIN_USERNAME,
        password=settings.KEYCLOAK_ADMIN_PASSWORD,
        realm_name=settings.KEYCLOAK_REALM,
        verify=True
    )

# Keycloak Models
class KeycloakUserCreate(BaseModel):
    username: str
    email: str
    firstName: str
    lastName: str
    password: str
    roles: list[str] = []

class KeycloakUserUpdate(BaseModel):
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    email: Optional[str] = None
    enabled: Optional[bool] = None

class KeycloakUserResponse(BaseModel):
    id: str
    username: str
    email: str
    firstName: str
    lastName: str
    enabled: bool
    createdTimestamp: int
    roles: list[str]

class KeycloakRoleCreate(BaseModel):
    name: str
    description: Optional[str] = None

class KeycloakRoleResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    composite: bool
    clientRole: bool
    containerId: str

class TenantRealmCreate(BaseModel):
    tenant_id: str
    realm_name: str
    display_name: str
    admin_email: str
    admin_password: str

class TenantSwitchRequest(BaseModel):
    current_tenant_id: str
    new_tenant_id: str

# =================================================================
# Multi-Tenant Realm Management
# =================================================================

@router.post("/tenants/realms")
async def create_tenant_realm(
    tenant_data: TenantRealmCreate,
    _user=Depends(get_admin_user)
):
    """Create a new realm for a tenant"""
    keycloak_admin = get_keycloak_admin()

    # Create the realm
    realm_payload = {
        "realm": tenant_data.realm_name,
        "enabled": True,
        "displayName": tenant_data.display_name,
        "registrationAllowed": False,
        "editUsernameAllowed": True
    }

    try:
        keycloak_admin.create_realm(realm_payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create realm: {str(e)}")

    # Create admin client for the realm
    client_payload = {
        "clientId": "admin-client",
        "protocol": "openid-connect",
        "publicClient": False,
        "standardFlowEnabled": True,
        "directAccessGrantsEnabled": True,
        "serviceAccountsEnabled": True
    }

    keycloak_admin.create_client(
        realm_name=tenant_data.realm_name,
        payload=client_payload
    )

    # Create initial admin user
    admin_user = keycloak_admin.create_user(
        realm_name=tenant_data.realm_name,
        payload={
            "username": "admin",
            "email": tenant_data.admin_email,
            "firstName": "Tenant",
            "lastName": "Admin",
            "enabled": True,
            "credentials": [{
                "type": "password",
                "value": tenant_data.admin_password,
                "temporary": False
            }]
        }
    )

    # Create initial roles
    initial_roles = ["admin", "manager", "user", "viewer"]
    for role_name in initial_roles:
        keycloak_admin.create_realm_role(
            realm_name=tenant_data.realm_name,
            payload={"name": role_name}
        )

    # Assign admin role to admin user
    admin_roles = keycloak_admin.get_realm_roles(realm_name=tenant_data.realm_name)
    admin_role = next(r for r in admin_roles if r["name"] == "admin")
    keycloak_admin.assign_realm_roles(
        user_id=admin_user,
        roles=[admin_role],
        realm_name=tenant_data.realm_name
    )

    return {
        "status": "success",
        "realm": tenant_data.realm_name,
        "admin_email": tenant_data.admin_email,
        "message": "Tenant realm created successfully"
    }

@router.post("/switch-tenant")
async def switch_tenant(
    request: TenantSwitchRequest,
    current_user=Depends(get_current_user)
):
    """Handle tenant switching for admin users"""
    # Verify current user has permission to switch tenants
    if current_user.role != "global-admin":
        raise HTTPException(status_code=403, detail="Only global admins can switch tenants")

    # Verify both tenants exist
    keycloak_admin = get_keycloak_admin()
    current_realm = f"tenant-{request.current_tenant_id}"
    new_realm = f"tenant-{request.new_tenant_id}"

    try:
        keycloak_admin.get_realm(current_realm)
        keycloak_admin.get_realm(new_realm)
    except Exception:
        raise HTTPException(status_code=404, detail="One or both tenant realms not found")

    # For now, just return success
    # In production, you would generate a tenant-switch token
    return {
        "status": "success",
        "new_tenant_id": request.new_tenant_id,
        "message": "Tenant switch initiated"
    }

# =================================================================
# Tenant-Specific User Management
# =================================================================

@router.get("/tenants/{tenant_id}/users")
async def list_tenant_users(
    tenant_id: str,
    _user=Depends(get_admin_user)
):
    """List users in a specific tenant realm"""
    realm_name = f"tenant-{tenant_id}"
    keycloak_admin = get_keycloak_admin()

    try:
        users = keycloak_admin.get_users(realm_name=realm_name)

        # Enrich with role information
        enriched_users = []
        for user in users:
            user_roles = keycloak_admin.get_user_realm_roles(
                user_id=user['id'],
                realm_name=realm_name
            )
            enriched_users.append({
                **user,
                "roles": user_roles,
                "tenant_id": tenant_id
            })

        return enriched_users
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Tenant realm not found: {str(e)}")

@router.post("/tenants/{tenant_id}/users")
async def create_tenant_user(
    tenant_id: str,
    user_data: KeycloakUserCreate,
    _user=Depends(get_admin_user)
):
    """Create a new user in tenant realm"""
    realm_name = f"tenant-{tenant_id}"
    keycloak_admin = get_keycloak_admin()

    # Create user
    user_id = keycloak_admin.create_user(
        realm_name=realm_name,
        payload={
            "username": user_data.username,
            "email": user_data.email,
            "firstName": user_data.firstName,
            "lastName": user_data.lastName,
            "enabled": True,
            "credentials": [{
                "type": "password",
                "value": user_data.password,
                "temporary": False
            }]
        }
    )

    # Assign roles
    if user_data.roles:
        realm_roles = keycloak_admin.get_realm_roles(realm_name=realm_name)
        roles_to_assign = [role for role in realm_roles if role['name'] in user_data.roles]
        if roles_to_assign:
            keycloak_admin.assign_realm_roles(
                user_id=user_id,
                roles=roles_to_assign,
                realm_name=realm_name
            )

    # Get created user with roles
    created_user = keycloak_admin.get_user(user_id, realm_name=realm_name)
    user_roles = keycloak_admin.get_user_realm_roles(user_id, realm_name=realm_name)

    return {
        **created_user,
        "roles": user_roles,
        "tenant_id": tenant_id
    }

# =================================================================
# Tenant-Specific Role Management
# =================================================================

@router.get("/tenants/{tenant_id}/roles")
async def list_tenant_roles(
    tenant_id: str,
    _user=Depends(get_admin_user)
):
    """List all roles in tenant realm"""
    realm_name = f"tenant-{tenant_id}"
    keycloak_admin = get_keycloak_admin()

    try:
        roles = keycloak_admin.get_realm_roles(realm_name=realm_name)
        return roles
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Tenant realm not found: {str(e)}")

@router.post("/tenants/{tenant_id}/roles")
async def create_tenant_role(
    tenant_id: str,
    role_data: KeycloakRoleCreate,
    _user=Depends(get_admin_user)
):
    """Create a custom role in tenant realm"""
    realm_name = f"tenant-{tenant_id}"
    keycloak_admin = get_keycloak_admin()

    try:
        role = keycloak_admin.create_realm_role(
            realm_name=realm_name,
            payload={
                "name": role_data.name,
                "description": role_data.description
            }
        )
        return role
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create role: {str(e)}")

@router.post("/tenants/{tenant_id}/users/{user_id}/roles")
async def assign_roles_to_user(
    tenant_id: str,
    user_id: str,
    role_names: list[str],
    _user=Depends(get_admin_user)
):
    """Assign roles to a user in tenant realm"""
    realm_name = f"tenant-{tenant_id}"
    keycloak_admin = get_keycloak_admin()

    # Get available roles
    realm_roles = keycloak_admin.get_realm_roles(realm_name=realm_name)
    roles_to_assign = [role for role in realm_roles if role['name'] in role_names]

    if not roles_to_assign:
        raise HTTPException(status_code=404, detail="No valid roles found")

    keycloak_admin.assign_realm_roles(
        user_id=user_id,
        roles=roles_to_assign,
        realm_name=realm_name
    )

    return {
        "status": "success",
        "message": f"Assigned {len(roles_to_assign)} roles to user {user_id}",
        "assigned_roles": [role['name'] for role in roles_to_assign]
    }

@router.delete("/tenants/{tenant_id}/users/{user_id}/roles/{role_name}")
async def remove_role_from_user(
    tenant_id: str,
    user_id: str,
    role_name: str,
    _user=Depends(get_admin_user)
):
    """Remove a role from a user in tenant realm"""
    realm_name = f"tenant-{tenant_id}"
    keycloak_admin = get_keycloak_admin()

    # Get the role
    realm_roles = keycloak_admin.get_realm_roles(realm_name=realm_name)
    role = next((r for r in realm_roles if r['name'] == role_name), None)

    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    keycloak_admin.remove_realm_roles(
        user_id=user_id,
        roles=[role],
        realm_name=realm_name
    )

    return {
        "status": "success",
        "message": f"Removed role {role_name} from user {user_id}"
    }
