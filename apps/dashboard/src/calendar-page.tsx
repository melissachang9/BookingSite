import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactElement } from "react";
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
  CustomerProfileResponse,
  CustomerSummary,
  CustomPaymentMethod,
  ProviderListResponse,
  ProviderTimeOffEntry,
  RecordManualPaymentRequest,
  SendFormReminderResponse,
  ServiceCategoryListResponse,
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
  | { kind: "ready"; days: CalendarDay[]; services: ServiceSummary[]; providers: CalendarProviderOption[]; categoryNameById: Record<string, string> }
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
  priceCents: number;
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
  taxCents: number;
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
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  referredBy: string;
};

type DraftCreationState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; draftId: string }
  | { kind: "error"; message: string };

type CustomerCreateState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; customerId: string }
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

type IntakeStatus = "unknown" | "loading" | "submitted" | "missing" | "partial" | "not_required" | "error";

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
  getBooking: (tenantSlug: string, bookingId: string) => Promise<BookingSummary>;
  getCustomerProfile: (tenantSlug: string, customerId: string) => Promise<CustomerProfileResponse>;
  listServiceProviders: (tenantSlug: string, serviceId: string) => Promise<ProviderListResponse>;
  listServiceCategories: (tenantSlug: string) => Promise<ServiceCategoryListResponse>;
  lookupCustomers: (query: CustomerLookupQuery) => Promise<CustomerLookupResponse>;
  getAvailability: (request: AvailabilityRequest) => Promise<AvailabilityResponse>;
  createBookingDraft: (body: CreateBookingDraftRequest) => Promise<BookingDraftSummary>;
  createOrUpdateCustomer: (body: { name: string; email?: string; phone?: string }) => Promise<{ customerId: string }>;
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
  updateTenantSettings: (tenantSlug: string, body: { customPaymentMethods: CustomPaymentMethod[] }) => Promise<unknown>;
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

const rangeDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  day: "numeric",
});

const rangeMonthFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "long",
});

const nowTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
});

const SCHEDULE_MIN_VISIBLE_HOURS = 8;
const SCHEDULE_HOUR_HEIGHT_PX = 72;         // week view; must match --cs-row-h default
const SCHEDULE_DAY_HOUR_HEIGHT_PX = 80;     // day view; must match .cs-board--day --cs-row-h
const SCHEDULE_CHIP_GAP_PX = 4;             // STRUCTURE.md §1: 4px breath between stacked chips
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
  const reference = new Date(Date.UTC(2026, 4, 5 + index));
  return monthWeekdayFormatter.format(reference).slice(0, 1).toUpperCase();
});

const CALENDAR_SIDEBAR_RAIL_ID = "dashboard-calendar-sidebar-rail";
const storefrontBaseUrl = import.meta.env.VITE_PUBLIC_STOREFRONT_BASE_URL ?? "http://127.0.0.1:3001";

function getUpcomingDate(offsetDays: number): string {
  return dateFormatter.format(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
}

function getDateLabel(date: string): string {
  return dayLabelFormatter.format(new Date(`${date}T12:00:00Z`));
}

function formatDateRangeLabel(startDate: string, endDate: string): string {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  const startDay = rangeDayFormatter.format(start);
  const endDay = rangeDayFormatter.format(end);
  const startMonth = rangeMonthFormatter.format(start);
  const endMonth = rangeMonthFormatter.format(end);
  if (startMonth === endMonth) {
    return `${startDay} – ${endDay} ${endMonth}`;
  }
  return `${startDay} ${startMonth} – ${endDay} ${endMonth}`;
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

function splitCustomerName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstName: "", lastName: "" };
  }
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { firstName: trimmed, lastName: "" };
  }
  return { firstName: trimmed.slice(0, spaceIndex), lastName: trimmed.slice(spaceIndex + 1).trim() };
}

function combineCustomerName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
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

function formatPriceCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function timeRangesOverlap(leftStartAt: string, leftEndAt: string, rightStartAt: string, rightEndAt: string): boolean {
  return new Date(leftStartAt).getTime() < new Date(rightEndAt).getTime() && new Date(rightStartAt).getTime() < new Date(leftEndAt).getTime();
}

// STRUCTURE.md §1: concurrent bookings in a column are laid out side-by-side
// via --lane / --lanes. Group appointments into overlap clusters (connected
// components of the overlap graph), then greedily assign each a lane within
// its cluster. Returns a map of appointment id -> { lane, lanes }.
function computeAppointmentLanes(
  appointments: { id: string; startAt: string; endAt: string }[],
): Map<string, { lane: number; lanes: number }> {
  const result = new Map<string, { lane: number; lanes: number }>();
  if (appointments.length === 0) {
    return result;
  }

  const sorted = [...appointments].sort(
    (left, right) => left.startAt.localeCompare(right.startAt) || left.endAt.localeCompare(right.endAt),
  );

  // Build overlap clusters (connected components).
  const clusters: { id: string; startAt: string; endAt: string }[][] = [];
  for (const appointment of sorted) {
    const overlappingClusters = clusters.filter((cluster) =>
      cluster.some((member) => timeRangesOverlap(member.startAt, member.endAt, appointment.startAt, appointment.endAt)),
    );
    if (overlappingClusters.length === 0) {
      clusters.push([appointment]);
    } else {
      const merged = overlappingClusters.flat();
      merged.push(appointment);
      for (const cluster of overlappingClusters) {
        const index = clusters.indexOf(cluster);
        if (index !== -1) {
          clusters.splice(index, 1);
        }
      }
      clusters.push(merged);
    }
  }

  for (const cluster of clusters) {
    const lanes = cluster.length;
    // Greedy lane assignment: each appointment takes the lowest lane whose
    // last occupant has already ended.
    const laneEndTimes: number[] = [];
    for (const appointment of cluster) {
      const startMs = new Date(appointment.startAt).getTime();
      const endMs = new Date(appointment.endAt).getTime();
      let lane = laneEndTimes.findIndex((end) => end <= startMs);
      if (lane === -1) {
        lane = laneEndTimes.length;
        laneEndTimes.push(endMs);
      } else {
        laneEndTimes[lane] = endMs;
      }
      result.set(appointment.id, { lane, lanes });
    }
  }

  return result;
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

function addMinutesToTimeInput(timeValue: string, durationMinutes: number): string {
  const minuteOfDay = getMinutesFromTimeInput(timeValue);
  if (minuteOfDay === null) {
    return timeValue;
  }
  const total = minuteOfDay + Math.max(0, durationMinutes);
  const hour = Math.floor(total / 60) % 24;
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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
    case "not_required":
      return "No forms required";
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
    taxCents: booking.taxCents ?? 0,
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

function isSlotWithinAvailability(
  openings: CalendarOpening[],
  providerId: string | null,
  serviceId: string | null,
  startAt: string,
): boolean {
  if (providerId === null || serviceId === null) {
    return false;
  }
  const requestedStartMs = new Date(startAt).getTime();
  return openings.some(
    (opening) =>
      opening.providerId === providerId && opening.serviceId === serviceId && new Date(opening.startAt).getTime() === requestedStartMs,
  );
}

function getServiceOptionsFromOpenings(openings: CalendarOpening[], providerId: string | null, fallbackServices: ServiceSummary[]): CalendarServiceOption[] {
  const services = new Map<string, CalendarServiceOption>();

  for (const opening of openings) {
    if (providerId !== null && opening.providerId !== providerId) {
      continue;
    }
    const fallback = fallbackServices.find((s) => s.id === opening.serviceId);
    services.set(opening.serviceId, {
      id: opening.serviceId,
      name: opening.serviceName,
      durationMinutes: opening.durationMinutes,
      priceCents: fallback?.priceCents ?? 0,
    });
  }

  if (services.size === 0) {
    for (const service of fallbackServices) {
      services.set(service.id, {
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        priceCents: service.priceCents,
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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
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
  start.setUTCDate(1 - ((start.getUTCDay() + 6) % 7));

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
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [availMenuOpen, setAvailMenuOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<PendingCalendarSlot | null>(null);
  const [selectedSlotServiceId, setSelectedSlotServiceId] = useState<string | null>(null);
  const [selectedSlotNotes, setSelectedSlotNotes] = useState("");
  const [selectedSlotBlockedServiceIds, setSelectedSlotBlockedServiceIds] = useState<string[]>([]);
  const [selectedSlotCustomer, setSelectedSlotCustomer] = useState<SlotCustomerForm>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    referredBy: "",
  });
  const [selectedSlotBlockDurationMinutes, setSelectedSlotBlockDurationMinutes] = useState(60);
  const [customerLookupState, setCustomerLookupState] = useState<CustomerLookupState>({ kind: "idle" });
  const [customerCreateState, setCustomerCreateState] = useState<CustomerCreateState>({ kind: "idle" });
  const [viewMode, setViewMode] = useState<CalendarViewMode>(() => {
    try {
      const saved = window.localStorage.getItem("calendar.viewMode");
      if (saved === "day" || saved === "week") return saved;
    } catch {
      // ignore storage access errors (e.g. private browsing)
    }
    return "week";
  });
  const [focusedDate, setFocusedDate] = useState<string>(getUpcomingDate(1));
  const [monthCursorDate, setMonthCursorDate] = useState<string>(monthAnchor(getUpcomingDate(1)));
  const [sidebarRailHost, setSidebarRailHost] = useState<HTMLElement | null>(null);
  const [timeBlocks, setTimeBlocks] = useState<CalendarTimeBlock[]>([]);
  const [selectedTimeBlockId, setSelectedTimeBlockId] = useState<string | null>(null);
  const [draftCreationState, setDraftCreationState] = useState<DraftCreationState>({ kind: "idle" });
  // Loaded provider time-off entries (blocked dates / custom hours overrides)
  const [providerTimeOffs, setProviderTimeOffs] = useState<ProviderTimeOffEntry[]>([]);
  const [selectedTimeOffId, setSelectedTimeOffId] = useState<string | null>(null);
  const [completionState, setCompletionState] = useState<CompletionState>({ kind: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const isInitialLoad = useRef(true);
  // When arriving at /calendar?bookingId=..., fetch that booking up front so we
  // can focus the calendar on the booking's date and open its details after the
  // load finishes (rather than landing on today and ignoring the param).
  const pendingBookingIdRef = useRef<string | null>(null);
  const pendingBookingDateRef = useRef<string | null>(null);
  const previousCalendarContextRef = useRef<{ api: CalendarPageApi; tenantSlug: string } | null>(null);
  const [formResponsesState, setFormResponsesState] = useState<FormResponsesState>({ kind: "idle" });
  const [intakeStatusByBookingId, setIntakeStatusByBookingId] = useState<Record<string, IntakeStatus>>({});
  const [formReminderState, setFormReminderState] = useState<FormReminderState>({ kind: "idle" });
  const [checkedInBookingIds, setCheckedInBookingIds] = useState<Set<string>>(new Set());

  // Read ?bookingId= from the URL once and resolve its date for focusing.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bookingId = params.get("bookingId");
    if (!bookingId) return;
    pendingBookingIdRef.current = bookingId;
    // Remove the param from the URL so a manual reload doesn't re-focus.
    const url = new URL(window.location.href);
    url.searchParams.delete("bookingId");
    window.history.replaceState({}, "", url.toString());
    let cancelled = false;
    api.getBooking(tenantSlug, bookingId)
      .then((booking) => {
        if (cancelled) return;
        const date = booking.startsAt.slice(0, 10);
        pendingBookingDateRef.current = date;
        // Focus on the booking's date.
        setFocusedDate(date);
        setMonthCursorDate(monthAnchor(date));
        setViewMode("day");
      })
      .catch(() => {
        // If the booking can't be fetched, leave the calendar on its default date.
      });
    return () => { cancelled = true; };
  }, [api, tenantSlug]);

  // Persist the selected calendar view (day/week) so returning to the calendar
  // restores the last-used view.
  useEffect(() => {
    try {
      window.localStorage.setItem("calendar.viewMode", viewMode);
    } catch {
      // ignore storage access errors
    }
  }, [viewMode]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenuOpen) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".context")) setContextMenuOpen(false);
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [contextMenuOpen]);

  // Close availability filter menu on outside click
  useEffect(() => {
    if (!availMenuOpen) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".avail-context")) setAvailMenuOpen(false);
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [availMenuOpen]);

  const selectedAppointmentRef = useRef<SelectedCalendarAppointment | null>(null);
  const selectedAppointment = useMemo<SelectedCalendarAppointment | null>(() => {
    if (selectedAppointmentId === null) {
      selectedAppointmentRef.current = null;
      return null;
    }
    if (calendarState.kind === 'ready') {
      for (const day of calendarState.days) {
        const appointment = day.appointments.find((candidate) => candidate.id === selectedAppointmentId);
        if (appointment) {
          selectedAppointmentRef.current = { ...appointment, dayLabel: day.label };
          return selectedAppointmentRef.current;
        }
      }
    }
    // Keep the currently open appointment alive even when it drops out of the
    // loaded calendar window — most importantly during a reschedule, when
    // navigating the calendar to a different date reloads the data and the
    // appointment being edited is no longer present.
    if (selectedAppointmentRef.current && selectedAppointmentRef.current.id === selectedAppointmentId) {
      return selectedAppointmentRef.current;
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
              : "not_required"
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
    // Only clear the open appointment drawer and in-progress slot/customer
    // forms when the tenant or api actually changes. reloadKey also bumps
    // this effect when the operator navigates the calendar (e.g. picking a
    // reschedule target date outside the loaded window) — that reload should
    // refresh the data in the background without closing whatever the
    // operator currently has open.
    const previousContext = previousCalendarContextRef.current;
    const contextChanged =
      previousContext === null ||
      previousContext.api !== api ||
      previousContext.tenantSlug !== tenantSlug;
    previousCalendarContextRef.current = { api, tenantSlug };

    if (contextChanged) {
      setSelectedAppointmentId(null);
      setTimeBlocks([]);
      setSelectedTimeBlockId(null);
      setSelectedSlot(null);
      setSelectedSlotCustomer({ firstName: "", lastName: "", email: "", phone: "", referredBy: "" });
      setSelectedSlotBlockDurationMinutes(60);
      setCustomerLookupState({ kind: "idle" });
      setCustomerCreateState({ kind: "idle" });
      setDraftCreationState({ kind: "idle" });
      setIntakeStatusByBookingId({});
      setSelectedWeekProviderId(null);
    }

    const loadCalendar = async () => {
      try {
        // Load 14 days before today through 42 days after (56-day window)
        const today = toIsoDate(new Date());
        const requestedDates: string[] = [];
        for (let i = -14; i < 42; i++) {
          requestedDates.push(addDays(today, i));
        }

        const [bookingsResult, servicesResult, categoriesResult] = await Promise.allSettled([
          api.listBookings(tenantSlug, {
            status: ["confirmed", "completed", "canceled", "no_show"],
            startsAtGte: `${addDays(requestedDates[0], -1)}T00:00:00.000Z`,
            startsAtLte: `${addDays(requestedDates[requestedDates.length - 1], 1)}T23:59:59.999Z`,
            limit: 200,
          }),
          api.listServices(tenantSlug),
          api.listServiceCategories(tenantSlug),
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
        const categoryNameById: Record<string, string> =
          categoriesResult.status === "fulfilled"
            ? Object.fromEntries(categoriesResult.value.categories.map((category) => [category.id, category.name]))
            : {};
        const providerResults = services.length > 0
          ? await Promise.allSettled(services.map((service) => api.listServiceProviders(tenantSlug, service.id)))
          : [];

        if (isCancelled) {
          return;
        }

        const providers = getProviderOptionsFromProviderResponses(providerResults);
        const requestedDateSet = new Set(requestedDates);
        const appointmentsByDate = new Map(requestedDates.map((date) => [date, [] as CalendarAppointment[]]));

        // Load time-off entries for all providers
        const timeOffResults = await Promise.allSettled(
          providers.map((p) => api.listProviderTimeOff(tenantSlug, p.id)),
        );
        const allTimeOffs: ProviderTimeOffEntry[] = [];
        for (const result of timeOffResults) {
          if (result.status === "fulfilled") {
            allTimeOffs.push(...result.value.items);
          }
        }
        setProviderTimeOffs(allTimeOffs);

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
          setCalendarState({ kind: "ready", days, services, providers, categoryNameById });
          if (days.length > 0 && isInitialLoad.current) {
            if (pendingBookingIdRef.current === null) {
              isInitialLoad.current = false;
              const todayDate = toIsoDate(new Date());
              const todayIndex = days.findIndex((d) => d.date === todayDate);
              const initialDate = todayIndex >= 0 ? days[todayIndex].date : days[0].date;
              setFocusedDate(initialDate);
              setMonthCursorDate(monthAnchor(initialDate));
            } else {
              // Keep focusedDate set by the ?bookingId= handler; just stop
              // treating this as the initial load.
              isInitialLoad.current = false;
            }
          }
          setSelectedServiceId((current) => (current !== null && services.some((service) => service.id === current) ? current : null));

          // If we arrived here via ?bookingId=..., focus the booking's date and
          // open its details once it's present in the loaded window.
          const pendingId = pendingBookingIdRef.current;
          if (pendingId) {
            const match = days
              .flatMap((d) => d.appointments.map((a) => ({ day: d, appointment: a })))
              .find(({ appointment }) => appointment.id === pendingId);
            if (match) {
              setFocusedDate(match.day.date);
              setMonthCursorDate(monthAnchor(match.day.date));
              setViewMode("day");
              setSelectedAppointmentId(pendingId);
              pendingBookingIdRef.current = null;
              pendingBookingDateRef.current = null;
            }
          }
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
          categoryNameById: current.categoryNameById,
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
              categoryNameById: current.categoryNameById,
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
              categoryNameById: current.categoryNameById,
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

    // If focusedDate is in the future but outside the loaded window, reload
    // instead of resetting to the first day (which jumps back to June).
    const today = toIsoDate(new Date());
    const hasFocusedDate = calendarState.days.some((day) => day.date === focusedDate);
    if (!hasFocusedDate && focusedDate > today) {
      setReloadKey((k) => k + 1);
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

    return formatDateRangeLabel(viewDays[0].date, viewDays[viewDays.length - 1].date);
  }, [viewDays]);

  const boardFootStats = useMemo(() => {
    if (calendarState.kind !== "ready") {
      return { appointmentCount: 0, openSlotCount: 0 };
    }
    const appointmentCount = viewDays.reduce((sum, day) => sum + day.appointments.length, 0);
    const openSlotCount = viewDays.reduce((sum, day) => sum + day.openings.length, 0);
    return { appointmentCount, openSlotCount };
  }, [calendarState, viewDays]);

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

  // Per-provider appointment counts across the current view (for filter badges).
  const providerAppointmentCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const day of viewDays) {
      for (const appointment of day.appointments) {
        map.set(appointment.providerId, (map.get(appointment.providerId) ?? 0) + 1);
      }
    }
    return map;
  }, [viewDays]);
  const totalProviderAppointmentCount = useMemo(
    () => Array.from(providerAppointmentCounts.values()).reduce((sum, n) => sum + n, 0),
    [providerAppointmentCounts],
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
    focusDate.setUTCDate(focusDate.getUTCDate() + step);
    setFocusedDate(toIsoDate(focusDate));
  };

  const handleSelectAppointment = (appointmentId: string) => {
    setSelectedAppointmentId(appointmentId);
    setSelectedTimeBlockId(null);
    setSelectedSlot(null);
  };

  const handleToggleCheckIn = (appointmentId: string) => {
    setCheckedInBookingIds((current) => {
      const next = new Set(current);
      if (next.has(appointmentId)) {
        next.delete(appointmentId);
      } else {
        next.add(appointmentId);
      }
      return next;
    });
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

    const search = combineCustomerName(selectedSlotCustomer.firstName, selectedSlotCustomer.lastName);
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
  }, [api, selectedSlot, selectedSlotCustomer.firstName, selectedSlotCustomer.lastName]);

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
    setSelectedSlotCustomer({ firstName: "", lastName: "", email: "", phone: "", referredBy: "" });
    setSelectedSlotBlockDurationMinutes(getDurationMinutes(slot.startAt, slot.endAt));
    setCustomerLookupState({ kind: "idle" });
    setDraftCreationState({ kind: "idle" });
  };

  const handleNewBooking = () => {
    if (calendarState.kind !== "ready") {
      return;
    }
    const provider = allKnownProviderOptions[0] ?? null;
    const startMinute = (displayStartHour ?? 9) * 60;
    const startAt = toTenantDateTimeIso(focusedDate, startMinute);
    const endAt = toTenantDateTimeIso(focusedDate, startMinute + 60);
    handleRequestCalendarSlot({
      date: focusedDate,
      providerId: provider?.id ?? null,
      providerName: provider?.name ?? null,
      startAt,
      endAt,
      openings: [],
      providerOptions: allKnownProviderOptions,
    });
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
    setFocusedDate(dateValue);
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
    const { firstName, lastName } = splitCustomerName(customer.name);
    setSelectedSlotCustomer((current) => ({
      firstName,
      lastName,
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      referredBy: current.referredBy,
    }));
    setCustomerLookupState({ kind: "ready", items: [customer] });
    setDraftCreationState({ kind: "idle" });
  };

  const handleCreateSlotCustomer = async () => {
    const name = combineCustomerName(selectedSlotCustomer.firstName, selectedSlotCustomer.lastName).trim();
    const email = selectedSlotCustomer.email.trim();
    const phone = selectedSlotCustomer.phone.trim();
    if (!name || !email || !phone) {
      return;
    }
    setCustomerCreateState({ kind: "submitting" });
    try {
      const result = await api.createOrUpdateCustomer({
        name,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
      });
      setCustomerCreateState({ kind: "success", customerId: result.customerId });
    } catch (error) {
      setCustomerCreateState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to create the client.",
      });
    }
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
    const referredBy = selectedSlotCustomer.referredBy.trim();
    const customer = {
      name: combineCustomerName(selectedSlotCustomer.firstName, selectedSlotCustomer.lastName),
      email: selectedSlotCustomer.email.trim(),
      phone: selectedSlotCustomer.phone.trim(),
      ...(referredBy ? { referredBy } : {}),
    };
    if (selectedSlot === null || selectedSlot.providerId === null || selectedSlotServiceId === null || !customer.name || !customer.email || !customer.phone) {
      return;
    }

    const isAvailable = isSlotWithinAvailability(selectedSlot.openings, selectedSlot.providerId, selectedSlotServiceId, selectedSlot.startAt);
    if (!isAvailable) {
      const serviceName = selectedSlotServiceOptions.find((service) => service.id === selectedSlotServiceId)?.name ?? "this appointment type";
      const providerName = selectedSlot.providerName ?? "This provider";
      const confirmed = window.confirm(
        `${providerName} is not usually available for ${serviceName} at this time — it falls outside their normal working hours. Book this appointment anyway?`,
      );
      if (!confirmed) {
        return;
      }
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
        ...(isAvailable ? {} : { overrideAvailability: true }),
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

  const handleCompleteAppointment = async (appointment: SelectedCalendarAppointment, resolution: "collected" | "waived" = "collected") => {
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
      // Keep drawer open so operator can see the no-show fee
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
        <div className="cs-toolbar" role="toolbar" aria-label="Calendar controls">
          <div className="cs-toolbar__title-group">
            <div className="cs-range">{visibleDateRangeLabel || "Calendar"}</div>
            <div className="cs-stepper">
              <button
                type="button"
                className="cs-today"
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
                onClick={() => moveFocus(viewMode === "day" ? -1 : -7)}
                disabled={calendarState.kind !== "ready"}
                aria-label="Previous"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => moveFocus(viewMode === "day" ? 1 : 7)}
                disabled={calendarState.kind !== "ready"}
                aria-label="Next"
              >
                ›
              </button>
            </div>
          </div>

          <div className="cs-toolbar__controls">
            {calendarState.kind === "ready" && calendarState.services.length > 0 ? (
              <div className="avail-context" style={{ position: "relative" }}>
                <button
                  type="button"
                  className="cs-select"
                  onClick={() => setAvailMenuOpen((prev) => !prev)}
                  aria-expanded={availMenuOpen}
                  aria-label="Availability for"
                >
                  <span className="cs-select__label">Availability for</span>
                  <span className="cs-select__value">
                    {selectedServiceId
                      ? calendarState.services.find((s) => s.id === selectedServiceId)?.name ?? "Any service"
                      : "Any service"}
                  </span>
                  <span className="cs-select__caret" aria-hidden="true">▾</span>
                </button>
                {availMenuOpen ? (
                  <div
                    className="cs-menu"
                    role="menu"
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      left: 0,
                      zIndex: 40,
                      minWidth: 280,
                    }}
                  >
                    <div className="cs-menu__label">Availability for</div>
                    <button
                      type="button"
                      className={`cs-menu__item${!selectedServiceId ? " cs-menu__item--selected" : ""}`}
                      role="menuitemradio"
                      aria-checked={!selectedServiceId}
                      onClick={() => { setSelectedServiceId(null); setAvailMenuOpen(false); }}
                    >
                      <span>Any service</span>
                    </button>
                    <div className="cs-menu__rule" aria-hidden="true" />
                    {calendarState.services.map((service) => {
                      const checked = selectedServiceId === service.id;
                      return (
                        <button
                          key={service.id}
                          type="button"
                          className={`cs-menu__item${checked ? " cs-menu__item--selected" : ""}`}
                          role="menuitemradio"
                          aria-checked={checked}
                          onClick={() => { setSelectedServiceId(service.id); setAvailMenuOpen(false); }}
                        >
                          <span
                            className="cs-menu__swatch"
                            style={{ background: swatchForService(service.name, null) }}
                            aria-hidden="true"
                          />
                          <span>{service.name}</span>
                          <span className="cs-menu__count">{service.durationMinutes}m</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {viewMode === "week" && weekProviderOptions.length > 0 ? (
              <div className="context" style={{ position: "relative" }}>
                <button
                  type="button"
                  className="cs-select cs-select--ink"
                  onClick={() => setContextMenuOpen((prev) => !prev)}
                  aria-expanded={contextMenuOpen}
                  aria-label="Staff filter"
                >
                  <span className="cs-select__value">
                    {selectedWeekProviderId
                      ? weekProviderOptions.find((x) => x.id === selectedWeekProviderId)?.name ?? "All staff"
                      : "All staff"}
                  </span>
                  <span className="cs-staff-count" aria-hidden="true">
                    {weekProviderOptions.length}
                  </span>
                  <span className="cs-select__plus" aria-hidden="true">+</span>
                </button>
                {contextMenuOpen ? (
                  <div
                    className="cs-menu"
                    role="menu"
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      right: 0,
                      zIndex: 40,
                      minWidth: 260,
                    }}
                  >
                    <button
                      type="button"
                      className={`cs-menu__item${!selectedWeekProviderId ? " cs-menu__item--selected" : ""}`}
                      role="menuitemradio"
                      aria-checked={!selectedWeekProviderId}
                      onClick={() => { handleSelectWeekProvider(null); setContextMenuOpen(false); }}
                    >
                      <span className="cs-menu__check" aria-checked={!selectedWeekProviderId} aria-hidden="true">
                        {!selectedWeekProviderId ? "✓" : null}
                      </span>
                      <span>All staff</span>
                      <span className="cs-menu__count">{totalProviderAppointmentCount}</span>
                    </button>
                    <div className="cs-menu__rule" aria-hidden="true" />
                    {weekProviderOptions.map((provider) => {
                      const checked = selectedWeekProviderId === provider.id;
                      const count = providerAppointmentCounts.get(provider.id) ?? 0;
                      return (
                        <button
                          key={provider.id}
                          type="button"
                          className={`cs-menu__item${checked ? " cs-menu__item--selected" : ""}`}
                          role="menuitemradio"
                          aria-checked={checked}
                          onClick={() => { handleSelectWeekProvider(provider.id); setContextMenuOpen(false); }}
                        >
                          <span className="cs-menu__check" aria-checked={checked} aria-hidden="true">
                            {checked ? "✓" : null}
                          </span>
                          <span
                            className="cs-menu__avatar"
                            style={{ background: swatchForProvider(provider.id) }}
                            aria-hidden="true"
                          >
                            {provider.imageUrl ? (
                              <img src={provider.imageUrl} alt="" />
                            ) : (
                              <span className="cs-menu__avatar-initial">{getInitials(provider.name)}</span>
                            )}
                          </span>
                          <span>{provider.name}</span>
                          <span className="cs-menu__count">{count}</span>
                        </button>
                      );
                    })}
                    <div className="cs-menu__rule" aria-hidden="true" />
                    <button
                      type="button"
                      className="cs-menu__item"
                      role="menuitem"
                      onClick={() => setContextMenuOpen(false)}
                    >
                      <span className="cs-menu__check" aria-hidden="true" />
                      <span>Unassigned &amp; blocks</span>
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="cs-viewswitch" role="group" aria-label="Calendar view mode">
              <button
                type="button"
                onClick={() => setViewMode("day")}
                aria-pressed={viewMode === "day"}
              >
                Day
              </button>
              <button
                type="button"
                onClick={() => setViewMode("week")}
                aria-pressed={viewMode === "week"}
              >
                Week
              </button>
            </div>
            <button type="button" className="cs-cta" onClick={handleNewBooking}>
              New booking
              <span className="cs-cta__plus" aria-hidden="true">+</span>
            </button>
          </div>
        </div>

        <CalendarBoard
          state={calendarState}
          days={viewDays}
          viewMode={viewMode}
          selectedAppointmentId={selectedAppointmentId}
          intakeStatusByBookingId={intakeStatusByBookingId}
          checkedInBookingIds={checkedInBookingIds}
          selectedWeekProviderId={selectedWeekProviderId}
          selectedWeekProviderName={selectedWeekProvider?.name ?? null}
          fallbackProviderOptions={allKnownProviderOptions}
          timeBlockDurationMinutes={selectedService?.durationMinutes ?? 60}
          onSelectAppointment={handleSelectAppointment}
          timeBlocks={timeBlocks}
          selectedTimeBlockId={selectedTimeBlockId}
          onSelectTimeBlock={handleSelectTimeBlock}
          onRequestCalendarSlot={handleRequestCalendarSlot}
          providerTimeOffs={providerTimeOffs}
          selectedTimeOffId={selectedTimeOffId}
          onSelectTimeOff={setSelectedTimeOffId}
          displayStartHour={displayStartHour}
          displayEndHour={displayEndHour}
        />
        {calendarState.kind === "ready" ? (
          <div className="cs-boardfoot">
            <div className="cs-boardfoot__stats">
              <div className="cs-boardfoot__now">Now, {nowTimeFormatter.format(new Date())}</div>
              <div className="cs-boardfoot__meta">
                {boardFootStats.appointmentCount} appointments {viewMode === "day" ? "today" : "this week"} · {boardFootStats.openSlotCount} open slots
              </div>
            </div>
            <div className="cs-boardfoot__cue">Click any empty slot to book →</div>
          </div>
        ) : null}
      </section>
      {sidebarRailHost ? null : <div className="calendar-fallback-month-rail">{monthRail}</div>}
      {createPortal(
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
          customerCreateState={customerCreateState}
          blockDurationMinutes={selectedSlotBlockDurationMinutes}
          onCustomerFieldChange={handleUpdateSlotCustomerField}
          onApplyCustomer={handleApplySlotCustomer}
          onCreateCustomer={() => void handleCreateSlotCustomer()}
          onNotesChange={setSelectedSlotNotes}
          onBookAppointment={() => void handleCreateDraftFromSlot()}
          onAddTimeBlock={handleAddTimeBlockFromSlot}
        />,
        document.body,
      )}
      {createPortal(
        <AppointmentDetailsDrawer
          selectedAppointment={selectedAppointment}
          formResponsesState={formResponsesState}
          intakeStatus={selectedAppointment ? (intakeStatusByBookingId[selectedAppointment.id] ?? "unknown") : "unknown"}
          formReminderState={formReminderState}
          onSendFormReminder={handleSendFormReminder}
          checkedIn={selectedAppointment ? checkedInBookingIds.has(selectedAppointment.id) : false}
          onToggleCheckIn={selectedAppointment ? () => handleToggleCheckIn(selectedAppointment.id) : undefined}
          services={calendarState.kind === "ready" ? calendarState.services : []}
          providers={calendarState.kind === "ready" ? calendarState.providers : []}
          categoryNameById={calendarState.kind === "ready" ? calendarState.categoryNameById : undefined}
          onClose={handleCloseAppointmentDrawer}
          onComplete={handleCompleteAppointment}
          onNoShow={handleNoShowAppointment}
          onUpdate={handleUpdateAppointment}
          onNavigateToDate={(date) => {
            setFocusedDate(date);
            setViewMode("day");
          }}
          onCancel={handleCancelAppointment}
          onUpdateCustomerNotes={handleUpdateCustomerNotes}
          onUpdateCustomerContact={handleUpdateCustomerContact}
          completionState={completionState}
          api={api}
          tenantSlug={tenantSlug}
          storefrontBaseUrl={storefrontBaseUrl}
          customPaymentMethods={customPaymentMethods}
          onPaymentRecorded={() => setReloadKey((k) => k + 1)}
        />,
        document.body,
      )}
      {createPortal(
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
        />,
        document.body,
      )}
      {createPortal(
        <TimeOffDetailsDrawer
          timeOff={selectedTimeOffId ? providerTimeOffs.find((t) => t.id === selectedTimeOffId) ?? null : null}
          onClose={() => setSelectedTimeOffId(null)}
          onSave={async (id, updates) => {
            const to = providerTimeOffs.find((t) => t.id === id);
            if (!to) return;
            await platformApi.updateProviderTimeOff(tenantSlug, to.providerId, id, updates);
            setSelectedTimeOffId(null);
            setReloadKey((k) => k + 1);
          }}
          onDelete={async (id) => {
            const to = providerTimeOffs.find((t) => t.id === id);
            if (!to) return;
            await platformApi.deleteProviderTimeOff(tenantSlug, to.providerId, id);
            setSelectedTimeOffId(null);
            setReloadKey((k) => k + 1);
          }}
        />,
        document.body,
      )}
    </main>
  );
}

// ===========================================================================
// Time-off details drawer — read-only view of a blocked date / override
// ===========================================================================

function TimeOffDetailsDrawer({
  timeOff,
  onClose,
  onSave,
  onDelete,
}: {
  timeOff: ProviderTimeOffEntry | null;
  onClose: () => void;
  onSave: (id: string, updates: { startsAt: string; endsAt: string; reason: string | null; overrideType: string; startTime: string | null; endTime: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  if (!timeOff) return null;

  const startD = new Date(timeOff.startsAt);
  const endD = new Date(timeOff.endsAt);
  const sameDay = startD.toISOString().split("T")[0] === endD.toISOString().split("T")[0];
  const fmtD = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const isCustom = timeOff.overrideType === "custom_hours";

  const [editing, setEditing] = useState(false);
  const [startDate, setStartDate] = useState(startD.toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(endD.toISOString().split("T")[0]);
  const [reason, setReason] = useState(timeOff.reason || "");
  const [allDay, setAllDay] = useState(timeOff.overrideType === "closed");
  const [startTime, setStartTime] = useState(timeOff.startTime || "09:00");
  const [endTime, setEndTime] = useState(timeOff.endTime || "17:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(timeOff.id, {
        startsAt: `${startDate}T00:00:00.000Z`,
        endsAt: `${endDate}T23:59:59.000Z`,
        reason: reason.trim() || null,
        overrideType: allDay ? "closed" : "custom_hours",
        startTime: allDay ? null : normalizeTime(startTime),
        endTime: allDay ? null : normalizeTime(endTime),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await onDelete(timeOff.id);
    } catch {
      setSaving(false);
    }
  };

  return (
    <>
      <button type="button" className="appointment-drawer-backdrop" aria-label="Close time off details" onClick={onClose} />
      <aside className="appointment-details-drawer" role="dialog" aria-label="Time off details">
        <header className="appointment-details-drawer__header">
          <span className="appointment-status-chip" style={{ background: "var(--ui-ivory)", color: "var(--ui-ink-soft)" }}>
            <span aria-hidden="true" />
            {isCustom ? "Override shift" : "Blocked date"}
          </span>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {!editing ? (
              <>
                <button type="button" className="appointment-drawer-outline-action" onClick={() => setEditing(true)}>Edit</button>
                <button type="button" className="appointment-drawer-outline-action" onClick={handleDelete} disabled={saving}
                  style={{ color: "var(--ui-danger)", borderColor: "var(--ui-sand)" }}>Delete</button>
              </>
            ) : null}
            <button type="button" className="ghost-action" onClick={onClose} aria-label="Close">×</button>
          </div>
        </header>
        <div className="booking-rail__body" style={{ padding: "0 1rem 1rem" }}>
          {editing ? (
            <>
              <section className="booking-rail-section">
                <div className="booking-rail-section__label">Dates</div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <input type="date" className="svc-input" style={{ width: "140px" }}
                    value={startDate} aria-label="Start date"
                    onChange={(e) => setStartDate(e.target.value)} />
                  <span style={{ color: "var(--ui-muted)", fontSize: "12px" }}>to</span>
                  <input type="date" className="svc-input" style={{ width: "140px" }}
                    value={endDate} aria-label="End date"
                    onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </section>
              <section className="booking-rail-section">
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--ui-ink)", cursor: "pointer" }}>
                  <input type="checkbox" checked={allDay}
                    onChange={(e) => setAllDay(e.target.checked)} />
                  Block all day
                </label>
                {!allDay ? (
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "6px" }}>
                    <input type="text" className="svc-input" style={{ width: "80px", textAlign: "center" }}
                      value={startTime} placeholder="09:00" aria-label="Start time"
                      onChange={(e) => setStartTime(e.target.value)} />
                    <span style={{ color: "var(--ui-muted)", fontSize: "12px" }}>to</span>
                    <input type="text" className="svc-input" style={{ width: "80px", textAlign: "center" }}
                      value={endTime} placeholder="17:00" aria-label="End time"
                      onChange={(e) => setEndTime(e.target.value)} />
                  </div>
                ) : null}
              </section>
              <section className="booking-rail-section">
                <div className="booking-rail-section__label">Reason</div>
                <input type="text" className="svc-input" style={{ width: "100%" }}
                  value={reason} placeholder="e.g. Vacation"
                  onChange={(e) => setReason(e.target.value)} />
              </section>
              {error ? (
                <div role="alert" style={{ padding: "8px 10px", background: "var(--ui-danger-soft)", borderRadius: "6px", fontSize: "12px", color: "var(--ui-danger)", marginTop: "8px" }}>
                  {error}
                </div>
              ) : null}
              <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                <button type="button" className="svc-save-btn" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </button>
                <button type="button" className="svc-text-btn" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <section className="booking-rail-section">
                <div className="booking-rail-section__label">Type</div>
                <div style={{ fontSize: "13px", color: "var(--ui-ink)" }}>
                  {isCustom ? "Custom hours override" : "Full-day block"}
                </div>
              </section>
              <section className="booking-rail-section">
                <div className="booking-rail-section__label">Date</div>
                <div style={{ fontSize: "13px", color: "var(--ui-ink)" }}>
                  {sameDay ? fmtD(startD) : `${fmtD(startD)} – ${fmtD(endD)}`}
                </div>
              </section>
              {isCustom && timeOff.startTime ? (
                <section className="booking-rail-section">
                  <div className="booking-rail-section__label">Time</div>
                  <div style={{ fontSize: "13px", color: "var(--ui-ink)" }}>
                    {timeOff.startTime} – {timeOff.endTime}
                  </div>
                </section>
              ) : null}
              {timeOff.reason ? (
                <section className="booking-rail-section">
                  <div className="booking-rail-section__label">Reason</div>
                  <div style={{ fontSize: "13px", color: "var(--ui-ink)" }}>{timeOff.reason}</div>
                </section>
              ) : null}
              <section className="booking-rail-section">
                <div className="booking-rail-section__label">Duration</div>
                <div style={{ fontSize: "13px", color: "var(--ui-ink)" }}>
                  {sameDay ? "1 day" : `${Math.ceil((endD.getTime() - startD.getTime()) / 86400000) + 1} days`}
                </div>
              </section>
            </>
          )}
        </div>
      </aside>
    </>
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
  // Determine the visible week around focusedDate (Sun-Sat) so we can mark
  // `.cs-minical__day--inweek` per proof.html.
  const focused = parseIsoDate(focusedDate);
  const focusedDow = (focused.getUTCDay() + 6) % 7; // Monday = 0
  const weekStart = new Date(focused);
  weekStart.setUTCDate(focused.getUTCDate() - focusedDow);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  const inWeek = (iso: string): boolean => {
    const d = parseIsoDate(iso);
    return d >= weekStart && d <= weekEnd;
  };
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  return (
    <div className="cs-minical" aria-label="Month calendar">
      <div className="cs-minical__head">
        <div className="cs-minical__month">{monthLabelFormatter.format(parseIsoDate(monthCursorDate))}</div>
        <div className="cs-minical__nav">
          <button type="button" onClick={onPreviousMonth} aria-label="Previous month">‹</button>
          <button type="button" onClick={onNextMonth} aria-label="Next month">›</button>
        </div>
      </div>
      <div className="cs-minical__grid" role="grid">
        {monthDayLabel.map((label) => (
          <div key={label} className="cs-minical__dow">{label}</div>
        ))}
        {monthGrid.map((date) => {
          const dayData = monthDatesByDay.get(date);
          const isInCurrentMonth = date.slice(0, 7) === monthCursorDate.slice(0, 7);
          const isFocused = date === focusedDate;
          const isToday = date === todayIso;
          const isInVisibleWeek = inWeek(date);
          const cls = [
            "cs-minical__day",
            !isInCurrentMonth ? "cs-minical__day--out" : "",
            isToday ? "cs-minical__day--today" : "",
            !isToday && isInVisibleWeek ? "cs-minical__day--inweek" : "",
          ].filter(Boolean).join(" ");
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              disabled={!isInCurrentMonth && !dayData}
              aria-pressed={isFocused}
              aria-label={getDateLabel(date)}
              className={cls}
              onClick={() => onSelectDate(date)}
            >
              {parseIsoDate(date).getUTCDate()}
            </button>
          );
        })}
      </div>
    </div>
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

// Derive chip family (mint/lilac/pink/blue/peach) from the service. Highly
// specific service-name keywords (microneedling, xerf, laser, peel, consult,
// brow) win over category-name matches — in demo data a "Facials" category
// contains microneedling/XERF, so the specific service signal must dominate.
// Matches the design contract in club-sunday.css (`.cs-chip--{family}`).
function getChipFamily(serviceName: string | null | undefined, categoryName: string | null | undefined): string {
  const cat = (categoryName ?? "").toLowerCase();
  const svc = (serviceName ?? "").toLowerCase();

  // 1. Specific service-name keywords (most authoritative signal).
  if (svc.includes("consult")) return "cs-chip--consult";
  if (svc.includes("microneedl") || svc.includes("xerf") || svc.includes(" rf") || svc.startsWith("rf") || svc.includes("advanced")) return "cs-chip--advanced";
  if (svc.includes("laser") || svc.includes("peel")) return "cs-chip--laser";
  if (svc.includes("brow")) return "cs-chip--studio";

  // 2. Category name (operator-curated grouping).
  if (cat.includes("consult")) return "cs-chip--consult";
  if (cat.includes("advanced") || cat.includes("needling") || cat.includes(" rf") || cat.startsWith("rf")) return "cs-chip--advanced";
  if (cat.includes("laser") || cat.includes("peel")) return "cs-chip--laser";
  if (cat.includes("brow") || cat.includes("studio")) return "cs-chip--studio";
  if (cat.includes("facial")) return "cs-chip--facial";

  // 3. Generic service-name keywords.
  if (svc.includes("facial") || svc.includes("glow") || svc.includes("hydration")) return "cs-chip--facial";

  return "cs-chip--facial";
}

// Family swatch hex (matches --cs-mint / --cs-lilac / --cs-pink / --cs-blue /
// --cs-peach in club-sunday.css). Used by the filter dropdowns for the small
// colored dot next to a service or provider name.
const FAMILY_SWATCH: Record<string, string> = {
  "cs-chip--facial": "#DFEBE1",
  "cs-chip--advanced": "#E8E3F5",
  "cs-chip--laser": "#F7E0E4",
  "cs-chip--consult": "#DEE7F3",
  "cs-chip--studio": "#F6DFCE",
};
function swatchForService(name: string, category?: string | null): string {
  return FAMILY_SWATCH[getChipFamily(name, category)] ?? "#F0EDEA";
}
const PROVIDER_SWATCH_PALETTE = ["#DFEBE1", "#F7E0E4", "#E8E3F5", "#DEE7F3", "#F6DFCE"];
function swatchForProvider(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return PROVIDER_SWATCH_PALETTE[Math.abs(h) % PROVIDER_SWATCH_PALETTE.length];
}

function CalendarBoard({
  state,
  days,
  viewMode,
  selectedAppointmentId,
  intakeStatusByBookingId,
  checkedInBookingIds,
  selectedWeekProviderId,
  selectedWeekProviderName,
  fallbackProviderOptions,
  timeBlockDurationMinutes,
  onSelectAppointment,
  timeBlocks,
  selectedTimeBlockId,
  onSelectTimeBlock,
  onRequestCalendarSlot,
  providerTimeOffs,
  selectedTimeOffId,
  onSelectTimeOff,
  displayStartHour,
  displayEndHour,
}: {
  state: CalendarDataState;
  days: CalendarDay[];
  viewMode: CalendarViewMode;
  selectedAppointmentId: string | null;
  intakeStatusByBookingId: Record<string, IntakeStatus>;
  checkedInBookingIds: Set<string>;
  selectedWeekProviderId: string | null;
  selectedWeekProviderName: string | null;
  fallbackProviderOptions: CalendarProviderOption[];
  timeBlockDurationMinutes: number;
  onSelectAppointment: (appointmentId: string) => void;
  timeBlocks: CalendarTimeBlock[];
  selectedTimeBlockId: string | null;
  onSelectTimeBlock: (blockId: string) => void;
  onRequestCalendarSlot: (slot: PendingCalendarSlot) => void;
  providerTimeOffs: ProviderTimeOffEntry[];
  selectedTimeOffId: string | null;
  onSelectTimeOff: (id: string | null) => void;
  displayStartHour?: number;
  displayEndHour?: number;
}) {
  const boardBodyRef = useRef<HTMLDivElement | null>(null);

  // §4: land the board on "now" on mount — scroll the board body so the
  // current time sits one row below the top (clamped to 0).
  useEffect(() => {
    if (state.kind !== "ready") {
      return;
    }

    const startHour = Math.min(24, Math.max(0, Math.round(displayStartHour ?? 9)));
    let endHour = Math.min(24, Math.max(0, Math.round(displayEndHour ?? 19)));
    if (endHour <= startHour) {
      endHour = Math.min(24, startHour + SCHEDULE_MIN_VISIBLE_HOURS);
    }

    const parts = tenantTimePartsFormatter.formatToParts(new Date());
    const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const nowMinutes = hh * 60 + mm;

    if (nowMinutes < startHour * 60 || nowMinutes > endHour * 60) {
      return; // "now" is outside the displayed range; nothing to scroll to
    }

    const rowHpx = viewMode === "day" ? SCHEDULE_DAY_HOUR_HEIGHT_PX : SCHEDULE_HOUR_HEIGHT_PX;
    const nowTopPx = ((nowMinutes - startHour * 60) / 60) * rowHpx;
    const el = boardBodyRef.current;
    if (el) {
      el.scrollTop = Math.max(0, nowTopPx - rowHpx);
    }
  }, [state.kind, viewMode, displayStartHour, displayEndHour]);

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
  // Generate half-hour labels: "9 AM", "9:30", "10 AM", "10:30", etc.
  const halfHourLabels: string[] = [];
  for (let h = startHour; h < endHour; h++) {
    halfHourLabels.push(formatHourLabel(h));
    halfHourLabels.push("");
  }
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
  const todayIsoTenant = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  const nowMinutesTenant = (() => {
    const parts = tenantTimePartsFormatter.formatToParts(new Date());
    const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return hh * 60 + mm;
  })();
  const scheduleStartMinuteGlobal = startHour * 60;
  const scheduleEndMinuteGlobal = endHour * 60;
  // STRUCTURE.md §1: week ROW_H=64, day ROW_H=72. --cs-row-h is set by CSS
  // (default 64, .cs-board--day override 72); JS must use the same value so
  // --top / --h stay pinned to the CSS grid.
  const rowHpx = viewMode === "day" ? SCHEDULE_DAY_HOUR_HEIGHT_PX : SCHEDULE_HOUR_HEIGHT_PX;
  // CSS defaults: week --cs-hours: 9, day --cs-hours: 7. Only override when the
  // tenant range differs. Same for --provider-count on day view.
  const boardStyle: CSSProperties = {} as CSSProperties;
  const defaultCsHours = viewMode === "day" ? 7 : 9;
  if (totalHours !== defaultCsHours) {
    (boardStyle as Record<string, string | number>)["--cs-hours"] = totalHours;
  }
  if (viewMode === "day") {
    (boardStyle as Record<string, string | number>)["--provider-count"] = dayCount;
  }
  const boardClass = [
    "cs-board",
    viewMode === "day" ? "cs-board--day" : "",
    viewMode === "day" && dayCount > 6 ? "cs-board--scroll" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const padHour = (h: number) => `${String(h).padStart(2, "0")}:00`;
  // Chip geometry per STRUCTURE.md §1.
  //   top = ((startMin - DAY_START) / 60) * ROW_H
  //   h   = (durationMin / 60) * ROW_H - GAP
  const chipTop = (startMinutes: number): number =>
    ((startMinutes - scheduleStartMinuteGlobal) / 60) * rowHpx;
  const chipHeight = (durationMinutes: number): number =>
    Math.max(SCHEDULE_MIN_EVENT_HEIGHT_PX, (durationMinutes / 60) * rowHpx - SCHEDULE_CHIP_GAP_PX);

  return (
    <div className="cs-boardcard" aria-label="Scheduled appointments">
      <div className={boardClass} style={boardStyle}>
        <div className="cs-board__head">
          <div />
          {scheduleColumns.map((column) => {
            const isToday = column.date === todayIsoTenant;
            if (viewMode === "day" && column.providerId) {
              // Day view head cell = provider identity per STRUCTURE.md §4
              return (
                <div key={column.key} className="cs-provider">
                  <span className="cs-provider__avatar" aria-hidden="true">
                    {column.providerImageUrl ? <img src={column.providerImageUrl} alt="" /> : null}
                  </span>
                  <div>
                    <div className="cs-provider__name">{column.providerName ?? column.heading}</div>
                    <div className="cs-provider__role">{column.providerName ? "Provider" : column.heading}</div>
                  </div>
                </div>
              );
            }
            // Week view head cell = day label
            return (
              <div
                key={column.key}
                className={`cs-daylabel${isToday ? " cs-daylabel--today" : ""}`}
                aria-label={column.subheading ? `${column.heading} ${column.subheading} column` : `${column.heading} column`}
              >
                <div className="cs-daylabel__dow">{column.heading}</div>
                {column.subheading ? <div className="cs-daylabel__date">{column.subheading}</div> : null}
              </div>
            );
          })}
        </div>

        <div className="cs-board__body" ref={boardBodyRef}>
          <div className="cs-gutter" aria-hidden="true">
            {Array.from({ length: totalHours }, (_, i) => (
              <div key={i} className="cs-gutter__hour">{padHour(startHour + i)}</div>
            ))}
          </div>

          {scheduleColumns.map((column) => {
            const scheduleStartMinute = startHour * 60;
            const scheduleEndMinute = endHour * 60;
            const isToday = column.date === todayIsoTenant;
            const hatchSegments: { top: number; h: number }[] = [];
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
              const target = event.target as HTMLElement;
              if (target.closest(".cs-hatch") || target.closest(".cs-chip")) {
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

            let fullyClosed = false;
            if (column.availableSegments.length > 0) {
              // STRUCTURE.md §C: .cs-hatch is ONLY for turnover gaps and lunch
              // INSIDE a working column. Pre-first-opening and post-last-opening
              // regions are just empty grid, not hatched.
              const segs = column.availableSegments;
              for (let i = 0; i < segs.length - 1; i++) {
                const gapStart = Math.max(scheduleStartMinute, segs[i]!.endMinute);
                const gapEnd = Math.min(scheduleEndMinute, segs[i + 1]!.startMinute);
                if (gapEnd > gapStart) {
                  hatchSegments.push({
                    top: ((gapStart - scheduleStartMinute) / 60) * rowHpx,
                    h: ((gapEnd - gapStart) / 60) * rowHpx - SCHEDULE_CHIP_GAP_PX,
                  });
                }
              }
            } else if (column.openings.length === 0 && column.appointments.length === 0) {
              const hasTimeOffBlocks = column.providerId !== undefined && providerTimeOffs.some((to) => {
                const toDate = to.startsAt.split("T")[0];
                const toEndDate = to.endsAt.split("T")[0];
                return column.date >= toDate && column.date <= toEndDate;
              });
              if (!hasTimeOffBlocks) {
                fullyClosed = true;
              }
            }

            const colClass = [
              "cs-col",
              isToday ? "cs-col--today" : "",
              fullyClosed ? "cs-col--closed" : "",
            ].filter(Boolean).join(" ");

            // STRUCTURE.md §1: concurrent bookings share the column width via
            // --lane / --lanes. Compute overlap clusters once per column.
            const appointmentLanes = computeAppointmentLanes(column.appointments);

            return (
              <div
                key={column.key}
                className={colClass}
                role={isInteractiveTrack && !fullyClosed ? "button" : undefined}
                aria-label={trackLabel}
                onClick={fullyClosed ? undefined : handleTrackClick}
              >
                {fullyClosed ? (
                  <div className="cs-col__notice cs-col__notice--vertical">
                    {column.heading ? `${column.heading} closed` : "Closed"}
                  </div>
                ) : null}
                {hatchSegments.map((segment, index) => (
                  <div
                    key={`hatch-${index}`}
                    className="cs-hatch"
                    aria-hidden="true"
                    style={{ "--top": segment.top, "--h": Math.max(SCHEDULE_MIN_EVENT_HEIGHT_PX, segment.h) } as CSSProperties}
                  />
                ))}
                {isToday && nowMinutesTenant >= scheduleStartMinuteGlobal && nowMinutesTenant <= scheduleEndMinuteGlobal ? (
                  <div
                    className="cs-now"
                    aria-hidden="true"
                    style={{ "--top": ((nowMinutesTenant - scheduleStartMinuteGlobal) / 60) * rowHpx } as CSSProperties}
                  />
                ) : null}
                {(column.providerId !== undefined || viewMode === "week")
                  ? timeBlocks
                      .filter((block) => block.date === column.date && (column.providerId === undefined || block.providerId === column.providerId))
                      .map((block) => {
                        const isSelected = block.id === selectedTimeBlockId;
                        const startMinutes = minutesInTenantDay(block.startAt);
                        const rawEndMinutes = minutesInTenantDay(block.endAt);
                        const endMinutes = rawEndMinutes > startMinutes ? rawEndMinutes : startMinutes + 15;
                        const durationMinutes = Math.max(15, endMinutes - startMinutes);
                        const top = chipTop(startMinutes);
                        const h = chipHeight(durationMinutes);
                        return (
                          <button
                            key={block.id}
                            type="button"
                            className={`cs-chip cs-chip--block${isSelected ? " cs-chip--selected" : ""}`}
                            aria-label={`Time block ${formatDateTime(block.startAt)} with ${block.providerName}`}
                            aria-pressed={isSelected}
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectTimeBlock(block.id);
                            }}
                            style={{ "--top": top, "--h": h } as CSSProperties}
                          >
                            <span className="cs-chip__time">{formatTimeRange(block.startAt, block.endAt)}</span>
                            <span className="cs-chip__client">{`Time block · ${block.providerName}`}</span>
                          </button>
                        );
                      })
                  : null}
                {/* Provider custom_hours overrides render as hatched turnover blocks. */}
                {(column.providerId !== undefined || viewMode === "week")
                  ? providerTimeOffs
                      .filter((to) => {
                        if (to.overrideType !== "custom_hours") return false;
                        if (column.providerId !== undefined && to.providerId !== column.providerId) return false;
                        const toDate = to.startsAt.split("T")[0];
                        const toEndDate = to.endsAt.split("T")[0];
                        return column.date >= toDate && column.date <= toEndDate;
                      })
                      .map((to) => {
                        const isAllDay = to.overrideType === "closed";
                        // startTime/endTime are wall-clock "HH:MM" strings in the
                        // tenant timezone; parse them directly (not via a UTC
                        // datetime) so the block lands on the correct hour.
                        const startMinutes = isAllDay ? 0 : (getMinutesFromTimeInput(to.startTime ?? "") ?? 0);
                        const endMinutes = isAllDay ? 24 * 60 : (getMinutesFromTimeInput(to.endTime ?? "") ?? 24 * 60);
                        const durationMinutes = Math.max(15, endMinutes - startMinutes);
                        const top = chipTop(startMinutes);
                        const h = chipHeight(durationMinutes);
                        const label = to.reason || (to.overrideType === "custom_hours" ? "Override" : "Blocked");
                        const isSelected = to.id === selectedTimeOffId;
                        return (
                          <div
                            key={`to-${to.id}`}
                            role="button"
                            tabIndex={0}
                            className={`cs-hatch${isSelected ? " cs-hatch--selected" : ""}`}
                            aria-label={`${label} ${isAllDay ? "all day" : `${to.startTime || ""} – ${to.endTime || ""}`}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectTimeOff(isSelected ? null : to.id);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                onSelectTimeOff(isSelected ? null : to.id);
                              }
                            }}
                            style={{ "--top": top, "--h": h } as CSSProperties}
                          >
                            {label}
                          </div>
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
                  const durationMinutes = Math.max(15, endMinutes - startMinutes);
                  const top = chipTop(startMinutes);
                  const h = chipHeight(durationMinutes);
                  // Short appointments (<= 30 min) get a compact chip that
                  // drops the treatment line so the time + client still fit.
                  const isShort = durationMinutes <= 30;

                  const nowMs = Date.now();
                  const isInProgress =
                    appointment.status === "confirmed" &&
                    new Date(appointment.startAt).getTime() <= nowMs &&
                    nowMs < new Date(appointment.endAt).getTime();
                  const isCheckedIn = checkedInBookingIds.has(appointment.id);

                  // Derive chip family from the service's category (falls back
                  // to service-name keywords when category is unset).
                  const bookedService = state.services.find((candidate) => candidate.id === appointment.serviceId);
                  const bookedCategoryName = bookedService?.categoryId
                    ? state.categoryNameById[bookedService.categoryId] ?? null
                    : null;
                  const bookedFamily = getChipFamily(appointment.serviceName, bookedCategoryName);

                  const familyClass =
                    appointment.status === "completed" ? "cs-chip--completed" :
                    appointment.status === "canceled" || appointment.status === "no_show" ? "cs-chip--block" :
                    isInProgress || isCheckedIn ? "cs-chip--inprogress" :
                    bookedFamily;

                  const laneInfo = appointmentLanes.get(appointment.id);

                  return (
                    <button
                      key={appointment.id}
                      type="button"
                      className={`cs-chip ${familyClass}${isShort ? " cs-chip--short" : ""}${isSelected ? " cs-chip--selected" : ""}`}
                      aria-label={`View ${appointment.customerName} booked ${formatDateTime(appointment.startAt)} with ${appointment.providerName}. ${intakeLabel}.`}
                      aria-pressed={isSelected}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectAppointment(appointment.id);
                      }}
                      style={{
                        "--top": top,
                        "--h": h,
                        ...(laneInfo ? { "--lane": laneInfo.lane, "--lanes": laneInfo.lanes } : {}),
                      } as CSSProperties}
                    >
                      {isInProgress || isCheckedIn ? (
                        <span className="cs-chip__live">
                          <span />
                          <span>{isInProgress ? "IN ROOM" : "CHECKED IN"}</span>
                        </span>
                      ) : null}
                      <span className="cs-chip__time">
                        {formatTimeRange(appointment.startAt, appointment.endAt)}
                      </span>
                      {isShort ? (
                        <span className="cs-chip__treatment">{appointment.serviceName}</span>
                      ) : (
                        <>
                          <span className="cs-chip__client">{appointment.customerName}</span>
                          <span className="cs-chip__treatment">{appointment.serviceName}</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
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
  customerCreateState: CustomerCreateState;
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
  onCreateCustomer: () => void;
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
  customerCreateState,
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
  onCreateCustomer,
  onNotesChange,
  onBookAppointment,
  onAddTimeBlock,
}: SlotActionDrawerProps): ReactElement | null {
  const slotKey = selectedSlot
    ? `${selectedSlot.date}|${selectedSlot.providerId ?? ""}|${selectedSlot.startAt}`
    : null;
  const [mode, setMode] = useState<"appointment" | "time-block">("appointment");
  const [showDatePopover, setShowDatePopover] = useState(false);
  const [showTimeInput, setShowTimeInput] = useState(false);
  const [manualNewClient, setManualNewClient] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<
    { id: string; name: string; email?: string | null; phone?: string | null } | null
  >(null);
  const appliedCreatedCustomerIdRef = useRef<string | null>(null);
  const [showTreatmentMenu, setShowTreatmentMenu] = useState(false);
  const [pickerMonth, setPickerMonth] = useState<string>(monthAnchor(getUpcomingDate(1)));
  const pickerGrid = useMemo(() => buildMonthGrid(pickerMonth), [pickerMonth]);
  const datePickerContainerRef = useRef<HTMLDivElement | null>(null);
  const treatmentMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setMode("appointment");
    setShowDatePopover(false);
    setShowTimeInput(false);
    setManualNewClient(false);
    setSelectedCustomer(null);
    appliedCreatedCustomerIdRef.current = null;
    setShowTreatmentMenu(false);
  }, [slotKey]);
  // When a brand-new client is successfully created via the manual form, promote
  // them into the locked-in profile card so the operator sees the same UI as
  // when picking an existing client from search results.
  useEffect(() => {
    if (customerCreateState.kind !== "success") return;
    if (!manualNewClient) return;
    if (appliedCreatedCustomerIdRef.current === customerCreateState.customerId) return;
    const combinedName = `${customer.firstName.trim()} ${customer.lastName.trim()}`.trim();
    if (!combinedName) return;
    appliedCreatedCustomerIdRef.current = customerCreateState.customerId;
    setSelectedCustomer({
      id: customerCreateState.customerId,
      name: combinedName,
      email: customer.email.trim() || null,
      phone: customer.phone.trim() || null,
    });
    setManualNewClient(false);
  }, [customerCreateState, manualNewClient, customer.firstName, customer.lastName, customer.email, customer.phone]);
  useEffect(() => {
    if (!showTreatmentMenu) return;
    const handler = (event: Event) => {
      const target = event.target as Node;
      if (treatmentMenuRef.current && !treatmentMenuRef.current.contains(target)) {
        setShowTreatmentMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTreatmentMenu]);
  useEffect(() => {
    if (!showDatePopover) return;
    const handler = (event: Event) => {
      const target = event.target as Node;
      if (datePickerContainerRef.current && !datePickerContainerRef.current.contains(target)) {
        setShowDatePopover(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDatePopover]);

  if (selectedSlot === null) {
    return null;
  }

  const isAppointmentMode = mode === "appointment";
  const hasProvider = selectedSlot.providerId !== null;
  const selectedService = serviceOptions.find((service) => service.id === selectedServiceId) ?? null;
  const appointmentEndAt = selectedService ? addMinutesToTenantIso(selectedSlot.startAt, selectedService.durationMinutes) : selectedSlot.endAt;
  const blockEndAt = addMinutesToTenantIso(selectedSlot.startAt, blockDurationMinutes);
  const hasRequiredCustomer = Boolean(customer.firstName.trim() && customer.lastName.trim() && customer.email.trim() && customer.phone.trim());
  const isSlotAvailableForService = isSlotWithinAvailability(selectedSlot.openings, selectedSlot.providerId, selectedServiceId, selectedSlot.startAt);
  const canCreateDraft =
    hasProvider && selectedServiceId !== null && hasRequiredCustomer && draftCreationState.kind !== "submitting";
  const canAddTimeBlock = hasProvider && blockedServiceIds.length > 0;
  const headingTimeRange = isAppointmentMode ? formatTimeRange(selectedSlot.startAt, appointmentEndAt) : formatTimeRange(selectedSlot.startAt, blockEndAt);

  return (
    <>
      <button type="button" className="appointment-drawer-backdrop" aria-label="Close calendar slot actions" onClick={onClose} />
      <aside className="appointment-details-drawer slot-action-drawer cs-drawer-shim" role="dialog" aria-label="Calendar slot actions">
        <div className="cs-drawer__inner">
          {/* Header */}
          <div className="cs-drawer__head">
            <div>
              <div className="cs-drawer__kicker">{isAppointmentMode ? "New booking" : "New time block"}</div>
              <div className="cs-drawer__title">
                {getDateLabel(selectedSlot.date)} · {timeFormatter.format(new Date(selectedSlot.startAt))}
              </div>
              <div className="cs-drawer__meta">
                {[
                  selectedSlot.providerName ?? "Any provider",
                  isAppointmentMode ? headingTimeRange : `${formatDuration(blockDurationMinutes)} block`,
                ].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button type="button" className="cs-drawer__close" onClick={onClose} aria-label="Close">×</button>
          </div>

          {/* Mode toggle */}
          <div className="cs-seg" role="tablist" aria-label="Slot action mode">
            <button type="button" aria-pressed={isAppointmentMode} onClick={() => setMode("appointment")}>Appointment</button>
            <button type="button" aria-pressed={!isAppointmentMode} onClick={() => setMode("time-block")}>Time block</button>
          </div>

          {isAppointmentMode ? (
            <>
              {/* Client */}
              {(() => {
                const searchValue = customer.firstName;
                const trimmedSearch = searchValue.trim();
                const hasSearchQuery = trimmedSearch.length > 0;
                const lookupReady = customerLookupState.kind === "ready";
                const lookupItems = lookupReady ? customerLookupState.items : [];
                const showEmptyState = lookupReady && lookupItems.length === 0 && trimmedSearch.length >= 2;

                // Locked-in client: show a clean profile card instead of the search field.
                if (selectedCustomer !== null) {
                  const contactLines = [selectedCustomer.email, selectedCustomer.phone].filter(Boolean).join(" · ");
                  return (
                    <div>
                      <div className="cs-section__label">Client</div>
                      <div className="cs-panel" style={{ padding: 14 }}>
                        <div className="cs-clientrow">
                          <span className="cs-clientrow__avatar" aria-hidden="true">{getInitials(selectedCustomer.name)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="cs-clientrow__name">{selectedCustomer.name}</div>
                            <div className="cs-clientrow__meta">{contactLines || "No contact info"}</div>
                          </div>
                          <button
                            type="button"
                            className="cs-btn cs-btn--sm cs-btn--ghost"
                            onClick={() => {
                              setSelectedCustomer(null);
                              onCustomerFieldChange("firstName", "");
                              onCustomerFieldChange("lastName", "");
                              onCustomerFieldChange("email", "");
                              onCustomerFieldChange("phone", "");
                            }}
                          >
                            Change
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                if (manualNewClient) {
                  const canCreateClient =
                    customer.firstName.trim().length > 0 &&
                    customer.lastName.trim().length > 0 &&
                    customer.email.trim().length > 0 &&
                    customer.phone.trim().length > 0;
                  const isCreating = customerCreateState.kind === "submitting";
                  return (
                    <div>
                      <div className="cs-section__label">Add new client</div>
                      <div className="cs-panel" style={{ padding: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                          <div style={{ fontWeight: 600, fontSize: 12, color: "var(--cs-ink)" }}>Client details</div>
                          <button
                            type="button"
                            className="cs-btn cs-btn--sm cs-btn--ghost"
                            onClick={() => setManualNewClient(false)}
                          >
                            Back to search
                          </button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <input className="cs-input" placeholder="First name" value={customer.firstName} onChange={(event) => onCustomerFieldChange("firstName", event.target.value)} autoComplete="off" />
                          <input className="cs-input" placeholder="Last name" value={customer.lastName} onChange={(event) => onCustomerFieldChange("lastName", event.target.value)} autoComplete="off" />
                          <input className="cs-input" placeholder="Phone" value={customer.phone} onChange={(event) => onCustomerFieldChange("phone", event.target.value)} inputMode="tel" autoComplete="tel" />
                          <input className="cs-input" placeholder="Email" value={customer.email} onChange={(event) => onCustomerFieldChange("email", event.target.value)} inputMode="email" autoComplete="email" />
                        </div>
                        <button
                          type="button"
                          className="cs-btn cs-btn--primary"
                          style={{ width: "100%", marginTop: 12 }}
                          disabled={!canCreateClient || isCreating}
                          onClick={onCreateCustomer}
                        >
                          {isCreating
                            ? "Creating client…"
                            : customerCreateState.kind === "success"
                            ? "Client created"
                            : "Create client"}
                        </button>
                        {customerCreateState.kind === "error" ? (
                          <div className="message-banner message-banner--error" role="alert" style={{ marginTop: 8 }}>
                            {customerCreateState.message}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                }
                return (
                  <div>
                    <div className="cs-section__label">Client</div>
                    <input
                      className="cs-input"
                      placeholder="Search clients — type a name"
                      value={searchValue}
                      onChange={(event) => onCustomerFieldChange("firstName", event.target.value)}
                      autoComplete="off"
                    />
                    {hasSearchQuery ? (
                      <div style={{ marginTop: 8, background: "var(--cs-canvas)", borderRadius: 20, padding: 6 }}>
                        {lookupItems.slice(0, 4).map((lookupCustomer) => {
                          const contactLines = [
                            lookupCustomer.email,
                            lookupCustomer.phone,
                          ].filter(Boolean).join(" · ");
                          return (
                            <button
                              key={lookupCustomer.id}
                              type="button"
                              className="cs-choice"
                              onClick={() => {
                                setSelectedCustomer(lookupCustomer);
                                onApplyCustomer(lookupCustomer);
                              }}
                            >
                              <span className="cs-choice__avatar" aria-hidden="true">{getInitials(lookupCustomer.name)}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="cs-choice__name">{lookupCustomer.name}</div>
                                <div className="cs-choice__meta">{contactLines || "Client record"}</div>
                              </div>
                            </button>
                          );
                        })}
                        {showEmptyState ? (
                          <div className="cs-choice" style={{ cursor: "default" }} aria-live="polite">
                            <div style={{ flex: 1, minWidth: 0, padding: "2px 6px" }}>
                              <div className="cs-choice__meta">No clients match &ldquo;{trimmedSearch}&rdquo;.</div>
                            </div>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className="cs-choice"
                          onClick={() => setManualNewClient(true)}
                        >
                          <span className="cs-choice__avatar cs-choice__avatar--new" aria-hidden="true">+</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="cs-choice__name">Add new client</div>
                            <div className="cs-choice__meta">Enter name, phone, and email</div>
                          </div>
                        </button>
                      </div>
                    ) : null}
                    {customerLookupState.kind === "loading" ? (
                      <div className="slot-customer-lookup-note" role="status" style={{ marginTop: 8 }}>Searching clients…</div>
                    ) : null}
                    {customerLookupState.kind === "error" ? (
                      <div className="message-banner message-banner--error" role="alert" style={{ marginTop: 8 }}>{customerLookupState.message}</div>
                    ) : null}
                  </div>
                );
              })()}

              {/* Treatment (custom dropdown with sage-green active state) */}
              <div>
                <div className="cs-section__label">Treatment</div>
                <div className="cs-select-wrap" ref={treatmentMenuRef}>
                  <button
                    type="button"
                    className={`cs-select-trigger${selectedService ? " cs-select-trigger--active" : ""}`}
                    onClick={() => setShowTreatmentMenu((prev) => !prev)}
                    disabled={serviceOptions.length === 0}
                    aria-haspopup="listbox"
                    aria-expanded={showTreatmentMenu}
                    aria-label="Treatment"
                  >
                    <span className="cs-select-trigger__label">
                      {selectedService?.name ?? (serviceOptions.length === 0 ? "No appointment types available" : "Choose a treatment…")}
                    </span>
                    <span className="cs-select-trigger__chevron" aria-hidden="true">▾</span>
                  </button>
                  {showTreatmentMenu && serviceOptions.length > 0 ? (
                    <div className="cs-select-menu" role="listbox">
                      {serviceOptions.map((service) => {
                        const isSelected = service.id === selectedServiceId;
                        return (
                          <button
                            key={service.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={`cs-select-option${isSelected ? " cs-select-option--selected" : ""}`}
                            onClick={() => {
                              onSelectService(service.id);
                              setShowTreatmentMenu(false);
                            }}
                          >
                            {service.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
                  <div className="cs-stat">
                    <div className="cs-stat__label">Duration</div>
                    <div className="cs-stat__value">{selectedService ? formatDuration(selectedService.durationMinutes) : "—"}</div>
                  </div>
                  <div className="cs-stat">
                    <div className="cs-stat__label">Ends</div>
                    <div className="cs-stat__value">{selectedService ? timeFormatter.format(new Date(appointmentEndAt)) : "—"}</div>
                  </div>
                  <div className="cs-stat">
                    <div className="cs-stat__label">Price</div>
                    <div className="cs-stat__value">{selectedService ? formatPriceCents(selectedService.priceCents) : "—"}</div>
                  </div>
                </div>
              </div>

              {/* Notes for the team */}
              <div>
                <div className="cs-section__label">Notes for the team</div>
                <textarea
                  className="cs-note cs-note--input"
                  value={notes}
                  onChange={(event) => onNotesChange(event.target.value)}
                  placeholder="Add context for this client or appointment."
                  rows={3}
                />
              </div>

              {/* Alerts */}
              {selectedServiceId !== null && !isSlotAvailableForService ? (
                <div className="cs-panel cs-panel--peach cs-alert" role="alert">
                  <span className="cs-alert__icon" aria-hidden="true">!</span>
                  <div className="cs-alert__body">
                    {selectedSlot.providerName ?? "This provider"} is not usually available for {selectedService?.name ?? "the selected service"} at this time. You can still book it, but you'll be asked to confirm the override.
                  </div>
                </div>
              ) : null}
              {draftCreationState.kind === "error" ? (
                <div className="message-banner message-banner--error" role="alert">{draftCreationState.message}</div>
              ) : null}
              {draftCreationState.kind === "success" ? (
                <div className="cs-panel cs-panel--success cs-alert" role="status">
                  <span className="cs-alert__icon" aria-hidden="true" style={{ background: "var(--cs-ok-text)" }}>✓</span>
                  <div className="cs-alert__body">Booking draft created and slot held for 15 minutes.</div>
                </div>
              ) : null}
            </>
          ) : (
            <>
              {/* Time block — minimal styling, functional */}
              <div>
                <div className="cs-section__label">Block window</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <label className="cs-slot-field">
                    <span>Start date</span>
                    <input type="date" className="cs-input" value={getTenantDate(selectedSlot.startAt)} onChange={(event) => onStartDateChange(event.target.value)} />
                  </label>
                  <label className="cs-slot-field">
                    <span>Start time</span>
                    <input type="time" className="cs-input" value={formatTimeInputValue(selectedSlot.startAt)} onChange={(event) => onStartTimeChange(event.target.value)} />
                  </label>
                  <label className="cs-slot-field">
                    <span>End date</span>
                    <input type="date" className="cs-input" value={getTenantDate(blockEndAt)} onChange={(event) => onBlockEndChange(event.target.value, formatTimeInputValue(blockEndAt))} />
                  </label>
                  <label className="cs-slot-field">
                    <span>End time</span>
                    <input type="time" className="cs-input" value={formatTimeInputValue(blockEndAt)} onChange={(event) => onBlockEndChange(getTenantDate(blockEndAt), event.target.value)} />
                  </label>
                </div>
              </div>

              <div>
                <div className="cs-section__label">Notes for the team</div>
                <textarea className="cs-note cs-note--input" value={notes} onChange={(event) => onNotesChange(event.target.value)} placeholder="Add staff-facing context for this block." rows={3} />
              </div>

              <div>
                <div className="cs-section__label">Appointment types to block</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {serviceOptions.map((service) => {
                    const active = blockedServiceIds.includes(service.id);
                    return (
                      <button key={service.id} type="button" className={`cs-tag${active ? " cs-tag--selected" : ""}`} onClick={() => onToggleBlockedService(service.id)}>
                        {service.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Change-date popover (unchanged UX) */}
          {showDatePopover ? (
            <div ref={datePickerContainerRef} className="appointment-drawer-date-popover">
              <div className="month-rail__header">
                <h5>{monthLabelFormatter.format(parseIsoDate(pickerMonth))}</h5>
                <div className="month-rail__controls">
                  <button type="button" className="filter-chip" onClick={() => setPickerMonth(addMonths(pickerMonth, -1))}>Prev</button>
                  <button type="button" className="filter-chip" onClick={() => setPickerMonth(addMonths(pickerMonth, 1))}>Next</button>
                </div>
              </div>
              <div className="month-grid-labels" role="presentation">{monthDayLabel.map((label) => (<span key={label}>{label}</span>))}</div>
              <div className="month-grid" role="grid">
                {pickerGrid.map((date) => {
                  const isInCurrentMonth = date.slice(0, 7) === pickerMonth.slice(0, 7);
                  const isSelected = date === selectedSlot.date;
                  return (
                    <button
                      key={date}
                      type="button"
                      role="gridcell"
                      disabled={!isInCurrentMonth}
                      aria-pressed={isSelected}
                      aria-label={getDateLabel(date)}
                      className={["month-day", !isInCurrentMonth ? "month-day--outside" : "", isSelected ? "month-day--focused" : ""].filter(Boolean).join(" ")}
                      onClick={() => { onStartDateChange(date); setShowDatePopover(false); }}
                    >
                      <span>{parseIsoDate(date).getUTCDate()}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {showTimeInput ? (
            <input
              type="time"
              className="appointment-drawer-time-input"
              value={formatTimeInputValue(selectedSlot.startAt)}
              onChange={(event) => { onStartTimeChange(event.target.value); setShowTimeInput(false); }}
              autoFocus
              onBlur={() => setShowTimeInput(false)}
              onKeyDown={(event) => { if (event.key === "Enter") setShowTimeInput(false); }}
            />
          ) : null}
        </div>

        {/* Footer */}
        <div className="cs-drawer__foot">
          <div className="cs-actions">
            <button type="button" className="cs-btn" onClick={onClose}>Cancel</button>
            {isAppointmentMode ? (
              <button
                type="button"
                className="cs-btn cs-btn--primary"
                onClick={onBookAppointment}
                disabled={!canCreateDraft || draftCreationState.kind === "success"}
              >
                {draftCreationState.kind === "submitting"
                  ? "Creating draft…"
                  : draftCreationState.kind === "success"
                  ? "Draft created"
                  : "Book & send confirmation"}
              </button>
            ) : (
              <button type="button" className="cs-btn cs-btn--primary" onClick={onAddTimeBlock} disabled={!canAddTimeBlock}>
                Add time block
              </button>
            )}
          </div>
          {draftHref && draftCreationState.kind === "success" ? (
            <a className="cs-btn cs-btn--ghost" href={draftHref} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 8, textDecoration: "none" }}>
              Open draft in storefront
            </a>
          ) : null}
          {/* Hidden button to trigger date/time popovers from the drawer header */}
          <div style={{ display: "flex", gap: 12, marginTop: 8, justifyContent: "flex-end" }}>
            <button type="button" className="cs-btn cs-btn--ghost" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => { setPickerMonth(monthAnchor(selectedSlot.date)); setShowDatePopover((prev) => !prev); }}>Change date</button>
            <button type="button" className="cs-btn cs-btn--ghost" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => setShowTimeInput(true)}>Change time</button>
          </div>
        </div>
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
          <div className="cs-panel cs-panel--success cs-alert" role="status">
            <span className="cs-alert__icon" aria-hidden="true" style={{ background: "var(--cs-ok-text)" }}>✓</span>
            <div className="cs-alert__body">Booking draft created and slot held for 15 minutes.</div>
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
            <a className="secondary-action" href={draftHref} target="_blank" rel="noopener noreferrer">
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
  checkedIn?: boolean;
  onToggleCheckIn?: () => void;
  services: ServiceSummary[];
  providers: CalendarProviderOption[];
  categoryNameById?: Record<string, string>;
  onClose: () => void;
  onComplete: (appointment: SelectedCalendarAppointment, resolution?: "collected" | "waived") => Promise<void>;
  onNoShow: (appointment: SelectedCalendarAppointment) => Promise<void>;
  onUpdate?: (appointment: SelectedCalendarAppointment, body: UpdateBookingRequest) => Promise<void>;
  onNavigateToDate?: (date: string) => void;
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
  checkedIn = false,
  onToggleCheckIn,
  services,
  providers,
  categoryNameById,
  onClose,
  onComplete,
  onNoShow,
  onUpdate,
  onNavigateToDate,
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
  const [showRescheduleDatePopover, setShowRescheduleDatePopover] = useState(false);
  const [showRescheduleTimeInput, setShowRescheduleTimeInput] = useState(false);
  const [rescheduleTimeDraft, setRescheduleTimeDraft] = useState("");
  const [pendingRescheduleDate, setPendingRescheduleDate] = useState<string | null>(null);
  const [pickerMonth, setPickerMonth] = useState<string>(monthAnchor(getUpcomingDate(1)));
  const pickerGrid = useMemo(() => buildMonthGrid(pickerMonth), [pickerMonth]);
  const datePickerContainerRef = useRef<HTMLDivElement | null>(null);
  const datePopoverRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLButtonElement | null>(null);
  const [rescheduleSaveState, setRescheduleSaveState] = useState<"idle" | "submitting" | "error">("idle");
  const [rescheduleErrorMessage, setRescheduleErrorMessage] = useState("");
  const [isEditingAppointmentNotes, setIsEditingAppointmentNotes] = useState(false);
  const [appointmentNotesDraft, setAppointmentNotesDraft] = useState("");
  const [appointmentNotesSaveState, setAppointmentNotesSaveState] = useState<"idle" | "submitting" | "error">("idle");
  const [appointmentNotesError, setAppointmentNotesError] = useState("");
  const [isEditingCustomerNotes, setIsEditingCustomerNotes] = useState(false);
  const [customerNotesDraft, setCustomerNotesDraft] = useState("");
  const [customerNotesSaveState, setCustomerNotesSaveState] = useState<"idle" | "submitting" | "error">("idle");
  const [customerNotesError, setCustomerNotesError] = useState("");
  const [isEditingCustomerContact, setIsEditingCustomerContact] = useState(false);
  const [showCustomerOverlay, setShowCustomerOverlay] = useState(false);
  const [customerProfileForOverlay, setCustomerProfileForOverlay] = useState<CustomerProfileResponse | null>(null);
  const [customerOverlayTab, setCustomerOverlayTab] = useState<"history" | "forms" | "photos" | "notes" | "messages">("history");


  const [customerContactDraft, setCustomerContactDraft] = useState({ name: "", email: "", phone: "" });
  const [customerContactSaveState, setCustomerContactSaveState] = useState<"idle" | "submitting" | "error">("idle");
  const [customerContactError, setCustomerContactError] = useState("");

  // Reset drawer view when switching appointments
  useEffect(() => {
    setDrawerView("details");
    setShowRescheduleDatePopover(false);
    setShowRescheduleTimeInput(false);
    setRescheduleTimeDraft("");
    setPendingRescheduleDate(null);
    setRescheduleSaveState("idle");
    setRescheduleErrorMessage("");
  }, [selectedAppointment?.id]);

  useEffect(() => {
    if (!showRescheduleDatePopover) return;
    const handler = (event: Event) => {
      const target = event.target as Node;
      const insideTrigger = datePickerContainerRef.current && datePickerContainerRef.current.contains(target);
      const insidePopover = datePopoverRef.current && datePopoverRef.current.contains(target);
      if (!insideTrigger && !insidePopover) {
        setShowRescheduleDatePopover(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showRescheduleDatePopover]);

  // The drawer backdrop sits on top of the page and swallows wheel events, so
  // the calendar underneath can't be scrolled to inspect a reschedule target
  // time. Forward wheel events on the backdrop to the calendar board.
  //
  // This backdrop button only exists in the DOM while selectedAppointment is
  // truthy, so a plain useEffect([]) (which only runs on this component's
  // very first mount, when selectedAppointment is still null) would attach
  // to a null ref and never retry. Use a callback ref instead so the
  // listener is (re)attached every time the backdrop node itself mounts.
  const attachBackdropWheelForwarding = useCallback((node: HTMLButtonElement | null) => {
    backdropRef.current = node;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      const board = document.querySelector<HTMLElement>('.cs-board__body');
      if (!board) return;
      e.preventDefault();
      board.scrollTop += e.deltaY;
    };
    node.addEventListener('wheel', onWheel, { passive: false });
  }, []);

  if (!selectedAppointment) {
    return null;
  }

  const selectedAppointmentClockLabel = timeFormatter.format(new Date(selectedAppointment.startAt));
  const statusLabel = getBookingStatusLabel(selectedAppointment.status);
  const isConfirmed = selectedAppointment.status === "confirmed";
  const isCompleted = selectedAppointment.status === "completed";
  const isNoShow = selectedAppointment.status === "no_show";
  const showFooter = isConfirmed || isCompleted || isNoShow;
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
            setDrawerView("details");
          }}
          onClose={onClose}
          onPaymentRecorded={onPaymentRecorded ?? (() => {})}
          onComplete={onComplete}
        />
      </>
    );
  }

  const bookedService = services.find((s) => s.id === selectedAppointment.serviceId);
  const categoryName = bookedService?.categoryId ? categoryNameById?.[bookedService.categoryId] ?? null : null;
  const chipFamily = getChipFamily(selectedAppointment.serviceName, categoryName);
  const familyBg = FAMILY_SWATCH[chipFamily] ?? "#F0EDEA";
  const familyLabel = (categoryName ?? statusLabel).toUpperCase();
  // Compact 24-hour en-dash range for the when-card ("10:00 – 11:00"),
  // matching the mockup and keeping the time on a single line next to the
  // Reschedule / Check-in actions.
  const timeRangeLabel = `${tenantTimePartsFormatter.format(new Date(selectedAppointment.startAt))} \u2013 ${tenantTimePartsFormatter.format(new Date(selectedAppointment.endAt))}`;
  // End time shown next to the editable start time. It is derived from the
  // appointment's duration so the user only edits the start time while the
  // end time stays visible and updates live.
  const appointmentDurationMinutes = getDurationMinutes(selectedAppointment.startAt, selectedAppointment.endAt);
  const rescheduleEndTime = rescheduleTimeDraft
    ? addMinutesToTimeInput(rescheduleTimeDraft, appointmentDurationMinutes)
    : formatTimeInputValue(selectedAppointment.endAt);
  const confirmRescheduleTime = async () => {
    if (!onUpdate || !rescheduleTimeDraft) return;
    const dateStr = getTenantDate(selectedAppointment.startAt);
    const newStartsAt = isoFromTenantDateAndTime(dateStr, rescheduleTimeDraft);
    if (!newStartsAt) return;
    setRescheduleSaveState("submitting");
    setRescheduleErrorMessage("");
    try {
      await onUpdate(selectedAppointment, { startsAt: newStartsAt, sendConfirmation: true });
      setRescheduleSaveState("idle");
      setShowRescheduleTimeInput(false);
    } catch (err) {
      setRescheduleSaveState("error");
      setRescheduleErrorMessage(err instanceof Error ? err.message : "Unable to reschedule.");
    }
  };
  // Clicking a date in the popover selects it, navigates the background
  // calendar to that day, and closes the popover so the date + time
  // confirmation panel in the drawer is visible. The reschedule is only
  // committed when the operator confirms via that panel.
  const selectRescheduleDate = (date: string) => {
    setPendingRescheduleDate(date);
    setRescheduleTimeDraft(formatTimeInputValue(selectedAppointment.startAt));
    setShowRescheduleTimeInput(false);
    onNavigateToDate?.(date);
  };
  // Commit the reschedule using the selected date + time.
  const confirmReschedule = async () => {
    if (!onUpdate || !pendingRescheduleDate || !rescheduleTimeDraft) return;
    const newStartsAt = isoFromTenantDateAndTime(pendingRescheduleDate, rescheduleTimeDraft);
    if (!newStartsAt) return;
    setRescheduleSaveState("submitting");
    setRescheduleErrorMessage("");
    try {
      await onUpdate(selectedAppointment, { startsAt: newStartsAt, sendConfirmation: true });
      setRescheduleSaveState("idle");
      setPendingRescheduleDate(null);
      setShowRescheduleDatePopover(false);
    } catch (err) {
      setRescheduleSaveState("error");
      setRescheduleErrorMessage(err instanceof Error ? err.message : "Unable to reschedule.");
    }
  };
  const showConsentAlert = isConfirmed && (intakeStatus === "missing" || intakeStatus === "partial");
  const consentTitle = intakeStatus === "missing" ? "Intake forms unsigned" : "Intake needs review";
  const consentBody =
    intakeStatus === "missing"
      ? "Client has not submitted the required intake forms yet."
      : "Some responses need staff attention before the visit.";
  const providerRecord = providers.find((p) => p.id === selectedAppointment.providerId);
  const subtitleParts = [selectedAppointment.serviceName];
  if (selectedAppointment.providerName) subtitleParts.push(selectedAppointment.providerName);
  const subtitle = subtitleParts.join(" · ");

  // "TODAY" / "TOMORROW" kicker for the when-card; falls back to the stored dayLabel.
  const apptDate = getTenantDate(selectedAppointment.startAt);
  const todayIso = getTenantDate(new Date().toISOString());
  const tomorrowIso = getUpcomingDate(1);
  const whenKicker =
    apptDate === todayIso ? "TODAY" : apptDate === tomorrowIso ? "TOMORROW" : selectedAppointment.dayLabel.toUpperCase();

  // Earliest successful payment date — used to annotate the "Deposit paid" line
  // ("Deposit paid 19 Aug" style, matching the mockup).
  const depositPaidDate: string | null = (() => {
    if (selectedAppointment.depositCents <= 0) return null;
    const succeeded = selectedAppointment.payments
      .filter((p) => p.status === "succeeded" && p.amountCents > 0)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    if (succeeded.length === 0) return null;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      day: "numeric",
      month: "short",
    }).format(new Date(succeeded[0].createdAt));
  })();

  const formsReady = formResponsesState.kind === "ready" ? formResponsesState : null;
  const hasFormsContent = !!formsReady && (formsReady.items.length > 0 || formsReady.requirements.length > 0);
  const showFormsPanel =
    formResponsesState.kind === "loading" ||
    formResponsesState.kind === "error" ||
    hasFormsContent ||
    showConsentAlert;

  // Load the customer's profile so the compact client card can show wallet
  // and lifetime spend, not just what's on this booking.
  // Position the reschedule date popover relative to the Reschedule button,
  // rendered through a portal so it is never clipped by the drawer's scroll
  // container.
  const reschedulePopoverStyle = (() => {
    const rect = datePickerContainerRef.current?.getBoundingClientRect();
    if (!rect) {
      return { position: "fixed" as const, top: 0, left: "auto" as const, right: 12, width: 280, zIndex: 1000 };
    }
    return {
      position: "fixed" as const,
      top: rect.bottom + 6,
      left: "auto" as const,
      right: Math.max(12, window.innerWidth - rect.right),
      width: 280,
      zIndex: 1000,
    };
  })();

  return (
    <>
      <button
        type="button"
        className="appointment-drawer-backdrop"
        aria-label="Close appointment details"
        onClick={onClose}
        // Forward the ref so we can relay wheel events to the calendar board
        // (without breaking click-outside-to-close).
        ref={attachBackdropWheelForwarding}
      />
      <aside className="appointment-details-drawer cs-drawer-shim" role="dialog" aria-label="Appointment details">
        <div className="cs-drawer__inner">
          {/* Header */}
          <div className="cs-drawer__head">
            <div style={{ minWidth: 0, flex: 1 }}>
              <span className="cs-pill" style={{ background: familyBg, color: "var(--cs-ink)" }}>{familyLabel}</span>
              <div className="cs-drawer__title" style={{ marginTop: 10 }}>{selectedAppointment.customerName}</div>
              <div className="cs-drawer__meta">{subtitle}</div>
            </div>
            <button type="button" className="cs-drawer__close" onClick={onClose} aria-label="Close">×</button>
          </div>

          {/* Today / time card with actions */}
          <div className="cs-panel cs-when-card">
            <div>
              <div className="cs-when-card__kicker">{whenKicker}</div>
              <div className="cs-when-card__time">
                {showRescheduleTimeInput ? (
                  <div className="cs-when-card__time-editor">
                    <input
                      type="time"
                      className="appointment-drawer-time-input"
                      value={rescheduleTimeDraft}
                      autoFocus
                      disabled={rescheduleSaveState === "submitting"}
                      onChange={(event) => setRescheduleTimeDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          confirmRescheduleTime();
                        } else if (event.key === "Escape") {
                          setShowRescheduleTimeInput(false);
                        }
                      }}
                    />
                    <span className="cs-when-card__time-sep" aria-hidden="true">–</span>
                    <span className="cs-when-card__time-end">{rescheduleEndTime}</span>
                    <button
                      type="button"
                      className="cs-btn cs-btn--sm cs-btn--primary"
                      disabled={rescheduleSaveState === "submitting" || !rescheduleTimeDraft}
                      onClick={confirmRescheduleTime}
                    >
                      {rescheduleSaveState === "submitting" ? "Saving…" : "Confirm"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="cs-when-card__time-btn"
                    onClick={() => {
                      setRescheduleTimeDraft(formatTimeInputValue(selectedAppointment.startAt));
                      setShowRescheduleTimeInput(true);
                      setPendingRescheduleDate(null);
                    }}
                    disabled={!isConfirmed || rescheduleSaveState === "submitting"}
                    title="Change time"
                  >
                    {timeRangeLabel}
                  </button>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "nowrap", justifyContent: "flex-end" }}>
              {isConfirmed ? (
                <div style={{ position: "relative" }} ref={datePickerContainerRef}>
                  <button
                    type="button"
                    className="cs-btn cs-btn--sm"
                    disabled={rescheduleSaveState === "submitting"}
                    onClick={() => {
                      setPickerMonth(monthAnchor(new Date(selectedAppointment.startAt).toISOString().slice(0, 10)));
                      setShowRescheduleDatePopover((prev) => !prev);
                    }}
                    aria-expanded={showRescheduleDatePopover}
                  >
                    Reschedule
                  </button>
                </div>
              ) : null}
              {isConfirmed ? (
                <button
                  type="button"
                  className={`cs-btn cs-btn--sm${checkedIn ? " cs-btn--checked" : ""}`}
                  onClick={onToggleCheckIn}
                  aria-pressed={checkedIn}
                >
                  {checkedIn ? "Checked in" : "Check in"}
                </button>
              ) : null}
            </div>
          </div>
          {rescheduleSaveState === "error" ? <p role="alert" className="settings-error">{rescheduleErrorMessage}</p> : null}
          {pendingRescheduleDate ? (
            <div className="cs-reschedule-confirm" style={{ marginTop: 12 }}>
              <div className="cs-reschedule-confirm__title">
                Move to {getDateLabel(pendingRescheduleDate)}?
              </div>
              <div className="cs-reschedule-confirm__time">
                <input
                  type="time"
                  className="appointment-drawer-time-input"
                  value={rescheduleTimeDraft}
                  disabled={rescheduleSaveState === "submitting"}
                  onChange={(event) => setRescheduleTimeDraft(event.target.value)}
                />
                <span className="cs-reschedule-confirm__sep" aria-hidden="true">–</span>
                <span className="cs-reschedule-confirm__end">
                  {rescheduleTimeDraft ? addMinutesToTimeInput(rescheduleTimeDraft, appointmentDurationMinutes) : ""}
                </span>
              </div>
              <div className="cs-reschedule-confirm__actions">
                <button
                  type="button"
                  className="cs-btn cs-btn--sm cs-btn--primary"
                  disabled={rescheduleSaveState === "submitting" || !rescheduleTimeDraft}
                  onClick={() => void confirmReschedule()}
                >
                  {rescheduleSaveState === "submitting" ? "Saving…" : "Confirm change"}
                </button>
                <button
                  type="button"
                  className="cs-btn cs-btn--sm"
                  disabled={rescheduleSaveState === "submitting"}
                  onClick={() => setPendingRescheduleDate(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {/* Consent alert (pink) */}
          {showConsentAlert ? (
            <div className="cs-panel cs-panel--tint">
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span className="cs-alert__icon" aria-hidden="true">!</span>
                <span style={{ font: "700 13px var(--cs-font)", color: "var(--cs-ink)" }}>{consentTitle}</span>
              </div>
              <div style={{ font: "500 12px/1.6 var(--cs-font)", color: "rgba(20,17,15,.6)", marginTop: 8 }}>{consentBody}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button
                  type="button"
                  className="cs-btn cs-btn--primary"
                  style={{ flex: "none", padding: "10px 16px", fontSize: 11 }}
                  onClick={() => {
                    const el = document.querySelector('[data-forms-panel="true"]');
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  Review form
                </button>
                {onSendFormReminder ? (
                  <button
                    type="button"
                    className="cs-btn cs-btn--sm cs-btn--onTint"
                    onClick={() => onSendFormReminder(selectedAppointment)}
                    disabled={formReminderState?.kind === "sending"}
                  >
                    {formReminderState?.kind === "sending" ? "Sending…" : "Resend link"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Forms completed (green) */}
          {isConfirmed && intakeStatus === "submitted" ? (
            <div className="cs-panel cs-panel--success cs-alert">
              <span className="cs-alert__icon" aria-hidden="true" style={{ background: "var(--cs-ok-text)" }}>✓</span>
              <div className="cs-alert__body">
                <span style={{ font: "700 13px var(--cs-font)", color: "var(--cs-ink)" }}>Forms complete</span>
                <div style={{ font: "500 12px/1.6 var(--cs-font)", color: "rgba(20,17,15,.6)", marginTop: 4 }}>
                  All required intake forms have been submitted.
                </div>
              </div>
            </div>
          ) : null}

          {/* Client */}
          <div>
            <div className="cs-section__label">Client</div>
            {isEditingCustomerContact ? (
              <div className="customer-notes-editor">
                <label style={{ display: "block", marginBottom: "0.5rem" }}><span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>Name</span><input type="text" value={customerContactDraft.name} onChange={(e) => setCustomerContactDraft((d) => ({ ...d, name: e.target.value }))} disabled={customerContactSaveState === "submitting"} style={{ width: "100%" }} /></label>
                <label style={{ display: "block", marginBottom: "0.5rem" }}><span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>Email</span><input type="email" value={customerContactDraft.email} onChange={(e) => setCustomerContactDraft((d) => ({ ...d, email: e.target.value }))} disabled={customerContactSaveState === "submitting"} style={{ width: "100%" }} /></label>
                <label style={{ display: "block", marginBottom: "0.5rem" }}><span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>Phone</span><input type="tel" value={customerContactDraft.phone} onChange={(e) => setCustomerContactDraft((d) => ({ ...d, phone: e.target.value }))} disabled={customerContactSaveState === "submitting"} style={{ width: "100%" }} /></label>
                <div className="customer-notes-editor__actions">
                  <button type="button" className="cs-btn cs-btn--ghost" onClick={() => { setIsEditingCustomerContact(false); setCustomerContactError(""); }} disabled={customerContactSaveState === "submitting"}>Cancel</button>
                  <button type="button" className="cs-btn cs-btn--primary" onClick={async () => { if (!onUpdateCustomerContact) return; if (!customerContactDraft.name.trim()) { setCustomerContactSaveState("error"); setCustomerContactError("Name is required."); return; } setCustomerContactSaveState("submitting"); setCustomerContactError(""); try { await onUpdateCustomerContact(selectedAppointment, { name: customerContactDraft.name.trim(), email: customerContactDraft.email.trim(), phone: customerContactDraft.phone.trim() }); setIsEditingCustomerContact(false); setCustomerContactSaveState("idle"); } catch (err) { setCustomerContactSaveState("error"); setCustomerContactError(err instanceof Error ? err.message : "Unable to save contact."); } }} disabled={customerContactSaveState === "submitting"}>{customerContactSaveState === "submitting" ? "Saving…" : "Save"}</button>
                </div>
                {customerContactSaveState === "error" ? <p role="alert" className="settings-error">{customerContactError}</p> : null}
              </div>
            ) : (
              <>
                <div className="cs-clientrow cs-clientrow--profile-card">
                  <span className="cs-clientrow__avatar cs-clientrow__avatar--round" aria-hidden="true">
                    {getInitials(selectedAppointment.customerName)}
                  </span>
                  <div className="cs-clientrow__body">
                    <div className="cs-clientrow__top">
                      <div className="cs-clientrow__identity">
                        <div className="cs-clientrow__name">{selectedAppointment.customerName}</div>
                        <div className="cs-clientrow__meta">
                          {[
                            selectedAppointment.customerPhone,
                            selectedAppointment.customerEmail,
                          ]
                            .filter(Boolean)
                            .join("  ·  ") || "No contact on file"}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="cs-btn cs-btn--sm"
                        onClick={() => {
                          setShowCustomerOverlay(true);
                          setCustomerProfileForOverlay(null);
                          if (api) {
                            void api.getCustomerProfile(tenantSlug, selectedAppointment.customerId)
                              .then(setCustomerProfileForOverlay)
                              .catch(() => {});
                          }
                        }}
                      >
                        Profile
                      </button>
                    </div>
                    <div className="cs-clientrow__stats">
                      <div className="cs-clientrow__stat cs-clientrow__stat--credits">
                        <span className="cs-clientrow__stat-label">Credits</span>
                        <span className="cs-clientrow__stat-value">–</span>
                      </div>
                      <div className="cs-clientrow__stat cs-clientrow__stat--wallet">
                        <span className="cs-clientrow__stat-label">Wallet</span>
                        <span className="cs-clientrow__stat-value">{formatMoney(selectedAppointment.walletBalanceCents ?? 0)}</span>
                      </div>
                      <div className="cs-clientrow__stat cs-clientrow__stat--lifetime">
                        <span className="cs-clientrow__stat-label">Lifetime</span>
                        <span className="cs-clientrow__stat-value">{formatMoney(selectedAppointment.amountPaidCents ?? 0)}</span>
                      </div>
                    </div>
                    <div className="cs-clientrow__chips">
                      <span
                        className="cs-clientrow__chip"
                      >
                        Forms{intakeStatus === "submitted" ? " · submitted" : intakeStatus === "partial" ? " · partial" : intakeStatus === "missing" ? " · 1 pending" : ""}
                      </span>
                      <span className="cs-clientrow__chip cs-clientrow__chip--muted" title="Before/after photos aren't stored yet. This is a placeholder for a future phase.">
                        Photos
                      </span>
                      <span className="cs-clientrow__chip cs-clientrow__chip--muted" title="Client messaging isn't implemented yet. This is a placeholder for a future phase.">
                        Messages
                      </span>
                    </div>
                    {selectedAppointment.customerNotes ? (
                      <div className="cs-clientrow__note">
                        <span className="cs-clientrow__note-label">Note for staff</span>
                        <p className="cs-clientrow__note-text">{selectedAppointment.customerNotes}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
                {isEditingCustomerNotes ? (
                  <div style={{ marginTop: 12 }}>
                    <textarea
                      className="cs-note cs-note--input"
                      value={customerNotesDraft}
                      onChange={(e) => setCustomerNotesDraft(e.target.value)}
                      rows={3}
                      placeholder="Add notes about this client..."
                      disabled={customerNotesSaveState === "submitting"}
                      autoFocus
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                      <button type="button" className="cs-btn cs-btn--sm cs-btn--ghost" onClick={() => { setIsEditingCustomerNotes(false); setCustomerNotesError(""); }} disabled={customerNotesSaveState === "submitting"}>Cancel</button>
                      <button type="button" className="cs-btn cs-btn--sm cs-btn--primary" style={{ flex: "none" }} onClick={async () => { if (!onUpdateCustomerNotes) return; setCustomerNotesSaveState("submitting"); setCustomerNotesError(""); try { await onUpdateCustomerNotes(selectedAppointment, customerNotesDraft); setIsEditingCustomerNotes(false); setCustomerNotesSaveState("idle"); } catch (err) { setCustomerNotesSaveState("error"); setCustomerNotesError(err instanceof Error ? err.message : "Unable to save notes."); } }} disabled={customerNotesSaveState === "submitting"}>{customerNotesSaveState === "submitting" ? "Saving…" : "Save"}</button>
                    </div>
                    {customerNotesSaveState === "error" ? <p role="alert" className="settings-error">{customerNotesError}</p> : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="cs-note"
                    style={{ marginTop: 12, width: "100%", border: 0, textAlign: "left", cursor: "pointer" }}
                    onClick={() => { setCustomerNotesDraft(selectedAppointment.customerNotes ?? ""); setIsEditingCustomerNotes(true); }}
                  >
                    {selectedAppointment.customerNotes ? `"${selectedAppointment.customerNotes}"` : "Add a note…"}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Payment */}
          <div>
            <div className="cs-section__label">Payment</div>
            <div className="cs-money"><span>{selectedAppointment.serviceName}</span><span>{formatMoney(selectedAppointment.priceCents)}</span></div>
            {selectedAppointment.taxCents > 0 ? (
              <div className="cs-money"><span>Tax</span><span>{formatMoney(selectedAppointment.taxCents)}</span></div>
            ) : null}
            {selectedAppointment.depositCents > 0 ? (
              <div className="cs-money cs-money--credit">
                <span>{depositPaidDate ? `Deposit paid ${depositPaidDate}` : "Deposit paid"}</span>
                <span>−{formatMoney(selectedAppointment.depositCents)}</span>
              </div>
            ) : null}
            {selectedAppointment.amountPaidCents > 0 && selectedAppointment.amountPaidCents !== selectedAppointment.depositCents ? (
              <div className="cs-money cs-money--credit"><span>Paid</span><span>−{formatMoney(selectedAppointment.amountPaidCents)}</span></div>
            ) : null}
            <div className="cs-money cs-money--total">
              <span>{selectedAppointment.balanceDueCents > 0 ? "Due at checkout" : "Paid in full"}</span>
              <span>{formatMoney(Math.max(0, selectedAppointment.balanceDueCents))}</span>
            </div>
          </div>

          {/* Forms panel — kept as operator tool for detailed review */}
          {showFormsPanel ? (
            <div data-forms-panel="true" className="booking-rail-section booking-rail-section--forms" aria-label="Intake forms">
              <FormResponsesPanel
                selectedAppointment={selectedAppointment}
                state={formResponsesState}
                intakeStatus={intakeStatus}
                reminderState={formReminderState}
                onSendReminder={onSendFormReminder ? () => onSendFormReminder(selectedAppointment) : undefined}
                onViewForm={setViewingFormEntry}
              />
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {showFooter ? (
          <div className="cs-drawer__foot">
            <div className="cs-actions">
              {isConfirmed ? (
                <>
                  <button
                    type="button"
                    className="cs-btn"
                    onClick={() => { if (onCancel && window.confirm(`Cancel this appointment for ${selectedAppointment.customerName}? This will release the slot and notify the client.`)) void onCancel(selectedAppointment); }}
                    disabled={!onCancel || completionState?.kind === "submitting"}
                  >
                    Cancel appointment
                  </button>
                  <button
                    type="button"
                    className="cs-btn cs-btn--primary"
                    onClick={() => setDrawerView("checkout")}
                    disabled={completionState?.kind === "submitting"}
                  >
                    Complete & check out
                  </button>
                </>
              ) : (
                <button type="button" className="cs-btn cs-btn--primary" onClick={() => setDrawerView("checkout")}>View sale</button>
              )}
            </div>
            {isConfirmed ? (
              <div style={{ marginTop: 8, textAlign: "right" }}>
                <button type="button" className="cs-btn cs-btn--ghost" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => void onNoShow(selectedAppointment)} disabled={completionState?.kind === "submitting"}>
                  {completionState?.kind === "submitting" ? "Saving…" : "Mark no-show"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {completionState?.kind === "error" ? (
          <div className="message-banner message-banner--error" role="alert" style={{ margin: "0 24px 12px" }}>{completionState.message}</div>
        ) : null}
      </aside>
      {showCustomerOverlay ? (
        <>
          <button
            type="button"
            className="customer-overlay__backdrop"
            aria-label="Close customer profile"
            onClick={() => setShowCustomerOverlay(false)}
          />
          <div className="customer-overlay" role="dialog" aria-label="Customer profile" aria-modal="true">
            <div className="customer-overlay__panel">
              <header className="customer-overlay__head">
                <span className="customer-overlay__avatar" aria-hidden="true">
                  {selectedAppointment.customerName.split(" ").map(p => p[0]).join("").slice(0,2).toUpperCase()}
                </span>
                <div className="customer-overlay__identity">
                  <h3 className="customer-overlay__name">{selectedAppointment.customerName}</h3>
                  <p className="customer-overlay__meta">
                    {[selectedAppointment.customerEmail, selectedAppointment.customerPhone]
                      .filter(Boolean)
                      .join("  ·  ") || "No contact on file"}
                  </p>
                  {[customerProfileForOverlay?.customer?.addressStreet, customerProfileForOverlay?.customer?.addressCity, customerProfileForOverlay?.customer?.addressState, customerProfileForOverlay?.customer?.addressZip]
                    .filter(Boolean)
                    .length > 0 ? (
                    <p className="customer-overlay__address">
                      {[
                        customerProfileForOverlay?.customer?.addressStreet,
                        customerProfileForOverlay?.customer?.addressCity,
                        customerProfileForOverlay?.customer?.addressState,
                        customerProfileForOverlay?.customer?.addressZip,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="cs-drawer__close"
                  onClick={() => setShowCustomerOverlay(false)}
                  aria-label="Close customer profile"
                >
                  ×
                </button>
              </header>

              <div className="customer-overlay__body">
                <div className="customer-overlay__tabs" role="tablist">
                  {(
                    [
                      ["history", "History"],
                      ["forms", "Forms"],
                      ["photos", "Photos"],
                      ["notes", "Notes"],
                      ["messages", "Messages"],
                    ] as const
                  ).map(([tab, label]) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={customerOverlayTab === tab}
                      className={`customer-overlay__tab${customerOverlayTab === tab ? " is-active" : ""}`}
                      onClick={() => setCustomerOverlayTab(tab)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {customerProfileForOverlay === null ? (
                  <p className="customer-overlay__loading">Loading profile…</p>
                ) : null}

                <div className="customer-overlay__footer">
                  <a className="cs-btn cs-btn--ghost" href={`/customers?customerId=${selectedAppointment.customerId}`}>
                    Open full profile
                  </a>
                  <button
                    type="button"
                    className="cs-btn cs-btn--primary"
                    onClick={() => setShowCustomerOverlay(false)}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {showRescheduleDatePopover
        ? createPortal(
            <div className="appointment-drawer-date-popover" style={reschedulePopoverStyle} ref={datePopoverRef}>
              <div className="month-rail__header">
                <h5>{monthLabelFormatter.format(parseIsoDate(pickerMonth))}</h5>
                <div className="month-rail__controls">
                  <button type="button" className="filter-chip" onClick={() => setPickerMonth(addMonths(pickerMonth, -1))}>Prev</button>
                  <button type="button" className="filter-chip" onClick={() => setPickerMonth(addMonths(pickerMonth, 1))}>Next</button>
                </div>
              </div>
              <div className="month-grid-labels" role="presentation">{monthDayLabel.map((label) => (<span key={label}>{label}</span>))}</div>
              <div className="month-grid" role="grid">
                {pickerGrid.map((date) => {
                  const isInCurrentMonth = date.slice(0, 7) === pickerMonth.slice(0, 7);
                  const currentDate = new Date(selectedAppointment.startAt).toISOString().slice(0, 10);
                  const isSelected = date === (pendingRescheduleDate ?? currentDate);
                  return (
                    <button
                      key={date}
                      type="button"
                      role="gridcell"
                      disabled={!isInCurrentMonth}
                      aria-pressed={isSelected}
                      aria-label={getDateLabel(date)}
                      className={["month-day", !isInCurrentMonth ? "month-day--outside" : "", isSelected ? "month-day--focused" : ""].filter(Boolean).join(" ")}
                      onClick={() => selectRescheduleDate(date)}
                    >
                      <span>{parseIsoDate(date).getUTCDate()}</span>
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
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
    resolution?: "collected" | "waived",
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
  // Totals: subtotal is the service price, tax is from tenant settings.
  // Tip is added by the operator. Total = subtotal + tax + tip.
  const subtotal = appointment.priceCents;
  const taxCents = appointment.taxCents ?? 0;

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
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [showDiscountPopup, setShowDiscountPopup] = useState(false);
  const [discountPopupText, setDiscountPopupText] = useState("0");
  const [editingSubtotal, setEditingSubtotal] = useState(false);
  const [subtotalText, setSubtotalText] = useState((appointment.priceCents / 100).toFixed(2));
  const [adjustedSubtotal, setAdjustedSubtotal] = useState(appointment.priceCents);
  const effectiveSubtotal = adjustedSubtotal;
  const discountCents = Math.round(effectiveSubtotal * (discountPercent / 100));
  // Recalculate tax when subtotal changes
  const taxRate = appointment.priceCents > 0 ? (appointment.taxCents ?? 0) / appointment.priceCents : 0;
  const adjustedTaxCents = Math.round(effectiveSubtotal * taxRate);
  const total = effectiveSubtotal + adjustedTaxCents + tipCents - discountCents;
  const remainingBalance = Math.max(total - totalPaid, 0);
  const setTipFromPercent = (percent: number) => {
    setTipPercent(percent);
    const tip = Math.round((effectiveSubtotal * percent) / 100);
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
  const [isReadOnly, setIsReadOnly] = useState(appointment.status === "completed");
  const [wasReopened, setWasReopened] = useState(false);
  const [paymentStep, setPaymentStep] = useState<"methods" | "register">("methods");
  const [showWalletPopup, setShowWalletPopup] = useState(false);
  const [walletApplyText, setWalletApplyText] = useState("");

  const builtinMethods = [
    { id: "cash", label: "Cash", description: "Drawer count", tone: "neutral" },
    { id: "external_pos", label: "External POS", description: "Enter exact amount", tone: "peach" },
    { id: "manual", label: "Manual / Card", description: "Card or other", tone: "lilac" },
  ];
  const allMethods = [...builtinMethods, ...localCustomMethods];

  const paymentMethodDescription = (methodId: string): string =>
    builtinMethods.find((method) => method.id === methodId)?.description ?? "Custom payment method";
  const paymentMethodTone = (methodId: string): string =>
    builtinMethods.find((method) => method.id === methodId)?.tone ?? "neutral";

  const labelForPayment = (p: BookingPaymentSummary): string => {
    if (p.checkoutSessionKind && p.checkoutSessionKind.includes("deposit")) return "Deposit";
    if (p.paymentMethodType === "wallet") return "Wallet credit";
    if (p.paymentMethodType === "no_show_fee") return "No-show fee";
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
      setPaymentStep("methods");
      const newRemaining = Math.max(total - updatedPayments.reduce((s, p) => s + p.amountCents, 0), 0);
      setState(newRemaining <= 0 ? "success" : "idle");
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "Payment recording failed.");
      setSelectedMethod(null);
      setPaymentStep("methods");
    }
  };

  const handleApplyWallet = async () => {
    const applyCents = Math.round(parseFloat(walletApplyText) * 100);
    if (isNaN(applyCents) || applyCents <= 0 || applyCents > Math.min(appointment.walletBalanceCents, remainingBalance)) return;
    setState("submitting");
    setErrorMessage("");
    try {
      const updated = await api.applyWalletCredit(tenantSlug, appointment.id, { amountCents: applyCents });
      const updatedPayments = (updated.payments ?? []).filter(
        (p) => p.status === "succeeded" && p.amountCents > 0,
      );
      setPayments(updatedPayments);
      const newRemaining = Math.max(total - updatedPayments.reduce((s, p) => s + p.amountCents, 0), 0);
      setState(newRemaining <= 0 ? "success" : "idle");
      setShowWalletPopup(false);
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
    const updated = [...localCustomMethods, { id, label }];
    setLocalCustomMethods(updated);
    setNewMethodLabel("");
    setShowAddMethod(false);
    // Persist to tenant settings
    api.updateTenantSettings(tenantSlug, { customPaymentMethods: updated }).catch(() => {});
  };

  const handleWaive = () => {
    if (window.confirm("Waive the remaining balance and complete this booking?")) {
      void onComplete(appointment, "waived");
    }
  };

  const handleComplete = () => {
    const result = onComplete(appointment);
    if (result instanceof Promise) {
      result.then(() => {
        setSaleCompleted(true);
        setIsReadOnly(true);
      });
    } else {
      setSaleCompleted(true);
      setIsReadOnly(true);
    }
  };

  const handleReopenSale = () => {
    if (window.confirm("Re-open this sale for adjustments? The original sale record is preserved in the audit log. Any changes will be tracked.")) {
      setIsReadOnly(false);
      setWasReopened(true);
    }
  };

  const handleSendPaymentLink = async () => {
    setState("submitting");
    setErrorMessage("");
    try {
      const storefrontBaseUrl = import.meta.env.VITE_PUBLIC_STOREFRONT_BASE_URL ?? "http://127.0.0.1:3001";
      const checkoutSession = await api.createCheckoutSession({
        tenantSlug,
        bookingId: appointment.id,
        kind: "booking_balance",
        successUrl: `${storefrontBaseUrl}/cancel/${appointment.customerManageToken}/payment?sessionId={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${storefrontBaseUrl}/cancel/${appointment.customerManageToken}/payment`,
      });
      const paymentLink = `${storefrontBaseUrl}/cancel/${appointment.customerManageToken}/payment?sessionId=${checkoutSession.sessionId}`;
      await navigator.clipboard.writeText(paymentLink);
      setState("idle");
      window.alert(`Payment link copied to clipboard:\n${paymentLink}`);
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to create payment link.");
    }
  };

  const isSettled = remainingBalance <= 0;

  return (
    <aside className="appointment-details-drawer checkout-panel" role="dialog" aria-label="Checkout">
      <header className="appointment-details-drawer__header checkout-panel__header">
        <div className="checkout-panel__heading">
          <p className="checkout-panel__kicker">Complete appointment</p>
          <h3 className="checkout-panel__name">{appointment.customerName}</h3>
          <p className="checkout-panel__subtitle">
            {appointment.providerName} · {appointment.dayLabel} · {timeFormatter.format(new Date(appointment.startAt))}
          </p>
        </div>
        <div className="checkout-panel__header-actions">
          <button
            type="button"
            className="checkout-panel__back"
            onClick={onBack}
            aria-label="Back to appointment details"
          >
            ←
          </button>
          <button
            type="button"
            className="checkout-panel__close"
            onClick={onClose}
            aria-label="Close checkout"
          >
            ×
          </button>
        </div>
      </header>
      <div className="checkout-panel__body">
        <section className="checkout-panel__totals">
          <div className="checkout-panel__totals-row">
            <span className="checkout-panel__line-item-name">{appointment.serviceName}</span>
            {!isReadOnly ? (
              editingSubtotal ? (
                <span className="checkout-panel__editable-price">
                  <input
                    type="text"
                    inputMode="decimal"
                    className="checkout-panel__price-input"
                    value={subtotalText}
                    onChange={(e) => setSubtotalText(e.target.value)}
                    onBlur={() => {
                      const cleaned = subtotalText.replace(/[^0-9.]/g, "");
                      const dollars = parseFloat(cleaned);
                      if (!isNaN(dollars) && dollars >= 0) {
                        setAdjustedSubtotal(Math.round(dollars * 100));
                        setSubtotalText(dollars.toFixed(2));
                      } else {
                        setSubtotalText((adjustedSubtotal / 100).toFixed(2));
                      }
                      setEditingSubtotal(false);
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    autoFocus
                  />
                </span>
              ) : (
                <span
                  className="checkout-panel__clickable-price"
                  onClick={() => { setSubtotalText((adjustedSubtotal / 100).toFixed(2)); setEditingSubtotal(true); }}
                  title="Click to adjust price"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') { setSubtotalText((adjustedSubtotal / 100).toFixed(2)); setEditingSubtotal(true); } }}
                >
                  {formatMoney(adjustedSubtotal)}
                </span>
              )
            ) : (
              <span>{formatMoney(adjustedSubtotal)}</span>
            )}
          </div>
          {adjustedTaxCents > 0 ? (
            <div className="checkout-panel__totals-row">
              <span>Tax</span>
              <span>{formatMoney(adjustedTaxCents)}</span>
            </div>
          ) : null}
          {!isReadOnly ? (
          <>
          <div className="checkout-panel__totals-row checkout-panel__discount-row">
            <span className="checkout-panel__discount-label">Discount</span>
            {showDiscountPopup ? (
              <span className="checkout-panel__discount-popup">
                <input
                  type="text"
                  inputMode="decimal"
                  className="checkout-panel__discount-percent-input"
                  value={discountPopupText}
                  onChange={(e) => setDiscountPopupText(e.target.value)}
                  onBlur={() => {
                    const pct = parseFloat(discountPopupText.replace(/[^0-9.]/g, ""));
                    if (!isNaN(pct) && pct >= 0 && pct <= 100) {
                      setDiscountPercent(pct);
                    }
                    setDiscountPopupText(String(discountPercent));
                    setShowDiscountPopup(false);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  autoFocus
                />
                <span className="checkout-panel__discount-percent-sign">%</span>
              </span>
            ) : (
              <span
                className="checkout-panel__discount-link"
                onClick={() => { setDiscountPopupText(String(discountPercent)); setShowDiscountPopup(true); }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') { setDiscountPopupText(String(discountPercent)); setShowDiscountPopup(true); } }}
              >
                {discountPercent > 0 ? `${discountPercent}% (−${formatMoney(discountCents)})` : "Add discount"}
              </span>
            )}
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
          </>
          ) : tipCents > 0 ? (
          <div className="checkout-panel__totals-row">
            <span>Tip</span>
            <span>{formatMoney(tipCents)}</span>
          </div>
          ) : null}
          <div className="checkout-panel__totals-row checkout-panel__totals-row--total">
            <span>Total</span>
            <strong>{formatMoney(total)}</strong>
          </div>
        </section>

        {!isReadOnly && appointment.walletBalanceCents > 0 && remainingBalance > 0 ? (
          <section className="checkout-panel__wallet">
            <span>Wallet credit available</span>
            <strong>{formatMoney(appointment.walletBalanceCents)}</strong>
            <button
              type="button"
              className="checkout-panel__wallet-apply"
              onClick={() => {
                const cap = Math.min(appointment.walletBalanceCents, remainingBalance);
                setWalletApplyText((cap / 100).toFixed(2));
                setShowWalletPopup(true);
              }}
              disabled={state === "submitting"}
            >
              Apply credit
            </button>
          </section>
        ) : null}

        {showWalletPopup ? (
          <section className="checkout-panel__wallet-popup">
            <div className="checkout-panel__wallet-popup-header">
              <h3>Apply Wallet Credit</h3>
              <button
                type="button"
                className="checkout-panel__wallet-popup-close"
                onClick={() => setShowWalletPopup(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="checkout-panel__wallet-popup-balances">
              <div className="checkout-panel__wallet-popup-balance-row">
                <span>Wallet balance</span>
                <strong>{formatMoney(appointment.walletBalanceCents)}</strong>
              </div>
              <div className="checkout-panel__wallet-popup-balance-row">
                <span>Remaining after apply</span>
                <strong>{formatMoney(Math.max(0, appointment.walletBalanceCents - Math.round(parseFloat(walletApplyText || "0") * 100)))}</strong>
              </div>
            </div>
            <label className="checkout-panel__wallet-popup-amount">
              <span>Amount to apply</span>
              <input
                type="text"
                inputMode="decimal"
                value={walletApplyText}
                onChange={(e) => setWalletApplyText(e.target.value)}
                disabled={state === "submitting"}
                autoFocus
              />
            </label>
            {state === "error" ? (
              <p className="checkout-panel__error">{errorMessage}</p>
            ) : null}
            <div className="checkout-panel__wallet-popup-actions">
              <button
                type="button"
                className="checkout-panel__wallet-popup-cancel"
                onClick={() => setShowWalletPopup(false)}
                disabled={state === "submitting"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={() => void handleApplyWallet()}
                disabled={
                  state === "submitting" ||
                  (() => {
                    const c = Math.round(parseFloat(walletApplyText) * 100);
                    return isNaN(c) || c <= 0 || c > Math.min(appointment.walletBalanceCents, remainingBalance);
                  })()
                }
              >
                {state === "submitting"
                  ? "Applying..."
                  : `Apply ${formatMoney(Math.round(parseFloat(walletApplyText || "0") * 100))}`}
              </button>
            </div>
          </section>
        ) : null}

        {payments.length > 0 ? (
          <section className="checkout-panel__paid">
            {payments.map((p) => (
              <div key={p.id} className="checkout-panel__paid-row">
                <span className="checkout-panel__paid-label">{labelForPayment(p)}</span>
                <span className="checkout-panel__paid-amount">{formatMoney(p.amountCents)}</span>
                {!isReadOnly ? (
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
                ) : null}
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
          <span>Balance due</span>
          <strong>{formatMoney(remainingBalance)}</strong>
        </section>

        {!isReadOnly && !isSettled ? (
          <>
            {paymentStep === "register" && selectedMethod ? (
              <section className="checkout-panel__register">
                <div className="checkout-panel__register-header">
                  <button
                    type="button"
                    className="checkout-panel__back"
                    onClick={() => { setPaymentStep("methods"); setSelectedMethod(null); }}
                    aria-label="Back to payment methods"
                  >
                    ←
                  </button>
                  <span className="checkout-panel__register-method">
                    {allMethods.find((m) => m.id === selectedMethod)?.label ?? selectedMethod}
                  </span>
                </div>
                <label className="checkout-panel__amount-row">
                  <span>Amount to charge</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="checkout-panel__amount-input"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    disabled={state === "submitting"}
                    autoFocus
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
                <button
                  type="button"
                  className="primary-action checkout-panel__record-button"
                  onClick={() => void handleRecord(selectedMethod)}
                  disabled={state === "submitting" || parseAmount() <= 0 || parseAmount() > remainingBalance}
                >
                  {state === "submitting" ? "Recording..." : `Record ${formatMoney(parseAmount())}`}
                </button>
              </section>
            ) : (
              <section className="checkout-panel__methods">
                <h4 className="checkout-panel__section-kicker">How was it settled?</h4>
                <div className="checkout-panel__methods-grid">
                  {allMethods.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`checkout-panel__method-button checkout-panel__method-button--${paymentMethodTone(m.id)}${selectedMethod === m.id ? " is-active" : ""}`}
                      aria-pressed={selectedMethod === m.id}
                      onClick={() => { setSelectedMethod(m.id); setPaymentStep("register"); }}
                      disabled={state === "submitting"}
                    >
                      <span className="checkout-panel__method-name">{m.label}</span>
                      <span className="checkout-panel__method-description">{paymentMethodDescription(m.id)}</span>
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
            )}

            <section className="checkout-panel__resolutions" hidden>
              <div className="checkout-panel__resolutions-buttons">
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
            {!isReadOnly ? (
              <p className="checkout-panel__completed-hint">
                Use the ⋯ menu on each payment to refund if needed.
              </p>
            ) : null}
          </section>
        ) : (
          <p className="checkout-panel__settled-note">
            {tipCents > 0
              ? "All payments collected. Ready to complete."
              : "All payments collected. Add a tip above if needed before completing."}
          </p>
        )}

        {wasReopened ? (
          <div className="checkout-panel__reopen-warning" role="alert">
            ⚠️ Sale has been reopened for adjustments. Changes are tracked in the audit log.
          </div>
        ) : null}

        {state === "error" ? (
          <div className="message-banner message-banner--error" role="alert">
            {errorMessage}
          </div>
        ) : null}
      </div>
      <footer className="checkout-panel__footer">
        <div className="checkout-panel__footer-left">
          {!isReadOnly && !isSettled ? (
            <button
              type="button"
              className="checkout-panel__waive-link"
              onClick={handleWaive}
              disabled={state === "submitting"}
            >
              Cancel · no-show · refund
            </button>
          ) : null}
        </div>
        <div className="checkout-panel__footer-right">
          {!isReadOnly && remainingBalance > 0 ? (
            <button
              type="button"
              className="text-action checkout-panel__payment-link-button"
              onClick={() => void handleSendPaymentLink()}
              disabled={state === "submitting"}
            >
              {state === "submitting" ? "Creating link..." : "Send payment link"}
            </button>
          ) : null}
          {isReadOnly ? (
            <>
              <button
                type="button"
                className="text-action checkout-panel__reopen-button"
                onClick={handleReopenSale}
              >
                Re-open sale
              </button>
              <button
                type="button"
                className="checkout-panel__complete-button checkout-panel__complete-button--done"
                onClick={onClose}
              >
                Close
              </button>
            </>
          ) : (
            <div className="checkout-panel__complete-wrap">
              <button
                type="button"
                className="checkout-panel__complete-button"
                onClick={handleComplete}
                disabled={!isSettled || state === "submitting"}
              >
                Complete & collect
              </button>
              {!isSettled ? (
                <span className="checkout-panel__complete-hint">
                  Balance due {formatMoney(remainingBalance)}
                </span>
              ) : null}
            </div>
          )}
        </div>
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
  const pendingCount = requirements.filter((req) => req.status === "pending").length;
  const reminderForThisBooking =
    reminderState.kind !== "idle" && bookingId !== null && "bookingId" in reminderState && reminderState.bookingId === bookingId
      ? reminderState
      : null;
  const reminderSending = reminderForThisBooking?.kind === "sending";

  return (
    <>
      <div className="rail-section-heading">
        <p className="rail-section-kicker">Forms</p>
        <span className={`intake-status-badge intake-status-badge--${intakeStatus}`}>
          {pendingCount > 0 ? `${pendingCount} missing` : intakeLabel}
        </span>
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
        <p className="form-responses-empty">
          {intakeStatus === "not_required" ? "No forms required for this service." : "No forms attached."}
        </p>
      ) : (
        <>
          <div className="form-responses-list" aria-label="Intake forms">
            {requirements.length > 0
              ? requirements.map((req) => {
                  const matchedResponse = responseByRequirementId.get(req.id);
                  const isCompleted = req.status === "satisfied";
                  const submittedAt = matchedResponse ? formatDateTime(matchedResponse.submittedAt) : null;
                  const timingLabel = req.customerPromptTiming?.replaceAll("_", " ") ?? req.scope;
                  const viewableResponse = isCompleted && matchedResponse && onViewForm ? matchedResponse : null;
                  const viewForm = onViewForm;
                  return (
                    <div
                      key={req.id}
                      className={`form-response-item form-response-item--${isCompleted ? "submitted" : "missing"}`}
                      role={viewableResponse ? "button" : undefined}
                      tabIndex={viewableResponse ? 0 : undefined}
                      onClick={viewableResponse && viewForm ? () => viewForm(viewableResponse) : undefined}
                      onKeyDown={viewableResponse && viewForm ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); viewForm(viewableResponse); } } : undefined}
                    >
                      <div className="form-response-item__name">
                        {req.formName}
                        <span className={`form-response-item__badge form-response-item__badge--${isCompleted ? "submitted" : "missing"}`}>
                          {isCompleted ? "Submitted" : "Missing"}
                        </span>
                      </div>
                      <div className="form-response-item__date">
                        {isCompleted
                          ? submittedAt
                            ? `Submitted ${submittedAt}`
                            : "Completed"
                          : "Due before visit"}
                      </div>
                    </div>
                  );
                })
              : responses.map((entry) => {
                  const submittedAt = formatDateTime(entry.submittedAt);
                  const timingLabel = entry.customerPromptTiming?.replaceAll("_", " ") ?? entry.scope;
                  return (
                    <div
                      key={entry.id}
                      className="form-response-item form-response-item--submitted"
                      role={onViewForm ? "button" : undefined}
                      tabIndex={onViewForm ? 0 : undefined}
                      onClick={onViewForm ? () => onViewForm(entry) : undefined}
                      onKeyDown={onViewForm ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onViewForm(entry); } } : undefined}
                    >
                      <div className="form-response-item__name">
                        {entry.formName}
                        <span className="form-response-item__badge form-response-item__badge--submitted">Submitted</span>
                      </div>
                      <div className="form-response-item__date">Submitted {submittedAt} · {timingLabel}</div>
                    </div>
                  );
                })}
          </div>
          {hasPending && onSendReminder ? (
            <button
              type="button"
              className="form-reminder-btn"
              onClick={onSendReminder}
              disabled={reminderSending}
            >
              {reminderSending ? "Sending reminder..." : "Send form reminder"}
            </button>
          ) : null}
          {reminderForThisBooking?.kind === "success" ? (
            <span className="form-reminder-status" role="status">{reminderForThisBooking.message}</span>
          ) : null}
          {reminderForThisBooking?.kind === "error" ? (
            <span className="form-reminder-status form-reminder-status--error" role="alert">{reminderForThisBooking.message}</span>
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




