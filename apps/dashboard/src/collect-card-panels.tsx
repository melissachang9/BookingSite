import { useEffect, useRef, useState, type ReactElement } from "react";
import type {
  BookingDraftSummary,
  BookingSummary,
  PaymentLinkRequest,
  PaymentLinkResponse,
  PublicPaymentConfig,
  StaffDraftCardChargeRequest,
} from "@booking/shared-types";

import { CloverCardForm } from "./clover-card-form";

/**
 * The two phone-booking ways to be paid by card, shown inside the
 * collect-payment step:
 *  - PhoneCardPanel: staff type the card the client reads out (Clover's secure form).
 *  - PaymentLinkPanel: text/email the client a link, hold the slot, and wait.
 */

export type PhoneCardApi = {
  getPublicPaymentConfig: (tenantSlug: string) => Promise<PublicPaymentConfig>;
  chargeStaffDraftCard: (
    tenantSlug: string,
    bookingDraftId: string,
    body: StaffDraftCardChargeRequest,
  ) => Promise<BookingSummary>;
};

export type PaymentLinkApi = {
  sendPaymentLink: (tenantSlug: string, bookingDraftId: string, body: PaymentLinkRequest) => Promise<PaymentLinkResponse>;
  getBookingDraft: (tenantSlug: string, bookingDraftId: string) => Promise<BookingDraftSummary>;
  getBooking: (tenantSlug: string, bookingId: string) => Promise<BookingSummary>;
};

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

// ---------------------------------------------------------------------------
// Phone card
// ---------------------------------------------------------------------------

export function PhoneCardPanel({
  tenantSlug,
  draft,
  api,
  amountMode,
  tipCents,
  totalCents,
  disabled,
  onConfirmed,
}: {
  tenantSlug: string;
  draft: BookingDraftSummary;
  api: PhoneCardApi;
  amountMode: "deposit" | "full";
  tipCents: number;
  totalCents: number;
  disabled: boolean;
  onConfirmed: (booking: BookingSummary) => void;
}): ReactElement {
  const [config, setConfig] = useState<PublicPaymentConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .getPublicPaymentConfig(tenantSlug)
      .then((result) => {
        if (!cancelled) setConfig(result);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : "Unable to load the card form.");
      });
    return () => {
      cancelled = true;
    };
  }, [api, tenantSlug]);

  if (error) return <div role="alert" className="cs-banner cs-banner--error">{error}</div>;
  if (config === null) return <p className="cs-empty" role="status">Loading the card form…</p>;
  if (!config.clover) {
    return (
      <div role="alert" className="cs-banner cs-banner--error">
        Card payments aren't turned on for this business yet. Connect Clover in Settings → Card Processor.
      </div>
    );
  }
  const clover = config.clover;

  return (
    <div className="cs-collect__field">
      <span>Type the card the client reads out. It goes straight to Clover — it is never stored here.</span>
      <CloverCardForm
        config={clover}
        submitLabel={`Charge ${money(totalCents)}`}
        disabled={disabled}
        onSubmit={async (token, attemptId) => {
          const booking = await api.chargeStaffDraftCard(tenantSlug, draft.id, {
            sourceToken: token,
            attemptId,
            amountMode,
            ...(tipCents > 0 ? { tipCents } : {}),
          });
          onConfirmed(booking);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment link
// ---------------------------------------------------------------------------

export function PaymentLinkPanel({
  tenantSlug,
  draft,
  api,
  disabled,
  pollMs = 5000,
  onSent,
  onConfirmed,
}: {
  tenantSlug: string;
  draft: BookingDraftSummary;
  api: PaymentLinkApi;
  disabled: boolean;
  pollMs?: number;
  onSent: (holdExpiresAt: string) => void;
  onConfirmed: (booking: BookingSummary) => void;
}): ReactElement {
  const customer = draft.customer;
  const hasEmail = Boolean(customer?.email);
  const hasPhone = Boolean(customer?.smsPhone || customer?.phone);
  const optedIn = Boolean(customer?.smsConsent);

  const [email, setEmail] = useState(hasEmail);
  const [text, setText] = useState(false);
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<PaymentLinkResponse | null>(null);
  const [lapsed, setLapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const finished = useRef(false);

  // After the link is out, watch for the client paying (or the hold running out).
  useEffect(() => {
    if (!sent) return;
    let cancelled = false;
    const check = async () => {
      try {
        const current = await api.getBookingDraft(tenantSlug, draft.id);
        if (cancelled || finished.current) return;
        if (current.confirmedBookingId) {
          finished.current = true;
          onConfirmed(await api.getBooking(tenantSlug, current.confirmedBookingId));
        } else if (current.status === "expired" || current.status === "canceled") {
          setLapsed(true);
        }
      } catch {
        // A blip while polling isn't worth alarming staff over; the next poll retries.
      }
    };
    const id = window.setInterval(() => void check(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, draft.id, onConfirmed, pollMs, sent, tenantSlug]);

  const channels: Array<"email" | "sms"> = [...(email ? (["email"] as const) : []), ...(text ? (["sms"] as const) : [])];
  const needsConsent = text && !optedIn;
  const canSend = !disabled && !sending && !(needsConsent && !consent);

  const send = async () => {
    setSending(true);
    setError("");
    try {
      const response = await api.sendPaymentLink(tenantSlug, draft.id, {
        channels,
        ...(needsConsent && consent ? { smsConsentConfirmed: true } : {}),
      });
      setSent(response);
      onSent(response.holdExpiresAt);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to send the payment link.");
    } finally {
      setSending(false);
    }
  };

  const copy = async () => {
    if (!sent) return;
    try {
      await navigator.clipboard.writeText(sent.paymentUrl);
      setCopied(true);
    } catch {
      setError("Couldn't copy automatically. Select the link and copy it.");
    }
  };

  if (sent) {
    return (
      <div className="cs-collect__field" role="status" aria-live="polite">
        <strong>{lapsed ? "The hold expired before payment" : "Waiting for the client to pay…"}</strong>
        <span>
          The time is held until{" "}
          {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(sent.holdExpiresAt))}.
          This screen confirms the booking as soon as they pay.
        </span>
        {sent.deliveries.length > 0 ? (
          <ul className="cs-collect__deliveries">
            {sent.deliveries.map((delivery) => (
              <li key={delivery.channel} className={delivery.status === "sent" ? "is-ok" : "is-problem"}>
                {delivery.channel === "sms" ? "Text" : "Email"}
                {delivery.recipient ? ` to ${delivery.recipient}` : ""}:{" "}
                {delivery.status === "sent" ? "sent" : `${delivery.status}${delivery.error ? ` — ${delivery.error}` : ""}`}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="cs-collect__actions">
          <button type="button" className="cs-btn cs-btn--sm" onClick={() => void copy()}>
            {copied ? "Link copied" : "Copy link"}
          </button>
          <button type="button" className="cs-btn cs-btn--sm" onClick={() => setSent(null)} disabled={lapsed}>
            Send again
          </button>
        </div>
        {error ? <div role="alert" className="cs-banner cs-banner--error">{error}</div> : null}
      </div>
    );
  }

  return (
    <div className="cs-collect__field">
      <span>Send the client a link to pay their deposit. The time is held while they pay.</span>
      <label className="cs-collect__check">
        <input type="checkbox" checked={email} onChange={(event) => setEmail(event.target.checked)} disabled={!hasEmail || sending} />
        Email{customer?.email ? ` · ${customer.email}` : " · no email on file"}
      </label>
      <label className="cs-collect__check">
        <input type="checkbox" checked={text} onChange={(event) => setText(event.target.checked)} disabled={!hasPhone || sending} />
        Text{customer?.phone ? ` · ${customer.smsPhone ?? customer.phone}` : " · no phone on file"}
      </label>
      {needsConsent ? (
        <label className="cs-collect__check">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={sending} />
          The client asked for a text
        </label>
      ) : null}
      {error ? <div role="alert" className="cs-banner cs-banner--error">{error}</div> : null}
      <button type="button" className="cs-btn cs-btn--primary" onClick={() => void send()} disabled={!canSend}>
        {sending ? "Sending…" : channels.length === 0 ? "Hold slot & get link" : "Send payment link"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Balance at checkout
// ---------------------------------------------------------------------------

export type BalanceCardApi = {
  getPublicPaymentConfig: PhoneCardApi["getPublicPaymentConfig"];
  chargeStaffBookingBalanceCard: (
    tenantSlug: string,
    bookingId: string,
    body: { sourceToken: string; attemptId: string; tipCents?: number },
  ) => Promise<BookingSummary>;
};

/** Staff type a client's card to settle a booking's balance at checkout. */
export function BalanceCardPanel({
  tenantSlug,
  bookingId,
  api,
  tipCents,
  totalCents,
  blockedReason,
  disabled,
  onPaid,
}: {
  tenantSlug: string;
  bookingId: string;
  api: BalanceCardApi;
  tipCents: number;
  /** What the card will be charged, including any tip. */
  totalCents: number;
  blockedReason: string | null;
  disabled: boolean;
  onPaid: (booking: BookingSummary) => void | Promise<void>;
}): ReactElement {
  const [config, setConfig] = useState<PublicPaymentConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .getPublicPaymentConfig(tenantSlug)
      .then((result) => {
        if (!cancelled) setConfig(result);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : "Unable to load the card form.");
      });
    return () => {
      cancelled = true;
    };
  }, [api, tenantSlug]);

  if (error) return <div role="alert" className="cs-banner cs-banner--error">{error}</div>;
  if (config === null) return <p className="cs-empty" role="status">Loading the card form…</p>;
  if (!config.clover) {
    return (
      <div role="alert" className="cs-banner cs-banner--error">
        Card payments aren't turned on for this business yet.
      </div>
    );
  }
  return (
    <div className="cs-checkout-panel__notes">
      <span>Type the card the client reads out. It goes straight to Clover — it is never stored here.</span>
      {blockedReason ? <div role="note" className="cs-banner">{blockedReason}</div> : null}
      <CloverCardForm
        config={config.clover}
        submitLabel={`Charge ${money(totalCents)}`}
        disabled={disabled || blockedReason !== null || totalCents <= 0}
        onSubmit={async (token, attemptId) => {
          const booking = await api.chargeStaffBookingBalanceCard(tenantSlug, bookingId, {
            sourceToken: token,
            attemptId,
            ...(tipCents > 0 ? { tipCents } : {}),
          });
          await onPaid(booking);
        }}
      />
    </div>
  );
}
