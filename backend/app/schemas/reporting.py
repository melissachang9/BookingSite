from __future__ import annotations

from pydantic import Field

from app.schemas.base import CamelModel


class DashboardReportResponse(CamelModel):
    total_bookings: int = 0
    confirmed_bookings: int = 0
    completed_bookings: int = 0
    canceled_bookings: int = 0
    no_show_bookings: int = 0
    upcoming_bookings: int = 0
    completed_this_month: int = 0
    no_shows_this_month: int = 0
    revenue_this_month_cents: int = 0
    balance_follow_up_count: int = 0
