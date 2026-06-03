import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { SUPPORTED_CURRENCIES, type AuthenticatedUser, type SessionResponse, type TenantSummary } from "@booking/shared-types";

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
    status: "planned",
    plannedPhase: "Phase 4",
  },
  {
    id: "locations",
    title: "Locations",
    eyebrow: "Business setup",
    description: "Manage studio locations, addresses, and per-location phones.",
    status: "planned",
    plannedPhase: "Phase 5",
  },
  {
    id: "branding",
    title: "Logo & Branding",
    eyebrow: "Business setup",
    description: "Logo URL, favicon, gallery photos, and brand colors.",
    status: "planned",
    plannedPhase: "Phase 6",
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
    status: "planned",
    plannedPhase: "Phase 7",
  },
  {
    id: "client-ownership",
    title: "Client Ownership",
    eyebrow: "Advanced",
    description: "Restrict customer visibility to the assigned provider.",
    status: "planned",
    plannedPhase: "Phase 8",
  },
  {
    id: "custom-email",
    title: "Custom Email",
    eyebrow: "Advanced",
    description: "Send notifications from your own domain.",
    status: "planned",
    plannedPhase: "Phase 9",
  },
  {
    id: "wallet-membership",
    title: "Wallet & Membership",
    eyebrow: "Advanced",
    description: "Enable wallet credit and membership program toggles.",
    status: "planned",
    plannedPhase: "Phase 10",
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
      <section className="ops-hero ops-hero--compact">
        <div className="ops-hero-copy">
          <p className="eyebrow">{definition.eyebrow}</p>
          <h3>{definition.title}</h3>
          <p>{definition.description}</p>
        </div>
      </section>

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
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (tenant) {
      setStartHour(tenant.settings.calendarDisplayStartHour);
      setEndHour(tenant.settings.calendarDisplayEndHour);
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

export type { RouteDefinitionLike as SettingsRouteDefinition };
export type SettingsPageSession = SessionResponse;
