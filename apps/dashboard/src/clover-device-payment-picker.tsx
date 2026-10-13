import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { CloverDevicePayment } from "@booking/shared-types";

/**
 * Lists recent payments taken on the Clover device so staff can match one to
 * the booking they're working on. Only payments that equal the deposit, the
 * full price or the balance (before tip) can be picked; the server re-checks
 * everything when the payment is linked.
 */

export type CloverDevicePaymentPickerApi = {
  listCloverDevicePayments: (
    tenantSlug: string,
    query?: { sinceMinutes?: number; bookingDraftId?: string; bookingId?: string },
  ) => Promise<{ items: CloverDevicePayment[] }>;
};

type Props = {
  tenantSlug: string;
  api: CloverDevicePaymentPickerApi;
  bookingDraftId?: string;
  bookingId?: string;
  selectedId: string | null;
  onSelect: (payment: CloverDevicePayment | null) => void;
  disabled?: boolean;
  /** How often to look for new payments while the tab is visible. */
  pollMs?: number;
};

type State =
  | { kind: "loading" }
  | { kind: "ready"; items: CloverDevicePayment[] }
  | { kind: "error"; message: string };

const MATCH_LABEL: Record<NonNullable<CloverDevicePayment["matches"]>, string> = {
  deposit: "Matches deposit",
  full: "Matches full amount",
  balance: "Matches balance",
};

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function CloverDevicePaymentPicker({
  tenantSlug,
  api,
  bookingDraftId,
  bookingId,
  selectedId,
  onSelect,
  disabled = false,
  pollMs = 5000,
}: Props): ReactElement {
  const [state, setState] = useState<State>({ kind: "loading" });
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const response = await api.listCloverDevicePayments(tenantSlug, { sinceMinutes: 60, bookingDraftId, bookingId });
      if (request === latest.current) setState({ kind: "ready", items: response.items });
    } catch (error) {
      if (request === latest.current) {
        setState({ kind: "error", message: error instanceof Error ? error.message : "Unable to load Clover payments." });
      }
    }
  }, [api, bookingDraftId, bookingId, tenantSlug]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, pollMs);
    return () => {
      latest.current += 1; // ignore anything still in flight
      window.clearInterval(id);
    };
  }, [load, pollMs]);

  // A selection that disappears (linked elsewhere, refunded) must not linger.
  useEffect(() => {
    if (state.kind === "ready" && selectedId && !state.items.some((item) => item.id === selectedId)) {
      onSelect(null);
    }
  }, [onSelect, selectedId, state]);

  if (state.kind === "loading") {
    return <p className="cs-empty" role="status">Looking for payments on the Clover device…</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="cs-banner cs-banner--error" role="alert">
        {state.message}{" "}
        <button type="button" className="cs-btn cs-btn--sm" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (state.items.length === 0) {
    return (
      <p className="cs-empty" role="status">
        No unmatched payments in the last hour. Ring the client up on the Clover device and it will appear here.
      </p>
    );
  }

  return (
    <ul className="cs-clover-payments" aria-label="Payments on the Clover device">
      {state.items.map((payment) => {
        const matches = payment.matches ?? null;
        const selected = selectedId === payment.id;
        return (
          <li key={payment.id}>
            <button
              type="button"
              className={`cs-clover-payment${selected ? " is-selected" : ""}`}
              aria-pressed={selected}
              disabled={disabled || matches === null}
              onClick={() => onSelect(selected ? null : payment)}
            >
              <span className="cs-clover-payment__time">{timeLabel(payment.createdAt)}</span>
              <span className="cs-clover-payment__card">
                {payment.cardBrand ?? "Card"}
                {payment.cardLast4 ? ` ••${payment.cardLast4}` : ""}
              </span>
              <span className="cs-clover-payment__amount">
                {money(payment.amountCents)}
                {payment.tipCents > 0 ? <small> + {money(payment.tipCents)} tip</small> : null}
              </span>
              <span className={`cs-clover-payment__match${matches ? " is-match" : ""}`}>
                {matches ? MATCH_LABEL[matches] : "Doesn't match"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
