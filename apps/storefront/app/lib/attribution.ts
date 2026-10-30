import type { BookingAttribution } from "@booking/shared-types";

export const ATTRIBUTION_COOKIE = "bk_attr";
export const ATTRIBUTION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type StoredAttribution = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  referrerUrl: string | null;
  landingPath: string | null;
};

/** Reads the cookie written by proxy.ts; anything unreadable counts as no attribution. */
export function parseAttributionCookie(raw: string | undefined): BookingAttribution | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<StoredAttribution>;
    const pick = (field: unknown) => (typeof field === "string" && field.length > 0 ? field : null);
    return {
      source: pick(value.source),
      medium: pick(value.medium),
      campaign: pick(value.campaign),
      referrerUrl: pick(value.referrerUrl),
      landingPath: pick(value.landingPath),
    };
  } catch {
    return undefined;
  }
}
