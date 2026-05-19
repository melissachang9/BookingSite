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
import { applyProviderServiceOverrides } from "@/lib/services/provider-service";
import {
  filterServiceCustomerFormsByTiming,
  loadServiceCustomerForms,
  toBookingFormRequirementRows,
} from "@/lib/forms/service-customer-forms";
import {
  addMonthsToDateOnly,
  getLocalDateString,
  getUtcRangeForLocalDate,
  getUtcRangeForLocalMonth,
} from "@/lib/datetime/timezone";

const SlotsInput = z.object({
  tenantId: z.string().uuid(),
  serviceId: z.string().uuid(),
  locationId: z.string().uuid(),
  providerId: z.string().uuid().optional(),
  // YYYY-MM-DD (UTC day window).
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type LoadSlotsResult = {
  ok: boolean;
  error?: string;
  slots?: {
    starts_at: string;
    ends_at: string;
    provider_id: string;
    provider_name: string;
  }[];
};

export async function loadSlotsAction(input: z.infer<typeof SlotsInput>): Promise<LoadSlotsResult> {
  const parsed = SlotsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const admin = createAdminClient();
  const timeZone = await loadTenantTimeZone(admin, parsed.data.tenantId);
  const dayRange = getUtcRangeForLocalDate(parsed.data.date, timeZone);
  const providers = await loadBookableProviders(admin, {
    tenantId: parsed.data.tenantId,
    serviceId: parsed.data.serviceId,
    locationId: parsed.data.locationId,
    providerId: parsed.data.providerId,
  });

  if (providers.length === 0) {
    return { ok: true, slots: [] };
  }

  const slots = await loadSlotsForProviders({
    tenantId: parsed.data.tenantId,
    serviceId: parsed.data.serviceId,
    locationId: parsed.data.locationId,
    providers,
    rangeStart: dayRange.start,
    rangeEnd: dayRange.end,
  });

  return { ok: true, slots };
}

const MonthAvailabilityInput = z.object({
  tenantId: z.string().uuid(),
  serviceId: z.string().uuid(),
  locationId: z.string().uuid(),
  providerId: z.string().uuid().optional(),
  // YYYY-MM-DD month anchor. The UI always sends the first day of the month.
  month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type LoadMonthAvailabilityResult = {
  ok: boolean;
  error?: string;
  availability?: { date: string; slotCount: number }[];
};

export async function loadMonthAvailabilityAction(
  input: z.infer<typeof MonthAvailabilityInput>
): Promise<LoadMonthAvailabilityResult> {
  const parsed = MonthAvailabilityInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const admin = createAdminClient();
  const timeZone = await loadTenantTimeZone(admin, parsed.data.tenantId);
  const monthRange = getUtcRangeForLocalMonth(parsed.data.month, timeZone);
  const providers = await loadBookableProviders(admin, {
    tenantId: parsed.data.tenantId,
    serviceId: parsed.data.serviceId,
    locationId: parsed.data.locationId,
    providerId: parsed.data.providerId,
  });

  if (providers.length === 0) {
    return { ok: true, availability: [] };
  }

  const slots = await loadSlotsForProviders({
    tenantId: parsed.data.tenantId,
    serviceId: parsed.data.serviceId,
    locationId: parsed.data.locationId,
    providers,
    rangeStart: monthRange.start,
    rangeEnd: monthRange.end,
  });

  const uniqueSlotsByDate = new Map<string, Set<string>>();
  for (const slot of slots) {
    const date = getLocalDateString(slot.starts_at, timeZone);
    const slotKey = `${slot.starts_at}:${slot.ends_at}`;
    const existing = uniqueSlotsByDate.get(date) ?? new Set<string>();
    existing.add(slotKey);
    uniqueSlotsByDate.set(date, existing);
  }

  return {
    ok: true,
    availability: Array.from(uniqueSlotsByDate.entries()).map(([date, slotKeys]) => ({
      date,
      slotCount: slotKeys.size,
    })),
  };
}

const NextAvailableInput = z.object({
  tenantId: z.string().uuid(),
  serviceId: z.string().uuid(),
  locationId: z.string().uuid(),
  providerId: z.string().uuid().optional(),
});

export type LoadNextAvailableResult = {
  ok: boolean;
  error?: string;
  nextSlot?: {
    date: string;
    starts_at: string;
    ends_at: string;
    provider_id: string;
    provider_name: string;
    candidate_provider_ids: string[];
  };
  jumpSlot?: {
    date: string;
    starts_at: string;
    ends_at: string;
    provider_id: string;
    provider_name: string;
    candidate_provider_ids: string[];
  };
};

export async function loadNextAvailableAction(
  input: z.infer<typeof NextAvailableInput>
): Promise<LoadNextAvailableResult> {
  const parsed = NextAvailableInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const admin = createAdminClient();
  const timeZone = await loadTenantTimeZone(admin, parsed.data.tenantId);
  const providers = await loadBookableProviders(admin, {
    tenantId: parsed.data.tenantId,
    serviceId: parsed.data.serviceId,
    locationId: parsed.data.locationId,
    providerId: parsed.data.providerId,
  });

  if (providers.length === 0) {
    return { ok: true };
  }

  const todayLocalDate = getLocalDateString(new Date(), timeZone);
  const currentMonthAnchor = `${todayLocalDate.slice(0, 7)}-01`;
  const orderedAvailability: Array<{
    starts_at: string;
    ends_at: string;
    providers: { id: string; name: string }[];
  }> = [];

  // Search across the current month plus the next 3 months, which covers the
  // default 90-day booking horizon without hammering the database day-by-day.
  for (let monthOffset = 0; monthOffset < 4; monthOffset += 1) {
    const monthAnchor = addMonthsToDateOnly(currentMonthAnchor, monthOffset);
    const monthRange = getUtcRangeForLocalMonth(monthAnchor, timeZone);
    const slots = await loadSlotsForProviders({
      tenantId: parsed.data.tenantId,
      serviceId: parsed.data.serviceId,
      locationId: parsed.data.locationId,
      providers,
      rangeStart: monthRange.start,
      rangeEnd: monthRange.end,
    });

    if (slots.length === 0) {
      continue;
    }

    orderedAvailability.push(...groupSlotsByTime(slots));
    if (orderedAvailability.length >= 2) {
      break;
    }
  }

  if (orderedAvailability.length === 0) {
    return { ok: true };
  }

  const nextSlot = formatAvailableSlot(orderedAvailability[0], timeZone);
  const jumpSlot = orderedAvailability[1]
    ? formatAvailableSlot(orderedAvailability[1], timeZone)
    : undefined;

  return {
    ok: true,
    nextSlot,
    jumpSlot,
  };

}

const HoldInput = z.object({
  tenantId: z.string().uuid(),
  serviceId: z.string().uuid(),
  locationId: z.string().uuid(),
  providerId: z.string().uuid(),
  candidateProviderIds: z.array(z.string().uuid()).min(1).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
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
  const timeZone = await loadTenantTimeZone(admin, parsed.data.tenantId);
  const providerIdsToTry = dedupeProviderIds([
    ...(parsed.data.candidateProviderIds ?? []),
    parsed.data.providerId,
  ]);

  // Re-validate: service active, belongs to tenant.
  const { data: service } = await admin
    .from("services")
    .select("id, tenant_id, price_cents, deposit_cents, duration_minutes, buffer_before_minutes, buffer_after_minutes, is_active")
    .eq("id", parsed.data.serviceId)
    .maybeSingle();
  if (!service || service.tenant_id !== parsed.data.tenantId || !service.is_active) {
    return { ok: false, error: "Service unavailable" };
  }

  const apptStart = new Date(parsed.data.startsAt);
  const apptEnd = new Date(parsed.data.endsAt);

  if (!(apptStart < apptEnd)) {
    return { ok: false, error: "Invalid time selection" };
  }

  const bookableProviders = await loadBookableProviders(admin, {
    tenantId: parsed.data.tenantId,
    serviceId: parsed.data.serviceId,
    locationId: parsed.data.locationId,
    providerIds: providerIdsToTry,
  });

  if (bookableProviders.length === 0) {
    return { ok: false, error: "Provider unavailable" };
  }

  // Verify the slot is still available right now for the first provider candidate that can take it.
  const localDate = getLocalDateString(apptStart, timeZone);
  const dayRange = getUtcRangeForLocalDate(localDate, timeZone);
  let selectedProvider: ProviderOption | null = null;

  for (const provider of bookableProviders) {
    const fresh = await getAvailableSlots({
      tenantId: parsed.data.tenantId,
      serviceId: parsed.data.serviceId,
        locationId: parsed.data.locationId,
      providerId: provider.id,
      rangeStart: dayRange.start,
      rangeEnd: dayRange.end,
    });

    const stillAvailable = fresh.some(
      (slot) => slot.starts_at === apptStart.toISOString() && slot.ends_at === apptEnd.toISOString()
    );

    if (stillAvailable) {
      selectedProvider = provider;
      break;
    }
  }

  if (!selectedProvider) {
    return { ok: false, error: "Slot is no longer available. Please pick another time." };
  }

  const effectiveService = applyProviderServiceOverrides(service, selectedProvider);
  const outerStart = new Date(apptStart.getTime() - service.buffer_before_minutes * 60_000);
  const outerEnd = new Date(apptEnd.getTime() + service.buffer_after_minutes * 60_000);

  // 15-minute hold TTL — long enough to fill the form + checkout, short enough to release if abandoned.
  const HOLD_MINUTES = 15;
  const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);

  const { data: draft, error: draftErr } = await admin
    .from("booking_drafts")
    .insert({
      tenant_id: parsed.data.tenantId,
      service_id: parsed.data.serviceId,
      location_id: parsed.data.locationId,
      provider_id: selectedProvider.id,
      starts_at: apptStart.toISOString(),
      ends_at: apptEnd.toISOString(),
      price_cents: effectiveService.price_cents,
      deposit_cents: effectiveService.deposit_cents,
      duration_minutes: effectiveService.duration_minutes,
      booking_method: "customer_self_service",
      source_channel: "online_booking",
      deposit_status: "unpaid",
      confirmation_requested: true,
      status: "draft",
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();
  if (draftErr || !draft) return { ok: false, error: draftErr?.message ?? "Failed to create draft" };

  const { error: holdErr } = await admin.from("slot_holds").insert({
    tenant_id: parsed.data.tenantId,
    location_id: parsed.data.locationId,
    provider_id: selectedProvider.id,
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

  let serviceCustomerForms;
  try {
    serviceCustomerForms = await loadServiceCustomerForms(admin, {
      tenantId: parsed.data.tenantId,
      serviceId: parsed.data.serviceId,
    });
  } catch (error) {
    await admin.from("slot_holds").delete().eq("booking_draft_id", draft.id);
    await admin.from("booking_drafts").delete().eq("id", draft.id);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to load service forms",
    };
  }

  const reqRows = toBookingFormRequirementRows(
    filterServiceCustomerFormsByTiming(serviceCustomerForms, "pre_booking"),
    {
      tenantId: parsed.data.tenantId,
      bookingDraftId: draft.id,
    }
  );

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

async function loadTenantTimeZone(admin: ReturnType<typeof createAdminClient>, tenantId: string) {
  const { data: tenant } = await admin
    .from("tenants")
    .select("timezone")
    .eq("id", tenantId)
    .maybeSingle();
  return tenant?.timezone ?? "America/Los_Angeles";
}

type ProviderOption = {
  id: string;
  name: string;
  sort_order: number;
  price_cents_override: number | null;
  deposit_cents_override: number | null;
  duration_minutes_override: number | null;
};

async function loadBookableProviders(
  admin: ReturnType<typeof createAdminClient>,
  opts: { tenantId: string; serviceId: string; locationId: string; providerId?: string; providerIds?: string[] }
) {
  const { data: serviceLocation } = await admin
    .from("service_locations")
    .select("location_id")
    .eq("tenant_id", opts.tenantId)
    .eq("service_id", opts.serviceId)
    .eq("location_id", opts.locationId)
    .maybeSingle();
  if (!serviceLocation) {
    return [];
  }

  let providerLocationIdsQuery = admin
    .from("provider_locations")
    .select("provider_id")
    .eq("tenant_id", opts.tenantId)
    .eq("location_id", opts.locationId);

  if (opts.providerId) {
    providerLocationIdsQuery = providerLocationIdsQuery.eq("provider_id", opts.providerId);
  }

  if (opts.providerIds && opts.providerIds.length > 0) {
    providerLocationIdsQuery = providerLocationIdsQuery.in("provider_id", opts.providerIds);
  }

  const { data: providerLocationRows } = await providerLocationIdsQuery;
  let candidateProviderIds = dedupeProviderIds((providerLocationRows ?? []).map((row) => row.provider_id));

  if (opts.providerId) {
    candidateProviderIds = candidateProviderIds.filter((providerId) => providerId === opts.providerId);
  }

  if (opts.providerIds && opts.providerIds.length > 0) {
    const requestedIds = new Set(opts.providerIds);
    candidateProviderIds = candidateProviderIds.filter((providerId) => requestedIds.has(providerId));
  }

  if (candidateProviderIds.length === 0) {
    return [];
  }

  const { data: providerLinks } = await admin
    .from("provider_services")
    .select("provider_id, price_cents_override, deposit_cents_override, duration_minutes_override, providers!inner(id, name, is_active, sort_order, tenant_id)")
    .eq("tenant_id", opts.tenantId)
    .eq("service_id", opts.serviceId)
    .in("provider_id", candidateProviderIds);

  const providers = (providerLinks ?? [])
    .map((row) => {
      const provider = row.providers as unknown as {
        id: string;
        name: string;
        is_active: boolean;
        sort_order: number | null;
        tenant_id: string;
      };

      if (!provider || !provider.is_active || provider.tenant_id !== opts.tenantId) {
        return null;
      }

      return {
        id: provider.id,
        name: provider.name,
        sort_order: provider.sort_order ?? 0,
        price_cents_override:
          typeof row.price_cents_override === "number" ? row.price_cents_override : null,
        deposit_cents_override:
          typeof row.deposit_cents_override === "number" ? row.deposit_cents_override : null,
        duration_minutes_override:
          typeof row.duration_minutes_override === "number" ? row.duration_minutes_override : null,
      } satisfies ProviderOption;
    })
    .filter((provider): provider is ProviderOption => provider !== null)
    .sort(
      (left, right) =>
        (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.name.localeCompare(right.name)
    );

  if (!opts.providerIds || opts.providerIds.length === 0) {
    return providers;
  }

  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  return opts.providerIds
    .map((providerId) => providersById.get(providerId))
    .filter((provider): provider is ProviderOption => provider !== undefined);
}

async function loadSlotsForProviders(opts: {
  tenantId: string;
  serviceId: string;
  locationId: string;
  providers: ProviderOption[];
  rangeStart: Date;
  rangeEnd: Date;
}) {
  const slotGroups = await Promise.all(
    opts.providers.map(async (provider) => {
      const slots = await getAvailableSlots({
        tenantId: opts.tenantId,
        serviceId: opts.serviceId,
        locationId: opts.locationId,
        providerId: provider.id,
        rangeStart: opts.rangeStart,
        rangeEnd: opts.rangeEnd,
      });

      return slots.map((slot) => ({
        ...slot,
        provider_id: provider.id,
        provider_name: provider.name,
        provider_sort_order: provider.sort_order,
      }));
    })
  );

  return slotGroups
    .flat()
    .sort(
      (left, right) =>
        left.starts_at.localeCompare(right.starts_at) ||
        left.provider_sort_order - right.provider_sort_order ||
        left.provider_name.localeCompare(right.provider_name)
    )
    .map((slot) => ({
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      provider_id: slot.provider_id,
      provider_name: slot.provider_name,
    }));
}

function groupSlotsByTime(slots: {
  starts_at: string;
  ends_at: string;
  provider_id: string;
  provider_name: string;
}[]) {
  const grouped = new Map<
    string,
    {
      starts_at: string;
      ends_at: string;
      providers: { id: string; name: string }[];
    }
  >();

  for (const slot of slots) {
    const key = `${slot.starts_at}:${slot.ends_at}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.providers.push({ id: slot.provider_id, name: slot.provider_name });
      continue;
    }

    grouped.set(key, {
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      providers: [{ id: slot.provider_id, name: slot.provider_name }],
    });
  }

  return Array.from(grouped.values());
}

function formatAvailableSlot(
  slot: {
    starts_at: string;
    ends_at: string;
    providers: { id: string; name: string }[];
  },
  timeZone: string
) {
  return {
    date: getLocalDateString(slot.starts_at, timeZone),
    starts_at: slot.starts_at,
    ends_at: slot.ends_at,
    provider_id: slot.providers[0]?.id ?? "",
    provider_name: slot.providers[0]?.name ?? "",
    candidate_provider_ids: slot.providers.map((provider) => provider.id),
  };
}

function dedupeProviderIds(providerIds: string[]) {
  return Array.from(new Set(providerIds));
}

const SubmitDetailsInput = z.object({
  draftId: z.string().uuid(),
  name: z.string().min(1).max(120),
  email: z.string().email(),
  phone: z.string().min(7).max(40),
});

const SaveDetailsDraftInput = z.object({
  draftId: z.string().uuid(),
  name: z.string().max(120),
  email: z.string().max(240),
  phone: z.string().max(40),
});

export type SubmitDetailsResult = { ok: boolean; error?: string };
export type SaveDetailsDraftResult = { ok: boolean; error?: string; savedAt?: string };

export async function saveBookingDetailsDraftAction(
  input: z.infer<typeof SaveDetailsDraftInput>
): Promise<SaveDetailsDraftResult> {
  const parsed = SaveDetailsDraftInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const admin = createAdminClient();
  const { data: draft } = await admin
    .from("booking_drafts")
    .select("id, status, expires_at")
    .eq("id", parsed.data.draftId)
    .maybeSingle();
  if (!draft) return { ok: false, error: "Booking not found" };
  if (new Date(draft.expires_at) < new Date()) {
    return { ok: false, error: "Your hold has expired. Please pick a new time." };
  }
  if (draft.status === "promoted") return { ok: false, error: "Already booked" };

  const nextDraftDetails = {
    name: parsed.data.name.trim(),
    email: parsed.data.email.trim(),
    phone: parsed.data.phone.trim(),
  };
  const hasDraftDetails = Object.values(nextDraftDetails).some((value) => value.length > 0);
  const savedAt = hasDraftDetails ? new Date().toISOString() : null;

  const { data: updated, error } = await admin
    .from("booking_drafts")
    .update({
      draft_contact_details_json: hasDraftDetails ? nextDraftDetails : null,
      draft_contact_details_saved_at: savedAt,
    })
    .eq("id", parsed.data.draftId)
    .select("draft_contact_details_saved_at")
    .single();
  if (error) return { ok: false, error: error.message };

  return { ok: true, savedAt: updated?.draft_contact_details_saved_at ?? undefined };
}

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
      draft_contact_details_json: null,
      draft_contact_details_saved_at: null,
      status: "awaiting_payment",
    })
    .eq("id", parsed.data.draftId);
  if (uErr) return { ok: false, error: uErr.message };

  return { ok: true };
}
