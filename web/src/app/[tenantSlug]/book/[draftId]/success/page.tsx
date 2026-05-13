/**
 * Stripe Checkout success landing page. The webhook is the source of truth for
 * promoting the draft — this page just shows a friendly state based on whether
 * the promotion has happened yet (it usually has by the time the redirect lands).
 */
import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { PendingStatusRefresh } from "./pending-status-refresh";

type Params = { tenantSlug: string; draftId: string };

async function loadStatus(slug: string, draftId: string) {
  noStore();
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant) return null;
  const { data: draft } = await admin
    .from("booking_drafts")
    .select("id, tenant_id, status, promoted_booking_id, starts_at, ends_at")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft || draft.tenant_id !== tenant.id) return null;
  let booking = null;
  if (draft.promoted_booking_id) {
    const { data } = await admin
      .from("bookings")
      .select("id, starts_at, ends_at")
      .eq("id", draft.promoted_booking_id)
      .maybeSingle();
    booking = data;
  }
  return { tenant, draft, booking };
}

export default async function SuccessPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { tenantSlug, draftId } = await params;
  const data = await loadStatus(tenantSlug, draftId);
  if (!data) notFound();
  const { tenant, draft, booking } = data;

  const promoted = draft.status === "promoted" && booking;

  return (
    <div className="mx-auto w-full max-w-xl px-6 py-12">
      <header className="mb-6">
        <a href={`/${tenant.slug}`} className="text-sm text-neutral-500 hover:text-neutral-900">
          ← {tenant.name}
        </a>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {promoted ? "Booking confirmed" : "Processing payment"}
        </h1>
      </header>

      {promoted ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
          <p className="font-medium">You&apos;re all set.</p>
          <p className="mt-1">
            We&apos;ve sent a confirmation email with your appointment details.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-neutral-200 bg-white p-5 text-sm text-neutral-700">
          <PendingStatusRefresh />
          <p className="font-medium">Almost there…</p>
          <p className="mt-1">
            Your payment is processing. This page will update automatically when it&apos;s done.
            You can also refresh in a moment.
          </p>
        </div>
      )}
    </div>
  );
}
