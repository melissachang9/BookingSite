import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloverDevicePayment } from "@booking/shared-types";

import { CloverDevicePaymentPicker } from "./clover-device-payment-picker";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function payment(overrides: Partial<CloverDevicePayment> = {}): CloverDevicePayment {
  return {
    id: "PAY1",
    amountCents: 3500,
    tipCents: 0,
    totalCents: 3500,
    cardBrand: "VISA",
    cardLast4: "4242",
    createdAt: "2026-10-13T17:05:00.000Z",
    matches: "deposit",
    ...overrides,
  };
}

function setup(items: CloverDevicePayment[], extra: Partial<Parameters<typeof CloverDevicePaymentPicker>[0]> = {}) {
  const api = { listCloverDevicePayments: vi.fn().mockResolvedValue({ items }) };
  const onSelect = vi.fn();
  render(
    <CloverDevicePaymentPicker
      tenantSlug="studio"
      api={api}
      bookingDraftId="draft-1"
      selectedId={null}
      onSelect={onSelect}
      {...extra}
    />,
  );
  return { api, onSelect };
}

describe("CloverDevicePaymentPicker", () => {
  it("shows a loading state, then the payments with the card and tip", async () => {
    setup([payment(), payment({ id: "PAY2", cardBrand: "MC", cardLast4: "1111", tipCents: 500, totalCents: 4000 })]);
    expect(screen.getByRole("status")).toHaveTextContent("Looking for payments");
    expect(await screen.findByText("VISA ••4242")).toBeInTheDocument();
    expect(screen.getByText("MC ••1111")).toBeInTheDocument();
    expect(screen.getByText(/\+ \$5\.00 tip/)).toBeInTheDocument();
    expect(screen.getAllByText("Matches deposit")).toHaveLength(2);
  });

  it("asks for the booking context so the server can flag matches", async () => {
    const { api } = setup([payment()]);
    await screen.findByText("VISA ••4242");
    expect(api.listCloverDevicePayments).toHaveBeenCalledWith("studio", {
      sinceMinutes: 60,
      bookingDraftId: "draft-1",
      bookingId: undefined,
    });
  });

  it("lets staff pick a matching payment and un-pick it", async () => {
    const first = payment();
    const { onSelect } = setup([first]);
    fireEvent.click(await screen.findByRole("button", { name: /VISA ••4242/ }));
    expect(onSelect).toHaveBeenCalledWith(first);
  });

  it("doesn't let staff pick a payment that doesn't match", async () => {
    const { onSelect } = setup([payment({ id: "PAYX", matches: null, amountCents: 999, totalCents: 999 })]);
    const row = await screen.findByRole("button", { name: /Doesn't match/ });
    expect(row).toBeDisabled();
    fireEvent.click(row);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("explains an empty list", async () => {
    setup([]);
    expect(await screen.findByText(/No unmatched payments in the last hour/)).toBeInTheDocument();
  });

  it("shows an error with a retry, e.g. when Clover needs reconnecting", async () => {
    const api = { listCloverDevicePayments: vi.fn().mockRejectedValueOnce(new Error("Clover needs to be reconnected")).mockResolvedValue({ items: [payment()] }) };
    render(<CloverDevicePaymentPicker tenantSlug="studio" api={api} selectedId={null} onSelect={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Clover needs to be reconnected");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("VISA ••4242")).toBeInTheDocument();
  });

  it("polls for new payments while visible and stops when unmounted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api } = setup([payment()], { pollMs: 1000 });
    await screen.findByText("VISA ••4242");
    const calls = api.listCloverDevicePayments.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(api.listCloverDevicePayments.mock.calls.length).toBeGreaterThanOrEqual(calls + 2);

    cleanup();
    const after = api.listCloverDevicePayments.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.listCloverDevicePayments.mock.calls.length).toBe(after);
  });

  it("drops a selection that disappears from the list", async () => {
    const api = {
      listCloverDevicePayments: vi
        .fn()
        .mockResolvedValueOnce({ items: [payment()] })
        .mockResolvedValue({ items: [] }),
    };
    const onSelect = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<CloverDevicePaymentPicker tenantSlug="studio" api={api} selectedId="PAY1" onSelect={onSelect} pollMs={500} />);
    await screen.findByText("VISA ••4242");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null));
  });
});
