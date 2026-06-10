from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import CamelModel
from app.schemas.booking_drafts import CustomerSummaryResponse, IntakePlanResponse
from app.schemas.catalog import ProviderSummaryResponse, ServiceSummaryResponse, TenantSummaryResponse


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
    notes: str | None = None
    amount_paid_cents: int
    balance_due_cents: int
    customer_manage_token: str
    service: ServiceSummaryResponse
    provider: ProviderSummaryResponse
    customer: CustomerSummaryResponse
    intake_plan: IntakePlanResponse | None = None


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
    cancellation_deadline_at: datetime
    is_inside_cancellation_window: bool


class CancelManageBookingRequest(CamelModel):
    reason: str | None = Field(default=None, max_length=500)


class UpdateBookingStatusRequest(CamelModel):
    status: Literal["completed", "no_show"]
    notes: str | None = Field(default=None, max_length=500)
    payment_resolution: Literal["collected", "follow_up", "waived"] | None = None


class UpdateBookingRequest(CamelModel):
    starts_at: datetime | None = None
    provider_id: str | None = None
    service_id: str | None = None
    notes: str | None = Field(default=None, max_length=500)
    send_confirmation: bool = False