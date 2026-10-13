import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookingDraftSummary, BookingSummary, PaymentCapabilities } from "@booking/shared-types";

import { CollectDepositStep, type CollectDepositApi } from "./collect-deposit-step";

afterEach(() => cleanup());

function makeDraft(overrides: Partial<BookingDraftSummary> = {}): BookingDraftSummary {
  return {
    id: "draft-1",
    tenantId: "tenant-1",
    createdAt: "2026-10-13T17:00:00.000Z",
    updatedAt: "2026-10-13T17:00:00.000Z",
    serviceId: "service-1",
    providerId: "provider-1",
    status: "slot_held",
    bookingMethod: "staff_entered",
    startsAt: "2026-10-14T17:00:00.000Z",
    endsAt: "2026-10-14T18:00:00.000Z",
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    priceCents: 12000,
    depositCents: 3500,
    durationMinutes: 60,
    service: { id: "service-1", name: "Signature Facial" } as BookingDraftSummary["service"],
    provider: { id: "provider-1", name: "Ava Brooks" } as BookingDraftSummary["provider"],
    formRequirements: [],
    addOnsTotalCents: 0,
    taxCents: 1560,
    fullAmountCents: 13560,
    ...overrides,
  };
}

type TestApi = Omit<
  CollectDepositApi,
  "listCloverDevicePayments" | "confirmBookingDraftWithCloverPayment" | "confirmBookingDraftWithoutPayment"
> & {
  confirmBookingDraftWithPayment: ReturnType<typeof vi.fn>;
  releaseBookingDraft: ReturnType<typeof vi.fn>;
  listCloverDevicePayments?: ReturnType<typeof vi.fn>;
  confirmBookingDraftWithCloverPayment?: ReturnType<typeof vi.fn>;
  confirmBookingDraftWithoutPayment?: ReturnType<typeof vi.fn>;
};

function makeApi(): TestApi {
  return {
    confirmBookingDraftWithPayment: vi.fn().mockResolvedValue({ id: "booking-1" } as BookingSummary),
    releaseBookingDraft: vi.fn().mockResolvedValue(makeDraft({ status: "canceled" })),
  };
}

const cloverCapabilities: PaymentCapabilities = {
  processor: "clover",
  status: "connected",
  canLinkDevicePayments: true,
  canChargeCards: true,
  canRefundCards: true,
  currencyMismatch: false,
  needsReauth: false,
};

function renderStep(
  options: {
    draft?: BookingDraftSummary;
    canCollectPayment?: boolean;
    api?: TestApi;
    capabilities?: PaymentCapabilities | null;
  } = {},
) {
  const api: TestApi = options.api ?? makeApi();
  const onConfirmed = vi.fn();
  const onReleased = vi.fn();
  render(
    <CollectDepositStep
      draft={options.draft ?? makeDraft()}
      tenantSlug="brow-beauty-lab"
      api={api}
      customPaymentMethods={[{ id: "etransfer", label: "E-transfer" }]}
      canCollectPayment={options.canCollectPayment ?? true}
      capabilities={options.capabilities ?? null}
      onConfirmed={onConfirmed}
      onReleased={onReleased}
    />,
  );
  return { api, onConfirmed, onReleased };
}

const confirmButton = () => screen.getByRole("button", { name: "Record payment & confirm" });

describe("CollectDepositStep", () => {
  it("requires a POS reference and records the exact deposit", async () => {
    const { api, onConfirmed } = renderStep();

    expect(screen.getByText("$35.00")).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("e.g. 004512"), { target: { value: " 004512 " } });
    expect(confirmButton()).toBeEnabled();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith({ id: "booking-1" }));
    expect(api.confirmBookingDraftWithPayment).toHaveBeenCalledWith("brow-beauty-lab", "draft-1", {
      paymentMethodType: "external_pos",
      amountMode: "deposit",
      amountCents: 3500,
      externalReference: "004512",
    });
  });

  it("records the full amount plus tip in cash without a reference", async () => {
    const { api } = renderStep();

    fireEvent.click(screen.getByRole("radio", { name: /Full amount/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Cash/ }));
    expect(screen.queryByPlaceholderText("e.g. 004512")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "15" } });
    expect(screen.getByText("$150.60")).toBeInTheDocument();
    fireEvent.click(confirmButton());

    await waitFor(() => expect(api.confirmBookingDraftWithPayment).toHaveBeenCalled());
    expect(api.confirmBookingDraftWithPayment).toHaveBeenCalledWith("brow-beauty-lab", "draft-1", {
      paymentMethodType: "cash",
      amountMode: "full",
      amountCents: 15060,
      tipCents: 1500,
    });
  });

  it("offers the business's custom payment methods", () => {
    renderStep();
    expect(screen.getByRole("radio", { name: /E-transfer/ })).toBeInTheDocument();
  });

  it("shows the API error and stays on the step", async () => {
    const api = makeApi();
    api.confirmBookingDraftWithPayment.mockRejectedValue(new Error("The deposit is exactly $35.00."));
    const { onConfirmed } = renderStep({ api });
    fireEvent.click(screen.getByRole("radio", { name: /Cash/ }));
    fireEvent.click(confirmButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("The deposit is exactly $35.00.");
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("releases the hold", async () => {
    const { api, onReleased } = renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Release hold" }));
    await waitFor(() => expect(onReleased).toHaveBeenCalled());
    expect(api.releaseBookingDraft).toHaveBeenCalledWith("brow-beauty-lab", "draft-1", {});
  });

  it("blocks payment without the collect-payment permission", () => {
    renderStep({ canCollectPayment: false });
    expect(screen.getByRole("note")).toHaveTextContent("permission to take payments");
    fireEvent.click(screen.getByRole("radio", { name: /Cash/ }));
    expect(confirmButton()).toBeDisabled();
  });

  it("blocks payment once the hold has expired", () => {
    renderStep({ draft: makeDraft({ expiresAt: new Date(Date.now() - 1000).toISOString() }) });
    fireEvent.click(screen.getByRole("radio", { name: /Cash/ }));
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByRole("timer")).toHaveTextContent("Hold expired");
  });

  it("only offers the full amount when the service has no deposit", () => {
    renderStep({ draft: makeDraft({ depositCents: 0 }) });
    expect(screen.queryByRole("radio", { name: /Deposit/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Full amount/ })).toHaveAttribute("aria-checked", "true");
  });

  describe("Clover", () => {
    function cloverApi() {
      const api: TestApi = makeApi();
      api.listCloverDevicePayments = vi.fn().mockResolvedValue({
        items: [
          { id: "PAYA", amountCents: 3500, tipCents: 400, totalCents: 3900, cardBrand: "VISA", cardLast4: "4242", createdAt: "2026-10-13T17:05:00.000Z", matches: "deposit" },
          { id: "PAYB", amountCents: 999, tipCents: 0, totalCents: 999, cardBrand: "MC", cardLast4: "1111", createdAt: "2026-10-13T17:06:00.000Z", matches: null },
        ],
      });
      api.confirmBookingDraftWithCloverPayment = vi.fn().mockResolvedValue({ id: "booking-9" } as BookingSummary);
      return api;
    }

    it("offers Clover first and links the payment staff pick", async () => {
      const api = cloverApi();
      const { onConfirmed } = renderStep({ api, capabilities: cloverCapabilities });

      expect(screen.getByRole("radio", { name: /Clover/ })).toHaveAttribute("aria-checked", "true");
      expect(screen.queryByRole("radiogroup", { name: "Amount" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Link payment & confirm" })).toBeDisabled();

      fireEvent.click(await screen.findByRole("button", { name: /VISA ••4242/ }));
      expect(screen.getByText("$39.00")).toBeInTheDocument(); // total incl. tip
      fireEvent.click(screen.getByRole("button", { name: "Link payment & confirm" }));

      await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith({ id: "booking-9" }));
      expect(api.confirmBookingDraftWithCloverPayment).toHaveBeenCalledWith("brow-beauty-lab", "draft-1", {
        cloverPaymentId: "PAYA",
        amountMode: "deposit",
      });
      // Only an id goes to the server; amounts are read from Clover there.
      expect(api.confirmBookingDraftWithPayment).not.toHaveBeenCalled();
    });

    it("can't pick a payment that doesn't match", async () => {
      renderStep({ api: cloverApi(), capabilities: cloverCapabilities });
      const row = await screen.findByRole("button", { name: /MC ••1111/ });
      expect(row).toBeDisabled();
    });

    it("hides Clover when the business can't match device payments", () => {
      renderStep({ api: cloverApi(), capabilities: { ...cloverCapabilities, canLinkDevicePayments: false } });
      expect(screen.queryByRole("radio", { name: /Clover/ })).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /External POS/ })).toHaveAttribute("aria-checked", "true");
    });

    it("keeps External POS available as a fallback", async () => {
      renderStep({ api: cloverApi(), capabilities: cloverCapabilities });
      fireEvent.click(screen.getByRole("radio", { name: /External POS/ }));
      expect(screen.getByPlaceholderText("e.g. 004512")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /VISA ••4242/ })).not.toBeInTheDocument();
    });

    it("shows the server's reason when linking fails", async () => {
      const api = cloverApi();
      api.confirmBookingDraftWithCloverPayment!.mockRejectedValue(new Error("This payment is already linked to another booking."));
      renderStep({ api, capabilities: cloverCapabilities });
      fireEvent.click(await screen.findByRole("button", { name: /VISA ••4242/ }));
      fireEvent.click(screen.getByRole("button", { name: "Link payment & confirm" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("already linked to another booking");
    });
  });

  describe("services with no deposit", () => {
    it("lets staff confirm without taking payment", async () => {
      const api: TestApi = makeApi();
      api.confirmBookingDraftWithoutPayment = vi.fn().mockResolvedValue({ id: "booking-7" } as BookingSummary);
      const { onConfirmed } = renderStep({ api, draft: makeDraft({ depositCents: 0 }) });

      fireEvent.click(screen.getByRole("button", { name: /Confirm without payment/ }));
      await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith({ id: "booking-7" }));
      expect(api.confirmBookingDraftWithoutPayment).toHaveBeenCalledWith("brow-beauty-lab", "draft-1");
    });

    it("never offers it when there is a deposit", () => {
      const api: TestApi = makeApi();
      api.confirmBookingDraftWithoutPayment = vi.fn();
      renderStep({ api });
      expect(screen.queryByRole("button", { name: /Confirm without payment/ })).not.toBeInTheDocument();
    });

    it("blocks it without permission", () => {
      const api: TestApi = makeApi();
      api.confirmBookingDraftWithoutPayment = vi.fn();
      renderStep({ api, draft: makeDraft({ depositCents: 0 }), canCollectPayment: false });
      expect(screen.getByRole("button", { name: /Confirm without payment/ })).toBeDisabled();
    });
  });
});
