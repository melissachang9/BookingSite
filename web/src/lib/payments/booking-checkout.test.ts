import assert from "node:assert/strict";
import test from "node:test";
import {
  appendBookingCheckoutEvent,
  calculateBookingPaymentBreakdown,
  getBookingBalanceFollowUpCents,
  getLatestBookingCheckoutEvent,
  hasBookingCheckoutStripeSession,
  parseDollarAmountToCents,
  validateExternalPosCollection,
} from "./booking-checkout";

test("calculates amount owing from full price + tax then subtracts deposit", () => {
  const breakdown = calculateBookingPaymentBreakdown({
    priceCents: 10000,
    depositCents: 3000,
    depositStatus: "deposit_paid",
    refundedAmountCents: 0,
    taxRatePercent: 10,
  });

  assert.equal(breakdown.subtotalCents, 10000);
  assert.equal(breakdown.taxCents, 1000);
  assert.equal(breakdown.tipCents, 0);
  assert.equal(breakdown.totalWithTaxCents, 11000);
  assert.equal(breakdown.totalAtCheckoutCents, 11000);
  assert.equal(breakdown.walletAppliedCents, 0);
  assert.equal(breakdown.balanceDueCents, 8000);
});

test("subtracts refunded amount from tax-inclusive total", () => {
  const breakdown = calculateBookingPaymentBreakdown({
    priceCents: 20000,
    depositCents: 0,
    depositStatus: "unpaid",
    refundedAmountCents: 1500,
    taxRatePercent: 5,
  });

  assert.equal(breakdown.totalWithTaxCents, 21000);
  assert.equal(breakdown.totalAtCheckoutCents, 21000);
  assert.equal(breakdown.balanceDueCents, 19500);
});

test("adds tip and subtracts wallet credit from amount owing", () => {
  const breakdown = calculateBookingPaymentBreakdown({
    priceCents: 10000,
    depositCents: 3000,
    depositStatus: "deposit_paid",
    refundedAmountCents: 0,
    taxRatePercent: 10,
    tipCents: 1500,
    walletAppliedCents: 2000,
  });

  assert.equal(breakdown.totalWithTaxCents, 11000);
  assert.equal(breakdown.tipCents, 1500);
  assert.equal(breakdown.totalAtCheckoutCents, 12500);
  assert.equal(breakdown.walletAppliedCents, 2000);
  assert.equal(breakdown.balanceDueCents, 7500);
});

test("requires external POS amount when balance is due", () => {
  const result = validateExternalPosCollection({
    paymentResolution: "collected_external",
    balanceDueCents: 5000,
    externalPaidCents: null,
  });

  assert.equal(result, "Enter the exact amount collected on the external POS terminal.");
});

test("blocks external POS underpayment", () => {
  const result = validateExternalPosCollection({
    paymentResolution: "collected_external",
    balanceDueCents: 7500,
    externalPaidCents: 7400,
  });

  assert.deepEqual(result, {
    kind: "underpaid",
    externalPaidCents: 7400,
    balanceDueCents: 7500,
  });
});

test("accepts exact external POS amount", () => {
  const result = validateExternalPosCollection({
    paymentResolution: "collected_external",
    balanceDueCents: 7500,
    externalPaidCents: 7500,
  });

  assert.equal(result, null);
});

test("parses dollars into cents", () => {
  assert.equal(parseDollarAmountToCents("123.45"), 12345);
  assert.equal(parseDollarAmountToCents("0"), 0);
  assert.equal(parseDollarAmountToCents(""), null);
  assert.equal(parseDollarAmountToCents("abc"), null);
});

test("appends structured checkout events and exposes latest event", () => {
  const first = appendBookingCheckoutEvent(null, {
    kind: "admin_completion",
    at: "2025-01-01T10:00:00.000Z",
    payment_resolution: "collected_external",
    payment_outcome_label: "Collected now (external terminal)",
    subtotal_cents: 10000,
    tax_rate_percent: 5,
    tax_cents: 500,
    total_with_tax_cents: 10500,
    tip_cents: 1000,
    wallet_applied_cents: 500,
    amount_owing_at_checkout_cents: 7500,
    amount_recorded_cents: 7500,
    external_paid_cents: 7500,
    actor_user_id: "user-1",
    note: "Paid at front desk",
  });

  assert.equal(first.events.length, 1);
  assert.deepEqual(first.latest_event, first.events[0]);

  const second = appendBookingCheckoutEvent(first, {
    kind: "stripe_balance_checkout",
    at: "2025-01-02T10:00:00.000Z",
    payment_resolution: "stripe_balance_checkout",
    payment_outcome_label: "Paid through Stripe balance checkout",
    subtotal_cents: 10000,
    tax_rate_percent: 5,
    tax_cents: 500,
    total_with_tax_cents: 10500,
    tip_cents: 1000,
    wallet_applied_cents: 500,
    amount_owing_at_checkout_cents: 7500,
    amount_recorded_cents: 7500,
    stripe_session_id: "cs_123",
    stripe_payment_intent_id: "pi_123",
  });

  assert.equal(second.events.length, 2);
  assert.deepEqual(getLatestBookingCheckoutEvent(second), second.events[1]);
});

test("detects recorded Stripe checkout sessions from the structured events array", () => {
  const record = appendBookingCheckoutEvent(null, {
    kind: "stripe_balance_checkout",
    at: "2025-01-02T10:00:00.000Z",
    payment_resolution: "stripe_balance_checkout",
    payment_outcome_label: "Paid through Stripe balance checkout",
    subtotal_cents: 10000,
    tax_rate_percent: 5,
    tax_cents: 500,
    total_with_tax_cents: 10500,
    amount_owing_at_checkout_cents: 7500,
    amount_recorded_cents: 7500,
    stripe_session_id: "cs_recorded",
    stripe_payment_intent_id: "pi_recorded",
  });

  assert.equal(hasBookingCheckoutStripeSession(record, "cs_recorded"), true);
  assert.equal(
    hasBookingCheckoutStripeSession(
      {
        version: 1,
        events: [],
        latest_event: record.latest_event,
      },
      "cs_recorded"
    ),
    false
  );
});

test("returns outstanding cents for follow-up checkout events", () => {
  const record = appendBookingCheckoutEvent(null, {
    kind: "admin_completion",
    at: "2025-01-03T10:00:00.000Z",
    payment_resolution: "follow_up",
    payment_outcome_label: "Leave balance for follow-up",
    subtotal_cents: 10000,
    tax_rate_percent: 5,
    tax_cents: 500,
    total_with_tax_cents: 10500,
    amount_owing_at_checkout_cents: 7500,
    amount_recorded_cents: 0,
  });

  assert.equal(
    getBookingBalanceFollowUpCents({
      checkoutRecord: record,
      depositStatus: "deposit_paid",
    }),
    7500
  );
});

test("suppresses follow-up amount after booking is paid in full", () => {
  const record = appendBookingCheckoutEvent(null, {
    kind: "admin_completion",
    at: "2025-01-03T10:00:00.000Z",
    payment_resolution: "follow_up",
    payment_outcome_label: "Leave balance for follow-up",
    subtotal_cents: 10000,
    tax_rate_percent: 5,
    tax_cents: 500,
    total_with_tax_cents: 10500,
    amount_owing_at_checkout_cents: 7500,
    amount_recorded_cents: 0,
  });

  assert.equal(
    getBookingBalanceFollowUpCents({
      checkoutRecord: record,
      depositStatus: "paid_in_full",
    }),
    0
  );
});
