"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/admin/require-tenant";
import type { ActionState } from "@/lib/admin/action-state";

const locationSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  slug: z.string().trim().max(120).optional().or(z.literal("")),
  timezone: z.string().trim().min(1, "Timezone is required").max(120),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email("Email must be valid").max(120).optional().or(z.literal("")),
  address_line1: z.string().trim().max(200).optional().or(z.literal("")),
  address_line2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  state_region: z.string().trim().max(120).optional().or(z.literal("")),
  postal_code: z.string().trim().max(40).optional().or(z.literal("")),
  country_code: z.string().trim().max(2).optional().or(z.literal("")),
  sort_order: z.coerce.number().int().min(0).max(9999).default(0),
  is_active: z.preprocess((value) => value === "on" || value === true || value === "true", z.boolean()).default(true),
});

const locationIdSchema = z.object({
  id: z.string().uuid(),
});

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function toNullable(value: string | undefined) {
  return value && value.length > 0 ? value : null;
}

function mapLocationError(message: string) {
  if (message.includes("locations_tenant_id_slug_key")) {
    return "Slug already exists for another location.";
  }

  return message;
}

async function loadDefaultLocationId(supabase: Awaited<ReturnType<typeof requireTenant>>["supabase"], tenantId: string) {
  const { data: tenant } = await supabase
    .from("tenants")
    .select("default_location_id")
    .eq("id", tenantId)
    .maybeSingle();

  return tenant?.default_location_id ?? null;
}

export async function upsertLocationAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = locationSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    slug: formData.get("slug") ?? "",
    timezone: formData.get("timezone"),
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    address_line1: formData.get("address_line1") ?? "",
    address_line2: formData.get("address_line2") ?? "",
    city: formData.get("city") ?? "",
    state_region: formData.get("state_region") ?? "",
    postal_code: formData.get("postal_code") ?? "",
    country_code: formData.get("country_code") ?? "",
    sort_order: formData.get("sort_order") ?? 0,
    is_active: formData.get("is_active") ?? false,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { supabase, tenantId, role } = await requireTenant();
  if (role !== "owner" && role !== "manager") {
    return { error: "Only owners and managers can update locations." };
  }

  const slug = normalizeSlug(parsed.data.slug || parsed.data.name);
  if (!slug) {
    return { error: "Slug must contain letters or numbers." };
  }

  const defaultLocationId = await loadDefaultLocationId(supabase, tenantId);
  if (parsed.data.id && !parsed.data.is_active && parsed.data.id === defaultLocationId) {
    return { error: "Set another default location before archiving this one." };
  }

  const row = {
    tenant_id: tenantId,
    name: parsed.data.name,
    slug,
    timezone: parsed.data.timezone,
    phone: toNullable(parsed.data.phone),
    email: toNullable(parsed.data.email),
    address_line1: toNullable(parsed.data.address_line1),
    address_line2: toNullable(parsed.data.address_line2),
    city: toNullable(parsed.data.city),
    state_region: toNullable(parsed.data.state_region),
    postal_code: toNullable(parsed.data.postal_code),
    country_code: parsed.data.country_code ? parsed.data.country_code.toUpperCase() : null,
    sort_order: parsed.data.sort_order,
    is_active: parsed.data.is_active,
  };

  if (parsed.data.id) {
    const { error } = await supabase
      .from("locations")
      .update(row)
      .eq("id", parsed.data.id)
      .eq("tenant_id", tenantId);
    if (error) return { error: mapLocationError(error.message) };
  } else {
    const { error } = await supabase.from("locations").insert(row);
    if (error) return { error: mapLocationError(error.message) };
  }

  revalidatePath("/admin/locations");
  revalidatePath("/admin/onboarding");
  return { success: parsed.data.id ? "Location updated." : "Location created." };
}

export async function archiveLocationAction(formData: FormData): Promise<void> {
  const parsed = locationIdSchema.safeParse({
    id: formData.get("id"),
  });
  if (!parsed.success) return;

  const { supabase, tenantId, role } = await requireTenant();
  if (role !== "owner" && role !== "manager") return;

  const defaultLocationId = await loadDefaultLocationId(supabase, tenantId);
  if (parsed.data.id === defaultLocationId) return;

  await supabase
    .from("locations")
    .update({ is_active: false })
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId);

  revalidatePath("/admin/locations");
}

export async function restoreLocationAction(formData: FormData): Promise<void> {
  const parsed = locationIdSchema.safeParse({
    id: formData.get("id"),
  });
  if (!parsed.success) return;

  const { supabase, tenantId, role } = await requireTenant();
  if (role !== "owner" && role !== "manager") return;

  await supabase
    .from("locations")
    .update({ is_active: true })
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId);

  revalidatePath("/admin/locations");
}

export async function setDefaultLocationAction(formData: FormData): Promise<void> {
  const parsed = locationIdSchema.safeParse({
    id: formData.get("id"),
  });
  if (!parsed.success) return;

  const { supabase, tenantId, role } = await requireTenant();
  if (role !== "owner" && role !== "manager") return;

  const { data: location } = await supabase
    .from("locations")
    .select("id, is_active")
    .eq("id", parsed.data.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!location || !location.is_active) return;

  await supabase
    .from("tenants")
    .update({ default_location_id: parsed.data.id })
    .eq("id", tenantId);

  revalidatePath("/admin/locations");
  revalidatePath("/admin/onboarding");
}