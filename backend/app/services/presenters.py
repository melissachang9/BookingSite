from __future__ import annotations

from app.db.models import BookingDraft, Customer, Provider, Service, Tenant
from app.schemas.booking_drafts import BookingDraftSummaryResponse, CustomerSummaryResponse
from app.schemas.catalog import (
    ProviderSummaryResponse,
    ServiceSummaryResponse,
    TenantBrandingResponse,
    TenantSettingsResponse,
    TenantSummaryResponse,
)


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


def service_to_summary(service: Service) -> ServiceSummaryResponse:
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