from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import Booking, BookingDraft, BookingPaymentEvent, Payment, PaymentEvent, Provider, Service, Tenant, User
from app.schemas.bookings import BookingListResponse, BookingSummaryResponse, CancelBookingRequest, PaginationMetaResponse, UpdateBookingRequest, UpdateBookingStatusRequest
from app.schemas.payments import ApplyWalletCreditRequest, RecordManualPaymentRequest, RefundPaymentRequest
from app.services.booking_drafts import _cancellation_policy_for_booking, _load_booking
from app.services.payment_processor import charge_stripe_no_show_fee, refund_payment_via_processor
from app.services.presenters import booking_balance_due_cents, booking_to_summary

logger = logging.getLogger(__name__)
from app.services.state_machine import guard_transition
from app.services.wallet import record_wallet_transaction


def _clean_notes(notes: str | None) -> str | None:
    if notes is None:
        return None
    cleaned = notes.strip()
    return cleaned or None


def _append_payment_event(
    session: AsyncSession,
    payment: Payment,
    *,
    kind: str,
    actor: User,
    amount_cents: int | None = None,
    notes: str | None = None,
) -> None:
    session.add(
        PaymentEvent(
            tenant_id=payment.tenant_id,
            payment_id=payment.id,
            kind=kind,
            actor_type="user",
            actor_id=actor.id,
            display_name=actor.name,
            occurred_at=datetime.now(timezone.utc),
            amount_cents=amount_cents,
            notes=notes,
        )
    )


def _append_booking_event(
    session: AsyncSession,
    booking: Booking,
    *,
    event_kind: str,
    actor: User,
    amount_cents: int = 0,
    notes: str | None = None,
    extra_payload: dict[str, object] | None = None,
) -> None:
    payload: dict[str, object] = {
        "actorType": "user",
        "actorId": actor.id,
        "actorLabel": actor.name,
    }
    if notes is not None:
        payload["notes"] = notes
    if extra_payload is not None:
        payload.update(extra_payload)

    session.add(
        BookingPaymentEvent(
            tenant_id=booking.tenant_id,
            booking_id=booking.id,
            event_kind=event_kind,
            amount_cents=amount_cents,
            payload_json=payload,
        )
    )


async def _load_tenant(session: AsyncSession, tenant_slug: str) -> Tenant:
    tenant = await session.scalar(select(Tenant).where(Tenant.slug == tenant_slug))
    if tenant is None:
        raise api_exception(404, "not_found", "Tenant was not found.")
    return tenant


def _booking_query_options():
    return (
        selectinload(Booking.tenant),
        selectinload(Booking.service).selectinload(Service.location_links),
        selectinload(Booking.provider).selectinload(Provider.location_links),
        selectinload(Booking.provider).selectinload(Provider.service_links),
        selectinload(Booking.customer),
        selectinload(Booking.payments).selectinload(Payment.events),
        selectinload(Booking.source_draft).selectinload(BookingDraft.intake_plan),
    )


_BUILTIN_PAYMENT_METHODS = frozenset({"cash", "external_pos", "manual", "card"})


def _validate_payment_method(tenant: Tenant, method: str) -> None:
    if method in _BUILTIN_PAYMENT_METHODS:
        return
    custom_methods = tenant.settings_json.get("customPaymentMethods", [])
    valid_ids = {m["id"] for m in custom_methods if isinstance(m, dict) and "id" in m}
    if method not in valid_ids:
        raise api_exception(422, "validation_error", f"Unknown payment method: {method}")


def _apply_payment_resolution(booking: Booking, payment_resolution: str) -> None:
    booking.payment_resolution = payment_resolution

    if payment_resolution == "follow_up":
        booking.deposit_status = "follow_up"
        return

    if booking.service.price_cents == 0 and payment_resolution == "collected":
        booking.deposit_status = "not_required"
        return

    booking.deposit_status = "paid_in_full"


async def list_bookings(
    session: AsyncSession,
    tenant_slug: str,
    *,
    status_filters: list[str] | None,
    starts_at_gte: datetime | None,
    starts_at_lte: datetime | None,
    provider_id: str | None,
    customer_id: str | None,
    location_id: str | None,
    limit: int,
    offset: int,
) -> BookingListResponse:
    tenant = await _load_tenant(session, tenant_slug)
    filters = [Booking.tenant_id == tenant.id]

    if status_filters:
        filters.append(Booking.status.in_(status_filters))
    if starts_at_gte is not None:
        filters.append(Booking.starts_at >= starts_at_gte)
    if starts_at_lte is not None:
        filters.append(Booking.starts_at <= starts_at_lte)
    if provider_id is not None:
        filters.append(Booking.provider_id == provider_id)
    if customer_id is not None:
        filters.append(Booking.customer_id == customer_id)
    if location_id is not None:
        filters.append(Booking.location_id == location_id)

    total = await session.scalar(select(func.count()).select_from(Booking).where(*filters))
    bookings = (
        await session.scalars(
            select(Booking)
            .options(*_booking_query_options())
            .where(*filters)
            .order_by(Booking.starts_at.asc(), Booking.created_at.asc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    return BookingListResponse(
        items=[booking_to_summary(booking) for booking in bookings],
        meta=PaginationMetaResponse(limit=limit, offset=offset, total=total or 0),
    )


async def record_manual_payment(
    session: AsyncSession,
    tenant_slug: str,
    booking_id: str,
    payload: RecordManualPaymentRequest,
    actor: User,
) -> BookingSummaryResponse:
    tenant = await _load_tenant(session, tenant_slug)
    tenant_id = tenant.id
    booking = await _load_booking(session, booking_id, tenant.id)

    if booking.status not in {"confirmed", "completed"}:
        raise api_exception(409, "conflict", "Manual balance collection is only available for confirmed or completed bookings.")

    _validate_payment_method(tenant, payload.payment_method_type)

    if payload.amount_cents <= 0:
        raise api_exception(409, "conflict", "Manual payment amount must be at least 1 cent.")

    notes = _clean_notes(payload.notes)
    payment = Payment(
        tenant_id=booking.tenant_id,
        booking=booking,
        customer_id=booking.customer_id,
        status="succeeded",
        deposit_status="paid_in_full",
        amount_cents=payload.amount_cents,
        currency="USD",
        payment_method_type=payload.payment_method_type,
        checkout_session_kind=None,
    )
    session.add(payment)
    await session.flush()

    _append_payment_event(
        session,
        payment,
        kind="payment_recorded",
        actor=actor,
        amount_cents=payload.amount_cents,
        notes=notes,
    )

    new_balance_cents = booking_balance_due_cents(booking) - payload.amount_cents
    fully_paid = new_balance_cents <= 0

    _append_booking_event(
        session,
        booking,
        event_kind="admin_completion",
        actor=actor,
        amount_cents=payload.amount_cents,
        notes=notes,
        extra_payload={
            "paymentMethodType": payload.payment_method_type,
            "bookingStatus": booking.status,
            "paymentResolutionAfter": "collected" if fully_paid else "pending",
            "remainingBalanceCents": max(new_balance_cents, 0),
        },
    )

    if fully_paid:
        _apply_payment_resolution(booking, "collected")

    reload_booking_id = booking.id
    await session.commit()
    session.expire_all()
    updated_booking = await _load_booking(session, reload_booking_id, tenant_id)
    return booking_to_summary(updated_booking)


async def apply_wallet_credit(
    session: AsyncSession,
    tenant_slug: str,
    booking_id: str,
    payload: ApplyWalletCreditRequest,
    actor: User,
) -> BookingSummaryResponse:
    tenant = await _load_tenant(session, tenant_slug)
    booking = await _load_booking(session, booking_id, tenant.id)

    if booking.status not in {"confirmed", "completed"}:
        raise api_exception(409, "conflict", "Wallet credit can only be applied to confirmed or completed bookings.")

    wallet_balance = booking.customer.wallet_balance_cents
    if wallet_balance <= 0:
        raise api_exception(409, "conflict", "This customer has no wallet balance to apply.")

    apply_amount = min(payload.amount_cents, wallet_balance)

    # Deduct from wallet via ledger
    await record_wallet_transaction(
        session,
        customer=booking.customer,
        amount_cents=-apply_amount,
        kind="applied_to_booking",
        actor=actor,
        booking_id=booking.id,
        notes=f"Applied ${apply_amount / 100:.2f} wallet credit to booking.",
    )

    # Record as a payment
    payment = Payment(
        tenant_id=booking.tenant_id,
        booking=booking,
        customer_id=booking.customer_id,
        status="succeeded",
        deposit_status="paid_in_full",
        amount_cents=apply_amount,
        currency="USD",
        payment_method_type="wallet",
        checkout_session_kind=None,
    )
    session.add(payment)
    await session.flush()

    _append_payment_event(
        session,
        payment,
        kind="wallet_applied",
        actor=actor,
        amount_cents=apply_amount,
        notes=f"Applied ${apply_amount / 100:.2f} from customer wallet. Operator: {actor.name}.",
    )

    new_balance = booking_balance_due_cents(booking) - apply_amount
    fully_paid = new_balance <= 0

    _append_booking_event(
        session,
        booking,
        event_kind="admin_completion",
        actor=actor,
        amount_cents=apply_amount,
        extra_payload={
            "paymentMethodType": "wallet",
            "bookingStatus": booking.status,
            "paymentResolutionAfter": "collected" if fully_paid else "pending",
            "remainingBalanceCents": max(new_balance, 0),
        },
    )

    if fully_paid:
        _apply_payment_resolution(booking, "collected")

    reload_booking_id = booking.id
    reload_tenant_id = tenant.id
    await session.commit()
    session.expire_all()
    updated_booking = await _load_booking(session, reload_booking_id, reload_tenant_id)
    return booking_to_summary(updated_booking)


async def refund_payment(
    session: AsyncSession,
    tenant_slug: str,
    booking_id: str,
    payment_id: str,
    payload: RefundPaymentRequest,
    actor: User,
) -> BookingSummaryResponse:
    tenant = await _load_tenant(session, tenant_slug)
    booking = await _load_booking(session, booking_id, tenant.id)

    payment = next(
        (p for p in booking.payments if p.id == payment_id and p.tenant_id == tenant.id),
        None,
    )
    if payment is None:
        raise api_exception(404, "not_found", "Payment was not found on this booking.")
    if payment.status != "succeeded":
        raise api_exception(409, "conflict", "Only succeeded payments can be refunded.")
    if payment.amount_cents <= 0:
        raise api_exception(409, "conflict", "This payment has no amount to refund.")

    reason = _clean_notes(payload.reason)
    refund_amount_cents = payload.amount_cents if payload.amount_cents is not None else payment.amount_cents
    if refund_amount_cents <= 0 or refund_amount_cents > payment.amount_cents:
        raise api_exception(409, "conflict", "Refund amount must be between 1 cent and the payment amount.")
    is_partial = refund_amount_cents < payment.amount_cents
    is_wallet_payment = payment.payment_method_type == "wallet"

    if is_partial:
        # Reduce the payment amount; keep it succeeded unless fully refunded.
        payment.amount_cents -= refund_amount_cents
        if payment.amount_cents <= 0:
            payment.status = "refunded"
            payment.deposit_status = "refunded"
    else:
        payment.status = "refunded"
        payment.deposit_status = "refunded"

    # If the payment was a wallet credit application, return the funds to the wallet.
    if is_wallet_payment:
        await record_wallet_transaction(
            session,
            customer=booking.customer,
            amount_cents=refund_amount_cents,
            kind="refund_returned",
            actor=actor,
            booking_id=booking.id,
            payment_id=payment.id,
            notes=f"Wallet credit returned (${refund_amount_cents / 100:.2f})." + (f" Reason: {reason}" if reason else ""),
        )
        event_kind = "wallet_returned"
        partial_note = " (partial)" if is_partial else ""
        actor_notes = (
            f"Wallet credit returned{partial_note} (${refund_amount_cents / 100:.2f}). Operator: {actor.name}."
            + (f" Reason: {reason}" if reason else "")
        )
    else:
        event_kind = "refund_recorded"
        partial_note = " (partial)" if is_partial else ""
        actor_notes = (
            f"Refunded{partial_note} ${refund_amount_cents / 100:.2f} via {payment.payment_method_type}. Operator: {actor.name}."
            + (f" Reason: {reason}" if reason else "")
        )

    _append_payment_event(
        session,
        payment,
        kind=event_kind,
        actor=actor,
        amount_cents=refund_amount_cents,
        notes=actor_notes,
    )

    # The refund changes the balance picture; reset resolution to pending if booking was previously
    # marked collected via this payment, so operator workflow resumes.
    if booking.status == "confirmed":
        booking.payment_resolution = "pending_initial" if booking.payment_resolution == "collected" else booking.payment_resolution
        # Recompute deposit status from remaining succeeded payments.
        remaining_paid = sum(
            p.amount_cents for p in booking.payments if p.status == "succeeded" and p.id != payment.id
        )
        if remaining_paid <= 0:
            booking.deposit_status = "unpaid"
        else:
            booking.deposit_status = "paid"

    _append_booking_event(
        session,
        booking,
        event_kind="payment_refunded",
        actor=actor,
        amount_cents=refund_amount_cents,
        notes=reason,
        extra_payload={
            "paymentId": payment.id,
            "paymentMethodType": payment.payment_method_type,
            "walletReturnedCents": refund_amount_cents if is_wallet_payment else 0,
            "refundedAmountCents": refund_amount_cents,
            "isPartial": is_partial,
        },
    )

    reload_booking_id = booking.id
    tenant_id = tenant.id
    await session.commit()
    session.expire_all()
    updated_booking = await _load_booking(session, reload_booking_id, tenant_id)
    return booking_to_summary(updated_booking)


async def _deliver_post_visit_forms(session: AsyncSession, booking: Booking) -> None:
    """Create post-visit form requirements on a completed booking and notify the customer."""
    from app.core.config import get_settings
    from app.core.security import create_customer_manage_token
    from app.db.models import BookingDraftFormRequirement, ServiceFormAttachment
    from app.services.notifications import send_transactional_email
    from sqlalchemy.orm import selectinload

    attachments = (
        await session.scalars(
            select(ServiceFormAttachment)
            .options(selectinload(ServiceFormAttachment.form), selectinload(ServiceFormAttachment.form_version))
            .where(
                ServiceFormAttachment.tenant_id == booking.tenant_id,
                ServiceFormAttachment.service_id == booking.service_id,
                ServiceFormAttachment.customer_prompt_timing == "post_visit",
            )
        )
    ).all()

    for attachment in attachments:
        scope = attachment.form.scope if attachment.form is not None else "customer"
        session.add(
            BookingDraftFormRequirement(
                tenant_id=booking.tenant_id,
                booking_draft_id=None,
                booking_id=booking.id,
                form_id=attachment.form_id,
                form_version_id=attachment.form_version_id,
                scope=scope,
                customer_prompt_timing="post_visit",
                status="pending",
            )
        )

    if attachments:
        await session.commit()

        # Send email notification with the forms link
        customer = booking.customer
        if customer is not None and customer.email:
            token, _ = create_customer_manage_token({
                "bookingId": booking.id,
                "tenantId": booking.tenant_id,
            })
            settings = get_settings()
            forms_url = f"{settings.storefront_public_base_url}/forms/{token}"
            service_name = booking.service.name if booking.service is not None else "your appointment"
            customer_name = customer.name or "there"
            forms_word = "form" if len(attachments) == 1 else "forms"

            try:
                await send_transactional_email(
                    recipient_email=customer.email,
                    subject=f"Complete your post-visit {forms_word} for {service_name}",
                    text_body=(
                        f"Hi {customer_name},\n\n"
                        f"Your {service_name} appointment is complete. "
                        f"Please fill out {len(attachments)} post-visit {forms_word} to help us improve your experience.\n\n"
                        f"Complete your {forms_word} here: {forms_url}\n\n"
                        f"Thank you!"
                    ),
                    html_body=(
                        f"<p>Hi {customer_name},</p>"
                        f"<p>Your <strong>{service_name}</strong> appointment is complete. "
                        f"Please fill out <strong>{len(attachments)} post-visit {forms_word}</strong> to help us improve your experience.</p>"
                        f"<p><a href=\"{forms_url}\">Complete your {forms_word} here</a></p>"
                        f"<p>Thank you!</p>"
                    ),
                )
            except Exception:
                logger.exception(
                    "Post-visit form email failed for booking %s, customer %s",
                    booking.id, customer.id if customer else "unknown",
                )


async def update_booking_status(
    session: AsyncSession,
    tenant_slug: str,
    booking_id: str,
    payload: UpdateBookingStatusRequest,
    actor: User,
) -> BookingSummaryResponse:
    tenant = await _load_tenant(session, tenant_slug)
    tenant_id = tenant.id
    booking = await _load_booking(session, booking_id, tenant.id)
    notes = _clean_notes(payload.notes)

    if payload.status == "completed":
        if booking.status == "completed":
            if payload.payment_resolution is not None and payload.payment_resolution != booking.payment_resolution:
                raise api_exception(409, "conflict", "Completed bookings cannot be finalized again with a different payment outcome.")
            if notes is not None:
                booking.notes = notes
                reload_booking_id = booking.id
                await session.commit()
                session.expire_all()
                booking = await _load_booking(session, reload_booking_id, tenant_id)
            return booking_to_summary(booking)

        if booking.status != "confirmed":
            raise api_exception(409, "conflict", "Only confirmed bookings can be marked completed.")

        remaining_balance_cents = booking_balance_due_cents(booking)
        payment_resolution = payload.payment_resolution
        if payment_resolution is None:
            if remaining_balance_cents > 0:
                raise api_exception(
                    409,
                    "conflict",
                    "Completion requires an explicit payment outcome while a balance remains due.",
                )
            payment_resolution = "collected"

        if payment_resolution == "collected" and remaining_balance_cents > 0:
            raise api_exception(
                409,
                "conflict",
                "Record the remaining balance before marking this booking completed as collected.",
            )

        if payment_resolution == "follow_up" and remaining_balance_cents <= 0:
            raise api_exception(409, "conflict", "Follow-up is only valid when a balance still remains due.")

        guard_transition("booking", booking.id, booking.status, "completed")
        booking.status = "completed"
        booking.completed_at = datetime.now(timezone.utc)
        booking.notes = notes
        _apply_payment_resolution(booking, payment_resolution)
        _append_booking_event(
            session,
            booking,
            event_kind="booking_completed",
            actor=actor,
            amount_cents=remaining_balance_cents,
            notes=notes,
            extra_payload={
                "fromStatus": "confirmed",
                "toStatus": "completed",
                "paymentResolution": payment_resolution,
                "balanceDueCents": remaining_balance_cents,
            },
        )

        reload_booking_id = booking.id
        await session.commit()
        session.expire_all()
        updated_booking = await _load_booking(session, reload_booking_id, tenant_id)

        # Trigger post-visit form requirements
        await _deliver_post_visit_forms(session, updated_booking)

        return booking_to_summary(updated_booking)

    if booking.status == "no_show":
        if notes is not None:
            booking.notes = notes
            reload_booking_id = booking.id
            await session.commit()
            session.expire_all()
            booking = await _load_booking(session, reload_booking_id, tenant_id)
        return booking_to_summary(booking)

    if booking.status != "confirmed":
        raise api_exception(409, "conflict", "Only confirmed bookings can be marked as no-show.")

    guard_transition("booking", booking.id, booking.status, "no_show")
    booking.status = "no_show"
    booking.notes = notes
    _append_booking_event(
        session,
        booking,
        event_kind="booking_marked_no_show",
        actor=actor,
        amount_cents=booking_balance_due_cents(booking),
        notes=notes,
        extra_payload={
            "fromStatus": "confirmed",
            "toStatus": "no_show",
            "paymentResolution": booking.payment_resolution,
        },
    )

    # Auto-charge no-show fee if tenant setting is enabled
    tenant_settings = tenant.settings_json if isinstance(tenant.settings_json, dict) else {}
    auto_charge = tenant_settings.get("autoChargeNoShowFee", False)
    no_show_fee_cents = tenant_settings.get("noShowFeeCents", 0)
    if auto_charge and isinstance(no_show_fee_cents, int) and no_show_fee_cents > 0:
        stripe_charge_result = None
        if booking.customer is not None and booking.customer.stripe_customer_id:
            try:
                stripe_charge_result = await charge_stripe_no_show_fee(
                    stripe_customer_id=booking.customer.stripe_customer_id,
                    amount_cents=no_show_fee_cents,
                    description=f"No-show fee for {booking.service.name if booking.service else 'appointment'}",
                    idempotency_key=f"no-show-{booking.id}",
                )
            except Exception:
                logger.exception(
                    "No-show fee charge failed for booking %s, customer %s, amount %d cents",
                    booking.id, booking.customer_id, no_show_fee_cents,
                )

        no_show_payment = Payment(
            tenant_id=booking.tenant_id,
            booking=booking,
            customer_id=booking.customer_id,
            status="succeeded" if stripe_charge_result is not None else "failed",
            deposit_status="paid_in_full" if stripe_charge_result is not None else "unpaid",
            amount_cents=no_show_fee_cents,
            currency="USD",
            payment_method_type="stripe" if stripe_charge_result is not None else "no_show_fee",
            checkout_session_kind=None,
        )
        session.add(no_show_payment)
        await session.flush()
        _append_payment_event(
            session,
            no_show_payment,
            kind="no_show_fee_charged",
            actor=actor,
            amount_cents=no_show_fee_cents,
            notes=(
                f"No-show fee of ${no_show_fee_cents / 100:.2f} charged via Stripe "
                f"(pi {stripe_charge_result.payment_intent_id}). Operator: {actor.name}."
            )
            if stripe_charge_result is not None
            else f"No-show fee of ${no_show_fee_cents / 100:.2f} recorded (charge failed). Operator: {actor.name}.",
        )

    reload_booking_id = booking.id
    await session.commit()
    session.expire_all()
    updated_booking = await _load_booking(session, reload_booking_id, tenant_id)
    return booking_to_summary(updated_booking)

async def update_booking(
    session: AsyncSession,
    tenant_slug: str,
    booking_id: str,
    payload: UpdateBookingRequest,
    actor: User,
) -> BookingSummaryResponse:
    tenant = await _load_tenant(session, tenant_slug)
    booking = await _load_booking(session, booking_id, tenant.id)

    if booking.status not in ("confirmed", "completed"):
        raise api_exception(409, "conflict", "Only confirmed or completed bookings can be updated.")

    # Completed bookings can only have notes updated
    if booking.status == "completed":
        if payload.starts_at is not None or payload.provider_id is not None or payload.service_id is not None:
            raise api_exception(409, "conflict", "Completed bookings can only have notes updated.")
        if payload.notes is not None:
            booking.notes = _clean_notes(payload.notes)
            reload_id = booking.id
            reload_tenant_id = tenant.id
            await session.commit()
            session.expire_all()
            updated_booking = await _load_booking(session, reload_id, reload_tenant_id)
            return booking_to_summary(updated_booking)
        return booking_to_summary(booking)

    changed = False
    old_starts_at = booking.starts_at

    if payload.starts_at is not None:
        duration = booking.ends_at - booking.starts_at
        booking.starts_at = payload.starts_at
        booking.ends_at = payload.starts_at + duration
        changed = True

    if payload.provider_id is not None:
        booking.provider_id = payload.provider_id
        changed = True

    if payload.service_id is not None:
        booking.service_id = payload.service_id
        changed = True

    if payload.notes is not None:
        booking.notes = _clean_notes(payload.notes)
        changed = True

    if not changed:
        return booking_to_summary(booking)

    _append_booking_event(
        session,
        booking,
        event_kind="booking_updated",
        actor=actor,
        amount_cents=0,
        notes=payload.notes,
        extra_payload={
            "previousStartsAt": old_starts_at.isoformat() if payload.starts_at is not None else None,
            "sendConfirmation": payload.send_confirmation,
        },
    )

    reload_booking_id = booking.id
    await session.commit()
    updated_booking = await _load_booking(session, reload_booking_id, tenant.id)
    return booking_to_summary(updated_booking)


async def cancel_booking(
    session: AsyncSession,
    tenant_slug: str,
    booking_id: str,
    payload: CancelBookingRequest,
    actor: User,
) -> BookingSummaryResponse:
    tenant = await _load_tenant(session, tenant_slug)
    booking = await _load_booking(session, booking_id, tenant.id)
    reason = payload.reason.strip() if isinstance(payload.reason, str) and payload.reason.strip() else None

    if booking.status == "canceled":
        return booking_to_summary(booking)
    if booking.status != "confirmed":
        raise api_exception(409, "conflict", "Only confirmed bookings can be canceled.")

    _, refund_inside_window, _, is_inside_cancellation_window = _cancellation_policy_for_booking(tenant, booking)
    deposit_payments = [payment for payment in booking.payments if payment.amount_cents > 0 and payment.status == "succeeded"]
    requires_payment_record = booking.deposit_status in {"paid", "paid_in_full"}
    if requires_payment_record and not deposit_payments:
        raise api_exception(409, "conflict", "This booking no longer has the payment record required for cancellation.")

    refundable = requires_payment_record and (not is_inside_cancellation_window or refund_inside_window)
    forfeited = requires_payment_record and not refundable
    refunded_amount_cents = 0
    forfeited_amount_cents = 0
    wallet_credited_cents = 0
    processor_refund_id: str | None = None

    guard_transition("booking", booking.id, booking.status, "canceled")
    booking.status = "canceled"
    booking.canceled_at = datetime.now(timezone.utc)

    if refundable:
        for payment in deposit_payments:
            # Try processor refund first (Stripe, future Clover/Square).
            # Falls back to wallet credit if the processor isn't available.
            processor_result = None
            if payment.checkout_session_id:
                processor_result = await refund_payment_via_processor(
                    checkout_session_id=payment.checkout_session_id,
                    amount_cents=payment.amount_cents,
                    idempotency_key=f"cancel-staff-{booking.id}-{payment.id}",
                )

            if processor_result is not None:
                refunded_amount_cents += processor_result.amount_cents
                processor_refund_id = processor_result.processor_refund_id
                payment.status = "refunded"
                payment.deposit_status = "refunded"
                _append_payment_event(
                    session,
                    payment,
                    kind="refund_processed",
                    actor=actor,
                    amount_cents=processor_result.amount_cents,
                    notes=f"Refunded ${processor_result.amount_cents / 100:.2f} via {processor_result.processor} "
                          f"(refund {processor_result.processor_refund_id}). Staff canceled. Operator: {actor.name}.",
                )
            else:
                # Fall back to wallet credit
                wallet_credited_cents += payment.amount_cents
                payment.status = "refunded"
                payment.deposit_status = "refunded"
                _append_payment_event(
                    session,
                    payment,
                    kind="wallet_credited",
                    actor=actor,
                    amount_cents=payment.amount_cents,
                    notes=f"Deposit credited to customer wallet when staff canceled. Operator: {actor.name}.",
                )

        if wallet_credited_cents > 0:
            await record_wallet_transaction(
                session,
                customer=booking.customer,
                amount_cents=wallet_credited_cents,
                kind="cancellation_credit",
                actor=actor,
                booking_id=booking.id,
                notes=f"Deposit credited to wallet when staff canceled. Operator: {actor.name}.",
            )
        booking.deposit_status = "refunded"
        booking.payment_resolution = "waived"
    elif forfeited:
        for payment in deposit_payments:
            forfeited_amount_cents += payment.amount_cents
            payment.deposit_status = "forfeited"
            _append_payment_event(
                session,
                payment,
                kind="deposit_forfeited",
                actor=actor,
                amount_cents=payment.amount_cents,
                notes=f"Staff canceled the booking inside the cancellation window; deposit was retained. Operator: {actor.name}.",
            )
        booking.deposit_status = "forfeited"
        booking.payment_resolution = "collected"
    elif booking.deposit_status in {"unpaid", "follow_up"}:
        booking.payment_resolution = "waived"

    extra_payload: dict[str, object] = {
        "walletCreditedCents": wallet_credited_cents,
        "forfeitedAmountCents": forfeited_amount_cents,
        "isInsideCancellationWindow": is_inside_cancellation_window,
        "refundInsideWindow": refund_inside_window,
        "reason": reason,
    }
    if processor_refund_id is not None:
        extra_payload["processorRefundId"] = processor_refund_id
        extra_payload["processorRefundAmountCents"] = refunded_amount_cents

    _append_booking_event(
        session,
        booking,
        event_kind="staff_canceled",
        actor=actor,
        amount_cents=refunded_amount_cents,
        notes=reason,
        extra_payload=extra_payload,
    )

    reload_booking_id = booking.id
    await session.commit()
    updated_booking = await _load_booking(session, reload_booking_id, tenant.id)
    return booking_to_summary(updated_booking)
