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

function mockApi(blocks: any[] = []) {
  vi.spyOn(platformApi, "listResources").mockResolvedValue({ items: [panel, room] } as any);
  vi.spyOn(platformApi, "listLocations").mockResolvedValue({
    locations: [{ id: "loc-1", tenantId: "tenant-1", name: "Downtown", timeZone: "America/Los_Angeles", isActive: true }],
  } as any);
  vi.spyOn(platformApi, "listResourceBlocks").mockResolvedValue({ items: blocks } as any);
}

describe("ResourcesPage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("groups rooms and equipment and shows where each one is", async () => {
    mockApi();
    render(<ResourcesPage definition={definition} currentUser={manager} />);

    const list = await screen.findByRole("complementary", { name: "Resource list" });
    expect(within(list).getByText("Rooms")).toBeInTheDocument();
    expect(within(list).getByText("Equipment & other")).toBeInTheDocument();
    expect(within(list).getByText("Downtown")).toBeInTheDocument();
    expect(within(list).getByText(/2 units · All locations/)).toBeInTheDocument();
  });

  it("shows which services use a resource, and says so when none do", async () => {
    mockApi();
    render(<ResourcesPage definition={definition} currentUser={manager} />);

    fireEvent.click(await screen.findByRole("button", { name: /LED panel/ }));
    const usedBy = screen.getByRole("region", { name: "Used by" });
    expect(within(usedBy).getByText("Signature Facial")).toBeInTheDocument();
    expect(within(usedBy).getByText(/Uses 1 of 2/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Facial room 1/ }));
    expect(screen.getByRole("region", { name: "Used by" })).toHaveTextContent("doesn't affect availability");
  });

  it("saves a location when creating a resource and can clear it on edit", async () => {
    mockApi();
    const createSpy = vi.spyOn(platformApi, "createResource").mockResolvedValue({ ...room, id: "res-new" } as any);
    const updateSpy = vi.spyOn(platformApi, "updateResource").mockResolvedValue(room);
    render(<ResourcesPage definition={definition} currentUser={manager} />);

    fireEvent.click(await screen.findByRole("button", { name: "New resource" }));
    fireEvent.change(screen.getByPlaceholderText(/Treatment Room A/), { target: { value: "Room B" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "Downtown" })).toBeInTheDocument());
    fireEvent.change(screen.getByRole("combobox", { name: "Location" }), { target: { value: "loc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add resource" }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(
      "brow-beauty-lab",
      expect.objectContaining({ name: "Room B", locationId: "loc-1" }),
    ));

    fireEvent.click(await screen.findByRole("button", { name: /Facial room 1/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Location" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(
      "brow-beauty-lab",
      "res-room",
      expect.objectContaining({ locationId: null }),
    ));
  });

  it("blocks a time and lists the bookings it overlaps", async () => {
    mockApi();
    const created = {
      id: "blk-1", resourceId: "res-room", startsAt: "2030-01-07T17:00:00Z", endsAt: "2030-01-07T19:00:00Z",
      reason: "Deep clean", createdAt: "",
      conflicts: [{ bookingId: "bk-1", startsAt: "2030-01-07T17:30:00Z", endsAt: "2030-01-07T18:15:00Z", customerName: "Ana Lopez", serviceName: "Signature Facial" }],
    };
    const createSpy = vi.spyOn(platformApi, "createResourceBlock").mockResolvedValue(created as any);
    render(<ResourcesPage definition={definition} currentUser={manager} />);

    fireEvent.click(await screen.findByRole("button", { name: /Facial room 1/ }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Add unavailable time" }));
    const form = screen.getByRole("group", { name: "New unavailable time" });
    fireEvent.change(within(form).getByLabelText("From"), { target: { value: "2030-01-07T09:00" } });
    fireEvent.change(within(form).getByLabelText("Until"), { target: { value: "2030-01-07T11:00" } });
    fireEvent.change(within(form).getByPlaceholderText(/Annual servicing/), { target: { value: "Deep clean" } });
    fireEvent.click(within(form).getByRole("button", { name: "Block this time" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(
      "brow-beauty-lab",
      "res-room",
      expect.objectContaining({ reason: "Deep clean" }),
    ));
    const warning = await screen.findByRole("alert");
    expect(warning).toHaveTextContent("1 booked appointment overlaps this time");
    expect(warning).toHaveTextContent("Ana Lopez");
    expect(warning).toHaveTextContent("still booked");
  });

  it("rejects an end time that isn't after the start", async () => {
    mockApi();
    const createSpy = vi.spyOn(platformApi, "createResourceBlock");
    render(<ResourcesPage definition={definition} currentUser={manager} />);

    fireEvent.click(await screen.findByRole("button", { name: /Facial room 1/ }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Add unavailable time" }));
    const form = screen.getByRole("group", { name: "New unavailable time" });
    fireEvent.change(within(form).getByLabelText("From"), { target: { value: "2030-01-07T11:00" } });
    fireEvent.change(within(form).getByLabelText("Until"), { target: { value: "2030-01-07T09:00" } });
    fireEvent.click(within(form).getByRole("button", { name: "Block this time" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent("end time must be after");
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("removes an unavailable time after confirming", async () => {
    mockApi([{ id: "blk-2", resourceId: "res-room", startsAt: "2030-01-07T17:00:00Z", endsAt: "2030-01-07T19:00:00Z", reason: "Repair", createdAt: "", conflicts: [] }]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const removeSpy = vi.spyOn(platformApi, "removeResourceBlock").mockResolvedValue(undefined as any);
    render(<ResourcesPage definition={definition} currentUser={manager} />);

    fireEvent.click(await screen.findByRole("button", { name: /Facial room 1/ }));
    expect(await screen.findByText("Repair")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unavailable time actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));

    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith("brow-beauty-lab", "res-room", "blk-2"));
    await waitFor(() => expect(screen.queryByText("Repair")).toBeNull());
  });

  it("warns before deactivating a resource that services need", async () => {
    mockApi();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const updateSpy = vi.spyOn(platformApi, "updateResource").mockResolvedValue(panel);
    render(<ResourcesPage definition={definition} currentUser={manager} />);

    fireEvent.click(await screen.findByRole("button", { name: /LED panel/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Active" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Signature Facial"));
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("hides add and edit controls for people who can only view", async () => {
    mockApi();
    render(<ResourcesPage definition={definition} currentUser={viewer} />);

    fireEvent.click(await screen.findByRole("button", { name: /LED panel/ }));
    expect(screen.queryByRole("button", { name: "New resource" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add unavailable time" })).toBeNull();
  });
});
