/**
 * Stripe webhook handler.
 *
 * Listens for `checkout.session.completed` and promotes the matching booking_draft
 * to a confirmed `bookings` row. Idempotent — safe to receive duplicate events.
 *
 * Local testing:
 *   stripe listen --forward-to localhost:3000/api/stripe/webhook
 *   stripe trigger checkout.session.completed
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { reconcileBookingBalanceCheckoutSession } from "@/lib/payments/stripe-balance-checkout";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendBookingConfirmationEmail } from "@/lib/emails/booking-confirmation";
import {
  filterServiceCustomerFormsByTiming,
  loadServiceCustomerForms,
  toBookingFormRequirementRows,
} from "@/lib/forms/service-customer-forms";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET not configured" }, { status: 500 });
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const body = await req.text();
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bad signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.metadata?.kind === "booking_balance_checkout") {
    const result = await reconcileBookingBalanceCheckoutSession({ session });

    if (result.status === "booking_not_found") {
      return NextResponse.json({ error: result.error ?? "Booking not found" }, { status: 404 });
    }
    if (result.status === "not_balance_checkout" || result.status === "tenant_mismatch") {
      return NextResponse.json({ error: result.error ?? "Invalid balance checkout session" }, { status: 400 });
    }
    if (result.status === "session_not_found" || result.status === "update_failed") {
      return NextResponse.json({ error: result.error ?? "Failed to apply Stripe balance checkout" }, { status: 500 });
    }

    return NextResponse.json({
      received: true,
      booking_id: result.bookingId ?? null,
      customer_id: result.customerId ?? null,
      tenant_slug: result.tenantSlug ?? null,
      already_applied: result.status === "already_applied",
    });
  }

  const draftId = session.metadata?.booking_draft_id;
  if (!draftId) {
    return NextResponse.json({ error: "No booking_draft_id in metadata" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotency: check if already promoted.
  const { data: draft } = await admin
    .from("booking_drafts")
    .select("id, tenant_id, customer_id, customer_email, customer_name, customer_phone, service_id, location_id, provider_id, starts_at, ends_at, status, promoted_booking_id, price_cents, deposit_cents, booking_method, source_channel, created_by_user_id, confirmation_requested")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  if (draft.status === "promoted" && draft.promoted_booking_id) {
    return NextResponse.json({ received: true, already_promoted: true });
  }

  // Make sure we have a customer row (should, from submitBookingDetailsAction).
  let customerId = draft.customer_id;
  if (!customerId && draft.customer_email && draft.customer_name) {
    const { data: existing } = await admin
      .from("customers")
      .select("id")
      .eq("tenant_id", draft.tenant_id)
      .eq("email", draft.customer_email)
      .maybeSingle();
    if (existing) {
      customerId = existing.id;
    } else {
      const { data: created } = await admin
        .from("customers")
        .insert({
          tenant_id: draft.tenant_id,
          email: draft.customer_email,
          name: draft.customer_name,
          phone: draft.customer_phone,
        })
        .select("id")
        .single();
      customerId = created?.id ?? null;
    }
  }
  if (!customerId) {
    return NextResponse.json({ error: "Missing customer" }, { status: 500 });
  }

  const { data: service } = await admin
    .from("services")
    .select("name")
    .eq("id", draft.service_id)
    .maybeSingle();
  if (!service) return NextResponse.json({ error: "Service missing" }, { status: 500 });

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  let noShowFeePaymentMethodId: string | null = null;
  if (session.metadata?.auto_charge_no_show_fee === "true" && paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      noShowFeePaymentMethodId =
        typeof paymentIntent.payment_method === "string"
          ? paymentIntent.payment_method
          : paymentIntent.payment_method?.id ?? null;
    } catch (error) {
      console.error("Failed to retrieve payment method for no-show charging", error);
    }
  }

  if (stripeCustomerId) {
    await admin
      .from("customers")
      .update({ stripe_customer_id: stripeCustomerId })
      .eq("id", customerId);
  }

  let scheduledBookingForms;
  try {
    scheduledBookingForms = filterServiceCustomerFormsByTiming(
      await loadServiceCustomerForms(admin, {
        tenantId: draft.tenant_id,
        serviceId: draft.service_id,
      }),
      ["pre_visit", "post_visit"]
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load service forms" },
      { status: 500 }
    );
  }

  // Insert the confirmed booking.
  const { data: booking, error: bErr } = await admin
    .from("bookings")
    .insert({
      tenant_id: draft.tenant_id,
      customer_id: customerId,
      service_id: draft.service_id,
      location_id: draft.location_id,
      provider_id: draft.provider_id,
      starts_at: draft.starts_at,
      ends_at: draft.ends_at,
      status: "confirmed",
      price_cents: draft.price_cents,
      deposit_cents: draft.deposit_cents,
      booking_method: draft.booking_method ?? "customer_self_service",
      source_channel: draft.source_channel ?? "online_booking",
      deposit_status:
        draft.deposit_cents > 0 && draft.deposit_cents < draft.price_cents
          ? "deposit_paid"
          : "paid_in_full",
      confirmation_requested: draft.confirmation_requested ?? true,
      confirmation_delivery_status:
        draft.confirmation_requested === false ? "not_requested" : "unknown",
      stripe_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      stripe_customer_id: stripeCustomerId,
      no_show_fee_payment_method_id: noShowFeePaymentMethodId,
      created_by_user_id: draft.created_by_user_id ?? null,
    })
    .select("id, cancel_token, starts_at, ends_at, confirmation_send_count")
    .single();
  if (bErr || !booking) {
    return NextResponse.json({ error: bErr?.message ?? "Failed to create booking" }, { status: 500 });
  }

  // Re-link form responses + requirements from the draft to the booking.
  await admin
    .from("form_responses")
    .update({ booking_id: booking.id, booking_draft_id: null, customer_id: customerId })
    .eq("booking_draft_id", draftId);
  await admin
    .from("booking_form_requirements")
    .update({ booking_id: booking.id, booking_draft_id: null })
    .eq("booking_draft_id", draftId);
  if (scheduledBookingForms.length > 0) {
    await admin
      .from("booking_form_requirements")
      .insert(
        toBookingFormRequirementRows(scheduledBookingForms, {
          tenantId: draft.tenant_id,
          bookingId: booking.id,
        })
      );
  }
  await admin
    .from("form_response_attachments")
    .update({ booking_id: booking.id, booking_draft_id: null })
    .eq("booking_draft_id", draftId);

  // Mark the draft promoted, drop the slot hold.
  await admin
    .from("booking_drafts")
    .update({
      status: "promoted",
      promoted_booking_id: booking.id,
      deposit_status:
        draft.deposit_cents > 0 && draft.deposit_cents < draft.price_cents
          ? "deposit_paid"
          : "paid_in_full",
    })
    .eq("id", draftId);
  await admin.from("slot_holds").delete().eq("booking_draft_id", draftId);

  // Fire off confirmation email (non-blocking failure).
  if ((draft.confirmation_requested ?? true) && draft.customer_email && draft.customer_name) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("name, slug, timezone")
      .eq("id", draft.tenant_id)
      .maybeSingle();
    if (tenant) {
      try {
        await sendBookingConfirmationEmail({
          to: draft.customer_email,
          customerName: draft.customer_name,
          tenantName: tenant.name,
          tenantTimeZone: tenant.timezone,
          serviceName: service.name,
          startsAt: booking.starts_at,
          endsAt: booking.ends_at,
          cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/cancel/${booking.cancel_token}`,
        });
        await admin
          .from("bookings")
          .update({
            confirmation_delivery_status: "sent",
            confirmation_sent_at: new Date().toISOString(),
            confirmation_send_count: (booking.confirmation_send_count ?? 0) + 1,
            confirmation_last_error: null,
          })
          .eq("id", booking.id);
      } catch (err) {
        console.error("Failed to send confirmation email", err);
        await admin
          .from("bookings")
          .update({
            confirmation_delivery_status: "failed",
            confirmation_last_error:
              err instanceof Error ? err.message : "Failed to send confirmation email",
          })
          .eq("id", booking.id);
      }
    }
  }

  return NextResponse.json({ received: true, booking_id: booking.id });
}
