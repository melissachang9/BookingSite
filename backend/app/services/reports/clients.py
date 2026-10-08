"""Client report: new vs returning, retention, rebooking, sources, top and at-risk clients.

A client's first visit is their earliest non-canceled booking. "Active" means
a completed visit in the range. Retention counts a client as retained when
they have another non-canceled booking within N days of their first visit,
and only clients whose N-day window has already elapsed are eligible. The
retention cohort is every client first seen in the 12 months ending at the
range end (so short ranges still produce a meaningful rate).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Customer, Payment, Tenant
from app.schemas.reports import (
    AtRiskRow,
    ClientsReportResponse,
    ClientsSummary,
    CohortRow,
    CountRow,
    RetentionRow,
    TopClientRow,
)
from app.services.reports.data import BookingStub, load_booking_stubs
from app.services.reports.ranges import ReportRange, rate
from app.services.reports.team import rebooked_ids

AT_RISK_DAYS = 90
RETENTION_WINDOWS = (30, 60, 90)
TOP_LIMIT = 10
AT_RISK_LIMIT = 10
COHORT_MONTHS = 6


def _months_back(day: date, months: int) -> date:
    index = day.year * 12 + (day.month - 1) - months
    return date(index // 12, index % 12 + 1, 1)


def _retained_within(visits: list[BookingStub], days: int) -> bool:
    first = visits[0]
    return any(v.starts_at - first.starts_at <= timedelta(days=days) and v.id != first.id for v in visits[1:])


async def build_clients_report(
    session: AsyncSession,
    tenant: Tenant,
    rng: ReportRange,
    *,
    include_financial: bool,
    now: datetime | None = None,
) -> ClientsReportResponse:
    now = now or datetime.now(timezone.utc)
    stubs = await load_booking_stubs(session, tenant.id)
    customers = {
        c.id: c for c in (await session.scalars(select(Customer).where(Customer.tenant_id == tenant.id))).all()
    }

    visits_by_customer: dict[str, list[BookingStub]] = defaultdict(list)
    for stub in stubs:
        visits_by_customer[stub.customer_id].append(stub)
    for visits in visits_by_customer.values():
        visits.sort(key=lambda s: (s.starts_at, s.id))

    in_range_completed = [
        s for s in stubs if s.status == "completed" and s.completed_at is not None and rng.contains(s.completed_at)
    ]
    active_ids = {s.customer_id for s in in_range_completed}

    new_ids = {
        cid
        for cid, visits in visits_by_customer.items()
        if rng.contains(visits[0].starts_at)
    }
    returning_ids = active_ids - new_ids
    rebooked = rebooked_ids(stubs)

    # --- lifetime value / spend from payments (net of tips), SQL-side ---
    lifetime_spend: dict[str, int] = {}
    range_spend: dict[str, int] = {}
    if include_financial:
        for cid, total in (
            await session.execute(
                select(Payment.customer_id, func.sum(Payment.amount_cents - Payment.tip_cents))
                .where(Payment.tenant_id == tenant.id, Payment.status == "succeeded")
                .group_by(Payment.customer_id)
            )
        ).all():
            lifetime_spend[cid] = int(total or 0)
        for cid, total in (
            await session.execute(
                select(Payment.customer_id, func.sum(Payment.amount_cents - Payment.tip_cents))
                .where(
                    Payment.tenant_id == tenant.id,
                    Payment.status == "succeeded",
                    Payment.created_at >= rng.start_utc,
                    Payment.created_at < rng.end_utc,
                )
                .group_by(Payment.customer_id)
            )
        ).all():
            range_spend[cid] = int(total or 0)

    completed_counts: dict[str, int] = defaultdict(int)
    last_completed: dict[str, datetime] = {}
    for stub in stubs:
        if stub.status == "completed" and stub.completed_at is not None:
            completed_counts[stub.customer_id] += 1
            if stub.customer_id not in last_completed or stub.completed_at > last_completed[stub.customer_id]:
                last_completed[stub.customer_id] = stub.completed_at

    # --- summary ---
    paying = [spend for cid, spend in lifetime_spend.items() if completed_counts.get(cid)]
    wallet_holders = [c for c in customers.values() if (c.wallet_balance_cents or 0) > 0]
    completed_in_range = len(in_range_completed)
    summary = ClientsSummary(
        total_clients=len(customers),
        active_clients=len(active_ids),
        new_clients=len(new_ids),
        returning_clients=len(returning_ids),
        new_client_share=rate(len(new_ids), len(new_ids) + len(returning_ids)),
        average_visits_per_active_client=round(completed_in_range / len(active_ids), 2) if active_ids else None,
        rebooking_rate=rate(sum(1 for s in in_range_completed if s.id in rebooked), completed_in_range),
        blocked_clients=sum(1 for c in customers.values() if c.blocked_from_online_booking),
        wallet_holders=len(wallet_holders),
        wallet_liability_cents=sum(c.wallet_balance_cents or 0 for c in wallet_holders) if include_financial else None,
        average_lifetime_value_cents=round(sum(paying) / len(paying)) if include_financial and paying else None,
    )

    # --- retention: clients first seen in the 12 months ending at the range end ---
    # (a short range alone would rarely contain clients whose 30/60/90-day window has elapsed)
    retention_start = datetime.combine(rng.end - timedelta(days=365), datetime.min.time(), tzinfo=rng.zone).astimezone(timezone.utc)
    retention_ids = [
        cid
        for cid, visits in visits_by_customer.items()
        if retention_start <= visits[0].starts_at < rng.end_utc
    ]
    retention: list[RetentionRow] = []
    for window in RETENTION_WINDOWS:
        eligible = retained = 0
        for cid in retention_ids:
            visits = visits_by_customer[cid]
            if visits[0].starts_at + timedelta(days=window) > now:
                continue
            eligible += 1
            if _retained_within(visits, window):
                retained += 1
        retention.append(RetentionRow(window_days=window, eligible=eligible, retained=retained, rate=rate(retained, eligible)))

    # --- acquisition cohorts (trailing months ending with the range end month) ---
    cohorts: list[CohortRow] = []
    end_month = rng.end.replace(day=1)
    for offset in range(COHORT_MONTHS - 1, -1, -1):
        month_start = _months_back(end_month, offset)
        next_month = _months_back(end_month, offset - 1)
        members = [
            visits
            for visits in visits_by_customer.values()
            if month_start <= rng.local_date(visits[0].starts_at) < next_month
        ]
        eligible = [v for v in members if v[0].starts_at + timedelta(days=90) <= now]
        retained = [v for v in eligible if _retained_within(v, 90)]
        cohorts.append(
            CohortRow(
                month=month_start.strftime("%Y-%m"),
                new_clients=len(members),
                eligible_90_day=len(eligible),
                retained_90_day=len(retained),
                retention_rate=rate(len(retained), len(eligible)),
            )
        )

    # --- lead sources for clients acquired in range ---
    source_counts: dict[str, int] = defaultdict(int)
    for cid in new_ids:
        customer = customers.get(cid)
        source = (customer.source_channel if customer else None) or "unknown"
        source_counts[source] += 1
    sources = [
        CountRow(key=key, label=key.replace("_", " ").capitalize(), count=count)
        for key, count in sorted(source_counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    # --- top clients (by spend when allowed, otherwise by visits) in range ---
    visits_in_range: dict[str, int] = defaultdict(int)
    for stub in in_range_completed:
        visits_in_range[stub.customer_id] += 1
    ranked = sorted(
        active_ids,
        key=lambda cid: (-(range_spend.get(cid, 0) if include_financial else 0), -visits_in_range[cid], customers[cid].name if cid in customers else ""),
    )
    top_clients = [
        TopClientRow(
            customer_id=cid,
            name=customers[cid].name if cid in customers else "Unknown",
            visits=visits_in_range[cid],
            spend_cents=range_spend.get(cid, 0) if include_financial else None,
            last_visit=rng.local_date(last_completed[cid]) if cid in last_completed else None,
        )
        for cid in ranked[:TOP_LIMIT]
    ]

    # --- at-risk: completed before, nothing since the cutoff, nothing upcoming ---
    cutoff = datetime.combine(rng.end, datetime.min.time(), tzinfo=rng.zone).astimezone(timezone.utc) - timedelta(days=AT_RISK_DAYS)
    at_risk_ids = []
    for cid, last in last_completed.items():
        if last >= cutoff:
            continue
        upcoming = any(s.status == "confirmed" and s.starts_at >= now for s in visits_by_customer.get(cid, []))
        if upcoming:
            continue
        customer = customers.get(cid)
        if customer is None or customer.blocked_from_online_booking:
            continue
        at_risk_ids.append(cid)
    at_risk_ids.sort(key=lambda cid: (-(lifetime_spend.get(cid, 0) if include_financial else 0), last_completed[cid]))
    at_risk = [
        AtRiskRow(
            customer_id=cid,
            name=customers[cid].name,
            visits=completed_counts[cid],
            last_visit=rng.local_date(last_completed[cid]),
            days_since_last_visit=(now - last_completed[cid]).days,
            lifetime_spend_cents=lifetime_spend.get(cid, 0) if include_financial else None,
        )
        for cid in at_risk_ids[:AT_RISK_LIMIT]
    ]

    return ClientsReportResponse(
        range=rng.to_response(),
        include_financial=include_financial,
        summary=summary,
        retention=retention,
        cohorts=cohorts,
        sources=sources,
        top_clients=top_clients,
        at_risk_count=len(at_risk_ids),
        at_risk=at_risk,
    )
