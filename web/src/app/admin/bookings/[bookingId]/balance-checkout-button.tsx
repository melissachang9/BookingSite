"use client";

import { useState, useTransition } from "react";
import type { StripeCheckoutSessionStatus } from "@/lib/payments/stripe-checkout-session";
import { openBookingBalanceCheckoutAction } from "./actions";

function getButtonLabel(status: StripeCheckoutSessionStatus) {
  if (status === "open") return "Resume card checkout";
  if (status === "expired") return "Open new card checkout";
  if (status === "complete") return "Refresh payment status";
  return "Collect remaining balance";
}

export function BookingBalanceCheckoutButton({
  bookingId,
  checkoutSessionStatus = null,
}: {
  bookingId: string;
  checkoutSessionStatus?: StripeCheckoutSessionStatus;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openCheckout() {
    setError(null);

    startTransition(async () => {
      const result = await openBookingBalanceCheckoutAction({ bookingId });
      if (!result.ok || !result.url) {
        setError(result.error ?? "Failed to open checkout.");
        return;
      }

      window.location.assign(result.url);
    });
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={openCheckout}
        disabled={pending}
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
      >
        {pending ? "Opening card checkout..." : getButtonLabel(checkoutSessionStatus)}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}