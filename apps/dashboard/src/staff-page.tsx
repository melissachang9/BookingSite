import { useEffect, useMemo, useState } from "react";
import type {
  AuthenticatedUser,
  CreateProviderRequest,
  CreateStaffRequest,
  LocationSummary,
  ProviderSchedule,
  ProviderScheduleEntry,
  ProviderSummary,
  ReplaceProviderScheduleRequest,
  ServiceSummary,
  TenantUserSummary,
  UpdateProviderRequest,
  UpdateTenantUserRequest,
} from "@booking/shared-types";

import { platformApi } from "./platform-api";

type RouteDefinitionLike = {
  title: string;
  eyebrow: string;
  description: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

type ModalState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "password"; user: TenantUserSummary }
  | { kind: "addProviderFor"; user: TenantUserSummary };

type TabKey = "details" | "services" | "schedule";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
  provider: "Provider",
};

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "owner", label: "Owner" },
  { value: "manager", label: "Manager" },
  { value: "staff", label: "Staff" },
  { value: "provider", label: "Provider" },
];

const storefrontBaseUrl =
  import.meta.env.VITE_PUBLIC_STOREFRONT_BASE_URL ?? "http://127.0.0.1:3001";

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((permission) => permission.key === key && permission.allowed);
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

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

export function StaffPage({
  definition,
  currentUser,
}: {
  definition: RouteDefinitionLike;
  currentUser: AuthenticatedUser;
}) {
  const canManage = hasPermission(currentUser, "settings.manage");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [users, setUsers] = useState<TenantUserSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("details");
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    setState({ kind: "loading" });
    Promise.all([
      platformApi.listTenantUsers(currentUser.tenantSlug),
      platformApi.listProvidersAdmin(currentUser.tenantSlug),
      platformApi.listLocationsAdmin(currentUser.tenantSlug),
      platformApi.listServices(currentUser.tenantSlug),
    ])
      .then(([usersRes, providersRes, locationsRes, servicesRes]) => {
        if (cancelled) return;
        setUsers(usersRes.users);
        setProviders(providersRes.providers);
        setLocations(locationsRes.locations);
        setServices(servicesRes.services);
        setState({ kind: "ready" });
        setSelectedUserId((prev) => prev ?? usersRes.users[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: readErrorMessage(error, "Unable to load team roster."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, currentUser.tenantSlug, refreshKey]);

  const handleSaved = () => {
    setModal({ kind: "none" });
    setRefreshKey((value) => value + 1);
  };

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );
  const selectedProvider = useMemo(
    () => (selectedUser ? providers.find((p) => p.userId === selectedUser.id) ?? null : null),
    [providers, selectedUser],
  );

  if (!canManage) {
    return (
      <main className="ops-page-stack">
        <section className="ops-hero ops-hero--compact">
          <div className="ops-hero-copy">
            <p className="eyebrow">{definition.eyebrow}</p>
            <h3>{definition.title}</h3>
            <p>You do not have permission to view the team roster.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="ops-page-stack">
      <section className="ops-panel staff-master-detail">
        {state.kind === "loading" ? <p>Loading roster…</p> : null}
        {state.kind === "error" ? (
          <p role="alert" className="settings-error">
            {state.message}
          </p>
        ) : null}
        {state.kind === "ready" ? (
          <div className="staff-grid">
            <aside className="staff-list-rail">
              <header className="staff-list-rail-header">
                <h4>Team</h4>
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => setModal({ kind: "add" })}
                >
                  Add staff
                </button>
              </header>
              {users.length === 0 ? (
                <p className="settings-form-help">No users configured yet.</p>
              ) : (
                <ul className="staff-list">
                  {users.map((user) => {
                    const provider = providers.find((p) => p.userId === user.id);
                    const isActive = user.id === selectedUserId;
                    return (
                      <li key={user.id}>
                        <button
                          type="button"
                          className={`staff-list-item${isActive ? " is-active" : ""}`}
                          onClick={() => {
                            setSelectedUserId(user.id);
                            setActiveTab("details");
                          }}
                        >
                          {user.avatarUrl ? (
                            <img
                              className="staff-avatar"
                              src={user.avatarUrl}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="staff-avatar staff-avatar--initials" aria-hidden>
                              {initialsOf(user.name)}
                            </span>
                          )}
                          <span className="staff-list-meta">
                            <span className="staff-list-name">{user.name}</span>
                            <span className="staff-list-role">
                              {ROLE_LABELS[user.role] ?? user.role}
                              {provider ? " · Provider" : ""}
                              {!user.isActive ? " · Inactive" : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>

            <div className="staff-detail">
              {selectedUser === null ? (
                <p className="settings-form-help">Select a team member to view details.</p>
              ) : (
                <StaffDetail
                  tenantSlug={currentUser.tenantSlug}
                  user={selectedUser}
                  provider={selectedProvider}
                  locations={locations}
                  services={services}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  onResetPassword={() => setModal({ kind: "password", user: selectedUser })}
                  onLinkProvider={() => setModal({ kind: "addProviderFor", user: selectedUser })}
                  onSaved={handleSaved}
                />
              )}
            </div>
          </div>
        ) : null}
      </section>

      {modal.kind === "add" ? (
        <AddStaffModal
          tenantSlug={currentUser.tenantSlug}
          locations={locations}
          services={services}
          onClose={() => setModal({ kind: "none" })}
          onSaved={handleSaved}
        />
      ) : null}
      {modal.kind === "password" ? (
        <ResetPasswordModal
          tenantSlug={currentUser.tenantSlug}
          user={modal.user}
          onClose={() => setModal({ kind: "none" })}
          onSaved={handleSaved}
        />
      ) : null}
      {modal.kind === "addProviderFor" ? (
        <AddProviderModal
          tenantSlug={currentUser.tenantSlug}
          user={modal.user}
          locations={locations}
          services={services}
          onClose={() => setModal({ kind: "none" })}
          onSaved={handleSaved}
        />
      ) : null}
    </main>
  );
}

function StaffDetail({
  tenantSlug,
  user,
  provider,
  locations,
  services,
  activeTab,
  onTabChange,
  onResetPassword,
  onLinkProvider,
  onSaved,
}: {
  tenantSlug: string;
  user: TenantUserSummary;
  provider: ProviderSummary | null;
  locations: LocationSummary[];
  services: ServiceSummary[];
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  onResetPassword: () => void;
  onLinkProvider: () => void;
  onSaved: () => void;
}) {
  const tabs: Array<{ key: TabKey; label: string; disabled?: boolean }> = [
    { key: "details", label: "Details" },
    { key: "services", label: "Services", disabled: !provider },
    { key: "schedule", label: "Work hours", disabled: !provider },
  ];

  const directBookingLink = provider
    ? `${storefrontBaseUrl}/${tenantSlug}?providerId=${provider.id}`
    : null;

  return (
    <div className="staff-detail-inner">
      <header className="staff-detail-header">
        <div>
          <p className="eyebrow">{ROLE_LABELS[user.role] ?? user.role}</p>
          <h4>{user.name}</h4>
          <p className="settings-form-help">
            {user.email}
            {user.phone ? ` · ${user.phone}` : ""}
            {!user.isActive ? " · Inactive" : ""}
          </p>
        </div>
        <div className="staff-detail-actions">
          <button type="button" className="ghost-action" onClick={onResetPassword}>
            Reset password
          </button>
          {provider === null ? (
            <button type="button" className="ghost-action" onClick={onLinkProvider}>
              Make service provider
            </button>
          ) : null}
        </div>
      </header>

      <nav className="staff-detail-tabs" role="tablist" aria-label="Staff sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            disabled={tab.disabled}
            className={`staff-detail-tab${activeTab === tab.key ? " is-active" : ""}`}
            onClick={() => onTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "details" ? (
        <DetailsTab
          tenantSlug={tenantSlug}
          user={user}
          directBookingLink={directBookingLink}
          onSaved={onSaved}
        />
      ) : null}
      {activeTab === "services" && provider ? (
        <ServicesTab
          tenantSlug={tenantSlug}
          provider={provider}
          locations={locations}
          services={services}
          onSaved={onSaved}
        />
      ) : null}
      {activeTab === "schedule" && provider ? (
        <ScheduleTab tenantSlug={tenantSlug} provider={provider} locations={locations} />
      ) : null}
    </div>
  );
}

function DetailsTab({
  tenantSlug,
  user,
  directBookingLink,
  onSaved,
}: {
  tenantSlug: string;
  user: TenantUserSummary;
  directBookingLink: string | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    phone: user.phone ?? "",
    avatarUrl: user.avatarUrl ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      phone: user.phone ?? "",
      avatarUrl: user.avatarUrl ?? "",
    });
  }, [user]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const payload: UpdateTenantUserRequest = {};
    if (form.name.trim() !== user.name) payload.name = form.name.trim();
    if (form.role !== user.role) payload.role = form.role;
    if (form.isActive !== user.isActive) payload.isActive = form.isActive;
    const phone = form.phone.trim();
    if (phone !== (user.phone ?? "")) payload.phone = phone || null;
    const avatar = form.avatarUrl.trim();
    if (avatar !== (user.avatarUrl ?? "")) payload.avatarUrl = avatar || null;
    if (Object.keys(payload).length === 0) {
      setSubmitting(false);
      return;
    }
    try {
      await platformApi.updateTenantUser(tenantSlug, user.id, payload);
      onSaved();
    } catch (err) {
      setError(readErrorMessage(err, "Unable to update user."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="staff-detail-form" onSubmit={submit}>
      <div className="staff-detail-grid">
        <label>
          <span>Name</span>
          <input
            type="text"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={user.email} disabled readOnly />
        </label>
        <label>
          <span>Role</span>
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Phone</span>
          <input
            type="text"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
            placeholder="+1 555-555-1212"
          />
        </label>
        <label className="staff-detail-grid-wide">
          <span>Avatar URL</span>
          <input
            type="text"
            value={form.avatarUrl}
            onChange={(event) => setForm({ ...form, avatarUrl: event.target.value })}
            placeholder="https://…"
          />
          <small className="settings-form-help">
            Paste a hosted image URL. Upload coming later.
          </small>
        </label>
        <label className="settings-toggle staff-detail-grid-wide">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
          />
          <span>Active (can sign in)</span>
        </label>
        <label>
          <span>Joined</span>
          <input
            type="text"
            value={DATE_FORMAT.format(new Date(user.createdAt))}
            disabled
            readOnly
          />
        </label>
      </div>

      {directBookingLink ? (
        <div className="staff-booking-link">
          <p className="eyebrow">Direct booking link</p>
          <code>{directBookingLink}</code>
          <a className="ghost-action" href={directBookingLink} target="_blank" rel="noreferrer">
            Open
          </a>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="settings-error">
          {error}
        </p>
      ) : null}

      <div className="modal-actions">
        <button type="submit" className="primary-action" disabled={submitting}>
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function ServicesTab({
  tenantSlug,
  provider,
  locations,
  services,
  onSaved,
}: {
  tenantSlug: string;
  provider: ProviderSummary;
  locations: LocationSummary[];
  services: ServiceSummary[];
  onSaved: () => void;
}) {
  const [locationIds, setLocationIds] = useState<string[]>(provider.locationIds);
  const [serviceIds, setServiceIds] = useState<string[]>(provider.serviceIds);
  const [isBookableOnline, setIsBookableOnline] = useState(provider.isBookableOnline);
  const [isActive, setIsActive] = useState(provider.isActive);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocationIds(provider.locationIds);
    setServiceIds(provider.serviceIds);
    setIsBookableOnline(provider.isBookableOnline);
    setIsActive(provider.isActive);
  }, [provider]);

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const payload: UpdateProviderRequest = {
      locationIds,
      serviceIds,
      isBookableOnline,
      isActive,
    };
    try {
      await platformApi.updateProvider(tenantSlug, provider.id, payload);
      onSaved();
    } catch (err) {
      setError(readErrorMessage(err, "Unable to update provider."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="staff-detail-form" onSubmit={submit}>
      <fieldset className="staff-fieldset">
        <legend>Locations</legend>
        {locations.length === 0 ? (
          <p className="settings-form-help">No locations configured.</p>
        ) : (
          <div className="staff-checkbox-grid">
            {locations.map((loc) => (
              <label key={loc.id} className="settings-toggle">
                <input
                  type="checkbox"
                  checked={locationIds.includes(loc.id)}
                  onChange={() => setLocationIds(toggle(locationIds, loc.id))}
                />
                <span>{loc.name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="staff-fieldset">
        <legend>Services performed</legend>
        {services.length === 0 ? (
          <p className="settings-form-help">No services configured.</p>
        ) : (
          <div className="staff-checkbox-grid">
            {services.map((svc) => (
              <label key={svc.id} className="settings-toggle">
                <input
                  type="checkbox"
                  checked={serviceIds.includes(svc.id)}
                  onChange={() => setServiceIds(toggle(serviceIds, svc.id))}
                />
                <span>{svc.name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="staff-fieldset">
        <legend>Visibility</legend>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={isBookableOnline}
            onChange={(event) => setIsBookableOnline(event.target.checked)}
          />
          <span>Bookable online (shows on storefront)</span>
        </label>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          <span>Active provider</span>
        </label>
      </fieldset>

      {error ? (
        <p role="alert" className="settings-error">
          {error}
        </p>
      ) : null}

      <div className="modal-actions">
        <button type="submit" className="primary-action" disabled={submitting}>
          {submitting ? "Saving…" : "Save provider"}
        </button>
      </div>
    </form>
  );
}

function SchedulePlaceholder() {
  return (
    <div className="staff-detail-form">
      <p className="settings-form-help">
        Weekly work hours editor lands in the next phase. Schedules currently follow tenant business hours.
      </p>
    </div>
  );
}

const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type ScheduleTabProps = {
  tenantSlug: string;
  provider: ProviderSummary;
  locations: LocationSummary[];
};

function ScheduleTab({ tenantSlug, provider, locations }: ScheduleTabProps) {
  const providerLocations = useMemo(
    () => locations.filter((loc) => provider.locationIds.includes(loc.id)),
    [locations, provider.locationIds],
  );

  const [entries, setEntries] = useState<ProviderScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStatus(null);
    platformApi
      .getProviderSchedule(tenantSlug, provider.id)
      .then((schedule: ProviderSchedule) => {
        if (!cancelled) {
          setEntries(schedule.entries);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load schedule");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, provider.id]);

  function updateEntry(index: number, patch: Partial<ProviderScheduleEntry>) {
    setEntries((current) =>
      current.map((entry, idx) => (idx === index ? { ...entry, ...patch } : entry)),
    );
  }

  function removeEntry(index: number) {
    setEntries((current) => current.filter((_, idx) => idx !== index));
  }

  function addEntry(weekday: number) {
    const defaultLocationId = providerLocations[0]?.id;
    if (!defaultLocationId) {
      return;
    }
    setEntries((current) => [
      ...current,
      { weekday, locationId: defaultLocationId, startTime: "09:00", endTime: "17:00" },
    ]);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      const payload: ReplaceProviderScheduleRequest = { entries };
      const result = await platformApi.replaceProviderSchedule(tenantSlug, provider.id, payload);
      setEntries(result.entries);
      setStatus("Schedule saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save schedule");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="staff-detail-form">
        <p className="settings-form-help">Loading schedule…</p>
      </div>
    );
  }

  if (providerLocations.length === 0) {
    return (
      <div className="staff-detail-form">
        <p className="settings-form-help">
          Assign this provider to at least one location before setting work hours.
        </p>
      </div>
    );
  }

  return (
    <form className="staff-detail-form schedule-week" onSubmit={handleSubmit}>
      {WEEKDAY_LABELS.map((label, weekday) => {
        const dayEntries = entries
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => entry.weekday === weekday);
        return (
          <div key={weekday} className="schedule-day-row">
            <div className="schedule-day-header">
              <h4>{label}</h4>
              <button
                type="button"
                className="link-button"
                onClick={() => addEntry(weekday)}
              >
                + Add time window
              </button>
            </div>
            {dayEntries.length === 0 ? (
              <p className="settings-form-help schedule-day-empty">No hours.</p>
            ) : (
              <ul className="schedule-entry-list">
                {dayEntries.map(({ entry, index }) => (
                  <li key={index} className="schedule-entry">
                    <label className="schedule-entry-field">
                      <span>Location</span>
                      <select
                        value={entry.locationId}
                        onChange={(event) =>
                          updateEntry(index, { locationId: event.target.value })
                        }
                      >
                        {providerLocations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="schedule-entry-field">
                      <span>Start</span>
                      <input
                        type="time"
                        value={entry.startTime}
                        onChange={(event) =>
                          updateEntry(index, { startTime: event.target.value })
                        }
                      />
                    </label>
                    <label className="schedule-entry-field">
                      <span>End</span>
                      <input
                        type="time"
                        value={entry.endTime}
                        onChange={(event) =>
                          updateEntry(index, { endTime: event.target.value })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="link-button schedule-entry-remove"
                      onClick={() => removeEntry(index)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {error ? (
        <p role="alert" className="settings-error">
          {error}
        </p>
      ) : null}
      {status ? <p className="settings-form-help">{status}</p> : null}

      <div className="modal-actions">
        <button type="submit" className="primary-action" disabled={submitting}>
          {submitting ? "Saving…" : "Save schedule"}
        </button>
      </div>
    </form>
  );
}

function ModalShell({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal-panel${wide ? " modal-panel--wide" : ""}`}>
        <header className="modal-header">
          <h4>{title}</h4>
          <button type="button" className="ghost-action" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function AddStaffModal({
  tenantSlug,
  locations,
  services,
  onClose,
  onSaved,
}: {
  tenantSlug: string;
  locations: LocationSummary[];
  services: ServiceSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "staff",
    initialPassword: "",
    phone: "",
    avatarUrl: "",
    isProvider: false,
    isBookableOnline: true,
    locationIds: [] as string[],
    serviceIds: [] as string[],
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = useMemo(
    () =>
      submitting ||
      !form.email.trim() ||
      !form.name.trim() ||
      form.initialPassword.length < 8,
    [form, submitting],
  );

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateStaffRequest = {
        email: form.email.trim(),
        name: form.name.trim(),
        role: form.role,
        initialPassword: form.initialPassword,
        phone: form.phone.trim() || null,
        avatarUrl: form.avatarUrl.trim() || null,
      };
      if (form.isProvider) {
        payload.provider = {
          locationIds: form.locationIds,
          serviceIds: form.serviceIds,
          isBookableOnline: form.isBookableOnline,
        };
      }
      await platformApi.createTenantStaff(tenantSlug, payload);
      onSaved();
    } catch (err) {
      setError(readErrorMessage(err, "Unable to create staff member."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Add staff" onClose={onClose} wide>
      <form className="modal-form" onSubmit={submit}>
        <label>
          <span>Name</span>
          <input
            type="text"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </label>
        <label>
          <span>Email</span>
          <input
            type="email"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            required
          />
        </label>
        <label>
          <span>Role</span>
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Phone</span>
          <input
            type="text"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
            placeholder="+1 555-555-1212"
          />
        </label>
        <label>
          <span>Initial password</span>
          <input
            type="text"
            value={form.initialPassword}
            onChange={(event) => setForm({ ...form, initialPassword: event.target.value })}
            minLength={8}
            required
          />
          <small className="settings-form-help">Minimum 8 characters. Share securely.</small>
        </label>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={form.isProvider}
            onChange={(event) => setForm({ ...form, isProvider: event.target.checked })}
          />
          <span>This person is a service provider</span>
        </label>

        {form.isProvider ? (
          <>
            <fieldset className="staff-fieldset">
              <legend>Locations</legend>
              {locations.length === 0 ? (
                <p className="settings-form-help">No locations configured.</p>
              ) : (
                <div className="staff-checkbox-grid">
                  {locations.map((loc) => (
                    <label key={loc.id} className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={form.locationIds.includes(loc.id)}
                        onChange={() =>
                          setForm({ ...form, locationIds: toggle(form.locationIds, loc.id) })
                        }
                      />
                      <span>{loc.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <fieldset className="staff-fieldset">
              <legend>Services performed</legend>
              {services.length === 0 ? (
                <p className="settings-form-help">No services configured.</p>
              ) : (
                <div className="staff-checkbox-grid">
                  {services.map((svc) => (
                    <label key={svc.id} className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={form.serviceIds.includes(svc.id)}
                        onChange={() =>
                          setForm({ ...form, serviceIds: toggle(form.serviceIds, svc.id) })
                        }
                      />
                      <span>{svc.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={form.isBookableOnline}
                onChange={(event) =>
                  setForm({ ...form, isBookableOnline: event.target.checked })
                }
              />
              <span>Bookable online</span>
            </label>
          </>
        ) : null}

        {error ? (
          <p role="alert" className="settings-error">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="ghost-action" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-action" disabled={disabled}>
            {submitting ? "Saving…" : "Create staff"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function AddProviderModal({
  tenantSlug,
  user,
  locations,
  services,
  onClose,
  onSaved,
}: {
  tenantSlug: string;
  user: TenantUserSummary;
  locations: LocationSummary[];
  services: ServiceSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [isBookableOnline, setIsBookableOnline] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: CreateProviderRequest = {
        name: user.name,
        email: user.email,
        userId: user.id,
        locationIds,
        serviceIds,
        isBookableOnline,
      };
      await platformApi.createProvider(tenantSlug, payload);
      onSaved();
    } catch (err) {
      setError(readErrorMessage(err, "Unable to create provider."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={`Make ${user.name} a service provider`} onClose={onClose} wide>
      <form className="modal-form" onSubmit={submit}>
        <fieldset className="staff-fieldset">
          <legend>Locations</legend>
          <div className="staff-checkbox-grid">
            {locations.map((loc) => (
              <label key={loc.id} className="settings-toggle">
                <input
                  type="checkbox"
                  checked={locationIds.includes(loc.id)}
                  onChange={() => setLocationIds(toggle(locationIds, loc.id))}
                />
                <span>{loc.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="staff-fieldset">
          <legend>Services performed</legend>
          <div className="staff-checkbox-grid">
            {services.map((svc) => (
              <label key={svc.id} className="settings-toggle">
                <input
                  type="checkbox"
                  checked={serviceIds.includes(svc.id)}
                  onChange={() => setServiceIds(toggle(serviceIds, svc.id))}
                />
                <span>{svc.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={isBookableOnline}
            onChange={(event) => setIsBookableOnline(event.target.checked)}
          />
          <span>Bookable online</span>
        </label>

        {error ? (
          <p role="alert" className="settings-error">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="ghost-action" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-action" disabled={submitting}>
            {submitting ? "Saving…" : "Create provider"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ResetPasswordModal({
  tenantSlug,
  user,
  onClose,
  onSaved,
}: {
  tenantSlug: string;
  user: TenantUserSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await platformApi.resetTenantUserPassword(tenantSlug, user.id, { newPassword: password });
      onSaved();
    } catch (err) {
      setError(readErrorMessage(err, "Unable to reset password."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={`Reset password for ${user.name}`} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <label>
          <span>New password</span>
          <input
            type="text"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
          <small className="settings-form-help">
            Minimum 8 characters. Share securely with the user.
          </small>
        </label>
        {error ? (
          <p role="alert" className="settings-error">
            {error}
          </p>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="ghost-action" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-action"
            disabled={submitting || password.length < 8}
          >
            {submitting ? "Saving…" : "Save new password"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
