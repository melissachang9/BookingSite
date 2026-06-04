from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.db.session import get_db_session
from app.schemas.auth import (
    LoginRequest,
    PermissionCatalogResponse,
    PermissionDefinitionResponse,
    RefreshSessionRequest,
    SessionResponse,
)
from app.services.auth import (
    PERMISSION_CATALOG,
    ROLE_PERMISSION_ALLOWLIST,
    login_user,
    refresh_user_session,
)


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=SessionResponse, summary="Create an operator session")
async def login(
    payload: LoginRequest,
    session: AsyncSession = Depends(get_db_session),
) -> SessionResponse:
    return await login_user(session, payload.email, payload.password)


@router.post("/refresh", response_model=SessionResponse, summary="Refresh an operator session")
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
