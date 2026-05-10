"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/admin/require-tenant";
import type { ActionState } from "@/lib/admin/action-state";

const serviceSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  duration_minutes: z.coerce.number().int().min(5).max(600),
  price_cents: z.coerce.number().int().min(0).max(10_000_000),
  deposit_cents: z.coerce.number().int().min(0).max(10_000_000),
  buffer_before_minutes: z.coerce.number().int().min(0).max(240).default(0),
  buffer_after_minutes: z.coerce.number().int().min(0).max(240).default(0),
  is_active: z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean()).default(true),
});

function dollarsToCents(formData: FormData, key: string) {
  const raw = formData.get(key);
  if (raw === null || raw === "") return 0;
  const dollars = Number(raw);
  if (!Number.isFinite(dollars)) return Number.NaN;
  return Math.round(dollars * 100);
}

export async function upsertServiceAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = serviceSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    duration_minutes: formData.get("duration_minutes"),
    price_cents: dollarsToCents(formData, "price_dollars"),
    deposit_cents: dollarsToCents(formData, "deposit_dollars"),
    buffer_before_minutes: formData.get("buffer_before_minutes") ?? 0,
    buffer_after_minutes: formData.get("buffer_after_minutes") ?? 0,
    is_active: formData.get("is_active") ?? false,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  if (parsed.data.deposit_cents > parsed.data.price_cents) {
    return { error: "Deposit cannot exceed price." };
  }

  const { supabase, tenantId } = await requireTenant();

  const row = {
    tenant_id: tenantId,
    name: parsed.data.name,
    description: parsed.data.description || null,
    duration_minutes: parsed.data.duration_minutes,
    price_cents: parsed.data.price_cents,
    deposit_cents: parsed.data.deposit_cents,
    buffer_before_minutes: parsed.data.buffer_before_minutes,
    buffer_after_minutes: parsed.data.buffer_after_minutes,
    is_active: parsed.data.is_active,
  };

  if (parsed.data.id) {
    const { error } = await supabase
      .from("services")
      .update(row)
      .eq("id", parsed.data.id)
      .eq("tenant_id", tenantId);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("services").insert(row);
    if (error) return { error: error.message };
  }

  revalidatePath("/admin/services");
  return { success: parsed.data.id ? "Service updated." : "Service created." };
}

export async function archiveServiceAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") return;
  const { supabase, tenantId } = await requireTenant();
  await supabase
    .from("services")
    .update({ is_active: false })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  revalidatePath("/admin/services");
}

export async function restoreServiceAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") return;
  const { supabase, tenantId } = await requireTenant();
  await supabase
    .from("services")
    .update({ is_active: true })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  revalidatePath("/admin/services");
}
