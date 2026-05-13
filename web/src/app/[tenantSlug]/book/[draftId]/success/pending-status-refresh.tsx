"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 2500;
const FALLBACK_NOTICE_AFTER_ATTEMPTS = 6;

export function PendingStatusRefresh() {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    let timeoutId: number | null = null;
    let cancelled = false;

    const refresh = () => {
      if (cancelled) return;
      router.refresh();
      setAttempts((current) => current + 1);
      timeoutId = window.setTimeout(refresh, REFRESH_INTERVAL_MS);
    };

    timeoutId = window.setTimeout(refresh, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [router]);

  return attempts >= FALLBACK_NOTICE_AFTER_ATTEMPTS ? (
    <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      Stripe has already accepted the payment redirect. We&apos;re still waiting for the final booking confirmation from the payment webhook.
    </p>
  ) : null;
}