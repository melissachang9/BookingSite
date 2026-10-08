"""Sales report.

Definitions (also surfaced in the dashboard):
  * Gross sales  = service price + add-on/extra items, by completion date.
  * Net sales    = gross - discounts. Tax and tips are reported separately.
  * Cash block   = payment activity by payment date: collected, refunds,
    wallet movements, forfeited deposits, no-show fees.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Booking, Payment, PaymentEvent, Tenant
from app.schemas.reports import (
    BreakdownRow,
    CashSummary,
    OutstandingSummary,
    PaymentMethodRow,
    SalesKpis,
    SalesPoint,
    SalesReportResponse,
)
from app.services.reports.data import (
    BookingMoney,
    booking_money,
    load_catalog_names,
    load_completed_bookings,
    outstanding_balance_cents,
)
from app.services.reports.ranges import ReportRange, bucket_start, bucket_starts, previous_range

REFUND_EVENT_KINDS = ("refund_recorded", "refund_processed")
WALLET_CREDIT_EVENT_KINDS = ("wallet_credited", "wallet_returned")

UNKNOWN = "Unknown"


@dataclass
class _Acc:
    label: str
    appointments: int = 0
    gross: int = 0
    discounts: int = 0
    tips: int = 0

    def add(self, money: BookingMoney) -> None:
        self.appointments += 1
        self.gross += money.gross_cents
        self.discounts += money.discount_cents
        self.tips += money.tips_cents


def _rows(accs: dict[str, _Acc]) -> list[BreakdownRow]:
    rows = [
        BreakdownRow(
            key=key,
            label=acc.label,
            appointments=acc.appointments,
            gross_sales_cents=acc.gross,
            discounts_cents=acc.discounts,
            net_sales_cents=acc.gross - acc.discounts,
            tips_cents=acc.tips,
        )
        for key, acc in accs.items()
    ]
    rows.sort(key=lambda row: (-row.net_sales_cents, row.label))
    return rows


def compute_kpis(bookings: list[Booking]) -> SalesKpis:
    gross = discounts = tax = tips = add_on = with_items = 0
    for booking in bookings:
        money = booking_money(booking)
        gross += money.gross_cents
        discounts += money.discount_cents
        tax += money.tax_cents
        tips += money.tips_cents
        add_on += money.items_cents
        if money.items_cents > 0:
            with_items += 1
    count = len(bookings)
    net = gross - discounts
    return SalesKpis(
        gross_sales_cents=gross,
        discounts_cents=discounts,
        net_sales_cents=net,
        tax_cents=tax,
        tips_cents=tips,
        completed_appointments=count,
        average_ticket_cents=round(net / count) if count else 0,
        add_on_sales_cents=add_on,
        add_on_attach_rate=round(with_items / count, 4) if count else 0.0,
    )


async def _cash_summary(
    session: AsyncSession,
    tenant: Tenant,
    rng: ReportRange,
    *,
    location_id: str | None,
    provider_id: str | None,
) -> CashSummary:
    def scope(query):
        if location_id or provider_id:
            query = query.join(Booking, Booking.id == Payment.booking_id)
            if location_id:
                query = query.where(Booking.location_id == location_id)
            if provider_id:
                query = query.where(Booking.provider_id == provider_id)
        return query

    payments = (
        await session.scalars(
            scope(
                select(Payment).where(
                    Payment.tenant_id == tenant.id,
                    Payment.status == "succeeded",
                    Payment.created_at >= rng.start_utc,
                    Payment.created_at < rng.end_utc,
                )
            )
        )
    ).all()

    methods: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    collected = 0
    for payment in payments:
        collected += payment.amount_cents
        bucket = methods[payment.payment_method_type or UNKNOWN]
        bucket[0] += 1
        bucket[1] += payment.amount_cents - payment.tip_cents
        bucket[2] += payment.tip_cents

    event_query = (
        select(PaymentEvent.kind, PaymentEvent.amount_cents)
        .join(Payment, Payment.id == PaymentEvent.payment_id)
        .where(
            PaymentEvent.tenant_id == tenant.id,
            PaymentEvent.occurred_at >= rng.start_utc,
            PaymentEvent.occurred_at < rng.end_utc,
            PaymentEvent.kind.in_(
                (*REFUND_EVENT_KINDS, *WALLET_CREDIT_EVENT_KINDS, "wallet_applied", "deposit_forfeited", "no_show_fee_charged")
            ),
        )
    )
    if location_id or provider_id:
        event_query = event_query.join(Booking, Booking.id == Payment.booking_id)
        if location_id:
            event_query = event_query.where(Booking.location_id == location_id)
        if provider_id:
            event_query = event_query.where(Booking.provider_id == provider_id)

    totals: dict[str, int] = defaultdict(int)
    for kind, amount in (await session.execute(event_query)).all():
        totals[kind] += amount or 0

    return CashSummary(
        collected_cents=collected,
        refunded_cents=sum(totals[k] for k in REFUND_EVENT_KINDS),
        wallet_credited_cents=sum(totals[k] for k in WALLET_CREDIT_EVENT_KINDS),
        wallet_applied_cents=totals["wallet_applied"],
        deposits_forfeited_cents=totals["deposit_forfeited"],
        no_show_fees_cents=totals["no_show_fee_charged"],
        payment_methods=sorted(
            (
                PaymentMethodRow(method=method, payments=v[0], amount_cents=v[1], tips_cents=v[2])
                for method, v in methods.items()
            ),
            key=lambda row: -row.amount_cents,
        ),
    )


async def build_sales_report(
    session: AsyncSession,
    tenant: Tenant,
    rng: ReportRange,
    *,
    location_id: str | None = None,
    provider_id: str | None = None,
    compare: str | None = None,
) -> SalesReportResponse:
    bookings = await load_completed_bookings(session, tenant, rng, location_id=location_id, provider_id=provider_id)
    names = await load_catalog_names(session, tenant.id)

    by_service: dict[str, _Acc] = {}
    by_category: dict[str, _Acc] = {}
    by_provider: dict[str, _Acc] = {}
    by_location: dict[str, _Acc] = {}
    by_channel: dict[str, _Acc] = {}
    points = {start: [0, 0, 0, 0] for start in bucket_starts(rng)}
    outstanding_cents = 0
    follow_ups = 0

    for booking in bookings:
        money = booking_money(booking)

        service_name = names.services.get(booking.service_id) or booking.service.name
        by_service.setdefault(booking.service_id, _Acc(service_name)).add(money)

        category_id = names.service_category.get(booking.service_id)
        category_key = category_id or "uncategorized"
        category_label = names.categories.get(category_id or "", "Uncategorized")
        by_category.setdefault(category_key, _Acc(category_label)).add(money)

        by_provider.setdefault(booking.provider_id, _Acc(booking.provider.name)).add(money)

        location_key = booking.location_id or "none"
        by_location.setdefault(location_key, _Acc(names.locations.get(booking.location_id or "", "No location"))).add(money)

        channel = booking.source_channel or UNKNOWN.lower()
        by_channel.setdefault(channel, _Acc(channel.replace("_", " ").capitalize())).add(money)

        point = points[bucket_start(rng.local_date(booking.completed_at), rng.group_by)]
        point[0] += money.gross_cents
        point[1] += money.net_cents
        point[2] += money.tips_cents
        point[3] += 1

        if booking.payment_resolution == "follow_up":
            follow_ups += 1
            outstanding_cents += outstanding_balance_cents(booking)

    previous = None
    previous_rng = None
    if compare in ("prior_period", "prior_year"):
        previous_rng = previous_range(rng, compare)
        previous = compute_kpis(
            await load_completed_bookings(session, tenant, previous_rng, location_id=location_id, provider_id=provider_id)
        )

    return SalesReportResponse(
        range=rng.to_response(),
        kpis=compute_kpis(bookings),
        previous_range=previous_rng.to_response() if previous_rng else None,
        previous_kpis=previous,
        series=[
            SalesPoint(
                bucket_start=start,
                gross_sales_cents=v[0],
                net_sales_cents=v[1],
                tips_cents=v[2],
                appointments=v[3],
            )
            for start, v in points.items()
        ],
        by_service=_rows(by_service),
        by_category=_rows(by_category),
        by_provider=_rows(by_provider),
        by_location=_rows(by_location),
        by_channel=_rows(by_channel),
        cash=await _cash_summary(session, tenant, rng, location_id=location_id, provider_id=provider_id),
        outstanding=OutstandingSummary(outstanding_balance_cents=outstanding_cents, follow_up_count=follow_ups),
    )
