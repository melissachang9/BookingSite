from __future__ import annotations

from datetime import date, datetime

from pydantic import Field

from app.schemas.base import CamelModel
from app.schemas.reports import ReportRangeResponse


class MarketingSpendResponse(CamelModel):
    id: str
    channel: str
    campaign: str | None = None
    period_start: date
    period_end: date
    amount_cents: int
    note: str | None = None
    source_system: str
    created_by_name: str | None = None
    created_at: datetime


class MarketingSpendListResponse(CamelModel):
    items: list[MarketingSpendResponse]


class CreateMarketingSpendRequest(CamelModel):
    channel: str = Field(min_length=1, max_length=64)
    campaign: str | None = Field(default=None, max_length=128)
    period_start: date
    period_end: date
    amount_cents: int = Field(ge=0, le=1_000_000_000)
    note: str | None = Field(default=None, max_length=255)


class MarketingChannelRow(CamelModel):
    channel: str
    label: str
    spend_cents: int
    new_clients: int
    # Spend divided by new clients from the same channel; null when the channel won no new clients.
    cac_cents: int | None = None


class MarketingReportResponse(CamelModel):
    range: ReportRangeResponse
    channels: list[MarketingChannelRow]
    total_spend_cents: int
    total_new_clients: int
    # Spend on every channel divided by every new client, however they found you.
    blended_cac_cents: int | None = None
