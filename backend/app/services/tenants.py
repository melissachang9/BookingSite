from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import Location, Provider, Service, Tenant
from app.schemas.catalog import LocationListResponse, ProviderListResponse, ServiceListResponse, TenantSummaryResponse
from app.services.presenters import location_to_summary, provider_to_summary, service_to_summary, tenant_to_summary


async def get_tenant_by_slug(session: AsyncSession, tenant_slug: str) -> Tenant:
    tenant = await session.scalar(select(Tenant).where(Tenant.slug == tenant_slug))
    if tenant is None:
        raise api_exception(404, "not_found", "Tenant was not found.")
    return tenant


async def get_tenant_summary(session: AsyncSession, tenant_slug: str) -> TenantSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    return tenant_to_summary(tenant)


async def list_tenant_services(session: AsyncSession, tenant_slug: str) -> ServiceListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    services = (
        await session.scalars(
            select(Service)
            .options(selectinload(Service.location_links))
            .where(Service.tenant_id == tenant.id, Service.is_active.is_(True))
            .order_by(Service.created_at.asc())
        )
    ).all()
    return ServiceListResponse(services=[service_to_summary(service, tenant) for service in services])


async def list_tenant_locations(session: AsyncSession, tenant_slug: str) -> LocationListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    locations = (
        await session.scalars(
            select(Location)
            .where(Location.tenant_id == tenant.id, Location.is_active.is_(True))
            .order_by(Location.created_at.asc())
        )
    ).all()
    return LocationListResponse(locations=[location_to_summary(location) for location in locations])


async def list_service_providers(
    session: AsyncSession,
    tenant_slug: str,
    service_id: str,
    location_id: str | None = None,
) -> ProviderListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    service = await session.scalar(
        select(Service)
        .options(selectinload(Service.provider_links), selectinload(Service.location_links))
        .where(Service.tenant_id == tenant.id, Service.id == service_id, Service.is_active.is_(True))
    )
    if service is None:
        raise api_exception(404, "not_found", "Service was not found for this tenant.")

    provider_ids = [link.provider_id for link in service.provider_links]
    if not provider_ids:
        return ProviderListResponse(providers=[])

    service_location_ids = {link.location_id for link in service.location_links}
    if location_id is not None and location_id not in service_location_ids:
        raise api_exception(404, "not_found", "Location was not found for this service.")

    target_location_ids = {location_id} if location_id is not None else service_location_ids
    providers = (
        await session.scalars(
            select(Provider)
            .options(selectinload(Provider.location_links), selectinload(Provider.service_links))
            .where(Provider.tenant_id == tenant.id, Provider.id.in_(provider_ids), Provider.is_active.is_(True))
            .order_by(Provider.created_at.asc())
        )
    ).all()
    compatible_providers = [
        provider
        for provider in providers
        if any(link.location_id in target_location_ids for link in provider.location_links)
    ]
    return ProviderListResponse(providers=[provider_to_summary(provider) for provider in compatible_providers])