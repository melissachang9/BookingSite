"""Timezone resolution helpers.

Scheduling times (provider schedules, custom-hours and block overrides) are
wall-clock values interpreted in the business timezone, which is set per
location. The location timezone wins; the tenant-level timezone is the
fallback for records without a location (or an unparseable value).
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_UTC = ZoneInfo("UTC")


def resolve_zone(*candidates: str | None) -> ZoneInfo:
    """Return the first parseable IANA timezone from ``candidates``.

    Falls back to UTC when none resolve, so callers always get a usable zone.
    """
    for candidate in candidates:
        if not candidate:
            continue
        try:
            return ZoneInfo(candidate)
        except (ZoneInfoNotFoundError, ValueError):
            continue
    return _UTC


def as_utc(value: datetime) -> datetime:
    """Stored times are UTC; SQLite hands them back without a zone, so treat naive values as UTC."""
    return value.replace(tzinfo=_UTC) if value.tzinfo is None else value.astimezone(_UTC)


class LocalTimeLookup:
    """Formats appointment times for customers in the business's own timezone (the location's, else the tenant's)."""

    def __init__(self, tenant_zones: dict[str, str | None], location_zones: dict[str, str | None]) -> None:
        self._tenants = tenant_zones
        self._locations = location_zones

    @classmethod
    async def load(cls, session) -> "LocalTimeLookup":
        from sqlalchemy import select

        from app.db.models import Location, Tenant

        tenants = {row.id: row.timezone for row in (await session.execute(select(Tenant.id, Tenant.timezone))).all()}
        locations = {row.id: row.time_zone for row in (await session.execute(select(Location.id, Location.time_zone))).all()}
        return cls(tenants, locations)

    def label(self, tenant_id: str, location_id: str | None, starts_at: datetime) -> str:
        zone = resolve_zone(self._locations.get(location_id) if location_id else None, self._tenants.get(tenant_id))
        return as_utc(starts_at).astimezone(zone).strftime("%a, %b %d at %I:%M %p %Z")
