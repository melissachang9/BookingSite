from __future__ import annotations

from sqlalchemy import delete
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import BookingDraft, Customer, SlotHold
from app.schemas.testing import ResetE2EDataResponse
from app.services.tenants import get_tenant_by_slug


def _deleted_count(result: CursorResult) -> int:
    return int(result.rowcount or 0)


async def reset_e2e_data(session: AsyncSession, tenant_slug: str) -> ResetE2EDataResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)

    slot_holds_result = await session.execute(delete(SlotHold).where(SlotHold.tenant_id == tenant.id))
    booking_drafts_result = await session.execute(delete(BookingDraft).where(BookingDraft.tenant_id == tenant.id))
    customers_result = await session.execute(delete(Customer).where(Customer.tenant_id == tenant.id))
    await session.commit()

    return ResetE2EDataResponse(
        tenant_slug=tenant.slug,
        slot_holds_deleted=_deleted_count(slot_holds_result),
        booking_drafts_deleted=_deleted_count(booking_drafts_result),
        customers_deleted=_deleted_count(customers_result),
    )