"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenant } from "@/lib/admin/require-tenant";
import type { ActionState } from "@/lib/admin/action-state";
import type { FormField, FormSchema } from "@/lib/forms/schema";

const fieldSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "short_text",
    "long_text",
    "select",
    "multi_select",
    "checkbox",
    "yes_no",
    "date",
    "number",
    "file_upload",
    "signature",
    "section",
    "static_text",
  ]),
  label: z.string().trim().max(300),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(120)).optional(),
  help_text: z.string().trim().max(500).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  upload_kind: z.enum(["photo", "document"]).optional(),
  max_files: z.number().int().min(1).max(20).optional(),
  body: z.string().trim().max(5000).optional(),
});

const upsertFormSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  fields: z.array(fieldSchema).max(50),
});

export async function upsertFormAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  let parsedFields: FormField[];
  try {
    parsedFields = JSON.parse((formData.get("fields_json") as string) || "[]");
  } catch {
    return { error: "Invalid form schema." };
  }

  const parsed = upsertFormSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    fields: parsedFields,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // Field-specific validation.
  for (const f of parsed.data.fields) {
    if (f.type === "static_text") {
      if (!f.body) return { error: "Static text fields need body content." };
      continue;
    }

    if (!f.label) {
      return { error: "Every field except static text needs a label." };
    }

    if ((f.type === "select" || f.type === "multi_select") && (!f.options || f.options.length === 0)) {
      return {
        error: `${f.type === "multi_select" ? "Multi-select" : "Dropdown"} "${f.label}" needs at least one option.`,
      };
    }

    if (f.type === "number" && typeof f.min === "number" && typeof f.max === "number" && f.min > f.max) {
      return { error: `Number field "${f.label}" has min greater than max.` };
    }

    if (f.type === "file_upload" && typeof f.max_files === "number" && (f.max_files < 1 || f.max_files > 20)) {
      return { error: `File upload field "${f.label}" must allow between 1 and 20 files.` };
    }
  }

  const { supabase, tenantId } = await requireTenant();

  let formId = parsed.data.id;
  if (!formId) {
    const { data, error } = await supabase
      .from("forms")
      .insert({
        tenant_id: tenantId,
        name: parsed.data.name,
        description: parsed.data.description || null,
      })
      .select("id")
      .single();
    if (error || !data) return { error: error?.message ?? "Failed to create form" };
    formId = data.id;
  } else {
    const { error } = await supabase
      .from("forms")
      .update({
        name: parsed.data.name,
        description: parsed.data.description || null,
      })
      .eq("id", formId)
      .eq("tenant_id", tenantId);
    if (error) return { error: error.message };
  }

  // Create a new version every save.
  const { data: latest } = await supabase
    .from("form_versions")
    .select("version_number")
    .eq("form_id", formId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version_number ?? 0) + 1;

  const schemaPayload: FormSchema = { fields: parsed.data.fields };
  const { data: version, error: vErr } = await supabase
    .from("form_versions")
    .insert({
      tenant_id: tenantId,
      form_id: formId,
      version_number: nextVersion,
      schema_json: schemaPayload,
    })
    .select("id")
    .single();
  if (vErr || !version) return { error: vErr?.message ?? "Failed to save version" };

  await supabase
    .from("forms")
    .update({ current_version_id: version.id })
    .eq("id", formId)
    .eq("tenant_id", tenantId);

  revalidatePath("/admin/forms");
  revalidatePath(`/admin/forms/${formId}`);

  if (!parsed.data.id) {
    redirect(`/admin/forms/${formId}`);
  }
  return { success: "Form saved." };
}

export async function archiveFormAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") return;
  const { supabase, tenantId } = await requireTenant();
  await supabase
    .from("forms")
    .update({ is_archived: true })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  revalidatePath("/admin/forms");
}

export async function restoreFormAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") return;
  const { supabase, tenantId } = await requireTenant();
  await supabase
    .from("forms")
    .update({ is_archived: false })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  revalidatePath("/admin/forms");
}

const linkSchema = z.object({
  service_id: z.string().uuid(),
  form_ids: z.array(z.string().uuid()),
});

/**
 * Replace the set of forms required for a service. Used by the service-edit screen.
 */
export async function setServiceFormsAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = linkSchema.safeParse({
    service_id: formData.get("service_id"),
    form_ids: formData.getAll("form_ids").map(String),
  });
  if (!parsed.success) return { error: "Invalid input" };

  const { supabase, tenantId } = await requireTenant();

  // Verify all forms belong to this tenant.
  if (parsed.data.form_ids.length > 0) {
    const { data: forms } = await supabase
      .from("forms")
      .select("id")
      .in("id", parsed.data.form_ids)
      .eq("tenant_id", tenantId);
    if ((forms?.length ?? 0) !== parsed.data.form_ids.length) {
      return { error: "Form not found in this tenant." };
    }
  }

  // Delete + insert (small N, simpler than diff).
  await supabase
    .from("service_forms")
    .delete()
    .eq("service_id", parsed.data.service_id)
    .eq("tenant_id", tenantId);

  if (parsed.data.form_ids.length > 0) {
    const rows = parsed.data.form_ids.map((fid) => ({
      service_id: parsed.data.service_id,
      form_id: fid,
      tenant_id: tenantId,
    }));
    const { error } = await supabase.from("service_forms").insert(rows);
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/services");
  return { success: "Forms updated." };
}
