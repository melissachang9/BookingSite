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
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendBookingConfirmationEmail } from "@/lib/emails/booking-confirmation";

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
  const draftId = session.metadata?.booking_draft_id;
  if (!draftId) {
    return NextResponse.json({ error: "No booking_draft_id in metadata" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotency: check if already promoted.
  const { data: draft } = await admin
    .from("booking_drafts")
    .select("id, tenant_id, customer_id, customer_email, customer_name, customer_phone, service_id, provider_id, starts_at, ends_at, status, promoted_booking_id")
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
    .select("price_cents, deposit_cents, name")
    .eq("id", draft.service_id)
    .maybeSingle();
  if (!service) return NextResponse.json({ error: "Service missing" }, { status: 500 });

  // Insert the confirmed booking.
  const { data: booking, error: bErr } = await admin
    .from("bookings")
    .insert({
      tenant_id: draft.tenant_id,
      customer_id: customerId,
      service_id: draft.service_id,
      provider_id: draft.provider_id,
      starts_at: draft.starts_at,
      ends_at: draft.ends_at,
      status: "confirmed",
      price_cents: service.price_cents,
      deposit_cents: service.deposit_cents,
      stripe_session_id: session.id,
      stripe_payment_intent_id:
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
    })
    .select("id, cancel_token, starts_at, ends_at")
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

  // Mark the draft promoted, drop the slot hold.
  await admin
    .from("booking_drafts")
    .update({ status: "promoted", promoted_booking_id: booking.id })
    .eq("id", draftId);
  await admin.from("slot_holds").delete().eq("booking_draft_id", draftId);

  // Fire off confirmation email (non-blocking failure).
  if (draft.customer_email && draft.customer_name) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("name, slug")
      .eq("id", draft.tenant_id)
      .maybeSingle();
    if (tenant) {
      try {
        await sendBookingConfirmationEmail({
          to: draft.customer_email,
          customerName: draft.customer_name,
          tenantName: tenant.name,
          serviceName: service.name,
          startsAt: booking.starts_at,
          endsAt: booking.ends_at,
          cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/${tenant.slug}/bookings/${booking.id}?token=${booking.cancel_token}`,
        });
      } catch (err) {
        console.error("Failed to send confirmation email", err);
      }
    }
  }

  return NextResponse.json({ received: true, booking_id: booking.id });
}
