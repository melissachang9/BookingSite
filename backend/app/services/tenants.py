from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import Service, Tenant
from app.schemas.catalog import ServiceListResponse, TenantSummaryResponse
from app.services.presenters import service_to_summary, tenant_to_summary


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
    return ServiceListResponse(services=[service_to_summary(service) for service in services])