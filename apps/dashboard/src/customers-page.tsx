import { startTransition, useEffect, useState } from "react";
import type {
  AuthenticatedUser,
  BookingFormResponseEntry,
  BookingFormResponseList,
  CustomerBookingEntry,
  CustomerListResponse,
  CustomerProfileResponse,
  CustomerSummary,
} from "@booking/shared-types";

import { platformApi } from "./platform-api";
import { FormResponseViewer } from "./form-response-viewer";

type RouteDefinitionLike = {
  title: string;
  eyebrow: string;
  description: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

type ProfileState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; profile: CustomerProfileResponse }
  | { kind: "error"; message: string };

type FormResponsesState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; items: BookingFormResponseEntry[] }
  | { kind: "error"; message: string };

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some(
    (permission) => permission.key === key && permission.allowed,
  );
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatMoney(cents: number): string {
  return currencyFormatter.format(cents / 100);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${dateFormatter.format(date)} at ${timeFormatter.format(date)}`;
}

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "completed":
      return "Completed";
    case "canceled":
      return "Canceled";
    case "no_show":
      return "No-show";
    default:
      return status;
  }
}

export function CustomersPage({
  definition,
  currentUser,
}: {
  definition: RouteDefinitionLike;
  currentUser: AuthenticatedUser | null;
}) {
  const tenantSlug = currentUser?.tenantSlug ?? "";
  const canView =
    currentUser !== null && hasPermission(currentUser, "customers.view");

  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  );
  const [profileState, setProfileState] = useState<ProfileState>({
    kind: "idle",
  });
  const [formResponsesState, setFormResponsesState] = useState<FormResponsesState>({
    kind: "idle",
  });

  const loadCustomers = async (searchQuery?: string) => {
    try {
      const response: CustomerListResponse = await platformApi.listCustomers(
        tenantSlug,
        searchQuery || undefined,
      );
      startTransition(() => {
        setCustomers(response.items);
        setLoadState({ kind: "ready" });
      });
    } catch (error) {
      startTransition(() => {
        setLoadState({
          kind: "error",
          message: readErrorMessage(error, "Unable to load customers."),
        });
      });
    }
  };

  useEffect(() => {
    if (!canView || !tenantSlug) return;
    void loadCustomers();
  }, [tenantSlug, canView]);

  useEffect(() => {
    if (!canView || !tenantSlug || selectedCustomerId === null) {
      setProfileState({ kind: "idle" });
      return;
    }

    let cancelled = false;
    setProfileState({ kind: "loading" });

    platformApi
      .getCustomerProfile(tenantSlug, selectedCustomerId)
      .then((profile) => {
        if (cancelled) return;
        setProfileState({ kind: "ready", profile });
      })
      .catch((error) => {
        if (cancelled) return;
        setProfileState({
          kind: "error",
          message: readErrorMessage(error, "Unable to load customer profile."),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [tenantSlug, selectedCustomerId, canView]);

  useEffect(() => {
    if (!canView || !tenantSlug || selectedCustomerId === null) {
      setFormResponsesState({ kind: "idle" });
      return;
    }

    let cancelled = false;
    setFormResponsesState({ kind: "loading" });

    platformApi
      .listCustomerFormResponses(tenantSlug, selectedCustomerId)
      .then((response: BookingFormResponseList) => {
        if (cancelled) return;
        setFormResponsesState({ kind: "ready", items: response.items });
      })
      .catch((error) => {
        if (cancelled) return;
        setFormResponsesState({
          kind: "error",
          message: readErrorMessage(error, "Unable to load form responses."),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [tenantSlug, selectedCustomerId, canView]);

  const handleSearch = () => {
    void loadCustomers(search.trim() || undefined);
  };

  const selectedCustomer = customers.find(
    (c) => c.id === selectedCustomerId,
  ) ?? null;

  if (!currentUser) {
    return (
      <main className="ops-page-stack">
        <section className="ops-hero ops-hero--compact">
          <div className="ops-hero-copy">
            <h3>Sign in required</h3>
          </div>
        </section>
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="ops-page-stack">
        <section className="ops-hero ops-hero--compact">
          <div className="ops-hero-copy">
            <p className="eyebrow">{definition.eyebrow}</p>
            <h3>{definition.title}</h3>
            <p>You do not have permission to view customers.</p>
          </div>
        </section>
      </main>
    );
  }

  if (loadState.kind === "loading") {
    return (
      <main className="ops-page-stack">
        <section className="ops-hero ops-hero--compact">
          <div className="ops-hero-copy">
            <p className="eyebrow">{definition.eyebrow}</p>
            <h3>{definition.title}</h3>
          </div>
        </section>
      </main>
    );
  }

  if (loadState.kind === "error") {
    return (
      <main className="ops-page-stack">
        <section className="ops-hero ops-hero--compact">
          <div className="ops-hero-copy">
            <p className="eyebrow">{definition.eyebrow}</p>
            <h3>{definition.title}</h3>
            <p>{loadState.message}</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="ops-page-stack">
      <h3>{definition.title}</h3>

      <section className="staff-master-detail">
        <div className="staff-grid">
          <aside className="staff-list-rail" aria-label="Customer list">
            <div className="staff-list-rail-header">
              <h4>Customers</h4>
              <span className="services-category-count">{customers.length}</span>
            </div>
            <div className="customer-search-bar">
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSearch();
                }}
                placeholder="Search by name, email, or phone"
                aria-label="Search customers"
              />
              <button
                type="button"
                className="ghost-action"
                onClick={handleSearch}
              >
                Search
              </button>
            </div>
            {customers.length === 0 ? (
              <p className="staff-list-empty">No customers found.</p>
            ) : (
              <ul className="staff-list">
                {customers.map((customer) => (
                  <li key={customer.id}>
                    <button
                      type="button"
                      className={`staff-list-item${
                        selectedCustomerId === customer.id ? " is-active" : ""
                      }`}
                      onClick={() => setSelectedCustomerId(customer.id)}
                    >
                      <span
                        className="appointment-customer-avatar"
                        aria-hidden="true"
                      >
                        {initialsOf(customer.name)}
                      </span>
                      <div>
                        <strong>{customer.name}</strong>
                        {customer.email ? (
                          <span>{customer.email}</span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="staff-detail-panel" aria-label="Customer profile">
            {selectedCustomer ? (
              <CustomerProfilePanel
                customer={selectedCustomer}
                profileState={profileState}
                formResponsesState={formResponsesState}
              />
            ) : (
              <div className="staff-detail-empty">
                <p>Select a customer to view their profile and booking history.</p>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function CustomerProfilePanel({
  customer,
  profileState,
  formResponsesState,
}: {
  customer: CustomerSummary;
  profileState: ProfileState;
  formResponsesState: FormResponsesState;
}) {
  const [expandedFormIds, setExpandedFormIds] = useState<Set<string>>(new Set());

  const toggleFormExpand = (id: string) => {
    setExpandedFormIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  return (
    <div className="customer-profile">
      <header className="customer-profile-header">
        <span
          className="appointment-customer-avatar"
          aria-hidden="true"
          style={{ width: "3rem", height: "3rem", fontSize: "1rem" }}
        >
          {initialsOf(customer.name)}
        </span>
        <div>
          <h4>{customer.name}</h4>
          <p className="customer-profile-since">
            Client since {formatDate(customer.createdAt)}
          </p>
        </div>
      </header>

      <section className="customer-profile-section">
        <p className="rail-section-kicker">Contact</p>
        <div className="appointment-customer-fields">
          {customer.email ? (
            <div className="appointment-customer-field">
              <span className="appointment-customer-field__label">Email</span>
              <span className="appointment-customer-field__value">
                {customer.email}
              </span>
            </div>
          ) : null}
          {customer.phone ? (
            <div className="appointment-customer-field">
              <span className="appointment-customer-field__label">Phone</span>
              <span className="appointment-customer-field__value">
                {customer.phone}
              </span>
            </div>
          ) : null}
          {!customer.email && !customer.phone ? (
            <p className="staff-list-empty">No contact information on file.</p>
          ) : null}
        </div>
      </section>

      {customer.notes ? (
        <section className="customer-profile-section">
          <p className="rail-section-kicker">Notes</p>
          <p className="customer-profile-notes">{customer.notes}</p>
        </section>
      ) : null}

      <section className="customer-profile-section">
        <p className="rail-section-kicker">Booking history</p>
        {profileState.kind === "loading" ? (
          <p>Loading bookings...</p>
        ) : profileState.kind === "error" ? (
          <div className="message-banner message-banner--error" role="alert">
            {profileState.message}
          </div>
        ) : profileState.kind === "ready" ? (
          profileState.profile.bookings.length === 0 ? (
            <p className="staff-list-empty">No bookings yet.</p>
          ) : (
            <ul className="customer-booking-list">
              {profileState.profile.bookings.map((booking) => (
                <CustomerBookingRow key={booking.id} booking={booking} />
              ))}
            </ul>
          )
        ) : (
          <p className="staff-list-empty">Select a customer to load bookings.</p>
        )}
      </section>

      <section className="customer-profile-section">
        <p className="rail-section-kicker">Form responses</p>
        {formResponsesState.kind === "loading" ? (
          <p>Loading form responses...</p>
        ) : formResponsesState.kind === "error" ? (
          <div className="message-banner message-banner--error" role="alert">
            {formResponsesState.message}
          </div>
        ) : formResponsesState.kind === "ready" ? (
          formResponsesState.items.length === 0 ? (
            <p className="staff-list-empty">No form responses yet.</p>
          ) : (
            <ul className="customer-booking-list">
              {formResponsesState.items.map((response) => (
                <CustomerFormResponseRow
                  key={response.id}
                  response={response}
                  isExpanded={expandedFormIds.has(response.id)}
                  onToggleExpand={() => toggleFormExpand(response.id)}
                />
              ))}
            </ul>
          )
        ) : (
          <p className="staff-list-empty">Select a customer to load form responses.</p>
        )}
      </section>
    </div>
  );
}

function CustomerBookingRow({ booking }: { booking: CustomerBookingEntry }) {
  const statusLabel = getStatusLabel(booking.status);
  return (
    <li className="customer-booking-row">
      <div className="customer-booking-row__main">
        <div className="customer-booking-row__header">
          <strong>{booking.serviceName}</strong>
          <span className={`customer-booking-status customer-booking-status--${booking.status}`}>
            {statusLabel}
          </span>
        </div>
        <p className="customer-booking-row__meta">
          {formatDateTime(booking.startsAt)} · {booking.providerName}
        </p>
      </div>
      <div className="customer-booking-row__payment">
        <span>{formatMoney(booking.priceCents)}</span>
        {booking.balanceDueCents > 0 ? (
          <span className="customer-booking-row__balance">
            {formatMoney(booking.balanceDueCents)} due
          </span>
        ) : null}
      </div>
    </li>
  );
}

function CustomerFormResponseRow({
  response,
  isExpanded,
  onToggleExpand,
}: {
  response: BookingFormResponseEntry;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const timingLabel = response.customerPromptTiming?.replaceAll("_", " ") ?? response.scope;
  const answerCount = Object.keys(response.answers).length;
  return (
    <li className="customer-booking-row customer-form-response-row">
      <div className="customer-booking-row__main">
        <div className="customer-booking-row__header">
          <strong>{response.formName}</strong>
          <span className="customer-booking-status customer-booking-status--confirmed">
            v{response.formVersionNumber}
          </span>
        </div>
        <p className="customer-booking-row__meta">
          {formatDateTime(response.submittedAt)} · {timingLabel} · {answerCount} field{answerCount !== 1 ? "s" : ""}
        </p>
        <button
          type="button"
          className="customer-form-response-row__toggle"
          aria-expanded={isExpanded}
          onClick={onToggleExpand}
        >
          {isExpanded ? "Hide answers" : "View answers"}
        </button>
        {isExpanded ? (
          <div className="customer-form-response-row__viewer">
            <FormResponseViewer response={response} />
          </div>
        ) : null}
      </div>
    </li>
  );
}
