"use client";

import { useState, useTransition } from "react";
import { openAdminCheckoutAction } from "./actions";

export function AdminCheckoutButton({
  draftId,
  hasOpenCheckout,
}: {
  draftId: string;
  hasOpenCheckout: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setError(null);

    startTransition(async () => {
      const result = await openAdminCheckoutAction({ draftId });
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
        {pending
          ? "Opening checkout..."
          : hasOpenCheckout
            ? "Resume checkout"
            : "Start checkout"}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}