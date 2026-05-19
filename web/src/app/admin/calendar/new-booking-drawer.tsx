"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  deriveCalendarDrawerState,
  type LocationOption,
  type ProviderOption,
  type ServiceOption,
} from "./booking-drawer-state";
import type { CreateCalendarBookingState } from "./create-booking-state";
import { createCalendarBookingAction } from "./actions";

const initialCreateCalendarBookingState: CreateCalendarBookingState = {};

export function CalendarBookingDrawer({
  initialStartsAtLocal,
  initialProviderId,
  initialCustomerId,
  autoOpen = false,
  providers,
  services,
  locations,
  customers,
}: {
  initialStartsAtLocal: string;
  initialProviderId: string | null;
  initialCustomerId?: string | null;
  autoOpen?: boolean;
  providers: ProviderOption[];
  services: ServiceOption[];
  locations: LocationOption[];
  customers: { id: string; name: string; email: string; phone: string | null }[];
}) {
  const initialProvider = providers.find((provider) => provider.id === initialProviderId) ?? null;
  const initialCustomer = customers.find((customer) => customer.id === initialCustomerId) ?? null;
  const [open, setOpen] = useState(autoOpen);
  const [state, formAction, pending] = useActionState(
    createCalendarBookingAction,
    initialCreateCalendarBookingState
  );
  const formRef = useRef<HTMLFormElement>(null);
  const modeRef = useRef<HTMLInputElement>(null);
  const [startLocal, setStartLocal] = useState(initialStartsAtLocal);
  const [locationId, setLocationId] = useState(initialProvider?.locationIds[0] ?? locations[0]?.id ?? "");
  const [providerId, setProviderId] = useState(initialProviderId ?? "");
  const [serviceId, setServiceId] = useState("");
  const [pendingMode, setPendingMode] = useState<"confirm" | "checkout">("confirm");
  const [customerQuery, setCustomerQuery] = useState(
    initialCustomer ? `${initialCustomer.name} · ${initialCustomer.email}` : ""
  );
  const [customerName, setCustomerName] = useState(initialCustomer?.name ?? "");
  const [customerEmail, setCustomerEmail] = useState(initialCustomer?.email ?? "");
  const [customerPhone, setCustomerPhone] = useState(initialCustomer?.phone ?? "");

  const {
    providerOptions,
    providerValue,
    serviceOptions,
    serviceValue,
    selectedService,
    startsAtIso,
    durationMinutes,
    priceCents,
    depositCents,
    canSubmit,
    canOpenCheckout,
    setupComplete,
  } = deriveCalendarDrawerState({
    providers,
    services,
    locations,
    locationId,
    providerId,
    serviceId,
    startLocal,
  });
  const endsAtPreview =
    startsAtIso && durationMinutes > 0
      ? new Date(new Date(startsAtIso).getTime() + durationMinutes * 60_000).toLocaleString()
      : "-";
  const normalizedQuery = customerQuery.trim().toLowerCase();
  const matchingCustomers =
    normalizedQuery.length === 0
      ? customers.slice(0, 8)
      : customers
          .filter((customer) => {
            const haystack = `${customer.name} ${customer.email} ${customer.phone ?? ""}`.toLowerCase();
            return haystack.includes(normalizedQuery);
          })
          .slice(0, 8);

  useEffect(() => {
    if (state.checkoutUrl) {
      window.location.assign(state.checkoutUrl);
    }
  }, [state.checkoutUrl]);

  function submitAs(mode: "confirm" | "checkout") {
    if (!formRef.current || !modeRef.current) return;
    setPendingMode(mode);
    modeRef.current.value = mode;
    formRef.current.requestSubmit();
  }

  function selectExistingCustomer(customerId: string) {
    const selectedCustomer = customers.find((customer) => customer.id === customerId);
    if (!selectedCustomer) return;
    setCustomerName(selectedCustomer.name);
    setCustomerEmail(selectedCustomer.email);
    setCustomerPhone(selectedCustomer.phone ?? "");
    setCustomerQuery(`${selectedCustomer.name} · ${selectedCustomer.email}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!setupComplete}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        New booking
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close booking drawer"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/25"
          />
          <div className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto border-l border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-800 dark:bg-neutral-950">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Create booking</h2>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  Save a confirmed staff-entered appointment from the calendar. Payment can be handled later.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Close
              </button>
            </div>

            {!setupComplete ? (
              <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                Add at least one active location, provider, and service before creating bookings from the calendar.
              </div>
            ) : null}

            <form ref={formRef} action={formAction} className="mt-5 space-y-4">
              <input type="hidden" name="startsAt" value={startsAtIso} />
              <input ref={modeRef} type="hidden" name="mode" value="confirm" />

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-neutral-700 dark:text-neutral-300">Location</span>
                  <select
                    name="locationId"
                    value={locationId}
                    onChange={(event) => setLocationId(event.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                  >
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="text-neutral-700 dark:text-neutral-300">Start time</span>
                  <input
                    type="datetime-local"
                    value={startLocal}
                    onChange={(event) => setStartLocal(event.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-neutral-700 dark:text-neutral-300">Provider</span>
                  <select
                    name="providerId"
                    value={providerValue}
                    onChange={(event) => setProviderId(event.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                  >
                    <option value="">Select provider</option>
                    {providerOptions.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="text-neutral-700 dark:text-neutral-300">Service</span>
                  <select
                    name="serviceId"
                    value={serviceValue}
                    onChange={(event) => setServiceId(event.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                  >
                    <option value="">Select service</option>
                    {serviceOptions.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {selectedService ? (
                <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="font-medium text-neutral-900 dark:text-neutral-100">Booking summary</div>
                  <div className="mt-2 grid gap-2 text-neutral-600 dark:text-neutral-400 sm:grid-cols-2">
                    <div>Duration: {durationMinutes} min</div>
                    <div>Ends: {endsAtPreview}</div>
                    <div>Total: {formatMoney(priceCents)}</div>
                    <div>Deposit due: {formatMoney(depositCents)}</div>
                  </div>
                  {selectedService.requiresPreBookingForms ? (
                    <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                      This service has pre-booking forms, so the hosted checkout path stays disabled in this drawer for now.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-4 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                    Customer
                  </h3>
                  {initialCustomer ? (
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      Prefilled from the selected customer record for rebooking.
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
                  <label className="block text-sm">
                    <span className="text-neutral-700 dark:text-neutral-300">Find existing customer</span>
                    <input
                      type="text"
                      value={customerQuery}
                      onChange={(event) => setCustomerQuery(event.target.value)}
                      placeholder="Search by name, email, or phone"
                      className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-neutral-700 dark:text-neutral-300">Matches</span>
                    <select
                      value=""
                      onChange={(event) => {
                        selectExistingCustomer(event.target.value);
                        event.target.value = "";
                      }}
                      className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                    >
                      <option value="">Select customer to autofill</option>
                      {matchingCustomers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name} · {customer.email}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block text-sm">
                  <span className="text-neutral-700 dark:text-neutral-300">Full name</span>
                  <input
                    type="text"
                    name="customerName"
                    required
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-neutral-700 dark:text-neutral-300">Email</span>
                  <input
                    type="email"
                    name="customerEmail"
                    required
                    value={customerEmail}
                    onChange={(event) => setCustomerEmail(event.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-neutral-700 dark:text-neutral-300">Phone</span>
                  <input
                    type="tel"
                    name="customerPhone"
                    value={customerPhone}
                    onChange={(event) => setCustomerPhone(event.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-neutral-700 dark:text-neutral-300">Notes</span>
                  <textarea
                    name="notes"
                    rows={3}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                  />
                </label>
                <label className="flex items-start gap-3 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                  <input
                    type="checkbox"
                    name="confirmationRequested"
                    value="true"
                    defaultChecked
                    className="mt-0.5 h-4 w-4 rounded border-neutral-300 dark:border-neutral-700"
                  />
                  <span>
                    <span className="block font-medium text-neutral-900 dark:text-neutral-100">
                      Send confirmation email now
                    </span>
                    <span className="block text-neutral-500">
                      The booking is created either way. This only controls the initial confirmation delivery.
                    </span>
                  </span>
                </label>
              </div>

              {providerValue && providerOptions.length === 0 ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  No providers match the current service and location selection.
                </p>
              ) : null}
              {serviceValue && serviceOptions.length === 0 ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  No services match the current provider and location selection.
                </p>
              ) : null}

              {state.error ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}
              {state.success ? (
                <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <p>{state.success}</p>
                  {state.createdBookingId ? (
                    <Link href={`/admin/bookings/${state.createdBookingId}`} className="mt-2 inline-block font-medium underline">
                      View booking
                    </Link>
                  ) : state.checkoutUrl ? (
                    <a href={state.checkoutUrl} className="mt-2 inline-block font-medium underline">
                      Continue to checkout
                    </a>
                  ) : null}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => submitAs("confirm")}
                  disabled={pending || !canSubmit}
                  className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                >
                  {pending && pendingMode === "confirm" ? "Creating..." : "Create booking"}
                </button>
                <button
                  type="button"
                  onClick={() => submitAs("checkout")}
                  disabled={pending || !canOpenCheckout}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                >
                  {pending && pendingMode === "checkout"
                    ? "Opening checkout..."
                    : "Open checkout"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}