import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@booking/shared-types";

import { LocationsPage } from "./locations-page";
import { platformApi } from "./platform-api";

const owner: AuthenticatedUser = {
  id: "user-1",
  tenantId: "tenant-1",
  tenantSlug: "brow-beauty-lab",
  email: "owner@browbeautylab.test",
  name: "Owner",
  role: "owner",
  permissions: [
    { key: "settings.view", allowed: true },
    { key: "settings.manage", allowed: true },
  ],
};

const definition = { title: "Locations", eyebrow: "Settings", description: "Where you work." };

const downtown: any = {
  id: "loc-1",
  tenantId: "tenant-1",
  name: "Downtown",
  timeZone: "America/Los_Angeles",
  isActive: true,
  serviceTaxRatePercent: 5,
  productTaxRatePercent: 12,
  createdAt: "",
  updatedAt: "",
};

afterEach(() => vi.restoreAllMocks());

async function openDowntown() {
  vi.spyOn(platformApi, "listLocationsAdmin").mockResolvedValue({ locations: [downtown] } as any);
  render(<LocationsPage definition={definition} currentUser={owner} />);
  fireEvent.click(await screen.findByRole("button", { name: /Downtown/ }));
}

describe("LocationsPage tax rates", () => {
  it("shows a location's service and product tax rates", async () => {
    await openDowntown();
    expect(await screen.findByText("Services 5% · Products 12%")).toBeInTheDocument();
  });

  it("saves new service and product tax rates", async () => {
    await openDowntown();
    const updateSpy = vi.spyOn(platformApi, "updateLocation").mockResolvedValue({} as any);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Service tax rate/), { target: { value: "8.5" } });
    fireEvent.change(within(dialog).getByLabelText(/^Product tax rate/), { target: { value: "14" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy.mock.calls[0][2]).toMatchObject({ serviceTaxRatePercent: 8.5, productTaxRatePercent: 14 });
  });

  it("rejects a tax rate outside 0 to 100", async () => {
    await openDowntown();
    const updateSpy = vi.spyOn(platformApi, "updateLocation").mockResolvedValue({} as any);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Product tax rate/), { target: { value: "150" } });
    // The browser's own max=100 check would stop a click; submit directly to test the page's own check.
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement);

    expect(await within(dialog).findByText("Tax rates must be between 0 and 100.")).toBeInTheDocument();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("starts a new location at 0% for both rates", async () => {
    vi.spyOn(platformApi, "listLocationsAdmin").mockResolvedValue({ locations: [downtown] } as any);
    render(<LocationsPage definition={definition} currentUser={owner} />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Add location" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/^Service tax rate/)).toHaveValue(0);
    expect(within(dialog).getByLabelText(/^Product tax rate/)).toHaveValue(0);
  });
});
