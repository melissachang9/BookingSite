/**
 * Slot-hold sweep job.
 *
 * Marks expired booking_drafts as `abandoned` and deletes their slot_holds so
 * the time becomes bookable again. Idempotent — safe to run repeatedly.
 *
 * Trigger: Vercel Cron / external scheduler hits this every 1–5 minutes.
 * Auth: requires header `x-cron-secret` matching CRON_SECRET env var.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const headerSecret = req.headers.get("x-cron-secret");
  if (headerSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Mark expired drafts that aren't already promoted/abandoned.
  const { data: expiredDrafts, error: dErr } = await admin
    .from("booking_drafts")
    .update({ status: "abandoned" })
    .lt("expires_at", now)
    .in("status", ["draft", "awaiting_form", "awaiting_payment"])
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
    abandoned_drafts: expiredDrafts?.length ?? 0,
  });
}
