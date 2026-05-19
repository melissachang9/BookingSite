import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import {
  getBookingBalanceCheckoutExpiryDate,
  isReusableBookingBalanceCheckoutSession,
} from "./stripe-checkout-session";

function withFakeNow<T>(timestamp: number, run: () => T) {
  const originalNow = Date.now;
  Date.now = () => timestamp;

  try {
    return run();
  } finally {
    Date.now = originalNow;
  }
}

function makeSession(overrides?: Partial<Stripe.Checkout.Session>) {
  return {
    id: "cs_balance_123",
    object: "checkout.session",
    status: "open",
    url: "https://checkout.stripe.com/c/pay/cs_balance_123",
    expires_at: Math.floor((Date.now() + 32 * 60_000) / 1000),
    amount_total: 20500,
    metadata: {
      kind: "booking_balance_checkout",
      booking_id: "booking-123",
      tip_cents: "2000",
      wallet_applied_cents: "5000",
    },
    ...overrides,
  } as Stripe.Checkout.Session;
}

test("computes balance checkout expiry from the current time", () => {
  withFakeNow(Date.UTC(2026, 4, 17, 12, 0, 0), () => {
    const expiry = getBookingBalanceCheckoutExpiryDate(30);
    assert.equal(expiry.toISOString(), "2026-05-17T12:30:00.000Z");
  });
});

test("reuses a compatible open balance checkout session", () => {
  withFakeNow(Date.UTC(2026, 4, 17, 12, 0, 0), () => {
    const reusable = isReusableBookingBalanceCheckoutSession(makeSession(), {
      checkoutSessionMinutes: 30,
      amountCents: 20500,
      tipCents: 2000,
      walletAppliedCents: 5000,
    });

    assert.equal(reusable, true);
  });
});

test("does not reuse balance checkout sessions when the requested amount or checkout inputs changed", () => {
  withFakeNow(Date.UTC(2026, 4, 17, 12, 0, 0), () => {
    assert.equal(
      isReusableBookingBalanceCheckoutSession(makeSession(), {
        checkoutSessionMinutes: 30,
        amountCents: 20600,
        tipCents: 2000,
        walletAppliedCents: 5000,
      }),
      false
    );

    assert.equal(
      isReusableBookingBalanceCheckoutSession(makeSession(), {
        checkoutSessionMinutes: 30,
        amountCents: 20500,
        tipCents: 2500,
        walletAppliedCents: 5000,
      }),
      false
    );

    assert.equal(
      isReusableBookingBalanceCheckoutSession(makeSession(), {
        checkoutSessionMinutes: 30,
        amountCents: 20500,
        tipCents: 2000,
        walletAppliedCents: 0,
      }),
      false
    );
  });
});