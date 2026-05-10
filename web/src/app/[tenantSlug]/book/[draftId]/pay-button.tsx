"use client";

import { useState, useTransition } from "react";
import { createCheckoutSessionAction } from "./actions";

export function PayButton({
  draftId,
  tenantSlug,
  amountCents,
  isDeposit,
  totalCents,
}: {
  draftId: string;
  tenantSlug: string;
  amountCents: number;
  isDeposit: boolean;
  totalCents: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await createCheckoutSessionAction({ draftId, tenantSlug });
      if (!res.ok || !res.url) {
        setError(res.error ?? "Failed to start checkout");
        return;
      }
      window.location.href = res.url;
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5">
      <div className="border-b border-neutral-200 pb-3">
        <h2 className="text-lg font-semibold">Payment</h2>
        <p className="mt-1 text-sm text-neutral-600">
          {isDeposit
            ? `A $${(amountCents / 100).toFixed(0)} deposit is due now. Remaining $${((totalCents - amountCents) / 100).toFixed(0)} is paid at your appointment.`
            : `Total $${(amountCents / 100).toFixed(0)} due now.`}
        </p>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Starting…" : `Pay $${(amountCents / 100).toFixed(0)}`}
      </button>
    </div>
  );
}
