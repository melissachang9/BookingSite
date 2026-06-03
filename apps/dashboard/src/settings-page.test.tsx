import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser, TenantSummary } from "@booking/shared-types";

import { SettingsPage } from "./settings-page";
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

const tenant: TenantSummary = {
  id: "tenant-1",
  slug: "brow-beauty-lab",
  name: "Brow Beauty Lab",
  timezone: "America/Toronto",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  defaultLocationId: "location-1",
  branding: {
    homepageUrl: "https://browbeautylab.com",
    primaryColor: "#101010",
    accentColor: "#cf3367",
    logoUrl: null,
    heroImageUrl: null,
    socialLinks: [],
  },
  settings: {
    cancellationWindowHours: 24,
    refundInsideWindow: false,
    minimumLeadTimeMinutes: 30,
    maximumAdvanceDays: 90,
    reminderHoursBefore: 24,
    defaultDepositCents: 2500,
    noShowFeeCents: 5000,
    automaticallyChargeNoShowFee: false,
    paymentLinkExpiryMinutes: 30,
    taxRatePercent: 0,
    calendarDisplayStartHour: 9,
    calendarDisplayEndHour: 19,
    country: "US",
    currency: "USD",
    smsPhone: null,
    businessHoursEnabled: false,
    restrictProvidersToBusinessHours: false,
    businessHours: {
      mon: { open: "09:00", close: "17:00", closed: false },
      tue: { open: "09:00", close: "17:00", closed: false },
      wed: { open: "09:00", close: "17:00", closed: false },
      thu: { open: "09:00", close: "17:00", closed: false },
      fri: { open: "09:00", close: "17:00", closed: false },
      sat: { open: "09:00", close: "17:00", closed: true },
      sun: { open: "09:00", close: "17:00", closed: true },
    },
    clientOwnershipEnabled: false,
    onlineBookingOwnerAssignmentEnabled: false,
  },
};

const definition = {
  title: "Settings",
  eyebrow: "Operations",
  description: "Tenant settings",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SettingsPage", () => {
  it("renders the sectioned anchor nav with Business Setup and Calendar groups", () => {
    render(
      <SettingsPage
        definition={definition}
        currentUser={ownerUser}
        tenant={tenant}
        onTenantUpdated={() => {}}
      />,
    );

    expect(screen.getByRole("navigation", { name: /settings sections/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Business Details" })).toHaveAttribute("href", "#business-details");
    expect(screen.getByRole("link", { name: "Business Hours" })).toHaveAttribute("href", "#business-hours");
    expect(screen.getByRole("link", { name: "Calendar Display" })).toHaveAttribute("href", "#calendar");
    expect(screen.getByRole("link", { name: "Wallet & Membership" })).toHaveAttribute("href", "#wallet-membership");
  });

  it("renders placeholders for planned sections and the live Calendar form", () => {
    render(
      <SettingsPage
        definition={definition}
        currentUser={ownerUser}
        tenant={tenant}
        onTenantUpdated={() => {}}
      />,
    );

    expect(screen.getByText(/ships in Phase 9/i)).toBeInTheDocument();
    expect(screen.getByText(/ships in Phase 10/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save calendar hours/i })).toBeEnabled();
  });

  it("saves calendar display hours via platformApi.updateTenantSettings", async () => {
    const updated = { ...tenant, settings: { ...tenant.settings, calendarDisplayStartHour: 8, calendarDisplayEndHour: 20 } };
    const spy = vi.spyOn(platformApi, "updateTenantSettings").mockResolvedValue(updated);
    const onTenantUpdated = vi.fn();

    render(
      <SettingsPage
        definition={definition}
        currentUser={ownerUser}
        tenant={tenant}
        onTenantUpdated={onTenantUpdated}
      />,
    );

    fireEvent.change(screen.getByLabelText(/start hour/i), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText(/end hour/i), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /save calendar hours/i }));

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("brow-beauty-lab", {
        calendarDisplayStartHour: 8,
        calendarDisplayEndHour: 20,
      });
    });
    expect(onTenantUpdated).toHaveBeenCalledWith(updated);
    expect(await screen.findByText(/calendar display hours saved/i)).toBeInTheDocument();
  });

  it("disables the calendar save button and shows a permission note for read-only staff", () => {
    render(
      <SettingsPage
        definition={definition}
        currentUser={readOnlyUser}
        tenant={tenant}
        onTenantUpdated={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /save calendar hours/i })).toBeDisabled();
    expect(screen.getAllByText(/do not have permission/i).length).toBeGreaterThan(0);
  });

  it("submits business details via platformApi.updateTenantBusiness", async () => {
    const updated = {
      ...tenant,
      name: "Brow Beauty Studio",
      branding: { ...tenant.branding, homepageUrl: "https://browbeautystudio.com" },
      settings: { ...tenant.settings, country: "CA", currency: "CAD", smsPhone: "+1 416 555 0199" },
    };
    const spy = vi.spyOn(platformApi, "updateTenantBusiness").mockResolvedValue(updated);
    const onTenantUpdated = vi.fn();

    render(
      <SettingsPage
        definition={definition}
        currentUser={ownerUser}
        tenant={tenant}
        onTenantUpdated={onTenantUpdated}
      />,
    );

    fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: "Brow Beauty Studio" } });
    fireEvent.change(screen.getByLabelText(/website/i), { target: { value: "https://browbeautystudio.com" } });
    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: "CA" } });
    fireEvent.change(screen.getByLabelText(/currency/i), { target: { value: "CAD" } });
    fireEvent.change(screen.getByLabelText(/primary phone/i), { target: { value: "+1 416 555 0199" } });
    fireEvent.click(screen.getByRole("button", { name: /save business details/i }));

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("brow-beauty-lab", {
        name: "Brow Beauty Studio",
        homepageUrl: "https://browbeautystudio.com",
        country: "CA",
        currency: "CAD",
        smsPhone: "+1 416 555 0199",
      });
    });
    expect(onTenantUpdated).toHaveBeenCalledWith(updated);
    expect(await screen.findByText(/business details saved/i)).toBeInTheDocument();
  });

  it("hides the weekday editor and disables the restrict toggle when Set business hours is off", () => {
    render(
      <SettingsPage
        definition={definition}
        currentUser={ownerUser}
        tenant={tenant}
        onTenantUpdated={() => {}}
      />,
    );

    expect(screen.queryByLabelText(/monday open/i)).not.toBeInTheDocument();
    expect(screen.getByText(/availability follows each provider/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/only allow providers to offer services/i)).toBeDisabled();
  });

  it("reveals the weekday editor when Set business hours is enabled and saves the toggle + week", async () => {
    const updated = {
      ...tenant,
      settings: {
        ...tenant.settings,
        businessHoursEnabled: true,
        restrictProvidersToBusinessHours: true,
      },
    };
    const spy = vi.spyOn(platformApi, "updateTenantBusinessHours").mockResolvedValue(updated);

    render(
      <SettingsPage
        definition={definition}
        currentUser={ownerUser}
        tenant={tenant}
        onTenantUpdated={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText(/^set business hours$/i));
    expect(screen.getByLabelText(/monday open/i)).toBeEnabled();
    fireEvent.click(screen.getByLabelText(/only allow providers to offer services/i));
    fireEvent.click(screen.getByRole("button", { name: /save business hours/i }));

    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(1);
    });
    const [, body] = spy.mock.calls[0];
    expect(body.businessHoursEnabled).toBe(true);
    expect(body.restrictProvidersToBusinessHours).toBe(true);
    expect(body.businessHours?.mon).toEqual({ open: "09:00", close: "17:00", closed: false });
  });

  it("renders Locations section and creates a new location", async () => {
    const baseLocation = {
      id: "location-1",
      tenantId: "tenant-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      name: "Downtown Studio",
      timeZone: "America/Los_Angeles",
      isActive: true,
      phone: "+1 503 555 0100",
    };
    vi.spyOn(platformApi, "listLocationsAdmin").mockResolvedValue({ locations: [baseLocation] } as any);
    const created = { ...baseLocation, id: "location-2", name: "Annex Studio", phone: null };
    const createSpy = vi
      .spyOn(platformApi, "createLocation")
      .mockResolvedValue(created as any);
    vi.spyOn(platformApi, "listLocationsAdmin")
      .mockResolvedValueOnce({ locations: [baseLocation] } as any)
      .mockResolvedValue({ locations: [baseLocation, created] } as any);

    render(
      <SettingsPage
        definition={definition}
        currentUser={ownerUser}
        tenant={tenant}
        onTenantUpdated={() => {}}
      />,
    );

    expect(await screen.findByText("Downtown Studio")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add location/i }));
    fireEvent.change(screen.getByLabelText(/location name/i), { target: { value: "Annex Studio" } });
    fireEvent.change(screen.getByLabelText(/time zone/i), { target: { value: "America/Los_Angeles" } });
    fireEvent.click(screen.getByRole("button", { name: /create location/i }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith("brow-beauty-lab", expect.objectContaining({
        name: "Annex Studio",
        timeZone: "America/Los_Angeles",
      }));
    });
  });

  it("disables deactivate button for the default location", async () => {
    const defaultLocation = {
      id: "location-1",
      tenantId: "tenant-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      name: "Downtown Studio",
      timeZone: "America/Los_Angeles",
      isActive: true,
      phone: null,
    };
    vi.spyOn(platformApi, "listLocationsAdmin").mockResolvedValue({ locations: [defaultLocation] } as any);

    render(
      <SettingsPage
        definition={definition}
        currentUser={ownerUser}
        tenant={tenant}
        onTenantUpdated={() => {}}
      />,
    );

    expect(await screen.findByText("Downtown Studio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deactivate/i })).toBeDisabled();
  });

  it("saves branding via platformApi.updateTenantBranding", async () => {
    const updated = { ...tenant, branding: { ...tenant.branding, primaryColor: "#112233" } };
    const spy = vi.spyOn(platformApi, "updateTenantBranding").mockResolvedValue(updated as any);
    const onTenantUpdated = vi.fn();

    render(
      <SettingsPage
        definition={definition}
        currentUser={ownerUser}
        tenant={tenant}
        onTenantUpdated={onTenantUpdated}
      />,
    );

    const logoInput = screen.getByLabelText(/logo url/i);
    fireEvent.change(logoInput, { target: { value: "https://cdn.example.com/logo.png" } });
    const primaryHex = screen.getByLabelText(/primary color hex/i);
    fireEvent.change(primaryHex, { target: { value: "#112233" } });
    const photosTextarea = screen.getByLabelText(/gallery photo urls/i);
    fireEvent.change(photosTextarea, {
      target: { value: "https://cdn.example.com/a.jpg\nhttps://cdn.example.com/b.jpg\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("brow-beauty-lab", expect.objectContaining({
        logoUrl: "https://cdn.example.com/logo.png",
        primaryColor: "#112233",
        photos: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
      }));
    });
    expect(onTenantUpdated).toHaveBeenCalled();
  });

  it("disables the branding save button on invalid hex color", () => {
    render(
      <SettingsPage
        definition={definition}
        currentUser={ownerUser}
        tenant={tenant}
        onTenantUpdated={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText(/primary color hex/i), { target: { value: "not-a-color" } });
    expect(screen.getByText(/must be a #RGB or #RRGGBB hex/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save branding/i })).toBeDisabled();
  });

  it("renders the Payroll placeholder with a disabled connect button", () => {
    render(
      <SettingsPage
        definition={definition}
        currentUser={ownerUser}
        tenant={tenant}
        onTenantUpdated={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /connect bank account/i })).toBeDisabled();
    expect(screen.getByText(/onboarding ships in a later release/i)).toBeInTheDocument();
  });

  it("saves client ownership toggles via platformApi.updateTenantClientOwnership", async () => {
    const updated = {
      ...tenant,
      settings: {
        ...tenant.settings,
        clientOwnershipEnabled: true,
        onlineBookingOwnerAssignmentEnabled: true,
      },
    };
    const spy = vi.spyOn(platformApi, "updateTenantClientOwnership").mockResolvedValue(updated as any);
    const onTenantUpdated = vi.fn();

    render(
      <SettingsPage
        definition={definition}
        currentUser={ownerUser}
        tenant={tenant}
        onTenantUpdated={onTenantUpdated}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /enable client ownership/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /assign owner on online bookings/i }));
    fireEvent.click(screen.getByRole("button", { name: /save client ownership/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith("brow-beauty-lab", {
      clientOwnershipEnabled: true,
      onlineBookingOwnerAssignmentEnabled: true,
    });
    expect(onTenantUpdated).toHaveBeenCalledWith(updated);
  });
});
