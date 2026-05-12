"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/admin/require-tenant";
import type { ActionState } from "@/lib/admin/action-state";
import { normalizeTenantSettings } from "@/lib/tenants/settings";

function parseIntegerField(
  formData: FormData,
  name: string,
  label: string,
  min: number,
  max: number
) {
  const value = formData.get(name);
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return { error: `${label} must be a whole number.` } as const;
  }
  if (parsed < min || parsed > max) {
    return { error: `${label} must be between ${min} and ${max}.` } as const;
  }

  return { value: parsed } as const;
}

function parseMoneyField(
  formData: FormData,
  name: string,
  label: string,
  minCents: number,
  maxCents: number
) {
  const value = formData.get(name);
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return { error: `${label} must be a valid dollar amount.` } as const;
  }

  const cents = Math.round(parsed * 100);
  if (cents < minCents || cents > maxCents) {
    return {
      error: `${label} must be between $${(minCents / 100).toFixed(2)} and $${(maxCents / 100).toFixed(2)}.`,
    } as const;
  }

  return { value: cents } as const;
}

export async function updateTenantSettingsAction(
  _: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, tenantId, role } = await requireTenant();

  if (role !== "owner" && role !== "manager") {
    return { error: "Only owners and managers can update business settings." };
  }

  const cancellationWindow = parseIntegerField(
    formData,
    "cancellation_window_hours",
    "Cancellation window",
    0,
    168
  );
  if ("error" in cancellationWindow) return { error: cancellationWindow.error };

  const reminderHours = parseIntegerField(
    formData,
    "reminder_hours_before",
    "Reminder timing",
    1,
    168
  );
  if ("error" in reminderHours) return { error: reminderHours.error };

  const minLeadTime = parseIntegerField(
    formData,
    "min_lead_time_minutes",
    "Minimum lead time",
    0,
    10080
  );
  if ("error" in minLeadTime) return { error: minLeadTime.error };

  const maxAdvanceBooking = parseIntegerField(
    formData,
    "max_advance_booking_days",
    "Maximum advance booking",
    1,
    365
  );
  if ("error" in maxAdvanceBooking) return { error: maxAdvanceBooking.error };

  const defaultDeposit = parseMoneyField(
    formData,
    "default_deposit_dollars",
    "Default deposit",
    0,
    10_000_000
  );
  if ("error" in defaultDeposit) return { error: defaultDeposit.error };

  const noShowFee = parseMoneyField(
    formData,
    "no_show_fee_dollars",
    "No-show fee",
    0,
    10_000_000
  );
  if ("error" in noShowFee) return { error: noShowFee.error };

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("settings_json")
    .eq("id", tenantId)
    .maybeSingle();

  if (tenantError || !tenant) {
    return { error: tenantError?.message ?? "Could not load current business settings." };
  }

  const currentSettings = normalizeTenantSettings(
    (tenant.settings_json ?? null) as Partial<Record<string, unknown>> | null
  );

  const nextSettings = {
    ...currentSettings,
    cancellation_window_hours: cancellationWindow.value,
    refund_inside_window: formData.get("refund_inside_window") === "on",
    default_deposit_cents: defaultDeposit.value,
    reminder_hours_before: reminderHours.value,
    no_show_fee_cents: noShowFee.value,
    min_lead_time_minutes: minLeadTime.value,
    max_advance_booking_days: maxAdvanceBooking.value,
    auto_charge_no_show_fee: formData.get("auto_charge_no_show_fee") === "on",
  };

  const { error: updateError } = await supabase
    .from("tenants")
    .update({ settings_json: nextSettings })
    .eq("id", tenantId);

  if (updateError) {
    return { error: updateError.message };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/onboarding");
  revalidatePath("/admin/services");

  return { success: "Business settings updated." };
}