import { startTransition, useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactElement } from "react";
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
  CustomerLookupQuery,
  CustomerLookupResponse,
  CustomerSummary,
  ProviderListResponse,
  ServiceListResponse,
  ServiceSummary,
  SlotAvailability,
} from "@booking/shared-types";

import { platformApi } from "./platform-api";

type CalendarDataState =
  | { kind: "loading" }
  | { kind: "ready"; days: CalendarDay[]; services: ServiceSummary[]; providers: CalendarProviderOption[] }
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
  durationMinutes: number;
};

type CalendarServiceOption = {
  id: string;
  name: string;
  durationMinutes: number;
};

type CalendarAppointment = {
  id: string;
  startAt: string;
  endAt: string;
  providerId: string;
  providerName: string;
  customerName: string;
  serviceId: string;
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
  notes: string;
  blockedServiceIds: string[];
};

type PendingTimeBlock = Omit<CalendarTimeBlock, "id" | "notes" | "blockedServiceIds"> & {
  notes?: string;
  blockedServiceIds?: string[];
};

type PendingCalendarSlot = {
  date: string;
  providerId: string | null;
  providerName: string | null;
  locationId?: string;
  startAt: string;
  endAt: string;
  openings: CalendarOpening[];
  providerOptions: CalendarProviderOption[];
};

type SlotCustomerForm = {
  name: string;
  email: string;
  phone: string;
};

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

type CustomerLookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; items: CustomerSummary[] }
  | { kind: "error"; message: string };

type CalendarProviderOption = {
  id: string;
  name: string;
};

export type CalendarPageDefinition = {
  eyebrow: string;
  description: string;
};

export type CalendarPageApi = {
  listBookings: (tenantSlug: string, query?: BookingListQuery) => Promise<BookingListResponse>;
  listServices: (tenantSlug: string) => Promise<ServiceListResponse>;
  listServiceProviders: (tenantSlug: string, serviceId: string) => Promise<ProviderListResponse>;
  lookupCustomers: (query: CustomerLookupQuery) => Promise<CustomerLookupResponse>;
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

function getDurationMinutes(startAt: string, endAt: string): number {
  const startMs = new Date(startAt).getTime();
  const endMs = new Date(endAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 15;
  }
  return Math.max(15, Math.round((endMs - startMs) / 60_000));
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hourLabel = `${hours} hr${hours === 1 ? "" : "s"}`;

  return remainder === 0 ? hourLabel : `${hourLabel} ${remainder} min`;
}

function timeRangesOverlap(leftStartAt: string, leftEndAt: string, rightStartAt: string, rightEndAt: string): boolean {
  return new Date(leftStartAt).getTime() < new Date(rightEndAt).getTime() && new Date(rightStartAt).getTime() < new Date(leftEndAt).getTime();
}

function getInitials(value: string): string {
  const initials = value
    .split(/\s+/)
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");

  return initials.toUpperCase() || "--";
}

function toTenantDateTimeIso(date: string, minuteOfDay: number): string {
  const safeMinute = Math.max(0, Math.min(23 * 60 + 59, minuteOfDay));
  const hour = Math.floor(safeMinute / 60);
  const minute = safeMinute % 60;
  const hourText = String(hour).padStart(2, "0");
  const minuteText = String(minute).padStart(2, "0");
  return new Date(`${date}T${hourText}:${minuteText}:00-07:00`).toISOString();
}

function formatTimeInputValue(value: string): string {
  const parts = tenantTimePartsFormatter.formatToParts(new Date(value));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function getMinutesFromTimeInput(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) {
    return null;
  }

  return hour * 60 + minute;
}

function addMinutesToTenantIso(startAt: string, durationMinutes: number): string {
  const date = getTenantDate(startAt);
  return toTenantDateTimeIso(date, minutesInTenantDay(startAt) + Math.max(15, durationMinutes));
}

function addMinutesToIsoUnclamped(startAt: string, durationMinutes: number): string {
  const startMs = new Date(startAt).getTime();
  if (!Number.isFinite(startMs)) {
    return startAt;
  }
  return new Date(startMs + Math.max(15, durationMinutes) * 60_000).toISOString();
}

function isoFromTenantDateAndTime(date: string, timeValue: string): string | null {
  const minuteOfDay = getMinutesFromTimeInput(timeValue);
  if (minuteOfDay === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  return toTenantDateTimeIso(date, minuteOfDay);
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
    serviceId: booking.serviceId,
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
    durationMinutes: service.durationMinutes,
  };
}

function getProviderOptions(days: CalendarDay[]): CalendarProviderOption[] {
  const providers = new Map<string, string>();

  for (const day of days) {
    for (const appointment of day.appointments) {
      providers.set(appointment.providerId, appointment.providerName);
    }
    for (const opening of day.openings) {
      providers.set(opening.providerId, opening.providerName);
    }
  }

  return Array.from(providers, ([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
}

function mergeProviderOptions(...providerGroups: CalendarProviderOption[][]): CalendarProviderOption[] {
  const providers = new Map<string, string>();

  for (const group of providerGroups) {
    for (const provider of group) {
      providers.set(provider.id, provider.name);
    }
  }

  return Array.from(providers, ([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
}

function getProviderOptionsFromProviderResponses(responses: PromiseSettledResult<ProviderListResponse>[]): CalendarProviderOption[] {
  const providers = responses.flatMap((response) =>
    response.status === "fulfilled"
      ? response.value.providers.filter((provider) => provider.isActive).map((provider) => ({ id: provider.id, name: provider.name }))
      : [],
  );

  return mergeProviderOptions(providers);
}

function getProviderOptionsFromSchedule(appointments: CalendarAppointment[], openings: CalendarOpening[]): CalendarProviderOption[] {
  const providers = new Map<string, string>();
  for (const appointment of appointments) {
    providers.set(appointment.providerId, appointment.providerName);
  }
  for (const opening of openings) {
    providers.set(opening.providerId, opening.providerName);
  }
  return Array.from(providers, ([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name));
}

function getServiceOptionsFromOpenings(openings: CalendarOpening[], providerId: string | null, fallbackServices: ServiceSummary[]): CalendarServiceOption[] {
  const services = new Map<string, CalendarServiceOption>();

  for (const opening of openings) {
    if (providerId !== null && opening.providerId !== providerId) {
      continue;
    }
    services.set(opening.serviceId, {
      id: opening.serviceId,
      name: opening.serviceName,
      durationMinutes: opening.durationMinutes,
    });
  }

  if (services.size === 0) {
    for (const service of fallbackServices) {
      services.set(service.id, {
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
      });
    }
  }

  return Array.from(services.values()).sort((left, right) => left.name.localeCompare(right.name));
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
  const [selectedWeekProviderId, setSelectedWeekProviderId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<PendingCalendarSlot | null>(null);
  const [selectedSlotServiceId, setSelectedSlotServiceId] = useState<string | null>(null);
  const [selectedSlotNotes, setSelectedSlotNotes] = useState("");
  const [selectedSlotBlockedServiceIds, setSelectedSlotBlockedServiceIds] = useState<string[]>([]);
  const [selectedSlotCustomer, setSelectedSlotCustomer] = useState<SlotCustomerForm>({ name: "", email: "", phone: "" });
  const [selectedSlotBlockDurationMinutes, setSelectedSlotBlockDurationMinutes] = useState(60);
  const [customerLookupState, setCustomerLookupState] = useState<CustomerLookupState>({ kind: "idle" });
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
    setSelectedSlot(null);
    setSelectedSlotCustomer({ name: "", email: "", phone: "" });
    setSelectedSlotBlockDurationMinutes(60);
    setCustomerLookupState({ kind: "idle" });
    setDraftCreationState({ kind: "idle" });
    setIntakeStatusByBookingId({});
    setSelectedWeekProviderId(null);

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
        const providerResults = services.length > 0
          ? await Promise.allSettled(services.map((service) => api.listServiceProviders(tenantSlug, service.id)))
          : [];

        if (isCancelled) {
          return;
        }

        const providers = getProviderOptionsFromProviderResponses(providerResults);
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
          setCalendarState({ kind: "ready", days, services, providers });
          if (days.length > 0) {
            setFocusedDate(days[0].date);
            setMonthCursorDate(monthAnchor(days[0].date));
          }
          setSelectedServiceId((current) => (current !== null && services.some((service) => service.id === current) ? current : null));
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
  const serviceDateKey = calendarState.kind === "ready" ? calendarState.services.map((service) => service.id).join("|") : "";

  useEffect(() => {
    if (calendarState.kind !== "ready") {
      return;
    }

    if (calendarState.services.length === 0) {
      setCalendarState((current) => {
        if (current.kind !== "ready") {
          return current;
        }

        return {
          kind: "ready",
          services: current.services,
          providers: current.providers,
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
        const services = selectedServiceId === null
          ? calendarState.services
          : calendarState.services.filter((candidate) => candidate.id === selectedServiceId);
        if (services.length === 0) {
          return;
        }

        const availabilityResponses = await Promise.all(
          services.flatMap((service) =>
            requestedDates.map((date) =>
              api.getAvailability({
                tenantSlug,
                serviceId: service.id,
                date,
                windowDays: 1,
              }).then((availability) => ({ availability, requestedDate: date, service })),
            ),
          ),
        );

        if (isCancelled) {
          return;
        }

        const openingsByDate = new Map(requestedDates.map((date) => [date, [] as CalendarOpening[]]));

        for (const { availability, requestedDate, service } of availabilityResponses) {
          const resolvedDate = openingsByDate.has(availability.days[0]?.date ?? "") ? (availability.days[0]?.date ?? requestedDate) : requestedDate;
          openingsByDate.get(resolvedDate)?.push(
            ...availability.slots
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
              providers: current.providers,
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
              providers: current.providers,
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
  }, [api, calendarDateKey, calendarState.kind, selectedServiceId, serviceDateKey, tenantSlug]);

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

  const weekProviderOptions = useMemo(
    () => (viewMode === "week" && calendarState.kind === "ready" ? mergeProviderOptions(calendarState.providers, getProviderOptions(viewDays)) : []),
    [calendarState, viewDays, viewMode],
  );
  const selectedWeekProvider = useMemo(
    () => weekProviderOptions.find((provider) => provider.id === selectedWeekProviderId) ?? null,
    [selectedWeekProviderId, weekProviderOptions],
  );

  useEffect(() => {
    if (selectedWeekProviderId === null) {
      return;
    }
    if (!weekProviderOptions.some((provider) => provider.id === selectedWeekProviderId)) {
      setSelectedWeekProviderId(null);
    }
  }, [selectedWeekProviderId, weekProviderOptions]);

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
    setSelectedSlot(null);
  };

  const handleSelectWeekProvider = (providerId: string | null) => {
    setSelectedWeekProviderId(providerId);
    setSelectedAppointmentId(null);
    setSelectedTimeBlockId(null);
    setSelectedSlot(null);
    setDraftCreationState({ kind: "idle" });
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

  const selectedTimeBlockAppointments = useMemo<CalendarAppointment[]>(() => {
    if (calendarState.kind !== "ready" || selectedTimeBlock === null) {
      return [];
    }

    return calendarState.days
      .flatMap((day) => day.appointments)
      .filter(
        (appointment) =>
          appointment.providerId === selectedTimeBlock.providerId &&
          (selectedTimeBlock.blockedServiceIds.length === 0 || selectedTimeBlock.blockedServiceIds.includes(appointment.serviceId)) &&
          timeRangesOverlap(selectedTimeBlock.startAt, selectedTimeBlock.endAt, appointment.startAt, appointment.endAt),
      )
      .sort((left, right) => left.startAt.localeCompare(right.startAt) || left.customerName.localeCompare(right.customerName));
  }, [calendarState, selectedTimeBlock]);

  const selectedSlotServiceOptions = useMemo<CalendarServiceOption[]>(() => {
    if (calendarState.kind !== "ready" || selectedSlot === null) {
      return [];
    }

    return getServiceOptionsFromOpenings(selectedSlot.openings, selectedSlot.providerId, calendarState.services);
  }, [calendarState, selectedSlot]);

  const selectedSlotService = useMemo<CalendarServiceOption | null>(
    () => selectedSlotServiceOptions.find((service) => service.id === selectedSlotServiceId) ?? null,
    [selectedSlotServiceId, selectedSlotServiceOptions],
  );

  const selectedTimeBlockServiceOptions = useMemo<CalendarServiceOption[]>(() => {
    if (calendarState.kind !== "ready" || selectedTimeBlock === null) {
      return [];
    }

    const blockDay = calendarState.days.find((day) => day.date === selectedTimeBlock.date);
    return getServiceOptionsFromOpenings(blockDay?.openings ?? [], selectedTimeBlock.providerId, calendarState.services);
  }, [calendarState, selectedTimeBlock]);

  useEffect(() => {
    if (selectedSlot === null) {
      return;
    }

    setSelectedSlotServiceId((current) => {
      if (current !== null && selectedSlotServiceOptions.some((service) => service.id === current)) {
        return current;
      }
      if (selectedServiceId !== null && selectedSlotServiceOptions.some((service) => service.id === selectedServiceId)) {
        return selectedServiceId;
      }
      return selectedSlotServiceOptions[0]?.id ?? null;
    });

    setSelectedSlotBlockedServiceIds((current) => {
      const valid = current.filter((serviceId) => selectedSlotServiceOptions.some((service) => service.id === serviceId));
      return valid.length > 0 ? valid : selectedSlotServiceOptions.map((service) => service.id);
    });
  }, [selectedServiceId, selectedSlot, selectedSlotServiceOptions]);

  useEffect(() => {
    if (selectedSlot === null) {
      setCustomerLookupState({ kind: "idle" });
      return;
    }

    const search = selectedSlotCustomer.name.trim();
    if (search.length < 2) {
      setCustomerLookupState({ kind: "idle" });
      return;
    }

    let isCancelled = false;
    setCustomerLookupState({ kind: "loading" });
    api
      .lookupCustomers({ search, limit: 5 })
      .then((response) => {
        if (isCancelled) {
          return;
        }

        setCustomerLookupState({ kind: "ready", items: response.items });
        const normalizedSearch = search.toLowerCase();
        const matchingCustomer = response.items.find((customer) => customer.name.toLowerCase().startsWith(normalizedSearch));
        if (matchingCustomer) {
          setSelectedSlotCustomer((current) => {
            if (current.name.trim().toLowerCase() !== normalizedSearch) {
              return current;
            }

            const nextCustomer = {
              name: matchingCustomer.name,
              email: matchingCustomer.email ?? "",
              phone: matchingCustomer.phone ?? "",
            };
            if (current.name === nextCustomer.name && current.email === nextCustomer.email && current.phone === nextCustomer.phone) {
              return current;
            }
            return nextCustomer;
          });
        }
      })
      .catch((error: unknown) => {
        if (isCancelled) {
          return;
        }

        setCustomerLookupState({
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to search customer records.",
        });
      });

    return () => {
      isCancelled = true;
    };
  }, [api, selectedSlot, selectedSlotCustomer.name]);

  const handleRequestCalendarSlot = (slot: PendingCalendarSlot) => {
    const provider = slot.providerId !== null
      ? { id: slot.providerId, name: slot.providerName ?? "Selected provider" }
      : (slot.providerOptions[0] ?? null);

    setSelectedSlot({
      ...slot,
      providerId: provider?.id ?? null,
      providerName: provider?.name ?? null,
      locationId: provider ? (slot.openings.find((opening) => opening.providerId === provider.id)?.locationId ?? slot.locationId) : slot.locationId,
    });
    setSelectedAppointmentId(null);
    setSelectedTimeBlockId(null);
    setSelectedSlotNotes("");
    setSelectedSlotCustomer({ name: "", email: "", phone: "" });
    setSelectedSlotBlockDurationMinutes(getDurationMinutes(slot.startAt, slot.endAt));
    setCustomerLookupState({ kind: "idle" });
    setDraftCreationState({ kind: "idle" });
  };

  const handleSelectSlotService = (serviceId: string) => {
    const service = selectedSlotServiceOptions.find((option) => option.id === serviceId);
    setSelectedSlotServiceId(serviceId);
    if (service) {
      setSelectedSlot((current) => (current === null ? current : { ...current, endAt: addMinutesToTenantIso(current.startAt, service.durationMinutes) }));
    }
    setDraftCreationState({ kind: "idle" });
  };

  const handleUpdateSlotStartTime = (timeValue: string) => {
    const minuteOfDay = getMinutesFromTimeInput(timeValue);
    if (minuteOfDay === null) {
      return;
    }

    setSelectedSlot((current) => {
      if (current === null) {
        return current;
      }

      const startAt = toTenantDateTimeIso(current.date, minuteOfDay);
      const appointmentDurationMinutes = selectedSlotService?.durationMinutes ?? getDurationMinutes(current.startAt, current.endAt);
      return {
        ...current,
        startAt,
        endAt: addMinutesToTenantIso(startAt, appointmentDurationMinutes),
      };
    });
    setDraftCreationState({ kind: "idle" });
  };

  const handleUpdateSlotStartDate = (dateValue: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      return;
    }

    setSelectedSlot((current) => {
      if (current === null) {
        return current;
      }

      const startAt = toTenantDateTimeIso(dateValue, minutesInTenantDay(current.startAt));
      const appointmentDurationMinutes = selectedSlotService?.durationMinutes ?? getDurationMinutes(current.startAt, current.endAt);
      return {
        ...current,
        date: dateValue,
        startAt,
        endAt: addMinutesToTenantIso(startAt, appointmentDurationMinutes),
      };
    });
    setDraftCreationState({ kind: "idle" });
  };

  const handleUpdateSlotBlockEnd = (dateValue: string, timeValue: string) => {
    if (selectedSlot === null) {
      return;
    }
    const endIso = isoFromTenantDateAndTime(dateValue, timeValue);
    if (endIso === null) {
      return;
    }
    const startMs = new Date(selectedSlot.startAt).getTime();
    const endMs = new Date(endIso).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return;
    }
    const durationMinutes = Math.max(15, Math.round((endMs - startMs) / 60_000));
    setSelectedSlotBlockDurationMinutes(durationMinutes);
    setDraftCreationState({ kind: "idle" });
  };

  const handleUpdateSlotBlockDuration = (durationValue: number) => {
    if (!Number.isFinite(durationValue)) {
      return;
    }

    const durationMinutes = Math.max(15, Math.min(12 * 60, Math.round(durationValue / 15) * 15));
    setSelectedSlotBlockDurationMinutes(durationMinutes);
    setDraftCreationState({ kind: "idle" });
  };

  const handleUpdateSlotCustomerField = (field: keyof SlotCustomerForm, value: string) => {
    setSelectedSlotCustomer((current) => ({ ...current, [field]: value }));
    setDraftCreationState({ kind: "idle" });
  };

  const handleApplySlotCustomer = (customer: CustomerSummary) => {
    setSelectedSlotCustomer({
      name: customer.name,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
    });
    setCustomerLookupState({ kind: "ready", items: [customer] });
    setDraftCreationState({ kind: "idle" });
  };

  const handleSelectSlotProvider = (providerId: string) => {
    setSelectedSlot((current) => {
      if (current === null) {
        return current;
      }

      const provider = current.providerOptions.find((option) => option.id === providerId);
      if (!provider) {
        return current;
      }

      return {
        ...current,
        providerId: provider.id,
        providerName: provider.name,
        locationId: current.openings.find((opening) => opening.providerId === provider.id)?.locationId ?? current.locationId,
      };
    });
    setSelectedSlotServiceId(null);
    setSelectedSlotBlockedServiceIds([]);
    setDraftCreationState({ kind: "idle" });
  };

  const handleToggleSlotBlockedService = (serviceId: string) => {
    setSelectedSlotBlockedServiceIds((current) => {
      if (current.includes(serviceId)) {
        return current.filter((candidate) => candidate !== serviceId);
      }
      return [...current, serviceId];
    });
  };

  const handleAddTimeBlock = (providerId: string, providerName: string, pending?: PendingTimeBlock) => {
    if (calendarState.kind !== "ready") {
      return;
    }
    const targetDate = pending?.date ?? focusedDate;
    const targetDay = calendarState.days.find((day) => day.date === targetDate);
    if (!targetDay) {
      return;
    }

    const providerOpening = targetDay.openings.find((opening) => opening.providerId === providerId);
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
      const fallback = new Date(`${targetDay.date}T10:00:00-07:00`);
      startAt = fallback.toISOString();
      endAt = new Date(fallback.getTime() + defaultDurationMinutes * 60_000).toISOString();
    }

    const id = `time-block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const block: CalendarTimeBlock = {
      id,
      date: targetDay.date,
      providerId,
      providerName,
      locationId,
      startAt,
      endAt,
      notes: pending?.notes ?? "",
      blockedServiceIds: pending?.blockedServiceIds ?? [],
    };

    setTimeBlocks((current) => [...current, block]);
    setSelectedTimeBlockId(id);
    setSelectedAppointmentId(null);
    setSelectedSlot(null);
    setDraftCreationState({ kind: "idle" });
  };

  const handleSelectTimeBlock = (blockId: string) => {
    setSelectedTimeBlockId(blockId);
    setSelectedAppointmentId(null);
    setSelectedSlot(null);
    setDraftCreationState({ kind: "idle" });
  };

  const handleAddTimeBlockFromSlot = () => {
    if (selectedSlot === null || selectedSlot.providerId === null || selectedSlot.providerName === null) {
      return;
    }

    handleAddTimeBlock(selectedSlot.providerId, selectedSlot.providerName, {
      date: selectedSlot.date,
      providerId: selectedSlot.providerId,
      providerName: selectedSlot.providerName,
      locationId: selectedSlot.locationId,
      startAt: selectedSlot.startAt,
      endAt: addMinutesToIsoUnclamped(selectedSlot.startAt, selectedSlotBlockDurationMinutes),
      notes: selectedSlotNotes,
      blockedServiceIds: selectedSlotBlockedServiceIds,
    });
  };

  const handleCreateDraftFromSlot = async () => {
    const customer = {
      name: selectedSlotCustomer.name.trim(),
      email: selectedSlotCustomer.email.trim(),
      phone: selectedSlotCustomer.phone.trim(),
    };
    if (selectedSlot === null || selectedSlot.providerId === null || selectedSlotServiceId === null || !customer.name || !customer.email || !customer.phone) {
      return;
    }

    setDraftCreationState({ kind: "submitting" });

    try {
      const draft = await api.createBookingDraft({
        tenantSlug,
        serviceId: selectedSlotServiceId,
        providerId: selectedSlot.providerId,
        locationId: selectedSlot.locationId,
        startsAt: selectedSlot.startAt,
        customer,
        bookingMethod: "staff_entered",
      });

      setDraftCreationState({ kind: "success", draftId: draft.id });
    } catch (error) {
      setDraftCreationState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to create a booking draft from this calendar slot.",
      });
    }
  };

  const handleUpdateTimeBlockBlockedServices = (blockId: string, serviceIds: string[]) => {
    setTimeBlocks((current) => current.map((block) => (block.id === blockId ? { ...block, blockedServiceIds: serviceIds } : block)));
  };

  const handleCloseTimeBlockDrawer = () => {
    setSelectedTimeBlockId(null);
  };

  const handleUpdateTimeBlockNotes = (blockId: string, notes: string) => {
    setTimeBlocks((current) => current.map((block) => (block.id === blockId ? { ...block, notes } : block)));
  };

  const handleDiscardTimeBlock = (blockId: string) => {
    setTimeBlocks((current) => current.filter((block) => block.id !== blockId));
    setSelectedTimeBlockId((current) => (current === blockId ? null : current));
    setDraftCreationState({ kind: "idle" });
  };

  const handleCreateDraftFromTimeBlock = async () => {
    if (selectedTimeBlock === null || calendarState.kind !== "ready") {
      return;
    }

    const serviceId = selectedService?.id ?? selectedTimeBlock.blockedServiceIds[0] ?? calendarState.services[0]?.id;
    if (!serviceId) {
      return;
    }

    setDraftCreationState({ kind: "submitting" });

    try {
      const draft = await api.createBookingDraft({
        tenantSlug,
        serviceId,
        providerId: selectedTimeBlock.providerId,
        locationId: selectedTimeBlock.locationId,
        startsAt: selectedTimeBlock.startAt,
        bookingMethod: "staff_entered",
      });

      setDraftCreationState({ kind: "success", draftId: draft.id });
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
                    <option value="">Any service</option>
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
              {viewMode === "week" && weekProviderOptions.length > 0 ? (
                <div className="provider-view-toggle" role="group" aria-label="Week provider view">
                  <button
                    type="button"
                    className={`provider-view-toggle__button${selectedWeekProviderId === null ? " provider-view-toggle__button--active" : ""}`}
                    onClick={() => handleSelectWeekProvider(null)}
                    aria-pressed={selectedWeekProviderId === null}
                  >
                    All providers
                  </button>
                  {weekProviderOptions.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      className={`provider-view-toggle__button${selectedWeekProviderId === provider.id ? " provider-view-toggle__button--active" : ""}`}
                      onClick={() => handleSelectWeekProvider(provider.id)}
                      aria-pressed={selectedWeekProviderId === provider.id}
                    >
                      {provider.name}
                    </button>
                  ))}
                </div>
              ) : null}
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
            selectedWeekProviderId={selectedWeekProviderId}
            selectedWeekProviderName={selectedWeekProvider?.name ?? null}
            fallbackProviderOptions={weekProviderOptions}
            timeBlockDurationMinutes={selectedService?.durationMinutes ?? 60}
            onSelectAppointment={handleSelectAppointment}
            timeBlocks={timeBlocks}
            selectedTimeBlockId={selectedTimeBlockId}
            onSelectTimeBlock={handleSelectTimeBlock}
            onRequestCalendarSlot={handleRequestCalendarSlot}
          />
        </article>
      </section>
      {sidebarRailHost ? null : <div className="calendar-fallback-month-rail">{monthRail}</div>}
      <SlotActionDrawer
        selectedSlot={selectedSlot}
        serviceOptions={selectedSlotServiceOptions}
        selectedServiceId={selectedSlotServiceId}
        blockedServiceIds={selectedSlotBlockedServiceIds}
        notes={selectedSlotNotes}
        draftCreationState={draftCreationState}
        draftHref={draftHref}
        onClose={() => setSelectedSlot(null)}
        onSelectProvider={handleSelectSlotProvider}
        onSelectService={handleSelectSlotService}
        onStartDateChange={handleUpdateSlotStartDate}
        onStartTimeChange={handleUpdateSlotStartTime}
        onBlockDurationChange={handleUpdateSlotBlockDuration}
        onBlockEndChange={handleUpdateSlotBlockEnd}
        onToggleBlockedService={handleToggleSlotBlockedService}
        customer={selectedSlotCustomer}
        customerLookupState={customerLookupState}
        blockDurationMinutes={selectedSlotBlockDurationMinutes}
        onCustomerFieldChange={handleUpdateSlotCustomerField}
        onApplyCustomer={handleApplySlotCustomer}
        onNotesChange={setSelectedSlotNotes}
        onBookAppointment={() => void handleCreateDraftFromSlot()}
        onAddTimeBlock={handleAddTimeBlockFromSlot}
      />
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
      <TimeBlockDetailsDrawer
        selectedTimeBlock={selectedTimeBlock}
        selectedService={selectedService}
        serviceOptions={selectedTimeBlockServiceOptions}
        blockedAppointments={selectedTimeBlockAppointments}
        draftCreationState={draftCreationState}
        draftHref={draftHref}
        onClose={handleCloseTimeBlockDrawer}
        onCreateDraft={() => void handleCreateDraftFromTimeBlock()}
        onDelete={() => {
          if (selectedTimeBlock) {
            handleDiscardTimeBlock(selectedTimeBlock.id);
          }
        }}
        onNotesChange={(notes) => {
          if (selectedTimeBlock) {
            handleUpdateTimeBlockNotes(selectedTimeBlock.id, notes);
          }
        }}
        onBlockedServicesChange={(serviceIds) => {
          if (selectedTimeBlock) {
            handleUpdateTimeBlockBlockedServices(selectedTimeBlock.id, serviceIds);
          }
        }}
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
  selectedWeekProviderId,
  selectedWeekProviderName,
  fallbackProviderOptions,
  timeBlockDurationMinutes,
  onSelectAppointment,
  timeBlocks,
  selectedTimeBlockId,
  onSelectTimeBlock,
  onRequestCalendarSlot,
}: {
  state: CalendarDataState;
  days: CalendarDay[];
  viewMode: CalendarViewMode;
  selectedAppointmentId: string | null;
  intakeStatusByBookingId: Record<string, IntakeStatus>;
  selectedWeekProviderId: string | null;
  selectedWeekProviderName: string | null;
  fallbackProviderOptions: CalendarProviderOption[];
  timeBlockDurationMinutes: number;
  onSelectAppointment: (appointmentId: string) => void;
  timeBlocks: CalendarTimeBlock[];
  selectedTimeBlockId: string | null;
  onSelectTimeBlock: (blockId: string) => void;
  onRequestCalendarSlot: (slot: PendingCalendarSlot) => void;
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
              emptyLabel: "",
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
                  emptyLabel: "",
                },
              ];
        })()
      : days.map((day) => {
          const appointments = selectedWeekProviderId === null
            ? day.appointments
            : day.appointments.filter((appointment) => appointment.providerId === selectedWeekProviderId);
          const openings = selectedWeekProviderId === null
            ? day.openings
            : day.openings.filter((opening) => opening.providerId === selectedWeekProviderId);
          const providerName = selectedWeekProviderId === null ? undefined : (selectedWeekProviderName ?? undefined);

          return {
            key: day.date,
            date: day.date,
            heading: getWeekHeading(day.date),
            subheading: getDayNumberLabel(day.date),
            providerId: selectedWeekProviderId ?? undefined,
            providerName,
            appointments,
            openings,
            availableSegments: mergeMinuteSegments(openings),
            emptyLabel: "",
          };
        });

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
            const columnProviderOptions = getProviderOptionsFromSchedule(column.appointments, column.openings);
            const slotProviderOptions = columnProviderOptions.length > 0 ? columnProviderOptions : fallbackProviderOptions;
            const isInteractiveTrack = (column.providerId !== undefined && column.providerName !== undefined) || slotProviderOptions.length > 0;
            const trackLabel = isInteractiveTrack
              ? viewMode === "day"
                ? `${column.providerName} schedule track`
                : column.providerName
                  ? `${column.providerName} ${column.heading} schedule track`
                  : `${column.heading} schedule track`
              : `${column.heading} schedule track`;

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
              const providerId = column.providerId ?? slotProviderOptions[0]?.id ?? null;
              const providerName = column.providerName ?? slotProviderOptions[0]?.name ?? null;
              const providerOpening = providerId ? column.openings.find((opening) => opening.providerId === providerId) : column.openings[0];

              onRequestCalendarSlot({
                date: column.date,
                providerId,
                providerName,
                locationId: providerOpening?.locationId,
                startAt: toTenantDateTimeIso(column.date, startMinute),
                endAt: toTenantDateTimeIso(column.date, endMinute),
                openings: column.openings,
                providerOptions: slotProviderOptions,
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
                aria-label={trackLabel}
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
                {column.appointments.length === 0 && column.emptyLabel ? (
                  <span className="schedule-day-track__empty">{column.emptyLabel}</span>
                ) : null}
                {(column.providerId !== undefined || viewMode === "week")
                  ? timeBlocks
                      .filter((block) => block.date === column.date && (column.providerId === undefined || block.providerId === column.providerId))
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

type SlotActionDrawerProps = {
  selectedSlot: PendingCalendarSlot | null;
  serviceOptions: CalendarServiceOption[];
  selectedServiceId: string | null;
  blockedServiceIds: string[];
  customer: SlotCustomerForm;
  customerLookupState: CustomerLookupState;
  blockDurationMinutes: number;
  notes: string;
  draftCreationState: DraftCreationState;
  draftHref: string | null;
  onClose: () => void;
  onSelectProvider: (providerId: string) => void;
  onSelectService: (serviceId: string) => void;
  onStartDateChange: (dateValue: string) => void;
  onStartTimeChange: (timeValue: string) => void;
  onBlockDurationChange: (durationMinutes: number) => void;
  onBlockEndChange: (dateValue: string, timeValue: string) => void;
  onToggleBlockedService: (serviceId: string) => void;
  onCustomerFieldChange: (field: keyof SlotCustomerForm, value: string) => void;
  onApplyCustomer: (customer: CustomerSummary) => void;
  onNotesChange: (notes: string) => void;
  onBookAppointment: () => void;
  onAddTimeBlock: () => void;
};

function SlotActionDrawer({
  selectedSlot,
  serviceOptions,
  selectedServiceId,
  blockedServiceIds,
  customer,
  customerLookupState,
  blockDurationMinutes,
  notes,
  draftCreationState,
  draftHref,
  onClose,
  onSelectProvider,
  onSelectService,
  onStartDateChange,
  onStartTimeChange,
  onBlockDurationChange,
  onBlockEndChange,
  onToggleBlockedService,
  onCustomerFieldChange,
  onApplyCustomer,
  onNotesChange,
  onBookAppointment,
  onAddTimeBlock,
}: SlotActionDrawerProps): ReactElement | null {
  const slotKey = selectedSlot
    ? `${selectedSlot.date}|${selectedSlot.providerId ?? ""}|${selectedSlot.startAt}`
    : null;
  const [mode, setMode] = useState<"appointment" | "time-block">("appointment");
  useEffect(() => {
    setMode("appointment");
  }, [slotKey]);

  if (selectedSlot === null) {
    return null;
  }

  const isAppointmentMode = mode === "appointment";
  const hasProvider = selectedSlot.providerId !== null;
  const selectedService = serviceOptions.find((service) => service.id === selectedServiceId) ?? null;
  const appointmentEndAt = selectedService ? addMinutesToTenantIso(selectedSlot.startAt, selectedService.durationMinutes) : selectedSlot.endAt;
  const blockEndAt = addMinutesToTenantIso(selectedSlot.startAt, blockDurationMinutes);
  const hasRequiredCustomer = Boolean(customer.name.trim() && customer.email.trim() && customer.phone.trim());
  const canCreateDraft = hasProvider && selectedServiceId !== null && hasRequiredCustomer && draftCreationState.kind !== "submitting";
  const canAddTimeBlock = hasProvider && blockedServiceIds.length > 0;
  const headingTimeRange = isAppointmentMode ? formatTimeRange(selectedSlot.startAt, appointmentEndAt) : formatTimeRange(selectedSlot.startAt, blockEndAt);

  return (
    <>
      <button type="button" className="appointment-drawer-backdrop" aria-label="Close calendar slot actions" onClick={onClose} />
      <aside className="appointment-details-drawer slot-action-drawer" role="dialog" aria-label="Calendar slot actions">
        <header className="appointment-details-drawer__header">
          <span className="appointment-status-chip">
            <span aria-hidden="true" />
            {isAppointmentMode ? "New appointment" : "New time block"}
          </span>
          <div className="slot-action-drawer__header-actions">
            <button
              type="button"
              className="appointment-drawer-outline-action"
              aria-pressed={!isAppointmentMode}
              onClick={() => setMode(isAppointmentMode ? "time-block" : "appointment")}
            >
              {isAppointmentMode ? "Create time block" : "Create appointment"}
            </button>
            <button type="button" className="appointment-drawer-outline-action" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <div className="appointment-drawer-when" aria-label="Calendar slot timing">
          <div>
            On <strong>{getDateLabel(selectedSlot.date)}</strong>
          </div>
          <div>
            At <strong>{headingTimeRange}</strong>
          </div>
        </div>

        <section className="booking-rail-section" aria-label="Slot setup">
          <p className="rail-section-kicker">Setup</p>
          <div className="slot-action-grid">
            <label>
              <span>Provider</span>
              {selectedSlot.providerOptions.length > 1 ? (
                <select value={selectedSlot.providerId ?? ""} onChange={(event) => onSelectProvider(event.target.value)}>
                  {selectedSlot.providerOptions.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={selectedSlot.providerName ?? "No provider available"} readOnly />
              )}
            </label>
            {isAppointmentMode ? (
              <label>
                <span>Start time</span>
                <input type="time" value={formatTimeInputValue(selectedSlot.startAt)} onChange={(event) => onStartTimeChange(event.target.value)} />
              </label>
            ) : null}
            {isAppointmentMode ? (
              <>
                <label>
                  <span>Appointment type</span>
                  <select value={selectedServiceId ?? ""} onChange={(event) => onSelectService(event.target.value)} disabled={serviceOptions.length === 0}>
                    {serviceOptions.length === 0 ? <option value="">No appointment types available</option> : null}
                    {serviceOptions.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Appointment duration</span>
                  <input value={selectedService ? formatDuration(selectedService.durationMinutes) : "Choose appointment type"} readOnly />
                </label>
                <label>
                  <span>Client name</span>
                  <input value={customer.name} onChange={(event) => onCustomerFieldChange("name", event.target.value)} autoComplete="off" />
                </label>
                <label>
                  <span>Phone number</span>
                  <input value={customer.phone} onChange={(event) => onCustomerFieldChange("phone", event.target.value)} inputMode="tel" autoComplete="tel" />
                </label>
                <label>
                  <span>Email</span>
                  <input value={customer.email} onChange={(event) => onCustomerFieldChange("email", event.target.value)} inputMode="email" autoComplete="email" />
                </label>
              </>
            ) : null}
          </div>
          {isAppointmentMode && customerLookupState.kind === "loading" ? <div className="slot-customer-lookup-note" role="status">Searching clients...</div> : null}
          {isAppointmentMode && customerLookupState.kind === "ready" && customerLookupState.items.length > 0 ? (
            <div className="slot-customer-results" aria-label="Matching clients">
              {customerLookupState.items.map((lookupCustomer) => (
                <button key={lookupCustomer.id} type="button" onClick={() => onApplyCustomer(lookupCustomer)}>
                  <strong>{lookupCustomer.name}</strong>
                  <span>{lookupCustomer.email ?? lookupCustomer.phone ?? "Client record"}</span>
                </button>
              ))}
            </div>
          ) : null}
          {isAppointmentMode && customerLookupState.kind === "error" ? (
            <div className="message-banner message-banner--error" role="alert">
              {customerLookupState.message}
            </div>
          ) : null}
        </section>

        {isAppointmentMode ? (
          <section className="booking-rail-section" aria-label="Book appointment from slot">
            <p className="rail-section-kicker">Book appointment</p>
            <div className="appointment-summary-card">
              <div>
                <strong>{selectedService?.name ?? "Choose an appointment type"}</strong>
                <span>{formatTimeRange(selectedSlot.startAt, appointmentEndAt)}</span>
              </div>
              <p>{customer.name || "Client required"}</p>
            </div>
            {draftCreationState.kind === "error" ? (
              <div className="message-banner message-banner--error" role="alert">
                {draftCreationState.message}
              </div>
            ) : null}
            {draftCreationState.kind === "success" ? (
              <div className="message-banner" role="status">
                Booking draft created and slot held for 15 minutes.
              </div>
            ) : null}
            <div className="time-block-drawer-actions">
              <button type="button" className="primary-action" onClick={onBookAppointment} disabled={!canCreateDraft || draftCreationState.kind === "success"}>
                {draftCreationState.kind === "submitting" ? "Creating draft..." : draftCreationState.kind === "success" ? "Draft created" : "Book appointment"}
              </button>
              {draftHref ? (
                <a className="secondary-action" href={draftHref}>
                  Open draft in storefront
                </a>
              ) : null}
            </div>
          </section>
        ) : (
          <section className="booking-rail-section" aria-label="Add time block from slot">
            <p className="rail-section-kicker">Add time block</p>
            <div className="slot-action-grid">
              <label>
                <span>Start date</span>
                <input
                  type="date"
                  value={getTenantDate(selectedSlot.startAt)}
                  onChange={(event) => onStartDateChange(event.target.value)}
                />
              </label>
              <label>
                <span>Start time</span>
                <input
                  type="time"
                  value={formatTimeInputValue(selectedSlot.startAt)}
                  onChange={(event) => onStartTimeChange(event.target.value)}
                />
              </label>
              <label>
                <span>End date</span>
                <input
                  type="date"
                  value={getTenantDate(blockEndAt)}
                  onChange={(event) => onBlockEndChange(event.target.value, formatTimeInputValue(blockEndAt))}
                />
              </label>
              <label>
                <span>End time</span>
                <input
                  type="time"
                  value={formatTimeInputValue(blockEndAt)}
                  onChange={(event) => onBlockEndChange(getTenantDate(blockEndAt), event.target.value)}
                />
              </label>
            </div>
            <label className="time-block-notes-field">
              <span>Notes</span>
              <textarea value={notes} onChange={(event) => onNotesChange(event.target.value)} placeholder="Add staff-facing context for this block." rows={4} />
            </label>
            <div className="time-block-service-options" aria-label="Appointment types to block">
              <span>Appointment types to block</span>
              {serviceOptions.map((service) => (
                <label key={service.id}>
                  <input
                    type="checkbox"
                    checked={blockedServiceIds.includes(service.id)}
                    onChange={() => onToggleBlockedService(service.id)}
                  />
                  {service.name}
                </label>
              ))}
            </div>
            <button type="button" className="primary-action" onClick={onAddTimeBlock} disabled={!canAddTimeBlock}>
              Add time block
            </button>
          </section>
        )}
      </aside>
    </>
  );
}

type TimeBlockDetailsDrawerProps = {
  selectedTimeBlock: CalendarTimeBlock | null;
  selectedService: ServiceSummary | null;
  serviceOptions: CalendarServiceOption[];
  blockedAppointments: CalendarAppointment[];
  draftCreationState: DraftCreationState;
  draftHref: string | null;
  onClose: () => void;
  onCreateDraft: () => void;
  onDelete: () => void;
  onNotesChange: (notes: string) => void;
  onBlockedServicesChange: (serviceIds: string[]) => void;
};

function TimeBlockDetailsDrawer({
  selectedTimeBlock,
  selectedService,
  serviceOptions,
  blockedAppointments,
  draftCreationState,
  draftHref,
  onClose,
  onCreateDraft,
  onDelete,
  onNotesChange,
  onBlockedServicesChange,
}: TimeBlockDetailsDrawerProps): ReactElement | null {
  if (!selectedTimeBlock) {
    return null;
  }

  const durationMinutes = getDurationMinutes(selectedTimeBlock.startAt, selectedTimeBlock.endAt);
  const durationLabel = formatDuration(durationMinutes);
  const dayLabel = getDateLabel(selectedTimeBlock.date);
  const draftCreated = draftCreationState.kind === "success";
  const canCreateDraft = (selectedService !== null || selectedTimeBlock.blockedServiceIds.length > 0) && draftCreationState.kind !== "submitting" && !draftCreated;
  const blockedServiceNames = selectedTimeBlock.blockedServiceIds
    .map((serviceId) => serviceOptions.find((service) => service.id === serviceId)?.name)
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <button
        type="button"
        className="appointment-drawer-backdrop"
        aria-label="Close time block details"
        onClick={onClose}
      />
      <aside className="appointment-details-drawer time-block-details-drawer" role="dialog" aria-label="Time block details">
        <header className="appointment-details-drawer__header">
          <span className="appointment-status-chip appointment-status-chip--block">
            <span aria-hidden="true" />
            Time block
          </span>
          <button type="button" className="appointment-drawer-outline-action" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="appointment-drawer-when" aria-label="Time block timing">
          <div>
            On <strong>{dayLabel}</strong>
          </div>
          <div>
            At <strong>{formatTimeRange(selectedTimeBlock.startAt, selectedTimeBlock.endAt)}</strong>
          </div>
        </div>

        <section className="booking-rail-section" aria-label="Time block summary">
          <p className="rail-section-kicker">Block details</p>
          <div className="appointment-summary-card time-block-summary-card">
            <div>
              <strong>{blockedServiceNames || selectedService?.name || "Selected service"}</strong>
              <span>{durationLabel}</span>
            </div>
            <p>{`${selectedTimeBlock.providerName} · ${formatDateTime(selectedTimeBlock.startAt)}`}</p>
          </div>
          <div className="drawer-form-preview drawer-form-preview--compact">
            <label>
              <span>Provider</span>
              <input value={selectedTimeBlock.providerName} readOnly />
            </label>
            <label>
              <span>Duration</span>
              <input value={durationLabel} readOnly />
            </label>
            <label>
              <span>Start</span>
              <input value={formatDateTime(selectedTimeBlock.startAt)} readOnly />
            </label>
            <label>
              <span>End</span>
              <input value={formatDateTime(selectedTimeBlock.endAt)} readOnly />
            </label>
          </div>
        </section>

        <section className="booking-rail-section" aria-label="Time block notes">
          <label className="time-block-notes-field">
            <span>Notes</span>
            <textarea
              value={selectedTimeBlock.notes}
              onChange={(event) => onNotesChange(event.target.value)}
              placeholder="Add staff-facing context for this block."
              rows={5}
            />
          </label>
        </section>

        <section className="booking-rail-section" aria-label="Appointment types blocked by this time block">
          <p className="rail-section-kicker">Appointment types blocked</p>
          <div className="time-block-service-options">
            {serviceOptions.map((service) => {
              const checked = selectedTimeBlock.blockedServiceIds.includes(service.id);
              return (
                <label key={service.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      onBlockedServicesChange(
                        checked
                          ? selectedTimeBlock.blockedServiceIds.filter((serviceId) => serviceId !== service.id)
                          : [...selectedTimeBlock.blockedServiceIds, service.id],
                      );
                    }}
                  />
                  {service.name}
                </label>
              );
            })}
          </div>
        </section>

        <section className="booking-rail-section" aria-label="Appointments blocked by this time block">
          <div className="rail-section-heading">
            <div>
              <p className="eyebrow">Affected appointments</p>
              <h4>Appointments blocked</h4>
            </div>
            <span className="intake-status-badge">{blockedAppointments.length}</span>
          </div>
          {blockedAppointments.length === 0 ? (
            <div className="message-banner message-banner--muted" role="status">
              No booked appointments fall inside this block.
            </div>
          ) : (
            <ul className="time-block-appointment-list">
              {blockedAppointments.map((appointment) => (
                <li key={appointment.id}>
                  <strong>{appointment.customerName}</strong>
                  <span>{`${appointment.serviceName} · ${formatTimeRange(appointment.startAt, appointment.endAt)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {draftCreationState.kind === "error" ? (
          <div className="message-banner message-banner--error" role="alert">
            {draftCreationState.message}
          </div>
        ) : null}
        {draftCreated ? (
          <div className="message-banner" role="status">
            Booking draft created and slot held for 15 minutes.
          </div>
        ) : null}

        <div className="time-block-drawer-actions">
          <button type="button" className="time-block-delete-action" onClick={onDelete}>
            Delete time block
          </button>
          <button
            type="button"
            className="primary-action"
            onClick={onCreateDraft}
            disabled={!canCreateDraft}
          >
            {draftCreationState.kind === "submitting" ? "Creating draft..." : draftCreated ? "Draft created" : "Create draft from time block"}
          </button>
          {draftHref ? (
            <a className="secondary-action" href={draftHref}>
              Open draft in storefront
            </a>
          ) : null}
        </div>
      </aside>
    </>
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
}: AppointmentDetailsDrawerProps): ReactElement | null {
  if (!selectedAppointment) {
    return null;
  }

  const selectedAppointmentClockLabel = timeFormatter.format(new Date(selectedAppointment.startAt));

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
          <span className="appointment-status-chip">
            <span aria-hidden="true" />
            {selectedStatusLabel}
          </span>
          <button type="button" className="appointment-drawer-outline-action" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="appointment-drawer-when" aria-label="Appointment timing">
          <div>
            On <strong>{selectedAppointment.dayLabel}</strong>
          </div>
          <div>
            At <strong>{selectedAppointmentClockLabel}</strong>
          </div>
        </div>

        <section className="booking-rail-section booking-rail-section--customer" aria-label="Customer summary">
          <p className="rail-section-kicker">Customer</p>
          <div className="appointment-customer-card">
            <span className="appointment-customer-avatar" aria-hidden="true">{getInitials(selectedAppointment.customerName)}</span>
            <div>
              <strong>{selectedAppointment.customerName}</strong>
              <span>Client profile</span>
            </div>
          </div>
          <div className="drawer-form-preview">
            <label>
              <span>Customer</span>
              <input value={selectedCustomerLabel} readOnly />
            </label>
            <label>
              <span>Provider</span>
              <input value={selectedProviderLabel} readOnly />
            </label>
          </div>
        </section>

        <section className="booking-rail-section" aria-label="Appointment details preview">
          <p className="rail-section-kicker">Appointment</p>
          <div className="appointment-summary-card">
            <div>
              <strong>{selectedServiceLabel}</strong>
              <span>{selectedPaymentLabel}</span>
            </div>
            <p>{`${selectedAppointmentTimeLabel} · ${selectedProviderLabel}`}</p>
          </div>
          <div className="drawer-form-preview drawer-form-preview--compact">
            <label>
              <span>Service</span>
              <input value={selectedServiceLabel} readOnly />
            </label>
            <label>
              <span>Scheduled time</span>
              <input value={selectedAppointmentTimeLabel} readOnly />
            </label>
            <label>
              <span>Booking status</span>
              <input value={selectedStatusLabel} readOnly />
            </label>
            <label>
              <span>Payment status</span>
              <input value={selectedPaymentLabel} readOnly />
            </label>
          </div>
        </section>

        <section className="booking-rail-section booking-rail-section--forms" aria-label="Submitted forms">
          <FormResponsesPanel
            selectedAppointment={selectedAppointment}
            state={formResponsesState}
            intakeStatus={intakeStatus}
          />
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

function FormResponsesPanel({ selectedAppointment, state, intakeStatus }: FormResponsesPanelProps): ReactElement {
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
