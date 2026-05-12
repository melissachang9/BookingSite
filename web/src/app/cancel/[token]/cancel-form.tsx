"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/admin/action-state";
import { cancelBookingByTokenAction } from "./actions";

export function CancelBookingForm({
  token,
  cancellationWindowHours,
  refundInsideWindow,
  insideCancellationWindow,
}: {
  token: string;
  cancellationWindowHours: number;
  refundInsideWindow: boolean;
  insideCancellationWindow: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    cancelBookingByTokenAction,
    initialActionState
  );

  const policyMessage =
    cancellationWindowHours <= 0
      ? "This business allows cancellations up until the appointment start time. If a payment was captured, it will be refunded automatically."
      : insideCancellationWindow
        ? refundInsideWindow
          ? `This booking is inside the ${cancellationWindowHours}-hour cancellation window, but this business still refunds cancellations made in that window.`
          : `This booking is inside the ${cancellationWindowHours}-hour cancellation window. You can still cancel online, but no refund will be issued.`
        : refundInsideWindow
          ? `This business refunds cancellations both outside and inside its ${cancellationWindowHours}-hour cancellation window.`
          : `Cancel at least ${cancellationWindowHours} hours before the appointment to stay outside the cancellation window. Cancellations inside that window will not be refunded.`;

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-red-200 bg-red-50 p-5">
      <input type="hidden" name="token" value={token} />

      <div>
        <h2 className="text-base font-semibold text-red-900">Cancel this booking</h2>
        <p className="mt-1 text-sm text-red-800/80">
          {policyMessage}
        </p>
      </div>

      <label className="block text-sm text-neutral-800">
        <span>Reason (optional)</span>
        <textarea
          name="reason"
          rows={3}
          maxLength={500}
          placeholder="Plans changed, feeling unwell, need a different time..."
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2"
        />
      </label>

      {state.error ? <p className="text-sm text-red-700">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-green-700">{state.success}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        {pending ? "Canceling..." : "Confirm cancellation"}
      </button>
    </form>
  );
}