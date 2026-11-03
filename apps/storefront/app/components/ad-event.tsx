"use client";

import { useEffect } from "react";

import { trackAdEvent, type AdEventName } from "../lib/ad-tracking";

type AdEventProps = {
  name: AdEventName;
  eventId: string;
  /** Booking value in the tenant's currency units. */
  value?: number;
  currency?: string;
};

/** Reports one booking step to the loaded ad platforms when it mounts. Renders nothing. */
export function AdEvent({ name, eventId, value, currency }: AdEventProps) {
  useEffect(() => {
    // The tag scripts load after hydration, so give them a moment before the first attempt.
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const w = window as Window & { fbq?: unknown; gtag?: unknown };
      if (w.fbq || w.gtag || attempts >= 20) {
        window.clearInterval(timer);
        trackAdEvent(name, { eventId, value, currency });
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [name, eventId, value, currency]);

  return null;
}
