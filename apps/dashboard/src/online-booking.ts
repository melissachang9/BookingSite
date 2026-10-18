import type { ServiceSummary } from "@booking/shared-types";

/** What a service takes at booking, after inheriting its category's payment rule. */
export function effectiveDepositCents(service: ServiceSummary, priceCents: number): number {
  const mode = service.effectiveBookingPaymentMode;
  let amount: number;
  if (mode === "none") amount = 0;
  else if (mode === "full") amount = priceCents;
  else if (mode === "partial_flat") amount = service.effectiveBookingPaymentValueCents ?? 0;
  else if (mode === "partial_percent") amount = Math.round((priceCents * (service.effectiveBookingPaymentPercent ?? 0)) / 100);
  else amount = service.depositCents;
  return Math.max(0, Math.min(amount, priceCents));
}
