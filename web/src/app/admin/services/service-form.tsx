"use client";

import { useActionState, useEffect, useRef } from "react";
import { upsertServiceAction } from "./actions";
import { initialActionState } from "@/lib/admin/action-state";

export type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number;
  deposit_cents: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  is_active: boolean;
};

export function ServiceForm({
  service,
  onDone,
}: {
  service?: ServiceRow;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(upsertServiceAction, initialActionState);
  const lastSuccess = useRef<string | undefined>(undefined);

  // After a successful save, collapse the form. Run as effect, never during render.
  useEffect(() => {
    if (state.success && state.success !== lastSuccess.current) {
      lastSuccess.current = state.success;
      onDone?.();
    }
  }, [state.success, onDone]);

  return (
    <form action={formAction} className="space-y-3 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      {service?.id && <input type="hidden" name="id" value={service.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" name="name" defaultValue={service?.name} required maxLength={120} />
        <Field
          label="Duration (minutes)"
          name="duration_minutes"
          type="number"
          min={5}
          max={600}
          defaultValue={service?.duration_minutes ?? 60}
          required
        />
        <Field
          label="Price ($)"
          name="price_dollars"
          type="number"
          min={0}
          step="0.01"
          defaultValue={service ? (service.price_cents / 100).toFixed(2) : "0.00"}
          required
        />
        <Field
          label="Deposit ($)"
          name="deposit_dollars"
          type="number"
          min={0}
          step="0.01"
          defaultValue={service ? (service.deposit_cents / 100).toFixed(2) : "0.00"}
        />
        <Field
          label="Buffer before (min)"
          name="buffer_before_minutes"
          type="number"
          min={0}
          max={240}
          defaultValue={service?.buffer_before_minutes ?? 0}
        />
        <Field
          label="Buffer after (min)"
          name="buffer_after_minutes"
          type="number"
          min={0}
          max={240}
          defaultValue={service?.buffer_after_minutes ?? 0}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="description" className="text-sm font-medium">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={service?.description ?? ""}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={service?.is_active ?? true}
        />
        Active (bookable)
      </label>
      {state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
      {state.success && <p className="text-sm text-green-600">{state.success}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {pending ? "Saving…" : service?.id ? "Save changes" : "Create service"}
        </button>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <div className="space-y-1">
      <label htmlFor={rest.name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={rest.name}
        {...rest}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      />
    </div>
  );
}
