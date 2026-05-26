from __future__ import annotations

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.http import api_exception
from app.core.security import decode_token
from app.db.models import Tenant, User
from app.db.session import get_db_session
from app.services.auth import ROLE_PERMISSION_ALLOWLIST


bearer_scheme = HTTPBearer(auto_error=False)


async def _resolve_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_db_session),
) -> User | None:
    if credentials is None:
        return None

    try:
        payload = decode_token(credentials.credentials)
    except Exception as error:  # noqa: BLE001
        raise api_exception(401, "unauthorized", "Access token is invalid or expired.") from error

    if payload.get("tokenType") != "access":
        raise api_exception(401, "unauthorized", "Access token is invalid or expired.")

    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise api_exception(401, "unauthorized", "Access token is invalid or expired.")

    user = await session.scalar(select(User).where(User.id == user_id))
    if user is None or not user.is_active:
        raise api_exception(401, "unauthorized", "User session is no longer active.")

    return user


async def get_current_user(
    current_user: User | None = Depends(_resolve_current_user),
) -> User:
    if current_user is None:
        raise api_exception(401, "unauthorized", "Authentication is required.")
    return current_user


async def get_optional_current_user(
    current_user: User | None = Depends(_resolve_current_user),
) -> User | None:
    return current_user


def require_tenant_permission(permission_key: str):
    async def dependency(
        tenant_slug: str,
        current_user: User = Depends(get_current_user),
        session: AsyncSession = Depends(get_db_session),
    ) -> User:
        tenant = await session.scalar(select(Tenant).where(Tenant.slug == tenant_slug))
        if tenant is None:
            raise api_exception(404, "not_found", "Tenant was not found.")

        if current_user.tenant_id != tenant.id:
            raise api_exception(403, "forbidden", "You do not have access to this tenant.")

        if permission_key not in ROLE_PERMISSION_ALLOWLIST.get(current_user.role, set()):
            raise api_exception(403, "forbidden", "You do not have permission to perform this action.")

        return current_user

    return dependency