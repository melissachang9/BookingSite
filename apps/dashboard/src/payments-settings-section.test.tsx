import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaymentCapabilities } from "@booking/shared-types";

import { CloverCallbackPage, PaymentsSettingsSection } from "./payments-settings-section";

afterEach(() => cleanup());

const notConnected: PaymentCapabilities = {
  processor: "simulated",
  status: null,
  canLinkDevicePayments: false,
  canChargeCards: false,
  canSendPaymentLink: false,
  canRefundCards: false,
  currencyMismatch: false,
  needsReauth: false,
};
const connected: PaymentCapabilities = {
  processor: "clover",
  environment: "production",
  status: "connected",
  authMode: "oauth",
  merchantName: "Brow Beauty Lab",
  canLinkDevicePayments: true,
  canChargeCards: true,
  canSendPaymentLink: true,
  canRefundCards: true,
  currencyMismatch: false,
  needsReauth: false,
};

function makeApi(initial: PaymentCapabilities) {
  return {
    getPaymentCapabilities: vi.fn().mockResolvedValue(initial),
    getCloverAuthorizeUrl: vi.fn().mockResolvedValue({ authorizeUrl: "https://www.clover.com/oauth/v2/authorize?x=1" }),
    completeCloverOAuth: vi.fn().mockResolvedValue(connected),
    connectCloverWithApiKeys: vi.fn().mockResolvedValue(connected),
    disconnectClover: vi.fn().mockResolvedValue({ ...notConnected, status: "disconnected" }),
  };
}

describe("PaymentsSettingsSection", () => {
  it("starts the Clover connection for an owner", async () => {
    const api = makeApi(notConnected);
    const redirectTo = vi.fn();
    render(<PaymentsSettingsSection tenantSlug="studio" canConfigure api={api} redirectTo={redirectTo} />);

    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect Clover" }));
    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith("https://www.clover.com/oauth/v2/authorize?x=1"));
  });

  it("shows the connected account and what is switched on", async () => {
    render(<PaymentsSettingsSection tenantSlug="studio" canConfigure api={makeApi(connected)} />);
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Brow Beauty Lab")).toBeInTheDocument();
    expect(screen.getByText(/Live · Clover app/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Clover" })).not.toBeInTheDocument();
  });

  it("explains when online card payments are not enabled on the Clover account", async () => {
    render(
      <PaymentsSettingsSection tenantSlug="studio" canConfigure api={makeApi({ ...connected, canChargeCards: false })} />,
    );
    expect(await screen.findByText(/not enabled on this Clover account/)).toBeInTheDocument();
  });

  it("asks to reconnect when Clover stopped accepting the connection", async () => {
    const needsReauth = { ...connected, status: "needs_reauth" as const, needsReauth: true };
    render(<PaymentsSettingsSection tenantSlug="studio" canConfigure api={makeApi(needsReauth)} />);
    expect(await screen.findByText("Needs reconnecting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect Clover" })).toBeEnabled();
  });

  it("warns about a currency mismatch", async () => {
    render(
      <PaymentsSettingsSection tenantSlug="studio" canConfigure api={makeApi({ ...connected, currencyMismatch: true })} />,
    );
    expect(await screen.findByText(/different currency/)).toBeInTheDocument();
  });

  it("blocks everyone but the owner", async () => {
    render(<PaymentsSettingsSection tenantSlug="studio" canConfigure={false} api={makeApi(notConnected)} />);
    expect(await screen.findByText(/Only the business owner/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Clover" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Connect with API keys" })).toBeDisabled();
  });

  it("connects with API keys and clears them from the form", async () => {
    const api = makeApi(notConnected);
    render(<PaymentsSettingsSection tenantSlug="studio" canConfigure api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect with API keys" }));

    const form = screen.getByRole("form", { name: "Connect with Clover API keys" });
    const inputs = Array.from(form.querySelectorAll("input"));
    ["MID123", " tok-1 ", "pub-1", "priv-1"].forEach((value, index) =>
      fireEvent.change(inputs[index], { target: { value } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(api.connectCloverWithApiKeys).toHaveBeenCalled());
    expect(api.connectCloverWithApiKeys).toHaveBeenCalledWith("studio", {
      environment: "production",
      merchantId: "MID123",
      platformApiToken: "tok-1",
      ecommercePublicKey: "pub-1",
      ecommercePrivateKey: "priv-1",
    });
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Connect with Clover API keys" })).not.toBeInTheDocument();
  });

  it("shows the server error when the keys are rejected", async () => {
    const api = makeApi(notConnected);
    api.connectCloverWithApiKeys.mockRejectedValue(new Error("Unauthorized"));
    render(<PaymentsSettingsSection tenantSlug="studio" canConfigure api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect with API keys" }));
    const form = screen.getByRole("form", { name: "Connect with Clover API keys" });
    Array.from(form.querySelectorAll("input")).forEach((input) => fireEvent.change(input, { target: { value: "x" } }));
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized");
  });

  it("confirms before disconnecting", async () => {
    const api = makeApi(connected);
    render(<PaymentsSettingsSection tenantSlug="studio" canConfigure api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(api.disconnectClover).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Clover" }));
    await waitFor(() => expect(api.disconnectClover).toHaveBeenCalledWith("studio"));
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
  });

  it("shows a retry when settings can't load", async () => {
    const api = makeApi(notConnected);
    api.getPaymentCapabilities.mockRejectedValueOnce(new Error("Network down"));
    render(<PaymentsSettingsSection tenantSlug="studio" canConfigure api={api} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network down");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
  });
});

describe("CloverCallbackPage", () => {
  function renderCallback(url: string, api: ReturnType<typeof makeApi>, redirectTo = vi.fn()) {
    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/settings/payments/clover/callback" element={<CloverCallbackPage tenantSlug="studio" api={api} redirectTo={redirectTo} />} />
          <Route path="/settings" element={<div>Settings page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    return redirectTo;
  }

  it("finishes the connection and returns to settings", async () => {
    const api = makeApi(notConnected);
    renderCallback("/settings/payments/clover/callback?code=abc&merchant_id=M1&state=signed", api);
    await waitFor(() =>
      expect(api.completeCloverOAuth).toHaveBeenCalledWith("studio", { code: "abc", merchantId: "M1", state: "signed" }),
    );
    expect(await screen.findByText("Settings page")).toBeInTheDocument();
  });

  it("restarts authorization when launched from the App Market without a state", async () => {
    const api = makeApi(notConnected);
    const redirectTo = renderCallback("/settings/payments/clover/callback?merchant_id=M1", api);
    await waitFor(() => expect(redirectTo).toHaveBeenCalledWith("https://www.clover.com/oauth/v2/authorize?x=1"));
    expect(api.completeCloverOAuth).not.toHaveBeenCalled();
  });

  it("shows why the connection failed", async () => {
    const api = makeApi(notConnected);
    api.completeCloverOAuth.mockRejectedValue(new Error("This Clover account is already connected to another business."));
    renderCallback("/settings/payments/clover/callback?code=abc&merchant_id=M1&state=signed", api);
    expect(await screen.findByRole("alert")).toHaveTextContent("already connected to another business");
    expect(screen.getByRole("button", { name: "Back to settings" })).toBeInTheDocument();
  });
});
