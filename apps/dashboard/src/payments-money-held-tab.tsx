import { useEffect, useState } from "react";
import type { LiabilitySummary } from "@booking/shared-types";

import { useMoneyFormat } from "./money-format";

export type MoneyHeldTabApi = {
  getLiabilitySummary: (
    tenantSlug: string,
    query?: { occurredFrom?: string; occurredTo?: string },
  ) => Promise<LiabilitySummary>;
};

type State = { kind: "loading" } | { kind: "ready"; data: LiabilitySummary } | { kind: "error"; message: string };

function Row({ label, cents, sign, strong }: { label: string; cents: number; sign?: "+" | "−"; strong?: boolean }) {
  const { money: formatMoney } = useMoneyFormat();
  return (
    <tr className={strong ? "cs-pay-total" : undefined}>
      <th scope="row">
        {sign ? <span aria-hidden="true">{sign} </span> : null}
        {label}
      </th>
      <td className="cs-pay-table__num">{formatMoney(cents)}</td>
    </tr>
  );
}

export function MoneyHeldTab({ api, tenantSlug }: { api: MoneyHeldTabApi; tenantSlug: string }) {
  const { dayStart, dayEnd } = useMoneyFormat();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    api
      .getLiabilitySummary(tenantSlug, { occurredFrom: dayStart(from), occurredTo: dayEnd(to) })
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ kind: "error", message: error instanceof Error ? error.message : "Unable to load held money." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, tenantSlug, from, to, dayStart, dayEnd]);

  return (
    <article className="cs-panel-card" aria-label="Money held">
      <div className="cs-panel-title-row">
        <div>
          <p className="cs-eyebrow">Not yet earned</p>
          <h4>Money held for clients</h4>
        </div>
      </div>
      <p className="cs-fieldset-help">
        Deposits and wallet credit are held for the client until they are used at checkout. They are not revenue until then.
      </p>

      <div className="cs-pay-filters">
        <label className="cs-field">
          <span>From</span>
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="cs-field">
          <span>To</span>
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        {from || to ? (
          <button
            type="button"
            className="cs-btn cs-btn--sm"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            Clear dates
          </button>
        ) : null}
      </div>

      {state.kind === "loading" ? (
        <div className="cs-empty">Loading held money...</div>
      ) : state.kind === "error" ? (
        <div className="cs-banner cs-banner--error" role="alert">
          {state.message}
        </div>
      ) : (
        <div className="cs-pay-held">
          <section aria-label="Deposits held">
            <h5>Deposits</h5>
            <table className="cs-table cs-pay-table">
              <tbody>
                <Row label="Opening balance" cents={state.data.deposits.openingCents} />
                <Row label="Collected" cents={state.data.deposits.collectedCents} sign="+" />
                <Row label="Applied at checkout" cents={state.data.deposits.redeemedCents} sign="−" />
                <Row label="Refunded" cents={state.data.deposits.refundedCents} sign="−" />
                <Row label="Moved to wallet" cents={state.data.deposits.movedToWalletCents} sign="−" />
                <Row label="Kept (cancellation policy)" cents={state.data.deposits.forfeitedCents} sign="−" />
                <Row label="Closing balance" cents={state.data.deposits.closingCents} strong />
              </tbody>
            </table>
          </section>
          <section aria-label="Wallet credit held">
            <h5>Wallet credit</h5>
            <table className="cs-table cs-pay-table">
              <tbody>
                <Row label="Opening balance" cents={state.data.wallet.openingCents} />
                <Row label="Added" cents={state.data.wallet.addedCents} sign="+" />
                <Row label="Used" cents={state.data.wallet.usedCents} sign="−" />
                <Row label="Closing balance" cents={state.data.wallet.closingCents} strong />
              </tbody>
            </table>
          </section>
        </div>
      )}
    </article>
  );
}
