"""Scheduled vs booked working time.

Scheduled minutes for a provider on a local date come from their weekly
``ProviderSchedule`` rows (null location = every location), replaced by any
``custom_hours`` override covering that date, clipped to business hours when
the tenant restricts providers to them, minus ``closed`` time off. Partial
service blocks (``blocked_service_ids``) are ignored: the provider is still
working. Booked minutes are the appointment durations of confirmed and
completed bookings (setup/cleanup buffers are not counted).
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.db.models import ProviderSchedule, ProviderTimeOff, Tenant
from app.services.availability import _business_window_for_weekday
from app.services.reports.ranges import ReportRange, aware
from app.services.timezones import resolve_zone

Interval = tuple[datetime, datetime]  # aware UTC


def _at(day: date, value: time, zone: ZoneInfo) -> datetime:
    return datetime.combine(day, value, tzinfo=zone).astimezone(timezone.utc)


def _merge(intervals: list[Interval]) -> list[Interval]:
    merged: list[Interval] = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _subtract(windows: list[Interval], blocks: list[Interval]) -> list[Interval]:
    result: list[Interval] = []
    for start, end in windows:
        cursor = start
        for block_start, block_end in sorted(blocks):
            if block_end <= cursor or block_start >= end:
                continue
            if block_start > cursor:
                result.append((cursor, block_start))
            cursor = max(cursor, block_end)
        if cursor < end:
            result.append((cursor, end))
    return result


def business_restricts_providers(tenant: Tenant) -> bool:
    settings = tenant.settings_json or {}
    return bool(settings.get("businessHoursEnabled", False)) and bool(
        settings.get("restrictProvidersToBusinessHours", False)
    )


def scheduled_minutes(
    tenant: Tenant,
    rng: ReportRange,
    schedules: list[ProviderSchedule],
    time_off: list[ProviderTimeOff],
    location_zones: dict[str, str],
    *,
    location_id: str | None = None,
) -> int | None:
    """Scheduled minutes in the range, or None when the provider has no schedule at all."""
    active = [
        row
        for row in schedules
        if row.is_active and (location_id is None or row.location_id in (None, location_id))
    ]
    if not active:
        return None

    restrict = business_restricts_providers(tenant)
    settings = tenant.settings_json or {}
    closed_blocks: list[Interval] = [
        (aware(row.starts_at), aware(row.ends_at))
        for row in time_off
        if row.override_type == "closed"
        and not row.blocked_service_ids
        and (location_id is None or row.location_id in (None, location_id))
    ]
    custom_rows = [
        row
        for row in time_off
        if row.override_type == "custom_hours"
        and not row.blocked_service_ids
        and row.start_time is not None
        and row.end_time is not None
        and (location_id is None or row.location_id in (None, location_id))
    ]

    total = timedelta()
    for day in rng.days():
        windows: list[Interval] = []
        overrides = [
            row
            for row in custom_rows
            if rng.local_date(row.starts_at) <= day <= rng.local_date(row.ends_at)
        ]
        if overrides:
            zone = rng.zone
            windows = [(_at(day, row.start_time, zone), _at(day, row.end_time, zone)) for row in overrides]
        else:
            for row in active:
                if row.weekday != day.weekday():
                    continue
                zone = resolve_zone(location_zones.get(row.location_id or ""), tenant.timezone)
                windows.append((_at(day, row.start_time, zone), _at(day, row.end_time, zone)))

        if restrict:
            business = _business_window_for_weekday(settings, day.weekday())
            if business is None:
                continue
            open_at, close_at = _at(day, business[0], rng.zone), _at(day, business[1], rng.zone)
            windows = [(max(s, open_at), min(e, close_at)) for s, e in windows]

        for start, end in _subtract(_merge(windows), closed_blocks):
            total += end - start
    return round(total.total_seconds() / 60)
