from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Customer
from app.schemas.customers import CustomerLookupResponse
from app.schemas.bookings import PaginationMetaResponse
from app.services.presenters import customer_to_summary


async def lookup_tenant_customers(
    session: AsyncSession,
    tenant_id: str,
    search: str,
    limit: int,
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