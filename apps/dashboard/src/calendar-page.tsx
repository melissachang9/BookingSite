import { startTransition, useEffect, useMemo, useState } from "react";
import type { AvailabilityRequest, AvailabilityResponse, ServiceListResponse, ServiceSummary, SlotAvailability } from "@booking/shared-types";

import { platformApi } from "./platform-api";

type CalendarDataState =
  | { kind: "loading" }
  | { kind: "ready"; service: ServiceSummary; days: CalendarDay[] }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string };

type CalendarDay = {
  date: string;
  label: string;
  slots: SlotAvailability[];
};

type SelectedCalendarSlot = SlotAvailability & {
  dayLabel: string;
};

export type CalendarPageDefinition = {
  eyebrow: string;
  description: string;
};

export type CalendarPageApi = {
  listServices: (tenantSlug: string) => Promise<ServiceListResponse>;
  getAvailability: (request: AvailabilityRequest) => Promise<AvailabilityResponse>;
};

type CalendarPageProps = {
  definition: CalendarPageDefinition;
  tenantSlug: string;
  api?: CalendarPageApi;
};

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  month: "short",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
});

function getUpcomingDate(offsetDays: number): string {
  return dateFormatter.format(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
}

function getDateLabel(date: string): string {
  return dayLabelFormatter.format(new Date(`${date}T12:00:00Z`));
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${dayLabelFormatter.format(date)} at ${timeFormatter.format(date)}`;
}

export function CalendarPage({ definition, tenantSlug, api = platformApi }: CalendarPageProps) {
  const [calendarState, setCalendarState] = useState<CalendarDataState>({ kind: "loading" });
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);

  const selectedSlot = useMemo<SelectedCalendarSlot | null>(() => {
    if (calendarState.kind !== "ready" || selectedSlotKey === null) {
      return null;
    }

    for (const day of calendarState.days) {
      const slot = day.slots.find((candidate) => `${candidate.providerId}-${candidate.startAt}` === selectedSlotKey);
      if (slot) {
        return {
          ...slot,
          dayLabel: day.label,
        };
      }
    }

    return null;
  }, [calendarState, selectedSlotKey]);

  useEffect(() => {
    let isCancelled = false;
    setSelectedSlotKey(null);

    const loadCalendar = async () => {
      try {
        const serviceResponse = await api.listServices(tenantSlug);
        const service = serviceResponse.services.find((candidate) => candidate.isActive);

        if (!service) {
          setCalendarState({ kind: "empty", message: "No active services are available for the demo tenant." });
          return;
        }

        const availabilityResponses = await Promise.all(
          Array.from({ length: 7 }, (_, index) => {
            const date = getUpcomingDate(index + 1);
            return api.getAvailability({
              tenantSlug,
              serviceId: service.id,
              date,
            });
          }),
        );

        if (isCancelled) {
          return;
        }

        const days = availabilityResponses.map((availability, index) => {
          const date = getUpcomingDate(index + 1);
          return {
            date,
            label: getDateLabel(date),
            slots: availability.slots.slice(0, 6),
          };
        });

        startTransition(() => {
          setCalendarState({ kind: "ready", service, days });
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setCalendarState({
            kind: "error",
            message: error instanceof Error ? error.message : "Unable to load calendar availability.",
          });
        });
      }
    };

    void loadCalendar();

    return () => {
      isCancelled = true;
    };
  }, [api, tenantSlug]);

  const selectedOpeningLabel = selectedSlot ? formatDateTime(selectedSlot.startAt) : "Choose a slot";
  const selectedProviderLabel = selectedSlot?.providerName ?? "Choose a slot";
  const customerLookupLabel = selectedSlot ? "Search existing customer" : "Choose a slot first";
  const serviceLabel = calendarState.kind === "ready" ? calendarState.service.name : "Load service";

  return (
    <main className="ops-page-stack">
      <section className="calendar-command-bar">
        <div>
          <p className="eyebrow">{definition.eyebrow}</p>
          <h3>Choose a real opening before creating a booking.</h3>
          <p>{definition.description}</p>
        </div>
        <div className="filter-row" aria-label="Calendar filters">
          <button type="button" className="filter-chip filter-chip--active">
            Week
          </button>
          <button type="button" className="filter-chip" disabled>
            Day
          </button>
          <button type="button" className="filter-chip" disabled>
            Location
          </button>
          <button type="button" className="filter-chip" disabled>
            Provider
          </button>
        </div>
      </section>

      <section className="calendar-workspace">
        <article className="ops-panel calendar-panel">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Live availability</p>
              <h4>Provider week</h4>
            </div>
            <span className="status-chip status-chip--ready">Backend-backed</span>
          </div>
          <CalendarBoard state={calendarState} selectedSlotKey={selectedSlotKey} onSelectSlot={setSelectedSlotKey} />
        </article>

        <aside className="ops-panel booking-rail">
          <p className="eyebrow">Manual booking</p>
          <h4>Selected-slot drawer</h4>
          <p>
            {selectedSlot
              ? `Start with ${formatDateTime(selectedSlot.startAt)} with ${selectedSlot.providerName}. Customer lookup, deposit mode, and hold creation stay anchored to this opening.`
              : "Staff booking stays anchored to calendar time. Choose an opening to load customer lookup, deposit mode, and hold creation context."}
          </p>
          <div className="drawer-form-preview" aria-label="Manual booking preview">
            <div className="drawer-selection-note" aria-live="polite">
              {selectedSlot
                ? `Selected ${selectedSlot.dayLabel} at ${timeFormatter.format(new Date(selectedSlot.startAt))} with ${selectedSlot.providerName}.`
                : "Select a slot from the calendar to begin the manual booking handoff."}
            </div>
            <label>
              Customer
              <input value={customerLookupLabel} readOnly />
            </label>
            <label>
              Service
              <input value={serviceLabel} readOnly />
            </label>
            <label>
              Selected opening
              <input value={selectedOpeningLabel} readOnly />
            </label>
            <label>
              Provider
              <input value={selectedProviderLabel} readOnly />
            </label>
            <label>
              Payment outcome
              <select value="deposit_link" disabled>
                <option value="deposit_link">Send deposit link</option>
              </select>
            </label>
            <button type="button" disabled>
              Create from selected slot
            </button>
          </div>
        </aside>
      </section>
    </main>
  );
}

function CalendarBoard({
  state,
  selectedSlotKey,
  onSelectSlot,
}: {
  state: CalendarDataState;
  selectedSlotKey: string | null;
  onSelectSlot: (slotKey: string) => void;
}) {
  if (state.kind === "loading") {
    return <div className="calendar-state">Loading calendar availability...</div>;
  }

  if (state.kind === "error" || state.kind === "empty") {
    return <div className="calendar-state calendar-state--muted">{state.message}</div>;
  }

  return (
    <div className="calendar-board" aria-label={`Upcoming openings for ${state.service.name}`}>
      {state.days.map((day) => (
        <section key={day.date} className="calendar-day-column">
          <header>
            <span>{day.label}</span>
            <strong>{day.slots.length > 0 ? `${day.slots.length} openings` : "No openings"}</strong>
          </header>

          <div className="calendar-slot-stack">
            {day.slots.length > 0 ? (
              day.slots.map((slot) => {
                const slotKey = `${slot.providerId}-${slot.startAt}`;
                const isSelected = slotKey === selectedSlotKey;

                return (
                  <button
                    key={slotKey}
                    type="button"
                    className={`calendar-slot-card${isSelected ? " calendar-slot-card--selected" : ""}`}
                    aria-label={`Select ${formatDateTime(slot.startAt)} with ${slot.providerName}`}
                    aria-pressed={isSelected}
                    onClick={() => onSelectSlot(slotKey)}
                  >
                    <strong>{timeFormatter.format(new Date(slot.startAt))}</strong>
                    <span>{slot.providerName}</span>
                    <small>{slot.locationId ? "Location selected" : state.service.name}</small>
                  </button>
                );
              })
            ) : (
              <div className="calendar-empty-cell">Protected time</div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}