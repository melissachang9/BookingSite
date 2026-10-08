import { useId, useState, type ReactNode } from "react";

/**
 * Small hand-rolled SVG charts for the Reports section (no chart dependency).
 * Marks are thin and quiet; identity comes from titles/labels, never colour alone;
 * every chart is paired with a table by its caller.
 */

export type LinePoint = { label: string; value: number; previous?: number | null };

type LineChartProps = {
  title: string;
  points: LinePoint[];
  format: (value: number) => string;
  /** Legend text for the main series and the comparison series. */
  seriesLabel: string;
  previousLabel?: string;
};

const WIDTH = 720;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 52 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * power;
}

export function LineChart({ title, points, format, seriesLabel, previousLabel }: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const hasPrevious = points.some((p) => p.previous != null);
  const max = niceMax(Math.max(0, ...points.map((p) => Math.max(p.value, p.previous ?? 0))));
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (points.length <= 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const y = (value: number) => PAD.top + innerHeight - (value / max) * innerHeight;

  const path = (pick: (p: LinePoint) => number | null | undefined) => {
    let d = "";
    points.forEach((p, index) => {
      const value = pick(p);
      if (value == null) return;
      d += `${d ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)} `;
    });
    return d.trim();
  };

  const ticks = [0, 0.5, 1].map((fraction) => max * fraction);
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  const active = hover !== null ? points[hover] : null;

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const svgX = ratio * WIDTH;
    const raw = ((svgX - PAD.left) / innerWidth) * (points.length - 1);
    setHover(points.length === 0 ? null : Math.min(points.length - 1, Math.max(0, Math.round(raw))));
  };

  return (
    <figure className="rp-chart">
      <figcaption id={titleId} className="rp-chart__title">
        {title}
        <span className="rp-legend">
          <span className="rp-legend__item"><i className="rp-swatch rp-swatch--main" />{seriesLabel}</span>
          {hasPrevious && previousLabel ? (
            <span className="rp-legend__item"><i className="rp-swatch rp-swatch--previous" />{previousLabel}</span>
          ) : null}
        </span>
      </figcaption>
      <div className="rp-chart__plot">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby={titleId}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} className="rp-grid" />
              <text x={PAD.left - 8} y={y(tick) + 3} textAnchor="end" className="rp-axis">{format(tick)}</text>
            </g>
          ))}
          {points.map((p, index) =>
            index % labelEvery === 0 ? (
              <text key={p.label} x={x(index)} y={HEIGHT - 8} textAnchor="middle" className="rp-axis">{p.label}</text>
            ) : null,
          )}
          {hasPrevious ? <path d={path((p) => p.previous)} className="rp-line rp-line--previous" /> : null}
          <path d={path((p) => p.value)} className="rp-line rp-line--main" />
          {active && hover !== null ? (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerHeight} className="rp-crosshair" />
              <circle cx={x(hover)} cy={y(active.value)} r={4} className="rp-dot" />
            </g>
          ) : null}
        </svg>
        {active && hover !== null ? (
          <div
            className="rp-tooltip"
            style={{ left: `${(x(hover) / WIDTH) * 100}%` }}
            role="status"
          >
            <strong>{active.label}</strong>
            <span>{seriesLabel}: {format(active.value)}</span>
            {active.previous != null && previousLabel ? <span>{previousLabel}: {format(active.previous)}</span> : null}
          </div>
        ) : null}
      </div>
    </figure>
  );
}

export type BarRow = { key: string; label: string; value: number; detail?: string };

/** Ranked horizontal bars. One hue; the value is always printed next to the bar. */
export function BarList({
  title,
  rows,
  format,
  empty = "No data for this range.",
  limit = 8,
}: {
  title: string;
  rows: BarRow[];
  format: (value: number) => string;
  empty?: string;
  limit?: number;
}) {
  const shown = rows.slice(0, limit);
  const max = Math.max(1, ...shown.map((row) => row.value));
  return (
    <section className="rp-card" aria-label={title}>
      <h4 className="rp-card__title">{title}</h4>
      {shown.length === 0 ? (
        <p className="cs-empty">{empty}</p>
      ) : (
        <ul className="rp-bars">
          {shown.map((row) => (
            <li key={row.key} className="rp-bars__row" title={row.detail ? `${row.label} — ${row.detail}` : row.label}>
              <span className="rp-bars__label">{row.label}</span>
              <span className="rp-bars__track" aria-hidden="true">
                <span className="rp-bars__fill" style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} />
              </span>
              <span className="rp-bars__value">{format(row.value)}</span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > limit ? <p className="rp-note">+ {rows.length - limit} more in the table</p> : null}
    </section>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function hourLabel(hour: number): string {
  const suffix = hour >= 12 ? "p" : "a";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
}

/** Weekday × hour demand. Single-hue sequential; every cell has a text alternative. */
export function Heatmap({ cells }: { cells: Array<{ weekday: number; hour: number; count: number }> }) {
  const [hover, setHover] = useState<{ weekday: number; hour: number; count: number } | null>(null);
  if (cells.length === 0) return <p className="cs-empty">No appointments in this range.</p>;
  const hours = cells.map((c) => c.hour);
  const first = Math.min(...hours);
  const last = Math.max(...hours);
  const range = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const lookup = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c.count]));
  const max = Math.max(...cells.map((c) => c.count));

  return (
    <div className="rp-heat">
      <div className="rp-heat__grid" style={{ gridTemplateColumns: `36px repeat(${range.length}, minmax(0, 1fr))` }} role="table" aria-label="Appointments by weekday and hour">
        <span />
        {range.map((hour) => (
          <span key={hour} className="rp-heat__hour" role="columnheader">{hourLabel(hour)}</span>
        ))}
        {WEEKDAYS.map((day, weekday) => (
          <HeatRow key={day} day={day} weekday={weekday} range={range} lookup={lookup} max={max} onHover={setHover} />
        ))}
      </div>
      <p className="rp-note" role="status">
        {hover ? `${WEEKDAYS[hover.weekday]} ${hourLabel(hover.hour)}: ${hover.count} appointment${hover.count === 1 ? "" : "s"}` : "Hover a cell for the count."}
      </p>
    </div>
  );
}

function HeatRow({
  day,
  weekday,
  range,
  lookup,
  max,
  onHover,
}: {
  day: string;
  weekday: number;
  range: number[];
  lookup: Map<string, number>;
  max: number;
  onHover: (cell: { weekday: number; hour: number; count: number } | null) => void;
}) {
  return (
    <>
      <span className="rp-heat__day" role="rowheader">{day}</span>
      {range.map((hour) => {
        const count = lookup.get(`${weekday}-${hour}`) ?? 0;
        return (
          <span
            key={hour}
            role="cell"
            aria-label={`${day} ${hourLabel(hour)}: ${count}`}
            className="rp-heat__cell"
            style={{ ["--heat" as string]: count === 0 ? 0 : 0.14 + 0.86 * (count / max) }}
            onMouseEnter={() => onHover({ weekday, hour, count })}
            onMouseLeave={() => onHover(null)}
          />
        );
      })}
    </>
  );
}

export function ReportTable({
  caption,
  head,
  children,
}: {
  caption: string;
  head: ReactNode[];
  children: ReactNode;
}) {
  return (
    <div className="rp-tablewrap">
      <table className="rp-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index} scope="col" className={index === 0 ? undefined : "is-num"}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
