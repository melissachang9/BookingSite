import Link from "next/link";
import {
  DAY_MS,
  addMonths,
  endOfMonthGrid,
  fmtLocalDate,
  startOfMonth,
  startOfWeek,
} from "./date-utils";

/**
 * Mini month picker for the sidebar. Each day links to /admin/calendar with
 * the day's date as `date=YYYY-MM-DD`.
 */
export function MiniMonth({
  monthDate,
  selectedDate,
  hrefFor,
  countsByDay,
}: {
  monthDate: Date;
  selectedDate: Date;
  hrefFor: (overrides: { date?: string; month?: string }) => string;
  countsByDay: Map<string, number>;
}) {
  const gridStart = startOfWeek(startOfMonth(monthDate));
  const gridEnd = endOfMonthGrid(monthDate);
  const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / DAY_MS);
  const days: Date[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  const month = monthDate.getMonth();
  const todayStr = fmtLocalDate(new Date());
  const selectedStr = fmtLocalDate(selectedDate);
  const weekdayLabels = ["M", "T", "W", "T", "F", "S", "S"];

  const prevMonthStr = fmtLocalDate(addMonths(monthDate, -1));
  const nextMonthStr = fmtLocalDate(addMonths(monthDate, 1));

  return (
    <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 flex items-center justify-between">
        <Link
          href={hrefFor({ month: prevMonthStr })}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          ←
        </Link>
        <div className="text-sm font-semibold">
          {monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </div>
        <Link
          href={hrefFor({ month: nextMonthStr })}
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          →
        </Link>
      </div>
      <div className="grid grid-cols-7 gap-px text-center text-[10px] uppercase text-neutral-500">
        {weekdayLabels.map((w, i) => (
          <div key={i} className="py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {days.map((day) => {
          const key = fmtLocalDate(day);
          const inMonth = day.getMonth() === month;
          const isToday = key === todayStr;
          const isSelected = key === selectedStr;
          const count = countsByDay.get(key) ?? 0;
          return (
            <Link
              key={key}
              href={hrefFor({ date: key })}
              className={
                "relative flex aspect-square items-center justify-center rounded text-xs " +
                (isSelected
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : isToday
                    ? "ring-1 ring-neutral-900 dark:ring-neutral-100"
                    : "") +
                " " +
                (inMonth
                  ? "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  : "text-neutral-400 hover:bg-neutral-50 dark:text-neutral-600 dark:hover:bg-neutral-900")
              }
            >
              <span>{day.getDate()}</span>
              {count > 0 && (
                <span
                  className={
                    "absolute bottom-1 h-1 w-1 rounded-full " +
                    (isSelected
                      ? "bg-white dark:bg-neutral-900"
                      : "bg-neutral-500")
                  }
                />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
