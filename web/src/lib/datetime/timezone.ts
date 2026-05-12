const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

type DateOnlyParts = {
  year: number;
  month: number;
  day: number;
};

type ZonedParts = DateOnlyParts & {
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const zonedPartsFormatters = new Map<string, Intl.DateTimeFormat>();

function getZonedPartsFormatter(timeZone: string) {
  const cached = zonedPartsFormatters.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  zonedPartsFormatters.set(timeZone, formatter);
  return formatter;
}

function formatDateOnlyParts(parts: DateOnlyParts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function parseDateOnly(value: string): DateOnlyParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid date-only value: ${value}`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function addDaysToDateOnly(value: string, days: number) {
  const parsed = parseDateOnly(value);
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  next.setUTCDate(next.getUTCDate() + days);
  return formatDateOnlyParts({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  });
}

export function addMonthsToDateOnly(value: string, months: number) {
  const parsed = parseDateOnly(value);
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1 + months, 1));
  return formatDateOnlyParts({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  });
}

export function getLocalDateString(date: Date | string, timeZone: string) {
  const parts = getZonedParts(typeof date === "string" ? new Date(date) : date, timeZone);
  return formatDateOnlyParts(parts);
}

export function getWeekdayInTimeZone(date: Date | string, timeZone: string) {
  return getZonedParts(typeof date === "string" ? new Date(date) : date, timeZone).weekday;
}

export function zonedDateTimeToUtc(
  parts: DateOnlyParts & { hour?: number; minute?: number; second?: number },
  timeZone: string
) {
  const targetUtcTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0
  );

  let guess = targetUtcTime;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = targetUtcTime - getTimeZoneOffsetMs(new Date(guess), timeZone);
    if (next === guess) break;
    guess = next;
  }

  return new Date(guess);
}

export function getUtcRangeForLocalDate(dateOnly: string, timeZone: string) {
  const startParts = parseDateOnly(dateOnly);
  const endParts = parseDateOnly(addDaysToDateOnly(dateOnly, 1));
  return {
    start: zonedDateTimeToUtc(startParts, timeZone),
    end: zonedDateTimeToUtc(endParts, timeZone),
  };
}

export function getUtcRangeForLocalMonth(monthAnchor: string, timeZone: string) {
  const monthStart = formatDateOnlyParts({ ...parseDateOnly(monthAnchor), day: 1 });
  const nextMonthStart = addMonthsToDateOnly(monthStart, 1);
  return {
    start: zonedDateTimeToUtc(parseDateOnly(monthStart), timeZone),
    end: zonedDateTimeToUtc(parseDateOnly(nextMonthStart), timeZone),
  };
}

export function formatInTimeZone(
  value: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  locale?: string
) {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(
    typeof value === "string" ? new Date(value) : value
  );
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = getZonedPartsFormatter(timeZone).formatToParts(date);
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of parts) {
    if (part.type === "literal") continue;
    values[part.type] = part.value;
  }

  return {
    year: Number(values.year ?? 0),
    month: Number(values.month ?? 0),
    day: Number(values.day ?? 0),
    hour: Number(values.hour ?? 0),
    minute: Number(values.minute ?? 0),
    second: Number(values.second ?? 0),
    weekday: WEEKDAY_INDEX[values.weekday ?? "Sun"] ?? 0,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getZonedParts(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localAsUtc - date.getTime();
}