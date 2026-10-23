import { useEffect, useState } from "react";
import type { MoneyOwed } from "@booking/shared-types";

import { useMoneyFormat } from "./money-format";

export type MoneyOwedApi = {
  getMoneyOwed: (tenantSlug: string) => Promise<MoneyOwed>;
};

type State = { kind: "loading" } | { kind: "ready"; data: MoneyOwed } | { kind: "error"; message: string };

export function MoneyOwedPanel({ api, tenantSlug }: { api: MoneyOwedApi; tenantSlug: string }) {
  const { money: formatMoney, dateTime: formatShortDateTime } = useMoneyFormat();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    api
      .getMoneyOwed(tenantSlug)
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ kind: "error", message: error instanceof Error ? error.message : "Unable to load money owed." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, tenantSlug]);

  return (
    <article className="cs-panel-card" aria-label="Money owed">
      <div className="cs-panel-title-row">
        <div>
          <p className="cs-eyebrow">Needs a person</p>
          <h4>Money owed</h4>
        </div>
      </div>

      {state.kind === "loading" ? (
        <div className="cs-empty">Loading money owed...</div>
      ) : state.kind === "error" ? (
        <div className="cs-banner cs-banner--error" role="alert">
          {state.message}
        </div>
      ) : (
        <div className="cs-pay-held">
          <section aria-label="Refunds to give">
            <h5>
              Refunds to give <small>{formatMoney(state.data.refundsOwedTotalCents)}</small>
            </h5>
            {state.data.refundsOwed.length === 0 ? (
              <div className="cs-empty cs-empty--muted">No refunds are waiting.</div>
            ) : (
              <ul className="cs-pay-list">
                {state.data.refundsOwed.map((item) => (
                  <li key={item.paymentId}>
                    <strong>{item.customerName ?? "Client"}</strong>
                    <span>{formatMoney(item.amountCents)} to refund on the card device</span>
                    <small>Since {formatShortDateTime(item.owedSince)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="Balances owed">
            <h5>
              Balances owed <small>{formatMoney(state.data.balancesOwedTotalCents)}</small>
            </h5>
            {state.data.balancesOwed.length === 0 ? (
              <div className="cs-empty cs-empty--muted">No client owes a balance.</div>
            ) : (
              <ul className="cs-pay-list">
                {state.data.balancesOwed.map((item) => (
                  <li key={item.bookingId}>
                    <strong>{item.customerName ?? "Client"}</strong>
                    <span>
                      {formatMoney(item.balanceDueCents)} for {item.serviceName ?? "visit"}
                    </span>
                    <small>
                      {item.saleNumber ? `Sale #${item.saleNumber}` : "No sale number"}
                      {item.completedAt ? ` · ${formatShortDateTime(item.completedAt)}` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </article>
  );
}
