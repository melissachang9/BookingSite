export type BookingDepositStatus = string | null;

export type BookingPaymentBreakdownInput = {
  priceCents: number;
  depositCents: number;
  depositStatus: BookingDepositStatus;
  refundedAmountCents: number | null;
  taxRatePercent: number;
  tipCents?: number;
  walletAppliedCents?: number;
};

export type BookingPaymentBreakdown = {
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalWithTaxCents: number;
  totalAtCheckoutCents: number;
  walletAppliedCents: number;
  balanceDueCents: number;
};

export type BookingCheckoutEventKind = "admin_completion" | "stripe_balance_checkout";

export type BookingCheckoutEvent = {
  kind: BookingCheckoutEventKind;
  at: string;
  payment_resolution: string;
  payment_outcome_label: string;
  subtotal_cents: number;
  tax_rate_percent: number;
  tax_cents: number;
  total_with_tax_cents: number;
  tip_cents?: number | null;
  wallet_applied_cents?: number | null;
  amount_owing_at_checkout_cents: number;
  amount_recorded_cents: number;
  external_paid_cents?: number | null;
  stripe_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
  actor_user_id?: string | null;
  note?: string | null;
};

export type BookingCheckoutRecord = {
  version: 1;
  events: BookingCheckoutEvent[];
  latest_event: BookingCheckoutEvent | null;
};

export function calculateBookingPaymentBreakdown(
  input: BookingPaymentBreakdownInput
): BookingPaymentBreakdown {
  const subtotalCents = Math.max(input.priceCents, 0);
  const taxRatePercent = clampTaxRatePercent(input.taxRatePercent);
  const taxCents = Math.round((subtotalCents * taxRatePercent) / 100);
  const totalWithTaxCents = subtotalCents + taxCents;
  const tipCents = Math.max(input.tipCents ?? 0, 0);
  const totalAtCheckoutCents = totalWithTaxCents + tipCents;
  const refundedCents = Math.max(input.refundedAmountCents ?? 0, 0);
  const walletAppliedCents = Math.max(input.walletAppliedCents ?? 0, 0);

  if (input.depositStatus === "paid_in_full") {
    return {
      subtotalCents,
      taxCents,
      tipCents,
      totalWithTaxCents,
      totalAtCheckoutCents,
      walletAppliedCents,
      balanceDueCents: 0,
    };
  }

  if (input.depositStatus === "deposit_paid") {
    return {
      subtotalCents,
      taxCents,
      tipCents,
      totalWithTaxCents,
      totalAtCheckoutCents,
      walletAppliedCents,
      balanceDueCents: Math.max(
        totalAtCheckoutCents - input.depositCents - refundedCents - walletAppliedCents,
        0
      ),
    };
  }

  return {
    subtotalCents,
    taxCents,
    tipCents,
    totalWithTaxCents,
    totalAtCheckoutCents,
    walletAppliedCents,
    balanceDueCents: Math.max(totalAtCheckoutCents - refundedCents - walletAppliedCents, 0),
  };
}

export function parseDollarAmountToCents(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function validateExternalPosCollection(input: {
  paymentResolution: "none_due" | "collected_cash" | "collected_external" | "already_paid" | "follow_up";
  balanceDueCents: number;
  externalPaidCents: number | null;
}) {
  if (input.paymentResolution !== "collected_external") {
    return null;
  }

  if (input.balanceDueCents > 0 && input.externalPaidCents === null) {
    return "Enter the exact amount collected on the external POS terminal.";
  }

  if ((input.externalPaidCents ?? 0) < input.balanceDueCents) {
    return {
      kind: "underpaid",
      externalPaidCents: input.externalPaidCents ?? 0,
      balanceDueCents: input.balanceDueCents,
    } as const;
  }

  return null;
}

export function appendBookingCheckoutEvent(
  existingValue: unknown,
  event: BookingCheckoutEvent
): BookingCheckoutRecord {
  const normalized = readBookingCheckoutRecord(existingValue);
  const events = [...normalized.events, event];
  return {
    version: 1,
    events,
    latest_event: event,
  };
}

export function getLatestBookingCheckoutEvent(existingValue: unknown): BookingCheckoutEvent | null {
  return readBookingCheckoutRecord(existingValue).latest_event;
}

export function hasBookingCheckoutStripeSession(existingValue: unknown, sessionId: string) {
  if (!sessionId) return false;

  return readBookingCheckoutRecord(existingValue).events.some(
    (event) => event.kind === "stripe_balance_checkout" && event.stripe_session_id === sessionId
  );
}

export function getBookingBalanceFollowUpCents(input: {
  checkoutRecord: unknown;
  depositStatus: BookingDepositStatus;
}) {
  const latestEvent = readBookingCheckoutRecord(input.checkoutRecord).latest_event;

  if (latestEvent?.payment_resolution !== "follow_up") {
    return 0;
  }

  if (input.depositStatus === "paid_in_full") {
    return 0;
  }

  return Math.max(latestEvent.amount_owing_at_checkout_cents, 0);
}

export function readBookingCheckoutRecord(existingValue: unknown): BookingCheckoutRecord {
  if (!existingValue || typeof existingValue !== "object" || Array.isArray(existingValue)) {
    return {
      version: 1,
      events: [],
      latest_event: null,
    };
  }

  const raw = existingValue as Record<string, unknown>;
  const rawEvents = Array.isArray(raw.events) ? raw.events : [];
  const events = rawEvents.filter(isBookingCheckoutEvent);

  return {
    version: 1,
    events,
    latest_event: events.length > 0 ? events[events.length - 1] : null,
  };
}

function isBookingCheckoutEvent(value: unknown): value is BookingCheckoutEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const raw = value as Record<string, unknown>;
  if (raw.kind !== "admin_completion" && raw.kind !== "stripe_balance_checkout") {
    return false;
  }
  if (typeof raw.at !== "string" || raw.at.length === 0) {
    return false;
  }
  if (typeof raw.payment_resolution !== "string" || typeof raw.payment_outcome_label !== "string") {
    return false;
  }

  return (
    Number.isFinite(raw.subtotal_cents) &&
    Number.isFinite(raw.tax_rate_percent) &&
    Number.isFinite(raw.tax_cents) &&
    Number.isFinite(raw.total_with_tax_cents) &&
    Number.isFinite(raw.amount_owing_at_checkout_cents) &&
    Number.isFinite(raw.amount_recorded_cents)
  );
}

function clampTaxRatePercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
