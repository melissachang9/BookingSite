from __future__ import annotations

from app.db.models import BookingDraft, Customer, Location, Provider, Service, Tenant
from app.schemas.booking_drafts import BookingDraftSummaryResponse, CustomerSummaryResponse
from app.schemas.catalog import (
    LocationSummaryResponse,
    ProviderSummaryResponse,
    ServiceSummaryResponse,
    TenantBrandingResponse,
    TenantSettingsResponse,
    TenantSummaryResponse,
)


def _service_media_for(service: Service, tenant: Tenant | None) -> tuple[str | None, str | None]:
    if tenant is None:
        return None, None

    service_media = tenant.branding_json.get("serviceMedia")
    if not isinstance(service_media, dict):
        return None, None

    media = service_media.get(service.id) or service_media.get(service.name)
    if not isinstance(media, dict):
        return None, None

    image_url = media.get("imageUrl") or media.get("image_url")
    image_alt_text = media.get("imageAltText") or media.get("image_alt_text")
    return image_url if isinstance(image_url, str) else None, image_alt_text if isinstance(image_alt_text, str) else None


def tenant_to_summary(tenant: Tenant) -> TenantSummaryResponse:
    return TenantSummaryResponse(
        id=tenant.id,
        tenant_id=tenant.id,
        created_at=tenant.created_at,
        updated_at=tenant.updated_at,
        slug=tenant.slug,
        name=tenant.name,
        timezone=tenant.timezone,
        default_location_id=tenant.default_location_id,
        branding=TenantBrandingResponse(**tenant.branding_json),
        settings=TenantSettingsResponse(**tenant.settings_json),
    )


def location_to_summary(location: Location) -> LocationSummaryResponse:
    return LocationSummaryResponse(
        id=location.id,
        tenant_id=location.tenant_id,
        created_at=location.created_at,
        updated_at=location.updated_at,
        name=location.name,
        time_zone=location.time_zone,
        is_active=location.is_active,
        address_line1=location.address_line1,
        address_line2=location.address_line2,
        city=location.city,
        state=location.state,
        postal_code=location.postal_code,
    )


def service_to_summary(service: Service, tenant: Tenant | None = None) -> ServiceSummaryResponse:
    image_url, image_alt_text = _service_media_for(service, tenant)
    return ServiceSummaryResponse(
        id=service.id,
        tenant_id=service.tenant_id,
        created_at=service.created_at,
        updated_at=service.updated_at,
        name=service.name,
        description=service.description,
        duration_minutes=service.duration_minutes,
        price_cents=service.price_cents,
        deposit_cents=service.deposit_cents,
        is_active=service.is_active,
        image_url=image_url,
        image_alt_text=image_alt_text,
        location_ids=[link.location_id for link in service.location_links],
        form_ids=[],
    )


def provider_to_summary(provider: Provider) -> ProviderSummaryResponse:
    return ProviderSummaryResponse(
        id=provider.id,
        tenant_id=provider.tenant_id,
        created_at=provider.created_at,
        updated_at=provider.updated_at,
        user_id=provider.user_id,
        name=provider.name,
        email=provider.email,
        is_active=provider.is_active,
        service_ids=[link.service_id for link in provider.service_links],
        location_ids=[link.location_id for link in provider.location_links],
    )


def customer_to_summary(customer: Customer) -> CustomerSummaryResponse:
    return CustomerSummaryResponse(
        id=customer.id,
        tenant_id=customer.tenant_id,
        created_at=customer.created_at,
        updated_at=customer.updated_at,
        name=customer.name,
        email=customer.email,
        phone=customer.phone,
        notes=customer.notes,
        acquired_at=None,
        source_channel=None,
    )


def booking_draft_to_summary(draft: BookingDraft) -> BookingDraftSummaryResponse:
    return BookingDraftSummaryResponse(
        id=draft.id,
        tenant_id=draft.tenant_id,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
        customer_id=draft.customer_id,
        service_id=draft.service_id,
        provider_id=draft.provider_id,
        location_id=draft.location_id,
        status=draft.status,
        booking_method=draft.booking_method,
        starts_at=draft.starts_at,
        ends_at=draft.ends_at,
        expires_at=draft.expires_at,
        price_cents=draft.price_cents,
        deposit_cents=draft.deposit_cents,
        duration_minutes=draft.duration_minutes,
        service=service_to_summary(draft.service),
        provider=provider_to_summary(draft.provider),
        customer=customer_to_summary(draft.customer) if draft.customer is not None else None,
        form_requirements=[],
    )