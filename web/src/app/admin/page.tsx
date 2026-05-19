import Link from "next/link";
import { canManageBookingCheckout } from "@/lib/admin/roles";
import { requireTenant } from "@/lib/admin/require-tenant";
import {
  getBookingBalanceFollowUpCents,
  readBookingCheckoutRecord,
} from "@/lib/payments/booking-checkout";

export default async function AdminHome() {
  const { supabase, tenantId, role } = await requireTenant();
  const showPaymentsCard = canManageBookingCheckout(role);

  const [
    { count: serviceCount },
    { count: providerCount },
    { count: upcomingCount },
    { count: pendingPaymentCount },
    followUpRes,
    recentCheckoutRes,
    { count: formCount },
    { count: customerCount },
  ] =
    await Promise.all([
      supabase
        .from("services")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
      supabase
        .from("providers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
      supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "confirmed")
        .gte("starts_at", new Date().toISOString()),
      supabase
        .from("booking_drafts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "awaiting_payment"),
      supabase
        .from("bookings")
        .select("id, deposit_status, checkout_record_json")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .neq("deposit_status", "paid_in_full")
        .order("completed_at", { ascending: false })
        .limit(100),
      supabase
        .from("bookings")
        .select("id, checkout_record_json")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(25),
      supabase
        .from("forms")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("is_archived", false),
      supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
    ]);

  const balanceFollowUpCount = (followUpRes.data ?? []).filter(
    (booking) =>
      getBookingBalanceFollowUpCents({
        checkoutRecord: booking.checkout_record_json,
        depositStatus: booking.deposit_status,
      }) > 0
  ).length;
  const recentCheckoutEvents = (recentCheckoutRes.data ?? [])
    .map((booking) => readBookingCheckoutRecord(booking.checkout_record_json).latest_event)
    .filter((event): event is NonNullable<typeof event> => Boolean(event));
  const recentWalletCloseouts = recentCheckoutEvents.filter(
    (event) => (event.wallet_applied_cents ?? 0) > 0
  ).length;
  const recentTippedCloseouts = recentCheckoutEvents.filter(
    (event) => (event.tip_cents ?? 0) > 0
  ).length;
  const paymentsDescription =
    balanceFollowUpCount > 0
      ? `${pendingPaymentCount ?? 0} awaiting payment · ${balanceFollowUpCount} need follow-up`
      : `${pendingPaymentCount ?? 0} awaiting payment`;
  const paymentsMeta = [
    recentWalletCloseouts > 0 ? `${recentWalletCloseouts} wallet-assisted` : null,
    recentTippedCloseouts > 0 ? `${recentTippedCloseouts} tipped` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Your booking site at a glance.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card href="/admin/calendar" title="Calendar" desc="Week view" />
        <Card href="/admin/bookings" title="Bookings" desc={`${upcomingCount ?? 0} upcoming`} />
        {showPaymentsCard ? (
          <Card
            href="/admin/payments"
            title="Payments"
            desc={paymentsDescription}
            meta={paymentsMeta || undefined}
          />
        ) : null}
        <Card href="/admin/onboarding" title="Onboarding" desc="Launch checklist" />
        <Card href="/admin/customers" title="Customers" desc={`${customerCount ?? 0} records`} />
        <Card href="/admin/services" title="Services" desc={`${serviceCount ?? 0} active`} />
        <Card href="/admin/providers" title="Providers" desc={`${providerCount ?? 0} active`} />
        <Card href="/admin/forms" title="Forms" desc={`${formCount ?? 0} active`} />
        <Card href="/admin/settings" title="Settings" desc="Policies and reminders" />
      </ul>
    </div>
  );
}

function Card({
  href,
  title,
  desc,
  meta,
  muted,
}: {
  href?: string;
  title: string;
  desc: string;
  meta?: string;
  muted?: boolean;
}) {
  const inner = (
    <div className="rounded-md border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900">
      <div className={`font-medium ${muted ? "text-neutral-400" : ""}`}>{title}</div>
      <div className="text-sm text-neutral-500">{desc}</div>
      {meta ? <div className="mt-1 text-xs text-neutral-400">{meta}</div> : null}
    </div>
  );
  return href ? (
    <li>
      <Link href={href}>{inner}</Link>
    </li>
  ) : (
    <li>{inner}</li>
  );
}
