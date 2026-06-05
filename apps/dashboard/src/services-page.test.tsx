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
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "cat-facials",
    tenantId: "tenant-1",
    name: "Facials",
    sortOrder: 1,
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

  it("filters the main list when a category is selected", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Brow Shape/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Brows/ }));

    expect(screen.getByRole("button", { name: /Brow Shape/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Signature Facial/ })).toBeNull();
  });

  it("opens the detail panel with a direct scheduling link when a service is clicked", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Brow Shape/ })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Brow Shape/ }));

    await waitFor(() =>
      expect(screen.getByText("Direct scheduling link")).toBeInTheDocument(),
    );
    const linkInput = screen.getByDisplayValue(
      /\?serviceId=svc-shape$/,
    ) as HTMLInputElement;
    expect(linkInput.readOnly).toBe(true);
  });

  it("copies the scheduling link to the clipboard", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Brow Shape/ })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Brow Shape/ }));
    await waitFor(() =>
      expect(screen.getByText("Direct scheduling link")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByText("Link copied!")).toBeInTheDocument());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("?serviceId=svc-shape"),
    );
  });

  it("duplicates a service and selects the new one", async () => {
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
    // After duplicate, listServices is re-fetched.
    vi.spyOn(platformApi, "listServices").mockResolvedValue({
      services: [...baseServices, duplicated],
    } as any);

    render(<ServicesPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /Brow Shape/ }).length).toBeGreaterThan(0),
    );

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

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Brow Shape/ })).toBeInTheDocument(),
    );

    expect(screen.queryByRole("button", { name: /\+ Add category/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /\+ New service/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Duplicate" })).toBeNull();
  });

  it("denies access entirely when services.view is false", async () => {
    mockLoaders();
    render(<ServicesPage definition={definition} currentUser={readOnlyUser} />);

    expect(
      screen.getByText(/You do not have permission to view the service catalog\./),
    ).toBeInTheDocument();
    expect(platformApi.getTenantBySlug).not.toHaveBeenCalled();
  });
});
