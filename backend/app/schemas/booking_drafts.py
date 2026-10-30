from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import CamelModel
from app.schemas.catalog import ProviderSummaryResponse, ServiceSummaryResponse
from app.schemas.forms import FormRequirementResponse


IntakeCompletionTiming = Literal["before_booking", "before_visit"]


class CustomerInput(CamelModel):
    name: str = Field(min_length=1)
    email: str = Field(min_length=1)
    phone: str = Field(min_length=1)
    referred_by: str | None = None
    # The client ticked "Text me appointment reminders" on the booking page.
    sms_consent: bool | None = None


class IntakePlanResponse(CamelModel):
    completion_timing: IntakeCompletionTiming
    status: str
    due_at: datetime | None = None
    email_reminder_scheduled_at: datetime | None = None
    sms_reminder_scheduled_at: datetime | None = None
    reminder_channels: list[str]
    reminder_hours_before: int


class CustomerSummaryResponse(CamelModel):
    id: str
    tenant_id: str
    created_at: datetime
    updated_at: datetime
    name: str
    email: str | None = None
    phone: str | None = None
    notes: str | None = None
    owner_user_id: str | None = None
    owner_name: str | None = None
    sms_consent: bool = False
    sms_phone: str | None = None
    acquired_at: datetime | None = None
    source_channel: str | None = None
    referred_by: str | None = None
    address_street: str | None = None
    address_city: str | None = None
    address_state: str | None = None
    address_zip: str | None = None
    birthday: date | None = None
    blocked_from_online_booking: bool = False
    stripe_customer_id: str | None = None
    wallet_balance_cents: int = 0


class AttributionInput(CamelModel):
    """Where the visitor came from, captured by the booking page on their first landing."""

    source: str | None = Field(default=None, max_length=64)
    medium: str | None = Field(default=None, max_length=64)
    campaign: str | None = Field(default=None, max_length=128)
    referrer_url: str | None = Field(default=None, max_length=500)
    landing_path: str | None = Field(default=None, max_length=255)


class CreateBookingDraftRequest(CamelModel):
    tenant_slug: str
    service_id: str
    provider_id: str
    location_id: str | None = None
    starts_at: datetime
    customer: CustomerInput | None = None
    booking_method: Literal["public_online", "staff_entered"] = "public_online"
    override_availability: bool = False
    add_on_ids: list[str] = Field(default_factory=list, max_length=20)
    # Staff-only notes for the team; ignored for online bookings.
    notes: str | None = Field(default=None, max_length=1000)
    # Marketing attribution from the booking page; ignored for staff-entered drafts.
    attribution: AttributionInput | None = None


class ReleaseBookingDraftRequest(CamelModel):
    reason: str | None = Field(default=None, max_length=500)


class UpdateBookingDraftRequest(CamelModel):
    customer_id: str | None = None
    customer: CustomerInput | None = None
    intake_completion_timing: IntakeCompletionTiming | None = None


class ConfirmWithPaymentRequest(CamelModel):
    """Staff record a payment taken in person (POS terminal, cash...)."""

    payment_method_type: str = Field(min_length=1, max_length=64)
    # "deposit" = exactly the deposit; "full" = the whole visit (+ optional tip).
    amount_mode: Literal["deposit", "full"] = "deposit"
    amount_cents: int = Field(gt=0)
    tip_cents: int = Field(default=0, ge=0)
    # Receipt/approval number or card last 4; required for external POS.
    external_reference: str | None = Field(default=None, max_length=128)
    notes: str | None = Field(default=None, max_length=500)


class BookingDraftAddOnResponse(CamelModel):
    add_on_id: str | None = None
    name: str
    price_cents: int
    duration_minutes: int


class BookingDraftSummaryResponse(CamelModel):
    id: str
    tenant_id: str
    created_at: datetime
    updated_at: datetime
    customer_id: str | None = None
    service_id: str
    provider_id: str
    location_id: str | None = None
    status: str
    booking_method: str
    # Set once the draft became a booking (so a waiting screen can open it).
    confirmed_booking_id: str | None = None
    starts_at: datetime
    ends_at: datetime
    expires_at: datetime
    # First click-through to the studio's financing page (null if never).
    financing_started_at: datetime | None = None
    price_cents: int
    deposit_cents: int
    duration_minutes: int
    service: ServiceSummaryResponse
    provider: ProviderSummaryResponse
    customer: CustomerSummaryResponse | None = None
    intake_plan: IntakePlanResponse | None = None
    form_requirements: list[FormRequirementResponse]
    # Add-ons chosen for this booking: their minutes are included in
    # duration_minutes, their prices are added on top of price_cents.
    add_ons: list[BookingDraftAddOnResponse] = Field(default_factory=list)
    add_ons_total_cents: int = 0
    # Tax on price + add-ons, and the full visit total (subtotal + tax).
    tax_cents: int = 0
    full_amount_cents: int = 0


class BookingDraftListResponse(CamelModel):
    items: list[BookingDraftSummaryResponse]
