"use client";

import { useState, useTransition } from "react";
import type { StripeCheckoutSessionStatus } from "@/lib/payments/stripe-checkout-session";
import { openBookingBalanceCheckoutFromPaymentsAction } from "./actions";

function getButtonLabel(status: StripeCheckoutSessionStatus) {
  if (status === "open") return "Resume checkout";
  if (status === "expired") return "Open new checkout";
  if (status === "complete") return "Refresh payment status";
  return "Collect card now";
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

  function onClick() {
    setError(null);

    startTransition(async () => {
      const result = await openBookingBalanceCheckoutFromPaymentsAction({ bookingId });
      if (!result.ok || !result.url) {
        setError(result.error ?? "Failed to open checkout");
        return;
      }

      window.location.href = result.url;
    });
  }

  return (
    <div className="space-y-1 text-left">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
      >
        {pending ? "Opening checkout..." : getButtonLabel(checkoutSessionStatus)}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}