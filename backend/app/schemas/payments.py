from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import CamelModel
from app.schemas.booking_drafts import BookingDraftSummaryResponse


CheckoutSessionKind = Literal["deposit", "booking_balance", "manual_payment_link"]
DepositPaymentLinkState = Literal["open", "expired", "missing"]


class CreateCheckoutSessionRequest(CamelModel):
    tenant_slug: str
    booking_draft_id: str | None = None
    booking_id: str | None = None
    kind: CheckoutSessionKind
    success_url: str
    cancel_url: str


class CreateCheckoutSessionResponse(CamelModel):
    checkout_url: str
    session_id: str
    expires_at: datetime | None = None


class DepositPaymentFollowUpItemResponse(CamelModel):
    booking_draft: BookingDraftSummaryResponse
    payment_id: str | None = None
    payment_status: str | None = None
    checkout_session_id: str | None = None
    checkout_url: str | None = None
    checkout_expires_at: datetime | None = None
    link_state: DepositPaymentLinkState


class DepositPaymentFollowUpListResponse(CamelModel):
    items: list[DepositPaymentFollowUpItemResponse]


class SendPaymentReminderResponse(CamelModel):
    booking_draft_id: str
    payment_id: str
    checkout_session_id: str
    checkout_url: str
    recipient_email: str
    provider: str
    provider_message_id: str
    sent_at: datetime


class RecordManualPaymentRequest(CamelModel):
    amount_cents: int = Field(gt=0)
    payment_method_type: str
    notes: str | None = Field(default=None, max_length=500)


class ApplyWalletCreditRequest(CamelModel):
    amount_cents: int = Field(gt=0)