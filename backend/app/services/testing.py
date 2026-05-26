from __future__ import annotations

from datetime import timezone

from sqlalchemy import delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.http import api_exception
from app.db.models import (
    Booking,
    BookingDraft,
    BookingDraftFormRequirement,
    BookingDraftIntakePlan,
    BookingPaymentEvent,
    Customer,
    FormResponse,
    Payment,
    PaymentEvent,
    SlotHold,
)
from app.schemas.testing import MoveBookingStartResponse, ResetE2EDataResponse
from app.services.tenants import get_tenant_by_slug


def _deleted_count(result: CursorResult) -> int:
    return int(result.rowcount or 0)


async def reset_e2e_data(session: AsyncSession, tenant_slug: str) -> ResetE2EDataResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)

    slot_holds_result = await session.execute(delete(SlotHold).where(SlotHold.tenant_id == tenant.id))
    await session.execute(delete(BookingDraftIntakePlan).where(BookingDraftIntakePlan.tenant_id == tenant.id))
    await session.execute(delete(BookingDraftFormRequirement).where(BookingDraftFormRequirement.tenant_id == tenant.id))
    await session.execute(delete(FormResponse).where(FormResponse.tenant_id == tenant.id))
    await session.execute(delete(PaymentEvent).where(PaymentEvent.tenant_id == tenant.id))
    await session.execute(delete(Payment).where(Payment.tenant_id == tenant.id))
    booking_drafts_result = await session.execute(delete(BookingDraft).where(BookingDraft.tenant_id == tenant.id))
    await session.execute(delete(BookingPaymentEvent).where(BookingPaymentEvent.tenant_id == tenant.id))
    bookings_result = await session.execute(delete(Booking).where(Booking.tenant_id == tenant.id))
    customers_result = await session.execute(delete(Customer).where(Customer.tenant_id == tenant.id))
    await session.commit()

    return ResetE2EDataResponse(
        tenant_slug=tenant.slug,
        slot_holds_deleted=_deleted_count(slot_holds_result),
        booking_drafts_deleted=_deleted_count(booking_drafts_result),
        bookings_deleted=_deleted_count(bookings_result),
        customers_deleted=_deleted_count(customers_result),
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
