from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.core.security import decode_token
from app.db.models import (
    Booking,
    BookingDraft,
    BookingDraftFormRequirement,
    BookingDraftIntakePlan,
    BookingPaymentEvent,
    Customer,
    Payment,
    PaymentEvent,
    Provider,
    Service,
    ServiceFormAttachment,
    SlotHold,
    Tenant,
)
from app.schemas.bookings import BookingSummaryResponse, CancelManageBookingRequest, CustomerManageBookingResponse
from app.schemas.booking_drafts import BookingDraftSummaryResponse, CreateBookingDraftRequest, UpdateBookingDraftRequest
from app.services.payment_processor import create_stripe_refund, is_stripe_checkout_session_id
from app.services.availability import list_availability
from app.services.presenters import booking_draft_to_summary, booking_to_summary, tenant_to_summary
from app.services.tenants import get_tenant_by_slug


ACTIVE_DRAFT_STATUSES = {"draft", "slot_held", "awaiting_form", "awaiting_payment"}
MANAGE_LINK_ERROR_MESSAGE = "Manage booking link is invalid or expired."


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _ensure_not_expired(draft: BookingDraft) -> None:
    if draft.status not in ACTIVE_DRAFT_STATUSES:
        return
    if _ensure_aware(draft.expires_at) <= datetime.now(timezone.utc):
        raise api_exception(409, "conflict", "Booking draft has expired.")


async def _upsert_customer(
    session: AsyncSession,
    tenant_id: str,
    payload: dict[str, str | None],
    assign_owner_user_id: str | None = None,
) -> Customer:
    email = payload.get("email")
    phone = payload.get("phone")
    query = select(Customer).where(Customer.tenant_id == tenant_id)
    if email:
        query = query.where(Customer.email == email)
    elif phone:
        query = query.where(Customer.phone == phone)
    else:
        query = query.where(Customer.id == "")
    customer = await session.scalar(query)
    if customer is None:
        customer = Customer(
            tenant_id=tenant_id,
            name=payload["name"] or "Guest",
            email=email,
            phone=phone,
            owner_user_id=assign_owner_user_id,
        )
        session.add(customer)
        await session.flush()
        return customer

    customer.name = payload["name"] or customer.name
    customer.email = email or customer.email
    customer.phone = phone or customer.phone
    await session.flush()
    return customer


def _reminder_hours_for_tenant(tenant: Tenant) -> int:
    raw_hours = tenant.settings_json.get("reminderHoursBefore", 24)
    return raw_hours if isinstance(raw_hours, int) and raw_hours >= 1 else 24


async def _upsert_intake_plan(
    session: AsyncSession,
    tenant: Tenant,
    draft: BookingDraft,
    completion_timing: str,
) -> BookingDraftIntakePlan:
    reminder_hours = _reminder_hours_for_tenant(tenant)
    starts_at = _ensure_aware(draft.starts_at)
    now = datetime.now(timezone.utc)
    plan = draft.intake_plan
    if plan is None:
        plan = BookingDraftIntakePlan(
            tenant_id=draft.tenant_id,
            booking_draft_id=draft.id,
            completion_timing=completion_timing,
            status="pending",
        )
        session.add(plan)
        draft.intake_plan = plan

    plan.completion_timing = completion_timing
    if completion_timing == "before_visit":
        reminder_at = max(now, starts_at - timedelta(hours=reminder_hours))
        plan.status = "reminders_scheduled"
        plan.due_at = starts_at
        plan.email_reminder_scheduled_at = reminder_at
        plan.sms_reminder_scheduled_at = reminder_at
    else:
        plan.status = "required_before_booking"
        plan.due_at = _ensure_aware(draft.expires_at)
        plan.email_reminder_scheduled_at = None
        plan.sms_reminder_scheduled_at = None

    await session.flush()
    return plan


async def _attach_pre_booking_form_requirements(session: AsyncSession, draft: BookingDraft) -> None:
    attachments = (
        await session.scalars(
            select(ServiceFormAttachment)
            .options(selectinload(ServiceFormAttachment.form), selectinload(ServiceFormAttachment.form_version))
            .where(
                ServiceFormAttachment.tenant_id == draft.tenant_id,
                ServiceFormAttachment.service_id == draft.service_id,
                ServiceFormAttachment.customer_prompt_timing == "pre_booking",
            )
        )
    ).all()

    if not attachments:
        return

    for attachment in attachments:
        scope = attachment.form.scope if attachment.form is not None else "customer"
        session.add(
            BookingDraftFormRequirement(
                tenant_id=draft.tenant_id,
                booking_draft_id=draft.id,
                form_id=attachment.form_id,
                form_version_id=attachment.form_version_id,
                scope=scope,
                customer_prompt_timing=attachment.customer_prompt_timing,
                status="pending",
            )
        )

    draft.status = "awaiting_form"
    await session.flush()


def _has_pending_pre_booking_requirements(draft: BookingDraft) -> bool:
    return any(
        requirement.customer_prompt_timing == "pre_booking" and requirement.status == "pending"
        for requirement in draft.form_requirements
    )


async def _attach_post_confirmation_form_requirements(
    session: AsyncSession,
    draft: BookingDraft,
    booking: Booking,
) -> None:
    """Create pre-visit and post-visit form requirements linked to the confirmed booking."""
    attachments = (
        await session.scalars(
            select(ServiceFormAttachment)
            .options(selectinload(ServiceFormAttachment.form), selectinload(ServiceFormAttachment.form_version))
            .where(
                ServiceFormAttachment.tenant_id == draft.tenant_id,
                ServiceFormAttachment.service_id == draft.service_id,
                ServiceFormAttachment.customer_prompt_timing.in_(["pre_visit", "post_visit"]),
            )
        )
    ).all()

    for attachment in attachments:
        scope = attachment.form.scope if attachment.form is not None else "customer"
        session.add(
            BookingDraftFormRequirement(
                tenant_id=draft.tenant_id,
                booking_draft_id=draft.id,
                booking_id=booking.id,
                form_id=attachment.form_id,
                form_version_id=attachment.form_version_id,
                scope=scope,
                customer_prompt_timing=attachment.customer_prompt_timing,
                status="pending",
            )
        )

    await session.flush()


async def _load_booking_draft(
    session: AsyncSession,
    booking_draft_id: str,
    tenant_id: str | None = None,
) -> BookingDraft:
    filters = [BookingDraft.id == booking_draft_id]
    if tenant_id is not None:
        filters.append(BookingDraft.tenant_id == tenant_id)

    draft = await session.scalar(
        select(BookingDraft)
        .options(
            selectinload(BookingDraft.tenant),
            selectinload(BookingDraft.service).selectinload(Service.location_links),
            selectinload(BookingDraft.provider).selectinload(Provider.location_links),
            selectinload(BookingDraft.provider).selectinload(Provider.service_links),
            selectinload(BookingDraft.customer),
            selectinload(BookingDraft.hold),
            selectinload(BookingDraft.intake_plan),
            selectinload(BookingDraft.form_requirements).selectinload(BookingDraftFormRequirement.form_version),
        )
        .where(*filters)
    )
    if draft is None:
        raise api_exception(404, "not_found", "Booking draft was not found.")
    return draft


async def _load_booking(
    session: AsyncSession,
    booking_id: str,
    tenant_id: str | None = None,
) -> Booking:
    filters = [Booking.id == booking_id]
    if tenant_id is not None:
        filters.append(Booking.tenant_id == tenant_id)

    booking = await session.scalar(
        select(Booking)
        .options(
            selectinload(Booking.tenant),
            selectinload(Booking.service).selectinload(Service.location_links),
            selectinload(Booking.provider).selectinload(Provider.location_links),
            selectinload(Booking.provider).selectinload(Provider.service_links),
            selectinload(Booking.customer),
            selectinload(Booking.payments).selectinload(Payment.events),
            selectinload(Booking.source_draft).selectinload(BookingDraft.intake_plan),
        )
        .where(*filters)
    )
    if booking is None:
        raise api_exception(404, "not_found", "Booking was not found.")
    return booking


async def _promote_draft_to_booking(
    session: AsyncSession,
    draft: BookingDraft,
    *,
    deposit_status: str,
    payment_resolution: str,
    event_kind: str,
    event_amount_cents: int,
    event_payload: dict[str, str | int | None],
) -> Booking:
    booking = Booking(
        tenant_id=draft.tenant_id,
        customer_id=draft.customer_id or "",
        service_id=draft.service_id,
        provider_id=draft.provider_id,
        location_id=draft.location_id,
        status="confirmed",
        booking_method=draft.booking_method,
        deposit_status=deposit_status,
        payment_resolution=payment_resolution,
        starts_at=draft.starts_at,
        ends_at=draft.ends_at,
    )
    session.add(booking)
    await session.flush()

    session.add(
        BookingPaymentEvent(
            tenant_id=draft.tenant_id,
            booking_id=booking.id,
            event_kind=event_kind,
            amount_cents=event_amount_cents,
            payload_json=event_payload,
        )
    )

    draft.status = "confirmed"
    draft.confirmed_booking_id = booking.id
    if draft.hold is not None:
        await session.delete(draft.hold)

    # Create pre-visit and post-visit form requirements linked to the booking
    await _attach_post_confirmation_form_requirements(session, draft, booking)

    return booking


def _cancellation_policy_for_booking(tenant: Tenant, booking: Booking) -> tuple[int, bool, datetime, bool]:
    raw_window_hours = tenant.settings_json.get("cancellationWindowHours", 24)
    cancellation_window_hours = raw_window_hours if isinstance(raw_window_hours, int) and raw_window_hours >= 0 else 24
    refund_inside_window = bool(tenant.settings_json.get("refundInsideWindow", False))
    cancellation_deadline_at = _ensure_aware(booking.starts_at) - timedelta(hours=cancellation_window_hours)
    # At the exact deadline timestamp, treat cancellations as outside the penalty window.
    is_inside_cancellation_window = datetime.now(timezone.utc) > cancellation_deadline_at
    return cancellation_window_hours, refund_inside_window, cancellation_deadline_at, is_inside_cancellation_window


def _append_manage_payment_event(
    session: AsyncSession,
    payment: Payment,
    *,
    kind: str,
    amount_cents: int,
    notes: str,
    stripe_session_id: str | None = None,
    stripe_payment_intent_id: str | None = None,
) -> None:
    session.add(
        PaymentEvent(
            tenant_id=payment.tenant_id,
            payment_id=payment.id,
            kind=kind,
            actor_type="customer",
            actor_id=None,
            display_name="Customer self-service",
            occurred_at=datetime.now(timezone.utc),
            amount_cents=amount_cents,
            notes=notes,
            stripe_session_id=stripe_session_id,
            stripe_payment_intent_id=stripe_payment_intent_id,
        )
    )


def _append_manage_booking_event(
    session: AsyncSession,
    booking: Booking,
    *,
    refunded_amount_cents: int,
    forfeited_amount_cents: int,
    is_inside_cancellation_window: bool,
    refund_inside_window: bool,
    reason: str | None,
    external_refund_ids: list[str],
) -> None:
    session.add(
        BookingPaymentEvent(
            tenant_id=booking.tenant_id,
            booking_id=booking.id,
            event_kind="customer_canceled",
            amount_cents=refunded_amount_cents,
            payload_json={
                "actorType": "customer",
                "actorLabel": "Customer self-service",
                "reason": reason,
                "refundedAmountCents": refunded_amount_cents,
                "forfeitedAmountCents": forfeited_amount_cents,
                "isInsideCancellationWindow": is_inside_cancellation_window,
                "refundInsideWindow": refund_inside_window,
                "externalRefundIds": external_refund_ids,
            },
        )
    )


def _decode_manage_booking_token(token: str) -> tuple[str, str]:
    try:
        payload = decode_token(token)
    except Exception as error:  # noqa: BLE001
        raise api_exception(404, "not_found", MANAGE_LINK_ERROR_MESSAGE) from error

    if payload.get("tokenType") != "customer_manage":
        raise api_exception(404, "not_found", MANAGE_LINK_ERROR_MESSAGE)

    booking_id = payload.get("bookingId")
    tenant_id = payload.get("tenantId")
    if not isinstance(booking_id, str) or not isinstance(tenant_id, str):
        raise api_exception(404, "not_found", MANAGE_LINK_ERROR_MESSAGE)

    return booking_id, tenant_id


async def _load_manage_booking_context(
    session: AsyncSession,
    token: str,
) -> tuple[Booking, Tenant]:
    booking_id, tenant_id = _decode_manage_booking_token(token)
    booking = await _load_booking(session, booking_id, tenant_id)
    tenant = booking.tenant if isinstance(booking.tenant, Tenant) else None
    if tenant is None:
        raise api_exception(404, "not_found", MANAGE_LINK_ERROR_MESSAGE)
    return booking, tenant


def _build_manage_booking_response(
    booking: Booking,
    tenant: Tenant,
) -> CustomerManageBookingResponse:
    (
        cancellation_window_hours,
        refund_inside_window,
        cancellation_deadline_at,
        is_inside_cancellation_window,
    ) = _cancellation_policy_for_booking(tenant, booking)

    return CustomerManageBookingResponse(
        tenant=tenant_to_summary(tenant),
        booking=booking_to_summary(booking),
        cancellation_window_hours=cancellation_window_hours,
        refund_inside_window=refund_inside_window,
        cancellation_deadline_at=cancellation_deadline_at,
        is_inside_cancellation_window=is_inside_cancellation_window,
    )


async def create_booking_draft(
    session: AsyncSession,
    tenant_slug: str,
    payload: CreateBookingDraftRequest,
) -> BookingDraftSummaryResponse:
    if payload.tenant_slug != tenant_slug:
        raise api_exception(400, "bad_request", "Tenant slug in the request body must match the route.")

    tenant = await get_tenant_by_slug(session, tenant_slug)
    service = await session.scalar(
        select(Service)
        .options(selectinload(Service.location_links))
        .where(Service.id == payload.service_id, Service.tenant_id == tenant.id, Service.is_active.is_(True))
    )
    if service is None:
        raise api_exception(404, "not_found", "Service was not found for this tenant.")

    provider = await session.scalar(
        select(Provider)
        .options(selectinload(Provider.location_links), selectinload(Provider.service_links))
        .where(Provider.id == payload.provider_id, Provider.tenant_id == tenant.id, Provider.is_active.is_(True))
    )
    if provider is None:
        raise api_exception(404, "not_found", "Provider was not found for this tenant.")

    start_at = _ensure_aware(payload.starts_at)
    requested_date_text = start_at.astimezone(ZoneInfo(tenant.timezone)).date().isoformat()
    availability = await list_availability(
        session=session,
        tenant_slug=tenant_slug,
        service_id=payload.service_id,
        provider_id=payload.provider_id,
        location_id=payload.location_id,
        requested_date_text=requested_date_text,
    )
    matching_slot = next(
        (
            slot
            for slot in availability.slots
            if slot.start_at == start_at
            and slot.provider_id == payload.provider_id
            and (payload.location_id is None or slot.location_id == payload.location_id)
        ),
        None,
    )
    if matching_slot is None:
        raise api_exception(409, "conflict", "The selected slot is no longer available.")

    customer = None
    if payload.customer is not None:
        assign_owner = (
            provider.user_id
            if bool(tenant.settings_json.get("onlineBookingOwnerAssignmentEnabled"))
            else None
        )
        customer = await _upsert_customer(
            session,
            tenant.id,
            payload.customer.model_dump(),
            assign_owner_user_id=assign_owner,
        )

    draft = BookingDraft(
        tenant_id=tenant.id,
        customer_id=customer.id if customer is not None else None,
        service_id=service.id,
        provider_id=provider.id,
        location_id=matching_slot.location_id,
        status="slot_held",
        booking_method=payload.booking_method or "public_online",
        starts_at=matching_slot.start_at,
        ends_at=matching_slot.end_at,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=15),
        price_cents=service.price_cents,
        deposit_cents=service.deposit_cents,
        duration_minutes=service.duration_minutes,
    )
    session.add(draft)
    await session.flush()

    await session.execute(
        delete(SlotHold).where(
            SlotHold.provider_id == provider.id,
            SlotHold.starts_at == draft.starts_at,
            SlotHold.ends_at == draft.ends_at,
            SlotHold.expires_at <= datetime.now(timezone.utc),
        )
    )

    session.add(
        SlotHold(
            tenant_id=tenant.id,
            provider_id=provider.id,
            starts_at=draft.starts_at,
            ends_at=draft.ends_at,
            expires_at=draft.expires_at,
            booking_draft_id=draft.id,
        )
    )
    await _attach_pre_booking_form_requirements(session, draft)
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise api_exception(409, "conflict", "The selected slot is no longer available.") from error

    hydrated_draft = await _load_booking_draft(session, draft.id, tenant.id)
    return booking_draft_to_summary(hydrated_draft)


async def get_booking_draft(
    session: AsyncSession,
    tenant_slug: str,
    booking_draft_id: str,
) -> BookingDraftSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    draft = await _load_booking_draft(session, booking_draft_id, tenant.id)
    _ensure_not_expired(draft)
    return booking_draft_to_summary(draft)


async def get_booking(
    session: AsyncSession,
    tenant_slug: str,
    booking_id: str,
) -> BookingSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    booking = await _load_booking(session, booking_id, tenant.id)
    return booking_to_summary(booking)


async def get_manage_booking(
    session: AsyncSession,
    token: str,
) -> CustomerManageBookingResponse:
    booking, tenant = await _load_manage_booking_context(session, token)
    return _build_manage_booking_response(booking, tenant)


async def cancel_manage_booking(
    session: AsyncSession,
    token: str,
    payload: CancelManageBookingRequest,
) -> CustomerManageBookingResponse:
    booking, tenant = await _load_manage_booking_context(session, token)
    reason = payload.reason.strip() if isinstance(payload.reason, str) and payload.reason.strip() else None

    if booking.status == "canceled":
        return _build_manage_booking_response(booking, tenant)
    if booking.status != "confirmed":
        raise api_exception(409, "conflict", "Only confirmed bookings can be canceled from this link.")

    _, refund_inside_window, _, is_inside_cancellation_window = _cancellation_policy_for_booking(tenant, booking)
    deposit_payments = [payment for payment in booking.payments if payment.amount_cents > 0 and payment.status == "succeeded"]
    requires_payment_record = booking.deposit_status in {"paid", "paid_in_full"}
    if requires_payment_record and not deposit_payments:
        raise api_exception(409, "conflict", "This booking no longer has the payment record required for cancellation.")

    refundable = requires_payment_record and (not is_inside_cancellation_window or refund_inside_window)
    forfeited = requires_payment_record and not refundable
    refunded_amount_cents = 0
    forfeited_amount_cents = 0
    external_refund_ids: list[str] = []

    booking.status = "canceled"
    booking.canceled_at = datetime.now(timezone.utc)

    if refundable:
        for payment in deposit_payments:
            refund_note = "Customer canceled the booking from the private manage link."
            stripe_payment_intent_id = None
            if is_stripe_checkout_session_id(payment.checkout_session_id):
                refund = await create_stripe_refund(
                    payment.checkout_session_id or "",
                    amount_cents=payment.amount_cents,
                    idempotency_key=f"customer-cancel-{booking.id}-{payment.id}",
                )
                external_refund_ids.append(refund.refund_id)
                stripe_payment_intent_id = refund.payment_intent_id
                refund_note = f"Stripe refund {refund.refund_id} created when customer canceled from the private manage link."
            refunded_amount_cents += payment.amount_cents
            payment.status = "refunded"
            payment.deposit_status = "refunded"
            _append_manage_payment_event(
                session,
                payment,
                kind="refund_recorded",
                amount_cents=payment.amount_cents,
                notes=refund_note,
                stripe_session_id=payment.checkout_session_id if is_stripe_checkout_session_id(payment.checkout_session_id) else None,
                stripe_payment_intent_id=stripe_payment_intent_id,
            )
        booking.deposit_status = "refunded"
        booking.payment_resolution = "waived"
    elif forfeited:
        for payment in deposit_payments:
            forfeited_amount_cents += payment.amount_cents
            payment.deposit_status = "forfeited"
            _append_manage_payment_event(
                session,
                payment,
                kind="deposit_forfeited",
                amount_cents=payment.amount_cents,
                notes="Customer canceled the booking inside the cancellation window; deposit was retained.",
            )
        booking.deposit_status = "forfeited"
        booking.payment_resolution = "collected"
    elif booking.deposit_status in {"unpaid", "follow_up"}:
        booking.payment_resolution = "waived"

    _append_manage_booking_event(
        session,
        booking,
        refunded_amount_cents=refunded_amount_cents,
        forfeited_amount_cents=forfeited_amount_cents,
        is_inside_cancellation_window=is_inside_cancellation_window,
        refund_inside_window=refund_inside_window,
        reason=reason,
        external_refund_ids=external_refund_ids,
    )

    await session.commit()
    hydrated_booking, hydrated_tenant = await _load_manage_booking_context(session, token)
    return _build_manage_booking_response(hydrated_booking, hydrated_tenant)


async def update_booking_draft(
    session: AsyncSession,
    tenant_slug: str,
    booking_draft_id: str,
    payload: UpdateBookingDraftRequest,
) -> BookingDraftSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    draft = await _load_booking_draft(session, booking_draft_id, tenant.id)
    _ensure_not_expired(draft)

    if payload.customer_id is not None:
        customer = await session.scalar(
            select(Customer).where(Customer.id == payload.customer_id, Customer.tenant_id == draft.tenant_id)
        )
        if customer is None:
            raise api_exception(404, "not_found", "Customer was not found for this tenant.")
        draft.customer_id = customer.id
        draft.customer = customer

    if payload.customer is not None:
        assign_owner: str | None = None
        if bool(tenant.settings_json.get("onlineBookingOwnerAssignmentEnabled")):
            provider = await session.scalar(
                select(Provider).where(Provider.id == draft.provider_id, Provider.tenant_id == draft.tenant_id)
            )
            assign_owner = provider.user_id if provider is not None else None
        customer = await _upsert_customer(
            session,
            draft.tenant_id,
            payload.customer.model_dump(),
            assign_owner_user_id=assign_owner,
        )
        draft.customer_id = customer.id
        draft.customer = customer

    if payload.intake_completion_timing is not None:
        if draft.customer_id is None and payload.customer is None:
            raise api_exception(400, "bad_request", "Customer details are required before choosing intake timing.")
        await _upsert_intake_plan(session, tenant, draft, payload.intake_completion_timing)

    await session.commit()
    hydrated_draft = await _load_booking_draft(session, booking_draft_id, tenant.id)
    return booking_draft_to_summary(hydrated_draft)


async def confirm_booking_draft(
    session: AsyncSession,
    tenant_slug: str,
    booking_draft_id: str,
) -> BookingSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    draft = await _load_booking_draft(session, booking_draft_id, tenant.id)

    if draft.confirmed_booking_id is not None:
        booking = await _load_booking(session, draft.confirmed_booking_id, tenant.id)
        return booking_to_summary(booking)

    _ensure_not_expired(draft)

    if _has_pending_pre_booking_requirements(draft):
        draft.status = "awaiting_form"
        await session.commit()
        raise api_exception(400, "bad_request", "Complete required forms before confirming the booking.")

    if draft.customer_id is None or draft.customer is None:
        raise api_exception(400, "bad_request", "Customer details are required before confirming the booking.")

    if draft.deposit_cents > 0:
        draft.status = "awaiting_payment"
        await session.commit()
        raise api_exception(409, "conflict", "Deposit checkout is not yet implemented for this booking.")

    booking = await _promote_draft_to_booking(
        session,
        draft,
        deposit_status="not_required",
        payment_resolution="waived",
        event_kind="deposit_not_required",
        event_amount_cents=0,
        event_payload={
            "bookingDraftId": draft.id,
            "bookingMethod": draft.booking_method,
        },
    )

    await session.commit()
    hydrated_booking = await _load_booking(session, booking.id, tenant.id)
    return booking_to_summary(hydrated_booking)