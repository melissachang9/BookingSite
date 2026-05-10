/**
 * Public Server Actions for the booking-flow form runtime + Stripe checkout kickoff.
 */
"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAnswers, type FormSchema } from "@/lib/forms/schema";
import { getStripe } from "@/lib/stripe";

const SubmitInput = z.object({
  draftId: z.string().uuid(),
  requirementId: z.string().uuid(),
  // answers as a JSON-encoded string from the form runtime
  answersJson: z.string(),
});

export type SubmitFormResult = { ok: boolean; error?: string };

export async function submitFormResponseAction(
  input: z.infer<typeof SubmitInput>
): Promise<SubmitFormResult> {
  const parsed = SubmitInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  let answers: Record<string, unknown>;
  try {
    answers = JSON.parse(parsed.data.answersJson);
  } catch {
    return { ok: false, error: "Invalid answers" };
  }

  const admin = createAdminClient();

  // Verify draft, requirement, and that they're linked.
  const { data: draft } = await admin
    .from("booking_drafts")
    .select("id, tenant_id, status, expires_at")
    .eq("id", parsed.data.draftId)
    .maybeSingle();
  if (!draft) return { ok: false, error: "Booking not found" };
  if (new Date(draft.expires_at) < new Date()) {
    return { ok: false, error: "Your hold has expired. Please pick a new time." };
  }

  const { data: requirement } = await admin
    .from("booking_form_requirements")
    .select("id, tenant_id, booking_draft_id, form_id, form_version_id, satisfied_by_response_id")
    .eq("id", parsed.data.requirementId)
    .maybeSingle();
  if (!requirement || requirement.booking_draft_id !== parsed.data.draftId) {
    return { ok: false, error: "Form not required for this booking" };
  }
  if (requirement.tenant_id !== draft.tenant_id) {
    return { ok: false, error: "Tenant mismatch" };
  }

  const { data: version } = await admin
    .from("form_versions")
    .select("schema_json")
    .eq("id", requirement.form_version_id)
    .maybeSingle();
  if (!version) return { ok: false, error: "Form version not found" };

  const schema = version.schema_json as FormSchema;
  const validation = validateAnswers(schema, answers);
  if (!validation.ok) {
    const firstError = Object.values(validation.errors)[0] ?? "Invalid answers";
    return { ok: false, error: firstError };
  }

  const { data: response, error: rErr } = await admin
    .from("form_responses")
    .insert({
      tenant_id: draft.tenant_id,
      form_version_id: requirement.form_version_id,
      booking_draft_id: parsed.data.draftId,
      answers_json: answers,
    })
    .select("id")
    .single();
  if (rErr || !response) return { ok: false, error: rErr?.message ?? "Failed to save response" };

  await admin
    .from("booking_form_requirements")
    .update({ satisfied_by_response_id: response.id })
    .eq("id", requirement.id);

  // If all requirements for this draft are now satisfied, advance status.
  const { data: remaining } = await admin
    .from("booking_form_requirements")
    .select("id")
    .eq("booking_draft_id", parsed.data.draftId)
    .is("satisfied_by_response_id", null);

  if ((remaining?.length ?? 0) === 0 && draft.status === "awaiting_form") {
    await admin
      .from("booking_drafts")
      .update({ status: "draft" }) // back to draft → ready for contact details
      .eq("id", parsed.data.draftId);
  }

  return { ok: true };
}

const CheckoutInput = z.object({
  draftId: z.string().uuid(),
  tenantSlug: z.string().min(1),
});

export type CheckoutResult = { ok: boolean; error?: string; url?: string };

/**
 * Create a Stripe Checkout session for the deposit (or full price if no deposit).
 * Webhook on `checkout.session.completed` promotes the draft to a confirmed booking.
 */
export async function createCheckoutSessionAction(
  input: z.infer<typeof CheckoutInput>
): Promise<CheckoutResult> {
  const parsed = CheckoutInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const admin = createAdminClient();
  const { data: draft } = await admin
    .from("booking_drafts")
    .select("id, tenant_id, service_id, customer_email, customer_name, status, expires_at")
    .eq("id", parsed.data.draftId)
    .maybeSingle();
  if (!draft) return { ok: false, error: "Booking not found" };
  if (new Date(draft.expires_at) < new Date()) {
    return { ok: false, error: "Your hold has expired. Please pick a new time." };
  }
  if (draft.status === "promoted") return { ok: false, error: "Already booked" };
  if (!draft.customer_email) return { ok: false, error: "Please enter your contact details first" };

  // Check that all forms are satisfied.
  const { data: pending } = await admin
    .from("booking_form_requirements")
    .select("id")
    .eq("booking_draft_id", parsed.data.draftId)
    .is("satisfied_by_response_id", null);
  if ((pending?.length ?? 0) > 0) {
    return { ok: false, error: "Please complete the required intake forms first" };
  }

  const { data: service } = await admin
    .from("services")
    .select("id, name, price_cents, deposit_cents")
    .eq("id", draft.service_id)
    .maybeSingle();
  if (!service) return { ok: false, error: "Service not found" };

  const amount = service.deposit_cents > 0 ? service.deposit_cents : service.price_cents;
  if (amount <= 0) {
    // Free service — promote immediately. Skip Stripe.
    return { ok: false, error: "Free bookings not yet supported" };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const successUrl = `${appUrl}/${parsed.data.tenantSlug}/book/${draft.id}/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${appUrl}/${parsed.data.tenantSlug}/book/${draft.id}`;

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: draft.customer_email,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: service.name,
            description:
              service.deposit_cents > 0
                ? `Deposit ($${(service.price_cents / 100).toFixed(0)} total)`
                : undefined,
          },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      booking_draft_id: draft.id,
      tenant_id: draft.tenant_id,
    },
  });

  await admin
    .from("booking_drafts")
    .update({ stripe_session_id: session.id, status: "awaiting_payment" })
    .eq("id", draft.id);

  if (!session.url) return { ok: false, error: "Failed to create checkout session" };
  return { ok: true, url: session.url };
}
