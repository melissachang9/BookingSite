from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Customer, Tenant
from app.schemas.customers import CustomerLookupResponse
from app.schemas.bookings import PaginationMetaResponse
from app.services.presenters import customer_to_summary


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