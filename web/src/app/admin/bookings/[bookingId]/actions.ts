"use server";

import Stripe from "stripe";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/admin/require-tenant";
import type { ActionState } from "@/lib/admin/action-state";
import { cancelBookingForTenant } from "@/lib/bookings/cancel";
import { sendBookingConfirmationEmail } from "@/lib/emails/booking-confirmation";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
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

function formatStripeError(error: unknown) {
  if (error instanceof Stripe.errors.StripeError) return error.message;
  if (error instanceof Error) return error.message;
  return "Stripe request failed";
}

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
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
      `id, tenant_id, status, cancel_token, starts_at, ends_at,
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
    return {
      error: err instanceof Error ? err.message : "Failed to send confirmation email",
    };
  }

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

  const { tenantId } = await requireTenant();
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

async function updateBookingStatus(input: {
  bookingId: string;
  nextStatus: "completed" | "no_show";
}): Promise<ActionState> {
  const { tenantId } = await requireTenant();
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
  const parsed = statusSchema.safeParse({
    bookingId: formData.get("bookingId"),
  });
  if (!parsed.success) return { error: "Invalid input" };
  return updateBookingStatus({ bookingId: parsed.data.bookingId, nextStatus: "completed" });
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
