"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/admin/require-tenant";
import {
  DISPLAY_ONLY_TYPES,
  normalizeAttachmentAnswers,
  normalizeFileUploadConfig,
  validateAnswers,
  type FormSchema,
} from "@/lib/forms/schema";
import { createAdminClient } from "@/lib/supabase/admin";

const SubmitInput = z.object({
  customerId: z.string().uuid(),
  formId: z.string().uuid(),
  formVersionId: z.string().uuid(),
  uploadSessionId: z.string().uuid(),
  answersJson: z.string(),
});

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

type InternalFormContextResult =
  | {
      ok: true;
      admin: ReturnType<typeof createAdminClient>;
      tenantId: string;
      userId: string;
      customerId: string;
      formId: string;
      schema: FormSchema;
    }
  | { ok: false; error: string };

async function loadInternalFormContext(input: {
  customerId: string;
  formId: string;
  formVersionId: string;
}): Promise<InternalFormContextResult> {
  const { tenantId, user } = await requireTenant();
  const admin = createAdminClient();

  const [{ data: customer }, { data: form }, { data: version }] = await Promise.all([
    admin
      .from("customers")
      .select("id, tenant_id")
      .eq("id", input.customerId)
      .maybeSingle(),
    admin
      .from("forms")
      .select("id, tenant_id, scope, is_archived")
      .eq("id", input.formId)
      .maybeSingle(),
    admin
      .from("form_versions")
      .select("id, tenant_id, form_id, schema_json")
      .eq("id", input.formVersionId)
      .maybeSingle(),
  ]);

  if (!customer || customer.tenant_id !== tenantId) {
    return { ok: false, error: "Customer not found" };
  }

  if (!form || form.tenant_id !== tenantId || form.scope !== "internal" || form.is_archived) {
    return { ok: false, error: "Internal form not found" };
  }

  if (!version || version.tenant_id !== tenantId || version.form_id !== form.id) {
    return { ok: false, error: "Form version not found" };
  }

  return {
    ok: true,
    admin,
    tenantId,
    userId: user.id,
    customerId: customer.id,
    formId: form.id,
    schema: version.schema_json as FormSchema,
  };
}

export async function submitInternalCustomerFormResponseAction(
  input: z.infer<typeof SubmitInput>
): Promise<{ ok: boolean; error?: string }> {
  const parsed = SubmitInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid input" };
  }

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

  const context = await loadInternalFormContext(parsed.data);
  if (!context.ok) {
    return { ok: false, error: context.error };
  }

  const sanitizedAnswers = sanitizeAnswers(context.schema, answers);
  const validation = validateAnswers(context.schema, sanitizedAnswers);
  if (!validation.ok) {
    const firstError = Object.values(validation.errors)[0] ?? "Invalid answers";
    return { ok: false, error: firstError };
  }

  const { data: response, error } = await context.admin
    .from("form_responses")
    .insert({
      tenant_id: context.tenantId,
      form_version_id: parsed.data.formVersionId,
      customer_id: parsed.data.customerId,
      answers_json: sanitizedAnswers,
      filled_by_user_id: context.userId,
    })
    .select("id")
    .single();
  if (error || !response) {
    return { ok: false, error: error?.message ?? "Failed to save form response" };
  }

  const attachmentIds = getAttachmentIds(context.schema, sanitizedAnswers);
  if (attachmentIds.length > 0) {
    await context.admin
      .from("form_response_attachments")
      .update({ form_response_id: response.id, upload_session_id: null })
      .in("id", attachmentIds)
      .eq("customer_id", parsed.data.customerId)
      .eq("upload_session_id", parsed.data.uploadSessionId);
  }

  revalidatePath(`/admin/customers/${parsed.data.customerId}`);
  return { ok: true };
}

export async function uploadInternalCustomerFormAttachmentAction(
  formData: FormData
): Promise<{ ok: boolean; error?: string; attachment?: { id: string; filename: string } }> {
  const customerId = formData.get("customerId");
  const formId = formData.get("formId");
  const formVersionId = formData.get("formVersionId");
  const uploadSessionId = formData.get("uploadSessionId");
  const fieldId = formData.get("fieldId");
  const kind = formData.get("kind");
  const file = formData.get("file");

  if (
    typeof customerId !== "string" ||
    typeof formId !== "string" ||
    typeof formVersionId !== "string" ||
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
  if (file.size <= 0) {
    return { ok: false, error: "Empty file" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "File is too large (max 10 MB)" };
  }
  if (kind === "file" && !ALLOWED_UPLOAD_MIME.has(file.type)) {
    return { ok: false, error: `Unsupported file type: ${file.type || "unknown"}` };
  }
  if (kind === "signature_png" && file.type !== "image/png") {
    return { ok: false, error: "Signature must be PNG" };
  }

  const context = await loadInternalFormContext({ customerId, formId, formVersionId });
  if (!context.ok) {
    return { ok: false, error: context.error };
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
      .eq("customer_id", customerId)
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
      tenant_id: context.tenantId,
      customer_id: customerId,
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

  const storagePath = `${context.tenantId}/customers/${customerId}/${uploadSessionId}/${row.id}.${ext}`;
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

export async function deleteInternalCustomerFormAttachmentAction(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  const attachmentId = formData.get("attachmentId");
  const customerId = formData.get("customerId");
  const uploadSessionId = formData.get("uploadSessionId");

  if (
    typeof attachmentId !== "string" ||
    typeof customerId !== "string" ||
    typeof uploadSessionId !== "string"
  ) {
    return { ok: false, error: "Invalid attachment delete request" };
  }

  const { tenantId } = await requireTenant();
  const admin = createAdminClient();

  const [{ data: customer }, { data: attachment }] = await Promise.all([
    admin
      .from("customers")
      .select("id, tenant_id")
      .eq("id", customerId)
      .maybeSingle(),
    admin
      .from("form_response_attachments")
      .select("id, tenant_id, customer_id, form_response_id, upload_session_id, storage_path")
      .eq("id", attachmentId)
      .maybeSingle(),
  ]);

  if (!customer || customer.tenant_id !== tenantId) {
    return { ok: false, error: "Customer not found" };
  }

  if (
    !attachment ||
    attachment.tenant_id !== tenantId ||
    attachment.customer_id !== customerId ||
    attachment.upload_session_id !== uploadSessionId
  ) {
    return { ok: false, error: "Attachment not found" };
  }

  if (attachment.form_response_id) {
    return { ok: false, error: "Submitted attachments cannot be removed from the form" };
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
      if (signature?.attachment_id) {
        ids.push(signature.attachment_id);
      }
    }
  }

  return ids;
}

function sanitizeAnswers(schema: FormSchema, answers: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {};

  for (const field of schema.fields) {
    if (DISPLAY_ONLY_TYPES.has(field.type)) {
      continue;
    }

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
          const allowedOptions = new Set(field.options ?? []);
          const nextValues = value
            .map((entry) => String(entry))
            .filter((entry) => allowedOptions.size === 0 || allowedOptions.has(entry));
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