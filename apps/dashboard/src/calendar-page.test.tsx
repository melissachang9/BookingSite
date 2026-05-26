import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AvailabilityRequest, AvailabilityResponse, ServiceListResponse } from "@booking/shared-types";

import { CalendarPage, type CalendarPageApi } from "./calendar-page";

const serviceResponse: ServiceListResponse = {
  services: [
    {
      id: "service-1",
      tenantId: "tenant-1",
      createdAt: "2026-05-24T15:00:00.000Z",
      updatedAt: "2026-05-24T15:00:00.000Z",
      name: "Signature Facial",
      description: "A 60-minute facial.",
      durationMinutes: 60,
      priceCents: 10000,
      depositCents: 2500,
      isActive: true,
      imageUrl: null,
      imageAltText: null,
      locationIds: ["location-1"],
      formIds: [],
    },
  ],
};

const availabilityResponseWithSlot: AvailabilityResponse = {
  days: [],
  slots: [
    {
      startAt: "2026-05-25T17:00:00.000Z",
      endAt: "2026-05-25T18:00:00.000Z",
      providerId: "provider-1",
      providerName: "Jordan Rivera",
      locationId: "location-1",
    },
  ],
};

const emptyAvailabilityResponse: AvailabilityResponse = {
  days: [],
  slots: [],
};

describe("CalendarPage", () => {
  it("keeps the manual booking drawer anchored to the selected slot", async () => {
    let availabilityCallCount = 0;
    const getAvailability = vi.fn(async (_request: AvailabilityRequest) => {
      availabilityCallCount += 1;
      return availabilityCallCount === 1 ? availabilityResponseWithSlot : emptyAvailabilityResponse;
    });

    const api: CalendarPageApi = {
      listServices: vi.fn().mockResolvedValue(serviceResponse),
      getAvailability,
    };

    render(
      <CalendarPage
        definition={{
          eyebrow: "Calendar-first booking",
          description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
        }}
        tenantSlug="brow-beauty-lab"
        api={api}
      />,
    );

    expect(await screen.findByText("Provider week")).toBeInTheDocument();
    expect(screen.getByLabelText("Customer")).toHaveValue("Choose a slot first");
    expect(screen.getByLabelText("Provider")).toHaveValue("Choose a slot");

    fireEvent.click(await screen.findByRole("button", { name: /Jordan Rivera/i }));

    expect(screen.getByLabelText("Customer")).toHaveValue("Search existing customer");
    expect(screen.getByLabelText("Service")).toHaveValue("Signature Facial");
    expect(screen.getByLabelText("Provider")).toHaveValue("Jordan Rivera");
    expect(screen.getByText(/hold creation stay anchored to this opening/i)).toBeInTheDocument();
  });
});