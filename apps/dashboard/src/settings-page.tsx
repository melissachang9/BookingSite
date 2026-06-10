import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  BUSINESS_HOURS_WEEKDAY_KEYS,
  SUPPORTED_CURRENCIES,
  type AuthenticatedUser,
  type BusinessHoursDay,
  type BusinessHoursWeek,
  type BusinessHoursWeekdayKey,
  type EmailDnsRecord,
  type LocationSummary,
  type SessionResponse,
  type TenantBranding,
  type TenantSummary,
} from "@booking/shared-types";

import { platformApi } from "./platform-api";

type RouteDefinitionLike = {
  title: string;
  eyebrow: string;
  description: string;
};

type SaveState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type SectionDefinition = {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  status: "available" | "planned";
  plannedPhase?: string;
};

const SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    id: "business-details",
    title: "Business Details",
    eyebrow: "Business setup",
    description: "Business name, website, country, currency, and primary phone.",
    status: "available",
  },
  {
    id: "business-hours",
    title: "Business Hours",
    eyebrow: "Business setup",
    description: "Optional weekly open hours that scope provider availability.",
    status: "available",
  },
  {
    id: "locations",
    title: "Locations",
    eyebrow: "Business setup",
    description: "Manage studio locations, addresses, and per-location phones.",
    status: "available",
  },
  {
    id: "branding",
    title: "Logo & Branding",
    eyebrow: "Business setup",
    description: "Logo URL, favicon, gallery photos, and brand colors.",
    status: "available",
  },
  {
    id: "calendar",
    title: "Calendar Display",
    eyebrow: "Calendar & appointments",
    description: "Visible hour range on the operator calendar grid.",
    status: "available",
  },
  {
    id: "payroll",
    title: "Payroll",
    eyebrow: "Payments & checkout",
    description: "Connect a bank account to pay providers.",
    status: "available",
  },
  {
    id: "client-ownership",
    title: "Client Ownership",
    eyebrow: "Advanced",
    description: "Restrict customer visibility to the assigned provider.",
    status: "available",
  },
  {
    id: "custom-email",
    title: "Custom Email",
    eyebrow: "Advanced",
    description: "Send notifications from your own domain.",
    status: "available",
  },
  {
    id: "wallet-membership",
    title: "Wallet & Membership",
    eyebrow: "Advanced",
    description: "Enable wallet credit and membership program toggles.",
    status: "available",
  },
];

const HOUR_OPTIONS = Array.from({ length: 25 }, (_, hour) => {
  let label: string;
  if (hour === 0) {
    label = "12:00 AM";
  } else if (hour === 12) {
    label = "12:00 PM";
  } else if (hour === 24) {
    label = "12:00 AM (next day)";
  } else if (hour > 12) {
    label = `${hour - 12}:00 PM`;
  } else {
    label = `${hour}:00 AM`;
  }
  return { value: hour, label };
});

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((permission) => permission.key === key && permission.allowed);
}

export function SettingsPage({
  definition,
  currentUser,
  tenant,
  onTenantUpdated,
}: {
  definition: RouteDefinitionLike;
  currentUser: AuthenticatedUser;
  tenant: TenantSummary | null;
  onTenantUpdated: (tenant: TenantSummary) => void;
}) {
  const canManageSettings = hasPermission(currentUser, "settings.manage");
  const [activeSection, setActiveSection] = useState<string>(SECTION_DEFINITIONS[0].id);

  // Track which section is currently in view as the user scrolls so the rail highlights it.
  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) {
          setActiveSection(visible[0].target.id);
        }
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    for (const section of SECTION_DEFINITIONS) {
      const node = document.getElementById(section.id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, []);

  const groupedSections = useMemo(() => {
    const groups = new Map<string, SectionDefinition[]>();
    for (const section of SECTION_DEFINITIONS) {
      const list = groups.get(section.eyebrow) ?? [];
      list.push(section);
      groups.set(section.eyebrow, list);
    }
    return Array.from(groups.entries());
  }, []);

  return (
    <main className="ops-page-stack">
      <div className="settings-layout">
        <nav className="settings-anchor-nav" aria-label="Settings sections">
          {groupedSections.map(([groupTitle, sections]) => (
            <div key={groupTitle} className="settings-anchor-group">
              <p className="settings-anchor-group__title">{groupTitle}</p>
              <ul>
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className={`settings-anchor-link${activeSection === section.id ? " settings-anchor-link--active" : ""}`}
                      onClick={() => setActiveSection(section.id)}
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="settings-content">
          {SECTION_DEFINITIONS.map((section) => (
            <SettingsSection key={section.id} section={section}>
              {section.id === "calendar" ? (
                <CalendarDisplaySection
                  canManageSettings={canManageSettings}
                  tenant={tenant}
                  onTenantUpdated={onTenantUpdated}
                  tenantSlug={currentUser.tenantSlug}
                />
              ) : section.id === "business-details" ? (
                <BusinessDetailsSection
                  canManageSettings={canManageSettings}
                  tenant={tenant}
                  onTenantUpdated={onTenantUpdated}
                  tenantSlug={currentUser.tenantSlug}
                />
              ) : section.id === "business-hours" ? (
                <BusinessHoursSection
                  canManageSettings={canManageSettings}
                  tenant={tenant}
                  onTenantUpdated={onTenantUpdated}
                  tenantSlug={currentUser.tenantSlug}
                />
              ) : section.id === "locations" ? (
                <LocationsSection
                  canManageSettings={canManageSettings}
                  tenantSlug={currentUser.tenantSlug}
                  defaultLocationId={tenant?.defaultLocationId ?? null}
                />
              ) : section.id === "branding" ? (
                <BrandingSection
                  canManageSettings={canManageSettings}
                  tenant={tenant}
                  onTenantUpdated={onTenantUpdated}
                  tenantSlug={currentUser.tenantSlug}
                />
              ) : section.id === "payroll" ? (
                <PayrollSection />
              ) : section.id === "client-ownership" ? (
                <ClientOwnershipSection
                  canManageSettings={canManageSettings}
                  tenant={tenant}
                  onTenantUpdated={onTenantUpdated}
                  tenantSlug={currentUser.tenantSlug}
                />
              ) : section.id === "custom-email" ? (
                <CustomEmailSection
                  canManageSettings={canManageSettings}
                  tenant={tenant}
                  onTenantUpdated={onTenantUpdated}
                  tenantSlug={currentUser.tenantSlug}
                />
              ) : section.id === "wallet-membership" ? (
                <WalletMembershipSection
                  canManageSettings={canManageSettings}
                  tenant={tenant}
                  onTenantUpdated={onTenantUpdated}
                  tenantSlug={currentUser.tenantSlug}
                />
              ) : (
                <PlannedPlaceholder phase={section.plannedPhase ?? "a later release"} />
              )}
            </SettingsSection>
          ))}
        </div>
      </div>
    </main>
  );
}

function SettingsSection({
  section,
  children,
}: {
  section: SectionDefinition;
  children: ReactNode;
}) {
  return (
    <section id={section.id} className="settings-section">
      <header className="settings-section__header">
        <p className="eyebrow">{section.eyebrow}</p>
        <h4>{section.title}</h4>
        <p className="settings-panel-help">{section.description}</p>
      </header>
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

function PlannedPlaceholder({ phase }: { phase: string }) {
  return (
    <div className="settings-placeholder">
      <p>This section ships in {phase}.</p>
    </div>
  );
}

function CalendarDisplaySection({
  canManageSettings,
  tenant,
  onTenantUpdated,
  tenantSlug,
}: {
  canManageSettings: boolean;
  tenant: TenantSummary | null;
  onTenantUpdated: (tenant: TenantSummary) => void;
  tenantSlug: string;
}) {
  const [startHour, setStartHour] = useState<number>(tenant?.settings.calendarDisplayStartHour ?? 9);
  const [endHour, setEndHour] = useState<number>(tenant?.settings.calendarDisplayEndHour ?? 19);
  const [weekStartsOn, setWeekStartsOn] = useState<number>(tenant?.settings.weekStartsOn ?? 0);
  const [reminderHoursBefore, setReminderHoursBefore] = useState<number>(tenant?.settings.reminderHoursBefore ?? 24);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (tenant) {
      setStartHour(tenant.settings.calendarDisplayStartHour);
      setEndHour(tenant.settings.calendarDisplayEndHour);
      setWeekStartsOn(tenant.settings.weekStartsOn ?? 0);
      setReminderHoursBefore(tenant.settings.reminderHoursBefore ?? 24);
    }
  }, [tenant]);

  const validationMessage = endHour <= startHour ? "End hour must be later than start hour." : null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageSettings || validationMessage !== null) {
      return;
    }
    setSaveState({ kind: "submitting" });
    try {
      const updated = await platformApi.updateTenantSettings(tenantSlug, {
        calendarDisplayStartHour: startHour,
        calendarDisplayEndHour: endHour,
        weekStartsOn,
        reminderHoursBefore,
      });
      onTenantUpdated(updated);
      setSaveState({ kind: "success", message: "Calendar display hours saved." });
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to save settings.",
      });
    }
  };

  if (tenant === null) {
    return <p>Loading current settings…</p>;
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="settings-form-row">
        <label className="settings-field">
          <span>Start hour</span>
          <select
            value={startHour}
            onChange={(event) => setStartHour(Number(event.target.value))}
            disabled={!canManageSettings || saveState.kind === "submitting"}
          >
            {HOUR_OPTIONS.slice(0, 24).map((option) => (
              <option key={`start-${option.value}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-field">
          <span>End hour</span>
          <select
            value={endHour}
            onChange={(event) => setEndHour(Number(event.target.value))}
            disabled={!canManageSettings || saveState.kind === "submitting"}
          >
            {HOUR_OPTIONS.slice(1).map((option) => (
              <option key={`end-${option.value}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="settings-field">
        <span>Week starts on</span>
        <select
          value={weekStartsOn}
          onChange={(event) => setWeekStartsOn(Number(event.target.value))}
          disabled={!canManageSettings || saveState.kind === "submitting"}
        >
          <option value={0}>Sunday</option>
          <option value={1}>Monday</option>
          <option value={2}>Tuesday</option>
          <option value={3}>Wednesday</option>
          <option value={4}>Thursday</option>
          <option value={5}>Friday</option>
          <option value={6}>Saturday</option>
        </select>
      </label>

      <label className="settings-field">
        <span>Intake reminder (hours before appointment)</span>
        <select
          value={reminderHoursBefore}
          onChange={(event) => setReminderHoursBefore(Number(event.target.value))}
          disabled={!canManageSettings || saveState.kind === "submitting"}
        >
          <option value={1}>1 hour</option>
          <option value={2}>2 hours</option>
          <option value={4}>4 hours</option>
          <option value={8}>8 hours</option>
          <option value={12}>12 hours</option>
          <option value={24}>24 hours</option>
          <option value={48}>48 hours</option>
          <option value={72}>72 hours</option>
        </select>
      </label>

      {validationMessage ? <p role="alert" className="settings-error">{validationMessage}</p> : null}
      {saveState.kind === "success" ? <p role="status" className="settings-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="settings-error">{saveState.message}</p> : null}

      <div className="settings-actions">
        <button
          type="submit"
          className="primary-action"
          disabled={!canManageSettings || validationMessage !== null || saveState.kind === "submitting"}
        >
          {saveState.kind === "submitting" ? "Saving…" : "Save calendar hours"}
        </button>
        {!canManageSettings ? (
          <p className="settings-permission-note">You do not have permission to edit tenant settings.</p>
        ) : null}
      </div>
    </form>
  );
}

function BusinessDetailsSection({
  canManageSettings,
  tenant,
  onTenantUpdated,
  tenantSlug,
}: {
  canManageSettings: boolean;
  tenant: TenantSummary | null;
  onTenantUpdated: (tenant: TenantSummary) => void;
  tenantSlug: string;
}) {
  const [name, setName] = useState<string>("");
  const [homepageUrl, setHomepageUrl] = useState<string>("");
  const [country, setCountry] = useState<string>("US");
  const [currency, setCurrency] = useState<string>("USD");
  const [smsPhone, setSmsPhone] = useState<string>("");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (tenant) {
      setName(tenant.name);
      setHomepageUrl(tenant.branding.homepageUrl ?? "");
      setCountry(tenant.settings.country ?? "US");
      setCurrency(tenant.settings.currency ?? "USD");
      setSmsPhone(tenant.settings.smsPhone ?? "");
    }
  }, [tenant]);

  const trimmedName = name.trim();
  const validationMessage = trimmedName.length === 0 ? "Business name is required." : null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageSettings || validationMessage !== null) {
      return;
    }
    setSaveState({ kind: "submitting" });
    try {
      const updated = await platformApi.updateTenantBusiness(tenantSlug, {
        name: trimmedName,
        homepageUrl: homepageUrl.trim(),
        country: country.trim().toUpperCase(),
        currency: currency.trim().toUpperCase(),
        smsPhone: smsPhone.trim() === "" ? null : smsPhone.trim(),
      });
      onTenantUpdated(updated);
      setSaveState({ kind: "success", message: "Business details saved." });
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to save business details.",
      });
    }
  };

  if (tenant === null) {
    return <p>Loading current settings…</p>;
  }

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <div className="settings-form-row">
        <label className="settings-field">
          <span>Business name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={!canManageSettings || saveState.kind === "submitting"}
            required
            maxLength={255}
          />
        </label>
        <label className="settings-field">
          <span>Website</span>
          <input
            type="url"
            placeholder="https://yourbusiness.com"
            value={homepageUrl}
            onChange={(event) => setHomepageUrl(event.target.value)}
            disabled={!canManageSettings || saveState.kind === "submitting"}
            maxLength={255}
          />
        </label>
      </div>

      <div className="settings-form-row">
        <label className="settings-field">
          <span>Country</span>
          <input
            type="text"
            value={country}
            onChange={(event) => setCountry(event.target.value.toUpperCase().slice(0, 3))}
            disabled={!canManageSettings || saveState.kind === "submitting"}
            maxLength={3}
            placeholder="US"
          />
        </label>
        <label className="settings-field">
          <span>Currency</span>
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            disabled={!canManageSettings || saveState.kind === "submitting"}
          >
            {SUPPORTED_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-field">
          <span>Primary phone</span>
          <input
            type="tel"
            value={smsPhone}
            onChange={(event) => setSmsPhone(event.target.value)}
            disabled={!canManageSettings || saveState.kind === "submitting"}
            maxLength={32}
            placeholder="+1 555 123 4567"
          />
        </label>
      </div>

      {validationMessage ? <p role="alert" className="settings-error">{validationMessage}</p> : null}
      {saveState.kind === "success" ? <p role="status" className="settings-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="settings-error">{saveState.message}</p> : null}

      <div className="settings-actions">
        <button
          type="submit"
          className="primary-action"
          disabled={!canManageSettings || validationMessage !== null || saveState.kind === "submitting"}
        >
          {saveState.kind === "submitting" ? "Saving…" : "Save business details"}
        </button>
        {!canManageSettings ? (
          <p className="settings-permission-note">You do not have permission to edit business details.</p>
        ) : null}
      </div>
    </form>
  );
}

const WEEKDAY_LABELS: Record<BusinessHoursWeekdayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function defaultBusinessHoursWeek(): BusinessHoursWeek {
  return {
    mon: { open: "09:00", close: "17:00", closed: false },
    tue: { open: "09:00", close: "17:00", closed: false },
    wed: { open: "09:00", close: "17:00", closed: false },
    thu: { open: "09:00", close: "17:00", closed: false },
    fri: { open: "09:00", close: "17:00", closed: false },
    sat: { open: "09:00", close: "17:00", closed: true },
    sun: { open: "09:00", close: "17:00", closed: true },
  };
}

function BusinessHoursSection({
  canManageSettings,
  tenant,
  onTenantUpdated,
  tenantSlug,
}: {
  canManageSettings: boolean;
  tenant: TenantSummary | null;
  onTenantUpdated: (tenant: TenantSummary) => void;
  tenantSlug: string;
}) {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [restrict, setRestrict] = useState<boolean>(false);
  const [week, setWeek] = useState<BusinessHoursWeek>(() => defaultBusinessHoursWeek());
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (tenant) {
      setEnabled(tenant.settings.businessHoursEnabled ?? false);
      setRestrict(tenant.settings.restrictProvidersToBusinessHours ?? false);
      const hours = tenant.settings.businessHours ?? defaultBusinessHoursWeek();
      setWeek({
        mon: { ...hours.mon },
        tue: { ...hours.tue },
        wed: { ...hours.wed },
        thu: { ...hours.thu },
        fri: { ...hours.fri },
        sat: { ...hours.sat },
        sun: { ...hours.sun },
      });
    }
  }, [tenant]);

  const validationMessage = useMemo(() => {
    for (const key of BUSINESS_HOURS_WEEKDAY_KEYS) {
      const day = week[key];
      if (day.closed) continue;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(day.open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(day.close)) {
        return `${WEEKDAY_LABELS[key]}: times must be HH:MM (24-hour).`;
      }
      if (day.open >= day.close) {
        return `${WEEKDAY_LABELS[key]}: open must be earlier than close.`;
      }
    }
    return null;
  }, [week]);

  const updateDay = (key: BusinessHoursWeekdayKey, patch: Partial<BusinessHoursDay>) => {
    setWeek((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageSettings || validationMessage !== null) {
      return;
    }
    setSaveState({ kind: "submitting" });
    try {
      const updated = await platformApi.updateTenantBusinessHours(tenantSlug, {
        businessHoursEnabled: enabled,
        restrictProvidersToBusinessHours: restrict,
        businessHours: week,
      });
      onTenantUpdated(updated);
      setSaveState({ kind: "success", message: "Business hours saved." });
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to save business hours.",
      });
    }
  };

  if (tenant === null) {
    return <p>Loading current settings…</p>;
  }

  const editorDisabled = !canManageSettings || saveState.kind === "submitting" || !enabled;

  return (
    <form className="settings-form" onSubmit={handleSubmit}>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          disabled={!canManageSettings || saveState.kind === "submitting"}
        />
        <span>Set business hours</span>
      </label>
      {!enabled ? (
        <p className="settings-panel-help">Availability follows each provider&rsquo;s schedule.</p>
      ) : (
        <div className="business-hours-grid">
          {BUSINESS_HOURS_WEEKDAY_KEYS.map((key) => {
            const day = week[key];
            return (
              <div key={key} className="business-hours-row">
                <span className="business-hours-row__label">{WEEKDAY_LABELS[key]}</span>
                <label className="business-hours-row__field">
                  <span className="visually-hidden">{WEEKDAY_LABELS[key]} open</span>
                  <input
                    type="time"
                    value={day.open}
                    onChange={(event) => updateDay(key, { open: event.target.value })}
                    disabled={editorDisabled || day.closed}
                    aria-label={`${WEEKDAY_LABELS[key]} open`}
                  />
                </label>
                <span aria-hidden="true">–</span>
                <label className="business-hours-row__field">
                  <span className="visually-hidden">{WEEKDAY_LABELS[key]} close</span>
                  <input
                    type="time"
                    value={day.close}
                    onChange={(event) => updateDay(key, { close: event.target.value })}
                    disabled={editorDisabled || day.closed}
                    aria-label={`${WEEKDAY_LABELS[key]} close`}
                  />
                </label>
                <label className="business-hours-row__closed">
                  <input
                    type="checkbox"
                    checked={day.closed}
                    onChange={(event) => updateDay(key, { closed: event.target.checked })}
                    disabled={editorDisabled}
                    aria-label={`${WEEKDAY_LABELS[key]} closed`}
                  />
                  <span>Closed</span>
                </label>
              </div>
            );
          })}
        </div>
      )}

      <label className={`settings-toggle${!enabled ? " settings-toggle--disabled" : ""}`}>
        <input
          type="checkbox"
          checked={restrict}
          onChange={(event) => setRestrict(event.target.checked)}
          disabled={!canManageSettings || saveState.kind === "submitting" || !enabled}
        />
        <span>Only allow providers to offer services within business hours</span>
      </label>

      {validationMessage ? <p role="alert" className="settings-error">{validationMessage}</p> : null}
      {saveState.kind === "success" ? <p role="status" className="settings-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="settings-error">{saveState.message}</p> : null}

      <div className="settings-actions">
        <button
          type="submit"
          className="primary-action"
          disabled={!canManageSettings || validationMessage !== null || saveState.kind === "submitting"}
        >
          {saveState.kind === "submitting" ? "Saving…" : "Save business hours"}
        </button>
        {!canManageSettings ? (
          <p className="settings-permission-note">You do not have permission to edit business hours.</p>
        ) : null}
      </div>
    </form>
  );
}

export type { RouteDefinitionLike as SettingsRouteDefinition };
export type SettingsPageSession = SessionResponse;

type LocationsLoadState =
  | { kind: "loading" }
  | { kind: "ready"; locations: LocationSummary[] }
  | { kind: "error"; message: string };

type LocationDraft = {
  name: string;
  timeZone: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
};

const EMPTY_LOCATION_DRAFT: LocationDraft = {
  name: "",
  timeZone: "",
  addressLine1: "",
  city: "",
  state: "",
  postalCode: "",
  phone: "",
};

function LocationsSection({
  canManageSettings,
  tenantSlug,
  defaultLocationId,
}: {
  canManageSettings: boolean;
  tenantSlug: string;
  defaultLocationId: string | null;
}) {
  const [state, setState] = useState<LocationsLoadState>({ kind: "loading" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LocationDraft>(EMPTY_LOCATION_DRAFT);
  const [showCreate, setShowCreate] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  const loadLocations = async () => {
    setState({ kind: "loading" });
    try {
      const response = canManageSettings
        ? await platformApi.listLocationsAdmin(tenantSlug)
        : await platformApi.listLocations(tenantSlug);
      setState({ kind: "ready", locations: response.locations });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to load locations.",
      });
    }
  };

  useEffect(() => {
    void loadLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug, canManageSettings]);

  const beginEdit = (location: LocationSummary) => {
    setEditingId(location.id);
    setShowCreate(false);
    setSaveState({ kind: "idle" });
    setDraft({
      name: location.name,
      timeZone: location.timeZone,
      addressLine1: location.addressLine1 ?? "",
      city: location.city ?? "",
      state: location.state ?? "",
      postalCode: location.postalCode ?? "",
      phone: location.phone ?? "",
    });
  };

  const beginCreate = () => {
    setEditingId(null);
    setShowCreate(true);
    setSaveState({ kind: "idle" });
    setDraft(EMPTY_LOCATION_DRAFT);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setShowCreate(false);
    setDraft(EMPTY_LOCATION_DRAFT);
    setSaveState({ kind: "idle" });
  };

  const submitDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageSettings) return;
    if (!draft.name.trim() || !draft.timeZone.trim()) {
      setSaveState({ kind: "error", message: "Name and time zone are required." });
      return;
    }
    setSaveState({ kind: "submitting" });
    try {
      if (editingId) {
        await platformApi.updateLocation(tenantSlug, editingId, {
          name: draft.name.trim(),
          timeZone: draft.timeZone.trim(),
          addressLine1: draft.addressLine1.trim() || null,
          city: draft.city.trim() || null,
          state: draft.state.trim() || null,
          postalCode: draft.postalCode.trim() || null,
          phone: draft.phone.trim() || null,
        });
        setSaveState({ kind: "success", message: "Location updated." });
      } else {
        await platformApi.createLocation(tenantSlug, {
          name: draft.name.trim(),
          timeZone: draft.timeZone.trim(),
          addressLine1: draft.addressLine1.trim() || undefined,
          city: draft.city.trim() || undefined,
          state: draft.state.trim() || undefined,
          postalCode: draft.postalCode.trim() || undefined,
          phone: draft.phone.trim() || undefined,
        });
        setSaveState({ kind: "success", message: "Location created." });
      }
      setEditingId(null);
      setShowCreate(false);
      setDraft(EMPTY_LOCATION_DRAFT);
      await loadLocations();
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to save location.",
      });
    }
  };

  const deactivate = async (location: LocationSummary) => {
    if (!canManageSettings) return;
    if (location.id === defaultLocationId) {
      setSaveState({ kind: "error", message: "Cannot deactivate the default location." });
      return;
    }
    setSaveState({ kind: "submitting" });
    try {
      await platformApi.deactivateLocation(tenantSlug, location.id);
      setSaveState({ kind: "success", message: "Location deactivated." });
      await loadLocations();
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to deactivate location.",
      });
    }
  };

  const reactivate = async (location: LocationSummary) => {
    if (!canManageSettings) return;
    setSaveState({ kind: "submitting" });
    try {
      await platformApi.updateLocation(tenantSlug, location.id, { isActive: true });
      setSaveState({ kind: "success", message: "Location reactivated." });
      await loadLocations();
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to reactivate location.",
      });
    }
  };

  if (state.kind === "loading") {
    return <p>Loading locations…</p>;
  }
  if (state.kind === "error") {
    return <p role="alert" className="settings-error">{state.message}</p>;
  }

  return (
    <div className="locations-section">
      <ul className="locations-list">
        {state.locations.map((location) => {
          const isEditing = editingId === location.id;
          return (
            <li key={location.id} className="locations-list__item">
              {isEditing ? (
                <LocationForm
                  draft={draft}
                  setDraft={setDraft}
                  onSubmit={submitDraft}
                  onCancel={cancelEdit}
                  saveState={saveState}
                  submitLabel="Save location"
                />
              ) : (
                <div className="locations-list__row">
                  <div>
                    <strong>{location.name}</strong>
                    {location.id === defaultLocationId ? (
                      <span className="locations-default-tag"> · Default</span>
                    ) : null}
                    <p className="settings-panel-help">
                      {[location.addressLine1, location.city, location.state, location.postalCode]
                        .filter(Boolean)
                        .join(", ") || "No address on file"}
                    </p>
                    <p className="settings-panel-help">
                      {location.phone ? `Phone: ${location.phone}` : "No phone"} · {location.timeZone}
                    </p>
                    {!location.isActive ? (
                      <p className="settings-panel-help">Inactive</p>
                    ) : null}
                  </div>
                  {canManageSettings ? (
                    <div className="locations-list__actions">
                      <button type="button" className="ghost-action" onClick={() => beginEdit(location)}>
                        Edit
                      </button>
                      {location.isActive ? (
                        <button
                          type="button"
                          className="ghost-action"
                          onClick={() => void deactivate(location)}
                          disabled={location.id === defaultLocationId}
                          title={
                            location.id === defaultLocationId
                              ? "Cannot deactivate the default location."
                              : undefined
                          }
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ghost-action"
                          onClick={() => void reactivate(location)}
                        >
                          Reactivate
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canManageSettings ? (
        showCreate ? (
          <LocationForm
            draft={draft}
            setDraft={setDraft}
            onSubmit={submitDraft}
            onCancel={cancelEdit}
            saveState={saveState}
            submitLabel="Create location"
          />
        ) : (
          <div className="settings-actions">
            <button type="button" className="primary-action" onClick={beginCreate}>
              Add location
            </button>
          </div>
        )
      ) : (
        <p className="settings-permission-note">You do not have permission to edit locations.</p>
      )}

      {!showCreate && editingId === null && saveState.kind === "success" ? (
        <p role="status" className="settings-status">{saveState.message}</p>
      ) : null}
      {!showCreate && editingId === null && saveState.kind === "error" ? (
        <p role="alert" className="settings-error">{saveState.message}</p>
      ) : null}
    </div>
  );
}

function LocationForm({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  saveState,
  submitLabel,
}: {
  draft: LocationDraft;
  setDraft: (draft: LocationDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  saveState: SaveState;
  submitLabel: string;
}) {
  const disabled = saveState.kind === "submitting";
  return (
    <form className="settings-form" onSubmit={onSubmit}>
      <label>
        <span>Location name</span>
        <input
          type="text"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          disabled={disabled}
          required
        />
      </label>
      <label>
        <span>Time zone (IANA)</span>
        <input
          type="text"
          value={draft.timeZone}
          onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
          placeholder="America/Los_Angeles"
          disabled={disabled}
          required
        />
      </label>
      <label>
        <span>Address</span>
        <input
          type="text"
          value={draft.addressLine1}
          onChange={(event) => setDraft({ ...draft, addressLine1: event.target.value })}
          disabled={disabled}
        />
      </label>
      <label>
        <span>City</span>
        <input
          type="text"
          value={draft.city}
          onChange={(event) => setDraft({ ...draft, city: event.target.value })}
          disabled={disabled}
        />
      </label>
      <label>
        <span>State / region</span>
        <input
          type="text"
          value={draft.state}
          onChange={(event) => setDraft({ ...draft, state: event.target.value })}
          disabled={disabled}
        />
      </label>
      <label>
        <span>Postal code</span>
        <input
          type="text"
          value={draft.postalCode}
          onChange={(event) => setDraft({ ...draft, postalCode: event.target.value })}
          disabled={disabled}
        />
      </label>
      <label>
        <span>Phone</span>
        <input
          type="tel"
          value={draft.phone}
          onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
          disabled={disabled}
        />
      </label>
      {saveState.kind === "error" ? <p role="alert" className="settings-error">{saveState.message}</p> : null}
      <div className="settings-actions">
        <button type="submit" className="primary-action" disabled={disabled}>
          {disabled ? "Saving…" : submitLabel}
        </button>
        <button type="button" className="ghost-action" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
      </div>
    </form>
  );
}
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function BrandingSection({
  canManageSettings,
  tenant,
  onTenantUpdated,
  tenantSlug,
}: {
  canManageSettings: boolean;
  tenant: TenantSummary | null;
  onTenantUpdated: (tenant: TenantSummary) => void;
  tenantSlug: string;
}) {
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [faviconUrl, setFaviconUrl] = useState<string>("");
  const [primaryColor, setPrimaryColor] = useState<string>("#9f5323");
  const [accentColor, setAccentColor] = useState<string>("#7a3c13");
  const [photosText, setPhotosText] = useState<string>("");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (tenant) {
      const branding: TenantBranding = tenant.branding ?? {};
      setLogoUrl(branding.logoUrl ?? "");
      setFaviconUrl(branding.faviconUrl ?? "");
      setPrimaryColor(branding.primaryColor ?? "#9f5323");
      setAccentColor(branding.accentColor ?? "#7a3c13");
      setPhotosText((branding.photos ?? []).join("\n"));
    }
  }, [tenant]);

  const parsedPhotos = useMemo(
    () =>
      photosText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    [photosText],
  );

  const validationMessage = useMemo(() => {
    if (primaryColor.trim() && !HEX_COLOR_RE.test(primaryColor.trim())) {
      return "Primary color must be a #RGB or #RRGGBB hex value.";
    }
    if (accentColor.trim() && !HEX_COLOR_RE.test(accentColor.trim())) {
      return "Accent color must be a #RGB or #RRGGBB hex value.";
    }
    return null;
  }, [primaryColor, accentColor]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageSettings || validationMessage !== null) return;
    setSaveState({ kind: "submitting" });
    try {
      const updated = await platformApi.updateTenantBranding(tenantSlug, {
        logoUrl: logoUrl.trim(),
        faviconUrl: faviconUrl.trim(),
        primaryColor: primaryColor.trim() || null,
        accentColor: accentColor.trim() || null,
        photos: parsedPhotos,
      });
      onTenantUpdated(updated);
      setSaveState({ kind: "success", message: "Branding saved." });
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to save branding.",
      });
    }
  };

  if (tenant === null) {
    return <p>Loading current settings…</p>;
  }

  const disabled = !canManageSettings || saveState.kind === "submitting";

  return (
    <form className="settings-form branding-section" onSubmit={handleSubmit}>
      <div className="settings-form-row">
        <label className="settings-field">
          <span>Logo URL</span>
          <input
            type="url"
            value={logoUrl}
            onChange={(event) => setLogoUrl(event.target.value)}
            disabled={disabled}
            maxLength={2048}
            placeholder="https://cdn.example.com/logo.png"
          />
        </label>
        <label className="settings-field">
          <span>Favicon URL</span>
          <input
            type="url"
            value={faviconUrl}
            onChange={(event) => setFaviconUrl(event.target.value)}
            disabled={disabled}
            maxLength={2048}
            placeholder="https://cdn.example.com/favicon.ico"
          />
        </label>
      </div>

      <div className="settings-form-row">
        <label className="settings-field branding-color-field">
          <span>Primary color</span>
          <div className="branding-color-input">
            <input
              type="color"
              value={HEX_COLOR_RE.test(primaryColor.trim()) ? primaryColor.trim() : "#9f5323"}
              onChange={(event) => setPrimaryColor(event.target.value)}
              disabled={disabled}
              aria-label="Primary color picker"
            />
            <input
              type="text"
              value={primaryColor}
              onChange={(event) => setPrimaryColor(event.target.value)}
              disabled={disabled}
              maxLength={16}
              aria-label="Primary color hex"
            />
          </div>
        </label>
        <label className="settings-field branding-color-field">
          <span>Accent color</span>
          <div className="branding-color-input">
            <input
              type="color"
              value={HEX_COLOR_RE.test(accentColor.trim()) ? accentColor.trim() : "#7a3c13"}
              onChange={(event) => setAccentColor(event.target.value)}
              disabled={disabled}
              aria-label="Accent color picker"
            />
            <input
              type="text"
              value={accentColor}
              onChange={(event) => setAccentColor(event.target.value)}
              disabled={disabled}
              maxLength={16}
              aria-label="Accent color hex"
            />
          </div>
        </label>
      </div>

      <label className="settings-field">
        <span>Gallery photo URLs</span>
        <textarea
          value={photosText}
          onChange={(event) => setPhotosText(event.target.value)}
          disabled={disabled}
          rows={4}
          placeholder={"https://cdn.example.com/photo1.jpg\nhttps://cdn.example.com/photo2.jpg"}
        />
        <span className="settings-field-help">One URL per line.</span>
      </label>

      <div className="branding-preview" aria-label="Brand preview">
        <span className="branding-preview__label">Preview</span>
        <span
          className="branding-preview__swatch"
          style={{ backgroundColor: HEX_COLOR_RE.test(primaryColor.trim()) ? primaryColor.trim() : "transparent" }}
          aria-label="Primary color swatch"
        />
        <span
          className="branding-preview__swatch"
          style={{ backgroundColor: HEX_COLOR_RE.test(accentColor.trim()) ? accentColor.trim() : "transparent" }}
          aria-label="Accent color swatch"
        />
        {parsedPhotos.length > 0 ? (
          <span className="branding-preview__count">{parsedPhotos.length} gallery photo{parsedPhotos.length === 1 ? "" : "s"}</span>
        ) : null}
      </div>

      {validationMessage ? <p role="alert" className="settings-error">{validationMessage}</p> : null}
      {saveState.kind === "success" ? <p role="status" className="settings-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="settings-error">{saveState.message}</p> : null}

      <div className="settings-actions">
        <button
          type="submit"
          className="primary-action"
          disabled={disabled || validationMessage !== null}
        >
          {saveState.kind === "submitting" ? "Saving…" : "Save branding"}
        </button>
        {!canManageSettings ? (
          <p className="settings-permission-note">You do not have permission to edit branding.</p>
        ) : null}
      </div>
    </form>
  );
}

function PayrollSection() {
  return (
    <div className="payroll-section">
      <p className="payroll-section__lead">
        Connect a bank account to run provider payroll directly from your booking platform.
      </p>
      <ul className="payroll-section__bullets">
        <li>Calculate commissions per booking, service, or provider.</li>
        <li>Schedule weekly or biweekly payouts to provider bank accounts.</li>
        <li>Track tips, deductions, and 1099/contractor totals automatically.</li>
      </ul>
      <div className="payroll-section__cta">
        <button type="button" className="primary-action" disabled>
          Connect bank account
        </button>
        <p className="settings-permission-note">
          Bank-account onboarding ships in a later release. We'll email you when it's ready.
        </p>
      </div>
    </div>
  );
}

function ClientOwnershipSection({
  canManageSettings,
  tenant,
  onTenantUpdated,
  tenantSlug,
}: {
  canManageSettings: boolean;
  tenant: TenantSummary | null;
  onTenantUpdated: (tenant: TenantSummary) => void;
  tenantSlug: string;
}) {
  const [clientOwnershipEnabled, setClientOwnershipEnabled] = useState<boolean>(false);
  const [onlineAssignEnabled, setOnlineAssignEnabled] = useState<boolean>(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (tenant) {
      setClientOwnershipEnabled(Boolean(tenant.settings?.clientOwnershipEnabled));
      setOnlineAssignEnabled(Boolean(tenant.settings?.onlineBookingOwnerAssignmentEnabled));
    }
  }, [tenant]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageSettings) return;
    setSaveState({ kind: "submitting" });
    try {
      const updated = await platformApi.updateTenantClientOwnership(tenantSlug, {
        clientOwnershipEnabled,
        onlineBookingOwnerAssignmentEnabled: onlineAssignEnabled,
      });
      onTenantUpdated(updated);
      setSaveState({ kind: "success", message: "Client ownership saved." });
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to save client ownership.",
      });
    }
  };

  if (tenant === null) {
    return <p>Loading current settings…</p>;
  }

  const disabled = !canManageSettings || saveState.kind === "submitting";

  return (
    <form className="settings-form client-ownership-section" onSubmit={handleSubmit}>
      <p className="settings-form-help">
        When client ownership is on, providers can only see customers assigned to them. Owners and
        managers always see all customers.
      </p>
      <label className="settings-toggle-field">
        <input
          type="checkbox"
          checked={clientOwnershipEnabled}
          onChange={(event) => setClientOwnershipEnabled(event.target.checked)}
          disabled={disabled}
        />
        <span>
          <strong>Enable client ownership</strong>
          <small>Scope the customer list for non-manager roles to clients they own.</small>
        </span>
      </label>
      <label className="settings-toggle-field">
        <input
          type="checkbox"
          checked={onlineAssignEnabled}
          onChange={(event) => setOnlineAssignEnabled(event.target.checked)}
          disabled={disabled}
        />
        <span>
          <strong>Assign owner on online bookings</strong>
          <small>
            When a new customer books online, set their owner to the booked provider's user
            account. Existing customers are never reassigned.
          </small>
        </span>
      </label>

      {saveState.kind === "success" ? <p role="status" className="settings-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="settings-error">{saveState.message}</p> : null}

      <div className="settings-actions">
        <button type="submit" className="primary-action" disabled={disabled}>
          {saveState.kind === "submitting" ? "Saving…" : "Save client ownership"}
        </button>
        {!canManageSettings ? (
          <p className="settings-permission-note">You do not have permission to edit client ownership.</p>
        ) : null}
      </div>
    </form>
  );
}

function CustomEmailSection({
  canManageSettings,
  tenant,
  onTenantUpdated,
  tenantSlug,
}: {
  canManageSettings: boolean;
  tenant: TenantSummary | null;
  onTenantUpdated: (tenant: TenantSummary) => void;
  tenantSlug: string;
}) {
  const [fromAddress, setFromAddress] = useState<string>("");
  const [domain, setDomain] = useState<string>("");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [records, setRecords] = useState<EmailDnsRecord[]>([]);
  const [dnsDomain, setDnsDomain] = useState<string | null>(null);
  const [dnsError, setDnsError] = useState<string | null>(null);

  useEffect(() => {
    if (tenant) {
      setFromAddress(tenant.settings.customEmail?.fromAddress ?? "");
      setDomain(tenant.settings.customEmail?.domain ?? "");
    }
  }, [tenant]);

  useEffect(() => {
    const configuredDomain = tenant?.settings.customEmail?.domain ?? null;
    if (!configuredDomain) {
      setRecords([]);
      setDnsDomain(null);
      setDnsError(null);
      return;
    }
    let cancelled = false;
    platformApi
      .getTenantEmailDns(tenantSlug)
      .then((response) => {
        if (cancelled) return;
        setRecords(response.records);
        setDnsDomain(response.domain);
        setDnsError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDnsError(error instanceof Error ? error.message : "Unable to load DNS records.");
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, tenant?.settings.customEmail?.domain]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageSettings) return;
    setSaveState({ kind: "submitting" });
    try {
      const updated = await platformApi.updateTenantCustomEmail(tenantSlug, {
        fromAddress: fromAddress.trim() === "" ? null : fromAddress.trim(),
        domain: domain.trim() === "" ? null : domain.trim(),
      });
      onTenantUpdated(updated);
      setSaveState({ kind: "success", message: "Custom email settings saved." });
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to save custom email.",
      });
    }
  };

  if (tenant === null) {
    return <p>Loading current settings…</p>;
  }

  const disabled = !canManageSettings || saveState.kind === "submitting";
  const verified = Boolean(tenant.settings.customEmail?.verified);

  return (
    <form className="settings-form custom-email-section" onSubmit={handleSubmit}>
      <p className="settings-form-help">
        Use your own domain for outgoing emails. After saving, add the DNS records below at your
        domain registrar.
      </p>
      <label className="settings-field">
        <span>From address</span>
        <input
          type="text"
          value={fromAddress}
          onChange={(event) => setFromAddress(event.target.value)}
          placeholder="hello@yourdomain.com"
          disabled={disabled}
        />
      </label>
      <label className="settings-field">
        <span>Sending domain</span>
        <input
          type="text"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="yourdomain.com"
          disabled={disabled}
        />
      </label>

      {saveState.kind === "success" ? <p role="status" className="settings-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="settings-error">{saveState.message}</p> : null}

      <div className="settings-actions">
        <button type="submit" className="primary-action" disabled={disabled}>
          {saveState.kind === "submitting" ? "Saving…" : "Save custom email"}
        </button>
        {!canManageSettings ? (
          <p className="settings-permission-note">You do not have permission to edit custom email.</p>
        ) : null}
      </div>

      <div className="settings-subsection">
        <h5>DNS records</h5>
        {dnsError ? <p role="alert" className="settings-error">{dnsError}</p> : null}
        {dnsDomain === null || records.length === 0 ? (
          <p className="settings-form-help">Save a sending domain to see the records you need to add.</p>
        ) : (
          <table className="settings-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Host</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={`${record.type}-${record.host}`}>
                  <td>{record.type}</td>
                  <td><code>{record.host}</code></td>
                  <td><code>{record.value}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="settings-actions">
          <button type="button" className="primary-action" disabled aria-disabled="true">
            {verified ? "Verified" : "Verify"}
          </button>
          <p className="settings-permission-note">Verification ships in a later release.</p>
        </div>
      </div>
    </form>
  );
}

function WalletMembershipSection({
  canManageSettings,
  tenant,
  onTenantUpdated,
  tenantSlug,
}: {
  canManageSettings: boolean;
  tenant: TenantSummary | null;
  onTenantUpdated: (tenant: TenantSummary) => void;
  tenantSlug: string;
}) {
  const [walletEnabled, setWalletEnabled] = useState<boolean>(false);
  const [walletExpiration, setWalletExpiration] = useState<string>("");
  const [membershipEnabled, setMembershipEnabled] = useState<boolean>(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (tenant) {
      setWalletEnabled(Boolean(tenant.settings.walletEnabled));
      setWalletExpiration(
        tenant.settings.walletExpirationMonths === null ||
          tenant.settings.walletExpirationMonths === undefined
          ? ""
          : String(tenant.settings.walletExpirationMonths),
      );
      setMembershipEnabled(Boolean(tenant.settings.membershipEnabled));
    }
  }, [tenant]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageSettings) return;
    let expirationValue: number | null = null;
    if (walletExpiration.trim() !== "") {
      const parsed = Number.parseInt(walletExpiration.trim(), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setSaveState({
          kind: "error",
          message: "Wallet expiration must be a positive whole number of months, or blank.",
        });
        return;
      }
      expirationValue = parsed;
    }
    setSaveState({ kind: "submitting" });
    try {
      const updated = await platformApi.updateTenantWalletMembership(tenantSlug, {
        walletEnabled,
        walletExpirationMonths: expirationValue,
        membershipEnabled,
      });
      onTenantUpdated(updated);
      setSaveState({ kind: "success", message: "Wallet & membership saved." });
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to save wallet & membership.",
      });
    }
  };

  if (tenant === null) {
    return <p>Loading current settings…</p>;
  }

  const disabled = !canManageSettings || saveState.kind === "submitting";

  return (
    <form className="settings-form wallet-membership-section" onSubmit={handleSubmit}>
      <p className="settings-form-help">
        Toggle wallet credit and membership programs. Balances and tiers are not yet implemented;
        these flags reserve the capability for future releases.
      </p>
      <label className="settings-toggle-field">
        <input
          type="checkbox"
          checked={walletEnabled}
          onChange={(event) => setWalletEnabled(event.target.checked)}
          disabled={disabled}
        />
        <span>
          <strong>Enable wallet credit</strong>
          <small>Allow customer balances to be applied at checkout in a later release.</small>
        </span>
      </label>
      <label className="settings-field">
        <span>Wallet credit expiration (months)</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={walletExpiration}
          onChange={(event) => setWalletExpiration(event.target.value)}
          placeholder="Leave blank for no expiration"
          disabled={disabled || !walletEnabled}
        />
      </label>
      <label className="settings-toggle-field">
        <input
          type="checkbox"
          checked={membershipEnabled}
          onChange={(event) => setMembershipEnabled(event.target.checked)}
          disabled={disabled}
        />
        <span>
          <strong>Enable membership program</strong>
          <small>Reserve a paid-membership tier for future pricing/perks features.</small>
        </span>
      </label>

      {saveState.kind === "success" ? <p role="status" className="settings-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="settings-error">{saveState.message}</p> : null}

      <div className="settings-actions">
        <button type="submit" className="primary-action" disabled={disabled}>
          {saveState.kind === "submitting" ? "Saving…" : "Save wallet & membership"}
        </button>
        {!canManageSettings ? (
          <p className="settings-permission-note">You do not have permission to edit wallet & membership.</p>
        ) : null}
      </div>
    </form>
  );
}
