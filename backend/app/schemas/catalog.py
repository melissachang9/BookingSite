from __future__ import annotations

import re
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
    favicon_url: str | None = None
    homepage_url: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    photos: list[str] = Field(default_factory=list)
    service_catalog_mode: str | None = None
    service_categories: list[str] = Field(default_factory=list)
    booking_screening: BookingScreeningResponse | None = None
    booking_ad: BookingAdResponse | None = None


_HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


class UpdateTenantBrandingRequest(CamelModel):
    logo_url: str | None = Field(default=None, max_length=2048)
    favicon_url: str | None = Field(default=None, max_length=2048)
    primary_color: str | None = Field(default=None, max_length=16)
    accent_color: str | None = Field(default=None, max_length=16)
    photos: list[str] | None = Field(default=None, max_length=24)

    @model_validator(mode="after")
    def _validate(self) -> "UpdateTenantBrandingRequest":
        for field_name, value in (("primary_color", self.primary_color), ("accent_color", self.accent_color)):
            if value is not None and value.strip() and not _HEX_COLOR_RE.match(value.strip()):
                raise ValueError(f"{field_name} must be a #RGB or #RRGGBB hex color.")
        if self.photos is not None:
            for url in self.photos:
                if not isinstance(url, str) or not url.strip():
                    raise ValueError("photos entries must be non-empty URLs.")
                if len(url) > 2048:
                    raise ValueError("photos entries must be 2048 characters or fewer.")
        return self


class BusinessHoursDayResponse(CamelModel):
    open: str = "09:00"
    close: str = "17:00"
    closed: bool = False


class BusinessHoursWeekResponse(CamelModel):
    mon: BusinessHoursDayResponse = Field(default_factory=BusinessHoursDayResponse)
    tue: BusinessHoursDayResponse = Field(default_factory=BusinessHoursDayResponse)
    wed: BusinessHoursDayResponse = Field(default_factory=BusinessHoursDayResponse)
    thu: BusinessHoursDayResponse = Field(default_factory=BusinessHoursDayResponse)
    fri: BusinessHoursDayResponse = Field(default_factory=BusinessHoursDayResponse)
    sat: BusinessHoursDayResponse = Field(default_factory=lambda: BusinessHoursDayResponse(closed=True))
    sun: BusinessHoursDayResponse = Field(default_factory=lambda: BusinessHoursDayResponse(closed=True))


class CustomEmailSettingsResponse(CamelModel):
    from_address: str | None = None
    domain: str | None = None
    verified: bool = False


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
    business_hours_enabled: bool = False
    restrict_providers_to_business_hours: bool = False
    business_hours: BusinessHoursWeekResponse = Field(default_factory=BusinessHoursWeekResponse)
    client_ownership_enabled: bool = False
    online_booking_owner_assignment_enabled: bool = False
    custom_email: CustomEmailSettingsResponse = Field(default_factory=CustomEmailSettingsResponse)
    wallet_enabled: bool = False
    wallet_expiration_months: int | None = None
    membership_enabled: bool = False


_HHMM_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class BusinessHoursDayRequest(CamelModel):
    open: str = "09:00"
    close: str = "17:00"
    closed: bool = False

    @model_validator(mode="after")
    def _validate_window(self) -> "BusinessHoursDayRequest":
        if not _HHMM_RE.match(self.open):
            raise ValueError("open must be HH:MM 24-hour format.")
        if not _HHMM_RE.match(self.close):
            raise ValueError("close must be HH:MM 24-hour format.")
        if not self.closed and self.open >= self.close:
            raise ValueError("open must be earlier than close on open days.")
        return self


class BusinessHoursWeekRequest(CamelModel):
    mon: BusinessHoursDayRequest = Field(default_factory=BusinessHoursDayRequest)
    tue: BusinessHoursDayRequest = Field(default_factory=BusinessHoursDayRequest)
    wed: BusinessHoursDayRequest = Field(default_factory=BusinessHoursDayRequest)
    thu: BusinessHoursDayRequest = Field(default_factory=BusinessHoursDayRequest)
    fri: BusinessHoursDayRequest = Field(default_factory=BusinessHoursDayRequest)
    sat: BusinessHoursDayRequest = Field(default_factory=lambda: BusinessHoursDayRequest(closed=True))
    sun: BusinessHoursDayRequest = Field(default_factory=lambda: BusinessHoursDayRequest(closed=True))


class UpdateTenantBusinessHoursRequest(CamelModel):
    business_hours_enabled: bool | None = None
    restrict_providers_to_business_hours: bool | None = None
    business_hours: BusinessHoursWeekRequest | None = None


class UpdateTenantClientOwnershipRequest(CamelModel):
    client_ownership_enabled: bool | None = None
    online_booking_owner_assignment_enabled: bool | None = None


class UpdateTenantWalletMembershipRequest(CamelModel):
    wallet_enabled: bool | None = None
    wallet_expiration_months: int | None = None
    membership_enabled: bool | None = None

    @model_validator(mode="after")
    def _validate(self) -> "UpdateTenantWalletMembershipRequest":
        if self.wallet_expiration_months is not None and self.wallet_expiration_months <= 0:
            raise ValueError("walletExpirationMonths must be a positive integer.")
        return self


class UpdateTenantCustomEmailRequest(CamelModel):
    from_address: str | None = None
    domain: str | None = None

    @model_validator(mode="after")
    def _validate(self) -> "UpdateTenantCustomEmailRequest":
        if self.from_address is not None and self.from_address.strip():
            if "@" not in self.from_address or self.from_address.strip() != self.from_address:
                raise ValueError("fromAddress must be a valid email address.")
        if self.domain is not None and self.domain.strip():
            if " " in self.domain or "." not in self.domain:
                raise ValueError("domain must be a valid host name.")
        return self


class EmailDnsRecordResponse(CamelModel):
    type: str
    host: str
    value: str


class EmailDnsResponse(CamelModel):
    domain: str | None = None
    records: list[EmailDnsRecordResponse] = Field(default_factory=list)
    verified: bool = False


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
    phone: str | None = None


class CreateLocationRequest(CamelModel):
    name: str = Field(min_length=1, max_length=255)
    time_zone: str = Field(min_length=3, max_length=100)
    address_line1: str | None = Field(default=None, max_length=255)
    address_line2: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def _validate(self) -> "CreateLocationRequest":
        if self.phone is not None and self.phone.strip():
            stripped = self.phone.strip()
            digits = sum(ch.isdigit() for ch in stripped)
            if digits < 7 or any(ch not in "+0123456789-() .x" for ch in stripped):
                raise ValueError("phone must contain at least 7 digits and only standard phone characters.")
        return self


class UpdateLocationRequest(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    time_zone: str | None = Field(default=None, min_length=3, max_length=100)
    address_line1: str | None = Field(default=None, max_length=255)
    address_line2: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, max_length=40)
    is_active: bool | None = None

    @model_validator(mode="after")
    def _validate(self) -> "UpdateLocationRequest":
        if self.phone is not None and self.phone.strip():
            stripped = self.phone.strip()
            digits = sum(ch.isdigit() for ch in stripped)
            if digits < 7 or any(ch not in "+0123456789-() .x" for ch in stripped):
                raise ValueError("phone must contain at least 7 digits and only standard phone characters.")
        return self


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
    is_bookable_online: bool = True
    service_ids: list[str]
    location_ids: list[str]


class ServiceListResponse(CamelModel):
    services: list[ServiceSummaryResponse]


class ProviderListResponse(CamelModel):
    providers: list[ProviderSummaryResponse]


class LocationListResponse(CamelModel):
    locations: list[LocationSummaryResponse]


class TenantUserSummaryResponse(CamelModel):
    id: str
    email: str
    name: str
    role: str
    is_active: bool
    created_at: datetime
    phone: str | None = None
    avatar_url: str | None = None


class TenantUserListResponse(CamelModel):
    users: list[TenantUserSummaryResponse]


VALID_USER_ROLES = ("owner", "manager", "staff", "provider")

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_role(value: str, *, field: str = "role") -> str:
    lowered = value.strip().lower()
    if lowered not in VALID_USER_ROLES:
        raise ValueError(f"{field} must be one of {', '.join(VALID_USER_ROLES)}.")
    return lowered


def _validate_email(value: str) -> str:
    stripped = value.strip()
    if not _EMAIL_RE.match(stripped):
        raise ValueError("email must be a valid email address.")
    return stripped.lower()


def _validate_password(value: str) -> str:
    if len(value) < 8:
        raise ValueError("password must be at least 8 characters long.")
    return value


def _normalize_optional(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


class CreateTenantUserRequest(CamelModel):
    email: str = Field(min_length=3, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    role: str = Field(min_length=1, max_length=32)
    initial_password: str = Field(min_length=8, max_length=255)
    phone: str | None = Field(default=None, max_length=40)
    avatar_url: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _validate(self) -> "CreateTenantUserRequest":
        self.email = _validate_email(self.email)
        self.role = _validate_role(self.role)
        self.initial_password = _validate_password(self.initial_password)
        self.phone = _normalize_optional(self.phone)
        self.avatar_url = _normalize_optional(self.avatar_url)
        return self


class UpdateTenantUserRequest(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    role: str | None = Field(default=None, min_length=1, max_length=32)
    is_active: bool | None = None
    phone: str | None = Field(default=None, max_length=40)
    avatar_url: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def _validate(self) -> "UpdateTenantUserRequest":
        if self.role is not None:
            self.role = _validate_role(self.role)
        return self


class ResetTenantUserPasswordRequest(CamelModel):
    new_password: str = Field(min_length=8, max_length=255)

    @model_validator(mode="after")
    def _validate(self) -> "ResetTenantUserPasswordRequest":
        self.new_password = _validate_password(self.new_password)
        return self


class ProviderProfileRequest(CamelModel):
    """Optional provider sub-payload when creating a staff user."""

    location_ids: list[str] = Field(default_factory=list)
    service_ids: list[str] = Field(default_factory=list)
    is_bookable_online: bool = True


class CreateProviderRequest(CamelModel):
    name: str = Field(min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    user_id: str | None = Field(default=None, max_length=36)
    location_ids: list[str] = Field(default_factory=list)
    service_ids: list[str] = Field(default_factory=list)
    is_bookable_online: bool = True

    @model_validator(mode="after")
    def _validate(self) -> "CreateProviderRequest":
        if self.email:
            self.email = _validate_email(self.email)
        return self


class UpdateProviderRequest(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    user_id: str | None = Field(default=None, max_length=36)
    location_ids: list[str] | None = None
    service_ids: list[str] | None = None
    is_active: bool | None = None
    is_bookable_online: bool | None = None

    @model_validator(mode="after")
    def _validate(self) -> "UpdateProviderRequest":
        if self.email:
            self.email = _validate_email(self.email)
        return self


class CreateStaffRequest(CamelModel):
    """Combined user-plus-optional-provider creation."""

    email: str = Field(min_length=3, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    role: str = Field(min_length=1, max_length=32)
    initial_password: str = Field(min_length=8, max_length=255)
    phone: str | None = Field(default=None, max_length=40)
    avatar_url: str | None = Field(default=None, max_length=2000)
    provider: ProviderProfileRequest | None = None

    @model_validator(mode="after")
    def _validate(self) -> "CreateStaffRequest":
        self.email = _validate_email(self.email)
        self.role = _validate_role(self.role)
        self.initial_password = _validate_password(self.initial_password)
        self.phone = _normalize_optional(self.phone)
        self.avatar_url = _normalize_optional(self.avatar_url)
        return self


class CreateStaffResponse(CamelModel):
    user: TenantUserSummaryResponse
    provider: ProviderSummaryResponse | None = None


# ---------------------------------------------------------------------------
# Provider weekly schedule (Phase C)
# ---------------------------------------------------------------------------


def _validate_time_string(value: str, field: str) -> str:
    parts = value.split(":")
    if len(parts) != 2:
        raise ValueError(f"{field} must use HH:MM format")
    try:
        hour = int(parts[0])
        minute = int(parts[1])
    except ValueError as exc:
        raise ValueError(f"{field} must use HH:MM format") from exc
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        raise ValueError(f"{field} must be a valid time of day")
    return f"{hour:02d}:{minute:02d}"


class ProviderScheduleEntryRequest(CamelModel):
    weekday: int = Field(ge=0, le=6)
    location_id: str = Field(min_length=1)
    start_time: str
    end_time: str

    @model_validator(mode="after")
    def _validate(self) -> "ProviderScheduleEntryRequest":
        self.start_time = _validate_time_string(self.start_time, "startTime")
        self.end_time = _validate_time_string(self.end_time, "endTime")
        if self.end_time <= self.start_time:
            raise ValueError("endTime must be after startTime")
        return self


class ProviderScheduleEntryResponse(CamelModel):
    weekday: int
    location_id: str
    start_time: str
    end_time: str


class ProviderScheduleResponse(CamelModel):
    provider_id: str
    entries: list[ProviderScheduleEntryResponse]


class ReplaceProviderScheduleRequest(CamelModel):
    entries: list[ProviderScheduleEntryRequest] = Field(default_factory=list)
