import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedUser, FormSummaryResponse } from "@booking/shared-types";

import { FormsPage } from "./forms-page";
import { platformApi } from "./platform-api";

const definition = { title: "Forms", eyebrow: "Unified forms", description: "Forms." };

function userWith(keys: string[]): AuthenticatedUser {
  return {
    id: "user-1",
    tenantId: "tenant-1",
    tenantSlug: "brow-beauty-lab",
    email: "owner@browbeautylab.test",
    name: "Owner",
    role: "owner",
    permissions: keys.map((key) => ({ key, allowed: true })) as AuthenticatedUser["permissions"],
  };
}

const consentForm = {
  id: "form-1",
  tenantId: "tenant-1",
  name: "Laser consent",
  category: "Laser & peels",
  scope: "customer",
  customerPromptTiming: null,
  reviewRequired: false,
  isActive: true,
  appliesToAllServices: true,
  currentVersionNumber: 3,
  serviceIds: [],
  schema: {
    title: "Laser consent",
    fields: [
      { id: "f1", type: "yes_no", label: "Are you pregnant?", required: true },
      { id: "f2", type: "long_text", label: "List medications", required: false },
    ],
  },
} as unknown as FormSummaryResponse;

beforeEach(() => {
  vi.spyOn(platformApi, "listForms").mockResolvedValue({ items: [consentForm] });
  vi.spyOn(platformApi, "listServices").mockResolvedValue({ services: [] } as never);
  vi.spyOn(platformApi, "listServiceCategories").mockResolvedValue({ categories: [] } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FormsPage", () => {
  it("lists forms and shows the details questions for the selected form", async () => {
    render(<FormsPage definition={definition} currentUser={userWith(["settings.view", "settings.manage"])} />);

    fireEvent.click(await screen.findByRole("button", { name: /Laser consent/ }));

    expect(await screen.findByRole("heading", { name: "Laser consent" })).toBeInTheDocument();
    expect(screen.getByText("Version 3")).toBeInTheDocument();
    expect(screen.getByText("Who fills out this form?")).toBeInTheDocument();
    expect(screen.getByText("Does this form require review?")).toBeInTheDocument();
  });

  it("saves changed details through the update endpoint", async () => {
    const update = vi
      .spyOn(platformApi, "updateForm")
      .mockResolvedValue({ ...consentForm, reviewRequired: true } as FormSummaryResponse);
    render(<FormsPage definition={definition} currentUser={userWith(["settings.view", "settings.manage"])} />);

    fireEvent.click(await screen.findByRole("button", { name: /Laser consent/ }));
    fireEvent.click(await screen.findByLabelText(/Review required/));
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        "brow-beauty-lab",
        "form-1",
        expect.objectContaining({ reviewRequired: true, scope: "customer" }),
      ),
    );
  });

  it("hides management controls without the manage permission", async () => {
    render(<FormsPage definition={definition} currentUser={userWith(["settings.view"])} />);

    fireEvent.click(await screen.findByRole("button", { name: /Laser consent/ }));
    await screen.findByRole("heading", { name: "Laser consent" });

    expect(screen.queryByRole("button", { name: /Build form/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save details" })).not.toBeInTheDocument();
  });

  it("edits a field inline and keeps required toggle in the saved schema", async () => {
    const update = vi.spyOn(platformApi, "updateForm").mockResolvedValue(consentForm);
    render(<FormsPage definition={definition} currentUser={userWith(["settings.view", "settings.manage"])} />);

    fireEvent.click(await screen.findByRole("button", { name: /Laser consent/ }));
    fireEvent.click(await screen.findByRole("tab", { name: "Form Fields" }));
    fireEvent.click(screen.getByRole("button", { name: /List medications/ }));

    expect(screen.getByText("Editing field 2 of 2")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Question label"), { target: { value: "List all medications" } });
    fireEvent.click(screen.getByRole("button", { name: "Save fields" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    const body = update.mock.calls[0]![2] as { schema: { fields: Array<{ label: string }> } };
    expect(body.schema.fields[1]!.label).toBe("List all medications");
  });

  it("opens the full-page builder with numbered steps and a disabled fields step", async () => {
    render(<FormsPage definition={definition} currentUser={userWith(["settings.view", "settings.manage"])} />);

    fireEvent.click(await screen.findByRole("button", { name: /Build form/ }));

    expect(screen.getByText("New form")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "1 · Details" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /2 · Form Fields — create form first/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create form" })).toBeDisabled();
  });

  it("moves to the fields step after creating a form, then closes on the next save", async () => {
    const created = { ...consentForm, id: "form-2", name: "Photo release" } as FormSummaryResponse;
    const create = vi.spyOn(platformApi, "createForm").mockResolvedValue(created);
    const update = vi.spyOn(platformApi, "updateForm").mockResolvedValue(created);
    render(<FormsPage definition={definition} currentUser={userWith(["settings.view", "settings.manage"])} />);

    fireEvent.click(await screen.findByRole("button", { name: /Build form/ }));
    fireEvent.change(screen.getByLabelText(/Form name/), { target: { value: "Photo release" } });
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: "Intake" } });
    fireEvent.click(screen.getByRole("button", { name: "Create form" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        "brow-beauty-lab",
        expect.objectContaining({ name: "Photo release", category: "Intake" }),
      ),
    );
    expect(await screen.findByRole("tab", { name: "2 · Form Fields" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save fields" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(await screen.findByRole("heading", { name: "Forms" })).toBeInTheDocument();
    expect(screen.queryByText("New form")).not.toBeInTheDocument();
  });

  it("lets staff change the category of an existing form with existing categories suggested", async () => {
    const update = vi.spyOn(platformApi, "updateForm").mockResolvedValue(consentForm);
    const { container } = render(
      <FormsPage definition={definition} currentUser={userWith(["settings.view", "settings.manage"])} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Laser consent/ }));
    const input = await screen.findByLabelText(/^Category(?! filter)/);
    fireEvent.focus(input);
    const menu = await screen.findByRole("listbox");
    expect(within(menu).getByRole("option", { name: "Laser & peels" })).toBeInTheDocument();
    expect(container.querySelector("datalist")).toBeNull();

    fireEvent.change(input, { target: { value: "Skin" } });
    fireEvent.click(within(menu).getByRole("button", { name: /Use new category/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("brow-beauty-lab", "form-1", expect.objectContaining({ category: "Skin" })),
    );
  });
});
