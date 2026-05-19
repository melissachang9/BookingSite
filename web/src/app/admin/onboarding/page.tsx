import Link from "next/link";
import { requireTenant } from "@/lib/admin/require-tenant";
import { normalizeTenantSettings } from "@/lib/tenants/settings";

export const metadata = { title: "Onboarding — BookingSite" };

type ChecklistItem = {
  title: string;
  description: string;
  done: boolean;
  href?: string;
  cta?: string;
  optional?: boolean;
};

export default async function OnboardingPage() {
  const { supabase, tenantId } = await requireTenant();

  const [
    { count: serviceCount },
    { count: providerCount },
    { count: providerServiceCount },
    { count: providerScheduleCount },
    { count: formCount },
    { count: serviceFormCount },
    { count: bookingCount },
    { count: customerCount },
    { data: tenant },
  ] = await Promise.all([
    supabase.from("services").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true),
    supabase.from("providers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true),
    supabase.from("provider_services").select("provider_id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase.from("provider_schedules").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase.from("forms").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_archived", false),
    supabase.from("service_forms").select("service_id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase.from("tenants").select("name, slug, settings_json").eq("id", tenantId).maybeSingle(),
  ]);

  const tenantSettings = normalizeTenantSettings(
    (tenant?.settings_json ?? null) as Partial<Record<string, unknown>> | null
  );

  const hasStripe = Boolean(
    process.env.STRIPE_SECRET_KEY && process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  );
  const hasResend = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
  const hasCronSecret = Boolean(process.env.CRON_SECRET);
  const hasTwilio = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
  );
  const publicUrlBase = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const publicBookingUrl = tenant?.slug ? `${publicUrlBase}/${tenant.slug}` : publicUrlBase;

  const items: ChecklistItem[] = [
    {
      title: "Add at least one service",
      description: `${serviceCount ?? 0} active service${serviceCount === 1 ? "" : "s"} configured.`,
      done: (serviceCount ?? 0) > 0,
      href: "/admin/services",
      cta: "Open services",
    },
    {
      title: "Add providers and availability",
      description: `${providerCount ?? 0} provider${providerCount === 1 ? "" : "s"}, ${providerScheduleCount ?? 0} schedule block${providerScheduleCount === 1 ? "" : "s"}.`,
      done: (providerCount ?? 0) > 0 && (providerScheduleCount ?? 0) > 0,
      href: "/admin/providers",
      cta: "Open providers",
    },
    {
      title: "Assign providers to services",
      description: `${providerServiceCount ?? 0} provider-to-service assignment${providerServiceCount === 1 ? "" : "s"}.`,
      done: (providerServiceCount ?? 0) > 0,
      href: "/admin/providers",
      cta: "Review assignments",
    },
    {
      title: "Publish intake forms",
      description: `${formCount ?? 0} active form${formCount === 1 ? "" : "s"}; templates are available for fast starts.`,
      done: (formCount ?? 0) > 0,
      href: "/admin/forms/new?template=generic-intake",
      cta: "Start from template",
    },
    {
      title: "Attach forms to services",
      description: `${serviceFormCount ?? 0} service-to-form link${serviceFormCount === 1 ? "" : "s"}.`,
      done: (serviceFormCount ?? 0) > 0,
      href: "/admin/services",
      cta: "Link forms",
    },
    {
      title: "Configure payments",
      description: hasStripe ? "Stripe keys detected." : "Add Stripe server and publishable keys in your environment.",
      done: hasStripe,
    },
    {
      title: "Configure reminders",
      description: hasResend
        ? hasCronSecret
          ? hasTwilio
            ? "Email, cron auth, and SMS credentials are present."
            : "Email and cron auth are ready; Twilio is still optional if you want SMS reminders."
          : "Email is configured, but CRON_SECRET is still missing."
        : "Add Resend and CRON_SECRET to enable automated reminders.",
      done: hasResend && hasCronSecret,
      optional: !hasTwilio,
      href: "/admin/settings",
      cta: "Open settings",
    },
    {
      title: "Run a live booking test",
      description: `${bookingCount ?? 0} booking${bookingCount === 1 ? "" : "s"} and ${customerCount ?? 0} customer record${customerCount === 1 ? "" : "s"} so far.`,
      done: (bookingCount ?? 0) > 0,
      href: publicBookingUrl,
      cta: "Open booking site",
    },
  ];

  const completeCount = items.filter((item) => item.done).length;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Launch checklist</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {tenant?.name ?? "Tenant"} onboarding
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Work through the minimum setup to take bookings reliably.
        </p>
      </div>

      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-neutral-900">Readiness</p>
              <p className="text-sm text-neutral-500">{completeCount} of {items.length} checklist items complete</p>
            </div>
            <div className="text-3xl font-semibold">{Math.round((completeCount / items.length) * 100)}%</div>
          </div>
          <div className="mt-4 h-3 rounded-full bg-neutral-100">
            <div
              className="h-3 rounded-full bg-neutral-900"
              style={{ width: `${(completeCount / items.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <p className="text-sm font-medium text-neutral-900">Tenant defaults</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Booking URL</dt>
              <dd className="text-right">
                <a href={publicBookingUrl} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
                  {tenant?.slug ?? "site"}
                </a>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Reminder timing</dt>
              <dd>{tenantSettings.reminder_hours_before}h before</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Cancellation window</dt>
              <dd>{tenantSettings.cancellation_window_hours}h</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Refunds inside window</dt>
              <dd>{tenantSettings.refund_inside_window ? "Enabled" : "Disabled"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Default deposit</dt>
              <dd>${(tenantSettings.default_deposit_cents / 100).toFixed(2)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">No-show fee</dt>
              <dd>${(tenantSettings.no_show_fee_cents / 100).toFixed(2)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">No-show auto-charge</dt>
              <dd>{tenantSettings.auto_charge_no_show_fee ? "Enabled" : "Disabled"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Payment link hold</dt>
              <dd>{tenantSettings.payment_link_expiry_minutes} min</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-neutral-500">Edit defaults</dt>
              <dd>
                <Link href="/admin/settings" className="text-blue-600 hover:underline">
                  Open settings
                </Link>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="space-y-3">
        {items.map((item) => (
          <div key={item.title} className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${item.done ? "bg-green-100 text-green-800" : item.optional ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-700"}`}>
                  {item.done ? "Done" : item.optional ? "Optional" : "Pending"}
                </span>
                <h2 className="font-medium text-neutral-900">{item.title}</h2>
              </div>
              <p className="text-sm text-neutral-600">{item.description}</p>
            </div>
            {item.href && item.cta ? (
              item.href.startsWith("http") ? (
                <a
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  {item.cta}
                </a>
              ) : (
                <Link
                  href={item.href}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
                >
                  {item.cta}
                </Link>
              )
            ) : null}
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-neutral-200 bg-neutral-50 p-5">
        <h2 className="font-medium text-neutral-900">What this page does not automate yet</h2>
        <p className="mt-2 text-sm text-neutral-600">
          Owner bootstrap still runs through the existing CLI script, and customer import is still manual. The checklist is meant to get a tenant live using the admin UI that exists today.
        </p>
      </section>
    </div>
  );
}