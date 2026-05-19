import Link from "next/link";
import { canManageBookingCheckout } from "@/lib/admin/roles";
import { requireTenant } from "@/lib/admin/require-tenant";
import { calculateBookingPaymentBreakdown } from "@/lib/payments/booking-checkout";
import { normalizeTenantSettings } from "@/lib/tenants/settings";
import {
  DayWeekSchedule,
  type CalendarScheduleBooking,
} from "./day-week-schedule";
import { CalendarBookingDrawer } from "./new-booking-drawer";
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
  price_cents: number;
  deposit_cents: number;
  deposit_status: string | null;
  refunded_amount_cents: number | null;
  provider_id: string;
  customers:
    | {
        id: string | null;
        name: string | null;
        email: string | null;
        phone: string | null;
        created_at: string | null;
      }
    | {
        id: string | null;
        name: string | null;
        email: string | null;
        phone: string | null;
        created_at: string | null;
      }[]
    | null;
  services: { name: string | null } | { name: string | null }[] | null;
  providers: { name: string | null } | { name: string | null }[] | null;
};

type CalendarProviderRow = {
  id: string;
  name: string;
  provider_locations: { location_id: string }[] | null;
  provider_services:
    | {
        service_id: string;
        price_cents_override: number | null;
        deposit_cents_override: number | null;
        duration_minutes_override: number | null;
      }[]
    | null;
};

type CalendarServiceRow = {
  id: string;
  name: string;
  price_cents: number;
  deposit_cents: number;
  duration_minutes: number;
  service_locations: { location_id: string }[] | null;
  service_forms:
    | {
        form_id: string;
        forms:
          | { customer_prompt_timing: string | null }
          | { customer_prompt_timing: string | null }[]
          | null;
      }[]
    | null;
};

type CalendarLocationRow = {
  id: string;
  name: string;
};

type CalendarCustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
};

function getName<T extends { name: string | null }>(v: T | T[] | null): string | null {
  return normalizeRelation(v)?.name ?? null;
}

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
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
    drawer?: string;
    rebookCustomerId?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase, tenantId, role } = await requireTenant();
  const canManageCheckout = canManageBookingCheckout(role);

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
      "id, starts_at, ends_at, status, price_cents, deposit_cents, deposit_status, refunded_amount_cents, provider_id, customers(id, name, email, phone, created_at), services(name), providers(name)"
    )
    .eq("tenant_id", tenantId)
    .gte("starts_at", fetchStart.toISOString())
    .lt("starts_at", fetchEnd.toISOString())
    .neq("status", "canceled")
    .order("starts_at", { ascending: true });

  if (providerFilter) {
    q = q.eq("provider_id", providerFilter);
  }

  const [bookingsRes, providersRes, servicesRes, locationsRes, customersRes, tenantRes] = await Promise.all([
    q,
    supabase
      .from("providers")
      .select(
        "id, name, provider_locations(location_id), provider_services(service_id, price_cents_override, deposit_cents_override, duration_minutes_override)"
      )
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("services")
      .select(
        "id, name, price_cents, deposit_cents, duration_minutes, service_locations(location_id), service_forms(form_id, forms(customer_prompt_timing))"
      )
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name"),
    supabase
      .from("locations")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name"),
    supabase
      .from("customers")
      .select("id, name, email, phone")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase.from("tenants").select("settings_json").eq("id", tenantId).maybeSingle(),
  ]);

  const taxRatePercent = normalizeTenantSettings(
    (tenantRes.data?.settings_json ?? null) as Partial<Record<string, unknown>> | null
  ).tax_rate_percent;
  const allBookings = (bookingsRes.data ?? []) as Booking[];
  const scheduleBookings: CalendarScheduleBooking[] = allBookings.map((booking) => {
    const customer = normalizeRelation(booking.customers);
    const service = normalizeRelation(booking.services);
    const provider = normalizeRelation(booking.providers);
    const paymentBreakdown = calculateBookingPaymentBreakdown({
      priceCents: booking.price_cents,
      depositCents: booking.deposit_cents,
      depositStatus: booking.deposit_status,
      refundedAmountCents: booking.refunded_amount_cents,
      taxRatePercent,
    });

    return {
      id: booking.id,
      startsAt: booking.starts_at,
      endsAt: booking.ends_at,
      status: booking.status,
      priceCents: booking.price_cents,
      depositStatus: booking.deposit_status,
      balanceDueCents: paymentBreakdown.balanceDueCents,
      providerId: booking.provider_id,
      customer: customer
        ? {
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            createdAt: customer.created_at,
          }
        : null,
      service: service
        ? {
            name: service.name,
          }
        : null,
      provider: provider
        ? {
            name: provider.name,
          }
        : null,
    };
  });
  const providerRows = (providersRes.data ?? []) as CalendarProviderRow[];
  const providers = providerRows.map((provider) => ({ id: provider.id, name: provider.name }));
  const providerOptions = providerRows.map((provider) => ({
    id: provider.id,
    name: provider.name,
    locationIds: (provider.provider_locations ?? []).map((location) => location.location_id),
    serviceIds: (provider.provider_services ?? []).map((service) => service.service_id),
    serviceOverrides: Object.fromEntries(
      (provider.provider_services ?? []).map((service) => [
        service.service_id,
        {
          priceCentsOverride: service.price_cents_override,
          depositCentsOverride: service.deposit_cents_override,
          durationMinutesOverride: service.duration_minutes_override,
        },
      ])
    ),
  }));
  const serviceOptions = ((servicesRes.data ?? []) as CalendarServiceRow[]).map((service) => ({
    id: service.id,
    name: service.name,
    locationIds: (service.service_locations ?? []).map((location) => location.location_id),
    priceCents: service.price_cents,
    depositCents: service.deposit_cents,
    durationMinutes: service.duration_minutes,
    requiresPreBookingForms: (service.service_forms ?? []).some((serviceForm) => {
      const form = Array.isArray(serviceForm.forms) ? serviceForm.forms[0] : serviceForm.forms;
      return (form?.customer_prompt_timing ?? "pre_booking") === "pre_booking";
    }),
  }));
  const locationOptions = ((locationsRes.data ?? []) as CalendarLocationRow[]).map((location) => ({
    id: location.id,
    name: location.name,
  }));
  let customerOptions = ((customersRes.data ?? []) as CalendarCustomerRow[]).map((customer) => ({
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
  }));
  let rebookCustomer =
    params.rebookCustomerId
      ? customerOptions.find((customer) => customer.id === params.rebookCustomerId) ?? null
      : null;

  if (params.rebookCustomerId && !rebookCustomer) {
    const { data: exactCustomer } = await supabase
      .from("customers")
      .select("id, name, email, phone")
      .eq("tenant_id", tenantId)
      .eq("id", params.rebookCustomerId)
      .maybeSingle();

    if (exactCustomer) {
      rebookCustomer = exactCustomer;
      customerOptions = [exactCustomer, ...customerOptions.filter((customer) => customer.id !== exactCustomer.id)];
    }
  }

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
  const drawerStateKey = [
    fmtLocalDate(baseDate),
    providerFilter ?? "all",
    params.drawer ?? "closed",
    rebookCustomer?.id ?? "none",
  ].join(":");

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

  const showMonthSidebar = view === "month";

  return (
    <div className={showMonthSidebar ? "grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]" : "space-y-4"}>
      {showMonthSidebar ? (
        <aside className="space-y-4">
          <MiniMonth
            monthDate={monthAnchor}
            selectedDate={baseDate}
            hrefFor={(o) => buildHref({ ...o })}
            countsByDay={countsByDay}
          />
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
        </aside>
      ) : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{heading}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <CalendarBookingDrawer
              key={drawerStateKey}
              initialStartsAtLocal={`${fmtLocalDate(baseDate)}T09:00`}
              initialProviderId={providerFilter}
              initialCustomerId={rebookCustomer?.id ?? null}
              autoOpen={params.drawer === "new-booking"}
              providers={providerOptions}
              services={serviceOptions}
              locations={locationOptions}
              customers={customerOptions}
            />
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

        {(bookingsRes.error || providersRes.error || servicesRes.error || locationsRes.error || customersRes.error) && (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {bookingsRes.error?.message ?? providersRes.error?.message ?? servicesRes.error?.message ?? locationsRes.error?.message ?? customersRes.error?.message}
          </p>
        )}

        {!showMonthSidebar ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildHref({ provider: null })}
              className={
                "rounded-full border px-4 py-2 text-sm font-medium " +
                (!providerFilter
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                  : "border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900")
              }
            >
              All providers
            </Link>
            {providers.map((provider) => (
              <Link
                key={provider.id}
                href={buildHref({ provider: provider.id })}
                className={
                  "rounded-full border px-4 py-2 text-sm font-medium " +
                  (providerFilter === provider.id
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    : "border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900")
                }
              >
                {provider.name}
              </Link>
            ))}
          </div>
        ) : null}

        {view === "day" ? (
          <DayWeekSchedule
            key={`day:${fmtLocalDate(baseDate)}:${providerFilter ?? "all"}`}
            view="day"
            baseDateKey={fmtLocalDate(baseDate)}
            todayKey={todayStr}
            providerFilter={providerFilter}
            providers={providers}
            bookings={scheduleBookings.filter(
              (booking) => fmtLocalDate(new Date(booking.startsAt)) === fmtLocalDate(baseDate)
            )}
            canManageCheckout={canManageCheckout}
          />
        ) : view === "week" ? (
          <DayWeekSchedule
            key={`week:${fmtLocalDate(startOfWeek(baseDate))}:${providerFilter ?? "all"}`}
            view="week"
            baseDateKey={fmtLocalDate(baseDate)}
            todayKey={todayStr}
            providerFilter={providerFilter}
            providers={providers}
            bookings={scheduleBookings}
            canManageCheckout={canManageCheckout}
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
                        href={`/admin/bookings/${booking.id}?flow=checkout`}
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
