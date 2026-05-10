import Link from "next/link";
import { requireTenant } from "@/lib/admin/require-tenant";

export const metadata = { title: "Calendar — BookingSite" };

const DAY_MS = 24 * 60 * 60 * 1000;

function parseLocalDate(s: string | undefined): Date {
  if (!s) return new Date();
  // Expect YYYY-MM-DD; parse as local midnight to avoid TZ drift.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fmtLocalDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfWeek(d: Date) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const day = (out.getDay() + 6) % 7; // Monday-start
  out.setDate(out.getDate() - day);
  return out;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function endOfMonthGrid(d: Date) {
  // First day after the last week shown in the month grid (Monday-start).
  const monthEnd = endOfMonth(d);
  const last = new Date(monthEnd.getTime() - DAY_MS);
  const startOfLastWeek = startOfWeek(last);
  return new Date(startOfLastWeek.getTime() + 7 * DAY_MS);
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

type View = "week" | "month";

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
  searchParams: Promise<{ date?: string; week?: string; provider?: string; view?: string }>;
}) {
  const params = await searchParams;
  const { supabase, tenantId } = await requireTenant();

  const view: View = params.view === "month" ? "month" : "week";
  // Accept legacy `week` param for back-compat.
  const baseDate = parseLocalDate(params.date ?? params.week);
  const providerFilter = params.provider && params.provider !== "all" ? params.provider : null;

  const rangeStart =
    view === "month" ? startOfWeek(startOfMonth(baseDate)) : startOfWeek(baseDate);
  const rangeEnd =
    view === "month" ? endOfMonthGrid(baseDate) : new Date(rangeStart.getTime() + 7 * DAY_MS);

  let q = supabase
    .from("bookings")
    .select(
      "id, starts_at, ends_at, status, provider_id, customers(name), services(name), providers(name)"
    )
    .eq("tenant_id", tenantId)
    .gte("starts_at", rangeStart.toISOString())
    .lt("starts_at", rangeEnd.toISOString())
    .neq("status", "canceled")
    .order("starts_at", { ascending: true });

  if (providerFilter) q = q.eq("provider_id", providerFilter);

  const [bookingsRes, providersRes] = await Promise.all([
    q,
    supabase
      .from("providers")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name"),
  ]);

  // Bucket bookings by local YYYY-MM-DD.
  const bookingsByDay = new Map<string, Booking[]>();
  for (const b of (bookingsRes.data ?? []) as Booking[]) {
    const key = fmtLocalDate(new Date(b.starts_at));
    const list = bookingsByDay.get(key) ?? [];
    list.push(b);
    bookingsByDay.set(key, list);
  }

  const baseHref = (overrides: { view?: View; date?: string; provider?: string | null }) => {
    const sp = new URLSearchParams();
    sp.set("view", overrides.view ?? view);
    sp.set("date", overrides.date ?? fmtLocalDate(baseDate));
    const prov = overrides.provider !== undefined ? overrides.provider : providerFilter;
    if (prov) sp.set("provider", prov);
    return `/admin/calendar?${sp.toString()}`;
  };

  const todayStr = fmtLocalDate(new Date());

  const navPrev =
    view === "week" ? fmtLocalDate(addDays(baseDate, -7)) : fmtLocalDate(addMonths(baseDate, -1));
  const navNext =
    view === "week" ? fmtLocalDate(addDays(baseDate, 7)) : fmtLocalDate(addMonths(baseDate, 1));

  const heading =
    view === "week"
      ? `Week of ${startOfWeek(baseDate).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`
      : baseDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{heading}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center overflow-hidden rounded-md border border-neutral-300 text-sm dark:border-neutral-700">
            <Link
              href={baseHref({ view: "week" })}
              className={
                "px-3 py-1 " +
                (view === "week"
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "hover:bg-neutral-50 dark:hover:bg-neutral-900")
              }
            >
              Week
            </Link>
            <Link
              href={baseHref({ view: "month" })}
              className={
                "px-3 py-1 " +
                (view === "month"
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "hover:bg-neutral-50 dark:hover:bg-neutral-900")
              }
            >
              Month
            </Link>
          </div>
          <Link
            href={baseHref({ date: navPrev })}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            ←
          </Link>
          <Link
            href={baseHref({ date: todayStr })}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            Today
          </Link>
          <Link
            href={baseHref({ date: navNext })}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            →
          </Link>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="date" value={fmtLocalDate(baseDate)} />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Provider</span>
          <select
            name="provider"
            defaultValue={providerFilter ?? "all"}
            className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-950"
          >
            <option value="all">All providers</option>
            {(providersRes.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Apply
        </button>
      </form>

      {bookingsRes.error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {bookingsRes.error.message}
        </p>
      )}

      {view === "week" ? (
        <WeekGrid
          weekStart={startOfWeek(baseDate)}
          bookingsByDay={bookingsByDay}
          showProvider={!providerFilter}
          todayStr={todayStr}
        />
      ) : (
        <MonthGrid
          baseDate={baseDate}
          bookingsByDay={bookingsByDay}
          showProvider={!providerFilter}
          todayStr={todayStr}
        />
      )}
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
  baseDate,
  bookingsByDay,
  showProvider,
  todayStr,
}: {
  baseDate: Date;
  bookingsByDay: Map<string, Booking[]>;
  showProvider: boolean;
  todayStr: string;
}) {
  const gridStart = startOfWeek(startOfMonth(baseDate));
  const gridEnd = endOfMonthGrid(baseDate);
  const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / DAY_MS);
  const days: Date[] = [];
  for (let i = 0; i < totalDays; i++) days.push(addDays(gridStart, i));
  const month = baseDate.getMonth();
  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
      <div className="grid grid-cols-7 border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
        {weekdayLabels.map((w) => (
          <div key={w} className="px-2 py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = fmtLocalDate(day);
          const inMonth = day.getMonth() === month;
          const isToday = key === todayStr;
          const list = bookingsByDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={
                "min-h-[110px] border-b border-r border-neutral-200 p-1.5 text-xs dark:border-neutral-800 " +
                (inMonth ? "" : "bg-neutral-50/60 text-neutral-400 dark:bg-neutral-950/60")
              }
            >
              <div
                className={
                  "mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] " +
                  (isToday
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "")
                }
              >
                {day.getDate()}
              </div>
              <ul className="space-y-0.5">
                {list.slice(0, 3).map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/admin/bookings/${b.id}`}
                      className="block truncate rounded bg-neutral-100 px-1 py-0.5 hover:bg-neutral-200 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                      title={`${fmtTime(b.starts_at)} ${getName(b.customers) ?? ""} ${getName(b.services) ?? ""}`}
                    >
                      <span className="font-medium">{fmtTime(b.starts_at)}</span>{" "}
                      <span>{getName(b.customers) ?? "—"}</span>
                      {showProvider && getName(b.providers) ? (
                        <span className="text-neutral-500"> · {getName(b.providers)}</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
                {list.length > 3 && (
                  <li className="px-1 text-[11px] text-neutral-500">+{list.length - 3} more</li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
