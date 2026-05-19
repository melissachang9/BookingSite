import type Stripe from "stripe";

const REUSABLE_CHECKOUT_BUFFER_MINUTES = 5;

export type StripeCheckoutSessionStatus = "open" | "complete" | "expired" | null;

export type StripeCheckoutSessionState = {
  status: StripeCheckoutSessionStatus;
  url: string | null;
  expiresAt: string | null;
};

export function getStripeCheckoutSessionStatus(
  session: Stripe.Checkout.Session
): StripeCheckoutSessionStatus {
  if (
    session.status === "open" ||
    session.status === "complete" ||
    session.status === "expired"
  ) {
    return session.status;
  }

  return null;
}

export function getStripeCheckoutSessionExpiresAt(session: Stripe.Checkout.Session) {
  return session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null;
}

function getSessionMetadataCents(value: string | null | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getBookingBalanceCheckoutExpiryDate(checkoutSessionMinutes: number) {
  return new Date(Date.now() + checkoutSessionMinutes * 60_000);
}

export function isReusableBookingBalanceCheckoutSession(
  session: Stripe.Checkout.Session,
  input: {
    checkoutSessionMinutes: number;
    amountCents: number;
    tipCents: number;
    walletAppliedCents: number;
  }
) {
  if (session.status !== "open" || !session.url || !session.expires_at) {
    return false;
  }

  if ((session.amount_total ?? 0) !== input.amountCents) {
    return false;
  }

  if (getSessionMetadataCents(session.metadata?.tip_cents) !== input.tipCents) {
    return false;
  }

  if (
    getSessionMetadataCents(session.metadata?.wallet_applied_cents) !== input.walletAppliedCents
  ) {
    return false;
  }

  return (
    session.expires_at * 1000 <=
    Date.now() + (input.checkoutSessionMinutes + REUSABLE_CHECKOUT_BUFFER_MINUTES) * 60_000
  );
}