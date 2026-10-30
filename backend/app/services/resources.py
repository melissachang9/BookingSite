from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.http import api_exception
from app.db.models import Location, Resource, Service, ServiceResource
from app.schemas.resources import (
    CreateResourceRequest,
    ResourceListResponse,
    ResourceServiceUse,
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
    usage = await _services_using(session, tenant.id, [r.id for r in resources])
    return ResourceListResponse(
        items=[_resource_to_summary(r, usage.get(r.id, [])) for r in resources],
    )


async def _services_using(
    session: AsyncSession, tenant_id: str, resource_ids: list[str]
) -> dict[str, list[ResourceServiceUse]]:
    """Services that require each resource, so the Resources page can show what depends on it."""
    usage: dict[str, list[ResourceServiceUse]] = {}
    if not resource_ids:
        return usage
    rows = (
        await session.execute(
            select(ServiceResource.resource_id, ServiceResource.quantity, Service)
            .join(Service, Service.id == ServiceResource.service_id)
            .where(
                ServiceResource.tenant_id == tenant_id,
                Service.tenant_id == tenant_id,
                ServiceResource.resource_id.in_(resource_ids),
            )
            .order_by(Service.name.asc())
        )
    ).all()
    for resource_id, quantity, service in rows:
        usage.setdefault(resource_id, []).append(
            ResourceServiceUse(
                service_id=service.id,
                service_name=service.name,
                is_active=service.is_active,
                quantity=quantity,
            )
        )
    return usage


async def _ensure_location(session: AsyncSession, tenant_id: str, location_id: str | None) -> None:
    if location_id is None:
        return
    found = await session.scalar(
        select(Location.id).where(Location.tenant_id == tenant_id, Location.id == location_id)
    )
    if found is None:
        raise api_exception(404, "not_found", "Location was not found for this tenant.")


async def create_tenant_resource(
    session: AsyncSession,
    tenant_slug: str,
    payload: CreateResourceRequest,
) -> ResourceSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    await _ensure_location(session, tenant.id, payload.location_id)
    resource = Resource(
        tenant_id=tenant.id,
        name=payload.name.strip(),
        kind=payload.kind,
        location_id=payload.location_id,
        notes=payload.notes.strip() if payload.notes else None,
        quantity=payload.quantity,
    )
    session.add(resource)
    await session.commit()
    return _resource_to_summary(resource, [])


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
    # An explicit null moves the resource back to "all locations".
    if "location_id" in payload.model_fields_set:
        await _ensure_location(session, tenant.id, payload.location_id)
        resource.location_id = payload.location_id
    if payload.notes is not None:
        resource.notes = payload.notes.strip() if payload.notes else None
    if payload.quantity is not None:
        resource.quantity = payload.quantity

    await session.commit()
    usage = await _services_using(session, tenant.id, [resource.id])
    return _resource_to_summary(resource, usage.get(resource.id, []))


def _resource_to_summary(resource: Resource, used_by: list[ResourceServiceUse]) -> ResourceSummaryResponse:
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
        quantity=resource.quantity,
        used_by=used_by,
    )
