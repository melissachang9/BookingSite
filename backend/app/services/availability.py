from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import Booking, Provider, ProviderSchedule, ProviderTimeOff, Service, SlotHold
from app.schemas.availability import AvailabilityDayResponse, AvailabilityResponse, SlotAvailabilityResponse
from app.services.tenants import get_tenant_by_slug


@dataclass
class ProviderContext:
    provider: Provider
    location_ids: list[str]


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_settings(settings_json: dict[str, object]) -> dict[str, int | bool]:
    return {
        "minLeadTimeMinutes": int(settings_json.get("minLeadTimeMinutes", 60)),
        "maxAdvanceBookingDays": int(settings_json.get("maxAdvanceBookingDays", 45)),
    }


_WEEKDAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
_SLOT_GRANULARITY = timedelta(minutes=15)


def _business_window_for_weekday(
    settings_json: dict[str, object], weekday_index: int
) -> tuple[time, time] | None:
    """Return (open, close) `time` window for the weekday, or None if closed.

    Returns the sentinel ``None`` only when business-hours restriction applies and
    the day is closed. Callers should check the enable/restrict flags before calling.
    """
    hours = settings_json.get("businessHours")
    if not isinstance(hours, dict):
        return (time(0, 0), time(23, 59))
    entry = hours.get(_WEEKDAY_KEYS[weekday_index])
    if not isinstance(entry, dict) or entry.get("closed", False):
        return None
    try:
        open_text = str(entry.get("open", "00:00"))
        close_text = str(entry.get("close", "23:59"))
        oh, om = (int(part) for part in open_text.split(":", 1))
        ch, cm = (int(part) for part in close_text.split(":", 1))
        return (time(oh, om), time(ch, cm))
    except (ValueError, TypeError):
        return (time(0, 0), time(23, 59))


def _overlaps(start_at: datetime, end_at: datetime, hold_ranges: list[tuple[datetime, datetime]]) -> bool:
    return any(start_at < hold_end and end_at > hold_start for hold_start, hold_end in hold_ranges)


async def _load_service(session: AsyncSession, tenant_id: str, service_id: str) -> Service:
    service = await session.scalar(
        select(Service)
        .options(selectinload(Service.location_links), selectinload(Service.provider_links))
        .where(Service.tenant_id == tenant_id, Service.id == service_id, Service.is_active.is_(True))
    )
    if service is None:
        raise api_exception(404, "not_found", "Service was not found for this tenant.")
    return service


async def _load_providers(
    session: AsyncSession,
    tenant_id: str,
    service: Service,
    provider_id: str | None,
    location_id: str | None,
) -> list[ProviderContext]:
    provider_ids = [link.provider_id for link in service.provider_links]
    if not provider_ids:
        return []

    providers = (
        await session.scalars(
            select(Provider)
            .options(selectinload(Provider.location_links), selectinload(Provider.service_links))
            .where(Provider.tenant_id == tenant_id, Provider.id.in_(provider_ids), Provider.is_active.is_(True))
            .order_by(Provider.created_at.asc())
        )
    ).all()
    service_location_ids = {link.location_id for link in service.location_links}
    resolved_contexts: list[ProviderContext] = []
    for provider in providers:
        if provider_id and provider.id != provider_id:
            continue
        provider_location_ids = [
            link.location_id
            for link in provider.location_links
            if link.location_id in service_location_ids and (location_id is None or link.location_id == location_id)
        ]
        if provider_location_ids:
            resolved_contexts.append(ProviderContext(provider=provider, location_ids=provider_location_ids))
    return resolved_contexts


async def list_availability(
    session: AsyncSession,
    tenant_slug: str,
    service_id: str,
    provider_id: str | None,
    location_id: str | None,
    requested_date_text: str,
    window_days: int = 7,
) -> AvailabilityResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    service = await _load_service(session, tenant.id, service_id)
    provider_contexts = await _load_providers(session, tenant.id, service, provider_id, location_id)
    if not provider_contexts:
        # Return empty availability instead of 404 so the calendar renders
        # gracefully when a service has no assigned providers.
        try:
            requested_date = date.fromisoformat(requested_date_text)
        except ValueError:
            requested_date = date.today()
        resolved_window_days = max(1, min(window_days, 45))
        days: list[AvailabilityDayResponse] = []
        for i in range(resolved_window_days):
            day_date = requested_date + timedelta(days=i)
            days.append(AvailabilityDayResponse(date=day_date.isoformat(), slotCount=0))
        return AvailabilityResponse(days=days, slots=[], nextAvailableSlot=None)

    try:
        requested_date = date.fromisoformat(requested_date_text)
    except ValueError as error:
        raise api_exception(422, "validation_error", "Date must be in YYYY-MM-DD format.") from error

    tenant_timezone = ZoneInfo(tenant.timezone)
    settings = _normalize_settings(tenant.settings_json)
    resolved_window_days = max(1, min(window_days, int(settings["maxAdvanceBookingDays"])))
    min_start = datetime.now(timezone.utc) + timedelta(minutes=int(settings["minLeadTimeMinutes"]))
    max_start = datetime.now(timezone.utc) + timedelta(days=int(settings["maxAdvanceBookingDays"]))
    duration = timedelta(minutes=service.duration_minutes)
    setup_buffer = timedelta(minutes=service.setup_buffer_minutes)
    cleanup_buffer = timedelta(minutes=service.cleanup_buffer_minutes)
    total_block = duration + setup_buffer + cleanup_buffer
    window_start = datetime.combine(requested_date, time.min, tzinfo=tenant_timezone).astimezone(timezone.utc)
    window_end = datetime.combine(requested_date + timedelta(days=resolved_window_days), time.min, tzinfo=tenant_timezone).astimezone(timezone.utc)
    provider_ids = [context.provider.id for context in provider_contexts]

    schedules = (
        await session.scalars(
            select(ProviderSchedule).where(
                ProviderSchedule.tenant_id == tenant.id,
                ProviderSchedule.provider_id.in_(provider_ids),
                ProviderSchedule.is_active.is_(True),
            )
        )
    ).all()
    holds = (
        await session.scalars(
            select(SlotHold).where(
                SlotHold.tenant_id == tenant.id,
                SlotHold.provider_id.in_(provider_ids),
                SlotHold.expires_at > datetime.now(timezone.utc),
                SlotHold.starts_at < window_end,
                SlotHold.ends_at > window_start,
            )
        )
    ).all()
    bookings = (
        await session.scalars(
            select(Booking).where(
                Booking.tenant_id == tenant.id,
                Booking.provider_id.in_(provider_ids),
                Booking.status.in_(("confirmed", "completed")),
                Booking.starts_at < window_end,
                Booking.ends_at > window_start,
            )
        )
    ).all()

    time_off_rows = (
        await session.scalars(
            select(ProviderTimeOff).where(
                ProviderTimeOff.tenant_id == tenant.id,
                ProviderTimeOff.provider_id.in_(provider_ids),
                ProviderTimeOff.starts_at < window_end,
                ProviderTimeOff.ends_at > window_start,
            )
        )
    ).all()

    schedule_map: dict[tuple[str, str, int], list[ProviderSchedule]] = defaultdict(list)
    for schedule in schedules:
        schedule_map[(schedule.provider_id, schedule.location_id, schedule.weekday)].append(schedule)

    blocked_map: dict[str, list[tuple[datetime, datetime]]] = defaultdict(list)
    # Per-service blocked map for time off entries that only block specific services
    # Keyed by (provider_id, location_id) for location isolation
    service_blocked_map: dict[tuple[str, str | None], dict[str, list[tuple[datetime, datetime]]]] = defaultdict(lambda: defaultdict(list))
    for hold in holds:
        blocked_map[hold.provider_id].append((_ensure_aware(hold.starts_at), _ensure_aware(hold.ends_at)))
    for booking in bookings:
        blocked_map[booking.provider_id].append((_ensure_aware(booking.starts_at), _ensure_aware(booking.ends_at)))
    # Build date-specific custom hours map: (provider_id, location_id, date) -> (start_time, end_time)
    custom_hours_map: dict[tuple[str, str | None, date], tuple[time, time]] = {}
    for time_off in time_off_rows:
        if time_off.override_type == "custom_hours" and time_off.start_time and time_off.end_time:
            current = time_off.starts_at.astimezone(tenant_timezone).date()
            end_date = time_off.ends_at.astimezone(tenant_timezone).date()
            while current <= end_date:
                custom_hours_map[(time_off.provider_id, time_off.location_id, current)] = (time_off.start_time, time_off.end_time)
                current += timedelta(days=1)

    for time_off in time_off_rows:
        if time_off.override_type == "custom_hours":
            # Custom hours overrides with blocked services still need service blocking
            if time_off.blocked_service_ids:
                for svc_id in time_off.blocked_service_ids:
                    service_blocked_map[(time_off.provider_id, time_off.location_id)][svc_id].append(
                        (_ensure_aware(time_off.starts_at), _ensure_aware(time_off.ends_at))
                    )
            continue
        elif time_off.blocked_service_ids:
            # Only block the specified services, scoped to location
            for svc_id in time_off.blocked_service_ids:
                service_blocked_map[(time_off.provider_id, time_off.location_id)][svc_id].append(
                    (_ensure_aware(time_off.starts_at), _ensure_aware(time_off.ends_at))
                )
        else:
            # Block all services (full day off), scoped to location
            blocked_map[(time_off.provider_id, time_off.location_id)].append(
                (_ensure_aware(time_off.starts_at), _ensure_aware(time_off.ends_at))
            )

    all_slots_by_day: list[list[SlotAvailabilityResponse]] = []
    earliest_slot: SlotAvailabilityResponse | None = None
    business_hours_enabled = bool(tenant.settings_json.get("businessHoursEnabled", False))
    restrict_to_business_hours = business_hours_enabled and bool(
        tenant.settings_json.get("restrictProvidersToBusinessHours", False)
    )
    for day_offset in range(resolved_window_days):
        current_date = requested_date + timedelta(days=day_offset)
        day_slots: list[SlotAvailabilityResponse] = []
        business_window: tuple[time, time] | None
        if restrict_to_business_hours:
            business_window = _business_window_for_weekday(
                tenant.settings_json, current_date.weekday()
            )
            if business_window is None:
                # Closed day under restriction -> no slots
                all_slots_by_day.append(day_slots)
                continue
        else:
            business_window = None
        for context in provider_contexts:
            for resolved_location_id in context.location_ids:
                day_schedules = schedule_map.get(
                    (context.provider.id, resolved_location_id, current_date.weekday()),
                    [],
                )
                # Also include null-location schedules (applies to all locations)
                null_loc_schedules = schedule_map.get(
                    (context.provider.id, None, current_date.weekday()),
                    [],
                )
                all_day_schedules = day_schedules + null_loc_schedules
                # Check for date-specific custom_hours override (both location-specific and null-location)
                custom_hours = custom_hours_map.get((context.provider.id, resolved_location_id, current_date)) or custom_hours_map.get((context.provider.id, None, current_date))
                if custom_hours is not None:
                    # Use custom hours for this specific date
                    schedules_to_use = [
                        ProviderSchedule(
                            tenant_id=context.provider.tenant_id,
                            provider_id=context.provider.id,
                            location_id=resolved_location_id,
                            weekday=current_date.weekday(),
                            start_time=custom_hours[0],
                            end_time=custom_hours[1],
                            is_active=True,
                        )
                    ]
                else:
                    schedules_to_use = all_day_schedules
                for schedule in schedules_to_use:
                    effective_start = schedule.start_time
                    effective_end = schedule.end_time
                    if business_window is not None:
                        business_open, business_close = business_window
                        if business_close <= effective_start or business_open >= effective_end:
                            continue
                        if business_open > effective_start:
                            effective_start = business_open
                        if business_close < effective_end:
                            effective_end = business_close
                    cursor = datetime.combine(current_date, effective_start, tzinfo=tenant_timezone)
                    end_boundary = datetime.combine(current_date, effective_end, tzinfo=tenant_timezone)
                    while cursor + total_block <= end_boundary:
                        slot_start = cursor.astimezone(timezone.utc)
                        slot_end = (cursor + duration).astimezone(timezone.utc)
                        block_start = (cursor - setup_buffer).astimezone(timezone.utc)
                        block_end = (cursor + duration + cleanup_buffer).astimezone(timezone.utc)
                        if slot_start < min_start or slot_start > max_start:
                            cursor += _SLOT_GRANULARITY
                            continue
                        if _overlaps(block_start, block_end, blocked_map.get((context.provider.id, resolved_location_id), [])) or _overlaps(block_start, block_end, blocked_map.get((context.provider.id, None), [])):
                            cursor += _SLOT_GRANULARITY
                            continue
                        # Check service-specific blocks from time off
                        svc_blocks = service_blocked_map.get((context.provider.id, resolved_location_id), {}).get(service.id, []) + service_blocked_map.get((context.provider.id, None), {}).get(service.id, [])
                        if _overlaps(block_start, block_end, svc_blocks):
                            cursor += _SLOT_GRANULARITY
                            continue
                        # Check if this schedule entry blocks this service
                        if schedule.blocked_service_ids and service.id in schedule.blocked_service_ids:
                            cursor += _SLOT_GRANULARITY
                            continue
                        response = SlotAvailabilityResponse(
                            start_at=slot_start,
                            end_at=slot_end,
                            provider_id=context.provider.id,
                            provider_name=context.provider.name,
                            location_id=resolved_location_id,
                            is_next_available=False,
                        )
                        day_slots.append(response)
                        if earliest_slot is None or response.start_at < earliest_slot.start_at:
                            earliest_slot = response
                        cursor += _SLOT_GRANULARITY
        day_slots.sort(key=lambda slot: (slot.start_at, slot.provider_name))
        all_slots_by_day.append(day_slots)

    requested_day_slots = all_slots_by_day[0] if all_slots_by_day else []
    if earliest_slot is not None:
        earliest_slot.is_next_available = True
        for slot in requested_day_slots:
            if (
                slot.start_at == earliest_slot.start_at
                and slot.provider_id == earliest_slot.provider_id
                and slot.location_id == earliest_slot.location_id
            ):
                slot.is_next_available = True
                break

    return AvailabilityResponse(
        days=[
            AvailabilityDayResponse(
                date=(requested_date + timedelta(days=index)).isoformat(),
                slot_count=len(day_slots),
            )
            for index, day_slots in enumerate(all_slots_by_day)
        ],
        slots=requested_day_slots,
        next_available_slot=earliest_slot,
    )