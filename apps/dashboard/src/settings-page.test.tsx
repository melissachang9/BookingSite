import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser, TenantSummary } from "@booking/shared-types";

import { SettingsPage } from "./settings-page";
import { platformApi } from "./platform-api";
import { uploadImageFile } from "./upload-image";

vi.mock("./upload-image", () => ({ uploadImageFile: vi.fn() }));

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
  tenantId: "tenant-1",
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
  },
  settings: {
    cancellationWindowHours: 24,
    refundInsideWindow: false,
    minLeadTimeMinutes: 30,
    maxAdvanceBookingDays: 90,
    reminderHoursBefore: 24,
    noShowFeeCents: 5000,
    autoChargeNoShowFee: false,
    calendarDisplayStartHour: 9,
    calendarDisplayEndHour: 19,
    weekStartsOn: 0,
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
    customEmail: {
      fromAddress: null,
      domain: null,
      verified: false,
    },
    walletEnabled: false,
    walletExpirationMonths: null,
    membershipEnabled: false,
    customPaymentMethods: [],
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
  it("renders the sectioned anchor nav with Business Setup, Marketing, and Calendar groups", () => {
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
    expect(screen.getByRole("link", { name: "Marketing" })).toHaveAttribute("href", "#branding");
    expect(screen.getByRole("link", { name: "Calendar Display" })).toHaveAttribute("href", "#calendar");
    expect(screen.getByRole("link", { name: "Wallet & Membership" })).toHaveAttribute("href", "#wallet-membership");
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("href", "#reports");
  });

  it("explains missing report access without fetching report data", () => {
    const sales = vi.spyOn(platformApi, "getSalesReport");
    render(
      <SettingsPage definition={definition} currentUser={ownerUser} tenant={tenant} onTenantUpdated={() => {}} />,
    );

    expect(screen.getByText("You do not have permission to view reports.")).toBeInTheDocument();
    expect(sales).not.toHaveBeenCalled();
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
        weekStartsOn: 0,
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
    expect(screen.getByLabelText(/monday open hour/i)).toBeEnabled();
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

    vi.mocked(uploadImageFile)
      .mockResolvedValueOnce({ url: "https://cdn.example.com/logo.png", fileName: "logo.png" })
      .mockResolvedValueOnce({ url: "https://cdn.example.com/a.jpg", fileName: "a.jpg" })
      .mockResolvedValueOnce({ url: "https://cdn.example.com/b.jpg", fileName: "b.jpg" });
    const picture = (name: string) => new File(["x"], name, { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Logo file"), { target: { files: [picture("logo.png")] } });
    expect(await screen.findByAltText("Logo preview")).toHaveAttribute("src", "https://cdn.example.com/logo.png");
    const primaryHex = screen.getByLabelText(/primary color hex/i);
    fireEvent.change(primaryHex, { target: { value: "#112233" } });
    fireEvent.change(screen.getByLabelText("Add gallery photo"), { target: { files: [picture("a.jpg")] } });
    expect(await screen.findByAltText("Gallery photo 1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Add gallery photo"), { target: { files: [picture("b.jpg")] } });
    expect(await screen.findByAltText("Gallery photo 2")).toBeInTheDocument();
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

  it("edits the storefront panel's labels and text from the Marketing section", async () => {
    const spy = vi.spyOn(platformApi, "updateTenantBranding").mockResolvedValue(tenant as any);
    render(<SettingsPage definition={definition} currentUser={ownerUser} tenant={tenant} onTenantUpdated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/label above the headline/i), { target: { value: "This autumn" } });
    fireEvent.change(screen.getByLabelText(/marketing headline/i), { target: { value: "The Autumn Reset" } });
    fireEvent.change(screen.getByLabelText(/^marketing body/i), { target: { value: "Book by 30 November." } });
    fireEvent.change(screen.getByLabelText(/service screen label/i), { target: { value: "Membership" } });
    fireEvent.change(screen.getByLabelText(/location screen label/i), { target: { value: "Our studios" } });
    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("brow-beauty-lab", expect.objectContaining({
        bookingAd: expect.objectContaining({
          label: "This autumn",
          headline: "The Autumn Reset",
          body: "Book by 30 November.",
          serviceLabel: "Membership",
          locationLabel: "Our studios",
        }),
      }));
    });
  });

  it("takes marketing images as uploads, never as typed URLs", async () => {
    const spy = vi.spyOn(platformApi, "updateTenantBranding").mockResolvedValue(tenant as any);
    render(<SettingsPage definition={definition} currentUser={ownerUser} tenant={tenant} onTenantUpdated={vi.fn()} />);

    // No URL boxes for any image.
    expect(screen.queryByLabelText(/image url/i)).toBeNull();
    expect(screen.queryByLabelText(/logo url/i)).toBeNull();
    expect(screen.queryByLabelText(/gallery photo urls/i)).toBeNull();

    // Panel images open the crop dialog first, so nothing uploads until it is confirmed.
    fireEvent.change(screen.getByLabelText("Service screen image file"), {
      target: { files: [new File(["x"], "service.jpg", { type: "image/jpeg" })] },
    });
    expect(await screen.findByRole("dialog", { name: "Crop photo" })).toBeInTheDocument();
    expect(uploadImageFile).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Crop photo" })).getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog", { name: "Crop photo" })).toBeNull();

    // Alt text for each screen's image is saved with the rest.
    fireEvent.change(screen.getByLabelText(/service screen image alt text/i), { target: { value: "A treatment room" } });
    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("brow-beauty-lab", expect.objectContaining({
        bookingAd: expect.objectContaining({ serviceImageAltText: "A treatment room" }),
      })),
    );
  });

  it("sets the Begin booking card color, previews it, and can reset it", async () => {
    const spy = vi.spyOn(platformApi, "updateTenantBranding").mockResolvedValue(tenant as any);
    render(<SettingsPage definition={definition} currentUser={ownerUser} tenant={tenant} onTenantUpdated={vi.fn()} />);

    const preview = screen.getByLabelText("Begin booking card preview");
    fireEvent.change(screen.getByLabelText("Card color hex"), { target: { value: "#1a2b3c" } });
    expect(preview).toHaveStyle({ background: "#1a2b3c" });
    // A dark card gets light text so it stays readable.
    expect(preview).toHaveStyle({ color: "#ffffff" });
    fireEvent.change(screen.getByLabelText("Card color hex"), { target: { value: "#fbe9dd" } });
    expect(preview).toHaveStyle({ color: "#15110f" });

    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("brow-beauty-lab", expect.objectContaining({
        bookingAd: expect.objectContaining({ panelColor: "#fbe9dd" }),
      })),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Card color hex")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith("brow-beauty-lab", expect.objectContaining({
        bookingAd: expect.objectContaining({ panelColor: null }),
      })),
    );
  });

  it("opens the photo picker when the card preview is clicked", () => {
    const withPhoto = {
      ...tenant,
      branding: { ...tenant.branding, bookingAd: { enabled: true, imageUrl: "https://cdn.example.com/home.jpg" } },
    };
    render(<SettingsPage definition={definition} currentUser={ownerUser} tenant={withPhoto as any} onTenantUpdated={vi.fn()} />);

    const input = screen.getByLabelText("Marketing image file");
    const preview = screen.getByLabelText("Begin booking card preview");
    // The preview's photo and the upload thumbnail are both labels for the same file input, so clicking them opens it.
    const photo = within(preview).getByText("Replace photo").closest("label") as HTMLLabelElement;
    expect(photo).toHaveAttribute("for", input.id);
    expect(screen.getByAltText("Marketing image preview").closest("label")).toHaveAttribute("for", input.id);
  });

  it("uses the card preview as the only control for the Begin booking photo", () => {
    const withPhoto = {
      ...tenant,
      branding: { ...tenant.branding, bookingAd: { enabled: true, imageUrl: "https://cdn.example.com/home.jpg" } },
    };
    render(<SettingsPage definition={definition} currentUser={ownerUser} tenant={withPhoto as any} onTenantUpdated={vi.fn()} />);

    // One picker and one preview for this photo; no separate thumbnail or upload button above it.
    expect(screen.getAllByLabelText("Marketing image file")).toHaveLength(1);
    expect(screen.getAllByAltText("Marketing image preview")).toHaveLength(1);
    expect(screen.getByAltText("Marketing image preview").closest(".cs-promo-preview")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove Marketing image" })).toBeInTheDocument();
  });

  it("groups each screen's marketing settings in its own collapsible section", () => {
    render(<SettingsPage definition={definition} currentUser={ownerUser} tenant={tenant} onTenantUpdated={vi.fn()} />);
    const titles = ["Marketing panel", "Select service screen", "Choose location screen", "Booking review screen"];
    const sections = titles.map((t) => screen.getByText(t, { selector: "summary" }).closest("details") as HTMLDetailsElement);
    expect(sections.map((d) => d.open)).toEqual([true, false, false, false]);
    fireEvent.click(screen.getByText("Select service screen", { selector: "summary" }));
    expect(sections[1].open).toBe(true);
  });

  it("turns the Begin booking marketing panel off and saves it", async () => {
    const spy = vi.spyOn(platformApi, "updateTenantBranding").mockResolvedValue(tenant as any);
    render(<SettingsPage definition={definition} currentUser={ownerUser} tenant={tenant} onTenantUpdated={vi.fn()} />);
    const toggle = screen.getByLabelText(/show marketing panel on begin booking/i);
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /save branding/i }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const body = spy.mock.calls.at(-1)![1] as any;
    expect(body.bookingAd.enabled).toBe(false);
  });

  it("asks for an upload in the card preview when there is no photo yet", () => {
    render(<SettingsPage definition={definition} currentUser={ownerUser} tenant={tenant} onTenantUpdated={vi.fn()} />);
    const preview = screen.getByLabelText("Begin booking card preview");
    const prompt = within(preview).getByText("Upload photo").closest("label") as HTMLLabelElement;
    expect(prompt).toHaveAttribute("for", screen.getByLabelText("Marketing image file").id);
  });

  it("doesn't offer to replace photos to someone who can't edit settings", () => {
    const viewer = { ...ownerUser, permissions: [{ key: "settings.view", allowed: true }, { key: "settings.manage", allowed: false }] } as unknown as AuthenticatedUser;
    const withPhoto = {
      ...tenant,
      branding: { ...tenant.branding, bookingAd: { enabled: true, imageUrl: "https://cdn.example.com/home.jpg" } },
    };
    render(<SettingsPage definition={definition} currentUser={viewer} tenant={withPhoto as any} onTenantUpdated={vi.fn()} />);
    expect(screen.queryByText("Replace photo")).toBeNull();
    expect(screen.getByLabelText("Marketing image file")).toBeDisabled();
  });

  it("won't save a card color that isn't a hex value", () => {
    render(<SettingsPage definition={definition} currentUser={ownerUser} tenant={tenant} onTenantUpdated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Card color hex"), { target: { value: "peach" } });
    expect(screen.getByRole("button", { name: /save branding/i })).toBeDisabled();
    expect(screen.getByText(/card color must be a #rgb or #rrggbb/i)).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("checkbox", { name: /^enable client ownership/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /^assign owner on online bookings/i }));
    fireEvent.click(screen.getByRole("button", { name: /save client ownership/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith("brow-beauty-lab", {
      clientOwnershipEnabled: true,
      onlineBookingOwnerAssignmentEnabled: true,
    });
    expect(onTenantUpdated).toHaveBeenCalledWith(updated);
  });

  it("saves custom email settings via platformApi.updateTenantCustomEmail", async () => {
    const updated = {
      ...tenant,
      settings: {
        ...tenant.settings,
        customEmail: {
          fromAddress: "hello@browbeautylab.com",
          domain: "browbeautylab.com",
          verified: false,
        },
      },
    };
    const saveSpy = vi
      .spyOn(platformApi, "updateTenantCustomEmail")
      .mockResolvedValue(updated as any);
    const dnsSpy = vi.spyOn(platformApi, "getTenantEmailDns").mockResolvedValue({
      domain: "browbeautylab.com",
      verified: false,
      records: [
        { type: "CNAME", host: "booking._domainkey.browbeautylab.com", value: "dkim.example" },
        { type: "TXT", host: "browbeautylab.com", value: "v=spf1" },
        { type: "TXT", host: "_dmarc.browbeautylab.com", value: "v=DMARC1" },
      ],
    } as any);
    const onTenantUpdated = vi.fn();

    render(
      <SettingsPage
        definition={definition}
        currentUser={ownerUser}
        tenant={tenant}
        onTenantUpdated={onTenantUpdated}
      />,
    );

    fireEvent.change(screen.getByLabelText(/from address/i), {
      target: { value: "hello@browbeautylab.com" },
    });
    fireEvent.change(screen.getByLabelText(/sending domain/i), {
      target: { value: "browbeautylab.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save custom email/i }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(saveSpy).toHaveBeenCalledWith("brow-beauty-lab", {
      fromAddress: "hello@browbeautylab.com",
      domain: "browbeautylab.com",
    });
    expect(onTenantUpdated).toHaveBeenCalledWith(updated);
    expect(screen.getByRole("button", { name: /^verify$/i })).toBeDisabled();
    expect(screen.getByText(/verification ships in a later release/i)).toBeInTheDocument();
    void dnsSpy;
  });

  it("saves wallet & membership via platformApi.updateTenantWalletMembership", async () => {
    const updated = {
      ...tenant,
      settings: {
        ...tenant.settings,
        walletEnabled: true,
        walletExpirationMonths: 12,
        membershipEnabled: true,
      },
    };
    const spy = vi
      .spyOn(platformApi, "updateTenantWalletMembership")
      .mockResolvedValue(updated as any);
    const onTenantUpdated = vi.fn();

    render(
      <SettingsPage
        definition={definition}
        currentUser={ownerUser}
        tenant={tenant}
        onTenantUpdated={onTenantUpdated}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /enable wallet credit/i }));
    fireEvent.change(screen.getByLabelText(/wallet credit expiration/i), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /enable membership program/i }));
    fireEvent.click(screen.getByRole("button", { name: /save wallet & membership/i }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith("brow-beauty-lab", {
      walletEnabled: true,
      walletExpirationMonths: 12,
      membershipEnabled: true,
    });
    expect(onTenantUpdated).toHaveBeenCalledWith(updated);
  });
});
