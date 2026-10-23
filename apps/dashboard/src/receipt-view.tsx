import { useEffect, useMemo, useState } from "react";
import type { EmailReceiptResponse, SaleReceipt } from "@booking/shared-types";

import { buildMoneyFormat } from "./money-format";

export type ReceiptApi = {
  getSaleReceipt: (tenantSlug: string, saleId: string) => Promise<SaleReceipt>;
  emailSaleReceipt: (tenantSlug: string, saleId: string, email?: string) => Promise<EmailReceiptResponse>;
};

type State = { kind: "loading" } | { kind: "ready"; receipt: SaleReceipt } | { kind: "error"; message: string };
type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; to: string } | { kind: "error"; message: string };

const METHOD_LABELS: Record<string, string> = {
  deposit: "Deposit",
  card: "Card",
  cash: "Cash",
  external_pos: "External POS",
  wallet: "Wallet credit",
  manual: "Manual",
  stripe: "Card",
};

function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method.replaceAll("_", " ");
}

/**
 * A receipt for one numbered sale. Amounts and times use the sale's own currency and the
 * location's timezone, so a printed copy matches what the client was charged.
 */
export function ReceiptDialog({
  api,
  tenantSlug,
  saleId,
  canEmail,
  onClose,
}: {
  api: ReceiptApi;
  tenantSlug: string;
  saleId: string;
  canEmail: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [sendState, setSendState] = useState<SendState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    api
      .getSaleReceipt(tenantSlug, saleId)
      .then((receipt) => {
        if (cancelled) return;
        setEmail(receipt.customer.email ?? "");
        setState({ kind: "ready", receipt });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ kind: "error", message: error instanceof Error ? error.message : "Unable to load this receipt." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, tenantSlug, saleId]);

  const receipt = state.kind === "ready" ? state.receipt : null;
  const fmt = useMemo(
    () => (receipt ? buildMoneyFormat(receipt.currency, receipt.timeZone) : null),
    [receipt],
  );

  const sendEmail = async () => {
    setSendState({ kind: "sending" });
    try {
      const sent = await api.emailSaleReceipt(tenantSlug, saleId, email.trim() || undefined);
      setSendState({ kind: "sent", to: sent.recipientEmail });
    } catch (error) {
      setSendState({ kind: "error", message: error instanceof Error ? error.message : "Unable to send the receipt." });
    }
  };

  return (
    <>
      <div className="cs-drawer-backdrop cs-scrim" onClick={onClose} />
      <aside className="cs-receipt" role="dialog" aria-label="Receipt">
        <header className="cs-receipt__bar">
          <h3>Receipt{receipt ? ` #${receipt.saleNumber}` : ""}</h3>
          <button type="button" className="cs-drawer-close-btn cs-drawer__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {state.kind === "loading" ? (
          <div className="cs-empty">Loading receipt...</div>
        ) : state.kind === "error" ? (
          <div className="cs-banner cs-banner--error" role="alert">
            {state.message}
          </div>
        ) : receipt && fmt ? (
          <>
            <article className="cs-receipt__paper cs-receipt-print" aria-label={`Receipt ${receipt.saleNumber}`}>
              <h4>{receipt.business.name}</h4>
              {receipt.business.locationName ? <p>{receipt.business.locationName}</p> : null}
              {receipt.business.addressLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {receipt.business.phone ? <p>{receipt.business.phone}</p> : null}

              <p className="cs-receipt__meta">
                Receipt #{receipt.saleNumber} · {fmt.dateTime(receipt.completedAt)}
              </p>
              <p className="cs-receipt__meta">Client: {receipt.customer.name}</p>

              <table className="cs-receipt__table">
                <tbody>
                  {receipt.lines.map((line, index) => (
                    <tr key={`${line.name}-${index}`}>
                      <td>
                        {line.name}
                        {line.quantity !== 1 ? ` × ${line.quantity}` : ""}
                        {line.providerName ? <small> with {line.providerName}</small> : null}
                      </td>
                      <td className="cs-receipt__num">{fmt.money(line.lineTotalCents)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Subtotal</td>
                    <td className="cs-receipt__num">{fmt.money(receipt.subtotalCents)}</td>
                  </tr>
                  {receipt.discountCents > 0 ? (
                    <tr>
                      <td>Discount</td>
                      <td className="cs-receipt__num">{fmt.signed(-receipt.discountCents)}</td>
                    </tr>
                  ) : null}
                  <tr>
                    <td>Tax</td>
                    <td className="cs-receipt__num">{fmt.money(receipt.taxCents)}</td>
                  </tr>
                  <tr className="cs-receipt__total">
                    <td>Total</td>
                    <td className="cs-receipt__num">{fmt.money(receipt.totalCents)}</td>
                  </tr>
                  {receipt.tipCents > 0 ? (
                    <tr>
                      <td>Tip</td>
                      <td className="cs-receipt__num">{fmt.money(receipt.tipCents)}</td>
                    </tr>
                  ) : null}
                </tfoot>
              </table>

              <h5>Paid</h5>
              {receipt.payments.length === 0 ? (
                <p>No payments yet.</p>
              ) : (
                <table className="cs-receipt__table">
                  <tbody>
                    {receipt.payments.map((payment, index) => (
                      <tr key={payment.paymentId ?? index}>
                        <td>
                          {methodLabel(payment.method)}
                          {payment.cardBrand && payment.cardLast4 ? (
                            <small>
                              {" "}
                              {payment.cardBrand} ending {payment.cardLast4}
                            </small>
                          ) : null}
                          {payment.refundedCents > 0 ? <small> · {fmt.money(payment.refundedCents)} refunded</small> : null}
                          {payment.paidAt ? <small> · {fmt.dateTime(payment.paidAt)}</small> : null}
                        </td>
                        <td className="cs-receipt__num">{fmt.money(payment.netCents + payment.tipCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className={receipt.balanceDueCents > 0 ? "cs-receipt__due" : "cs-receipt__paid"}>
                {receipt.balanceDueCents > 0 ? `Balance due ${fmt.money(receipt.balanceDueCents)}` : "Paid in full"}
              </p>
            </article>

            <div className="cs-receipt__actions">
              <button type="button" className="cs-btn cs-btn--primary cs-btn--sm" onClick={() => window.print()}>
                Print
              </button>
              {canEmail ? (
                <div className="cs-receipt__email">
                  <label className="cs-field">
                    <span>Email receipt to</span>
                    <input
                      type="email"
                      value={email}
                      placeholder="client@example.com"
                      onChange={(event) => {
                        setEmail(event.target.value);
                        setSendState({ kind: "idle" });
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="cs-btn cs-btn--sm"
                    disabled={sendState.kind === "sending"}
                    onClick={() => void sendEmail()}
                  >
                    {sendState.kind === "sending" ? "Sending..." : "Email receipt"}
                  </button>
                </div>
              ) : null}
              {sendState.kind === "sent" ? (
                <p role="status" className="cs-status">
                  Receipt sent to {sendState.to}.
                </p>
              ) : null}
              {sendState.kind === "error" ? (
                <p role="alert" className="cs-error">
                  {sendState.message}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}
