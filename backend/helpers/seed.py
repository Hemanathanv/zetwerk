"""
Seed script to create or update the default admin user and related records.
Run with: python -m helpers.seed
"""
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import close_prisma, get_prisma
from helpers.utils import hash_password


def _env(*names: str, default: str | None = None) -> str | None:
    """Return the first non-empty environment variable value."""
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return default


def _split_name(name: str) -> tuple[str, str | None]:
    parts = name.strip().split(maxsplit=1)
    first_name = parts[0] if parts else "Admin"
    last_name = parts[1] if len(parts) > 1 else None
    return first_name, last_name


def _load_s3_config() -> dict:
    """Load the SeaweedFS S3 static config if it exists."""
    repo_dir = Path(__file__).resolve().parents[2]
    s3_config_path = repo_dir / "object_store" / "config" / "s3.json"
    if not s3_config_path.exists():
        return {}

    try:
        return json.loads(s3_config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _get_admin_s3_identity(s3_config: dict) -> tuple[str, str | None]:
    """Prefer the static S3 admin identity over app env vars."""
    identities = s3_config.get("identities", [])
    for identity in identities:
        actions = set(identity.get("actions", []))
        credentials = identity.get("credentials", [])
        if "Admin" in actions and credentials:
            access_key = credentials[0].get("accessKey")
            secret_key = credentials[0].get("secretKey")
            if access_key:
                return access_key, secret_key
    return "ewms_admin", None


def _discover_admin_buckets(s3_config: dict) -> list[str]:
    """Collect every known bucket so admin gets a policy row for each one."""
    buckets: set[str] = {"ewms-invoices"}
    identities = s3_config.get("identities", [])

    for identity in identities:
        for action in identity.get("actions", []):
            if ":" not in action:
                continue
            _, bucket = action.split(":", 1)
            bucket = bucket.strip()
            if bucket:
                buckets.add(bucket)

    configured_buckets = _env("ADMIN_S3_BUCKETS")
    if configured_buckets:
        for bucket in configured_buckets.split(","):
            bucket = bucket.strip()
            if bucket:
                buckets.add(bucket)

    return sorted(buckets)


async def seed_admin_user():
    """Create or update the default admin user with profile and S3 records."""
    prisma = await get_prisma()

    admin_name = _env("ADMIN_NAME", default="Admin")
    admin_email = _env("ADMIN_EMAIL", default="admin@sprconsultech.com")
    admin_password = _env("ADMIN_PASSWORD", default="admin123")
    profile_phone = _env("ADMIN_PHONE")
    profile_department = _env("ADMIN_DEPARTMENT", default="Administration")
    profile_designation = _env("ADMIN_DESIGNATION", default="System Administrator")
    profile_timezone = _env("ADMIN_TIMEZONE", default="Asia/Kolkata")
    s3_config = _load_s3_config()
    s3_access_key, s3_secret_key = _get_admin_s3_identity(s3_config)
    admin_buckets = _discover_admin_buckets(s3_config)

    first_name, last_name = _split_name(admin_name)

    existing_user = await prisma.user.find_unique(where={"email": admin_email})
    created_user = False

    if existing_user:
        admin_user = await prisma.user.update(
            where={"id": existing_user.id},
            data={
                "name": admin_name,
                "role": "ADMIN",
                "isActive": True,
            },
        )
        print(f"✅ Admin user already exists, refreshed role/status: {admin_email}")
    else:
        admin_user = await prisma.user.create(
            data={
                "name": admin_name,
                "email": admin_email,
                "passwordHash": hash_password(admin_password),
                "role": "ADMIN",
                "isActive": True,
            }
        )
        created_user = True
        print(f"✅ Created admin user: {admin_email}")
        print(f"   Password: {admin_password}")

    existing_profile = await prisma.profile.find_first(
        where={"userId": admin_user.id}
    )
    profile_data = {
        "firstName": first_name,
        "lastName": last_name,
        "phone": profile_phone,
        "department": profile_department,
        "designation": profile_designation,
        "timezone": profile_timezone,
    }

    if existing_profile:
        await prisma.profile.update(
            where={"id": existing_profile.id},
            data=profile_data,
        )
        print(f"✅ Updated admin profile for: {admin_email}")
    else:
        await prisma.profile.create(
            data={
                "userId": admin_user.id,
                **profile_data,
            }
        )
        print(f"✅ Created admin profile for: {admin_email}")

    existing_credential = await prisma.s3usercredential.find_unique(
        where={"accessKeyId": s3_access_key}
    )
    key_hint = s3_secret_key[-4:] if s3_secret_key else None

    if existing_credential:
        await prisma.s3usercredential.update(
            where={"id": existing_credential.id},
            data={
                "userId": admin_user.id,
                "keyHint": key_hint,
                "isActive": True,
            },
        )
        print(f"✅ Updated admin S3 credential metadata: {s3_access_key}")
    else:
        await prisma.s3usercredential.create(
            data={
                "userId": admin_user.id,
                "accessKeyId": s3_access_key,
                "keyHint": key_hint,
                "isActive": True,
            }
        )
        print(f"✅ Created admin S3 credential metadata: {s3_access_key}")

    for bucket in admin_buckets:
        existing_policy = await prisma.s3userpolicy.find_first(
            where={
                "userId": admin_user.id,
                "bucket": bucket,
            }
        )

        if existing_policy:
            await prisma.s3userpolicy.update(
                where={"id": existing_policy.id},
                data={
                    "permission": "ADMIN",
                    "grantedBy": admin_user.id,
                },
            )
            print(f"✅ Updated admin S3 policy for bucket: {bucket}")
        else:
            await prisma.s3userpolicy.create(
                data={
                    "userId": admin_user.id,
                    "bucket": bucket,
                    "permission": "ADMIN",
                    "grantedBy": admin_user.id,
                }
            )
            print(f"✅ Created admin S3 policy for bucket: {bucket}")

    if not s3_secret_key:
        print("⚠️  S3 admin secret was not found in object_store/config/s3.json; key hint was not stored.")

    return admin_user, created_user


async def main():
    try:
        await seed_admin_user()
    finally:
        await close_prisma()


if __name__ == "__main__":
    asyncio.run(main())
