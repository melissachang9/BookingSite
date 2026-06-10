import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  BookingDraftSummary,
  BookingFormResponseEntry,
  BookingSummary,
  CustomerLookupResponse,
  ProviderListResponse,
  ServiceListResponse,
  SlotAvailability,
} from "@booking/shared-types";

import { CalendarPage, type CalendarPageApi } from "./calendar-page";

const baseBooking = {
  id: "booking-1",
  tenantId: "tenant-1",
  createdAt: "2026-05-24T15:00:00.000Z",
  updatedAt: "2026-05-24T15:00:00.000Z",
  customerId: "customer-1",
  serviceId: "service-1",
  providerId: "provider-1",
  status: "confirmed",
  bookingMethod: "staff_entered",
  depositStatus: "paid",
  paymentResolution: "pending",
  startsAt: "2026-05-27T17:00:00.000Z",
  endsAt: "2026-05-27T18:00:00.000Z",
  notes: null,
  amountPaidCents: 2500,
  balanceDueCents: 7500,
  customerManageToken: "manage-token-1",
  service: {
    id: "service-1",
    tenantId: "tenant-1",
    createdAt: "2026-05-24T15:00:00.000Z",
    updatedAt: "2026-05-24T15:00:00.000Z",
    name: "Signature Facial",
    description: "A 60-minute facial.",
    durationMinutes: 60,
    setupBufferMinutes: 0,
    cleanupBufferMinutes: 0,
    priceCents: 10000,
    depositCents: 2500,
    isActive: true,
    imageUrl: null,
    imageAltText: null,
    locationIds: ["location-1"],
    formIds: [],
    sortOrder: 0,
  },
  provider: {
    id: "provider-1",
    tenantId: "tenant-1",
    createdAt: "2026-05-24T15:00:00.000Z",
    updatedAt: "2026-05-24T15:00:00.000Z",
    userId: null,
    name: "Jordan Rivera",
    email: "jordan@example.com",
    description: null,
    imageUrl: null,
    imageAltText: null,
    availabilityLabel: null,
    isActive: true,
    serviceIds: ["service-1"],
    locationIds: ["location-1"],
  },
  customer: {
    id: "customer-1",
    tenantId: "tenant-1",
    createdAt: "2026-05-24T15:00:00.000Z",
    updatedAt: "2026-05-24T15:00:00.000Z",
    name: "Taylor Guest",
    email: "guest@example.com",
    phone: "555-0100",
    notes: null,
  },
} as BookingSummary;

const serviceResponse: ServiceListResponse = {
  services: [baseBooking.service],
};

const baseDraftSummary: BookingDraftSummary = {
  id: "draft-1",
  tenantId: "tenant-1",
  createdAt: "2026-05-26T19:00:00.000Z",
  updatedAt: "2026-05-26T19:00:00.000Z",
  customerId: null,
  serviceId: "service-1",
  providerId: "provider-1",
  locationId: "location-1",
  status: "slot_held",
  bookingMethod: "staff_entered",
  startsAt: "2026-05-27T19:00:00.000Z",
  endsAt: "2026-05-27T20:00:00.000Z",
  expiresAt: "2026-05-26T19:15:00.000Z",
  priceCents: 10000,
  depositCents: 2500,
  durationMinutes: 60,
  service: baseBooking.service,
  provider: baseBooking.provider,
  customer: null,
  intakePlan: null,
  formRequirements: [],
};

function createBooking(overrides: Partial<BookingSummary> = {}): BookingSummary {
  return {
    ...baseBooking,
    ...overrides,
    service: {
      ...baseBooking.service,
      ...(overrides.service ?? {}),
    },
    provider: {
      ...baseBooking.provider,
      ...(overrides.provider ?? {}),
    },
    customer: {
      ...baseBooking.customer,
      ...(overrides.customer ?? {}),
    },
  } as BookingSummary;
}

function createApi(
  bookings: BookingSummary[],
  options: {
    services?: ServiceListResponse["services"];
    providersByServiceId?: Record<string, ProviderListResponse["providers"]>;
    customerLookupItems?: CustomerLookupResponse["items"];
    openingsByDate?: Record<string, SlotAvailability[]>;
    draftSummary?: BookingDraftSummary;
    formResponses?: BookingFormResponseEntry[];
  } = {},
): CalendarPageApi {
  const openingsByDate = options.openingsByDate ?? {};
  const services = options.services ?? serviceResponse.services;

  return {
    listBookings: vi.fn().mockResolvedValue({
      items: bookings,
      meta: {
        limit: 100,
        offset: 0,
        total: bookings.length,
      },
    }),
    listServices: vi.fn().mockResolvedValue({
      services,
    }),
    listServiceProviders: vi.fn(async (_tenantSlug, serviceId) => ({
      providers: options.providersByServiceId?.[serviceId] ?? [baseBooking.provider],
    })),
    getAvailability: vi.fn(async (request) => ({
      days: [
        {
          date: request.date,
          slotCount: (openingsByDate[request.date] ?? []).length,
        },
      ],
      slots: openingsByDate[request.date] ?? [],
    })),
    createBookingDraft: vi.fn().mockResolvedValue(options.draftSummary ?? baseDraftSummary),
    lookupCustomers: vi.fn(async () => ({
      items: options.customerLookupItems ?? [baseBooking.customer],
      meta: {
        limit: 5,
        offset: 0,
        total: options.customerLookupItems?.length ?? 1,
      },
    })),
    listBookingFormResponses: vi.fn().mockResolvedValue({ items: options.formResponses ?? [] }),
    updateBookingStatus: vi.fn().mockResolvedValue(baseBooking),
    updateBooking: vi.fn().mockResolvedValue(baseBooking),
  };
}

describe("CalendarPage", () => {
  it("shows appointment details when selecting a booked visit", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const api = createApi([baseBooking]);

      render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      expect(await screen.findByText("Sun, May 24 - Sat, May 30")).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Appointment details" })).not.toBeInTheDocument();
      expect(screen.getAllByText("Intake not checked").length).toBeGreaterThan(0);

      fireEvent.click(await screen.findByRole("button", { name: /Taylor Guest booked/i }));

      expect(await screen.findByRole("dialog", { name: "Appointment details" })).toBeInTheDocument();
      const dialog = screen.getByRole("dialog", { name: "Appointment details" });
      // Customer section
      expect(within(dialog).getAllByText("Taylor Guest").length).toBeGreaterThan(0);
      // Status chip
      expect(within(dialog).getByText("Confirmed")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog", { name: "Appointment details" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders unavailable bands instead of opening boxes when availability is loaded", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const opening = {
        startAt: "2026-05-27T19:00:00.000Z",
        endAt: "2026-05-27T20:00:00.000Z",
        providerId: "provider-1",
        providerName: "Jordan Rivera",
        locationId: "location-1",
      } satisfies SlotAvailability;
      const api = createApi([], {
        openingsByDate: {
          "2026-05-27": [opening],
        },
      });

      const { container } = render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      expect(await screen.findByText("Sun, May 24 - Sat, May 30")).toBeInTheDocument();

      // Wait for availability load to finish painting unavailable bands.
      expect(await screen.findByLabelText("Availability for")).toHaveValue("");

      expect(screen.queryByRole("button", { name: /Start booking/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/Create draft from selected opening/i)).not.toBeInTheDocument();

      await vi.waitFor(() => {
        expect(container.querySelectorAll(".schedule-unavailable").length).toBeGreaterThan(0);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders provider columns in day view for booked appointments", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const api = createApi([
        baseBooking,
        createBooking({
          id: "booking-2",
          providerId: "provider-2",
          startsAt: "2026-05-27T18:15:00.000Z",
          endsAt: "2026-05-27T19:00:00.000Z",
          provider: {
            ...baseBooking.provider,
            id: "provider-2",
            name: "Taylor Stone",
            email: "taylor@example.com",
          },
          customer: {
            ...baseBooking.customer,
            id: "customer-2",
            name: "Morgan Ellis",
            email: "morgan@example.com",
          },
        }),
      ]);

      render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      fireEvent.click(await screen.findByRole("gridcell", { name: "Wed, May 27" }));
      fireEvent.click(await screen.findByRole("button", { name: "Day" }));

      expect(await screen.findByLabelText("Jordan Rivera column")).toBeInTheDocument();
      expect(screen.getByLabelText("Taylor Stone column")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters week view by service provider", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const api = createApi([
        baseBooking,
        createBooking({
          id: "booking-2",
          providerId: "provider-2",
          startsAt: "2026-05-28T18:15:00.000Z",
          endsAt: "2026-05-28T19:00:00.000Z",
          provider: {
            ...baseBooking.provider,
            id: "provider-2",
            name: "Taylor Stone",
            email: "taylor@example.com",
          },
          customer: {
            ...baseBooking.customer,
            id: "customer-2",
            name: "Morgan Ellis",
            email: "morgan@example.com",
          },
        }),
      ]);

      const { container } = render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      expect(await screen.findByText("Sun, May 24 - Sat, May 30")).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: /Taylor Guest booked/i })).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: /Morgan Ellis booked/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Taylor Stone" }));

      expect(screen.queryByRole("button", { name: /Taylor Guest booked/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Morgan Ellis booked/i })).toBeInTheDocument();
      expect(container.querySelector(".schedule-day-track__empty")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "All providers" }));

      expect(screen.getByRole("button", { name: /Taylor Guest booked/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Morgan Ellis booked/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows week provider toggle from the provider catalog when the week has no bookings", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const api = createApi([]);

      render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      expect(await screen.findByText("Sun, May 24 - Sat, May 30")).toBeInTheDocument();
      expect(await screen.findByRole("group", { name: "Week provider view" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "All providers" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Jordan Rivera" })).toBeInTheDocument();

      await vi.waitFor(() => {
        expect(api.listServiceProviders).toHaveBeenCalledWith("brow-beauty-lab", "service-1");
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens slot actions from week view without selecting a provider first", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const opening = {
        startAt: "2026-05-27T19:00:00.000Z",
        endAt: "2026-05-27T20:00:00.000Z",
        providerId: "provider-1",
        providerName: "Jordan Rivera",
        locationId: "location-1",
      } satisfies SlotAvailability;
      const api = createApi([baseBooking], {
        openingsByDate: {
          "2026-05-27": [opening],
        },
      });

      const { container } = render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      expect(await screen.findByText("Sun, May 24 - Sat, May 30")).toBeInTheDocument();

      await vi.waitFor(() => {
        expect(container.querySelectorAll(".schedule-unavailable").length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getByLabelText("Wed schedule track"));

      expect(await screen.findByRole("dialog", { name: "Calendar slot actions" })).toBeInTheDocument();
      expect(screen.getByLabelText("Provider")).toHaveValue("Jordan Rivera");
      expect(screen.getByLabelText("Appointment duration")).toHaveValue("1 hr");

      fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "Tay" } });

      await vi.waitFor(() => {
        expect(screen.getByLabelText("Client name")).toHaveValue("Taylor Guest");
        expect(screen.getByLabelText("Email")).toHaveValue("guest@example.com");
        expect(screen.getByLabelText("Phone number")).toHaveValue("555-0100");
      });

      fireEvent.click(screen.getByRole("button", { name: "Book appointment" }));

      await vi.waitFor(() => {
        expect(api.createBookingDraft).toHaveBeenCalledWith({
          tenantSlug: "brow-beauty-lab",
          serviceId: "service-1",
          providerId: "provider-1",
          locationId: "location-1",
          startsAt: "2026-05-27T19:00:00.000Z",
          customer: {
            name: "Taylor Guest",
            email: "guest@example.com",
            phone: "555-0100",
          },
          bookingMethod: "staff_entered",
        });
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates appointment duration from appointment type and books the edited start time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const waxingService = {
        ...baseBooking.service,
        id: "service-2",
        name: "Waxing",
        durationMinutes: 30,
      };
      const opening = {
        startAt: "2026-05-27T19:00:00.000Z",
        endAt: "2026-05-27T20:00:00.000Z",
        providerId: "provider-1",
        providerName: "Jordan Rivera",
        locationId: "location-1",
      } satisfies SlotAvailability;
      const api = createApi([], {
        services: [baseBooking.service, waxingService],
        openingsByDate: {
          "2026-05-27": [opening],
        },
      });

      const { container } = render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      expect(await screen.findByText("Sun, May 24 - Sat, May 30")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("gridcell", { name: "Wed, May 27" }));
      fireEvent.click(screen.getByRole("button", { name: "Day" }));

      await vi.waitFor(() => {
        expect(container.querySelectorAll(".schedule-unavailable").length).toBeGreaterThan(0);
      });

      fireEvent.click(await screen.findByLabelText("Jordan Rivera schedule track"));

      expect(await screen.findByRole("dialog", { name: "Calendar slot actions" })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "13:15" } });
      fireEvent.change(screen.getByLabelText("Appointment type"), { target: { value: "service-2" } });

      expect(screen.getByLabelText("Appointment duration")).toHaveValue("30 min");

      fireEvent.change(screen.getByLabelText("Client name"), { target: { value: "New Client" } });
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new-client@example.com" } });
      fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "555-0144" } });
      fireEvent.click(screen.getByRole("button", { name: "Book appointment" }));

      await vi.waitFor(() => {
        expect(api.createBookingDraft).toHaveBeenCalledWith({
          tenantSlug: "brow-beauty-lab",
          serviceId: "service-2",
          providerId: "provider-1",
          locationId: "location-1",
          startsAt: "2026-05-27T20:15:00.000Z",
          customer: {
            name: "New Client",
            email: "new-client@example.com",
            phone: "555-0144",
          },
          bookingMethod: "staff_entered",
        });
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps month rail and week view in sync when selecting a date", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const api = createApi([]);

      render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      expect(await screen.findByText("Sun, May 24 - Sat, May 30")).toBeInTheDocument();
      expect(screen.getByText("May 2026")).toBeInTheDocument();

      const juneFourth = screen.getByRole("gridcell", { name: "Thu, Jun 4" });
      fireEvent.click(juneFourth);

      expect(await screen.findByText("Sun, May 31 - Sat, Jun 6")).toBeInTheDocument();
      expect(juneFourth).toHaveAttribute("aria-pressed", "true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders booked appointments only in the correct week when changing the month rail", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const juneFourthBooking = createBooking({
        startsAt: "2026-06-04T17:00:00.000Z",
        endsAt: "2026-06-04T18:00:00.000Z",
      });
      const api = createApi([juneFourthBooking]);

      render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      expect(await screen.findByText("Sun, May 24 - Sat, May 30")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Taylor Guest booked Thu, Jun 4/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("gridcell", { name: "Thu, Jun 4" }));

      expect(await screen.findByText("Sun, May 31 - Sat, Jun 6")).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: /Taylor Guest booked Thu, Jun 4/i })).toBeInTheDocument();
      expect(api.listBookings).toHaveBeenCalledWith(
        "brow-beauty-lab",
        expect.objectContaining({
          status: ["confirmed", "completed", "canceled", "no_show"],
          limit: 200,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("still loads booked appointments when the service catalog request fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const api = createApi([baseBooking]);
      api.listServices = vi.fn().mockRejectedValue(new Error("Service catalog unavailable"));

      render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      expect(await screen.findByText("Sun, May 24 - Sat, May 30")).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: /Taylor Guest booked/i })).toBeInTheDocument();
      expect(screen.queryByText("Unable to load booked appointments.")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens time block details with notes and affected appointments", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-27T19:00:00.000Z"));

    try {
      // Opening at 9:00 AM PDT (16:00 UTC) — JSDOM click lands at schedule start (9 AM)
      const opening = {
        startAt: "2026-05-27T16:00:00.000Z",
        endAt: "2026-05-27T17:00:00.000Z",
        providerId: "provider-1",
        providerName: "Jordan Rivera",
        locationId: "location-1",
      } satisfies SlotAvailability;
      const overlappingBooking = createBooking({
        startsAt: "2026-05-27T16:15:00.000Z",
        endsAt: "2026-05-27T16:45:00.000Z",
      });
      const api = createApi([overlappingBooking], {
        openingsByDate: {
          "2026-05-27": [opening],
        },
      });

      const { container } = render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      expect(await screen.findByText("Sun, May 24 - Sat, May 30")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Day" }));

      await vi.waitFor(() => {
        expect(container.querySelectorAll(".schedule-unavailable").length).toBeGreaterThan(0);
      });

      fireEvent.click(await screen.findByLabelText("Jordan Rivera schedule track"));

      expect(await screen.findByRole("dialog", { name: "Calendar slot actions" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Create time block" }));
      expect(screen.getByLabelText("Provider")).toHaveValue("Jordan Rivera");
      expect(screen.getByLabelText("Signature Facial")).toBeChecked();
      fireEvent.change(screen.getByLabelText("End time"), { target: { value: "12:45" } });
      fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Hold for staff meeting." } });
      fireEvent.click(screen.getByRole("button", { name: "Add time block" }));

      const drawer = await screen.findByRole("dialog", { name: "Time block details" });
      expect(
        await screen.findByRole("button", { name: /Time block .* with Jordan Rivera/i }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Duration")).toHaveValue("3 hrs 45 min");
      expect(drawer).toHaveTextContent("Appointments blocked");
      expect(drawer).toHaveTextContent("Taylor Guest");

      expect(screen.getByLabelText("Notes")).toHaveValue("Hold for staff meeting.");
      expect(screen.getByLabelText("Signature Facial")).toBeChecked();

      fireEvent.click(screen.getByRole("button", { name: "Create draft from time block" }));

      await vi.waitFor(() => {
        expect(api.createBookingDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantSlug: "brow-beauty-lab",
            serviceId: "service-1",
            providerId: "provider-1",
            startsAt: "2026-05-27T16:00:00.000Z",
            bookingMethod: "staff_entered",
          }),
        );
      });

      expect(
        await screen.findByRole("link", { name: "Open draft in storefront" }),
      ).toHaveAttribute("href", "http://127.0.0.1:3001/brow-beauty-lab/book/draft-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes a selected time block from the details drawer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const opening = {
        startAt: "2026-05-27T19:00:00.000Z",
        endAt: "2026-05-27T20:00:00.000Z",
        providerId: "provider-1",
        providerName: "Jordan Rivera",
        locationId: "location-1",
      } satisfies SlotAvailability;
      const api = createApi([], {
        openingsByDate: {
          "2026-05-27": [opening],
        },
      });

      render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      expect(await screen.findByText("Sun, May 24 - Sat, May 30")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Day" }));
      fireEvent.click(await screen.findByLabelText("Jordan Rivera schedule track"));

      expect(await screen.findByRole("dialog", { name: "Calendar slot actions" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Create time block" }));
      fireEvent.click(screen.getByRole("button", { name: "Add time block" }));

      expect(await screen.findByRole("dialog", { name: "Time block details" })).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: /Time block .* with Jordan Rivera/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Delete time block" }));

      expect(screen.queryByRole("dialog", { name: "Time block details" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Time block .* with Jordan Rivera/i })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows submitted form responses for the selected appointment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const formResponse: BookingFormResponseEntry = {
        id: "form-response-1",
        formId: "form-1",
        formVersionId: "form-version-1",
        formName: "Brow Prep Check-In",
        formVersionNumber: 1,
        scope: "customer",
        customerPromptTiming: "pre_booking",
        submittedAt: "2026-05-25T18:30:00.000Z",
        answers: {
          recentRetinoidUse: true,
          skinSensitivityNotes: "Mild redness after exfoliation.",
        },
        schema: {
          title: "Brow Prep Check-In",
          fields: [
            { id: "recentRetinoidUse", type: "yes_no", label: "Recent retinoid use" },
            { id: "skinSensitivityNotes", type: "long_text", label: "Skin sensitivity notes" },
          ],
        },
      };

      const api = createApi([baseBooking], { formResponses: [formResponse] });

      render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      await screen.findByText("Sun, May 24 - Sat, May 30");

      expect(screen.queryByRole("dialog", { name: "Appointment details" })).not.toBeInTheDocument();

      fireEvent.click(await screen.findByRole("button", { name: /Taylor Guest booked.*Intake not checked/i }));

      expect(await screen.findByRole("dialog", { name: "Appointment details" })).toBeInTheDocument();
      await vi.waitFor(() => {
        expect(api.listBookingFormResponses).toHaveBeenCalledWith("brow-beauty-lab", "booking-1");
      });

      expect(await screen.findByRole("button", { name: /Taylor Guest booked.*Intake submitted/i })).toBeInTheDocument();
      expect(await screen.findByText("Brow Prep Check-In")).toBeInTheDocument();
      expect(screen.getAllByText("Intake submitted").length).toBeGreaterThan(0);
      // Compact row shows form name + a "View form" button; answers are not shown until expanded
      expect(screen.getByRole("button", { name: "View form" })).toBeInTheDocument();
      expect(screen.queryByText("Recent retinoid use")).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Time block details" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a secondary drawer with form answers when clicking View form", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const formResponse: BookingFormResponseEntry = {
        id: "form-response-1",
        formId: "form-1",
        formVersionId: "form-version-1",
        formName: "Brow Prep Check-In",
        formVersionNumber: 1,
        scope: "customer",
        customerPromptTiming: "pre_booking",
        submittedAt: "2026-05-25T18:30:00.000Z",
        answers: {
          recentRetinoidUse: true,
          skinSensitivityNotes: "Mild redness after exfoliation.",
        },
        schema: {
          title: "Brow Prep Check-In",
          fields: [
            { id: "recentRetinoidUse", type: "yes_no", label: "Recent retinoid use" },
            { id: "skinSensitivityNotes", type: "long_text", label: "Skin sensitivity notes" },
          ],
        },
      };

      const api = createApi([baseBooking], { formResponses: [formResponse] });

      render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      await screen.findByText("Sun, May 24 - Sat, May 30");
      fireEvent.click(await screen.findByRole("button", { name: /Taylor Guest booked.*Intake not checked/i }));

      await screen.findByRole("dialog", { name: "Appointment details" });
      const viewButton = await screen.findByRole("button", { name: "View form" });

      expect(screen.queryByRole("dialog", { name: "Form response" })).not.toBeInTheDocument();

      fireEvent.click(viewButton);

      const responseDialog = await screen.findByRole("dialog", { name: "Form response" });
      expect(within(responseDialog).getByText("Brow Prep Check-In")).toBeInTheDocument();
      expect(within(responseDialog).getByText("Recent retinoid use")).toBeInTheDocument();
      expect(within(responseDialog).getByText("Yes")).toBeInTheDocument();
      expect(within(responseDialog).getByText("Skin sensitivity notes")).toBeInTheDocument();
      expect(within(responseDialog).getByText("Mild redness after exfoliation.")).toBeInTheDocument();

      fireEvent.click(within(responseDialog).getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog", { name: "Form response" })).not.toBeInTheDocument();
      // Appointment drawer remains open
      expect(screen.getByRole("dialog", { name: "Appointment details" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an empty state when the selected appointment has no submitted forms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const api = createApi([baseBooking]);

      render(
        <CalendarPage
          definition={{
            eyebrow: "Calendar-first booking",
            description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
          }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      await screen.findByText("Sun, May 24 - Sat, May 30");

      fireEvent.click(await screen.findByRole("button", { name: /Taylor Guest booked.*Intake not checked/i }));

      expect(await screen.findByRole("button", { name: /Taylor Guest booked.*Intake missing/i })).toBeInTheDocument();
      expect(
        await screen.findByText("Intake missing for this booking."),
      ).toBeInTheDocument();
      expect(screen.getAllByText("Intake missing").length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});