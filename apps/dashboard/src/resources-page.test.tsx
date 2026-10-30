import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@booking/shared-types";

import { ResourcesPage } from "./resources-page";
import { platformApi } from "./platform-api";

const manager: AuthenticatedUser = {
  id: "user-1",
  tenantId: "tenant-1",
  tenantSlug: "brow-beauty-lab",
  email: "owner@browbeautylab.test",
  name: "Melissa Chang",
  role: "owner",
  permissions: [
    { key: "settings.view", allowed: true },
    { key: "settings.manage", allowed: true },
  ],
};

const viewer: AuthenticatedUser = {
  ...manager,
  id: "user-2",
  role: "staff",
  permissions: [{ key: "settings.view", allowed: true }, { key: "settings.manage", allowed: false }],
};

const definition = { title: "Resources", eyebrow: "Settings", description: "Rooms and equipment." };

const base = { tenantId: "tenant-1", createdAt: "", updatedAt: "", isActive: true, notes: null };
const room: any = { ...base, id: "res-room", name: "Facial room 1", kind: "room", quantity: 1, locationId: "loc-1", usedBy: [] };
const panel: any = {
  ...base, id: "res-panel", name: "LED panel", kind: "equipment", quantity: 2, locationId: null,
  usedBy: [{ serviceId: "svc-1", serviceName: "Signature Facial", isActive: true, quantity: 1 }],
};

function mockApi() {
  vi.spyOn(platformApi, "listResources").mockResolvedValue({ items: [panel, room] } as any);
  vi.spyOn(platformApi, "listLocations").mockResolvedValue({
    locations: [{ id: "loc-1", tenantId: "tenant-1", name: "Downtown", timeZone: "America/Los_Angeles", isActive: true }],
  } as any);
}

describe("ResourcesPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("groups rooms and equipment and shows where each one is", async () => {
    mockApi();
    render(<ResourcesPage definition={definition} currentUser={manager} />);

    const list = await screen.findByRole("complementary", { name: "Resource list" });
    expect(within(list).getByText("Rooms")).toBeInTheDocument();
    expect(within(list).getByText("Equipment & other")).toBeInTheDocument();
    expect(within(list).getByText(/Room · Downtown/)).toBeInTheDocument();
    expect(within(list).getByText(/Equipment · 2 units · All locations/)).toBeInTheDocument();
  });

  it("shows which services use a resource, and says so when none do", async () => {
    mockApi();
    render(<ResourcesPage definition={definition} currentUser={manager} />);

    fireEvent.click(await screen.findByRole("button", { name: /LED panel/ }));
    const usedBy = screen.getByRole("region", { name: "Used by" });
    expect(within(usedBy).getByText("Signature Facial")).toBeInTheDocument();
    expect(within(usedBy).getByText(/uses 1 of 2/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Facial room 1/ }));
    expect(screen.getByRole("region", { name: "Used by" })).toHaveTextContent("doesn't affect availability");
  });

  it("saves a location when creating a resource and can clear it on edit", async () => {
    mockApi();
    const createSpy = vi.spyOn(platformApi, "createResource").mockResolvedValue({ ...room, id: "res-new" } as any);
    const updateSpy = vi.spyOn(platformApi, "updateResource").mockResolvedValue(room);
    render(<ResourcesPage definition={definition} currentUser={manager} />);

    fireEvent.click(await screen.findByRole("button", { name: "+ Add resource" }));
    let dialog = screen.getByRole("dialog", { name: "Add resource" });
    fireEvent.change(within(dialog).getByPlaceholderText(/Treatment Room A/), { target: { value: "Room B" } });
    await waitFor(() => expect(within(dialog).getByRole("option", { name: "Downtown" })).toBeInTheDocument());
    fireEvent.change(within(dialog).getByRole("combobox", { name: /Location/ }), { target: { value: "loc-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create resource" }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(
      "brow-beauty-lab",
      expect.objectContaining({ name: "Room B", locationId: "loc-1" }),
    ));

    fireEvent.click(await screen.findByRole("button", { name: /Facial room 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    dialog = screen.getByRole("dialog", { name: "Edit resource" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: /Location/ }), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(
      "brow-beauty-lab",
      "res-room",
      expect.objectContaining({ locationId: null }),
    ));
  });

  it("hides add and edit for people who can only view", async () => {
    mockApi();
    render(<ResourcesPage definition={definition} currentUser={viewer} />);

    fireEvent.click(await screen.findByRole("button", { name: /LED panel/ }));
    expect(screen.queryByRole("button", { name: "+ Add resource" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
