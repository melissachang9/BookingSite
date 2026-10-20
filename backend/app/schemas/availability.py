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
    # Price with this provider (their override, else the service price).
    price_cents: int | None = None


class AvailabilityDayResponse(CamelModel):
    date: str
    # Every bookable provider/time combination that day.
    slot_count: int
    # Distinct start times (per location) a client can pick from, however many providers are free at each.
    opening_count: int = 0


class AvailabilityResponse(CamelModel):
    days: list[AvailabilityDayResponse]
    slots: list[SlotAvailabilityResponse]
    next_available_slot: SlotAvailabilityResponse | None = None