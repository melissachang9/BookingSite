from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import Booking, BookingDraft, Customer, Payment, Tenant, User
from app.schemas.customers import CustomerBookingAttempt, CustomerBookingEntry, CustomerListResponse, CustomerLookupResponse, CustomerPaymentEntry, CustomerProfileResponse, UpdateCustomerRequest, UpsertCustomerRequest, UpsertCustomerResponse
from app.schemas.bookings import PaginationMetaResponse
from app.services.presenters import (
    booking_amount_paid_cents,
    booking_balance_due_cents,
    booking_deposit_cents,
    booking_price_cents,
    customer_to_summary,
)
from app.services.audit import record_audit
from app.services.tenants import get_tenant_by_slug
from app.services.wallet import record_wallet_transaction


_OWNERSHIP_BYPASS_ROLES = frozenset({"owner", "manager"})


def _parse_birthday(raw: str) -> date | None:
    value = raw.strip()
    if not value:
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise api_exception(422, "invalid_birthday", "Birthday must be a date in YYYY-MM-DD format.")
    if parsed > date.today():
        raise api_exception(422, "invalid_birthday", "Birthday cannot be in the future.")
    return parsed


# How long an unfinished booking stays on the follow-up list, counted from the client's last activity
# (opening financing, otherwise starting the booking).
FOLLOW_UP_WINDOW_DAYS = 30

_LIVE_DRAFT_STATUSES = {"draft", "slot_held", "awaiting_form", "awaiting_payment"}


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _attempt_outcome(draft: BookingDraft, now: datetime) -> str | None:
    """financing_started | in_progress | abandoned, or None when the draft isn't an unfinished online
    booking worth keeping (confirmed, or a staff-entered/released hold with no financing click)."""
    if draft.confirmed_booking_id is not None or draft.status == "confirmed":
        return None
    if draft.financing_started_at is not None:
        return "financing_started"
    if draft.booking_method == "staff_entered" or draft.status == "canceled":
        return None
    if draft.status in _LIVE_DRAFT_STATUSES and _aware(draft.expires_at) > now:
        return "in_progress"
    return "abandoned"


def _booking_attempts(drafts: list[BookingDraft], booked: list[tuple[str, str, datetime]]) -> list[CustomerBookingAttempt]:
    """Unfinished online drafts, newest first. `booked` is (customer_id, service_id, created_at) of the
    client's live bookings, used to tell when they came back and booked anyway."""
    now = datetime.now(timezone.utc)
    entries: list[CustomerBookingAttempt] = []
    for draft in drafts:
        outcome = _attempt_outcome(draft, now)
        if outcome is None:
            continue
        customer = draft.customer
        followed_by = draft.follow_up_by
        dismissed_by = draft.dismissed_by
        last_activity = _aware(draft.financing_started_at or draft.created_at)
        aged_out = outcome != "in_progress" and now - last_activity > timedelta(days=FOLLOW_UP_WINDOW_DAYS)
        entries.append(
            CustomerBookingAttempt(
                id=draft.id,
                outcome=outcome,
                service_name=draft.service.name,
                provider_name=draft.provider.name,
                starts_at=draft.starts_at,
                created_at=draft.created_at,
                financing_started_at=draft.financing_started_at,
                booked_since=any(
                    customer_id == draft.customer_id
                    and service_id == draft.service_id
                    and _aware(created) >= _aware(draft.created_at)
                    for customer_id, service_id, created in booked
                ),
                booking_method=draft.booking_method,
                customer_id=draft.customer_id,
                customer_name=customer.name if customer is not None else None,
                customer_email=customer.email if customer is not None else None,
                customer_phone=customer.phone if customer is not None else None,
                aged_out=aged_out,
                dismissed_at=draft.dismissed_at,
                dismissed_reason=draft.dismissed_reason,
                dismissed_by_name=dismissed_by.name if dismissed_by is not None else None,
                dismissed_note=draft.dismissed_note,
                follow_up_at=draft.follow_up_at,
                follow_up_by_name=followed_by.name if followed_by is not None else None,
                follow_up_note=draft.follow_up_note,
            )
        )
    return entries


_ATTEMPT_LOAD_OPTIONS = (
    selectinload(BookingDraft.service),
    selectinload(BookingDraft.provider),
    selectinload(BookingDraft.customer),
    selectinload(BookingDraft.follow_up_by),
    selectinload(BookingDraft.dismissed_by),
)


async def _booked_pairs(session: AsyncSession, tenant_id: str, customer_ids: set[str]) -> list[tuple[str, str, datetime]]:
    if not customer_ids:
        return []
    rows = (
        await session.execute(
            select(Booking.customer_id, Booking.service_id, Booking.created_at).where(
                Booking.tenant_id == tenant_id,
                Booking.customer_id.in_(customer_ids),
                Booking.status.notin_(["canceled"]),
            )
        )
    ).all()
    return [(row[0], row[1], row[2]) for row in rows]


async def _load_booking_attempts(session: AsyncSession, tenant_id: str, customer_id: str) -> list[CustomerBookingAttempt]:
    drafts = (
        await session.scalars(
            select(BookingDraft)
            .options(*_ATTEMPT_LOAD_OPTIONS)
            .where(BookingDraft.tenant_id == tenant_id, BookingDraft.customer_id == customer_id)
            .order_by(BookingDraft.created_at.desc())
            .limit(25)
        )
    ).all()
    return _booking_attempts(list(drafts), await _booked_pairs(session, tenant_id, {customer_id}))


async def list_booking_attempts(
    session: AsyncSession,
    tenant_slug: str,
    *,
    outcome: str | None = None,
    include_followed_up: bool = False,
) -> list[CustomerBookingAttempt]:
    """Clients to circle back with: opened financing first (the warmer lead), then abandoned checkouts."""
    tenant = await get_tenant_by_slug(session, tenant_slug)
    drafts = (
        await session.scalars(
            select(BookingDraft)
            .options(*_ATTEMPT_LOAD_OPTIONS)
            .where(BookingDraft.tenant_id == tenant.id, BookingDraft.customer_id.is_not(None))
            .order_by(BookingDraft.created_at.desc())
            .limit(500)
        )
    ).all()
    booked = await _booked_pairs(session, tenant.id, {d.customer_id for d in drafts if d.customer_id})
    items = [
        item
        for item in _booking_attempts(list(drafts), booked)
        if item.outcome in {"financing_started", "abandoned"}
        and not item.booked_since
        and not item.aged_out
        and item.dismissed_at is None
        and (include_followed_up or item.follow_up_at is None)
        and (outcome is None or item.outcome == outcome)
    ]
    items.sort(
        key=lambda item: (
            0 if item.outcome == "financing_started" else 1,
            -(_aware(item.financing_started_at or item.created_at).timestamp()),
        )
    )
    return items


async def dismiss_booking_attempt(
    session: AsyncSession,
    tenant_slug: str,
    booking_draft_id: str,
    reason: str,
    note: str | None,
    actor: User,
) -> CustomerBookingAttempt:
    """Take an unfinished booking off the follow-up list without claiming anyone followed up."""
    tenant = await get_tenant_by_slug(session, tenant_slug)
    draft = await session.scalar(
        select(BookingDraft)
        .options(*_ATTEMPT_LOAD_OPTIONS)
        .where(BookingDraft.id == booking_draft_id, BookingDraft.tenant_id == tenant.id)
    )
    if draft is None or draft.customer_id is None:
        raise api_exception(404, "not_found", "Unfinished booking was not found for this tenant.")
    if _attempt_outcome(draft, datetime.now(timezone.utc)) not in {"financing_started", "abandoned"}:
        raise api_exception(409, "conflict", "This booking is not on the follow-up list.")
    if draft.dismissed_at is not None:
        raise api_exception(409, "conflict", "This booking was already removed from the follow-up list.")
    clean_note = (note or "").strip() or None
    if reason == "other" and clean_note is None:
        raise api_exception(422, "validation_error", "Add a note explaining why this is being removed.")
    draft.dismissed_at = datetime.now(timezone.utc)
    draft.dismissed_by_user_id = actor.id
    draft.dismissed_reason = reason
    draft.dismissed_note = clean_note
    await record_audit(
        session,
        tenant_id=tenant.id,
        entity_type="booking_draft",
        entity_id=draft.id,
        action="follow_up_dismissed",
        actor=actor,
        changes={"reason": reason},
        notes=clean_note,
    )
    await session.commit()
    draft = await session.scalar(
        select(BookingDraft)
        .options(*_ATTEMPT_LOAD_OPTIONS)
        .where(BookingDraft.id == booking_draft_id)
        .execution_options(populate_existing=True)
    )
    booked = await _booked_pairs(session, tenant.id, {draft.customer_id})
    return _booking_attempts([draft], booked)[0]


async def mark_booking_attempt_followed_up(
    session: AsyncSession,
    tenant_slug: str,
    booking_draft_id: str,
    note: str | None,
    actor: User,
) -> CustomerBookingAttempt:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    draft = await session.scalar(
        select(BookingDraft)
        .options(*_ATTEMPT_LOAD_OPTIONS)
        .where(BookingDraft.id == booking_draft_id, BookingDraft.tenant_id == tenant.id)
    )
    if draft is None or draft.customer_id is None:
        raise api_exception(404, "not_found", "Unfinished booking was not found for this tenant.")
    if _attempt_outcome(draft, datetime.now(timezone.utc)) not in {"financing_started", "abandoned"}:
        raise api_exception(409, "conflict", "This booking is not waiting for follow-up.")
    draft.follow_up_at = datetime.now(timezone.utc)
    draft.follow_up_by_user_id = actor.id
    draft.follow_up_note = (note or "").strip() or None
    await record_audit(
        session,
        tenant_id=tenant.id,
        entity_type="booking_draft",
        entity_id=draft.id,
        action="follow_up",
        actor=actor,
        notes=draft.follow_up_note,
    )
    await session.commit()
    draft = await session.scalar(
        select(BookingDraft)
        .options(*_ATTEMPT_LOAD_OPTIONS)
        .where(BookingDraft.id == booking_draft_id)
        .execution_options(populate_existing=True)
    )
    booked = await _booked_pairs(session, tenant.id, {draft.customer_id})
    return _booking_attempts([draft], booked)[0]


def _build_customer_profile(
    customer: Customer,
    bookings: list[Booking],
    booking_attempts: list[CustomerBookingAttempt] | None = None,
) -> CustomerProfileResponse:
    booking_entries = [
        CustomerBookingEntry(
            id=booking.id,
            service_name=booking.service.name,
            provider_name=booking.provider.name,
            status=booking.status,
            starts_at=booking.starts_at,
            ends_at=booking.ends_at,
            price_cents=booking_price_cents(booking),
            deposit_cents=booking_deposit_cents(booking),
            amount_paid_cents=booking_amount_paid_cents(booking),
            balance_due_cents=booking_balance_due_cents(booking),
        )
        for booking in bookings
    ]
    lifetime_spend = sum(
        booking_amount_paid_cents(b) for b in bookings if b.status == "completed"
    )
    outstanding = sum(
        booking_balance_due_cents(b) for b in bookings if b.status in {"confirmed", "completed"}
    )
    def _latest_payment_note(payment: Payment) -> str | None:
        # Payment notes live on append-only PaymentEvent rows, not on the
        # Payment itself. Use the most recent event that carries a note.
        events = [e for e in (payment.events or []) if e.notes]
        if not events:
            return None
        events.sort(key=lambda e: e.occurred_at)
        return events[-1].notes

    payment_entries = [
        CustomerPaymentEntry(
            id=payment.id,
            booking_id=payment.booking_id,
            amount_cents=payment.amount_cents,
            payment_method_type=payment.payment_method_type or "unknown",
            status=payment.status,
            recorded_at=payment.created_at,
            notes=_latest_payment_note(payment),
        )
        for booking in bookings
        for payment in (booking.payments or [])
    ]
    return CustomerProfileResponse(
        customer=customer_to_summary(customer),
        bookings=booking_entries,
        payments=payment_entries,
        booking_attempts=booking_attempts or [],
        lifetime_spend_cents=lifetime_spend,
        outstanding_balance_cents=outstanding,
        wallet_balance_cents=customer.wallet_balance_cents,
    )


async def lookup_tenant_customers(
    session: AsyncSession,
    tenant_id: str,
    search: str,
    limit: int,
    current_user_id: str | None = None,
    current_user_role: str | None = None,
) -> CustomerLookupResponse:
    search_text = search.strip()
    pattern = f"%{search_text}%"
    filters = [Customer.tenant_id == tenant_id]
    if search_text:
        filters.append(
            or_(
                Customer.name.ilike(pattern),
                Customer.email.ilike(pattern),
                Customer.phone.ilike(pattern),
            )
        )

    if current_user_role is not None and current_user_role not in _OWNERSHIP_BYPASS_ROLES:
        tenant = await session.scalar(select(Tenant).where(Tenant.id == tenant_id))
        ownership_enabled = bool(
            tenant.settings_json.get("clientOwnershipEnabled") if tenant is not None else False
        )
        if ownership_enabled and current_user_id is not None:
            filters.append(Customer.owner_user_id == current_user_id)

    total = await session.scalar(select(func.count()).select_from(Customer).where(*filters))
    customers = (
        await session.scalars(
            select(Customer)
            .options(selectinload(Customer.owner))
            .where(*filters)
            .order_by(Customer.name.asc(), Customer.created_at.desc())
            .limit(limit)
        )
    ).all()

    return CustomerLookupResponse(
        items=[customer_to_summary(customer) for customer in customers],
        meta=PaginationMetaResponse(limit=limit, offset=0, total=total or 0),
    )


async def list_tenant_customers(
    session: AsyncSession,
    tenant_slug: str,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> CustomerListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    filters = [Customer.tenant_id == tenant.id]
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            or_(
                Customer.name.ilike(pattern),
                Customer.email.ilike(pattern),
                Customer.phone.ilike(pattern),
            )
        )
    total = await session.scalar(select(func.count()).select_from(Customer).where(*filters))
    customers = (
        await session.scalars(
            select(Customer)
            .options(selectinload(Customer.owner))
            .where(*filters)
            .order_by(Customer.name.asc(), Customer.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return CustomerListResponse(
        items=[customer_to_summary(customer) for customer in customers],
        meta=PaginationMetaResponse(limit=limit, offset=offset, total=total or 0),
    )


async def get_customer_profile(
    session: AsyncSession,
    tenant_slug: str,
    customer_id: str,
) -> CustomerProfileResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    customer = await session.scalar(
        select(Customer)
        .options(selectinload(Customer.owner))
        .where(Customer.tenant_id == tenant.id, Customer.id == customer_id)
    )
    if customer is None:
        raise api_exception(404, "not_found", "Customer was not found for this tenant.")
    bookings = (
        await session.scalars(
            select(Booking)
            .options(
                selectinload(Booking.service),
                selectinload(Booking.tenant),
                selectinload(Booking.items),
                selectinload(Booking.provider),
                selectinload(Booking.payments).selectinload(Payment.events),
                selectinload(Booking.payment_events),
            )
            .where(Booking.tenant_id == tenant.id, Booking.customer_id == customer_id)
            .order_by(Booking.starts_at.desc())
            .limit(50)
        )
    ).all()
    attempts = await _load_booking_attempts(session, tenant.id, customer_id)
    return _build_customer_profile(customer, list(bookings), attempts)


async def update_customer(
    session: AsyncSession,
    tenant_slug: str,
    customer_id: str,
    payload: UpdateCustomerRequest,
    actor: User,
) -> CustomerProfileResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    customer = await session.scalar(
        select(Customer)
        .options(selectinload(Customer.owner))
        .where(Customer.tenant_id == tenant.id, Customer.id == customer_id)
    )
    if customer is None:
        raise api_exception(404, "not_found", "Customer was not found for this tenant.")

    if payload.name is not None:
        customer.name = payload.name.strip()
    if payload.email is not None:
        customer.email = payload.email.strip() or None
    if payload.phone is not None:
        customer.phone = payload.phone.strip() or None
    if payload.referred_by is not None:
        customer.referred_by = payload.referred_by.strip() or None
    if payload.notes is not None:
        # Track notes history for audit
        history = customer.notes_history or {}
        if isinstance(history, dict):
            timestamp = datetime.now(timezone.utc).isoformat()
            history[timestamp] = {
                "previous": customer.notes,
                "new": payload.notes.strip() or None,
            }
            customer.notes_history = history
        customer.notes = payload.notes.strip() or None
    if payload.owner_user_id is not None:
        customer.owner_user_id = payload.owner_user_id if payload.owner_user_id.strip() else None
    if payload.sms_consent is not None:
        customer.sms_consent = payload.sms_consent
    if payload.sms_phone is not None:
        customer.sms_phone = payload.sms_phone.strip() or None
    if payload.address_street is not None:
        customer.address_street = payload.address_street.strip() or None
    if payload.address_city is not None:
        customer.address_city = payload.address_city.strip() or None
    if payload.address_state is not None:
        customer.address_state = payload.address_state.strip() or None
    if payload.address_zip is not None:
        customer.address_zip = payload.address_zip.strip() or None
    if payload.birthday is not None:
        customer.birthday = _parse_birthday(payload.birthday)
    if payload.blocked_from_online_booking is not None:
        customer.blocked_from_online_booking = payload.blocked_from_online_booking
    if payload.wallet_adjustment_cents is not None and payload.wallet_adjustment_cents != 0:
        await record_wallet_transaction(
            session,
            customer=customer,
            amount_cents=payload.wallet_adjustment_cents,
            kind="staff_adjustment",
            actor=actor,
            notes=payload.wallet_adjustment_note or "Manual wallet adjustment",
        )

    await session.commit()
    await session.refresh(customer)

    # Return the full profile (same shape as get_customer_profile)
    bookings = (
        await session.scalars(
            select(Booking)
            .options(
                selectinload(Booking.service),
                selectinload(Booking.tenant),
                selectinload(Booking.items),
                selectinload(Booking.provider),
                selectinload(Booking.payments).selectinload(Payment.events),
                selectinload(Booking.payment_events),
            )
            .where(Booking.tenant_id == tenant.id, Booking.customer_id == customer_id)
            .order_by(Booking.starts_at.desc())
            .limit(50)
        )
    ).all()
    attempts = await _load_booking_attempts(session, tenant.id, customer_id)
    return _build_customer_profile(customer, list(bookings), attempts)


async def create_or_update_customer(
    session: AsyncSession,
    payload: UpsertCustomerRequest,
    tenant_id: str,
) -> UpsertCustomerResponse:
    """Create a new customer or update an existing one by email."""
    customer = None
    if payload.email:
        customer = await session.scalar(
            select(Customer).where(
                Customer.tenant_id == tenant_id,
                Customer.email == payload.email,
            )
        )

    if customer is None:
        customer = Customer(
            tenant_id=tenant_id,
            name=payload.name,
            email=payload.email,
            phone=payload.phone,
            address_street=payload.address_street,
            address_city=payload.address_city,
            address_state=payload.address_state,
            address_zip=payload.address_zip,
            acquired_at=datetime.now(timezone.utc),
            source_channel="staff_entered",
        )
        session.add(customer)
    else:
        customer.name = payload.name
        if payload.phone is not None:
            customer.phone = payload.phone
        if payload.address_street is not None:
            customer.address_street = payload.address_street
        if payload.address_city is not None:
            customer.address_city = payload.address_city
        if payload.address_state is not None:
            customer.address_state = payload.address_state
        if payload.address_zip is not None:
            customer.address_zip = payload.address_zip

    await session.commit()
    await session.refresh(customer)
    return UpsertCustomerResponse(customer_id=customer.id)