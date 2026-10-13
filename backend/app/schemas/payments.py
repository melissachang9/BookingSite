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
    tip_cents: int = Field(default=0, ge=0)
    payment_method_type: str
    notes: str | None = Field(default=None, max_length=500)
    # Receipt/approval number or card last 4; required for external POS.
    external_reference: str | None = Field(default=None, max_length=128)


class ApplyWalletCreditRequest(CamelModel):
    amount_cents: int = Field(gt=0)
    tip_cents: int = Field(default=0, ge=0)


class RefundPaymentRequest(CamelModel):
    amount_cents: int | None = Field(default=None, ge=1, description="Partial refund amount in cents. If omitted, the full payment amount is refunded.")
    reason: str | None = Field(default=None, max_length=500)

# ---------------------------------------------------------------------------
# Payment processor connection (Clover)
# ---------------------------------------------------------------------------


class PaymentCapabilitiesResponse(CamelModel):
    """What this business can do with card payments right now. No secrets."""

    processor: str  # clover | stripe | simulated | none
    environment: str | None = None
    status: str | None = None  # connected | needs_reauth | disconnected | None (never connected)
    auth_mode: str | None = None
    merchant_name: str | None = None
    can_link_device_payments: bool = False
    can_charge_cards: bool = False
    can_refund_cards: bool = False
    currency_mismatch: bool = False
    needs_reauth: bool = False
    connected_at: datetime | None = None


class PublicCloverConfig(CamelModel):
    merchant_id: str
    public_key: str
    sdk_url: str
    locale: str = "en-CA"
    environment: str


class PublicPaymentConfigResponse(CamelModel):
    """Safe to expose publicly: only what the browser card form needs."""

    processor: str
    currency: str
    clover: PublicCloverConfig | None = None


class CloverAuthorizeUrlResponse(CamelModel):
    authorize_url: str


class CloverOAuthCompleteRequest(CamelModel):
    code: str = Field(min_length=1, max_length=512)
    merchant_id: str = Field(min_length=1, max_length=64)
    state: str = Field(min_length=1, max_length=2048)


class CloverApiKeysRequest(CamelModel):
    """Connect with keys from the merchant's own Clover dashboard (before app approval)."""

    environment: str = Field(default="production", pattern=r"^(sandbox|production)$")
    merchant_id: str = Field(min_length=1, max_length=64)
    platform_api_token: str = Field(min_length=1, max_length=512)
    ecommerce_public_key: str = Field(min_length=1, max_length=128)
    ecommerce_private_key: str = Field(min_length=1, max_length=512)


class CloverDevicePaymentResponse(CamelModel):
    """A payment taken on the Clover device, for staff to match to a booking."""

    id: str
    amount_cents: int  # before tip
    tip_cents: int
    total_cents: int
    card_brand: str | None = None
    card_last4: str | None = None
    auth_code: str | None = None
    employee_id: str | None = None
    created_at: datetime
    # Which amount it equals for the booking being paid, if any.
    matches: Literal["deposit", "full", "balance"] | None = None


class CloverDevicePaymentListResponse(CamelModel):
    items: list[CloverDevicePaymentResponse]


class ConfirmWithCloverPaymentRequest(CamelModel):
    clover_payment_id: str = Field(min_length=1, max_length=64)
    amount_mode: Literal["deposit", "full"] = "deposit"
    notes: str | None = Field(default=None, max_length=500)


class RecordCloverDevicePaymentRequest(CamelModel):
    clover_payment_id: str = Field(min_length=1, max_length=64)
    notes: str | None = Field(default=None, max_length=500)


# ---------------------------------------------------------------------------
# Card-not-present payments (Clover card form)
# ---------------------------------------------------------------------------


class CardChargeRequest(CamelModel):
    """A card typed into Clover's secure form, already tokenized in the browser.

    `attempt_id` is generated by the browser for each new card entry and kept
    when retrying after "we couldn't confirm"; it makes the charge idempotent.
    """

    source_token: str = Field(min_length=1, max_length=512)
    attempt_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class StaffDraftCardChargeRequest(CardChargeRequest):
    amount_mode: Literal["deposit", "full"] = "deposit"
    tip_cents: int = Field(default=0, ge=0, le=10_000_000)


class StaffBalanceCardChargeRequest(CardChargeRequest):
    tip_cents: int = Field(default=0, ge=0, le=10_000_000)


class CheckoutSessionViewResponse(CamelModel):
    """What the payment page needs to show. No customer details."""

    session_id: str
    kind: str  # deposit | booking_balance
    status: str  # pending | processing | succeeded | canceled | refunded
    amount_cents: int
    currency: str
    expires_at: datetime | None = None
    processor: str  # clover | stripe | simulated
    service_name: str
    starts_at: datetime
    booking_id: str | None = None
    booking_draft_id: str | None = None


class PaymentLinkRequest(CamelModel):
    channels: list[Literal["sms", "email"]] = Field(default_factory=list, max_length=2)
    # Staff confirm the client asked for a text (recorded in the audit trail).
    sms_consent_confirmed: bool = False


class DeliveryResultResponse(CamelModel):
    channel: str
    status: str  # sent | failed | skipped
    recipient: str | None = None
    error: str | None = None


class PaymentLinkResponse(CamelModel):
    booking_draft: BookingDraftSummaryResponse
    payment_url: str
    hold_expires_at: datetime
    deliveries: list[DeliveryResultResponse]
