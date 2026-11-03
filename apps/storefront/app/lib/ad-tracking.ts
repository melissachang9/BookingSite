/** Ad-platform tracking shared by the loader and the per-step event components. */

export const AD_CONSENT_KEY = "bk_ad_consent";

// Visitors in these regions must opt in before ad tags load. The tenant's country stands in for the
// visitor's, since the booking pages are used by a business's local clients.
const CONSENT_REQUIRED_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
  "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH",
]);

export function consentRequiredFor(country: string | null | undefined): boolean {
  return CONSENT_REQUIRED_COUNTRIES.has((country ?? "").toUpperCase());
}

export type AdIds = {
  metaPixelId: string | null;
  googleTagId: string | null;
  googleConversionLabel: string | null;
};

export type AdEventName = "booking_started" | "booking_confirmed";

export type AdEventDetail = {
  /** Booking value in the tenant's currency units (not cents). */
  value?: number;
  currency?: string;
  /** Stable ID for the event (the booking or draft ID); lets the platform ignore a repeat. */
  eventId: string;
};

type AdWindow = Window & {
  fbq?: (...args: unknown[]) => void;
  gtag?: (...args: unknown[]) => void;
  __bkAdIds?: AdIds;
};

export function readConsent(): "granted" | "denied" | null {
  try {
    const value = window.localStorage.getItem(AD_CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

export function storeConsent(value: "granted" | "denied") {
  try {
    window.localStorage.setItem(AD_CONSENT_KEY, value);
  } catch {
    // Without storage the choice only lasts for this page view.
  }
  // The booking server action reads this cookie, so server-side reporting honours the same choice.
  document.cookie = `${AD_CONSENT_KEY}=${value}; Max-Age=${60 * 60 * 24 * 180}; Path=/; SameSite=Lax`;
}

/**
 * Sends one funnel step to whichever platforms are loaded. Does nothing when a platform's script is not
 * on the page (not configured, or consent not given). Each event fires at most once per ID per tab.
 */
export function trackAdEvent(name: AdEventName, detail: AdEventDetail) {
  const w = window as AdWindow;
  const guardKey = `bk_ad_sent:${name}:${detail.eventId}`;
  try {
    if (window.sessionStorage.getItem(guardKey)) return;
  } catch {
    // Fall through: a duplicate is better than a lost conversion.
  }

  const ids = w.__bkAdIds;
  let sent = false;
  const money = detail.value !== undefined ? { value: detail.value, currency: detail.currency ?? "USD" } : {};

  if (w.fbq && ids?.metaPixelId) {
    // Standard Meta events: InitiateCheckout when a slot is chosen, Schedule when the booking is confirmed.
    const metaName = name === "booking_started" ? "InitiateCheckout" : "Schedule";
    w.fbq("track", metaName, money, { eventID: detail.eventId });
    sent = true;
  }

  if (w.gtag && ids?.googleTagId) {
    if (name === "booking_started") {
      w.gtag("event", "begin_checkout", money);
    } else {
      w.gtag("event", "purchase", { ...money, transaction_id: detail.eventId });
      if (ids.googleTagId.startsWith("AW-") && ids.googleConversionLabel) {
        w.gtag("event", "conversion", {
          send_to: `${ids.googleTagId}/${ids.googleConversionLabel}`,
          ...money,
          transaction_id: detail.eventId,
        });
      }
    }
    sent = true;
  }

  if (sent) {
    try {
      window.sessionStorage.setItem(guardKey, "1");
    } catch {
      // See above.
    }
  }
}
