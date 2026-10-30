from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.schemas.base import CamelModel
from app.schemas.booking_drafts import CustomerSummaryResponse
from app.schemas.bookings import PaginationMetaResponse


class CustomerLookupResponse(CamelModel):
    items: list[CustomerSummaryResponse]
    meta: PaginationMetaResponse


class CustomerListResponse(CamelModel):
    items: list[CustomerSummaryResponse]
    meta: PaginationMetaResponse


class CustomerBookingEntry(CamelModel):
    id: str
    service_name: str
    provider_name: str
    status: str
    starts_at: datetime
    ends_at: datetime
    price_cents: int
    deposit_cents: int
    amount_paid_cents: int
    balance_due_cents: int


class CustomerBookingAttempt(CamelModel):
    """A booking the client started online but never finished, kept for follow-up.

    outcome: financing_started (opened the studio's financing page; applying can take days),
    abandoned (hold lapsed before payment), in_progress (still held), released (staff let it go).
    """

    id: str
    outcome: str
    service_name: str
    provider_name: str
    starts_at: datetime
    created_at: datetime
    financing_started_at: datetime | None = None
    # The client has since booked this service, so there is nothing left to chase.
    booked_since: bool = False
    booking_method: str
    customer_id: str | None = None
    customer_name: str | None = None
    customer_email: str | None = None
    customer_phone: str | None = None
    # Set once staff have followed up (who, when, and what came of it).
    follow_up_at: datetime | None = None
    follow_up_by_name: str | None = None
    follow_up_note: str | None = None


class CustomerBookingAttemptListResponse(CamelModel):
    items: list[CustomerBookingAttempt]


class MarkBookingAttemptFollowedUpRequest(CamelModel):
    note: str | None = Field(default=None, max_length=500)


class CustomerPaymentEntry(CamelModel):
    id: str
    booking_id: str
    amount_cents: int
    payment_method_type: str
    status: str
    recorded_at: datetime
    notes: str | None = None


class CustomerProfileResponse(CamelModel):
    customer: CustomerSummaryResponse
    bookings: list[CustomerBookingEntry]
    payments: list[CustomerPaymentEntry] = []
    booking_attempts: list[CustomerBookingAttempt] = []
    lifetime_spend_cents: int = 0
    outstanding_balance_cents: int = 0
    wallet_balance_cents: int = 0


class UpdateCustomerRequest(CamelModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    notes: str | None = None
    referred_by: str | None = None
    owner_user_id: str | None = None
    wallet_adjustment_cents: int | None = None
    wallet_adjustment_note: str | None = None
    sms_consent: bool | None = None
    sms_phone: str | None = None
    address_street: str | None = None
    address_city: str | None = None
    address_state: str | None = None
    address_zip: str | None = None
    birthday: str | None = None  # ISO date (YYYY-MM-DD); empty string clears
    blocked_from_online_booking: bool | None = None


class UpsertCustomerRequest(CamelModel):
    name: str
    email: str | None = None
    phone: str | None = None
    notes: str | None = None
    address_street: str | None = None
    address_city: str | None = None
    address_state: str | None = None
    address_zip: str | None = None
    blocked_from_online_booking: bool = False


class UpsertCustomerResponse(CamelModel):
    customer_id: str