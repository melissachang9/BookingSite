from __future__ import annotations

from datetime import timezone

from sqlalchemy import delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.http import api_exception
from app.db.base import Base
from app.db.models import Booking
from app.schemas.testing import MoveBookingStartResponse, ResetE2EDataResponse
from app.services.tenants import get_tenant_by_slug


def _deleted_count(result: CursorResult) -> int:
    return int(result.rowcount or 0)


# Everything a visit, sale or client can leave behind. Catalog and settings tables are untouched.
_TRANSACTIONAL_ROOTS = frozenset({"bookings", "booking_drafts", "customers", "payments", "sales", "slot_holds"})


def _transactional_tables() -> list:
    """The roots plus every table that points at them, children first, so rows delete without FK errors.

    Derived from the schema so a table added later is cleared too, instead of silently breaking the reset."""
    from sqlalchemy.sql.ddl import sort_tables

    names = set(_TRANSACTIONAL_ROOTS)
    grew = True
    while grew:
        grew = False
        for table in Base.metadata.tables.values():
            if table.name not in names and any(fk.column.table.name in names for fk in table.foreign_keys):
                names.add(table.name)
                grew = True
    tables = [Base.metadata.tables[name] for name in names]
    return list(reversed(sort_tables(tables)))


async def reset_e2e_data(session: AsyncSession, tenant_slug: str) -> ResetE2EDataResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)

    deleted: dict[str, int] = {}
    for table in _transactional_tables():
        result = await session.execute(delete(table).where(table.c.tenant_id == tenant.id))
        deleted[table.name] = _deleted_count(result)
    await session.commit()

    return ResetE2EDataResponse(
        tenant_slug=tenant.slug,
        slot_holds_deleted=deleted.get("slot_holds", 0),
        booking_drafts_deleted=deleted.get("booking_drafts", 0),
        bookings_deleted=deleted.get("bookings", 0),
        customers_deleted=deleted.get("customers", 0),
    )


async def move_e2e_booking_start(
    session: AsyncSession,
    tenant_slug: str,
    booking_id: str,
    starts_at,
) -> MoveBookingStartResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    booking = await session.scalar(select(Booking).where(Booking.id == booking_id, Booking.tenant_id == tenant.id))

    if booking is None:
        raise api_exception(404, "not_found", "Booking was not found for this tenant.")

    normalized_starts_at = starts_at if starts_at.tzinfo is not None else starts_at.replace(tzinfo=timezone.utc)
    duration = booking.ends_at - booking.starts_at
    booking.starts_at = normalized_starts_at
    booking.ends_at = normalized_starts_at + duration
    await session.commit()

    return MoveBookingStartResponse(
        tenant_slug=tenant.slug,
        booking_id=booking.id,
        starts_at=booking.starts_at,
        ends_at=booking.ends_at,
    )
