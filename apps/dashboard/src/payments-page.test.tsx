import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser, DepositPaymentFollowUpItem } from "@booking/shared-types";

import { PaymentsPage, type PaymentsPageApi } from "./payments-page";

const ownerUser: AuthenticatedUser = {
  id: "user-1",
  tenantId: "tenant-1",
  tenantSlug: "brow-beauty-lab",
  email: "owner@browbeautylab.test",
  name: "Melissa Chang",
  role: "owner",
  permissions: [
    { key: "payments.view", allowed: true },
    { key: "payments.manage", allowed: true },
  ],
};

const readOnlyUser: AuthenticatedUser = {
  ...ownerUser,
  id: "user-2",
  email: "staff@browbeautylab.test",
  role: "staff",
  permissions: [
    { key: "payments.view", allowed: true },
    { key: "payments.manage", allowed: false },
  ],
};

const baseFollowUpItem = {
  bookingDraft: {
    id: "draft-1",
    tenantId: "tenant-1",
    createdAt: "2026-05-24T15:00:00.000Z",
    updatedAt: "2026-05-24T15:00:00.000Z",
    customerId: "customer-1",
    serviceId: "service-1",
    providerId: "provider-1",
    locationId: "location-1",
    status: "awaiting_payment",
    bookingMethod: "staff_entered",
    startsAt: "2026-05-25T17:00:00.000Z",
    endsAt: "2026-05-25T18:00:00.000Z",
    expiresAt: "2026-05-25T18:15:00.000Z",
    priceCents: 10000,
    depositCents: 2500,
    durationMinutes: 60,
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
    intakePlan: null,
    formRequirements: [],
  },
  paymentId: "payment-1",
  paymentStatus: "pending",
  checkoutSessionId: null,
  checkoutUrl: null,
  checkoutExpiresAt: null,
  linkState: "missing",
} as DepositPaymentFollowUpItem;

const listResponse = { items: [baseFollowUpItem] };

const renderPaymentsPage = (api: PaymentsPageApi, currentUser: AuthenticatedUser = ownerUser) =>
  render(
    <PaymentsPage
      definition={{
        eyebrow: "Checkout and balance",
        description: "Deposits, hosted balance checkout, POS collection, corrections, and follow-up balances.",
        metric: "Live reminder queue",
      }}
      currentUser={currentUser}
      api={api}
      storefrontBaseUrl="http://127.0.0.1:3001"
    />,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PaymentsPage", () => {
  it("reopens a deposit checkout link and opens it in a new tab", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const api: PaymentsPageApi = {
      listPaymentFollowUp: vi.fn().mockResolvedValue(listResponse),
      createCheckoutSession: vi.fn().mockResolvedValue({
        checkoutUrl: "https://checkout.stripe.test/deposit_123",
        sessionId: "deposit_123",
        expiresAt: "2026-05-25T00:00:00.000Z",
      }),
      sendPaymentReminder: vi.fn(),
    };

    renderPaymentsPage(api);

    fireEvent.click(await screen.findByRole("button", { name: "Reopen checkout link" }));

    await waitFor(() => {
      expect(api.createCheckoutSession).toHaveBeenCalledWith({
        tenantSlug: "brow-beauty-lab",
        bookingDraftId: "draft-1",
        kind: "deposit",
        successUrl: "http://127.0.0.1:3001/brow-beauty-lab/book/draft-1/success",
        cancelUrl: "http://127.0.0.1:3001/brow-beauty-lab/book/draft-1",
      });
    });

    expect(openSpy).toHaveBeenCalledWith("https://checkout.stripe.test/deposit_123", "_blank", "noopener,noreferrer");
    expect(await screen.findByText("Generated a fresh checkout link and opened it in a new tab.")).toBeInTheDocument();
  });

  it("sends a real reminder email and refreshes the follow-up queue", async () => {
    const api: PaymentsPageApi = {
      listPaymentFollowUp: vi.fn().mockResolvedValue(listResponse),
      createCheckoutSession: vi.fn(),
      sendPaymentReminder: vi.fn().mockResolvedValue({
        bookingDraftId: "draft-1",
        paymentId: "payment-1",
        checkoutSessionId: "checkout-1",
        checkoutUrl: "https://checkout.stripe.test/deposit_123",
        recipientEmail: "guest@example.com",
        provider: "resend",
        providerMessageId: "message-1",
        sentAt: "2026-05-24T16:00:00.000Z",
      }),
    };

    renderPaymentsPage(api);

    fireEvent.click(await screen.findByRole("button", { name: "Send reminder email" }));

    await waitFor(() => {
      expect(api.sendPaymentReminder).toHaveBeenCalledWith("brow-beauty-lab", "draft-1");
    });

    expect(api.listPaymentFollowUp).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Reminder email sent to guest@example.com.")).toBeInTheDocument();
  });

  it("shows read-only payment follow-up controls when the role cannot manage payments", async () => {
    const api: PaymentsPageApi = {
      listPaymentFollowUp: vi.fn().mockResolvedValue(listResponse),
      createCheckoutSession: vi.fn(),
      sendPaymentReminder: vi.fn(),
    };

    renderPaymentsPage(api, readOnlyUser);

    expect(await screen.findByText("Your role can review payment follow-up work, but it cannot send reminders, reopen links, or draft outreach.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Send reminder email" })).toBeDisabled();
    expect(await screen.findByRole("button", { name: "Reopen checkout link" })).toBeDisabled();
    expect(await screen.findByRole("button", { name: "Draft reminder email" })).toBeDisabled();
    expect(await screen.findByRole("button", { name: "Copy checkout link" })).toBeDisabled();
  });
});