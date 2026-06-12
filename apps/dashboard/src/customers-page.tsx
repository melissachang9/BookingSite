import { startTransition, useEffect, useState } from "react";
import type {
  AuthenticatedUser,
  BookingFormResponseEntry,
  BookingFormResponseList,
  CustomerBookingEntry,
  CustomerListResponse,
  CustomerProfileResponse,
  CustomerSummary,
  UpdateCustomerRequest,
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
                tenantSlug={tenantSlug}
                onCustomerUpdated={async () => {
                  await loadCustomers();
                  // Re-fetch the profile to get updated notes
                  if (selectedCustomerId) {
                    setProfileState({ kind: "loading" });
                    try {
                      const profile = await platformApi.getCustomerProfile(tenantSlug, selectedCustomerId);
                      setProfileState({ kind: "ready", profile });
                    } catch (error) {
                      setProfileState({
                        kind: "error",
                        message: readErrorMessage(error, "Unable to reload profile."),
                      });
                    }
                  }
                }}
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
  tenantSlug,
  onCustomerUpdated,
}: {
  customer: CustomerSummary;
  profileState: ProfileState;
  formResponsesState: FormResponsesState;
  tenantSlug: string;
  onCustomerUpdated?: () => Promise<void>;
}) {
  const [expandedFormIds, setExpandedFormIds] = useState<Set<string>>(new Set());
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(customer.notes ?? "");
  const [notesSaveState, setNotesSaveState] = useState<"idle" | "submitting" | "error">("idle");
  const [notesError, setNotesError] = useState("");
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState({
    name: customer.name,
    email: customer.email ?? "",
    phone: customer.phone ?? "",
  });
  const [contactSaveState, setContactSaveState] = useState<"idle" | "submitting" | "error">("idle");
  const [contactError, setContactError] = useState("");

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

  const handleSaveNotes = async () => {
    setNotesSaveState("submitting");
    setNotesError("");
    try {
      const body: UpdateCustomerRequest = { notes: notesDraft };
      await platformApi.updateCustomer(customer.tenantId, customer.id, body);
      setIsEditingNotes(false);
      setNotesSaveState("idle");
      if (onCustomerUpdated) {
        await onCustomerUpdated();
      }
    } catch (err) {
      setNotesSaveState("error");
      setNotesError(err instanceof Error ? err.message : "Unable to save notes.");
    }
  };

  const handleSaveContact = async () => {
    if (!contactDraft.name.trim()) {
      setContactSaveState("error");
      setContactError("Name is required.");
      return;
    }
    setContactSaveState("submitting");
    setContactError("");
    try {
      const body: UpdateCustomerRequest = {
        name: contactDraft.name.trim(),
        email: contactDraft.email.trim(),
        phone: contactDraft.phone.trim(),
      };
      await platformApi.updateCustomer(customer.tenantId, customer.id, body);
      setIsEditingContact(false);
      setContactSaveState("idle");
      if (onCustomerUpdated) {
        await onCustomerUpdated();
      }
    } catch (err) {
      setContactSaveState("error");
      setContactError(err instanceof Error ? err.message : "Unable to save contact.");
    }
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
        {isEditingContact ? (
          <div className="customer-notes-editor">
            <label style={{ display: "block", marginBottom: "0.5rem" }}>
              <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>Name</span>
              <input
                type="text"
                value={contactDraft.name}
                onChange={(e) => setContactDraft((d) => ({ ...d, name: e.target.value }))}
                disabled={contactSaveState === "submitting"}
                style={{ width: "100%" }}
              />
            </label>
            <label style={{ display: "block", marginBottom: "0.5rem" }}>
              <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>Email</span>
              <input
                type="email"
                value={contactDraft.email}
                onChange={(e) => setContactDraft((d) => ({ ...d, email: e.target.value }))}
                disabled={contactSaveState === "submitting"}
                style={{ width: "100%" }}
              />
            </label>
            <label style={{ display: "block", marginBottom: "0.5rem" }}>
              <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>Phone</span>
              <input
                type="tel"
                value={contactDraft.phone}
                onChange={(e) => setContactDraft((d) => ({ ...d, phone: e.target.value }))}
                disabled={contactSaveState === "submitting"}
                style={{ width: "100%" }}
              />
            </label>
            <div className="customer-notes-editor__actions">
              <button
                type="button"
                className="text-action"
                onClick={() => {
                  setIsEditingContact(false);
                  setContactDraft({
                    name: customer.name,
                    email: customer.email ?? "",
                    phone: customer.phone ?? "",
                  });
                  setContactError("");
                }}
                disabled={contactSaveState === "submitting"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={handleSaveContact}
                disabled={contactSaveState === "submitting"}
              >
                {contactSaveState === "submitting" ? "Saving…" : "Save"}
              </button>
            </div>
            {contactSaveState === "error" ? (
              <p role="alert" className="settings-error">{contactError}</p>
            ) : null}
          </div>
        ) : (
          <div className="customer-notes-display">
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
            <button
              type="button"
              className="text-action"
              onClick={() => {
                setContactDraft({
                  name: customer.name,
                  email: customer.email ?? "",
                  phone: customer.phone ?? "",
                });
                setIsEditingContact(true);
              }}
            >
              Edit
            </button>
          </div>
        )}
      </section>

      <section className="customer-profile-section">
        <p className="rail-section-kicker">Notes</p>
        {isEditingNotes ? (
          <div className="customer-notes-editor">
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={4}
              placeholder="Add notes about this client..."
              disabled={notesSaveState === "submitting"}
            />
            <div className="customer-notes-editor__actions">
              <button
                type="button"
                className="text-action"
                onClick={() => {
                  setIsEditingNotes(false);
                  setNotesDraft(customer.notes ?? "");
                  setNotesError("");
                }}
                disabled={notesSaveState === "submitting"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={handleSaveNotes}
                disabled={notesSaveState === "submitting"}
              >
                {notesSaveState === "submitting" ? "Saving…" : "Save"}
              </button>
            </div>
            {notesSaveState === "error" ? (
              <p role="alert" className="settings-error">{notesError}</p>
            ) : null}
          </div>
        ) : (
          <div className="customer-notes-display">
            {customer.notes ? (
              <p className="customer-profile-notes">{customer.notes}</p>
            ) : (
              <p className="staff-list-empty">No notes yet.</p>
            )}
            <button
              type="button"
              className="text-action"
              onClick={() => {
                setNotesDraft(customer.notes ?? "");
                setIsEditingNotes(true);
              }}
            >
              {customer.notes ? "Edit" : "Add note"}
            </button>
          </div>
        )}
      </section>

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
