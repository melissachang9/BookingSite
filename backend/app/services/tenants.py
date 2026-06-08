from __future__ import annotations

import re
from copy import deepcopy

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.core.security import hash_password
from app.db.models import (
    Location,
    Provider,
    ProviderLocation,
    ProviderSchedule,
    ProviderService,
    ProviderTimeOff,
    Service,
    ServiceCategory,
    ServiceLocation,
    Tenant,
    User,
    UserPermissionOverride,
)
from app.schemas.catalog import (
    CreateLocationRequest,
    CreateServiceRequest,
    CreateTenantRequest,
    CreateTenantResponse,
    CreateTenantUserRequest,
    LocationListResponse,
    TenantUserListResponse,
    TenantUserSummaryResponse,
    LocationSummaryResponse,
    ProviderListResponse,
    ResetTenantUserPasswordRequest,
    ServiceListResponse,
    TenantSummaryResponse,
    UpdateLocationRequest,
    UpdateTenantBrandingRequest,
    UpdateTenantBusinessHoursRequest,
    UpdateTenantBusinessRequest,
    UpdateTenantClientOwnershipRequest,
    UpdateTenantCustomEmailRequest,
    UpdateTenantUserRequest,
    UpdateTenantWalletMembershipRequest,
    UpdateTenantSettingsRequest,
    CreateProviderRequest,
    UpdateProviderRequest,
    CreateStaffRequest,
    CreateStaffResponse,
    ProviderSummaryResponse,
)
from app.services.presenters import location_to_summary, provider_to_summary, service_to_summary, tenant_to_summary


DEFAULT_BUSINESS_HOURS = {
    "mon": {"open": "09:00", "close": "17:00", "closed": False},
    "tue": {"open": "09:00", "close": "17:00", "closed": False},
    "wed": {"open": "09:00", "close": "17:00", "closed": False},
    "thu": {"open": "09:00", "close": "17:00", "closed": False},
    "fri": {"open": "09:00", "close": "17:00", "closed": False},
    "sat": {"open": "09:00", "close": "17:00", "closed": True},
    "sun": {"open": "09:00", "close": "17:00", "closed": True},
}


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
    "calendarDisplayStartHour": 9,
    "calendarDisplayEndHour": 19,
    "country": "US",
    "currency": "USD",
    "smsPhone": None,
    "businessHoursEnabled": False,
    "restrictProvidersToBusinessHours": False,
    "businessHours": deepcopy(DEFAULT_BUSINESS_HOURS),
    "clientOwnershipEnabled": False,
    "onlineBookingOwnerAssignmentEnabled": False,
    "customEmail": {"fromAddress": None, "domain": None, "verified": False},
    "walletEnabled": False,
    "walletExpirationMonths": None,
    "membershipEnabled": False,
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


async def update_tenant_settings(
    session: AsyncSession, tenant_slug: str, payload: UpdateTenantSettingsRequest
) -> TenantSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    current = dict(tenant.settings_json or {})

    start_hour = payload.calendar_display_start_hour if payload.calendar_display_start_hour is not None else current.get("calendarDisplayStartHour", 9)
    end_hour = payload.calendar_display_end_hour if payload.calendar_display_end_hour is not None else current.get("calendarDisplayEndHour", 19)

    if end_hour <= start_hour:
        raise api_exception(422, "validation_error", "Calendar display end hour must be greater than start hour.")

    current["calendarDisplayStartHour"] = start_hour
    current["calendarDisplayEndHour"] = end_hour

    if payload.week_starts_on is not None:
        current["weekStartsOn"] = payload.week_starts_on

    tenant.settings_json = current
    await session.commit()
    await session.refresh(tenant)
    return tenant_to_summary(tenant)


async def update_tenant_business(
    session: AsyncSession, tenant_slug: str, payload: UpdateTenantBusinessRequest
) -> TenantSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    current_settings = dict(tenant.settings_json or {})
    current_branding = dict(tenant.branding_json or {})

    if payload.name is not None:
        tenant.name = payload.name.strip()
    if payload.homepage_url is not None:
        homepage = payload.homepage_url.strip()
        current_branding["homepageUrl"] = homepage or None
    if payload.country is not None:
        current_settings["country"] = payload.country.strip().upper()
    if payload.currency is not None:
        current_settings["currency"] = payload.currency.strip().upper()
    if payload.sms_phone is not None:
        sms = payload.sms_phone.strip()
        current_settings["smsPhone"] = sms or None

    tenant.branding_json = current_branding
    tenant.settings_json = current_settings
    await session.commit()
    await session.refresh(tenant)
    return tenant_to_summary(tenant)


async def update_tenant_branding(
    session: AsyncSession, tenant_slug: str, payload: UpdateTenantBrandingRequest
) -> TenantSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    current_branding = dict(tenant.branding_json or {})

    if payload.logo_url is not None:
        url = payload.logo_url.strip()
        current_branding["logoUrl"] = url or None
    if payload.favicon_url is not None:
        url = payload.favicon_url.strip()
        current_branding["faviconUrl"] = url or None
    if payload.primary_color is not None:
        color = payload.primary_color.strip()
        current_branding["primaryColor"] = color or None
    if payload.accent_color is not None:
        color = payload.accent_color.strip()
        current_branding["accentColor"] = color or None
    if payload.photos is not None:
        current_branding["photos"] = [url.strip() for url in payload.photos]

    tenant.branding_json = current_branding
    await session.commit()
    await session.refresh(tenant)
    return tenant_to_summary(tenant)


async def update_tenant_client_ownership(
    session: AsyncSession, tenant_slug: str, payload: UpdateTenantClientOwnershipRequest
) -> TenantSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    current = dict(tenant.settings_json or {})

    if payload.client_ownership_enabled is not None:
        current["clientOwnershipEnabled"] = payload.client_ownership_enabled
    if payload.online_booking_owner_assignment_enabled is not None:
        current["onlineBookingOwnerAssignmentEnabled"] = payload.online_booking_owner_assignment_enabled

    tenant.settings_json = current
    await session.commit()
    await session.refresh(tenant)
    return tenant_to_summary(tenant)


async def update_tenant_wallet_membership(
    session: AsyncSession, tenant_slug: str, payload: UpdateTenantWalletMembershipRequest
) -> TenantSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    current = dict(tenant.settings_json or {})

    fields_set = payload.model_fields_set
    if "walletEnabled" in fields_set or "wallet_enabled" in fields_set:
        current["walletEnabled"] = bool(payload.wallet_enabled)
    if "walletExpirationMonths" in fields_set or "wallet_expiration_months" in fields_set:
        current["walletExpirationMonths"] = payload.wallet_expiration_months
    if "membershipEnabled" in fields_set or "membership_enabled" in fields_set:
        current["membershipEnabled"] = bool(payload.membership_enabled)

    tenant.settings_json = current
    await session.commit()
    await session.refresh(tenant)
    return tenant_to_summary(tenant)


def _normalize_optional_str(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped if stripped else None


async def update_tenant_custom_email(
    session: AsyncSession, tenant_slug: str, payload: UpdateTenantCustomEmailRequest
) -> TenantSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    current = dict(tenant.settings_json or {})
    current_email = dict(current.get("customEmail") or {"fromAddress": None, "domain": None, "verified": False})

    if "fromAddress" in payload.model_fields_set or payload.from_address is not None:
        current_email["fromAddress"] = _normalize_optional_str(payload.from_address)
    if "domain" in payload.model_fields_set or payload.domain is not None:
        current_email["domain"] = _normalize_optional_str(payload.domain)
    # Verification is always false until a real verification flow exists.
    current_email["verified"] = False

    current["customEmail"] = current_email
    tenant.settings_json = current
    await session.commit()
    await session.refresh(tenant)
    return tenant_to_summary(tenant)


def build_email_dns_records(domain: str | None) -> list[dict[str, str]]:
    if not domain:
        return []
    return [
        {"type": "CNAME", "host": f"booking._domainkey.{domain}", "value": "dkim.bookingsoftware.email"},
        {"type": "TXT", "host": domain, "value": "v=spf1 include:bookingsoftware.email ~all"},
        {"type": "TXT", "host": f"_dmarc.{domain}", "value": "v=DMARC1; p=none; rua=mailto:dmarc@bookingsoftware.email"},
    ]


async def get_tenant_email_dns(session: AsyncSession, tenant_slug: str) -> dict[str, object]:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    settings = tenant.settings_json or {}
    custom_email = settings.get("customEmail") or {}
    domain = custom_email.get("domain")
    return {
        "domain": domain,
        "records": build_email_dns_records(domain),
        "verified": bool(custom_email.get("verified", False)),
    }


async def update_tenant_business_hours(
    session: AsyncSession, tenant_slug: str, payload: UpdateTenantBusinessHoursRequest
) -> TenantSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    current = dict(tenant.settings_json or {})

    if payload.business_hours_enabled is not None:
        current["businessHoursEnabled"] = payload.business_hours_enabled
    if payload.restrict_providers_to_business_hours is not None:
        current["restrictProvidersToBusinessHours"] = payload.restrict_providers_to_business_hours
    if payload.business_hours is not None:
        hours: dict[str, dict[str, object]] = {}
        for day_key in ("mon", "tue", "wed", "thu", "fri", "sat", "sun"):
            entry = getattr(payload.business_hours, day_key)
            hours[day_key] = {
                "open": entry.open,
                "close": entry.close,
                "closed": entry.closed,
            }
        current["businessHours"] = hours

    tenant.settings_json = current
    await session.commit()
    await session.refresh(tenant)
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
            .options(selectinload(Service.location_links), selectinload(Service.form_attachments))
            .where(Service.tenant_id == tenant.id, Service.is_active.is_(True))
            .order_by(Service.sort_order.asc(), Service.created_at.asc())
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
        setup_buffer_minutes=payload.setup_buffer_minutes,
        cleanup_buffer_minutes=payload.cleanup_buffer_minutes,
        price_cents=payload.price_cents,
        deposit_cents=payload.deposit_cents,
        is_active=payload.is_active,
        category_id=payload.category_id,
    )
    service.location_links = [
        ServiceLocation(tenant_id=tenant.id, location_id=location_id)
        for location_id in requested_location_ids
    ]
    service.slug = await _ensure_unique_service_slug(
        session, tenant.id, getattr(payload, "slug", None), service.name
    )
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


async def list_tenant_locations_admin(session: AsyncSession, tenant_slug: str) -> LocationListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    locations = (
        await session.scalars(
            select(Location)
            .where(Location.tenant_id == tenant.id)
            .order_by(Location.created_at.asc())
        )
    ).all()
    return LocationListResponse(locations=[location_to_summary(location) for location in locations])


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


async def create_tenant_location(
    session: AsyncSession, tenant_slug: str, payload: CreateLocationRequest
) -> LocationSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    name = payload.name.strip()
    existing_id = await session.scalar(
        select(Location.id).where(
            Location.tenant_id == tenant.id,
            func.lower(Location.name) == name.lower(),
        )
    )
    if existing_id is not None:
        raise api_exception(409, "conflict", "A location with this name already exists for the tenant.")
    location = Location(
        tenant_id=tenant.id,
        name=name,
        time_zone=payload.time_zone.strip(),
        is_active=True,
        address_line1=_normalize_optional_text(payload.address_line1),
        address_line2=_normalize_optional_text(payload.address_line2),
        city=_normalize_optional_text(payload.city),
        state=_normalize_optional_text(payload.state),
        postal_code=_normalize_optional_text(payload.postal_code),
        phone=_normalize_optional_text(payload.phone),
    )
    session.add(location)
    await session.commit()
    await session.refresh(location)
    return location_to_summary(location)


async def update_tenant_location(
    session: AsyncSession,
    tenant_slug: str,
    location_id: str,
    payload: UpdateLocationRequest,
) -> LocationSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    location = await session.scalar(
        select(Location).where(Location.tenant_id == tenant.id, Location.id == location_id)
    )
    if location is None:
        raise api_exception(404, "not_found", "Location was not found for this tenant.")

    if payload.name is not None:
        name = payload.name.strip()
        duplicate_id = await session.scalar(
            select(Location.id).where(
                Location.tenant_id == tenant.id,
                Location.id != location.id,
                func.lower(Location.name) == name.lower(),
            )
        )
        if duplicate_id is not None:
            raise api_exception(409, "conflict", "A location with this name already exists for the tenant.")
        location.name = name
    if payload.time_zone is not None:
        location.time_zone = payload.time_zone.strip()
    if payload.address_line1 is not None:
        location.address_line1 = _normalize_optional_text(payload.address_line1)
    if payload.address_line2 is not None:
        location.address_line2 = _normalize_optional_text(payload.address_line2)
    if payload.city is not None:
        location.city = _normalize_optional_text(payload.city)
    if payload.state is not None:
        location.state = _normalize_optional_text(payload.state)
    if payload.postal_code is not None:
        location.postal_code = _normalize_optional_text(payload.postal_code)
    if payload.phone is not None:
        location.phone = _normalize_optional_text(payload.phone)
    if payload.is_active is not None:
        if not payload.is_active and tenant.default_location_id == location.id:
            raise api_exception(
                409,
                "conflict",
                "Cannot deactivate the default location. Set a different default first.",
            )
        location.is_active = payload.is_active

    await session.commit()
    await session.refresh(location)
    return location_to_summary(location)


async def deactivate_tenant_location(
    session: AsyncSession, tenant_slug: str, location_id: str
) -> LocationSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    location = await session.scalar(
        select(Location).where(Location.tenant_id == tenant.id, Location.id == location_id)
    )
    if location is None:
        raise api_exception(404, "not_found", "Location was not found for this tenant.")
    if tenant.default_location_id == location.id:
        raise api_exception(
            409,
            "conflict",
            "Cannot deactivate the default location. Set a different default first.",
        )
    location.is_active = False
    await session.commit()
    await session.refresh(location)
    return location_to_summary(location)


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

async def list_tenant_users(session: AsyncSession, tenant_slug: str) -> "TenantUserListResponse":
    tenant = await get_tenant_by_slug(session, tenant_slug)
    users = (
        await session.scalars(
            select(User)
            .where(User.tenant_id == tenant.id)
            .order_by(User.created_at.asc())
        )
    ).all()
    return TenantUserListResponse(
        users=[_user_to_summary(user) for user in users]
    )


def _user_to_summary(user: User) -> TenantUserSummaryResponse:
    return TenantUserSummaryResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        phone=user.phone,
        avatar_url=user.avatar_url,
    )


async def _get_tenant_user(session: AsyncSession, tenant_id: str, user_id: str) -> User:
    user = (
        await session.scalars(
            select(User).where(User.id == user_id, User.tenant_id == tenant_id)
        )
    ).one_or_none()
    if user is None:
        raise api_exception(status_code=404, code="user_not_found", message="User not found.")
    return user


async def _count_active_owners(session: AsyncSession, tenant_id: str) -> int:
    return int(
        (
            await session.scalar(
                select(func.count())
                .select_from(User)
                .where(
                    User.tenant_id == tenant_id,
                    User.role == "owner",
                    User.is_active == True,  # noqa: E712
                )
            )
        )
        or 0
    )


async def create_tenant_user(
    session: AsyncSession,
    tenant_slug: str,
    payload: CreateTenantUserRequest,
) -> TenantUserSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    existing = (
        await session.scalars(select(User).where(func.lower(User.email) == payload.email.lower()))
    ).one_or_none()
    if existing is not None:
        raise api_exception(
            status_code=409,
            code="email_already_registered",
            message="A user with that email already exists.",
        )
    user = User(
        tenant_id=tenant.id,
        email=payload.email,
        name=payload.name.strip(),
        role=payload.role,
        password_hash=hash_password(payload.initial_password),
        is_active=True,
        phone=payload.phone,
        avatar_url=payload.avatar_url,
    )
    session.add(user)
    await session.flush()
    await session.commit()
    await session.refresh(user)
    return _user_to_summary(user)


async def update_tenant_user(
    session: AsyncSession,
    tenant_slug: str,
    user_id: str,
    payload: UpdateTenantUserRequest,
) -> TenantUserSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    user = await _get_tenant_user(session, tenant.id, user_id)

    new_role = payload.role if payload.role is not None else user.role
    new_active = payload.is_active if payload.is_active is not None else user.is_active

    # Last-active-owner guard: prevent demotion or deactivation if it would leave
    # the tenant with zero active owners.
    if user.role == "owner" and user.is_active and (new_role != "owner" or new_active is False):
        active_owners = await _count_active_owners(session, tenant.id)
        if active_owners <= 1:
            raise api_exception(
                status_code=409,
                code="last_active_owner",
                message="At least one active owner is required.",
            )

    if payload.name is not None:
        user.name = payload.name.strip()
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.phone is not None:
        user.phone = _normalize_optional_text(payload.phone)
    if payload.avatar_url is not None:
        user.avatar_url = _normalize_optional_text(payload.avatar_url)

    await session.commit()
    await session.refresh(user)
    return _user_to_summary(user)


async def reset_tenant_user_password(
    session: AsyncSession,
    tenant_slug: str,
    user_id: str,
    payload: ResetTenantUserPasswordRequest,
) -> TenantUserSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    user = await _get_tenant_user(session, tenant.id, user_id)
    user.password_hash = hash_password(payload.new_password)
    await session.commit()
    await session.refresh(user)
    return _user_to_summary(user)


# === Phase B: Providers CRUD + Staff combo ===


async def _load_provider_with_links(session: AsyncSession, provider_id: str, tenant_id: str) -> Provider:
    provider = await session.scalar(
        select(Provider)
        .options(selectinload(Provider.service_links), selectinload(Provider.location_links))
        .where(Provider.id == provider_id, Provider.tenant_id == tenant_id)
        .execution_options(populate_existing=True)
    )
    if provider is None:
        raise api_exception(404, "provider_not_found", "Provider not found.")
    return provider


async def _validate_tenant_user_link(session: AsyncSession, tenant_id: str, user_id: str | None) -> None:
    if not user_id:
        return
    user = await session.scalar(select(User).where(User.id == user_id, User.tenant_id == tenant_id))
    if user is None:
        raise api_exception(400, "invalid_user", "Linked user does not belong to this tenant.")


async def _validate_tenant_locations(session: AsyncSession, tenant_id: str, location_ids: list[str]) -> None:
    if not location_ids:
        return
    found = (
        await session.scalars(
            select(Location.id).where(Location.tenant_id == tenant_id, Location.id.in_(location_ids))
        )
    ).all()
    if set(found) != set(location_ids):
        raise api_exception(400, "invalid_locations", "One or more locations are invalid for this tenant.")


async def _validate_tenant_services(session: AsyncSession, tenant_id: str, service_ids: list[str]) -> None:
    if not service_ids:
        return
    found = (
        await session.scalars(
            select(Service.id).where(Service.tenant_id == tenant_id, Service.id.in_(service_ids))
        )
    ).all()
    if set(found) != set(service_ids):
        raise api_exception(400, "invalid_services", "One or more services are invalid for this tenant.")


async def list_tenant_providers_admin(
    session: AsyncSession, tenant_slug: str
) -> ProviderListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    providers = (
        await session.scalars(
            select(Provider)
            .options(
                selectinload(Provider.service_links),
                selectinload(Provider.location_links),
            )
            .where(Provider.tenant_id == tenant.id)
            .order_by(Provider.created_at.asc())
        )
    ).all()
    return ProviderListResponse(providers=[provider_to_summary(p, tenant) for p in providers])


async def create_tenant_provider(
    session: AsyncSession, tenant_slug: str, payload: CreateProviderRequest
) -> ProviderSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    await _validate_tenant_user_link(session, tenant.id, payload.user_id)
    await _validate_tenant_locations(session, tenant.id, payload.location_ids)
    await _validate_tenant_services(session, tenant.id, payload.service_ids)

    provider = Provider(
        tenant_id=tenant.id,
        user_id=payload.user_id,
        name=payload.name.strip(),
        email=payload.email,
        is_active=True,
        is_bookable_online=payload.is_bookable_online,
    )
    session.add(provider)
    await session.flush()
    for location_id in payload.location_ids:
        session.add(ProviderLocation(tenant_id=tenant.id, provider_id=provider.id, location_id=location_id))
    for service_id in payload.service_ids:
        session.add(ProviderService(tenant_id=tenant.id, provider_id=provider.id, service_id=service_id))
    await session.commit()
    provider = await _load_provider_with_links(session, provider.id, tenant.id)
    return provider_to_summary(provider, tenant)


async def update_tenant_provider(
    session: AsyncSession, tenant_slug: str, provider_id: str, payload: UpdateProviderRequest
) -> ProviderSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    provider = await _load_provider_with_links(session, provider_id, tenant.id)

    if payload.user_id is not None:
        await _validate_tenant_user_link(session, tenant.id, payload.user_id or None)
        provider.user_id = payload.user_id or None
    if payload.name is not None:
        provider.name = payload.name.strip()
    if payload.email is not None:
        provider.email = payload.email or None
    if payload.is_active is not None:
        provider.is_active = payload.is_active
    if payload.is_bookable_online is not None:
        provider.is_bookable_online = payload.is_bookable_online

    if payload.location_ids is not None:
        await _validate_tenant_locations(session, tenant.id, payload.location_ids)
        existing = {link.location_id: link for link in provider.location_links}
        wanted = set(payload.location_ids)
        for loc_id, link in list(existing.items()):
            if loc_id not in wanted:
                await session.delete(link)
        for loc_id in wanted - set(existing.keys()):
            session.add(ProviderLocation(tenant_id=tenant.id, provider_id=provider.id, location_id=loc_id))

    if payload.service_ids is not None:
        await _validate_tenant_services(session, tenant.id, payload.service_ids)
        existing = {link.service_id: link for link in provider.service_links}
        wanted = set(payload.service_ids)
        for svc_id, link in list(existing.items()):
            if svc_id not in wanted:
                await session.delete(link)
        for svc_id in wanted - set(existing.keys()):
            session.add(ProviderService(tenant_id=tenant.id, provider_id=provider.id, service_id=svc_id))

    await session.commit()
    provider = await _load_provider_with_links(session, provider.id, tenant.id)
    return provider_to_summary(provider, tenant)


async def deactivate_tenant_provider(
    session: AsyncSession, tenant_slug: str, provider_id: str
) -> ProviderSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    provider = await _load_provider_with_links(session, provider_id, tenant.id)
    provider.is_active = False
    await session.commit()
    provider = await _load_provider_with_links(session, provider.id, tenant.id)
    return provider_to_summary(provider, tenant)


async def create_tenant_staff(
    session: AsyncSession, tenant_slug: str, payload: CreateStaffRequest
) -> CreateStaffResponse:
    """Create a user and (optionally) a linked provider in a single transaction."""
    tenant = await get_tenant_by_slug(session, tenant_slug)

    existing = (
        await session.scalars(select(User).where(func.lower(User.email) == payload.email.lower()))
    ).one_or_none()
    if existing is not None:
        raise api_exception(409, "email_already_registered", "A user with that email already exists.")

    if payload.provider is not None:
        await _validate_tenant_locations(session, tenant.id, payload.provider.location_ids)
        await _validate_tenant_services(session, tenant.id, payload.provider.service_ids)

    user = User(
        tenant_id=tenant.id,
        email=payload.email,
        name=payload.name.strip(),
        role=payload.role,
        password_hash=hash_password(payload.initial_password),
        is_active=True,
        phone=payload.phone,
        avatar_url=payload.avatar_url,
    )
    session.add(user)
    await session.flush()

    provider_summary: ProviderSummaryResponse | None = None
    if payload.provider is not None:
        provider = Provider(
            tenant_id=tenant.id,
            user_id=user.id,
            name=payload.name.strip(),
            email=payload.email,
            is_active=True,
            is_bookable_online=payload.provider.is_bookable_online,
        )
        session.add(provider)
        await session.flush()
        for location_id in payload.provider.location_ids:
            session.add(ProviderLocation(tenant_id=tenant.id, provider_id=provider.id, location_id=location_id))
        for service_id in payload.provider.service_ids:
            session.add(ProviderService(tenant_id=tenant.id, provider_id=provider.id, service_id=service_id))
        await session.commit()
        provider = await _load_provider_with_links(session, provider.id, tenant.id)
        provider_summary = provider_to_summary(provider, tenant)
    else:
        await session.commit()

    await session.refresh(user)
    return CreateStaffResponse(user=_user_to_summary(user), provider=provider_summary)



# === Phase C: Provider weekly schedule ===

from datetime import time as _time

from app.schemas.catalog import (
    ProviderScheduleEntryResponse,
    ProviderScheduleResponse,
    ReplaceProviderScheduleRequest,
)


def _format_time(value: _time) -> str:
    return f"{value.hour:02d}:{value.minute:02d}"


def _parse_time(value: str) -> _time:
    hour, minute = value.split(":")
    return _time(hour=int(hour), minute=int(minute))


async def _load_provider_schedule(
    session: AsyncSession, provider_id: str, tenant_id: str
) -> list[ProviderSchedule]:
    rows = await session.scalars(
        select(ProviderSchedule)
        .where(
            ProviderSchedule.provider_id == provider_id,
            ProviderSchedule.tenant_id == tenant_id,
        )
        .order_by(ProviderSchedule.weekday, ProviderSchedule.start_time)
    )
    return list(rows.all())


def _schedule_to_response(provider_id: str, rows: list[ProviderSchedule]) -> ProviderScheduleResponse:
    return ProviderScheduleResponse(
        provider_id=provider_id,
        entries=[
            ProviderScheduleEntryResponse(
                weekday=row.weekday,
                location_id=row.location_id,
                start_time=_format_time(row.start_time),
                end_time=_format_time(row.end_time),
            )
            for row in rows
        ],
    )


async def get_tenant_provider_schedule(
    session: AsyncSession, tenant_slug: str, provider_id: str
) -> ProviderScheduleResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    provider = await _load_provider_with_links(session, provider_id, tenant.id)
    rows = await _load_provider_schedule(session, provider.id, tenant.id)
    return _schedule_to_response(provider.id, rows)


async def replace_tenant_provider_schedule(
    session: AsyncSession,
    tenant_slug: str,
    provider_id: str,
    payload: ReplaceProviderScheduleRequest,
) -> ProviderScheduleResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    provider = await _load_provider_with_links(session, provider_id, tenant.id)

    # Validate each entry's location is one of the tenant's locations AND linked
    # to this provider. Use a single round-trip to fetch valid tenant location ids.
    if payload.entries:
        tenant_location_ids = set(
            (await session.scalars(
                select(Location.id).where(Location.tenant_id == tenant.id)
            )).all()
        )
        provider_location_ids = {link.location_id for link in provider.location_links}
        for entry in payload.entries:
            if entry.location_id not in tenant_location_ids:
                raise api_exception(
                    422,
                    "invalid_location",
                    f"Location {entry.location_id} does not belong to this tenant.",
                )
            if entry.location_id not in provider_location_ids:
                raise api_exception(
                    422,
                    "invalid_location",
                    "Provider is not assigned to that location. Add the location on the Services tab first.",
                )

    # Replace semantics: delete existing rows, insert new set, all in one txn.
    existing = await _load_provider_schedule(session, provider.id, tenant.id)
    for row in existing:
        await session.delete(row)
    await session.flush()
    for entry in payload.entries:
        session.add(
            ProviderSchedule(
                tenant_id=tenant.id,
                provider_id=provider.id,
                location_id=entry.location_id,
                weekday=entry.weekday,
                start_time=_parse_time(entry.start_time),
                end_time=_parse_time(entry.end_time),
            )
        )
    await session.commit()

    rows = await _load_provider_schedule(session, provider.id, tenant.id)
    return _schedule_to_response(provider.id, rows)


# ---------------------------------------------------------------------------
# Phase D: Provider time off
# ---------------------------------------------------------------------------

from app.schemas.catalog import (  # noqa: E402
    CreateProviderTimeOffRequest,
    ProviderTimeOffListResponse,
    ProviderTimeOffResponse,
)


def _time_off_to_response(row: ProviderTimeOff) -> ProviderTimeOffResponse:
    return ProviderTimeOffResponse(
        id=row.id,
        provider_id=row.provider_id,
        starts_at=row.starts_at,
        ends_at=row.ends_at,
        reason=row.reason,
    )


async def list_tenant_provider_time_off(
    session: AsyncSession, tenant_slug: str, provider_id: str
) -> ProviderTimeOffListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    provider = await _load_provider_with_links(session, provider_id, tenant.id)
    rows = (
        await session.scalars(
            select(ProviderTimeOff)
            .where(
                ProviderTimeOff.tenant_id == tenant.id,
                ProviderTimeOff.provider_id == provider.id,
            )
            .order_by(ProviderTimeOff.starts_at.asc())
        )
    ).all()
    return ProviderTimeOffListResponse(items=[_time_off_to_response(row) for row in rows])


async def create_tenant_provider_time_off(
    session: AsyncSession,
    tenant_slug: str,
    provider_id: str,
    payload: CreateProviderTimeOffRequest,
) -> ProviderTimeOffResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    provider = await _load_provider_with_links(session, provider_id, tenant.id)
    row = ProviderTimeOff(
        tenant_id=tenant.id,
        provider_id=provider.id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        reason=payload.reason,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _time_off_to_response(row)


async def delete_tenant_provider_time_off(
    session: AsyncSession,
    tenant_slug: str,
    provider_id: str,
    time_off_id: str,
) -> None:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    provider = await _load_provider_with_links(session, provider_id, tenant.id)
    row = await session.scalar(
        select(ProviderTimeOff).where(
            ProviderTimeOff.id == time_off_id,
            ProviderTimeOff.tenant_id == tenant.id,
            ProviderTimeOff.provider_id == provider.id,
        )
    )
    if row is None:
        raise api_exception(404, "not_found", "Time off entry was not found.")
    await session.delete(row)
    await session.commit()


# ---------------------------------------------------------------------------
# Per-user permission overrides (Phase E)
# ---------------------------------------------------------------------------


async def get_tenant_user_permissions(
    session: AsyncSession,
    tenant_slug: str,
    user_id: str,
):
    from app.schemas.auth import (
        PermissionGrantResponse,
        UserPermissionOverrideEntry,
        UserPermissionsResponse,
    )
    from app.services.auth import (
        ALL_PERMISSION_KEYS,
        ROLE_PERMISSION_ALLOWLIST,
        _apply_overrides,
    )

    tenant = await get_tenant_by_slug(session, tenant_slug)
    user = await _get_tenant_user(session, tenant.id, user_id)

    override_rows = (
        await session.scalars(
            select(UserPermissionOverride)
            .where(UserPermissionOverride.user_id == user.id)
            .order_by(UserPermissionOverride.permission_key.asc())
        )
    ).all()
    overrides_map = {row.permission_key: row.allowed for row in override_rows}

    if user.role == "owner":
        effective = [
            PermissionGrantResponse(key=key, allowed=True) for key in ALL_PERMISSION_KEYS
        ]
    else:
        effective = _apply_overrides(user.role, overrides_map)

    role_defaults = sorted(ROLE_PERMISSION_ALLOWLIST.get(user.role, set()))

    return UserPermissionsResponse(
        user_id=user.id,
        role=user.role,
        role_defaults=role_defaults,
        overrides=[
            UserPermissionOverrideEntry(key=row.permission_key, allowed=row.allowed)
            for row in override_rows
        ],
        effective=effective,
    )


async def replace_tenant_user_permissions(
    session: AsyncSession,
    tenant_slug: str,
    user_id: str,
    payload,
):
    from app.services.auth import ALL_PERMISSION_KEYS

    tenant = await get_tenant_by_slug(session, tenant_slug)
    user = await _get_tenant_user(session, tenant.id, user_id)

    if user.role == "owner":
        raise api_exception(
            status_code=409,
            code="owner_permissions_locked",
            message="Owner permissions cannot be customized.",
        )

    valid_keys = set(ALL_PERMISSION_KEYS)
    seen: set[str] = set()
    cleaned: list[tuple[str, bool]] = []
    for entry in payload.overrides:
        key = entry.key.strip()
        if key not in valid_keys:
            raise api_exception(
                status_code=422,
                code="invalid_permission_key",
                message=f"Unknown permission key: {entry.key}",
            )
        if key in seen:
            raise api_exception(
                status_code=422,
                code="duplicate_permission_override",
                message=f"Duplicate override for permission: {key}",
            )
        seen.add(key)
        cleaned.append((key, bool(entry.allowed)))

    existing = (
        await session.scalars(
            select(UserPermissionOverride).where(UserPermissionOverride.user_id == user.id)
        )
    ).all()
    for row in existing:
        await session.delete(row)
    await session.flush()

    for key, allowed in cleaned:
        session.add(
            UserPermissionOverride(
                tenant_id=tenant.id,
                user_id=user.id,
                permission_key=key,
                allowed=allowed,
            )
        )
    await session.commit()
    return await get_tenant_user_permissions(session, tenant_slug, user_id)


# ---------------------------------------------------------------------------
# Phase G: Service categories, reorder, duplicate, per-provider variants,
# service update
# ---------------------------------------------------------------------------


async def _load_service_for_tenant(session: AsyncSession, tenant_id: str, service_id: str) -> Service:
    service = (
        await session.scalars(
            select(Service)
            .options(selectinload(Service.location_links), selectinload(Service.provider_links))
            .where(Service.id == service_id, Service.tenant_id == tenant_id)
        )
    ).one_or_none()
    if service is None:
        raise api_exception(status_code=404, code="service_not_found", message="Service not found.")
    return service


async def _load_category_for_tenant(
    session: AsyncSession, tenant_id: str, category_id: str
) -> ServiceCategory:
    category = (
        await session.scalars(
            select(ServiceCategory).where(
                ServiceCategory.id == category_id, ServiceCategory.tenant_id == tenant_id
            )
        )
    ).one_or_none()
    if category is None:
        raise api_exception(
            status_code=404, code="service_category_not_found", message="Service category not found."
        )
    return category


def _category_to_summary(category: ServiceCategory):
    from app.schemas.catalog import (
        CategoryFaqItem,
        ServiceCategorySummaryResponse,
        SocialProof,
        ValueStackItem,
    )

    return ServiceCategorySummaryResponse(
        id=category.id,
        tenant_id=category.tenant_id,
        created_at=category.created_at,
        updated_at=category.updated_at,
        name=category.name,
        sort_order=category.sort_order,
        is_active=category.is_active,
        slug=category.slug,
        outcome_headline=category.outcome_headline,
        subheadline=category.subheadline,
        hero_image_url=category.hero_image_url,
        hero_image_alt=category.hero_image_alt,
        value_stack=[ValueStackItem(**item) for item in (category.value_stack or [])],
        bonuses=[ValueStackItem(**item) for item in (category.bonuses or [])],
        guarantee_text=category.guarantee_text,
        social_proof=SocialProof(**category.social_proof) if category.social_proof else None,
        scarcity_hint=category.scarcity_hint,
        featured_label=category.featured_label,
        meta_description=category.meta_description,
        faqs=[CategoryFaqItem(**item) for item in (category.faqs or [])],
    )


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(value: str) -> str:
    base = _SLUG_RE.sub("-", value.lower()).strip("-")
    return base[:120] or "category"


def _slugify_service(value: str) -> str:
    base = _SLUG_RE.sub("-", value.lower()).strip("-")
    return base[:120] or "service"


async def _ensure_unique_category_slug(
    session: AsyncSession,
    tenant_id: str,
    desired: str | None,
    fallback_name: str,
    exclude_id: str | None = None,
) -> str:
    candidate = _slugify(desired) if (desired and desired.strip()) else _slugify(fallback_name)
    base = candidate
    suffix = 2
    while True:
        existing = await session.scalar(
            select(ServiceCategory.id).where(
                ServiceCategory.tenant_id == tenant_id,
                ServiceCategory.slug == candidate,
                ServiceCategory.id != (exclude_id or ""),
            )
        )
        if existing is None:
            return candidate
        candidate = f"{base}-{suffix}"
        suffix += 1


async def _ensure_unique_service_slug(
    session: AsyncSession,
    tenant_id: str,
    desired: str | None,
    fallback_name: str,
    exclude_id: str | None = None,
) -> str:
    candidate = (
        _slugify_service(desired)
        if (desired and desired.strip())
        else _slugify_service(fallback_name)
    )
    base = candidate
    suffix = 2
    while True:
        existing = await session.scalar(
            select(Service.id).where(
                Service.tenant_id == tenant_id,
                Service.slug == candidate,
                Service.id != (exclude_id or ""),
            )
        )
        if existing is None:
            return candidate
        candidate = f"{base}-{suffix}"
        suffix += 1


async def list_tenant_service_categories(session: AsyncSession, tenant_slug: str):
    from app.schemas.catalog import ServiceCategoryListResponse

    tenant = await get_tenant_by_slug(session, tenant_slug)
    categories = (
        await session.scalars(
            select(ServiceCategory)
            .where(ServiceCategory.tenant_id == tenant.id)
            .order_by(ServiceCategory.sort_order.asc(), ServiceCategory.created_at.asc())
        )
    ).all()
    return ServiceCategoryListResponse(categories=[_category_to_summary(c) for c in categories])


async def get_public_category_by_slug(
    session: AsyncSession, tenant_slug: str, category_slug: str
):
    from app.schemas.catalog import PublicCategoryResponse

    tenant = await get_tenant_by_slug(session, tenant_slug)
    normalized = category_slug.strip().lower()
    category = (
        await session.scalars(
            select(ServiceCategory).where(
                ServiceCategory.tenant_id == tenant.id,
                func.lower(ServiceCategory.slug) == normalized,
            )
        )
    ).one_or_none()
    if category is None:
        raise api_exception(
            status_code=404,
            code="service_category_not_found",
            message="Category not found.",
        )
    if not category.is_active:
        raise api_exception(
            status_code=404,
            code="service_category_not_active",
            message="Category is not currently available.",
        )
    services = (
        await session.scalars(
            select(Service)
            .options(selectinload(Service.location_links))
            .where(
                Service.tenant_id == tenant.id,
                Service.category_id == category.id,
                Service.is_active.is_(True),
            )
            .order_by(Service.sort_order.asc(), Service.created_at.asc())
        )
    ).all()
    return PublicCategoryResponse(
        category=_category_to_summary(category),
        services=[service_to_summary(service, tenant) for service in services],
    )


async def get_public_service_by_slug(
    session: AsyncSession, tenant_slug: str, service_slug: str
):
    from app.schemas.catalog import PublicServiceResponse

    tenant = await get_tenant_by_slug(session, tenant_slug)
    normalized = service_slug.strip().lower()
    service = (
        await session.scalars(
            select(Service)
            .options(selectinload(Service.location_links))
            .where(
                Service.tenant_id == tenant.id,
                func.lower(Service.slug) == normalized,
            )
        )
    ).one_or_none()
    if service is None:
        raise api_exception(
            status_code=404,
            code="service_not_found",
            message="Service not found.",
        )
    if not service.is_active:
        raise api_exception(
            status_code=404,
            code="service_not_active",
            message="Service is not currently available.",
        )
    category = None
    if service.category_id:
        category_row = await session.get(ServiceCategory, service.category_id)
        if category_row is not None and category_row.tenant_id == tenant.id:
            category = _category_to_summary(category_row)
    return PublicServiceResponse(
        service=service_to_summary(service, tenant),
        category=category,
    )


async def create_tenant_service_category(session: AsyncSession, tenant_slug: str, payload):
    tenant = await get_tenant_by_slug(session, tenant_slug)
    name = payload.name.strip()
    existing = await session.scalar(
        select(ServiceCategory.id).where(
            ServiceCategory.tenant_id == tenant.id,
            func.lower(ServiceCategory.name) == name.lower(),
        )
    )
    if existing is not None:
        raise api_exception(
            status_code=409, code="conflict", message="A service category with that name already exists."
        )
    max_sort = (
        await session.scalar(
            select(func.max(ServiceCategory.sort_order)).where(ServiceCategory.tenant_id == tenant.id)
        )
    )
    slug = await _ensure_unique_category_slug(
        session, tenant.id, getattr(payload, "slug", None), name
    )
    category = ServiceCategory(
        tenant_id=tenant.id,
        name=name,
        sort_order=(int(max_sort) + 1) if max_sort is not None else 0,
        is_active=True,
        slug=slug,
    )
    session.add(category)
    await session.commit()
    await session.refresh(category)
    return _category_to_summary(category)


async def update_tenant_service_category(
    session: AsyncSession, tenant_slug: str, category_id: str, payload
):
    tenant = await get_tenant_by_slug(session, tenant_slug)
    category = await _load_category_for_tenant(session, tenant.id, category_id)
    if payload.name is not None:
        new_name = payload.name.strip()
        if new_name.lower() != category.name.lower():
            duplicate = await session.scalar(
                select(ServiceCategory.id).where(
                    ServiceCategory.tenant_id == tenant.id,
                    func.lower(ServiceCategory.name) == new_name.lower(),
                    ServiceCategory.id != category.id,
                )
            )
            if duplicate is not None:
                raise api_exception(
                    status_code=409,
                    code="conflict",
                    message="A service category with that name already exists.",
                )
        category.name = new_name
    if payload.is_active is not None:
        category.is_active = payload.is_active
    if getattr(payload, "slug", None) is not None and payload.slug.strip():
        category.slug = await _ensure_unique_category_slug(
            session, tenant.id, payload.slug, category.name, exclude_id=category.id
        )
    elif getattr(payload, "clear_slug", False):
        category.slug = await _ensure_unique_category_slug(
            session, tenant.id, None, category.name, exclude_id=category.id
        )
    # Merchandising fields: set when provided, clear when corresponding flag set.
    for field, clear_flag in (
        ("outcome_headline", "clear_outcome_headline"),
        ("subheadline", "clear_subheadline"),
        ("guarantee_text", "clear_guarantee_text"),
        ("scarcity_hint", "clear_scarcity_hint"),
        ("featured_label", "clear_featured_label"),
        ("meta_description", "clear_meta_description"),
    ):
        value = getattr(payload, field, None)
        if value is not None:
            stripped = value.strip()
            setattr(category, field, stripped or None)
        elif getattr(payload, clear_flag, False):
            setattr(category, field, None)
    if getattr(payload, "clear_hero_image", False):
        category.hero_image_url = None
        category.hero_image_alt = None
    else:
        if payload.hero_image_url is not None:
            category.hero_image_url = payload.hero_image_url.strip() or None
        if payload.hero_image_alt is not None:
            category.hero_image_alt = payload.hero_image_alt.strip() or None
    if payload.value_stack is not None:
        category.value_stack = [item.model_dump(by_alias=False) for item in payload.value_stack] or None
    if payload.bonuses is not None:
        category.bonuses = [item.model_dump(by_alias=False) for item in payload.bonuses] or None
    if getattr(payload, "clear_social_proof", False):
        category.social_proof = None
    elif payload.social_proof is not None:
        category.social_proof = payload.social_proof.model_dump(by_alias=False)
    if payload.faqs is not None:
        category.faqs = [item.model_dump(by_alias=False) for item in payload.faqs] or None
    await session.commit()
    await session.refresh(category)
    return _category_to_summary(category)


async def delete_tenant_service_category(
    session: AsyncSession, tenant_slug: str, category_id: str
) -> None:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    category = await _load_category_for_tenant(session, tenant.id, category_id)
    # Detach services rather than cascade delete
    services = (
        await session.scalars(
            select(Service).where(Service.tenant_id == tenant.id, Service.category_id == category.id)
        )
    ).all()
    for service in services:
        service.category_id = None
    await session.delete(category)
    await session.commit()


async def reorder_tenant_service_categories(session: AsyncSession, tenant_slug: str, payload):
    from app.schemas.catalog import ServiceCategoryListResponse

    tenant = await get_tenant_by_slug(session, tenant_slug)
    categories = (
        await session.scalars(
            select(ServiceCategory).where(ServiceCategory.tenant_id == tenant.id)
        )
    ).all()
    by_id = {c.id: c for c in categories}
    seen: set[str] = set()
    for index, category_id in enumerate(payload.ordered_ids):
        if category_id in seen:
            raise api_exception(
                status_code=422,
                code="duplicate_id",
                message=f"Duplicate category id in reorder payload: {category_id}",
            )
        seen.add(category_id)
        category = by_id.get(category_id)
        if category is None:
            raise api_exception(
                status_code=404,
                code="service_category_not_found",
                message=f"Category not found: {category_id}",
            )
        category.sort_order = index
    await session.commit()
    return await list_tenant_service_categories(session, tenant_slug)


async def reorder_tenant_services(session: AsyncSession, tenant_slug: str, payload):
    tenant = await get_tenant_by_slug(session, tenant_slug)
    services = (
        await session.scalars(
            select(Service)
            .options(selectinload(Service.location_links))
            .where(Service.tenant_id == tenant.id)
        )
    ).all()
    by_id = {s.id: s for s in services}
    seen: set[str] = set()
    for index, service_id in enumerate(payload.ordered_ids):
        if service_id in seen:
            raise api_exception(
                status_code=422,
                code="duplicate_id",
                message=f"Duplicate service id in reorder payload: {service_id}",
            )
        seen.add(service_id)
        service = by_id.get(service_id)
        if service is None:
            raise api_exception(
                status_code=404,
                code="service_not_found",
                message=f"Service not found: {service_id}",
            )
        service.sort_order = index
    await session.commit()
    return await list_tenant_services(session, tenant_slug)


async def update_tenant_service(
    session: AsyncSession, tenant_slug: str, service_id: str, payload
):
    tenant = await get_tenant_by_slug(session, tenant_slug)
    service = await _load_service_for_tenant(session, tenant.id, service_id)

    if payload.name is not None:
        new_name = payload.name.strip()
        if new_name.lower() != service.name.lower():
            existing_id = await session.scalar(
                select(Service.id).where(
                    Service.tenant_id == tenant.id,
                    func.lower(Service.name) == new_name.lower(),
                    Service.id != service.id,
                )
            )
            if existing_id is not None:
                raise api_exception(
                    status_code=409,
                    code="conflict",
                    message="A service with this name already exists for the tenant.",
                )
        service.name = new_name
    if payload.clear_description:
        service.description = None
    elif payload.description is not None:
        cleaned = payload.description.strip()
        service.description = cleaned if cleaned else None
    if payload.duration_minutes is not None:
        service.duration_minutes = payload.duration_minutes
    if payload.setup_buffer_minutes is not None:
        service.setup_buffer_minutes = payload.setup_buffer_minutes
    if payload.cleanup_buffer_minutes is not None:
        service.cleanup_buffer_minutes = payload.cleanup_buffer_minutes
    if payload.price_cents is not None:
        service.price_cents = payload.price_cents
    if payload.deposit_cents is not None:
        service.deposit_cents = payload.deposit_cents
    if service.deposit_cents > service.price_cents:
        raise api_exception(
            status_code=422,
            code="invalid_deposit",
            message="Deposit cannot exceed the service price.",
        )
    if payload.is_active is not None:
        service.is_active = payload.is_active
    if payload.clear_category:
        service.category_id = None
    elif payload.category_id is not None:
        category = await _load_category_for_tenant(session, tenant.id, payload.category_id)
        service.category_id = category.id

    if payload.location_ids is not None:
        requested = list(dict.fromkeys(payload.location_ids))
        if requested:
            located = (
                await session.scalars(
                    select(Location).where(
                        Location.tenant_id == tenant.id,
                        Location.id.in_(requested),
                    )
                )
            ).all()
            found = {loc.id for loc in located}
            missing = [lid for lid in requested if lid not in found]
            if missing:
                raise api_exception(
                    status_code=404,
                    code="not_found",
                    message="One or more locations were not found for this tenant.",
                )
        for link in list(service.location_links):
            await session.delete(link)
        await session.flush()
        service.location_links = [
            ServiceLocation(tenant_id=tenant.id, location_id=lid) for lid in requested
        ]

    # Phase J: merchandising fields
    if getattr(payload, "slug", None) is not None and payload.slug.strip():
        service.slug = await _ensure_unique_service_slug(
            session, tenant.id, payload.slug, service.name, exclude_id=service.id
        )
    elif getattr(payload, "clear_slug", False):
        service.slug = await _ensure_unique_service_slug(
            session, tenant.id, None, service.name, exclude_id=service.id
        )
    for field, clear_flag in (
        ("outcome_headline", "clear_outcome_headline"),
        ("subheadline", "clear_subheadline"),
        ("guarantee_text", "clear_guarantee_text"),
        ("scarcity_hint", "clear_scarcity_hint"),
        ("featured_label", "clear_featured_label"),
        ("meta_description", "clear_meta_description"),
    ):
        value = getattr(payload, field, None)
        if value is not None:
            stripped = value.strip()
            setattr(service, field, stripped or None)
        elif getattr(payload, clear_flag, False):
            setattr(service, field, None)
    if getattr(payload, "compare_at_price_cents", None) is not None:
        service.compare_at_price_cents = payload.compare_at_price_cents
    elif getattr(payload, "clear_compare_at_price", False):
        service.compare_at_price_cents = None
    if getattr(payload, "clear_image", False):
        service.image_url = None
        service.image_alt_text = None
    else:
        if getattr(payload, "image_url", None) is not None:
            value = payload.image_url.strip()
            service.image_url = value or None
        if getattr(payload, "image_alt_text", None) is not None:
            value = payload.image_alt_text.strip()
            service.image_alt_text = value or None
    if getattr(payload, "clear_before_image", False):
        service.before_image_url = None
        service.before_image_alt = None
    else:
        if getattr(payload, "before_image_url", None) is not None:
            value = payload.before_image_url.strip()
            service.before_image_url = value or None
        if getattr(payload, "before_image_alt", None) is not None:
            value = payload.before_image_alt.strip()
            service.before_image_alt = value or None
    if getattr(payload, "clear_after_image", False):
        service.after_image_url = None
        service.after_image_alt = None
    else:
        if getattr(payload, "after_image_url", None) is not None:
            value = payload.after_image_url.strip()
            service.after_image_url = value or None
        if getattr(payload, "after_image_alt", None) is not None:
            value = payload.after_image_alt.strip()
            service.after_image_alt = value or None
    if getattr(payload, "value_stack", None) is not None:
        service.value_stack = [
            item.model_dump(by_alias=False) for item in payload.value_stack
        ]
    if getattr(payload, "bonuses", None) is not None:
        service.bonuses = [
            item.model_dump(by_alias=False) for item in payload.bonuses
        ]
    if getattr(payload, "clear_social_proof", False):
        service.social_proof = None
    elif getattr(payload, "social_proof", None) is not None:
        service.social_proof = payload.social_proof.model_dump(by_alias=False)

    await session.commit()
    service = await _load_service_for_tenant(session, tenant.id, service.id)
    return service_to_summary(service, tenant)


async def duplicate_tenant_service(session: AsyncSession, tenant_slug: str, service_id: str):
    tenant = await get_tenant_by_slug(session, tenant_slug)
    source = await _load_service_for_tenant(session, tenant.id, service_id)

    base = f"{source.name} (Copy)"
    candidate = base
    suffix = 2
    while True:
        existing = await session.scalar(
            select(Service.id).where(
                Service.tenant_id == tenant.id,
                func.lower(Service.name) == candidate.lower(),
            )
        )
        if existing is None:
            break
        candidate = f"{base} {suffix}"
        suffix += 1

    max_sort = await session.scalar(
        select(func.max(Service.sort_order)).where(Service.tenant_id == tenant.id)
    )
    duplicate = Service(
        tenant_id=tenant.id,
        name=candidate,
        description=source.description,
        duration_minutes=source.duration_minutes,
        setup_buffer_minutes=source.setup_buffer_minutes,
        cleanup_buffer_minutes=source.cleanup_buffer_minutes,
        price_cents=source.price_cents,
        deposit_cents=source.deposit_cents,
        is_active=source.is_active,
        category_id=source.category_id,
        sort_order=(int(max_sort) + 1) if max_sort is not None else 0,
    )
    duplicate.location_links = [
        ServiceLocation(tenant_id=tenant.id, location_id=link.location_id)
        for link in source.location_links
    ]
    session.add(duplicate)
    await session.commit()
    duplicate = await _load_service_for_tenant(session, tenant.id, duplicate.id)
    return service_to_summary(duplicate, tenant)


async def list_tenant_service_provider_variants(
    session: AsyncSession, tenant_slug: str, service_id: str
):
    from app.schemas.catalog import (
        ProviderServiceVariantEntry,
        ProviderServiceVariantListResponse,
    )

    tenant = await get_tenant_by_slug(session, tenant_slug)
    service = await _load_service_for_tenant(session, tenant.id, service_id)
    rows = (
        await session.scalars(
            select(ProviderService)
            .where(ProviderService.service_id == service.id, ProviderService.tenant_id == tenant.id)
            .order_by(ProviderService.created_at.asc())
        )
    ).all()
    return ProviderServiceVariantListResponse(
        service_id=service.id,
        variants=[
            ProviderServiceVariantEntry(
                provider_id=row.provider_id,
                price_cents=row.price_cents_override,
                duration_minutes=row.duration_minutes_override,
                deposit_cents=row.deposit_cents_override,
            )
            for row in rows
        ],
    )


async def replace_tenant_service_provider_variants(
    session: AsyncSession, tenant_slug: str, service_id: str, payload
):
    tenant = await get_tenant_by_slug(session, tenant_slug)
    service = await _load_service_for_tenant(session, tenant.id, service_id)

    # Build by provider for upsert
    rows = (
        await session.scalars(
            select(ProviderService).where(
                ProviderService.service_id == service.id, ProviderService.tenant_id == tenant.id
            )
        )
    ).all()
    by_provider = {row.provider_id: row for row in rows}

    seen: set[str] = set()
    for entry in payload.variants:
        if entry.provider_id in seen:
            raise api_exception(
                status_code=422,
                code="duplicate_provider",
                message=f"Duplicate provider in variants: {entry.provider_id}",
            )
        seen.add(entry.provider_id)

        row = by_provider.get(entry.provider_id)
        if row is None:
            # Verify provider belongs to tenant and is linked to service.
            provider = (
                await session.scalars(
                    select(Provider).where(
                        Provider.id == entry.provider_id, Provider.tenant_id == tenant.id
                    )
                )
            ).one_or_none()
            if provider is None:
                raise api_exception(
                    status_code=404,
                    code="provider_not_found",
                    message=f"Provider not found: {entry.provider_id}",
                )
            row = ProviderService(
                tenant_id=tenant.id,
                provider_id=entry.provider_id,
                service_id=service.id,
            )
            session.add(row)

        if entry.deposit_cents is not None:
            base_price = entry.price_cents if entry.price_cents is not None else service.price_cents
            if entry.deposit_cents > base_price:
                raise api_exception(
                    status_code=422,
                    code="invalid_deposit",
                    message="Variant deposit cannot exceed the effective price.",
                )
        row.price_cents_override = entry.price_cents
        row.duration_minutes_override = entry.duration_minutes
        row.deposit_cents_override = entry.deposit_cents

    # For provider variants not in payload, clear overrides (preserve link).
    for provider_id, row in by_provider.items():
        if provider_id not in seen:
            row.price_cents_override = None
            row.duration_minutes_override = None
            row.deposit_cents_override = None

    await session.commit()
    return await list_tenant_service_provider_variants(session, tenant_slug, service_id)
