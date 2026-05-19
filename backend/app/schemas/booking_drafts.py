from __future__ import annotations

from datetime import datetime

from app.schemas.base import CamelModel
from app.schemas.catalog import ProviderSummaryResponse, ServiceSummaryResponse


class CustomerInput(CamelModel):
    name: str
    email: str | None = None
    phone: str | None = None


class CustomerSummaryResponse(CamelModel):
    id: str
    tenant_id: str
    created_at: datetime
    updated_at: datetime
    name: str
    email: str | None = None
    phone: str | None = None
    notes: str | None = None
    acquired_at: datetime | None = None
    source_channel: str | None = None


class FormRequirementResponse(CamelModel):
    id: str
    booking_id: str | None = None
    booking_draft_id: str | None = None
    form_id: str
    form_version_id: str
    scope: str
    customer_prompt_timing: str | None = None
    status: str
    satisfied_by_response_id: str | None = None


class CreateBookingDraftRequest(CamelModel):
    tenant_slug: str
    service_id: str
    provider_id: str
    location_id: str | None = None
    starts_at: datetime
    customer: CustomerInput | None = None
    booking_method: str | None = "public_online"


class UpdateBookingDraftRequest(CamelModel):
    customer_id: str | None = None
    customer: CustomerInput | None = None


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
    starts_at: datetime
    ends_at: datetime
    expires_at: datetime
    price_cents: int
    deposit_cents: int
    duration_minutes: int
    service: ServiceSummaryResponse
    provider: ProviderSummaryResponse
    customer: CustomerSummaryResponse | None = None
    form_requirements: list[FormRequirementResponse]