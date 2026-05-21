from __future__ import annotations

from datetime import datetime

from app.schemas.base import CamelModel


class SlotAvailabilityResponse(CamelModel):
    start_at: datetime
    end_at: datetime
    provider_id: str
    provider_name: str
    location_id: str | None = None
    is_next_available: bool | None = None


class AvailabilityDayResponse(CamelModel):
    date: str
    slot_count: int


class AvailabilityResponse(CamelModel):
    days: list[AvailabilityDayResponse]
    slots: list[SlotAvailabilityResponse]
    next_available_slot: SlotAvailabilityResponse | None = None