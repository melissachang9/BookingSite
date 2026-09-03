from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import Booking, Customer, Payment, Tenant
from app.schemas.customers import CustomerBookingEntry, CustomerListResponse, CustomerLookupResponse, CustomerPaymentEntry, CustomerProfileResponse, UpdateCustomerRequest, UpsertCustomerRequest, UpsertCustomerResponse
from app.schemas.bookings import PaginationMetaResponse
from app.services.presenters import booking_amount_paid_cents, booking_balance_due_cents, customer_to_summary
from app.services.tenants import get_tenant_by_slug


_OWNERSHIP_BYPASS_ROLES = frozenset({"owner", "manager"})


def _build_customer_profile(customer: Customer, bookings: list[Booking]) -> CustomerProfileResponse:
    booking_entries = [
        CustomerBookingEntry(
            id=booking.id,
            service_name=booking.service.name,
            provider_name=booking.provider.name,
            status=booking.status,
            starts_at=booking.starts_at,
            ends_at=booking.ends_at,
            price_cents=booking.service.price_cents,
            deposit_cents=booking.service.deposit_cents,
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
    payment_entries = [
        CustomerPaymentEntry(
            id=payment.id,
            booking_id=payment.booking_id,
            amount_cents=payment.amount_cents,
            payment_method_type=payment.payment_method_type or "unknown",
            status=payment.status,
            recorded_at=payment.created_at,
            notes=None,
        )
        for booking in bookings
        for payment in (booking.payments or [])
    ]
    return CustomerProfileResponse(
        customer=customer_to_summary(customer),
        bookings=booking_entries,
        payments=payment_entries,
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
            .options(selectinload(Booking.service), selectinload(Booking.provider), selectinload(Booking.payments))
            .where(Booking.tenant_id == tenant.id, Booking.customer_id == customer_id)
            .order_by(Booking.starts_at.desc())
            .limit(50)
        )
    ).all()
    return _build_customer_profile(customer, list(bookings))


async def update_customer(
    session: AsyncSession,
    tenant_slug: str,
    customer_id: str,
    payload: UpdateCustomerRequest,
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
            .options(selectinload(Booking.service), selectinload(Booking.provider), selectinload(Booking.payments))
            .where(Booking.tenant_id == tenant.id, Booking.customer_id == customer_id)
            .order_by(Booking.starts_at.desc())
            .limit(50)
        )
    ).all()
    return _build_customer_profile(customer, list(bookings))


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