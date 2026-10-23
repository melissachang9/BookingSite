import { useEffect, useState } from "react";
import type { SaleListQuery, SaleListResponse } from "@booking/shared-types";

import { useMoneyFormat } from "./money-format";
import { ReceiptDialog, type ReceiptApi } from "./receipt-view";

export type SalesTabApi = ReceiptApi & {
  listSales: (tenantSlug: string, query?: SaleListQuery) => Promise<SaleListResponse>;
};

type State = { kind: "loading" } | { kind: "ready"; data: SaleListResponse } | { kind: "error"; message: string };

const PAGE_SIZE = 25;

/** Every numbered sale, newest first. A sale is numbered when a visit is checked out. */
export function SalesTab({
  api,
  tenantSlug,
  canEmailReceipts = false,
}: {
  api: SalesTabApi;
  tenantSlug: string;
  canEmailReceipts?: boolean;
}) {
  const { money, dateTime, dayStart, dayEnd } = useMoneyFormat();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    api
      .listSales(tenantSlug, { occurredFrom: dayStart(from), occurredTo: dayEnd(to), limit: PAGE_SIZE, offset })
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ kind: "error", message: error instanceof Error ? error.message : "Unable to load sales." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, tenantSlug, from, to, offset, dayStart, dayEnd]);

  const filtered = Boolean(from || to);

  return (
    <article className="cs-panel-card" aria-label="Sales">
      <div className="cs-panel-title-row">
        <div>
          <p className="cs-eyebrow">Checked-out visits</p>
          <h4>Sales</h4>
        </div>
        {state.kind === "ready" ? <span className="cs-status-chip cs-status-chip--planned">{state.data.total} total</span> : null}
      </div>

      <div className="cs-pay-filters">
        <label className="cs-field">
          <span>From</span>
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label className="cs-field">
          <span>To</span>
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setOffset(0);
            }}
          />
        </label>
        {filtered ? (
          <button
            type="button"
            className="cs-btn cs-btn--sm"
            onClick={() => {
              setFrom("");
              setTo("");
              setOffset(0);
            }}
          >
            Clear dates
          </button>
        ) : null}
      </div>

      {state.kind === "loading" ? (
        <div className="cs-empty">Loading sales...</div>
      ) : state.kind === "error" ? (
        <div className="cs-banner cs-banner--error" role="alert">
          {state.message}
        </div>
      ) : state.data.sales.length === 0 ? (
        <div className="cs-empty cs-empty--muted">
          {filtered
            ? "No sales in these dates."
            : "No sales yet. A sale is numbered when a visit is marked completed, so none appear for visits completed before sales existed."}
        </div>
      ) : (
        <>
          <div className="cs-pay-table-wrap">
            <table className="cs-table cs-pay-table">
              <thead>
                <tr>
                  <th>Sale</th>
                  <th>Date</th>
                  <th>Client</th>
                  <th className="cs-pay-table__num">Total</th>
                  <th className="cs-pay-table__num">Paid</th>
                  <th className="cs-pay-table__num">Balance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.data.sales.map((sale) => (
                  <tr key={sale.id}>
                    <td>
                      <strong>#{sale.saleNumber}</strong>
                    </td>
                    <td>{dateTime(sale.completedAt)}</td>
                    <td>{sale.customerName ?? "—"}</td>
                    <td className="cs-pay-table__num">
                      {money(sale.totalCents)}
                      {sale.tipCents > 0 ? <small> + {money(sale.tipCents)} tip</small> : null}
                    </td>
                    <td className="cs-pay-table__num">{money(sale.paidCents)}</td>
                    <td className="cs-pay-table__num">
                      {sale.balanceDueCents > 0 ? (
                        <span className="cs-status-chip cs-status-chip--progress">{money(sale.balanceDueCents)} due</span>
                      ) : (
                        "Paid"
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="cs-btn cs-btn--sm"
                        aria-label={`Receipt for sale ${sale.saleNumber}`}
                        onClick={() => setReceiptSaleId(sale.id)}
                      >
                        Receipt
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cs-action-row">
            <button type="button" className="cs-btn cs-btn--sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              Previous
            </button>
            <span className="cs-pay-pager">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, state.data.total)} of {state.data.total}
            </span>
            <button
              type="button"
              className="cs-btn cs-btn--sm"
              disabled={offset + PAGE_SIZE >= state.data.total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        </>
      )}

      {receiptSaleId ? (
        <ReceiptDialog
          api={api}
          tenantSlug={tenantSlug}
          saleId={receiptSaleId}
          canEmail={canEmailReceipts}
          onClose={() => setReceiptSaleId(null)}
        />
      ) : null}
    </article>
  );
}
