"use client";

import { useActionState, useState } from "react";
import { cancelBookingAction } from "./actions";
import { initialActionState } from "@/lib/admin/action-state";

export function CancelButton({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(cancelBookingAction, initialActionState);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-700/60 dark:text-red-400 dark:hover:bg-red-950/40"
      >
        Cancel booking
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2 rounded-md border border-red-300 bg-red-50/50 p-3 dark:border-red-900/60 dark:bg-red-950/20">
      <input type="hidden" name="bookingId" value={bookingId} />
      <label className="block text-sm">
        <span className="text-neutral-700 dark:text-neutral-300">Reason (optional)</span>
        <input
          name="reason"
          className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          placeholder="Customer requested..."
        />
      </label>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? "Canceling…" : "Confirm cancel"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Back
        </button>
      </div>
    </form>
  );
}
