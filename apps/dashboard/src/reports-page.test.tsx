import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser } from "@booking/shared-types";

import { ReportsPage } from "./reports-page";
import { platformApi } from "./platform-api";

const user: AuthenticatedUser = {
  id: "user-1",
  tenantId: "tenant-1",
  tenantSlug: "brow-beauty-lab",
  email: "owner@browbeautylab.test",
  name: "Melissa Chang",
  role: "owner",
  permissions: [],
};

const definition = { title: "Reports", eyebrow: "Business performance", description: "Reports" };

afterEach(() => vi.restoreAllMocks());

describe("ReportsPage", () => {
  it("explains missing report access without fetching report data", () => {
    const sales = vi.spyOn(platformApi, "getSalesReport");
    render(<ReportsPage definition={definition} currentUser={user} tenant={null} />);

    expect(screen.getByText("You do not have permission to view reports.")).toBeInTheDocument();
    expect(sales).not.toHaveBeenCalled();
  });

  it("shows the report tabs to people who can view reports", () => {
    vi.spyOn(platformApi, "listLocationsAdmin").mockResolvedValue({ locations: [] } as any);
    vi.spyOn(platformApi, "listProvidersAdmin").mockResolvedValue({ providers: [] } as any);
    vi.spyOn(platformApi, "getTeamReport").mockReturnValue(new Promise(() => {}));
    render(
      <ReportsPage
        definition={definition}
        currentUser={{ ...user, permissions: [{ key: "reports.view", allowed: true }] }}
        tenant={null}
      />,
    );

    expect(screen.getByRole("tab", { name: "Team" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Sales" })).toBeNull();
  });
});
