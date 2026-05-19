"use client";

import { useState, useTransition } from "react";
import { reopenBookingCheckoutAction } from "./actions";

export function ReopenCheckoutButton({ bookingId }: { bookingId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reopenCheckout() {
    setError(null);

    startTransition(async () => {
      const result = await reopenBookingCheckoutAction({ bookingId });
      if (!result.ok) {
        setError(result.error ?? "Failed to reopen checkout.");
        return;
      }

      window.location.assign(`/admin/bookings/${bookingId}?flow=checkout`);
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={reopenCheckout}
        disabled={pending}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
      >
        {pending ? "Reopening checkout..." : "Reopen checkout"}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}