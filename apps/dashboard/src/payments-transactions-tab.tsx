import { useEffect, useState } from "react";
import type { TransactionListResponse, TransactionQuery, TransactionRow, TransactionType } from "@booking/shared-types";

import { useMoneyFormat } from "./money-format";
import { ReceiptDialog, type ReceiptApi } from "./receipt-view";

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  payment: "Payment",
  deposit_collected: "Deposit collected",
  refund: "Refund",
  deposit_redeemed: "Deposit applied",
  deposit_forfeited: "Deposit kept",
  deposit_to_wallet: "Deposit to wallet",
};

const TYPE_TONES: Record<TransactionType, "ready" | "progress" | "planned"> = {
  payment: "ready",
  deposit_collected: "ready",
  refund: "progress",
  deposit_redeemed: "planned",
  deposit_forfeited: "planned",
  deposit_to_wallet: "planned",
};

const METHOD_LABELS: Record<string, string> = {
  card: "Card",
  cash: "Cash",
  external_pos: "External POS",
  manual: "Manual",
  wallet: "Wallet",
  stripe: "Card (Stripe)",
  deposit: "Deposit",
};

const PAGE_SIZE = 25;

export type TransactionsTabApi = ReceiptApi & {
  listTransactions: (tenantSlug: string, query?: TransactionQuery) => Promise<TransactionListResponse>;
};

type State =
  | { kind: "loading" }
  | { kind: "ready"; data: TransactionListResponse }
  | { kind: "error"; message: string };

function methodLabel(method?: string | null): string {
  if (!method) return "—";
  return METHOD_LABELS[method] ?? method.replaceAll("_", " ");
}

function describeRow(row: TransactionRow): string {
  if (row.type === "deposit_redeemed") return row.saleNumber ? `Applied to sale #${row.saleNumber}` : "Applied at checkout";
  return row.notes ?? "";
}

export function TransactionsTab({
  api,
  tenantSlug,
  canEmailReceipts = false,
}: {
  api: TransactionsTabApi;
  tenantSlug: string;
  canEmailReceipts?: boolean;
}) {
  const { money: formatMoney, signed: formatSignedMoney, dateTime: formatShortDateTime, dayStart, dayEnd } = useMoneyFormat();
  const [type, setType] = useState<TransactionType | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    api
      .listTransactions(tenantSlug, {
        type: type ? [type] : undefined,
        occurredFrom: dayStart(from),
        occurredTo: dayEnd(to),
        limit: PAGE_SIZE,
        offset,
      })
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ kind: "error", message: error instanceof Error ? error.message : "Unable to load transactions." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, tenantSlug, type, from, to, offset, dayStart, dayEnd]);

  const resetPage = () => setOffset(0);

  return (
    <article className="cs-panel-card" aria-label="Transactions">
      <div className="cs-panel-title-row">
        <div>
          <p className="cs-eyebrow">Money in and out</p>
          <h4>Transactions</h4>
        </div>
        {state.kind === "ready" ? <span className="cs-status-chip cs-status-chip--planned">{state.data.total} total</span> : null}
      </div>

      <div className="cs-pay-filters">
        <label className="cs-field">
          <span>Type</span>
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as TransactionType | "");
              resetPage();
            }}
          >
            <option value="">All types</option>
            {(Object.keys(TRANSACTION_TYPE_LABELS) as TransactionType[]).map((key) => (
              <option key={key} value={key}>
                {TRANSACTION_TYPE_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="cs-field">
          <span>From</span>
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              resetPage();
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
              resetPage();
            }}
          />
        </label>
        {type || from || to ? (
          <button
            type="button"
            className="cs-btn cs-btn--sm"
            onClick={() => {
              setType("");
              setFrom("");
              setTo("");
              resetPage();
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {state.kind === "loading" ? (
        <div className="cs-empty">Loading transactions...</div>
      ) : state.kind === "error" ? (
        <div className="cs-banner cs-banner--error" role="alert">
          {state.message}
        </div>
      ) : state.data.transactions.length === 0 ? (
        <div className="cs-empty cs-empty--muted">
          {type || from || to ? "No transactions match these filters." : "No payments have been recorded yet."}
        </div>
      ) : (
        <>
          <div className="cs-pay-table-wrap">
            <table className="cs-table cs-pay-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Client</th>
                  <th>Method</th>
                  <th>Sale</th>
                  <th className="cs-pay-table__num">Amount</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {state.data.transactions.map((row) => (
                  <tr key={row.id}>
                    <td>{formatShortDateTime(row.occurredAt)}</td>
                    <td>
                      <span className={`cs-status-chip cs-status-chip--${TYPE_TONES[row.type]}`}>
                        {TRANSACTION_TYPE_LABELS[row.type]}
                      </span>
                    </td>
                    <td>{row.customerName ?? "—"}</td>
                    <td>{methodLabel(row.method)}</td>
                    <td>
                      {row.saleId && row.saleNumber ? (
                        <button
                          type="button"
                          className="cs-link-btn"
                          aria-label={`Open receipt for sale ${row.saleNumber}`}
                          onClick={() => setReceiptSaleId(row.saleId ?? null)}
                        >
                          #{row.saleNumber}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="cs-pay-table__num">
                      <strong>{row.cashCents === 0 ? formatMoney(row.amountCents) : formatSignedMoney(row.cashCents)}</strong>
                      {row.cashCents === 0 ? <small> no cash moved</small> : null}
                      {row.tipCents > 0 ? <small> incl. {formatMoney(row.tipCents)} tip</small> : null}
                    </td>
                    <td className="cs-pay-table__notes">{describeRow(row)}</td>
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
