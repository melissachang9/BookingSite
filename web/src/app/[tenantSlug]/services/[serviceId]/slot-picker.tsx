"use client";

import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  loadNextAvailableAction,
  loadMonthAvailabilityAction,
  loadSlotsAction,
  createBookingDraftAction,
} from "./actions";

type Provider = { id: string; name: string };
type Slot = {
  starts_at: string;
  ends_at: string;
  provider_id: string;
  provider_name: string;
};

type SlotOption = {
  starts_at: string;
  ends_at: string;
  providers: Provider[];
};

type NextAvailableSlot = {
  date: string;
  starts_at: string;
  ends_at: string;
  provider_id: string;
  provider_name: string;
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NO_PREFERENCE_PROVIDER_VALUE = "__no_preference__";

export function SlotPicker({
  tenantId,
  tenantSlug,
  timeZone,
  serviceId,
  providers,
  initialProviderId,
  showProviderSelector = true,
}: {
  tenantId: string;
  tenantSlug: string;
  timeZone: string;
  serviceId: string;
  providers: Provider[];
  initialProviderId?: string;
  showProviderSelector?: boolean;
}) {
  const router = useRouter();
  const [providerId, setProviderId] = useState(
    initialProviderId ?? (providers.length > 1 ? NO_PREFERENCE_PROVIDER_VALUE : (providers[0]?.id ?? ""))
  );
  const [date, setDate] = useState(() => todayIsoDate());
  const [monthDate, setMonthDate] = useState(() => startOfMonth(parseLocalDate(todayIsoDate())));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [monthAvailability, setMonthAvailability] = useState<Record<string, number>>({});
  const [loadedAvailabilityKey, setLoadedAvailabilityKey] = useState<string | null>(null);
  const [nextAvailableSlot, setNextAvailableSlot] = useState<NextAvailableSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [nextAvailableError, setNextAvailableError] = useState<string | null>(null);
  const [highlightedSlotStartAt, setHighlightedSlotStartAt] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [loadingAvailability, startLoadingAvailability] = useTransition();
  const [loadingNextAvailable, startLoadingNextAvailable] = useTransition();
  const [holding, startHolding] = useTransition();
  const slotListRef = useRef<HTMLElement | null>(null);
  const pendingJumpTargetRef = useRef<string | null>(null);
  const isNoPreference = providerId === NO_PREFERENCE_PROVIDER_VALUE;
  const slotOptions = buildSlotOptions(slots ?? []);

  const fetchSlots = useEffectEvent(async (nextProviderId: string, nextDate: string) => {
    const res = await loadSlotsAction({
      tenantId,
      serviceId,
      providerId: toActionProviderId(nextProviderId),
      date: nextDate,
    });
    if (!res.ok) setError(res.error ?? "Failed to load slots");
    else setSlots(res.slots ?? []);
  });

  const fetchMonthAvailability = useEffectEvent(async (nextProviderId: string, nextMonth: string) => {
    const res = await loadMonthAvailabilityAction({
      tenantId,
      serviceId,
      providerId: toActionProviderId(nextProviderId),
      month: nextMonth,
    });

    if (!res.ok) {
      setAvailabilityError(res.error ?? "Failed to load monthly availability");
      setMonthAvailability({});
      setLoadedAvailabilityKey(null);
      return;
    }

    const nextAvailability: Record<string, number> = {};
    for (const day of res.availability ?? []) {
      nextAvailability[day.date] = day.slotCount;
    }

    setAvailabilityError(null);
    setMonthAvailability(nextAvailability);
    setLoadedAvailabilityKey(`${nextProviderId}:${nextMonth}`);
  });

  const fetchNextAvailable = useEffectEvent(async (nextProviderId: string) => {
    const res = await loadNextAvailableAction({
      tenantId,
      serviceId,
      providerId: toActionProviderId(nextProviderId),
    });

    if (!res.ok) {
      setNextAvailableError(res.error ?? "Failed to load the next available time");
      setNextAvailableSlot(null);
      return;
    }

    setNextAvailableError(null);
    setNextAvailableSlot(res.nextSlot ?? null);
  });

  useEffect(() => {
    if (!providerId || !date) return;
    startLoading(async () => {
      await fetchSlots(providerId, date);
    });
  }, [providerId, date]);

  useEffect(() => {
    if (!providerId) return;
    startLoadingNextAvailable(async () => {
      await fetchNextAvailable(providerId);
    });
  }, [providerId]);

  const todayIso = todayIsoDate();
  const today = parseLocalDate(todayIso);
  const visibleMonth = startOfMonth(monthDate);
  const visibleMonthIso = fmtLocalDate(visibleMonth);
  const currentAvailabilityKey = `${providerId}:${visibleMonthIso}`;

  useEffect(() => {
    if (!providerId) return;
    startLoadingAvailability(async () => {
      await fetchMonthAvailability(providerId, visibleMonthIso);
    });
  }, [providerId, visibleMonthIso]);

  useEffect(() => {
    const pendingJumpTarget = pendingJumpTargetRef.current;
    if (!pendingJumpTarget) return;

    const hasTargetSlot = slotOptions.some((slotOption) => slotOption.starts_at === pendingJumpTarget);
    if (hasTargetSlot) {
      slotListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      pendingJumpTargetRef.current = null;
      return;
    }

    if (!loading && slots && slots.length === 0) {
      pendingJumpTargetRef.current = null;
    }
  }, [highlightedSlotStartAt, slotOptions, loading, slots]);

  function onPickSlot(slotOption: SlotOption) {
    const selectedProvider = slotOption.providers[0];
    if (!selectedProvider) {
      setError("Failed to identify the provider for that slot. Please try again.");
      return;
    }
    setError(null);
    startHolding(async () => {
      const res = await createBookingDraftAction({
        tenantId,
        serviceId,
        providerId: selectedProvider.id,
        candidateProviderIds: isNoPreference
          ? slotOption.providers.map((provider) => provider.id)
          : undefined,
        startsAt: slotOption.starts_at,
        endsAt: slotOption.ends_at,
      });
      if (!res.ok || !res.draftId) {
        setError(res.error ?? "Failed to hold slot");
        return;
      }
      router.push(`/${tenantSlug}/book/${res.draftId}`);
    });
  }

  const monthDays = getMonthGridDays(monthDate);
  const canGoPrev = startOfMonth(monthDate).getTime() > startOfMonth(today).getTime();
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const availabilityReady = loadedAvailabilityKey === currentAvailabilityKey;
  const providerHeading = isNoPreference
    ? "All providers"
    : (selectedProvider?.name ?? "Provider");

  function resetMonthAvailability() {
    setAvailabilityError(null);
    setLoadedAvailabilityKey(null);
    setMonthAvailability({});
  }

  function onChangeMonth(offset: number) {
    const nextMonth = addMonths(monthDate, offset);
    resetMonthAvailability();
    setError(null);
    setSlots(null);
    setHighlightedSlotStartAt(null);
    pendingJumpTargetRef.current = null;
    setMonthDate(nextMonth);
    setDate(getPreferredDateForMonth(nextMonth, today));
  }

  function onJumpToNextAvailable() {
    if (!nextAvailableSlot) return;
    const nextDate = parseLocalDate(nextAvailableSlot.date);
    const nextMonth = startOfMonth(nextDate);
    resetMonthAvailability();
    setError(null);
    setSlots(null);
    setHighlightedSlotStartAt(nextAvailableSlot.starts_at);
    pendingJumpTargetRef.current = nextAvailableSlot.starts_at;
    setMonthDate(nextMonth);
    setDate(nextAvailableSlot.date);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.9fr)]">
      <section className="overflow-hidden rounded-[1.75rem] border border-stone-200 bg-[linear-gradient(180deg,#fffdf9_0%,#f7f1e7_100%)] shadow-[0_18px_55px_rgba(41,24,12,0.08)]">
        <div className="border-b border-stone-200 px-6 py-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                Choose a day
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">
                Availability calendar
              </h2>
            </div>
            {showProviderSelector ? (
              <label className="block min-w-[14rem]">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">
                  Provider
                </span>
                <select
                  className="w-full rounded-xl border border-stone-300 bg-white/90 px-3 py-2 text-sm text-stone-900"
                  value={providerId}
                  onChange={(e) => {
                    resetMonthAvailability();
                    setError(null);
                    setSlots(null);
                    setHighlightedSlotStartAt(null);
                    pendingJumpTargetRef.current = null;
                    setProviderId(e.target.value);
                  }}
                >
                  {providers.length > 1 ? (
                    <option value={NO_PREFERENCE_PROVIDER_VALUE}>No preference</option>
                  ) : null}
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="rounded-[1rem] border border-stone-200 bg-white/80 px-4 py-3 text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                  Provider
                </p>
                <p className="mt-1 text-sm font-semibold text-stone-950">
                  {isNoPreference ? "No preference" : (selectedProvider?.name ?? "Selected provider")}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-stone-200 bg-white/80 px-4 py-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500">
                Next available
              </p>
              {loadingNextAvailable ? (
                <p className="mt-1 text-sm text-stone-500">Checking the earliest opening…</p>
              ) : nextAvailableSlot ? (
                <>
                  <p className="mt-1 text-base font-semibold text-stone-950">
                    {formatNextAvailable(nextAvailableSlot.starts_at, timeZone)}
                  </p>
                  <p className="mt-1 text-sm text-stone-600">
                    {isNoPreference
                      ? `Earliest opening across ${providers.length === 1 ? "the available provider" : "all available providers"}.`
                      : `Earliest opening for ${selectedProvider?.name ?? "this provider"}.`}
                  </p>
                </>
              ) : nextAvailableError ? (
                <p className="mt-1 text-sm text-red-600">{nextAvailableError}</p>
              ) : (
                <p className="mt-1 text-sm text-stone-500">No openings found in the current booking window.</p>
              )}
            </div>

            <button
              type="button"
              onClick={onJumpToNextAvailable}
              disabled={!nextAvailableSlot || loadingNextAvailable}
              className="rounded-full border border-stone-300 bg-stone-950 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-500"
            >
              Jump to next time
            </button>
          </div>

          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => canGoPrev && onChangeMonth(-1)}
              disabled={!canGoPrev}
              className="rounded-full border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ←
            </button>
            <div className="text-center">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-stone-500">
                {providerHeading}
              </p>
              <h3 className="mt-1 text-xl font-semibold text-stone-950">
                {monthDate.toLocaleDateString(undefined, {
                  month: "long",
                  year: "numeric",
                })}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onChangeMonth(1)}
              className="rounded-full border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
            >
              →
            </button>
          </div>

          {loadingAvailability ? (
            <p className="mb-4 text-sm text-stone-500">Checking availability across the month…</p>
          ) : null}
          {availabilityError ? <p className="mb-4 text-sm text-red-600">{availabilityError}</p> : null}

          <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="py-2">
                {label}
              </div>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-7 gap-2">
            {monthDays.map((day) => {
              const iso = fmtLocalDate(day);
              const isToday = iso === todayIso;
              const isSelected = iso === date;
              const inMonth = day.getMonth() === monthDate.getMonth();
              const isPast = iso < todayIso;
              const slotCount = inMonth && availabilityReady ? monthAvailability[iso] ?? 0 : null;
              const hasAvailability = typeof slotCount === "number" && slotCount > 0;
              const isUnavailable = inMonth && availabilityReady && slotCount === 0;
              const label = isPast
                ? "Past"
                : !inMonth
                  ? day.toLocaleDateString(undefined, { month: "short" })
                  : !availabilityReady
                    ? "Checking"
                    : hasAvailability
                      ? `${slotCount} ${slotCount === 1 ? "slot" : "slots"}`
                      : "Booked";
              const disabled = isPast || (inMonth && (loadingAvailability || isUnavailable));

              return (
                <button
                  key={iso}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    if (day.getMonth() !== monthDate.getMonth()) {
                      resetMonthAvailability();
                    }
                    setError(null);
                    setSlots(null);
                    setHighlightedSlotStartAt(null);
                    pendingJumpTargetRef.current = null;
                    setDate(iso);
                    if (day.getMonth() !== monthDate.getMonth()) {
                      setMonthDate(startOfMonth(day));
                    }
                  }}
                  className={
                    "group aspect-square rounded-2xl border px-2 py-3 text-left transition " +
                    (isSelected
                      ? "border-stone-900 bg-stone-900 text-white shadow-[0_18px_40px_rgba(28,16,7,0.18)]"
                      : isPast
                        ? "border-stone-200 bg-stone-100/70 text-stone-400"
                        : isUnavailable
                          ? "border-stone-200 bg-stone-100/80 text-stone-400"
                        : inMonth
                          ? "border-stone-200 bg-white text-stone-900 hover:border-stone-400 hover:bg-stone-50"
                          : "border-stone-200/70 bg-stone-50/80 text-stone-500 hover:border-stone-300 hover:bg-stone-100")
                  }
                >
                  <div className="flex h-full flex-col justify-between">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold">{day.getDate()}</span>
                      {hasAvailability && !isSelected ? (
                        <span className="mt-1 h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      ) : null}
                    </div>
                    <span
                      className={
                        "text-[11px] uppercase tracking-wide " +
                        (isSelected
                          ? "text-stone-200"
                          : isToday
                            ? "text-amber-700"
                            : hasAvailability
                              ? "text-emerald-700"
                            : "text-stone-400")
                      }
                    >
                      {label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <aside ref={slotListRef} className="rounded-[1.75rem] border border-stone-200 bg-white p-6 shadow-[0_18px_55px_rgba(41,24,12,0.08)]">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
          Selected date
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">
          {formatSelectedDate(date)}
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          {isNoPreference
            ? "Showing times across every provider for this service who is available on this day."
            : selectedProvider?.name
              ? `Showing times for ${selectedProvider.name}.`
              : "Choose a provider to continue."}
        </p>
        {isNoPreference ? (
          <p className="mt-2 text-xs uppercase tracking-[0.18em] text-stone-500">
            Each time groups matching openings together and assigns the first available provider.
          </p>
        ) : null}
        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-stone-400">
          Times shown in the business timezone
        </p>

        {loading ? <p className="mt-6 text-sm text-stone-500">Loading times...</p> : null}
        {error ? <p className="mt-6 text-sm text-red-600">{error}</p> : null}

        {!loading && slots && slots.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-stone-600">
            {isNoPreference
              ? "No providers have times available on this day. Try another date in the calendar."
              : "No times are available on this day. Try another date in the calendar."}
          </div>
        ) : null}

        {!loading && slotOptions.length > 0 ? (
          <div className={"mt-6 grid gap-2 " + (isNoPreference ? "grid-cols-1" : "grid-cols-2")}>
            {slotOptions.map((slotOption) => {
              const providerSummary = summarizeProviders(slotOption.providers);

              return (
              <button
                key={`${slotOption.starts_at}:${slotOption.ends_at}`}
                type="button"
                disabled={holding}
                onClick={() => onPickSlot(slotOption)}
                className={
                  "rounded-2xl border px-3 py-3 text-sm font-medium text-stone-900 hover:border-stone-900 hover:bg-stone-100 disabled:opacity-50 " +
                  (highlightedSlotStartAt === slotOption.starts_at
                    ? "border-stone-900 bg-stone-100 shadow-[0_12px_30px_rgba(41,24,12,0.12)] "
                    : "border-stone-300 bg-stone-50 ") +
                  (isNoPreference ? "text-left" : "")
                }
              >
                <span className="block">{formatTime(slotOption.starts_at, timeZone)}</span>
                {isNoPreference ? (
                  <>
                    <span className="mt-1 block text-xs uppercase tracking-[0.18em] text-stone-500">
                      {providerSummary.label}
                    </span>
                    {providerSummary.detail ? (
                      <span className="mt-1 block text-xs text-stone-500">{providerSummary.detail}</span>
                    ) : null}
                  </>
                ) : null}
              </button>
              );
            })}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function todayIsoDate() {
  return fmtLocalDate(new Date());
}

function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatSelectedDate(iso: string) {
  return parseLocalDate(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatNextAvailable(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(value);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function fmtLocalDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const weekday = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - weekday);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function getMonthGridDays(monthDate: Date) {
  const start = startOfWeek(startOfMonth(monthDate));
  const days: Date[] = [];
  for (let index = 0; index < 42; index += 1) {
    days.push(addDays(start, index));
  }
  return days;
}

function getPreferredDateForMonth(monthDate: Date, today: Date) {
  const monthStart = startOfMonth(monthDate);
  return fmtLocalDate(monthStart.getTime() <= startOfMonth(today).getTime() ? today : monthStart);
}

function toActionProviderId(providerId: string) {
  return providerId === NO_PREFERENCE_PROVIDER_VALUE ? undefined : providerId;
}

function buildSlotOptions(slots: Slot[]) {
  const grouped = new Map<string, SlotOption>();

  for (const slot of slots) {
    const key = `${slot.starts_at}:${slot.ends_at}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.providers.push({ id: slot.provider_id, name: slot.provider_name });
      continue;
    }

    grouped.set(key, {
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      providers: [{ id: slot.provider_id, name: slot.provider_name }],
    });
  }

  return Array.from(grouped.values());
}

function summarizeProviders(providers: Provider[]) {
  if (providers.length === 0) {
    return { label: "No providers", detail: null };
  }

  if (providers.length === 1) {
    return { label: providers[0].name, detail: "1 provider available" };
  }

  if (providers.length === 2) {
    return {
      label: "2 providers available",
      detail: `${providers[0].name} or ${providers[1].name}`,
    };
  }

  return {
    label: `${providers.length} providers available`,
    detail: providers.map((provider) => provider.name).join(", "),
  };
}
