"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/admin/action-state";
import { resendBookingConfirmationAction } from "./actions";

export function CustomerManageTools({
  bookingId,
  manageUrl,
}: {
  bookingId: string;
  manageUrl: string;
}) {
  const [state, formAction, pending] = useActionState(
    resendBookingConfirmationAction,
    initialActionState
  );

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
        If email delivery fails, open the secure customer link directly to test customer-facing cancel/refund behavior.
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={manageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Open customer manage link
        </a>
        <form action={formAction}>
          <input type="hidden" name="bookingId" value={bookingId} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {pending ? "Sending..." : "Resend confirmation email"}
          </button>
        </form>
      </div>
      <p className="text-xs text-neutral-500 break-all">{manageUrl}</p>
      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-green-700">{state.success}</p> : null}
    </div>
  );
}