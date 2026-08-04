from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import get_prisma
from helpers.config import settings
from helpers.dependencies import get_current_user

router = APIRouter(prefix=settings.API_SLUG + "/settings", tags=["Settings"])


class ProfileResponse(BaseModel):
    id: str
    userId: str
    email: str
    systemRole: str
    firstName: str | None
    lastName: str | None
    phone: str | None
    department: str | None
    designation: str | None
    avatarUrl: str | None
    bio: str | None
    location: str | None
    timezone: str | None


class UpdateProfileRequest(BaseModel):
    firstName: str | None = None
    lastName: str | None = None
    phone: str | None = None
    department: str | None = None
    designation: str | None = None
    avatarUrl: str | None = None
    bio: str | None = None
    location: str | None = None
    timezone: str | None = None


def _to_profile_response(*, user, profile) -> ProfileResponse:
    return ProfileResponse(
        id=profile.id,
        userId=user.id,
        email=user.email,
        systemRole=str(user.role),
        firstName=profile.firstName,
        lastName=profile.lastName,
        phone=profile.phone,
        department=profile.department,
        designation=profile.designation,
        avatarUrl=profile.avatarUrl,
        bio=profile.bio,
        location=profile.location,
        timezone=profile.timezone,
    )


@router.get("/profile", response_model=ProfileResponse)
async def get_profile(user=Depends(get_current_user)):
    prisma = await get_prisma()

    try:
        profile = await prisma.profile.find_unique(where={"userId": user.id})
        if not profile:
            profile = await prisma.profile.create(
                data={
                    "user": {"connect": {"id": user.id}},
                }
            )

        return _to_profile_response(user=user, profile=profile)
    except Exception as exc:
        print(f"Error fetching profile: {exc}")
        raise HTTPException(status_code=500, detail="Could not fetch profile")


@router.put("/profile", response_model=ProfileResponse)
async def update_profile(request: UpdateProfileRequest, user=Depends(get_current_user)):
    prisma = await get_prisma()

    update_data = request.model_dump(exclude_unset=True)

    try:
        profile = await prisma.profile.upsert(
            where={"userId": user.id},
            data={
                "update": update_data,
                "create": {
                    **update_data,
                    "user": {"connect": {"id": user.id}},
                },
            },
        )

        return _to_profile_response(user=user, profile=profile)
    except Exception as exc:
        print(f"Error updating profile: {exc}")
        raise HTTPException(status_code=500, detail="Could not update profile")
