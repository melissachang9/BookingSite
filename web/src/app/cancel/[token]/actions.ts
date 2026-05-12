"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/admin/action-state";
import { cancelBookingByToken } from "@/lib/bookings/cancel";

const cancelByTokenSchema = z.object({
  token: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export async function cancelBookingByTokenAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = cancelByTokenSchema.safeParse({
    token: formData.get("token"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return { error: "Invalid link or form data" };

  const result = await cancelBookingByToken({
    cancelToken: parsed.data.token,
    reason: parsed.data.reason ?? null,
  });

  revalidatePath(`/cancel/${parsed.data.token}`);
  if (result.bookingId) {
    revalidatePath(`/admin/bookings/${result.bookingId}`);
  }
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/calendar");

  if (!result.ok) {
    return { error: result.error ?? "Failed to cancel booking" };
  }

  if (result.refundedAmountCents && result.refundedAmountCents > 0) {
    return {
      success: `Your booking was canceled and $${(result.refundedAmountCents / 100).toFixed(2)} was refunded.`,
    };
  }

  if (result.refundDecision === "blocked_by_policy") {
    return {
      success: `Your booking was canceled. Because it was inside the ${result.cancellationWindowHours ?? 24}-hour cancellation window, no refund was issued.`,
    };
  }

  return { success: "Your booking was canceled." };
}