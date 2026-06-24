from __future__ import annotations

from datetime import datetime, timedelta, timezone
from html import escape
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import BookingDraft, BookingDraftFormRequirement, Payment, PaymentEvent, Provider, Service, User
from app.db.models import BookingPaymentEvent
from app.schemas.bookings import BookingSummaryResponse
from app.schemas.payments import (
    CreateCheckoutSessionRequest,
    CreateCheckoutSessionResponse,
    DepositPaymentFollowUpItemResponse,
    DepositPaymentFollowUpListResponse,
    SendPaymentReminderResponse,
)
from app.services.payment_processor import (
    create_stripe_booking_balance_checkout_session,
    create_stripe_deposit_checkout_session,
    get_stripe_checkout_session,
    is_stripe_checkout_session_id,
    StripeWebhookEvent,
    stripe_processor_configured,
)
from app.services.booking_drafts import (
    _ensure_aware,
    _ensure_not_expired,
    _load_booking,
    _load_booking_draft,
    _promote_draft_to_booking,
)
from app.services.notifications import send_transactional_email
from app.services.presenters import booking_balance_due_cents, booking_draft_to_summary, booking_to_summary
from app.services.auth import ROLE_PERMISSION_ALLOWLIST
from app.services.tenants import get_tenant_by_slug


def _payment_link_expiry_minutes(settings_json: dict[str, object]) -> int:
    raw_value = (
        settings_json.get("paymentLinkExpiryMinutes")
        or settings_json.get("payment_link_expiry_minutes")
        or 30
    )
    return raw_value if isinstance(raw_value, int) and raw_value >= 5 else 30


def _build_checkout_url(cancel_url: str, session_id: str) -> str:
    parts = urlsplit(cancel_url)
    normalized_path = parts.path.rstrip("/")
    checkout_path = f"{normalized_path}/payment"
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["sessionId"] = session_id
    return urlunsplit((parts.scheme, parts.netloc, checkout_path, urlencode(query), parts.fragment))


def _append_payment_event(
    session: AsyncSession,
    payment: Payment,
    *,
    kind: str,
    amount_cents: int | None = None,
    notes: str | None = None,
    actor_type: str = "system",
    actor_id: str | None = None,
    display_name: str | None = "System",
    stripe_session_id: str | None = None,
    stripe_payment_intent_id: str | None = None,
) -> None:
    session.add(
        PaymentEvent(
            tenant_id=payment.tenant_id,
            payment_id=payment.id,
            kind=kind,
            actor_type=actor_type,
            actor_id=actor_id,
            display_name=display_name,
            occurred_at=datetime.now(timezone.utc),
            amount_cents=amount_cents,
            notes=notes,
            stripe_session_id=stripe_session_id,
            stripe_payment_intent_id=stripe_payment_intent_id,
        )
    )


def _append_booking_payment_event(
    session: AsyncSession,
    *,
    booking_id: str,
    tenant_id: str,
    event_kind: str,
    amount_cents: int,
    actor: User | None,
    payload: dict[str, object],
) -> None:
    session.add(
        BookingPaymentEvent(
            tenant_id=tenant_id,
            booking_id=booking_id,
            event_kind=event_kind,
            amount_cents=amount_cents,
            payload_json={
                **payload,
                "actorType": "user" if actor is not None else "system",
                "actorId": actor.id if actor is not None else None,
                "actorLabel": actor.name if actor is not None else "System",
            },
        )
    )


def _require_booking_balance_checkout_access(current_user: User | None, *, tenant_id: str) -> User:
    if current_user is None:
        raise api_exception(401, "unauthorized", "Authentication is required.")

    if current_user.tenant_id != tenant_id:
        raise api_exception(403, "forbidden", "You do not have access to this tenant.")

    if "bookings.collect_payment" not in ROLE_PERMISSION_ALLOWLIST.get(current_user.role, set()):
        raise api_exception(403, "forbidden", "You do not have permission to perform this action.")

    return current_user


def _deposit_link_state(payment: Payment | None, *, now: datetime) -> str:
    if payment is None or payment.checkout_url is None:
        return "missing"

    if (
        payment.status == "pending"
        and payment.checkout_expires_at is not None
        and _ensure_aware(payment.checkout_expires_at) > now
    ):
        return "open"

    return "expired"


def _latest_deposit_checkout_payment(draft: BookingDraft) -> Payment | None:
    deposit_payments = [payment for payment in draft.payments if payment.checkout_session_kind == "deposit"]
    if not deposit_payments:
        return None

    return max(deposit_payments, key=lambda payment: payment.created_at)


def _format_money(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def _format_booking_start(starts_at: datetime) -> str:
    return _ensure_aware(starts_at).strftime("%a, %b %d at %I:%M %p %Z")


def _build_deposit_reminder_content(draft: BookingDraft, checkout_url: str) -> tuple[str, str, str]:
    customer_name = draft.customer.name if draft.customer is not None else "there"
    service_name = draft.service.name
    appointment_label = _format_booking_start(draft.starts_at)
    deposit_label = _format_money(draft.deposit_cents)
    subject = f"{service_name} deposit reminder"
    text_body = "\n".join(
        [
            f"Hi {customer_name},",
            "",
            f"Here is your secure link to pay the {deposit_label} deposit for your {service_name} appointment on {appointment_label}.",
            "",
            checkout_url,
            "",
            "Reply to this email if you need a different time or have any questions before checkout.",
        ]
    )
    html_body = "".join(
        [
            f"<p>Hi {escape(customer_name)},</p>",
            f"<p>Here is your secure link to pay the <strong>{escape(deposit_label)}</strong> deposit for your <strong>{escape(service_name)}</strong> appointment on <strong>{escape(appointment_label)}</strong>.</p>",
            f'<p><a href="{escape(checkout_url)}">Complete your deposit checkout</a></p>',
            "<p>Reply to this email if you need a different time or have any questions before checkout.</p>",
        ]
    )
    return subject, text_body, html_body


def _reminder_checkout_context(payment: Payment | None) -> tuple[str, str]:
    if payment is None or payment.success_url is None or payment.cancel_url is None:
        raise api_exception(409, "conflict", "This booking no longer has the checkout context required for reminders.")
    return payment.success_url, payment.cancel_url


async def _load_latest_deposit_checkout_payment(
    session: AsyncSession,
    *,
    tenant_id: str,
    booking_draft_id: str,
) -> Payment | None:
    return await session.scalar(
        select(Payment)
        .where(
            Payment.tenant_id == tenant_id,
            Payment.booking_draft_id == booking_draft_id,
            Payment.checkout_session_kind == "deposit",
        )
        .order_by(Payment.created_at.desc())
    )


async def _load_checkout_payment(
    session: AsyncSession,
    *,
    tenant_id: str,
    session_id: str,
) -> Payment:
    payment = await session.scalar(
        select(Payment)
        .options(
            selectinload(Payment.booking_draft),
            selectinload(Payment.booking),
            selectinload(Payment.events),
        )
        .where(Payment.tenant_id == tenant_id, Payment.checkout_session_id == session_id)
    )
    if payment is None:
        raise api_exception(404, "not_found", "Checkout session was not found for this tenant.")
    return payment


def _has_payment_event(payment: Payment, *, kind: str, stripe_session_id: str | None = None) -> bool:
    return any(
        event.kind == kind and (stripe_session_id is None or event.stripe_session_id == stripe_session_id)
        for event in payment.events
    )


async def _expire_checkout_payment(
    session: AsyncSession,
    payment: Payment,
    *,
    notes: str,
    stripe_session_id: str | None = None,
    stripe_payment_intent_id: str | None = None,
) -> None:
    if payment.status == "succeeded":
        return
    if payment.status != "canceled":
        payment.status = "canceled"
    if not _has_payment_event(payment, kind="checkout_expired", stripe_session_id=stripe_session_id or payment.checkout_session_id):
        _append_payment_event(
            session,
            payment,
            kind="checkout_expired",
            amount_cents=payment.amount_cents,
            notes=notes,
            stripe_session_id=stripe_session_id,
            stripe_payment_intent_id=stripe_payment_intent_id,
        )


async def _complete_deposit_checkout_payment(
    session: AsyncSession,
    *,
    tenant_slug: str,
    payment: Payment,
    stripe_session_id: str | None = None,
    stripe_payment_intent_id: str | None = None,
    completion_note: str,
) -> BookingSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)

    if payment.checkout_session_kind != "deposit" or payment.booking_draft_id is None:
        raise api_exception(400, "bad_request", "Only deposit checkout completion is supported in this flow.")

    if payment.status == "succeeded" and payment.booking_id is not None:
        booking = await _load_booking(session, payment.booking_id, tenant.id)
        return booking_to_summary(booking)

    now = datetime.now(timezone.utc)
    if payment.checkout_expires_at is None or _ensure_aware(payment.checkout_expires_at) <= now:
        await _expire_checkout_payment(
            session,
            payment,
            notes="Deposit checkout session expired before completion.",
            stripe_session_id=stripe_session_id,
            stripe_payment_intent_id=stripe_payment_intent_id,
        )
        await session.commit()
        raise api_exception(409, "conflict", "The checkout session expired before payment completed.")

    draft = await _load_booking_draft(session, payment.booking_draft_id, tenant.id)
    if draft.confirmed_booking_id is not None:
        payment.status = "succeeded"
        payment.deposit_status = "paid"
        payment.booking_id = draft.confirmed_booking_id
        if not _has_payment_event(payment, kind="checkout_completed", stripe_session_id=stripe_session_id or payment.checkout_session_id):
            _append_payment_event(
                session,
                payment,
                kind="checkout_completed",
                amount_cents=payment.amount_cents,
                notes=completion_note,
                stripe_session_id=stripe_session_id,
                stripe_payment_intent_id=stripe_payment_intent_id,
            )
        await session.commit()
        booking = await _load_booking(session, draft.confirmed_booking_id, tenant.id)
        return booking_to_summary(booking)

    _ensure_not_expired(draft)
    if draft.customer_id is None or draft.customer is None:
        raise api_exception(400, "bad_request", "Customer details are required before payment can complete.")

    booking = await _promote_draft_to_booking(
        session,
        draft,
        deposit_status="paid",
        payment_resolution="pending",
        event_kind="deposit_checkout_completed",
        event_amount_cents=payment.amount_cents,
        event_payload={
            "bookingDraftId": draft.id,
            "checkoutSessionId": payment.checkout_session_id,
            "paymentId": payment.id,
        },
    )
    payment.status = "succeeded"
    payment.deposit_status = "paid"
    payment.booking_id = booking.id
    if not _has_payment_event(payment, kind="checkout_completed", stripe_session_id=stripe_session_id or payment.checkout_session_id):
        _append_payment_event(
            session,
            payment,
            kind="checkout_completed",
            amount_cents=payment.amount_cents,
            notes=completion_note,
            stripe_session_id=stripe_session_id,
            stripe_payment_intent_id=stripe_payment_intent_id,
        )

    await session.commit()
    hydrated_booking = await _load_booking(session, booking.id, tenant.id)
    return booking_to_summary(hydrated_booking)


async def _complete_booking_balance_checkout_payment(
    session: AsyncSession,
    *,
    tenant_slug: str,
    payment: Payment,
    stripe_session_id: str | None = None,
    stripe_payment_intent_id: str | None = None,
    completion_note: str,
) -> BookingSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)

    if payment.checkout_session_kind != "booking_balance" or payment.booking_id is None:
        raise api_exception(400, "bad_request", "Only booking balance checkout completion is supported in this flow.")

    booking = await _load_booking(session, payment.booking_id, tenant.id)
    if payment.status == "succeeded":
        return booking_to_summary(booking)

    now = datetime.now(timezone.utc)
    if payment.checkout_expires_at is None or _ensure_aware(payment.checkout_expires_at) <= now:
        await _expire_checkout_payment(
            session,
            payment,
            notes="Booking balance checkout session expired before completion.",
            stripe_session_id=stripe_session_id,
            stripe_payment_intent_id=stripe_payment_intent_id,
        )
        await session.commit()
        raise api_exception(409, "conflict", "The checkout session expired before payment completed.")

    if booking.status not in {"confirmed", "completed"}:
        raise api_exception(409, "conflict", "This booking can no longer accept a balance checkout payment.")

    remaining_balance_cents = booking_balance_due_cents(booking)
    if remaining_balance_cents <= 0:
        await _expire_checkout_payment(
            session,
            payment,
            notes="Booking balance checkout session was no longer needed because the balance was already resolved.",
            stripe_session_id=stripe_session_id,
            stripe_payment_intent_id=stripe_payment_intent_id,
        )
        await session.commit()
        raise api_exception(409, "conflict", "This booking no longer has a balance due.")

    if payment.amount_cents != remaining_balance_cents:
        await _expire_checkout_payment(
            session,
            payment,
            notes="Booking balance changed before the hosted checkout could complete.",
            stripe_session_id=stripe_session_id,
            stripe_payment_intent_id=stripe_payment_intent_id,
        )
        await session.commit()
        raise api_exception(409, "conflict", "The booking balance changed. Start a new hosted checkout link.")

    payment.status = "succeeded"
    payment.deposit_status = "paid_in_full"
    if not _has_payment_event(payment, kind="checkout_completed", stripe_session_id=stripe_session_id or payment.checkout_session_id):
        _append_payment_event(
            session,
            payment,
            kind="checkout_completed",
            amount_cents=payment.amount_cents,
            notes=completion_note,
            stripe_session_id=stripe_session_id,
            stripe_payment_intent_id=stripe_payment_intent_id,
        )

    booking.deposit_status = "paid_in_full"
    booking.payment_resolution = "collected"
    _append_booking_payment_event(
        session,
        booking_id=booking.id,
        tenant_id=booking.tenant_id,
        event_kind="stripe_balance_checkout" if stripe_session_id is not None else "booking_balance_checkout_completed",
        amount_cents=payment.amount_cents,
        actor=None,
        payload={
            "checkoutSessionId": payment.checkout_session_id,
            "paymentId": payment.id,
            "paymentResolutionAfter": "collected",
            "bookingStatus": booking.status,
            "stripeSessionId": stripe_session_id,
            "stripePaymentIntentId": stripe_payment_intent_id,
        },
    )

    await session.commit()
    hydrated_booking = await _load_booking(session, booking.id, tenant.id)
    return booking_to_summary(hydrated_booking)


async def list_deposit_payment_follow_up(
    session: AsyncSession,
    tenant_slug: str,
) -> DepositPaymentFollowUpListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    drafts = list(
        (
            await session.scalars(
                select(BookingDraft)
                .options(
                    selectinload(BookingDraft.tenant),
                    selectinload(BookingDraft.customer),
                    selectinload(BookingDraft.intake_plan),
                    selectinload(BookingDraft.payments),
                    selectinload(BookingDraft.service).selectinload(Service.location_links),
                    selectinload(BookingDraft.provider).selectinload(Provider.service_links),
                    selectinload(BookingDraft.provider).selectinload(Provider.location_links),
                    selectinload(BookingDraft.form_requirements).selectinload(BookingDraftFormRequirement.form_version),
                )
                .where(
                    BookingDraft.tenant_id == tenant.id,
                    BookingDraft.status == "awaiting_payment",
                    BookingDraft.confirmed_booking_id.is_(None),
                )
                .order_by(BookingDraft.expires_at.asc(), BookingDraft.starts_at.asc())
            )
        ).all()
    )

    now = datetime.now(timezone.utc)
    items = []
    for draft in drafts:
        payment = _latest_deposit_checkout_payment(draft)
        items.append(
            DepositPaymentFollowUpItemResponse(
                booking_draft=booking_draft_to_summary(draft),
                payment_id=payment.id if payment is not None else None,
                payment_status=payment.status if payment is not None else None,
                checkout_session_id=payment.checkout_session_id if payment is not None else None,
                checkout_url=payment.checkout_url if payment is not None else None,
                checkout_expires_at=payment.checkout_expires_at if payment is not None else None,
                link_state=_deposit_link_state(payment, now=now),
            )
        )

    return DepositPaymentFollowUpListResponse(items=items)


async def send_deposit_payment_reminder(
    session: AsyncSession,
    tenant_slug: str,
    booking_draft_id: str,
    actor: User,
) -> SendPaymentReminderResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    draft = await _load_booking_draft(session, booking_draft_id, tenant.id)

    if draft.status != "awaiting_payment" or draft.confirmed_booking_id is not None:
        raise api_exception(409, "conflict", "Only awaiting-payment booking drafts can receive deposit reminders.")
    if draft.customer is None or not draft.customer.email:
        raise api_exception(400, "bad_request", "Customer email is required before sending a deposit reminder.")

    latest_payment = await _load_latest_deposit_checkout_payment(
        session,
        tenant_id=tenant.id,
        booking_draft_id=booking_draft_id,
    )
    success_url, cancel_url = _reminder_checkout_context(latest_payment)

    checkout_session = await create_checkout_session(
        session,
        tenant_slug,
        CreateCheckoutSessionRequest(
            tenant_slug=tenant_slug,
            booking_draft_id=booking_draft_id,
            kind="deposit",
            success_url=success_url,
            cancel_url=cancel_url,
        ),
    )
    payment = await _load_checkout_payment(session, tenant_id=tenant.id, session_id=checkout_session.session_id)

    subject, text_body, html_body = _build_deposit_reminder_content(draft, checkout_session.checkout_url)
    delivery = await send_transactional_email(
        recipient_email=draft.customer.email,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
    )

    _append_payment_event(
        session,
        payment,
        kind="checkout_reminder_sent",
        amount_cents=payment.amount_cents,
        notes=(
            f"Deposit reminder email sent via {delivery.provider}. "
            f"recipient={delivery.recipient_email}; message_id={delivery.provider_message_id}"
        ),
        actor_type="user",
        actor_id=actor.id,
        display_name=actor.name,
    )
    await session.commit()

    return SendPaymentReminderResponse(
        booking_draft_id=draft.id,
        payment_id=payment.id,
        checkout_session_id=checkout_session.session_id,
        checkout_url=checkout_session.checkout_url,
        recipient_email=delivery.recipient_email,
        provider=delivery.provider,
        provider_message_id=delivery.provider_message_id,
        sent_at=delivery.sent_at,
    )


async def create_checkout_session(
    session: AsyncSession,
    tenant_slug: str,
    payload: CreateCheckoutSessionRequest,
    current_user: User | None = None,
) -> CreateCheckoutSessionResponse:
    if payload.tenant_slug != tenant_slug:
        raise api_exception(400, "bad_request", "Tenant slug in the request body must match the route.")

    tenant = await get_tenant_by_slug(session, tenant_slug)

    if payload.kind == "booking_balance":
        if payload.booking_id is None:
            raise api_exception(400, "bad_request", "Booking id is required for booking balance checkout.")

        actor = _require_booking_balance_checkout_access(current_user, tenant_id=tenant.id)
        booking = await _load_booking(session, payload.booking_id, tenant.id)
        if booking.status not in {"confirmed", "completed"}:
            raise api_exception(409, "conflict", "Only confirmed or completed bookings can open a balance checkout link.")

        remaining_balance_cents = booking_balance_due_cents(booking)
        if remaining_balance_cents <= 0:
            raise api_exception(409, "conflict", "This booking no longer has a balance due.")

        now = datetime.now(timezone.utc)
        existing_payment = await session.scalar(
            select(Payment)
            .where(
                Payment.tenant_id == tenant.id,
                Payment.booking_id == booking.id,
                Payment.checkout_session_kind == "booking_balance",
                Payment.status == "pending",
                Payment.checkout_expires_at.is_not(None),
                Payment.checkout_expires_at > now,
            )
            .order_by(Payment.created_at.desc())
        )

        if existing_payment is not None and existing_payment.checkout_expires_at is not None and existing_payment.checkout_url is not None:
            return CreateCheckoutSessionResponse(
                checkout_url=existing_payment.checkout_url,
                session_id=existing_payment.checkout_session_id or "",
                expires_at=existing_payment.checkout_expires_at,
            )

        expires_at = now + timedelta(minutes=_payment_link_expiry_minutes(tenant.settings_json))
        session_id = str(uuid4())
        checkout_url = _build_checkout_url(payload.cancel_url, session_id)

        stripe_checkout = None
        if stripe_processor_configured():
            stripe_checkout = await create_stripe_booking_balance_checkout_session(
                tenant_slug=tenant_slug,
                booking_id=booking.id,
                service_name=booking.service.name,
                amount_cents=remaining_balance_cents,
                customer_email=booking.customer.email,
                success_url=payload.success_url,
                cancel_url=payload.cancel_url,
                expires_at=expires_at,
            )
            session_id = stripe_checkout.session_id
            checkout_url = stripe_checkout.checkout_url
            expires_at = stripe_checkout.expires_at or expires_at

        payment = Payment(
            tenant_id=tenant.id,
            booking_id=booking.id,
            customer_id=booking.customer_id,
            status="pending",
            deposit_status=booking.deposit_status,
            amount_cents=remaining_balance_cents,
            currency="USD",
            payment_method_type="card",
            checkout_session_kind="booking_balance",
            checkout_session_id=session_id,
            checkout_expires_at=expires_at,
            checkout_url=checkout_url,
            success_url=payload.success_url,
            cancel_url=payload.cancel_url,
        )
        session.add(payment)
        await session.flush()
        _append_payment_event(
            session,
            payment,
            kind="checkout_started",
            amount_cents=remaining_balance_cents,
            notes=(
                "Hosted booking balance checkout opened from the dashboard via Stripe Checkout."
                if stripe_checkout is not None
                else "Hosted booking balance checkout opened from the dashboard."
            ),
            actor_type="user",
            actor_id=actor.id,
            display_name=actor.name,
            stripe_session_id=stripe_checkout.session_id if stripe_checkout is not None else None,
        )
        await session.commit()
        return CreateCheckoutSessionResponse(
            checkout_url=checkout_url,
            session_id=session_id,
            expires_at=expires_at,
        )

    if payload.kind != "deposit":
        raise api_exception(400, "bad_request", "Unsupported checkout session kind.")
    if payload.booking_draft_id is None:
        raise api_exception(400, "bad_request", "Booking draft id is required for deposit checkout.")

    draft = await _load_booking_draft(session, payload.booking_draft_id, tenant.id)

    if draft.confirmed_booking_id is not None:
        raise api_exception(409, "conflict", "This booking has already been confirmed.")

    _ensure_not_expired(draft)

    if draft.customer_id is None or draft.customer is None:
        raise api_exception(400, "bad_request", "Customer details are required before payment.")
    if any(
        requirement.customer_prompt_timing == "pre_booking" and requirement.status == "pending"
        for requirement in draft.form_requirements
    ):
        draft.status = "awaiting_form"
        await session.commit()
        raise api_exception(400, "bad_request", "Complete the required forms before payment.")
    if draft.deposit_cents <= 0:
        raise api_exception(409, "conflict", "This booking does not require a deposit checkout session.")
    if draft.hold is None:
        raise api_exception(409, "conflict", "The slot hold is no longer active for this booking.")

    now = datetime.now(timezone.utc)
    existing_payment = await session.scalar(
        select(Payment)
        .where(
            Payment.tenant_id == tenant.id,
            Payment.booking_draft_id == draft.id,
            Payment.checkout_session_kind == "deposit",
            Payment.status == "pending",
            Payment.checkout_expires_at.is_not(None),
            Payment.checkout_expires_at > now,
        )
        .order_by(Payment.created_at.desc())
    )

    if existing_payment is not None and existing_payment.checkout_expires_at is not None and existing_payment.checkout_url is not None:
        draft.status = "awaiting_payment"
        draft.expires_at = max(_ensure_aware(draft.expires_at), _ensure_aware(existing_payment.checkout_expires_at))
        draft.hold.expires_at = draft.expires_at
        await session.commit()
        return CreateCheckoutSessionResponse(
            checkout_url=existing_payment.checkout_url,
            session_id=existing_payment.checkout_session_id or "",
            expires_at=existing_payment.checkout_expires_at,
        )

    expires_at = max(
        _ensure_aware(draft.expires_at),
        now + timedelta(minutes=_payment_link_expiry_minutes(tenant.settings_json)),
    )
    session_id = str(uuid4())
    checkout_url = _build_checkout_url(payload.cancel_url, session_id)

    stripe_checkout = None
    if stripe_processor_configured():
        stripe_checkout = await create_stripe_deposit_checkout_session(
            tenant_slug=tenant_slug,
            booking_draft_id=draft.id,
            service_name=draft.service.name,
            amount_cents=draft.deposit_cents,
            customer_email=draft.customer.email,
            success_url=payload.success_url,
            cancel_url=payload.cancel_url,
            expires_at=expires_at,
        )
        session_id = stripe_checkout.session_id
        checkout_url = stripe_checkout.checkout_url
        expires_at = stripe_checkout.expires_at or expires_at

    payment = Payment(
        tenant_id=tenant.id,
        booking_draft_id=draft.id,
        customer_id=draft.customer_id,
        status="pending",
        deposit_status="unpaid",
        amount_cents=draft.deposit_cents,
        currency="USD",
        payment_method_type="card",
        checkout_session_kind="deposit",
        checkout_session_id=session_id,
        checkout_expires_at=expires_at,
        checkout_url=checkout_url,
        success_url=payload.success_url,
        cancel_url=payload.cancel_url,
    )
    session.add(payment)
    await session.flush()

    from app.services.funnel import checkout_session_started
    checkout_session_started(
        tenant_id=tenant.id,
        booking_draft_id=draft.id,
        kind="deposit",
        amount_cents=draft.deposit_cents,
    )

    _append_payment_event(
        session,
        payment,
        kind="checkout_started",
        amount_cents=draft.deposit_cents,
        notes=(
            "Deposit checkout session opened for public booking draft via Stripe Checkout."
            if stripe_checkout is not None
            else "Deposit checkout session opened for public booking draft."
        ),
        stripe_session_id=stripe_checkout.session_id if stripe_checkout is not None else None,
    )

    draft.status = "awaiting_payment"
    draft.expires_at = expires_at
    draft.hold.expires_at = expires_at

    await session.commit()
    return CreateCheckoutSessionResponse(
        checkout_url=checkout_url,
        session_id=session_id,
        expires_at=expires_at,
    )


async def complete_checkout_session(
    session: AsyncSession,
    tenant_slug: str,
    session_id: str,
) -> BookingSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    payment = await _load_checkout_payment(session, tenant_id=tenant.id, session_id=session_id)

    if payment.status == "succeeded" and payment.checkout_session_kind == "deposit" and payment.booking_id is not None:
        return await _complete_deposit_checkout_payment(
            session,
            tenant_slug=tenant_slug,
            payment=payment,
            completion_note="Deposit checkout completed and booking confirmed.",
        )
    if payment.status == "succeeded" and payment.checkout_session_kind == "booking_balance" and payment.booking_id is not None:
        return await _complete_booking_balance_checkout_payment(
            session,
            tenant_slug=tenant_slug,
            payment=payment,
            completion_note="Booking balance checkout completed and payment recorded.",
        )

    stripe_checkout = None
    if is_stripe_checkout_session_id(payment.checkout_session_id):
        stripe_checkout = await get_stripe_checkout_session(payment.checkout_session_id or "")
        if stripe_checkout.status == "expired":
            await _expire_checkout_payment(
                session,
                payment,
                notes="Stripe Checkout session expired before completion.",
                stripe_session_id=stripe_checkout.session_id,
                stripe_payment_intent_id=stripe_checkout.payment_intent_id,
            )
            await session.commit()
            raise api_exception(409, "conflict", "The checkout session expired before payment completed.")
        if stripe_checkout.status != "complete" or stripe_checkout.payment_status != "paid":
            raise api_exception(409, "conflict", "The payment processor has not completed this checkout yet.")
    if payment.checkout_session_kind == "booking_balance":
        return await _complete_booking_balance_checkout_payment(
            session,
            tenant_slug=tenant_slug,
            payment=payment,
            stripe_session_id=stripe_checkout.session_id if stripe_checkout is not None else None,
            stripe_payment_intent_id=stripe_checkout.payment_intent_id if stripe_checkout is not None else None,
            completion_note=(
                "Booking balance checkout completed via Stripe Checkout and payment recorded."
                if stripe_checkout is not None
                else "Booking balance checkout completed and payment recorded."
            ),
        )
    return await _complete_deposit_checkout_payment(
        session,
        tenant_slug=tenant_slug,
        payment=payment,
        stripe_session_id=stripe_checkout.session_id if stripe_checkout is not None else None,
        stripe_payment_intent_id=stripe_checkout.payment_intent_id if stripe_checkout is not None else None,
        completion_note=(
            "Deposit checkout completed via Stripe Checkout and booking confirmed."
            if stripe_checkout is not None
            else "Deposit checkout completed and booking confirmed."
        ),
    )


async def process_stripe_webhook_event(
    session: AsyncSession,
    event: StripeWebhookEvent,
) -> dict[str, str]:
    event_object = event.data_object
    session_id = event_object.get("id") if isinstance(event_object.get("id"), str) else None
    metadata = event_object.get("metadata") if isinstance(event_object.get("metadata"), dict) else {}
    tenant_slug = metadata.get("tenant_slug") if isinstance(metadata.get("tenant_slug"), str) else None

    if not session_id or not is_stripe_checkout_session_id(session_id):
        return {"status": "ignored", "reason": "unsupported_session"}
    if not tenant_slug:
        return {"status": "ignored", "reason": "missing_tenant_slug"}

    tenant = await get_tenant_by_slug(session, tenant_slug)
    payment = await _load_checkout_payment(session, tenant_id=tenant.id, session_id=session_id)
    stripe_payment_intent_id = event_object.get("payment_intent") if isinstance(event_object.get("payment_intent"), str) else None

    if event.event_type == "checkout.session.completed":
        payment_status = event_object.get("payment_status") if isinstance(event_object.get("payment_status"), str) else None
        if payment_status != "paid":
            return {"status": "ignored", "reason": "payment_not_paid"}
        if payment.checkout_session_kind == "booking_balance":
            await _complete_booking_balance_checkout_payment(
                session,
                tenant_slug=tenant_slug,
                payment=payment,
                stripe_session_id=session_id,
                stripe_payment_intent_id=stripe_payment_intent_id,
                completion_note="Booking balance checkout completed via Stripe webhook and payment recorded.",
            )
        else:
            await _complete_deposit_checkout_payment(
                session,
                tenant_slug=tenant_slug,
                payment=payment,
                stripe_session_id=session_id,
                stripe_payment_intent_id=stripe_payment_intent_id,
                completion_note="Deposit checkout completed via Stripe webhook and booking confirmed.",
            )
        return {"status": "processed", "reason": "checkout_completed"}

    if event.event_type == "checkout.session.expired":
        await _expire_checkout_payment(
            session,
            payment,
            notes="Stripe Checkout session expired before completion via webhook.",
            stripe_session_id=session_id,
            stripe_payment_intent_id=stripe_payment_intent_id,
        )
        await session.commit()
        return {"status": "processed", "reason": "checkout_expired"}

    return {"status": "ignored", "reason": "unhandled_event_type"}