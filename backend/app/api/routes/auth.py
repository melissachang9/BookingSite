from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.core.client_ip import client_ip
from app.core.rate_limit import enforce_rate_limit, rate_limit
from app.db.session import get_db_session
from app.schemas.auth import (
    LoginRequest,
    PermissionCatalogResponse,
    PermissionDefinitionResponse,
    ForgotPasswordRequest,
    OkResponse,
    RefreshSessionRequest,
    ResetPasswordRequest,
    SessionResponse,
)
from app.services.auth import (
    PERMISSION_CATALOG,
    ROLE_PERMISSION_ALLOWLIST,
    complete_password_reset,
    login_user,
    refresh_user_session,
    request_password_reset,
)


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/login",
    response_model=SessionResponse,
    summary="Create an operator session",
    dependencies=[Depends(rate_limit("login", limit=20, window_seconds=300))],
)
async def login(
    payload: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> SessionResponse:
    # Guessing one account's password from one address is capped tighter than the address overall, without
    # letting a stranger lock the real owner out from elsewhere.
    enforce_rate_limit(
        "login-account", f"{client_ip(request)}|{payload.email.strip().lower()}", limit=8, window_seconds=900
    )
    return await login_user(session, payload.email, payload.password)


@router.post(
    "/refresh",
    response_model=SessionResponse,
    summary="Refresh an operator session",
    dependencies=[Depends(rate_limit("refresh", limit=60, window_seconds=60))],
)
async def refresh_session(
    payload: RefreshSessionRequest,
    session: AsyncSession = Depends(get_db_session),
) -> SessionResponse:
    return await refresh_user_session(session, payload.refresh_token)


@router.get(
    "/permissions/catalog",
    response_model=PermissionCatalogResponse,
    summary="List all permissions and per-role defaults",
)
async def get_permission_catalog(
    _current_user: object = Depends(get_current_user),
) -> PermissionCatalogResponse:
    return PermissionCatalogResponse(
        permissions=[
            PermissionDefinitionResponse(
                key=definition.key,
                category=definition.category,
                label=definition.label,
                description=definition.description,
            )
            for definition in PERMISSION_CATALOG
        ],
        role_defaults={
            role: sorted(keys) for role, keys in ROLE_PERMISSION_ALLOWLIST.items()
        },
    )


@router.post(
    "/forgot-password",
    response_model=OkResponse,
    summary="Email a password reset link (always answers the same, so emails can't be probed)",
    dependencies=[Depends(rate_limit("forgot-password", limit=10, window_seconds=3600))],
)
async def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> OkResponse:
    # A few links per address per hour: enough for a real person, too few to spam someone's inbox.
    enforce_rate_limit("forgot-password-account", payload.email.strip().lower(), limit=3, window_seconds=3600)
    await request_password_reset(session, payload.email)
    return OkResponse()


@router.post(
    "/reset-password",
    response_model=OkResponse,
    summary="Set a new password from an emailed reset or invite link",
    dependencies=[Depends(rate_limit("reset-password", limit=20, window_seconds=3600))],
)
async def reset_password(
    payload: ResetPasswordRequest,
    session: AsyncSession = Depends(get_db_session),
) -> OkResponse:
    await complete_password_reset(session, payload.token, payload.new_password)
    return OkResponse()
