"use client";

import { useActionState } from "react";
import { initialActionState } from "@/lib/admin/action-state";
import { markBookingCompletedAction, markBookingNoShowAction } from "./actions";

export function StatusButtons({ bookingId }: { bookingId: string }) {
  const [completedState, completeAction, completing] = useActionState(
    markBookingCompletedAction,
    initialActionState
  );
  const [noShowState, noShowAction, markingNoShow] = useActionState(
    markBookingNoShowAction,
    initialActionState
  );

  return (
    <div className="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="text-xs uppercase tracking-wide text-neutral-500">Booking outcome</p>

      <form action={completeAction}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <button
          type="submit"
          disabled={completing || markingNoShow}
          className="w-full rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {completing ? "Marking..." : "Mark completed"}
        </button>
      </form>
      {completedState.error ? <p className="text-sm text-red-700">{completedState.error}</p> : null}
      {completedState.success ? <p className="text-sm text-green-700">{completedState.success}</p> : null}

      <form action={noShowAction}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <button
          type="submit"
          disabled={completing || markingNoShow}
          className="w-full rounded-md border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
        >
          {markingNoShow ? "Marking..." : "Mark no-show"}
        </button>
      </form>
      {noShowState.error ? <p className="text-sm text-red-700">{noShowState.error}</p> : null}
      {noShowState.success ? <p className="text-sm text-green-700">{noShowState.success}</p> : null}
    </div>
  );
}