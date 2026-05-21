from __future__ import annotations

import os
from typing import Annotated, Optional

from fastapi import APIRouter, Body, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.http import api_exception
from app.db.session import get_db_session
from app.schemas.testing import ResetE2EDataRequest, ResetE2EDataResponse
from app.services.testing import reset_e2e_data


router = APIRouter(prefix="/testing", tags=["testing"], include_in_schema=False)


def require_e2e_reset_access(
    x_e2e_reset_token: Annotated[Optional[str], Header(alias="X-E2E-Reset-Token")] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    if settings.app_env == "production":
        raise api_exception(404, "not_found", "Testing endpoint was not found.")

    configured_reset_token = settings.test_reset_token or os.getenv("TEST_RESET_TOKEN")
    if configured_reset_token:
        if x_e2e_reset_token != configured_reset_token:
            raise api_exception(403, "forbidden", "Testing reset token is invalid.")
        return

    if settings.app_env != "test":
        raise api_exception(404, "not_found", "Testing endpoint was not found.")


@router.post(
    "/e2e/reset",
    response_model=ResetE2EDataResponse,
    summary="Reset volatile E2E data for a seeded tenant",
)
async def reset_e2e_data_route(
    payload: Annotated[Optional[ResetE2EDataRequest], Body()] = None,
    _: None = Depends(require_e2e_reset_access),
    session: AsyncSession = Depends(get_db_session),
) -> ResetE2EDataResponse:
    request = payload or ResetE2EDataRequest()
    return await reset_e2e_data(session, request.tenant_slug)