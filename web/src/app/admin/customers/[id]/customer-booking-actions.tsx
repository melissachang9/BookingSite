"use client";

import { useActionState, useState } from "react";
import { initialActionState } from "@/lib/admin/action-state";
import { CancelButton } from "../../bookings/[bookingId]/cancel-button";
import { refundBookingPaymentAction } from "../../bookings/[bookingId]/actions";
import { RescheduleForm } from "../../bookings/[bookingId]/reschedule-form";
import { StatusButtons } from "../../bookings/[bookingId]/status-buttons";

type CustomerBookingActionsProps = {
  bookingId: string;
  status: "confirmed" | "completed" | "canceled" | "no_show";
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  depositCents: number;
  stripePaymentIntentId: string | null;
  stripeRefundId: string | null;
  refundedAmountCents: number | null;
  refundedAt: string | null;
};

export function CustomerBookingActions({
  bookingId,
  status,
  startsAt,
  endsAt,
  durationMinutes,
  depositCents,
  stripePaymentIntentId,
  stripeRefundId,
  refundedAmountCents,
  refundedAt,
}: CustomerBookingActionsProps) {
  const [open, setOpen] = useState(false);
  const [refundState, refundAction, refundPending] = useActionState(
    refundBookingPaymentAction,
    initialActionState
  );

  const canManage = status === "confirmed";
  const canRefund = Boolean(stripePaymentIntentId) && !stripeRefundId;
  const refundLabel = depositCents > 0 ? "Refund deposit" : "Refund payment";

  return (
    <div className="min-w-[15rem] space-y-2">
      <div className="flex flex-wrap justify-end gap-2">
        {canManage ? (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {open ? "Hide actions" : "Manage"}
          </button>
        ) : null}
        {canRefund ? (
          <form action={refundAction}>
            <input type="hidden" name="bookingId" value={bookingId} />
            <button
              type="submit"
              disabled={refundPending}
              className="rounded-md border border-emerald-300 px-3 py-1.5 text-sm text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
            >
              {refundPending ? "Refunding..." : refundLabel}
            </button>
          </form>
        ) : null}
      </div>

      {refundState.error ? <p className="text-sm text-red-700">{refundState.error}</p> : null}
      {refundState.success ? <p className="text-sm text-green-700">{refundState.success}</p> : null}

      {stripeRefundId ? (
        <p className="text-xs text-neutral-500">
          Refunded {refundedAmountCents && refundedAmountCents > 0 ? `$${(refundedAmountCents / 100).toFixed(2)}` : "payment"}
          {refundedAt ? ` on ${new Date(refundedAt).toLocaleString()}` : ""}.
        </p>
      ) : null}

      {open ? (
        <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="grid gap-2 lg:grid-cols-2">
            <CancelButton bookingId={bookingId} />
            <RescheduleForm
              bookingId={bookingId}
              currentStart={startsAt}
              currentEnd={endsAt}
              durationMinutes={durationMinutes}
            />
          </div>
          <StatusButtons bookingId={bookingId} />
        </div>
      ) : null}
    </div>
  );
}