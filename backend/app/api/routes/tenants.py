from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import require_tenant_permission
from app.db.session import get_db_session
from app.schemas.availability import AvailabilityResponse
from app.schemas.catalog import (
    CreateServiceRequest,
    CreateTenantRequest,
    CreateTenantResponse,
    LocationListResponse,
    ProviderListResponse,
    ServiceListResponse,
    ServiceSummaryResponse,
    TenantSummaryResponse,
    UpdateTenantSettingsRequest,
)
from app.services.availability import list_availability
from app.services.tenants import (
    create_tenant_account,
    create_tenant_service,
    get_tenant_summary,
    list_service_providers,
    list_tenant_locations,
    list_tenant_services,
    update_tenant_settings,
)


router = APIRouter(prefix="/tenants", tags=["tenants"])


@router.post("", response_model=CreateTenantResponse, status_code=status.HTTP_201_CREATED, summary="Create a tenant")
async def create_tenant(
    payload: CreateTenantRequest,
    session: AsyncSession = Depends(get_db_session),
) -> CreateTenantResponse:
    return await create_tenant_account(session, payload)


@router.get("/{tenant_slug}", response_model=TenantSummaryResponse, summary="Get tenant storefront context")
async def get_tenant(
    tenant_slug: str,
    session: AsyncSession = Depends(get_db_session),
) -> TenantSummaryResponse:
    return await get_tenant_summary(session, tenant_slug)


@router.patch(
    "/{tenant_slug}/settings",
    response_model=TenantSummaryResponse,
    summary="Update tenant settings",
)
async def patch_tenant_settings(
    tenant_slug: str,
    payload: UpdateTenantSettingsRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> TenantSummaryResponse:
    return await update_tenant_settings(session, tenant_slug, payload)


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


@router.post(
    "/{tenant_slug}/services",
    response_model=ServiceSummaryResponse,
    status_code=201,
    summary="Create a tenant-scoped service",
)
async def create_service(
    tenant_slug: str,
    payload: CreateServiceRequest,
    _: object = Depends(require_tenant_permission("services.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ServiceSummaryResponse:
    return await create_tenant_service(session, tenant_slug, payload)


@router.get(
    "/{tenant_slug}/locations",
    response_model=LocationListResponse,
    summary="List active locations for a tenant storefront",
)
async def list_locations(
    tenant_slug: str,
    session: AsyncSession = Depends(get_db_session),
) -> LocationListResponse:
    return await list_tenant_locations(session, tenant_slug)


@router.get(
    "/{tenant_slug}/services/{service_id}/providers",
    response_model=ProviderListResponse,
    summary="List active providers for a tenant service",
)
async def list_providers_for_service(
    tenant_slug: str,
    service_id: str,
    location_id: str | None = Query(None, alias="locationId"),
    session: AsyncSession = Depends(get_db_session),
) -> ProviderListResponse:
    return await list_service_providers(session, tenant_slug, service_id, location_id)


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
    window_days: int = Query(7, alias="windowDays", ge=1, le=62),
    session: AsyncSession = Depends(get_db_session),
) -> AvailabilityResponse:
    return await list_availability(
        session=session,
        tenant_slug=tenant_slug,
        service_id=service_id,
        provider_id=provider_id,
        location_id=location_id,
        requested_date_text=date,
        window_days=window_days,
    )