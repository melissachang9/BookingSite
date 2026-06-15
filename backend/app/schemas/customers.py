from __future__ import annotations

from datetime import datetime

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


class CustomerProfileResponse(CamelModel):
    customer: CustomerSummaryResponse
    bookings: list[CustomerBookingEntry]
    lifetime_spend_cents: int = 0
    outstanding_balance_cents: int = 0


class UpdateCustomerRequest(CamelModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    notes: str | None = None
    owner_user_id: str | None = None