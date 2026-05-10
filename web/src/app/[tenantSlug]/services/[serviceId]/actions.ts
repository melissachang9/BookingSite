/**
 * Server Actions for the public booking site: load available slots, create a booking draft.
 *
 * These run as the anon role (no auth). Tenant safety is enforced in code by always
 * scoping queries to the `tenantId` provided + cross-checking via the admin client.
 */
"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAvailableSlots } from "@/lib/booking/availability";

const SlotsInput = z.object({
  tenantId: z.string().uuid(),
  serviceId: z.string().uuid(),
  providerId: z.string().uuid(),
  // YYYY-MM-DD (UTC day window).
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type LoadSlotsResult = {
  ok: boolean;
  error?: string;
  slots?: { starts_at: string; ends_at: string }[];
};

export async function loadSlotsAction(input: z.infer<typeof SlotsInput>): Promise<LoadSlotsResult> {
  const parsed = SlotsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const day = new Date(`${parsed.data.date}T00:00:00.000Z`);
  const dayEnd = new Date(day.getTime() + 24 * 60 * 60_000);

  const slots = await getAvailableSlots({
    tenantId: parsed.data.tenantId,
    serviceId: parsed.data.serviceId,
    providerId: parsed.data.providerId,
    rangeStart: day,
    rangeEnd: dayEnd,
  });

  return { ok: true, slots };
}

const HoldInput = z.object({
  tenantId: z.string().uuid(),
  serviceId: z.string().uuid(),
  providerId: z.string().uuid(),
  startsAt: z.string().datetime(),
});

export type HoldResult = { ok: boolean; error?: string; draftId?: string };

/**
 * Create a booking draft + slot hold for the chosen time. The hold blocks the slot
 * from showing as available to other customers until expires_at.
 */
export async function createBookingDraftAction(input: z.infer<typeof HoldInput>): Promise<HoldResult> {
  const parsed = HoldInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const admin = createAdminClient();

  // Re-validate: service active, belongs to tenant, provider active, link exists.
  const { data: service } = await admin
    .from("services")
    .select("id, tenant_id, duration_minutes, buffer_before_minutes, buffer_after_minutes, is_active")
    .eq("id", parsed.data.serviceId)
    .maybeSingle();
  if (!service || service.tenant_id !== parsed.data.tenantId || !service.is_active) {
    return { ok: false, error: "Service unavailable" };
  }

  const { data: provider } = await admin
    .from("providers")
    .select("id, tenant_id, is_active")
    .eq("id", parsed.data.providerId)
    .maybeSingle();
  if (!provider || provider.tenant_id !== parsed.data.tenantId || !provider.is_active) {
    return { ok: false, error: "Provider unavailable" };
  }

  const { data: link } = await admin
    .from("provider_services")
    .select("provider_id")
    .eq("provider_id", parsed.data.providerId)
    .eq("service_id", parsed.data.serviceId)
    .maybeSingle();
  if (!link) return { ok: false, error: "Provider does not offer this service" };

  // Recompute slot bounds server-side. Outer = buffer_before + duration + buffer_after.
  const apptStart = new Date(parsed.data.startsAt);
  const apptEnd = new Date(apptStart.getTime() + service.duration_minutes * 60_000);
  const outerStart = new Date(apptStart.getTime() - service.buffer_before_minutes * 60_000);
  const outerEnd = new Date(apptEnd.getTime() + service.buffer_after_minutes * 60_000);

  // Verify the slot is still available right now.
  const dayStart = new Date(apptStart);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
  const fresh = await getAvailableSlots({
    tenantId: parsed.data.tenantId,
    serviceId: parsed.data.serviceId,
    providerId: parsed.data.providerId,
    rangeStart: dayStart,
    rangeEnd: dayEnd,
  });
  const stillAvailable = fresh.some(
    (s) => s.starts_at === apptStart.toISOString() && s.ends_at === apptEnd.toISOString()
  );
  if (!stillAvailable) {
    return { ok: false, error: "Slot is no longer available. Please pick another time." };
  }

  // 15-minute hold TTL — long enough to fill the form + checkout, short enough to release if abandoned.
  const HOLD_MINUTES = 15;
  const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);

  const { data: draft, error: draftErr } = await admin
    .from("booking_drafts")
    .insert({
      tenant_id: parsed.data.tenantId,
      service_id: parsed.data.serviceId,
      provider_id: parsed.data.providerId,
      starts_at: apptStart.toISOString(),
      ends_at: apptEnd.toISOString(),
      status: "draft",
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();
  if (draftErr || !draft) return { ok: false, error: draftErr?.message ?? "Failed to create draft" };

  const { error: holdErr } = await admin.from("slot_holds").insert({
    tenant_id: parsed.data.tenantId,
    provider_id: parsed.data.providerId,
    booking_draft_id: draft.id,
    starts_at: outerStart.toISOString(),
    ends_at: outerEnd.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  if (holdErr) {
    // Roll back the draft if the hold fails.
    await admin.from("booking_drafts").delete().eq("id", draft.id);
    return { ok: false, error: holdErr.message };
  }

  // Generate booking_form_requirements for any forms attached to this service.
  const { data: requiredForms } = await admin
    .from("service_forms")
    .select("form_id, forms!inner(id, current_version_id, is_archived)")
    .eq("service_id", parsed.data.serviceId)
    .eq("tenant_id", parsed.data.tenantId);

  const reqRows = (requiredForms ?? [])
    .map((row) => {
      const form = row.forms as unknown as {
        id: string;
        current_version_id: string | null;
        is_archived: boolean;
      };
      if (!form || form.is_archived || !form.current_version_id) return null;
      return {
        tenant_id: parsed.data.tenantId,
        booking_draft_id: draft.id,
        form_id: form.id,
        form_version_id: form.current_version_id,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (reqRows.length > 0) {
    await admin.from("booking_form_requirements").insert(reqRows);
    // If any forms are required, the draft starts in awaiting_form (not draft).
    await admin
      .from("booking_drafts")
      .update({ status: "awaiting_form" })
      .eq("id", draft.id);
  }

  return { ok: true, draftId: draft.id };
}

const SubmitDetailsInput = z.object({
  draftId: z.string().uuid(),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().min(7).max(40),
});

export type SubmitDetailsResult = { ok: boolean; error?: string };

/**
 * Phase 2 ends here: the customer enters name/email/phone and we mark the draft as
 * `awaiting_payment`. Phase 4 will hand off to Stripe Checkout from this point.
 */
export async function submitBookingDetailsAction(
  input: z.infer<typeof SubmitDetailsInput>
): Promise<SubmitDetailsResult> {
  const parsed = SubmitDetailsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const admin = createAdminClient();
  const { data: draft } = await admin
    .from("booking_drafts")
    .select("id, status, expires_at, tenant_id")
    .eq("id", parsed.data.draftId)
    .maybeSingle();
  if (!draft) return { ok: false, error: "Booking not found" };
  if (new Date(draft.expires_at) < new Date()) {
    return { ok: false, error: "Your hold has expired. Please pick a new time." };
  }
  if (draft.status === "promoted") return { ok: false, error: "Already booked" };

  // Upsert customer by (tenant_id, email).
  const { data: existing } = await admin
    .from("customers")
    .select("id")
    .eq("tenant_id", draft.tenant_id)
    .eq("email", parsed.data.email)
    .maybeSingle();

  let customerId = existing?.id;
  if (!customerId) {
    const { data: created, error: cErr } = await admin
      .from("customers")
      .insert({
        tenant_id: draft.tenant_id,
        email: parsed.data.email,
        name: parsed.data.name,
        phone: parsed.data.phone,
      })
      .select("id")
      .single();
    if (cErr || !created) return { ok: false, error: cErr?.message ?? "Failed to save customer" };
    customerId = created.id;
  }

  const { error: uErr } = await admin
    .from("booking_drafts")
    .update({
      customer_id: customerId,
      customer_name: parsed.data.name,
      customer_email: parsed.data.email,
      customer_phone: parsed.data.phone,
      status: "awaiting_payment",
    })
    .eq("id", parsed.data.draftId);
  if (uErr) return { ok: false, error: uErr.message };

  return { ok: true };
}
