"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadSlotsAction, createBookingDraftAction } from "./actions";

type Provider = { id: string; name: string };

export function SlotPicker({
  tenantId,
  tenantSlug,
  serviceId,
  providers,
}: {
  tenantId: string;
  tenantSlug: string;
  serviceId: string;
  providers: Provider[];
}) {
  const router = useRouter();
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [date, setDate] = useState(() => todayIsoDate());
  const [slots, setSlots] = useState<{ starts_at: string; ends_at: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [holding, startHolding] = useTransition();

  function loadSlots(nextProviderId = providerId, nextDate = date) {
    setError(null);
    setSlots(null);
    startLoading(async () => {
      const res = await loadSlotsAction({
        tenantId,
        serviceId,
        providerId: nextProviderId,
        date: nextDate,
      });
      if (!res.ok) setError(res.error ?? "Failed to load slots");
      else setSlots(res.slots ?? []);
    });
  }

  function onPickSlot(startsAt: string) {
    setError(null);
    startHolding(async () => {
      const res = await createBookingDraftAction({
        tenantId,
        serviceId,
        providerId,
        startsAt,
      });
      if (!res.ok || !res.draftId) {
        setError(res.error ?? "Failed to hold slot");
        return;
      }
      router.push(`/${tenantSlug}/book/${res.draftId}`);
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Provider</span>
          <select
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value);
              loadSlots(e.target.value, date);
            }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-neutral-700">Date</span>
          <input
            type="date"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
            value={date}
            min={todayIsoDate()}
            onChange={(e) => {
              setDate(e.target.value);
              loadSlots(providerId, e.target.value);
            }}
          />
        </label>
      </div>

      {slots === null && !loading ? (
        <button
          type="button"
          onClick={() => loadSlots()}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Show available times
        </button>
      ) : null}

      {loading ? <p className="text-sm text-neutral-500">Loading times…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {slots && slots.length === 0 ? (
        <p className="text-sm text-neutral-600">No times available on this date. Try another day.</p>
      ) : null}

      {slots && slots.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {slots.map((s) => (
            <button
              key={s.starts_at}
              type="button"
              disabled={holding}
              onClick={() => onPickSlot(s.starts_at)}
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
            >
              {formatTime(s.starts_at)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function todayIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
