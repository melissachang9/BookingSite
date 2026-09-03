import { startTransition, useEffect, useMemo, useState } from "react";
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

type ClientTab = "history" | "forms" | "notes";

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
  maximumFractionDigits: 0,
});

const currencyFormatterFull = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatMoney(cents: number): string {
  return currencyFormatter.format(cents / 100);
}

function formatMoneyFull(cents: number): string {
  return currencyFormatterFull.format(cents / 100);
}

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${dateFormatter.format(date)} at ${timeFormatter.format(date)}`;
}

function monthLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short" })
    .format(new Date(value))
    .toUpperCase();
}

function dayNumber(value: string): string {
  return new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(
    new Date(value),
  );
}

function memberMonths(createdAt: string): number {
  const created = new Date(createdAt);
  const now = new Date();
  return Math.max(
    1,
    (now.getFullYear() - created.getFullYear()) * 12 +
      (now.getMonth() - created.getMonth()),
  );
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
  const [formResponsesState, setFormResponsesState] =
    useState<FormResponsesState>({ kind: "idle" });
  const [clientOwnershipEnabled, setClientOwnershipEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState<ClientTab>("history");

  // Read customerId from URL query param on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const customerId = params.get("customerId");
    if (customerId) {
      setSelectedCustomerId(customerId);
      const url = new URL(window.location.href);
      url.searchParams.delete("customerId");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  useEffect(() => {
    if (!tenantSlug) return;
    platformApi
      .getTenantBySlug(tenantSlug)
      .then((t) => {
        setClientOwnershipEnabled(Boolean(t.settings?.clientOwnershipEnabled));
      })
      .catch(() => {});
  }, [tenantSlug]);

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

  const reloadProfile = async () => {
    await loadCustomers();
    if (selectedCustomerId) {
      setProfileState({ kind: "loading" });
      try {
        const profile = await platformApi.getCustomerProfile(
          tenantSlug,
          selectedCustomerId,
        );
        setProfileState({ kind: "ready", profile });
      } catch (error) {
        setProfileState({
          kind: "error",
          message: readErrorMessage(error, "Unable to reload profile."),
        });
      }
    }
  };

  const selectedCustomer =
    customers.find((c) => c.id === selectedCustomerId) ?? null;

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = [...customers].sort((a, b) => a.name.localeCompare(b.name));
    if (!query) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        (c.email ?? "").toLowerCase().includes(query) ||
        (c.phone ?? "").toLowerCase().includes(query),
    );
  }, [customers, search]);

  if (!currentUser) {
    return (
      <main className="ops-page-stack">
        <p className="staff-list-empty">Sign in required</p>
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="ops-page-stack">
        <p className="staff-list-empty">
          You do not have permission to view customers.
        </p>
      </main>
    );
  }

  if (loadState.kind === "error") {
    return (
      <main className="ops-page-stack">
        <div className="message-banner message-banner--error" role="alert">
          {loadState.message}
        </div>
      </main>
    );
  }

  if (selectedCustomer) {
    return (
      <main className="ops-page-stack client-detail-page">
        <nav className="client-detail-page__breadcrumb" aria-label="Breadcrumb">
          <button
            type="button"
            className="client-detail-page__breadcrumb-link"
            onClick={() => setSelectedCustomerId(null)}
          >
            Clients
          </button>
          <span className="client-detail-page__breadcrumb-sep">/</span>
          <span className="client-detail-page__breadcrumb-current">
            {selectedCustomer.name}
          </span>
        </nav>

        <ClientProfileHeader
          customer={selectedCustomer}
          profileState={profileState}
        />

        <ClientStatCards profileState={profileState} />

        <div className="client-detail-page__tabs" role="tablist">
          {(
            [
              ["history", "History"],
              ["forms", "Forms"],
              ["notes", "Notes"],
            ] as [ClientTab, string][]
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`client-detail-page__tab${
                activeTab === tab ? " is-active" : ""
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="client-detail-page__tab-panel">
          {activeTab === "history" ? (
            <ClientHistoryTab profileState={profileState} />
          ) : activeTab === "forms" ? (
            <ClientFormsTab formResponsesState={formResponsesState} />
          ) : (
            <ClientNotesTab
              customer={selectedCustomer}
              tenantSlug={tenantSlug}
              onCustomerUpdated={reloadProfile}
            />
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="ops-page-stack clients-page">
      <header className="clients-page__header">
        <div>
          <h2 className="clients-page__title">{definition.title}</h2>
          <p className="clients-page__subtitle">
            {customers.length} client{customers.length === 1 ? "" : "s"}
          </p>
        </div>
        <input
          type="search"
          className="clients-page__search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name, email, or phone"
          aria-label="Search customers"
        />
      </header>

      {filteredCustomers.length === 0 ? (
        <p className="staff-list-empty">No customers found.</p>
      ) : (
        <ul className="clients-page__grid">
          {filteredCustomers.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                className="clients-page__card"
                onClick={() => {
                  setActiveTab("history");
                  setSelectedCustomerId(customer.id);
                }}
              >
                <span className="clients-page__card-avatar" aria-hidden="true">
                  {initialsOf(customer.name)}
                </span>
                <span className="clients-page__card-info">
                  <strong>{customer.name}</strong>
                  {customer.email ? <span>{customer.email}</span> : null}
                </span>
                <span className="clients-page__card-date">
                  Since {formatDate(customer.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function ClientProfileHeader({
  customer,
  profileState,
}: {
  customer: CustomerSummary;
  profileState: ProfileState;
}) {
  const contactLine = [
    customer.email,
    customer.notes ? null : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <header className="client-profile-header">
      <span className="client-profile-header__avatar" aria-hidden="true">
        {initialsOf(customer.name)}
      </span>
      <div className="client-profile-header__info">
        <h2 className="client-profile-header__name">{customer.name}</h2>
        <p className="client-profile-header__contact">
          {[
            customer.email,
            customer.phone,
            `member ${memberMonths(customer.createdAt)} months`,
          ]
            .filter(Boolean)
            .join("  ·  ")}
        </p>
        {contactLine ? null : null}
        <div className="client-profile-header__tags">
          {profileState.kind === "ready" &&
          profileState.profile.outstandingBalanceCents > 0 ? (
            <span className="client-tag client-tag--peach">
              Balance due ·{" "}
              {formatMoneyFull(profileState.profile.outstandingBalanceCents)}
            </span>
          ) : null}
          {customer.blockedFromOnlineBooking ? (
            <span className="client-tag client-tag--risk">
              Blocked from online booking
            </span>
          ) : null}
        </div>
      </div>
      <a className="client-profile-header__cta" href="/calendar">
        Book from calendar
      </a>
    </header>
  );
}

function ClientStatCards({ profileState }: { profileState: ProfileState }) {
  const ready = profileState.kind === "ready" ? profileState.profile : null;
  const lifetime = ready ? ready.lifetimeSpendCents : 0;
  const visits = ready ? ready.bookings.length : 0;
  const outstanding = ready ? ready.outstandingBalanceCents : 0;
  return (
    <div className="client-stat-cards">
      <div className="client-stat-card client-stat-card--mint">
        <span className="client-stat-card__label">Visits</span>
        <span className="client-stat-card__value">
          {profileState.kind === "ready" ? visits : "–"}
        </span>
      </div>
      <div className="client-stat-card client-stat-card--blue">
        <span className="client-stat-card__label">Outstanding</span>
        <span className="client-stat-card__value">
          {profileState.kind === "ready" ? formatMoney(outstanding) : "–"}
        </span>
      </div>
      <div className="client-stat-card client-stat-card--lilac">
        <span className="client-stat-card__label">Lifetime</span>
        <span className="client-stat-card__value">
          {profileState.kind === "ready" ? formatMoney(lifetime) : "–"}
        </span>
      </div>
    </div>
  );
}

function ClientHistoryTab({ profileState }: { profileState: ProfileState }) {
  if (profileState.kind === "loading") {
    return <p className="staff-list-empty">Loading bookings…</p>;
  }
  if (profileState.kind === "error") {
    return (
      <div className="message-banner message-banner--error" role="alert">
        {profileState.message}
      </div>
    );
  }
  if (profileState.kind !== "ready") {
    return <p className="staff-list-empty">No booking history.</p>;
  }
  const bookings = [...profileState.profile.bookings].sort(
    (a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
  );
  if (bookings.length === 0) {
    return <p className="staff-list-empty">No bookings yet.</p>;
  }
  return (
    <ul className="client-history-list">
      {bookings.map((booking) => (
        <ClientHistoryRow key={booking.id} booking={booking} />
      ))}
    </ul>
  );
}

function ClientHistoryRow({ booking }: { booking: CustomerBookingEntry }) {
  const badge = historyBadge(booking);
  return (
    <li
      className={`client-history-row${
        booking.status === "canceled" ? " is-muted" : ""
      }`}
    >
      <span className="client-history-row__date">
        <strong className="client-history-row__day">
          {dayNumber(booking.startsAt)}
        </strong>
        <span className="client-history-row__month">
          {monthLabel(booking.startsAt)}
        </span>
      </span>
      <a
        className="client-history-row__body"
        href={`/calendar?bookingId=${booking.id}`}
      >
        <strong className="client-history-row__title">
          {booking.serviceName}
        </strong>
        <span className="client-history-row__meta">
          {booking.providerName} · {formatDateTime(booking.startsAt)}
        </span>
      </a>
      {badge !== null ? (
        <span className={`client-history-row__badge client-history-row__badge--${badge.tone}`}>
          {badge.label}
        </span>
      ) : (
        <span className="client-history-row__amount">
          {formatMoneyFull(booking.priceCents)}
        </span>
      )}
    </li>
  );
}

function historyBadge(
  booking: CustomerBookingEntry,
): { label: string; tone: string } | null {
  if (booking.status === "canceled") {
    return { label: "Cancelled", tone: "risk" };
  }
  if (booking.status === "no_show") {
    return { label: "No-show", tone: "risk" };
  }
  if (booking.amountPaidCents > 0 && booking.balanceDueCents <= 0) {
    return { label: "Credit", tone: "neutral" };
  }
  if (booking.balanceDueCents > 0) {
    return {
      label: `${formatMoneyFull(booking.balanceDueCents)} due`,
      tone: "peach",
    };
  }
  return null;
}

function ClientFormsTab({
  formResponsesState,
}: {
  formResponsesState: FormResponsesState;
}) {
  const [expandedFormIds, setExpandedFormIds] = useState<Set<string>>(
    new Set(),
  );
  const toggle = (id: string) => {
    setExpandedFormIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (formResponsesState.kind === "loading") {
    return <p className="staff-list-empty">Loading form responses…</p>;
  }
  if (formResponsesState.kind === "error") {
    return (
      <div className="message-banner message-banner--error" role="alert">
        {formResponsesState.message}
      </div>
    );
  }
  if (formResponsesState.kind !== "ready") {
    return <p className="staff-list-empty">No form responses.</p>;
  }
  if (formResponsesState.items.length === 0) {
    return <p className="staff-list-empty">No form responses yet.</p>;
  }
  return (
    <ul className="client-history-list">
      {formResponsesState.items.map((response) => (
        <li key={response.id} className="client-history-row">
          <span className="client-history-row__date">
            <strong className="client-history-row__day">
              {dayNumber(response.submittedAt)}
            </strong>
            <span className="client-history-row__month">
              {monthLabel(response.submittedAt)}
            </span>
          </span>
          <div className="client-history-row__body">
            <strong className="client-history-row__title">
              {response.formName}
            </strong>
            <span className="client-history-row__meta">
              {formatDateTime(response.submittedAt)} · v
              {response.formVersionNumber}
            </span>
            <button
              type="button"
              className="customer-form-response-row__toggle"
              aria-expanded={expandedFormIds.has(response.id)}
              onClick={() => toggle(response.id)}
            >
              {expandedFormIds.has(response.id) ? "Hide answers" : "View answers"}
            </button>
            {expandedFormIds.has(response.id) ? (
              <div className="customer-form-response-row__viewer">
                <FormResponseViewer response={response} />
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ClientNotesTab({
  customer,
  tenantSlug,
  onCustomerUpdated,
}: {
  customer: CustomerSummary;
  tenantSlug: string;
  onCustomerUpdated: () => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(customer.notes ?? "");
  const [saveState, setSaveState] = useState<
    "idle" | "submitting" | "error"
  >("idle");
  const [error, setError] = useState("");

  const handleSave = async () => {
    setSaveState("submitting");
    setError("");
    try {
      const body: UpdateCustomerRequest = { notes: draft };
      await platformApi.updateCustomer(tenantSlug, customer.id, body);
      setIsEditing(false);
      setSaveState("idle");
      await onCustomerUpdated();
    } catch (err) {
      setSaveState("error");
      setError(err instanceof Error ? err.message : "Unable to save notes.");
    }
  };

  return (
    <div className="client-notes-tab">
      {isEditing ? (
        <div className="customer-notes-editor">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            placeholder="Add notes about this client..."
            disabled={saveState === "submitting"}
          />
          <div className="customer-notes-editor__actions">
            <button
              type="button"
              className="text-action"
              onClick={() => {
                setIsEditing(false);
                setDraft(customer.notes ?? "");
                setError("");
              }}
              disabled={saveState === "submitting"}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-action"
              onClick={handleSave}
              disabled={saveState === "submitting"}
            >
              {saveState === "submitting" ? "Saving…" : "Save"}
            </button>
          </div>
          {saveState === "error" ? (
            <p role="alert" className="settings-error">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="client-notes-tab__empty">
          {customer.notes ? (
            <p className="customer-profile-notes">{customer.notes}</p>
          ) : (
            <p className="staff-list-empty">No notes yet.</p>
          )}
          <button
            type="button"
            className="primary-action"
            onClick={() => {
              setDraft(customer.notes ?? "");
              setIsEditing(true);
            }}
          >
            {customer.notes ? "Edit note" : "Add note"}
          </button>
        </div>
      )}
    </div>
  );
}
