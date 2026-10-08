"""CSV rendering for reports. Money is exported in dollars, rates as percentages."""

from __future__ import annotations

import csv
import io
from typing import Any

from app.schemas.reports import (
    AppointmentsReportResponse,
    ClientsReportResponse,
    SalesReportResponse,
    TeamReportResponse,
)

Section = tuple[str, list[str], list[list[Any]]]


def _usd(cents: int | None) -> str:
    return "" if cents is None else f"{cents / 100:.2f}"


def _pct(value: float | None) -> str:
    return "" if value is None else f"{value * 100:.1f}%"


def _safe(cell: Any) -> Any:
    """Neutralise spreadsheet formula injection from user-entered text."""
    if isinstance(cell, str) and cell[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + cell
    return cell


def render_csv(title: str, range_label_text: str, sections: list[Section]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([title])
    writer.writerow([range_label_text])
    for heading, header, rows in sections:
        writer.writerow([])
        writer.writerow([heading])
        writer.writerow(header)
        for row in rows:
            writer.writerow([_safe(cell) for cell in row])
    return buffer.getvalue()


def range_label(report: Any) -> str:
    r = report.range
    return f"{r.start_date} to {r.end_date} ({r.timezone})"


def sales_sections(report: SalesReportResponse) -> list[Section]:
    k = report.kpis
    breakdown_header = ["Name", "Appointments", "Gross sales", "Discounts", "Net sales", "Tips"]

    def breakdown(rows):
        return [
            [r.label, r.appointments, _usd(r.gross_sales_cents), _usd(r.discounts_cents), _usd(r.net_sales_cents), _usd(r.tips_cents)]
            for r in rows
        ]

    return [
        (
            "Summary",
            ["Metric", "Value"],
            [
                ["Gross sales", _usd(k.gross_sales_cents)],
                ["Discounts", _usd(k.discounts_cents)],
                ["Net sales", _usd(k.net_sales_cents)],
                ["Tax", _usd(k.tax_cents)],
                ["Tips", _usd(k.tips_cents)],
                ["Completed appointments", k.completed_appointments],
                ["Average ticket", _usd(k.average_ticket_cents)],
                ["Add-on sales", _usd(k.add_on_sales_cents)],
                ["Add-on attach rate", _pct(k.add_on_attach_rate)],
                ["Collected", _usd(report.cash.collected_cents)],
                ["Refunded", _usd(report.cash.refunded_cents)],
                ["Outstanding balances", _usd(report.outstanding.outstanding_balance_cents)],
            ],
        ),
        (
            "Sales over time",
            ["Period start", "Gross sales", "Net sales", "Tips", "Appointments"],
            [[p.bucket_start, _usd(p.gross_sales_cents), _usd(p.net_sales_cents), _usd(p.tips_cents), p.appointments] for p in report.series],
        ),
        ("By service", breakdown_header, breakdown(report.by_service)),
        ("By category", breakdown_header, breakdown(report.by_category)),
        ("By provider", breakdown_header, breakdown(report.by_provider)),
        ("By location", breakdown_header, breakdown(report.by_location)),
        ("By booking channel", breakdown_header, breakdown(report.by_channel)),
        (
            "Payment methods",
            ["Method", "Payments", "Amount (excl. tips)", "Tips"],
            [[m.method, m.payments, _usd(m.amount_cents), _usd(m.tips_cents)] for m in report.cash.payment_methods],
        ),
    ]


def team_sections(report: TeamReportResponse) -> list[Section]:
    header = [
        "Provider", "Completed", "Scheduled", "No-shows", "Canceled", "No-show rate", "Cancel rate",
        "New-client share", "Rebooking rate", "Booked hours", "Scheduled hours", "Utilization",
    ]
    if report.include_financial:
        header += ["Gross sales", "Discounts", "Net sales", "Add-on sales", "Tips", "Average ticket", "Commission"]
    rows = []
    for m in report.members:
        row: list[Any] = [
            m.name, m.appointments_completed, m.appointments_scheduled, m.no_shows, m.canceled,
            _pct(m.no_show_rate), _pct(m.cancel_rate), _pct(m.new_client_share), _pct(m.rebooking_rate),
            f"{m.booked_minutes / 60:.1f}",
            "" if m.scheduled_minutes is None else f"{m.scheduled_minutes / 60:.1f}",
            _pct(m.utilization_rate),
        ]
        if report.include_financial:
            row += [
                _usd(m.gross_sales_cents), _usd(m.discounts_cents), _usd(m.net_sales_cents),
                _usd(m.add_on_sales_cents), _usd(m.tips_cents), _usd(m.average_ticket_cents), _usd(m.commission_cents),
            ]
        rows.append(row)
    return [("Team", header, rows)]


def clients_sections(report: ClientsReportResponse) -> list[Section]:
    s = report.summary
    return [
        (
            "Summary",
            ["Metric", "Value"],
            [
                ["Total clients", s.total_clients],
                ["Active clients", s.active_clients],
                ["New clients", s.new_clients],
                ["Returning clients", s.returning_clients],
                ["New-client share", _pct(s.new_client_share)],
                ["Average visits per active client", s.average_visits_per_active_client or ""],
                ["Rebooking rate", _pct(s.rebooking_rate)],
                ["Blocked clients", s.blocked_clients],
                ["Wallet holders", s.wallet_holders],
                ["Wallet liability", _usd(s.wallet_liability_cents)],
                ["Average lifetime value", _usd(s.average_lifetime_value_cents)],
            ],
        ),
        (
            "Retention",
            ["Window (days)", "Eligible", "Retained", "Rate"],
            [[r.window_days, r.eligible, r.retained, _pct(r.rate)] for r in report.retention],
        ),
        (
            "Acquisition cohorts",
            ["Month", "New clients", "Eligible (90 day)", "Retained (90 day)", "Retention"],
            [[c.month, c.new_clients, c.eligible_90_day, c.retained_90_day, _pct(c.retention_rate)] for c in report.cohorts],
        ),
        ("Lead sources", ["Source", "New clients"], [[r.label, r.count] for r in report.sources]),
        (
            "Top clients",
            ["Client", "Visits", "Spend", "Last visit"],
            [[t.name, t.visits, _usd(t.spend_cents), t.last_visit or ""] for t in report.top_clients],
        ),
        (
            "At-risk clients",
            ["Client", "Visits", "Last visit", "Days since", "Lifetime spend"],
            [[a.name, a.visits, a.last_visit, a.days_since_last_visit, _usd(a.lifetime_spend_cents)] for a in report.at_risk],
        ),
    ]


def appointments_sections(report: AppointmentsReportResponse) -> list[Section]:
    s = report.summary
    return [
        (
            "Summary",
            ["Metric", "Value"],
            [
                ["Total appointments", s.total],
                ["Completed", s.completed],
                ["Upcoming", s.upcoming],
                ["Canceled", s.canceled],
                ["No-shows", s.no_shows],
                ["No-show rate", _pct(s.no_show_rate)],
                ["Cancel rate", _pct(s.cancel_rate)],
                ["Late cancellations", s.late_cancel_count],
                ["Reschedule rate", _pct(s.reschedule_rate)],
                ["Average lead time (days)", s.average_lead_time_days or ""],
                ["Average wait (minutes)", s.average_wait_minutes or ""],
                ["Booking conversion", _pct(report.drafts.conversion_rate)],
            ],
        ),
        ("Status", ["Status", "Count"], [[r.label, r.count] for r in report.status_mix]),
        ("Lead time", ["Lead time", "Count"], [[r.label, r.count] for r in report.lead_time]),
        ("Canceled by", ["Who", "Count"], [[r.label, r.count] for r in report.cancel_actors]),
        ("Cancel reasons", ["Reason", "Count"], [[r.label, r.count] for r in report.cancel_reasons]),
        ("Booking channel", ["Channel", "Count"], [[r.label, r.count] for r in report.channels]),
        (
            "Rooms and equipment",
            ["Resource", "Type", "Booked hours", "Capacity hours", "Utilization"],
            [
                [r.name, r.kind, f"{r.booked_minutes / 60:.1f}", "" if r.capacity_minutes is None else f"{r.capacity_minutes / 60:.1f}", _pct(r.utilization_rate)]
                for r in report.resources
            ],
        ),
    ]
