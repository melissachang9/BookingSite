"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/admin/require-tenant";
import type { ActionState } from "@/lib/admin/action-state";

const providerSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email().optional().or(z.literal("")),
  bio: z.string().trim().max(2000).optional().or(z.literal("")),
  is_active: z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean()).default(true),
});

export async function upsertProviderAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = providerSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    email: formData.get("email") ?? "",
    bio: formData.get("bio") ?? "",
    is_active: formData.get("is_active") ?? false,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { supabase, tenantId } = await requireTenant();
  const row = {
    tenant_id: tenantId,
    name: parsed.data.name,
    email: parsed.data.email || null,
    bio: parsed.data.bio || null,
    is_active: parsed.data.is_active,
  };

  let providerId = parsed.data.id;
  if (providerId) {
    const { error } = await supabase
      .from("providers")
      .update(row)
      .eq("id", providerId)
      .eq("tenant_id", tenantId);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await supabase
      .from("providers")
      .insert(row)
      .select("id")
      .single();
    if (error) return { error: error.message };
    providerId = data.id;
  }

  // Sync services offered: incoming as service_ids[]
  const serviceIds = formData.getAll("service_ids").filter((v): v is string => typeof v === "string");
  await supabase.from("provider_services").delete().eq("provider_id", providerId);
  if (serviceIds.length > 0) {
    const { error: insErr } = await supabase
      .from("provider_services")
      .insert(serviceIds.map((sid) => ({ provider_id: providerId!, service_id: sid, tenant_id: tenantId })));
    if (insErr) return { error: insErr.message };
  }

  revalidatePath("/admin/providers");
  return { success: parsed.data.id ? "Provider updated." : "Provider created." };
}

export async function archiveProviderAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string") return;
  const { supabase, tenantId } = await requireTenant();
  await supabase
    .from("providers")
    .update({ is_active: false })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  revalidatePath("/admin/providers");
}

export async function restoreProviderAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string") return;
  const { supabase, tenantId } = await requireTenant();
  await supabase
    .from("providers")
    .update({ is_active: true })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  revalidatePath("/admin/providers");
}

// =========================================================================
// Schedule blocks
// =========================================================================
const scheduleSchema = z.object({
  provider_id: z.string().uuid(),
  weekday: z.coerce.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Invalid start time"),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Invalid end time"),
});

export async function addScheduleBlockAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = scheduleSchema.safeParse({
    provider_id: formData.get("provider_id"),
    weekday: formData.get("weekday"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  if (parsed.data.start_time >= parsed.data.end_time) {
    return { error: "End time must be after start time." };
  }

  const { supabase, tenantId } = await requireTenant();
  const { error } = await supabase.from("provider_schedules").insert({
    tenant_id: tenantId,
    provider_id: parsed.data.provider_id,
    weekday: parsed.data.weekday,
    start_time: parsed.data.start_time,
    end_time: parsed.data.end_time,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/providers");
  return { success: "Schedule block added." };
}

export async function deleteScheduleBlockAction(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string") return;
  const { supabase, tenantId } = await requireTenant();
  await supabase
    .from("provider_schedules")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);
  revalidatePath("/admin/providers");
}
