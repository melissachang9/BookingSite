"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/admin/action-state";
import { cancelBookingByToken } from "@/lib/bookings/cancel";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DISPLAY_ONLY_TYPES,
  normalizeAttachmentAnswers,
  normalizeFileUploadConfig,
  validateAnswers,
  type FormSchema,
} from "@/lib/forms/schema";

const cancelByTokenSchema = z.object({
  token: z.string().min(1),
  reason: z.string().max(500).optional(),
});

const bookingFormProgressSchema = z.object({
  token: z.string().min(1),
  requirementId: z.string().uuid(),
  answersJson: z.string(),
});

const submitBookingFormSchema = bookingFormProgressSchema.extend({
  uploadSessionId: z.string().min(1),
});

export type ManageBookingFormSaveResult = { ok: boolean; error?: string; savedAt?: string };
export type ManageBookingFormSubmitResult = { ok: boolean; error?: string };
export type ManageBookingAttachmentResult = {
  ok: boolean;
  error?: string;
  attachment?: { id: string; filename: string };
};

export async function cancelBookingByTokenAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = cancelByTokenSchema.safeParse({
    token: formData.get("token"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return { error: "Invalid link or form data" };

  const result = await cancelBookingByToken({
    cancelToken: parsed.data.token,
    reason: parsed.data.reason ?? null,
  });

  revalidatePath(`/cancel/${parsed.data.token}`);
  if (result.bookingId) {
    revalidatePath(`/admin/bookings/${result.bookingId}`);
  }
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/calendar");

  if (!result.ok) {
    return { error: result.error ?? "Failed to cancel booking" };
  }

  if (result.refundedAmountCents && result.refundedAmountCents > 0) {
    return {
      success: `Your booking was canceled and $${(result.refundedAmountCents / 100).toFixed(2)} was refunded.`,
    };
  }

  if (result.refundDecision === "blocked_by_policy") {
    return {
      success: `Your booking was canceled. Because it was inside the ${result.cancellationWindowHours ?? 24}-hour cancellation window, no refund was issued.`,
    };
  }

  return { success: "Your booking was canceled." };
}

const ALLOWED_UPLOAD_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

const IMAGE_UPLOAD_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

async function loadManageBookingRequirementContext(input: {
  token: string;
  requirementId: string;
}) {
  const admin = createAdminClient();

  const [{ data: booking }, { data: requirement }] = await Promise.all([
    admin
      .from("bookings")
      .select("id, tenant_id, customer_id, status, starts_at, ends_at")
      .eq("cancel_token", input.token)
      .maybeSingle(),
    admin
      .from("booking_form_requirements")
      .select("id, tenant_id, booking_id, form_version_id, satisfied_by_response_id")
      .eq("id", input.requirementId)
      .maybeSingle(),
  ]);

  if (!booking) {
    return { ok: false as const, error: "Booking not found" };
  }

  if (
    !requirement ||
    requirement.tenant_id !== booking.tenant_id ||
    requirement.booking_id !== booking.id
  ) {
    return { ok: false as const, error: "Form not found for this booking" };
  }

  const { data: version } = await admin
    .from("form_versions")
    .select("schema_json")
    .eq("id", requirement.form_version_id)
    .maybeSingle();
  if (!version) {
    return { ok: false as const, error: "Form version not found" };
  }

  return {
    ok: true as const,
    admin,
    booking,
    requirement,
    schema: version.schema_json as FormSchema,
  };
}

export async function saveManageBookingFormProgressAction(
  input: z.infer<typeof bookingFormProgressSchema>
): Promise<ManageBookingFormSaveResult> {
  const parsed = bookingFormProgressSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  let answers: Record<string, unknown>;
  try {
    const candidate = JSON.parse(parsed.data.answersJson);
    if (!candidate || Array.isArray(candidate) || typeof candidate !== "object") {
      return { ok: false, error: "Invalid answers" };
    }
    answers = candidate as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Invalid answers" };
  }

  const context = await loadManageBookingRequirementContext(parsed.data);
  if (!context.ok) {
    return { ok: false, error: context.error };
  }

  if (context.requirement.satisfied_by_response_id) {
    return { ok: false, error: "This form has already been submitted" };
  }

  const nextAnswers = sanitizeAnswers(context.schema, answers);
  const hasSavedAnswers = Object.keys(nextAnswers).length > 0;
  const savedAt = hasSavedAnswers ? new Date().toISOString() : null;

  const { data: updated, error } = await context.admin
    .from("booking_form_requirements")
    .update({
      draft_answers_json: hasSavedAnswers ? nextAnswers : null,
      draft_saved_at: savedAt,
    })
    .eq("id", context.requirement.id)
    .eq("booking_id", context.booking.id)
    .select("draft_saved_at")
    .single();
  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, savedAt: updated?.draft_saved_at ?? undefined };
}

export async function submitManageBookingFormResponseAction(
  input: z.infer<typeof submitBookingFormSchema>
): Promise<ManageBookingFormSubmitResult> {
  const parsed = submitBookingFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  let answers: Record<string, unknown>;
  try {
    const candidate = JSON.parse(parsed.data.answersJson);
    if (!candidate || Array.isArray(candidate) || typeof candidate !== "object") {
      return { ok: false, error: "Invalid answers" };
    }
    answers = candidate as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Invalid answers" };
  }

  const context = await loadManageBookingRequirementContext(parsed.data);
  if (!context.ok) {
    return { ok: false, error: context.error };
  }

  if (context.requirement.satisfied_by_response_id) {
    return { ok: false, error: "This form has already been submitted" };
  }

  const validation = validateAnswers(context.schema, answers);
  if (!validation.ok) {
    const firstError = Object.values(validation.errors)[0] ?? "Invalid answers";
    return { ok: false, error: firstError };
  }

  const { data: response, error } = await context.admin
    .from("form_responses")
    .insert({
      tenant_id: context.booking.tenant_id,
      form_version_id: context.requirement.form_version_id,
      booking_id: context.booking.id,
      customer_id: context.booking.customer_id,
      answers_json: answers,
    })
    .select("id")
    .single();
  if (error || !response) {
    return { ok: false, error: error?.message ?? "Failed to save response" };
  }

  const attachmentIds = getAttachmentIds(context.schema, answers);
  if (attachmentIds.length > 0) {
    await context.admin
      .from("form_response_attachments")
      .update({ form_response_id: response.id, upload_session_id: null })
      .in("id", attachmentIds)
      .eq("booking_id", context.booking.id)
      .eq("upload_session_id", parsed.data.uploadSessionId);
  }

  await context.admin
    .from("booking_form_requirements")
    .update({
      satisfied_by_response_id: response.id,
      draft_answers_json: null,
      draft_saved_at: null,
    })
    .eq("id", context.requirement.id)
    .eq("booking_id", context.booking.id);

  revalidatePath(`/cancel/${parsed.data.token}`);
  revalidatePath(`/admin/bookings/${context.booking.id}`);
  if (context.booking.customer_id) {
    revalidatePath(`/admin/customers/${context.booking.customer_id}`);
  }

  return { ok: true };
}

export async function uploadManageBookingFormAttachmentAction(
  formData: FormData
): Promise<ManageBookingAttachmentResult> {
  const token = formData.get("token");
  const requirementId = formData.get("requirementId");
  const uploadSessionId = formData.get("uploadSessionId");
  const fieldId = formData.get("fieldId");
  const kind = formData.get("kind");
  const file = formData.get("file");

  if (
    typeof token !== "string" ||
    typeof requirementId !== "string" ||
    typeof uploadSessionId !== "string" ||
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

  const context = await loadManageBookingRequirementContext({ token, requirementId });
  if (!context.ok) {
    return { ok: false, error: context.error };
  }
  if (context.requirement.satisfied_by_response_id) {
    return { ok: false, error: "This form has already been submitted" };
  }

  const field = context.schema.fields.find((entry) => entry.id === fieldId);
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
    const allowedMime = uploadKind === "document" ? ALLOWED_UPLOAD_MIME : IMAGE_UPLOAD_MIME;
    if (!allowedMime.has(file.type)) {
      return {
        ok: false,
        error:
          uploadKind === "document"
            ? `Unsupported file type: ${file.type || "unknown"}`
            : "Photo fields accept image files only",
      };
    }

    const { count } = await context.admin
      .from("form_response_attachments")
      .select("id", { count: "exact", head: true })
      .eq("booking_id", context.booking.id)
      .eq("upload_session_id", uploadSessionId)
      .eq("field_id", fieldId);

    if ((count ?? 0) >= maxFiles) {
      return {
        ok: false,
        error: `You can upload up to ${maxFiles} file${maxFiles === 1 ? "" : "s"} for this field`,
      };
    }
  }

  const ext =
    kind === "signature_png"
      ? "png"
      : (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "bin").toLowerCase();
  const originalFilename = kind === "signature_png" ? "signature.png" : file.name || "upload";

  const { data: row, error: insertError } = await context.admin
    .from("form_response_attachments")
    .insert({
      tenant_id: context.booking.tenant_id,
      booking_id: context.booking.id,
      customer_id: context.booking.customer_id,
      upload_session_id: uploadSessionId,
      field_id: fieldId,
      kind,
      storage_path: `pending/${crypto.randomUUID()}.${ext}`,
      mime_type: file.type || null,
      file_size_bytes: file.size,
      original_filename: originalFilename,
    })
    .select("id")
    .single();
  if (insertError || !row) {
    return { ok: false, error: insertError?.message ?? "Failed to record attachment" };
  }

  const storagePath = `${context.booking.tenant_id}/bookings/${context.booking.id}/${uploadSessionId}/${row.id}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await context.admin.storage
    .from("form-uploads")
    .upload(storagePath, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) {
    await context.admin.from("form_response_attachments").delete().eq("id", row.id);
    return { ok: false, error: uploadError.message };
  }

  await context.admin
    .from("form_response_attachments")
    .update({ storage_path: storagePath })
    .eq("id", row.id);

  return { ok: true, attachment: { id: row.id, filename: originalFilename } };
}

export async function deleteManageBookingFormAttachmentAction(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const token = formData.get("token");
  const attachmentId = formData.get("attachmentId");
  const uploadSessionId = formData.get("uploadSessionId");

  if (
    typeof token !== "string" ||
    typeof attachmentId !== "string" ||
    typeof uploadSessionId !== "string"
  ) {
    return { ok: false, error: "Invalid attachment delete request" };
  }

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from("bookings")
    .select("id, tenant_id")
    .eq("cancel_token", token)
    .maybeSingle();
  if (!booking) {
    return { ok: false, error: "Booking not found" };
  }

  const { data: attachment } = await admin
    .from("form_response_attachments")
    .select("id, tenant_id, booking_id, form_response_id, upload_session_id, storage_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (
    !attachment ||
    attachment.tenant_id !== booking.tenant_id ||
    attachment.booking_id !== booking.id ||
    attachment.upload_session_id !== uploadSessionId
  ) {
    return { ok: false, error: "Attachment not found" };
  }
  if (attachment.form_response_id) {
    return { ok: false, error: "Submitted attachments cannot be removed from this form" };
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

function getAttachmentIds(schema: FormSchema, answers: Record<string, unknown>) {
  const ids: string[] = [];
  for (const field of schema.fields) {
    if (field.type === "file_upload") {
      ids.push(
        ...normalizeAttachmentAnswers(answers[field.id]).map((attachment) => attachment.attachment_id)
      );
    }
    if (field.type === "signature") {
      const signature = normalizeAttachmentAnswers(answers[field.id])[0];
      if (signature?.attachment_id) ids.push(signature.attachment_id);
    }
  }
  return ids;
}

function sanitizeAnswers(schema: FormSchema, answers: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {};

  for (const field of schema.fields) {
    if (DISPLAY_ONLY_TYPES.has(field.type)) continue;

    const value = answers[field.id];

    switch (field.type) {
      case "short_text":
      case "long_text":
      case "date":
      case "select": {
        if (typeof value === "string" && value.length > 0) {
          sanitized[field.id] = value;
        }
        break;
      }
      case "number": {
        if (typeof value === "number" && Number.isFinite(value)) {
          sanitized[field.id] = value;
        } else if (typeof value === "string" && value.trim().length > 0) {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) {
            sanitized[field.id] = parsed;
          }
        }
        break;
      }
      case "multi_select": {
        if (Array.isArray(value)) {
          const allowed = new Set(field.options ?? []);
          const nextValues = value
            .map((entry) => String(entry))
            .filter((entry) => allowed.size === 0 || allowed.has(entry));
          if (nextValues.length > 0) {
            sanitized[field.id] = nextValues;
          }
        }
        break;
      }
      case "checkbox": {
        if (typeof value === "boolean") {
          sanitized[field.id] = value;
        }
        break;
      }
      case "yes_no": {
        if (value === "yes" || value === "no") {
          sanitized[field.id] = value;
        }
        break;
      }
      case "file_upload": {
        const attachments = normalizeAttachmentAnswers(value);
        if (attachments.length > 0) {
          sanitized[field.id] = attachments;
        }
        break;
      }
      case "signature": {
        const signature = normalizeAttachmentAnswers(value)[0];
        if (signature) {
          sanitized[field.id] = signature;
        }
        break;
      }
    }
  }

  return sanitized;
}