import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveCalendarDrawerState,
  type LocationOption,
  type ProviderOption,
  type ServiceOption,
} from "./booking-drawer-state";

const locations: LocationOption[] = [
  { id: "loc-1", name: "Main Studio" },
  { id: "loc-2", name: "Annex" },
];

const providers: ProviderOption[] = [
  {
    id: "prov-1",
    name: "Taylor",
    locationIds: ["loc-1"],
    serviceIds: ["svc-1", "svc-2"],
    serviceOverrides: {
      "svc-1": {
        priceCentsOverride: 15000,
        depositCentsOverride: 5000,
        durationMinutesOverride: 75,
      },
    },
  },
  {
    id: "prov-2",
    name: "Jordan",
    locationIds: ["loc-2"],
    serviceIds: ["svc-2"],
    serviceOverrides: {},
  },
];

const services: ServiceOption[] = [
  {
    id: "svc-1",
    name: "Custom Color",
    locationIds: ["loc-1"],
    priceCents: 12000,
    depositCents: 3000,
    durationMinutes: 60,
    requiresPreBookingForms: false,
  },
  {
    id: "svc-2",
    name: "Consultation",
    locationIds: ["loc-1", "loc-2"],
    priceCents: 0,
    depositCents: 0,
    durationMinutes: 30,
    requiresPreBookingForms: true,
  },
];

test("clears a stale provider selection when the chosen service no longer matches", () => {
  const state = deriveCalendarDrawerState({
    providers,
    services,
    locations,
    locationId: "loc-1",
    providerId: "prov-2",
    serviceId: "svc-1",
    startLocal: "2026-05-14T09:00",
  });

  assert.deepEqual(
    state.providerOptions.map((provider) => provider.id),
    ["prov-1"]
  );
  assert.equal(state.providerValue, "");
  assert.equal(state.canSubmit, false);
});

test("uses provider-specific overrides for the booking summary", () => {
  const state = deriveCalendarDrawerState({
    providers,
    services,
    locations,
    locationId: "loc-1",
    providerId: "prov-1",
    serviceId: "svc-1",
    startLocal: "2026-05-14T09:00",
  });

  assert.equal(state.durationMinutes, 75);
  assert.equal(state.priceCents, 15000);
  assert.equal(state.depositCents, 5000);
  assert.equal(state.canSubmit, true);
  assert.equal(state.canOpenCheckout, true);
});

test("blocks hosted checkout for services with pre-booking forms or zero price", () => {
  const state = deriveCalendarDrawerState({
    providers,
    services,
    locations,
    locationId: "loc-1",
    providerId: "prov-1",
    serviceId: "svc-2",
    startLocal: "2026-05-14T09:00",
  });

  assert.equal(state.canSubmit, true);
  assert.equal(state.canOpenCheckout, false);
});

test("treats an invalid local start time as not submittable", () => {
  const state = deriveCalendarDrawerState({
    providers,
    services,
    locations,
    locationId: "loc-1",
    providerId: "prov-1",
    serviceId: "svc-1",
    startLocal: "not-a-date",
  });

  assert.equal(state.startsAtIso, "");
  assert.equal(state.canSubmit, false);
  assert.equal(state.canOpenCheckout, false);
});