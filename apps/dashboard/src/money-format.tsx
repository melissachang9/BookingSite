import { createContext, useContext, useMemo, type ReactNode } from "react";

/** How this business shows money and times: its own currency and timezone, not a fixed default. */
export type MoneyFormat = {
  currency: string;
  timeZone: string;
  money: (cents: number) => string;
  signed: (cents: number) => string;
  dateTime: (iso: string) => string;
  date: (iso: string) => string;
  /** The instant a yyyy-mm-dd day starts in the business's timezone; empty input gives undefined. */
  dayStart: (day: string) => string | undefined;
  /** The instant after that day ends (exclusive upper bound). */
  dayEnd: (day: string) => string | undefined;
};

/** Offset of `timeZone` from UTC at the given instant, in milliseconds. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - instantMs;
}

/** Midnight at the start of a yyyy-mm-dd day in `timeZone`, as an ISO instant. */
export function zonedDayStartIso(day: string, timeZone: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return undefined;
  const wallClockUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // The offset can differ at midnight vs. the guess when a daylight-saving change falls in between.
  const first = wallClockUtc - zoneOffsetMs(wallClockUtc, timeZone);
  return new Date(wallClockUtc - zoneOffsetMs(first, timeZone)).toISOString();
}

function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

export const DEFAULT_CURRENCY = "USD";
export const DEFAULT_TIME_ZONE = "America/Los_Angeles";

function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function buildMoneyFormat(currency: string = DEFAULT_CURRENCY, timeZone: string = DEFAULT_TIME_ZONE): MoneyFormat {
  const zone = safeTimeZone(timeZone);
  const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" });
  const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const money = (cents: number) => currencyFormatter.format(cents / 100);
  return {
    currency,
    timeZone: zone,
    money,
    signed: (cents) => (cents === 0 ? money(0) : `${cents > 0 ? "+" : "−"}${money(Math.abs(cents))}`),
    dateTime: (iso) => dateTimeFormatter.format(new Date(iso)),
    date: (iso) => dateFormatter.format(new Date(iso)),
    dayStart: (day) => zonedDayStartIso(day, zone),
    dayEnd: (day) => (/^\d{4}-\d{2}-\d{2}$/.test(day) ? zonedDayStartIso(nextDay(day), zone) : undefined),
  };
}

const MoneyFormatContext = createContext<MoneyFormat>(buildMoneyFormat());

export function MoneyFormatProvider({
  currency,
  timeZone,
  children,
}: {
  currency?: string | null;
  timeZone?: string | null;
  children: ReactNode;
}) {
  const value = useMemo(
    () => buildMoneyFormat(currency || DEFAULT_CURRENCY, timeZone || DEFAULT_TIME_ZONE),
    [currency, timeZone],
  );
  return <MoneyFormatContext.Provider value={value}>{children}</MoneyFormatContext.Provider>;
}

export function useMoneyFormat(): MoneyFormat {
  return useContext(MoneyFormatContext);
}
