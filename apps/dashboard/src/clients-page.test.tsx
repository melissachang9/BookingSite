import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthenticatedUser,
  BookingFormResponseList,
  CustomerListResponse,
  CustomerProfileResponse,
} from "@booking/shared-types";

import { CustomersPage } from "./clients-page";
import { platformApi } from "./platform-api";

const definition = {
  title: "Customers",
  eyebrow: "Profiles",
  description: "Customer history and profiles.",
};

const ownerUser: AuthenticatedUser = {
  id: "user-1",
  tenantId: "tenant-1",
  tenantSlug: "brow-beauty-lab",
  email: "owner@browbeautylab.test",
  name: "Melissa Chang",
  role: "owner",
  permissions: [{ key: "customers.view", allowed: true }],
};

const customerList: CustomerListResponse = {
  items: [
    {
      id: "cust-1",
      tenantId: "tenant-1",
      name: "Taylor Guest",
      email: "taylor@example.com",
      phone: null,
      notes: null,
      acquiredAt: null,
      sourceChannel: null,
      ownerUserId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  meta: { limit: 25, offset: 0, total: 1 },
};

const profileResponse: CustomerProfileResponse = {
  customer: customerList.items[0],
  bookings: [],
  payments: [],
  lifetimeSpendCents: 0,
  outstandingBalanceCents: 0,
};

const formResponses: BookingFormResponseList = {
  items: [
    {
      id: "form-response-1",
      formId: "form-1",
      formVersionId: "form-version-1",
      formName: "Brow Prep Check-In",
      formVersionNumber: 1,
      scope: "customer",
      customerPromptTiming: "pre_booking",
      submittedAt: "2026-05-25T18:30:00.000Z",
      answers: {
        recentRetinoidUse: true,
        skinSensitivityNotes: "Mild redness after exfoliation.",
      },
      schema: {
        title: "Brow Prep Check-In",
        fields: [
          { id: "recentRetinoidUse", type: "yes_no", label: "Recent retinoid use" },
          { id: "skinSensitivityNotes", type: "long_text", label: "Skin sensitivity notes" },
        ],
      },
    },
  ],
};

function mockLoaders() {
  vi.spyOn(platformApi, "listCustomers").mockResolvedValue(customerList);
  vi.spyOn(platformApi, "getCustomerProfile").mockResolvedValue(profileResponse);
  vi.spyOn(platformApi, "listCustomerFormResponses").mockResolvedValue(formResponses);
  vi.spyOn(platformApi, "listBookingAttempts").mockResolvedValue({ items: [] });
}

beforeEach(() => {
  mockLoaders();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CustomersPage form responses", () => {
  it("renders compact form rows and expands to show answers when toggled", async () => {
    render(<CustomersPage definition={definition} currentUser={ownerUser} />);

    // Wait for the customer list to load and click into the profile
    await waitFor(() => {
      expect(screen.getByText("Taylor Guest")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Taylor Guest/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Forms" }));

    // Form responses load - compact row shows the form name + meta + toggle
    expect(await screen.findByText("Brow Prep Check-In")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "View answers" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Answers should not yet be visible
    expect(screen.queryByText("Recent retinoid use")).not.toBeInTheDocument();

    // Expand
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide answers" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // Viewer now renders the answers
    expect(screen.getByText("Recent retinoid use")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("Skin sensitivity notes")).toBeInTheDocument();
    expect(screen.getByText("Mild redness after exfoliation.")).toBeInTheDocument();

    // Collapse again
    fireEvent.click(screen.getByRole("button", { name: "Hide answers" }));
    expect(screen.queryByText("Recent retinoid use")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View answers" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("shows the empty state when the customer has no form responses", async () => {
    vi.spyOn(platformApi, "listCustomerFormResponses").mockResolvedValue({ items: [] });

    render(<CustomersPage definition={definition} currentUser={ownerUser} />);

    await waitFor(() => {
      expect(screen.getByText("Taylor Guest")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Taylor Guest/ }));
    fireEvent.click(screen.getByRole("tab", { name: "Forms" }));

    expect(await screen.findByText("No form responses yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View answers" })).not.toBeInTheDocument();
  });
});

describe("CustomersPage unfinished bookings", () => {
  const attempt = {
    serviceName: "Signature Facial",
    providerName: "Maya",
    startsAt: "2026-06-02T17:00:00.000Z",
    createdAt: "2026-05-25T18:00:00.000Z",
    bookedSince: false,
    bookingMethod: "public_online",
  };

  it("flags clients who opened financing or abandoned checkout for follow-up", async () => {
    vi.spyOn(platformApi, "getCustomerProfile").mockResolvedValue({
      ...profileResponse,
      bookingAttempts: [
        { ...attempt, id: "a1", outcome: "financing_started", financingStartedAt: "2026-05-25T18:05:00.000Z" },
        { ...attempt, id: "a2", outcome: "abandoned", serviceName: "Brow Shape" },
      ],
    });

    render(<CustomersPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => expect(screen.getByText("Taylor Guest")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Taylor Guest/ }));

    const section = await screen.findByRole("region", { name: "Unfinished bookings" });
    expect(section).toHaveTextContent("Signature Facial");
    expect(section).toHaveTextContent("Follow up: opened financing");
    expect(section).toHaveTextContent("opened financing");
    expect(section).toHaveTextContent("Brow Shape");
    expect(section).toHaveTextContent("Follow up: abandoned");
    // Still shows although the client has no confirmed bookings at all.
    expect(screen.queryByText("No bookings yet.")).not.toBeInTheDocument();
  });

  it("stops asking for follow-up once the client has booked since", async () => {
    vi.spyOn(platformApi, "getCustomerProfile").mockResolvedValue({
      ...profileResponse,
      bookingAttempts: [{ ...attempt, id: "a3", outcome: "financing_started", bookedSince: true }],
    });

    render(<CustomersPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => expect(screen.getByText("Taylor Guest")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Taylor Guest/ }));

    const section = await screen.findByRole("region", { name: "Unfinished bookings" });
    expect(section).toHaveTextContent("Booked since");
    expect(section).not.toHaveTextContent("Follow up");
  });

  it("shows no section for a client with nothing unfinished", async () => {
    render(<CustomersPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => expect(screen.getByText("Taylor Guest")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Taylor Guest/ }));
    expect(await screen.findByText("No bookings yet.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Unfinished bookings" })).not.toBeInTheDocument();
  });
});

describe("CustomersPage follow up tab", () => {
  const lead = {
    outcome: "abandoned" as const,
    serviceName: "Signature Facial",
    providerName: "Maya",
    startsAt: "2026-06-02T17:00:00.000Z",
    createdAt: "2026-05-25T18:00:00.000Z",
    bookedSince: false,
    bookingMethod: "public_online",
    customerId: "customer-1",
    customerEmail: "pat@example.com",
    customerPhone: "6045550101",
  };
  const cold = { ...lead, id: "cold", customerName: "Cold Cart" };
  const warm = {
    ...lead,
    id: "warm",
    outcome: "financing_started" as const,
    customerName: "Warm Lead",
    financingStartedAt: "2026-05-25T18:05:00.000Z",
  };

  const managerUser: AuthenticatedUser = {
    ...ownerUser,
    permissions: [
      { key: "customers.view", allowed: true },
      { key: "customers.manage", allowed: true },
    ],
  };

  async function openFollowUp(currentUser: AuthenticatedUser = managerUser) {
    render(<CustomersPage definition={definition} currentUser={currentUser} />);
    await waitFor(() => expect(screen.getByText("Taylor Guest")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /Follow up/ }));
  }

  it("lists clients who opened financing and clients who abandoned, with counts and filters", async () => {
    vi.spyOn(platformApi, "listBookingAttempts").mockResolvedValue({ items: [warm, cold] });
    await openFollowUp();

    const list = await screen.findByRole("region", { name: "Follow up" });
    expect(list).toHaveTextContent("Warm Lead");
    expect(list).toHaveTextContent("Opened financing");
    expect(list).toHaveTextContent("opened financing May 25");
    expect(list).toHaveTextContent("Cold Cart");
    expect(list).toHaveTextContent("6045550101 · pat@example.com");
    expect(screen.getByRole("button", { name: "All · 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Opened financing · 1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Abandoned · 1" }));
    expect(screen.queryByText("Warm Lead")).not.toBeInTheDocument();
    expect(screen.getByText("Cold Cart")).toBeInTheDocument();
  });

  it("marks a client as followed up with a note and moves them out of the open list", async () => {
    vi.spyOn(platformApi, "listBookingAttempts").mockResolvedValue({ items: [warm] });
    const mark = vi.spyOn(platformApi, "markBookingAttemptFollowedUp").mockResolvedValue({
      ...warm,
      followUpAt: "2026-05-26T15:00:00.000Z",
      followUpByName: "Owner",
      followUpNote: "Left a voicemail",
    });
    await openFollowUp();

    fireEvent.click(await screen.findByRole("button", { name: "Mark followed up" }));
    fireEvent.change(screen.getByLabelText("Follow-up note for Warm Lead"), { target: { value: "Left a voicemail" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mark).toHaveBeenCalledWith("brow-beauty-lab", "warm", { note: "Left a voicemail" }));
    await waitFor(() => expect(screen.queryByText("Warm Lead")).not.toBeInTheDocument());
    expect(screen.getByText("Nobody is waiting for a follow-up.")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Show followed up"));
    expect(screen.getByText(/Followed up May 26.*by Owner: Left a voicemail/)).toBeInTheDocument();
  });

  it("hides the follow-up action from staff who can't manage clients", async () => {
    vi.spyOn(platformApi, "listBookingAttempts").mockResolvedValue({ items: [warm] });
    await openFollowUp(ownerUser);
    expect(await screen.findByText("Warm Lead")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark followed up" })).not.toBeInTheDocument();
  });
});
