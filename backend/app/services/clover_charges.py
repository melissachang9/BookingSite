"""Card payments through Clover's secure card form: online deposits and balances
(the client types the card), and staff phone orders (staff type it).

How a charge stays safe:
1. Write the payment as "processing" with an attempt key and commit. No lock is
   held while we wait for Clover.
2. Call Clover with that key as the idempotency key. Replaying the same attempt
   (after a timeout) can never charge twice.
3. Record the charge, then finish the booking. If finishing fails after the
   money was taken, the charge is refunded and the client is told. A payment
   that arrives after the hold expired confirms the booking if the slot is
   still free and is refunded otherwise.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import Booking, BookingDraft, Payment, PaymentEvent, ResourceAllocation, SlotHold, Tenant, User
from app.schemas.bookings import BookingSummaryResponse
from app.schemas.payments import CardChargeRequest, StaffBalanceCardChargeRequest, StaffDraftCardChargeRequest
from app.services import clover_client
from app.services.audit import record_audit
from app.services.booking_drafts import (
    ACTIVE_DRAFT_STATUSES,
    _ensure_aware,
    _ensure_not_expired,
    _has_pending_pre_booking_requirements,
    _load_booking,
    _load_booking_draft,
    _upsert_intake_plan,
)
from app.services.booking_notifications import send_booking_confirmation
from app.services.clover_client import (
    CloverAuthError,
    CloverCharge,
    CloverContext,
    CloverDeclined,
    CloverError,
    CloverOutcomeUnknown,
)
from app.services.clover_connections import get_clover_context, mark_connection_needs_reauth
from app.services.payments import (
    _complete_booking_balance_checkout_payment,
    _complete_deposit_checkout_payment,
    _load_checkout_payment,
)
from app.services.presenters import booking_balance_due_cents, booking_to_summary
from app.services.resource_availability import reserve_resources
from app.services.staff_booking_drafts import check_staff_draft_amount, confirm_staff_draft, staff_draft_amounts
from app.services.state_machine import guard_transition
from app.services.tenants import get_tenant_by_slug, tenant_currency

logger = logging.getLogger(__name__)

PROCESSOR = "clover"
MAX_DECLINES = 5  # then the payment is locked (card-testing defence)
MIN_HOLD_SECONDS = 30  # don't start a charge on a hold about to lapse


class PaymentRefunded(HTTPException):
    """The charge was taken, could not be used, and has been refunded."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _event(
    session: AsyncSession,
    payment: Payment,
    kind: str,
    *,
    notes: str | None = None,
    reference: str | None = None,
    actor: User | None = None,
    actor_type: str | None = None,
) -> None:
    session.add(
        PaymentEvent(
            tenant_id=payment.tenant_id,
            payment_id=payment.id,
            kind=kind,
            actor_type=actor_type or ("user" if actor is not None else "system"),
            actor_id=actor.id if actor is not None else None,
            display_name=actor.name if actor is not None else ("Customer" if actor_type == "customer" else "System"),
            occurred_at=datetime.now(timezone.utc),
            amount_cents=payment.amount_cents,
            notes=notes,
            processor_reference=reference,
        )
    )


async def _load_payment_locked(session: AsyncSession, tenant_id: str, payment_id: str) -> Payment:
    payment = await session.scalar(
        select(Payment)
        .options(selectinload(Payment.events))
        .where(Payment.tenant_id == tenant_id, Payment.id == payment_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if payment is None:
        raise api_exception(404, "not_found", "Payment was not found for this tenant.")
    return payment


def _hold_seconds_left(draft: BookingDraft) -> float:
    return (_ensure_aware(draft.expires_at) - datetime.now(timezone.utc)).total_seconds()


@dataclass
class Finish:
    """Everything a finalizer needs once Clover has taken the money."""

    session: AsyncSession
    tenant: Tenant
    # Plain values: after a rollback the ORM objects below are expired.
    tenant_id: str
    tenant_slug: str
    payment_id: str
    ctx: CloverContext
    charge: CloverCharge
    actor: User | None


Finalizer = Callable[[Finish], Awaitable[BookingSummaryResponse]]
Precheck = Callable[[AsyncSession, Payment], Awaitable[None]]


# ---------------------------------------------------------------------------
# Refunding a charge we can't use
# ---------------------------------------------------------------------------


async def _refund_unusable_charge(fc: Finish, *, event_kind: str, reason: str) -> None:
    """Return money Clover took for a booking we can't confirm. Always raises."""
    payment = await _load_payment_locked(fc.session, fc.tenant_id, fc.payment_id)
    try:
        refund = await clover_client.create_refund(
            fc.ctx,
            charge_id=fc.charge.id,
            amount_cents=fc.charge.amount_cents,
            idempotency_key=f"late-refund-{payment.id}",
        )
    except CloverError as error:
        # Never lose track of money: leave it flagged for staff.
        _event(
            fc.session,
            payment,
            "refund_failed",
            notes=f"Automatic refund failed ({error.message}). Refund charge {fc.charge.id} in Clover.",
            reference=fc.charge.id,
        )
        await fc.session.commit()
        raise api_exception(
            502,
            "payment_processor_error",
            "Your card was charged but we couldn't complete the booking or refund it automatically. "
            "The business has been alerted and will sort it out.",
        ) from error

    payment.status = "refunded"
    payment.deposit_status = "refunded"
    _event(fc.session, payment, event_kind, notes=f"{reason} Refunded via Clover (refund {refund.id}).", reference=refund.id)
    await record_audit(
        fc.session,
        tenant_id=fc.tenant_id,
        entity_type="payment",
        entity_id=payment.id,
        action=event_kind,
        notes=reason,
    )
    await fc.session.commit()
    raise PaymentRefunded(
        status_code=409,
        detail={
            "code": "payment_refunded",
            "message": f"{reason} Your card was not charged — the payment has been refunded.",
            "issues": [],
        },
    )


async def _reclaim_expired_slot(session: AsyncSession, draft: BookingDraft) -> bool:
    """A payment arrived after the hold lapsed. Take the slot back if nobody else did."""
    service = draft.service
    block_start = _ensure_aware(draft.starts_at) - timedelta(minutes=service.setup_buffer_minutes)
    block_end = _ensure_aware(draft.ends_at) + timedelta(minutes=service.cleanup_buffer_minutes)
    now = datetime.now(timezone.utc)

    booked = await session.scalar(
        select(Booking.id)
        .where(
            Booking.tenant_id == draft.tenant_id,
            Booking.provider_id == draft.provider_id,
            Booking.status.in_(("confirmed", "completed")),
            Booking.starts_at < block_end,
            Booking.ends_at > block_start,
        )
        .limit(1)
    )
    if booked is not None:
        return False
    held = await session.scalar(
        select(SlotHold.id)
        .where(
            SlotHold.tenant_id == draft.tenant_id,
            SlotHold.provider_id == draft.provider_id,
            SlotHold.booking_draft_id != draft.id,
            SlotHold.expires_at > now,
            SlotHold.starts_at < block_end,
            SlotHold.ends_at > block_start,
        )
        .limit(1)
    )
    if held is not None:
        return False
    picks = await reserve_resources(session, draft.tenant_id, draft.service_id, draft.location_id, block_start, block_end)
    if picks is None:
        return False
    for resource_id, quantity in picks:
        session.add(
            ResourceAllocation(
                tenant_id=draft.tenant_id,
                resource_id=resource_id,
                booking_draft_id=draft.id,
                quantity=quantity,
                starts_at=block_start,
                ends_at=block_end,
            )
        )
    return True


async def _ready_draft(fc: Finish, draft: BookingDraft, payment: Payment) -> None:
    """Make sure the draft can still become a booking, or refund the charge."""
    if draft.confirmed_booking_id is not None:
        await _refund_unusable_charge(
            fc, event_kind="late_payment_refunded", reason="This appointment was already booked and paid for."
        )
    if draft.status in ACTIVE_DRAFT_STATUSES:
        return
    if draft.status == "expired":
        if await _reclaim_expired_slot(fc.session, draft):
            _event(fc.session, payment, "late_payment_confirmed", notes="Paid after the hold expired; the slot was still free.")
            return
        await _refund_unusable_charge(
            fc,
            event_kind="late_payment_refunded",
            reason="The held time slot expired and was taken by someone else before the payment arrived.",
        )
    await _refund_unusable_charge(
        fc, event_kind="late_payment_refunded", reason="The business released this held time slot before the payment arrived."
    )


# ---------------------------------------------------------------------------
# Finalizers
# ---------------------------------------------------------------------------


async def _after_deposit_booking(fc: Finish, summary: BookingSummaryResponse) -> BookingSummaryResponse:
    booking = await _load_booking(fc.session, summary.id, fc.tenant_id)
    await send_booking_confirmation(fc.session, booking, actor=fc.actor)
    fc.session.expire_all()
    return booking_to_summary(await _load_booking(fc.session, summary.id, fc.tenant_id))


def _processor_fields(fc: Finish, channel: str) -> dict[str, object]:
    return {
        "processor": PROCESSOR,
        "processor_channel": channel,
        "processor_merchant_id": fc.ctx.merchant_id,
        "processor_payment_id": fc.charge.id,
        "card_brand": fc.charge.card_brand,
        "card_last4": fc.charge.last4,
    }


async def _finish_online_deposit(fc: Finish) -> BookingSummaryResponse:
    payment = await _load_payment_locked(fc.session, fc.tenant_id, fc.payment_id)
    draft = await _load_booking_draft(fc.session, payment.booking_draft_id or "", fc.tenant_id, for_update=True)
    await _ready_draft(fc, draft, payment)
    # A staff draft paid through a link: forms become due before the visit.
    if draft.booking_method == "staff_entered" and _has_pending_pre_booking_requirements(draft):
        await _upsert_intake_plan(fc.session, fc.tenant, draft, "before_visit")
        if draft.status == "awaiting_form":
            guard_transition("booking_draft", draft.id, draft.status, "awaiting_payment")
            draft.status = "awaiting_payment"
    summary = await _complete_deposit_checkout_payment(
        fc.session,
        tenant_slug=fc.tenant_slug,
        payment=payment,
        completion_note="Deposit paid by card through Clover.",
        captured=True,
    )
    return await _after_deposit_booking(fc, summary)


async def _finish_online_balance(fc: Finish) -> BookingSummaryResponse:
    payment = await _load_payment_locked(fc.session, fc.tenant_id, fc.payment_id)
    booking = await _load_booking(fc.session, payment.booking_id or "", fc.tenant_id)
    if booking.status not in {"confirmed", "completed"} or booking_balance_due_cents(booking) != payment.amount_cents:
        await _refund_unusable_charge(
            fc, event_kind="late_payment_refunded", reason="The balance on this booking changed before the payment arrived."
        )
    return await _complete_booking_balance_checkout_payment(
        fc.session,
        tenant_slug=fc.tenant_slug,
        payment=payment,
        completion_note="Balance paid by card through Clover.",
        captured=True,
    )


def _staff_draft_finisher(amount_mode: str) -> Finalizer:
    async def finish(fc: Finish) -> BookingSummaryResponse:
        payment = await _load_payment_locked(fc.session, fc.tenant_id, fc.payment_id)
        draft = await _load_booking_draft(fc.session, payment.booking_draft_id or "", fc.tenant_id, for_update=True)
        await _ready_draft(fc, draft, payment)
        return await confirm_staff_draft(
            fc.session,
            fc.tenant,
            draft,
            method="card",
            amount_mode=amount_mode,
            amount_cents=payment.amount_cents,
            tip_cents=payment.tip_cents,
            reference=fc.charge.id[:128],
            notes=None,
            actor=fc.actor,  # type: ignore[arg-type]  (staff paths always have an actor)
            processor_fields=_processor_fields(fc, "moto"),
            event_note="Card entered by staff (Clover phone order).",
            payment=payment,
        )

    return finish


async def _finish_staff_balance(fc: Finish) -> BookingSummaryResponse:
    from app.services.bookings import record_booking_payment

    payment = await _load_payment_locked(fc.session, fc.tenant_id, fc.payment_id)
    booking = await _load_booking(fc.session, payment.booking_id or "", fc.tenant_id)
    if booking.status not in {"confirmed", "completed"} or booking_balance_due_cents(booking) != payment.amount_cents - payment.tip_cents:
        await _refund_unusable_charge(
            fc, event_kind="late_payment_refunded", reason="The balance on this booking changed before the payment arrived."
        )
    return await record_booking_payment(
        fc.session,
        fc.tenant,
        booking,
        method="card",
        amount_cents=payment.amount_cents,
        tip_cents=payment.tip_cents,
        reference=fc.charge.id[:128],
        notes=None,
        actor=fc.actor,  # type: ignore[arg-type]
        processor_fields=_processor_fields(fc, "moto"),
        event_note="Card entered by staff (Clover phone order).",
        payment=payment,
    )


# ---------------------------------------------------------------------------
# The charge itself
# ---------------------------------------------------------------------------


async def _reset_to_pending(session: AsyncSession, tenant_id: str, payment_id: str, kind: str, **event: object) -> None:
    payment = await _load_payment_locked(session, tenant_id, payment_id)
    if payment.status == "processing":
        payment.status = "pending"
    _event(session, payment, kind, **event)  # type: ignore[arg-type]
    await session.commit()


async def _run_card_charge(
    session: AsyncSession,
    *,
    tenant: Tenant,
    payment_id: str,
    ecomind: str,
    source_token: str,
    attempt_id: str,
    client_ip: str | None,
    actor: User | None,
    actor_type: str | None,
    precheck: Precheck,
    finalize: Finalizer,
    metadata: dict[str, str],
) -> BookingSummaryResponse:
    tenant_id = tenant.id
    payment = await _load_payment_locked(session, tenant_id, payment_id)

    if payment.status == "succeeded" and payment.booking_id:
        return booking_to_summary(await _load_booking(session, payment.booking_id, tenant_id))
    if payment.status in {"canceled", "refunded", "failed"}:
        raise api_exception(409, "conflict", "This payment is no longer open. Start a new one.")

    key = f"{payment.id}:{attempt_id}"
    retry_of_same_attempt = payment.status == "processing" and payment.charge_attempt_key == key
    if payment.status == "processing" and not retry_of_same_attempt:
        raise api_exception(409, "payment_in_progress", "A payment for this booking is already being processed. Try again in a minute.")

    if sum(1 for event in payment.events if event.kind == "charge_declined") >= MAX_DECLINES:
        payment.status = "canceled"
        _event(session, payment, "checkout_expired", notes="Locked after too many declined attempts.")
        await session.commit()
        raise api_exception(429, "too_many_attempts", "Too many declined attempts. Please contact the business to pay.")

    ctx = await get_clover_context(tenant_id)  # own sessions; may ask the owner to reconnect

    amount_cents = payment.amount_cents
    currency = payment.currency
    if not retry_of_same_attempt:
        await precheck(session, payment)
        payment.status = "processing"
        payment.charge_attempt_key = key
        _event(session, payment, "charge_attempted", notes=f"Card charge started ({ecomind}).", actor=actor, actor_type=actor_type)
        await session.commit()

    try:
        charge = await clover_client.create_charge(
            ctx,
            amount_cents=amount_cents,
            currency=currency,
            source_token=source_token,
            ecomind=ecomind,
            idempotency_key=key,
            client_ip=client_ip,
            metadata=metadata,
        )
    except CloverDeclined as error:
        await _reset_to_pending(session, tenant_id, payment_id, "charge_declined", notes=error.message, reference=error.code, actor_type=actor_type)
        raise api_exception(402, "card_declined", error.message or "Your card was declined.") from error
    except CloverOutcomeUnknown as error:
        # Leave it "processing": the retry carries the same key, so Clover
        # returns the original result instead of charging again.
        payment = await _load_payment_locked(session, tenant_id, payment_id)
        _event(session, payment, "charge_outcome_unknown", notes=error.message)
        await session.commit()
        raise api_exception(
            503,
            "payment_outcome_unknown",
            "We couldn't confirm whether the payment went through. Please try again in a moment — you will not be charged twice.",
        ) from error
    except CloverAuthError as error:
        await mark_connection_needs_reauth(tenant_id, error.message)
        await _reset_to_pending(session, tenant_id, payment_id, "charge_declined", notes="Clover rejected our connection.")
        raise api_exception(503, "service_unavailable", "Card payments are temporarily unavailable. Please contact the business.") from error
    except CloverError as error:
        await _reset_to_pending(session, tenant_id, payment_id, "charge_declined", notes=error.message)
        raise api_exception(502, "payment_processor_error", error.message) from error

    # The money is taken. Record that first, in its own commit.
    payment = await _load_payment_locked(session, tenant_id, payment_id)
    payment.processor = PROCESSOR
    payment.processor_merchant_id = ctx.merchant_id
    payment.processor_payment_id = charge.id
    payment.card_brand = charge.card_brand
    payment.card_last4 = charge.last4
    _event(session, payment, "charge_succeeded", notes="Clover accepted the card.", reference=charge.id, actor=actor, actor_type=actor_type)
    await session.commit()

    fc = Finish(session=session, tenant=tenant, tenant_id=tenant_id, tenant_slug=tenant.slug, payment_id=payment_id, ctx=ctx, charge=charge, actor=actor)
    try:
        return await finalize(fc)
    except PaymentRefunded:
        raise
    except HTTPException as error:
        # Money taken but the booking can't be completed: give it back.
        message = error.detail.get("message") if isinstance(error.detail, dict) else None
        await session.rollback()
        await _refund_unusable_charge(
            fc, event_kind="late_payment_refunded", reason=message or "The booking could not be completed."
        )
        raise  # unreachable: _refund_unusable_charge always raises


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


async def charge_checkout_session(
    session: AsyncSession,
    tenant_slug: str,
    session_id: str,
    payload: CardChargeRequest,
    client_ip: str | None,
) -> BookingSummaryResponse:
    """A client pays their deposit or balance on the payment page."""
    tenant = await get_tenant_by_slug(session, tenant_slug)
    request = await _load_checkout_payment(session, tenant_id=tenant.id, session_id=session_id)
    if request.processor != PROCESSOR:
        raise api_exception(409, "conflict", "This payment page doesn't take Clover card payments.")
    kind = request.checkout_session_kind

    async def precheck(inner: AsyncSession, payment: Payment) -> None:
        if kind == "deposit":
            draft = await _load_booking_draft(inner, payment.booking_draft_id or "", tenant.id)
            if draft.confirmed_booking_id is not None:
                raise api_exception(409, "conflict", "This booking has already been confirmed.")
            _ensure_not_expired(draft)
            if draft.customer_id is None:
                raise api_exception(400, "bad_request", "Customer details are required before payment.")
            if draft.booking_method != "staff_entered" and _has_pending_pre_booking_requirements(draft):
                raise api_exception(400, "bad_request", "Complete the required forms before payment.")
            if payment.amount_cents != draft.deposit_cents or draft.deposit_cents <= 0:
                raise api_exception(409, "conflict", "The deposit changed. Open a new payment link.")
            if _hold_seconds_left(draft) < MIN_HOLD_SECONDS:
                raise api_exception(409, "conflict", "This held time slot is about to expire. Start the booking again.")
        else:
            booking = await _load_booking(inner, payment.booking_id or "", tenant.id)
            if booking.status not in {"confirmed", "completed"}:
                raise api_exception(409, "conflict", "This booking can no longer accept a payment.")
            if booking_balance_due_cents(booking) != payment.amount_cents:
                raise api_exception(409, "conflict", "The balance changed. Open a new payment link.")

    return await _run_card_charge(
        session,
        tenant=tenant,
        payment_id=request.id,
        ecomind="ecom",
        source_token=payload.source_token,
        attempt_id=payload.attempt_id,
        client_ip=client_ip,
        actor=None,
        actor_type="customer",
        precheck=precheck,
        finalize=_finish_online_deposit if kind == "deposit" else _finish_online_balance,
        metadata={"tenant": tenant.slug, "paymentId": request.id, "kind": kind or ""},
    )


async def charge_staff_draft(
    session: AsyncSession,
    tenant_slug: str,
    booking_draft_id: str,
    payload: StaffDraftCardChargeRequest,
    actor: User,
    client_ip: str | None,
) -> BookingSummaryResponse:
    """Staff type the card a client reads out over the phone."""
    tenant = await get_tenant_by_slug(session, tenant_slug)
    draft = await _load_booking_draft(session, booking_draft_id, tenant.id)
    if draft.confirmed_booking_id is not None:
        booking = await _load_booking(session, draft.confirmed_booking_id, tenant.id)
        return booking_to_summary(booking)
    _ensure_not_expired(draft)
    if draft.customer_id is None or draft.customer is None:
        raise api_exception(400, "bad_request", "Add the client before taking payment.")

    amounts = staff_draft_amounts(draft)
    visit_cents = amounts.deposit_cents if payload.amount_mode == "deposit" else amounts.full_cents
    check_staff_draft_amount(
        draft,
        amount_mode=payload.amount_mode,
        amount_cents=visit_cents + payload.tip_cents,
        tip_cents=payload.tip_cents,
    )
    total_cents = visit_cents + payload.tip_cents
    full_mode = payload.amount_mode == "full"

    # One open row per draft, so declines and retries share a counter.
    payment = await session.scalar(
        select(Payment).where(
            Payment.tenant_id == tenant.id,
            Payment.booking_draft_id == draft.id,
            Payment.processor == PROCESSOR,
            Payment.processor_channel == "moto",
            Payment.status.in_(("pending", "processing")),
        )
    )
    if payment is not None and payment.status == "processing" and payment.amount_cents != total_cents:
        raise api_exception(409, "payment_in_progress", "A card payment for this booking is already in progress.")
    if payment is None:
        payment = Payment(
            tenant_id=tenant.id,
            booking_draft_id=draft.id,
            customer_id=draft.customer_id,
            status="pending",
            deposit_status="unpaid",
            amount_cents=total_cents,
            tip_cents=payload.tip_cents,
            currency=tenant_currency(tenant),
            payment_method_type="card",
            processor=PROCESSOR,
            processor_channel="moto",
            checkout_session_kind="admin_completion" if full_mode else "deposit_in_person",
            checkout_session_id=str(uuid4()),
        )
        session.add(payment)
    else:
        payment.amount_cents = total_cents
        payment.tip_cents = payload.tip_cents
        payment.checkout_session_kind = "admin_completion" if full_mode else "deposit_in_person"
    await session.commit()
    payment_id = payment.id

    async def precheck(inner: AsyncSession, locked: Payment) -> None:
        current = await _load_booking_draft(inner, booking_draft_id, tenant.id)
        if current.confirmed_booking_id is not None:
            raise api_exception(409, "conflict", "This booking has already been confirmed.")
        _ensure_not_expired(current)
        if _hold_seconds_left(current) < MIN_HOLD_SECONDS:
            raise api_exception(409, "conflict", "The hold is about to expire. Book the slot again.")

    return await _run_card_charge(
        session,
        tenant=tenant,
        payment_id=payment_id,
        ecomind="moto",
        source_token=payload.source_token,
        attempt_id=payload.attempt_id,
        client_ip=client_ip,
        actor=actor,
        actor_type=None,
        precheck=precheck,
        finalize=_staff_draft_finisher(payload.amount_mode),
        metadata={"tenant": tenant.slug, "paymentId": payment_id, "draftId": draft.id, "by": actor.id},
    )


async def charge_staff_booking_balance(
    session: AsyncSession,
    tenant_slug: str,
    booking_id: str,
    payload: StaffBalanceCardChargeRequest,
    actor: User,
    client_ip: str | None,
) -> BookingSummaryResponse:
    """Staff type a client's card to settle a booking's balance."""
    tenant = await get_tenant_by_slug(session, tenant_slug)
    booking = await _load_booking(session, booking_id, tenant.id)
    if booking.status not in {"confirmed", "completed"}:
        raise api_exception(409, "conflict", "Payments can only be added to confirmed or completed bookings.")
    balance = booking_balance_due_cents(booking)
    if balance <= 0:
        raise api_exception(409, "conflict", "This booking has no balance due.")
    total_cents = balance + payload.tip_cents

    payment = await session.scalar(
        select(Payment).where(
            Payment.tenant_id == tenant.id,
            Payment.booking_id == booking.id,
            Payment.processor == PROCESSOR,
            Payment.processor_channel == "moto",
            Payment.status.in_(("pending", "processing")),
        )
    )
    if payment is not None and payment.status == "processing" and payment.amount_cents != total_cents:
        raise api_exception(409, "payment_in_progress", "A card payment for this booking is already in progress.")
    if payment is None:
        payment = Payment(
            tenant_id=tenant.id,
            booking_id=booking.id,
            customer_id=booking.customer_id,
            status="pending",
            deposit_status=booking.deposit_status,
            amount_cents=total_cents,
            tip_cents=payload.tip_cents,
            currency=tenant_currency(tenant),
            payment_method_type="card",
            processor=PROCESSOR,
            processor_channel="moto",
            checkout_session_kind="admin_completion",
            checkout_session_id=str(uuid4()),
        )
        session.add(payment)
    else:
        payment.amount_cents = total_cents
        payment.tip_cents = payload.tip_cents
    await session.commit()
    payment_id = payment.id

    async def precheck(inner: AsyncSession, locked: Payment) -> None:
        current = await _load_booking(inner, booking_id, tenant.id)
        if current.status not in {"confirmed", "completed"}:
            raise api_exception(409, "conflict", "This booking can no longer accept a payment.")
        if booking_balance_due_cents(current) != locked.amount_cents - locked.tip_cents:
            raise api_exception(409, "conflict", "The balance changed. Check the amount and try again.")

    return await _run_card_charge(
        session,
        tenant=tenant,
        payment_id=payment_id,
        ecomind="moto",
        source_token=payload.source_token,
        attempt_id=payload.attempt_id,
        client_ip=client_ip,
        actor=actor,
        actor_type=None,
        precheck=precheck,
        finalize=_finish_staff_balance,
        metadata={"tenant": tenant.slug, "paymentId": payment_id, "bookingId": booking.id, "by": actor.id},
    )


async def get_checkout_session_view(session: AsyncSession, tenant_slug: str, session_id: str):
    """What the payment page shows. The session id is the (unguessable) access key."""
    from app.schemas.payments import CheckoutSessionViewResponse
    from app.services.payment_processor import is_stripe_checkout_session_id

    tenant = await get_tenant_by_slug(session, tenant_slug)
    payment = await _load_checkout_payment(session, tenant_id=tenant.id, session_id=session_id)
    if payment.booking_draft_id is not None:
        draft = await _load_booking_draft(session, payment.booking_draft_id, tenant.id)
        service_name, starts_at = draft.service.name, draft.starts_at
        # A hold that lapsed while the page was open reads as expired, not payable.
        status = payment.status
        if status in {"pending", "processing"} and (
            draft.status in {"expired", "canceled"}
            or (draft.confirmed_booking_id is None and _ensure_aware(draft.expires_at) <= datetime.now(timezone.utc))
        ):
            status = "expired"
        booking_id = draft.confirmed_booking_id or payment.booking_id
    else:
        booking = await _load_booking(session, payment.booking_id or "", tenant.id)
        service_name, starts_at = booking.service.name, booking.starts_at
        status, booking_id = payment.status, booking.id

    if payment.processor:
        processor = payment.processor
    else:
        processor = "stripe" if is_stripe_checkout_session_id(payment.checkout_session_id) else "simulated"
    return CheckoutSessionViewResponse(
        session_id=session_id,
        kind=payment.checkout_session_kind or "deposit",
        status=status,
        amount_cents=payment.amount_cents,
        currency=payment.currency,
        expires_at=payment.checkout_expires_at,
        processor=processor,
        service_name=service_name,
        starts_at=starts_at,
        booking_id=booking_id if status == "succeeded" else None,
        booking_draft_id=payment.booking_draft_id,
    )
