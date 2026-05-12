import "server-only";

import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import {
  isInsideCancellationWindow,
  normalizeTenantSettings,
} from "@/lib/tenants/settings";

type CancelableBookingRow = {
  id: string;
  tenant_id: string;
  status: "confirmed" | "completed" | "canceled" | "no_show";
  starts_at: string;
  ends_at: string;
  stripe_payment_intent_id: string | null;
  stripe_refund_id: string | null;
  refunded_at: string | null;
  refunded_amount_cents: number | null;
  canceled_at: string | null;
};

export type CancelBookingResult = {
  ok: boolean;
  error?: string;
  bookingId?: string;
  refundedAmountCents?: number;
  refundDecision?: "refunded" | "not_charged" | "blocked_by_policy";
  cancellationWindowHours?: number;
  insideCancellationWindow?: boolean;
};

export type PublicCancelableBooking = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantTimeZone: string;
  serviceName: string;
  providerName: string | null;
  customerName: string | null;
  startsAt: string;
  endsAt: string;
  status: CancelableBookingRow["status"];
  canceledAt: string | null;
  cancelReason: string | null;
  refundedAt: string | null;
  refundedAmountCents: number | null;
  cancellationWindowHours: number;
  refundInsideWindow: boolean;
  insideCancellationWindow: boolean;
  canceledInsideCancellationWindow: boolean;
};

type CancelInternalOptions = {
  booking: CancelableBookingRow;
  reason?: string | null;
  canceledByUserId?: string | null;
  source: "admin" | "customer";
};

const CANCEL_BOOKING_SELECT =
  "id, tenant_id, status, starts_at, ends_at, stripe_payment_intent_id, stripe_refund_id, refunded_at, refunded_amount_cents, canceled_at";

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function formatStripeError(err: unknown): string {
  if (err instanceof Stripe.errors.StripeError) return err.message;
  if (err instanceof Error) return err.message;
  return "Failed to cancel booking";
}

async function issueRefundIfNeeded(
  booking: CancelableBookingRow,
  source: CancelInternalOptions["source"],
  policy: { insideCancellationWindow: boolean; refundInsideWindow: boolean }
): Promise<{
  refund: { refundId: string; refundedAmountCents: number } | null;
  decision: "refunded" | "not_charged" | "blocked_by_policy";
}> {
  if (!booking.stripe_payment_intent_id || booking.stripe_refund_id) {
    return {
      refund:
        booking.stripe_refund_id && booking.refunded_amount_cents
          ? {
              refundId: booking.stripe_refund_id,
              refundedAmountCents: booking.refunded_amount_cents,
            }
          : null,
      decision:
        booking.stripe_refund_id && booking.refunded_amount_cents ? "refunded" : "not_charged",
    };
  }

  if (policy.insideCancellationWindow && !policy.refundInsideWindow) {
    return { refund: null, decision: "blocked_by_policy" };
  }

  const refund = await getStripe().refunds.create(
    {
      payment_intent: booking.stripe_payment_intent_id,
      reason: "requested_by_customer",
      metadata: {
        booking_id: booking.id,
        tenant_id: booking.tenant_id,
        canceled_via: source,
      },
    },
    { idempotencyKey: `booking-cancel-${booking.id}` }
  );

  return {
    refund: {
      refundId: refund.id,
      refundedAmountCents: refund.amount,
    },
    decision: "refunded",
  };
}

async function cancelBookingInternal(options: CancelInternalOptions): Promise<CancelBookingResult> {
  const { booking, canceledByUserId, source } = options;
  const reason = options.reason?.trim() || null;
  const admin = createAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("settings_json")
    .eq("id", booking.tenant_id)
    .maybeSingle();
  const settings = normalizeTenantSettings(
    (tenant?.settings_json ?? null) as Partial<Record<string, unknown>> | null
  );
  const insideCancellationWindow = isInsideCancellationWindow(
    booking.starts_at,
    settings.cancellation_window_hours,
    new Date()
  );

  if (booking.status === "canceled") {
    return { ok: false, error: "Booking is already canceled", bookingId: booking.id };
  }
  if (booking.status !== "confirmed") {
    return { ok: false, error: "Only confirmed bookings can be canceled", bookingId: booking.id };
  }

  let refund: { refundId: string; refundedAmountCents: number } | null = null;
  let refundDecision: "refunded" | "not_charged" | "blocked_by_policy" = "not_charged";
  try {
    const refundResult = await issueRefundIfNeeded(booking, source, {
      insideCancellationWindow,
      refundInsideWindow: settings.refund_inside_window,
    });
    refund = refundResult.refund;
    refundDecision = refundResult.decision;
  } catch (err) {
    return {
      ok: false,
      error: formatStripeError(err),
      bookingId: booking.id,
      cancellationWindowHours: settings.cancellation_window_hours,
      insideCancellationWindow,
    };
  }

  const now = new Date().toISOString();
  const fallbackReason = source === "customer" ? "Customer canceled via secure link" : null;
  const updatePayload: {
    status: "canceled";
    canceled_at: string;
    canceled_by_user_id: string | null;
    cancel_reason: string | null;
    stripe_refund_id?: string;
    refunded_at?: string;
    refunded_amount_cents?: number;
  } = {
    status: "canceled",
    canceled_at: now,
    canceled_by_user_id: canceledByUserId ?? null,
    cancel_reason: reason ?? fallbackReason,
  };

  if (refund) {
    updatePayload.stripe_refund_id = refund.refundId;
    updatePayload.refunded_at = now;
    updatePayload.refunded_amount_cents = refund.refundedAmountCents;
  }

  const { data: updated, error } = await admin
    .from("bookings")
    .update(updatePayload)
    .eq("id", booking.id)
    .eq("status", "confirmed")
    .select("id")
    .maybeSingle();

  if (error || !updated) {
    return {
      ok: false,
      error:
        error?.message ??
        "Stripe refund succeeded but the booking record could not be updated. Reconcile this booking manually.",
      bookingId: booking.id,
    };
  }

  return {
    ok: true,
    bookingId: booking.id,
    refundedAmountCents: refund?.refundedAmountCents,
    refundDecision,
    cancellationWindowHours: settings.cancellation_window_hours,
    insideCancellationWindow,
  };
}

export async function cancelBookingForTenant(input: {
  bookingId: string;
  tenantId: string;
  canceledByUserId?: string | null;
  reason?: string | null;
}): Promise<CancelBookingResult> {
  const admin = createAdminClient();
  const { data: booking, error } = await admin
    .from("bookings")
    .select(CANCEL_BOOKING_SELECT)
    .eq("id", input.bookingId)
    .maybeSingle<CancelableBookingRow>();

  if (error || !booking || booking.tenant_id !== input.tenantId) {
    return { ok: false, error: "Booking not found" };
  }

  return cancelBookingInternal({
    booking,
    reason: input.reason,
    canceledByUserId: input.canceledByUserId ?? null,
    source: "admin",
  });
}

export async function cancelBookingByToken(input: {
  cancelToken: string;
  reason?: string | null;
}): Promise<CancelBookingResult> {
  const admin = createAdminClient();
  const { data: booking, error } = await admin
    .from("bookings")
    .select(CANCEL_BOOKING_SELECT)
    .eq("cancel_token", input.cancelToken)
    .maybeSingle<CancelableBookingRow>();

  if (error || !booking) {
    return { ok: false, error: "Booking not found" };
  }

  return cancelBookingInternal({
    booking,
    reason: input.reason,
    source: "customer",
  });
}

export async function getBookingByCancelToken(
  cancelToken: string
): Promise<PublicCancelableBooking | null> {
  const admin = createAdminClient();
  const { data: booking, error } = await admin
    .from("bookings")
    .select(
      `id, tenant_id, status, starts_at, ends_at, canceled_at, cancel_reason,
       refunded_at, refunded_amount_cents,
       tenants(name, slug, timezone, settings_json),
       services(name),
       providers(name),
       customers(name)`
    )
    .eq("cancel_token", cancelToken)
    .maybeSingle();

  if (error || !booking) return null;

  const tenant = normalizeRelation(
    booking.tenants as {
      name: string;
      slug: string;
      timezone: string;
      settings_json: Partial<Record<string, unknown>> | null;
    } | null
  );
  const service = normalizeRelation(booking.services as { name: string } | null);
  const provider = normalizeRelation(booking.providers as { name: string } | null);
  const customer = normalizeRelation(booking.customers as { name: string } | null);

  if (!tenant || !service) return null;

  const settings = normalizeTenantSettings(tenant.settings_json);
  const insideCancellationWindow = isInsideCancellationWindow(
    booking.starts_at,
    settings.cancellation_window_hours,
    new Date()
  );
  const canceledInsideCancellationWindow = booking.canceled_at
    ? isInsideCancellationWindow(
        booking.starts_at,
        settings.cancellation_window_hours,
        booking.canceled_at
      )
    : false;

  return {
    id: booking.id,
    tenantId: booking.tenant_id,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    tenantTimeZone: tenant.timezone,
    serviceName: service.name,
    providerName: provider?.name ?? null,
    customerName: customer?.name ?? null,
    startsAt: booking.starts_at,
    endsAt: booking.ends_at,
    status: booking.status,
    canceledAt: booking.canceled_at,
    cancelReason: booking.cancel_reason,
    refundedAt: booking.refunded_at,
    refundedAmountCents: booking.refunded_amount_cents,
    cancellationWindowHours: settings.cancellation_window_hours,
    refundInsideWindow: settings.refund_inside_window,
    insideCancellationWindow,
    canceledInsideCancellationWindow,
  };
}