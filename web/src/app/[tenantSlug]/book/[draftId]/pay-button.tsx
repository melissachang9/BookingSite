"use client";

import { useState, useTransition } from "react";
import { createCheckoutSessionAction } from "./actions";

export function PayButton({
  draftId,
  tenantSlug,
  amountCents,
  isDeposit,
  totalCents,
  noShowFeeCents,
  autoChargeNoShowFee,
  checkoutSessionStatus,
  checkoutSessionExpiresLabel,
}: {
  draftId: string;
  tenantSlug: string;
  amountCents: number;
  isDeposit: boolean;
  totalCents: number;
  noShowFeeCents: number;
  autoChargeNoShowFee: boolean;
  checkoutSessionStatus: "open" | "complete" | "expired" | null;
  checkoutSessionExpiresLabel: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasOpenCheckout = checkoutSessionStatus === "open";
  const isProcessing = checkoutSessionStatus === "complete";
  const previousSessionExpired = checkoutSessionStatus === "expired";

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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-stone-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
            Secure checkout
          </p>
          <h2
            className="mt-2 text-3xl tracking-[-0.03em] text-stone-950"
            style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif' }}
          >
            Confirm the appointment with payment
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600 sm:text-base">
            Stripe handles the card entry and returns you to the booking flow after checkout.
          </p>
        </div>
        <div className="rounded-2xl bg-stone-950 px-4 py-3 text-sm font-medium text-stone-100 shadow-[0_18px_40px_rgba(35,21,10,0.18)]">
          PCI-secure checkout
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard
          label="Due now"
          value={`$${(amountCents / 100).toFixed(2)}`}
          note={isDeposit ? "Deposit collected today" : "Full amount collected today"}
        />
        <MetricCard
          label={isDeposit ? "Remaining at appointment" : "Booking total"}
          value={`$${((isDeposit ? totalCents - amountCents : totalCents) / 100).toFixed(2)}`}
          note={
            isDeposit
              ? "The remaining balance is settled with the studio."
              : "Nothing else is due after this payment."
          }
        />
      </div>

      <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50/80 p-5 text-sm leading-6 text-stone-600">
        <p className="font-semibold text-stone-900">Payment breakdown</p>
        <p className="mt-2">
          {isDeposit
            ? `A $${(amountCents / 100).toFixed(2)} deposit is due now. The remaining $${((totalCents - amountCents) / 100).toFixed(2)} is collected at your appointment.`
            : `The full $${(amountCents / 100).toFixed(2)} is due now to finalize the booking.`}
        </p>
      </div>

      {hasOpenCheckout ? (
        <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          <p className="font-semibold text-amber-950">Your checkout is still open</p>
          <p className="mt-1">
            Resume the same Stripe session without re-entering your booking details.
            {checkoutSessionExpiresLabel
              ? ` Finish payment before ${checkoutSessionExpiresLabel}.`
              : ""}
          </p>
        </div>
      ) : null}

      {previousSessionExpired ? (
        <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50 p-4 text-sm leading-6 text-stone-700">
          <p className="font-semibold text-stone-900">Your previous checkout session ended</p>
          <p className="mt-1">Start a fresh secure checkout below to finish confirming this booking.</p>
        </div>
      ) : null}

      {isProcessing ? (
        <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
          <p className="font-semibold text-emerald-950">Payment submitted</p>
          <p className="mt-1">
            Stripe has your payment. We&apos;re finalizing the booking now.
          </p>
          <a
            href={`/${tenantSlug}/book/${draftId}/success`}
            className="mt-3 inline-flex text-sm font-semibold text-emerald-900 underline decoration-emerald-300 underline-offset-4"
          >
            Refresh confirmation status
          </a>
        </div>
      ) : null}

      {autoChargeNoShowFee && noShowFeeCents > 0 ? (
        <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          This business has enabled optional automatic no-show charging. Stripe will securely save this card for this booking and may charge the $${(noShowFeeCents / 100).toFixed(2)} no-show fee if you miss the appointment.
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {isProcessing ? null : (
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className="w-full rounded-2xl bg-stone-900 px-5 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-stone-800 disabled:opacity-50"
        >
          {pending
            ? "Opening secure checkout…"
            : hasOpenCheckout
              ? "Resume secure checkout"
              : `Pay $${(amountCents / 100).toFixed(2)} securely`}
        </button>
      )}

      <p className="text-xs uppercase tracking-[0.18em] text-stone-500">
        {hasOpenCheckout
          ? "Stripe will reopen the same secure checkout session."
          : "Card processing runs through Stripe. You&apos;ll return here automatically if checkout is interrupted."}
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-stone-200 bg-stone-50/80 p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-stone-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-stone-600">{note}</p>
    </div>
  );
}
