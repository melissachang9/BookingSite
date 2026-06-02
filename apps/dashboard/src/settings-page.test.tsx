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

    expect(screen.getByText(/ships in Phase 3/i)).toBeInTheDocument();
    expect(screen.getByText(/ships in Phase 4/i)).toBeInTheDocument();
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
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });
});
