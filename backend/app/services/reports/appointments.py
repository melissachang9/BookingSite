"""Appointment report: outcomes, cancellations, lead time, demand heatmap, funnel, rooms."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Booking, BookingDraft, Resource, ResourceAllocation, Tenant
from app.schemas.reports import (
    AppointmentsReportResponse,
    AppointmentsSummary,
    CountRow,
    DraftFunnel,
    HeatCell,
    ResourceUtilizationRow,
)
from app.services.availability import _business_window_for_weekday
from app.services.reports.ranges import ReportRange, aware, rate

STATUS_LABELS = {
    "confirmed": "Upcoming",
    "completed": "Completed",
    "canceled": "Canceled",
    "no_show": "No-show",
}
LEAD_TIME_BUCKETS = (
    ("same_day", "Same day", 1),
    ("1_2_days", "1–2 days", 3),
    ("3_7_days", "3–7 days", 8),
    ("8_14_days", "8–14 days", 15),
    ("15_30_days", "15–30 days", 31),
    ("over_30_days", "30+ days", None),
)


def _count_rows(counts: dict[str, int], labels: dict[str, str] | None = None) -> list[CountRow]:
    labels = labels or {}
    return [
        CountRow(key=key, label=labels.get(key, key.replace("_", " ").capitalize()), count=count)
        for key, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]


def _minutes(start: datetime, end: datetime) -> int:
    return max(0, round((aware(end) - aware(start)).total_seconds() / 60))


async def build_appointments_report(
    session: AsyncSession,
    tenant: Tenant,
    rng: ReportRange,
    *,
    location_id: str | None = None,
    provider_id: str | None = None,
    now: datetime | None = None,
) -> AppointmentsReportResponse:
    now = now or datetime.now(timezone.utc)
    settings = tenant.settings_json or {}
    try:
        window_hours = float(settings.get("cancellationWindowHours", 24))
    except (TypeError, ValueError):
        window_hours = 24.0

    query = select(Booking).where(
        Booking.tenant_id == tenant.id,
        Booking.starts_at >= rng.start_utc,
        Booking.starts_at < rng.end_utc,
    )
    if location_id:
        query = query.where(Booking.location_id == location_id)
    if provider_id:
        query = query.where(Booking.provider_id == provider_id)
    bookings = list((await session.scalars(query)).all())

    status_counts: dict[str, int] = defaultdict(int)
    actors: dict[str, int] = defaultdict(int)
    reasons: dict[str, int] = defaultdict(int)
    channels: dict[str, int] = defaultdict(int)
    methods: dict[str, int] = defaultdict(int)
    lead_counts: dict[str, int] = defaultdict(int)
    heat: dict[tuple[int, int], int] = defaultdict(int)
    lead_days: list[float] = []
    waits: list[float] = []
    late_starts: list[float] = []
    late_cancels = 0
    rescheduled = 0

    for booking in bookings:
        starts = aware(booking.starts_at)
        status_counts[booking.status] += 1
        channels[booking.source_channel or "unknown"] += 1
        methods[booking.booking_method or "unknown"] += 1
        if (booking.reschedule_count or 0) > 0:
            rescheduled += 1

        if booking.status == "canceled":
            actors[booking.canceled_by or "unknown"] += 1
            if booking.cancel_reason:
                reasons[booking.cancel_reason.strip()[:80]] += 1
            if booking.canceled_at is not None and starts - aware(booking.canceled_at) < timedelta(hours=window_hours):
                late_cancels += 1
            continue

        local = starts.astimezone(rng.zone)
        heat[(local.weekday(), local.hour)] += 1

        created = aware(booking.created_at) if booking.created_at else None
        if created is not None:
            lead = max((starts - created).total_seconds() / 86400, 0)
            lead_days.append(lead)
            for key, _, limit in LEAD_TIME_BUCKETS:
                if limit is None or lead < limit:
                    lead_counts[key] += 1
                    break

        if booking.checked_in_at is not None and booking.service_started_at is not None:
            waits.append(max((aware(booking.service_started_at) - aware(booking.checked_in_at)).total_seconds() / 60, 0))
        if booking.service_started_at is not None:
            late_starts.append((aware(booking.service_started_at) - starts).total_seconds() / 60)

    total = len(bookings)
    completed = status_counts["completed"]
    no_shows = status_counts["no_show"]
    canceled = status_counts["canceled"]
    summary = AppointmentsSummary(
        total=total,
        completed=completed,
        upcoming=status_counts["confirmed"],
        canceled=canceled,
        no_shows=no_shows,
        no_show_rate=rate(no_shows, completed + no_shows),
        cancel_rate=rate(canceled, total),
        late_cancel_count=late_cancels,
        late_cancel_rate=rate(late_cancels, canceled),
        reschedule_rate=rate(rescheduled, total),
        average_lead_time_days=round(sum(lead_days) / len(lead_days), 1) if lead_days else None,
        average_wait_minutes=round(sum(waits) / len(waits), 1) if waits else None,
        average_late_start_minutes=round(sum(late_starts) / len(late_starts), 1) if late_starts else None,
    )

    # --- booking funnel (drafts created in range) ---
    draft_query = select(BookingDraft.status, BookingDraft.confirmed_booking_id).where(
        BookingDraft.tenant_id == tenant.id,
        BookingDraft.created_at >= rng.start_utc,
        BookingDraft.created_at < rng.end_utc,
    )
    if location_id:
        draft_query = draft_query.where(BookingDraft.location_id == location_id)
    if provider_id:
        draft_query = draft_query.where(BookingDraft.provider_id == provider_id)
    drafts = (await session.execute(draft_query)).all()
    confirmed_drafts = sum(1 for _, confirmed_id in drafts if confirmed_id is not None)
    drafts_total = len(drafts)

    # --- rooms / equipment ---
    resources = list(
        (
            await session.scalars(
                select(Resource).where(Resource.tenant_id == tenant.id, Resource.is_active.is_(True))
            )
        ).all()
    )
    resource_rows: list[ResourceUtilizationRow] = []
    if resources:
        allocations = (
            await session.execute(
                select(ResourceAllocation.resource_id, ResourceAllocation.starts_at, ResourceAllocation.ends_at, ResourceAllocation.quantity)
                .join(Booking, Booking.id == ResourceAllocation.booking_id)
                .where(
                    ResourceAllocation.tenant_id == tenant.id,
                    Booking.status.in_(("confirmed", "completed")),
                    Booking.starts_at >= rng.start_utc,
                    Booking.starts_at < rng.end_utc,
                )
            )
        ).all()
        booked_by_resource: dict[str, int] = defaultdict(int)
        for resource_id, starts, ends, quantity in allocations:
            booked_by_resource[resource_id] += _minutes(starts, ends) * (quantity or 1)

        hours_enabled = bool(settings.get("businessHoursEnabled", False))
        open_minutes = 0
        if hours_enabled:
            for day in rng.days():
                window = _business_window_for_weekday(settings, day.weekday())
                if window is not None:
                    open_minutes += (window[1].hour * 60 + window[1].minute) - (window[0].hour * 60 + window[0].minute)
        for resource in resources:
            if location_id and resource.location_id not in (None, location_id):
                continue
            capacity = open_minutes * (resource.quantity or 1) if hours_enabled else None
            booked = booked_by_resource.get(resource.id, 0)
            resource_rows.append(
                ResourceUtilizationRow(
                    resource_id=resource.id,
                    name=resource.name,
                    kind=resource.kind,
                    booked_minutes=booked,
                    capacity_minutes=capacity,
                    utilization_rate=rate(booked, capacity or 0),
                )
            )
        resource_rows.sort(key=lambda r: (-(r.utilization_rate or 0), r.name))

    return AppointmentsReportResponse(
        range=rng.to_response(),
        summary=summary,
        status_mix=_count_rows(status_counts, STATUS_LABELS),
        lead_time=[
            CountRow(key=key, label=label, count=lead_counts.get(key, 0)) for key, label, _ in LEAD_TIME_BUCKETS
        ],
        cancel_actors=_count_rows(actors),
        cancel_reasons=_count_rows(reasons)[:8],
        channels=_count_rows(channels),
        booking_methods=_count_rows(methods),
        heatmap=[HeatCell(weekday=w, hour=h, count=c) for (w, h), c in sorted(heat.items())],
        drafts=DraftFunnel(
            total=drafts_total,
            confirmed=confirmed_drafts,
            abandoned=drafts_total - confirmed_drafts,
            conversion_rate=rate(confirmed_drafts, drafts_total),
        ),
        resources=resource_rows,
    )
