"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/admin/action-state";
import { updateTenantSettingsAction } from "./actions";

type SettingsFormProps = {
  initialSettings: {
    cancellation_window_hours: number;
    refund_inside_window: boolean;
    default_deposit_cents: number;
    reminder_hours_before: number;
    no_show_fee_cents: number;
    min_lead_time_minutes: number;
    max_advance_booking_days: number;
    auto_charge_no_show_fee: boolean;
  };
  canEdit: boolean;
};

export function SettingsForm({ initialSettings, canEdit }: SettingsFormProps) {
  const [state, formAction, pending] = useActionState(
    updateTenantSettingsAction,
    initialActionState
  );

  return (
    <form action={formAction} className="space-y-6 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Cancellation policy</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            The cancellation window decides when an appointment is considered last-minute. Online cancellations still work inside the window; this setting controls whether those cancellations are refunded.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Cancellation window (hours)"
            name="cancellation_window_hours"
            type="number"
            min={0}
            max={168}
            defaultValue={initialSettings.cancellation_window_hours}
            disabled={!canEdit || pending}
            required
          />
          <label className="flex items-start gap-3 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <input
              type="checkbox"
              name="refund_inside_window"
              defaultChecked={initialSettings.refund_inside_window}
              disabled={!canEdit || pending}
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium text-neutral-900 dark:text-neutral-100">Refund cancellations inside the window</span>
              <span className="mt-1 block text-neutral-600 dark:text-neutral-400">
                Turn this on if the business still wants to refund last-minute cancellations.
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Payments and fees</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            The default deposit pre-fills new services. The no-show fee is recorded on the booking when staff mark an appointment as a no-show.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Default deposit ($)"
            name="default_deposit_dollars"
            type="number"
            min={0}
            step="0.01"
            defaultValue={(initialSettings.default_deposit_cents / 100).toFixed(2)}
            disabled={!canEdit || pending}
            required
          />
          <Field
            label="No-show fee ($)"
            name="no_show_fee_dollars"
            type="number"
            min={0}
            step="0.01"
            defaultValue={(initialSettings.no_show_fee_cents / 100).toFixed(2)}
            disabled={!canEdit || pending}
            required
          />
        </div>
        <label className="flex items-start gap-3 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
          <input
            type="checkbox"
            name="auto_charge_no_show_fee"
            defaultChecked={initialSettings.auto_charge_no_show_fee}
            disabled={!canEdit || pending}
            className="mt-0.5"
          />
          <span>
            <span className="block font-medium text-neutral-900 dark:text-neutral-100">Automatically charge the saved card for no-shows</span>
            <span className="mt-1 block text-neutral-600 dark:text-neutral-400">
              Optional per business. When enabled, checkout securely stores the customer card with Stripe for that booking and staff marking a booking as no-show will attempt to charge the configured no-show fee.
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Booking rules</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            These limits already affect public booking availability for this business.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Minimum lead time (minutes)"
            name="min_lead_time_minutes"
            type="number"
            min={0}
            max={10080}
            defaultValue={initialSettings.min_lead_time_minutes}
            disabled={!canEdit || pending}
            required
          />
          <Field
            label="Maximum advance booking (days)"
            name="max_advance_booking_days"
            type="number"
            min={1}
            max={365}
            defaultValue={initialSettings.max_advance_booking_days}
            disabled={!canEdit || pending}
            required
          />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Reminder timing</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Email and SMS reminders use this timing when cron is enabled.
          </p>
        </div>
        <Field
          label="Send reminders this many hours before"
          name="reminder_hours_before"
          type="number"
          min={1}
          max={168}
          defaultValue={initialSettings.reminder_hours_before}
          disabled={!canEdit || pending}
          required
        />
      </section>

      {!canEdit ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Only owners and managers can update business settings.
        </p>
      ) : null}
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-green-600">{state.success}</p> : null}

      <div className="flex items-center justify-between gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Changes apply per business and take effect immediately.
        </p>
        <button
          type="submit"
          disabled={!canEdit || pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {pending ? "Saving..." : "Save settings"}
        </button>
      </div>
    </form>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props;

  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-neutral-900 dark:text-neutral-100">{label}</span>
      <input
        {...rest}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      />
    </label>
  );
}