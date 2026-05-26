from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_optional_current_user, require_tenant_permission
from app.db.models import User
from app.db.session import get_db_session
from app.schemas.bookings import BookingSummaryResponse
from app.schemas.payments import (
    CreateCheckoutSessionRequest,
    CreateCheckoutSessionResponse,
    DepositPaymentFollowUpListResponse,
    SendPaymentReminderResponse,
)
from app.services.payments import (
    complete_checkout_session,
    create_checkout_session,
    list_deposit_payment_follow_up,
    process_stripe_webhook_event,
    send_deposit_payment_reminder,
)
from app.services.payment_processor import verify_and_parse_stripe_webhook_event


router = APIRouter(tags=["payments"])


@router.get(
    "/tenants/{tenant_slug}/payments/follow-up",
    response_model=DepositPaymentFollowUpListResponse,
    summary="List operator payment follow-up work for a tenant",
)
async def list_payment_follow_up_route(
    tenant_slug: str,
    _: object = Depends(require_tenant_permission("payments.view")),
    session: AsyncSession = Depends(get_db_session),
) -> DepositPaymentFollowUpListResponse:
    return await list_deposit_payment_follow_up(session, tenant_slug)


@router.post(
    "/tenants/{tenant_slug}/payments/follow-up/{booking_draft_id}/send-reminder",
    response_model=SendPaymentReminderResponse,
    summary="Send a deposit reminder email for a booking draft",
)
async def send_payment_reminder_route(
    tenant_slug: str,
    booking_draft_id: str,
    current_user: User = Depends(require_tenant_permission("payments.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> SendPaymentReminderResponse:
    return await send_deposit_payment_reminder(session, tenant_slug, booking_draft_id, current_user)


@router.post(
    "/tenants/{tenant_slug}/payments/checkout-sessions",
    response_model=CreateCheckoutSessionResponse,
    summary="Create or resume a checkout session for a booking draft or booking balance",
)
async def create_checkout_session_route(
    tenant_slug: str,
    payload: CreateCheckoutSessionRequest,
    current_user: User | None = Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> CreateCheckoutSessionResponse:
    return await create_checkout_session(session, tenant_slug, payload, current_user)


@router.post(
    "/tenants/{tenant_slug}/payments/checkout-sessions/{session_id}/complete",
    response_model=BookingSummaryResponse,
    summary="Complete a checkout session and update the booking payment state",
)
async def complete_checkout_session_route(
    tenant_slug: str,
    session_id: str,
    session: AsyncSession = Depends(get_db_session),
) -> BookingSummaryResponse:
    return await complete_checkout_session(session, tenant_slug, session_id)


@router.post(
    "/payments/webhooks/stripe",
    summary="Receive Stripe webhook events for checkout reconciliation",
)
async def stripe_webhook_route(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
    session: AsyncSession = Depends(get_db_session),
) -> dict[str, str]:
    payload = await request.body()
    event = verify_and_parse_stripe_webhook_event(payload, stripe_signature)
    return await process_stripe_webhook_event(session, event)