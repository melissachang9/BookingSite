/**
 * Availability engine.
 *
 * Given a service + provider + date range, returns the set of bookable start times.
 *
 * Inputs:
 *   - provider weekly schedule (recurring)
 *   - provider time off (one-off blocks)
 *   - confirmed bookings
 *   - active (non-expired) slot holds
 *   - service duration + buffers
 *   - tenant settings (min lead time, max advance days, slot granularity)
 *
 * Server-only — uses the admin client to read across tables that anon can't see
 * (time_off, confirmed bookings, slot_holds).
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyProviderServiceOverrides } from "@/lib/services/provider-service";
import {
  addDaysToDateOnly,
  getLocalDateString,
  getUtcRangeForLocalDate,
  getWeekdayInTimeZone,
  parseDateOnly,
  zonedDateTimeToUtc,
} from "@/lib/datetime/timezone";

export type AvailableSlot = {
  starts_at: string; // ISO
  ends_at: string;
};

type Service = {
  id: string;
  price_cents: number;
  deposit_cents: number;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
};

type Schedule = {
  weekday: number;
  start_time: string; // "HH:MM:SS"
  end_time: string;
};

type Range = { start: Date; end: Date };

/**
 * Slot granularity — how often a slot can start. 15 min is the practical floor for
 * beauty/wellness; we'll surface this as a tenant setting later.
 */
const SLOT_STEP_MINUTES = 15;

export async function getAvailableSlots(opts: {
  tenantId: string;
  serviceId: string;
  providerId: string;
  /** Start of the day-range (in tenant's local day boundary, but passed as ISO UTC). */
  rangeStart: Date;
  /** End of the day-range (exclusive). */
  rangeEnd: Date;
}): Promise<AvailableSlot[]> {
  const admin = createAdminClient();

  // Fetch service, provider, schedules, time off, bookings, holds in parallel.
  const [
    { data: service },
    { data: provider },
    { data: providerService },
    { data: schedules },
    { data: timeOff },
    { data: bookings },
    { data: holds },
    { data: tenant },
  ] = await Promise.all([
    admin
      .from("services")
      .select("id, price_cents, deposit_cents, duration_minutes, buffer_before_minutes, buffer_after_minutes, is_active, tenant_id")
      .eq("id", opts.serviceId)
      .maybeSingle(),
    admin
      .from("providers")
      .select("id, tenant_id, is_active")
      .eq("id", opts.providerId)
      .maybeSingle(),
    admin
      .from("provider_services")
      .select("price_cents_override, deposit_cents_override, duration_minutes_override")
      .eq("tenant_id", opts.tenantId)
      .eq("service_id", opts.serviceId)
      .eq("provider_id", opts.providerId)
      .maybeSingle(),
    admin
      .from("provider_schedules")
      .select("weekday, start_time, end_time")
      .eq("provider_id", opts.providerId)
      .eq("tenant_id", opts.tenantId),
    admin
      .from("provider_time_off")
      .select("starts_at, ends_at")
      .eq("provider_id", opts.providerId)
      .lt("starts_at", opts.rangeEnd.toISOString())
      .gt("ends_at", opts.rangeStart.toISOString()),
    admin
      .from("bookings")
      .select("starts_at, ends_at, status")
      .eq("provider_id", opts.providerId)
      .in("status", ["confirmed", "completed"])
      .lt("starts_at", opts.rangeEnd.toISOString())
      .gt("ends_at", opts.rangeStart.toISOString()),
    admin
      .from("slot_holds")
      .select("starts_at, ends_at, expires_at")
      .eq("provider_id", opts.providerId)
      .gt("expires_at", new Date().toISOString())
      .lt("starts_at", opts.rangeEnd.toISOString())
      .gt("ends_at", opts.rangeStart.toISOString()),
    admin
      .from("tenants")
      .select("settings_json, timezone")
      .eq("id", opts.tenantId)
      .maybeSingle(),
  ]);

  if (!service || service.is_active === false || service.tenant_id !== opts.tenantId) return [];
  if (!provider || provider.is_active === false || provider.tenant_id !== opts.tenantId) return [];

  const effectiveService = applyProviderServiceOverrides(
    service as Service,
    providerService
  );

  const settings = (tenant?.settings_json ?? {}) as {
    min_lead_time_minutes?: number;
    max_advance_booking_days?: number;
  };
  const timeZone = tenant?.timezone ?? "America/Los_Angeles";
  const minLead = settings.min_lead_time_minutes ?? 60;
  const maxAdvance = settings.max_advance_booking_days ?? 90;

  const now = new Date();
  const earliest = new Date(now.getTime() + minLead * 60_000);
  const latest = new Date(now.getTime() + maxAdvance * 24 * 60 * 60_000);

  // Effective range: clip to [now+minLead, now+maxAdvance].
  const rangeStart = new Date(Math.max(opts.rangeStart.getTime(), earliest.getTime()));
  const rangeEnd = new Date(Math.min(opts.rangeEnd.getTime(), latest.getTime()));
  if (rangeStart >= rangeEnd) return [];

  // Build the busy ranges (bookings + holds + time off), already including service buffers.
  const busy: Range[] = [];
  for (const b of bookings ?? []) {
    busy.push({ start: new Date(b.starts_at), end: new Date(b.ends_at) });
  }
  for (const h of holds ?? []) {
    busy.push({ start: new Date(h.starts_at), end: new Date(h.ends_at) });
  }
  for (const t of timeOff ?? []) {
    busy.push({ start: new Date(t.starts_at), end: new Date(t.ends_at) });
  }
  busy.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Walk each day in the range and apply the weekly schedule for that weekday.
  const slots: AvailableSlot[] = [];
  const totalMinutes =
    effectiveService.duration_minutes +
    effectiveService.buffer_before_minutes +
    effectiveService.buffer_after_minutes;

  let localDate = getLocalDateString(rangeStart, timeZone);
  const lastLocalDate = getLocalDateString(new Date(rangeEnd.getTime() - 1), timeZone);

  while (localDate <= lastLocalDate) {
    const localDayRange = getUtcRangeForLocalDate(localDate, timeZone);
    const weekday = getWeekdayInTimeZone(localDayRange.start, timeZone);
    const todaysBlocks = (schedules ?? []).filter((s: Schedule) => s.weekday === weekday);
    const dayParts = parseDateOnly(localDate);
    for (const block of todaysBlocks) {
      const blockStart = parseTimeOnLocalDate(dayParts, block.start_time, timeZone);
      const blockEnd = parseTimeOnLocalDate(dayParts, block.end_time, timeZone);
      // Walk slot boundaries inside the block.
      for (
        let cursor = new Date(blockStart);
        cursor.getTime() + totalMinutes * 60_000 <= blockEnd.getTime();
        cursor = new Date(cursor.getTime() + SLOT_STEP_MINUTES * 60_000)
      ) {
        const slotStart = cursor;
        const slotEnd = new Date(cursor.getTime() + totalMinutes * 60_000);

        if (slotStart < rangeStart) continue;
        if (slotEnd > rangeEnd) break;

        // Conflict with any busy range?
        const conflict = busy.some(
          (b) => b.start < slotEnd && b.end > slotStart
        );
        if (conflict) continue;

        // The customer-visible appointment is the inner window (without buffers).
        const apptStart = new Date(slotStart.getTime() + effectiveService.buffer_before_minutes * 60_000);
        const apptEnd = new Date(apptStart.getTime() + effectiveService.duration_minutes * 60_000);
        slots.push({
          starts_at: apptStart.toISOString(),
          ends_at: apptEnd.toISOString(),
        });
      }
    }
    localDate = addDaysToDateOnly(localDate, 1);
  }

  return slots;
}

function parseTimeOnLocalDate(
  day: { year: number; month: number; day: number },
  hms: string,
  timeZone: string
): Date {
  const [h, m] = hms.split(":").map(Number);
  return zonedDateTimeToUtc(
    { year: day.year, month: day.month, day: day.day, hour: h, minute: m, second: 0 },
    timeZone
  );
}
