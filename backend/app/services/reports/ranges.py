"""Report date ranges. Dates are tenant-local calendar dates; bucketing and
day boundaries use the tenant (or filtered location) timezone, never UTC."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.core.http import api_exception
from app.db.models import Location, Tenant
from app.schemas.reports import ReportRangeResponse
from app.services.timezones import resolve_zone

MAX_RANGE_DAYS = 731
GROUP_BY_VALUES = ("day", "week", "month")


def aware(value: datetime) -> datetime:
    """SQLite returns naive datetimes; treat them as UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@dataclass(frozen=True)
class ReportRange:
    start: date  # inclusive, local
    end: date  # inclusive, local
    zone: ZoneInfo
    group_by: str

    @property
    def start_utc(self) -> datetime:
        return datetime.combine(self.start, time.min, tzinfo=self.zone).astimezone(timezone.utc)

    @property
    def end_utc(self) -> datetime:
        """Exclusive upper bound."""
        return datetime.combine(self.end + timedelta(days=1), time.min, tzinfo=self.zone).astimezone(timezone.utc)

    @property
    def day_count(self) -> int:
        return (self.end - self.start).days + 1

    def local_date(self, value: datetime) -> date:
        return aware(value).astimezone(self.zone).date()

    def contains(self, value: datetime) -> bool:
        return self.start_utc <= aware(value) < self.end_utc

    def days(self) -> list[date]:
        return [self.start + timedelta(days=offset) for offset in range(self.day_count)]

    def to_response(self) -> ReportRangeResponse:
        return ReportRangeResponse(
            start_date=self.start,
            end_date=self.end,
            timezone=str(self.zone),
            group_by=self.group_by,
            day_count=self.day_count,
        )


def build_range(
    tenant: Tenant,
    start: date,
    end: date,
    group_by: str = "day",
    location: Location | None = None,
) -> ReportRange:
    if group_by not in GROUP_BY_VALUES:
        raise api_exception(422, "validation_error", "groupBy must be one of day, week or month.")
    if end < start:
        raise api_exception(422, "validation_error", "The end date must be on or after the start date.")
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise api_exception(422, "validation_error", f"Report ranges are limited to {MAX_RANGE_DAYS} days.")
    zone = resolve_zone(location.time_zone if location is not None else None, tenant.timezone)
    return ReportRange(start=start, end=end, zone=zone, group_by=group_by)


def previous_range(current: ReportRange, mode: str) -> ReportRange:
    if mode == "prior_year":
        def shift(day: date) -> date:
            try:
                return day.replace(year=day.year - 1)
            except ValueError:  # Feb 29
                return day.replace(year=day.year - 1, day=28)

        return ReportRange(shift(current.start), shift(current.end), current.zone, current.group_by)
    length = current.day_count
    end = current.start - timedelta(days=1)
    return ReportRange(end - timedelta(days=length - 1), end, current.zone, current.group_by)


def bucket_start(day: date, group_by: str) -> date:
    if group_by == "week":
        return day - timedelta(days=day.weekday())
    if group_by == "month":
        return day.replace(day=1)
    return day


def bucket_starts(rng: ReportRange) -> list[date]:
    seen: list[date] = []
    for day in rng.days():
        key = bucket_start(day, rng.group_by)
        if not seen or seen[-1] != key:
            seen.append(key)
    return seen


def rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator > 0 else None
