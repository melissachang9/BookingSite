from __future__ import annotations

from datetime import datetime

from pydantic import Field, model_validator

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
    tax_rate_percent: float = 0
    auto_charge_no_show_fee: bool | None = None
    calendar_display_start_hour: int = 9
    calendar_display_end_hour: int = 19
    country: str = "US"
    currency: str = "USD"
    sms_phone: str | None = None


class UpdateTenantSettingsRequest(CamelModel):
    calendar_display_start_hour: int | None = Field(default=None, ge=0, le=23)
    calendar_display_end_hour: int | None = Field(default=None, ge=1, le=24)


SUPPORTED_CURRENCIES = ("USD", "CAD", "EUR", "GBP", "AUD", "MXN")


class UpdateTenantBusinessRequest(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    homepage_url: str | None = Field(default=None, max_length=255)
    country: str | None = Field(default=None, min_length=2, max_length=3, pattern=r"^[A-Za-z]{2,3}$")
    currency: str | None = Field(default=None, min_length=3, max_length=3, pattern=r"^[A-Za-z]{3}$")
    sms_phone: str | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def _validate(self) -> "UpdateTenantBusinessRequest":
        if self.currency is not None and self.currency.upper() not in SUPPORTED_CURRENCIES:
            raise ValueError(
                f"Unsupported currency. Supported: {', '.join(SUPPORTED_CURRENCIES)}."
            )
        if self.sms_phone is not None and self.sms_phone.strip():
            stripped = self.sms_phone.strip()
            digits = sum(ch.isdigit() for ch in stripped)
            if digits < 7 or any(ch not in "+0123456789-() .x" for ch in stripped):
                raise ValueError("smsPhone must contain at least 7 digits and only standard phone characters.")
        return self


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


class CreateTenantRequest(CamelModel):
    name: str = Field(min_length=1, max_length=255)
    slug: str = Field(min_length=3, max_length=255, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    timezone: str = Field(min_length=3, max_length=100)
    location_name: str = Field(min_length=1, max_length=255)
    owner_name: str = Field(min_length=1, max_length=255)
    owner_email: str = Field(min_length=5, max_length=255)
    owner_password: str = Field(min_length=8, max_length=128)
    homepage_url: str | None = Field(default=None, max_length=255)
    primary_color: str | None = Field(default=None, max_length=32)
    accent_color: str | None = Field(default=None, max_length=32)


class CreateTenantResponse(CamelModel):
    tenant: TenantSummaryResponse
    owner_email: str
    location_id: str


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


class CreateServiceRequest(CamelModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    duration_minutes: int = Field(ge=15, le=480)
    price_cents: int = Field(ge=0, le=500_000)
    deposit_cents: int = Field(ge=0, le=500_000)
    location_ids: list[str] = Field(min_length=1)
    is_active: bool = True

    @model_validator(mode="after")
    def validate_deposit(self) -> "CreateServiceRequest":
        if self.deposit_cents > self.price_cents:
            raise ValueError("Deposit cannot exceed the service price.")
        return self


class ProviderSummaryResponse(CamelModel):
    id: str
    tenant_id: str
    created_at: datetime
    updated_at: datetime
    user_id: str | None = None
    name: str
    email: str | None = None
    description: str | None = None
    image_url: str | None = None
    image_alt_text: str | None = None
    availability_label: str | None = None
    is_active: bool
    service_ids: list[str]
    location_ids: list[str]


class ServiceListResponse(CamelModel):
    services: list[ServiceSummaryResponse]


class ProviderListResponse(CamelModel):
    providers: list[ProviderSummaryResponse]


class LocationListResponse(CamelModel):
    locations: list[LocationSummaryResponse]