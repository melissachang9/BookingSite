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

function dedupeIds(values: FormDataEntryValue[]) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string")));
}

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
  const locationIds = dedupeIds(formData.getAll("location_ids"));
  if (locationIds.length === 0) {
    return { error: "Select at least one location." };
  }

  const { data: allowedLocations } = await supabase
    .from("locations")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("id", locationIds);
  if ((allowedLocations ?? []).length !== locationIds.length) {
    return { error: "One or more selected locations are invalid." };
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("default_location_id")
    .eq("id", tenantId)
    .maybeSingle();

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
  const serviceIds = dedupeIds(formData.getAll("service_ids"));
  await supabase.from("provider_services").delete().eq("provider_id", providerId);
  if (serviceIds.length > 0) {
    const { error: insErr } = await supabase
      .from("provider_services")
      .insert(serviceIds.map((sid) => ({ provider_id: providerId!, service_id: sid, tenant_id: tenantId })));
    if (insErr) return { error: insErr.message };
  }

  // Sync locations offered.
  const primaryLocationId = locationIds.includes(tenant?.default_location_id ?? "")
    ? tenant?.default_location_id ?? locationIds[0]
    : locationIds[0];
  await supabase.from("provider_locations").delete().eq("provider_id", providerId);
  const { error: locationErr } = await supabase.from("provider_locations").insert(
    locationIds.map((locationId) => ({
      provider_id: providerId!,
      location_id: locationId,
      tenant_id: tenantId,
      is_primary: locationId === primaryLocationId,
    }))
  );
  if (locationErr) return { error: locationErr.message };

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
  location_id: z.string().uuid(),
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
    location_id: formData.get("location_id"),
    weekday: formData.get("weekday"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  if (parsed.data.start_time >= parsed.data.end_time) {
    return { error: "End time must be after start time." };
  }

  const { supabase, tenantId } = await requireTenant();
  const { data: providerLocation } = await supabase
    .from("provider_locations")
    .select("provider_id")
    .eq("tenant_id", tenantId)
    .eq("provider_id", parsed.data.provider_id)
    .eq("location_id", parsed.data.location_id)
    .maybeSingle();
  if (!providerLocation) {
    return { error: "Assign this provider to the location before adding schedule blocks there." };
  }

  const { error } = await supabase.from("provider_schedules").insert({
    tenant_id: tenantId,
    provider_id: parsed.data.provider_id,
    location_id: parsed.data.location_id,
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
