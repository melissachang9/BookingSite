from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import require_tenant_permission
from app.db.session import get_db_session
from app.schemas.resources import (
    CreateResourceRequest,
    ResourceListResponse,
    ResourceSummaryResponse,
    UpdateResourceRequest,
)
from app.services.resources import create_tenant_resource, list_tenant_resources, update_tenant_resource


router = APIRouter(tags=["resources"])


@router.get(
    "/tenants/{tenant_slug}/resources",
    response_model=ResourceListResponse,
    summary="List all resources for a tenant",
)
async def list_resources(
    tenant_slug: str,
    _: object = Depends(require_tenant_permission("settings.view")),
    session: AsyncSession = Depends(get_db_session),
) -> ResourceListResponse:
    return await list_tenant_resources(session, tenant_slug)


@router.post(
    "/tenants/{tenant_slug}/resources",
    response_model=ResourceSummaryResponse,
    status_code=201,
    summary="Create a tenant resource",
)
async def create_resource(
    tenant_slug: str,
    payload: CreateResourceRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ResourceSummaryResponse:
    return await create_tenant_resource(session, tenant_slug, payload)


@router.patch(
    "/tenants/{tenant_slug}/resources/{resource_id}",
    response_model=ResourceSummaryResponse,
    summary="Update a tenant resource",
)
async def update_resource(
    tenant_slug: str,
    resource_id: str,
    payload: UpdateResourceRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ResourceSummaryResponse:
    return await update_tenant_resource(session, tenant_slug, resource_id, payload)
