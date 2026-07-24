"use client";

import { useEffect, useState } from "react";

type HoldCountdownProps = {
  expiresAt: string; // ISO date string
};

function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "Expired";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")} remaining`;
}

export default function HoldCountdown({ expiresAt }: HoldCountdownProps) {
  const [remaining, setRemaining] = useState(() => {
    const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    return Math.max(0, diff);
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          clearInterval(interval);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (remaining <= 0) {
    return <span className="hold-countdown hold-countdown--expired">Slot hold expired</span>;
  }

  if (remaining < 120) {
    return <span className="hold-countdown hold-countdown--urgent">{formatRemaining(remaining)}</span>;
  }

  return <span className="hold-countdown">{formatRemaining(remaining)}</span>;
}
