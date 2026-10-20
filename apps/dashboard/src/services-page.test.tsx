import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@booking/shared-types";

import { ServicesPage } from "./services-page";
import { platformApi } from "./platform-api";

const ownerUser: AuthenticatedUser = {
  id: "user-1",
  tenantId: "tenant-1",
  tenantSlug: "brow-beauty-lab",
  email: "owner@browbeautylab.test",
  name: "Melissa Chang",
  role: "owner",
  permissions: [
    { key: "services.view", allowed: true },
    { key: "services.manage", allowed: true },
    { key: "settings.manage", allowed: true },
  ],
};

const readOnlyUser: AuthenticatedUser = {
  ...ownerUser,
  id: "user-2",
  email: "staff@browbeautylab.test",
  role: "staff",
  permissions: [
    { key: "services.view", allowed: false },
    { key: "services.manage", allowed: false },
  ],
};

const definition = {
  title: "Services",
  eyebrow: "Catalog",
  description: "Organize the menu customers see.",
};

const baseTenant: any = {
  id: "tenant-1",
  slug: "brow-beauty-lab",
  name: "Brow Beauty Lab",
  timeZone: "America/Los_Angeles",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const baseCategories: any[] = [
  {
    id: "cat-brows",
    tenantId: "tenant-1",
    name: "Brows",
    sortOrder: 0,
    subheadline: "Shape, tint, and define",
    featuredLabel: "signature",
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "cat-facials",
    tenantId: "tenant-1",
    name: "Facials",
    sortOrder: 1,
    subheadline: null,
    featuredLabel: null,
    createdAt: "",
    updatedAt: "",
  },
];

const baseLocations: any[] = [
  {
    id: "loc-1",
    tenantId: "tenant-1",
    name: "Downtown",
    timeZone: "America/Los_Angeles",
    isActive: true,
    createdAt: "",
    updatedAt: "",
  },
];

const baseProviders: any[] = [
  {
    id: "prov-1",
    tenantId: "tenant-1",
    userId: null,
    name: "Ava Rivera",
    email: "ava@example.com",
    isActive: true,
    isBookableOnline: true,
    serviceIds: ["svc-shape"],
    locationIds: ["loc-1"],
    createdAt: "",
    updatedAt: "",
  },
];

const baseServices: any[] = [
  {
    id: "svc-shape",
    tenantId: "tenant-1",
    name: "Brow Shape",
    description: "30-min shaping",
    durationMinutes: 30,
    setupBufferMinutes: 0,
    cleanupBufferMinutes: 0,
    priceCents: 5000,
    depositCents: 0,
    isActive: true,
    locationIds: ["loc-1"],
    formIds: [],
    categoryId: "cat-brows",
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "svc-facial",
    tenantId: "tenant-1",
    name: "Signature Facial",
    description: "",
    durationMinutes: 60,
    setupBufferMinutes: 15,
    cleanupBufferMinutes: 15,
    priceCents: 12000,
    depositCents: 2500,
    isActive: true,
    locationIds: ["loc-1"],
    formIds: [],
    categoryId: "cat-facials",
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "svc-loose",
    tenantId: "tenant-1",
    name: "Lash Tint",
    description: "",
    durationMinutes: 20,
    setupBufferMinutes: 0,
    cleanupBufferMinutes: 0,
    priceCents: 3500,
    depositCents: 0,
    isActive: true,
    locationIds: ["loc-1"],
    formIds: [],
    categoryId: null,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  },
];

function mockLoaders(overrides: {
  services?: any[];
  categories?: any[];
  forms?: any[];
} = {}) {
  vi.spyOn(platformApi, "getTenantBySlug").mockResolvedValue(baseTenant);
  vi.spyOn(platformApi, "listServices").mockResolvedValue({
    services: overrides.services ?? baseServices,
  } as any);
  vi.spyOn(platformApi, "listServiceCategories").mockResolvedValue({
    categories: overrides.categories ?? baseCategories,
  } as any);
  vi.spyOn(platformApi, "listLocations").mockResolvedValue({
    locations: baseLocations,
  } as any);
  vi.spyOn(platformApi, "listProvidersAdmin").mockResolvedValue({
    providers: baseProviders,
  } as any);
  vi.spyOn(platformApi, "getServiceProviderVariants").mockResolvedValue({
    variants: [],
  } as any);
  vi.spyOn(platformApi, "listForms").mockResolvedValue({
    items: overrides.forms ?? [],
  } as any);
}

beforeEach(() => {
  // jsdom doesn't define navigator.clipboard; provide a writable mock.
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ServicesPage", () => {
  it("renders the sidebar with categories, counts, and an Uncategorized bucket", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByText("Brows")).toBeInTheDocument(),
    );

    // Categories are in group headers with counts
    expect(screen.getByText("Brows")).toBeInTheDocument();
    expect(screen.getByText("Facials")).toBeInTheDocument();
    // Uncategorized group shows when there are uncategorized services
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
  });

  it("renders category subheadline in the sidebar", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByText("Brows")).toBeInTheDocument(),
    );

    expect(screen.getByText("Shape, tint, and define")).toBeInTheDocument();
  });

  it("renders featured label badge in the sidebar", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByText("Brows")).toBeInTheDocument(),
    );

    expect(screen.getByText("Signature")).toBeInTheDocument();
  });

  it("does not render subheadline or badge when category has none", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByText("Facials")).toBeInTheDocument(),
    );

    // Facials has no subheadline or featuredLabel (scoped to badges: "New" is
    // also the add-service button's label).
    expect(screen.queryByText("Most popular", { selector: ".cs-svc-badge" })).toBeNull();
    expect(screen.queryByText("New", { selector: ".cs-svc-badge" })).toBeNull();
    expect(screen.queryByText("Limited", { selector: ".cs-svc-badge" })).toBeNull();
  });

  it("shows all services grouped under their categories", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByText("Brow Shape")).toBeInTheDocument(),
    );

    // All services are visible in the sidebar list
    expect(screen.getByText("Brow Shape")).toBeInTheDocument();
    expect(screen.getByText("Signature Facial")).toBeInTheDocument();
  });

  it("shows the direct scheduling link on each service card", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    // Click a service in the list to open its detail panel
    await waitFor(() =>
      expect(screen.getByText("Brow Shape")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Brow Shape"));
    fireEvent.click(screen.getByRole("tab", { name: "Online booking" }));

    // The "Copy link" action is visible in the Online booking card
    await waitFor(() =>
      expect(screen.getByText("Copy link")).toBeInTheDocument(),
    );
  });

  it("copies the scheduling link to the clipboard", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    // Click a service in the list to open its detail panel
    await waitFor(() =>
      expect(screen.getByText("Brow Shape")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Brow Shape"));
    fireEvent.click(screen.getByRole("tab", { name: "Online booking" }));

    await waitFor(() =>
      expect(screen.getByText("Copy link")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("Copy link"));
    await waitFor(() => expect(screen.getByText("Link copied!")).toBeInTheDocument());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("/services/svc-shape"),
    );
  });

  it("duplicates a service", async () => {
    mockLoaders();
    const duplicated = {
      ...baseServices[0],
      id: "svc-shape-copy",
      name: "Brow Shape (copy)",
      sortOrder: 1,
    };
    const duplicateSpy = vi
      .spyOn(platformApi, "duplicateService")
      .mockResolvedValue(duplicated as any);
    vi.spyOn(platformApi, "listServices").mockResolvedValueOnce({
      services: baseServices,
    } as any);
    vi.spyOn(platformApi, "listServices").mockResolvedValue({
      services: [...baseServices, duplicated],
    } as any);

    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    // Click a service in the list to open its detail panel
    await waitFor(() =>
      expect(screen.getByText("Brow Shape")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Brow Shape"));

    const dupButtons = screen.getAllByRole("button", { name: "Duplicate" });
    fireEvent.click(dupButtons[0]);

    await waitFor(() => expect(duplicateSpy).toHaveBeenCalledWith(
      "brow-beauty-lab",
      "svc-shape",
    ));
  });

  it("hides manage actions for users without services.manage", async () => {
    mockLoaders();
    const viewOnly: AuthenticatedUser = {
      ...ownerUser,
      permissions: [
        { key: "services.view", allowed: true },
        { key: "services.manage", allowed: false },
      ],
    };
    render(<ServicesPage definition={definition} currentUser={viewOnly} />);

    // Click a service in the list to open its detail panel
    await waitFor(() =>
      expect(screen.getByText("Brow Shape")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Brow Shape"));

    expect(screen.queryByRole("button", { name: /\+ Add category/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /\+ Add service/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Duplicate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("saves a featured label from the Details tab", async () => {
    mockLoaders();
    const updateSpy = vi.spyOn(platformApi, "updateService").mockResolvedValue({} as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Brow Shape"));
    fireEvent.click(screen.getByRole("button", { name: "Most popular" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy.mock.calls[0][2]).toMatchObject({ featuredLabel: "most_popular" });
  });

  it("requires a client-facing form for the service on save", async () => {
    mockLoaders({
      forms: [
        { id: "form-intake", name: "General skin intake", scope: "customer", isActive: true, customerPromptTiming: "pre_visit", appliesToAllServices: false, serviceIds: ["svc-facial"] },
        { id: "form-notes", name: "Provider notes", scope: "internal", isActive: true, appliesToAllServices: false, serviceIds: [] },
      ],
    });
    vi.spyOn(platformApi, "updateService").mockResolvedValue({} as any);
    const formSpy = vi.spyOn(platformApi, "updateForm").mockResolvedValue({} as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Brow Shape"));
    // Internal forms never show up as client requirements.
    await waitFor(() => expect(screen.getByText("General skin intake")).toBeInTheDocument());
    expect(screen.queryByText("Provider notes")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: /General skin intake/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(formSpy).toHaveBeenCalledWith(
      "brow-beauty-lab",
      "form-intake",
      { serviceIds: ["svc-facial", "svc-shape"] },
    ));
  });

  it("adds an add-on from the Add-ons tab", async () => {
    mockLoaders();
    vi.spyOn(platformApi, "listServiceAddOnsManaged").mockResolvedValue({ items: [] } as any);
    const createSpy = vi.spyOn(platformApi, "createServiceAddOn").mockResolvedValue({
      id: "addon-1", tenantId: "tenant-1", serviceId: "svc-shape", createdAt: "", updatedAt: "",
      name: "Brow lamination", description: null, priceCents: 4000, durationMinutes: 15, isActive: true, sortOrder: 0,
    } as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Brow Shape"));
    fireEvent.click(screen.getByRole("tab", { name: "Add-ons" }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Add add-on" }));

    const form = screen.getByRole("group", { name: "New add-on" });
    fireEvent.change(within(form).getByPlaceholderText("e.g. LED therapy"), { target: { value: "Brow lamination" } });
    fireEvent.change(within(form).getByPlaceholderText("0.00"), { target: { value: "40" } });
    fireEvent.change(within(form).getByDisplayValue("0"), { target: { value: "15" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add add-on" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("brow-beauty-lab", "svc-shape", {
      name: "Brow lamination", priceCents: 4000, durationMinutes: 15, description: null,
    }));
    expect(await screen.findByText("Brow lamination")).toBeInTheDocument();
  });

  it("adds equipment inline from the Resources tab and ticks it", async () => {
    mockLoaders();
    vi.spyOn(platformApi, "listResources").mockResolvedValue({ items: [] } as any);
    vi.spyOn(platformApi, "getServiceResources").mockResolvedValue({ serviceId: "svc-shape", resources: [] } as any);
    const createSpy = vi.spyOn(platformApi, "createResource").mockResolvedValue({
      id: "res-1", tenantId: "tenant-1", createdAt: "", updatedAt: "",
      name: "LED panel", kind: "equipment", isActive: true, locationId: null, notes: null, quantity: 2,
    } as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Brow Shape"));
    fireEvent.click(screen.getByRole("tab", { name: "Resources" }));
    fireEvent.click(await screen.findByRole("button", { name: "+ Add equipment" }));

    const form = screen.getByRole("group", { name: "New equipment" });
    fireEvent.change(within(form).getByPlaceholderText("e.g. LED panel"), { target: { value: "LED panel" } });
    fireEvent.change(within(form).getByDisplayValue("1"), { target: { value: "2" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add equipment" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("brow-beauty-lab", expect.objectContaining({
      name: "LED panel", kind: "equipment", quantity: 2,
    })));
    expect(await screen.findByRole("checkbox", { name: "Toggle LED panel" })).toBeChecked();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("can delete a category and leave its services uncategorised", async () => {
    mockLoaders();
    const deleteSpy = vi.spyOn(platformApi, "deleteServiceCategory").mockResolvedValue(undefined);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brows")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Brows actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete category" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Leave them uncategorised" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete category" }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith("brow-beauty-lab", "cat-brows", { moveToCategoryId: undefined }));
  });

  it("opens the category editor from the category name", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brows")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Brows" }));

    expect(await screen.findByDisplayValue("Shape, tint, and define")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("saves what's taken at booking from the Online booking tab", async () => {
    mockLoaders();
    const updateSpy = vi.spyOn(platformApi, "updateService").mockResolvedValue({} as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Brow Shape"));
    fireEvent.click(screen.getByRole("tab", { name: "Online booking" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Partial payment — %/ }));
    fireEvent.change(screen.getByLabelText("Partial payment percentage"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy.mock.calls[0][2]).toMatchObject({ bookingPaymentMode: "partial_percent", bookingPaymentPercent: 30 });
  });

  it("defaults a service to its category's payment rule and keeps following it when saved", async () => {
    mockLoaders({
      categories: [
        { ...baseCategories[0], bookingPaymentMode: "partial_flat", bookingPaymentValueCents: 4000 },
        baseCategories[1],
      ],
    });
    const updateSpy = vi.spyOn(platformApi, "updateService").mockResolvedValue({} as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Brow Shape"));
    fireEvent.click(screen.getByRole("tab", { name: "Online booking" }));

    // The category's rule is the current choice; there is no separate "same as" button.
    expect(await screen.findByRole("radio", { name: /Partial payment — \$/ })).toBeChecked();
    expect(screen.getByLabelText("Partial payment amount")).toHaveValue("40.00");
    expect(screen.queryByRole("radio", { name: /Same as/ })).toBeNull();
    // Payment and card on file both say they are following the category.
    expect(screen.getAllByText(/Following Brows/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const body = updateSpy.mock.calls[0][2] as any;
    expect(body.inheritBookingPayment).toBe(true);
    expect(body.inheritRequireCardOnFile).toBe(true);
    expect(body.bookingPaymentMode).toBeUndefined();
  });

  it("makes the payment rule the service's own once it is changed from the category's", async () => {
    mockLoaders({
      categories: [{ ...baseCategories[0], bookingPaymentMode: "full" }, baseCategories[1]],
    });
    const updateSpy = vi.spyOn(platformApi, "updateService").mockResolvedValue({} as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Brow Shape"));
    fireEvent.click(screen.getByRole("tab", { name: "Online booking" }));
    expect(await screen.findByRole("radio", { name: /Full payment/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "No payment required at booking" }));
    // Only card on file still follows the category.
    expect(screen.getAllByText(/Following Brows/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    const body = updateSpy.mock.calls[0][2] as any;
    expect(body.bookingPaymentMode).toBe("none");
    expect(body.inheritBookingPayment).toBeUndefined();
  });

  it("requires an amount for a fixed payment on a service", async () => {
    mockLoaders();
    const updateSpy = vi.spyOn(platformApi, "updateService").mockResolvedValue({} as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Brow Shape"));
    fireEvent.click(screen.getByRole("tab", { name: "Online booking" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Partial payment — \$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter the amount to take at booking.")).toBeInTheDocument();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("saves online booking rules and required forms on a category", async () => {
    mockLoaders({
      forms: [
        { id: "form-consent", name: "Brow consent", scope: "customer", isActive: true, appliesToAllServices: false, serviceIds: [], categoryIds: [], customerPromptTiming: "pre_booking" },
      ],
    });
    const updateCategory = vi.spyOn(platformApi, "updateServiceCategory").mockResolvedValue({} as any);
    const updateForm = vi.spyOn(platformApi, "updateForm").mockResolvedValue({} as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brows")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Brows" }));

    fireEvent.click(await screen.findByRole("radio", { name: "Full payment" }));
    fireEvent.click(screen.getByRole("button", { name: "Category require card on file toggle" }));
    fireEvent.click(screen.getByRole("radio", { name: "Hide artist selection" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Brow consent/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateCategory).toHaveBeenCalledTimes(1));
    expect(updateCategory.mock.calls[0][2]).toMatchObject({
      bookingPaymentMode: "full",
      requireCardOnFile: true,
      providerSelectionMode: "hide",
    });
    await waitFor(() =>
      expect(updateForm).toHaveBeenCalledWith("brow-beauty-lab", "form-consent", { categoryIds: ["cat-brows"] }),
    );
  });

  it("shows a category's saved payment rule as selected", async () => {
    mockLoaders({
      categories: [{ ...baseCategories[0], bookingPaymentMode: "full" }, baseCategories[1]],
    });
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brows")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Brows" }));
    expect(await screen.findByRole("radio", { name: "Full payment" })).toBeChecked();
    expect(screen.queryByText(/Not set — services here take no payment/)).toBeNull();
  });

  it("marks forms a service's category requires as required by the category", async () => {
    mockLoaders({
      forms: [
        { id: "form-consent", name: "Brow consent", scope: "customer", isActive: true, appliesToAllServices: false, serviceIds: [], categoryIds: ["cat-brows"], customerPromptTiming: "pre_booking" },
      ],
    });
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Brow Shape"));

    expect(await screen.findByText("Required by Brows")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Brow consent/ })).toBeDisabled();
  });

  it("lets the category booking link be edited and saved", async () => {
    mockLoaders({ categories: [{ ...baseCategories[0], slug: "brows" }, baseCategories[1]] });
    const updateCategory = vi.spyOn(platformApi, "updateServiceCategory").mockResolvedValue({} as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brows")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Brows" }));
    const link = await screen.findByLabelText("Category link");
    expect(link).toHaveValue("brows");
    fireEvent.change(link, { target: { value: "Brow Studio" } });
    expect(link).toHaveValue("brow-studio");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateCategory).toHaveBeenCalledTimes(1));
    expect(updateCategory.mock.calls[0][2]).toMatchObject({ slug: "brow-studio" });
  });

  it("edits a provider's deposit from the service's Staff tab", async () => {
    mockLoaders();
    const replaceSpy = vi.spyOn(platformApi, "replaceServiceProviderVariants").mockResolvedValue({
      variants: [{ providerId: "prov-1", priceCents: null, durationMinutes: null, depositCents: 1500, commissionFlatCents: null, commissionBasisPoints: null }],
    } as any);
    vi.spyOn(platformApi, "updateService").mockResolvedValue({} as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Brow Shape"));
    fireEvent.click(screen.getByRole("tab", { name: "Staff" }));
    fireEvent.change(await screen.findByLabelText("Ava Rivera deposit"), { target: { value: "15.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(replaceSpy).toHaveBeenCalledTimes(1));
    expect(replaceSpy.mock.calls[0][2]).toMatchObject({
      variants: [expect.objectContaining({ providerId: "prov-1", depositCents: 1500 })],
    });
  });

  it("names a new service so it never clashes with an existing one", async () => {
    mockLoaders({
      services: [...baseServices, { ...baseServices[2], id: "svc-new", name: "New Service" }],
    });
    const createSpy = vi.spyOn(platformApi, "createService").mockResolvedValue({ id: "svc-created" } as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "New service" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy.mock.calls[0][1]).toMatchObject({ name: "New Service 2" });
  });

  it("tries the next name when a hidden service already holds the first", async () => {
    mockLoaders();
    const conflict = Object.assign(new Error("A service with this name already exists for the tenant."), { status: 409 });
    const createSpy = vi
      .spyOn(platformApi, "createService")
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ id: "svc-created" } as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "New service" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(2));
    expect(createSpy.mock.calls[0][1]).toMatchObject({ name: "New Service" });
    expect(createSpy.mock.calls[1][1]).toMatchObject({ name: "New Service 2" });
  });

  it("keeps the service heading and category label in step with the form as it is edited", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Lash Tint")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Lash Tint"));
    const heading = await screen.findByRole("heading", { name: "Lash Tint", level: 4 });
    expect(screen.getByText("Uncategorized", { selector: ".cs-svc-detail-head__eyebrow" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Service name"), { target: { value: "Microneedling" } });
    expect(heading).toHaveTextContent("Microneedling");
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "cat-facials" } });
    expect(screen.getByText("Facials", { selector: ".cs-svc-detail-head__eyebrow" })).toBeInTheDocument();
  });

  it("offers the booking link in a category's more-actions menu", async () => {
    mockLoaders({ categories: [{ ...baseCategories[0], slug: "brows" }, baseCategories[1]] });
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brows")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Brows" }));
    fireEvent.click(await screen.findByRole("button", { name: "More category actions" }));
    expect(screen.getByRole("menuitem", { name: "View booking page" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete category" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy booking link" }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringMatching(/\/brow-beauty-lab\/c\/brows$/)),
    );
  });

  it("opens a category's settings from the list menu", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Facials")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Facials actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));

    expect(await screen.findByLabelText("Category name")).toHaveValue("Facials");
    expect(screen.getByRole("button", { name: "More category actions" })).toBeInTheDocument();
  });

  it("copies a category's booking link from the list menu", async () => {
    mockLoaders({ categories: [{ ...baseCategories[0], slug: "brows" }, baseCategories[1]] });
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brows")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Brows actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy booking link" }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringMatching(/\/brow-beauty-lab\/c\/brows$/)),
    );
    expect(await screen.findByText("Booking link for Brows copied.")).toBeInTheDocument();
  });

  it("lets tax be switched off for a service and saves it as the service's own", async () => {
    mockLoaders();
    const updateSpy = vi.spyOn(platformApi, "updateService").mockResolvedValue({} as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Brow Shape"));
    const toggle = await screen.findByRole("button", { name: "Charge tax toggle" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Following Brows\./)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("No tax is added to this service.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy.mock.calls[0][2]).toMatchObject({ isTaxable: false });
  });

  it("shows a service following a non-taxable category and keeps following it when saved", async () => {
    mockLoaders({ categories: [{ ...baseCategories[0], isTaxable: false }, baseCategories[1]] });
    const updateSpy = vi.spyOn(platformApi, "updateService").mockResolvedValue({} as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Brow Shape"));
    const toggle = await screen.findByRole("button", { name: "Charge tax toggle" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy.mock.calls[0][2]).toMatchObject({ inheritIsTaxable: true });
  });

  it("saves a category as not charging tax", async () => {
    mockLoaders();
    const updateCategory = vi.spyOn(platformApi, "updateServiceCategory").mockResolvedValue({} as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Facials")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Facials" }));
    const toggle = await screen.findByRole("button", { name: "Category charge tax toggle" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateCategory).toHaveBeenCalledTimes(1));
    expect(updateCategory.mock.calls[0][2]).toMatchObject({ isTaxable: false });
  });

  it("turns a category's tax setting back to the default when it is switched on again", async () => {
    mockLoaders({ categories: [baseCategories[0], { ...baseCategories[1], isTaxable: false }] });
    const updateCategory = vi.spyOn(platformApi, "updateServiceCategory").mockResolvedValue({} as any);
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Facials")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Facials" }));
    const toggle = await screen.findByRole("button", { name: "Category charge tax toggle" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateCategory).toHaveBeenCalledTimes(1));
    expect(updateCategory.mock.calls[0][2]).toMatchObject({ clearIsTaxable: true });
  });

  describe("provider settings panel on the Staff tab", () => {
    const provider = {
      ...baseProviders[0],
      description: "Lead therapist",
      isBookableOnline: true,
      bookingSlug: "ava",
      bookingUrl: "https://shop.example.com/brow-beauty-lab/p/ava",
      compensationMode: "service_percent",
      compensationServicePercentBp: 4000,
    };

    async function openPanel(providers: any[] = [provider]) {
      mockLoaders();
      vi.spyOn(platformApi, "listProvidersAdmin").mockResolvedValue({ providers } as any);
      render(<ServicesPage definition={definition} currentUser={ownerUser} />);
      await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Brow Shape"));
      fireEvent.click(screen.getByRole("tab", { name: "Staff" }));
      fireEvent.click(await screen.findByRole("button", { name: "Open settings for Ava Rivera" }));
      return screen.findByRole("complementary", { name: "Ava Rivera settings" });
    }

    it("opens when a provider is clicked and shows their pay, online booking and link", async () => {
      const panel = await openPanel();
      expect(within(panel).getByText("Pay for this treatment")).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "Staff default" })).toHaveAttribute("aria-pressed", "true");
      expect(within(panel).getByText("40% of service revenue")).toBeInTheDocument();
      expect(within(panel).getByRole("link", { name: "Edit in Staff" })).toHaveAttribute(
        "href",
        "/staff?provider=prov-1&tab=compensation",
      );
      // 40% of the $50.00 service price.
      expect(within(panel).getByText("$20.00")).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "Ava Rivera bookable online toggle" })).toHaveAttribute("aria-pressed", "true");
      expect(within(panel).getByLabelText("Ava Rivera booking link")).toHaveValue("ava");

      fireEvent.click(within(panel).getByRole("button", { name: "Done" }));
      expect(screen.queryByRole("complementary", { name: "Ava Rivera settings" })).toBeNull();
    });

    it("sets a percent or flat pay override for this treatment and saves it with the variants", async () => {
      const panel = await openPanel();
      const replaceSpy = vi.spyOn(platformApi, "replaceServiceProviderVariants").mockResolvedValue({ variants: [] } as any);
      vi.spyOn(platformApi, "updateService").mockResolvedValue({} as any);

      fireEvent.click(within(panel).getByRole("button", { name: "% of price" }));
      fireEvent.change(within(panel).getByLabelText("Ava Rivera pay percent"), { target: { value: "50" } });
      expect(within(panel).getByText("$25.00")).toBeInTheDocument();
      fireEvent.click(within(panel).getByRole("button", { name: "Flat per booking" }));
      fireEvent.change(within(panel).getByLabelText("Ava Rivera pay flat amount"), { target: { value: "12" } });
      expect(within(panel).getByText("$12.00")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(replaceSpy).toHaveBeenCalledTimes(1));
      expect(replaceSpy.mock.calls[0][2]).toMatchObject({
        variants: [expect.objectContaining({ providerId: "prov-1", commissionFlatCents: 1200, commissionBasisPoints: null })],
      });
    });

    it("lets the booking link be edited and saved", async () => {
      const panel = await openPanel();
      const updateProvider = vi.spyOn(platformApi, "updateProvider").mockResolvedValue({} as any);
      // Both buttons are always there; Save only does something once the ending changes.
      expect(within(panel).getByRole("button", { name: "Save link" })).toBeDisabled();
      expect(within(panel).getByRole("button", { name: "Copy link" })).toBeEnabled();

      fireEvent.change(within(panel).getByLabelText("Ava Rivera booking link"), { target: { value: "Ava Brow Studio" } });
      expect(within(panel).getByLabelText("Ava Rivera booking link")).toHaveValue("ava-brow-studio");
      // A link that isn't saved yet can't be copied.
      expect(within(panel).getByRole("button", { name: "Copy link" })).toBeDisabled();
      fireEvent.click(within(panel).getByRole("button", { name: "Save link" }));

      await waitFor(() =>
        expect(updateProvider).toHaveBeenCalledWith("brow-beauty-lab", "prov-1", { bookingSlug: "ava-brow-studio" }),
      );
    });

    it("shows the same two buttons for every provider and never carries a draft to someone else", async () => {
      const other = { ...provider, id: "prov-2", name: "Ben Cole", bookingSlug: null, bookingUrl: null, serviceIds: ["svc-shape"] };
      const panel = await openPanel([provider, other]);
      fireEvent.change(within(panel).getByLabelText("Ava Rivera booking link"), { target: { value: "draft-only" } });
      expect(within(panel).getByRole("button", { name: "Save link" })).toBeEnabled();

      fireEvent.click(screen.getByRole("button", { name: "Open settings for Ben Cole" }));
      const benPanel = await screen.findByRole("complementary", { name: "Ben Cole settings" });
      expect(within(benPanel).getByLabelText("Ben Cole booking link")).toHaveValue("");
      // No link yet: Save and Copy are both there, neither usable until there is something to save or copy.
      expect(within(benPanel).getByRole("button", { name: "Save link" })).toBeDisabled();
      expect(within(benPanel).getByRole("button", { name: "Copy link" })).toBeDisabled();
    });

    it("shows why a booking link couldn't be saved, such as one already taken", async () => {
      const panel = await openPanel();
      vi.spyOn(platformApi, "updateProvider").mockRejectedValue(new Error("That booking link is already taken. Try another."));
      fireEvent.change(within(panel).getByLabelText("Ava Rivera booking link"), { target: { value: "jordan" } });
      fireEvent.click(within(panel).getByRole("button", { name: "Save link" }));

      expect(await within(panel).findByText("That booking link is already taken. Try another.")).toBeInTheDocument();
    });

    it("blocks a malformed booking link before saving", async () => {
      const panel = await openPanel();
      const updateProvider = vi.spyOn(platformApi, "updateProvider").mockResolvedValue({} as any);
      fireEvent.change(within(panel).getByLabelText("Ava Rivera booking link"), { target: { value: "bad_link!" } });
      fireEvent.click(within(panel).getByRole("button", { name: "Save link" }));

      expect(await within(panel).findByText("Use letters, numbers and single hyphens only.")).toBeInTheDocument();
      expect(updateProvider).not.toHaveBeenCalled();
    });

    it("turns online booking on or off for the provider straight away", async () => {
      const panel = await openPanel();
      const updateProvider = vi.spyOn(platformApi, "updateProvider").mockResolvedValue({} as any);
      fireEvent.click(within(panel).getByRole("button", { name: "Ava Rivera bookable online toggle" }));
      await waitFor(() =>
        expect(updateProvider).toHaveBeenCalledWith("brow-beauty-lab", "prov-1", { isBookableOnline: false }),
      );
      expect(within(panel).getByText(/Applies to all of Ava's treatments/)).toBeInTheDocument();
    });

    it("has no separate remove link, and unticking the provider closes the panel and removes them", async () => {
      const panel = await openPanel();
      expect(within(panel).queryByRole("button", { name: /Remove from this treatment/ })).toBeNull();
      const updateProvider = vi.spyOn(platformApi, "updateProvider").mockResolvedValue({} as any);
      fireEvent.click(screen.getByRole("checkbox", { name: "Toggle Ava Rivera" }));
      await waitFor(() =>
        expect(updateProvider).toHaveBeenCalledWith("brow-beauty-lab", "prov-1", { serviceIds: [] }),
      );
      expect(screen.queryByRole("complementary", { name: "Ava Rivera settings" })).toBeNull();
    });

    it("shows what the storefront will display for this treatment", async () => {
      mockLoaders();
      const other = { ...provider, id: "prov-2", name: "Ben Cole", isBookableOnline: false, serviceIds: ["svc-shape"] };
      vi.spyOn(platformApi, "listProvidersAdmin").mockResolvedValue({ providers: [provider, other] } as any);
      render(<ServicesPage definition={definition} currentUser={ownerUser} />);
      await waitFor(() => expect(screen.getByText("Brow Shape")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Brow Shape"));
      fireEvent.click(screen.getByRole("tab", { name: "Staff" }));
      expect(await screen.findByText(/1 of 2 bookable online/)).toBeInTheDocument();
      expect(screen.getByText("Calendar only")).toBeInTheDocument();
    });
  });

  it("denies access entirely when services.view is false", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={readOnlyUser} />);

    expect(
      screen.getByText(/You do not have permission to view the service catalog\./),
    ).toBeInTheDocument();
    expect(platformApi.getTenantBySlug).not.toHaveBeenCalled();
  });

  it("opens the Add category modal when + Add category is clicked", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /\+ Add category/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /\+ Add category/ }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Add category" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Add category" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Brows, Facials, Lamination")).toBeInTheDocument();
  });

  it("creates a category through the modal and closes it", async () => {
    mockLoaders();
    const createSpy = vi
      .spyOn(platformApi, "createServiceCategory")
      .mockResolvedValue({} as any);
    vi.spyOn(platformApi, "listServiceCategories").mockResolvedValue({
      categories: [...baseCategories, { id: "cat-new", tenantId: "tenant-1", name: "Lamination", sortOrder: 2, createdAt: "", updatedAt: "" }],
    } as any);

    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /\+ Add category/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /\+ Add category/ }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Add category" })).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText("e.g. Brows, Facials, Lamination"), {
      target: { value: "Lamination" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith(
      "brow-beauty-lab",
      { name: "Lamination" },
    ));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add category" })).toBeNull(),
    );
  });

  it("shows an error in the create modal when the name is empty", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /\+ Add category/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /\+ Add category/ }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Add category" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create category" }));

    await waitFor(() =>
      expect(screen.getByText("Enter a category name.")).toBeInTheDocument(),
    );
  });

  it("closes the create modal when Cancel is clicked", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /\+ Add category/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /\+ Add category/ }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Add category" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add category" })).toBeNull(),
    );
  });

  it("opens the Rename modal when Rename is clicked on a category", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByText("Brows")).toBeInTheDocument(),
    );

    // Rename lives in the category's "···" menu
    fireEvent.click(screen.getByRole("button", { name: "Brows actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Rename category" })).toBeInTheDocument(),
    );
    const dialog = screen.getByRole("dialog", { name: "Rename category" });
    const input = within(dialog).getByDisplayValue("Brows") as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it("renames a category through the modal", async () => {
    mockLoaders();
    const updateSpy = vi
      .spyOn(platformApi, "updateServiceCategory")
      .mockResolvedValue({} as any);
    // First load returns original categories; refresh after rename returns updated
    vi.spyOn(platformApi, "listServiceCategories")
      .mockResolvedValueOnce({ categories: baseCategories } as any)
      .mockResolvedValue({ categories: [{ ...baseCategories[0], name: "Brow Services" }, baseCategories[1]] } as any);

    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByText("Brows")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Brows actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Rename category" })).toBeInTheDocument(),
    );

    const dialog = screen.getByRole("dialog", { name: "Rename category" });
    const input = within(dialog).getByDisplayValue("Brows");
    fireEvent.change(input, { target: { value: "Brow Services" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(
      "brow-beauty-lab",
      "cat-brows",
      { name: "Brow Services" },
    ));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Rename category" })).toBeNull(),
    );
  });

  it("opens the Delete confirmation modal when Delete is clicked", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByText("Brows")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Brows actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Delete category" })).toBeInTheDocument(),
    );
    const dialog = screen.getByRole("dialog", { name: "Delete category" });
    expect(within(dialog).getByRole("heading", { name: "Delete category" })).toBeInTheDocument();
    expect(within(dialog).getByText(/nothing is deleted with the category/)).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Move them to" })).toBeChecked();
  });

  it("deletes a category through the confirmation modal", async () => {
    mockLoaders();
    const deleteSpy = vi
      .spyOn(platformApi, "deleteServiceCategory")
      .mockResolvedValue(undefined);
    vi.spyOn(platformApi, "listServiceCategories")
      .mockResolvedValueOnce({ categories: baseCategories } as any)
      .mockResolvedValue({ categories: [baseCategories[1]] } as any);
    vi.spyOn(platformApi, "listServices")
      .mockResolvedValueOnce({ services: baseServices } as any)
      .mockResolvedValue({ services: baseServices } as any);

    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByText("Brows")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Brows actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Delete category" })).toBeInTheDocument(),
    );

    const dialog = screen.getByRole("dialog", { name: "Delete category" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete category" }));

    // Its services move to the next category by default.
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(
      "brow-beauty-lab",
      "cat-brows",
      { moveToCategoryId: "cat-facials" },
    ));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete category" })).toBeNull(),
    );
  });
});
