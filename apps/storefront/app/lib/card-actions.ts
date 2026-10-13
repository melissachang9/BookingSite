"use server";

import { headers } from "next/headers";

import { isApiClientError, storefrontApi } from "./storefront-api";

export type CardChargeResult =
  | { ok: true; redirectTo: string }
  | { ok: false; code: string; message: string };

const forwardedFor = async (): Promise<HeadersInit | undefined> => {
  const incoming = (await headers()).get("x-forwarded-for");
  const first = incoming?.split(",")[0]?.trim();
  return first ? { "x-forwarded-for": first } : undefined;
};

const failure = (error: unknown): CardChargeResult => {
  if (isApiClientError(error)) {
    return {
      ok: false,
      code: error.payload?.error?.code ?? `http_${error.status}`,
      message: error.message,
    };
  }
  return { ok: false, code: "payment_unavailable", message: "The payment couldn't be started. Please try again." };
};

type ChargeInput = { sessionId: string; sourceToken: string; attemptId: string };

/** Deposit for a booking draft. Success goes to the booking's confirmation page. */
export async function chargeDepositCardAction(
  input: ChargeInput & { tenantSlug: string; bookingDraftId: string },
): Promise<CardChargeResult> {
  try {
    const booking = await storefrontApi.chargeCheckoutSession(
      input.tenantSlug,
      input.sessionId,
      { sourceToken: input.sourceToken, attemptId: input.attemptId },
      await forwardedFor(),
    );
    return { ok: true, redirectTo: `/${input.tenantSlug}/book/${input.bookingDraftId}/success?bookingId=${booking.id}` };
  } catch (error) {
    return failure(error);
  }
}

/** Remaining balance from the private manage-booking link. */
export async function chargeBalanceCardAction(input: ChargeInput & { token: string }): Promise<CardChargeResult> {
  try {
    const manageBooking = await storefrontApi.getManageBooking(input.token);
    await storefrontApi.chargeCheckoutSession(
      manageBooking.tenant.slug,
      input.sessionId,
      { sourceToken: input.sourceToken, attemptId: input.attemptId },
      await forwardedFor(),
    );
    return { ok: true, redirectTo: `/cancel/${input.token}?paid=1` };
  } catch (error) {
    return failure(error);
  }
}
