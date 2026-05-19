"use client";

import Link from "next/link";
import { useState } from "react";
import { addDays, fmtLocalDate, parseLocalDate, startOfWeek } from "./date-utils";

const HOUR_HEIGHT = 88;

export type CalendarScheduleBooking = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  priceCents: number;
  depositStatus: string | null;
  balanceDueCents: number;
  providerId: string;
  customer: {
    id: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    createdAt: string | null;
  } | null;
  service: {
    name: string | null;
  } | null;
  provider: {
    name: string | null;
  } | null;
};

type ScheduleColumn = {
  key: string;
  label: string;
  sublabel: string;
  accent?: string;
  bookings: CalendarScheduleBooking[];
};

export function DayWeekSchedule({
  view,
  baseDateKey,
  todayKey,
  providerFilter,
  providers,
  bookings,
  canManageCheckout,
}: {
  view: "day" | "week";
  baseDateKey: string;
  todayKey: string;
  providerFilter: string | null;
  providers: { id: string; name: string }[];
  bookings: CalendarScheduleBooking[];
  canManageCheckout: boolean;
}) {
  const defaultSelectedBooking = bookings.find(canOpenBookingCheckout) ?? bookings[0] ?? null;
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(defaultSelectedBooking?.id ?? null);
  const selectedBooking =
    bookings.find((booking) => booking.id === selectedBookingId) ?? defaultSelectedBooking;

  const { startHour, endHour } = getVisibleHourRange(bookings);
  const columns =
    view === "week"
      ? buildWeekColumns(baseDateKey, todayKey, bookings)
      : buildDayColumns(baseDateKey, providerFilter, providers, bookings);
  const totalHeight = Math.max((endHour - startHour) * HOUR_HEIGHT, HOUR_HEIGHT * 8);
  const timeLabels = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);

  if (columns.length === 0) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950">
        No appointments match this view yet.
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
        <div className="grid grid-cols-[72px_repeat(var(--column-count),minmax(0,1fr))] border-b border-neutral-200 dark:border-neutral-800" style={{ ["--column-count" as string]: columns.length }}>
          <div className="border-r border-neutral-200 px-3 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400 dark:border-neutral-800">
            Time
          </div>
          {columns.map((column) => (
            <div
              key={column.key}
              className="border-r border-neutral-200 px-4 py-4 last:border-r-0 dark:border-neutral-800"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400">
                {column.label}
              </div>
              <div className="mt-1 text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                {column.sublabel}
              </div>
              {column.accent ? (
                <div className="mt-1 text-xs text-neutral-500">{column.accent}</div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[72px_repeat(var(--column-count),minmax(0,1fr))]" style={{ ["--column-count" as string]: columns.length }}>
          <div className="border-r border-neutral-200 bg-neutral-50/70 dark:border-neutral-800 dark:bg-neutral-900/40">
            {timeLabels.slice(0, -1).map((hour) => (
              <div
                key={hour}
                className="border-b border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-500 dark:border-neutral-800 dark:text-neutral-400"
                style={{ height: HOUR_HEIGHT }}
              >
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>

          {columns.map((column) => (
            (() => {
              const laidOutBookings = layoutColumnBookings(column.bookings);

              return (
            <div
              key={column.key}
              className="relative border-r border-neutral-200 last:border-r-0 dark:border-neutral-800"
              style={{ height: totalHeight }}
            >
              {timeLabels.slice(0, -1).map((hour) => (
                <div
                  key={`${column.key}-${hour}`}
                  className="absolute inset-x-0 border-t border-neutral-200 dark:border-neutral-800"
                  style={{ top: (hour - startHour) * HOUR_HEIGHT }}
                />
              ))}

              {laidOutBookings.map(({ booking, laneIndex, laneCount }) => {
                const top = getMinutesFromHourStart(booking.startsAt, startHour);
                const height = Math.max(getDurationMinutes(booking.startsAt, booking.endsAt) * (HOUR_HEIGHT / 60), 56);
                const isSelected = booking.id === selectedBooking?.id;
                const hasCheckoutBalance = canOpenBookingCheckout(booking);

                return (
                  <button
                    key={booking.id}
                    type="button"
                    onClick={() => setSelectedBookingId(booking.id)}
                    className={
                      "absolute left-2 right-2 overflow-hidden rounded-2xl border px-3 py-2 text-left shadow-sm transition hover:shadow-md " +
                      (hasCheckoutBalance
                        ? isSelected
                          ? "border-amber-600 bg-amber-200/95 ring-2 ring-amber-600 dark:border-amber-300 dark:bg-amber-400/70 dark:ring-amber-300"
                          : "border-amber-400 bg-amber-100/95 hover:border-amber-500 dark:border-amber-700 dark:bg-amber-950/85 dark:hover:border-amber-600"
                        : isSelected
                          ? "border-neutral-900 bg-cyan-200/90 ring-2 ring-neutral-900 dark:border-neutral-100 dark:bg-cyan-400/80 dark:ring-neutral-100"
                          : "border-cyan-300 bg-cyan-100/90 hover:border-cyan-400 dark:border-cyan-700 dark:bg-cyan-950/80 dark:hover:border-cyan-600")
                    }
                    style={{
                      top,
                      height,
                      left: `calc(${(laneIndex * 100) / laneCount}% + 0.375rem)`,
                      width: `calc(${100 / laneCount}% - 0.5rem)`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">
                        {formatTimeRange(booking.startsAt, booking.endsAt)}
                      </div>
                      {hasCheckoutBalance ? (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-300/15 dark:text-amber-200">
                          Due {formatCompactMoney(booking.balanceDueCents)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 line-clamp-1 text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                      {booking.service?.name ?? "Appointment"}
                    </div>
                    <div className="mt-1 line-clamp-1 text-sm text-neutral-700 dark:text-neutral-200">
                      {booking.customer?.name ?? "Unnamed client"}
                    </div>
                    {view === "week" && !providerFilter && booking.provider?.name ? (
                      <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-300">
                        {booking.provider.name}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
              );
            })()
          ))}
        </div>
      </div>

      <div className="xl:sticky xl:top-4 xl:self-start">
        <AppointmentSidebar booking={selectedBooking} canManageCheckout={canManageCheckout} />
      </div>
    </div>
  );
}

function AppointmentSidebar({
  booking,
  canManageCheckout,
}: {
  booking: CalendarScheduleBooking | null;
  canManageCheckout: boolean;
}) {
  if (!booking) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
        Select an appointment to view details and jump to the client record or checkout flow.
      </div>
    );
  }

  const customerSince = booking.customer?.createdAt
    ? new Date(booking.customer.createdAt).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      })
    : null;
  const canOpenCheckout = canManageCheckout && canOpenBookingCheckout(booking);
  const checkoutHref = `/admin/bookings/${booking.id}?flow=checkout`;
  const bookingHref = `/admin/bookings/${booking.id}`;
  const customerHref = booking.customer?.id ? `/admin/customers/${booking.customer.id}` : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-5 dark:border-neutral-800">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-neutral-400">
            Appointment
          </div>
          <div className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-200">
            <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(booking.status)}`} />
            {formatStatusLabel(booking.status)}
          </div>
        </div>
        {canOpenCheckout ? (
          <Link
            href={checkoutHref}
            className="inline-flex items-center rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
          >
            Collect balance
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-2 border-b border-neutral-200 dark:border-neutral-800">
        <div className="border-r border-neutral-200 px-6 py-5 dark:border-neutral-800">
          <div className="text-sm text-neutral-500 dark:text-neutral-400">When</div>
          <div className="mt-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {new Date(booking.startsAt).toLocaleDateString(undefined, {
              weekday: "short",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>
        <div className="px-6 py-5">
          <div className="text-sm text-neutral-500 dark:text-neutral-400">Time</div>
          <div className="mt-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {formatTimeRange(booking.startsAt, booking.endsAt)}
          </div>
        </div>
      </div>

      <div className="space-y-6 px-6 py-6">
        <div className="space-y-3">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-neutral-400">Client</div>
          <div>
            {customerHref ? (
              <Link href={customerHref} className="text-xl font-semibold text-neutral-900 hover:underline dark:text-neutral-100">
                {booking.customer?.name ?? "Unnamed client"}
              </Link>
            ) : (
              <div className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                {booking.customer?.name ?? "Unnamed client"}
              </div>
            )}
            {customerSince ? (
              <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Client since {customerSince}
              </div>
            ) : null}
          </div>
          <dl className="space-y-2 text-sm text-neutral-700 dark:text-neutral-200">
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 text-neutral-500 dark:text-neutral-400">Phone</dt>
              <dd>{booking.customer?.phone ?? "—"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 text-neutral-500 dark:text-neutral-400">Email</dt>
              <dd className="break-all">{booking.customer?.email ?? "—"}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-3 border-t border-neutral-200 pt-6 dark:border-neutral-800">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-neutral-400">Service</div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                {booking.service?.name ?? "Appointment"}
              </div>
              <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                {booking.provider?.name ?? "Unassigned provider"}
              </div>
            </div>
            <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {formatMoney(booking.priceCents)}
            </div>
          </div>
          <div className="inline-flex rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
            Payment status: {formatDepositStatus(booking.depositStatus)}
          </div>
          <div className="inline-flex rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
            {booking.balanceDueCents > 0
              ? `Amount owing: ${formatMoney(booking.balanceDueCents)}`
              : "Amount owing: $0.00"}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 border-t border-neutral-200 pt-6 dark:border-neutral-800">
          {customerHref ? (
            <Link
              href={customerHref}
              className="inline-flex items-center rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
            >
              Open client
            </Link>
          ) : null}
          <Link
            href={bookingHref}
            className="inline-flex items-center rounded-full border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
          >
            View booking
          </Link>
          {canOpenCheckout ? (
            <Link
              href={checkoutHref}
              className="inline-flex items-center rounded-full bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
            >
              Open checkout
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function buildWeekColumns(
  baseDateKey: string,
  todayKey: string,
  bookings: CalendarScheduleBooking[]
): ScheduleColumn[] {
  const weekStart = startOfWeek(parseLocalDate(baseDateKey));

  return Array.from({ length: 7 }, (_, index) => {
    const day = addDays(weekStart, index);
    const dayKey = fmtLocalDate(day);

    return {
      key: dayKey,
      label: day.toLocaleDateString(undefined, { weekday: "short" }),
      sublabel: day.toLocaleDateString(undefined, { month: "long", day: "numeric" }),
      accent: dayKey === todayKey ? "Today" : undefined,
      bookings: bookings.filter((booking) => fmtLocalDate(new Date(booking.startsAt)) === dayKey),
    };
  });
}

function buildDayColumns(
  baseDateKey: string,
  providerFilter: string | null,
  providers: { id: string; name: string }[],
  bookings: CalendarScheduleBooking[]
): ScheduleColumn[] {
  const day = parseLocalDate(baseDateKey);
  const visibleProviders = providerFilter
    ? providers.filter((provider) => provider.id === providerFilter)
    : providers.filter((provider) => bookings.some((booking) => booking.providerId === provider.id));
  const seenProviderIds = new Set(visibleProviders.map((provider) => provider.id));
  const orphanProviders = bookings
    .map((booking) => ({ id: booking.providerId, name: booking.provider?.name ?? "Provider" }))
    .filter((provider) => {
      if (seenProviderIds.has(provider.id)) return false;
      seenProviderIds.add(provider.id);
      return true;
    });

  return [...visibleProviders, ...orphanProviders].map((provider) => ({
    key: provider.id,
    label: day.toLocaleDateString(undefined, { weekday: "short" }),
    sublabel: day.toLocaleDateString(undefined, { month: "long", day: "numeric" }),
    accent: provider.name,
    bookings: bookings.filter((booking) => booking.providerId === provider.id),
  }));
}

function getVisibleHourRange(bookings: CalendarScheduleBooking[]) {
  if (bookings.length === 0) {
    return { startHour: 8, endHour: 18 };
  }

  let earliestMinutes = Number.POSITIVE_INFINITY;
  let latestMinutes = 0;

  for (const booking of bookings) {
    const start = new Date(booking.startsAt);
    const end = new Date(booking.endsAt);
    earliestMinutes = Math.min(earliestMinutes, start.getHours() * 60 + start.getMinutes());
    latestMinutes = Math.max(latestMinutes, end.getHours() * 60 + end.getMinutes());
  }

  const startHour = Math.max(7, Math.floor(earliestMinutes / 60) - 1);
  const endHour = Math.max(startHour + 8, Math.min(22, Math.ceil(latestMinutes / 60) + 1));

  return { startHour, endHour };
}

function layoutColumnBookings(bookings: CalendarScheduleBooking[]) {
  const sortedBookings = [...bookings].sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
  );
  const groups: CalendarScheduleBooking[][] = [];

  for (const booking of sortedBookings) {
    const start = new Date(booking.startsAt).getTime();
    const lastGroup = groups[groups.length - 1];

    if (!lastGroup) {
      groups.push([booking]);
      continue;
    }

    const groupEnd = Math.max(...lastGroup.map((item) => new Date(item.endsAt).getTime()));

    if (start < groupEnd) {
      lastGroup.push(booking);
    } else {
      groups.push([booking]);
    }
  }

  return groups.flatMap((group) => {
    const laneEnds: number[] = [];
    const laidOut = group.map((booking) => {
      const start = new Date(booking.startsAt).getTime();
      const end = new Date(booking.endsAt).getTime();
      let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd <= start);

      if (laneIndex === -1) {
        laneIndex = laneEnds.length;
        laneEnds.push(end);
      } else {
        laneEnds[laneIndex] = end;
      }

      return { booking, laneIndex };
    });

    return laidOut.map((item) => ({
      ...item,
      laneCount: laneEnds.length,
    }));
  });
}

function getMinutesFromHourStart(iso: string, startHour: number) {
  const date = new Date(iso);
  return ((date.getHours() - startHour) * 60 + date.getMinutes()) * (HOUR_HEIGHT / 60);
}

function getDurationMinutes(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  return Math.max(Math.round((end.getTime() - start.getTime()) / 60000), 30);
}

function formatHourLabel(hour: number) {
  return new Date(2026, 0, 1, hour, 0).toLocaleTimeString(undefined, {
    hour: "numeric",
  });
}

function formatTimeRange(startsAt: string, endsAt: string) {
  return `${new Date(startsAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })} – ${new Date(endsAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function formatStatusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDepositStatus(status: string | null) {
  if (!status) return "Unknown";
  return status.replace(/_/g, " ");
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatCompactMoney(cents: number) {
  const dollars = cents / 100;
  if (Number.isInteger(dollars)) {
    return `$${dollars.toFixed(0)}`;
  }
  return `$${dollars.toFixed(2)}`;
}

function canOpenBookingCheckout(booking: CalendarScheduleBooking) {
  return (
    booking.balanceDueCents > 0 &&
    (booking.status === "confirmed" || booking.status === "completed")
  );
}

function statusDotClass(status: string) {
  if (status === "confirmed") return "bg-cyan-400";
  if (status === "completed") return "bg-green-400";
  if (status === "no_show") return "bg-amber-400";
  return "bg-neutral-400";
}