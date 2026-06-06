from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import require_tenant_permission
from app.db.session import get_db_session
from app.schemas.forms import (
    CreateFormRequest,
    FormListResponse,
    FormSummaryResponse,
    UpdateFormRequest,
)
from app.services.forms import create_tenant_form, list_tenant_forms, update_tenant_form


router = APIRouter(tags=["forms"])


@router.get(
    "/tenants/{tenant_slug}/forms",
    response_model=FormListResponse,
    summary="List all forms for a tenant",
)
async def list_forms(
    tenant_slug: str,
    _: object = Depends(require_tenant_permission("settings.view")),
    session: AsyncSession = Depends(get_db_session),
) -> FormListResponse:
    return await list_tenant_forms(session, tenant_slug)


@router.post(
    "/tenants/{tenant_slug}/forms",
    response_model=FormSummaryResponse,
    status_code=201,
    summary="Create a tenant form",
)
async def create_form(
    tenant_slug: str,
    payload: CreateFormRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> FormSummaryResponse:
    return await create_tenant_form(session, tenant_slug, payload)


@router.patch(
    "/tenants/{tenant_slug}/forms/{form_id}",
    response_model=FormSummaryResponse,
    summary="Update a tenant form",
)
async def update_form(
    tenant_slug: str,
    form_id: str,
    payload: UpdateFormRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> FormSummaryResponse:
    return await update_tenant_form(session, tenant_slug, form_id, payload)
