import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InternalFormOption, InternalFormResponseEntry } from "@booking/shared-types";

import { ClientInternalForms } from "./internal-forms";
import { platformApi } from "./platform-api";

const option: InternalFormOption = {
  id: "form-1",
  name: "Treatment note",
  description: "Private notes about this visit.",
  formVersionId: "version-1",
  versionNumber: 1,
  schema: {
    title: "Treatment note",
    fields: [
      { id: "formula", type: "short_text", label: "Formula used", required: true },
      { id: "reaction", type: "long_text", label: "Skin reaction" },
    ],
  },
};

const saved: InternalFormResponseEntry = {
  id: "response-1",
  formId: "form-1",
  formVersionId: "version-1",
  formName: "Treatment note",
  formVersionNumber: 1,
  scope: "internal",
  submittedAt: "2026-06-01T15:00:00.000Z",
  answers: { formula: "Brown 5N" },
  schema: option.schema,
  submittedByName: "Floor Staff",
};

function stubApi(items: InternalFormResponseEntry[] = []) {
  vi.spyOn(platformApi, "listCustomerInternalFormResponses").mockResolvedValue({ items });
  vi.spyOn(platformApi, "listInternalForms").mockResolvedValue({ items: [option] });
}

const props = { tenantSlug: "brow-beauty-lab", customerId: "customer-1" };

afterEach(() => vi.restoreAllMocks());

describe("ClientInternalForms", () => {
  it("renders nothing without either permission", () => {
    stubApi();
    const { container } = render(<ClientInternalForms {...props} canView={false} canSubmit={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists who filled in each form and hides the fill-in button without permission", async () => {
    stubApi([saved]);
    render(<ClientInternalForms {...props} canView canSubmit={false} />);

    expect(await screen.findByText("Treatment note")).toBeInTheDocument();
    expect(screen.getByText(/Floor Staff/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fill in a form" })).not.toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    stubApi([]);
    render(<ClientInternalForms {...props} canView canSubmit />);
    expect(await screen.findByText("No internal forms filled in yet.")).toBeInTheDocument();
  });

  it("surfaces a load failure", async () => {
    vi.spyOn(platformApi, "listCustomerInternalFormResponses").mockRejectedValue(new Error("Server unavailable"));
    render(<ClientInternalForms {...props} canView canSubmit />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Server unavailable");
  });

  it("requires required questions before saving", async () => {
    stubApi();
    const submit = vi.spyOn(platformApi, "submitInternalForm");
    render(<ClientInternalForms {...props} canView canSubmit />);

    fireEvent.click(await screen.findByRole("button", { name: "Fill in a form" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save form" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Formula used is required.");
    expect(submit).not.toHaveBeenCalled();
  });

  it("saves the answers and refreshes the list", async () => {
    stubApi();
    const submit = vi.spyOn(platformApi, "submitInternalForm").mockResolvedValue(saved);
    render(<ClientInternalForms {...props} canView canSubmit />);

    fireEvent.click(await screen.findByRole("button", { name: "Fill in a form" }));
    fireEvent.change(await screen.findByLabelText(/Formula used/), { target: { value: "Brown 5N" } });
    fireEvent.click(screen.getByRole("button", { name: "Save form" }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith("brow-beauty-lab", "customer-1", "form-1", { answers: { formula: "Brown 5N" } }),
    );
    await waitFor(() => expect(platformApi.listCustomerInternalFormResponses).toHaveBeenCalledTimes(2));
  });

  it("keeps the form open and shows the error when saving fails", async () => {
    stubApi();
    vi.spyOn(platformApi, "submitInternalForm").mockRejectedValue(new Error("This form is not active."));
    render(<ClientInternalForms {...props} canView canSubmit />);

    fireEvent.click(await screen.findByRole("button", { name: "Fill in a form" }));
    fireEvent.change(await screen.findByLabelText(/Formula used/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save form" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This form is not active.");
    expect(screen.getByRole("button", { name: "Save form" })).toBeEnabled();
  });

  it("explains when there are no internal forms to fill in", async () => {
    vi.spyOn(platformApi, "listCustomerInternalFormResponses").mockResolvedValue({ items: [] });
    vi.spyOn(platformApi, "listInternalForms").mockResolvedValue({ items: [] });
    render(<ClientInternalForms {...props} canView canSubmit />);

    fireEvent.click(await screen.findByRole("button", { name: "Fill in a form" }));
    expect(await screen.findByText(/no active internal forms/i)).toBeInTheDocument();
  });
});
