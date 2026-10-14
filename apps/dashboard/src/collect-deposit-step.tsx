import { useEffect, useMemo, useState, type ReactElement } from "react";
import type {
  BookingDraftSummary,
  BookingSummary,
  CloverDevicePayment,
  ConfirmWithCloverPaymentRequest,
  ConfirmWithPaymentRequest,
  CustomPaymentMethod,
  PaymentCapabilities,
  ReleaseBookingDraftRequest,
} from "@booking/shared-types";

import { CloverDevicePaymentPicker, type CloverDevicePaymentPickerApi } from "./clover-device-payment-picker";
import { PaymentLinkPanel, PhoneCardPanel, type PaymentLinkApi, type PhoneCardApi } from "./collect-card-panels";

/**
 * Shown in the new-booking drawer once a staff draft holds the slot. Staff
 * record how the client paid (external POS terminal, cash, or a custom
 * method) and the booking is confirmed; or they release the hold.
 *
 * The amount is never typed: it is exactly the deposit or the full visit
 * total (plus an optional tip), so the record always matches the terminal.
 */

export type CollectDepositApi = {
  confirmBookingDraftWithPayment: (
    tenantSlug: string,
    bookingDraftId: string,
    body: ConfirmWithPaymentRequest,
  ) => Promise<BookingSummary>;
  releaseBookingDraft: (
    tenantSlug: string,
    bookingDraftId: string,
    body?: ReleaseBookingDraftRequest,
  ) => Promise<BookingDraftSummary>;
  /** Present when the business can match payments taken on the Clover device. */
  listCloverDevicePayments?: CloverDevicePaymentPickerApi["listCloverDevicePayments"];
  confirmBookingDraftWithCloverPayment?: (
    tenantSlug: string,
    bookingDraftId: string,
    body: ConfirmWithCloverPaymentRequest,
  ) => Promise<BookingSummary>;
  /** For services that take no deposit. */
  confirmBookingDraftWithoutPayment?: (tenantSlug: string, bookingDraftId: string) => Promise<BookingSummary>;
  /** Phone card entry through Clover's secure form. */
  getPublicPaymentConfig?: PhoneCardApi["getPublicPaymentConfig"];
  chargeStaffDraftCard?: PhoneCardApi["chargeStaffDraftCard"];
  /** Text/email the client a payment link, then wait for them to pay. */
  sendPaymentLink?: PaymentLinkApi["sendPaymentLink"];
  getBookingDraft?: PaymentLinkApi["getBookingDraft"];
  getBooking?: PaymentLinkApi["getBooking"];
};

type CollectDepositStepProps = {
  draft: BookingDraftSummary;
  tenantSlug: string;
  api: CollectDepositApi;
  customPaymentMethods: CustomPaymentMethod[];
  canCollectPayment: boolean;
  /** What the business's card processor can do; Clover matching shows when on. */
  capabilities?: PaymentCapabilities | null;
  onConfirmed: (booking: BookingSummary) => void;
  onReleased: () => void;
};

type MethodOption = { id: string; label: string; hint: string };

const CLOVER_METHOD: MethodOption = { id: "clover", label: "Clover", hint: "Paid on the Clover device" };
const CARD_METHOD: MethodOption = { id: "card", label: "Card (phone)", hint: "Type the card the client reads out" };
const LINK_METHOD: MethodOption = { id: "link", label: "Payment link", hint: "Text or email the client a link" };

const BUILTIN_METHODS: MethodOption[] = [
  { id: "external_pos", label: "External POS", hint: "Paid on the card terminal" },
  { id: "cash", label: "Cash", hint: "Paid in cash" },
];

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function parseTipCents(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  const dollars = Number.parseFloat(cleaned);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}

function useSecondsLeft(expiresAt: string): number {
  const target = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return Math.max(0, Math.floor((target - now) / 1000));
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function CollectDepositStep({
  draft,
  tenantSlug,
  api,
  customPaymentMethods,
  canCollectPayment,
  capabilities = null,
  onConfirmed,
  onReleased,
}: CollectDepositStepProps): ReactElement {
  const depositCents = draft.depositCents;
  const fullCents = draft.fullAmountCents ?? draft.priceCents + (draft.addOnsTotalCents ?? 0);
  const [amountMode, setAmountMode] = useState<"deposit" | "full">(depositCents > 0 ? "deposit" : "full");
  const cloverAvailable = Boolean(
    capabilities?.canLinkDevicePayments && api.listCloverDevicePayments && api.confirmBookingDraftWithCloverPayment,
  );
  // Online card payments (phone card entry, payment link) need a connected processor.
  const cardAvailable = Boolean(
    capabilities?.canChargeCards && api.getPublicPaymentConfig && api.chargeStaffDraftCard && depositCents + (draft.fullAmountCents ?? 0) > 0,
  );
  const linkAvailable = Boolean(
    capabilities?.canSendPaymentLink && api.sendPaymentLink && api.getBookingDraft && api.getBooking && depositCents > 0,
  );
  const methods = useMemo<MethodOption[]>(
    () => [
      ...(cloverAvailable ? [CLOVER_METHOD] : []),
      ...(cardAvailable ? [CARD_METHOD] : []),
      ...(linkAvailable ? [LINK_METHOD] : []),
      ...BUILTIN_METHODS,
      ...customPaymentMethods.map((m) => ({ id: m.id, label: m.label, hint: m.label })),
    ],
    [cardAvailable, cloverAvailable, customPaymentMethods, linkAvailable],
  );
  const [methodId, setMethodId] = useState(cloverAvailable ? "clover" : "external_pos");
  const [cloverPayment, setCloverPayment] = useState<CloverDevicePayment | null>(null);
  const [reference, setReference] = useState("");
  const [tipText, setTipText] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "submitting" | "releasing" } | { kind: "error"; message: string }>({
    kind: "idle",
  });

  // Sending a payment link extends the hold; the draft prop doesn't change.
  const [holdExpiresAt, setHoldExpiresAt] = useState(draft.expiresAt);
  const secondsLeft = useSecondsLeft(holdExpiresAt);
  const expired = secondsLeft === 0;
  const busy = state.kind === "submitting" || state.kind === "releasing";

  const isClover = methodId === "clover";
  // Card entry and the payment link run their own submit; the shared button is for typed-in payments.
  const isOwnSubmit = methodId === "card" || methodId === "link";
  const tipCents = amountMode === "full" ? parseTipCents(tipText) : 0;
  const visitCents = amountMode === "deposit" ? depositCents : fullCents;
  const totalCents = visitCents + (tipCents ?? 0);
  const needsReference = methodId === "external_pos";
  const referenceMissing = needsReference && reference.trim().length === 0;
  const canSubmit = isClover
    ? canCollectPayment && !busy && !expired && cloverPayment !== null
    : canCollectPayment && !busy && !expired && !referenceMissing && tipCents !== null && visitCents > 0;
  // Staff can confirm a no-deposit service without taking anything now.
  const canConfirmWithoutPayment = depositCents === 0 && Boolean(api.confirmBookingDraftWithoutPayment);

  const handleConfirmWithoutPayment = async () => {
    if (!api.confirmBookingDraftWithoutPayment || busy || expired) return;
    setState({ kind: "submitting" });
    try {
      onConfirmed(await api.confirmBookingDraftWithoutPayment(tenantSlug, draft.id));
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Unable to confirm the booking." });
    }
  };

  const handleConfirmClover = async () => {
    if (!canSubmit || !cloverPayment || !api.confirmBookingDraftWithCloverPayment) return;
    setState({ kind: "submitting" });
    try {
      const booking = await api.confirmBookingDraftWithCloverPayment(tenantSlug, draft.id, {
        cloverPaymentId: cloverPayment.id,
        amountMode: cloverPayment.matches === "full" ? "full" : "deposit",
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onConfirmed(booking);
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Unable to link the Clover payment." });
    }
  };

  const handleConfirm = async () => {
    if (isClover) return handleConfirmClover();
    if (!canSubmit || tipCents === null) return;
    setState({ kind: "submitting" });
    try {
      const booking = await api.confirmBookingDraftWithPayment(tenantSlug, draft.id, {
        paymentMethodType: methodId,
        amountMode,
        amountCents: totalCents,
        ...(tipCents > 0 ? { tipCents } : {}),
        ...(reference.trim() ? { externalReference: reference.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onConfirmed(booking);
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Unable to record the payment." });
    }
  };

  const handleRelease = async () => {
    setState({ kind: "releasing" });
    try {
      await api.releaseBookingDraft(tenantSlug, draft.id, {});
      onReleased();
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "Unable to release the hold." });
    }
  };

  return (
    <section className="cs-collect" aria-label="Collect payment">
      <div className="cs-collect__head">
        <div>
          <div className="cs-section__label">Collect payment</div>
          <div className="cs-collect__hint">The slot is held until the client pays.</div>
        </div>
        <span className={`cs-collect__timer${expired ? " is-expired" : secondsLeft < 120 ? " is-urgent" : ""}`} role="timer">
          {expired ? "Hold expired" : `Held ${formatCountdown(secondsLeft)}`}
        </span>
      </div>

      {!canCollectPayment ? (
        <div className="cs-banner" role="note">
          You don&rsquo;t have permission to take payments. Ask a manager to collect the deposit.
        </div>
      ) : null}

      {!isClover && methodId !== "link" ? (
      <div className="cs-seg" role="radiogroup" aria-label="Amount">
        {depositCents > 0 ? (
          <button type="button" role="radio" aria-checked={amountMode === "deposit"} aria-pressed={amountMode === "deposit"} onClick={() => setAmountMode("deposit")} disabled={busy}>
            Deposit · {formatMoney(depositCents)}
          </button>
        ) : null}
        <button type="button" role="radio" aria-checked={amountMode === "full"} aria-pressed={amountMode === "full"} onClick={() => setAmountMode("full")} disabled={busy}>
          Full amount · {formatMoney(fullCents)}
        </button>
      </div>
      ) : null}

      <div className="cs-collect__methods" role="radiogroup" aria-label="Paid with">
        {methods.map((method) => (
          <button
            key={method.id}
            type="button"
            role="radio"
            aria-checked={methodId === method.id}
            className={`cs-collect__method${methodId === method.id ? " is-active" : ""}`}
            onClick={() => {
              setMethodId(method.id);
              setCloverPayment(null);
            }}
            disabled={busy}
          >
            <span className="cs-collect__method-label">{method.label}</span>
            <span className="cs-collect__method-hint">{method.hint}</span>
          </button>
        ))}
      </div>

      {isClover && api.listCloverDevicePayments ? (
        <div className="cs-collect__field">
          <span>Ring the client up on the Clover device, then pick the payment</span>
          <CloverDevicePaymentPicker
            tenantSlug={tenantSlug}
            api={{ listCloverDevicePayments: api.listCloverDevicePayments }}
            bookingDraftId={draft.id}
            selectedId={cloverPayment?.id ?? null}
            onSelect={setCloverPayment}
            disabled={busy || expired || !canCollectPayment}
          />
        </div>
      ) : null}

      {methodId === "card" && api.getPublicPaymentConfig && api.chargeStaffDraftCard ? (
        <PhoneCardPanel
          tenantSlug={tenantSlug}
          draft={draft}
          api={{ getPublicPaymentConfig: api.getPublicPaymentConfig, chargeStaffDraftCard: api.chargeStaffDraftCard }}
          amountMode={amountMode}
          tipCents={tipCents ?? 0}
          totalCents={totalCents}
          disabled={busy || expired || !canCollectPayment || tipCents === null || visitCents <= 0}
          onConfirmed={onConfirmed}
        />
      ) : null}

      {methodId === "link" && api.sendPaymentLink && api.getBookingDraft && api.getBooking ? (
        <PaymentLinkPanel
          tenantSlug={tenantSlug}
          draft={draft}
          api={{ sendPaymentLink: api.sendPaymentLink, getBookingDraft: api.getBookingDraft, getBooking: api.getBooking }}
          disabled={busy || expired || !canCollectPayment}
          onSent={setHoldExpiresAt}
          onConfirmed={onConfirmed}
        />
      ) : null}

      {needsReference ? (
        <label className="cs-collect__field">
          <span>Receipt or approval # (or card last 4)</span>
          <input
            className="cs-input"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="e.g. 004512"
            maxLength={128}
            disabled={busy}
          />
        </label>
      ) : null}

      {amountMode === "full" && !isClover && methodId !== "link" ? (
        <label className="cs-collect__field">
          <span>Tip (optional)</span>
          <input
            className="cs-input"
            inputMode="decimal"
            value={tipText}
            onChange={(event) => setTipText(event.target.value)}
            placeholder="0.00"
            disabled={busy}
          />
        </label>
      ) : null}

      {!isOwnSubmit ? (
      <label className="cs-collect__field">
        <span>Note (optional)</span>
        <input
          className="cs-input"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="e.g. Paid at front desk"
          maxLength={500}
          disabled={busy}
        />
      </label>
      ) : null}

      {methodId !== "link" ? (
      <div className="cs-collect__total">
        <span>{isClover ? "Matched payment" : methodId === "card" ? "Charge to the card" : "Charge on the terminal"}</span>
        <strong>
          {isClover
            ? cloverPayment
              ? formatMoney(cloverPayment.totalCents)
              : "—"
            : tipCents === null
              ? "—"
              : formatMoney(totalCents)}
        </strong>
      </div>
      ) : null}

      {state.kind === "error" ? (
        <div className="cs-banner cs-banner--error" role="alert">{state.message}</div>
      ) : null}
      {expired ? (
        <div className="cs-banner cs-banner--error" role="alert">
          The hold expired before payment was recorded. Close this and book the slot again.
        </div>
      ) : null}

      <div className="cs-collect__actions">
        <button type="button" className="cs-btn" onClick={() => void handleRelease()} disabled={busy}>
          {state.kind === "releasing" ? "Releasing…" : "Release hold"}
        </button>
        {isOwnSubmit ? null : (
          <button type="button" className="cs-btn cs-btn--primary" onClick={() => void handleConfirm()} disabled={!canSubmit}>
            {state.kind === "submitting" ? "Confirming…" : isClover ? "Link payment & confirm" : "Record payment & confirm"}
          </button>
        )}
      </div>
      {canConfirmWithoutPayment ? (
        <button
          type="button"
          className="cs-btn cs-collect__skip"
          onClick={() => void handleConfirmWithoutPayment()}
          disabled={busy || expired || !canCollectPayment}
        >
          Confirm without payment — client pays at the visit
        </button>
      ) : null}
    </section>
  );
}
