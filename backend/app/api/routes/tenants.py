from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.schemas.availability import AvailabilityResponse
from app.schemas.catalog import ServiceListResponse, TenantSummaryResponse
from app.services.availability import list_availability
from app.services.tenants import get_tenant_summary, list_tenant_services


router = APIRouter(prefix="/tenants", tags=["tenants"])


@router.get("/{tenant_slug}", response_model=TenantSummaryResponse, summary="Get tenant storefront context")
async def get_tenant(
    tenant_slug: str,
    session: AsyncSession = Depends(get_db_session),
) -> TenantSummaryResponse:
    return await get_tenant_summary(session, tenant_slug)


@router.get(
    "/{tenant_slug}/services",
    response_model=ServiceListResponse,
    summary="List active services for a tenant",
)
async def list_services(
    tenant_slug: str,
    session: AsyncSession = Depends(get_db_session),
) -> ServiceListResponse:
    return await list_tenant_services(session, tenant_slug)


@router.get(
    "/{tenant_slug}/availability",
    response_model=AvailabilityResponse,
    summary="List availability for a tenant service route",
)
async def get_availability(
    tenant_slug: str,
    service_id: str = Query(..., alias="serviceId"),
    provider_id: str | None = Query(None, alias="providerId"),
    location_id: str | None = Query(None, alias="locationId"),
    date: str = Query(...),
    session: AsyncSession = Depends(get_db_session),
) -> AvailabilityResponse:
    return await list_availability(
        session=session,
        tenant_slug=tenant_slug,
        service_id=service_id,
        provider_id=provider_id,
        location_id=location_id,
        requested_date_text=date,
    )