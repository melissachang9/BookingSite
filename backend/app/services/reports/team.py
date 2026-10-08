"""Team (employee) report: sales, commission, appointment outcomes, utilization."""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Booking, Provider, ProviderSchedule, ProviderTimeOff, Tenant
from app.schemas.reports import TeamMemberRow, TeamReportResponse, TeamTotals
from app.services.compensation import CompletedService, compute_service_payout
from app.services.reports.data import (
    BookingStub,
    booking_money,
    load_booking_stubs,
    load_completed_bookings,
    load_scheduled_bookings,
)
from app.services.reports.ranges import ReportRange, aware, rate
from app.services.reports.utilization import scheduled_minutes
from app.db.models import Location


def first_visit_by_customer(stubs: list[BookingStub]) -> dict[str, BookingStub]:
    first: dict[str, BookingStub] = {}
    for stub in sorted(stubs, key=lambda s: (s.starts_at, s.id)):
        first.setdefault(stub.customer_id, stub)
    return first


def rebooked_ids(stubs: list[BookingStub]) -> set[str]:
    """Booking ids that were followed by a later non-canceled booking for the same customer."""
    by_customer: dict[str, list[BookingStub]] = defaultdict(list)
    for stub in stubs:
        by_customer[stub.customer_id].append(stub)
    rebooked: set[str] = set()
    for visits in by_customer.values():
        visits.sort(key=lambda s: (s.starts_at, s.id))
        for index, stub in enumerate(visits[:-1]):
            if visits[index + 1].starts_at > stub.starts_at:
                rebooked.add(stub.id)
    return rebooked


async def build_team_report(
    session: AsyncSession,
    tenant: Tenant,
    rng: ReportRange,
    *,
    include_financial: bool,
    location_id: str | None = None,
    provider_id: str | None = None,
) -> TeamReportResponse:
    provider_query = (
        select(Provider)
        .options(selectinload(Provider.service_links))
        .where(Provider.tenant_id == tenant.id)
    )
    if provider_id:
        provider_query = provider_query.where(Provider.id == provider_id)
    providers = list((await session.scalars(provider_query)).all())

    completed = await load_completed_bookings(session, tenant, rng, location_id=location_id, provider_id=provider_id)
    scheduled = await load_scheduled_bookings(session, tenant, rng, location_id=location_id, provider_id=provider_id)
    stubs = await load_booking_stubs(session, tenant.id)
    first_visits = first_visit_by_customer(stubs)
    rebooked = rebooked_ids(stubs)

    schedules_by_provider: dict[str, list[ProviderSchedule]] = defaultdict(list)
    for row in (await session.scalars(select(ProviderSchedule).where(ProviderSchedule.tenant_id == tenant.id))).all():
        schedules_by_provider[row.provider_id].append(row)
    time_off_by_provider: dict[str, list[ProviderTimeOff]] = defaultdict(list)
    for row in (await session.scalars(select(ProviderTimeOff).where(ProviderTimeOff.tenant_id == tenant.id))).all():
        time_off_by_provider[row.provider_id].append(row)
    location_zones = {
        loc.id: loc.time_zone
        for loc in (await session.scalars(select(Location).where(Location.tenant_id == tenant.id))).all()
    }

    completed_by_provider: dict[str, list[Booking]] = defaultdict(list)
    for booking in completed:
        completed_by_provider[booking.provider_id].append(booking)
    scheduled_by_provider: dict[str, list[Booking]] = defaultdict(list)
    for booking in scheduled:
        scheduled_by_provider[booking.provider_id].append(booking)

    members: list[TeamMemberRow] = []
    for provider in providers:
        done = completed_by_provider.get(provider.id, [])
        sched = scheduled_by_provider.get(provider.id, [])
        if not provider.is_active and not done and not sched:
            continue

        no_shows = sum(1 for b in sched if b.status == "no_show")
        canceled = sum(1 for b in sched if b.status == "canceled")
        not_canceled = len(sched) - canceled
        booked_minutes = sum(
            max(0, round((aware(b.ends_at) - aware(b.starts_at)).total_seconds() / 60))
            for b in sched
            if b.status in ("confirmed", "completed")
        )
        new_client = sum(
            1
            for b in done
            if first_visits.get(b.customer_id) is not None and first_visits[b.customer_id].id == b.id
        )
        rebooked_count = sum(1 for b in done if b.id in rebooked)
        scheduled_mins = scheduled_minutes(
            tenant,
            rng,
            schedules_by_provider.get(provider.id, []),
            time_off_by_provider.get(provider.id, []),
            location_zones,
            location_id=location_id,
        )

        row = TeamMemberRow(
            provider_id=provider.id,
            name=provider.name,
            is_active=provider.is_active,
            appointments_completed=len(done),
            appointments_scheduled=not_canceled,
            no_shows=no_shows,
            canceled=canceled,
            no_show_rate=rate(no_shows, len([b for b in sched if b.status in ("completed", "no_show")])),
            cancel_rate=rate(canceled, len(sched)),
            new_client_appointments=new_client,
            new_client_share=rate(new_client, len(done)),
            rebooked_appointments=rebooked_count,
            rebooking_rate=rate(rebooked_count, len(done)),
            booked_minutes=booked_minutes,
            scheduled_minutes=scheduled_mins,
            utilization_rate=rate(booked_minutes, scheduled_mins or 0),
        )

        if include_financial:
            moneys = [booking_money(b) for b in done]
            gross = sum(m.gross_cents for m in moneys)
            discounts = sum(m.discount_cents for m in moneys)
            net = gross - discounts
            payout = compute_service_payout(
                provider,
                [
                    CompletedService(
                        service_id=b.service_id,
                        price_cents=b.price_cents if b.price_cents is not None else b.service.price_cents,
                        minutes=max(0, round((aware(b.ends_at) - aware(b.starts_at)).total_seconds() / 60)),
                    )
                    for b in done
                ],
            )
            row.gross_sales_cents = gross
            row.discounts_cents = discounts
            row.net_sales_cents = net
            row.add_on_sales_cents = sum(m.items_cents for m in moneys)
            row.tips_cents = sum(m.tips_cents for m in moneys)
            row.average_ticket_cents = round(net / len(done)) if done else 0
            row.commission_cents = payout.service_payout_cents
            row.compensation_mode = provider.compensation_mode
        members.append(row)

    members.sort(key=lambda m: (-(m.net_sales_cents or 0), -m.appointments_completed, m.name))

    known_scheduled = [m.scheduled_minutes for m in members if m.scheduled_minutes is not None]
    total_scheduled = sum(known_scheduled) if known_scheduled else None
    total_booked = sum(m.booked_minutes for m in members)
    totals = TeamTotals(
        appointments_completed=sum(m.appointments_completed for m in members),
        booked_minutes=total_booked,
        scheduled_minutes=total_scheduled,
        utilization_rate=rate(total_booked, total_scheduled or 0),
        net_sales_cents=sum(m.net_sales_cents or 0 for m in members) if include_financial else None,
        tips_cents=sum(m.tips_cents or 0 for m in members) if include_financial else None,
        commission_cents=sum(m.commission_cents or 0 for m in members) if include_financial else None,
    )
    return TeamReportResponse(range=rng.to_response(), include_financial=include_financial, members=members, totals=totals)
