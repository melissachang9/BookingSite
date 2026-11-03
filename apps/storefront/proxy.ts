import { NextResponse, type NextRequest } from "next/server";

import { ATTRIBUTION_COOKIE, ATTRIBUTION_MAX_AGE_SECONDS, type StoredAttribution } from "./app/lib/attribution";

/**
 * Remembers where a visitor first came from (UTM tags, a ?ref= link, or the site that sent them) in a
 * first-party cookie, so the booking draft they create later can carry it. A visit with an explicit
 * campaign tag replaces an older, untagged one; otherwise the first landing wins.
 */
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const params = request.nextUrl.searchParams;
  const utmSource = params.get("utm_source")?.trim() || null;
  const ref = params.get("ref")?.trim() || null;
  const gclid = params.get("gclid")?.trim() || null;
  const fbclid = params.get("fbclid")?.trim() || null;
  const hasCampaignTag = Boolean(utmSource || ref || gclid || fbclid);
  if (request.cookies.has(ATTRIBUTION_COOKIE) && !hasCampaignTag) return response;

  let referrerHost: string | null = null;
  let referrerUrl: string | null = null;
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.host !== request.nextUrl.host) {
        referrerHost = url.hostname.replace(/^www\./, "");
        referrerUrl = `${url.origin}${url.pathname}`;
      }
    } catch {
      // A malformed Referer header is the same as none.
    }
  }

  // Ads that are auto-tagged carry only a click ID, so name the source from it. A gclid exists only on
  // Google Ads clicks ("cpc"); Facebook adds fbclid to organic shares too, so its medium stays "social".
  const clickSource = gclid ? "google" : fbclid ? "facebook" : null;
  const clickMedium = gclid ? "cpc" : fbclid ? "social" : null;

  const attribution: StoredAttribution = {
    source: utmSource ?? (ref ? "referral" : clickSource ?? referrerHost ?? "direct"),
    medium:
      params.get("utm_medium")?.trim() ||
      (ref ? "referral" : utmSource ? null : clickMedium ?? (referrerHost ? "referral-site" : null)),
    campaign: params.get("utm_campaign")?.trim() || ref,
    referrerUrl,
    landingPath: request.nextUrl.pathname,
    gclid,
    fbclid,
  };
  response.cookies.set(ATTRIBUTION_COOKIE, JSON.stringify(attribution), {
    maxAge: ATTRIBUTION_MAX_AGE_SECONDS,
    sameSite: "lax",
    path: "/",
    httpOnly: true,
  });
  return response;
}

export const config = {
  // Pages only: skip Next internals, API routes and static files.
  matcher: ["/((?!_next/|api/|.*\\..*).*)"],
};
