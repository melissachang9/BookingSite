"use client";

import { useActionState, useState } from "react";
import { rescheduleBookingAction } from "./actions";
import { initialActionState } from "@/lib/admin/action-state";

function toLocalInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RescheduleForm({
  bookingId,
  currentStart,
  currentEnd,
  durationMinutes,
}: {
  bookingId: string;
  currentStart: string;
  currentEnd: string;
  durationMinutes: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(rescheduleBookingAction, initialActionState);
  const [startLocal, setStartLocal] = useState(toLocalInputValue(currentStart));

  // Compute ends_at = starts_at + durationMinutes (local-tz interpretation handled client-side).
  const endsAtIso = (() => {
    const d = new Date(startLocal);
    if (Number.isNaN(d.getTime())) return "";
    return new Date(d.getTime() + durationMinutes * 60_000).toISOString();
  })();

  const startsAtIso = (() => {
    const d = new Date(startLocal);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  })();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        Reschedule
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="startsAt" value={startsAtIso} />
      <input type="hidden" name="endsAt" value={endsAtIso} />
      <label className="block text-sm">
        <span className="text-neutral-700 dark:text-neutral-300">New start time (your local time)</span>
        <input
          type="datetime-local"
          value={startLocal}
          onChange={(e) => setStartLocal(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        />
      </label>
      <p className="text-xs text-neutral-500">
        Duration: {durationMinutes} min. End: {endsAtIso ? new Date(endsAtIso).toLocaleString() : "—"}
      </p>
      <p className="text-xs text-amber-700 dark:text-amber-400">
        Note: this reschedules without re-running availability checks. You can pick any time the provider isn&apos;t already booked.
      </p>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state.success && <p className="text-sm text-green-700">{state.success}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !startsAtIso}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Close
        </button>
      </div>
      <p className="text-xs text-neutral-500">Currently: {new Date(currentStart).toLocaleString()} → {new Date(currentEnd).toLocaleString()}</p>
    </form>
  );
}
