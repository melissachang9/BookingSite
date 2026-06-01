import { startTransition, useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type {
  AvailabilityRequest,
  AvailabilityResponse,
  BookingDraftSummary,
  BookingFormResponseEntry,
  BookingFormResponseList,
  BookingListQuery,
  BookingListResponse,
  BookingSummary,
  CreateBookingDraftRequest,
  ServiceListResponse,
  ServiceSummary,
  SlotAvailability,
} from "@booking/shared-types";

import { platformApi } from "./platform-api";

type CalendarDataState =
  | { kind: "loading" }
  | { kind: "ready"; days: CalendarDay[]; services: ServiceSummary[] }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string };

type CalendarViewMode = "day" | "week";

type CalendarDay = {
  date: string;
  label: string;
  appointments: CalendarAppointment[];
  openings: CalendarOpening[];
};

type CalendarOpening = {
  key: string;
  startAt: string;
  endAt: string;
  providerId: string;
  providerName: string;
  locationId?: string;
  serviceId: string;
  serviceName: string;
};

type CalendarAppointment = {
  id: string;
  startAt: string;
  endAt: string;
  providerId: string;
  providerName: string;
  customerName: string;
  serviceName: string;
  status: BookingSummary["status"];
  paymentResolution: BookingSummary["paymentResolution"];
};

type ScheduleColumn = {
  key: string;
  date: string;
  heading: string;
  subheading?: string;
  appointments: CalendarAppointment[];
  openings: CalendarOpening[];
  availableSegments: { startMinute: number; endMinute: number }[];
  emptyLabel: string;
  providerId?: string;
  providerName?: string;
};

type SelectedCalendarAppointment = CalendarAppointment & {
  dayLabel: string;
};

type CalendarTimeBlock = {
  id: string;
  date: string;
  providerId: string;
  providerName: string;
  locationId?: string;
  startAt: string;
  endAt: string;
};

type PendingTimeBlock = Omit<CalendarTimeBlock, "id">;

type DraftCreationState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; draftId: string }
  | { kind: "error"; message: string };

type FormResponsesState =
  | { kind: "idle" }
  | { kind: "loading"; bookingId: string }
  | { kind: "ready"; bookingId: string; items: BookingFormResponseEntry[] }
  | { kind: "error"; bookingId: string; message: string };

type IntakeStatus = "unknown" | "loading" | "submitted" | "missing" | "error";

export type CalendarPageDefinition = {
  eyebrow: string;
  description: string;
};

export type CalendarPageApi = {
  listBookings: (tenantSlug: string, query?: BookingListQuery) => Promise<BookingListResponse>;
  listServices: (tenantSlug: string) => Promise<ServiceListResponse>;
  getAvailability: (request: AvailabilityRequest) => Promise<AvailabilityResponse>;
  createBookingDraft: (body: CreateBookingDraftRequest) => Promise<BookingDraftSummary>;
  listBookingFormResponses: (tenantSlug: string, bookingId: string) => Promise<BookingFormResponseList>;
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

const dayHeadingFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
});

const tenantTimePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const SCHEDULE_MIN_HOUR = 7;
const SCHEDULE_MAX_HOUR = 22;
const SCHEDULE_MIN_VISIBLE_HOURS = 8;
const SCHEDULE_HOUR_HEIGHT_PX = 66;
const SCHEDULE_QUARTER_HEIGHT_PX = SCHEDULE_HOUR_HEIGHT_PX / 4;
const SCHEDULE_MIN_EVENT_HEIGHT_PX = 26;

const monthLabelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "long",
  year: "numeric",
});

const monthWeekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
});

const monthDayLabel = Array.from({ length: 7 }, (_, index) => {
  const reference = new Date(Date.UTC(2026, 4, 3 + index));
  return monthWeekdayFormatter.format(reference).slice(0, 2).toUpperCase();
});

const CALENDAR_SIDEBAR_RAIL_ID = "dashboard-calendar-sidebar-rail";
const storefrontBaseUrl = import.meta.env.VITE_PUBLIC_STOREFRONT_BASE_URL ?? "http://127.0.0.1:3001";

function getUpcomingDate(offsetDays: number): string {
  return dateFormatter.format(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
}

function getDateLabel(date: string): string {
  return dayLabelFormatter.format(new Date(`${date}T12:00:00Z`));
}

function getTenantDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function getWeekHeading(date: string): string {
  return dayHeadingFormatter.format(parseIsoDate(date));
}

function getDayNumberLabel(date: string): string {
  return String(parseIsoDate(date).getUTCDate());
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${dayLabelFormatter.format(date)} at ${timeFormatter.format(date)}`;
}

function formatTimeRange(startAt: string, endAt: string): string {
  return `${timeFormatter.format(new Date(startAt))} - ${timeFormatter.format(new Date(endAt))}`;
}

function toTenantDateTimeIso(date: string, minuteOfDay: number): string {
  const safeMinute = Math.max(0, Math.min(23 * 60 + 59, minuteOfDay));
  const hour = Math.floor(safeMinute / 60);
  const minute = safeMinute % 60;
  const hourText = String(hour).padStart(2, "0");
  const minuteText = String(minute).padStart(2, "0");
  return new Date(`${date}T${hourText}:${minuteText}:00-07:00`).toISOString();
}

function roundToQuarterHour(minuteOfDay: number): number {
  return Math.round(minuteOfDay / 15) * 15;
}

function getBookingStatusLabel(status: BookingSummary["status"]): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "completed":
      return "Completed";
    case "canceled":
      return "Canceled";
    case "no_show":
      return "No-show";
    default:
      return status;
  }
}

function getPaymentResolutionLabel(resolution: BookingSummary["paymentResolution"]): string {
  switch (resolution) {
    case "pending":
      return "Pending";
    case "collected":
      return "Collected";
    case "follow_up":
      return "Follow-up";
    case "waived":
      return "Waived";
    default:
      return resolution;
  }
}

function getIntakeStatusLabel(status: IntakeStatus): string {
  switch (status) {
    case "loading":
      return "Checking intake";
    case "submitted":
      return "Intake submitted";
    case "missing":
      return "Intake missing";
    case "error":
      return "Intake check failed";
    case "unknown":
    default:
      return "Intake not checked";
  }
}

function createCalendarAppointment(booking: BookingSummary): CalendarAppointment {
  return {
    id: booking.id,
    startAt: booking.startsAt,
    endAt: booking.endsAt,
    providerId: booking.providerId,
    providerName: booking.provider.name,
    customerName: booking.customer.name,
    serviceName: booking.service.name,
    status: booking.status,
    paymentResolution: booking.paymentResolution,
  };
}

function createCalendarOpening(slot: SlotAvailability, service: ServiceSummary): CalendarOpening {
  return {
    key: `${service.id}-${slot.providerId}-${slot.startAt}`,
    startAt: slot.startAt,
    endAt: slot.endAt,
    providerId: slot.providerId,
    providerName: slot.providerName,
    locationId: slot.locationId,
    serviceId: service.id,
    serviceName: service.name,
  };
}

function formatHourLabel(hour24: number): string {
  const hour = hour24 % 12 || 12;
  const period = hour24 >= 12 ? "PM" : "AM";
  return `${hour} ${period}`;
}

function minutesInTenantDay(value: string): number {
  const parts = tenantTimePartsFormatter.formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function addMonths(value: string, months: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  return toIsoDate(date);
}

function monthAnchor(value: string): string {
  const date = parseIsoDate(value);
  date.setUTCDate(1);
  return toIsoDate(date);
}

function buildMonthGrid(value: string): string[] {
  const anchor = parseIsoDate(monthAnchor(value));
  const start = new Date(anchor);
  start.setUTCDate(1 - start.getUTCDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    return toIsoDate(day);
  });
}

export function CalendarPage({ definition, tenantSlug, api = platformApi }: CalendarPageProps) {
  const [calendarState, setCalendarState] = useState<CalendarDataState>({ kind: "loading" });
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [focusedDate, setFocusedDate] = useState<string>(getUpcomingDate(1));
  const [monthCursorDate, setMonthCursorDate] = useState<string>(monthAnchor(getUpcomingDate(1)));
  const [sidebarRailHost, setSidebarRailHost] = useState<HTMLElement | null>(null);
  const [timeBlocks, setTimeBlocks] = useState<CalendarTimeBlock[]>([]);
  const [selectedTimeBlockId, setSelectedTimeBlockId] = useState<string | null>(null);
  const [draftCreationState, setDraftCreationState] = useState<DraftCreationState>({ kind: "idle" });
  const [formResponsesState, setFormResponsesState] = useState<FormResponsesState>({ kind: "idle" });
  const [intakeStatusByBookingId, setIntakeStatusByBookingId] = useState<Record<string, IntakeStatus>>({});

  const selectedAppointment = useMemo<SelectedCalendarAppointment | null>(() => {
    if (calendarState.kind !== "ready" || selectedAppointmentId === null) {
      return null;
    }

    for (const day of calendarState.days) {
      const appointment = day.appointments.find((candidate) => candidate.id === selectedAppointmentId);
      if (appointment) {
        return {
          ...appointment,
          dayLabel: day.label,
        };
      }
    }

    return null;
  }, [calendarState, selectedAppointmentId]);

  useEffect(() => {
    if (!selectedAppointment) {
      setFormResponsesState({ kind: "idle" });
      return;
    }

    const bookingId = selectedAppointment.id;
    let isCancelled = false;
    setFormResponsesState({ kind: "loading", bookingId });
    setIntakeStatusByBookingId((current) => ({ ...current, [bookingId]: "loading" }));

    api
      .listBookingFormResponses(tenantSlug, bookingId)
      .then((response) => {
        if (isCancelled) {
          return;
        }
        setFormResponsesState({ kind: "ready", bookingId, items: response.items });
        setIntakeStatusByBookingId((current) => ({
          ...current,
          [bookingId]: response.items.length > 0 ? "submitted" : "missing",
        }));
      })
      .catch((error: unknown) => {
        if (isCancelled) {
          return;
        }
        setIntakeStatusByBookingId((current) => ({ ...current, [bookingId]: "error" }));
        setFormResponsesState({
          kind: "error",
          bookingId,
          message: error instanceof Error ? error.message : "Unable to load submitted forms for this booking.",
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [api, tenantSlug, selectedAppointment]);

  useEffect(() => {
    let isCancelled = false;
    setSelectedAppointmentId(null);
    setTimeBlocks([]);
    setSelectedTimeBlockId(null);
    setDraftCreationState({ kind: "idle" });
    setIntakeStatusByBookingId({});

    const loadCalendar = async () => {
      try {
        const requestedDates = Array.from({ length: 28 }, (_, index) => getUpcomingDate(index + 1));
        const [bookingsResult, servicesResult] = await Promise.allSettled([
          api.listBookings(tenantSlug, {
            status: ["confirmed"],
            startsAtGte: `${addDays(requestedDates[0], -1)}T00:00:00.000Z`,
            startsAtLte: `${addDays(requestedDates[requestedDates.length - 1], 1)}T23:59:59.999Z`,
            limit: 100,
          }),
          api.listServices(tenantSlug),
        ]);

        if (bookingsResult.status === "rejected") {
          throw bookingsResult.reason;
        }

        if (isCancelled) {
          return;
        }

        const services =
          servicesResult.status === "fulfilled"
            ? servicesResult.value.services.filter((candidate) => candidate.isActive)
            : [];
        const requestedDateSet = new Set(requestedDates);
        const appointmentsByDate = new Map(requestedDates.map((date) => [date, [] as CalendarAppointment[]]));

        for (const booking of bookingsResult.value.items) {
          const date = getTenantDate(booking.startsAt);
          if (!requestedDateSet.has(date)) {
            continue;
          }

          appointmentsByDate.get(date)?.push(createCalendarAppointment(booking));
        }

        const days = requestedDates.map((date) => ({
          date,
          label: getDateLabel(date),
          appointments: (appointmentsByDate.get(date) ?? []).sort(
            (left, right) =>
              left.startAt.localeCompare(right.startAt) ||
              left.providerName.localeCompare(right.providerName) ||
              left.customerName.localeCompare(right.customerName),
          ),
          openings: [],
        }));

        startTransition(() => {
          setCalendarState({ kind: "ready", days, services });
          if (days.length > 0) {
            setFocusedDate(days[0].date);
            setMonthCursorDate(monthAnchor(days[0].date));
          }
          setSelectedServiceId((current) =>
            current !== null && services.some((service) => service.id === current) ? current : (services[0]?.id ?? null),
          );
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setCalendarState({
            kind: "error",
            message: error instanceof Error ? error.message : "Unable to load booked appointments.",
          });
        });
      }
    };

    void loadCalendar();

    return () => {
      isCancelled = true;
    };
  }, [api, tenantSlug]);

  const selectedService = useMemo(() => {
    if (calendarState.kind !== "ready" || selectedServiceId === null) {
      return null;
    }

    return calendarState.services.find((service) => service.id === selectedServiceId) ?? null;
  }, [calendarState, selectedServiceId]);

  const calendarDateKey = calendarState.kind === "ready" ? calendarState.days.map((day) => day.date).join("|") : "";

  useEffect(() => {
    if (calendarState.kind !== "ready") {
      return;
    }

    if (selectedServiceId === null) {
      setCalendarState((current) => {
        if (current.kind !== "ready") {
          return current;
        }

        return {
          kind: "ready",
          services: current.services,
          days: current.days.map((day) => ({
            ...day,
            openings: [],
          })),
        };
      });
      return;
    }

    let isCancelled = false;
    const requestedDates = calendarState.days.map((day) => day.date);

    const loadOpenings = async () => {
      try {
        const service = calendarState.services.find((candidate) => candidate.id === selectedServiceId);
        if (service === undefined) {
          return;
        }

        const availabilityResponses = await Promise.all(
          requestedDates.map((date) =>
            api.getAvailability({
              tenantSlug,
              serviceId: service.id,
              date,
              windowDays: 1,
            }),
          ),
        );

        if (isCancelled) {
          return;
        }

        const openingsByDate = new Map(requestedDates.map((date) => [date, [] as CalendarOpening[]]));

        for (const [index, availability] of availabilityResponses.entries()) {
          const requestedDate = requestedDates[index];
          const resolvedDate = openingsByDate.has(availability.days[0]?.date ?? "") ? (availability.days[0]?.date ?? requestedDate) : requestedDate;
          openingsByDate.set(
            resolvedDate,
            availability.slots
              .filter((slot) => getTenantDate(slot.startAt) === resolvedDate)
              .map((slot) => createCalendarOpening(slot, service)),
          );
        }

        startTransition(() => {
          setCalendarState((current) => {
            if (current.kind !== "ready") {
              return current;
            }

            return {
              kind: "ready",
              services: current.services,
              days: current.days.map((day) => ({
                ...day,
                openings: openingsByDate.get(day.date) ?? [],
              })),
            };
          });
        });
      } catch {
        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setCalendarState((current) => {
            if (current.kind !== "ready") {
              return current;
            }

            return {
              kind: "ready",
              services: current.services,
              days: current.days.map((day) => ({
                ...day,
                openings: [],
              })),
            };
          });
        });
      }
    };

    void loadOpenings();

    return () => {
      isCancelled = true;
    };
  }, [api, calendarDateKey, calendarState.kind, selectedServiceId, tenantSlug]);

  useEffect(() => {
    if (calendarState.kind !== "ready") {
      return;
    }

    const hasFocusedDate = calendarState.days.some((day) => day.date === focusedDate);
    if (!hasFocusedDate) {
      setFocusedDate(calendarState.days[0]?.date ?? getUpcomingDate(1));
    }
  }, [calendarState, focusedDate]);

  useEffect(() => {
    setMonthCursorDate(monthAnchor(focusedDate));
  }, [focusedDate]);

  useEffect(() => {
    setSidebarRailHost(document.getElementById(CALENDAR_SIDEBAR_RAIL_ID));

    return () => {
      setSidebarRailHost(null);
    };
  }, []);

  const viewDays = useMemo(() => {
    if (calendarState.kind !== "ready") {
      return [];
    }

    const focusIndex = calendarState.days.findIndex((day) => day.date === focusedDate);
    const safeFocusIndex = focusIndex >= 0 ? focusIndex : 0;

    if (viewMode === "day") {
      return calendarState.days.slice(safeFocusIndex, safeFocusIndex + 1);
    }

    const weekStartIndex = Math.floor(safeFocusIndex / 7) * 7;
    return calendarState.days.slice(weekStartIndex, weekStartIndex + 7);
  }, [calendarState, focusedDate, viewMode]);

  const visibleDateRangeLabel = useMemo(() => {
    if (viewDays.length === 0) {
      return "";
    }

    if (viewDays.length === 1) {
      return getDateLabel(viewDays[0].date);
    }

    return `${getDateLabel(viewDays[0].date)} - ${getDateLabel(viewDays[viewDays.length - 1].date)}`;
  }, [viewDays]);

  const monthGrid = useMemo(() => buildMonthGrid(monthCursorDate), [monthCursorDate]);
  const monthDatesByDay = useMemo(() => {
    if (calendarState.kind !== "ready") {
      return new Map<string, CalendarDay>();
    }

    return new Map(calendarState.days.map((day) => [day.date, day]));
  }, [calendarState]);

  const moveFocus = (step: number) => {
    if (calendarState.kind !== "ready") {
      return;
    }

    const currentIndex = calendarState.days.findIndex((day) => day.date === focusedDate);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.max(0, Math.min(calendarState.days.length - 1, safeIndex + step));
    setFocusedDate(calendarState.days[nextIndex].date);
  };

  const handleSelectAppointment = (appointmentId: string) => {
    setSelectedAppointmentId(appointmentId);
    setSelectedTimeBlockId(null);
  };

  const handleCloseAppointmentDrawer = () => {
    setSelectedAppointmentId(null);
  };

  const selectedTimeBlock = useMemo<CalendarTimeBlock | null>(() => {
    if (selectedTimeBlockId === null) {
      return null;
    }
    return timeBlocks.find((block) => block.id === selectedTimeBlockId) ?? null;
  }, [selectedTimeBlockId, timeBlocks]);

  const handleAddTimeBlock = (providerId: string, providerName: string, pending?: PendingTimeBlock) => {
    if (calendarState.kind !== "ready") {
      return;
    }
    const focusedDay = calendarState.days.find((day) => day.date === focusedDate);
    if (!focusedDay) {
      return;
    }

    const providerOpening = focusedDay.openings.find((opening) => opening.providerId === providerId);
    const defaultDurationMinutes = selectedService?.durationMinutes ?? 60;

    let startAt: string;
    let endAt: string;
    let locationId: string | undefined;

    if (pending) {
      startAt = pending.startAt;
      endAt = pending.endAt;
      locationId = pending.locationId;
    } else if (providerOpening) {
      startAt = providerOpening.startAt;
      const openingStartMs = new Date(providerOpening.startAt).getTime();
      endAt = new Date(openingStartMs + defaultDurationMinutes * 60_000).toISOString();
      locationId = providerOpening.locationId;
    } else {
      const fallback = new Date(`${focusedDay.date}T10:00:00-07:00`);
      startAt = fallback.toISOString();
      endAt = new Date(fallback.getTime() + defaultDurationMinutes * 60_000).toISOString();
    }

    const id = `time-block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const block: CalendarTimeBlock = {
      id,
      date: focusedDay.date,
      providerId,
      providerName,
      locationId,
      startAt,
      endAt,
    };

    setTimeBlocks((current) => [...current, block]);
    setSelectedTimeBlockId(id);
    setSelectedAppointmentId(null);
    setDraftCreationState({ kind: "idle" });
  };

  const handleSelectTimeBlock = (blockId: string) => {
    setSelectedTimeBlockId(blockId);
    setSelectedAppointmentId(null);
    setDraftCreationState({ kind: "idle" });
  };

  const handleDiscardTimeBlock = (blockId: string) => {
    setTimeBlocks((current) => current.filter((block) => block.id !== blockId));
    setSelectedTimeBlockId((current) => (current === blockId ? null : current));
    setDraftCreationState({ kind: "idle" });
  };

  const handleCreateDraftFromTimeBlock = async () => {
    if (selectedTimeBlock === null || selectedService === null) {
      return;
    }

    setDraftCreationState({ kind: "submitting" });

    try {
      const draft = await api.createBookingDraft({
        tenantSlug,
        serviceId: selectedService.id,
        providerId: selectedTimeBlock.providerId,
        locationId: selectedTimeBlock.locationId,
        startsAt: selectedTimeBlock.startAt,
        bookingMethod: "staff_entered",
      });

      setDraftCreationState({ kind: "success", draftId: draft.id });
      setTimeBlocks((current) => current.filter((block) => block.id !== selectedTimeBlock.id));
      setSelectedTimeBlockId(null);
    } catch (error) {
      setDraftCreationState({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Unable to create a booking draft from this time block.",
      });
    }
  };

  const selectedAppointmentTimeLabel = selectedAppointment ? formatDateTime(selectedAppointment.startAt) : "Select an appointment";
  const selectedProviderLabel = selectedAppointment?.providerName ?? "Select an appointment";
  const selectedCustomerLabel = selectedAppointment?.customerName ?? "Select an appointment";
  const selectedServiceLabel = selectedAppointment?.serviceName ?? "Select an appointment";
  const selectedStatusLabel = selectedAppointment ? getBookingStatusLabel(selectedAppointment.status) : "Select an appointment";
  const selectedPaymentLabel = selectedAppointment
    ? getPaymentResolutionLabel(selectedAppointment.paymentResolution)
    : "Select an appointment";
  const draftHref =
    draftCreationState.kind === "success"
      ? `${storefrontBaseUrl}/${tenantSlug}/book/${draftCreationState.draftId}`
      : null;
  const monthRail = (
    <MonthRail
      monthCursorDate={monthCursorDate}
      monthGrid={monthGrid}
      monthDatesByDay={monthDatesByDay}
      focusedDate={focusedDate}
      onSelectDate={setFocusedDate}
      onPreviousMonth={() => setMonthCursorDate(addMonths(monthCursorDate, -1))}
      onNextMonth={() => setMonthCursorDate(addMonths(monthCursorDate, 1))}
    />
  );

  return (
    <main className="ops-page-stack">
      {sidebarRailHost ? createPortal(monthRail, sidebarRailHost) : null}

      <section className="calendar-workspace">
        <article className="ops-panel calendar-panel">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Booked appointments</p>
              <h4>{visibleDateRangeLabel || "Weekly calendar"}</h4>
            </div>
            <div className="calendar-header-actions">
              {calendarState.kind === "ready" && calendarState.services.length > 0 ? (
                <label className="calendar-service-filter">
                  <span>Availability for</span>
                  <select value={selectedServiceId ?? ""} onChange={(event) => setSelectedServiceId(event.target.value || null)}>
                    {calendarState.services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="view-mode-toggle" role="group" aria-label="Calendar view mode">
                <button
                  type="button"
                  className={`view-mode-toggle__button${viewMode === "day" ? " view-mode-toggle__button--active" : ""}`}
                  onClick={() => setViewMode("day")}
                  aria-pressed={viewMode === "day"}
                >
                  Day
                </button>
                <button
                  type="button"
                  className={`view-mode-toggle__button${viewMode === "week" ? " view-mode-toggle__button--active" : ""}`}
                  onClick={() => setViewMode("week")}
                  aria-pressed={viewMode === "week"}
                >
                  Week
                </button>
              </div>
              <button
                type="button"
                className="filter-chip"
                onClick={() => moveFocus(viewMode === "day" ? -1 : -7)}
                disabled={calendarState.kind !== "ready"}
              >
                Previous
              </button>
              <button
                type="button"
                className="filter-chip"
                onClick={() => moveFocus(viewMode === "day" ? 1 : 7)}
                disabled={calendarState.kind !== "ready"}
              >
                Next
              </button>
            </div>
          </div>
          <CalendarBoard
            state={calendarState}
            days={viewDays}
            viewMode={viewMode}
            selectedAppointmentId={selectedAppointmentId}
            intakeStatusByBookingId={intakeStatusByBookingId}
            timeBlockDurationMinutes={selectedService?.durationMinutes ?? 60}
            onSelectAppointment={handleSelectAppointment}
            timeBlocks={timeBlocks}
            selectedTimeBlockId={selectedTimeBlockId}
            onSelectTimeBlock={handleSelectTimeBlock}
            onRequestTimeBlock={handleAddTimeBlock}
          />
          <TimeBlockPrompt
            selectedTimeBlock={selectedTimeBlock}
            selectedService={selectedService}
            draftCreationState={draftCreationState}
            draftHref={draftHref}
            onCreateDraft={() => void handleCreateDraftFromTimeBlock()}
            onDiscard={() => {
              if (selectedTimeBlock) {
                handleDiscardTimeBlock(selectedTimeBlock.id);
              }
            }}
          />
        </article>
      </section>
      {sidebarRailHost ? null : <div className="calendar-fallback-month-rail">{monthRail}</div>}
      <AppointmentDetailsDrawer
        selectedAppointment={selectedAppointment}
        formResponsesState={formResponsesState}
        intakeStatus={selectedAppointment ? (intakeStatusByBookingId[selectedAppointment.id] ?? "unknown") : "unknown"}
        selectedCustomerLabel={selectedCustomerLabel}
        selectedServiceLabel={selectedServiceLabel}
        selectedAppointmentTimeLabel={selectedAppointmentTimeLabel}
        selectedProviderLabel={selectedProviderLabel}
        selectedStatusLabel={selectedStatusLabel}
        selectedPaymentLabel={selectedPaymentLabel}
        onClose={handleCloseAppointmentDrawer}
      />
    </main>
  );
}

function MonthRail({
  monthCursorDate,
  monthGrid,
  monthDatesByDay,
  focusedDate,
  onSelectDate,
  onPreviousMonth,
  onNextMonth,
}: {
  monthCursorDate: string;
  monthGrid: string[];
  monthDatesByDay: Map<string, CalendarDay>;
  focusedDate: string;
  onSelectDate: (date: string) => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}) {
  return (
    <section className="month-rail" aria-label="Month calendar">
      <div className="month-rail__header">
        <h5>{monthLabelFormatter.format(parseIsoDate(monthCursorDate))}</h5>
        <div className="month-rail__controls">
          <button type="button" className="filter-chip" onClick={onPreviousMonth}>
            Prev
          </button>
          <button type="button" className="filter-chip" onClick={onNextMonth}>
            Next
          </button>
        </div>
      </div>
      <div className="month-grid-labels" role="presentation">
        {monthDayLabel.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="month-grid" role="grid">
        {monthGrid.map((date) => {
          const dayData = monthDatesByDay.get(date);
          const isInCurrentMonth = date.slice(0, 7) === monthCursorDate.slice(0, 7);
          const isFocused = date === focusedDate;

          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              disabled={!dayData}
              aria-pressed={isFocused}
              aria-label={getDateLabel(date)}
              className={[
                "month-day",
                !isInCurrentMonth ? "month-day--outside" : "",
                isFocused ? "month-day--focused" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onSelectDate(date)}
            >
              <span>{parseIsoDate(date).getUTCDate()}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function mergeMinuteSegments(
  openings: { startAt: string; endAt: string }[],
): { startMinute: number; endMinute: number }[] {
  if (openings.length === 0) {
    return [];
  }

  const sorted = openings
    .map((opening) => {
      const startMinute = minutesInTenantDay(opening.startAt);
      const rawEndMinute = minutesInTenantDay(opening.endAt);
      const endMinute = rawEndMinute > startMinute ? rawEndMinute : startMinute + 15;
      return { startMinute, endMinute };
    })
    .sort((left, right) => left.startMinute - right.startMinute);

  const merged: { startMinute: number; endMinute: number }[] = [];
  for (const segment of sorted) {
    const last = merged[merged.length - 1];
    if (last && segment.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, segment.endMinute);
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

function CalendarBoard({
  state,
  days,
  viewMode,
  selectedAppointmentId,
  intakeStatusByBookingId,
  timeBlockDurationMinutes,
  onSelectAppointment,
  timeBlocks,
  selectedTimeBlockId,
  onSelectTimeBlock,
  onRequestTimeBlock,
}: {
  state: CalendarDataState;
  days: CalendarDay[];
  viewMode: CalendarViewMode;
  selectedAppointmentId: string | null;
  intakeStatusByBookingId: Record<string, IntakeStatus>;
  timeBlockDurationMinutes: number;
  onSelectAppointment: (appointmentId: string) => void;
  timeBlocks: CalendarTimeBlock[];
  selectedTimeBlockId: string | null;
  onSelectTimeBlock: (blockId: string) => void;
  onRequestTimeBlock: (providerId: string, providerName: string, pending?: PendingTimeBlock) => void;
}) {
  if (state.kind === "loading") {
    return <div className="calendar-state">Loading booked appointments...</div>;
  }

  if (state.kind === "error" || state.kind === "empty") {
    return <div className="calendar-state calendar-state--muted">{state.message}</div>;
  }

  const appointments = days.flatMap((day) => day.appointments);
  const openings = days.flatMap((day) => day.openings);
  const relevantTimeBlocks = timeBlocks.filter((block) => days.some((day) => day.date === block.date));
  let startHour = 9;
  let endHour = startHour + SCHEDULE_MIN_VISIBLE_HOURS;

  if (appointments.length > 0 || openings.length > 0 || relevantTimeBlocks.length > 0) {
    const minMinutes = Math.min(
      ...appointments.map((appointment) => minutesInTenantDay(appointment.startAt)),
      ...openings.map((opening) => minutesInTenantDay(opening.startAt)),
      ...relevantTimeBlocks.map((block) => minutesInTenantDay(block.startAt)),
    );
    const maxMinutes = Math.max(
      ...appointments.map((appointment) => minutesInTenantDay(appointment.endAt)),
      ...openings.map((opening) => minutesInTenantDay(opening.endAt)),
      ...relevantTimeBlocks.map((block) => minutesInTenantDay(block.endAt)),
    );

    startHour = Math.max(SCHEDULE_MIN_HOUR, Math.floor((minMinutes - 45) / 60));
    endHour = Math.min(SCHEDULE_MAX_HOUR, Math.ceil((maxMinutes + 45) / 60));

    if (endHour <= startHour) {
      endHour = Math.min(SCHEDULE_MAX_HOUR, startHour + SCHEDULE_MIN_VISIBLE_HOURS);
    }
  }

  if (endHour - startHour < SCHEDULE_MIN_VISIBLE_HOURS) {
    endHour = Math.min(SCHEDULE_MAX_HOUR, startHour + SCHEDULE_MIN_VISIBLE_HOURS);
    if (endHour - startHour < SCHEDULE_MIN_VISIBLE_HOURS) {
      startHour = Math.max(SCHEDULE_MIN_HOUR, endHour - SCHEDULE_MIN_VISIBLE_HOURS);
    }
  }

  const totalHours = Math.max(1, endHour - startHour);
  const scheduleHeightPx = totalHours * SCHEDULE_HOUR_HEIGHT_PX;
  const hourLabels = Array.from({ length: totalHours }, (_, index) => startHour + index);
  const scheduleColumns: ScheduleColumn[] =
    viewMode === "day"
      ? (() => {
          const focusedDay = days[0];
          if (!focusedDay) {
            return [];
          }

          const providerColumns = new Map<
            string,
            {
              key: string;
              heading: string;
              providerId: string;
              providerName: string;
              appointments: CalendarAppointment[];
              openings: CalendarOpening[];
            }
          >();
          for (const appointment of focusedDay.appointments) {
            const existing = providerColumns.get(appointment.providerId);
            if (existing) {
              existing.appointments.push(appointment);
              continue;
            }

            providerColumns.set(appointment.providerId, {
              key: appointment.providerId,
              heading: appointment.providerName,
              providerId: appointment.providerId,
              providerName: appointment.providerName,
              appointments: [appointment],
              openings: [],
            });
          }

          for (const opening of focusedDay.openings) {
            const existing = providerColumns.get(opening.providerId);
            if (existing) {
              existing.openings.push(opening);
              continue;
            }

            providerColumns.set(opening.providerId, {
              key: opening.providerId,
              heading: opening.providerName,
              providerId: opening.providerId,
              providerName: opening.providerName,
              appointments: [],
              openings: [opening],
            });
          }

          const columns: ScheduleColumn[] = Array.from(providerColumns.values())
            .sort((left, right) => {
              const leftStart = left.appointments[0]?.startAt ?? left.openings[0]?.startAt ?? "";
              const rightStart = right.appointments[0]?.startAt ?? right.openings[0]?.startAt ?? "";
              return leftStart.localeCompare(rightStart) || left.heading.localeCompare(right.heading);
            })
            .map((column) => ({
              key: column.key,
              date: focusedDay.date,
              heading: column.heading,
              providerId: column.providerId,
              providerName: column.providerName,
              appointments: column.appointments,
              openings: column.openings,
              availableSegments: mergeMinuteSegments(column.openings),
              emptyLabel: "No appointments",
            }));

          return columns.length > 0
            ? columns
            : [
                {
                  key: `${focusedDay.date}-empty`,
                  date: focusedDay.date,
                  heading: "No providers",
                  appointments: [],
                  openings: focusedDay.openings,
                  availableSegments: mergeMinuteSegments(focusedDay.openings),
                  emptyLabel: "No appointments",
                },
              ];
        })()
      : days.map((day) => ({
          key: day.date,
          date: day.date,
          heading: getWeekHeading(day.date),
          subheading: getDayNumberLabel(day.date),
          appointments: day.appointments,
          openings: day.openings,
          availableSegments: mergeMinuteSegments(day.openings),
          emptyLabel: "No appointments",
        }));

  const dayCount = Math.max(1, scheduleColumns.length);

  return (
    <div
      className={`schedule-board${viewMode === "day" ? " schedule-board--day" : ""}`}
      aria-label="Scheduled appointments"
      style={{
        "--schedule-hour-height": `${SCHEDULE_HOUR_HEIGHT_PX}px`,
        "--schedule-quarter-height": `${SCHEDULE_QUARTER_HEIGHT_PX}px`,
      } as CSSProperties}
    >
      <div className="schedule-board__header" style={{ gridTemplateColumns: `88px repeat(${dayCount}, minmax(0, 1fr))` }}>
        <div className="schedule-header-corner">Time</div>
        {scheduleColumns.map((column) => (
          <div
            key={column.key}
            className="schedule-day-heading"
            aria-label={column.subheading ? `${column.heading} ${column.subheading} column` : `${column.heading} column`}
          >
            <strong>{column.heading}</strong>
            {column.subheading ? <span>{column.subheading}</span> : null}
          </div>
        ))}
      </div>

      <div className="schedule-board__body">
        <div className="schedule-time-axis" style={{ height: `${scheduleHeightPx}px` }}>
          {hourLabels.map((hour) => (
            <div key={hour} className="schedule-time-axis__cell">
              {formatHourLabel(hour)}
            </div>
          ))}
        </div>

        <div className="schedule-day-tracks" style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))`, height: `${scheduleHeightPx}px` }}>
          {scheduleColumns.map((column) => {
            const scheduleStartMinute = startHour * 60;
            const scheduleEndMinute = endHour * 60;
            const unavailableSegments: { topPx: number; heightPx: number }[] = [];
            const isInteractiveTrack = viewMode === "day" && column.providerId !== undefined && column.providerName !== undefined;

            const handleTrackClick = (event: MouseEvent<HTMLElement>) => {
              if (!isInteractiveTrack) {
                return;
              }

              const rect = event.currentTarget.getBoundingClientRect();
              const relativeY = rect.height > 0 ? event.clientY - rect.top : 0;
              const clickedMinutes = rect.height > 0
                ? scheduleStartMinute + (Math.max(0, Math.min(rect.height, relativeY)) / rect.height) * (scheduleEndMinute - scheduleStartMinute)
                : column.openings[0]
                  ? minutesInTenantDay(column.openings[0].startAt)
                  : scheduleStartMinute;
              const startMinute = Math.max(scheduleStartMinute, Math.min(scheduleEndMinute - 15, roundToQuarterHour(clickedMinutes)));
              const durationMinutes = timeBlockDurationMinutes;
              const endMinute = Math.min(scheduleEndMinute, startMinute + durationMinutes);

              onRequestTimeBlock(column.providerId!, column.providerName!, {
                date: column.date,
                providerId: column.providerId!,
                providerName: column.providerName!,
                locationId: column.openings[0]?.locationId,
                startAt: toTenantDateTimeIso(column.date, startMinute),
                endAt: toTenantDateTimeIso(column.date, endMinute),
              });
            };

            if (column.availableSegments.length > 0) {
              let cursor = scheduleStartMinute;
              for (const segment of column.availableSegments) {
                const segmentStart = Math.max(scheduleStartMinute, segment.startMinute);
                const segmentEnd = Math.min(scheduleEndMinute, segment.endMinute);
                if (segmentStart > cursor) {
                  unavailableSegments.push({
                    topPx: ((cursor - scheduleStartMinute) / 60) * SCHEDULE_HOUR_HEIGHT_PX,
                    heightPx: ((segmentStart - cursor) / 60) * SCHEDULE_HOUR_HEIGHT_PX,
                  });
                }
                cursor = Math.max(cursor, segmentEnd);
              }
              if (cursor < scheduleEndMinute) {
                unavailableSegments.push({
                  topPx: ((cursor - scheduleStartMinute) / 60) * SCHEDULE_HOUR_HEIGHT_PX,
                  heightPx: ((scheduleEndMinute - cursor) / 60) * SCHEDULE_HOUR_HEIGHT_PX,
                });
              }
            }

            return (
              <section
                key={column.key}
                className={`schedule-day-track${isInteractiveTrack ? " schedule-day-track--interactive" : ""}`}
                aria-label={isInteractiveTrack ? `${column.providerName} schedule track` : `${column.heading} schedule track`}
                onClick={handleTrackClick}
              >
                {unavailableSegments.map((segment, index) => (
                  <div
                    key={`unavailable-${index}`}
                    className="schedule-unavailable"
                    aria-hidden="true"
                    style={{ top: `${segment.topPx}px`, height: `${segment.heightPx}px` }}
                  />
                ))}
                {column.appointments.length === 0 ? (
                  <span className="schedule-day-track__empty">{column.emptyLabel}</span>
                ) : null}
                {viewMode === "day" && column.providerId
                  ? timeBlocks
                      .filter((block) => block.providerId === column.providerId && days.some((day) => day.date === block.date))
                      .map((block) => {
                        const isSelected = block.id === selectedTimeBlockId;
                        const startMinutes = minutesInTenantDay(block.startAt);
                        const rawEndMinutes = minutesInTenantDay(block.endAt);
                        const endMinutes = rawEndMinutes > startMinutes ? rawEndMinutes : startMinutes + 15;
                        const startOffsetMinutes = Math.max(0, startMinutes - startHour * 60);
                        const durationMinutes = Math.max(15, endMinutes - startMinutes);

                        const rawTopPx = (startOffsetMinutes / 60) * SCHEDULE_HOUR_HEIGHT_PX;
                        const maxTopPx = Math.max(0, scheduleHeightPx - SCHEDULE_MIN_EVENT_HEIGHT_PX);
                        const topPx = Math.min(rawTopPx, maxTopPx);
                        const rawHeightPx = Math.max(
                          SCHEDULE_MIN_EVENT_HEIGHT_PX,
                          (durationMinutes / 60) * SCHEDULE_HOUR_HEIGHT_PX,
                        );
                        const heightPx = Math.max(
                          SCHEDULE_MIN_EVENT_HEIGHT_PX,
                          Math.min(rawHeightPx, scheduleHeightPx - topPx),
                        );

                        return (
                          <button
                            key={block.id}
                            type="button"
                            className={`schedule-time-block${isSelected ? " schedule-time-block--selected" : ""}`}
                            aria-label={`Time block ${formatDateTime(block.startAt)} with ${block.providerName}`}
                            aria-pressed={isSelected}
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectTimeBlock(block.id);
                            }}
                            style={{ top: `${topPx}px`, height: `${heightPx}px` }}
                          >
                            <strong>{formatTimeRange(block.startAt, block.endAt)}</strong>
                            <span>{`Time block · ${block.providerName}`}</span>
                          </button>
                        );
                      })
                  : null}
                {column.appointments.map((appointment) => {
                  const isSelected = appointment.id === selectedAppointmentId;
                  const intakeStatus = intakeStatusByBookingId[appointment.id] ?? "unknown";
                  const intakeLabel = getIntakeStatusLabel(intakeStatus);

                  const startMinutes = minutesInTenantDay(appointment.startAt);
                  const rawEndMinutes = minutesInTenantDay(appointment.endAt);
                  const endMinutes = rawEndMinutes > startMinutes ? rawEndMinutes : startMinutes + 15;
                  const startOffsetMinutes = Math.max(0, startMinutes - startHour * 60);
                  const durationMinutes = Math.max(15, endMinutes - startMinutes);

                  const rawTopPx = (startOffsetMinutes / 60) * SCHEDULE_HOUR_HEIGHT_PX;
                  const maxTopPx = Math.max(0, scheduleHeightPx - SCHEDULE_MIN_EVENT_HEIGHT_PX);
                  const topPx = Math.min(rawTopPx, maxTopPx);
                  const rawHeightPx = Math.max(
                    SCHEDULE_MIN_EVENT_HEIGHT_PX,
                    (durationMinutes / 60) * SCHEDULE_HOUR_HEIGHT_PX,
                  );
                  const heightPx = Math.max(
                    SCHEDULE_MIN_EVENT_HEIGHT_PX,
                    Math.min(rawHeightPx, scheduleHeightPx - topPx),
                  );

                  return (
                    <button
                      key={appointment.id}
                      type="button"
                      className={`schedule-event${isSelected ? " schedule-event--selected" : ""}`}
                      aria-label={`View ${appointment.customerName} booked ${formatDateTime(appointment.startAt)} with ${appointment.providerName}. ${intakeLabel}.`}
                      aria-pressed={isSelected}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectAppointment(appointment.id);
                      }}
                      style={{ top: `${topPx}px`, height: `${heightPx}px` }}
                    >
                      <strong>
                        {viewMode === "day"
                          ? formatTimeRange(appointment.startAt, appointment.endAt)
                          : appointment.customerName}
                      </strong>
                      <span>
                        {viewMode === "day"
                          ? `${appointment.customerName} · ${appointment.serviceName}`
                          : `${appointment.serviceName} · ${formatTimeRange(appointment.startAt, appointment.endAt)}`}
                      </span>
                      <span className={`schedule-event__intake schedule-event__intake--${intakeStatus}`}>
                        {intakeLabel}
                      </span>
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type TimeBlockPromptProps = {
  selectedTimeBlock: CalendarTimeBlock | null;
  selectedService: ServiceSummary | null;
  draftCreationState: DraftCreationState;
  draftHref: string | null;
  onCreateDraft: () => void;
  onDiscard: () => void;
};

function TimeBlockPrompt({
  selectedTimeBlock,
  selectedService,
  draftCreationState,
  draftHref,
  onCreateDraft,
  onDiscard,
}: TimeBlockPromptProps): JSX.Element | null {
  if (!selectedTimeBlock && draftCreationState.kind !== "success") {
    return null;
  }

  return (
    <section className="time-block-prompt" aria-label="Time block action">
      <div>
        <p className="eyebrow">Time block</p>
        <h4>{selectedTimeBlock ? "Block selected time" : "Booking draft created"}</h4>
      </div>
      {draftCreationState.kind === "success" ? (
        <div className="message-banner" role="status">
          Booking draft created and slot held for 15 minutes.
        </div>
      ) : null}
      {draftCreationState.kind === "error" ? (
        <div className="message-banner message-banner--error" role="alert">
          {draftCreationState.message}
        </div>
      ) : null}
      {selectedTimeBlock ? (
        <div className="time-block-prompt__summary">
          <span>{selectedService?.name ?? "Selected service"}</span>
          <strong>{formatDateTime(selectedTimeBlock.startAt)}</strong>
          <span>{selectedTimeBlock.providerName}</span>
        </div>
      ) : null}
      <div className="action-row">
        {selectedTimeBlock ? (
          <button
            type="button"
            onClick={onCreateDraft}
            disabled={selectedService === null || draftCreationState.kind === "submitting"}
          >
            {draftCreationState.kind === "submitting" ? "Creating draft..." : "Create draft from time block"}
          </button>
        ) : null}
        {selectedTimeBlock ? (
          <button type="button" className="text-action" onClick={onDiscard}>
            Discard time block
          </button>
        ) : null}
        {draftHref ? (
          <a className="secondary-action" href={draftHref}>
            Open draft in storefront
          </a>
        ) : null}
      </div>
    </section>
  );
}

type AppointmentDetailsDrawerProps = {
  selectedAppointment: SelectedCalendarAppointment | null;
  formResponsesState: FormResponsesState;
  intakeStatus: IntakeStatus;
  selectedCustomerLabel: string;
  selectedServiceLabel: string;
  selectedAppointmentTimeLabel: string;
  selectedProviderLabel: string;
  selectedStatusLabel: string;
  selectedPaymentLabel: string;
  onClose: () => void;
};

function AppointmentDetailsDrawer({
  selectedAppointment,
  formResponsesState,
  intakeStatus,
  selectedCustomerLabel,
  selectedServiceLabel,
  selectedAppointmentTimeLabel,
  selectedProviderLabel,
  selectedStatusLabel,
  selectedPaymentLabel,
  onClose,
}: AppointmentDetailsDrawerProps): JSX.Element | null {
  if (!selectedAppointment) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="appointment-drawer-backdrop"
        aria-label="Close appointment details"
        onClick={onClose}
      />
      <aside className="appointment-details-drawer" role="dialog" aria-label="Appointment details">
        <header className="appointment-details-drawer__header">
          <div>
            <p className="eyebrow">Appointment details</p>
            <h4>{selectedAppointment.customerName}</h4>
          </div>
          <button type="button" className="text-action" onClick={onClose}>
            Close
          </button>
        </header>

        <section className="booking-rail-section booking-rail-section--forms" aria-label="Submitted forms">
          <FormResponsesPanel
            selectedAppointment={selectedAppointment}
            state={formResponsesState}
            intakeStatus={intakeStatus}
          />
        </section>

        <section className="booking-rail-section" aria-label="Appointment details preview">
          <p>
            {`${selectedAppointment.customerName} is booked for ${selectedAppointment.serviceName} with ${selectedAppointment.providerName} on ${formatDateTime(selectedAppointment.startAt)}.`}
          </p>
          <div className="drawer-form-preview">
            <div className="drawer-selection-note" aria-live="polite">
              {`Selected ${selectedAppointment.dayLabel} at ${timeFormatter.format(new Date(selectedAppointment.startAt))} for ${selectedAppointment.customerName}.`}
            </div>
            <label>
              Customer
              <input value={selectedCustomerLabel} readOnly />
            </label>
            <label>
              Service
              <input value={selectedServiceLabel} readOnly />
            </label>
            <label>
              Scheduled time
              <input value={selectedAppointmentTimeLabel} readOnly />
            </label>
            <label>
              Provider
              <input value={selectedProviderLabel} readOnly />
            </label>
            <label>
              Booking status
              <input value={selectedStatusLabel} readOnly />
            </label>
            <label>
              Payment status
              <input value={selectedPaymentLabel} readOnly />
            </label>
          </div>
        </section>
      </aside>
    </>
  );
}

type FormResponsesPanelProps = {
  selectedAppointment: SelectedCalendarAppointment | null;
  state: FormResponsesState;
  intakeStatus: IntakeStatus;
};

function formatFormAnswer(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "—" : value.map((entry) => String(entry)).join(", ");
  }
  if (typeof value === "string") {
    return value.trim().length === 0 ? "—" : value;
  }
  return String(value);
}

function FormResponsesPanel({ selectedAppointment, state, intakeStatus }: FormResponsesPanelProps): JSX.Element {
  const intakeLabel = getIntakeStatusLabel(intakeStatus);

  return (
    <>
      <div className="rail-section-heading">
        <div>
          <p className="eyebrow">Submitted forms</p>
          <h4>Customer intake</h4>
        </div>
        <span className={`intake-status-badge intake-status-badge--${intakeStatus}`}>{intakeLabel}</span>
      </div>
      {!selectedAppointment ? (
        <p>Select an appointment to review any intake forms the customer submitted before the visit.</p>
      ) : state.kind === "loading" ? (
        <p>Checking intake status...</p>
      ) : state.kind === "error" ? (
        <div className="message-banner message-banner--error" role="alert">
          {state.message}
        </div>
      ) : state.kind === "ready" && state.items.length === 0 ? (
        <div className="message-banner message-banner--warning" role="status">
          Intake missing for this booking.
        </div>
      ) : state.kind === "ready" ? (
        <ul className="form-responses-list" aria-label="Submitted forms">
          {state.items.map((entry) => {
            const fields = entry.schema?.fields ?? [];
            const promptable = fields.filter((field) => field.type !== "section" && field.type !== "static_text");
            return (
              <li key={entry.id} className="form-responses-list__item">
                <header className="form-responses-list__header">
                  <span className="form-responses-list__title">{entry.formName}</span>
                  <span className="form-responses-list__meta">
                    v{entry.formVersionNumber} · {formatDateTime(entry.submittedAt)}
                  </span>
                </header>
                {promptable.length === 0 ? (
                  <p className="form-responses-list__empty">No prompted answers recorded.</p>
                ) : (
                  <dl className="form-responses-list__answers">
                    {promptable.map((field) => (
                      <div key={field.id} className="form-responses-list__answer">
                        <dt>{field.label}</dt>
                        <dd>{formatFormAnswer(entry.answers[field.id])}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
