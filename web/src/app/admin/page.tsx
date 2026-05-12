import Link from "next/link";
import { requireTenant } from "@/lib/admin/require-tenant";

export default async function AdminHome() {
  const { supabase, tenantId } = await requireTenant();

  const [{ count: serviceCount }, { count: providerCount }, { count: upcomingCount }, { count: formCount }, { count: customerCount }] =
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
        .from("forms")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("is_archived", false),
      supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
    ]);

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
  muted,
}: {
  href?: string;
  title: string;
  desc: string;
  muted?: boolean;
}) {
  const inner = (
    <div className="rounded-md border border-neutral-200 p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900">
      <div className={`font-medium ${muted ? "text-neutral-400" : ""}`}>{title}</div>
      <div className="text-sm text-neutral-500">{desc}</div>
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
