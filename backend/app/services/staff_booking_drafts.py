"""Staff-side payment collection for calendar booking drafts.

A staff draft holds a slot until the customer pays. This module confirms the
draft when staff record a payment taken in person, e.g. on an unconnected
POS terminal (Clover, Moneris) or in cash.

Rules:
- The amount must be exact: the deposit, or the full visit total (price +
  add-ons + tax). A tip is only allowed when the full amount is paid.
- POS payments need a reference (receipt/approval number or card last 4) so
  the record can be matched to the terminal.
- Pending customer pre-booking forms move to "before the visit" instead of
  blocking the walk-in; the customer gets a link to complete them.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.http import api_exception
from app.db.models import BookingDraft, Payment, Tenant, User
from app.schemas.booking_drafts import ConfirmWithPaymentRequest
from app.schemas.bookings import BookingSummaryResponse
from app.services.booking_drafts import (
    _clean_text,
    _ensure_not_expired,
    _has_pending_pre_booking_requirements,
    _load_booking,
    _load_booking_draft,
    _promote_draft_to_booking,
    _upsert_intake_plan,
)
from app.services.presenters import booking_draft_amounts, booking_to_summary
from app.services.state_machine import guard_transition
from app.services.tenants import get_tenant_by_slug, tenant_currency

# Card payments must go through the processor (card form or payment link),
# never be "recorded" by hand.
_DISALLOWED_IN_PERSON_METHODS = frozenset({"card", "wallet", "stripe"})


@dataclass(frozen=True)
class DraftAmounts:
    deposit_cents: int
    subtotal_cents: int
    tax_cents: int
    full_cents: int


def staff_draft_amounts(draft: BookingDraft) -> DraftAmounts:
    """Deposit and full visit total for a draft, matching the booking's math."""
    subtotal, tax, full = booking_draft_amounts(draft)
    return DraftAmounts(deposit_cents=draft.deposit_cents, subtotal_cents=subtotal, tax_cents=tax, full_cents=full)


def _money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def check_staff_draft_amount(
    draft: BookingDraft,
    *,
    amount_mode: str,
    amount_cents: int,
    tip_cents: int,
    allow_tip_on_deposit: bool = False,
) -> None:
    """The amount before tip must be exactly the deposit or the full visit.

    Shared by every way of paying in person (typed POS receipt, Clover device
    payment) so they can never disagree about what "exact" means.
    """
    amounts = staff_draft_amounts(draft)
    if amount_mode == "deposit":
        if tip_cents and not allow_tip_on_deposit:
            raise api_exception(422, "validation_error", "A tip can only be added when the full amount is paid.")
        if amounts.deposit_cents <= 0:
            raise api_exception(
                409,
                "conflict",
                "This service has no deposit. Record the full amount instead.",
            )
        expected_cents = amounts.deposit_cents
    else:
        expected_cents = amounts.full_cents

    paid_toward_visit = amount_cents - tip_cents
    if tip_cents < 0 or paid_toward_visit != expected_cents:
        label = "deposit" if amount_mode == "deposit" else "full amount"
        raise api_exception(
            409,
            "conflict",
            f"The {label} is exactly {_money(expected_cents)}"
            + (" (plus any tip)" if amount_mode == "full" else "")
            + f". You entered {_money(paid_toward_visit)}.",
        )


async def load_staff_draft_for_payment(
    session: AsyncSession, tenant_slug: str, booking_draft_id: str
) -> tuple[Tenant, BookingDraft, BookingSummaryResponse | None]:
    """Lock the draft and return it, or the booking it already became (replay)."""
    tenant = await get_tenant_by_slug(session, tenant_slug)
    draft = await _load_booking_draft(session, booking_draft_id, tenant.id, for_update=True)

    # Idempotent replay: the same request after success returns the booking.
    if draft.confirmed_booking_id is not None:
        booking = await _load_booking(session, draft.confirmed_booking_id, tenant.id)
        return tenant, draft, booking_to_summary(booking)

    _ensure_not_expired(draft)
    if draft.customer_id is None or draft.customer is None:
        raise api_exception(400, "bad_request", "Add the client before taking payment.")
    return tenant, draft, None


async def confirm_staff_draft(
    session: AsyncSession,
    tenant: Tenant,
    draft: BookingDraft,
    *,
    method: str,
    amount_mode: str,
    amount_cents: int,
    tip_cents: int,
    reference: str | None,
    notes: str | None,
    actor: User,
    processor_fields: dict[str, object] | None = None,
    event_note: str | None = None,
    payment: Payment | None = None,
    send_confirmation: bool = True,
) -> BookingSummaryResponse:
    """Promote a held draft to a confirmed booking with its payment recorded.

    Pass `payment` to complete a payment row that already exists (a card charge
    creates its row before calling the processor) instead of creating one.

    The caller has already validated the amount (check_staff_draft_amount) and
    the payment itself. `processor_fields` are extra Payment columns for
    processor-taken payments (processor, channel, merchant, payment id, card).
    """
    from app.services.booking_notifications import send_booking_confirmation
    from app.services.bookings import _append_payment_event, _apply_payment_resolution

    # Customer pre-booking forms don't block an in-person booking: they become
    # due before the visit and the customer is sent a link.
    forms_deferred = _has_pending_pre_booking_requirements(draft)
    if forms_deferred:
        await _upsert_intake_plan(session, tenant, draft, "before_visit")
    if draft.status == "awaiting_form":
        guard_transition("booking_draft", draft.id, draft.status, "awaiting_payment")
        draft.status = "awaiting_payment"

    full_mode = amount_mode == "full"
    booking = await _promote_draft_to_booking(
        session,
        draft,
        deposit_status="paid",
        payment_resolution="pending",
        event_kind="admin_completion" if full_mode else "deposit_collected_in_person",
        event_amount_cents=amount_cents,
        event_payload={
            "actorType": "user",
            "actorId": actor.id,
            "actorLabel": actor.name,
            "bookingDraftId": draft.id,
            "bookingMethod": draft.booking_method,
            "paymentMethodType": method,
            "amountMode": amount_mode,
            "tipCents": tip_cents,
            "externalReference": reference,
            "formsDeferredToBeforeVisit": forms_deferred,
            "notes": notes,
            **{key: value for key, value in (processor_fields or {}).items() if key in {"processor", "processor_channel"}},
        },
    )

    values = dict(
        status="succeeded",
        deposit_status="paid_in_full" if full_mode else "paid",
        amount_cents=amount_cents,
        tip_cents=tip_cents,
        currency=tenant_currency(tenant),
        payment_method_type=method,
        checkout_session_kind="admin_completion" if full_mode else "deposit_in_person",
        external_reference=reference,
        **(processor_fields or {}),
    )
    if payment is None:
        payment = Payment(tenant_id=booking.tenant_id, booking=booking, customer_id=booking.customer_id, **values)
        session.add(payment)
    else:
        payment.booking = booking
        for key, value in values.items():
            setattr(payment, key, value)
    await session.flush()

    event_notes = " · ".join(
        part
        for part in (
            event_note,
            f"Ref {reference}" if reference else None,
            notes,
            "Deposit collected in person." if not full_mode else "Paid in full in person.",
        )
        if part
    )
    _append_payment_event(
        session,
        payment,
        kind="payment_recorded",
        actor=actor,
        amount_cents=amount_cents,
        notes=event_notes,
    )

    if full_mode:
        _apply_payment_resolution(booking, "collected")

    booking_id = booking.id
    tenant_id = tenant.id
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        # The unique (processor, merchant, payment id) index: one processor
        # payment can pay for only one booking.
        raise api_exception(409, "conflict", "This payment is already linked to another booking.") from error
    session.expire_all()

    hydrated = await _load_booking(session, booking_id, tenant_id)
    if send_confirmation:
        await session.refresh(actor)  # expired above; the audit trail reads it
        await send_booking_confirmation(session, hydrated, actor=actor)
        session.expire_all()
        hydrated = await _load_booking(session, booking_id, tenant_id)
    return booking_to_summary(hydrated)


async def confirm_staff_draft_with_payment(
    session: AsyncSession,
    tenant_slug: str,
    booking_draft_id: str,
    payload: ConfirmWithPaymentRequest,
    actor: User,
) -> BookingSummaryResponse:
    """Confirm a held draft after staff record an in-person payment (POS receipt, cash...)."""
    from app.services.bookings import _validate_payment_method

    tenant, draft, replay = await load_staff_draft_for_payment(session, tenant_slug, booking_draft_id)
    if replay is not None:
        return replay

    method = payload.payment_method_type.strip()
    if method in _DISALLOWED_IN_PERSON_METHODS:
        raise api_exception(
            422,
            "validation_error",
            "Card payments are taken with the secure card form or a payment link, not recorded by hand.",
        )
    _validate_payment_method(tenant, method)

    reference = _clean_text(payload.external_reference)
    if method == "external_pos" and reference is None:
        raise api_exception(
            422,
            "validation_error",
            "Enter the POS receipt or approval number (or card last 4) for an external POS payment.",
        )

    check_staff_draft_amount(
        draft, amount_mode=payload.amount_mode, amount_cents=payload.amount_cents, tip_cents=payload.tip_cents
    )
    return await confirm_staff_draft(
        session,
        tenant,
        draft,
        method=method,
        amount_mode=payload.amount_mode,
        amount_cents=payload.amount_cents,
        tip_cents=payload.tip_cents,
        reference=reference,
        notes=_clean_text(payload.notes),
        actor=actor,
    )


async def confirm_staff_draft_without_payment(
    session: AsyncSession,
    tenant_slug: str,
    booking_draft_id: str,
    actor: User,
) -> BookingSummaryResponse:
    """Confirm a held draft for a service that takes no deposit.

    The visit is still paid for later at checkout, so the booking stays
    `pending` collection (not waived). Services with a deposit can't use this.
    """
    from app.services.booking_notifications import send_booking_confirmation

    tenant, draft, replay = await load_staff_draft_for_payment(session, tenant_slug, booking_draft_id)
    if replay is not None:
        return replay
    if draft.deposit_cents > 0:
        raise api_exception(
            409,
            "conflict",
            "This service requires a deposit. Take the payment to confirm the booking.",
        )

    forms_deferred = _has_pending_pre_booking_requirements(draft)
    if forms_deferred:
        await _upsert_intake_plan(session, tenant, draft, "before_visit")
    if draft.status == "awaiting_form":
        guard_transition("booking_draft", draft.id, draft.status, "awaiting_payment")
        draft.status = "awaiting_payment"

    booking = await _promote_draft_to_booking(
        session,
        draft,
        deposit_status="not_required",
        payment_resolution="pending",
        event_kind="deposit_not_required",
        event_amount_cents=0,
        event_payload={
            "actorType": "user",
            "actorId": actor.id,
            "actorLabel": actor.name,
            "bookingDraftId": draft.id,
            "bookingMethod": draft.booking_method,
            "formsDeferredToBeforeVisit": forms_deferred,
        },
    )
    booking_id = booking.id
    tenant_id = tenant.id
    await session.commit()
    session.expire_all()

    hydrated = await _load_booking(session, booking_id, tenant_id)
    await session.refresh(actor)
    await send_booking_confirmation(session, hydrated, actor=actor)
    session.expire_all()
    return booking_to_summary(await _load_booking(session, booking_id, tenant_id))
