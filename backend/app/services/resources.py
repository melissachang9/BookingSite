from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.http import api_exception
from app.db.models import Resource
from app.schemas.resources import (
    CreateResourceRequest,
    ResourceListResponse,
    ResourceSummaryResponse,
    UpdateResourceRequest,
)
from app.services.tenants import get_tenant_by_slug


async def list_tenant_resources(
    session: AsyncSession,
    tenant_slug: str,
) -> ResourceListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    resources = (
        await session.scalars(
            select(Resource)
            .where(Resource.tenant_id == tenant.id)
            .order_by(Resource.name.asc())
        )
    ).all()
    return ResourceListResponse(
        items=[_resource_to_summary(r) for r in resources],
    )


async def create_tenant_resource(
    session: AsyncSession,
    tenant_slug: str,
    payload: CreateResourceRequest,
) -> ResourceSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    resource = Resource(
        tenant_id=tenant.id,
        name=payload.name.strip(),
        kind=payload.kind,
        location_id=payload.location_id,
        notes=payload.notes.strip() if payload.notes else None,
    )
    session.add(resource)
    await session.commit()
    return _resource_to_summary(resource)


async def update_tenant_resource(
    session: AsyncSession,
    tenant_slug: str,
    resource_id: str,
    payload: UpdateResourceRequest,
) -> ResourceSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    resource = await session.scalar(
        select(Resource).where(
            Resource.tenant_id == tenant.id,
            Resource.id == resource_id,
        )
    )
    if resource is None:
        raise api_exception(404, "not_found", "Resource was not found for this tenant.")

    if payload.name is not None:
        resource.name = payload.name.strip()
    if payload.kind is not None:
        resource.kind = payload.kind
    if payload.is_active is not None:
        resource.is_active = payload.is_active
    if payload.location_id is not None:
        resource.location_id = payload.location_id
    if payload.notes is not None:
        resource.notes = payload.notes.strip() if payload.notes else None

    await session.commit()
    return _resource_to_summary(resource)


def _resource_to_summary(resource: Resource) -> ResourceSummaryResponse:
    return ResourceSummaryResponse(
        id=resource.id,
        tenant_id=resource.tenant_id,
        created_at=resource.created_at,
        updated_at=resource.updated_at,
        name=resource.name,
        kind=resource.kind,
        is_active=resource.is_active,
        location_id=resource.location_id,
        notes=resource.notes,
    )
