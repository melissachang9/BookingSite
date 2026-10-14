import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookingDraftSummary, BookingSummary, PaymentCapabilities } from "@booking/shared-types";

import { CollectDepositStep, type CollectDepositApi } from "./collect-deposit-step";

// Clover's secure card form is exercised in its own tests; here it's a stand-in
// that "tokenizes" instantly and reports back through onSubmit like the real one.
vi.mock("./clover-card-form", () => ({
  CloverCardForm: ({
    submitLabel,
    disabled,
    onSubmit,
  }: {
    submitLabel: string;
    disabled?: boolean;
    onSubmit: (token: string, attemptId: string) => Promise<void>;
  }) => (
    <button type="button" disabled={disabled} onClick={() => void onSubmit("clv_tok", "attempt-12345678").catch(() => undefined)}>
      {submitLabel}
    </button>
  ),
}));

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
  | "listCloverDevicePayments"
  | "confirmBookingDraftWithCloverPayment"
  | "confirmBookingDraftWithoutPayment"
  | "getPublicPaymentConfig"
  | "chargeStaffDraftCard"
  | "sendPaymentLink"
  | "getBookingDraft"
  | "getBooking"
> & {
  confirmBookingDraftWithPayment: ReturnType<typeof vi.fn>;
  releaseBookingDraft: ReturnType<typeof vi.fn>;
  listCloverDevicePayments?: ReturnType<typeof vi.fn>;
  confirmBookingDraftWithCloverPayment?: ReturnType<typeof vi.fn>;
  confirmBookingDraftWithoutPayment?: ReturnType<typeof vi.fn>;
  getPublicPaymentConfig?: ReturnType<typeof vi.fn>;
  chargeStaffDraftCard?: ReturnType<typeof vi.fn>;
  sendPaymentLink?: ReturnType<typeof vi.fn>;
  getBookingDraft?: ReturnType<typeof vi.fn>;
  getBooking?: ReturnType<typeof vi.fn>;
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
  canSendPaymentLink: true,
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

  describe("Card (phone)", () => {
    const cardCapabilities: PaymentCapabilities = { ...cloverCapabilities, canLinkDevicePayments: false };

    function cardApi() {
      const api: TestApi = makeApi();
      api.getPublicPaymentConfig = vi.fn().mockResolvedValue({
        processor: "clover",
        currency: "CAD",
        clover: { merchantId: "M1", publicKey: "pub", sdkUrl: "https://sdk", locale: "en-CA", environment: "sandbox" },
      });
      api.chargeStaffDraftCard = vi.fn().mockResolvedValue({ id: "booking-5" } as BookingSummary);
      return api;
    }

    it("charges the deposit through the secure form", async () => {
      const api = cardApi();
      const { onConfirmed } = renderStep({ api, capabilities: cardCapabilities });
      fireEvent.click(screen.getByRole("radio", { name: /Card \(phone\)/ }));

      fireEvent.click(await screen.findByRole("button", { name: "Charge $35.00" }));
      await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith({ id: "booking-5" }));
      expect(api.chargeStaffDraftCard).toHaveBeenCalledWith("brow-beauty-lab", "draft-1", {
        sourceToken: "clv_tok",
        attemptId: "attempt-12345678",
        amountMode: "deposit",
      });
      // Phone card entry has its own submit, so the typed-payment button is gone.
      expect(screen.queryByRole("button", { name: "Record payment & confirm" })).not.toBeInTheDocument();
    });

    it("adds a tip when charging the full amount", async () => {
      const api = cardApi();
      renderStep({ api, capabilities: cardCapabilities });
      fireEvent.click(screen.getByRole("radio", { name: /Card \(phone\)/ }));
      fireEvent.click(screen.getByRole("radio", { name: /Full amount/ }));
      fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "10" } });

      fireEvent.click(await screen.findByRole("button", { name: "Charge $145.60" }));
      await waitFor(() => expect(api.chargeStaffDraftCard).toHaveBeenCalled());
      expect(api.chargeStaffDraftCard).toHaveBeenCalledWith(
        "brow-beauty-lab",
        "draft-1",
        expect.objectContaining({ amountMode: "full", tipCents: 1000 }),
      );
    });

    it("shows the server's reason when the card is declined and stays on the step", async () => {
      const api = cardApi();
      api.chargeStaffDraftCard!.mockRejectedValue(new Error("Your card was declined."));
      const { onConfirmed } = renderStep({ api, capabilities: cardCapabilities });
      fireEvent.click(screen.getByRole("radio", { name: /Card \(phone\)/ }));
      fireEvent.click(await screen.findByRole("button", { name: "Charge $35.00" }));
      await waitFor(() => expect(api.chargeStaffDraftCard).toHaveBeenCalled());
      expect(onConfirmed).not.toHaveBeenCalled();
    });

    it("isn't offered unless the business can charge cards", () => {
      renderStep({ api: cardApi(), capabilities: { ...cardCapabilities, canChargeCards: false } });
      expect(screen.queryByRole("radio", { name: /Card \(phone\)/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: /Payment link/ })).not.toBeInTheDocument();
    });

    it("explains when the card form isn't set up", async () => {
      const api = cardApi();
      api.getPublicPaymentConfig!.mockResolvedValue({ processor: "none", currency: "CAD", clover: null });
      renderStep({ api, capabilities: cardCapabilities });
      fireEvent.click(screen.getByRole("radio", { name: /Card \(phone\)/ }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Connect Clover");
    });

    it("blocks charging without the collect-payment permission", async () => {
      renderStep({ api: cardApi(), capabilities: cardCapabilities, canCollectPayment: false });
      fireEvent.click(screen.getByRole("radio", { name: /Card \(phone\)/ }));
      expect(await screen.findByRole("button", { name: "Charge $35.00" })).toBeDisabled();
    });
  });

  describe("Payment link", () => {
    function linkApi(overrides: Partial<TestApi> = {}) {
      const api: TestApi = makeApi();
      api.sendPaymentLink = vi.fn().mockResolvedValue({
        bookingDraft: makeDraft(),
        paymentUrl: "https://shop.test/brow-beauty-lab/book/draft-1/payment?sessionId=s1",
        holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        deliveries: [{ channel: "email", status: "sent", recipient: "walk.in@example.com" }],
      });
      api.getBookingDraft = vi.fn().mockResolvedValue(makeDraft());
      api.getBooking = vi.fn().mockResolvedValue({ id: "booking-8" } as BookingSummary);
      return Object.assign(api, overrides);
    }
    const customer = (extra: Record<string, unknown> = {}) =>
      ({ id: "c1", name: "Walk In", email: "walk.in@example.com", phone: "555-0199", ...extra }) as BookingDraftSummary["customer"];
    const linkCapabilities: PaymentCapabilities = { ...cloverCapabilities, canLinkDevicePayments: false };

    it("emails the link, holds the slot and waits", async () => {
      const api = linkApi();
      renderStep({ api, capabilities: linkCapabilities, draft: makeDraft({ customer: customer() }) });
      fireEvent.click(screen.getByRole("radio", { name: /Payment link/ }));
      expect(screen.queryByRole("radiogroup", { name: "Amount" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Send payment link" }));
      expect(await screen.findByText("Waiting for the client to pay…")).toBeInTheDocument();
      expect(api.sendPaymentLink).toHaveBeenCalledWith("brow-beauty-lab", "draft-1", { channels: ["email"] });
      expect(screen.getByText(/Email to walk.in@example.com: sent/)).toBeInTheDocument();
    });

    it("needs the client's OK before texting, and records that staff confirmed it", async () => {
      const api = linkApi();
      renderStep({ api, capabilities: linkCapabilities, draft: makeDraft({ customer: customer() }) });
      fireEvent.click(screen.getByRole("radio", { name: /Payment link/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /Text/ }));
      expect(screen.getByRole("button", { name: "Send payment link" })).toBeDisabled();

      fireEvent.click(screen.getByRole("checkbox", { name: /The client asked for a text/ }));
      fireEvent.click(screen.getByRole("button", { name: "Send payment link" }));
      await waitFor(() => expect(api.sendPaymentLink).toHaveBeenCalled());
      expect(api.sendPaymentLink).toHaveBeenCalledWith("brow-beauty-lab", "draft-1", {
        channels: ["email", "sms"],
        smsConsentConfirmed: true,
      });
    });

    it("doesn't ask again when the client already agreed to texts", () => {
      renderStep({ api: linkApi(), capabilities: linkCapabilities, draft: makeDraft({ customer: customer({ smsConsent: true }) }) });
      fireEvent.click(screen.getByRole("radio", { name: /Payment link/ }));
      fireEvent.click(screen.getByRole("checkbox", { name: /Text/ }));
      expect(screen.queryByRole("checkbox", { name: /The client asked for a text/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send payment link" })).toBeEnabled();
    });

    it("can't email a client with no email on file", () => {
      renderStep({ api: linkApi(), capabilities: linkCapabilities, draft: makeDraft({ customer: customer({ email: null }) }) });
      fireEvent.click(screen.getByRole("radio", { name: /Payment link/ }));
      expect(screen.getByRole("checkbox", { name: /no email on file/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Hold slot & get link" })).toBeEnabled(); // copy the link instead
    });

    it("confirms the booking when the client pays", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const api = linkApi();
        const { onConfirmed } = renderStep({ api, capabilities: linkCapabilities, draft: makeDraft({ customer: customer() }) });
        fireEvent.click(screen.getByRole("radio", { name: /Payment link/ }));
        fireEvent.click(screen.getByRole("button", { name: "Send payment link" }));
        await screen.findByText("Waiting for the client to pay…");

        api.getBookingDraft!.mockResolvedValue(makeDraft({ status: "confirmed", confirmedBookingId: "booking-8" }));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5200);
        });
        await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith({ id: "booking-8" }));
        expect(api.getBooking).toHaveBeenCalledWith("brow-beauty-lab", "booking-8");
      } finally {
        vi.useRealTimers();
      }
    });

    it("tells staff when the hold lapses before payment", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const api = linkApi();
        renderStep({ api, capabilities: linkCapabilities, draft: makeDraft({ customer: customer() }) });
        fireEvent.click(screen.getByRole("radio", { name: /Payment link/ }));
        fireEvent.click(screen.getByRole("button", { name: "Send payment link" }));
        await screen.findByText("Waiting for the client to pay…");
        api.getBookingDraft!.mockResolvedValue(makeDraft({ status: "expired" }));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5200);
        });
        expect(await screen.findByText("The hold expired before payment")).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("shows a failed delivery and still lets staff copy the link", async () => {
      const api = linkApi();
      api.sendPaymentLink!.mockResolvedValue({
        bookingDraft: makeDraft(),
        paymentUrl: "https://shop.test/pay",
        holdExpiresAt: new Date(Date.now() + 1800000).toISOString(),
        deliveries: [{ channel: "email", status: "failed", recipient: "walk.in@example.com", error: "Email provider is down." }],
      });
      renderStep({ api, capabilities: linkCapabilities, draft: makeDraft({ customer: customer() }) });
      fireEvent.click(screen.getByRole("radio", { name: /Payment link/ }));
      fireEvent.click(screen.getByRole("button", { name: "Send payment link" }));
      expect(await screen.findByText(/failed — Email provider is down\./)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    });

    it("shows the server's reason when sending fails", async () => {
      const api = linkApi();
      api.sendPaymentLink!.mockRejectedValue(new Error("This service has no deposit."));
      renderStep({ api, capabilities: linkCapabilities, draft: makeDraft({ customer: customer() }) });
      fireEvent.click(screen.getByRole("radio", { name: /Payment link/ }));
      fireEvent.click(screen.getByRole("button", { name: "Send payment link" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("This service has no deposit.");
    });

    it("isn't offered for a service with no deposit", () => {
      renderStep({ api: linkApi(), capabilities: linkCapabilities, draft: makeDraft({ depositCents: 0, customer: customer() }) });
      expect(screen.queryByRole("radio", { name: /Payment link/ })).not.toBeInTheDocument();
    });
  });
});
