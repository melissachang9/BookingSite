from __future__ import annotations

from copy import deepcopy

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.core.security import hash_password
from app.db.models import Location, Provider, Service, ServiceLocation, Tenant, User
from app.schemas.catalog import (
    CreateServiceRequest,
    CreateTenantRequest,
    CreateTenantResponse,
    LocationListResponse,
    ProviderListResponse,
    ServiceListResponse,
    TenantSummaryResponse,
)
from app.services.presenters import location_to_summary, provider_to_summary, service_to_summary, tenant_to_summary


DEFAULT_TENANT_SETTINGS = {
    "cancellationWindowHours": 24,
    "refundInsideWindow": False,
    "reminderHoursBefore": 24,
    "minLeadTimeMinutes": 60,
    "maxAdvanceBookingDays": 45,
    "defaultDepositCents": 2500,
    "noShowFeeCents": 5000,
    "taxRatePercent": 0,
    "autoChargeNoShowFee": False,
}


def _default_branding(payload: CreateTenantRequest) -> dict[str, object]:
    homepage_url = payload.homepage_url.strip() if isinstance(payload.homepage_url, str) and payload.homepage_url.strip() else None
    primary_color = payload.primary_color.strip() if isinstance(payload.primary_color, str) and payload.primary_color.strip() else "#9f5323"
    accent_color = payload.accent_color.strip() if isinstance(payload.accent_color, str) and payload.accent_color.strip() else "#7a3c13"
    return {
        "primaryColor": primary_color,
        "accentColor": accent_color,
        "homepageUrl": homepage_url,
        "serviceCatalogMode": "flat",
        "serviceCategories": [],
        "bookingScreening": {
            "enabled": False,
            "title": "How can we help?",
            "options": [],
        },
        "bookingAd": {
            "headline": f"{payload.name.strip()} online booking",
            "body": "Services will appear here as soon as the launch checklist is completed.",
        },
    }


async def get_tenant_by_slug(session: AsyncSession, tenant_slug: str) -> Tenant:
    tenant = await session.scalar(select(Tenant).where(Tenant.slug == tenant_slug))
    if tenant is None:
        raise api_exception(404, "not_found", "Tenant was not found.")
    return tenant


async def get_tenant_summary(session: AsyncSession, tenant_slug: str) -> TenantSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    return tenant_to_summary(tenant)


async def create_tenant_account(session: AsyncSession, payload: CreateTenantRequest) -> CreateTenantResponse:
    normalized_slug = payload.slug.strip().lower()
    normalized_email = payload.owner_email.strip().lower()

    existing_tenant_id = await session.scalar(select(Tenant.id).where(Tenant.slug == normalized_slug))
    if existing_tenant_id is not None:
        raise api_exception(409, "conflict", "A tenant with this slug already exists.")

    existing_user_id = await session.scalar(select(User.id).where(User.email == normalized_email))
    if existing_user_id is not None:
        raise api_exception(409, "conflict", "A user with this email already exists.")

    tenant = Tenant(
        slug=normalized_slug,
        name=payload.name.strip(),
        timezone=payload.timezone.strip(),
        branding_json=_default_branding(payload),
        settings_json=deepcopy(DEFAULT_TENANT_SETTINGS),
    )
    session.add(tenant)
    await session.flush()

    location = Location(
        tenant_id=tenant.id,
        name=payload.location_name.strip(),
        time_zone=tenant.timezone,
        is_active=True,
    )
    session.add(location)
    await session.flush()

    tenant.default_location_id = location.id
    owner = User(
        tenant_id=tenant.id,
        email=normalized_email,
        name=payload.owner_name.strip(),
        role="owner",
        password_hash=hash_password(payload.owner_password),
        is_active=True,
    )
    session.add(owner)
    await session.commit()

    return CreateTenantResponse(
        tenant=tenant_to_summary(tenant),
        owner_email=owner.email,
        location_id=location.id,
    )


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


async def create_tenant_service(
    session: AsyncSession,
    tenant_slug: str,
    payload: CreateServiceRequest,
):
    tenant = await get_tenant_by_slug(session, tenant_slug)
    requested_location_ids = list(dict.fromkeys(payload.location_ids))

    existing_service_id = await session.scalar(
        select(Service.id).where(
            Service.tenant_id == tenant.id,
            func.lower(Service.name) == payload.name.strip().lower(),
        )
    )
    if existing_service_id is not None:
        raise api_exception(409, "conflict", "A service with this name already exists for the tenant.")

    locations = (
        await session.scalars(
            select(Location)
            .where(
                Location.tenant_id == tenant.id,
                Location.is_active.is_(True),
                Location.id.in_(requested_location_ids),
            )
            .order_by(Location.created_at.asc())
        )
    ).all()
    found_location_ids = {location.id for location in locations}
    missing_location_ids = [location_id for location_id in requested_location_ids if location_id not in found_location_ids]
    if missing_location_ids:
        raise api_exception(404, "not_found", "One or more locations were not found for this tenant.")

    service = Service(
        tenant_id=tenant.id,
        name=payload.name.strip(),
        description=payload.description.strip() if isinstance(payload.description, str) and payload.description.strip() else None,
        duration_minutes=payload.duration_minutes,
        price_cents=payload.price_cents,
        deposit_cents=payload.deposit_cents,
        is_active=payload.is_active,
    )
    service.location_links = [
        ServiceLocation(tenant_id=tenant.id, location_id=location_id)
        for location_id in requested_location_ids
    ]
    session.add(service)
    await session.commit()
    return service_to_summary(service, tenant)


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
    return ProviderListResponse(providers=[provider_to_summary(provider, tenant) for provider in compatible_providers])