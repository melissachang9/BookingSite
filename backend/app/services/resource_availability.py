"""Room and equipment constraints for availability and booking.

A service can require resources (Services › Resources tab):

* Rooms — the service can run in any one of its rooms. A slot needs at least
  one of them free at the slot's location for the whole buffered window.
* Equipment — every piece is required. A slot needs the units it uses to fit
  within the units the studio owns, given everything else booked at the time.

Resources pinned to a location only serve that location; unpinned ones are
shared studio-wide. Inactive resources are ignored (they are hidden from the
Resources tab, so they must not silently block bookings).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Booking, Resource, ResourceAllocation, ServiceResource, SlotHold

ROOM_KIND = "room"


@dataclass(frozen=True)
class ResourceRequirement:
    resource_id: str
    is_room: bool
    location_id: str | None
    capacity: int  # units the studio owns
    quantity: int  # units one booking uses (rooms always use 1)


@dataclass(frozen=True)
class Usage:
    starts_at: datetime
    ends_at: datetime
    quantity: int


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


async def load_requirements(session: AsyncSession, tenant_id: str, service_id: str) -> list[ResourceRequirement]:
    rows = (
        await session.execute(
            select(ServiceResource.quantity, Resource)
            .join(Resource, Resource.id == ServiceResource.resource_id)
            .where(
                ServiceResource.tenant_id == tenant_id,
                ServiceResource.service_id == service_id,
                Resource.tenant_id == tenant_id,
                Resource.is_active.is_(True),
            )
            .order_by(Resource.name.asc())
        )
    ).all()
    return [
        ResourceRequirement(
            resource_id=resource.id,
            is_room=resource.kind == ROOM_KIND,
            location_id=resource.location_id,
            capacity=max(resource.quantity or 1, 1),
            quantity=1 if resource.kind == ROOM_KIND else max(quantity, 1),
        )
        for quantity, resource in rows
    ]


async def load_usage(
    session: AsyncSession,
    tenant_id: str,
    resource_ids: list[str],
    window_start: datetime,
    window_end: datetime,
    *,
    exclude_booking_id: str | None = None,
) -> dict[str, list[Usage]]:
    """Allocations still holding each resource inside the window: confirmed or
    completed bookings, plus drafts whose slot hold has not expired.
    `exclude_booking_id` ignores one booking's own reservation (rescheduling)."""
    usage: dict[str, list[Usage]] = defaultdict(list)
    if not resource_ids:
        return usage
    now = datetime.now(timezone.utc)
    rows = (
        await session.execute(
            select(ResourceAllocation)
            .outerjoin(Booking, Booking.id == ResourceAllocation.booking_id)
            .outerjoin(SlotHold, SlotHold.booking_draft_id == ResourceAllocation.booking_draft_id)
            .where(
                ResourceAllocation.tenant_id == tenant_id,
                ResourceAllocation.resource_id.in_(resource_ids),
                ResourceAllocation.starts_at < window_end,
                ResourceAllocation.ends_at > window_start,
                *(
                    [or_(ResourceAllocation.booking_id.is_(None), ResourceAllocation.booking_id != exclude_booking_id)]
                    if exclude_booking_id
                    else []
                ),
                or_(
                    and_(
                        ResourceAllocation.booking_id.is_not(None),
                        Booking.status.in_(("confirmed", "completed")),
                    ),
                    and_(ResourceAllocation.booking_id.is_(None), SlotHold.expires_at > now),
                ),
            )
        )
    ).scalars().all()
    for allocation in rows:
        usage[allocation.resource_id].append(
            Usage(_aware(allocation.starts_at), _aware(allocation.ends_at), allocation.quantity)
        )
    return usage


def peak_usage(usages: list[Usage], start: datetime, end: datetime) -> int:
    """Most units in use at any instant within [start, end)."""
    events: list[tuple[datetime, int]] = []
    for item in usages:
        if item.starts_at < end and item.ends_at > start:
            events.append((max(item.starts_at, start), item.quantity))
            events.append((min(item.ends_at, end), -item.quantity))
    # Releases sort before acquisitions at the same instant (back-to-back is fine).
    events.sort(key=lambda event: (event[0], event[1]))
    current = peak = 0
    for _, delta in events:
        current += delta
        peak = max(peak, current)
    return peak


def pick_resources(
    requirements: list[ResourceRequirement],
    usage: dict[str, list[Usage]],
    location_id: str | None,
    start: datetime,
    end: datetime,
) -> list[tuple[str, int]] | None:
    """Resources to reserve for a booking at this location and window, or None
    when the service's rooms/equipment are not free."""
    picks: list[tuple[str, int]] = []
    rooms = [req for req in requirements if req.is_room]
    if rooms:
        room = next(
            (
                req
                for req in rooms
                if (req.location_id is None or req.location_id == location_id)
                and peak_usage(usage.get(req.resource_id, []), start, end) + 1 <= req.capacity
            ),
            None,
        )
        if room is None:
            return None
        picks.append((room.resource_id, 1))
    for req in requirements:
        if req.is_room:
            continue
        if req.location_id is not None and req.location_id != location_id:
            return None
        if peak_usage(usage.get(req.resource_id, []), start, end) + req.quantity > req.capacity:
            return None
        picks.append((req.resource_id, req.quantity))
    return picks


async def reserve_resources(
    session: AsyncSession,
    tenant_id: str,
    service_id: str,
    location_id: str | None,
    start: datetime,
    end: datetime,
    *,
    exclude_booking_id: str | None = None,
) -> list[tuple[str, int]] | None:
    """Pick resources for a new or moved appointment inside the caller's
    transaction. Returns [] when the service needs none, None when its rooms or
    equipment are not free."""
    requirements = await load_requirements(session, tenant_id, service_id)
    if not requirements:
        return []
    resource_ids = [req.resource_id for req in requirements]
    # Serialize concurrent reservations of the same resources (no-op on SQLite).
    await session.execute(
        select(Resource.id)
        .where(Resource.tenant_id == tenant_id, Resource.id.in_(resource_ids))
        .with_for_update()
    )
    usage = await load_usage(
        session, tenant_id, resource_ids, start, end, exclude_booking_id=exclude_booking_id
    )
    return pick_resources(requirements, usage, location_id, start, end)
