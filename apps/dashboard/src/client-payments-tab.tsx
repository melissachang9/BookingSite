import { useEffect, useState } from "react";
import type { SaleListResponse, TransactionListResponse, WalletHistory } from "@booking/shared-types";

import { useMoneyFormat } from "./money-format";
import { TRANSACTION_TYPE_LABELS } from "./payments-transactions-tab";
import { ReceiptDialog, type ReceiptApi } from "./receipt-view";

export type ClientPaymentsApi = ReceiptApi & {
  listSales: (tenantSlug: string, query?: { customerId?: string; limit?: number }) => Promise<SaleListResponse>;
  listTransactions: (tenantSlug: string, query?: { customerId?: string; limit?: number }) => Promise<TransactionListResponse>;
  getCustomerWallet: (tenantSlug: string, customerId: string) => Promise<WalletHistory>;
};

type Loaded<T> = { kind: "loading" } | { kind: "ready"; data: T } | { kind: "error"; message: string };

const WALLET_KIND_LABELS: Record<string, string> = {
  staff_adjustment: "Staff adjustment",
  cancellation_credit: "Cancellation credit",
  applied_to_booking: "Used on a visit",
  refund_returned: "Refund returned",
};

function useLoaded<T>(load: () => Promise<T>, deps: unknown[], enabled: boolean): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ kind: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ kind: "loading" });
    load()
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: "error", message: error instanceof Error ? error.message : "Unable to load." });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);
  return state;
}

function Problem({ state }: { state: { kind: "loading" } | { kind: "error"; message: string } }) {
  return state.kind === "loading" ? (
    <div className="cs-empty">Loading...</div>
  ) : (
    <div className="cs-banner cs-banner--error" role="alert">
      {state.message}
    </div>
  );
}

/** A client's money: numbered sales with receipts, every payment and refund, and the wallet's history. */
export function ClientPaymentsTab({
  api,
  tenantSlug,
  customerId,
  canViewPayments,
  canManagePayments,
}: {
  api: ClientPaymentsApi;
  tenantSlug: string;
  customerId: string;
  canViewPayments: boolean;
  canManagePayments: boolean;
}) {
  const { money, signed, dateTime } = useMoneyFormat();
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null);

  const sales = useLoaded(() => api.listSales(tenantSlug, { customerId, limit: 25 }), [api, tenantSlug, customerId], canViewPayments);
  const transactions = useLoaded(
    () => api.listTransactions(tenantSlug, { customerId, limit: 50 }),
    [api, tenantSlug, customerId],
    canViewPayments,
  );
  const wallet = useLoaded(() => api.getCustomerWallet(tenantSlug, customerId), [api, tenantSlug, customerId], true);

  return (
    <div className="cs-client-payments">
      {canViewPayments ? (
        <>
          <section aria-label="Sales">
            <h4>Sales</h4>
            {sales.kind !== "ready" ? (
              <Problem state={sales} />
            ) : sales.data.sales.length === 0 ? (
              <div className="cs-empty cs-empty--muted">No completed sales yet. A sale is numbered when a visit is checked out.</div>
            ) : (
              <table className="cs-table cs-pay-table">
                <thead>
                  <tr>
                    <th>Sale</th>
                    <th>Date</th>
                    <th className="cs-pay-table__num">Total</th>
                    <th className="cs-pay-table__num">Paid</th>
                    <th className="cs-pay-table__num">Balance</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sales.data.sales.map((sale) => (
                    <tr key={sale.id}>
                      <td>#{sale.saleNumber}</td>
                      <td>{dateTime(sale.completedAt)}</td>
                      <td className="cs-pay-table__num">{money(sale.totalCents)}</td>
                      <td className="cs-pay-table__num">{money(sale.paidCents)}</td>
                      <td className="cs-pay-table__num">
                        {sale.balanceDueCents > 0 ? <strong>{money(sale.balanceDueCents)}</strong> : "Paid"}
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
            )}
          </section>

          <section aria-label="Payments and refunds">
            <h4>Payments and refunds</h4>
            {transactions.kind !== "ready" ? (
              <Problem state={transactions} />
            ) : transactions.data.transactions.length === 0 ? (
              <div className="cs-empty cs-empty--muted">No payments recorded for this client.</div>
            ) : (
              <table className="cs-table cs-pay-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Sale</th>
                    <th className="cs-pay-table__num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.data.transactions.map((row) => (
                    <tr key={row.id}>
                      <td>{dateTime(row.occurredAt)}</td>
                      <td>{TRANSACTION_TYPE_LABELS[row.type]}</td>
                      <td>{row.saleNumber ? `#${row.saleNumber}` : "—"}</td>
                      <td className="cs-pay-table__num">
                        {row.cashCents === 0 ? (
                          <>
                            {money(row.amountCents)}
                            <small> no cash moved</small>
                          </>
                        ) : (
                          signed(row.cashCents)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : (
        <div className="cs-banner cs-banner--muted">Your role can't view payments, so sales and payment history are hidden.</div>
      )}

      <section aria-label="Wallet history">
        <h4>Wallet</h4>
        {wallet.kind !== "ready" ? (
          <Problem state={wallet} />
        ) : (
          <>
            <p className="cs-fieldset-help">Balance {money(wallet.data.balanceCents)}</p>
            {wallet.data.transactions.length === 0 ? (
              <div className="cs-empty cs-empty--muted">No wallet activity.</div>
            ) : (
              <table className="cs-table cs-pay-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th>Note</th>
                    <th className="cs-pay-table__num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {wallet.data.transactions.map((row) => (
                    <tr key={row.id}>
                      <td>{dateTime(row.createdAt)}</td>
                      <td>{WALLET_KIND_LABELS[row.kind] ?? row.kind.replaceAll("_", " ")}</td>
                      <td className="cs-pay-table__notes">
                        {row.notes ?? ""}
                        {row.actorName ? <small> — {row.actorName}</small> : null}
                      </td>
                      <td className="cs-pay-table__num">{signed(row.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      {receiptSaleId ? (
        <ReceiptDialog
          api={api}
          tenantSlug={tenantSlug}
          saleId={receiptSaleId}
          canEmail={canManagePayments}
          onClose={() => setReceiptSaleId(null)}
        />
      ) : null}
    </div>
  );
}
