import { getStripe } from "@/lib/stripe";
import {
  getStripeCheckoutSessionExpiresAt,
  getStripeCheckoutSessionStatus,
  type StripeCheckoutSessionState,
} from "@/lib/payments/stripe-checkout-session";

export async function loadStripeCheckoutSessionState(
  sessionId: string | null
): Promise<StripeCheckoutSessionState | null> {
  if (!sessionId) return null;

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);

    return {
      status: getStripeCheckoutSessionStatus(session),
      url: session.url ?? null,
      expiresAt: getStripeCheckoutSessionExpiresAt(session),
    };
  } catch {
    return null;
  }
}