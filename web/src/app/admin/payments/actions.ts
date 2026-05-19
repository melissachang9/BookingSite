"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createCheckoutSessionAction } from "@/app/[tenantSlug]/book/[draftId]/actions";
import { openBookingBalanceCheckoutAction } from "@/app/admin/bookings/[bookingId]/actions";
import {
  canManageBookingCheckout,
  getManageBookingCheckoutError,
} from "@/lib/admin/roles";
import { requireTenant } from "@/lib/admin/require-tenant";
import { createAdminClient } from "@/lib/supabase/admin";

const adminCheckoutSchema = z.object({
  draftId: z.string().uuid(),
});

const bookingBalanceCheckoutSchema = z.object({
  bookingId: z.string().uuid(),
});

export type AdminCheckoutResult = {
  ok: boolean;
  error?: string;
  url?: string;
};

export type AdminBookingBalanceCheckoutResult = {
  ok: boolean;
  error?: string;
  url?: string;
};

export async function openAdminCheckoutAction(
  input: z.infer<typeof adminCheckoutSchema>
): Promise<AdminCheckoutResult> {
  const parsed = adminCheckoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { tenantId, role } = await requireTenant();
  if (!canManageBookingCheckout(role)) {
    return { ok: false, error: getManageBookingCheckoutError() };
  }
  const admin = createAdminClient();

  const [{ data: draft }, { data: tenant }] = await Promise.all([
    admin
      .from("booking_drafts")
      .select("id, tenant_id, status")
      .eq("id", parsed.data.draftId)
      .maybeSingle(),
    admin.from("tenants").select("slug").eq("id", tenantId).maybeSingle(),
  ]);

  if (!draft || draft.tenant_id !== tenantId) {
    return { ok: false, error: "Booking draft not found" };
  }

  if (draft.status === "promoted") {
    return { ok: false, error: "This booking has already been confirmed." };
  }

  if (!tenant?.slug) {
    return { ok: false, error: "Tenant booking URL is not configured." };
  }

  const result = await createCheckoutSessionAction({
    draftId: draft.id,
    tenantSlug: tenant.slug,
  });

  if (!result.ok || !result.url) {
    return { ok: false, error: result.error ?? "Failed to open checkout" };
  }

  revalidatePath("/admin/payments");
  return { ok: true, url: result.url };
}

export async function openBookingBalanceCheckoutFromPaymentsAction(
  input: z.infer<typeof bookingBalanceCheckoutSchema>
): Promise<AdminBookingBalanceCheckoutResult> {
  const parsed = bookingBalanceCheckoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { tenantId, role } = await requireTenant();
  if (!canManageBookingCheckout(role)) {
    return { ok: false, error: getManageBookingCheckoutError() };
  }
  const admin = createAdminClient();

  const { data: booking } = await admin
    .from("bookings")
    .select("id, tenant_id")
    .eq("id", parsed.data.bookingId)
    .maybeSingle();

  if (!booking || booking.tenant_id !== tenantId) {
    return { ok: false, error: "Booking not found" };
  }

  const result = await openBookingBalanceCheckoutAction({ bookingId: booking.id });
  if (!result.ok || !result.url) {
    return { ok: false, error: result.error ?? "Failed to open checkout" };
  }

  revalidatePath("/admin/payments");
  return { ok: true, url: result.url };
}