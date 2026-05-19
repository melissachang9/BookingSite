"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { initialActionState } from "@/lib/admin/action-state";
import {
  calculateBookingPaymentBreakdown,
  parseDollarAmountToCents,
} from "@/lib/payments/booking-checkout";
import {
  markBookingCompletedAction,
  markBookingNoShowAction,
  openBookingBalanceCheckoutAction,
} from "./actions";

export function StatusButtons({
  bookingId,
  priceCents,
  depositCents,
  depositStatus,
  refundedAmountCents,
  taxRatePercent,
  walletBalanceCents = 0,
  autoOpenCompletionDrawer = false,
  rebookUrl,
  canManageCheckout = true,
}: {
  bookingId: string;
  priceCents: number;
  depositCents: number;
  depositStatus: string | null;
  refundedAmountCents: number | null;
  taxRatePercent: number;
  walletBalanceCents?: number;
  autoOpenCompletionDrawer?: boolean;
  rebookUrl?: string | null;
  canManageCheckout?: boolean;
}) {
  const [open, setOpen] = useState(autoOpenCompletionDrawer && canManageCheckout);
  const [paymentResolution, setPaymentResolution] = useState<
    "none_due" | "collected_cash" | "collected_external" | "already_paid" | "follow_up"
  >("follow_up");
  const [completionNote, setCompletionNote] = useState("");
  const [completedState, completeAction, completing] = useActionState(
    markBookingCompletedAction,
    initialActionState
  );
  const [noShowState, noShowAction, markingNoShow] = useActionState(
    markBookingNoShowAction,
    initialActionState
  );
  const [checkoutPending, startCheckoutTransition] = useTransition();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [externalPaidDollars, setExternalPaidDollars] = useState("");
  const [tipDollars, setTipDollars] = useState("");
  const [applyWalletBalance, setApplyWalletBalance] = useState(false);

  const tipCents = parseDollarAmountToCents(tipDollars) ?? 0;
  const preWalletTotals = calculateBookingPaymentBreakdown({
    priceCents,
    depositCents,
    depositStatus,
    refundedAmountCents,
    taxRatePercent,
    tipCents,
  });
  const walletAppliedPreviewCents = applyWalletBalance
    ? Math.min(Math.max(walletBalanceCents, 0), preWalletTotals.balanceDueCents)
    : 0;
  const paymentTotals = calculateBookingPaymentBreakdown({
    priceCents,
    depositCents,
    depositStatus,
    refundedAmountCents,
    taxRatePercent,
    tipCents,
    walletAppliedCents: walletAppliedPreviewCents,
  });
  const estimatedBalanceDue = paymentTotals.balanceDueCents;
  const displayedPaymentResolution =
    estimatedBalanceDue <= 0
      ? "none_due"
      : paymentResolution === "none_due"
        ? "follow_up"
        : paymentResolution;

  if (!canManageCheckout) {
    return (
      <div className="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Appointment checkout</p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Only owners, managers, and staff can complete appointments or collect payment.
        </p>
      </div>
    );
  }

  function openBalanceCheckout() {
    setCheckoutError(null);
    startCheckoutTransition(async () => {
      const result = await openBookingBalanceCheckoutAction({
        bookingId,
        tipDollars,
        applyWalletBalance,
      });
      if (!result.ok || !result.url) {
        setCheckoutError(result.error ?? "Failed to open checkout.");
        return;
      }
      window.location.assign(result.url);
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="text-xs uppercase tracking-wide text-neutral-500">Appointment checkout</p>

      {!canManageCheckout ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Only owners, managers, and staff can complete appointments or collect payment.
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={!canManageCheckout || completing || markingNoShow}
        className="w-full rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {open ? "Hide completion drawer" : "Complete appointment"}
      </button>

      {open ? (
        <form action={completeAction} className="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <input type="hidden" name="bookingId" value={bookingId} />
          <div className="space-y-1 rounded-md border border-neutral-200 p-2 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
            <p>
              Service price: <span className="font-medium">{formatMoney(paymentTotals.subtotalCents)}</span>
            </p>
            <p>
              Tax ({taxRatePercent.toFixed(2)}%): <span className="font-medium">{formatMoney(paymentTotals.taxCents)}</span>
            </p>
            <p>
              Total with tax: <span className="font-medium">{formatMoney(paymentTotals.totalWithTaxCents)}</span>
            </p>
            <p>
              Tip: <span className="font-medium">{formatMoney(paymentTotals.tipCents)}</span>
            </p>
            {walletBalanceCents > 0 ? (
              <p>
                Guest wallet available: <span className="font-medium">{formatMoney(walletBalanceCents)}</span>
              </p>
            ) : null}
            {walletAppliedPreviewCents > 0 ? (
              <p>
                Wallet applied now: <span className="font-medium">{formatMoney(walletAppliedPreviewCents)}</span>
              </p>
            ) : null}
            <p>
              Amount owing now: <span className="font-medium">{formatMoney(estimatedBalanceDue)}</span>
            </p>
          </div>
          <label className="block text-sm">
            <span className="text-neutral-700 dark:text-neutral-300">Tip ($)</span>
            <input
              type="number"
              name="tipDollars"
              min={0}
              step="0.01"
              value={tipDollars}
              onChange={(event) => setTipDollars(event.target.value)}
              placeholder="0.00"
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            />
          </label>
          {walletBalanceCents > 0 ? (
            <label className="flex items-start gap-3 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
              <input
                type="checkbox"
                name="applyWalletBalance"
                value="true"
                checked={applyWalletBalance}
                onChange={(event) => setApplyWalletBalance(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block font-medium text-neutral-900 dark:text-neutral-100">
                  Apply guest wallet balance
                </span>
                <span className="block text-neutral-500 dark:text-neutral-400">
                  {formatMoney(walletBalanceCents)} available{walletAppliedPreviewCents > 0 ? `, ${formatMoney(walletAppliedPreviewCents)} applied to this checkout` : ""}.
                </span>
              </span>
            </label>
          ) : null}
          {estimatedBalanceDue > 0 ? (
            <button
              type="button"
              onClick={openBalanceCheckout}
              disabled={checkoutPending || completing || markingNoShow}
              className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              {checkoutPending ? "Opening card checkout..." : "Collect card now"}
            </button>
          ) : null}
          <label className="block text-sm">
            <span className="text-neutral-700 dark:text-neutral-300">Balance outcome</span>
            <select
              name="paymentResolution"
              value={displayedPaymentResolution}
              onChange={(event) =>
                setPaymentResolution(
                  event.target.value as
                    | "none_due"
                    | "collected_cash"
                    | "collected_external"
                    | "already_paid"
                    | "follow_up"
                )
              }
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            >
              <option value="follow_up">Leave balance for follow-up</option>
              <option value="collected_cash">Collected now (cash)</option>
              <option value="collected_external">Collected now (external terminal)</option>
              <option value="already_paid">Already paid outside this flow</option>
              <option value="none_due">No balance due</option>
            </select>
          </label>
          {paymentResolution === "collected_external" ? (
            <label className="block text-sm">
              <span className="text-neutral-700 dark:text-neutral-300">Exact amount paid on external POS ($)</span>
              <input
                type="number"
                name="externalPaidDollars"
                min={0}
                step="0.01"
                required={estimatedBalanceDue > 0}
                value={externalPaidDollars}
                onChange={(event) => setExternalPaidDollars(event.target.value)}
                placeholder={(estimatedBalanceDue / 100).toFixed(2)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              />
            </label>
          ) : null}
          <label className="block text-sm">
            <span className="text-neutral-700 dark:text-neutral-300">Completion notes</span>
            <textarea
              name="completionNote"
              rows={3}
              value={completionNote}
              onChange={(event) => setCompletionNote(event.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            />
          </label>
          <button
            type="submit"
            disabled={completing || markingNoShow}
            className="w-full rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
          >
            {completing ? "Completing..." : "Save completion"}
          </button>
        </form>
      ) : null}

      {completedState.error ? <p className="text-sm text-red-700">{completedState.error}</p> : null}
      {completedState.success ? (
        <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
          <p>{completedState.success}</p>
          {rebookUrl ? (
            <Link href={rebookUrl} className="inline-block font-medium underline">
              Book next appointment
            </Link>
          ) : null}
        </div>
      ) : null}
      {checkoutError ? <p className="text-sm text-red-700">{checkoutError}</p> : null}

      <form action={noShowAction}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <button
          type="submit"
          disabled={!canManageCheckout || completing || markingNoShow}
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

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}