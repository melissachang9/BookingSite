import { requireTenant } from "@/lib/admin/require-tenant";
import { normalizeTenantSettings } from "@/lib/tenants/settings";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings — BookingSite" };

export default async function SettingsPage() {
  const { supabase, tenantId, role } = await requireTenant();
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("name, slug, settings_json")
    .eq("id", tenantId)
    .maybeSingle();

  if (error || !tenant) {
    throw new Error(error?.message ?? "Could not load business settings.");
  }

  const settings = normalizeTenantSettings(
    (tenant.settings_json ?? null) as Partial<Record<string, unknown>> | null
  );
  const canEdit = role === "owner" || role === "manager";
  const publicUrlBase = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Business settings</p>
        <h1 className="text-2xl font-semibold tracking-tight">Policies and booking controls</h1>
        <p className="max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
          These settings apply only to {tenant.name}. Cancellation policy, deposits, no-show fees, reminder timing, booking limits, and no-show auto-charging are stored per business rather than hard-coded across the platform.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <SettingsForm
          initialSettings={{
            cancellation_window_hours: settings.cancellation_window_hours,
            refund_inside_window: settings.refund_inside_window,
            default_deposit_cents: settings.default_deposit_cents,
            reminder_hours_before: settings.reminder_hours_before,
            no_show_fee_cents: settings.no_show_fee_cents,
            min_lead_time_minutes: settings.min_lead_time_minutes,
            max_advance_booking_days: settings.max_advance_booking_days,
            auto_charge_no_show_fee: settings.auto_charge_no_show_fee,
          }}
          canEdit={canEdit}
        />

        <aside className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-50 p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Current live behavior</h2>
            <dl className="mt-3 space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
              <div className="flex justify-between gap-4">
                <dt>Booking page</dt>
                <dd className="text-right">{tenant.slug ? `${publicUrlBase}/${tenant.slug}` : publicUrlBase}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Cancellation window</dt>
                <dd>{settings.cancellation_window_hours}h</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Refunds inside window</dt>
                <dd>{settings.refund_inside_window ? "Enabled" : "Disabled"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Default service deposit</dt>
                <dd>${(settings.default_deposit_cents / 100).toFixed(2)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Reminder timing</dt>
                <dd>{settings.reminder_hours_before}h before</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>No-show fee</dt>
                <dd>${(settings.no_show_fee_cents / 100).toFixed(2)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>No-show auto-charge</dt>
                <dd>{settings.auto_charge_no_show_fee ? "Enabled" : "Disabled"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Minimum lead time</dt>
                <dd>{settings.min_lead_time_minutes} min</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Max advance booking</dt>
                <dd>{settings.max_advance_booking_days} days</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
            Customer self-service cancellation stays available through the secure link. New services start with the business default deposit, and no-show auto-charging stays optional per business.
          </div>
        </aside>
      </div>
    </div>
  );
}