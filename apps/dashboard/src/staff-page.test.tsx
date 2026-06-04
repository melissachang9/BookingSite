import { render, screen, waitFor } from "@testing-library/react";
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
  eyebrow: "Team roster",
  description: "Team members who can sign in to the dashboard.",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StaffPage", () => {
  it("renders the team roster from the API", async () => {
    vi.spyOn(platformApi, "listTenantUsers").mockResolvedValue({
      users: [
        {
          id: "u1",
          email: "owner@browbeautylab.test",
          name: "Melissa Chang",
          role: "owner",
          isActive: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "u2",
          email: "stylist@browbeautylab.test",
          name: "Riley Park",
          role: "provider",
          isActive: false,
          createdAt: "2026-02-15T00:00:00.000Z",
        },
      ],
    } as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => expect(screen.getByText("Melissa Chang")).toBeInTheDocument());
    expect(screen.getByText("Riley Park")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Provider")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("blocks users without settings.manage permission", () => {
    const spy = vi.spyOn(platformApi, "listTenantUsers");
    render(<StaffPage definition={definition} currentUser={readOnlyUser} />);
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("surfaces an error when the API fails", async () => {
    vi.spyOn(platformApi, "listTenantUsers").mockRejectedValue(new Error("boom"));
    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/boom/));
  });
});
