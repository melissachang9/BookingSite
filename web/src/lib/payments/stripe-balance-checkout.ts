import type Stripe from "stripe";
import {
  appendBookingCheckoutEvent,
  calculateBookingPaymentBreakdown,
  hasBookingCheckoutStripeSession,
} from "@/lib/payments/booking-checkout";
import { appendCustomerWalletLedgerEntry } from "@/lib/payments/customer-wallet";
import {
  getStripeCheckoutSessionStatus,
} from "@/lib/payments/stripe-checkout-session";
import type { StripeCheckoutSessionStatus } from "@/lib/payments/stripe-checkout-session";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeTenantSettings } from "@/lib/tenants/settings";

type AdminClient = ReturnType<typeof createAdminClient>;

export type BookingBalanceCheckoutReconcileResult = {
  status:
    | "applied"
    | "already_applied"
    | "session_not_found"
    | "session_not_complete"
    | "not_balance_checkout"
    | "booking_not_found"
    | "tenant_mismatch"
    | "update_failed";
  error?: string;
  sessionId?: string;
  sessionStatus?: StripeCheckoutSessionStatus;
  bookingId?: string;
  customerId?: string | null;
  tenantSlug?: string | null;
  paymentIntentId?: string | null;
};

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function persistBookingBalanceCheckoutSession(input: {
  bookingId: string;
  sessionId: string;
  expiresAt: Date;
  admin?: AdminClient;
}) {
  const admin = input.admin ?? createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .update({
      balance_checkout_stripe_session_id: input.sessionId,
      balance_checkout_session_expires_at: input.expiresAt.toISOString(),
    })
    .eq("id", input.bookingId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false as const,
      error: error?.message ?? "Booking not found",
    };
  }

  return { ok: true as const };
}

function getPaymentIntentId(session: Stripe.Checkout.Session) {
  return typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;
}

function getStripeCustomerId(session: Stripe.Checkout.Session) {
  return typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
}

export async function reconcileBookingBalanceCheckoutSession(input: {
  sessionId?: string | null;
  session?: Stripe.Checkout.Session;
  tenantId?: string;
  admin?: AdminClient;
}): Promise<BookingBalanceCheckoutReconcileResult> {
  let session = input.session;

  if (!session) {
    if (!input.sessionId) {
      return {
        status: "session_not_found",
        error: "Missing Stripe checkout session id.",
      };
    }

    try {
      session = await getStripe().checkout.sessions.retrieve(input.sessionId);
    } catch (error) {
      return {
        status: "session_not_found",
        error: error instanceof Error ? error.message : "Stripe checkout session could not be loaded.",
        sessionId: input.sessionId,
      };
    }
  }

  const sessionStatus = getStripeCheckoutSessionStatus(session);
  if (sessionStatus !== "complete") {
    return {
      status: "session_not_complete",
      sessionId: session.id,
      sessionStatus,
      error:
        sessionStatus === "expired"
          ? "The Stripe checkout session expired before payment completed."
          : "Stripe has not marked this checkout session complete yet.",
    };
  }

  if (session.metadata?.kind !== "booking_balance_checkout" || !session.metadata.booking_id) {
    return {
      status: "not_balance_checkout",
      sessionId: session.id,
      error: "Stripe checkout session is not a booking balance checkout.",
    };
  }

  const admin = input.admin ?? createAdminClient();
  const { data: booking, error } = await admin
    .from("bookings")
    .select(
      `id, tenant_id, status, customer_id, price_cents, deposit_cents, deposit_status, refunded_amount_cents, tip_cents, wallet_applied_cents,
       stripe_payment_intent_id, stripe_customer_id, notes, checkout_record_json,
       balance_checkout_stripe_session_id,
       customers(id),
       tenants(slug, settings_json)`
    )
    .eq("id", session.metadata.booking_id)
    .maybeSingle();

  if (error || !booking) {
    return {
      status: "booking_not_found",
      sessionId: session.id,
      error: error?.message ?? "Booking not found for Stripe balance checkout.",
    };
  }

  if (input.tenantId && booking.tenant_id !== input.tenantId) {
    return {
      status: "tenant_mismatch",
      sessionId: session.id,
      bookingId: booking.id,
      error: "Stripe checkout session does not belong to this tenant.",
    };
  }

  const customer = normalizeRelation(booking.customers as { id: string } | null);
  const tenant = normalizeRelation(
    booking.tenants as { slug: string; settings_json: Partial<Record<string, unknown>> | null } | null
  );

  if (hasBookingCheckoutStripeSession(booking.checkout_record_json, session.id)) {
    return {
      status: "already_applied",
      sessionId: session.id,
      bookingId: booking.id,
      customerId: customer?.id ?? null,
      tenantSlug: tenant?.slug ?? null,
      paymentIntentId: getPaymentIntentId(session),
    };
  }

  const taxRatePercent = normalizeTenantSettings(
    (tenant?.settings_json ?? null) as Partial<Record<string, unknown>> | null
  ).tax_rate_percent ?? 0;
  const paymentIntentId = getPaymentIntentId(session);
  const stripeCustomerId = getStripeCustomerId(session);
  const tipCents = Number.parseInt(session.metadata?.tip_cents ?? `${booking.tip_cents}`, 10);
  const walletAppliedCents = Number.parseInt(
    session.metadata?.wallet_applied_cents ?? `${booking.wallet_applied_cents}`,
    10
  );
  const paymentBreakdown = calculateBookingPaymentBreakdown({
    priceCents: booking.price_cents,
    depositCents: booking.deposit_cents,
    depositStatus: booking.deposit_status,
    refundedAmountCents: booking.refunded_amount_cents,
    taxRatePercent,
    tipCents: Number.isFinite(tipCents) ? tipCents : booking.tip_cents,
    walletAppliedCents: Number.isFinite(walletAppliedCents)
      ? walletAppliedCents
      : booking.wallet_applied_cents,
  });
  const remainingBalance = paymentBreakdown.balanceDueCents;

  if (remainingBalance <= 0 && booking.deposit_status === "paid_in_full") {
    return {
      status: "already_applied",
      sessionId: session.id,
      bookingId: booking.id,
      customerId: customer?.id ?? null,
      tenantSlug: tenant?.slug ?? null,
      paymentIntentId,
    };
  }

  const existingNotes = booking.notes?.trim() ? `${booking.notes}\n` : "";
  const balanceMeta = `Balance checkout paid via Stripe (${(session.amount_total ?? 0) / 100} USD). Session ${session.id}${paymentIntentId ? `, PI ${paymentIntentId}` : ""}.`;
  const paidAt = new Date().toISOString();
  const checkoutRecord = appendBookingCheckoutEvent(booking.checkout_record_json, {
    kind: "stripe_balance_checkout",
    at: paidAt,
    payment_resolution: "stripe_balance_checkout",
    payment_outcome_label: "Paid through Stripe balance checkout",
    subtotal_cents: paymentBreakdown.subtotalCents,
    tax_rate_percent: taxRatePercent,
    tax_cents: paymentBreakdown.taxCents,
    total_with_tax_cents: paymentBreakdown.totalWithTaxCents,
    tip_cents: paymentBreakdown.tipCents,
    wallet_applied_cents: paymentBreakdown.walletAppliedCents,
    amount_owing_at_checkout_cents: remainingBalance,
    amount_recorded_cents: session.amount_total ?? remainingBalance,
    stripe_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
    note: null,
  });

  let walletLedgerEntryId: string | null = null;
  if (paymentBreakdown.walletAppliedCents > 0 && booking.customer_id && booking.wallet_applied_cents === 0) {
    walletLedgerEntryId = await appendCustomerWalletLedgerEntry({
      admin,
      tenantId: booking.tenant_id,
      customerId: booking.customer_id,
      bookingId: booking.id,
      amountCents: -paymentBreakdown.walletAppliedCents,
      reason: "checkout_applied",
      note: `Applied during Stripe balance checkout${paymentBreakdown.tipCents > 0 ? ` with ${paymentBreakdown.tipCents / 100} USD tip` : ""}`,
    });
  }

  const { error: updateError } = await admin
    .from("bookings")
    .update({
      deposit_status: "paid_in_full",
      tip_cents: paymentBreakdown.tipCents,
      wallet_applied_cents: paymentBreakdown.walletAppliedCents,
      balance_checkout_stripe_session_id: null,
      balance_checkout_session_expires_at: null,
      ...(booking.stripe_payment_intent_id ? {} : { stripe_payment_intent_id: paymentIntentId }),
      ...(booking.stripe_customer_id ? {} : { stripe_customer_id: stripeCustomerId }),
      checkout_record_json: checkoutRecord,
      notes: `${existingNotes}${balanceMeta}`,
    })
    .eq("id", booking.id);

  if (updateError) {
    if (walletLedgerEntryId) {
      await admin.from("customer_wallet_ledger").delete().eq("id", walletLedgerEntryId);
    }

    return {
      status: "update_failed",
      sessionId: session.id,
      bookingId: booking.id,
      error: updateError.message,
    };
  }

  await admin
    .from("booking_drafts")
    .update({ deposit_status: "paid_in_full" })
    .eq("promoted_booking_id", booking.id)
    .neq("status", "abandoned");

  return {
    status: "applied",
    sessionId: session.id,
    bookingId: booking.id,
    customerId: customer?.id ?? null,
    tenantSlug: tenant?.slug ?? null,
    paymentIntentId,
  };
}