import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SaleReceipt } from "@booking/shared-types";

import { ReceiptDialog, type ReceiptApi } from "./receipt-view";

const receipt: SaleReceipt = {
  saleId: "sale-1",
  saleNumber: 12,
  completedAt: "2026-10-20T16:30:00.000Z",
  currency: "CAD",
  timeZone: "America/Vancouver",
  business: {
    name: "Brow Beauty Lab",
    phone: "604 555 0100",
    locationName: "Main Studio",
    addressLines: ["120 Market Street", "Vancouver BC V6B 1A1"],
  },
  customer: { id: "c1", name: "Rina Patel", email: "rina@example.com" },
  lines: [
    { name: "Signature Facial", kind: "service", quantity: 1, unitPriceCents: 12000, lineTotalCents: 12000, taxCents: 1440, providerName: "Jordan Rivera" },
    { name: "Dermaplaning", kind: "add_on", quantity: 2, unitPriceCents: 1500, lineTotalCents: 3000, taxCents: 360 },
  ],
  subtotalCents: 15000,
  discountCents: 1000,
  taxCents: 1800,
  tipCents: 2000,
  totalCents: 15800,
  payments: [
    { paymentId: "p1", method: "deposit", receivedCents: 3500, refundedCents: 500, netCents: 3000, tipCents: 0, paidAt: "2026-10-15T20:00:00.000Z" },
    { paymentId: "p2", method: "card", receivedCents: 14800, refundedCents: 0, netCents: 12800, tipCents: 2000, cardBrand: "Visa", cardLast4: "4242" },
  ],
  paidCents: 15800,
  balanceDueCents: 0,
};

const makeApi = (overrides: Partial<ReceiptApi> = {}): ReceiptApi => ({
  getSaleReceipt: vi.fn().mockResolvedValue(receipt),
  emailSaleReceipt: vi.fn().mockResolvedValue({ saleId: "sale-1", recipientEmail: "rina@example.com", sentAt: "2026-10-20T17:00:00.000Z" }),
  ...overrides,
});

const open = (api: ReceiptApi, canEmail = true, onClose = vi.fn()) =>
  render(<ReceiptDialog api={api} tenantSlug="brow-beauty-lab" saleId="sale-1" canEmail={canEmail} onClose={onClose} />);

afterEach(() => vi.restoreAllMocks());

describe("ReceiptDialog", () => {
  it("shows the business, lines, totals and payments in the sale's own currency and timezone", async () => {
    open(makeApi());
    const paper = await screen.findByLabelText("Receipt 12");

    expect(within(paper).getByText("Brow Beauty Lab")).toBeInTheDocument();
    expect(within(paper).getByText("120 Market Street")).toBeInTheDocument();
    expect(within(paper).getByText(/Receipt #12 · Oct 20, 9:30 AM/)).toBeInTheDocument(); // Vancouver time
    expect(within(paper).getByText(/Signature Facial/)).toBeInTheDocument();
    expect(within(paper).getByText(/with Jordan Rivera/)).toBeInTheDocument();
    expect(within(paper).getByText(/Dermaplaning × 2/)).toBeInTheDocument();
    expect(within(paper).getByText("$150.00")).toBeInTheDocument(); // subtotal, no "CA" prefix
    expect(within(paper).getByText("−$10.00")).toBeInTheDocument(); // discount
    expect(within(paper).getByText("$158.00")).toBeInTheDocument(); // total
    expect(within(paper).getByText("Tip").closest("tr")).toHaveTextContent("$20.00");
    expect(within(paper).getByText(/Visa ending 4242/)).toBeInTheDocument();
    expect(within(paper).getByText(/\$5\.00 refunded/)).toBeInTheDocument();
    expect(within(paper).getByText("Paid in full")).toBeInTheDocument();
  });

  it("states the balance when something is still owed", async () => {
    open(makeApi({ getSaleReceipt: vi.fn().mockResolvedValue({ ...receipt, balanceDueCents: 12228 }) }));
    expect(await screen.findByText("Balance due $122.28")).toBeInTheDocument();
  });

  it("prints", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    open(makeApi());
    fireEvent.click(await screen.findByRole("button", { name: "Print" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("emails the receipt to the client's address, or one the operator types", async () => {
    const api = makeApi();
    open(api);
    const input = (await screen.findByLabelText("Email receipt to")) as HTMLInputElement;
    expect(input.value).toBe("rina@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Email receipt" }));
    expect(await screen.findByText("Receipt sent to rina@example.com.")).toBeInTheDocument();
    expect(api.emailSaleReceipt).toHaveBeenCalledWith("brow-beauty-lab", "sale-1", "rina@example.com");

    fireEvent.change(input, { target: { value: "accounts@example.com" } });
    expect(screen.queryByText(/Receipt sent to/)).toBeNull(); // editing clears the old confirmation
    fireEvent.click(screen.getByRole("button", { name: "Email receipt" }));
    await waitFor(() =>
      expect(api.emailSaleReceipt).toHaveBeenLastCalledWith("brow-beauty-lab", "sale-1", "accounts@example.com"),
    );
  });

  it("shows why a receipt could not be emailed", async () => {
    const api = makeApi({ emailSaleReceipt: vi.fn().mockRejectedValue(new Error("Email delivery is not configured.")) });
    open(api);
    fireEvent.click(await screen.findByRole("button", { name: "Email receipt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email delivery is not configured.");
  });

  it("hides emailing from people who can't manage payments", async () => {
    open(makeApi(), false);
    await screen.findByLabelText("Receipt 12");
    expect(screen.queryByRole("button", { name: "Email receipt" })).toBeNull();
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
  });

  it("shows an error when the receipt can't be loaded, and closes", async () => {
    const onClose = vi.fn();
    open(makeApi({ getSaleReceipt: vi.fn().mockRejectedValue(new Error("Sale was not found.")) }), true, onClose);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sale was not found.");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
