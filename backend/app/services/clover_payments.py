"""Matching payments taken on the Clover device to bookings.

Walk-ins are rung up on the Flex as usual. Staff then pick that payment in the
booking drawer; the server re-reads it from the business's own Clover account
(the browser never supplies amounts) and links it to the booking, once.

Rules: the amount before tip must equal the deposit / full price / balance
exactly; a tip on the Flex is recorded as a tip; a Clover payment can pay for
only one booking.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.http import api_exception
from app.db.models import Payment
from app.schemas.booking_drafts import BookingDraftSummaryResponse  # noqa: F401  (documented return types)
from app.schemas.bookings import BookingSummaryResponse
from app.schemas.payments import (
    CloverDevicePaymentListResponse,
    CloverDevicePaymentResponse,
    ConfirmWithCloverPaymentRequest,
    RecordCloverDevicePaymentRequest,
    RefundPaymentRequest,
)
from app.services import clover_client
from app.services.booking_drafts import _clean_text, _load_booking, _load_booking_draft
from app.services.clover_client import CloverAuthError, CloverContext, CloverError, CloverPayment
from app.services.clover_connections import get_clover_context, mark_connection_needs_reauth
from app.services.presenters import booking_balance_due_cents, booking_to_summary
from app.services.staff_booking_drafts import (
    check_staff_draft_amount,
    confirm_staff_draft,
    load_staff_draft_for_payment,
    staff_draft_amounts,
)
from app.services.tenants import get_tenant_by_slug

PROCESSOR = "clover"
CHANNEL_DEVICE = "device"

# Staff are watching the screen while a client pays, so the picker polls. A
# short per-business cache keeps several front desks from hammering Clover.
_LIST_CACHE_SECONDS = 5.0
_list_cache: dict[tuple[str, int], tuple[float, list[CloverPayment]]] = {}


def clear_device_payment_cache() -> None:
    _list_cache.clear()


async def _context(tenant_id: str) -> CloverContext:
    return await get_clover_context(tenant_id)


async def _clover_call(tenant_id: str, call):
    """Run a Clover call, turning failures into structured, honest API errors."""
    try:
        return await call
    except CloverAuthError as error:
        await mark_connection_needs_reauth(tenant_id, error.message)
        raise api_exception(
            503, "service_unavailable", "Clover stopped accepting our connection. Reconnect it in Settings → Payments."
        ) from error
    except CloverError as error:
        raise api_exception(502, "payment_processor_error", error.message) from error


async def _linked_ids(session: AsyncSession, merchant_id: str, ids: list[str]) -> set[str]:
    if not ids:
        return set()
    rows = await session.scalars(
        select(Payment.processor_payment_id).where(
            Payment.processor == PROCESSOR,
            Payment.processor_merchant_id == merchant_id,
            Payment.processor_payment_id.in_(ids),
        )
    )
    return {row for row in rows if row}


def _device_payment_fields(ctx: CloverContext, payment: CloverPayment) -> dict[str, object]:
    return {
        "processor": PROCESSOR,
        "processor_channel": CHANNEL_DEVICE,
        "processor_merchant_id": ctx.merchant_id,
        "processor_payment_id": payment.id,
        "card_brand": payment.card_brand,
        "card_last4": payment.last4,
    }


def _reference_for(payment: CloverPayment) -> str | None:
    return payment.auth_code or (f"••{payment.last4}" if payment.last4 else None)


def _check_payment_usable(payment: CloverPayment | None) -> CloverPayment:
    if payment is None:
        raise api_exception(404, "not_found", "That payment was not found in this business's Clover account.")
    if payment.result != "SUCCESS":
        raise api_exception(409, "conflict", f"That Clover payment did not go through (status {payment.result.lower()}).")
    if payment.refunded_cents > 0:
        raise api_exception(409, "conflict", "That Clover payment has been refunded.")
    return payment


async def _ensure_not_linked(session: AsyncSession, ctx: CloverContext, payment: CloverPayment) -> None:
    if payment.id in await _linked_ids(session, ctx.merchant_id, [payment.id]):
        raise api_exception(409, "conflict", "This payment is already linked to another booking.")


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


async def list_recent_device_payments(
    session: AsyncSession,
    tenant_slug: str,
    *,
    since_minutes: int,
    booking_draft_id: str | None = None,
    booking_id: str | None = None,
) -> CloverDevicePaymentListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    targets: dict[str, int] = {}
    if booking_draft_id is not None:
        draft = await _load_booking_draft(session, booking_draft_id, tenant.id)
        amounts = staff_draft_amounts(draft)
        if amounts.deposit_cents > 0:
            targets["deposit"] = amounts.deposit_cents
        targets["full"] = amounts.full_cents
    elif booking_id is not None:
        booking = await _load_booking(session, booking_id, tenant.id)
        balance = booking_balance_due_cents(booking)
        if balance > 0:
            targets["balance"] = balance

    ctx = await _context(tenant.id)
    now = time.monotonic()
    cache_key = (tenant.id, since_minutes)
    cached = _list_cache.get(cache_key)
    if cached is not None and now - cached[0] < _LIST_CACHE_SECONDS:
        payments = cached[1]
    else:
        since = datetime.now(timezone.utc) - timedelta(minutes=since_minutes)
        payments = await _clover_call(tenant.id, clover_client.list_payments(ctx, since=since))
        _list_cache[cache_key] = (now, payments)

    linked = await _linked_ids(session, ctx.merchant_id, [p.id for p in payments])
    items: list[CloverDevicePaymentResponse] = []
    for payment in payments:
        if not payment.is_paid or payment.id in linked:
            continue
        matches = next((name for name, cents in targets.items() if cents == payment.visit_cents), None)
        items.append(
            CloverDevicePaymentResponse(
                id=payment.id,
                amount_cents=payment.visit_cents,
                tip_cents=payment.tip_cents,
                total_cents=payment.total_cents,
                card_brand=payment.card_brand,
                card_last4=payment.last4,
                auth_code=payment.auth_code,
                employee_id=payment.employee_id,
                created_at=payment.created_at,
                matches=matches,  # type: ignore[arg-type]
            )
        )
    return CloverDevicePaymentListResponse(items=items)


# ---------------------------------------------------------------------------
# Linking
# ---------------------------------------------------------------------------


async def confirm_staff_draft_with_clover_payment(
    session: AsyncSession,
    tenant_slug: str,
    booking_draft_id: str,
    payload: ConfirmWithCloverPaymentRequest,
    actor,
) -> BookingSummaryResponse:
    tenant, draft, replay = await load_staff_draft_for_payment(session, tenant_slug, booking_draft_id)
    if replay is not None:
        return replay

    ctx = await _context(tenant.id)
    payment = _check_payment_usable(
        await _clover_call(tenant.id, clover_client.get_payment(ctx, payload.clover_payment_id))
    )
    await _ensure_not_linked(session, ctx, payment)
    # The server's reading of Clover decides the amounts, never the browser.
    check_staff_draft_amount(
        draft,
        amount_mode=payload.amount_mode,
        amount_cents=payment.total_cents,
        tip_cents=payment.tip_cents,
        allow_tip_on_deposit=True,
    )
    return await confirm_staff_draft(
        session,
        tenant,
        draft,
        method="card",
        amount_mode=payload.amount_mode,
        amount_cents=payment.total_cents,
        tip_cents=payment.tip_cents,
        reference=_reference_for(payment),
        notes=_clean_text(payload.notes),
        actor=actor,
        processor_fields=_device_payment_fields(ctx, payment),
        event_note="Matched to a payment taken on the Clover device.",
    )


async def record_clover_device_payment_for_booking(
    session: AsyncSession,
    tenant_slug: str,
    booking_id: str,
    payload: RecordCloverDevicePaymentRequest,
    actor,
) -> BookingSummaryResponse:
    from app.services.bookings import record_booking_payment

    tenant = await get_tenant_by_slug(session, tenant_slug)
    booking = await _load_booking(session, booking_id, tenant.id)
    if booking.status not in {"confirmed", "completed"}:
        raise api_exception(409, "conflict", "Payments can only be added to confirmed or completed bookings.")

    # Already linked to THIS booking: a repeat of the same request is a no-op.
    ctx = await _context(tenant.id)
    existing = next(
        (
            p
            for p in booking.payments
            if p.processor == PROCESSOR and p.processor_payment_id == payload.clover_payment_id
        ),
        None,
    )
    if existing is not None:
        return booking_to_summary(booking)

    payment = _check_payment_usable(
        await _clover_call(tenant.id, clover_client.get_payment(ctx, payload.clover_payment_id))
    )
    await _ensure_not_linked(session, ctx, payment)
    balance = booking_balance_due_cents(booking)
    if balance <= 0:
        raise api_exception(409, "conflict", "This booking has no balance due.")
    if payment.visit_cents != balance:
        raise api_exception(
            409,
            "conflict",
            f"The balance is exactly ${balance / 100:,.2f}. That Clover payment is ${payment.visit_cents / 100:,.2f} before tip.",
        )
    return await record_booking_payment(
        session,
        tenant,
        booking,
        method="card",
        amount_cents=payment.total_cents,
        tip_cents=payment.tip_cents,
        reference=_reference_for(payment),
        notes=_clean_text(payload.notes),
        actor=actor,
        processor_fields=_device_payment_fields(ctx, payment),
        event_note="Matched to a payment taken on the Clover device.",
    )


# ---------------------------------------------------------------------------
# Refunds done on the device
# ---------------------------------------------------------------------------


async def record_clover_device_refund(
    session: AsyncSession,
    tenant_slug: str,
    booking_id: str,
    payment_id: str,
    actor,
) -> BookingSummaryResponse:
    """Staff refunded a device payment on the Flex; record it here.

    Re-reads the payment from Clover and records only refund money we haven't
    recorded yet, so repeating the request changes nothing.
    """
    from app.services.bookings import refund_payment

    tenant = await get_tenant_by_slug(session, tenant_slug)
    booking = await _load_booking(session, booking_id, tenant.id)
    payment = next((p for p in booking.payments if p.id == payment_id), None)
    if payment is None:
        raise api_exception(404, "not_found", "Payment was not found on this booking.")
    if payment.processor != PROCESSOR or payment.processor_channel != CHANNEL_DEVICE or not payment.processor_payment_id:
        raise api_exception(409, "conflict", "Only payments matched from the Clover device can be recorded this way.")

    ctx = await _context(tenant.id)
    clover_payment = await _clover_call(tenant.id, clover_client.get_payment(ctx, payment.processor_payment_id))
    if clover_payment is None:
        raise api_exception(404, "not_found", "That payment was not found in this business's Clover account.")

    recorded = sum(
        event.amount_cents or 0 for event in payment.events if event.kind in {"refund_recorded", "wallet_returned"}
    )
    to_record = clover_payment.refunded_cents - recorded
    if to_record <= 0:
        if recorded > 0:
            return booking_to_summary(booking)  # already up to date
        raise api_exception(409, "conflict", "Refund it on the Clover device first, then record it here.")

    return await refund_payment(
        session,
        tenant_slug,
        booking_id,
        payment_id,
        RefundPaymentRequest(amount_cents=min(to_record, payment.amount_cents), reason="Refunded on the Clover device."),
        actor,
    )
