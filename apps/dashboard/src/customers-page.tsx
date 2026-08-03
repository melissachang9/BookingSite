import { startTransition, useEffect, useState } from "react";
import type {
  AuthenticatedUser,
  BookingFormResponseEntry,
  BookingFormResponseList,
  CustomerBookingEntry,
  CustomerListResponse,
  CustomerProfileResponse,
  CustomerSummary,
  TenantUserSummary,
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
  const [clientOwnershipEnabled, setClientOwnershipEnabled] = useState(false);
  const [sortMode, setSortMode] = useState<"alpha" | "recent">("alpha");
  const [showAddForm, setShowAddForm] = useState(false);
  const [addFormName, setAddFormName] = useState("");
  const [addFormEmail, setAddFormEmail] = useState("");
  const [addFormPhone, setAddFormPhone] = useState("");
  const [addFormState, setAddFormState] = useState<"idle" | "submitting" | "error">("idle");
  const [addFormError, setAddFormError] = useState("");

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
    platformApi.getTenantBySlug(tenantSlug).then((t) => {
      setClientOwnershipEnabled(Boolean(t.settings?.clientOwnershipEnabled));
    }).catch(() => {});
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

  const sortedCustomers = [...customers].sort((a, b) => {
    if (sortMode === "recent") {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
    return a.name.localeCompare(b.name);
  });

  const recentCutoff = new Date();
  recentCutoff.setDate(recentCutoff.getDate() - 30);
  const recentCustomers = customers.filter((c) => new Date(c.createdAt) >= recentCutoff);

  return (
    <main className="ops-page-stack customers-page">
      <div className="customers-page__toolbar">
        <h3>{definition.title}</h3>
        <div className="customers-page__controls">
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
          <button
            type="button"
            className="primary-action"
            onClick={() => setShowAddForm((prev) => !prev)}
          >
            {showAddForm ? "Cancel" : "Add customer"}
          </button>
        </div>
        {showAddForm ? (
          <div className="customer-notes-editor" style={{ marginTop: "0.75rem", padding: "0.75rem", background: "var(--ui-surface, #f9fafb)", borderRadius: "8px" }}>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
              <label style={{ flex: "1", minWidth: "150px" }}>
                <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>Name *</span>
                <input type="text" value={addFormName} onChange={(e) => setAddFormName(e.target.value)} placeholder="Full name" style={{ width: "100%" }} />
              </label>
              <label style={{ flex: "1", minWidth: "150px" }}>
                <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>Email</span>
                <input type="email" value={addFormEmail} onChange={(e) => setAddFormEmail(e.target.value)} placeholder="Email address" style={{ width: "100%" }} />
              </label>
              <label style={{ flex: "1", minWidth: "150px" }}>
                <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>Phone</span>
                <input type="tel" value={addFormPhone} onChange={(e) => setAddFormPhone(e.target.value)} placeholder="Phone number" style={{ width: "100%" }} />
              </label>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <button
                type="button"
                className="primary-action"
                disabled={!addFormName.trim() || addFormState === "submitting"}
                onClick={async () => {
                  setAddFormState("submitting");
                  setAddFormError("");
                  try {
                    await platformApi.createOrUpdateCustomer({
                      name: addFormName.trim(),
                      email: addFormEmail.trim() || undefined,
                      phone: addFormPhone.trim() || undefined,
                    });
                    setAddFormName("");
                    setAddFormEmail("");
                    setAddFormPhone("");
                    setShowAddForm(false);
                    setAddFormState("idle");
                    await loadCustomers();
                  } catch (err) {
                    setAddFormState("error");
                    setAddFormError(err instanceof Error ? err.message : "Unable to add customer.");
                  }
                }}
              >
                {addFormState === "submitting" ? "Adding…" : "Save customer"}
              </button>
              {addFormState === "error" ? <span style={{ color: "var(--ui-danger)", fontSize: "0.85rem" }}>{addFormError}</span> : null}
            </div>
          </div>
        ) : null}
        <div className="customers-page__filters">
          <span className="customers-page__count">{customers.length} total</span>
          <div className="customers-page__sort">
            <button
              type="button"
              className={`customers-page__sort-btn${sortMode === "alpha" ? " is-active" : ""}`}
              onClick={() => setSortMode("alpha")}
            >
              A–Z
            </button>
            <button
              type="button"
              className={`customers-page__sort-btn${sortMode === "recent" ? " is-active" : ""}`}
              onClick={() => setSortMode("recent")}
            >
              Last 30 days
              {sortMode === "recent" ? ` (${recentCustomers.length})` : ""}
            </button>
          </div>
        </div>
      </div>

      {customers.length === 0 ? (
        <p className="staff-list-empty">No customers found.</p>
      ) : (
        <ul className="customers-page__list">
          {sortedCustomers.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                className={`customers-page__row${
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
                <div className="customers-page__row-info">
                  <strong>{customer.name}</strong>
                  {customer.email ? <span>{customer.email}</span> : null}
                </div>
                <span className="customers-page__row-date">
                  {formatDate(customer.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedCustomer ? (
        <>
          <div
            className="appointment-drawer-backdrop"
            onClick={() => setSelectedCustomerId(null)}
          />
          <aside className="appointment-details-drawer customer-profile-drawer" role="dialog" aria-label="Customer profile">
            <header className="appointment-details-drawer__header">
              <span className="appointment-status-chip">
                <span aria-hidden="true" />
                Customer profile
              </span>
              <button type="button" className="appointment-drawer-close" onClick={() => setSelectedCustomerId(null)} aria-label="Close">
                ×
              </button>
            </header>
            <div className="appointment-drawer-body">
              <CustomerProfilePanel
                customer={selectedCustomer}
                profileState={profileState}
                formResponsesState={formResponsesState}
                tenantSlug={tenantSlug}
                clientOwnershipEnabled={clientOwnershipEnabled}
                onCustomerUpdated={async () => {
                  await loadCustomers();
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
            </div>
          </aside>
        </>
      ) : null}
    </main>
  );
}

function CustomerProfilePanel({
  customer,
  profileState,
  formResponsesState,
  tenantSlug,
  clientOwnershipEnabled,
  onCustomerUpdated,
}: {
  customer: CustomerSummary;
  profileState: ProfileState;
  formResponsesState: FormResponsesState;
  tenantSlug: string;
  clientOwnershipEnabled: boolean;
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
    addressStreet: customer.addressStreet ?? "",
    addressCity: customer.addressCity ?? "",
    addressState: customer.addressState ?? "",
    addressZip: customer.addressZip ?? "",
  });
  const [contactSaveState, setContactSaveState] = useState<"idle" | "submitting" | "error">("idle");
  const [contactError, setContactError] = useState("");
  const [isAdjustingWallet, setIsAdjustingWallet] = useState(false);
  const [walletAmountText, setWalletAmountText] = useState("");
  const [walletNote, setWalletNote] = useState("");
  const [walletSaveState, setWalletSaveState] = useState<"idle" | "submitting" | "error">("idle");
  const [walletError, setWalletError] = useState("");
  const [ownerCandidates, setOwnerCandidates] = useState<TenantUserSummary[]>([]);
  const [ownerCandidatesLoaded, setOwnerCandidatesLoaded] = useState(false);
  const [selectedOwnerId, setSelectedOwnerId] = useState(customer.ownerUserId ?? "");
  const [ownerSaveState, setOwnerSaveState] = useState<"idle" | "submitting" | "error">("idle");
  const [ownerError, setOwnerError] = useState("");
  const [smsConsent, setSmsConsent] = useState(customer.smsConsent ?? false);
  const [smsPhone, setSmsPhone] = useState(customer.smsPhone ?? customer.phone ?? "");
  const [smsSaveState, setSmsSaveState] = useState<"idle" | "submitting" | "error">("idle");

  useEffect(() => {
    if (ownerCandidatesLoaded) return;
    let cancelled = false;
    platformApi.listOwnerCandidates(tenantSlug).then((res) => {
      if (cancelled) return;
      setOwnerCandidates(res.users);
      setOwnerCandidatesLoaded(true);
    }).catch(() => {
      if (cancelled) return;
      setOwnerCandidatesLoaded(true);
    });
    return () => { cancelled = true; };
  }, [tenantSlug, ownerCandidatesLoaded]);

  const handleOwnerChange = async (userId: string) => {
    setSelectedOwnerId(userId);
    setOwnerSaveState("submitting");
    setOwnerError("");
    try {
      const body: UpdateCustomerRequest = { ownerUserId: userId || null };
      await platformApi.updateCustomer(tenantSlug, customer.id, body);
      setOwnerSaveState("idle");
      if (onCustomerUpdated) {
        await onCustomerUpdated();
      }
    } catch (err) {
      setOwnerSaveState("error");
      setOwnerError(err instanceof Error ? err.message : "Unable to assign owner.");
      setSelectedOwnerId(customer.ownerUserId ?? "");
    }
  };

  const handleSmsConsentChange = async (consent: boolean) => {
    setSmsConsent(consent);
    setSmsSaveState("submitting");
    try {
      const body: UpdateCustomerRequest = { smsConsent: consent, smsPhone: consent ? smsPhone || customer.phone || null : null };
      await platformApi.updateCustomer(tenantSlug, customer.id, body);
      setSmsSaveState("idle");
      if (onCustomerUpdated) await onCustomerUpdated();
    } catch (err) {
      setSmsSaveState("error");
      setSmsConsent(customer.smsConsent ?? false);
    }
  };

  const handleSmsPhoneSave = async () => {
    setSmsSaveState("submitting");
    try {
      const body: UpdateCustomerRequest = { smsPhone: smsPhone.trim() || null };
      await platformApi.updateCustomer(tenantSlug, customer.id, body);
      setSmsSaveState("idle");
      if (onCustomerUpdated) await onCustomerUpdated();
    } catch (err) {
      setSmsSaveState("error");
    }
  };

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
      await platformApi.updateCustomer(tenantSlug, customer.id, body);
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
        addressStreet: contactDraft.addressStreet.trim() || undefined,
        addressCity: contactDraft.addressCity.trim() || undefined,
        addressState: contactDraft.addressState.trim() || undefined,
        addressZip: contactDraft.addressZip.trim() || undefined,
      };
      await platformApi.updateCustomer(tenantSlug, customer.id, body);
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

  const handleWalletAdjustment = async () => {
    const dollars = parseFloat(walletAmountText.replace(/[^0-9.-]/g, ""));
    if (isNaN(dollars) || dollars === 0) {
      setWalletError("Enter a valid dollar amount.");
      setWalletSaveState("error");
      return;
    }
    const cents = Math.round(dollars * 100);
    setWalletSaveState("submitting");
    setWalletError("");
    try {
      const body: UpdateCustomerRequest = {
        walletAdjustmentCents: cents,
        walletAdjustmentNote: walletNote.trim() || undefined,
      };
      await platformApi.updateCustomer(tenantSlug, customer.id, body);
      setIsAdjustingWallet(false);
      setWalletAmountText("");
      setWalletNote("");
      setWalletSaveState("idle");
      if (onCustomerUpdated) {
        await onCustomerUpdated();
      }
    } catch (err) {
      setWalletSaveState("error");
      setWalletError(err instanceof Error ? err.message : "Unable to adjust wallet.");
    }
  };
  return (
    <>
      {/* Customer header */}
      <div className="booking-rail-section">
        <div className="appointment-customer-card">
          <span
            className="appointment-customer-avatar"
            aria-hidden="true"
            style={{ width: "2.5rem", height: "2.5rem", fontSize: "0.9rem" }}
          >
            {initialsOf(customer.name)}
          </span>
          <div>
            <strong className="appointment-customer-name">{customer.name}</strong>
            <span className="appointment-customer-detail">
              Client since {formatDate(customer.createdAt)}
            </span>
          </div>
        </div>
      </div>

      {clientOwnershipEnabled ? (
      <div className="booking-rail-section">
        <p className="rail-section-kicker">Owner</p>
        <div className="appointment-summary-card">
          <div className="customer-owner-row">
            <select
              value={selectedOwnerId}
              onChange={(e) => { void handleOwnerChange(e.target.value); }}
              disabled={ownerSaveState === "submitting" || !ownerCandidatesLoaded}
              className="customer-owner-select"
            >
              <option value="">Unassigned</option>
              {ownerCandidates.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            {ownerSaveState === "submitting" ? <span className="customer-owner-saving">Saving…</span> : null}
          </div>
        </div>
        {ownerSaveState === "error" ? <p role="alert" className="settings-error">{ownerError}</p> : null}
      </div>
      ) : null}

      <div className="booking-rail-section">
        <p className="rail-section-kicker">Money</p>
        {profileState.kind === "ready" ? (
          <div className="appointment-payment-summary">
            <div className="appointment-payment-row"><span>Lifetime spend</span><span>{formatMoney(profileState.profile.lifetimeSpendCents)}</span></div>
            <div className="appointment-payment-row"><span>Wallet balance</span><span>{formatMoney(profileState.profile.walletBalanceCents)}</span></div>
            {profileState.profile.outstandingBalanceCents > 0 ? (
              <div className="appointment-payment-row appointment-payment-row--due"><span>Outstanding</span><span>{formatMoney(profileState.profile.outstandingBalanceCents)}</span></div>
            ) : null}
            {isAdjustingWallet ? (
              <div className="customer-notes-editor" style={{ marginTop: "0.75rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem" }}>
                  <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>
                    Amount (positive = credit, negative = debit)
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={walletAmountText}
                    onChange={(e) => setWalletAmountText(e.target.value)}
                    placeholder="e.g. 25.00 or -10.00"
                    disabled={walletSaveState === "submitting"}
                    style={{ width: "100%" }}
                  />
                </label>
                <label style={{ display: "block", marginBottom: "0.5rem" }}>
                  <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>Note (required)</span>
                  <input
                    type="text"
                    value={walletNote}
                    onChange={(e) => setWalletNote(e.target.value)}
                    placeholder="e.g. Loyalty credit"
                    disabled={walletSaveState === "submitting"}
                    style={{ width: "100%" }}
                  />
                </label>
                <div className="customer-notes-editor__actions">
                  <button type="button" className="text-action" onClick={() => { setIsAdjustingWallet(false); setWalletError(""); }} disabled={walletSaveState === "submitting"}>Cancel</button>
                  <button type="button" className="primary-action" onClick={handleWalletAdjustment} disabled={walletSaveState === "submitting" || !walletNote.trim()}>{walletSaveState === "submitting" ? "Saving…" : "Adjust"}</button>
                </div>
                {walletSaveState === "error" ? <p role="alert" className="settings-error">{walletError}</p> : null}
              </div>
            ) : (
              <button type="button" className="link-action" onClick={() => setIsAdjustingWallet(true)} style={{ marginTop: "0.5rem" }}>Adjust wallet</button>
            )}
          </div>
        ) : (
          <p className="staff-list-empty">Loading…</p>
        )}
      </div>

      <div className="booking-rail-section">
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
            <label style={{ display: "block", marginBottom: "0.5rem" }}>
              <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>Street address</span>
              <input
                type="text"
                value={contactDraft.addressStreet}
                onChange={(e) => setContactDraft((d) => ({ ...d, addressStreet: e.target.value }))}
                disabled={contactSaveState === "submitting"}
                style={{ width: "100%" }}
              />
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", flex: "2" }}>
                <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>City</span>
                <input
                  type="text"
                  value={contactDraft.addressCity}
                  onChange={(e) => setContactDraft((d) => ({ ...d, addressCity: e.target.value }))}
                  disabled={contactSaveState === "submitting"}
                  style={{ width: "100%" }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.5rem", flex: "1" }}>
                <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>State</span>
                <input
                  type="text"
                  value={contactDraft.addressState}
                  onChange={(e) => setContactDraft((d) => ({ ...d, addressState: e.target.value }))}
                  disabled={contactSaveState === "submitting"}
                  style={{ width: "100%" }}
                />
              </label>
              <label style={{ display: "block", marginBottom: "0.5rem", flex: "1" }}>
                <span style={{ display: "block", fontSize: "0.85em", marginBottom: "0.25rem" }}>ZIP</span>
                <input
                  type="text"
                  value={contactDraft.addressZip}
                  onChange={(e) => setContactDraft((d) => ({ ...d, addressZip: e.target.value }))}
                  disabled={contactSaveState === "submitting"}
                  style={{ width: "100%" }}
                />
              </label>
            </div>
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
                    addressStreet: customer.addressStreet ?? "",
                    addressCity: customer.addressCity ?? "",
                    addressState: customer.addressState ?? "",
                    addressZip: customer.addressZip ?? "",
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
          <div className="appointment-summary-card">
            <div className="appointment-field-list">
              {customer.email ? (
                <div className="appointment-field-row"><span>Email</span><span>{customer.email}</span></div>
              ) : null}
              {customer.phone ? (
                <div className="appointment-field-row"><span>Phone</span><span>{customer.phone}</span></div>
              ) : null}
              {customer.addressStreet ? (
                <div className="appointment-field-row"><span>Address</span><span>{[customer.addressStreet, customer.addressCity, customer.addressState, customer.addressZip].filter(Boolean).join(", ")}</span></div>
              ) : null}
              {!customer.email && !customer.phone && !customer.addressStreet ? (
                <p className="staff-list-empty">No contact information on file.</p>
              ) : null}
            </div>
            <button
              type="button"
              className="link-action"
              onClick={() => {
                setContactDraft({
                  name: customer.name,
                  email: customer.email ?? "",
                  phone: customer.phone ?? "",
                  addressStreet: customer.addressStreet ?? "",
                  addressCity: customer.addressCity ?? "",
                  addressState: customer.addressState ?? "",
                  addressZip: customer.addressZip ?? "",
                });
                setIsEditingContact(true);
              }}
              style={{ marginTop: "0.5rem" }}
            >
              Edit contact
            </button>
          </div>
        )}
      </div>

      <div className="booking-rail-section">
        <p className="rail-section-kicker">SMS reminders</p>
        <div className="appointment-summary-card">
          <label className="settings-toggle-field" style={{ padding: 0 }}>
            <input
              type="checkbox"
              checked={smsConsent}
              onChange={(e) => { void handleSmsConsentChange(e.target.checked); }}
              disabled={smsSaveState === "submitting"}
            />
            <span>
              <strong>SMS consent</strong>
              <small>Customer agrees to receive SMS appointment reminders.</small>
            </span>
          </label>
          {smsConsent ? (
            <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.4rem" }}>
              <input
                type="tel"
                value={smsPhone}
                onChange={(e) => setSmsPhone(e.target.value)}
                onBlur={() => { if (smsPhone.trim() && smsPhone !== (customer.smsPhone ?? customer.phone ?? "")) handleSmsPhoneSave(); }}
                placeholder="SMS phone number"
                disabled={smsSaveState === "submitting"}
                style={{ flex: 1, padding: "0.35rem 0.5rem", fontSize: "0.85rem", border: "1px solid var(--color-border, rgba(0,0,0,0.18))", borderRadius: "4px" }}
              />
            </div>
          ) : null}
        </div>
        {smsSaveState === "error" ? <p role="alert" className="settings-error" style={{ marginTop: "0.25rem" }}>Unable to save SMS settings.</p> : null}
      </div>

      <div className="booking-rail-section">
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
          <div className="appointment-summary-card">
            {customer.notes ? (
              <p className="customer-profile-notes">{customer.notes}</p>
            ) : (
              <p className="staff-list-empty">No notes yet.</p>
            )}
            <button
              type="button"
              className="link-action"
              onClick={() => {
                setNotesDraft(customer.notes ?? "");
                setIsEditingNotes(true);
              }}
              style={{ marginTop: "0.5rem" }}
            >
              {customer.notes ? "Edit" : "Add note"}
            </button>
          </div>
        )}
      </div>

      <div className="booking-rail-section">
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
      </div>

      <div className="booking-rail-section">
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
      </div>
    </>
  );
}

function CustomerBookingRow({ booking }: { booking: CustomerBookingEntry }) {
  const statusLabel = getStatusLabel(booking.status);
  return (
    <li className="customer-booking-row">
      <a
        href={`/calendar?bookingId=${booking.id}`}
        className="customer-booking-row__main"
        style={{ textDecoration: "none", color: "inherit", display: "contents" }}
      >
        <div className="customer-booking-row__header">
          <strong>{booking.serviceName}</strong>
          <span className={`customer-booking-status customer-booking-status--${booking.status}`}>
            {statusLabel}
          </span>
        </div>
        <p className="customer-booking-row__meta">
          {formatDateTime(booking.startsAt)} · {booking.providerName}
        </p>
      </a>
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
