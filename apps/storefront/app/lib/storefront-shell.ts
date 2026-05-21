import type { BookingState, CustomerPromptTiming } from "@booking/shared-types";

export type JourneyStep = {
  state: BookingState;
  label: string;
  detail: string;
};

export type PromptTimingStep = {
  timing: CustomerPromptTiming;
  label: string;
  detail: string;
};

export const bookingJourney: JourneyStep[] = [
  {
    state: "draft",
    label: "Draft created",
    detail: "The customer picks a service and starts a booking session.",
  },
  {
    state: "slot_held",
    label: "Slot held",
    detail: "The selected time is reserved while details, forms, and payment are completed.",
  },
  {
    state: "awaiting_form",
    label: "Form completion",
    detail: "Required pre-booking forms gate progress until every requirement is satisfied.",
  },
  {
    state: "awaiting_payment",
    label: "Awaiting payment",
    detail: "Stripe Checkout handles deposit collection and supports return-to-session recovery.",
  },
  {
    state: "confirmed",
    label: "Confirmed booking",
    detail: "The visit is promoted atomically from draft to confirmed booking.",
  },
];

export const promptTimingSteps: PromptTimingStep[] = [
  {
    timing: "pre_booking",
    label: "Pre-booking",
    detail: "Forms required before payment stay inside the public booking flow.",
  },
  {
    timing: "pre_visit",
    label: "Pre-visit",
    detail: "After confirmation, secure manage links keep required follow-up forms accessible.",
  },
  {
    timing: "post_visit",
    label: "Post-visit",
    detail: "Customer follow-up forms remain separate from internal operator-only documentation.",
  },
];

export function titleFromSlug(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function pathWithQuery(path: string, params: Record<string, string | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }

  const queryText = query.toString();
  return queryText ? `${path}?${queryText}` : path;
}

export function formatLocationAddress(location: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}): string {
  const cityRegion = [location.city, location.state, location.postalCode].filter(Boolean).join(", ");
  return [location.addressLine1, location.addressLine2, cityRegion].filter(Boolean).join(" ");
}

export function formatCurrency(amountCents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
}

export function formatDuration(durationMinutes: number): string {
  if (durationMinutes < 60) {
    return `${durationMinutes} min`;
  }

  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}

export function formatInTenantTime(value: string, timeZone: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...options,
  }).format(new Date(value));
}

export function formatDateInTenantTime(value: string, timeZone: string): string {
  return formatInTenantTime(value, timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function isoDateFromValueInTimeZone(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function formatExpiryWindow(value: string): string {
  const millisecondsRemaining = new Date(value).getTime() - Date.now();
  const minutesRemaining = Math.max(0, Math.round(millisecondsRemaining / 60000));
  if (minutesRemaining <= 1) {
    return "Less than a minute remaining";
  }

  return `${minutesRemaining} minutes remaining`;
}

export function isoDateForTimeZone(timeZone: string, offsetDays = 0): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const baseDate = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);

  return formatter.format(baseDate);
}