import Link from "next/link";
import { requireTenant } from "@/lib/admin/require-tenant";
import { MiniMonth } from "./mini-month";
import {
  DAY_MS,
  addDays,
  addMonths,
  endOfMonthGrid,
  fmtLocalDate,
  fmtTime,
  parseLocalDate,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "./date-utils";

export const metadata = { title: "Calendar — BookingSite" };

type View = "day" | "week" | "month";

type Booking = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  provider_id: string;
  customers: { name: string | null } | { name: string | null }[] | null;
  services: { name: string | null } | { name: string | null }[] | null;
  providers: { name: string | null } | { name: string | null }[] | null;
};

function getName<T extends { name: string | null }>(v: T | T[] | null): string | null {
  const x = Array.isArray(v) ? v[0] : v;
  return x?.name ?? null;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    week?: string;
    month?: string;
    provider?: string;
    view?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, tenantId } = await requireTenant();

  const view: View =
    params.view === "day" ? "day" : params.view === "week" ? "week" : "month";
  const baseDate = parseLocalDate(params.date ?? params.week ?? params.month);
  const sidebarMonthDate = parseLocalDate(params.month) ?? baseDate;
  // If month not in URL, follow the selected date.
  const monthAnchor = params.month ? sidebarMonthDate : startOfMonth(baseDate);

  const providerFilter = params.provider && params.provider !== "all" ? params.provider : null;

  // Main range — what we'll display in the active view.
  const mainStart =
    view === "day"
      ? startOfDay(baseDate)
      : view === "week"
        ? startOfWeek(baseDate)
        : startOfWeek(startOfMonth(baseDate));
  const mainEnd =
    view === "day"
      ? new Date(mainStart.getTime() + DAY_MS)
      : view === "week"
        ? new Date(mainStart.getTime() + 7 * DAY_MS)
        : endOfMonthGrid(baseDate);

  // Sidebar mini-month range — for the dot indicators.
  const miniStart = startOfWeek(startOfMonth(monthAnchor));
  const miniEnd = endOfMonthGrid(monthAnchor);

  // Combined fetch range covers both.
  const fetchStart = mainStart < miniStart ? mainStart : miniStart;
  const fetchEnd = mainEnd > miniEnd ? mainEnd : miniEnd;

  let q = supabase
    .from("bookings")
    .select(
      "id, starts_at, ends_at, status, provider_id, customers(name), services(name), providers(name)"
    )
    .eq("tenant_id", tenantId)
    .gte("starts_at", fetchStart.toISOString())
    .lt("starts_at", fetchEnd.toISOString())
    .neq("status", "canceled")
    .order("starts_at", { ascending: true });

  if (view !== "day" && providerFilter) {
    q = q.eq("provider_id", providerFilter);
  }

  const [bookingsRes, providersRes] = await Promise.all([
    q,
    supabase
      .from("providers")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name"),
  ]);

  const allBookings = (bookingsRes.data ?? []) as Booking[];

  // Bucket by local YYYY-MM-DD for grid rendering.
  const bookingsByDay = new Map<string, Booking[]>();
  for (const b of allBookings) {
    const key = fmtLocalDate(new Date(b.starts_at));
    const list = bookingsByDay.get(key) ?? [];
    list.push(b);
    bookingsByDay.set(key, list);
  }

  // Counts for the mini-month dots.
  const countsByDay = new Map<string, number>();
  for (const [k, v] of bookingsByDay) countsByDay.set(k, v.length);

  const todayStr = fmtLocalDate(new Date());

  const buildHref = (overrides: {
    view?: View;
    date?: string;
    month?: string;
    provider?: string | null;
  }) => {
    const sp = new URLSearchParams();
    sp.set("view", overrides.view ?? view);
    sp.set("date", overrides.date ?? fmtLocalDate(baseDate));
    if (overrides.month !== undefined) sp.set("month", overrides.month);
    else if (params.month) sp.set("month", params.month);
    else sp.set("month", fmtLocalDate(startOfMonth(baseDate)));
    const prov =
      overrides.provider !== undefined ? overrides.provider : providerFilter;
    if (prov) sp.set("provider", prov);
    return `/admin/calendar?${sp.toString()}`;
  };

  const navPrev =
    view === "day"
      ? fmtLocalDate(addDays(baseDate, -1))
      : view === "week"
        ? fmtLocalDate(addDays(baseDate, -7))
        : fmtLocalDate(addMonths(startOfMonth(baseDate), -1));
  const navNext =
    view === "day"
      ? fmtLocalDate(addDays(baseDate, 1))
      : view === "week"
        ? fmtLocalDate(addDays(baseDate, 7))
        : fmtLocalDate(addMonths(startOfMonth(baseDate), 1));
  const navMonth = view === "month" ? navPrev : fmtLocalDate(monthAnchor);
  const nextNavMonth = view === "month" ? navNext : fmtLocalDate(monthAnchor);

  const heading =
    view === "day"
      ? baseDate.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : view === "week"
        ? `Week of ${startOfWeek(baseDate).toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}`
        : baseDate.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
      {/* Sidebar */}
      <aside className="space-y-4">
        <MiniMonth
          monthDate={monthAnchor}
          selectedDate={baseDate}
          hrefFor={(o) => buildHref({ ...o })}
          countsByDay={countsByDay}
        />
        {view !== "day" && (
          <div className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
            <div className="mb-2 text-xs font-semibold uppercase text-neutral-500">
              Provider
            </div>
            <ul className="space-y-1">
              <li>
                <Link
                  href={buildHref({ provider: null })}
                  className={
                    "block rounded px-2 py-1 " +
                    (!providerFilter
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "hover:bg-neutral-100 dark:hover:bg-neutral-800")
                  }
                >
                  All providers
                </Link>
              </li>
              {(providersRes.data ?? []).map((p) => (
                <li key={p.id}>
                  <Link
                    href={buildHref({ provider: p.id })}
                    className={
                      "block rounded px-2 py-1 " +
                      (providerFilter === p.id
                        ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                        : "hover:bg-neutral-100 dark:hover:bg-neutral-800")
                    }
                  >
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      {/* Main */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{heading}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center overflow-hidden rounded-md border border-neutral-300 text-sm dark:border-neutral-700">
              <Link
                href={buildHref({
                  view: "month",
                  month: fmtLocalDate(startOfMonth(baseDate)),
                })}
                className={
                  "px-3 py-1 " +
                  (view === "month"
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-900")
                }
              >
                Month
              </Link>
              <Link
                href={buildHref({ view: "day" })}
                className={
                  "px-3 py-1 " +
                  (view === "day"
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-900")
                }
              >
                Day
              </Link>
              <Link
                href={buildHref({ view: "week" })}
                className={
                  "px-3 py-1 " +
                  (view === "week"
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-900")
                }
              >
                Week
              </Link>
            </div>
            <Link
              href={buildHref({
                date: navPrev,
                month: navMonth,
              })}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              ←
            </Link>
            <Link
              href={buildHref({ date: todayStr, month: fmtLocalDate(startOfMonth(new Date())) })}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              Today
            </Link>
            <Link
              href={buildHref({
                date: navNext,
                month: nextNavMonth,
              })}
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              →
            </Link>
          </div>
        </div>

        {bookingsRes.error && (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {bookingsRes.error.message}
          </p>
        )}

        {view === "day" ? (
          <DayView
            date={baseDate}
            providers={providersRes.data ?? []}
            bookings={(bookingsByDay.get(fmtLocalDate(baseDate)) ?? []).filter(
              (b) => !providerFilter || b.provider_id === providerFilter
            )}
          />
        ) : view === "week" ? (
          <WeekGrid
            weekStart={startOfWeek(baseDate)}
            bookingsByDay={bookingsByDay}
            showProvider={!providerFilter}
            todayStr={todayStr}
          />
        ) : (
          <MonthGrid
            monthDate={startOfMonth(baseDate)}
            selectedDate={baseDate}
            bookingsByDay={bookingsByDay}
            showProvider={!providerFilter}
            todayStr={todayStr}
            hrefForDate={(date) =>
              buildHref({
                view: "day",
                date,
                month: fmtLocalDate(startOfMonth(baseDate)),
              })
            }
          />
        )}
      </div>
    </div>
  );
}

function DayView({
  date,
  providers,
  bookings,
}: {
  date: Date;
  providers: { id: string; name: string }[];
  bookings: Booking[];
}) {
  // Group bookings by provider; only show providers with at least one booking,
  // followed by an "Off / no bookings" list of remaining providers.
  const byProvider = new Map<string, Booking[]>();
  for (const b of bookings) {
    const list = byProvider.get(b.provider_id) ?? [];
    list.push(b);
    byProvider.set(b.provider_id, list);
  }

  if (bookings.length === 0) {
    return (
      <div className="rounded-md border border-neutral-200 p-8 text-center text-sm text-neutral-500 dark:border-neutral-800">
        No bookings on{" "}
        {date.toLocaleDateString(undefined, { month: "long", day: "numeric" })}.
      </div>
    );
  }

  const withBookings = providers.filter((p) => byProvider.has(p.id));
  // Some bookings may reference inactive providers not in the providers list — group them too.
  const knownIds = new Set(providers.map((p) => p.id));
  const orphanProviderIds = Array.from(byProvider.keys()).filter((id) => !knownIds.has(id));

  return (
    <div className="space-y-4">
      {withBookings.map((p) => (
        <ProviderDayCard key={p.id} name={p.name} bookings={byProvider.get(p.id) ?? []} />
      ))}
      {orphanProviderIds.map((id) => {
        const list = byProvider.get(id) ?? [];
        const name = getName(list[0]?.providers) ?? "Provider";
        return <ProviderDayCard key={id} name={name} bookings={list} />;
      })}
    </div>
  );
}

function ProviderDayCard({ name, bookings }: { name: string; bookings: Booking[] }) {
  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800">
      <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-sm font-medium dark:border-neutral-800 dark:bg-neutral-900">
        {name}
        <span className="ml-2 text-xs font-normal text-neutral-500">
          {bookings.length} booking{bookings.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {bookings.map((b) => {
          const c = getName(b.customers);
          const s = getName(b.services);
          return (
            <li key={b.id}>
              <Link
                href={`/admin/bookings/${b.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <div className="flex items-center gap-4">
                  <div className="w-28 tabular-nums text-neutral-600 dark:text-neutral-400">
                    {fmtTime(b.starts_at)} – {fmtTime(b.ends_at)}
                  </div>
                  <div>
                    <div className="font-medium">{c ?? "—"}</div>
                    <div className="text-xs text-neutral-500">{s}</div>
                  </div>
                </div>
                <span className="text-xs text-neutral-400">View →</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WeekGrid({
  weekStart,
  bookingsByDay,
  showProvider,
  todayStr,
}: {
  weekStart: Date;
  bookingsByDay: Map<string, Booking[]>;
  showProvider: boolean;
  todayStr: string;
}) {
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) days.push(addDays(weekStart, i));
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
      {days.map((day) => {
        const key = fmtLocalDate(day);
        const list = bookingsByDay.get(key) ?? [];
        const isToday = key === todayStr;
        return (
          <div
            key={key}
            className={
              "rounded-md border p-2 text-sm " +
              (isToday
                ? "border-neutral-900 dark:border-neutral-100"
                : "border-neutral-200 dark:border-neutral-800")
            }
          >
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs uppercase text-neutral-500">
                {day.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span className="font-medium">
                {day.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
              </span>
            </div>
            {list.length === 0 ? (
              <p className="text-xs text-neutral-400">—</p>
            ) : (
              <ul className="space-y-1">
                {list.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/admin/bookings/${b.id}`}
                      className="block rounded-md bg-neutral-100 px-2 py-1 hover:bg-neutral-200 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                    >
                      <div className="text-xs font-medium">{fmtTime(b.starts_at)}</div>
                      <div className="text-xs">{getName(b.customers) ?? "—"}</div>
                      <div className="text-xs text-neutral-500">
                        {getName(b.services)}
                        {showProvider && getName(b.providers) ? ` · ${getName(b.providers)}` : ""}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MonthGrid({
  monthDate,
  selectedDate,
  bookingsByDay,
  showProvider,
  todayStr,
  hrefForDate,
}: {
  monthDate: Date;
  selectedDate: Date;
  bookingsByDay: Map<string, Booking[]>;
  showProvider: boolean;
  todayStr: string;
  hrefForDate: (date: string) => string;
}) {
  const gridStart = startOfWeek(startOfMonth(monthDate));
  const gridEnd = endOfMonthGrid(monthDate);
  const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / DAY_MS);
  const days: Date[] = [];
  for (let index = 0; index < totalDays; index += 1) {
    days.push(addDays(gridStart, index));
  }

  const month = monthDate.getMonth();
  const selectedStr = fmtLocalDate(selectedDate);
  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
      <div className="min-w-[64rem] bg-white dark:bg-neutral-950">
        <div className="grid grid-cols-7 border-b border-neutral-200 dark:border-neutral-800">
          {weekdayLabels.map((label) => (
            <div
              key={label}
              className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-500"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = fmtLocalDate(day);
            const list = bookingsByDay.get(key) ?? [];
            const isToday = key === todayStr;
            const isSelected = key === selectedStr;
            const inMonth = day.getMonth() === month;
            const overflowCount = Math.max(list.length - 3, 0);

            return (
              <div
                key={key}
                className={
                  "min-h-40 border-b border-r border-neutral-200 p-3 align-top dark:border-neutral-800 " +
                  (inMonth ? "bg-white dark:bg-neutral-950" : "bg-neutral-50/80 dark:bg-neutral-900")
                }
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <Link
                    href={hrefForDate(key)}
                    className={
                      "inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-sm font-semibold " +
                      (isSelected
                        ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                        : isToday
                          ? "ring-1 ring-neutral-900 dark:ring-neutral-100"
                          : inMonth
                            ? "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            : "text-neutral-400 hover:bg-neutral-100 dark:text-neutral-600 dark:hover:bg-neutral-800")
                    }
                  >
                    {day.getDate()}
                  </Link>
                  <span className="text-xs text-neutral-400">
                    {list.length > 0 ? `${list.length} booked` : ""}
                  </span>
                </div>

                {list.length === 0 ? (
                  <div className="pt-6 text-xs text-neutral-400">No bookings</div>
                ) : (
                  <div className="space-y-2">
                    {list.slice(0, 3).map((booking) => (
                      <Link
                        key={booking.id}
                        href={`/admin/bookings/${booking.id}`}
                        className="block rounded-lg bg-neutral-100 px-3 py-2 text-xs hover:bg-neutral-200 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                      >
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">
                          {fmtTime(booking.starts_at)} · {getName(booking.customers) ?? "—"}
                        </div>
                        <div className="mt-1 text-neutral-500">
                          {getName(booking.services)}
                          {showProvider && getName(booking.providers)
                            ? ` · ${getName(booking.providers)}`
                            : ""}
                        </div>
                      </Link>
                    ))}
                    {overflowCount > 0 ? (
                      <Link
                        href={hrefForDate(key)}
                        className="block rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:text-neutral-100"
                      >
                        +{overflowCount} more
                      </Link>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
