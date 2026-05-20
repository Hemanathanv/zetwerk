import base64
import hashlib
import hmac
from typing import Optional
import uuid
from fastapi import Request, APIRouter, HTTPException, Depends, Response
from db import get_prisma
from helpers.utils import hash_password, verify_password, create_session_token
from helpers.dependencies import get_current_user, get_session_token, validate_token
from datetime import datetime, timedelta, timezone
from helpers.config import settings
from pydantic import BaseModel, EmailStr

router = APIRouter(prefix=settings.API_SLUG + "/auth", tags=["Auth"])


def _cookie_domain() -> Optional[str]:
    domain = (settings.SESSION_COOKIE_DOMAIN or "").strip()
    return domain or None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

class UserResponse(BaseModel):
    id: str
    name: str
    email: str
    systemRole: str
    isActive: bool

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str
    newPassword: str


def _sign_reset_payload(payload: str) -> str:
    secret = settings.SECRET_KEY.encode("utf-8")
    return hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()


def create_reset_token(email: str) -> str:
    expires_at = int((utc_now() + timedelta(hours=1)).timestamp())
    payload = f"{email.lower()}|{expires_at}"
    signature = _sign_reset_payload(payload)
    return base64.urlsafe_b64encode(f"{payload}|{signature}".encode("utf-8")).decode("utf-8")


def validate_reset_token(token: str) -> str:
    try:
        decoded = base64.urlsafe_b64decode(token.encode("utf-8")).decode("utf-8")
        email, expires_at_raw, signature = decoded.rsplit("|", 2)
        payload = f"{email}|{expires_at_raw}"
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reset token")

    if not hmac.compare_digest(signature, _sign_reset_payload(payload)):
        raise HTTPException(status_code=400, detail="Invalid reset token")

    if int(expires_at_raw) < int(utc_now().timestamp()):
        raise HTTPException(status_code=400, detail="Reset token has expired")

    return email.lower()


@router.post("/login")
async def login(request: LoginRequest, response: Response):
    prisma = await get_prisma()
    
    try:
        user = await prisma.user.find_unique(where={"email": request.email.lower()})
    except Exception as e:
        print(f"Error querying user: {e}")
        raise HTTPException(status_code=500, detail="Database error")
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not verify_password(request.password, user.passwordHash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not user.isActive:
        raise HTTPException(status_code=403, detail="Account is inactive")
    
    token = create_session_token()
    expires_at = utc_now() + timedelta(days=7)
    try:
        await prisma.session.create(
            data={
                "id": str(uuid.uuid4()),
                "userId": user.id,
                "token": token,
                "expiresAt": expires_at,
                "createdAt": utc_now()
            }
        )
    except Exception as e:
        print(f"Error creating session: {e}")
        raise HTTPException(status_code=500, detail="Could not create session")
    
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=settings.SESSION_COOKIE_SECURE,
        samesite=settings.SESSION_COOKIE_SAMESITE,
        domain=_cookie_domain(),
        max_age=7 * 24 * 60 * 60,  # 7 days
    )
    return {
        "status": "success",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "systemRole": user.role,
            "isActive": user.isActive,
        },
        "token": token,
    }

@router.post("/logout")
async def logout(
    response: Response,
    token: Optional[str] = Depends(get_session_token)
):
    """
    Invalidate the current session.
    """
    if token:
        prisma = await get_prisma()
        try:
            await prisma.session.delete_many(
                where={"token": token}
            )
        except Exception:
            pass  # Session might not exist
    
    # Clear cookie
    response.delete_cookie(
        key="session_token",
        domain=_cookie_domain(),
        samesite=settings.SESSION_COOKIE_SAMESITE,
        secure=settings.SESSION_COOKIE_SECURE,
    )
    
    return {"status": "success", "message": "Logged out"}

@router.post("/change-password")
async def change_password(
    request: ChangePasswordRequest,
    user = Depends(get_current_user)
):
    """
    Change password for authenticated users (requires old password)
    """
    prisma = await get_prisma()
    user_password_hash = user.passwordHash

    if not verify_password(request.old_password, user_password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if len(request.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    if len(request.new_password) > 50:
        raise HTTPException(status_code=400, detail="New password is too long")

    new_hash = hash_password(request.new_password)
    try:
        await prisma.user.update(
            where={"id": user.id},
            data={"passwordHash": new_hash}
        )
    except Exception as e:
        print(f"Error updating password: {e}")
        raise HTTPException(status_code=500, detail="Could not update password")

    return {"status": "success", "message": "Password changed successfully"}

@router.post("/forgot-password")
async def forgot_password(
    request: ForgotPasswordRequest
):
    """
    Forgot password - sends reset link to user's email
    No authentication required
    """
    prisma = await get_prisma()
    # print(f"Forgot password called with email: {request.email}")  # Debug input

    try:
        user = await prisma.user.find_unique(where={"email": request.email.lower()})
    except Exception as e:
        print(f"Error querying user: {e}")
        # Don't reveal if email exists or not for security
        return {"status": "success", "message": "If an account exists with this email, a reset link has been sent."}

    if not user:
        # Don't reveal if email exists for security
        return {"status": "success", "message": "If an account exists with this email, a reset link has been sent."}

    if not user.isActive:
        return {"status": "success", "message": "If an account exists with this email, a reset link has been sent."}

    reset_token = create_reset_token(user.email)
    return {
        "status": "success",
        "message": "If an account exists with this email, a reset link has been sent.",
        "reset_token": reset_token
    }


@router.post("/reset-password")
async def reset_password(request: ResetPasswordRequest):
    if len(request.newPassword) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    if len(request.newPassword) > 50:
        raise HTTPException(status_code=400, detail="New password is too long")

    email = validate_reset_token(request.token)
    prisma = await get_prisma()

    user = await prisma.user.find_unique(where={"email": email})
    if not user or not user.isActive:
        raise HTTPException(status_code=400, detail="Invalid reset token")

    new_hash = hash_password(request.newPassword)
    await prisma.user.update(
        where={"id": user.id},
        data={"passwordHash": new_hash},
    )

    return {"status": "success", "message": "Password reset successfully"}

@router.get("/status")
async def auth_status(
    token: Optional[str] = Depends(get_session_token)
):
    """
    Check authentication status and return current user data
    """
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    prisma = await get_prisma()
    try:
        session = await prisma.session.find_unique(
            where={"token": token},
            include={"user": True}
        )

        if not session or session.expiresAt < utc_now():
            raise HTTPException(status_code=401, detail="Session expired or invalid")

        user = session.user
        if not user.isActive:
            raise HTTPException(status_code=403, detail="Account is inactive")

        return {
            "status": "success",
            "user": {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "systemRole": user.role,
                "isActive": user.isActive,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error checking auth status: {e}")
        raise HTTPException(status_code=500, detail="Could not verify authentication status")
