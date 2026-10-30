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
  const hasCampaignTag = Boolean(utmSource || ref);
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

  const attribution: StoredAttribution = {
    source: utmSource ?? (ref ? "referral" : referrerHost ?? "direct"),
    medium: params.get("utm_medium")?.trim() || (ref ? "referral" : referrerHost ? "referral-site" : null),
    campaign: params.get("utm_campaign")?.trim() || ref,
    referrerUrl,
    landingPath: request.nextUrl.pathname,
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
