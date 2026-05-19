from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.http import api_exception
from app.core.security import create_access_token, create_refresh_token, decode_token, verify_password
from app.db.models import User
from app.schemas.auth import AuthenticatedUserResponse, PermissionGrantResponse, SessionResponse


ALL_PERMISSION_KEYS = [
    "dashboard.view",
    "calendar.view",
    "calendar.create_booking",
    "bookings.view",
    "bookings.manage",
    "bookings.complete",
    "bookings.cancel",
    "bookings.collect_payment",
    "payments.view",
    "payments.manage",
    "customers.view",
    "customers.manage",
    "forms.view",
    "forms.manage",
    "services.view",
    "services.manage",
    "providers.view",
    "providers.manage",
    "locations.view",
    "locations.manage",
    "settings.view",
    "settings.manage",
    "users.manage",
]


ROLE_PERMISSION_ALLOWLIST = {
    "owner": set(ALL_PERMISSION_KEYS),
    "manager": set(key for key in ALL_PERMISSION_KEYS if key != "users.manage"),
    "staff": {
        "dashboard.view",
        "calendar.view",
        "calendar.create_booking",
        "bookings.view",
        "bookings.manage",
        "bookings.complete",
        "bookings.cancel",
        "bookings.collect_payment",
        "payments.view",
        "payments.manage",
        "customers.view",
        "customers.manage",
        "forms.view",
        "services.view",
        "providers.view",
        "locations.view",
    },
    "provider": {
        "dashboard.view",
        "calendar.view",
        "bookings.view",
        "customers.view",
        "forms.view",
    },
}


def _permission_grants(role: str) -> list[PermissionGrantResponse]:
    allowlist = ROLE_PERMISSION_ALLOWLIST.get(role, set())
    return [PermissionGrantResponse(key=key, allowed=key in allowlist) for key in ALL_PERMISSION_KEYS]


def _session_response_for_user(user: User) -> SessionResponse:
    payload = {
        "sub": user.id,
        "tenantId": user.tenant_id,
        "email": user.email,
        "role": user.role,
    }
    access_token, expires_at = create_access_token(payload)
    refresh_token, _ = create_refresh_token(payload)
    return SessionResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        user=AuthenticatedUserResponse(
            id=user.id,
            tenant_id=user.tenant_id,
            email=user.email,
            name=user.name,
            role=user.role,
            permissions=_permission_grants(user.role),
        ),
    )


async def login_user(session: AsyncSession, email: str, password: str) -> SessionResponse:
    user = await session.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None or not user.is_active or not verify_password(password, user.password_hash):
        raise api_exception(401, "unauthorized", "Invalid email or password.")
    return _session_response_for_user(user)


async def refresh_user_session(session: AsyncSession, refresh_token: str) -> SessionResponse:
    try:
        payload = decode_token(refresh_token)
    except Exception as error:  # noqa: BLE001
        raise api_exception(401, "unauthorized", "Refresh token is invalid or expired.") from error

    if payload.get("tokenType") != "refresh":
        raise api_exception(401, "unauthorized", "Refresh token is invalid or expired.")

    user = await session.scalar(select(User).where(User.id == payload.get("sub")))
    if user is None or not user.is_active:
        raise api_exception(401, "unauthorized", "User session is no longer active.")
    return _session_response_for_user(user)