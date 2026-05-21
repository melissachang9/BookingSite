from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.schemas.base import CamelModel


class BookingScreeningOptionResponse(CamelModel):
    id: str
    label: str
    description: str | None = None


class BookingScreeningResponse(CamelModel):
    enabled: bool = False
    title: str = "How can we help?"
    options: list[BookingScreeningOptionResponse] = Field(default_factory=list)


class BookingAdResponse(CamelModel):
    headline: str | None = None
    body: str | None = None
    image_url: str | None = None
    image_alt_text: str | None = None


class TenantBrandingResponse(CamelModel):
    logo_url: str | None = None
    homepage_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    service_catalog_mode: str | None = None
    service_categories: list[str] = Field(default_factory=list)
    booking_screening: BookingScreeningResponse | None = None
    booking_ad: BookingAdResponse | None = None


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
    image_url: str | None = None
    image_alt_text: str | None = None
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


class ProviderListResponse(CamelModel):
    providers: list[ProviderSummaryResponse]


class LocationListResponse(CamelModel):
    locations: list[LocationSummaryResponse]