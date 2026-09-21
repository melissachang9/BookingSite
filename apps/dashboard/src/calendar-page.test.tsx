import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BookingDraftSummary,
  BookingFormResponseEntry,
  BookingSummary,
  CustomerLookupResponse,
  CustomerProfileResponse,
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
  taxCents: 0,
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
    requireCardOnFile: false,
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
    isBookableOnline: true,
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

const customerProfileResponse: CustomerProfileResponse = {
  customer: baseBooking.customer,
  bookings: [],
  payments: [],
  lifetimeSpendCents: 32500,
  outstandingBalanceCents: 0,
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
    getBooking: vi.fn().mockResolvedValue(baseBooking),
    getCustomerProfile: vi.fn().mockResolvedValue(customerProfileResponse),
    listServiceCategories: vi.fn().mockResolvedValue({ categories: [] }),
    listServiceProviders: vi.fn(async (_tenantSlug, serviceId) => ({
      providers: options.providersByServiceId?.[serviceId] ?? [baseBooking.provider],
    })),
    listProviderTimeOff: vi.fn().mockResolvedValue({ items: [] }),
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
    createOrUpdateCustomer: vi.fn().mockResolvedValue({ customerId: "customer-new" }),
    lookupCustomers: vi.fn(async () => ({
      items: options.customerLookupItems ?? [baseBooking.customer],
      meta: {
        limit: 5,
        offset: 0,
        total: options.customerLookupItems?.length ?? 1,
      },
    })),
    listBookingFormResponses: vi.fn().mockResolvedValue({ items: options.formResponses ?? [] }),
    listBookingFormRequirements: vi.fn().mockResolvedValue({ items: [] }),
    sendBookingFormReminder: vi.fn().mockResolvedValue({
      bookingId: "booking-1",
      pendingRequirementCount: 0,
      recipientEmail: baseBooking.customer.email ?? "customer@example.com",
      provider: "test",
      providerMessageId: "test",
      sentAt: new Date().toISOString(),
      manageUrl: "https://example.com/forms/test",
    }),
    updateBookingStatus: vi.fn().mockResolvedValue(baseBooking),
    updateBooking: vi.fn().mockResolvedValue(baseBooking),
    cancelBooking: vi.fn().mockResolvedValue(baseBooking),
    recordManualPayment: vi.fn().mockResolvedValue(baseBooking),
    applyWalletCredit: vi.fn().mockResolvedValue(baseBooking),
    refundBookingPayment: vi.fn().mockResolvedValue(baseBooking),
    createCheckoutSession: vi.fn().mockResolvedValue({
      checkoutUrl: "http://127.0.0.1:3001/cancel/manage-token-1/payment/session-1",
      sessionId: "session-1",
    }),
    updateTenantSettings: vi.fn().mockResolvedValue({}),
    updateCustomer: vi.fn().mockResolvedValue(baseBooking.customer),
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.removeItem("calendar.viewMode");
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CalendarPage", () => {
  it("shows appointment details when selecting a booked visit", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const api = createApi([baseBooking]);

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

      expect(await screen.findByText("24 – 30 May")).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Appointment details" })).not.toBeInTheDocument();

      fireEvent.click(await screen.findByRole("button", { name: /Taylor Guest booked/i }));

      expect(await screen.findByRole("dialog", { name: "Appointment details" })).toBeInTheDocument();
      const dialog = screen.getByRole("dialog", { name: "Appointment details" });
      expect(within(dialog).getAllByText("Taylor Guest").length).toBeGreaterThan(0);
      expect(within(dialog).getByRole("button", { name: "Profile" })).toBeInTheDocument();
      expect(within(dialog).getByRole("tab", { name: "History" })).toBeInTheDocument();
      expect(within(dialog).getByText("$325.00")).toBeInTheDocument();

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
        startAt: "2026-05-27T17:00:00.000Z",
        endAt: "2026-05-27T18:00:00.000Z",
        providerId: "provider-1",
        providerName: "Jordan Rivera",
        locationId: "location-1",
      } satisfies SlotAvailability;
      const afternoonOpening = {
        ...opening,
        startAt: "2026-05-27T19:00:00.000Z",
        endAt: "2026-05-27T20:00:00.000Z",
      } satisfies SlotAvailability;
      const api = createApi([], {
        openingsByDate: {
          "2026-05-27": [opening, afternoonOpening],
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

      expect(await screen.findByText("24 – 30 May")).toBeInTheDocument();

      expect(await screen.findByLabelText("Availability for")).toHaveAttribute("aria-expanded", "false");

      expect(screen.queryByRole("button", { name: /Start booking/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/Create draft from selected opening/i)).not.toBeInTheDocument();

      await vi.waitFor(() => {
        expect(container.querySelectorAll(".cs-hatch").length).toBeGreaterThan(0);
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

      expect(await screen.findByText("Jordan Rivera")).toBeInTheDocument();
      expect(screen.getByText("Taylor Stone")).toBeInTheDocument();
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

      expect(await screen.findByText("24 – 30 May")).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: /Taylor Guest booked/i })).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: /Morgan Ellis booked/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Staff filter" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: /Taylor Stone/ }));

      expect(screen.queryByRole("button", { name: /Taylor Guest booked/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Morgan Ellis booked/i })).toBeInTheDocument();
      expect(container.querySelector(".cs-col")).not.toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Staff filter" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: /All staff/ }));

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

      expect(await screen.findByText("24 – 30 May")).toBeInTheDocument();
      const providerFilter = await screen.findByRole("button", { name: "Staff filter" });
      expect(providerFilter).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(providerFilter);
      expect(screen.getByRole("menuitemradio", { name: /All staff/ })).toHaveAttribute("aria-checked", "true");
      expect(screen.getByRole("menuitemradio", { name: /Jordan Rivera/ })).toBeInTheDocument();

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

      expect(await screen.findByText("24 – 30 May")).toBeInTheDocument();
      fireEvent.click(await screen.findByLabelText("Wed schedule track"));

      expect(await screen.findByRole("dialog", { name: "Calendar slot actions" })).toBeInTheDocument();
      const dialog = screen.getByRole("dialog", { name: "Calendar slot actions" });
      expect(within(dialog).getByText(/Jordan Rivera.*12:00 PM - 1:00 PM/)).toBeInTheDocument();
      expect(within(dialog).getByText("1 hr")).toBeInTheDocument();

      fireEvent.change(within(dialog).getByPlaceholderText("Search clients — type a name"), { target: { value: "Tay" } });

      await vi.waitFor(() => {
        expect(within(dialog).getByRole("button", { name: /Taylor Guest/ })).toBeInTheDocument();
      });
      fireEvent.click(within(dialog).getByRole("button", { name: /Taylor Guest/ }));
      expect(within(dialog).getByText("guest@example.com · 555-0100")).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole("button", { name: "Book & send confirmation" }));

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
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

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

      expect(await screen.findByText("24 – 30 May")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("gridcell", { name: "Wed, May 27" }));
      fireEvent.click(screen.getByRole("button", { name: "Day" }));

      const providerTrack = await screen.findByLabelText("Jordan Rivera schedule track");
      await vi.waitFor(() => {
        expect(providerTrack).toHaveAttribute("role", "button");
      });
      fireEvent.click(providerTrack);

      const dialog = await screen.findByRole("dialog", { name: "Calendar slot actions" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Change time" }));
      fireEvent.change(within(dialog).getByDisplayValue("12:00"), { target: { value: "13:15" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Treatment" }));
      fireEvent.click(within(dialog).getByRole("option", { name: "Waxing" }));

      expect(within(dialog).getByText("30 min")).toBeInTheDocument();

      fireEvent.change(within(dialog).getByPlaceholderText("Search clients — type a name"), { target: { value: "New Client" } });
      fireEvent.click(await within(dialog).findByRole("button", { name: /^Add new client/ }));
      fireEvent.change(within(dialog).getByPlaceholderText("First name"), { target: { value: "New" } });
      fireEvent.change(within(dialog).getByPlaceholderText("Last name"), { target: { value: "Client" } });
      fireEvent.change(within(dialog).getByPlaceholderText("Email"), { target: { value: "new-client@example.com" } });
      fireEvent.change(within(dialog).getByPlaceholderText("Phone"), { target: { value: "555-0144" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Create client" }));

      await vi.waitFor(() => {
        expect(api.createOrUpdateCustomer).toHaveBeenCalled();
      });
      const bookButton = within(dialog).getByRole("button", { name: "Book & send confirmation" });
      await vi.waitFor(() => {
        expect(bookButton).toBeEnabled();
      });
      fireEvent.click(bookButton);

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
          overrideAvailability: true,
        });
      });
    } finally {
      confirmSpy.mockRestore();
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

      expect(await screen.findByText("24 – 30 May")).toBeInTheDocument();
      expect(screen.getByText("May 2026")).toBeInTheDocument();

      const juneFourth = screen.getByRole("gridcell", { name: "Thu, Jun 4" });
      fireEvent.click(juneFourth);

      expect(await screen.findByText("31 May – 6 June")).toBeInTheDocument();
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

      expect(await screen.findByText("24 – 30 May")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Taylor Guest booked Thu, Jun 4/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("gridcell", { name: "Thu, Jun 4" }));

      expect(await screen.findByText("31 May – 6 June")).toBeInTheDocument();
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

      expect(await screen.findByText("24 – 30 May")).toBeInTheDocument();
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

      expect(await screen.findByText("24 – 30 May")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Day" }));
      const providerTrack = await screen.findByLabelText("Jordan Rivera schedule track");
      await vi.waitFor(() => {
        expect(providerTrack).toHaveAttribute("role", "button");
      });
      fireEvent.click(providerTrack);

      const slotDialog = await screen.findByRole("dialog", { name: "Calendar slot actions" });
      fireEvent.click(within(slotDialog).getByRole("button", { name: "Time block" }));
      fireEvent.change(within(slotDialog).getByLabelText("End time"), { target: { value: "12:45" } });
      fireEvent.change(within(slotDialog).getByPlaceholderText("Add staff-facing context for this block."), { target: { value: "Hold for staff meeting." } });
      fireEvent.click(within(slotDialog).getByRole("button", { name: "Add time block" }));

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

      expect(await screen.findByText("24 – 30 May")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("gridcell", { name: "Wed, May 27" }));
      fireEvent.click(screen.getByRole("button", { name: "Day" }));
      const providerTrack = await screen.findByLabelText("Jordan Rivera schedule track");
      await vi.waitFor(() => {
        expect(providerTrack).toHaveAttribute("role", "button");
      });
      fireEvent.click(providerTrack);

      const slotDialog = await screen.findByRole("dialog", { name: "Calendar slot actions" });
      fireEvent.click(within(slotDialog).getByRole("button", { name: "Time block" }));
      fireEvent.click(within(slotDialog).getByRole("button", { name: "Add time block" }));

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

      await screen.findByText("24 – 30 May");

      expect(screen.queryByRole("dialog", { name: "Appointment details" })).not.toBeInTheDocument();

      fireEvent.click(await screen.findByRole("button", { name: /Taylor Guest booked/i }));

      expect(await screen.findByRole("dialog", { name: "Appointment details" })).toBeInTheDocument();
      await vi.waitFor(() => {
        expect(api.listBookingFormResponses).toHaveBeenCalledWith("brow-beauty-lab", "booking-1");
      });

      expect(await screen.findByRole("button", { name: /Brow Prep Check-In/ })).toBeInTheDocument();
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

      await screen.findByText("24 – 30 May");
      fireEvent.click(await screen.findByRole("button", { name: /Taylor Guest booked/i }));

      await screen.findByRole("dialog", { name: "Appointment details" });
      const formRow = await screen.findByRole("button", { name: /Brow Prep Check-In/ });

      expect(screen.queryByRole("dialog", { name: "Form response" })).not.toBeInTheDocument();

      fireEvent.click(formRow);

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

      await screen.findByText("24 – 30 May");

      fireEvent.click(await screen.findByRole("button", { name: /Taylor Guest booked/i }));
      const dialog = await screen.findByRole("dialog", { name: "Appointment details" });
      fireEvent.click(within(dialog).getByRole("tab", { name: "Forms" }));

      expect(await within(dialog).findByText("No forms attached to this appointment.")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});