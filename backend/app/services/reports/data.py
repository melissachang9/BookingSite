"""Shared loaders and the canonical money definitions used by every report."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Booking, Location, Payment, Service, ServiceCategory, Tenant
from app.services.presenters import (
    booking_balance_due_cents,
    booking_discount_cents,
    booking_items_total_cents,
    booking_price_cents,
    booking_tax_cents,
)
from app.services.reports.ranges import ReportRange, aware


@dataclass
class BookingMoney:
    """Accrual-basis figures for one completed booking.

    gross    = service price + add-on/extra items
    discount = discounts applied at completion
    net      = gross - discount (tax and tips are reported separately)
    """

    gross_cents: int
    discount_cents: int
    items_cents: int
    tax_cents: int
    tips_cents: int

    @property
    def net_cents(self) -> int:
        return self.gross_cents - self.discount_cents


def booking_money(booking: Booking) -> BookingMoney:
    items = booking_items_total_cents(booking)
    return BookingMoney(
        gross_cents=booking_price_cents(booking) + items,
        discount_cents=booking_discount_cents(booking),
        items_cents=items,
        tax_cents=booking_tax_cents(booking),
        tips_cents=sum(p.tip_cents for p in booking.payments if p.status == "succeeded"),
    )


def _full_options():
    return (
        selectinload(Booking.tenant),
        selectinload(Booking.service),
        selectinload(Booking.provider),
        selectinload(Booking.customer),
        selectinload(Booking.items),
        selectinload(Booking.payments).selectinload(Payment.events),
        selectinload(Booking.payment_events),
    )


async def load_completed_bookings(
    session: AsyncSession,
    tenant: Tenant,
    rng: ReportRange,
    *,
    location_id: str | None = None,
    provider_id: str | None = None,
) -> list[Booking]:
    """Completed bookings whose completion falls in the range (tenant-local days)."""
    query = (
        select(Booking)
        .options(*_full_options())
        .where(
            Booking.tenant_id == tenant.id,
            Booking.status == "completed",
            Booking.completed_at >= rng.start_utc,
            Booking.completed_at < rng.end_utc,
        )
    )
    if location_id:
        query = query.where(Booking.location_id == location_id)
    if provider_id:
        query = query.where(Booking.provider_id == provider_id)
    return list((await session.scalars(query)).all())


async def load_scheduled_bookings(
    session: AsyncSession,
    tenant: Tenant,
    rng: ReportRange,
    *,
    location_id: str | None = None,
    provider_id: str | None = None,
) -> list[Booking]:
    """Bookings (any status) whose appointment time falls in the range."""
    query = select(Booking).where(
        Booking.tenant_id == tenant.id,
        Booking.starts_at >= rng.start_utc,
        Booking.starts_at < rng.end_utc,
    )
    if location_id:
        query = query.where(Booking.location_id == location_id)
    if provider_id:
        query = query.where(Booking.provider_id == provider_id)
    return list((await session.scalars(query)).all())


@dataclass(frozen=True)
class BookingStub:
    id: str
    customer_id: str
    provider_id: str
    status: str
    starts_at: datetime
    completed_at: datetime | None


async def load_booking_stubs(session: AsyncSession, tenant_id: str) -> list[BookingStub]:
    """Slim all-time rows for non-canceled bookings (first visit, rebooking, retention)."""
    rows = (
        await session.execute(
            select(
                Booking.id,
                Booking.customer_id,
                Booking.provider_id,
                Booking.status,
                Booking.starts_at,
                Booking.completed_at,
            ).where(Booking.tenant_id == tenant_id, Booking.status != "canceled")
        )
    ).all()
    return [
        BookingStub(
            id=row[0],
            customer_id=row[1],
            provider_id=row[2],
            status=row[3],
            starts_at=aware(row[4]),
            completed_at=aware(row[5]) if row[5] is not None else None,
        )
        for row in rows
    ]


@dataclass
class CatalogNames:
    services: dict[str, str] = field(default_factory=dict)
    service_category: dict[str, str | None] = field(default_factory=dict)
    categories: dict[str, str] = field(default_factory=dict)
    locations: dict[str, str] = field(default_factory=dict)


async def load_catalog_names(session: AsyncSession, tenant_id: str) -> CatalogNames:
    names = CatalogNames()
    for service in (await session.scalars(select(Service).where(Service.tenant_id == tenant_id))).all():
        names.services[service.id] = service.name
        names.service_category[service.id] = service.category_id
    for category in (
        await session.scalars(select(ServiceCategory).where(ServiceCategory.tenant_id == tenant_id))
    ).all():
        names.categories[category.id] = category.name
    for location in (await session.scalars(select(Location).where(Location.tenant_id == tenant_id))).all():
        names.locations[location.id] = location.name
    return names


def outstanding_balance_cents(booking: Booking) -> int:
    return booking_balance_due_cents(booking)
