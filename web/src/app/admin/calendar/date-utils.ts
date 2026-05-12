/**
 * Calendar date helpers — local-time based to avoid TZ drift in URL params.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export function parseLocalDate(s: string | undefined): Date {
  if (!s) return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function fmtLocalDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(d: Date) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function startOfWeek(d: Date) {
  const out = startOfDay(d);
  const day = (out.getDay() + 6) % 7; // Monday-start
  out.setDate(out.getDate() - day);
  return out;
}

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

export function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function endOfMonthGrid(d: Date) {
  const monthEnd = endOfMonth(d);
  const last = new Date(monthEnd.getTime() - DAY_MS);
  const startOfLastWeek = startOfWeek(last);
  return new Date(startOfLastWeek.getTime() + 7 * DAY_MS);
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
