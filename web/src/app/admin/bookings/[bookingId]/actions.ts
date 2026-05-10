"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/admin/require-tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "@/lib/admin/action-state";

const cancelSchema = z.object({
  bookingId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export async function cancelBookingAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = cancelSchema.safeParse({
    bookingId: formData.get("bookingId"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return { error: "Invalid input" };

  const { tenantId, user } = await requireTenant();
  const admin = createAdminClient();

  const { data: booking, error: lookupErr } = await admin
    .from("bookings")
    .select("id, tenant_id, status")
    .eq("id", parsed.data.bookingId)
    .maybeSingle();

  if (lookupErr || !booking || booking.tenant_id !== tenantId) {
    return { error: "Booking not found" };
  }
  if (booking.status === "canceled") return { error: "Already canceled" };

  const { error } = await admin
    .from("bookings")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      canceled_by_user_id: user.id,
      cancel_reason: parsed.data.reason ?? null,
    })
    .eq("id", booking.id);

  if (error) return { error: error.message };

  revalidatePath(`/admin/bookings/${booking.id}`);
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/calendar");
  return { success: "Booking canceled" };
}

const rescheduleSchema = z.object({
  bookingId: z.string().uuid(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
});

export async function rescheduleBookingAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = rescheduleSchema.safeParse({
    bookingId: formData.get("bookingId"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
  });
  if (!parsed.success) return { error: "Invalid input" };

  const startsAt = new Date(parsed.data.startsAt);
  const endsAt = new Date(parsed.data.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return { error: "Invalid date" };
  }
  if (startsAt >= endsAt) return { error: "End must be after start" };

  const { tenantId } = await requireTenant();
  const admin = createAdminClient();

  const { data: booking } = await admin
    .from("bookings")
    .select("id, tenant_id, provider_id, status")
    .eq("id", parsed.data.bookingId)
    .maybeSingle();

  if (!booking || booking.tenant_id !== tenantId) return { error: "Booking not found" };
  if (booking.status !== "confirmed") return { error: "Only confirmed bookings can be rescheduled" };

  // Conflict check: rely on the existing assert_no_booking_conflict trigger but also
  // block manually so we can give a clean error.
  const { data: conflicts } = await admin
    .from("bookings")
    .select("id")
    .eq("provider_id", booking.provider_id)
    .eq("status", "confirmed")
    .neq("id", booking.id)
    .lt("starts_at", endsAt.toISOString())
    .gt("ends_at", startsAt.toISOString());

  if (conflicts && conflicts.length > 0) {
    return { error: "That time conflicts with another booking for this provider." };
  }

  const { error } = await admin
    .from("bookings")
    .update({
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .eq("id", booking.id);

  if (error) return { error: error.message };

  revalidatePath(`/admin/bookings/${booking.id}`);
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/calendar");
  return { success: "Booking rescheduled" };
}
