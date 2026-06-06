from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import Booking, Customer, Tenant
from app.schemas.customers import CustomerBookingEntry, CustomerListResponse, CustomerLookupResponse, CustomerProfileResponse
from app.schemas.bookings import PaginationMetaResponse
from app.services.presenters import customer_to_summary
from app.services.tenants import get_tenant_by_slug


_OWNERSHIP_BYPASS_ROLES = frozenset({"owner", "manager"})


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
        select(Customer).where(Customer.tenant_id == tenant.id, Customer.id == customer_id)
    )
    if customer is None:
        raise api_exception(404, "not_found", "Customer was not found for this tenant.")
    bookings = (
        await session.scalars(
            select(Booking)
            .options(selectinload(Booking.service), selectinload(Booking.provider))
            .where(Booking.tenant_id == tenant.id, Booking.customer_id == customer_id)
            .order_by(Booking.starts_at.desc())
            .limit(50)
        )
    ).all()
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
            amount_paid_cents=booking.amount_paid_cents,
            balance_due_cents=booking.balance_due_cents,
        )
        for booking in bookings
    ]
    return CustomerProfileResponse(
        customer=customer_to_summary(customer),
        bookings=booking_entries,
    )