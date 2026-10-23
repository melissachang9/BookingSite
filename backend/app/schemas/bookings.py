from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import CamelModel
from app.schemas.booking_drafts import CustomerSummaryResponse, IntakePlanResponse
from app.schemas.catalog import ProviderSummaryResponse, ServiceSummaryResponse, TenantSummaryResponse


class BookingPaymentSummary(CamelModel):
    id: str
    amount_cents: int
    tip_cents: int = 0
    status: str
    deposit_status: str
    payment_method_type: str
    checkout_session_kind: str | None = None
    created_at: datetime
    refund_reason: str | None = None
    # POS receipt/approval number for payments taken outside our processor.
    external_reference: str | None = None
    # Which processor took the money and how (clover: device | ecom | moto).
    processor: str | None = None
    processor_channel: str | None = None
    card_brand: str | None = None
    card_last4: str | None = None


class BookingItemSummary(CamelModel):
    id: str
    name: str
    price_cents: int
    quantity: int
    source_service_id: str | None = None
    source_add_on_id: str | None = None
    kind: str = "service"


class AddBookingItemRequest(CamelModel):
    source_service_id: str | None = None
    source_add_on_id: str | None = None
    name: str | None = Field(default=None, max_length=255)
    price_cents: int | None = Field(default=None, ge=0, le=1_000_000)
    quantity: int = Field(default=1, ge=1, le=99)


class BookingSummaryResponse(CamelModel):
    id: str
    tenant_id: str
    created_at: datetime
    updated_at: datetime
    customer_id: str
    service_id: str
    provider_id: str
    location_id: str | None = None
    status: str
    booking_method: str
    deposit_status: str
    payment_resolution: str
    starts_at: datetime
    ends_at: datetime
    completed_at: datetime | None = None
    canceled_at: datetime | None = None
    source_channel: str | None = None
    canceled_by: str | None = None
    cancel_reason: str | None = None
    no_show_at: datetime | None = None
    reschedule_count: int = 0
    rescheduled_from_starts_at: datetime | None = None
    checked_in_at: datetime | None = None
    service_started_at: datetime | None = None
    notes: str | None = None
    # Service price/deposit agreed at booking time (provider overrides applied).
    price_cents: int
    deposit_cents: int
    amount_paid_cents: int
    balance_due_cents: int
    tax_cents: int = 0
    # Set when the visit is checked out; null on bookings completed before sales were numbered.
    sale_id: str | None = None
    sale_number: int | None = None
    # The rates behind tax_cents, so a checkout can re-price a sale without guessing.
    service_tax_rate_percent: float = 0
    product_tax_rate_percent: float = 0
    service_is_taxable: bool = True
    wallet_balance_cents: int = 0
    customer_manage_token: str
    service: ServiceSummaryResponse
    provider: ProviderSummaryResponse
    customer: CustomerSummaryResponse
    intake_plan: IntakePlanResponse | None = None
    payments: list[BookingPaymentSummary] = Field(default_factory=list)
    items: list[BookingItemSummary] = Field(default_factory=list)


class PaginationMetaResponse(CamelModel):
    limit: int
    offset: int
    total: int


class BookingListResponse(CamelModel):
    items: list[BookingSummaryResponse]
    meta: PaginationMetaResponse


class CustomerManageBookingResponse(CamelModel):
    tenant: TenantSummaryResponse
    booking: BookingSummaryResponse
    cancellation_window_hours: int
    refund_inside_window: bool
    cancellation_refund_method: Literal["original_payment", "wallet_credit"] = "original_payment"
    cancellation_deadline_at: datetime
    is_inside_cancellation_window: bool


class CancelManageBookingRequest(CamelModel):
    reason: str | None = Field(default=None, max_length=500)


class RescheduleManageBookingRequest(CamelModel):
    starts_at: datetime
    reason: str | None = Field(default=None, max_length=500)


class CancelBookingRequest(CamelModel):
    reason: str | None = Field(default=None, max_length=500)


class UpdateBookingStatusRequest(CamelModel):
    status: Literal["completed", "no_show"]
    notes: str | None = Field(default=None, max_length=500)
    payment_resolution: Literal["collected", "follow_up", "waived"] | None = None
    discount_cents: int = Field(default=0, ge=0)
    discount_type: Literal["percent", "amount"] | None = None


class GroupCheckoutItem(CamelModel):
    booking_id: str
    discount_cents: int = Field(default=0, ge=0)
    discount_type: Literal["percent", "amount"] | None = None
    payment_resolution: Literal["collected", "follow_up", "waived"] | None = None


class TipShare(CamelModel):
    provider_id: str
    amount_cents: int = Field(ge=0)


class GroupCheckoutRequest(CamelModel):
    """Check out several of one client's visits as a single sale."""

    items: list[GroupCheckoutItem] = Field(min_length=2, max_length=10)
    notes: str | None = Field(default=None, max_length=500)
    # Optional override of how the tip is shared; must add up to the tip left on these visits.
    tip_split: list[TipShare] | None = None


class GroupCheckoutResponse(CamelModel):
    sale_id: str
    sale_number: int
    bookings: list[BookingSummaryResponse]


class BookingProgressRequest(CamelModel):
    """Stamp when the client arrived or when the service actually began."""

    action: Literal["check_in", "start_service"]


class UpdateBookingRequest(CamelModel):
    starts_at: datetime | None = None
    provider_id: str | None = None
    service_id: str | None = None
    notes: str | None = Field(default=None, max_length=500)
    send_confirmation: bool = False