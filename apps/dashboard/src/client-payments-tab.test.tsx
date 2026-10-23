import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ClientPaymentsTab, type ClientPaymentsApi } from "./client-payments-tab";

const sale = {
  id: "sale-1",
  saleNumber: 12,
  customerId: "c1",
  customerName: "Rina Patel",
  completedAt: "2026-10-20T16:30:00.000Z",
  currency: "USD",
  subtotalCents: 15000,
  discountCents: 0,
  taxCents: 1800,
  tipCents: 0,
  totalCents: 16800,
  paidCents: 3500,
  balanceDueCents: 13300,
};

const makeApi = (overrides: Partial<ClientPaymentsApi> = {}): ClientPaymentsApi => ({
  listSales: vi.fn().mockResolvedValue({ sales: [sale], total: 1, limit: 25, offset: 0 }),
  listTransactions: vi.fn().mockResolvedValue({
    total: 3,
    limit: 50,
    offset: 0,
    transactions: [
      { id: "t1", occurredAt: "2026-10-15T20:00:00.000Z", type: "deposit_collected", amountCents: 3500, cashCents: 3500, tipCents: 0 },
      { id: "t2", occurredAt: "2026-10-16T20:00:00.000Z", type: "refund", amountCents: 500, cashCents: -500, tipCents: 0 },
      { id: "t3", occurredAt: "2026-10-20T16:30:00.000Z", type: "deposit_redeemed", amountCents: 3000, cashCents: 0, tipCents: 0, saleNumber: 12 },
    ],
  }),
  getCustomerWallet: vi.fn().mockResolvedValue({
    customerId: "c1",
    balanceCents: 2500,
    transactions: [
      { id: "w1", createdAt: "2026-10-18T20:00:00.000Z", amountCents: 2500, kind: "staff_adjustment", notes: "Goodwill", actorName: "Melissa Chang" },
    ],
  }),
  getSaleReceipt: vi.fn().mockResolvedValue({
    saleId: "sale-1",
    saleNumber: 12,
    completedAt: "2026-10-20T16:30:00.000Z",
    currency: "USD",
    timeZone: "America/Los_Angeles",
    business: { name: "Brow Beauty Lab", addressLines: [] },
    customer: { id: "c1", name: "Rina Patel", email: null },
    lines: [],
    subtotalCents: 0,
    discountCents: 0,
    taxCents: 0,
    tipCents: 0,
    totalCents: 0,
    payments: [],
    paidCents: 0,
    balanceDueCents: 0,
  }),
  emailSaleReceipt: vi.fn(),
  ...overrides,
});

const show = (api: ClientPaymentsApi, view = true, manage = true) =>
  render(
    <ClientPaymentsTab api={api} tenantSlug="brow-beauty-lab" customerId="c1" canViewPayments={view} canManagePayments={manage} />,
  );

describe("ClientPaymentsTab", () => {
  it("lists the client's sales with what is still owed, and loads only that client's data", async () => {
    const api = makeApi();
    show(api);
    const sales = await screen.findByRole("region", { name: "Sales" });
    expect(within(sales).getByText("#12")).toBeInTheDocument();
    expect(within(sales).getByText("$168.00")).toBeInTheDocument();
    expect(within(sales).getByText("$133.00")).toBeInTheDocument(); // balance
    expect(api.listSales).toHaveBeenCalledWith("brow-beauty-lab", { customerId: "c1", limit: 25 });
    expect(api.listTransactions).toHaveBeenCalledWith("brow-beauty-lab", { customerId: "c1", limit: 50 });
    expect(api.getCustomerWallet).toHaveBeenCalledWith("brow-beauty-lab", "c1");
  });

  it("opens that sale's receipt", async () => {
    const api = makeApi();
    show(api);
    fireEvent.click(await screen.findByRole("button", { name: "Receipt for sale 12" }));
    expect(await screen.findByRole("dialog", { name: "Receipt" })).toBeInTheDocument();
    expect(api.getSaleReceipt).toHaveBeenCalledWith("brow-beauty-lab", "sale-1");
  });

  it("shows payments, refunds and deposits applied, with no cash noted where none moved", async () => {
    show(makeApi());
    const history = await screen.findByRole("region", { name: "Payments and refunds" });
    expect(within(history).getByText("+$35.00")).toBeInTheDocument();
    expect(within(history).getByText("−$5.00")).toBeInTheDocument();
    expect(within(history).getByText("Deposit applied")).toBeInTheDocument();
    expect(within(history).getByText("no cash moved")).toBeInTheDocument();
  });

  it("shows the wallet balance and who changed it", async () => {
    show(makeApi());
    const wallet = await screen.findByRole("region", { name: "Wallet history" });
    expect(within(wallet).getByText("Balance $25.00")).toBeInTheDocument();
    expect(within(wallet).getByText("Staff adjustment")).toBeInTheDocument();
    expect(within(wallet).getByText(/Goodwill/)).toBeInTheDocument();
    expect(within(wallet).getByText(/Melissa Chang/)).toBeInTheDocument();
  });

  it("explains empty states", async () => {
    show(
      makeApi({
        listSales: vi.fn().mockResolvedValue({ sales: [], total: 0, limit: 25, offset: 0 }),
        listTransactions: vi.fn().mockResolvedValue({ transactions: [], total: 0, limit: 50, offset: 0 }),
        getCustomerWallet: vi.fn().mockResolvedValue({ customerId: "c1", balanceCents: 0, transactions: [] }),
      }),
    );
    expect(await screen.findByText(/No completed sales yet/)).toBeInTheDocument();
    expect(screen.getByText("No payments recorded for this client.")).toBeInTheDocument();
    expect(screen.getByText("No wallet activity.")).toBeInTheDocument();
  });

  it("shows an error per section instead of an empty list", async () => {
    show(makeApi({ listSales: vi.fn().mockRejectedValue(new Error("Sales are unavailable.")) }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sales are unavailable.");
    // the other sections still load
    expect(await screen.findByText("Balance $25.00")).toBeInTheDocument();
  });

  it("hides sales and payments, and doesn't request them, without payments access", async () => {
    const api = makeApi();
    show(api, false, false);
    expect(await screen.findByText(/can't view payments/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sales" })).toBeNull();
    expect(api.listSales).not.toHaveBeenCalled();
    expect(api.listTransactions).not.toHaveBeenCalled();
    expect(await screen.findByText("Balance $25.00")).toBeInTheDocument(); // wallet needs only client access
  });
});
