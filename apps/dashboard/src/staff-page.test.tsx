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
  vi.spyOn(platformApi, "getServiceProviderVariants").mockResolvedValue({
    serviceId: "",
    variants: [],
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

    // Add Facial (svc2) to provider's services via checkbox
    const facialLabel = screen.getByText("Facial").closest("label")!;
    fireEvent.click(within(facialLabel).getByRole("checkbox"));
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
    const getWorkHoursSpy = vi
      .spyOn(platformApi, "getProviderWorkHours")
      .mockResolvedValue({
        providerId: "p1",
        locationId: null,
        regularHours: [
          { id: "s1", weekday: 0, locationId: "loc1", startTime: "09:00", endTime: "17:00", isActive: true },
        ],
        dateOverrides: [],
        summary: { hoursPerWeek: 8, workingDays: 1, upcomingOverridesCount: 0 },
      } as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Work hours" }));

    await waitFor(() =>
      expect(getWorkHoursSpy).toHaveBeenCalledWith("brow-beauty-lab", "p1", null),
    );
    // Monday shift renders as "09:00 – 17:00" text in the regular hours template (weekday 0 = Monday).
    await waitFor(() => expect(screen.getByText(/09:00\s+–\s+17:00/)).toBeInTheDocument());
  });

  it("saves a new schedule entry via replaceProviderSchedule", async () => {
    mockListEndpoints();
    vi.spyOn(platformApi, "getProviderWorkHours").mockResolvedValue({
      providerId: "p1",
      locationId: null,
      regularHours: [],
      dateOverrides: [],
      summary: { hoursPerWeek: 0, workingDays: 0, upcomingOverridesCount: 0 },
    } as any);
    const replaceSpy = vi
      .spyOn(platformApi, "replaceProviderSchedule")
      .mockResolvedValue({
        providerId: "p1",
        entries: [
          { id: "s1", weekday: 0, locationId: "loc1", startTime: "09:00", endTime: "17:00", isActive: true },
        ],
      } as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Work hours" }));

    // Empty state appears since no regular hours
    await waitFor(() => screen.getByText("No regular hours set yet"));
    // Open the regular hours drawer
    fireEvent.click(screen.getByRole("button", { name: "Set regular hours" }));
    await waitFor(() => screen.getByRole("dialog", { name: "Set regular hours" }));

    // Check Sunday (weekday 6) and set its time
    const sundayCheckbox = screen.getByLabelText(/Sunday active/);
    fireEvent.click(sundayCheckbox);
    // Save
    fireEvent.click(screen.getByRole("button", { name: "Save regular hours" }));

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledTimes(1));
    const payload = replaceSpy.mock.calls[0][2];
    expect(payload.entries.length).toBeGreaterThan(0);
    // Sunday is weekday 6 in the current WEEKDAY_LABELS (Mon=0..Sun=6)
    expect(payload.entries[0].weekday).toBe(6);
  });

  it("keeps regular hours isolated per location when switching A/B/A", async () => {
    mockListEndpoints({
      providers: [
        {
          ...baseProviders[0],
          locationIds: ["loc1", "loc2"],
        },
      ],
    });
    const getWorkHoursSpy = vi
      .spyOn(platformApi, "getProviderWorkHours")
      .mockImplementation(async (_tenantSlug, _providerId, locationId) => {
        if (locationId === "loc1") {
          return {
            providerId: "p1",
            locationId: "loc1",
            regularHours: [
              { id: "loc1-mon", weekday: 1, locationId: "loc1", startTime: "09:00", endTime: "17:00", isActive: true },
            ],
            dateOverrides: [],
            summary: { hoursPerWeek: 8, workingDays: 1, upcomingOverridesCount: 0 },
          } as any;
        }
        if (locationId === "loc2") {
          return {
            providerId: "p1",
            locationId: "loc2",
            regularHours: [
              { id: "loc2-tue", weekday: 2, locationId: "loc2", startTime: "10:00", endTime: "18:00", isActive: true },
            ],
            dateOverrides: [],
            summary: { hoursPerWeek: 8, workingDays: 1, upcomingOverridesCount: 0 },
          } as any;
        }
        return {
          providerId: "p1",
          locationId: null,
          regularHours: [],
          dateOverrides: [],
          summary: { hoursPerWeek: 0, workingDays: 0, upcomingOverridesCount: 0 },
        } as any;
      });

    vi.spyOn(platformApi, "replaceProviderSchedule")
      .mockResolvedValue({ providerId: "p1", entries: [] } as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Work hours" }));
    await waitFor(() => screen.getByText("Regular hours"));

    const getLocationSelect = () => screen.getByRole("combobox", { name: "Work hours location" });

    // A: Downtown — 09:00–17:00 should render in the regular hours template
    fireEvent.change(getLocationSelect(), { target: { value: "loc1" } });
    await waitFor(() => expect(getWorkHoursSpy).toHaveBeenCalledWith("brow-beauty-lab", "p1", "loc1"));
    await waitFor(() => expect(screen.getByText(/09:00\s+–\s+17:00/)).toBeInTheDocument());

    // B: Uptown — 10:00–18:00 should render, Downtown hours should not
    fireEvent.change(getLocationSelect(), { target: { value: "loc2" } });
    await waitFor(() => expect(getWorkHoursSpy).toHaveBeenCalledWith("brow-beauty-lab", "p1", "loc2"));
    await waitFor(() => expect(screen.getByText(/10:00\s+–\s+18:00/)).toBeInTheDocument());
    expect(screen.queryByText(/09:00\s+–\s+17:00/)).not.toBeInTheDocument();

    // Back to A: Downtown should still render Downtown hours, isolated from Uptown
    fireEvent.change(getLocationSelect(), { target: { value: "loc1" } });
    await waitFor(() => expect(screen.getByText(/09:00\s+–\s+17:00/)).toBeInTheDocument());
    expect(screen.queryByText(/10:00\s+–\s+18:00/)).not.toBeInTheDocument();
  });

  it("loads provider time off on the Work hours tab", async () => {
    mockListEndpoints();
    vi.spyOn(platformApi, "getProviderWorkHours").mockResolvedValue({
      providerId: "p1",
      locationId: null,
      regularHours: [],
      dateOverrides: [
        {
          id: "to1",
          providerId: "p1",
          locationId: null,
          startsAt: "2026-08-01T17:00:00.000Z",
          endsAt: "2026-08-05T17:00:00.000Z",
          reason: "Vacation",
          overrideType: "closed",
          startTime: null,
          endTime: null,
        },
      ],
      summary: { hoursPerWeek: 0, workingDays: 0, upcomingOverridesCount: 1 },
    } as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Work hours" }));

    // Wait for the sub-tab to appear (loading finishes)
    await waitFor(() => screen.getByRole("button", { name: /Overrides/ }));
    fireEvent.click(screen.getByRole("button", { name: /Overrides/ }));
    await waitFor(() => expect(screen.getAllByText(/Vacation/).length).toBeGreaterThan(0));
  });

  it("creates a new time off entry from the form", async () => {
    mockListEndpoints();
    vi.spyOn(platformApi, "getProviderWorkHours").mockResolvedValue({
      providerId: "p1",
      locationId: null,
      regularHours: [],
      dateOverrides: [],
      summary: { hoursPerWeek: 0, workingDays: 0, upcomingOverridesCount: 0 },
    } as any);
    const createSpy = vi
      .spyOn(platformApi, "createProviderTimeOff")
      .mockResolvedValue({
        id: "new1",
        providerId: "p1",
        locationId: null,
        startsAt: "2026-08-01T17:00:00.000Z",
        endsAt: "2026-08-02T01:00:00.000Z",
        reason: null,
        overrideType: "closed",
        startTime: null,
        endTime: null,
      } as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Work hours" }));

    // Wait for the sub-tab to appear, then switch to Overrides
    await waitFor(() => screen.getByRole("button", { name: /Overrides/ }));
    fireEvent.click(screen.getByRole("button", { name: /Overrides/ }));
    await waitFor(() => screen.getByText(/All overrides/));

    // Open the time-off drawer via "+ Block time off" button
    fireEvent.click(screen.getByRole("button", { name: /Block time off/ }));
    await waitFor(() => screen.getByRole("dialog", { name: "Block time off" }));

    fireEvent.change(screen.getByLabelText("Time off start date"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Time off end date"), { target: { value: "2026-08-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Block dates" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    const [slug, providerId, payload] = createSpy.mock.calls[0];
    expect(slug).toBe("brow-beauty-lab");
    expect(providerId).toBe("p1");
    expect(typeof payload.startsAt).toBe("string");
    expect(typeof payload.endsAt).toBe("string");
  });

  it("loads catalog and user permissions on the Permissions tab", async () => {
    mockListEndpoints();
    const catalogSpy = vi.spyOn(platformApi, "getPermissionsCatalog").mockResolvedValue({
      permissions: [
        {
          key: "settings.manage",
          category: "Settings",
          label: "Manage settings",
          description: "Edit business settings.",
        },
      ],
      roleDefaults: { staff: [], provider: [] },
    } as any);
    const permsSpy = vi.spyOn(platformApi, "getUserPermissions").mockResolvedValue({
      userId: "u2",
      role: "provider",
      roleDefaults: [],
      overrides: [],
      effective: [{ key: "settings.manage", allowed: false }],
    } as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Permissions" }));

    await waitFor(() => expect(catalogSpy).toHaveBeenCalled());
    await waitFor(() => expect(permsSpy).toHaveBeenCalledWith("brow-beauty-lab", "u2"));
    await waitFor(() => expect(screen.getByText("Manage settings")).toBeInTheDocument());
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("saves an override when toggled to allow", async () => {
    mockListEndpoints();
    vi.spyOn(platformApi, "getPermissionsCatalog").mockResolvedValue({
      permissions: [
        {
          key: "settings.manage",
          category: "Settings",
          label: "Manage settings",
          description: "Edit business settings.",
        },
      ],
      roleDefaults: { provider: [] },
    } as any);
    vi.spyOn(platformApi, "getUserPermissions").mockResolvedValue({
      userId: "u2",
      role: "provider",
      roleDefaults: [],
      overrides: [],
      effective: [{ key: "settings.manage", allowed: false }],
    } as any);
    const saveSpy = vi.spyOn(platformApi, "replaceUserPermissions").mockResolvedValue({
      userId: "u2",
      role: "provider",
      roleDefaults: [],
      overrides: [{ key: "settings.manage", allowed: true }],
      effective: [{ key: "settings.manage", allowed: true }],
    } as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Permissions" }));
    await waitFor(() => expect(screen.getByText("Manage settings")).toBeInTheDocument());

    const group = screen.getByRole("radiogroup", { name: "Manage settings" });
    fireEvent.click(within(group).getByLabelText("Allow"));
    fireEvent.click(screen.getByRole("button", { name: "Save permissions" }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const [slug, userId, payload] = saveSpy.mock.calls[0];
    expect(slug).toBe("brow-beauty-lab");
    expect(userId).toBe("u2");
    expect(payload).toEqual({ overrides: [{ key: "settings.manage", allowed: true }] });
  });

  it("shows owner notice instead of permissions matrix for owners", async () => {
    mockListEndpoints();
    const catalogSpy = vi.spyOn(platformApi, "getPermissionsCatalog");
    const permsSpy = vi.spyOn(platformApi, "getUserPermissions");

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Melissa Chang/i }));
    fireEvent.click(screen.getByRole("button", { name: /Melissa Chang/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Permissions" }));

    await waitFor(() => expect(screen.getByText(/Owners have full access/i)).toBeInTheDocument());
    expect(catalogSpy).not.toHaveBeenCalled();
    expect(permsSpy).not.toHaveBeenCalled();
  });

  it("filters services by search query in the Services tab", async () => {
    mockListEndpoints();

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Services" }));
    await waitFor(() => screen.getByText("Services performed"));

    expect(screen.getByText(/Brow Shaping/)).toBeInTheDocument();
    expect(screen.getByText(/Facial/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search services"), {
      target: { value: "fac" },
    });

    expect(screen.queryByText(/Brow Shaping/)).not.toBeInTheDocument();
    expect(screen.getByText(/Facial/)).toBeInTheDocument();
  });

  it("bulk Select all adds all visible services to the provider", async () => {
    mockListEndpoints();
    const updateSpy = vi.spyOn(platformApi, "updateProvider").mockResolvedValue({} as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Services" }));
    await waitFor(() => screen.getByText("Services performed"));

    // Find the Select all button in the services card (second one)
    const selectAllButtons = screen.getAllByRole("button", { name: /Select all/ });
    fireEvent.click(selectAllButtons[1]);
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const payload = updateSpy.mock.calls[0][2];
    expect((payload as { serviceIds: string[] }).serviceIds.sort()).toEqual(["svc1", "svc2"]);
  });

  it("bulk Clear shown removes only filtered locations", async () => {
    mockListEndpoints();
    // Provider currently has loc1 only; set both selected so "Clear shown" has effect.
    const providers = [
      {
        ...baseProviders[0],
        locationIds: ["loc1", "loc2"],
      },
    ];
    vi.spyOn(platformApi, "listProvidersAdmin").mockResolvedValue({ providers } as any);
    const updateSpy = vi.spyOn(platformApi, "updateProvider").mockResolvedValue({} as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Services" }));
    await waitFor(() => screen.getByText("Locations"));

    fireEvent.change(screen.getByLabelText("Search locations"), {
      target: { value: "uptown" },
    });

    const locFieldset = screen.getByText(/^Locations/).closest("fieldset")!;
    fireEvent.click(within(locFieldset).getByRole("button", { name: /Clear shown/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy.mock.calls[0][2].locationIds).toEqual(["loc1"]);
  });

  it("disables Save provider until services or locations change", async () => {
    mockListEndpoints();

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("button", { name: /Riley Park/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Services" }));
    await waitFor(() => screen.getByText("Services performed"));

    const save = screen.getByRole("button", { name: "Save provider" });
    expect(save).toBeDisabled();

    // Check Facial service checkbox
    const facialLabel2 = screen.getByText("Facial").closest("label")!;
    fireEvent.click(within(facialLabel2).getByRole("checkbox"));
    expect(save).not.toBeDisabled();
  });
});
