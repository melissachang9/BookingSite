from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import require_tenant_permission
from app.db.models import User
from app.db.session import get_db_session
from app.schemas.service_add_ons import (
    CreateServiceAddOnRequest,
    ServiceAddOnListResponse,
    ServiceAddOnResponse,
    UpdateServiceAddOnRequest,
)
from app.services.audit import record_audit
from app.services.service_add_ons import (
    create_service_add_on,
    delete_service_add_on,
    list_service_add_ons,
    update_service_add_on,
)

router = APIRouter(tags=["service add-ons"])

_BASE = "/tenants/{tenant_slug}/services/{service_id}/add-ons"


@router.get(_BASE, response_model=ServiceAddOnListResponse, summary="List a service's active add-ons (public)")
async def list_public_add_ons(
    tenant_slug: str,
    service_id: str,
    session: AsyncSession = Depends(get_db_session),
) -> ServiceAddOnListResponse:
    return await list_service_add_ons(session, tenant_slug, service_id, include_inactive=False)


@router.get(f"{_BASE}/manage", response_model=ServiceAddOnListResponse, summary="List all of a service's add-ons")
async def list_managed_add_ons(
    tenant_slug: str,
    service_id: str,
    _: object = Depends(require_tenant_permission("services.view")),
    session: AsyncSession = Depends(get_db_session),
) -> ServiceAddOnListResponse:
    return await list_service_add_ons(session, tenant_slug, service_id, include_inactive=True)


@router.post(
    _BASE,
    response_model=ServiceAddOnResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a service add-on",
)
async def create_add_on(
    tenant_slug: str,
    service_id: str,
    payload: CreateServiceAddOnRequest,
    actor: User = Depends(require_tenant_permission("services.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ServiceAddOnResponse:
    result = await create_service_add_on(session, tenant_slug, service_id, payload)
    await record_audit(
        session, tenant_id=result.tenant_id, entity_type="service_add_on", entity_id=result.id,
        action="create", actor=actor, notes=result.name,
    )
    return result


@router.patch(f"{_BASE}/{{add_on_id}}", response_model=ServiceAddOnResponse, summary="Update a service add-on")
async def update_add_on(
    tenant_slug: str,
    service_id: str,
    add_on_id: str,
    payload: UpdateServiceAddOnRequest,
    actor: User = Depends(require_tenant_permission("services.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ServiceAddOnResponse:
    result = await update_service_add_on(session, tenant_slug, service_id, add_on_id, payload)
    await record_audit(
        session, tenant_id=result.tenant_id, entity_type="service_add_on", entity_id=add_on_id,
        action="update", actor=actor,
    )
    return result


@router.delete(f"{_BASE}/{{add_on_id}}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a service add-on")
async def delete_add_on(
    tenant_slug: str,
    service_id: str,
    add_on_id: str,
    actor: User = Depends(require_tenant_permission("services.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> Response:
    tenant_id = await delete_service_add_on(session, tenant_slug, service_id, add_on_id)
    await record_audit(
        session, tenant_id=tenant_id, entity_type="service_add_on", entity_id=add_on_id,
        action="delete", actor=actor,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
