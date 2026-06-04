import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@booking/shared-types";

import { StaffPage } from "./staff-page";
import { platformApi } from "./platform-api";

const ownerUser: AuthenticatedUser = {
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

const readOnlyUser: AuthenticatedUser = {
  ...ownerUser,
  id: "user-2",
  email: "staff@browbeautylab.test",
  role: "staff",
  permissions: [
    { key: "settings.view", allowed: true },
    { key: "settings.manage", allowed: false },
  ],
};

const definition = {
  title: "Staff",
  eyebrow: "Team & providers",
  description: "Sign-in users and providers in one place.",
};

const baseUsers = [
  {
    id: "u1",
    email: "owner@browbeautylab.test",
    name: "Melissa Chang",
    role: "owner",
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    phone: null,
    avatarUrl: null,
  },
  {
    id: "u2",
    email: "stylist@browbeautylab.test",
    name: "Riley Park",
    role: "provider",
    isActive: true,
    createdAt: "2026-02-15T00:00:00.000Z",
    phone: "+1 555-555-1212",
    avatarUrl: null,
  },
];

const baseProviders = [
  {
    id: "p1",
    tenantId: "tenant-1",
    createdAt: "2026-02-15T00:00:00.000Z",
    updatedAt: "2026-02-15T00:00:00.000Z",
    userId: "u2",
    name: "Riley Park",
    email: "stylist@browbeautylab.test",
    isActive: true,
    isBookableOnline: true,
    serviceIds: ["svc1"],
    locationIds: ["loc1"],
  },
];

const baseLocations = [
  { id: "loc1", tenantId: "tenant-1", createdAt: "", updatedAt: "", name: "Downtown", timeZone: "America/Los_Angeles", isActive: true },
  { id: "loc2", tenantId: "tenant-1", createdAt: "", updatedAt: "", name: "Uptown", timeZone: "America/Los_Angeles", isActive: true },
];

const baseServices = [
  { id: "svc1", tenantId: "tenant-1", createdAt: "", updatedAt: "", name: "Brow Shaping", durationMinutes: 30, priceCents: 5000, depositCents: 0, isActive: true, locationIds: ["loc1"], formIds: [] },
  { id: "svc2", tenantId: "tenant-1", createdAt: "", updatedAt: "", name: "Facial", durationMinutes: 60, priceCents: 12000, depositCents: 2500, isActive: true, locationIds: ["loc1"], formIds: [] },
];

function mockListEndpoints(overrides: Partial<{ users: any[]; providers: any[] }> = {}) {
  vi.spyOn(platformApi, "listTenantUsers").mockResolvedValue({
    users: overrides.users ?? baseUsers,
  } as any);
  vi.spyOn(platformApi, "listProvidersAdmin").mockResolvedValue({
    providers: overrides.providers ?? baseProviders,
  } as any);
  vi.spyOn(platformApi, "listLocationsAdmin").mockResolvedValue({
    locations: baseLocations,
  } as any);
  vi.spyOn(platformApi, "listServices").mockResolvedValue({
    services: baseServices,
  } as any);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StaffPage", () => {
  it("renders the master list and shows the first user's details", async () => {
    mockListEndpoints();
    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Melissa Chang/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Riley Park/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  });

  it("blocks users without settings.manage permission", () => {
    const spy = vi.spyOn(platformApi, "listTenantUsers");
    render(<StaffPage definition={definition} currentUser={readOnlyUser} />);
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("shows the direct booking link only when a provider is linked", async () => {
    mockListEndpoints();
    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    // Melissa (owner) selected by default — no provider link.
    expect(screen.queryByText(/Direct booking link/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    await waitFor(() => expect(screen.getByText(/Direct booking link/i)).toBeInTheDocument());
    expect(screen.getByText(/\?providerId=p1/)).toBeInTheDocument();
  });

  it("enables Services tab only for providers", async () => {
    mockListEndpoints();
    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Melissa Chang/i }));
    expect(screen.getByRole("tab", { name: "Services" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Services" })).not.toBeDisabled(),
    );
  });

  it("creates a staff member without provider via combo endpoint", async () => {
    mockListEndpoints();
    const createSpy = vi
      .spyOn(platformApi, "createTenantStaff")
      .mockResolvedValue({ user: baseUsers[0], provider: null } as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: "Add staff" }));
    fireEvent.click(screen.getByRole("button", { name: "Add staff" }));
    const dialog = within(screen.getByRole("dialog"));

    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Jane Doe" } });
    fireEvent.change(dialog.getByLabelText("Email"), {
      target: { value: "jane@browbeautylab.test" },
    });
    fireEvent.change(dialog.getByLabelText("Role"), { target: { value: "manager" } });
    fireEvent.change(dialog.getByLabelText(/Initial password/), {
      target: { value: "TempPass123" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Create staff" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy).toHaveBeenCalledWith("brow-beauty-lab", {
      email: "jane@browbeautylab.test",
      name: "Jane Doe",
      role: "manager",
      initialPassword: "TempPass123",
      phone: null,
      avatarUrl: null,
    });
  });

  it("creates a staff member with provider sub-payload when toggle on", async () => {
    mockListEndpoints();
    const createSpy = vi
      .spyOn(platformApi, "createTenantStaff")
      .mockResolvedValue({ user: baseUsers[0], provider: baseProviders[0] } as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: "Add staff" }));
    fireEvent.click(screen.getByRole("button", { name: "Add staff" }));
    const dialog = within(screen.getByRole("dialog"));

    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Pro Jane" } });
    fireEvent.change(dialog.getByLabelText("Email"), {
      target: { value: "pro@browbeautylab.test" },
    });
    fireEvent.change(dialog.getByLabelText(/Initial password/), {
      target: { value: "TempPass123" },
    });
    fireEvent.click(dialog.getByLabelText(/This person is a service provider/));
    await waitFor(() => dialog.getByText("Locations"));
    fireEvent.click(dialog.getByLabelText("Downtown"));
    fireEvent.click(dialog.getByLabelText("Brow Shaping"));
    fireEvent.click(dialog.getByRole("button", { name: "Create staff" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    const arg = createSpy.mock.calls[0][1];
    expect(arg.provider).toEqual({
      locationIds: ["loc1"],
      serviceIds: ["svc1"],
      isBookableOnline: true,
    });
  });

  it("saves user detail changes including phone", async () => {
    mockListEndpoints();
    const updateSpy = vi
      .spyOn(platformApi, "updateTenantUser")
      .mockResolvedValue({} as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Melissa Chang/i }));

    fireEvent.change(screen.getByLabelText("Phone"), {
      target: { value: "+1 555-111-2222" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith("brow-beauty-lab", "u1", {
      phone: "+1 555-111-2222",
    });
  });

  it("saves provider Services tab updates", async () => {
    mockListEndpoints();
    const updateSpy = vi
      .spyOn(platformApi, "updateProvider")
      .mockResolvedValue({} as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Services" }));
    await waitFor(() => screen.getByText("Services performed"));

    // Add Facial (svc2) to provider's services
    fireEvent.click(screen.getByLabelText("Facial"));
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith("brow-beauty-lab", "p1", {
      locationIds: ["loc1"],
      serviceIds: ["svc1", "svc2"],
      isBookableOnline: true,
      isActive: true,
    });
  });

  it("resets a password from the detail header", async () => {
    mockListEndpoints();
    const resetSpy = vi
      .spyOn(platformApi, "resetTenantUserPassword")
      .mockResolvedValue({} as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Melissa Chang/i }));
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    const dialog = within(screen.getByRole("dialog"));

    fireEvent.change(dialog.getByLabelText(/New password/), {
      target: { value: "BrandNew456" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Save new password" }));

    await waitFor(() => expect(resetSpy).toHaveBeenCalledTimes(1));
    expect(resetSpy).toHaveBeenCalledWith("brow-beauty-lab", "u1", {
      newPassword: "BrandNew456",
    });
  });

  it("links a provider to an existing non-provider user", async () => {
    mockListEndpoints();
    const createProviderSpy = vi
      .spyOn(platformApi, "createProvider")
      .mockResolvedValue({} as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Melissa Chang/i }));
    fireEvent.click(screen.getByRole("button", { name: "Make service provider" }));
    const dialog = within(screen.getByRole("dialog"));
    await waitFor(() => dialog.getByText("Services performed"));

    fireEvent.click(dialog.getByLabelText("Uptown"));
    fireEvent.click(dialog.getByLabelText("Facial"));
    fireEvent.click(dialog.getByRole("button", { name: "Create provider" }));

    await waitFor(() => expect(createProviderSpy).toHaveBeenCalledTimes(1));
    expect(createProviderSpy).toHaveBeenCalledWith("brow-beauty-lab", {
      name: "Melissa Chang",
      email: "owner@browbeautylab.test",
      userId: "u1",
      locationIds: ["loc2"],
      serviceIds: ["svc2"],
      isBookableOnline: true,
    });
  });

  it("surfaces an error when loading fails", async () => {
    vi.spyOn(platformApi, "listTenantUsers").mockRejectedValue(new Error("boom"));
    vi.spyOn(platformApi, "listProvidersAdmin").mockResolvedValue({ providers: [] } as any);
    vi.spyOn(platformApi, "listLocationsAdmin").mockResolvedValue({ locations: [] } as any);
    vi.spyOn(platformApi, "listServices").mockResolvedValue({ services: [] } as any);
    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/boom/));
  });

  it("loads provider schedule entries on the Work hours tab", async () => {
    mockListEndpoints();
    const getScheduleSpy = vi
      .spyOn(platformApi, "getProviderSchedule")
      .mockResolvedValue({
        providerId: "p1",
        entries: [
          { weekday: 0, locationId: "loc1", startTime: "09:00", endTime: "17:00" },
        ],
      } as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Work hours" }));

    await waitFor(() =>
      expect(getScheduleSpy).toHaveBeenCalledWith("brow-beauty-lab", "p1"),
    );
    await waitFor(() => expect(screen.getByDisplayValue("09:00")).toBeInTheDocument());
    expect(screen.getByDisplayValue("17:00")).toBeInTheDocument();
  });

  it("saves a new schedule entry via replaceProviderSchedule", async () => {
    mockListEndpoints();
    vi.spyOn(platformApi, "getProviderSchedule").mockResolvedValue({
      providerId: "p1",
      entries: [],
    } as any);
    const replaceSpy = vi
      .spyOn(platformApi, "replaceProviderSchedule")
      .mockResolvedValue({
        providerId: "p1",
        entries: [
          { weekday: 0, locationId: "loc1", startTime: "09:00", endTime: "17:00" },
        ],
      } as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Work hours" }));

    await waitFor(() => screen.getAllByRole("button", { name: /Add time window/ }));
    // Monday is the first day row
    const addButtons = screen.getAllByRole("button", { name: /Add time window/ });
    fireEvent.click(addButtons[0]);

    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledTimes(1));
    expect(replaceSpy).toHaveBeenCalledWith("brow-beauty-lab", "p1", {
      entries: [
        { weekday: 0, locationId: "loc1", startTime: "09:00", endTime: "17:00" },
      ],
    });
  });

  it("loads provider time off on the Time off tab", async () => {
    mockListEndpoints();
    const listSpy = vi.spyOn(platformApi, "listProviderTimeOff").mockResolvedValue({
      items: [
        {
          id: "to1",
          providerId: "p1",
          startsAt: "2026-08-01T17:00:00.000Z",
          endsAt: "2026-08-05T17:00:00.000Z",
          reason: "Vacation",
        },
      ],
    } as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Time off" }));

    await waitFor(() =>
      expect(listSpy).toHaveBeenCalledWith("brow-beauty-lab", "p1"),
    );
    await waitFor(() => expect(screen.getByText(/Vacation/)).toBeInTheDocument());
  });

  it("creates a new time off entry from the form", async () => {
    mockListEndpoints();
    vi.spyOn(platformApi, "listProviderTimeOff").mockResolvedValue({ items: [] } as any);
    const createSpy = vi
      .spyOn(platformApi, "createProviderTimeOff")
      .mockResolvedValue({
        id: "new1",
        providerId: "p1",
        startsAt: "2026-08-01T17:00:00.000Z",
        endsAt: "2026-08-02T01:00:00.000Z",
        reason: null,
      } as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Time off" }));
    await waitFor(() => screen.getByLabelText("Starts"));

    fireEvent.change(screen.getByLabelText("Starts"), {
      target: { value: "2026-08-01T10:00" },
    });
    fireEvent.change(screen.getByLabelText("Ends"), {
      target: { value: "2026-08-01T18:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add time off" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    const [slug, providerId, payload] = createSpy.mock.calls[0];
    expect(slug).toBe("brow-beauty-lab");
    expect(providerId).toBe("p1");
    expect(payload.reason).toBeNull();
    expect(typeof payload.startsAt).toBe("string");
    expect(typeof payload.endsAt).toBe("string");
  });
});
