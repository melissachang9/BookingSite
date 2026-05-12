/**
 * Public Server Actions for the booking-flow form runtime + Stripe checkout kickoff.
 */
"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizeFileUploadConfig,
  normalizeAttachmentAnswers,
  validateAnswers,
  type FormSchema,
} from "@/lib/forms/schema";
import { getStripe } from "@/lib/stripe";
import { normalizeTenantSettings } from "@/lib/tenants/settings";

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

  // Link any attachments uploaded for this draft+form to the new response.
  const attachmentIds: string[] = [];
  for (const f of schema.fields) {
    if (f.type === "file_upload") {
      attachmentIds.push(
        ...normalizeAttachmentAnswers(answers[f.id]).map((attachment) => attachment.attachment_id)
      );
    }
    if (f.type === "signature") {
      const signature = normalizeAttachmentAnswers(answers[f.id])[0];
      if (signature?.attachment_id) attachmentIds.push(signature.attachment_id);
    }
  }
  if (attachmentIds.length > 0) {
    await admin
      .from("form_response_attachments")
      .update({ form_response_id: response.id })
      .in("id", attachmentIds)
      .eq("booking_draft_id", parsed.data.draftId);
  }

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
    .select("id, tenant_id, service_id, customer_id, customer_email, customer_name, customer_phone, status, expires_at, price_cents, deposit_cents, duration_minutes")
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
    .select("id, name")
    .eq("id", draft.service_id)
    .maybeSingle();
  if (!service) return { ok: false, error: "Service not found" };

  const { data: tenant } = await admin
    .from("tenants")
    .select("settings_json")
    .eq("id", draft.tenant_id)
    .maybeSingle();
  const tenantSettings = normalizeTenantSettings(
    (tenant?.settings_json ?? null) as Partial<Record<string, unknown>> | null
  );
  const shouldAutoChargeNoShowFee =
    tenantSettings.auto_charge_no_show_fee && tenantSettings.no_show_fee_cents > 0;

  const amount = draft.deposit_cents > 0 ? draft.deposit_cents : draft.price_cents;
  if (amount <= 0) {
    // Free service — promote immediately. Skip Stripe.
    return { ok: false, error: "Free bookings not yet supported" };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const successUrl = `${appUrl}/${parsed.data.tenantSlug}/book/${draft.id}/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${appUrl}/${parsed.data.tenantSlug}/book/${draft.id}`;

  const stripe = getStripe();
  let stripeCustomerId: string | null = null;

  if (shouldAutoChargeNoShowFee) {
    let customer = null as
      | { id: string; email: string; name: string; phone: string | null; stripe_customer_id: string | null }
      | null;

    if (draft.customer_id) {
      const { data: existingCustomer } = await admin
        .from("customers")
        .select("id, email, name, phone, stripe_customer_id")
        .eq("id", draft.customer_id)
        .maybeSingle();
      customer = existingCustomer;
    }

    if (!customer && draft.customer_email) {
      const { data: existingByEmail } = await admin
        .from("customers")
        .select("id, email, name, phone, stripe_customer_id")
        .eq("tenant_id", draft.tenant_id)
        .eq("email", draft.customer_email)
        .maybeSingle();
      customer = existingByEmail;
    }

    if (!customer && draft.customer_email) {
      const { data: createdCustomer, error: createCustomerError } = await admin
        .from("customers")
        .insert({
          tenant_id: draft.tenant_id,
          email: draft.customer_email,
          name: draft.customer_name ?? draft.customer_email,
          phone: draft.customer_phone ?? null,
        })
        .select("id, email, name, phone, stripe_customer_id")
        .single();
      if (createCustomerError || !createdCustomer) {
        return { ok: false, error: createCustomerError?.message ?? "Failed to prepare customer" };
      }
      customer = createdCustomer;
      await admin
        .from("booking_drafts")
        .update({ customer_id: createdCustomer.id })
        .eq("id", draft.id);
    }

    if (!customer) {
      return { ok: false, error: "Please enter your contact details first" };
    }

    stripeCustomerId = customer.stripe_customer_id;
    if (!stripeCustomerId) {
      const stripeCustomer = await stripe.customers.create({
        email: customer.email,
        name: customer.name,
        phone: customer.phone ?? undefined,
        metadata: {
          customer_id: customer.id,
          tenant_id: draft.tenant_id,
        },
      });
      stripeCustomerId = stripeCustomer.id;
      const { error: customerUpdateError } = await admin
        .from("customers")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", customer.id);
      if (customerUpdateError) {
        return { ok: false, error: customerUpdateError.message };
      }
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    ...(stripeCustomerId ? { customer: stripeCustomerId } : { customer_email: draft.customer_email }),
    ...(shouldAutoChargeNoShowFee
      ? { payment_intent_data: { setup_future_usage: "off_session" as const } }
      : {}),
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: service.name,
            description:
              draft.deposit_cents > 0
                ? `Deposit ($${(draft.price_cents / 100).toFixed(0)} total)`
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
      auto_charge_no_show_fee: shouldAutoChargeNoShowFee ? "true" : "false",
    },
  });

  await admin
    .from("booking_drafts")
    .update({ stripe_session_id: session.id, status: "awaiting_payment" })
    .eq("id", draft.id);

  if (!session.url) return { ok: false, error: "Failed to create checkout session" };
  return { ok: true, url: session.url };
}

// =========================================================================
// Form attachments (file/photo upload + drawn signatures)
// =========================================================================

const ALLOWED_UPLOAD_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const IMAGE_UPLOAD_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export type UploadAttachmentResult = {
  ok: boolean;
  error?: string;
  attachment?: { id: string; filename: string };
};

export type DeleteAttachmentResult = {
  ok: boolean;
  error?: string;
};

/**
 * Upload a file or signature PNG for a form field on the given booking draft.
 * Called by the form runtime via a server-action FormData submission.
 */
export async function uploadFormAttachmentAction(
  formData: FormData
): Promise<UploadAttachmentResult> {
  const draftId = formData.get("draftId");
  const requirementId = formData.get("requirementId");
  const fieldId = formData.get("fieldId");
  const kind = formData.get("kind");
  const file = formData.get("file");

  if (
    typeof draftId !== "string" ||
    typeof requirementId !== "string" ||
    typeof fieldId !== "string" ||
    typeof kind !== "string" ||
    !(file instanceof File)
  ) {
    return { ok: false, error: "Invalid upload" };
  }
  if (kind !== "file" && kind !== "signature_png") {
    return { ok: false, error: "Invalid kind" };
  }
  if (file.size <= 0) return { ok: false, error: "Empty file" };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File is too large (max 10 MB)" };
  }
  if (kind === "file" && !ALLOWED_UPLOAD_MIME.has(file.type)) {
    return { ok: false, error: `Unsupported file type: ${file.type || "unknown"}` };
  }
  if (kind === "signature_png" && file.type !== "image/png") {
    return { ok: false, error: "Signature must be PNG" };
  }

  const admin = createAdminClient();
  const { data: draft } = await admin
    .from("booking_drafts")
    .select("id, tenant_id, expires_at, status")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft) return { ok: false, error: "Booking not found" };
  if (new Date(draft.expires_at) < new Date()) {
    return { ok: false, error: "Your hold has expired. Please pick a new time." };
  }

  const { data: requirement } = await admin
    .from("booking_form_requirements")
    .select("id, tenant_id, booking_draft_id, form_version_id")
    .eq("id", requirementId)
    .maybeSingle();
  if (!requirement || requirement.booking_draft_id !== draftId) {
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
  const schema = (version?.schema_json ?? { fields: [] }) as FormSchema;
  const field = schema.fields.find((entry) => entry.id === fieldId);
  if (!field) {
    return { ok: false, error: "Field not found for this form" };
  }

  if (kind === "file" && field.type !== "file_upload") {
    return { ok: false, error: "This field does not accept file uploads" };
  }
  if (kind === "signature_png" && field.type !== "signature") {
    return { ok: false, error: "This field does not accept signatures" };
  }

  if (kind === "file") {
    const { uploadKind, maxFiles } = normalizeFileUploadConfig(field);
    const allowedMime =
      uploadKind === "document" ? ALLOWED_UPLOAD_MIME : IMAGE_UPLOAD_MIME;
    if (!allowedMime.has(file.type)) {
      return {
        ok: false,
        error:
          uploadKind === "document"
            ? `Unsupported file type: ${file.type || "unknown"}`
            : "Photo fields accept image files only",
      };
    }

    const { count } = await admin
      .from("form_response_attachments")
      .select("id", { count: "exact", head: true })
      .eq("booking_draft_id", draftId)
      .eq("field_id", fieldId);
    if ((count ?? 0) >= maxFiles) {
      return {
        ok: false,
        error: `You can upload up to ${maxFiles} file${maxFiles === 1 ? "" : "s"} for this field`,
      };
    }
  }

  // Insert the attachment row first so we can use its id in the storage path.
  const ext =
    kind === "signature_png"
      ? "png"
      : (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "bin").toLowerCase();
  const originalFilename =
    kind === "signature_png" ? "signature.png" : (file.name || "upload");

  const { data: row, error: insErr } = await admin
    .from("form_response_attachments")
    .insert({
      tenant_id: draft.tenant_id,
      booking_draft_id: draftId,
      field_id: fieldId,
      kind,
      // temporary placeholder; we update after we know the id-derived path
      storage_path: `pending/${crypto.randomUUID()}.${ext}`,
      mime_type: file.type || null,
      file_size_bytes: file.size,
      original_filename: originalFilename,
    })
    .select("id")
    .single();
  if (insErr || !row) {
    return { ok: false, error: insErr?.message ?? "Failed to record attachment" };
  }

  const storagePath = `${draft.tenant_id}/${draftId}/${row.id}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from("form-uploads")
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    // Roll back the row.
    await admin.from("form_response_attachments").delete().eq("id", row.id);
    return { ok: false, error: upErr.message };
  }

  await admin
    .from("form_response_attachments")
    .update({ storage_path: storagePath })
    .eq("id", row.id);

  return { ok: true, attachment: { id: row.id, filename: originalFilename } };
}

export async function deleteFormAttachmentAction(
  formData: FormData
): Promise<DeleteAttachmentResult> {
  const attachmentId = formData.get("attachmentId");
  const draftId = formData.get("draftId");

  if (typeof attachmentId !== "string" || typeof draftId !== "string") {
    return { ok: false, error: "Invalid attachment delete request" };
  }

  const admin = createAdminClient();
  const { data: draft } = await admin
    .from("booking_drafts")
    .select("id, tenant_id")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft) {
    return { ok: false, error: "Booking not found" };
  }

  const { data: attachment } = await admin
    .from("form_response_attachments")
    .select("id, tenant_id, booking_draft_id, form_response_id, storage_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!attachment || attachment.tenant_id !== draft.tenant_id || attachment.booking_draft_id !== draftId) {
    return { ok: false, error: "Attachment not found" };
  }
  if (attachment.form_response_id) {
    return { ok: false, error: "Submitted attachments cannot be removed from the draft" };
  }

  const { error: storageError } = await admin.storage
    .from("form-uploads")
    .remove([attachment.storage_path]);
  if (storageError) {
    return { ok: false, error: storageError.message };
  }

  const { error: deleteError } = await admin
    .from("form_response_attachments")
    .delete()
    .eq("id", attachment.id);
  if (deleteError) {
    return { ok: false, error: deleteError.message };
  }

  return { ok: true };
}

