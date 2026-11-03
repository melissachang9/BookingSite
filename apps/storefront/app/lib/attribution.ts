import type { BookingAttribution } from "@booking/shared-types";

export const ATTRIBUTION_COOKIE = "bk_attr";
/** Mirrors the visitor's ad-cookie choice ("granted" / "denied") so the server can honour it. */
export const AD_CONSENT_COOKIE = "bk_ad_consent";
export const ATTRIBUTION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type StoredAttribution = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  referrerUrl: string | null;
  landingPath: string | null;
  gclid: string | null;
  fbclid: string | null;
};

/**
 * Reads the cookie written by proxy.ts; anything unreadable counts as no attribution. `consent` is the value
 * of the ad-consent cookie: only "granted" is true, "denied" is false, anything else is unknown.
 */
export function parseAttributionCookie(raw: string | undefined, consent?: string): BookingAttribution | undefined {
  if (!raw) return undefined;
  const adConsent = consent === "granted" ? true : consent === "denied" ? false : null;
  try {
    const value = JSON.parse(raw) as Partial<StoredAttribution>;
    const pick = (field: unknown) => (typeof field === "string" && field.length > 0 ? field : null);
    return {
      source: pick(value.source),
      medium: pick(value.medium),
      campaign: pick(value.campaign),
      referrerUrl: pick(value.referrerUrl),
      landingPath: pick(value.landingPath),
      gclid: pick(value.gclid),
      fbclid: pick(value.fbclid),
      adConsent,
    };
  } catch {
    return undefined;
  }
}
