from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.schemas.auth import LoginRequest, RefreshSessionRequest, SessionResponse
from app.services.auth import login_user, refresh_user_session


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