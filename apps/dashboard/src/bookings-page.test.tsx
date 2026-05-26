import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser, BookingSummary } from "@booking/shared-types";

import { BookingsPage, type BookingsPageApi } from "./bookings-page";

const ownerUser: AuthenticatedUser = {
  id: "user-1",
  tenantId: "tenant-1",
  tenantSlug: "brow-beauty-lab",
  email: "owner@browbeautylab.test",
  name: "Melissa Chang",
  role: "owner",
  permissions: [
    { key: "bookings.view", allowed: true },
    { key: "bookings.complete", allowed: true },
    { key: "bookings.collect_payment", allowed: true },
  ],
};

const providerUser: AuthenticatedUser = {
  ...ownerUser,
  id: "user-2",
  email: "provider@browbeautylab.test",
  role: "provider",
  permissions: [
    { key: "bookings.view", allowed: true },
    { key: "bookings.complete", allowed: false },
    { key: "bookings.collect_payment", allowed: false },
  ],
};

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
  startsAt: "2026-05-25T17:00:00.000Z",
  endsAt: "2026-05-25T18:00:00.000Z",
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
    priceCents: 10000,
    depositCents: 2500,
    isActive: true,
    imageUrl: null,
    imageAltText: null,
    locationIds: ["location-1"],
    formIds: [],
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

const listResponse = { items: [baseBooking], meta: { limit: 60, offset: 0, total: 1 } };

afterEach(() => {
  vi.restoreAllMocks();
});

const renderBookingsPage = (api: BookingsPageApi, currentUser: AuthenticatedUser | null = ownerUser) =>
  render(
    <MemoryRouter>
      <BookingsPage
        definition={{
          eyebrow: "Lifecycle management",
          description: "Confirmed visits, completion controls, cancellation decisions, and auditable booking history.",
          metric: "Next API slice",
        }}
        currentUser={currentUser}
        api={api}
        storefrontBaseUrl="http://127.0.0.1:3001"
      />
    </MemoryRouter>,
  );

describe("BookingsPage", () => {
  it("completes a confirmed booking with follow-up", async () => {
    const api: BookingsPageApi = {
      listBookings: vi
        .fn()
        .mockResolvedValueOnce({ items: [baseBooking], meta: { limit: 60, offset: 0, total: 1 } })
        .mockResolvedValueOnce({
          items: [{ ...baseBooking, status: "completed", paymentResolution: "follow_up" }],
          meta: { limit: 60, offset: 0, total: 1 },
        }),
      recordManualPayment: vi.fn(),
      updateBookingStatus: vi.fn().mockResolvedValue({ ...baseBooking, status: "completed", paymentResolution: "follow_up" }),
      createCheckoutSession: vi.fn(),
    };

    renderBookingsPage(api);

    await screen.findByText("Confirmed visits and balance follow-up");

    fireEvent.click(await screen.findByRole("button", { name: "Complete with follow-up" }));

    await waitFor(() => {
      expect(api.updateBookingStatus).toHaveBeenCalledWith("brow-beauty-lab", "booking-1", {
        status: "completed",
        paymentResolution: "follow_up",
      });
    });

    expect(await screen.findByText("Marked the visit completed with balance follow-up still due.")).toBeInTheDocument();
  });

  it("shows a read-only notice when the role cannot complete or collect payments", async () => {
    const api: BookingsPageApi = {
      listBookings: vi.fn().mockResolvedValue(listResponse),
      recordManualPayment: vi.fn(),
      updateBookingStatus: vi.fn(),
      createCheckoutSession: vi.fn(),
    };

    renderBookingsPage(api, providerUser);

    expect(await screen.findByText("Your role can review lifecycle work, but it cannot complete visits or mark no-shows.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Collect cash & complete" })).toBeDisabled();
  });

  it("records the exact external POS amount and completes the visit", async () => {
    const api: BookingsPageApi = {
      listBookings: vi
        .fn()
        .mockResolvedValueOnce(listResponse)
        .mockResolvedValueOnce({
          items: [{ ...baseBooking, status: "completed", paymentResolution: "collected", amountPaidCents: 10525, balanceDueCents: 0 }],
          meta: { limit: 60, offset: 0, total: 1 },
        }),
      recordManualPayment: vi.fn().mockResolvedValue({ ...baseBooking, amountPaidCents: 10525, balanceDueCents: 0 }),
      updateBookingStatus: vi.fn().mockResolvedValue({ ...baseBooking, status: "completed", paymentResolution: "collected", amountPaidCents: 10525, balanceDueCents: 0 }),
      createCheckoutSession: vi.fn(),
    };

    renderBookingsPage(api);

    fireEvent.change(await screen.findByLabelText("Exact collected amount"), { target: { value: "80.25" } });
    fireEvent.click(await screen.findByRole("button", { name: "External POS & complete" }));

    await waitFor(() => {
      expect(api.recordManualPayment).toHaveBeenCalledWith("brow-beauty-lab", "booking-1", {
        amountCents: 8025,
        paymentMethodType: "external_pos",
      });
    });

    expect(api.updateBookingStatus).toHaveBeenCalledWith("brow-beauty-lab", "booking-1", {
      status: "completed",
      paymentResolution: "collected",
    });
    expect(await screen.findByText("Collected $80.25 by external POS and marked the visit completed.")).toBeInTheDocument();
  });

  it("opens the hosted balance checkout for a balance-due booking", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const api: BookingsPageApi = {
      listBookings: vi.fn().mockResolvedValue(listResponse),
      recordManualPayment: vi.fn(),
      updateBookingStatus: vi.fn(),
      createCheckoutSession: vi.fn().mockResolvedValue({
        checkoutUrl: "https://checkout.stripe.test/session_123",
        checkoutSessionId: "session_123",
        expiresAt: "2026-05-25T00:00:00.000Z",
        kind: "booking_balance",
      }),
    };

    renderBookingsPage(api);

    fireEvent.click(await screen.findByRole("button", { name: "Open hosted checkout" }));

    await waitFor(() => {
      expect(api.createCheckoutSession).toHaveBeenCalledWith({
        tenantSlug: "brow-beauty-lab",
        bookingId: "booking-1",
        kind: "booking_balance",
        successUrl: "http://127.0.0.1:3001/cancel/manage-token-1?sessionId={CHECKOUT_SESSION_ID}",
        cancelUrl: "http://127.0.0.1:3001/cancel/manage-token-1",
      });
    });

    expect(openSpy).toHaveBeenCalledWith("https://checkout.stripe.test/session_123", "_blank", "noopener,noreferrer");
    expect(await screen.findByText("Opened the hosted balance checkout in a new tab.")).toBeInTheDocument();
  });
});