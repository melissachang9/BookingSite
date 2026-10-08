from __future__ import annotations

from datetime import date

from app.schemas.base import CamelModel


class ReportRangeResponse(CamelModel):
    start_date: date
    end_date: date
    timezone: str
    group_by: str
    day_count: int


class CountRow(CamelModel):
    key: str
    label: str
    count: int


# ---------------------------------------------------------------- sales ----


class SalesKpis(CamelModel):
    gross_sales_cents: int = 0
    discounts_cents: int = 0
    net_sales_cents: int = 0
    tax_cents: int = 0
    tips_cents: int = 0
    completed_appointments: int = 0
    average_ticket_cents: int = 0
    add_on_sales_cents: int = 0
    add_on_attach_rate: float = 0.0


class SalesPoint(CamelModel):
    bucket_start: date
    gross_sales_cents: int
    net_sales_cents: int
    tips_cents: int
    appointments: int


class BreakdownRow(CamelModel):
    key: str
    label: str
    appointments: int
    gross_sales_cents: int
    discounts_cents: int
    net_sales_cents: int
    tips_cents: int


class PaymentMethodRow(CamelModel):
    method: str
    payments: int
    amount_cents: int
    tips_cents: int


class CashSummary(CamelModel):
    collected_cents: int = 0
    refunded_cents: int = 0
    wallet_credited_cents: int = 0
    wallet_applied_cents: int = 0
    deposits_forfeited_cents: int = 0
    no_show_fees_cents: int = 0
    payment_methods: list[PaymentMethodRow] = []


class OutstandingSummary(CamelModel):
    outstanding_balance_cents: int = 0
    follow_up_count: int = 0


class SalesReportResponse(CamelModel):
    range: ReportRangeResponse
    kpis: SalesKpis
    previous_range: ReportRangeResponse | None = None
    previous_kpis: SalesKpis | None = None
    series: list[SalesPoint]
    by_service: list[BreakdownRow]
    by_category: list[BreakdownRow]
    by_provider: list[BreakdownRow]
    by_location: list[BreakdownRow]
    by_channel: list[BreakdownRow]
    cash: CashSummary
    outstanding: OutstandingSummary


# ----------------------------------------------------------------- team ----


class TeamMemberRow(CamelModel):
    provider_id: str
    name: str
    is_active: bool
    appointments_completed: int
    appointments_scheduled: int
    no_shows: int
    canceled: int
    no_show_rate: float | None
    cancel_rate: float | None
    new_client_appointments: int
    new_client_share: float | None
    rebooked_appointments: int
    rebooking_rate: float | None
    booked_minutes: int
    scheduled_minutes: int | None
    utilization_rate: float | None
    # Financial fields are null unless the caller holds reports.financial.
    gross_sales_cents: int | None = None
    discounts_cents: int | None = None
    net_sales_cents: int | None = None
    add_on_sales_cents: int | None = None
    tips_cents: int | None = None
    average_ticket_cents: int | None = None
    commission_cents: int | None = None
    compensation_mode: str | None = None


class TeamTotals(CamelModel):
    appointments_completed: int
    booked_minutes: int
    scheduled_minutes: int | None
    utilization_rate: float | None
    net_sales_cents: int | None = None
    tips_cents: int | None = None
    commission_cents: int | None = None


class TeamReportResponse(CamelModel):
    range: ReportRangeResponse
    include_financial: bool
    members: list[TeamMemberRow]
    totals: TeamTotals


# -------------------------------------------------------------- clients ----


class ClientsSummary(CamelModel):
    total_clients: int
    active_clients: int
    new_clients: int
    returning_clients: int
    new_client_share: float | None
    average_visits_per_active_client: float | None
    rebooking_rate: float | None
    blocked_clients: int
    wallet_holders: int
    wallet_liability_cents: int | None = None
    average_lifetime_value_cents: int | None = None


class RetentionRow(CamelModel):
    window_days: int
    eligible: int
    retained: int
    rate: float | None


class CohortRow(CamelModel):
    month: str
    new_clients: int
    eligible_90_day: int
    retained_90_day: int
    retention_rate: float | None


class TopClientRow(CamelModel):
    customer_id: str
    name: str
    visits: int
    spend_cents: int | None = None
    last_visit: date | None = None


class AtRiskRow(CamelModel):
    customer_id: str
    name: str
    visits: int
    last_visit: date
    days_since_last_visit: int
    lifetime_spend_cents: int | None = None


class ClientsReportResponse(CamelModel):
    range: ReportRangeResponse
    include_financial: bool
    summary: ClientsSummary
    retention: list[RetentionRow]
    cohorts: list[CohortRow]
    sources: list[CountRow]
    top_clients: list[TopClientRow]
    at_risk_count: int
    at_risk: list[AtRiskRow]


# --------------------------------------------------------- appointments ----


class AppointmentsSummary(CamelModel):
    total: int
    completed: int
    upcoming: int
    canceled: int
    no_shows: int
    no_show_rate: float | None
    cancel_rate: float | None
    late_cancel_count: int
    late_cancel_rate: float | None
    reschedule_rate: float | None
    average_lead_time_days: float | None
    average_wait_minutes: float | None
    average_late_start_minutes: float | None


class HeatCell(CamelModel):
    weekday: int  # 0 = Monday
    hour: int
    count: int


class DraftFunnel(CamelModel):
    total: int
    confirmed: int
    abandoned: int
    conversion_rate: float | None


class ResourceUtilizationRow(CamelModel):
    resource_id: str
    name: str
    kind: str
    booked_minutes: int
    capacity_minutes: int | None
    utilization_rate: float | None


class AppointmentsReportResponse(CamelModel):
    range: ReportRangeResponse
    summary: AppointmentsSummary
    status_mix: list[CountRow]
    lead_time: list[CountRow]
    cancel_actors: list[CountRow]
    cancel_reasons: list[CountRow]
    channels: list[CountRow]
    booking_methods: list[CountRow]
    heatmap: list[HeatCell]
    drafts: DraftFunnel
    resources: list[ResourceUtilizationRow]
