from __future__ import annotations

from datetime import datetime

from app.schemas.base import CamelModel


class TenantBrandingResponse(CamelModel):
    logo_url: str | None = None
    homepage_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    service_catalog_mode: str | None = None
    service_categories: list[str] = []


class TenantSettingsResponse(CamelModel):
    cancellation_window_hours: int
    refund_inside_window: bool
    reminder_hours_before: int
    min_lead_time_minutes: int
    max_advance_booking_days: int
    default_deposit_cents: int
    no_show_fee_cents: int
    auto_charge_no_show_fee: bool | None = None


class TenantSummaryResponse(CamelModel):
    id: str
    tenant_id: str
    created_at: datetime
    updated_at: datetime
    slug: str
    name: str
    timezone: str
    default_location_id: str | None = None
    branding: TenantBrandingResponse
    settings: TenantSettingsResponse


class LocationSummaryResponse(CamelModel):
    id: str
    tenant_id: str
    created_at: datetime
    updated_at: datetime
    name: str
    time_zone: str
    is_active: bool
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None


class ServiceSummaryResponse(CamelModel):
    id: str
    tenant_id: str
    created_at: datetime
    updated_at: datetime
    name: str
    description: str | None = None
    duration_minutes: int
    price_cents: int
    deposit_cents: int
    is_active: bool
    location_ids: list[str]
    form_ids: list[str]


class ProviderSummaryResponse(CamelModel):
    id: str
    tenant_id: str
    created_at: datetime
    updated_at: datetime
    user_id: str | None = None
    name: str
    email: str | None = None
    is_active: bool
    service_ids: list[str]
    location_ids: list[str]


class ServiceListResponse(CamelModel):
    services: list[ServiceSummaryResponse]