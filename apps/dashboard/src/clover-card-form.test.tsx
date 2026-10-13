import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloverCardForm } from "./clover-card-form";

const config = { merchantId: "M1", publicKey: "pub_1", sdkUrl: "https://checkout.example/sdk.js", locale: "en-CA" };

type Created = { type: string; mount: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
let created: Created[];
let createToken: ReturnType<typeof vi.fn>;
let constructed: Array<{ key: string; options: unknown }>;

beforeEach(() => {
  created = [];
  constructed = [];
  createToken = vi.fn().mockResolvedValue({ token: "clv_token_1" });
  class FakeClover {
    constructor(key: string, options: unknown) {
      constructed.push({ key, options });
    }
    elements() {
      return {
        create: (type: string) => {
          const element = { type, mount: vi.fn(), destroy: vi.fn() };
          created.push(element);
          return element;
        },
      };
    }
    createToken = createToken;
  }
  (window as unknown as { Clover: unknown }).Clover = FakeClover;
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { Clover?: unknown }).Clover;
});

function setup(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(<CloverCardForm config={config} submitLabel="Charge $35.00" onSubmit={onSubmit} />);
  return onSubmit;
}

describe("CloverCardForm", () => {
  it("mounts Clover's four secure fields for this merchant", async () => {
    setup();
    await waitFor(() => expect(created).toHaveLength(4));
    expect(created.map((element) => element.type)).toEqual(["CARD_NUMBER", "CARD_DATE", "CARD_CVV", "CARD_POSTAL_CODE"]);
    expect(constructed).toEqual([{ key: "pub_1", options: { merchantId: "M1", locale: "en-CA" } }]);
    expect(created[0].mount).toHaveBeenCalledWith(expect.stringMatching(/^#clover-.*-number$/));
    expect(await screen.findByRole("button", { name: "Charge $35.00" })).toBeEnabled();
  });

  it("sends only a one-time token plus a fresh attempt id", async () => {
    const onSubmit = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Charge $35.00" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith("clv_token_1", expect.stringMatching(/^[A-Za-z0-9_-]{8,}$/));
  });

  it("shows card errors from Clover and doesn't charge", async () => {
    createToken.mockResolvedValue({ errors: { CARD_NUMBER: "Card number is invalid" } });
    const onSubmit = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Charge $35.00" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Card number is invalid");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows a decline and uses a new token and attempt id next time", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Your card was declined."), { payload: { error: { code: "card_declined" } } }))
      .mockResolvedValue(undefined);
    createToken.mockResolvedValueOnce({ token: "clv_one" }).mockResolvedValueOnce({ token: "clv_two" });
    setup(onSubmit);

    fireEvent.click(await screen.findByRole("button", { name: "Charge $35.00" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your card was declined.");
    fireEvent.click(screen.getByRole("button", { name: "Charge $35.00" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));

    const [first, second] = onSubmit.mock.calls;
    expect(first[0]).toBe("clv_one");
    expect(second[0]).toBe("clv_two");
    expect(second[1]).not.toBe(first[1]);
    expect(createToken).toHaveBeenCalledTimes(2);
  });

  it("retries an unconfirmed payment with the SAME token and attempt id", async () => {
    const unknown = Object.assign(new Error("We couldn't confirm the payment."), {
      payload: { error: { code: "payment_outcome_unknown" } },
    });
    const onSubmit = vi.fn().mockRejectedValueOnce(unknown).mockResolvedValue(undefined);
    setup(onSubmit);

    fireEvent.click(await screen.findByRole("button", { name: "Charge $35.00" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't confirm");
    fireEvent.click(screen.getByRole("button", { name: "Check payment again" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));

    expect(onSubmit.mock.calls[1]).toEqual(onSubmit.mock.calls[0]);
    expect(createToken).toHaveBeenCalledTimes(1); // no second tokenization
    // Once it settles, the next entry starts fresh.
    expect(screen.getByRole("button", { name: "Charge $35.00" })).toBeInTheDocument();
  });

  it("disables the button while processing and when told to", async () => {
    let finish: () => void = () => {};
    const onSubmit = vi.fn().mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    setup(onSubmit);
    const button = await screen.findByRole("button", { name: "Charge $35.00" });
    fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Processing…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Processing…" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Charge $35.00" })).toBeEnabled());
  });

  it("tells the user when the secure form can't load", async () => {
    delete (window as unknown as { Clover?: unknown }).Clover;
    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      queueMicrotask(() => (node as HTMLScriptElement).onerror?.(new Event("error")));
      return node;
    });
    render(<CloverCardForm config={{ ...config, sdkUrl: "https://broken.example/sdk.js" }} submitLabel="Pay" onSubmit={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the secure card form");
    expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();
    vi.restoreAllMocks();
  });

  it("removes the secure fields when it goes away", async () => {
    setup();
    await waitFor(() => expect(created).toHaveLength(4));
    cleanup();
    created.forEach((element) => expect(element.destroy).toHaveBeenCalled());
  });
});
