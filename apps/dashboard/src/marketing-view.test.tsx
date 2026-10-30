import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketingReport } from "@booking/shared-types";

import { MarketingView } from "./marketing-view";
import { platformApi } from "./platform-api";

const query = { from: "2030-01-01", to: "2030-01-31" };

const report: MarketingReport = {
  range: { startDate: query.from, endDate: query.to, timezone: "America/Los_Angeles", groupBy: "day", dayCount: 31 },
  channels: [
    { channel: "instagram", label: "Instagram", spendCents: 30000, newClients: 3, cacCents: 10000 },
    { channel: "google", label: "Google", spendCents: 5000, newClients: 0, cacCents: null },
  ],
  totalSpendCents: 35000,
  totalNewClients: 3,
  blendedCacCents: 11667,
};

const entry = {
  id: "sp-1", channel: "instagram", campaign: "spring", periodStart: "2030-01-01", periodEnd: "2030-01-31",
  amountCents: 30000, note: null, sourceSystem: "manual", createdByName: "Melissa", createdAt: "",
};

function mockApi(entries = [entry]) {
  vi.spyOn(platformApi, "getMarketingReport").mockResolvedValue(report);
  vi.spyOn(platformApi, "listMarketingSpend").mockResolvedValue({ items: entries } as any);
}

afterEach(() => vi.restoreAllMocks());

describe("MarketingView", () => {
  it("shows spend, new clients and CAC by channel", async () => {
    mockApi();
    render(<MarketingView tenantSlug="brow-beauty-lab" query={query} canManage />);

    const table = await screen.findByRole("table", { name: "Acquisition cost by channel" });
    const instagram = within(table).getByRole("row", { name: /Instagram/ });
    expect(instagram).toHaveTextContent("$300.00");
    expect(instagram).toHaveTextContent("$100.00");
    // A channel that won nobody has spend but no CAC.
    expect(within(table).getByRole("row", { name: /Google/ })).toHaveTextContent("–");
    expect(screen.getByText("Blended CAC").parentElement).toHaveTextContent("$116.67");
  });

  it("records spend in cents against the chosen channel and period", async () => {
    mockApi();
    const createSpy = vi.spyOn(platformApi, "createMarketingSpend").mockResolvedValue(entry as any);
    render(<MarketingView tenantSlug="brow-beauty-lab" query={query} canManage />);

    fireEvent.click(await screen.findByRole("button", { name: "+ Add spend" }));
    const form = screen.getByRole("group", { name: "New spend" });
    fireEvent.change(within(form).getByPlaceholderText("e.g. instagram"), { target: { value: "tiktok" } });
    fireEvent.change(within(form).getByLabelText("Amount spent ($)"), { target: { value: "125.50" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save spend" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("brow-beauty-lab", {
      channel: "tiktok", campaign: null, periodStart: query.from, periodEnd: query.to, amountCents: 12550, note: null,
    }));
  });

  it("asks for a channel and an amount before saving", async () => {
    mockApi();
    const createSpy = vi.spyOn(platformApi, "createMarketingSpend");
    render(<MarketingView tenantSlug="brow-beauty-lab" query={query} canManage />);

    fireEvent.click(await screen.findByRole("button", { name: "+ Add spend" }));
    const form = screen.getByRole("group", { name: "New spend" });
    fireEvent.click(within(form).getByRole("button", { name: "Save spend" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Choose or type the channel");
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("removes an entry only after confirming", async () => {
    mockApi();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const removeSpy = vi.spyOn(platformApi, "removeMarketingSpend").mockResolvedValue(undefined as any);
    render(<MarketingView tenantSlug="brow-beauty-lab" query={query} canManage />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove instagram spend" }));
    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith("brow-beauty-lab", "sp-1"));
  });

  it("hides add and remove for people who can only view", async () => {
    mockApi();
    render(<MarketingView tenantSlug="brow-beauty-lab" query={query} canManage={false} />);

    await screen.findByRole("table", { name: "Spend entries" });
    expect(screen.queryByRole("button", { name: "+ Add spend" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove instagram spend" })).toBeNull();
  });

  it("shows an error instead of an empty report when loading fails", async () => {
    vi.spyOn(platformApi, "getMarketingReport").mockRejectedValue(new Error("boom"));
    vi.spyOn(platformApi, "listMarketingSpend").mockResolvedValue({ items: [] } as any);
    render(<MarketingView tenantSlug="brow-beauty-lab" query={query} canManage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });
});
