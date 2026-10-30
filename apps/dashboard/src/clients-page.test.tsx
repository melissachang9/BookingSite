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

describe("CustomersPage followed-up bookings", () => {
  it("keeps who followed up and their note on the client's profile", async () => {
    vi.spyOn(platformApi, "getCustomerProfile").mockResolvedValue({
      ...profileResponse,
      bookingAttempts: [
        {
          id: "a9",
          outcome: "financing_started",
          serviceName: "Signature Facial",
          providerName: "Maya",
          startsAt: "2026-06-02T17:00:00.000Z",
          createdAt: "2026-05-25T18:00:00.000Z",
          financingStartedAt: "2026-05-25T18:05:00.000Z",
          bookedSince: false,
          bookingMethod: "public_online",
          followUpAt: "2026-05-26T15:00:00.000Z",
          followUpByName: "Owner",
          followUpNote: "Left a voicemail",
        },
      ],
    });

    render(<CustomersPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => expect(screen.getByText("Taylor Guest")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Taylor Guest/ }));

    const section = await screen.findByRole("region", { name: "Unfinished bookings" });
    expect(section).toHaveTextContent("Followed up");
    expect(section).toHaveTextContent("by Owner: Left a voicemail");
    expect(section).not.toHaveTextContent("Follow up:");
  });
});

describe("CustomersPage aged-out bookings", () => {
  it("marks an unfinished booking past the follow-up window as aged out, not as needing follow-up", async () => {
    vi.spyOn(platformApi, "getCustomerProfile").mockResolvedValue({
      ...profileResponse,
      bookingAttempts: [
        {
          id: "old",
          outcome: "financing_started",
          serviceName: "Signature Facial",
          providerName: "Maya",
          startsAt: "2026-04-02T17:00:00.000Z",
          createdAt: "2026-03-25T18:00:00.000Z",
          financingStartedAt: "2026-03-25T18:05:00.000Z",
          bookedSince: false,
          bookingMethod: "public_online",
          agedOut: true,
        },
      ],
    });

    render(<CustomersPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => expect(screen.getByText("Taylor Guest")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Taylor Guest/ }));

    const section = await screen.findByRole("region", { name: "Unfinished bookings" });
    expect(section).toHaveTextContent("Aged out");
    expect(section).toHaveTextContent("past the 30-day follow-up window");
    expect(section).not.toHaveTextContent("Follow up:");
  });
});

describe("CustomersPage removed-from-follow-up bookings", () => {
  it("shows the reason a booking was removed from the follow-up list", async () => {
    vi.spyOn(platformApi, "getCustomerProfile").mockResolvedValue({
      ...profileResponse,
      bookingAttempts: [
        {
          id: "gone",
          outcome: "abandoned",
          serviceName: "Signature Facial",
          providerName: "Maya",
          startsAt: "2026-06-02T17:00:00.000Z",
          createdAt: "2026-05-25T18:00:00.000Z",
          bookedSince: false,
          bookingMethod: "public_online",
          dismissedAt: "2026-05-26T15:00:00.000Z",
          dismissedReason: "not_interested",
          dismissedByName: "Owner",
          dismissedNote: "Said no on the phone",
        },
      ],
    });

    render(<CustomersPage definition={definition} currentUser={ownerUser} />);
    await waitFor(() => expect(screen.getByText("Taylor Guest")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Taylor Guest/ }));

    const section = await screen.findByRole("region", { name: "Unfinished bookings" });
    expect(section).toHaveTextContent("Removed");
    expect(section).toHaveTextContent("removed from follow-up by Owner (Not interested): Said no on the phone");
    expect(section).not.toHaveTextContent("Follow up:");
  });
});
