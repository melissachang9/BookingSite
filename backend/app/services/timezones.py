"""Timezone resolution helpers.

Scheduling times (provider schedules, custom-hours and block overrides) are
wall-clock values interpreted in the business timezone, which is set per
location. The location timezone wins; the tenant-level timezone is the
fallback for records without a location (or an unparseable value).
"""

from __future__ import annotations

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
