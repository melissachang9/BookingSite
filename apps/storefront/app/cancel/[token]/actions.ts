"use server";

import { redirect } from "next/navigation";

import { isApiClientError, storefrontApi } from "../../lib/storefront-api";

const CHECKOUT_PENDING_MESSAGE = "The payment processor has not completed this checkout yet.";
const CHECKOUT_EXPIRED_MESSAGE = "The checkout session expired before payment completed.";

const readRequiredField = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required field: ${key}`);
  }

  return value.trim();
};

const paymentErrorCodeFor = (error: unknown): string => {
  if (!isApiClientError(error)) {
    return "payment-unavailable";
  }

  if (error.status === 409) {
    if (error.message === CHECKOUT_PENDING_MESSAGE) {
      return "payment-pending";
    }

    if (error.message === CHECKOUT_EXPIRED_MESSAGE) {
      return "payment-expired";
    }
  }

  return "payment-unavailable";
};

export async function cancelManageBookingAction(formData: FormData) {
  const token = readRequiredField(formData, "token");
  const reasonValue = formData.get("reason");
  const reason = typeof reasonValue === "string" && reasonValue.trim().length > 0 ? reasonValue.trim() : undefined;

  try {
    await storefrontApi.cancelManageBooking(token, { reason });
  } catch (error) {
    if (isApiClientError(error)) {
      const errorCode = error.status === 409 ? "cancel-unavailable" : "cancel-error";
      redirect(`/cancel/${token}?error=${errorCode}`);
    }
    throw error;
  }

  redirect(`/cancel/${token}?canceled=1`);
}

export async function completeManageBookingBalanceCheckoutAction(formData: FormData) {
  const token = readRequiredField(formData, "token");
  const sessionId = readRequiredField(formData, "sessionId");

  try {
    const manageBooking = await storefrontApi.getManageBooking(token);
    await storefrontApi.completeCheckoutSession(manageBooking.tenant.slug, sessionId);
  } catch (error) {
    redirect(`/cancel/${token}?error=${paymentErrorCodeFor(error)}`);
  }

  redirect(`/cancel/${token}?paid=1`);
}