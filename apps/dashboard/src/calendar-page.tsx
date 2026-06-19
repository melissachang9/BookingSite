import { startTransition, useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import type {
  AvailabilityRequest,
  AvailabilityResponse,
  BookingDraftSummary,
  BookingFormRequirementEntry,
  BookingFormRequirementList,
  BookingFormResponseEntry,
  BookingFormResponseList,
  BookingListQuery,
  BookingListResponse,
  BookingPaymentSummary,
  BookingSummary,
  CreateBookingDraftRequest,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  CustomerLookupQuery,
  CustomerLookupResponse,
  CustomerSummary,
  CustomPaymentMethod,
  ProviderListResponse,
  RecordManualPaymentRequest,
  SendFormReminderResponse,
  ServiceListResponse,
  ServiceSummary,
  SlotAvailability,
  UpdateBookingRequest,
  UpdateBookingStatusRequest,
} from "@booking/shared-types";

import { FormResponseViewer } from "./form-response-viewer";
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
  customerId: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerNotes?: string | null;
  customerManageToken: string;
  serviceId: string;
  serviceName: string;
  serviceDescription?: string | null;
  status: BookingSummary["status"];
  paymentResolution: BookingSummary["paymentResolution"];
  priceCents: number;
  depositCents: number;
  amountPaidCents: number;
  balanceDueCents: number;
  walletBalanceCents: number;
  durationMinutes: number;
  notes?: string | null;
  payments: BookingPaymentSummary[];
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
  providerImageUrl?: string | null;
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

type CompletionState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

type FormResponsesState =
  | { kind: "idle" }
  | { kind: "loading"; bookingId: string }
  | {
      kind: "ready";
      bookingId: string;
      items: BookingFormResponseEntry[];
      requirements: BookingFormRequirementEntry[];
    }
  | { kind: "error"; bookingId: string; message: string };

type IntakeStatus = "unknown" | "loading" | "submitted" | "missing" | "partial" | "error";

type FormReminderState =
  | { kind: "idle" }
  | { kind: "sending"; bookingId: string }
  | { kind: "success"; bookingId: string; message: string }
  | { kind: "error"; bookingId: string; message: string };

type CustomerLookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; items: CustomerSummary[] }
  | { kind: "error"; message: string };

type CalendarProviderOption = {
  id: string;
  name: string;
  imageUrl?: string | null;
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
  listBookingFormRequirements: (tenantSlug: string, bookingId: string) => Promise<BookingFormRequirementList>;
  sendBookingFormReminder: (tenantSlug: string, bookingId: string) => Promise<SendFormReminderResponse>;
  updateBookingStatus: (tenantSlug: string, bookingId: string, body: UpdateBookingStatusRequest) => Promise<BookingSummary>;
  updateBooking: (tenantSlug: string, bookingId: string, body: UpdateBookingRequest) => Promise<BookingSummary>;
  cancelBooking: (tenantSlug: string, bookingId: string, body: { reason?: string }) => Promise<BookingSummary>;
  recordManualPayment: (tenantSlug: string, bookingId: string, body: RecordManualPaymentRequest) => Promise<BookingSummary>;
  applyWalletCredit: (tenantSlug: string, bookingId: string, body: { amountCents: number }) => Promise<BookingSummary>;
  refundBookingPayment: (
    tenantSlug: string,
    bookingId: string,
    paymentId: string,
    body?: { amountCents?: number; reason?: string },
  ) => Promise<BookingSummary>;
  createCheckoutSession: (body: CreateCheckoutSessionRequest) => Promise<CreateCheckoutSessionResponse>;
  updateCustomer: (
    tenantSlug: string,
    customerId: string,
    body: { notes?: string; name?: string; email?: string; phone?: string },
  ) => Promise<unknown>;
};

type CalendarPageProps = {
  definition: CalendarPageDefinition;
  tenantSlug: string;
  api?: CalendarPageApi;
  displayStartHour?: number;
  displayEndHour?: number;
  weekStartsOn?: number;
  storefrontBaseUrl?: string;
  customPaymentMethods?: CustomPaymentMethod[];
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

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatMoney(cents: number): string {
  return currencyFormatter.format(cents / 100);
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
      return "Intake complete";
    case "partial":
      return "Intake partial";
    case "missing":
      return "Intake pending";
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
    customerId: booking.customer.id,
    customerName: booking.customer.name,
    customerEmail: booking.customer.email ?? null,
    customerPhone: booking.customer.phone ?? null,
    customerNotes: booking.customer.notes ?? null,
    customerManageToken: booking.customerManageToken,
    serviceId: booking.serviceId,
    serviceName: booking.service.name,
    serviceDescription: booking.service.description ?? null,
    status: booking.status,
    paymentResolution: booking.paymentResolution,
    priceCents: booking.service.priceCents,
    depositCents: booking.service.depositCents,
    amountPaidCents: booking.amountPaidCents,
    balanceDueCents: booking.balanceDueCents,
    walletBalanceCents: booking.walletBalanceCents ?? 0,
    durationMinutes: booking.service.durationMinutes,
    notes: booking.notes ?? null,
    payments: booking.payments ?? [],
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
  const providers = new Map<string, CalendarProviderOption>();

  for (const group of providerGroups) {
    for (const provider of group) {
      const existing = providers.get(provider.id);
      providers.set(provider.id, {
        id: provider.id,
        name: provider.name,
        imageUrl: provider.imageUrl ?? existing?.imageUrl ?? null,
      });
    }
  }

  return Array.from(providers.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function getProviderOptionsFromProviderResponses(responses: PromiseSettledResult<ProviderListResponse>[]): CalendarProviderOption[] {
  const providers = responses.flatMap((response) =>
    response.status === "fulfilled"
      ? response.value.providers
          .filter((provider) => provider.isActive)
          .map((provider) => ({ id: provider.id, name: provider.name, imageUrl: provider.imageUrl ?? null }))
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

export function CalendarPage({
  definition,
  tenantSlug,
  api = platformApi,
  displayStartHour,
  displayEndHour,
  weekStartsOn,
  storefrontBaseUrl = "http://127.0.0.1:3001",
  customPaymentMethods = [],
}: CalendarPageProps) {
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
  const [completionState, setCompletionState] = useState<CompletionState>({ kind: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const [formResponsesState, setFormResponsesState] = useState<FormResponsesState>({ kind: "idle" });
  const [intakeStatusByBookingId, setIntakeStatusByBookingId] = useState<Record<string, IntakeStatus>>({});
  const [formReminderState, setFormReminderState] = useState<FormReminderState>({ kind: "idle" });

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
    setFormReminderState({ kind: "idle" });

    Promise.all([
      api.listBookingFormResponses(tenantSlug, bookingId),
      api.listBookingFormRequirements(tenantSlug, bookingId),
    ])
      .then(([responses, requirementsResp]) => {
        if (isCancelled) {
          return;
        }
        const requirements = requirementsResp.items;
        setFormResponsesState({
          kind: "ready",
          bookingId,
          items: responses.items,
          requirements,
        });
        const pendingCount = requirements.filter((req) => req.status === "pending").length;
        const satisfiedCount = requirements.filter((req) => req.status === "satisfied").length;
        const intakeStatus: IntakeStatus =
          requirements.length === 0
            ? responses.items.length > 0
              ? "submitted"
              : "missing"
            : pendingCount === 0
              ? "submitted"
              : satisfiedCount === 0
                ? "missing"
                : "partial";
        setIntakeStatusByBookingId((current) => ({
          ...current,
          [bookingId]: intakeStatus,
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
          message: error instanceof Error ? error.message : "Unable to load intake forms for this booking.",
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
        // Load 14 days before today through 42 days after (56-day window)
        const today = toIsoDate(new Date());
        const requestedDates: string[] = [];
        for (let i = -14; i < 42; i++) {
          requestedDates.push(addDays(today, i));
        }

        const [bookingsResult, servicesResult] = await Promise.allSettled([
          api.listBookings(tenantSlug, {
            status: ["confirmed", "completed", "canceled", "no_show"],
            startsAtGte: `${addDays(requestedDates[0], -1)}T00:00:00.000Z`,
            startsAtLte: `${addDays(requestedDates[requestedDates.length - 1], 1)}T23:59:59.999Z`,
            limit: 200,
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
            const todayDate = toIsoDate(new Date());
            const todayIndex = days.findIndex((d) => d.date === todayDate);
            const initialDate = todayIndex >= 0 ? days[todayIndex].date : days[0].date;
            setFocusedDate(initialDate);
            setMonthCursorDate(monthAnchor(initialDate));
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
  }, [api, tenantSlug, reloadKey]);

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

    // Only auto-reset if focusedDate is strictly in the future and not in the loaded window.
    // Today and past dates are valid — operators use them to view booking history.
    const today = toIsoDate(new Date());
    const hasFocusedDate = calendarState.days.some((day) => day.date === focusedDate);
    if (!hasFocusedDate && focusedDate > today) {
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

    const weekStartDay = weekStartsOn ?? 0;

    if (viewMode === "day") {
      // Find or create a single day entry
      const existing = calendarState.days.find((day) => day.date === focusedDate);
      if (existing) return [existing];
      return [{ date: focusedDate, label: getDateLabel(focusedDate), appointments: [], openings: [] }];
    }

    // Week view: compute the week containing focusedDate, anchored on weekStartsOn
    const focusDate = parseIsoDate(focusedDate);
    const dayOfWeek = focusDate.getUTCDay();
    const offset = (dayOfWeek - weekStartDay + 7) % 7;
    const weekStart = new Date(focusDate);
    weekStart.setUTCDate(focusDate.getUTCDate() - offset);

    const result: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setUTCDate(weekStart.getUTCDate() + i);
      const dateStr = toIsoDate(d);
      const existing = calendarState.days.find((day) => day.date === dateStr);
      result.push(existing ?? { date: dateStr, label: getDateLabel(dateStr), appointments: [], openings: [] });
    }
    return result;
  }, [calendarState, focusedDate, viewMode, weekStartsOn]);

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
  const allKnownProviderOptions = useMemo(
    () => (calendarState.kind === "ready" ? mergeProviderOptions(calendarState.providers, getProviderOptions(viewDays)) : []),
    [calendarState, viewDays],
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
    const focusDate = parseIsoDate(focusedDate);
    const offset = viewMode === "day" ? step : step * 7;
    focusDate.setUTCDate(focusDate.getUTCDate() + offset);
    setFocusedDate(toIsoDate(focusDate));
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

  const handleSaveTimeBlockEdits = (
    blockId: string,
    updates: { startAt: string; endAt: string; date: string; notes: string; blockedServiceIds: string[] },
  ) => {
    setTimeBlocks((current) =>
      current.map((block) => (block.id === blockId ? { ...block, ...updates } : block)),
    );
    setDraftCreationState({ kind: "idle" });
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

  const draftHref =
    draftCreationState.kind === "success"
      ? `${storefrontBaseUrl}/${tenantSlug}/book/${draftCreationState.draftId}`
      : null;

  const handleCompleteAppointment = async (appointment: SelectedCalendarAppointment, resolution: "collected" | "follow_up" | "waived" = "collected") => {
    setCompletionState({ kind: "submitting" });
    try {
      await api.updateBookingStatus(tenantSlug, appointment.id, {
        status: "completed",
        paymentResolution: resolution,
      });
      // Keep drawer open — CheckoutPanel will show completed-sale view
      setCompletionState({ kind: "idle" });
      setReloadKey((k) => k + 1);
    } catch (error) {
      setCompletionState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to mark booking as completed.",
      });
    }
  };

  const handleNoShowAppointment = async (appointment: SelectedCalendarAppointment) => {
    setCompletionState({ kind: "submitting" });
    try {
      await api.updateBookingStatus(tenantSlug, appointment.id, {
        status: "no_show",
        paymentResolution: "collected",
      });
      setSelectedAppointmentId(null);
      setCompletionState({ kind: "idle" });
      setReloadKey((k) => k + 1);
    } catch (error) {
      setCompletionState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to mark booking as no-show.",
      });
    }
  };

  const handleUpdateAppointment = async (appointment: SelectedCalendarAppointment, body: UpdateBookingRequest) => {
    await api.updateBooking(tenantSlug, appointment.id, body);
    setReloadKey((k) => k + 1);
  };

  const handleCancelAppointment = async (appointment: SelectedCalendarAppointment) => {
    setCompletionState({ kind: "submitting" });
    try {
      await api.cancelBooking(tenantSlug, appointment.id, {});
      setSelectedAppointmentId(null);
      setCompletionState({ kind: "idle" });
      setReloadKey((k) => k + 1);
    } catch (error) {
      setCompletionState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to cancel booking.",
      });
    }
  };

  const handleUpdateCustomerNotes = async (appointment: SelectedCalendarAppointment, notes: string) => {
    await api.updateCustomer(tenantSlug, appointment.customerId, { notes });
    // Update the appointment in local calendar state so the drawer
    // shows the new notes without closing.
    setCalendarState((current) => {
      if (current.kind !== "ready") return current;
      return {
        ...current,
        days: current.days.map((day) => ({
          ...day,
          appointments: day.appointments.map((a) =>
            a.id === appointment.id ? { ...a, customerNotes: notes } : a,
          ),
        })),
      };
    });
  };

  const handleUpdateCustomerContact = async (
    appointment: SelectedCalendarAppointment,
    contact: { name: string; email: string; phone: string },
  ) => {
    await api.updateCustomer(tenantSlug, appointment.customerId, contact);
    setCalendarState((current) => {
      if (current.kind !== "ready") return current;
      return {
        ...current,
        days: current.days.map((day) => ({
          ...day,
          appointments: day.appointments.map((a) =>
            a.customerId === appointment.customerId
              ? {
                  ...a,
                  customerName: contact.name,
                  customerEmail: contact.email,
                  customerPhone: contact.phone,
                }
              : a,
          ),
        })),
      };
    });
  };

  const handleSendFormReminder = (appointment: SelectedCalendarAppointment) => {
    const bookingId = appointment.id;
    setFormReminderState({ kind: "sending", bookingId });
    api
      .sendBookingFormReminder(tenantSlug, bookingId)
      .then((result) => {
        setFormReminderState({
          kind: "success",
          bookingId,
          message: `Reminder sent to ${result.recipientEmail} (${result.pendingRequirementCount} pending).`,
        });
      })
      .catch((error: unknown) => {
        setFormReminderState({
          kind: "error",
          bookingId,
          message: error instanceof Error ? error.message : "Unable to send reminder.",
        });
      });
  };
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
            <div
              className="calendar-header-actions"
              style={{ justifyContent: "flex-start", flexWrap: "nowrap", alignItems: "center" }}
            >
              <button
                type="button"
                className="filter-chip"
                onClick={() => {
                  setFocusedDate(toIsoDate(new Date()));
                  setViewMode("day");
                }}
                disabled={calendarState.kind !== "ready"}
              >
                Today
              </button>
              <button
                type="button"
                className="filter-chip"
                onClick={() => moveFocus(viewMode === "day" ? -1 : -7)}
                disabled={calendarState.kind !== "ready"}
                aria-label="Previous"
              >
                ‹
              </button>
              <button
                type="button"
                className="filter-chip"
                onClick={() => moveFocus(viewMode === "day" ? 1 : 7)}
                disabled={calendarState.kind !== "ready"}
                aria-label="Next"
              >
                ›
              </button>
              <div style={{ marginLeft: "0.5rem" }}>
                <h4 className="calendar-header-date">{visibleDateRangeLabel || "Weekly calendar"}</h4>
              </div>
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
                <label className="calendar-service-filter">
                  <span>Show provider</span>
                  <select
                    value={selectedWeekProviderId ?? ""}
                    onChange={(event) => handleSelectWeekProvider(event.target.value || null)}
                  >
                    <option value="">All providers</option>
                    {weekProviderOptions.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
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
            fallbackProviderOptions={allKnownProviderOptions}
            timeBlockDurationMinutes={selectedService?.durationMinutes ?? 60}
            onSelectAppointment={handleSelectAppointment}
            timeBlocks={timeBlocks}
            selectedTimeBlockId={selectedTimeBlockId}
            onSelectTimeBlock={handleSelectTimeBlock}
            onRequestCalendarSlot={handleRequestCalendarSlot}
            displayStartHour={displayStartHour}
            displayEndHour={displayEndHour}
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
        formReminderState={formReminderState}
        onSendFormReminder={handleSendFormReminder}
        services={calendarState.kind === "ready" ? calendarState.services : []}
        providers={calendarState.kind === "ready" ? calendarState.providers : []}
        onClose={handleCloseAppointmentDrawer}
        onComplete={handleCompleteAppointment}
        onNoShow={handleNoShowAppointment}
        onUpdate={handleUpdateAppointment}
        onCancel={handleCancelAppointment}
        onUpdateCustomerNotes={handleUpdateCustomerNotes}
        onUpdateCustomerContact={handleUpdateCustomerContact}
        completionState={completionState}
        api={api}
        tenantSlug={tenantSlug}
        storefrontBaseUrl={storefrontBaseUrl}
        customPaymentMethods={customPaymentMethods}
        onPaymentRecorded={() => setReloadKey((k) => k + 1)}
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
        onSave={(updates) => {
          if (selectedTimeBlock) {
            handleSaveTimeBlockEdits(selectedTimeBlock.id, updates);
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
              disabled={!isInCurrentMonth && !dayData && !dayData}
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
  displayStartHour,
  displayEndHour,
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
  displayStartHour?: number;
  displayEndHour?: number;
}) {
  if (state.kind === "loading") {
    return <div className="calendar-state">Loading booked appointments...</div>;
  }

  if (state.kind === "error" || state.kind === "empty") {
    return <div className="calendar-state calendar-state--muted">{state.message}</div>;
  }

  const clampHour = (value: number) => Math.min(24, Math.max(0, Math.round(value)));
  let startHour = clampHour(displayStartHour ?? 9);
  let endHour = clampHour(displayEndHour ?? 19);
  if (endHour <= startHour) {
    endHour = Math.min(24, startHour + SCHEDULE_MIN_VISIBLE_HOURS);
  }
  if (endHour - startHour < 1) {
    endHour = Math.min(24, startHour + 1);
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
              providerImageUrl?: string | null;
              appointments: CalendarAppointment[];
              openings: CalendarOpening[];
            }
          >();

          for (const provider of fallbackProviderOptions) {
            providerColumns.set(provider.id, {
              key: provider.id,
              heading: provider.name,
              providerId: provider.id,
              providerName: provider.name,
              providerImageUrl: provider.imageUrl ?? null,
              appointments: [],
              openings: [],
            });
          }

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
            .sort((left, right) => left.heading.localeCompare(right.heading))
            .map((column) => ({
              key: column.key,
              date: focusedDay.date,
              heading: column.heading,
              providerId: column.providerId,
              providerName: column.providerName,
              providerImageUrl: column.providerImageUrl ?? null,
              appointments: column.appointments,
              openings: column.openings,
              availableSegments: mergeMinuteSegments(column.openings),
              emptyLabel: column.appointments.length === 0 && column.openings.length === 0 ? "No scheduled hours" : "",
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
            {column.providerId ? (
              <div className="schedule-day-heading__avatar" aria-hidden="true">
                {column.providerImageUrl ? (
                  <img src={column.providerImageUrl} alt="" />
                ) : (
                  <span>{getInitials(column.providerName ?? column.heading)}</span>
                )}
              </div>
            ) : null}
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
            } else if (viewMode === "day" && column.openings.length === 0) {
              unavailableSegments.push({
                topPx: 0,
                heightPx: scheduleHeightPx,
              });
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
  onSave: (updates: { startAt: string; endAt: string; date: string; notes: string; blockedServiceIds: string[] }) => void;
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
  onSave,
}: TimeBlockDetailsDrawerProps): ReactElement | null {
  const blockId = selectedTimeBlock?.id ?? null;
  const initialStartDate = selectedTimeBlock ? getTenantDate(selectedTimeBlock.startAt) : "";
  const initialStartTime = selectedTimeBlock ? formatTimeInputValue(selectedTimeBlock.startAt) : "";
  const initialEndDate = selectedTimeBlock ? getTenantDate(selectedTimeBlock.endAt) : "";
  const initialEndTime = selectedTimeBlock ? formatTimeInputValue(selectedTimeBlock.endAt) : "";
  const initialNotes = selectedTimeBlock?.notes ?? "";
  const initialBlockedServiceIds = selectedTimeBlock?.blockedServiceIds ?? [];

  const [startDate, setStartDate] = useState(initialStartDate);
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [endTime, setEndTime] = useState(initialEndTime);
  const [notesDraft, setNotesDraft] = useState(initialNotes);
  const [blockedServiceIdsDraft, setBlockedServiceIdsDraft] = useState<string[]>(initialBlockedServiceIds);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    setStartDate(initialStartDate);
    setStartTime(initialStartTime);
    setEndDate(initialEndDate);
    setEndTime(initialEndTime);
    setNotesDraft(initialNotes);
    setBlockedServiceIdsDraft(initialBlockedServiceIds);
    setSaveState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId]);

  if (!selectedTimeBlock) {
    return null;
  }

  const startIso = isoFromTenantDateAndTime(startDate, startTime);
  const endIso = isoFromTenantDateAndTime(endDate, endTime);
  const startMs = startIso ? new Date(startIso).getTime() : NaN;
  const endMs = endIso ? new Date(endIso).getTime() : NaN;
  const hasValidRange = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  const draftDurationMinutes = hasValidRange ? Math.max(15, Math.round((endMs - startMs) / 60_000)) : getDurationMinutes(selectedTimeBlock.startAt, selectedTimeBlock.endAt);
  const durationLabel = formatDuration(draftDurationMinutes);
  const dayLabel = getDateLabel(startDate || selectedTimeBlock.date);
  const draftCreated = draftCreationState.kind === "success";
  const canCreateDraft = (selectedService !== null || selectedTimeBlock.blockedServiceIds.length > 0) && draftCreationState.kind !== "submitting" && !draftCreated;
  const blockedServiceNames = blockedServiceIdsDraft
    .map((serviceId) => serviceOptions.find((service) => service.id === serviceId)?.name)
    .filter(Boolean)
    .join(", ");
  const hasUnsavedChanges =
    startDate !== initialStartDate ||
    startTime !== initialStartTime ||
    endDate !== initialEndDate ||
    endTime !== initialEndTime ||
    notesDraft !== initialNotes ||
    blockedServiceIdsDraft.length !== initialBlockedServiceIds.length ||
    blockedServiceIdsDraft.some((id, i) => id !== initialBlockedServiceIds[i]);

  const handleToggleBlockedService = (serviceId: string) => {
    setBlockedServiceIdsDraft((current) =>
      current.includes(serviceId) ? current.filter((id) => id !== serviceId) : [...current, serviceId],
    );
    setSaveState("idle");
  };

  const handleSave = () => {
    if (!hasValidRange || !startIso || !endIso) {
      setSaveState("error");
      return;
    }
    onSave({
      startAt: startIso,
      endAt: endIso,
      date: startDate,
      notes: notesDraft,
      blockedServiceIds: blockedServiceIdsDraft,
    });
    setSaveState("saved");
  };

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
            At <strong>{hasValidRange && startIso && endIso ? formatTimeRange(startIso, endIso) : formatTimeRange(selectedTimeBlock.startAt, selectedTimeBlock.endAt)}</strong>
          </div>
        </div>

        <section className="booking-rail-section" aria-label="Time block summary">
          <p className="rail-section-kicker">Block details</p>
          <div className="appointment-summary-card time-block-summary-card">
            <div>
              <strong>{blockedServiceNames || selectedService?.name || "Selected service"}</strong>
              <span>{durationLabel}</span>
            </div>
            <p>{`${selectedTimeBlock.providerName} · ${formatDateTime(startIso ?? selectedTimeBlock.startAt)}`}</p>
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
              <span>Start date</span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  setSaveState("idle");
                }}
              />
            </label>
            <label>
              <span>Start time</span>
              <input
                type="time"
                value={startTime}
                onChange={(event) => {
                  setStartTime(event.target.value);
                  setSaveState("idle");
                }}
              />
            </label>
            <label>
              <span>End date</span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => {
                  setEndDate(event.target.value);
                  setSaveState("idle");
                }}
              />
            </label>
            <label>
              <span>End time</span>
              <input
                type="time"
                value={endTime}
                onChange={(event) => {
                  setEndTime(event.target.value);
                  setSaveState("idle");
                }}
              />
            </label>
          </div>
        </section>

        <section className="booking-rail-section" aria-label="Time block notes">
          <label className="time-block-notes-field">
            <span>Notes</span>
            <textarea
              value={notesDraft}
              onChange={(event) => {
                setNotesDraft(event.target.value);
                setSaveState("idle");
              }}
              placeholder="Add staff-facing context for this block."
              rows={5}
            />
          </label>
        </section>

        <section className="booking-rail-section" aria-label="Appointment types blocked by this time block">
          <p className="rail-section-kicker">Appointment types blocked</p>
          <div className="time-block-service-options">
            {serviceOptions.map((service) => {
              const checked = blockedServiceIdsDraft.includes(service.id);
              return (
                <label key={service.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => handleToggleBlockedService(service.id)}
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

        {saveState === "error" ? (
          <div className="message-banner message-banner--error" role="alert">
            End time must be after start time.
          </div>
        ) : null}
        {saveState === "saved" && !hasUnsavedChanges ? (
          <div className="message-banner" role="status">
            Time block updated.
          </div>
        ) : null}
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
            onClick={handleSave}
            disabled={!hasUnsavedChanges || !hasValidRange}
          >
            {hasUnsavedChanges ? "Save changes" : "Saved"}
          </button>
          <button
            type="button"
            className="secondary-action"
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
  formReminderState: FormReminderState;
  onSendFormReminder?: (appointment: SelectedCalendarAppointment) => void;
  services: ServiceSummary[];
  providers: CalendarProviderOption[];
  onClose: () => void;
  onComplete: (appointment: SelectedCalendarAppointment, resolution?: "collected" | "follow_up" | "waived") => Promise<void>;
  onNoShow: (appointment: SelectedCalendarAppointment) => Promise<void>;
  onUpdate?: (appointment: SelectedCalendarAppointment, body: UpdateBookingRequest) => Promise<void>;
  onCancel?: (appointment: SelectedCalendarAppointment) => Promise<void>;
  onUpdateCustomerNotes?: (appointment: SelectedCalendarAppointment, notes: string) => Promise<void>;
  onUpdateCustomerContact?: (
    appointment: SelectedCalendarAppointment,
    contact: { name: string; email: string; phone: string },
  ) => Promise<void>;
  completionState?: CompletionState;
  api?: CalendarPageApi;
  tenantSlug: string;
  storefrontBaseUrl: string;
  customPaymentMethods: CustomPaymentMethod[];
  onPaymentRecorded?: () => void;
};

function AppointmentDetailsDrawer({
  selectedAppointment,
  formResponsesState,
  intakeStatus,
  formReminderState,
  onSendFormReminder,
  services,
  providers,
  onClose,
  onComplete,
  onNoShow,
  onUpdate,
  onCancel,
  onUpdateCustomerNotes,
  onUpdateCustomerContact,
  completionState,
  api,
  tenantSlug,
  storefrontBaseUrl,
  customPaymentMethods,
  onPaymentRecorded,
}: AppointmentDetailsDrawerProps): ReactElement | null {
  const [viewingFormEntry, setViewingFormEntry] = useState<BookingFormResponseEntry | null>(null);
  const [drawerView, setDrawerView] = useState<"details" | "checkout">("details");
  const [isEditing, setIsEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editServiceId, setEditServiceId] = useState("");
  const [editProviderId, setEditProviderId] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSaveState, setEditSaveState] = useState<"idle" | "submitting" | "error">("idle");
  const [editErrorMessage, setEditErrorMessage] = useState("");
  const [notificationChoice, setNotificationChoice] = useState<"notify" | "silent">("notify");
  const [isEditingAppointmentNotes, setIsEditingAppointmentNotes] = useState(false);
  const [appointmentNotesDraft, setAppointmentNotesDraft] = useState("");
  const [appointmentNotesSaveState, setAppointmentNotesSaveState] = useState<"idle" | "submitting" | "error">("idle");
  const [appointmentNotesError, setAppointmentNotesError] = useState("");
  const [isEditingCustomerNotes, setIsEditingCustomerNotes] = useState(false);
  const [customerNotesDraft, setCustomerNotesDraft] = useState("");
  const [customerNotesSaveState, setCustomerNotesSaveState] = useState<"idle" | "submitting" | "error">("idle");
  const [customerNotesError, setCustomerNotesError] = useState("");
  const [isEditingCustomerContact, setIsEditingCustomerContact] = useState(false);
  const [customerContactDraft, setCustomerContactDraft] = useState({ name: "", email: "", phone: "" });
  const [customerContactSaveState, setCustomerContactSaveState] = useState<"idle" | "submitting" | "error">("idle");
  const [customerContactError, setCustomerContactError] = useState("");

  // Reset drawer view when switching appointments
  useEffect(() => {
    setDrawerView("details");
  }, [selectedAppointment?.id]);

  if (!selectedAppointment) {
    return null;
  }

  const selectedAppointmentClockLabel = timeFormatter.format(new Date(selectedAppointment.startAt));
  const statusLabel = getBookingStatusLabel(selectedAppointment.status);
  const isConfirmed = selectedAppointment.status === "confirmed";
  const isCompleted = selectedAppointment.status === "completed";
  const showFooter = isConfirmed || isCompleted;

  if (drawerView === "checkout" && api) {
    return (
      <>
        <button
          type="button"
          className="appointment-drawer-backdrop"
          aria-label="Close appointment details"
          onClick={onClose}
        />
        <CheckoutPanel
          appointment={selectedAppointment}
          api={api}
          tenantSlug={tenantSlug}
          customPaymentMethods={customPaymentMethods}
          onBack={() => {
            onPaymentRecorded?.();
            setDrawerView("details");
          }}
          onClose={onClose}
          onPaymentRecorded={onPaymentRecorded ?? (() => {})}
          onComplete={onComplete}
        />
      </>
    );
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
          <span className="appointment-status-chip">
            <span aria-hidden="true" />
            {statusLabel}
          </span>
          <div className="slot-action-drawer__header-actions">
            {isConfirmed ? (
              <button type="button" className="appointment-drawer-outline-action">
                Check in
              </button>
            ) : null}
            <button type="button" className="appointment-drawer-outline-action" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        {isEditing ? (
          <div className="appointment-drawer-when" aria-label="Edit appointment">
            <label className="appointment-drawer-when__field">
              <span>On</span>
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                disabled={editSaveState === "submitting"}
              />
            </label>
            <label className="appointment-drawer-when__field">
              <span>At</span>
              <input
                type="time"
                value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                disabled={editSaveState === "submitting"}
              />
            </label>
            <label className="appointment-drawer-when__field">
              <span>Service</span>
              <select
                value={editServiceId}
                onChange={(e) => setEditServiceId(e.target.value)}
                disabled={editSaveState === "submitting"}
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.durationMinutes} min · {formatMoney(s.priceCents)})
                  </option>
                ))}
              </select>
            </label>
            <label className="appointment-drawer-when__field">
              <span>Provider</span>
              <select
                value={editProviderId}
                onChange={(e) => setEditProviderId(e.target.value)}
                disabled={editSaveState === "submitting"}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="appointment-drawer-when__field">
              <span>Notification</span>
              <select
                value={notificationChoice}
                onChange={(e) => setNotificationChoice(e.target.value as "notify" | "silent")}
                disabled={editSaveState === "submitting"}
              >
                <option value="notify">Notify customer</option>
                <option value="silent">Save without notifying</option>
              </select>
            </label>
            <div className="appointment-drawer-when__actions">
              <button
                type="button"
                className="text-action"
                onClick={() => setIsEditing(false)}
                disabled={editSaveState === "submitting"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={editSaveState === "submitting"}
                onClick={async () => {
                  if (!onUpdate) return;
                  setEditSaveState("submitting");
                  setEditErrorMessage("");
                  try {
                    const newStartsAt = new Date(`${editDate}T${editTime}:00`).toISOString();
                    await onUpdate(selectedAppointment, {
                      startsAt: newStartsAt,
                      serviceId: editServiceId !== selectedAppointment.serviceId ? editServiceId : undefined,
                      providerId: editProviderId !== selectedAppointment.providerId ? editProviderId : undefined,
                      notes: editNotes || undefined,
                      sendConfirmation: notificationChoice === "notify",
                    });
                    setIsEditing(false);
                    setEditSaveState("idle");
                  } catch (err) {
                    setEditSaveState("error");
                    setEditErrorMessage(err instanceof Error ? err.message : "Unable to save changes.");
                  }
                }}
              >
                {editSaveState === "submitting" ? "Saving..." : "Save"}
              </button>
            </div>
            {editSaveState === "error" ? (
              <p role="alert" className="settings-error">{editErrorMessage}</p>
            ) : null}
          </div>
        ) : (
          <div className="appointment-drawer-when" aria-label="Appointment timing">
            <div>
              On <strong>{selectedAppointment.dayLabel}</strong>
            </div>
            <div>
              At <strong>{selectedAppointmentClockLabel}</strong>
            </div>
            {isConfirmed ? (
              <div className="appointment-drawer-when__actions">
                <button
                  type="button"
                  className="text-action"
                  onClick={() => {
                    const d = new Date(selectedAppointment.startAt);
                    setEditDate(d.toISOString().slice(0, 10));
                    setEditTime(d.toTimeString().slice(0, 5));
                    setEditServiceId(selectedAppointment.serviceId);
                    setEditProviderId(selectedAppointment.providerId);
                    setEditNotes(selectedAppointment.notes ?? "");
                    setNotificationChoice("notify");
                    setEditSaveState("idle");
                    setIsEditing(true);
                  }}
                >
                  Reschedule
                </button>
              </div>
            ) : null}
          </div>
        )}

        <section className="booking-rail-section booking-rail-section--customer" aria-label="Customer details">
          <p className="rail-section-kicker">Customer</p>
          {isEditingCustomerContact ? (
            <div className="customer-notes-editor">
              <label style={{ display: "block", marginBottom: "0.5rem" }}>
                <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>Name</span>
                <input
                  type="text"
                  value={customerContactDraft.name}
                  onChange={(e) => setCustomerContactDraft((d) => ({ ...d, name: e.target.value }))}
                  disabled={customerContactSaveState === "submitting"}
                  style={{ width: "100%" }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.5rem" }}>
                <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>Email</span>
                <input
                  type="email"
                  value={customerContactDraft.email}
                  onChange={(e) => setCustomerContactDraft((d) => ({ ...d, email: e.target.value }))}
                  disabled={customerContactSaveState === "submitting"}
                  style={{ width: "100%" }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.5rem" }}>
                <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>Phone</span>
                <input
                  type="tel"
                  value={customerContactDraft.phone}
                  onChange={(e) => setCustomerContactDraft((d) => ({ ...d, phone: e.target.value }))}
                  disabled={customerContactSaveState === "submitting"}
                  style={{ width: "100%" }}
                />
              </label>
              <div className="customer-notes-editor__actions">
                <button
                  type="button"
                  className="text-action"
                  onClick={() => {
                    setIsEditingCustomerContact(false);
                    setCustomerContactError("");
                  }}
                  disabled={customerContactSaveState === "submitting"}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-action"
                  onClick={async () => {
                    if (!onUpdateCustomerContact) return;
                    if (!customerContactDraft.name.trim()) {
                      setCustomerContactSaveState("error");
                      setCustomerContactError("Name is required.");
                      return;
                    }
                    setCustomerContactSaveState("submitting");
                    setCustomerContactError("");
                    try {
                      await onUpdateCustomerContact(selectedAppointment, {
                        name: customerContactDraft.name.trim(),
                        email: customerContactDraft.email.trim(),
                        phone: customerContactDraft.phone.trim(),
                      });
                      setIsEditingCustomerContact(false);
                      setCustomerContactSaveState("idle");
                    } catch (err) {
                      setCustomerContactSaveState("error");
                      setCustomerContactError(err instanceof Error ? err.message : "Unable to save contact.");
                    }
                  }}
                  disabled={customerContactSaveState === "submitting"}
                >
                  {customerContactSaveState === "submitting" ? "Saving…" : "Save"}
                </button>
              </div>
              {customerContactSaveState === "error" ? (
                <p role="alert" className="settings-error">{customerContactError}</p>
              ) : null}
            </div>
          ) : (
            <div className="customer-notes-display">
              <div className="appointment-customer-card">
                <span className="appointment-customer-avatar" aria-hidden="true">{getInitials(selectedAppointment.customerName)}</span>
                <div>
                  <strong>{selectedAppointment.customerName}</strong>
                  <span>Client profile</span>
                </div>
              </div>
              <div className="appointment-customer-fields">
                {selectedAppointment.customerPhone ? (
                  <div className="appointment-customer-field">
                    <span className="appointment-customer-field__label">Phone</span>
                    <span className="appointment-customer-field__value">{selectedAppointment.customerPhone}</span>
                  </div>
                ) : null}
                {selectedAppointment.customerEmail ? (
                  <div className="appointment-customer-field">
                    <span className="appointment-customer-field__label">Email</span>
                    <span className="appointment-customer-field__value">{selectedAppointment.customerEmail}</span>
                  </div>
                ) : null}
              </div>
              {onUpdateCustomerContact ? (
                <button
                  type="button"
                  className="text-action"
                  onClick={() => {
                    setCustomerContactDraft({
                      name: selectedAppointment.customerName,
                      email: selectedAppointment.customerEmail ?? "",
                      phone: selectedAppointment.customerPhone ?? "",
                    });
                    setIsEditingCustomerContact(true);
                  }}
                >
                  Edit contact
                </button>
              ) : null}
            </div>
          )}
          <div className="appointment-customer-notes">
            {isEditingCustomerNotes ? (
              <div className="customer-notes-editor">
                <textarea
                  value={customerNotesDraft}
                  onChange={(e) => setCustomerNotesDraft(e.target.value)}
                  rows={3}
                  placeholder="Add notes about this client..."
                  disabled={customerNotesSaveState === "submitting"}
                />
                <div className="customer-notes-editor__actions">
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => {
                      setIsEditingCustomerNotes(false);
                      setCustomerNotesError("");
                    }}
                    disabled={customerNotesSaveState === "submitting"}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-action"
                    onClick={async () => {
                      if (!onUpdateCustomerNotes) return;
                      setCustomerNotesSaveState("submitting");
                      setCustomerNotesError("");
                      try {
                        await onUpdateCustomerNotes(selectedAppointment, customerNotesDraft);
                        setIsEditingCustomerNotes(false);
                        setCustomerNotesSaveState("idle");
                      } catch (err) {
                        setCustomerNotesSaveState("error");
                        setCustomerNotesError(err instanceof Error ? err.message : "Unable to save notes.");
                      }
                    }}
                    disabled={customerNotesSaveState === "submitting"}
                  >
                    {customerNotesSaveState === "submitting" ? "Saving…" : "Save"}
                  </button>
                </div>
                {customerNotesSaveState === "error" ? (
                  <p role="alert" className="settings-error">{customerNotesError}</p>
                ) : null}
              </div>
            ) : (
              <div className="customer-notes-display">
                {selectedAppointment.customerNotes ? (
                  <p className="customer-profile-notes">{selectedAppointment.customerNotes}</p>
                ) : (
                  <p className="staff-list-empty">No client notes.</p>
                )}
                <button
                  type="button"
                  className="text-action"
                  onClick={() => {
                    setCustomerNotesDraft(selectedAppointment.customerNotes ?? "");
                    setIsEditingCustomerNotes(true);
                  }}
                >
                  {selectedAppointment.customerNotes ? "Edit" : "Add note"}
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="booking-rail-section" aria-label="Appointment details">
          <p className="rail-section-kicker">Appointment</p>
          <div className="appointment-summary-card">
            <div className="appointment-summary-card__row">
              <strong>{selectedAppointment.serviceName}</strong>
              <span className="appointment-summary-card__price">{formatMoney(selectedAppointment.priceCents)}</span>
            </div>
            <p className="appointment-summary-card__meta">
              {selectedAppointment.durationMinutes} min · {selectedAppointment.providerName}
            </p>
            {isEditingAppointmentNotes ? (
              <div className="customer-notes-editor">
                <textarea
                  value={appointmentNotesDraft}
                  onChange={(e) => setAppointmentNotesDraft(e.target.value)}
                  rows={3}
                  placeholder="Add appointment notes..."
                  disabled={appointmentNotesSaveState === "submitting"}
                />
                <div className="customer-notes-editor__actions">
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => {
                      setIsEditingAppointmentNotes(false);
                      setAppointmentNotesError("");
                    }}
                    disabled={appointmentNotesSaveState === "submitting"}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-action"
                    onClick={async () => {
                      if (!onUpdate) return;
                      setAppointmentNotesSaveState("submitting");
                      setAppointmentNotesError("");
                      try {
                        await onUpdate(selectedAppointment, {
                          notes: appointmentNotesDraft || undefined,
                        });
                        setIsEditingAppointmentNotes(false);
                        setAppointmentNotesSaveState("idle");
                      } catch (err) {
                        setAppointmentNotesSaveState("error");
                        setAppointmentNotesError(err instanceof Error ? err.message : "Unable to save notes.");
                      }
                    }}
                    disabled={appointmentNotesSaveState === "submitting"}
                  >
                    {appointmentNotesSaveState === "submitting" ? "Saving…" : "Save"}
                  </button>
                </div>
                {appointmentNotesSaveState === "error" ? (
                  <p role="alert" className="settings-error">{appointmentNotesError}</p>
                ) : null}
              </div>
            ) : (
              <div className="customer-notes-display">
                {selectedAppointment.notes ? (
                  <p className="customer-profile-notes">{selectedAppointment.notes}</p>
                ) : (
                  <p className="staff-list-empty">No appointment notes.</p>
                )}
                <button
                  type="button"
                  className="text-action"
                  onClick={() => {
                    setAppointmentNotesDraft(selectedAppointment.notes ?? "");
                    setIsEditingAppointmentNotes(true);
                  }}
                >
                  {selectedAppointment.notes ? "Edit" : "Add note"}
                </button>
              </div>
            )}
          </div>
          <div className="appointment-payment-summary">
            {selectedAppointment.depositCents > 0 ? (
              <div className="appointment-payment-row">
                <span>Deposit</span>
                <span>{formatMoney(selectedAppointment.depositCents)}</span>
              </div>
            ) : null}
            <div className="appointment-payment-row">
              <span>Paid</span>
              <span>{formatMoney(selectedAppointment.amountPaidCents)}</span>
            </div>
            {selectedAppointment.balanceDueCents > 0 ? (
              <div className="appointment-payment-row appointment-payment-row--due">
                <span>Balance due</span>
                <span>{formatMoney(selectedAppointment.balanceDueCents)}</span>
              </div>
            ) : null}
          </div>
        </section>

        <section className="booking-rail-section booking-rail-section--forms" aria-label="Intake forms">
          <FormResponsesPanel
            selectedAppointment={selectedAppointment}
            state={formResponsesState}
            intakeStatus={intakeStatus}
            reminderState={formReminderState}
            onSendReminder={onSendFormReminder ? () => onSendFormReminder(selectedAppointment) : undefined}
            onViewForm={setViewingFormEntry}
          />
        </section>

        {showFooter ? (
          <div className="appointment-drawer-footer">
            {isConfirmed ? (
              <div className="appointment-drawer-footer__actions">
                {selectedAppointment.customerEmail ? (
                  <a
                    href={`mailto:${encodeURIComponent(selectedAppointment.customerEmail)}`}
                    className="text-action"
                  >
                    Message
                  </a>
                ) : (
                  <button type="button" className="text-action" disabled>Message</button>
                )}
                <span className="text-action-separator">·</span>
                <button
                  type="button"
                  className="text-action"
                  onClick={() => {
                    const d = new Date(selectedAppointment.startAt);
                    setEditDate(d.toISOString().slice(0, 10));
                    setEditTime(d.toTimeString().slice(0, 5));
                    setEditServiceId(selectedAppointment.serviceId);
                    setEditProviderId(selectedAppointment.providerId);
                    setEditNotes(selectedAppointment.notes ?? "");
                    setNotificationChoice("notify");
                    setEditSaveState("idle");
                    setIsEditing(true);
                  }}
                >
                  Reschedule
                </button>
                {onCancel ? (
                  <>
                    <span className="text-action-separator">·</span>
                    <button
                      type="button"
                      className="text-action text-action--danger"
                      onClick={() => {
                        if (window.confirm("Cancel this booking? The cancellation policy will be applied.")) {
                          void onCancel(selectedAppointment);
                        }
                      }}
                      disabled={completionState?.kind === "submitting"}
                    >
                      Cancel
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="appointment-drawer-footer__finalize">
              {isCompleted ? (
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => setDrawerView("checkout")}
                >
                  View Sale
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="primary-action"
                    onClick={() => setDrawerView("checkout")}
                    disabled={completionState?.kind === "submitting"}
                  >
                    Checkout
                  </button>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => void onNoShow(selectedAppointment)}
                    disabled={completionState?.kind === "submitting"}
                  >
                    {completionState?.kind === "submitting" ? "Saving..." : "No-show"}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}
        {completionState?.kind === "error" ? (
          <div className="message-banner message-banner--error" role="alert">
            {completionState.message}
          </div>
        ) : null}
      </aside>
      {createPortal(
        <FormResponseDrawer
          entry={viewingFormEntry}
          onClose={() => setViewingFormEntry(null)}
        />,
        document.body,
      )}
    </>
  );
}

type CheckoutPanelProps = {
  appointment: SelectedCalendarAppointment;
  api: CalendarPageApi;
  tenantSlug: string;
  customPaymentMethods: CustomPaymentMethod[];
  onBack: () => void;
  onClose: () => void;
  onPaymentRecorded: () => void;
  onComplete: (
    appointment: SelectedCalendarAppointment,
    resolution?: "collected" | "follow_up" | "waived",
  ) => Promise<void> | void;
};

function CheckoutPanel({
  appointment,
  api,
  tenantSlug,
  customPaymentMethods,
  onBack,
  onClose,
  onPaymentRecorded,
  onComplete,
}: CheckoutPanelProps): ReactElement {
  // Totals: subtotal is the service price. Tax is 0% for this tenant.
  // Tip is added by the operator. Total = subtotal + tip.
  const subtotal = appointment.priceCents;

  // Local state.
  const [payments, setPayments] = useState<BookingPaymentSummary[]>(
    () => appointment.payments.filter((p) => p.status === "succeeded" && p.amountCents > 0),
  );
  const totalPaid = payments.reduce((sum, p) => sum + p.amountCents, 0);

  const [tipPercent, setTipPercent] = useState<number | null>(null);
  const [tipText, setTipText] = useState("0.00");
  const parseTip = (): number => {
    const cleaned = tipText.replace(/[^0-9.]/g, "");
    const dollars = parseFloat(cleaned);
    if (isNaN(dollars) || dollars < 0) return 0;
    return Math.round(dollars * 100);
  };
  const tipCents = parseTip();
  const total = subtotal + tipCents;
  const remainingBalance = Math.max(total - totalPaid, 0);
  const setTipFromPercent = (percent: number) => {
    setTipPercent(percent);
    const tip = Math.round((subtotal * percent) / 100);
    setTipText((tip / 100).toFixed(2));
  };
  const handleTipTextChange = (value: string) => {
    setTipText(value);
    setTipPercent(null);
  };

  const [amountText, setAmountText] = useState((appointment.balanceDueCents / 100).toFixed(2));
  // Update amount field whenever the remaining balance changes (e.g. tip changes, payment recorded).
  useEffect(() => {
    setAmountText(remainingBalance > 0 ? (remainingBalance / 100).toFixed(2) : "0.00");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingBalance]);

  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "error" | "success">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [showAddMethod, setShowAddMethod] = useState(false);
  const [newMethodLabel, setNewMethodLabel] = useState("");
  const [localCustomMethods, setLocalCustomMethods] = useState<CustomPaymentMethod[]>(customPaymentMethods);
  const [openMenuPaymentId, setOpenMenuPaymentId] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundAmountText, setRefundAmountText] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [saleCompleted, setSaleCompleted] = useState(appointment.status === "completed");

  const builtinMethods = [
    { id: "cash", label: "Cash" },
    { id: "external_pos", label: "External POS" },
    { id: "manual", label: "Manual / Card" },
  ];
  const allMethods = [...builtinMethods, ...localCustomMethods];

  const labelForPayment = (p: BookingPaymentSummary): string => {
    if (p.checkoutSessionKind && p.checkoutSessionKind.includes("deposit")) return "Deposit";
    if (p.paymentMethodType === "wallet") return "Wallet credit";
    if (p.paymentMethodType === "card") return "Credit card";
    return allMethods.find((m) => m.id === p.paymentMethodType)?.label ?? p.paymentMethodType;
  };

  // Derive refunded payments from API data so they persist across panel opens.
  // Also track refunds just made in this session for immediate display.
  const [sessionRefunds, setSessionRefunds] = useState<Array<{ id: string; label: string; amountCents: number; reason: string }>>([]);
  const apiRefundedPayments = useMemo(() => {
    return appointment.payments
      .filter((p) => p.status === "refunded" && p.amountCents > 0)
      .map((p) => ({
        id: p.id,
        label: labelForPayment(p),
        amountCents: p.amountCents,
        reason: p.refundReason ?? "",
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointment.payments]);
  const refundedPayments = [...apiRefundedPayments, ...sessionRefunds];

  // Close the open ellipsis menu when clicking outside.
  useEffect(() => {
    if (openMenuPaymentId === null) return;
    const handler = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest(".checkout-panel__payment-menu, .checkout-panel__payment-menu-trigger")) {
        return;
      }
      setOpenMenuPaymentId(null);
      setRefundAmountText("");
      setRefundReason("");
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenuPaymentId]);

  const parseAmount = (): number => {
    const cleaned = amountText.replace(/[^0-9.]/g, "");
    const dollars = parseFloat(cleaned);
    if (isNaN(dollars) || dollars <= 0) return 0;
    return Math.round(dollars * 100);
  };

  const handleRecord = async (methodId: string) => {
    const cents = parseAmount();
    if (cents <= 0 || cents > remainingBalance) {
      setErrorMessage("Amount must be between 1 cent and the remaining balance.");
      setState("error");
      return;
    }

    setSelectedMethod(methodId);
    setState("submitting");
    setErrorMessage("");
    try {
      const tipNote = tipCents > 0 ? `Includes $${(tipCents / 100).toFixed(2)} tip` : null;
      const combinedNotes = [notes.trim() || null, tipNote].filter(Boolean).join(" — ") || undefined;
      const updated = await api.recordManualPayment(tenantSlug, appointment.id, {
        amountCents: cents,
        paymentMethodType: methodId,
        notes: combinedNotes,
      });
      const updatedPayments = (updated.payments ?? []).filter(
        (p) => p.status === "succeeded" && p.amountCents > 0,
      );
      setPayments(updatedPayments);
      setSelectedMethod(null);
      setNotes("");
      const newRemaining = Math.max(total - updatedPayments.reduce((s, p) => s + p.amountCents, 0), 0);
      setState(newRemaining <= 0 ? "success" : "idle");
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "Payment recording failed.");
      setSelectedMethod(null);
    }
  };

  const handleApplyWallet = async () => {
    setState("submitting");
    setErrorMessage("");
    try {
      const applyAmount = Math.min(appointment.walletBalanceCents, remainingBalance);
      const updated = await api.applyWalletCredit(tenantSlug, appointment.id, { amountCents: applyAmount });
      const updatedPayments = (updated.payments ?? []).filter(
        (p) => p.status === "succeeded" && p.amountCents > 0,
      );
      setPayments(updatedPayments);
      const newRemaining = Math.max(total - updatedPayments.reduce((s, p) => s + p.amountCents, 0), 0);
      setState(newRemaining <= 0 ? "success" : "idle");
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to apply wallet credit.");
    }
  };

  const handleRefund = async (payment: BookingPaymentSummary) => {
    const label = labelForPayment(payment);
    const refundCents = parseRefundAmount();
    const isPartial = refundCents > 0 && refundCents < payment.amountCents;
    const refundDisplay = formatMoney(refundCents > 0 ? refundCents : payment.amountCents);
    const newBalance = remainingBalance + (refundCents > 0 ? refundCents : payment.amountCents);

    if (!refundReason.trim()) {
      setErrorMessage("A reason is required for refunds.");
      setState("error");
      return;
    }

    const confirmMsg = refundCents > 0
      ? `Refund ${formatMoney(refundCents)} of ${label} payment (${formatMoney(payment.amountCents)})?\n\nReason: ${refundReason.trim()}\nNew balance due: ${formatMoney(newBalance)}\n\nThis action is logged and auditable.`
      : `Refund ${label} payment of ${formatMoney(payment.amountCents)}?\n\nReason: ${refundReason.trim()}\nNew balance due: ${formatMoney(newBalance)}\n\nThis action is logged and auditable.`;

    if (!window.confirm(confirmMsg)) {
      return;
    }
    setOpenMenuPaymentId(null);
    setRefundAmountText("");
    setRefundReason("");
    setRefundingId(payment.id);
    setErrorMessage("");
    try {
      const body: { amountCents?: number; reason?: string } = { reason: refundReason.trim() };
      if (refundCents > 0) body.amountCents = refundCents;
      const updated = await api.refundBookingPayment(tenantSlug, appointment.id, payment.id, body);
      const updatedPayments = (updated.payments ?? []).filter(
        (p) => p.status === "succeeded" && p.amountCents > 0,
      );
      setPayments(updatedPayments);
      // Record the refund immediately in session state so it's visible in the panel.
      const refundedAmount = refundCents > 0 ? refundCents : payment.amountCents;
      setSessionRefunds((prev) => [
        ...prev,
        {
          id: `${payment.id}-refund-${Date.now()}`,
          label: labelForPayment(payment),
          amountCents: refundedAmount,
          reason: refundReason.trim(),
        },
      ]);
      // Trigger parent refetch so refunds persist when panel is reopened.
      onPaymentRecorded();
      // If balance is no longer zero, reset the completed-sale view so operator can collect again.
      const newTotalPaid = updatedPayments.reduce((s, p) => s + p.amountCents, 0);
      if (newTotalPaid < total) {
        setSaleCompleted(false);
      }
      setState("idle");
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "Refund failed.");
    } finally {
      setRefundingId(null);
    }
  };

  const parseRefundAmount = (): number => {
    const cleaned = refundAmountText.replace(/[^0-9.]/g, "");
    const dollars = parseFloat(cleaned);
    if (isNaN(dollars) || dollars <= 0) return 0;
    return Math.round(dollars * 100);
  };

  const handleAddCustomMethod = () => {
    const label = newMethodLabel.trim();
    if (!label) return;
    const id = label.toLowerCase().replace(/\s+/g, "_");
    setLocalCustomMethods((prev) => [...prev, { id, label }]);
    setNewMethodLabel("");
    setShowAddMethod(false);
  };

  const handleMarkOwing = () => {
    if (window.confirm("Mark this booking completed and flag the remaining balance for follow-up?")) {
      void onComplete(appointment, "follow_up");
    }
  };

  const handleWaive = () => {
    if (window.confirm("Waive the remaining balance and complete this booking?")) {
      void onComplete(appointment, "waived");
    }
  };

  const handleComplete = () => {
    void onComplete(appointment).then(() => {
      setSaleCompleted(true);
    });
  };

  const isSettled = remainingBalance <= 0;

  return (
    <aside className="appointment-details-drawer checkout-panel" role="dialog" aria-label="Checkout">
      <header className="appointment-details-drawer__header checkout-panel__header">
        <button
          type="button"
          className="checkout-panel__back"
          onClick={onBack}
          aria-label="Back to appointment details"
        >
          ←
        </button>
        <h3 className="checkout-panel__title">Payments</h3>
        <button type="button" className="appointment-drawer-outline-action" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="checkout-panel__body">
        <div className="checkout-panel__customer">
          <strong>{appointment.customerName}</strong>
          <span>{appointment.serviceName}</span>
        </div>

        <section className="checkout-panel__totals">
          <div className="checkout-panel__totals-row">
            <span>Subtotal</span>
            <span>{formatMoney(subtotal)}</span>
          </div>
          <div className="checkout-panel__totals-row checkout-panel__tip-row">
            <span className="checkout-panel__tip-label">
              Tip
              <span className="checkout-panel__tip-quick">
                {[18, 20, 22].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    className={`checkout-panel__tip-chip${tipPercent === pct ? " is-active" : ""}`}
                    onClick={() => setTipFromPercent(pct)}
                    disabled={state === "submitting"}
                  >
                    {pct}%
                  </button>
                ))}
              </span>
            </span>
            <input
              type="text"
              inputMode="decimal"
              className="checkout-panel__tip-input"
              value={tipText}
              onChange={(e) => handleTipTextChange(e.target.value)}
              disabled={state === "submitting"}
              aria-label="Tip amount"
            />
          </div>
          <div className="checkout-panel__totals-row checkout-panel__totals-row--total">
            <span>Total</span>
            <strong>{formatMoney(total)}</strong>
          </div>
        </section>

        {appointment.walletBalanceCents > 0 && remainingBalance > 0 ? (
          <section className="checkout-panel__wallet">
            <span>Wallet credit available</span>
            <strong>{formatMoney(appointment.walletBalanceCents)}</strong>
            <button
              type="button"
              className="checkout-panel__wallet-apply"
              onClick={handleApplyWallet}
              disabled={state === "submitting"}
            >
              Apply credit
            </button>
          </section>
        ) : null}

        {payments.length > 0 ? (
          <section className="checkout-panel__paid">
            {payments.map((p) => (
              <div key={p.id} className="checkout-panel__paid-row">
                <span className="checkout-panel__paid-label">{labelForPayment(p)}</span>
                <span className="checkout-panel__paid-amount">{formatMoney(p.amountCents)}</span>
                <div className="checkout-panel__payment-menu-wrap">
                  <button
                    type="button"
                    className="checkout-panel__payment-menu-trigger"
                    aria-label={`Payment actions for ${labelForPayment(p)}`}
                    aria-haspopup="menu"
                    aria-expanded={openMenuPaymentId === p.id}
                    onClick={() => setOpenMenuPaymentId(openMenuPaymentId === p.id ? null : p.id)}
                    disabled={refundingId === p.id || state === "submitting"}
                  >
                    ⋯
                  </button>
                  {openMenuPaymentId === p.id ? (
                    <div className="checkout-panel__payment-menu" role="menu">
                      <div className="checkout-panel__refund-form">
                        <label className="checkout-panel__refund-label">
                          Refund amount
                          <input
                            type="text"
                            inputMode="decimal"
                            className="checkout-panel__refund-input"
                            placeholder={formatMoney(p.amountCents)}
                            value={refundAmountText}
                            onChange={(e) => setRefundAmountText(e.target.value)}
                            disabled={refundingId === p.id}
                          />
                        </label>
                        <label className="checkout-panel__refund-label">
                          Reason (required)
                          <input
                            type="text"
                            className="checkout-panel__refund-input checkout-panel__refund-reason"
                            placeholder="e.g. Client cancelled, service adjustment"
                            value={refundReason}
                            onChange={(e) => setRefundReason(e.target.value)}
                            disabled={refundingId === p.id}
                          />
                        </label>
                        <button
                          type="button"
                          role="menuitem"
                          className="checkout-panel__payment-menu-item checkout-panel__refund-button"
                          onClick={() => void handleRefund(p)}
                          disabled={refundingId === p.id || !refundReason.trim()}
                        >
                          {refundingId === p.id ? "Refunding…" : "Refund"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {refundedPayments.length > 0 ? (
          <section className="checkout-panel__refunded">
            <h4 className="checkout-panel__refunded-heading">Refunded</h4>
            {refundedPayments.map((r) => (
              <div key={r.id} className="checkout-panel__refunded-row">
                <span className="checkout-panel__refunded-label">{r.label}</span>
                <span className="checkout-panel__refunded-amount">−{formatMoney(r.amountCents)}</span>
                <span className="checkout-panel__refunded-reason">{r.reason}</span>
              </div>
            ))}
          </section>
        ) : null}

        <section className="checkout-panel__balance">
          <span>Remaining Balance</span>
          <strong>{formatMoney(remainingBalance)}</strong>
        </section>

        {!isSettled ? (
          <>
            <section className="checkout-panel__amount-section">
              <label className="checkout-panel__amount-row">
                <span>Amount to charge</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="checkout-panel__amount-input"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  disabled={state === "submitting"}
                />
              </label>
              <label className="checkout-panel__notes">
                <span>Notes (optional)</span>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={state === "submitting"}
                  placeholder="e.g. Paid at front desk"
                />
              </label>
            </section>

            <section className="checkout-panel__methods">
              <div className="checkout-panel__methods-grid">
                {allMethods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`checkout-panel__method-button${selectedMethod === m.id && state === "submitting" ? " is-submitting" : ""}`}
                    onClick={() => void handleRecord(m.id)}
                    disabled={state === "submitting" || parseAmount() <= 0 || parseAmount() > remainingBalance}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {showAddMethod ? (
                <div className="checkout-panel__add-method">
                  <input
                    type="text"
                    placeholder="Method label (e.g. Venmo)"
                    value={newMethodLabel}
                    onChange={(e) => setNewMethodLabel(e.target.value)}
                    disabled={state === "submitting"}
                  />
                  <button
                    type="button"
                    className="text-action"
                    onClick={handleAddCustomMethod}
                    disabled={!newMethodLabel.trim() || state === "submitting"}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => setShowAddMethod(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="text-action checkout-panel__add-method-toggle"
                  onClick={() => setShowAddMethod(true)}
                  disabled={state === "submitting"}
                >
                  + Add payment method
                </button>
              )}
            </section>

            <section className="checkout-panel__resolutions">
              <div className="checkout-panel__resolutions-buttons">
                <button
                  type="button"
                  className="text-action"
                  onClick={handleMarkOwing}
                  disabled={state === "submitting"}
                >
                  Mark owing (follow up later)
                </button>
                <button
                  type="button"
                  className="text-action"
                  onClick={handleWaive}
                  disabled={state === "submitting"}
                >
                  Waive remaining balance
                </button>
              </div>
            </section>
          </>
        ) : saleCompleted ? (
          <section className="checkout-panel__completed-banner">
            <div className="checkout-panel__completed-icon">✓</div>
            <h4 className="checkout-panel__completed-heading">Sale Complete</h4>
            <p className="checkout-panel__completed-total">
              Total collected: <strong>{formatMoney(totalPaid)}</strong>
            </p>
            {payments.length > 0 ? (
              <p className="checkout-panel__completed-detail">
                {payments.length} payment{payments.length !== 1 ? "s" : ""} recorded
                {tipCents > 0 ? ` · Includes $${(tipCents / 100).toFixed(2)} tip` : ""}
              </p>
            ) : null}
            <p className="checkout-panel__completed-hint">
              Use the ⋯ menu on each payment to refund if needed.
            </p>
          </section>
        ) : (
          <p className="checkout-panel__settled-note">
            All payments collected. Add a tip above if needed before completing.
          </p>
        )}

        {state === "error" ? (
          <div className="message-banner message-banner--error" role="alert">
            {errorMessage}
          </div>
        ) : null}
      </div>
      <footer className="checkout-panel__footer">
        {saleCompleted ? (
          <button
            type="button"
            className="checkout-panel__complete-button checkout-panel__complete-button--done"
            onClick={onClose}
          >
            Close Sale
          </button>
        ) : (
          <button
            type="button"
            className="checkout-panel__complete-button"
            onClick={handleComplete}
            disabled={!isSettled || state === "submitting"}
          >
            {isSettled ? "COMPLETE" : `Collect ${formatMoney(remainingBalance)} to complete`}
          </button>
        )}
      </footer>
    </aside>
  );
}

type FormResponsesPanelProps = {
  selectedAppointment: SelectedCalendarAppointment | null;
  state: FormResponsesState;
  intakeStatus: IntakeStatus;
  reminderState: FormReminderState;
  onSendReminder?: () => void;
  onViewForm?: (entry: BookingFormResponseEntry) => void;
};

function FormResponsesPanel({
  selectedAppointment,
  state,
  intakeStatus,
  reminderState,
  onSendReminder,
  onViewForm,
}: FormResponsesPanelProps): ReactElement {
  const intakeLabel = getIntakeStatusLabel(intakeStatus);
  const bookingId = selectedAppointment?.id ?? null;

  const requirements = state.kind === "ready" ? state.requirements : [];
  const responses = state.kind === "ready" ? state.items : [];
  const responseByRequirementId = new Map<string, BookingFormResponseEntry>();
  for (const req of requirements) {
    if (req.satisfiedByResponseId) {
      const match = responses.find((r) => r.id === req.satisfiedByResponseId);
      if (match) {
        responseByRequirementId.set(req.id, match);
      }
    }
  }

  const hasPending = requirements.some((req) => req.status === "pending");
  const reminderForThisBooking =
    reminderState.kind !== "idle" && bookingId !== null && "bookingId" in reminderState && reminderState.bookingId === bookingId
      ? reminderState
      : null;
  const reminderSending = reminderForThisBooking?.kind === "sending";

  return (
    <>
      <div className="rail-section-heading">
        <div>
          <p className="eyebrow">Forms</p>
          <h4>Customer intake</h4>
        </div>
        <span className={`intake-status-badge intake-status-badge--${intakeStatus}`}>{intakeLabel}</span>
      </div>
      {!selectedAppointment ? (
        <p>Select an appointment to review any intake forms attached to it.</p>
      ) : state.kind === "loading" ? (
        <p>Checking intake status...</p>
      ) : state.kind === "error" ? (
        <div className="message-banner message-banner--error" role="alert">
          {state.message}
        </div>
      ) : requirements.length === 0 && responses.length === 0 ? (
        <p className="form-responses-empty">No intake forms are attached to this booking.</p>
      ) : (
        <>
          <ul className="form-requirements-list" aria-label="Intake forms">
            {requirements.length > 0
              ? requirements.map((req) => {
                  const matchedResponse = responseByRequirementId.get(req.id);
                  const isCompleted = req.status === "satisfied";
                  const submittedAt = matchedResponse ? formatDateTime(matchedResponse.submittedAt) : null;
                  const timingLabel = req.customerPromptTiming?.replaceAll("_", " ") ?? req.scope;
                  return (
                    <li
                      key={req.id}
                      className={`form-requirements-list__item form-requirements-list__item--${isCompleted ? "completed" : "pending"}`}
                    >
                      <span
                        className={`form-requirements-list__status form-requirements-list__status--${isCompleted ? "completed" : "pending"}`}
                        aria-hidden="true"
                      >
                        {isCompleted ? "✓" : ""}
                      </span>
                      <div className="form-requirements-list__body">
                        <div className="form-requirements-list__title">{req.formName}</div>
                        <div className="form-requirements-list__meta">
                          {isCompleted
                            ? submittedAt
                              ? `Completed ${submittedAt}`
                              : "Completed"
                            : "Form not started"}
                          {" · "}
                          {timingLabel}
                        </div>
                      </div>
                      {isCompleted && matchedResponse ? (
                        <button
                          type="button"
                          className="form-requirements-list__action"
                          onClick={() => onViewForm?.(matchedResponse)}
                        >
                          View
                        </button>
                      ) : null}
                    </li>
                  );
                })
              : responses.map((entry) => {
                  const submittedAt = formatDateTime(entry.submittedAt);
                  const timingLabel = entry.customerPromptTiming?.replaceAll("_", " ") ?? entry.scope;
                  return (
                    <li
                      key={entry.id}
                      className="form-requirements-list__item form-requirements-list__item--completed"
                    >
                      <span
                        className="form-requirements-list__status form-requirements-list__status--completed"
                        aria-hidden="true"
                      >
                        ✓
                      </span>
                      <div className="form-requirements-list__body">
                        <div className="form-requirements-list__title">{entry.formName}</div>
                        <div className="form-requirements-list__meta">
                          Completed {submittedAt} · {timingLabel}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="form-requirements-list__action"
                        onClick={() => onViewForm?.(entry)}
                      >
                        View
                      </button>
                    </li>
                  );
                })}
          </ul>
          {hasPending && onSendReminder ? (
            <div className="form-requirements-reminder">
              <button
                type="button"
                className="secondary-action"
                onClick={onSendReminder}
                disabled={reminderSending}
              >
                {reminderSending ? "Sending reminder..." : "Send reminder"}
              </button>
              {reminderForThisBooking?.kind === "success" ? (
                <span className="form-requirements-reminder__status" role="status">
                  {reminderForThisBooking.message}
                </span>
              ) : null}
              {reminderForThisBooking?.kind === "error" ? (
                <span className="form-requirements-reminder__status form-requirements-reminder__status--error" role="alert">
                  {reminderForThisBooking.message}
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

type FormResponseDrawerProps = {
  entry: BookingFormResponseEntry | null;
  onClose: () => void;
};

function FormResponseDrawer({ entry, onClose }: FormResponseDrawerProps): ReactElement | null {
  if (!entry) return null;

  return (
    <>
      <button
        type="button"
        className="appointment-drawer-backdrop"
        aria-label="Close form response"
        onClick={onClose}
      />
      <aside className="appointment-details-drawer form-response-drawer" role="dialog" aria-label="Form response">
        <header className="appointment-details-drawer__header">
          <span className="appointment-status-chip">
            <span aria-hidden="true" />
            Form response
          </span>
          <div className="slot-action-drawer__header-actions">
            <button type="button" className="appointment-drawer-outline-action" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <FormResponseViewer response={entry} />
      </aside>
    </>
  );
}
