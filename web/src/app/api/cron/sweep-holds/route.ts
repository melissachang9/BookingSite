/**
 * Slot-hold sweep job.
 *
 * Marks expired booking_drafts as `abandoned` and deletes their slot_holds so
 * the time becomes bookable again. Idempotent — safe to run repeatedly.
 *
 * Trigger: Vercel Cron / external scheduler hits this every 1–5 minutes.
 * Auth: accepts either `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`.
 */
import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handleSweep(req: Request) {
  const authError = requireCronAuth(req);
  if (authError) return authError;

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Mark expired payment drafts separately so staff can distinguish timed-out payment links.
  const { data: expiredPaymentDrafts, error: paymentErr } = await admin
    .from("booking_drafts")
    .update({ status: "abandoned", deposit_status: "expired_unpaid" })
    .lt("expires_at", now)
    .eq("status", "awaiting_payment")
    .select("id");
  if (paymentErr) return NextResponse.json({ error: paymentErr.message }, { status: 500 });

  // Mark other expired drafts abandoned.
  const { data: expiredDrafts, error: dErr } = await admin
    .from("booking_drafts")
    .update({ status: "abandoned" })
    .lt("expires_at", now)
    .in("status", ["draft", "awaiting_form"])
    .select("id");
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  // Delete expired holds. (cascades from booking_drafts deletion would also work, but
  // we keep the draft row around as a record and just remove the hold.)
  const { error: hErr } = await admin
    .from("slot_holds")
    .delete()
    .lt("expires_at", now);
  if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    abandoned_drafts: (expiredDrafts?.length ?? 0) + (expiredPaymentDrafts?.length ?? 0),
  });
}

export async function GET(req: Request) {
  return handleSweep(req);
}

export async function POST(req: Request) {
  return handleSweep(req);
}
