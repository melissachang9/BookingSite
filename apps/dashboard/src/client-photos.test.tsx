import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientPhoto } from "@booking/shared-types";

import { ClientPhotos } from "./client-photos";
import { platformApi } from "./platform-api";

function photo(overrides: Partial<ClientPhoto> = {}): ClientPhoto {
  return {
    id: "photo-1",
    customerId: "customer-1",
    kind: "before",
    caption: "Day one",
    mimeType: "image/png",
    fileSizeBytes: 100,
    uploadedByName: "Melissa Chang",
    createdAt: "2026-06-01T15:00:00.000Z",
    ...overrides,
  };
}

const props = { tenantSlug: "brow-beauty-lab", customerId: "customer-1", canView: true, canManage: true };

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:photo");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(platformApi, "getClientPhotoFile").mockResolvedValue(new Blob(["x"], { type: "image/png" }));
});

afterEach(() => vi.restoreAllMocks());

function stubList(items: ClientPhoto[], custom: string[] = []) {
  vi.spyOn(platformApi, "listPhotoCategories").mockResolvedValue({ custom });
  return vi.spyOn(platformApi, "listClientPhotos").mockResolvedValue({ items });
}

describe("ClientPhotos", () => {
  it("explains missing permission without calling the API", () => {
    const list = stubList([]);
    render(<ClientPhotos {...props} canView={false} canManage={false} />);
    expect(screen.getByText(/don’t have permission/)).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it("shows an empty state and the upload controls for people who can manage", async () => {
    stubList([]);
    render(<ClientPhotos {...props} />);
    expect(await screen.findByText(/No photos yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add photos" })).toBeInTheDocument();
  });

  it("hides the upload controls for view-only users", async () => {
    stubList([photo()]);
    render(<ClientPhotos {...props} canManage={false} />);
    expect(await screen.findByRole("button", { name: /Open Before photo: Day one/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add photos" })).not.toBeInTheDocument();
  });

  it("surfaces a load failure", async () => {
    vi.spyOn(platformApi, "listClientPhotos").mockRejectedValue(new Error("Server unavailable"));
    render(<ClientPhotos {...props} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Server unavailable");
  });

  it("filters photos by type", async () => {
    stubList([photo(), photo({ id: "photo-2", kind: "after", caption: "Healed" })]);
    render(<ClientPhotos {...props} />);

    expect(await screen.findByRole("button", { name: /Open After photo/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Before (1)" }));
    expect(screen.getByRole("button", { name: /Open Before photo/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open After photo/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Other (0)" }));
    expect(screen.getByText("No other photos.")).toBeInTheDocument();
  });

  it("shows only an Add photos button until files are picked, then asks for type and caption", async () => {
    stubList([]);
    render(<ClientPhotos {...props} />);
    await screen.findByText(/No photos yet/);

    expect(screen.queryByRole("radiogroup", { name: "Photo type" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("photo-file-input"), { target: { files: [new File(["img"], "a.png", { type: "image/png" })] } });
    expect(screen.getByRole("radiogroup", { name: "Photo type" })).toBeInTheDocument();
    expect(screen.getByText("a.png")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("radiogroup", { name: "Photo type" })).not.toBeInTheDocument();
  });

  it("uploads each chosen file with its type, caption and visit, refreshes, and collapses the form", async () => {
    const list = stubList([]);
    const upload = vi.spyOn(platformApi, "uploadClientPhoto").mockResolvedValue(photo());
    render(<ClientPhotos {...props} bookingId="booking-9" />);
    await screen.findByText(/No photos yet/);

    const file = new File(["img"], "a.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("photo-file-input"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("radio", { name: "After" }));
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Week two" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload photo" }));

    await waitFor(() =>
      expect(upload).toHaveBeenCalledWith("brow-beauty-lab", "customer-1", file, {
        kind: "after",
        caption: "Week two",
        bookingId: "booking-9",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Added 1 photo.");
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("radiogroup", { name: "Photo type" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument();
  });

  it("still uploads when the browser empties the file list after the input is cleared", async () => {
    const list = stubList([]);
    const upload = vi.spyOn(platformApi, "uploadClientPhoto").mockResolvedValue(photo());
    render(<ClientPhotos {...props} />);
    await screen.findByText(/No photos yet/);

    // A real FileList is live: clearing the input's value empties it.
    const file = new File(["img"], "a.png", { type: "image/png" });
    const liveFiles = { 0: file, length: 1, item: () => file } as unknown as FileList;
    const input = screen.getByTestId("photo-file-input") as HTMLInputElement;
    Object.defineProperty(input, "value", {
      get: () => "",
      set: () => {
        (liveFiles as unknown as { length: number }).length = 0;
      },
    });
    fireEvent.change(input, { target: { files: liveFiles } });
    fireEvent.click(screen.getByRole("button", { name: "Upload photo" }));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("lets people make their own category with an editable pill and uses it for the upload", async () => {
    stubList([], ["Progress"]);
    const upload = vi.spyOn(platformApi, "uploadClientPhoto").mockResolvedValue(photo({ kind: "Touch up" }));
    render(<ClientPhotos {...props} />);
    await screen.findByText(/No photos yet/);

    const file = new File(["img"], "a.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("photo-file-input"), { target: { files: [file] } });
    // Categories the business already made up are offered alongside the built-ins.
    expect(screen.getByRole("radio", { name: "Progress" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ Add category" }));
    const input = screen.getByLabelText("New category name");
    fireEvent.change(input, { target: { value: "  Touch   up " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole("radio", { name: "Touch up" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "+ Add category" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Upload photo" }));
    await waitFor(() =>
      expect(upload).toHaveBeenCalledWith("brow-beauty-lab", "customer-1", file, expect.objectContaining({ kind: "Touch up" })),
    );
  });

  it("cancels a new category on Escape or when left empty", async () => {
    stubList([]);
    render(<ClientPhotos {...props} />);
    await screen.findByText(/No photos yet/);
    fireEvent.change(screen.getByTestId("photo-file-input"), { target: { files: [new File(["x"], "a.png", { type: "image/png" })] } });

    fireEvent.click(screen.getByRole("button", { name: "+ Add category" }));
    fireEvent.change(screen.getByLabelText("New category name"), { target: { value: "Nope" } });
    fireEvent.keyDown(screen.getByLabelText("New category name"), { key: "Escape" });
    expect(screen.queryByRole("radio", { name: "Nope" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ Add category" }));
    fireEvent.blur(screen.getByLabelText("New category name"));
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("filters by a custom category and keeps its spelling", async () => {
    stubList([photo({ kind: "Progress", caption: null }), photo({ id: "photo-2", kind: "before" })]);
    render(<ClientPhotos {...props} />);

    fireEvent.click(await screen.findByRole("button", { name: "Progress (1)" }));
    expect(screen.getByRole("button", { name: /Open Progress photo/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open Before photo/ })).not.toBeInTheDocument();
  });

  it("keeps only the files that failed so they can be retried", async () => {
    stubList([]);
    vi.spyOn(platformApi, "uploadClientPhoto").mockRejectedValue(new Error("Unsupported file type."));
    render(<ClientPhotos {...props} />);
    await screen.findByText(/No photos yet/);

    fireEvent.change(screen.getByTestId("photo-file-input"), { target: { files: [new File(["x"], "scan.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload photo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("scan.pdf: Unsupported file type.");
    expect(screen.getByText("scan.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeEnabled();
  });

  it("edits a caption and type from the viewer", async () => {
    stubList([photo()]);
    const update = vi.spyOn(platformApi, "updateClientPhoto").mockResolvedValue(photo({ caption: "Healed", kind: "after" }));
    render(<ClientPhotos {...props} />);

    fireEvent.click(await screen.findByRole("button", { name: /Open Before photo/ }));
    const viewer = screen.getByRole("dialog", { name: "Photo" });
    const save = within(viewer).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    fireEvent.click(within(viewer).getByRole("radio", { name: "After" }));
    fireEvent.change(within(viewer).getByLabelText("Notes"), { target: { value: "Healed" } });
    fireEvent.click(save);

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("brow-beauty-lab", "customer-1", "photo-1", { kind: "after", caption: "Healed" }),
    );
    // Saving closes the viewer.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Photo" })).not.toBeInTheDocument());
  });

  it("asks before removing a photo", async () => {
    stubList([photo()]);
    const remove = vi.spyOn(platformApi, "deleteClientPhoto").mockResolvedValue(undefined);
    render(<ClientPhotos {...props} />);

    fireEvent.click(await screen.findByRole("button", { name: /Open Before photo/ }));
    const viewer = screen.getByRole("dialog", { name: "Photo" });
    fireEvent.click(within(viewer).getByRole("button", { name: "Remove photo" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(viewer).getByRole("button", { name: "Keep" }));
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(within(viewer).getByRole("button", { name: "Remove photo" }));
    fireEvent.click(within(viewer).getByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("brow-beauty-lab", "customer-1", "photo-1"));
  });

  it("shows view-only users the photo and caption without editing controls", async () => {
    stubList([photo()]);
    render(<ClientPhotos {...props} canManage={false} />);

    fireEvent.click(await screen.findByRole("button", { name: /Open Before photo/ }));
    const viewer = screen.getByRole("dialog", { name: "Photo" });
    expect(within(viewer).getByText("Day one")).toBeInTheDocument();
    expect(within(viewer).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(within(viewer).queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
  });
});
