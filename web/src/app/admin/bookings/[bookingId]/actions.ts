"use server";

import Stripe from "stripe";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import {
  canManageBookingCheckout,
  getManageBookingCheckoutError,
} from "@/lib/admin/roles";
import { requireTenant } from "@/lib/admin/require-tenant";
import type { ActionState } from "@/lib/admin/action-state";
import { cancelBookingForTenant } from "@/lib/bookings/cancel";
import { sendBookingCompletionEmail } from "@/lib/emails/booking-completion";
import { sendBookingConfirmationEmail } from "@/lib/emails/booking-confirmation";
import {
  appendBookingCheckoutEvent,
  calculateBookingPaymentBreakdown,
  parseDollarAmountToCents,
  readBookingCheckoutRecord,
  validateExternalPosCollection,
} from "@/lib/payments/booking-checkout";
import {
  appendCustomerWalletLedgerEntry,
  getCustomerWalletBalanceCents,
} from "@/lib/payments/customer-wallet";
import {
  persistBookingBalanceCheckoutSession,
} from "@/lib/payments/stripe-balance-checkout";
import {
  getBookingBalanceCheckoutExpiryDate,
  isReusableBookingBalanceCheckoutSession,
} from "@/lib/payments/stripe-checkout-session";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getReviewUrlFromBranding } from "@/lib/tenants/branding";
import { normalizeTenantSettings } from "@/lib/tenants/settings";

const cancelSchema = z.object({
  bookingId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export async function cancelBookingAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = cancelSchema.safeParse({
    bookingId: formData.get("bookingId"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return { error: "Invalid input" };

  const { tenantId, user } = await requireTenant();
  const result = await cancelBookingForTenant({
    bookingId: parsed.data.bookingId,
    tenantId,
    canceledByUserId: user.id,
    reason: parsed.data.reason ?? null,
  });

  if (!result.ok) return { error: result.error ?? "Failed to cancel booking" };

  revalidatePath(`/admin/bookings/${parsed.data.bookingId}`);
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/calendar");
  if (result.refundedAmountCents && result.refundedAmountCents > 0) {
    return {
      success: `Booking canceled and refunded $${(result.refundedAmountCents / 100).toFixed(2)}`,
    };
  }
  if (result.refundDecision === "blocked_by_policy") {
    return {
      success: `Booking canceled. No refund was issued because it was inside the ${result.cancellationWindowHours ?? 24}-hour cancellation window.`,
    };
  }
  return { success: "Booking canceled" };
}

const rescheduleSchema = z.object({
  bookingId: z.string().uuid(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
});

const statusSchema = z.object({
  bookingId: z.string().uuid(),
});

const completeSchema = z.object({
  bookingId: z.string().uuid(),
  paymentResolution: z
    .enum([
      "none_due",
      "collected_cash",
      "collected_external",
      "already_paid",
      "follow_up",
    ])
    .optional(),
  externalPaidDollars: z.string().optional(),
  tipDollars: z.string().optional(),
  applyWalletBalance: z.string().optional(),
  completionNote: z.string().max(1000).optional(),
});

const balanceCheckoutSchema = z.object({
  bookingId: z.string().uuid(),
  tipDollars: z.string().optional(),
  applyWalletBalance: z.boolean().optional(),
});

const reopenCheckoutSchema = z.object({
  bookingId: z.string().uuid(),
});

export type BookingBalanceCheckoutResult = {
  ok: boolean;
  error?: string;
  url?: string;
};

export type BookingCheckoutCorrectionResult = {
  ok: boolean;
  error?: string;
};

function formatStripeError(error: unknown) {
  if (error instanceof Stripe.errors.StripeError) return error.message;
  if (error instanceof Error) return error.message;
  return "Stripe request failed";
}

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function getRequestAppUrl() {
  const fallbackUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  try {
    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

    if (!host) return fallbackUrl;

    const protocol =
      requestHeaders.get("x-forwarded-proto") ??
      (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");

    return `${protocol}://${host}`;
  } catch {
    return fallbackUrl;
  }
}

export async function resendBookingConfirmationAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = statusSchema.safeParse({
    bookingId: formData.get("bookingId"),
  });
  if (!parsed.success) return { error: "Invalid input" };

  const { tenantId } = await requireTenant();
  const admin = createAdminClient();

  const { data: booking, error } = await admin
    .from("bookings")
    .select(
      `id, tenant_id, status, cancel_token, starts_at, ends_at, confirmation_send_count,
       customers(name, email),
       services(name),
       tenants(name, timezone)`
    )
    .eq("id", parsed.data.bookingId)
    .maybeSingle();

  if (error || !booking || booking.tenant_id !== tenantId) {
    return { error: "Booking not found" };
  }
  if (booking.status !== "confirmed") {
    return { error: "Only confirmed bookings can receive confirmation emails." };
  }

  const customer = normalizeRelation(booking.customers as { name: string; email: string } | null);
  const service = normalizeRelation(booking.services as { name: string } | null);
  const tenant = normalizeRelation(booking.tenants as { name: string; timezone: string } | null);

  if (!customer?.email || !customer.name || !service?.name || !tenant?.name || !tenant.timezone) {
    return { error: "Booking is missing customer or service details needed to send confirmation email." };
  }

  try {
    await sendBookingConfirmationEmail({
      to: customer.email,
      customerName: customer.name,
      tenantName: tenant.name,
      tenantTimeZone: tenant.timezone,
      serviceName: service.name,
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
      cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/cancel/${booking.cancel_token}`,
    });
  } catch (err) {
    await admin
      .from("bookings")
      .update({
        confirmation_requested: true,
        confirmation_delivery_status: "failed",
        confirmation_last_error:
          err instanceof Error ? err.message : "Failed to send confirmation email",
      })
      .eq("id", booking.id);

    return {
      error: err instanceof Error ? err.message : "Failed to send confirmation email",
    };
  }

  await admin
    .from("bookings")
    .update({
      confirmation_requested: true,
      confirmation_delivery_status: "sent",
      confirmation_sent_at: new Date().toISOString(),
      confirmation_send_count: (booking.confirmation_send_count ?? 0) + 1,
      confirmation_last_error: null,
    })
    .eq("id", booking.id);

  revalidatePath(`/admin/bookings/${booking.id}`);
  return { success: `Confirmation email re-sent to ${customer.email}.` };
}

export async function refundBookingPaymentAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = statusSchema.safeParse({
    bookingId: formData.get("bookingId"),
  });
  if (!parsed.success) return { error: "Invalid input" };

  const { tenantId, role } = await requireTenant();
  if (!canManageBookingCheckout(role)) {
    return { error: getManageBookingCheckoutError() };
  }
  const admin = createAdminClient();
  const { data: booking, error } = await admin
    .from("bookings")
    .select(
      "id, tenant_id, customer_id, stripe_payment_intent_id, stripe_refund_id, refunded_amount_cents"
    )
    .eq("id", parsed.data.bookingId)
    .maybeSingle();

  if (error || !booking || booking.tenant_id !== tenantId) {
    return { error: "Booking not found" };
  }
  if (!booking.stripe_payment_intent_id) {
    return { error: "No Stripe payment was captured for this booking." };
  }
  if (booking.stripe_refund_id) {
    const existingAmount =
      booking.refunded_amount_cents && booking.refunded_amount_cents > 0
        ? ` for $${(booking.refunded_amount_cents / 100).toFixed(2)}`
        : "";
    return { success: `This booking has already been refunded${existingAmount}.` };
  }

  let refund: Stripe.Refund;
  try {
    refund = await getStripe().refunds.create(
      {
        payment_intent: booking.stripe_payment_intent_id,
        reason: "requested_by_customer",
        metadata: {
          booking_id: booking.id,
          tenant_id: tenantId,
          refunded_via: "admin_customer_profile",
        },
      },
      { idempotencyKey: `booking-manual-refund-${booking.id}` }
    );
  } catch (stripeError) {
    return { error: formatStripeError(stripeError) };
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from("bookings")
    .update({
      deposit_status: "refunded",
      stripe_refund_id: refund.id,
      refunded_at: now,
      refunded_amount_cents: refund.amount,
    })
    .eq("id", booking.id)
    .is("stripe_refund_id", null)
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    return {
      error:
        updateError?.message ??
        "Stripe refund succeeded but the booking record could not be updated. Reconcile this booking manually.",
    };
  }

  revalidatePath(`/admin/bookings/${booking.id}`);
  revalidatePath("/admin/bookings");
  if (booking.customer_id) {
    revalidatePath(`/admin/customers/${booking.customer_id}`);
  }

  return { success: `Refunded $${(refund.amount / 100).toFixed(2)}.` };
}

export async function openBookingBalanceCheckoutAction(
  input: z.infer<typeof balanceCheckoutSchema>
): Promise<BookingBalanceCheckoutResult> {
  const parsed = balanceCheckoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { tenantId, role } = await requireTenant();
  if (!canManageBookingCheckout(role)) {
    return { ok: false, error: getManageBookingCheckoutError() };
  }
  const admin = createAdminClient();
  const { data: booking, error } = await admin
    .from("bookings")
    .select(
      `id, tenant_id, status, starts_at, price_cents, deposit_cents, deposit_status, refunded_amount_cents,
        customer_id, tip_cents, wallet_applied_cents,
       stripe_customer_id, balance_checkout_stripe_session_id,
       customers(name, email),
       services(name)`
    )
    .eq("id", parsed.data.bookingId)
    .maybeSingle();

  if (error || !booking || booking.tenant_id !== tenantId) {
    return { ok: false, error: "Booking not found" };
  }
  if (booking.status !== "confirmed" && booking.status !== "completed") {
    return { ok: false, error: "Only confirmed or completed bookings can open checkout." };
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("settings_json")
    .eq("id", tenantId)
    .maybeSingle();
  const tenantSettings = normalizeTenantSettings(
    (tenant?.settings_json ?? null) as Partial<Record<string, unknown>> | null
  );
  const taxRatePercent = tenantSettings.tax_rate_percent ?? 0;
  const checkoutSessionMinutes = tenantSettings.payment_link_expiry_minutes;

  const requestedTipCents = parseOptionalDollarsToCents(parsed.data.tipDollars);
  if (requestedTipCents.error) {
    return { ok: false, error: requestedTipCents.error };
  }

  const tipCents = requestedTipCents.cents ?? booking.tip_cents;
  const walletAppliedPreviewBreakdown = calculateBookingPaymentBreakdown({
    priceCents: booking.price_cents,
    depositCents: booking.deposit_cents,
    depositStatus: booking.deposit_status,
    refundedAmountCents: booking.refunded_amount_cents,
    taxRatePercent,
    tipCents,
  });
  const walletAppliedCents = parsed.data.applyWalletBalance && booking.customer_id
    ? Math.min(
        await getCustomerWalletBalanceCents({
          admin,
          tenantId,
          customerId: booking.customer_id,
        }),
        walletAppliedPreviewBreakdown.balanceDueCents
      )
    : booking.wallet_applied_cents;
  const registerBreakdown = calculateBookingPaymentBreakdown({
    priceCents: booking.price_cents,
    depositCents: booking.deposit_cents,
    depositStatus: booking.deposit_status,
    refundedAmountCents: booking.refunded_amount_cents,
    taxRatePercent,
    tipCents,
    walletAppliedCents,
  });
  const remainingBalanceCents = registerBreakdown.balanceDueCents;
  if (remainingBalanceCents <= 0) {
    return { ok: false, error: "No remaining balance is due for this booking." };
  }

  const customer = normalizeRelation(
    booking.customers as { name: string | null; email: string | null } | null
  );
  const service = normalizeRelation(booking.services as { name: string | null } | null);
  const customerEmail = customer?.email ?? null;

  if (!booking.stripe_customer_id && !customerEmail) {
    return {
      ok: false,
      error: "Customer email is required to open hosted checkout for this booking.",
    };
  }

  const appUrl = await getRequestAppUrl();
  const successUrl = `${appUrl}/admin/bookings/${booking.id}?flow=checkout&payment=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${appUrl}/admin/bookings/${booking.id}?flow=checkout&payment=cancel`;

  const stripe = getStripe();
  if (booking.balance_checkout_stripe_session_id) {
    try {
      const existingSession = await stripe.checkout.sessions.retrieve(
        booking.balance_checkout_stripe_session_id
      );

      if (existingSession.status === "complete") {
        return {
          ok: true,
          url: `${appUrl}/admin/bookings/${booking.id}?flow=checkout&payment=success&session_id=${existingSession.id}`,
        };
      }

      if (
        isReusableBookingBalanceCheckoutSession(existingSession, {
          checkoutSessionMinutes,
          amountCents: remainingBalanceCents,
          tipCents,
          walletAppliedCents,
        })
      ) {
        const expiresAt = existingSession.expires_at
          ? new Date(existingSession.expires_at * 1000)
          : getBookingBalanceCheckoutExpiryDate(checkoutSessionMinutes);
        const syncResult = await persistBookingBalanceCheckoutSession({
          admin,
          bookingId: booking.id,
          sessionId: existingSession.id,
          expiresAt,
        });
        if (!syncResult.ok) {
          return { ok: false, error: syncResult.error };
        }

        return { ok: true, url: existingSession.url ?? undefined };
      }

      if (existingSession.status === "open") {
        try {
          await stripe.checkout.sessions.expire(existingSession.id);
        } catch (expireError) {
          return {
            ok: false,
            error:
              expireError instanceof Error
                ? expireError.message
                : "The previous balance checkout is still active and could not be refreshed yet.",
          };
        }
      }
    } catch {
      // Fall through and create a fresh hosted checkout session.
    }
  }

  const checkoutExpiresAt = getBookingBalanceCheckoutExpiryDate(checkoutSessionMinutes);

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      expires_at: Math.floor(checkoutExpiresAt.getTime() / 1000),
      ...(booking.stripe_customer_id
        ? { customer: booking.stripe_customer_id }
        : { customer_email: customerEmail ?? undefined }),
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${service?.name ?? "Appointment"} balance`,
              description: buildBalanceCheckoutDescription({
                startsAt: booking.starts_at,
                taxRatePercent,
                tipCents,
                walletAppliedCents,
              }),
            },
            unit_amount: remainingBalanceCents,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        kind: "booking_balance_checkout",
        booking_id: booking.id,
        tenant_id: tenantId,
        tip_cents: String(tipCents),
        wallet_applied_cents: String(walletAppliedCents),
      },
    });
  } catch (stripeError) {
    return { ok: false, error: formatStripeError(stripeError) };
  }

  if (!session.url) {
    return { ok: false, error: "Failed to open checkout." };
  }

  const syncResult = await persistBookingBalanceCheckoutSession({
    admin,
    bookingId: booking.id,
    sessionId: session.id,
    expiresAt: checkoutExpiresAt,
  });
  if (!syncResult.ok) {
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch {
      // Best effort cleanup only.
    }

    return { ok: false, error: syncResult.error };
  }

  revalidatePath(`/admin/bookings/${booking.id}`);
  revalidatePath("/admin/payments");
  return { ok: true, url: session.url };
}

export async function reopenBookingCheckoutAction(
  input: z.infer<typeof reopenCheckoutSchema>
): Promise<BookingCheckoutCorrectionResult> {
  const parsed = reopenCheckoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { tenantId, role, user } = await requireTenant();
  if (!canManageBookingCheckout(role)) {
    return { ok: false, error: getManageBookingCheckoutError() };
  }

  const admin = createAdminClient();
  const { data: booking, error } = await admin
    .from("bookings")
    .select(
      "id, tenant_id, status, customer_id, deposit_cents, deposit_status, tip_cents, wallet_applied_cents, checkout_record_json, notes"
    )
    .eq("id", parsed.data.bookingId)
    .maybeSingle();

  if (error || !booking || booking.tenant_id !== tenantId) {
    return { ok: false, error: "Booking not found" };
  }

  if (booking.status !== "completed") {
    return { ok: false, error: "Only completed bookings can reopen checkout." };
  }

  const latestCheckoutEvent = readBookingCheckoutRecord(booking.checkout_record_json).latest_event;
  if (!latestCheckoutEvent) {
    return { ok: false, error: "No completed checkout record was found for this booking." };
  }

  const walletAppliedCents = Math.max(
    booking.wallet_applied_cents ?? latestCheckoutEvent.wallet_applied_cents ?? 0,
    0
  );
  if (walletAppliedCents > 0 && !booking.customer_id) {
    return {
      ok: false,
      error: "This booking is missing a customer record needed to return guest wallet credit.",
    };
  }

  const correctionNote = formatCheckoutCorrectionNote({
    eventKind: latestCheckoutEvent.kind,
    paymentResolution: latestCheckoutEvent.payment_resolution,
    tipCents: Math.max(booking.tip_cents ?? latestCheckoutEvent.tip_cents ?? 0, 0),
    walletAppliedCents,
  });

  if (latestCheckoutEvent.kind === "stripe_balance_checkout") {
    if (!latestCheckoutEvent.stripe_payment_intent_id) {
      return {
        ok: false,
        error: "Missing Stripe payment intent for this balance checkout correction.",
      };
    }

    try {
      await getStripe().refunds.create(
        {
          payment_intent: latestCheckoutEvent.stripe_payment_intent_id,
          amount: Math.max(latestCheckoutEvent.amount_recorded_cents, 0),
          reason: "requested_by_customer",
          metadata: {
            booking_id: booking.id,
            tenant_id: tenantId,
            refunded_via: "booking_checkout_correction",
          },
        },
        {
          idempotencyKey: `booking-checkout-correction-refund-${booking.id}-${latestCheckoutEvent.at}`,
        }
      );
    } catch (stripeError) {
      return {
        ok: false,
        error: formatStripeError(stripeError),
      };
    }
  }

  let walletLedgerEntryId: string | null = null;
  if (walletAppliedCents > 0 && booking.customer_id) {
    try {
      walletLedgerEntryId = await appendCustomerWalletLedgerEntry({
        admin,
        tenantId,
        customerId: booking.customer_id,
        bookingId: booking.id,
        amountCents: walletAppliedCents,
        reason: "manual_credit",
        note: correctionNote,
        createdByUserId: user.id,
      });
    } catch (walletError) {
      return {
        ok: false,
        error:
          walletError instanceof Error
            ? walletError.message
            : "Failed to return guest wallet credit.",
      };
    }
  }

  const { error: updateError } = await admin
    .from("bookings")
    .update({
      status: "confirmed",
      completed_at: null,
      deposit_status: getDepositStatusAfterCheckoutReopen({
        depositStatus: booking.deposit_status,
        depositCents: booking.deposit_cents,
      }),
      balance_checkout_stripe_session_id: null,
      balance_checkout_session_expires_at: null,
      tip_cents: 0,
      wallet_applied_cents: 0,
      checkout_record_json: createEmptyCheckoutRecord(),
      notes: mergeCompletionNotes(booking.notes, correctionNote),
    })
    .eq("id", booking.id);

  if (updateError) {
    if (walletLedgerEntryId) {
      await admin.from("customer_wallet_ledger").delete().eq("id", walletLedgerEntryId);
    }

    return { ok: false, error: updateError.message };
  }

  revalidatePath(`/admin/bookings/${booking.id}`);
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/calendar");
  revalidatePath("/admin/payments");
  revalidatePath("/admin");

  if (booking.customer_id) {
    revalidatePath(`/admin/customers/${booking.customer_id}`);
  }

  return { ok: true };
}

async function updateBookingStatus(input: {
  bookingId: string;
  nextStatus: "completed" | "no_show";
}): Promise<ActionState> {
  const { tenantId, role } = await requireTenant();
  if (!canManageBookingCheckout(role)) {
    return { error: getManageBookingCheckoutError() };
  }
  const admin = createAdminClient();

  const { data: booking } = await admin
    .from("bookings")
    .select("id, tenant_id, status, stripe_customer_id, no_show_fee_payment_method_id")
    .eq("id", input.bookingId)
    .maybeSingle();

  if (!booking || booking.tenant_id !== tenantId) return { error: "Booking not found" };
  if (booking.status !== "confirmed") {
    return { error: "Only confirmed bookings can be updated this way" };
  }

  if (input.nextStatus === "completed") {
    const { error } = await admin
      .from("bookings")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", booking.id);
    if (error) return { error: error.message };

    revalidatePath(`/admin/bookings/${booking.id}`);
    revalidatePath("/admin/bookings");
    revalidatePath("/admin/calendar");
    return { success: "Booking marked completed" };
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("settings_json")
    .eq("id", tenantId)
    .maybeSingle();
  const tenantSettings = normalizeTenantSettings(
    (tenant?.settings_json ?? null) as Partial<Record<string, unknown>> | null
  );
  const recordedNoShowFeeCents = tenantSettings.no_show_fee_cents;
  const shouldAutoCharge = tenantSettings.auto_charge_no_show_fee && recordedNoShowFeeCents > 0;

  let noShowChargeMessage: string | null = null;
  let chargeError: string | null = null;
  let chargeResult:
    | {
        paymentIntentId: string;
        chargedAt: string;
      }
    | null = null;

  if (shouldAutoCharge) {
    if (!booking.stripe_customer_id || !booking.no_show_fee_payment_method_id) {
      chargeError = "No saved payment method is available for automatic no-show charging.";
    } else {
      try {
        const paymentIntent = await getStripe().paymentIntents.create(
          {
            amount: recordedNoShowFeeCents,
            currency: "usd",
            customer: booking.stripe_customer_id,
            payment_method: booking.no_show_fee_payment_method_id,
            confirm: true,
            off_session: true,
            metadata: {
              booking_id: booking.id,
              tenant_id: tenantId,
              kind: "no_show_fee",
            },
          },
          { idempotencyKey: `booking-no-show-fee-${booking.id}` }
        );
        chargeResult = {
          paymentIntentId: paymentIntent.id,
          chargedAt: new Date().toISOString(),
        };
      } catch (error) {
        chargeError =
          error instanceof Stripe.errors.StripeError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Automatic no-show charge failed";
      }
    }
  }

  const { error } = await admin
    .from("bookings")
    .update({
      status: "no_show",
      assessed_no_show_fee_cents: recordedNoShowFeeCents,
      no_show_fee_payment_intent_id: chargeResult?.paymentIntentId ?? null,
      no_show_fee_charged_at: chargeResult?.chargedAt ?? null,
      no_show_fee_charge_error: chargeError,
    })
    .eq("id", booking.id);
  if (error) {
    return {
      error:
        chargeResult?.paymentIntentId
          ? "No-show fee was charged in Stripe but the booking could not be updated. Reconcile this booking manually."
          : error.message,
    };
  }

  revalidatePath(`/admin/bookings/${booking.id}`);
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/calendar");

  if (chargeResult) {
    noShowChargeMessage = `Charged $${(recordedNoShowFeeCents / 100).toFixed(2)} to the saved card.`;
  } else if (shouldAutoCharge && chargeError) {
    noShowChargeMessage = `Auto-charge skipped: ${chargeError}`;
  } else if (recordedNoShowFeeCents > 0) {
    noShowChargeMessage = `Recorded $${(recordedNoShowFeeCents / 100).toFixed(2)} no-show fee for manual follow-up.`;
  }

  return {
    success: noShowChargeMessage ? `Booking marked no-show. ${noShowChargeMessage}` : "Booking marked no-show",
  };
}

export async function markBookingCompletedAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = completeSchema.safeParse({
    bookingId: formData.get("bookingId"),
    paymentResolution: (formData.get("paymentResolution") ?? undefined) as
      | "none_due"
      | "collected_cash"
      | "collected_external"
      | "already_paid"
      | "follow_up"
      | undefined,
    externalPaidDollars: (formData.get("externalPaidDollars") ?? undefined) as
      | string
      | undefined,
    tipDollars: (formData.get("tipDollars") ?? undefined) as string | undefined,
    applyWalletBalance: (formData.get("applyWalletBalance") ?? undefined) as string | undefined,
    completionNote: (formData.get("completionNote") ?? undefined) as string | undefined,
  });
  if (!parsed.success) return { error: "Invalid input" };

  const { tenantId, user, role } = await requireTenant();
  if (!canManageBookingCheckout(role)) {
    return { error: getManageBookingCheckoutError() };
  }
  const admin = createAdminClient();

  const { data: booking } = await admin
    .from("bookings")
    .select(
      `id, tenant_id, status, starts_at, ends_at, cancel_token,
       customer_id, price_cents, deposit_cents, deposit_status, refunded_amount_cents, tip_cents, wallet_applied_cents, notes, checkout_record_json,
       customers(name, email),
       services(name),
       tenants(name, timezone, branding_json)`
    )
    .eq("id", parsed.data.bookingId)
    .maybeSingle();

  if (!booking || booking.tenant_id !== tenantId) {
    return { error: "Booking not found" };
  }
  if (booking.status !== "confirmed") {
    return { error: "Only confirmed bookings can be marked completed" };
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("settings_json")
    .eq("id", tenantId)
    .maybeSingle();
  const taxRatePercent = normalizeTenantSettings(
    (tenant?.settings_json ?? null) as Partial<Record<string, unknown>> | null
  ).tax_rate_percent ?? 0;

  const paymentResolution = parsed.data.paymentResolution ?? "follow_up";
  const completionNote = parsed.data.completionNote?.trim() || null;
  const requestedTipCents = parseOptionalDollarsToCents(parsed.data.tipDollars);
  if (requestedTipCents.error) {
    return { error: requestedTipCents.error };
  }

  const tipCents = requestedTipCents.cents ?? booking.tip_cents;
  const walletPreviewBreakdown = calculateBookingPaymentBreakdown({
    priceCents: booking.price_cents,
    depositCents: booking.deposit_cents,
    depositStatus: booking.deposit_status,
    refundedAmountCents: booking.refunded_amount_cents,
    taxRatePercent,
    tipCents,
  });
  const walletAppliedCents =
    parsed.data.applyWalletBalance === "true" && booking.customer_id
      ? Math.min(
          await getCustomerWalletBalanceCents({
            admin,
            tenantId,
            customerId: booking.customer_id,
          }),
          walletPreviewBreakdown.balanceDueCents
        )
      : booking.wallet_applied_cents;
  const paymentBreakdown = calculateBookingPaymentBreakdown({
    priceCents: booking.price_cents,
    depositCents: booking.deposit_cents,
    depositStatus: booking.deposit_status,
    refundedAmountCents: booking.refunded_amount_cents,
    taxRatePercent,
    tipCents,
    walletAppliedCents,
  });
  const estimatedBalanceDue = paymentBreakdown.balanceDueCents;
  const externalPaidCents = parseDollarAmountToCents(parsed.data.externalPaidDollars);

  if (paymentResolution === "none_due" && estimatedBalanceDue > 0) {
    return {
      error: "This booking still has an outstanding balance. Choose how payment was handled.",
    };
  }
  const externalPosValidation = validateExternalPosCollection({
    paymentResolution,
    balanceDueCents: estimatedBalanceDue,
    externalPaidCents,
  });
  if (externalPosValidation === "Enter the exact amount collected on the external POS terminal.") {
    return { error: externalPosValidation };
  }
  if (externalPosValidation && externalPosValidation.kind === "underpaid") {
    return {
      error: `External payment (${formatDollars(externalPosValidation.externalPaidCents)}) is less than amount owing (${formatDollars(externalPosValidation.balanceDueCents)}).`,
    };
  }

  const effectivePaymentResolution =
    estimatedBalanceDue <= 0 ? "none_due" : paymentResolution;

  const shouldMarkPaidInFull =
    effectivePaymentResolution === "none_due" ||
    effectivePaymentResolution === "collected_cash" ||
    effectivePaymentResolution === "collected_external" ||
    effectivePaymentResolution === "already_paid";

  const amountRecordedNowCents =
    effectivePaymentResolution === "collected_external"
      ? externalPaidCents ?? estimatedBalanceDue
      : effectivePaymentResolution === "collected_cash" || effectivePaymentResolution === "already_paid"
        ? estimatedBalanceDue
        : 0;
  const paymentOutcomeLabel = formatPaymentOutcomeLabel({
    paymentResolution: effectivePaymentResolution,
    walletAppliedCents,
  });
  const amountRecordedTotalCents = amountRecordedNowCents + walletAppliedCents;
  const completedAt = new Date().toISOString();
  const checkoutRecord = appendBookingCheckoutEvent(booking.checkout_record_json, {
    kind: "admin_completion",
    at: completedAt,
    payment_resolution: effectivePaymentResolution,
    payment_outcome_label: paymentOutcomeLabel,
    subtotal_cents: paymentBreakdown.subtotalCents,
    tax_rate_percent: taxRatePercent,
    tax_cents: paymentBreakdown.taxCents,
    total_with_tax_cents: paymentBreakdown.totalWithTaxCents,
    tip_cents: tipCents,
    wallet_applied_cents: walletAppliedCents,
    amount_owing_at_checkout_cents: estimatedBalanceDue,
    amount_recorded_cents: amountRecordedTotalCents,
    external_paid_cents:
      effectivePaymentResolution === "collected_external" ? externalPaidCents : null,
    actor_user_id: user.id,
    note: completionNote,
  });

  const completionMeta = formatCompletionMeta({
    paymentResolution: effectivePaymentResolution,
    estimatedBalanceDue,
    subtotalCents: paymentBreakdown.subtotalCents,
    taxCents: paymentBreakdown.taxCents,
    totalWithTaxCents: paymentBreakdown.totalWithTaxCents,
    tipCents,
    walletAppliedCents,
    taxRatePercent,
    externalPaidCents,
    completionNote,
  });
  const notes = mergeCompletionNotes(booking.notes, completionMeta);

  let walletLedgerEntryId: string | null = null;
  if (walletAppliedCents > 0 && booking.customer_id) {
    try {
      walletLedgerEntryId = await appendCustomerWalletLedgerEntry({
        admin,
        tenantId,
        customerId: booking.customer_id,
        bookingId: booking.id,
        amountCents: -walletAppliedCents,
        reason: "checkout_applied",
        note: `Applied during appointment checkout${tipCents > 0 ? ` with ${formatDollars(tipCents)} tip` : ""}`,
        createdByUserId: user.id,
      });
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Failed to apply guest wallet balance.",
      };
    }
  }

  const { error } = await admin
    .from("bookings")
    .update({
      status: "completed",
      completed_at: completedAt,
      ...(shouldMarkPaidInFull ? { deposit_status: "paid_in_full" } : {}),
      tip_cents: tipCents,
      wallet_applied_cents: walletAppliedCents,
      checkout_record_json: checkoutRecord,
      notes,
    })
    .eq("id", booking.id);
  if (error) {
    if (walletLedgerEntryId) {
      await admin.from("customer_wallet_ledger").delete().eq("id", walletLedgerEntryId);
    }
    return { error: error.message };
  }

  revalidatePath(`/admin/bookings/${booking.id}`);
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/calendar");

  const customer = normalizeRelation(
    booking.customers as { name: string | null; email: string | null } | null
  );
  const service = normalizeRelation(booking.services as { name: string | null } | null);
  const tenantRecord = normalizeRelation(
    booking.tenants as {
      name: string | null;
      timezone: string | null;
      branding_json: Partial<Record<string, unknown>> | null;
    } | null
  );

  let completionEmailStatus: string | null = null;
  if (
    customer?.email &&
    customer.name &&
    service?.name &&
    tenantRecord?.name &&
    tenantRecord.timezone
  ) {
    try {
      await sendBookingCompletionEmail({
        to: customer.email,
        customerName: customer.name,
        tenantName: tenantRecord.name,
        tenantTimeZone: tenantRecord.timezone,
        serviceName: service.name,
        startsAt: booking.starts_at,
        endsAt: booking.ends_at,
        subtotalCents: paymentBreakdown.subtotalCents,
        taxCents: paymentBreakdown.taxCents,
        totalWithTaxCents: paymentBreakdown.totalWithTaxCents,
        tipCents,
        walletAppliedCents,
        paymentOutcomeLabel,
        amountOwingAtCheckoutCents: estimatedBalanceDue,
        amountRecordedCents: amountRecordedTotalCents,
        reviewUrl: getReviewUrlFromBranding(tenantRecord.branding_json),
        manageUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/cancel/${booking.cancel_token}`,
      });
      completionEmailStatus = ` Completion receipt sent to ${customer.email}.`;
    } catch (error) {
      completionEmailStatus = ` Completion email could not be sent: ${error instanceof Error ? error.message : "Unknown error"}.`;
    }
  }

  if (shouldMarkPaidInFull) {
    return {
      success:
        effectivePaymentResolution === "collected_external" && externalPaidCents !== null
          ? `Booking completed and marked paid in full (${formatDollars(externalPaidCents)} recorded from external POS${walletAppliedCents > 0 ? `, ${formatDollars(walletAppliedCents)} applied from guest wallet` : ""}).${completionEmailStatus ?? ""}`
          : estimatedBalanceDue > 0
          ? `Booking completed and marked paid in full (${formatDollars(estimatedBalanceDue)} collected${walletAppliedCents > 0 ? ` after ${formatDollars(walletAppliedCents)} guest wallet credit` : ""}).${completionEmailStatus ?? ""}`
          : walletAppliedCents > 0
            ? `Booking completed and marked paid in full (${formatDollars(walletAppliedCents)} applied from guest wallet).${completionEmailStatus ?? ""}`
            : `Booking completed and marked paid in full.${completionEmailStatus ?? ""}`,
    };
  }

  if (estimatedBalanceDue > 0 && paymentResolution === "follow_up") {
    return {
      success: `Booking marked completed. Outstanding balance ${formatDollars(estimatedBalanceDue)} flagged for follow-up${walletAppliedCents > 0 ? ` after ${formatDollars(walletAppliedCents)} guest wallet credit` : ""}.${completionEmailStatus ?? ""}`,
    };
  }

  return { success: `Booking marked completed${completionEmailStatus ?? ""}` };
}

export async function markBookingNoShowAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = statusSchema.safeParse({
    bookingId: formData.get("bookingId"),
  });
  if (!parsed.success) return { error: "Invalid input" };
  return updateBookingStatus({ bookingId: parsed.data.bookingId, nextStatus: "no_show" });
}

export async function rescheduleBookingAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = rescheduleSchema.safeParse({
    bookingId: formData.get("bookingId"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
  });
  if (!parsed.success) return { error: "Invalid input" };

  const startsAt = new Date(parsed.data.startsAt);
  const endsAt = new Date(parsed.data.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { error: "Invalid date" };
  }
  if (startsAt >= endsAt) return { error: "End must be after start" };

  const { tenantId } = await requireTenant();
  const admin = createAdminClient();

  const { data: booking } = await admin
    .from("bookings")
    .select("id, tenant_id, provider_id, status")
    .eq("id", parsed.data.bookingId)
    .maybeSingle();

  if (!booking || booking.tenant_id !== tenantId) return { error: "Booking not found" };
  if (booking.status !== "confirmed") return { error: "Only confirmed bookings can be rescheduled" };

  // Conflict check: rely on the existing assert_no_booking_conflict trigger but also
  // block manually so we can give a clean error.
  const { data: conflicts } = await admin
    .from("bookings")
    .select("id")
    .eq("provider_id", booking.provider_id)
    .eq("status", "confirmed")
    .neq("id", booking.id)
    .lt("starts_at", endsAt.toISOString())
    .gt("ends_at", startsAt.toISOString());

  if (conflicts && conflicts.length > 0) {
    return { error: "That time conflicts with another booking for this provider." };
  }

  const { error } = await admin
    .from("bookings")
    .update({
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .eq("id", booking.id);

  if (error) return { error: error.message };

  revalidatePath(`/admin/bookings/${booking.id}`);
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/calendar");
  return { success: "Booking rescheduled" };
}

function formatDollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatCompletionMeta(input: {
  paymentResolution: "none_due" | "collected_cash" | "collected_external" | "already_paid" | "follow_up";
  estimatedBalanceDue: number;
  subtotalCents: number;
  taxCents: number;
  totalWithTaxCents: number;
  tipCents: number;
  walletAppliedCents: number;
  taxRatePercent: number;
  externalPaidCents: number | null;
  completionNote: string | null;
}) {
  const outcome =
    input.paymentResolution === "none_due"
      ? "no_balance_due"
      : input.paymentResolution === "collected_cash"
        ? "collected_cash"
        : input.paymentResolution === "collected_external"
          ? "collected_external"
          : input.paymentResolution === "already_paid"
            ? "already_paid"
            : "follow_up";

  let line = `Completion checkout: ${outcome}`;
  line += ` | subtotal ${formatDollars(input.subtotalCents)}, tax ${formatDollars(input.taxCents)} (${input.taxRatePercent.toFixed(2)}%), total ${formatDollars(input.totalWithTaxCents)}`;
  if (input.tipCents > 0) {
    line += `, tip ${formatDollars(input.tipCents)}`;
  }
  if (input.walletAppliedCents > 0) {
    line += `, wallet applied ${formatDollars(input.walletAppliedCents)}`;
  }
  if (input.estimatedBalanceDue > 0) {
    line += `, amount owing ${formatDollars(input.estimatedBalanceDue)}`;
  }
  if (input.paymentResolution === "collected_external" && input.externalPaidCents !== null) {
    line += `, external POS paid ${formatDollars(input.externalPaidCents)}`;
  }
  if (input.completionNote) {
    line += `. Note: ${input.completionNote}`;
  }
  return line;
}

function mergeCompletionNotes(existing: string | null, completionMeta: string) {
  if (!existing || existing.trim().length === 0) {
    return completionMeta;
  }
  return `${existing}\n${completionMeta}`;
}

function createEmptyCheckoutRecord() {
  return {
    version: 1 as const,
    events: [],
    latest_event: null,
  };
}

function getDepositStatusAfterCheckoutReopen(input: {
  depositStatus: string | null;
  depositCents: number;
}) {
  if (input.depositStatus !== "paid_in_full") {
    return input.depositStatus;
  }

  return input.depositCents > 0 ? "deposit_paid" : "unpaid";
}

function formatCheckoutCorrectionNote(input: {
  eventKind: BookingCheckoutEvent["kind"];
  paymentResolution: string;
  tipCents: number;
  walletAppliedCents: number;
}) {
  const adjustments: string[] = [];

  if (input.tipCents > 0) {
    adjustments.push(`cleared tip ${formatDollars(input.tipCents)}`);
  }

  if (input.walletAppliedCents > 0) {
    adjustments.push(`returned ${formatDollars(input.walletAppliedCents)} to guest wallet`);
  }

  let note = "Checkout reopened for correction";
  if (adjustments.length > 0) {
    note += ` (${adjustments.join(", ")})`;
  }

  if (input.eventKind === "stripe_balance_checkout") {
    note += ". Refunded the latest Stripe balance checkout before reopening.";
  }

  if (
    input.paymentResolution === "collected_cash" ||
    input.paymentResolution === "collected_external" ||
    input.paymentResolution === "already_paid"
  ) {
    note += ". Any cash, external POS, or outside payment already taken must be reconciled outside the app.";
  }

  return note;
}

function parseOptionalDollarsToCents(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return { cents: null, error: null };
  }

  const cents = parseDollarAmountToCents(trimmed);
  if (cents === null) {
    return { cents: null, error: "Enter a valid dollar amount." };
  }

  return { cents, error: null };
}

function formatPaymentOutcomeLabel(input: {
  paymentResolution: "none_due" | "collected_cash" | "collected_external" | "already_paid" | "follow_up";
  walletAppliedCents: number;
}) {
  const baseLabel =
    input.paymentResolution === "none_due"
      ? "No balance due"
      : input.paymentResolution === "collected_cash"
        ? "Collected now (cash)"
        : input.paymentResolution === "collected_external"
          ? "Collected now (external terminal)"
          : input.paymentResolution === "already_paid"
            ? "Already paid outside this flow"
            : "Follow-up required";

  if (input.walletAppliedCents <= 0) {
    return baseLabel;
  }

  if (input.paymentResolution === "none_due") {
    return "Applied guest wallet balance";
  }

  return `Applied guest wallet balance + ${baseLabel}`;
}

function buildBalanceCheckoutDescription(input: {
  startsAt: string;
  taxRatePercent: number;
  tipCents: number;
  walletAppliedCents: number;
}) {
  const details = [`incl. ${input.taxRatePercent.toFixed(2)}% tax`];
  if (input.tipCents > 0) {
    details.push(`${formatDollars(input.tipCents)} tip`);
  }
  if (input.walletAppliedCents > 0) {
    details.push(`${formatDollars(input.walletAppliedCents)} guest wallet applied`);
  }

  return `Remaining balance (${details.join(", ")}) for appointment on ${new Date(input.startsAt).toLocaleString()}`;
}
