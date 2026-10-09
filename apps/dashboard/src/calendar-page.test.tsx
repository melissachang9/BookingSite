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
    addBookingItem: vi.fn().mockResolvedValue(baseBooking),
    removeBookingItem: vi.fn().mockResolvedValue(baseBooking),
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

      fireEvent.click(within(dialog).getByRole("button", { name: "Profile" }));
      const profile = await screen.findByRole("dialog", { name: "Customer profile" });
      fireEvent.click(within(profile).getByRole("button", { name: "Back to appointment details" }));
      expect(await screen.findByRole("dialog", { name: "Appointment details" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog", { name: "Appointment details" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters the calendar strictly to the chosen staff member", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const otherProvider = { ...baseBooking.provider, id: "provider-2", name: "Ava Brooks" };
      const api = createApi(
        [
          baseBooking,
          createBooking({
            id: "booking-2",
            providerId: "provider-2",
            provider: otherProvider,
            customer: { ...baseBooking.customer, id: "customer-2", name: "Morgan Ellis" },
            customerId: "customer-2",
            startsAt: "2026-05-27T19:00:00.000Z",
            endsAt: "2026-05-27T20:00:00.000Z",
          }),
        ],
        { providersByServiceId: { "service-1": [baseBooking.provider, otherProvider] } },
      );

      render(
        <CalendarPage
          definition={{ eyebrow: "Calendar-first booking", description: "Calendar." }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      expect(await screen.findByRole("button", { name: /Taylor Guest booked/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Morgan Ellis booked/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Staff filter" }));
      fireEvent.click(await screen.findByRole("menuitemradio", { name: /Ava Brooks/ }));

      // The menu closes, the filter reads as the chosen person, and only their bookings remain.
      expect(screen.getByRole("button", { name: "Staff filter" })).toHaveTextContent("Ava Brooks");
      expect(screen.getByRole("button", { name: /Morgan Ellis booked/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Taylor Guest booked/i })).not.toBeInTheDocument();
      expect(screen.getByText(/1 appointments this week/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Staff filter" }));
      fireEvent.click(await screen.findByRole("menuitemradio", { name: /All staff/ }));
      expect(await screen.findByRole("button", { name: /Taylor Guest booked/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters appointments by service and combines with the staff filter", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const browService = { ...baseBooking.service, id: "service-2", name: "Brow Shape and Tint" };
      const otherProvider = { ...baseBooking.provider, id: "provider-2", name: "Ava Brooks" };
      const api = createApi(
        [
          baseBooking, // Taylor Guest, Signature Facial, Jordan
          createBooking({
            id: "booking-2",
            serviceId: "service-2",
            service: browService,
            customerId: "customer-2",
            customer: { ...baseBooking.customer, id: "customer-2", name: "Morgan Ellis" },
            startsAt: "2026-05-27T19:00:00.000Z",
            endsAt: "2026-05-27T20:00:00.000Z",
          }), // Morgan Ellis, Brow Shape and Tint, Jordan
          createBooking({
            id: "booking-3",
            providerId: "provider-2",
            provider: otherProvider,
            customerId: "customer-3",
            customer: { ...baseBooking.customer, id: "customer-3", name: "Casey Lin" },
            startsAt: "2026-05-27T21:00:00.000Z",
            endsAt: "2026-05-27T22:00:00.000Z",
          }), // Casey Lin, Signature Facial, Ava
        ],
        {
          services: [baseBooking.service, browService],
          providersByServiceId: {
            "service-1": [baseBooking.provider, otherProvider],
            "service-2": [baseBooking.provider],
          },
        },
      );

      render(
        <CalendarPage
          definition={{ eyebrow: "Calendar-first booking", description: "Calendar." }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      expect(await screen.findByRole("button", { name: /Taylor Guest booked/i })).toBeInTheDocument();
      expect(screen.getByText(/3 appointments this week/)).toBeInTheDocument();

      // Service filter: only that appointment type remains.
      fireEvent.click(screen.getByRole("button", { name: "Service filter" }));
      fireEvent.click(await screen.findByRole("menuitemradio", { name: /Brow Shape and Tint/ }));
      expect(await screen.findByRole("button", { name: /Morgan Ellis booked/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Taylor Guest booked/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Casey Lin booked/i })).not.toBeInTheDocument();
      expect(screen.getByText(/1 appointments this week/)).toBeInTheDocument();

      // Both filters together: Signature Facial for Ava only.
      fireEvent.click(screen.getByRole("button", { name: "Service filter" }));
      fireEvent.click(await screen.findByRole("menuitemradio", { name: /Signature Facial/ }));
      fireEvent.click(await screen.findByRole("button", { name: "Staff filter" }));
      fireEvent.click(await screen.findByRole("menuitemradio", { name: /Ava Brooks/ }));
      expect(await screen.findByRole("button", { name: /Casey Lin booked/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Taylor Guest booked/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Morgan Ellis booked/i })).not.toBeInTheDocument();

      // Clearing the service filter restores that person's other appointment types.
      fireEvent.click(screen.getByRole("button", { name: "Service filter" }));
      fireEvent.click(await screen.findByRole("menuitemradio", { name: /Any service/ }));
      expect(await screen.findByRole("button", { name: /Casey Lin booked/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("records check-in on the booking and shows it as checked in", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const api = createApi([baseBooking]);
      const recordProgress = vi.fn().mockResolvedValue({ ...baseBooking, checkedInAt: "2026-05-26T19:00:00.000Z" });
      api.recordBookingProgress = recordProgress;

      render(
        <CalendarPage
          definition={{ eyebrow: "Calendar-first booking", description: "Calendar." }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      fireEvent.click(await screen.findByRole("button", { name: /Taylor Guest booked/i }));
      const dialog = await screen.findByRole("dialog", { name: "Appointment details" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Check in" }));

      await waitFor(() => expect(recordProgress).toHaveBeenCalledWith("brow-beauty-lab", baseBooking.id, { action: "check_in" }));
      expect(within(dialog).getByRole("button", { name: "Checked in" })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reverts the check-in and shows an error when it cannot be saved", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const api = createApi([baseBooking]);
      api.recordBookingProgress = vi.fn().mockRejectedValue(new Error("Check-in failed"));

      render(
        <CalendarPage
          definition={{ eyebrow: "Calendar-first booking", description: "Calendar." }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );

      fireEvent.click(await screen.findByRole("button", { name: /Taylor Guest booked/i }));
      const dialog = await screen.findByRole("dialog", { name: "Appointment details" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Check in" }));

      expect(await within(dialog).findByText("Check-in failed")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Check in" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels time editing when clicking outside the time editor", async () => {
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

      fireEvent.click(within(dialog).getByTitle("Change time"));
      const timeInput = within(dialog).getByDisplayValue("10:00");
      fireEvent.mouseDown(timeInput);
      expect(timeInput).toBeInTheDocument();

      fireEvent.mouseDown(document.body);
      expect(within(dialog).queryByDisplayValue("10:00")).not.toBeInTheDocument();
      expect(within(dialog).getByTitle("Change time")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies checkout discounts as a percentage or fixed dollar amount", async () => {
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
      const details = await screen.findByRole("dialog", { name: "Appointment details" });
      fireEvent.click(within(details).getByRole("button", { name: "Complete & check out" }));
      const checkout = await screen.findByRole("dialog", { name: "Checkout" });

      fireEvent.click(within(checkout).getByRole("button", { name: "Add discount" }));
      expect(within(checkout).getByRole("button", { name: "Percentage" })).toHaveAttribute("aria-pressed", "true");
      fireEvent.change(within(checkout).getByLabelText("Discount value"), { target: { value: "10" } });
      fireEvent.click(within(checkout).getByRole("button", { name: "Apply" }));
      expect(within(checkout).getByRole("button", { name: /10%/ })).toHaveTextContent("−$10.00");
      expect(within(checkout).getAllByText("$90.00").length).toBeGreaterThan(0);

      fireEvent.click(within(checkout).getByRole("button", { name: /10%/ }));
      fireEvent.click(within(checkout).getByRole("button", { name: "Fixed amount" }));
      fireEvent.change(within(checkout).getByLabelText("Discount value"), { target: { value: "15" } });
      fireEvent.click(within(checkout).getByRole("button", { name: "Apply" }));
      expect(within(checkout).getByRole("button", { name: "−$15.00" })).toBeInTheDocument();
      expect(within(checkout).getAllByText("$85.00").length).toBeGreaterThan(0);

      fireEvent.click(within(checkout).getByRole("button", { name: "−$15.00" }));
      fireEvent.change(within(checkout).getByLabelText("Discount value"), { target: { value: "100" } });
      fireEvent.click(within(checkout).getByRole("button", { name: "Apply" }));
      expect(within(checkout).queryByText("Sale Complete")).not.toBeInTheDocument();
      fireEvent.click(within(checkout).getByRole("button", { name: "Complete sale" }));

      await waitFor(() => {
        expect(api.updateBookingStatus).toHaveBeenCalledWith("brow-beauty-lab", "booking-1", {
          status: "completed",
          paymentResolution: "collected",
          discountCents: 10000,
          discountType: "amount",
        });
      });
      expect(within(checkout).getByText("Sale Complete")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("locks the tip to its payment method and completes once fully settled", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const deposit = {
        id: "payment-deposit",
        amountCents: 2500,
        tipCents: 0,
        status: "succeeded",
        depositStatus: "deposit_paid",
        paymentMethodType: "card",
        checkoutSessionKind: "deposit",
        createdAt: "2026-05-24T15:00:00.000Z",
      };
      const booking = createBooking({ payments: [deposit] });
      const api = createApi([booking]);
      const checkoutPayment = {
        id: "payment-checkout",
        amountCents: 9500,
        tipCents: 2000,
        status: "succeeded",
        depositStatus: "paid_in_full",
        paymentMethodType: "cash",
        checkoutSessionKind: "admin_completion",
        createdAt: "2026-05-26T19:05:00.000Z",
      };
      vi.mocked(api.recordManualPayment).mockResolvedValue(
        createBooking({ payments: [deposit, checkoutPayment], balanceDueCents: 0 }),
      );

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
      const details = await screen.findByRole("dialog", { name: "Appointment details" });
      fireEvent.click(within(details).getByRole("button", { name: "Complete & check out" }));

      const checkout = await screen.findByRole("dialog", { name: "Checkout" });
      fireEvent.click(within(checkout).getByRole("button", { name: "20%" }));
      fireEvent.click(within(checkout).getByRole("button", { name: /^Cash/ }));
      fireEvent.click(within(checkout).getByRole("button", { name: "Record $95.00" }));

      await waitFor(() => {
        expect(api.recordManualPayment).toHaveBeenCalledWith(
          "brow-beauty-lab",
          "booking-1",
          expect.objectContaining({
            amountCents: 9500,
            tipCents: 2000,
            paymentMethodType: "cash",
          }),
        );
        expect(api.updateBookingStatus).toHaveBeenCalledWith("brow-beauty-lab", "booking-1", {
          status: "completed",
          paymentResolution: "collected",
        });
      });

      // The tip is recorded on the completed sale and shown read-only (the
      // editable tip input is replaced by the completed-sale summary).
      expect(within(checkout).queryByLabelText("Tip amount")).not.toBeInTheDocument();
      expect(within(checkout).getByText("$20.00")).toBeInTheDocument();
      expect(within(checkout).getByText("Sale Complete")).toBeInTheDocument();
      expect(within(checkout).queryByRole("button", { name: "Complete & collect" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a partial charge smaller than the tip without forcing the tip", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));

    try {
      const deposit = {
        id: "payment-deposit",
        amountCents: 2500,
        tipCents: 0,
        status: "succeeded",
        depositStatus: "deposit_paid",
        paymentMethodType: "card",
        checkoutSessionKind: "deposit",
        createdAt: "2026-05-24T15:00:00.000Z",
      };
      const booking = createBooking({ payments: [deposit] });
      const api = createApi([booking]);

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
      const details = await screen.findByRole("dialog", { name: "Appointment details" });
      fireEvent.click(within(details).getByRole("button", { name: "Complete & check out" }));

      const checkout = await screen.findByRole("dialog", { name: "Checkout" });
      fireEvent.click(within(checkout).getByRole("button", { name: "20%" }));
      fireEvent.click(within(checkout).getByRole("button", { name: /^Cash/ }));

      fireEvent.change(within(checkout).getByLabelText("Amount to charge"), { target: { value: "7.00" } });
      fireEvent.click(within(checkout).getByRole("button", { name: "Record $7.00" }));

      await waitFor(() => {
        expect(api.recordManualPayment).toHaveBeenCalledWith(
          "brow-beauty-lab",
          "booking-1",
          expect.objectContaining({ amountCents: 700, tipCents: 0, paymentMethodType: "cash" }),
        );
      });
      // The tip was not collected, so it stays editable rather than locked.
      expect(within(checkout).getByLabelText("Tip amount")).not.toBeDisabled();
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

      expect(await screen.findByLabelText("Service filter")).toHaveAttribute("aria-expanded", "false");

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

  describe("add-ons on a calendar booking", () => {
    const opening = {
      startAt: "2026-05-27T19:00:00.000Z",
      endAt: "2026-05-27T20:00:00.000Z",
      providerId: "provider-1",
      providerName: "Jordan Rivera",
      locationId: "location-1",
    } satisfies SlotAvailability;
    const ledAddOn = {
      id: "addon-1", tenantId: "tenant-1", serviceId: "service-1", createdAt: "", updatedAt: "",
      name: "LED therapy", description: null, priceCents: 4000, durationMinutes: 15, isActive: true, sortOrder: 0,
    };

    // Books the 12:00 slot with LED therapy; `fitsWithAddOns` decides whether the
    // longer visit still fits the provider's hours.
    async function bookWithAddOn(fitsWithAddOns: boolean, confirmAnswer: boolean) {
      const api = createApi([baseBooking], { openingsByDate: { "2026-05-27": [opening] } });
      api.listServiceAddOns = vi.fn().mockResolvedValue({ items: [ledAddOn] });
      api.getAvailability = vi.fn(async (request) => {
        const slots = request.addOnIds?.length && !fitsWithAddOns ? [] : [opening];
        return { days: [{ date: request.date, slotCount: slots.length }], slots };
      });
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(confirmAnswer);

      render(
        <CalendarPage
          definition={{ eyebrow: "Calendar-first booking", description: "Calendar" }}
          tenantSlug="brow-beauty-lab"
          api={api}
        />,
      );
      expect(await screen.findByText("24 – 30 May")).toBeInTheDocument();
      fireEvent.click(await screen.findByLabelText("Wed schedule track"));
      const dialog = await screen.findByRole("dialog", { name: "Calendar slot actions" });

      fireEvent.click(await within(dialog).findByRole("checkbox", { name: /LED therapy/ }));
      expect(within(dialog).getByText("1 hr 15 min")).toBeInTheDocument();

      fireEvent.change(within(dialog).getByPlaceholderText("Search clients — type a name"), { target: { value: "Tay" } });
      fireEvent.click(await within(dialog).findByRole("button", { name: /Taylor Guest/ }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Book & send confirmation" }));
      return { api, confirmSpy };
    }

    it("prompts when add-ons run past the provider's hours and books with an override", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));
      try {
        const { api, confirmSpy } = await bookWithAddOn(false, true);
        await vi.waitFor(() => {
          expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("With add-ons"));
          expect(api.createBookingDraft).toHaveBeenCalledWith(
            expect.objectContaining({ overrideAvailability: true, addOnIds: ["addon-1"] }),
          );
        });
        confirmSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not book when the override prompt is declined", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));
      try {
        const { api, confirmSpy } = await bookWithAddOn(false, false);
        await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalled());
        expect(api.createBookingDraft).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it("books without a prompt when the add-ons still fit", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date("2026-05-26T19:00:00.000Z"));
      try {
        const { api, confirmSpy } = await bookWithAddOn(true, true);
        await vi.waitFor(() => {
          expect(api.createBookingDraft).toHaveBeenCalledWith(expect.objectContaining({ addOnIds: ["addon-1"] }));
        });
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(api.createBookingDraft).not.toHaveBeenCalledWith(expect.objectContaining({ overrideAvailability: true }));
        confirmSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });
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