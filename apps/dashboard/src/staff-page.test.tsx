import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("creates a new user via the Add user modal", async () => {
    vi.spyOn(platformApi, "listTenantUsers").mockResolvedValue({ users: [] } as any);
    const createSpy = vi
      .spyOn(platformApi, "createTenantUser")
      .mockResolvedValue({} as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => expect(screen.getByText("Add user")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add user" }));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane Doe" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "jane@browbeautylab.test" },
    });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "manager" } });
    fireEvent.change(screen.getByLabelText(/Initial password/), {
      target: { value: "TempPass123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    expect(createSpy).toHaveBeenCalledWith("brow-beauty-lab", {
      email: "jane@browbeautylab.test",
      name: "Jane Doe",
      role: "manager",
      initialPassword: "TempPass123",
    });
  });

  it("updates an existing user via the Edit modal", async () => {
    vi.spyOn(platformApi, "listTenantUsers").mockResolvedValue({
      users: [
        {
          id: "u1",
          email: "stylist@browbeautylab.test",
          name: "Riley Park",
          role: "staff",
          isActive: true,
          createdAt: "2026-02-15T00:00:00.000Z",
        },
      ],
    } as any);
    const updateSpy = vi
      .spyOn(platformApi, "updateTenantUser")
      .mockResolvedValue({} as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => expect(screen.getByText("Riley Park")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "manager" } });
    fireEvent.click(screen.getByLabelText("Active"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith("brow-beauty-lab", "u1", {
      role: "manager",
      isActive: false,
    });
  });

  it("resets a password via the Reset password modal", async () => {
    vi.spyOn(platformApi, "listTenantUsers").mockResolvedValue({
      users: [
        {
          id: "u1",
          email: "stylist@browbeautylab.test",
          name: "Riley Park",
          role: "staff",
          isActive: true,
          createdAt: "2026-02-15T00:00:00.000Z",
        },
      ],
    } as any);
    const resetSpy = vi
      .spyOn(platformApi, "resetTenantUserPassword")
      .mockResolvedValue({} as any);

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => expect(screen.getByText("Riley Park")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    fireEvent.change(screen.getByLabelText(/New password/), {
      target: { value: "BrandNew456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save new password" }));

    await waitFor(() => expect(resetSpy).toHaveBeenCalledTimes(1));
    expect(resetSpy).toHaveBeenCalledWith("brow-beauty-lab", "u1", {
      newPassword: "BrandNew456",
    });
  });

  it("surfaces backend errors from the Add user modal", async () => {
    vi.spyOn(platformApi, "listTenantUsers").mockResolvedValue({ users: [] } as any);
    vi.spyOn(platformApi, "createTenantUser").mockRejectedValue(
      new Error("email_already_registered"),
    );

    render(<StaffPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => expect(screen.getByText("Add user")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add user" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dup" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "dup@browbeautylab.test" },
    });
    fireEvent.change(screen.getByLabelText(/Initial password/), {
      target: { value: "TempPass123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/email_already_registered/),
    );
  });
});
