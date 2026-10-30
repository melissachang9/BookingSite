import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AuthenticatedUser,
  CustomerBookingAttempt,
  LiabilitySummary,
  MoneyOwed,
  TransactionListResponse,
} from "@booking/shared-types";

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
    { key: "customers.view", allowed: true },
    { key: "customers.manage", allowed: true },
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

const emptyTransactions: TransactionListResponse = { transactions: [], total: 0, limit: 25, offset: 0 };
const emptyOwed: MoneyOwed = { refundsOwed: [], balancesOwed: [], refundsOwedTotalCents: 0, balancesOwedTotalCents: 0 };
const bucket = {
  openingCents: 0,
  collectedCents: 0,
  redeemedCents: 0,
  refundedCents: 0,
  movedToWalletCents: 0,
  forfeitedCents: 0,
  closingCents: 0,
};
const emptyLiabilities: LiabilitySummary = {
  deposits: bucket,
  wallet: { openingCents: 0, addedCents: 0, usedCents: 0, closingCents: 0 },
};

/** The money-record calls most tests don't care about. */
const ledgerStubs = () => ({
  listTransactions: vi.fn().mockResolvedValue(emptyTransactions),
  getLiabilitySummary: vi.fn().mockResolvedValue(emptyLiabilities),
  getMoneyOwed: vi.fn().mockResolvedValue(emptyOwed),
  listSales: vi.fn().mockResolvedValue({ sales: [], total: 0, limit: 25, offset: 0 }),
  getSaleReceipt: vi.fn(),
  emailSaleReceipt: vi.fn(),
  listBookingAttempts: vi.fn().mockResolvedValue({ items: [] }),
  markBookingAttemptFollowedUp: vi.fn(),
  dismissBookingAttempt: vi.fn(),
});

const openFollowUpTab = () => fireEvent.click(screen.getByRole("tab", { name: "Follow-up" }));

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
    />,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

const lead = {
  outcome: "abandoned" as const,
  serviceName: "Signature Facial",
  providerName: "Maya",
  startsAt: "2026-06-02T17:00:00.000Z",
  createdAt: "2026-05-25T18:00:00.000Z",
  bookedSince: false,
  bookingMethod: "public_online",
  customerId: "customer-1",
  customerEmail: "pat@example.com",
  customerPhone: "6045550101",
};
const coldLead: CustomerBookingAttempt = { ...lead, id: "cold", customerName: "Cold Cart" };
const warmLead: CustomerBookingAttempt = {
  ...lead,
  id: "warm",
  outcome: "financing_started",
  customerName: "Warm Lead",
  financingStartedAt: "2026-05-25T18:05:00.000Z",
};

describe("PaymentsPage follow-up tab", () => {
  it("lists clients who opened financing and clients who abandoned, with counts and filters", async () => {
    const api: PaymentsPageApi = { ...ledgerStubs() };
    (api.listBookingAttempts as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [warmLead, coldLead] });

    renderPaymentsPage(api);
    openFollowUpTab();

    const panel = await screen.findByRole("region", { name: "Follow up" });
    expect(await within(panel).findByText("Warm Lead")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Opened financing");
    expect(panel).toHaveTextContent("opened financing May 25");
    expect(panel).toHaveTextContent("Cold Cart");
    expect(panel).toHaveTextContent("6045550101 · pat@example.com");
    expect(panel).toHaveTextContent("2 to follow up");
    expect(within(panel).getByRole("link", { name: "Warm Lead" })).toHaveAttribute("href", "/customers?customerId=customer-1");
    expect(within(panel).getByRole("button", { name: "Opened financing · 1" })).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "Abandoned · 1" }));
    expect(within(panel).queryByText("Warm Lead")).not.toBeInTheDocument();
    expect(within(panel).getByText("Cold Cart")).toBeInTheDocument();
  });

  it("marks a client as followed up with a note and moves them out of the open list", async () => {
    const api: PaymentsPageApi = { ...ledgerStubs() };
    (api.listBookingAttempts as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [warmLead] });
    (api.markBookingAttemptFollowedUp as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...warmLead,
      followUpAt: "2026-05-26T15:00:00.000Z",
      followUpByName: "Owner",
      followUpNote: "Left a voicemail",
    });

    renderPaymentsPage(api);
    openFollowUpTab();

    fireEvent.click(await screen.findByRole("button", { name: "Mark followed up" }));
    fireEvent.change(screen.getByLabelText("Follow-up note for Warm Lead"), { target: { value: "Left a voicemail" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.markBookingAttemptFollowedUp).toHaveBeenCalledWith("brow-beauty-lab", "warm", { note: "Left a voicemail" }),
    );
    // Gone from the list and the count; the record lives on the client's profile.
    await waitFor(() => expect(screen.queryByText("Warm Lead")).not.toBeInTheDocument());
    expect(screen.getByText("0 to follow up")).toBeInTheDocument();
    expect(screen.getByText("Nobody is waiting for a follow-up.")).toBeInTheDocument();
  });

  it("removes a client from the list with a reason, which is not the same as following up", async () => {
    const api: PaymentsPageApi = { ...ledgerStubs() };
    (api.listBookingAttempts as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [warmLead, coldLead] });
    (api.dismissBookingAttempt as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...coldLead,
      dismissedAt: "2026-05-26T15:00:00.000Z",
      dismissedReason: "booked_another_way",
      dismissedByName: "Owner",
    });

    renderPaymentsPage(api);
    openFollowUpTab();

    await screen.findByText("Cold Cart");
    fireEvent.click(screen.getAllByRole("button", { name: "Remove from list" })[1]);
    fireEvent.change(screen.getByLabelText("Reason for removing Cold Cart"), { target: { value: "booked_another_way" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(api.dismissBookingAttempt).toHaveBeenCalledWith("brow-beauty-lab", "cold", { reason: "booked_another_way", note: null }),
    );
    await waitFor(() => expect(screen.queryByText("Cold Cart")).not.toBeInTheDocument());
    expect(api.markBookingAttemptFollowedUp).not.toHaveBeenCalled();
    expect(screen.getByText("Warm Lead")).toBeInTheDocument();
    expect(screen.getByText("1 to follow up")).toBeInTheDocument();
  });

  it("needs a note when the removal reason is Other", async () => {
    const api: PaymentsPageApi = { ...ledgerStubs() };
    (api.listBookingAttempts as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [coldLead] });

    renderPaymentsPage(api);
    openFollowUpTab();

    fireEvent.click(await screen.findByRole("button", { name: "Remove from list" }));
    fireEvent.change(screen.getByLabelText("Reason for removing Cold Cart"), { target: { value: "other" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Add a note explaining why");
    expect(api.dismissBookingAttempt).not.toHaveBeenCalled();
    expect(screen.getByText("Cold Cart")).toBeInTheDocument();
  });

  it("hides the follow-up action from staff who can't manage clients", async () => {
    const api: PaymentsPageApi = { ...ledgerStubs() };
    (api.listBookingAttempts as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [warmLead] });
    const viewOnly: AuthenticatedUser = {
      ...ownerUser,
      permissions: [
        { key: "payments.view", allowed: true },
        { key: "customers.view", allowed: true },
      ],
    };

    renderPaymentsPage(api, viewOnly);
    openFollowUpTab();

    expect(await screen.findByText("Warm Lead")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark followed up" })).not.toBeInTheDocument();
  });

  it("doesn't load client follow-ups for a role that can't view clients", async () => {
    const api: PaymentsPageApi = { ...ledgerStubs() };

    renderPaymentsPage(api, readOnlyUser);
    openFollowUpTab();

    expect(await screen.findByText("Your role can view payments, but it cannot view clients to follow up with.")).toBeInTheDocument();
    expect(api.listBookingAttempts).not.toHaveBeenCalled();
  });

  it("shows an error when the follow-up list can't load", async () => {
    const api: PaymentsPageApi = { ...ledgerStubs() };
    (api.listBookingAttempts as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));

    renderPaymentsPage(api);
    openFollowUpTab();

    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});

describe("PaymentsPage", () => {
  it("lists transactions with signed amounts, sale numbers and a tip note", async () => {
    const api: PaymentsPageApi = {
      ...ledgerStubs(),
    };
    (api.listTransactions as ReturnType<typeof vi.fn>).mockResolvedValue({
      total: 3,
      limit: 25,
      offset: 0,
      transactions: [
        {
          id: "payment:1",
          occurredAt: "2026-10-20T17:00:00.000Z",
          type: "deposit_collected",
          amountCents: 3500,
          cashCents: 3500,
          tipCents: 0,
          method: "stripe",
          customerName: "Rina Patel",
          saleId: "sale-7",
          saleNumber: 7,
        },
        {
          id: "event:2",
          occurredAt: "2026-10-20T18:00:00.000Z",
          type: "refund",
          amountCents: 500,
          cashCents: -500,
          tipCents: 0,
          method: "stripe",
          customerName: "Rina Patel",
        },
        {
          id: "tender:3",
          occurredAt: "2026-10-21T18:00:00.000Z",
          type: "deposit_redeemed",
          amountCents: 3000,
          cashCents: 0,
          tipCents: 0,
          method: "deposit",
          customerName: "Rina Patel",
          saleId: "sale-7",
          saleNumber: 7,
        },
      ],
    });

    renderPaymentsPage(api);

    expect(await screen.findByText("+$35.00")).toBeInTheDocument();
    expect(screen.getByText("−$5.00")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Deposit collected")).toBeInTheDocument();
    expect(screen.getByText("Applied to sale #7")).toBeInTheDocument();
    expect(screen.getByText("no cash moved")).toBeInTheDocument();
    expect(screen.getAllByText("#7").length).toBeGreaterThan(0);
    expect(screen.getByText("3 total")).toBeInTheDocument();
  });

  it("filters transactions by type and shows an empty state", async () => {
    const api: PaymentsPageApi = {
      ...ledgerStubs(),
    };
    renderPaymentsPage(api);
    expect(await screen.findByText("No payments have been recorded yet.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "refund" } });
    await waitFor(() =>
      expect(api.listTransactions).toHaveBeenLastCalledWith(
        "brow-beauty-lab",
        expect.objectContaining({ type: ["refund"], offset: 0 }),
      ),
    );
    expect(await screen.findByText("No transactions match these filters.")).toBeInTheDocument();
  });

  it("shows a transactions error instead of an empty list", async () => {
    const api: PaymentsPageApi = {
      ...ledgerStubs(),
    };
    (api.listTransactions as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Server is down"));
    renderPaymentsPage(api);
    expect(await screen.findByRole("alert")).toHaveTextContent("Server is down");
  });

  it("shows money held as opening plus collected minus used equals closing", async () => {
    const api: PaymentsPageApi = {
      ...ledgerStubs(),
    };
    (api.getLiabilitySummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      deposits: { ...bucket, openingCents: 1000, collectedCents: 3500, redeemedCents: 3000, closingCents: 1500 },
      wallet: { openingCents: 500, addedCents: 200, usedCents: 100, closingCents: 600 },
    });
    renderPaymentsPage(api);
    fireEvent.click(screen.getByRole("tab", { name: "Money held" }));

    const deposits = await screen.findByRole("region", { name: "Deposits held" });
    expect(within(deposits).getByText("Closing balance").closest("tr")).toHaveTextContent("$15.00");
    expect(within(deposits).getByText(/Applied at checkout/).closest("tr")).toHaveTextContent("$30.00");
    const wallet = screen.getByRole("region", { name: "Wallet credit held" });
    expect(within(wallet).getByText("Closing balance").closest("tr")).toHaveTextContent("$6.00");
  });

  it("lists refunds to give and balances owed on the follow-up tab", async () => {
    const api: PaymentsPageApi = {
      ...ledgerStubs(),
    };
    (api.getMoneyOwed as ReturnType<typeof vi.fn>).mockResolvedValue({
      refundsOwed: [
        { paymentId: "p1", customerId: "c1", customerName: "Rina Patel", amountCents: 3500, owedSince: "2026-10-20T17:00:00.000Z" },
      ],
      balancesOwed: [
        { bookingId: "b1", customerId: "c2", customerName: "Ava Lee", serviceName: "Facial", balanceDueCents: 12228, saleNumber: 9 },
      ],
      refundsOwedTotalCents: 3500,
      balancesOwedTotalCents: 12228,
    });
    renderPaymentsPage(api);
    openFollowUpTab();

    const refunds = await screen.findByRole("region", { name: "Refunds to give" });
    expect(within(refunds).getByText("Rina Patel")).toBeInTheDocument();
    expect(within(refunds).getByText(/\$35\.00 to refund on the card device/)).toBeInTheDocument();
    const balances = screen.getByRole("region", { name: "Balances owed" });
    expect(within(balances).getByText(/\$122\.28 for Facial/)).toBeInTheDocument();
    expect(within(balances).getByText(/Sale #9/)).toBeInTheDocument();
  });

  it("keeps people without payment access out of every tab", async () => {
    const noAccess: AuthenticatedUser = { ...ownerUser, permissions: [] };
    const api: PaymentsPageApi = {
      ...ledgerStubs(),
    };
    renderPaymentsPage(api, noAccess);
    expect(screen.getByText(/cannot view payments/)).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(api.listTransactions).not.toHaveBeenCalled();
  });

  it("opens the receipt when a sale number is clicked", async () => {
    const api: PaymentsPageApi = {
      ...ledgerStubs(),
    };
    (api.listTransactions as ReturnType<typeof vi.fn>).mockResolvedValue({
      total: 1,
      limit: 25,
      offset: 0,
      transactions: [
        {
          id: "payment:1",
          occurredAt: "2026-10-20T17:00:00.000Z",
          type: "deposit_collected",
          amountCents: 3500,
          cashCents: 3500,
          tipCents: 0,
          method: "card",
          customerName: "Rina Patel",
          saleId: "sale-7",
          saleNumber: 7,
        },
      ],
    });
    (api.getSaleReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
      saleId: "sale-7",
      saleNumber: 7,
      completedAt: "2026-10-20T17:00:00.000Z",
      currency: "USD",
      timeZone: "America/Los_Angeles",
      business: { name: "Brow Beauty Lab", addressLines: [] },
      customer: { id: "c1", name: "Rina Patel", email: "rina@example.com" },
      lines: [],
      subtotalCents: 0,
      discountCents: 0,
      taxCents: 0,
      tipCents: 0,
      totalCents: 0,
      payments: [],
      paidCents: 0,
      balanceDueCents: 0,
    });
    renderPaymentsPage(api);

    fireEvent.click(await screen.findByRole("button", { name: "Open receipt for sale 7" }));
    expect(await screen.findByRole("dialog", { name: "Receipt" })).toBeInTheDocument();
    expect(api.getSaleReceipt).toHaveBeenCalledWith("brow-beauty-lab", "sale-7");
  });

  it("lists numbered sales with what is still owed and opens a receipt", async () => {
    const api: PaymentsPageApi = {
      ...ledgerStubs(),
    };
    (api.listSales as ReturnType<typeof vi.fn>).mockResolvedValue({
      total: 2,
      limit: 25,
      offset: 0,
      sales: [
        {
          id: "sale-2", saleNumber: 2, customerId: "c2", customerName: "Ava Lee", completedAt: "2026-10-21T18:00:00.000Z",
          currency: "USD", subtotalCents: 12000, discountCents: 0, taxCents: 1440, tipCents: 1000, totalCents: 13440,
          paidCents: 3500, balanceDueCents: 9940,
        },
        {
          id: "sale-1", saleNumber: 1, customerId: "c1", customerName: "Rina Patel", completedAt: "2026-10-20T18:00:00.000Z",
          currency: "USD", subtotalCents: 5000, discountCents: 0, taxCents: 600, tipCents: 0, totalCents: 5600,
          paidCents: 5600, balanceDueCents: 0,
        },
      ],
    });
    (api.getSaleReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
      saleId: "sale-2",
      saleNumber: 2,
      completedAt: "2026-10-21T18:00:00.000Z",
      currency: "USD",
      timeZone: "America/Los_Angeles",
      business: { name: "Brow Beauty Lab", addressLines: [] },
      customer: { id: "c2", name: "Ava Lee", email: null },
      lines: [],
      subtotalCents: 12000,
      discountCents: 0,
      taxCents: 1440,
      tipCents: 1000,
      totalCents: 13440,
      payments: [],
      paidCents: 3500,
      balanceDueCents: 9940,
    });
    renderPaymentsPage(api);
    fireEvent.click(screen.getByRole("tab", { name: "Sales" }));

    const table = await screen.findByRole("table");
    const owed = within(table).getByText("#2").closest("tr") as HTMLElement;
    expect(owed).toHaveTextContent("Ava Lee");
    expect(owed).toHaveTextContent("$134.40");
    expect(owed).toHaveTextContent("+ $10.00 tip");
    expect(owed).toHaveTextContent("$99.40 due");
    const settled = within(table).getByText("#1").closest("tr") as HTMLElement;
    expect(settled).toHaveTextContent("Paid");
    expect(screen.getByText("2 total")).toBeInTheDocument();

    fireEvent.click(within(owed).getByRole("button", { name: "Receipt for sale 2" }));
    expect(await screen.findByRole("dialog", { name: "Receipt" })).toBeInTheDocument();
    expect(api.getSaleReceipt).toHaveBeenCalledWith("brow-beauty-lab", "sale-2");
  });

  it("explains an empty sales list and filters sales by date", async () => {
    const api: PaymentsPageApi = {
      ...ledgerStubs(),
    };
    renderPaymentsPage(api);
    fireEvent.click(screen.getByRole("tab", { name: "Sales" }));
    expect(await screen.findByText(/No sales yet\. A sale is numbered when a visit is marked completed/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    await waitFor(() =>
      expect(api.listSales).toHaveBeenLastCalledWith(
        "brow-beauty-lab",
        expect.objectContaining({ occurredFrom: expect.stringContaining("2026-10-01"), offset: 0 }),
      ),
    );
    expect(await screen.findByText("No sales in these dates.")).toBeInTheDocument();
  });

  it("shows a sales error instead of an empty list", async () => {
    const api: PaymentsPageApi = {
      ...ledgerStubs(),
    };
    (api.listSales as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Sales are unavailable."));
    renderPaymentsPage(api);
    fireEvent.click(screen.getByRole("tab", { name: "Sales" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sales are unavailable.");
  });
});
