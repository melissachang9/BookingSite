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
      expect(screen.getByRole("button", { name: /All services/ })).toBeInTheDocument(),
    );

    const brows = screen.getByRole("button", { name: /^Brows/ });
    expect(within(brows).getByText("1")).toBeInTheDocument();
    const facials = screen.getByRole("button", { name: /^Facials/ });
    expect(within(facials).getByText("1")).toBeInTheDocument();
    const uncategorized = screen.getByRole("button", { name: /Uncategorized/ });
    expect(within(uncategorized).getByText("1")).toBeInTheDocument();
  });

  it("renders category subheadline in the sidebar", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /All services/ })).toBeInTheDocument(),
    );

    const brows = screen.getByRole("button", { name: /^Brows/ });
    expect(within(brows).getByText("Shape, tint, and define")).toBeInTheDocument();
  });

  it("renders featured label badge in the sidebar", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /All services/ })).toBeInTheDocument(),
    );

    const brows = screen.getByRole("button", { name: /^Brows/ });
    expect(within(brows).getByText("Signature")).toBeInTheDocument();
  });

  it("does not render subheadline or badge when category has none", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /All services/ })).toBeInTheDocument(),
    );

    const facials = screen.getByRole("button", { name: /^Facials/ });
    // Facials has no subheadline or featuredLabel
    expect(within(facials).queryByText("Signature")).toBeNull();
    expect(within(facials).queryByText("Most popular")).toBeNull();
    expect(within(facials).queryByText("New")).toBeNull();
    expect(within(facials).queryByText("Limited")).toBeNull();
  });

  it("filters the main list when a category is selected", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByText("Brow Shape")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Brows/ }));

    expect(screen.getByText("Brow Shape")).toBeInTheDocument();
    expect(screen.queryByText("Signature Facial")).toBeNull();
  });

  it("shows the direct scheduling link on each service card", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    // Click a service in the list to open its detail panel
    await waitFor(() =>
      expect(screen.getByText("Brow Shape")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Brow Shape"));

    const linkInput = (await screen.findByDisplayValue(
      /\?serviceId=svc-shape$/,
    )) as HTMLInputElement;
    expect(linkInput.readOnly).toBe(true);
  });

  it("copies the scheduling link to the clipboard", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    // Click a service in the list to open its detail panel
    await waitFor(() =>
      expect(screen.getByText("Brow Shape")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Brow Shape"));

    await screen.findByDisplayValue(/\?serviceId=svc-shape$/);

    // Open the "More options" details so the booking-link Copy button is interactable
    const detailsEls = document.querySelectorAll<HTMLDetailsElement>(".service-card__more");
    detailsEls.forEach((d) => {
      d.open = true;
    });

    const copyButtons = screen.getAllByRole("button", { name: "Copy" });
    fireEvent.click(copyButtons[0]);
    await waitFor(() => expect(screen.getByText("Link copied!")).toBeInTheDocument());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("?serviceId=svc-shape"),
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

  it("opens the Rename modal when Rename is clicked on a selected category", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Brows/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Brows/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

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
      expect(screen.getByRole("button", { name: /^Brows/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Brows/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

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
      expect(screen.getByRole("button", { name: /^Brows/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Brows/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Delete category" })).toBeInTheDocument(),
    );
    const dialog = screen.getByRole("dialog", { name: "Delete category" });
    expect(within(dialog).getByRole("heading", { name: "Delete category" })).toBeInTheDocument();
    expect(within(dialog).getByText(/Services in this category will become uncategorized/)).toBeInTheDocument();
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
      expect(screen.getByRole("button", { name: /^Brows/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Brows/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Delete category" })).toBeInTheDocument(),
    );

    const dialog = screen.getByRole("dialog", { name: "Delete category" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(
      "brow-beauty-lab",
      "cat-brows",
    ));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete category" })).toBeNull(),
    );
  });
});
