import { useCallback, useEffect, useState } from "react";
import type { MarketingReport, MarketingSpendEntry, ReportQuery } from "@booking/shared-types";

import { platformApi } from "./platform-api";
import { ReportTable } from "./report-charts";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (cents: number | null | undefined) => (cents == null ? "–" : dollars.format(cents / 100));

/** Common places customers come from; any other name can be typed in. */
const CHANNEL_SUGGESTIONS = ["instagram", "facebook", "google", "tiktok", "referral", "yelp", "event", "walk-in"];

type Load =
  | { kind: "loading" }
  | { kind: "ready"; report: MarketingReport; entries: MarketingSpendEntry[] }
  | { kind: "error"; message: string };

type Draft = { channel: string; campaign: string; amount: string; periodStart: string; periodEnd: string; note: string };

function readError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function MarketingView({
  tenantSlug,
  query,
  canManage,
}: {
  tenantSlug: string;
  query: ReportQuery;
  canManage: boolean;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>({ channel: "", campaign: "", amount: "", periodStart: query.from, periodEnd: query.to, note: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [report, spend] = await Promise.all([
        platformApi.getMarketingReport(tenantSlug, query),
        platformApi.listMarketingSpend(tenantSlug, query),
      ]);
      setLoad({ kind: "ready", report, entries: spend.items });
    } catch (error) {
      setLoad({ kind: "error", message: readError(error, "Unable to load marketing report.") });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug, query.from, query.to]);

  useEffect(() => {
    setLoad({ kind: "loading" });
    void refresh();
  }, [refresh]);

  const startAdding = () => {
    setDraft({ channel: "", campaign: "", amount: "", periodStart: query.from, periodEnd: query.to, note: "" });
    setFormError(null);
    setAdding(true);
  };

  const save = async () => {
    const channel = draft.channel.trim();
    const amount = Number(draft.amount);
    if (!channel) { setFormError("Choose or type the channel the money was spent on."); return; }
    if (!draft.amount.trim() || !Number.isFinite(amount) || amount < 0) { setFormError("Enter the amount spent."); return; }
    if (draft.periodEnd < draft.periodStart) { setFormError("The end date must be on or after the start date."); return; }
    setBusy(true);
    setFormError(null);
    try {
      await platformApi.createMarketingSpend(tenantSlug, {
        channel,
        campaign: draft.campaign.trim() || null,
        periodStart: draft.periodStart,
        periodEnd: draft.periodEnd,
        amountCents: Math.round(amount * 100),
        note: draft.note.trim() || null,
      });
      setAdding(false);
      await refresh();
    } catch (error) {
      setFormError(readError(error, "Unable to save spend."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: MarketingSpendEntry) => {
    if (!window.confirm(`Remove ${money(entry.amountCents)} spent on ${entry.channel}? It stays in the audit trail.`)) return;
    setActionError(null);
    try {
      await platformApi.removeMarketingSpend(tenantSlug, entry.id);
      await refresh();
    } catch (error) {
      setActionError(readError(error, "Unable to remove spend."));
    }
  };

  if (load.kind === "loading") return <p className="rp-status" role="status">Loading report…</p>;
  if (load.kind === "error") return <p className="cs-error" role="alert">{load.message}</p>;
  const { report, entries } = load;

  return (
    <div className="rp-body">
      <div className="rp-kpis">
        <div className="rp-kpi">
          <span className="rp-kpi__label">Marketing spend</span>
          <span className="rp-kpi__value">{money(report.totalSpendCents)}</span>
        </div>
        <div className="rp-kpi">
          <span className="rp-kpi__label">New clients</span>
          <span className="rp-kpi__value">{report.totalNewClients.toLocaleString("en-US")}</span>
          <span className="rp-kpi__hint">First booked visit in range</span>
        </div>
        <div className="rp-kpi">
          <span className="rp-kpi__label">Blended CAC</span>
          <span className="rp-kpi__value">{money(report.blendedCacCents)}</span>
          <span className="rp-kpi__hint">All spend ÷ all new clients</span>
        </div>
      </div>

      <div className="rp-card">
        <h3 className="rp-card__title">Cost to acquire a client, by channel</h3>
        <p className="rp-note">
          A client counts toward the channel they first came from. Spend counts in the date range its period starts in.
        </p>
        {report.channels.length === 0 ? (
          <p className="rp-status">No spend or new clients in this range yet. Add what you spend below to see CAC.</p>
        ) : (
          <ReportTable caption="Acquisition cost by channel" head={["Channel", "Spend", "New clients", "CAC"]}>
            {report.channels.map((row) => (
              <tr key={row.channel}>
                <th scope="row">{row.label}</th>
                <td className="is-num">{money(row.spendCents)}</td>
                <td className="is-num">{row.newClients}</td>
                <td className="is-num">{row.cacCents == null ? "–" : money(row.cacCents)}</td>
              </tr>
            ))}
          </ReportTable>
        )}
      </div>

      <div className="rp-card">
        <div className="rp-card__head">
          <h3 className="rp-card__title">Spend entries</h3>
          {canManage && !adding ? (
            <button type="button" className="rp-chip" onClick={startAdding}>+ Add spend</button>
          ) : null}
        </div>
        {actionError ? <p className="cs-error" role="alert">{actionError}</p> : null}
        {adding ? (
          <div className="rp-spend-form" role="group" aria-label="New spend">
            <label>
              <span>Channel</span>
              <input list="rp-channel-options" value={draft.channel} placeholder="e.g. instagram"
                onChange={(e) => setDraft({ ...draft, channel: e.target.value })} />
              <datalist id="rp-channel-options">
                {CHANNEL_SUGGESTIONS.map((name) => <option key={name} value={name} />)}
              </datalist>
            </label>
            <label>
              <span>Amount spent ($)</span>
              <input type="number" min={0} step="0.01" value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            </label>
            <label>
              <span>From</span>
              <input type="date" value={draft.periodStart} max={draft.periodEnd}
                onChange={(e) => setDraft({ ...draft, periodStart: e.target.value })} />
            </label>
            <label>
              <span>Until</span>
              <input type="date" value={draft.periodEnd} min={draft.periodStart}
                onChange={(e) => setDraft({ ...draft, periodEnd: e.target.value })} />
            </label>
            <label>
              <span>Campaign (optional)</span>
              <input value={draft.campaign} onChange={(e) => setDraft({ ...draft, campaign: e.target.value })} />
            </label>
            <label>
              <span>Note (optional)</span>
              <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </label>
            <div className="rp-spend-form__actions">
              {formError ? <span className="cs-error" role="alert">{formError}</span> : null}
              <button type="button" className="rp-chip" onClick={() => setAdding(false)} disabled={busy}>Cancel</button>
              <button type="button" className="rp-export" onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : "Save spend"}
              </button>
            </div>
          </div>
        ) : null}
        {entries.length === 0 && !adding ? (
          <p className="rp-status">No spend recorded for this range.</p>
        ) : (
          <ReportTable caption="Spend entries" head={["Channel", "Period", "Amount", ""]}>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <th scope="row">
                  {entry.channel}
                  {entry.campaign ? ` · ${entry.campaign}` : ""}
                  {entry.note ? <span className="rp-note"> {entry.note}</span> : null}
                </th>
                <td className="is-num">
                  {entry.periodStart === entry.periodEnd ? entry.periodStart : `${entry.periodStart} → ${entry.periodEnd}`}
                </td>
                <td className="is-num">{money(entry.amountCents)}</td>
                <td className="is-num">
                  {canManage ? (
                    <button type="button" className="rp-chip" onClick={() => void remove(entry)} aria-label={`Remove ${entry.channel} spend`}>
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </ReportTable>
        )}
      </div>
    </div>
  );
}
