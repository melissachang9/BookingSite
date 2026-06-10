from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Booking, Payment
from app.schemas.reporting import DashboardReportResponse
from app.services.tenants import get_tenant_by_slug


async def get_dashboard_report(
    session: AsyncSession,
    tenant_slug: str,
) -> DashboardReportResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    now = datetime.now(timezone.utc)

    # Bookings by status
    status_counts = dict(
        (
            await session.execute(
                select(Booking.status, func.count(Booking.id))
                .where(Booking.tenant_id == tenant.id)
                .group_by(Booking.status)
            )
        ).all()
    )

    # Upcoming confirmed bookings
    upcoming_count = await session.scalar(
        select(func.count(Booking.id)).where(
            Booking.tenant_id == tenant.id,
            Booking.status == "confirmed",
            Booking.starts_at >= now,
        )
    ) or 0

    # Completed this month
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    completed_this_month = await session.scalar(
        select(func.count(Booking.id)).where(
            Booking.tenant_id == tenant.id,
            Booking.status == "completed",
            Booking.completed_at >= month_start,
        )
    ) or 0

    # No-shows this month
    no_shows_this_month = await session.scalar(
        select(func.count(Booking.id)).where(
            Booking.tenant_id == tenant.id,
            Booking.status == "no_show",
            Booking.starts_at >= month_start,
        )
    ) or 0

    # Revenue this month (sum of succeeded payments)
    revenue_result = await session.scalar(
        select(func.coalesce(func.sum(Payment.amount_cents), 0)).where(
            Payment.tenant_id == tenant.id,
            Payment.status == "succeeded",
            Payment.created_at >= month_start,
        )
    ) or 0

    # Balance follow-up count
    follow_up_count = await session.scalar(
        select(func.count(Booking.id)).where(
            Booking.tenant_id == tenant.id,
            Booking.payment_resolution == "follow_up",
        )
    ) or 0

    return DashboardReportResponse(
        total_bookings=sum(status_counts.values()),
        confirmed_bookings=status_counts.get("confirmed", 0),
        completed_bookings=status_counts.get("completed", 0),
        canceled_bookings=status_counts.get("canceled", 0),
        no_show_bookings=status_counts.get("no_show", 0),
        upcoming_bookings=upcoming_count,
        completed_this_month=completed_this_month,
        no_shows_this_month=no_shows_this_month,
        revenue_this_month_cents=revenue_result,
        balance_follow_up_count=follow_up_count,
    )
