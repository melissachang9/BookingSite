from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import Booking, Provider, ProviderSchedule, Service, SlotHold
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
        raise api_exception(404, "not_found", "No active providers are available for this service.")

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
    window_start = datetime.combine(requested_date, time.min, tzinfo=tenant_timezone).astimezone(timezone.utc)
    window_end = datetime.combine(requested_date + timedelta(days=resolved_window_days), time.min, tzinfo=tenant_timezone).astimezone(timezone.utc)
    provider_ids = [context.provider.id for context in provider_contexts]

    schedules = (
        await session.scalars(
            select(ProviderSchedule).where(
                ProviderSchedule.tenant_id == tenant.id,
                ProviderSchedule.provider_id.in_(provider_ids),
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

    schedule_map: dict[tuple[str, str, int], list[ProviderSchedule]] = defaultdict(list)
    for schedule in schedules:
        schedule_map[(schedule.provider_id, schedule.location_id, schedule.weekday)].append(schedule)

    blocked_map: dict[str, list[tuple[datetime, datetime]]] = defaultdict(list)
    for hold in holds:
        blocked_map[hold.provider_id].append((_ensure_aware(hold.starts_at), _ensure_aware(hold.ends_at)))
    for booking in bookings:
        blocked_map[booking.provider_id].append((_ensure_aware(booking.starts_at), _ensure_aware(booking.ends_at)))

    all_slots_by_day: list[list[SlotAvailabilityResponse]] = []
    earliest_slot: SlotAvailabilityResponse | None = None
    for day_offset in range(resolved_window_days):
        current_date = requested_date + timedelta(days=day_offset)
        day_slots: list[SlotAvailabilityResponse] = []
        for context in provider_contexts:
            for resolved_location_id in context.location_ids:
                day_schedules = schedule_map.get(
                    (context.provider.id, resolved_location_id, current_date.weekday()),
                    [],
                )
                for schedule in day_schedules:
                    cursor = datetime.combine(current_date, schedule.start_time, tzinfo=tenant_timezone)
                    end_boundary = datetime.combine(current_date, schedule.end_time, tzinfo=tenant_timezone)
                    while cursor + duration <= end_boundary:
                        slot_start = cursor.astimezone(timezone.utc)
                        slot_end = (cursor + duration).astimezone(timezone.utc)
                        if slot_start < min_start or slot_start > max_start:
                            cursor += timedelta(minutes=30)
                            continue
                        if _overlaps(slot_start, slot_end, blocked_map.get(context.provider.id, [])):
                            cursor += timedelta(minutes=30)
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
                        cursor += timedelta(minutes=30)
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