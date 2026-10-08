import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  AppointmentsReport,
  ClientsReport,
  LocationSummary,
  ReportGroupBy,
  ReportKind,
  ReportQuery,
  SalesBreakdownRow,
  SalesReport,
  TeamReport,
} from "@booking/shared-types";

import { platformApi } from "./platform-api";
import { BarList, Heatmap, LineChart, ReportTable, type BarRow } from "./report-charts";

// ---------------------------------------------------------------- helpers ----

const moneyFormatter = (fractionDigits: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
const wholeDollars = moneyFormatter(0);
const withCents = moneyFormatter(2);
/** "$5,099.16" — cents only when there are some. */
const money = (cents: number) => {
  const rounded = Math.round(cents);
  return (rounded % 100 === 0 ? wholeDollars : withCents).format(rounded / 100);
};
const moneyOrDash = (cents: number | null | undefined) => (cents == null ? "–" : money(cents));
const percent = (value: number | null | undefined) => (value == null ? "–" : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`);
const hours = (minutes: number | null | undefined) => (minutes == null ? "–" : `${(minutes / 60).toFixed(1)} h`);
const count = (value: number) => value.toLocaleString("en-US");

function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type PresetKey = "today" | "7d" | "30d" | "month" | "last_month" | "ytd" | "custom";

const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "ytd", label: "Year to date" },
  { key: "custom", label: "Custom" },
];

function presetRange(key: PresetKey, today: string): { from: string; to: string } {
  const monthStart = `${today.slice(0, 8)}01`;
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: shiftDays(today, -6), to: today };
    case "month":
      return { from: monthStart, to: today };
    case "last_month": {
      const lastDay = shiftDays(monthStart, -1);
      return { from: `${lastDay.slice(0, 8)}01`, to: lastDay };
    }
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return { from: shiftDays(today, -29), to: today };
  }
}

function bucketLabel(iso: string, groupBy: ReportGroupBy): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (groupBy === "month") return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).format(date);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

type LoadState<T> = { kind: "loading" } | { kind: "ready"; data: T } | { kind: "error"; message: string };

function useReport<T>(enabled: boolean, load: () => Promise<T>, deps: unknown[]): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ kind: "loading" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableLoad = useCallback(load, deps);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ kind: "loading" });
    stableLoad()
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ kind: "error", message: error instanceof Error ? error.message : "Unable to load this report." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, stableLoad]);
  return state;
}

function ReportState<T>({ state, children }: { state: LoadState<T>; children: (data: T) => ReactNode }) {
  if (state.kind === "loading") return <p className="rp-status" role="status">Loading report…</p>;
  if (state.kind === "error") return <p className="cs-error" role="alert">{state.message}</p>;
  return <>{children(state.data)}</>;
}

function Kpi({
  label,
  value,
  hint,
  previous,
  current,
  invert = false,
}: {
  label: string;
  value: string;
  hint?: string;
  previous?: number | null;
  current?: number;
  /** For metrics where lower is better (e.g. refunds). */
  invert?: boolean;
}) {
  let delta: ReactNode = null;
  if (previous != null && current != null) {
    if (previous === 0) {
      delta = current === 0 ? <span className="rp-delta">no change</span> : <span className="rp-delta">new vs. prior</span>;
    } else {
      const change = (current - previous) / previous;
      const up = change > 0;
      const good = invert ? !up : up;
      delta = (
        <span className={`rp-delta ${change === 0 ? "" : good ? "rp-delta--good" : "rp-delta--bad"}`}>
          {change === 0 ? "no change" : `${up ? "▲" : "▼"} ${Math.abs(change * 100).toFixed(0)}% vs. prior`}
        </span>
      );
    }
  }
  return (
    <div className="rp-kpi">
      <span className="rp-kpi__label">{label}</span>
      <span className="rp-kpi__value">{value}</span>
      {delta}
      {hint ? <span className="rp-kpi__hint">{hint}</span> : null}
    </div>
  );
}

const asBars = (rows: Array<{ key: string; label: string; count: number }>): BarRow[] =>
  rows.map((row) => ({ key: row.key, label: row.label, value: row.count }));

// -------------------------------------------------------------- the section ----

type TabKey = ReportKind;

export function ReportsSection({
  tenantSlug,
  tenantTimezone,
  canViewReports,
  canViewFinancial,
  canExport,
}: {
  tenantSlug: string;
  tenantTimezone: string;
  canViewReports: boolean;
  canViewFinancial: boolean;
  canExport: boolean;
}) {
  const today = useMemo(() => todayIn(tenantTimezone), [tenantTimezone]);
  const [tab, setTab] = useState<TabKey>(canViewFinancial ? "sales" : "team");
  const [preset, setPreset] = useState<PresetKey>("30d");
  const [range, setRange] = useState(() => presetRange("30d", today));
  const [groupBy, setGroupBy] = useState<ReportGroupBy>("day");
  const [compare, setCompare] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!canViewReports) return;
    platformApi
      .listLocationsAdmin(tenantSlug)
      .then((response) => setLocations(response.locations))
      .catch(() => setLocations([]));
    platformApi
      .listProvidersAdmin(tenantSlug)
      .then((response) => setProviders(response.providers.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProviders([]));
  }, [tenantSlug, canViewReports]);

  if (!canViewReports) {
    return <p className="cs-permission-note">You do not have permission to view reports.</p>;
  }

  const rangeInvalid = range.from > range.to;
  const query: ReportQuery = {
    from: range.from,
    to: range.to,
    groupBy: tab === "sales" ? groupBy : undefined,
    locationId: locationId || undefined,
    providerId: providerId || undefined,
  };
  const tabs: Array<{ key: TabKey; label: string; hidden?: boolean }> = [
    { key: "sales", label: "Sales", hidden: !canViewFinancial },
    { key: "team", label: "Team" },
    { key: "clients", label: "Clients" },
    { key: "appointments", label: "Appointments" },
  ];
  const clientsIgnoreFilters = tab === "clients";

  const choosePreset = (key: PresetKey) => {
    setPreset(key);
    if (key !== "custom") setRange(presetRange(key, today));
  };

  const download = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const csv = await platformApi.exportReportCsv(tenantSlug, tab, query);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${tab}-report-${range.from}-to-${range.to}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Unable to export this report.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="rp">
      <nav className="rp-tabs" role="tablist" aria-label="Report type">
        {tabs
          .filter((entry) => !entry.hidden)
          .map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={tab === entry.key}
              className={`rp-tab${tab === entry.key ? " is-active" : ""}`}
              onClick={() => setTab(entry.key)}
            >
              {entry.label}
            </button>
          ))}
      </nav>

      <div className="rp-filters">
        <div className="rp-presets" role="group" aria-label="Date range">
          {PRESETS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`rp-chip${preset === entry.key ? " is-on" : ""}`}
              aria-pressed={preset === entry.key}
              onClick={() => choosePreset(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {preset === "custom" ? (
          <div className="rp-dates">
            <label>
              <span>From</span>
              <input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            </label>
            <label>
              <span>To</span>
              <input type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            </label>
          </div>
        ) : (
          <span className="rp-range-note">{range.from} → {range.to}</span>
        )}
        <div className="rp-selects">
          {locations.length > 1 && !clientsIgnoreFilters ? (
            <label>
              <span className="rp-sr">Location</span>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Location">
                <option value="">All locations</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          {providers.length > 1 && !clientsIgnoreFilters ? (
            <label>
              <span className="rp-sr">Team member</span>
              <select value={providerId} onChange={(e) => setProviderId(e.target.value)} aria-label="Team member">
                <option value="">All team members</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          {tab === "sales" ? (
            <>
              <label>
                <span className="rp-sr">Group by</span>
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as ReportGroupBy)} aria-label="Group by">
                  <option value="day">By day</option>
                  <option value="week">By week</option>
                  <option value="month">By month</option>
                </select>
              </label>
              <label className="rp-check">
                <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
                Compare to prior period
              </label>
            </>
          ) : null}
        </div>
        {canExport ? (
          <button type="button" className="rp-export" onClick={() => void download()} disabled={exporting || rangeInvalid}>
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        ) : null}
      </div>
      {exportError ? <p className="cs-error" role="alert">{exportError}</p> : null}
      {rangeInvalid ? <p className="cs-error" role="alert">The start date must be on or before the end date.</p> : null}

      {!rangeInvalid && tab === "sales" && canViewFinancial ? (
        <SalesView tenantSlug={tenantSlug} query={query} compare={compare} />
      ) : null}
      {!rangeInvalid && tab === "team" ? <TeamView tenantSlug={tenantSlug} query={query} /> : null}
      {!rangeInvalid && tab === "clients" ? <ClientsView tenantSlug={tenantSlug} query={query} /> : null}
      {!rangeInvalid && tab === "appointments" ? <AppointmentsView tenantSlug={tenantSlug} query={query} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ sales ----

const DIMENSIONS = [
  { key: "byService", label: "Service" },
  { key: "byCategory", label: "Category" },
  { key: "byProvider", label: "Team member" },
  { key: "byLocation", label: "Location" },
  { key: "byChannel", label: "Booking channel" },
] as const;

function SalesView({ tenantSlug, query, compare }: { tenantSlug: string; query: ReportQuery; compare: boolean }) {
  const state = useReport<SalesReport>(
    true,
    () => platformApi.getSalesReport(tenantSlug, query, compare ? "prior_period" : undefined),
    [tenantSlug, query.from, query.to, query.groupBy, query.locationId, query.providerId, compare],
  );
  const [dimension, setDimension] = useState<(typeof DIMENSIONS)[number]["key"]>("byService");

  return (
    <ReportState state={state}>
      {(report) => {
        const k = report.kpis;
        const p = report.previousKpis ?? null;
        const groupBy = report.range.groupBy;
        const rows: SalesBreakdownRow[] = report[dimension];
        return (
          <div className="rp-body">
            <div className="rp-kpis">
              <Kpi label="Net sales" value={money(k.netSalesCents)} current={k.netSalesCents} previous={p?.netSalesCents} hint="Gross minus discounts" />
              <Kpi label="Gross sales" value={money(k.grossSalesCents)} current={k.grossSalesCents} previous={p?.grossSalesCents} />
              <Kpi label="Completed visits" value={count(k.completedAppointments)} current={k.completedAppointments} previous={p?.completedAppointments} />
              <Kpi label="Average ticket" value={money(k.averageTicketCents)} current={k.averageTicketCents} previous={p?.averageTicketCents} />
              <Kpi label="Tips" value={money(k.tipsCents)} current={k.tipsCents} previous={p?.tipsCents} />
              <Kpi label="Discounts" value={money(k.discountsCents)} current={k.discountsCents} previous={p?.discountsCents} invert />
              <Kpi label="Tax collected" value={money(k.taxCents)} current={k.taxCents} previous={p?.taxCents} />
              <Kpi label="Add-on sales" value={money(k.addOnSalesCents)} hint={`${percent(k.addOnAttachRate)} of visits`} current={k.addOnSalesCents} previous={p?.addOnSalesCents} />
            </div>

            <LineChart
              title="Net sales"
              seriesLabel="Net sales"
              format={money}
              points={report.series.map((point) => ({ label: bucketLabel(point.bucketStart, groupBy), value: point.netSalesCents }))}
            />

            <div className="rp-grid2">
              <BarList
                title="Net sales by service"
                rows={report.byService.map((r) => ({ key: r.key, label: r.label, value: r.netSalesCents, detail: `${r.appointments} visits` }))}
                format={money}
              />
              <BarList
                title="Net sales by team member"
                rows={report.byProvider.map((r) => ({ key: r.key, label: r.label, value: r.netSalesCents, detail: `${r.appointments} visits` }))}
                format={money}
              />
            </div>

            <section className="rp-card">
              <div className="rp-card__head">
                <h4 className="rp-card__title">Breakdown</h4>
                <label className="rp-inline">
                  <span>By</span>
                  <select value={dimension} onChange={(e) => setDimension(e.target.value as typeof dimension)}>
                    {DIMENSIONS.map((d) => (
                      <option key={d.key} value={d.key}>{d.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              {rows.length === 0 ? (
                <p className="cs-empty">No completed visits in this range.</p>
              ) : (
                <ReportTable caption={`Sales by ${DIMENSIONS.find((d) => d.key === dimension)?.label.toLowerCase()}`} head={["Name", "Visits", "Gross", "Discounts", "Net", "Tips"]}>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">{row.label}</th>
                      <td>{count(row.appointments)}</td>
                      <td>{money(row.grossSalesCents)}</td>
                      <td>{money(row.discountsCents)}</td>
                      <td>{money(row.netSalesCents)}</td>
                      <td>{money(row.tipsCents)}</td>
                    </tr>
                  ))}
                </ReportTable>
              )}
            </section>

            <section className="rp-card">
              <h4 className="rp-card__title">Cash activity</h4>
              <p className="rp-note">By payment date, separate from sales above.</p>
              <div className="rp-kpis rp-kpis--compact">
                <Kpi label="Collected" value={money(report.cash.collectedCents)} hint="Succeeded payments incl. tips" />
                <Kpi label="Refunded" value={money(report.cash.refundedCents)} />
                <Kpi label="Wallet credit issued" value={money(report.cash.walletCreditedCents)} />
                <Kpi label="Wallet applied" value={money(report.cash.walletAppliedCents)} />
                <Kpi label="Deposits forfeited" value={money(report.cash.depositsForfeitedCents)} />
                <Kpi label="No-show fees" value={money(report.cash.noShowFeesCents)} />
                <Kpi
                  label="Balances to follow up"
                  value={money(report.outstanding.outstandingBalanceCents)}
                  hint={`${report.outstanding.followUpCount} visit${report.outstanding.followUpCount === 1 ? "" : "s"}`}
                />
              </div>
              {report.cash.paymentMethods.length > 0 ? (
                <ReportTable caption="Payments by method" head={["Method", "Payments", "Amount", "Tips"]}>
                  {report.cash.paymentMethods.map((m) => (
                    <tr key={m.method}>
                      <th scope="row">{m.method.replace(/_/g, " ")}</th>
                      <td>{count(m.payments)}</td>
                      <td>{money(m.amountCents)}</td>
                      <td>{money(m.tipsCents)}</td>
                    </tr>
                  ))}
                </ReportTable>
              ) : (
                <p className="cs-empty">No payments in this range.</p>
              )}
            </section>

            <Definitions>
              <li><strong>Gross sales</strong> — service price plus add-ons/extra items on visits completed in the range.</li>
              <li><strong>Net sales</strong> — gross minus discounts applied at completion. Tax and tips are shown separately.</li>
              <li><strong>Tax</strong> — the amount charged at completion (older visits use the current rate).</li>
              <li><strong>Cash activity</strong> — by payment date: succeeded payments (including tips), card/cash refunds, wallet movements, forfeited deposits and no-show fees.</li>
              <li>Days are grouped in the business time zone ({report.range.timezone}).</li>
            </Definitions>
          </div>
        );
      }}
    </ReportState>
  );
}

function Definitions({ children }: { children: ReactNode }) {
  return (
    <details className="rp-defs">
      <summary>How this is calculated</summary>
      <ul>{children}</ul>
    </details>
  );
}

// ------------------------------------------------------------------- team ----

function TeamView({ tenantSlug, query }: { tenantSlug: string; query: ReportQuery }) {
  const state = useReport<TeamReport>(
    true,
    () => platformApi.getTeamReport(tenantSlug, query),
    [tenantSlug, query.from, query.to, query.locationId, query.providerId],
  );
  return (
    <ReportState state={state}>
      {(report) => {
        const t = report.totals;
        const fin = report.includeFinancial;
        return (
          <div className="rp-body">
            <div className="rp-kpis">
              <Kpi label="Completed visits" value={count(t.appointmentsCompleted)} />
              <Kpi label="Booked hours" value={hours(t.bookedMinutes)} />
              <Kpi label="Scheduled hours" value={hours(t.scheduledMinutes)} hint="From weekly schedules, minus time off" />
              <Kpi label="Utilization" value={percent(t.utilizationRate)} hint="Booked ÷ scheduled" />
              {fin ? <Kpi label="Net sales" value={moneyOrDash(t.netSalesCents)} /> : null}
              {fin ? <Kpi label="Tips" value={moneyOrDash(t.tipsCents)} /> : null}
              {fin ? <Kpi label="Estimated commission" value={moneyOrDash(t.commissionCents)} hint="Current pay settings" /> : null}
            </div>

            <div className="rp-grid2">
              <BarList
                title="Utilization by team member"
                rows={report.members
                  .filter((m) => m.utilizationRate != null)
                  .sort((a, b) => (b.utilizationRate ?? 0) - (a.utilizationRate ?? 0))
                  .map((m) => ({ key: m.providerId, label: m.name, value: m.utilizationRate ?? 0, detail: `${hours(m.bookedMinutes)} of ${hours(m.scheduledMinutes)}` }))}
                format={(v) => percent(v)}
                empty="No working schedules to measure against."
              />
              {fin ? (
                <BarList
                  title="Net sales by team member"
                  rows={report.members.map((m) => ({ key: m.providerId, label: m.name, value: m.netSalesCents ?? 0, detail: `${m.appointmentsCompleted} visits` }))}
                  format={money}
                />
              ) : (
                <BarList
                  title="Completed visits by team member"
                  rows={report.members.map((m) => ({ key: m.providerId, label: m.name, value: m.appointmentsCompleted }))}
                  format={count}
                />
              )}
            </div>

            <section className="rp-card">
              <h4 className="rp-card__title">Team performance</h4>
              {report.members.length === 0 ? (
                <p className="cs-empty">No team activity in this range.</p>
              ) : (
                <ReportTable
                  caption="Team performance"
                  head={[
                    "Team member", "Visits", "No-show rate", "Cancel rate", "New clients", "Rebooked", "Booked", "Scheduled", "Utilization",
                    ...(fin ? ["Net sales", "Avg ticket", "Tips", "Commission"] : []),
                  ]}
                >
                  {report.members.map((m) => (
                    <tr key={m.providerId}>
                      <th scope="row">{m.name}{!m.isActive ? " (inactive)" : ""}</th>
                      <td>{count(m.appointmentsCompleted)}</td>
                      <td>{percent(m.noShowRate)}</td>
                      <td>{percent(m.cancelRate)}</td>
                      <td>{percent(m.newClientShare)}</td>
                      <td>{percent(m.rebookingRate)}</td>
                      <td>{hours(m.bookedMinutes)}</td>
                      <td>{hours(m.scheduledMinutes)}</td>
                      <td>{percent(m.utilizationRate)}</td>
                      {fin ? (
                        <>
                          <td>{moneyOrDash(m.netSalesCents)}</td>
                          <td>{moneyOrDash(m.averageTicketCents)}</td>
                          <td>{moneyOrDash(m.tipsCents)}</td>
                          <td>{moneyOrDash(m.commissionCents)}</td>
                        </>
                      ) : null}
                    </tr>
                  ))}
                </ReportTable>
              )}
            </section>

            <Definitions>
              <li><strong>Utilization</strong> — appointment minutes (confirmed + completed, excluding setup/cleanup buffers) divided by scheduled minutes. Time off and closed days reduce scheduled time; "–" means no weekly schedule is set.</li>
              <li><strong>New clients</strong> — share of completed visits that were the client's first visit. <strong>Rebooked</strong> — share followed by another booking.</li>
              <li><strong>No-show rate</strong> — no-shows ÷ (completed + no-shows). <strong>Cancel rate</strong> — canceled ÷ all appointments in the range.</li>
              {fin ? <li><strong>Commission</strong> — estimated from each person's current compensation settings, so changing a rate changes past figures. Sliding-scale tiers use the revenue of the selected range.</li> : null}
            </Definitions>
          </div>
        );
      }}
    </ReportState>
  );
}

// ---------------------------------------------------------------- clients ----

function ClientsView({ tenantSlug, query }: { tenantSlug: string; query: ReportQuery }) {
  const state = useReport<ClientsReport>(
    true,
    () => platformApi.getClientsReport(tenantSlug, query),
    [tenantSlug, query.from, query.to],
  );
  return (
    <ReportState state={state}>
      {(report) => {
        const s = report.summary;
        const fin = report.includeFinancial;
        return (
          <div className="rp-body">
            <div className="rp-kpis">
              <Kpi label="Active clients" value={count(s.activeClients)} hint="Completed a visit in range" />
              <Kpi label="New clients" value={count(s.newClients)} hint={`${percent(s.newClientShare)} of active`} />
              <Kpi label="Returning clients" value={count(s.returningClients)} />
              <Kpi label="Rebooking rate" value={percent(s.rebookingRate)} hint="Visits followed by another booking" />
              <Kpi label="Visits per active client" value={s.averageVisitsPerActiveClient?.toFixed(1) ?? "–"} />
              <Kpi label="All clients" value={count(s.totalClients)} hint={`${s.blockedClients} blocked online`} />
              {fin ? <Kpi label="Avg lifetime value" value={moneyOrDash(s.averageLifetimeValueCents)} hint="Payments excl. tips" /> : null}
              {fin ? <Kpi label="Wallet balances held" value={moneyOrDash(s.walletLiabilityCents)} hint={`${s.walletHolders} clients`} /> : null}
            </div>

            <div className="rp-grid2">
              <section className="rp-card">
                <h4 className="rp-card__title">Retention</h4>
                <p className="rp-note">Clients first seen in the 12 months before the end date who booked again within…</p>
                <ReportTable caption="Retention" head={["Window", "Eligible", "Came back", "Rate"]}>
                  {report.retention.map((row) => (
                    <tr key={row.windowDays}>
                      <th scope="row">{row.windowDays} days</th>
                      <td>{count(row.eligible)}</td>
                      <td>{count(row.retained)}</td>
                      <td>{percent(row.rate)}</td>
                    </tr>
                  ))}
                </ReportTable>
              </section>
              <BarList title="Where new clients came from" rows={asBars(report.sources)} format={count} empty="No new clients in this range." />
            </div>

            <section className="rp-card">
              <h4 className="rp-card__title">New-client cohorts</h4>
              <ReportTable caption="Acquisition cohorts" head={["First visit month", "New clients", "Eligible (90d)", "Came back", "Retention"]}>
                {report.cohorts.map((row) => (
                  <tr key={row.month}>
                    <th scope="row">{row.month}</th>
                    <td>{count(row.newClients)}</td>
                    <td>{count(row.eligible90Day)}</td>
                    <td>{count(row.retained90Day)}</td>
                    <td>{percent(row.retentionRate)}</td>
                  </tr>
                ))}
              </ReportTable>
            </section>

            <div className="rp-grid2">
              <section className="rp-card">
                <h4 className="rp-card__title">{fin ? "Top clients by spend" : "Top clients by visits"}</h4>
                {report.topClients.length === 0 ? (
                  <p className="cs-empty">No visits in this range.</p>
                ) : (
                  <ReportTable caption="Top clients" head={["Client", "Visits", ...(fin ? ["Spend"] : []), "Last visit"]}>
                    {report.topClients.map((row) => (
                      <tr key={row.customerId}>
                        <th scope="row"><a href={`/customers?customerId=${row.customerId}`}>{row.name}</a></th>
                        <td>{count(row.visits)}</td>
                        {fin ? <td>{moneyOrDash(row.spendCents)}</td> : null}
                        <td>{row.lastVisit ?? "–"}</td>
                      </tr>
                    ))}
                  </ReportTable>
                )}
              </section>
              <section className="rp-card">
                <h4 className="rp-card__title">At risk — {report.atRiskCount} client{report.atRiskCount === 1 ? "" : "s"}</h4>
                <p className="rp-note">Visited before, nothing in 90+ days, nothing booked.</p>
                {report.atRisk.length === 0 ? (
                  <p className="cs-empty">No clients are at risk.</p>
                ) : (
                  <ReportTable caption="At-risk clients" head={["Client", "Visits", "Last visit", "Days", ...(fin ? ["Lifetime"] : [])]}>
                    {report.atRisk.map((row) => (
                      <tr key={row.customerId}>
                        <th scope="row"><a href={`/customers?customerId=${row.customerId}`}>{row.name}</a></th>
                        <td>{count(row.visits)}</td>
                        <td>{row.lastVisit}</td>
                        <td>{row.daysSinceLastVisit}</td>
                        {fin ? <td>{moneyOrDash(row.lifetimeSpendCents)}</td> : null}
                      </tr>
                    ))}
                  </ReportTable>
                )}
              </section>
            </div>

            <Definitions>
              <li>A client's <strong>first visit</strong> is their earliest non-canceled booking; <strong>new</strong> means that visit falls in the range.</li>
              <li><strong>Retention</strong> only counts clients whose 30/60/90-day window has already passed.</li>
              <li>Lead sources come from how the client was added; bookings made before tracking began show as "Unknown".</li>
            </Definitions>
          </div>
        );
      }}
    </ReportState>
  );
}

// ----------------------------------------------------------- appointments ----

function AppointmentsView({ tenantSlug, query }: { tenantSlug: string; query: ReportQuery }) {
  const state = useReport<AppointmentsReport>(
    true,
    () => platformApi.getAppointmentsReport(tenantSlug, query),
    [tenantSlug, query.from, query.to, query.locationId, query.providerId],
  );
  return (
    <ReportState state={state}>
      {(report) => {
        const s = report.summary;
        if (s.total === 0 && report.drafts.total === 0) {
          return <p className="cs-empty">No appointments in this range.</p>;
        }
        return (
          <div className="rp-body">
            <div className="rp-kpis">
              <Kpi label="Appointments" value={count(s.total)} hint={`${s.upcoming} upcoming`} />
              <Kpi label="Completed" value={count(s.completed)} />
              <Kpi label="No-show rate" value={percent(s.noShowRate)} hint={`${s.noShows} no-shows`} />
              <Kpi label="Cancel rate" value={percent(s.cancelRate)} hint={`${s.canceled} canceled`} />
              <Kpi label="Late cancellations" value={count(s.lateCancelCount)} hint={`${percent(s.lateCancelRate)} of cancellations`} />
              <Kpi label="Rescheduled" value={percent(s.rescheduleRate)} />
              <Kpi label="Avg booking lead time" value={s.averageLeadTimeDays == null ? "–" : `${s.averageLeadTimeDays} days`} />
              <Kpi label="Avg wait after check-in" value={s.averageWaitMinutes == null ? "–" : `${s.averageWaitMinutes} min`} hint="Needs check-in / start stamps" />
            </div>

            <div className="rp-grid2">
              <BarList title="Outcomes" rows={asBars(report.statusMix)} format={count} />
              <BarList title="How far ahead clients book" rows={asBars(report.leadTime)} format={count} limit={6} />
              <BarList title="Canceled by" rows={asBars(report.cancelActors)} format={count} empty="No cancellations in this range." />
              <BarList title="Top cancellation reasons" rows={asBars(report.cancelReasons)} format={count} empty="No reasons recorded." />
              <BarList title="Booking channel" rows={asBars(report.channels)} format={count} />
              <section className="rp-card">
                <h4 className="rp-card__title">Online booking funnel</h4>
                <p className="rp-note">Carts started in the range.</p>
                <div className="rp-kpis rp-kpis--compact">
                  <Kpi label="Started" value={count(report.drafts.total)} />
                  <Kpi label="Confirmed" value={count(report.drafts.confirmed)} />
                  <Kpi label="Abandoned" value={count(report.drafts.abandoned)} />
                  <Kpi label="Conversion" value={percent(report.drafts.conversionRate)} />
                </div>
              </section>
            </div>

            <section className="rp-card">
              <h4 className="rp-card__title">Busiest times</h4>
              <Heatmap cells={report.heatmap} />
            </section>

            {report.resources.length > 0 ? (
              <section className="rp-card">
                <h4 className="rp-card__title">Rooms and equipment</h4>
                <ReportTable caption="Resource utilization" head={["Resource", "Type", "Booked", "Capacity", "Utilization"]}>
                  {report.resources.map((r) => (
                    <tr key={r.resourceId}>
                      <th scope="row">{r.name}</th>
                      <td>{r.kind}</td>
                      <td>{hours(r.bookedMinutes)}</td>
                      <td>{hours(r.capacityMinutes)}</td>
                      <td>{percent(r.utilizationRate)}</td>
                    </tr>
                  ))}
                </ReportTable>
                <p className="rp-note">Capacity needs business hours turned on in Settings.</p>
              </section>
            ) : null}

            <Definitions>
              <li>Appointments are counted by their scheduled time. <strong>Late cancellation</strong> means canceled inside the business's cancellation window.</li>
              <li><strong>No-show rate</strong> — no-shows ÷ (completed + no-shows). <strong>Cancel rate</strong> — canceled ÷ all appointments.</li>
              <li>Who canceled, reasons, channels and check-in times are recorded going forward; earlier bookings show as "Unknown".</li>
            </Definitions>
          </div>
        );
      }}
    </ReportState>
  );
}
