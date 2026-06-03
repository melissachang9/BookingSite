from __future__ import annotations

from datetime import datetime
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
    acquired_at: datetime | None = None
    source_channel: str | None = None


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
    intake_completion_timing: IntakeCompletionTiming | None = None


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
    intake_plan: IntakePlanResponse | None = None
    form_requirements: list[FormRequirementResponse]