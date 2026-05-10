"use client";

import { useActionState } from "react";
import {
  upsertProviderAction,
  addScheduleBlockAction,
  deleteScheduleBlockAction,
} from "./actions";
import { initialActionState } from "@/lib/admin/action-state";

export type ProviderRow = {
  id: string;
  name: string;
  email: string | null;
  bio: string | null;
  is_active: boolean;
  service_ids: string[];
  schedules: ScheduleBlock[];
};

export type ScheduleBlock = {
  id: string;
  weekday: number;
  start_time: string; // "HH:MM:SS"
  end_time: string;
};

export type ServiceOption = { id: string; name: string };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ProviderForm({
  provider,
  services,
  onDone,
}: {
  provider?: ProviderRow;
  services: ServiceOption[];
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(upsertProviderAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      {provider?.id && <input type="hidden" name="id" value={provider.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" name="name" defaultValue={provider?.name} required maxLength={120} />
        <Field label="Email" name="email" type="email" defaultValue={provider?.email ?? ""} />
      </div>
      <div className="space-y-1">
        <label htmlFor="bio" className="text-sm font-medium">Bio</label>
        <textarea
          id="bio"
          name="bio"
          rows={2}
          defaultValue={provider?.bio ?? ""}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        />
      </div>

      <div className="space-y-1">
        <span className="text-sm font-medium">Services offered</span>
        {services.length === 0 ? (
          <p className="text-sm text-neutral-500">Add services first to assign them here.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {services.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="service_ids"
                  value={s.id}
                  defaultChecked={provider?.service_ids.includes(s.id) ?? false}
                />
                {s.name}
              </label>
            ))}
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_active" defaultChecked={provider?.is_active ?? true} />
        Active
      </label>

      {state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
      {state.success && <p className="text-sm text-green-600">{state.success}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {pending ? "Saving…" : provider?.id ? "Save changes" : "Create provider"}
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

export function ScheduleEditor({ provider }: { provider: ProviderRow }) {
  const [state, formAction, pending] = useActionState(addScheduleBlockAction, initialActionState);

  return (
    <div className="space-y-3 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      <h4 className="text-sm font-semibold">Weekly schedule</h4>

      {provider.schedules.length === 0 ? (
        <p className="text-sm text-neutral-500">No availability set yet.</p>
      ) : (
        <ul className="space-y-1">
          {provider.schedules.map((b) => (
            <li key={b.id} className="flex items-center justify-between text-sm">
              <span>
                <span className="font-medium">{WEEKDAYS[b.weekday]}</span>{" "}
                {b.start_time.slice(0, 5)} – {b.end_time.slice(0, 5)}
              </span>
              <form action={deleteScheduleBlockAction}>
                <input type="hidden" name="id" value={b.id} />
                <button
                  type="submit"
                  className="text-xs text-red-600 hover:underline"
                  aria-label="Delete block"
                >
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <input type="hidden" name="provider_id" value={provider.id} />
        <div className="space-y-1">
          <label className="text-xs font-medium">Day</label>
          <select
            name="weekday"
            defaultValue="1"
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          >
            {WEEKDAYS.map((d, i) => (
              <option key={i} value={i}>{d}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Start</label>
          <input
            type="time"
            name="start_time"
            defaultValue="09:00"
            required
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">End</label>
          <input
            type="time"
            name="end_time"
            defaultValue="17:00"
            required
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </form>
      {state.error && <p className="text-sm text-red-600" role="alert">{state.error}</p>}
    </div>
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
