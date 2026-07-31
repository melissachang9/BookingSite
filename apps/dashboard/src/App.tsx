import "@booking/ui-components/styles.css";

import { startTransition, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type {
  AuthenticatedUser,
  CreateTenantRequest,
  CreateTenantResponse,
  SessionResponse,
  TenantSummary,
} from "@booking/shared-types";

import {
  apiBaseUrl,
  clearStoredAuthNotice,
  clearStoredRedirectPath,
  clearStoredSession,
  ensureActiveStoredSession,
  platformApi,
  readStoredAuthNotice,
  readStoredRedirectPath,
  readStoredSession,
  subscribeToStoredSession,
  writeStoredRedirectPath,
  writeStoredSession,
} from "./platform-api";
import { CalendarPage } from "./calendar-page";
import { PaymentsPage } from "./payments-page";
import { SettingsPage } from "./settings-page";
import { StaffPage } from "./staff-page";
import { ServicesPage } from "./services-page";
import { CustomersPage } from "./customers-page";
import { LocationsPage } from "./locations-page";
import { FormsPage } from "./forms-page";
import { ResourcesPage } from "./resources-page";
import "./styles.css";

type RouteGroupKey = "settings-management";

type RouteDefinition = {
  path: string;
  title: string;
  eyebrow: string;
  description: string;
  metric: string;
  tone: "ready" | "progress" | "planned";
  workstreams: string[];
  actions: string[];
  group?: RouteGroupKey;
};

type RouteGroupDefinition = {
  key: RouteGroupKey;
  title: string;
  eyebrow: string;
  childPaths: string[];
};

type LoginState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

type OnboardingFormState = {
  name: string;
  slug: string;
  timezone: string;
  locationName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  homepageUrl: string;
  primaryColor: string;
  accentColor: string;
};

type OnboardingSaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "success"; message: string; result: CreateTenantResponse; password: string }
  | { kind: "error"; message: string };

type OwnerSignInState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

const demoOwnerEmail = "owner@browbeautylab.test";
const demoOwnerPassword = "DemoBooking123";
const storefrontBaseUrl = import.meta.env.VITE_PUBLIC_STOREFRONT_BASE_URL ?? "http://127.0.0.1:3001";

const routeDefinitions: RouteDefinition[] = [
  {
    path: "/calendar",
    title: "Calendar",
    eyebrow: "",
    description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
    metric: "Live availability",
    tone: "ready",
    workstreams: ["Provider week view", "Manual booking drawer", "Service and location filters"],
    actions: ["Select a slot", "Start customer search", "Send deposit link"],
  },
  {
    path: "/payments",
    title: "Payments",
    eyebrow: "Checkout and balance",
    description: "Deposits, hosted balance checkout, POS collection, corrections, and follow-up balances.",
    metric: "Ledger model ready",
    tone: "progress",
    workstreams: ["Balance follow-up", "External POS exact amount", "Checkout audit events"],
    actions: ["Collect balance", "Send checkout", "Review exceptions"],
  },
  {
    path: "/customers",
    title: "Customers",
    eyebrow: "Unified record",
    description: "Customer profiles that connect contact data, booking history, forms, payments, and attribution.",
    metric: "Profile APIs next",
    tone: "progress",
    workstreams: ["Customer lookup", "Internal forms", "Visit history"],
    actions: ["Find customer", "Open profile", "Add internal note"],
  },
  {
    path: "/locations",
    title: "Locations",
    eyebrow: "Multi-location setup",
    description: "Location-aware services, providers, schedules, and customer booking filters.",
    metric: "Foundation planned",
    tone: "planned",
    workstreams: ["Location catalog", "Provider links", "Service availability"],
    actions: ["Add location", "Assign staff", "Audit coverage"],
  },
  {
    path: "/services",
    title: "Services",
    eyebrow: "Catalog",
    description: "Pricing, deposits, durations, buffers, provider overrides, and form attachments.",
    metric: "Catalog contracts",
    tone: "progress",
    workstreams: ["Service editing", "Form requirements", "Deposit defaults"],
    actions: ["Edit service", "Attach forms", "Preview storefront"],
    group: "settings-management",
  },
  {
    path: "/forms",
    title: "Forms",
    eyebrow: "Unified forms",
    description: "Versioned customer and internal forms with scope, timing, response visibility, and audit history.",
    metric: "Scope locked",
    tone: "progress",
    workstreams: ["Customer-facing forms", "Internal forms", "Versioned responses"],
    actions: ["Review requirements", "Build form", "View responses"],
  },
  {
    path: "/settings",
    title: "Settings",
    eyebrow: "Tenant policy",
    description: "Cancellation windows, refunds, reminders, deposits, taxes, payment links, and branding settings.",
    metric: "Policy source",
    tone: "progress",
    workstreams: ["Booking policies", "Payment settings", "Branding"],
    actions: ["Update policy", "Review defaults", "Publish storefront"],
    group: "settings-management",
  },
  {
    path: "/staff",
    title: "Staff",
    eyebrow: "Team & providers",
    description: "Sign-in users, service providers, schedules, and direct booking links — all in one place.",
    metric: "Unified",
    tone: "progress",
    workstreams: ["User accounts", "Provider services & locations", "Direct booking link"],
    actions: ["Add staff", "Assign services", "Toggle online booking"],
    group: "settings-management",
  },
  {
    path: "/resources",
    title: "Resources",
    eyebrow: "Rooms and equipment",
    description: "Schedulable resources such as treatment rooms, chairs, and equipment that gate service availability.",
    metric: "Planned",
    tone: "planned",
    workstreams: ["Resource catalog", "Service requirements", "Conflict prevention"],
    actions: ["Add resource", "Attach to service", "Block resource"],
    group: "settings-management",
  },
  {
    path: "/onboarding",
    title: "Onboarding",
    eyebrow: "Launch readiness",
    description: "Tenant setup, import readiness, catalog health, payment setup, and operational launch blockers.",
    metric: "Launch checklist",
    tone: "planned",
    workstreams: ["Tenant setup", "Data import", "Go-live review"],
    actions: ["Complete setup", "Validate imports", "Invite staff"],
  },
];

const routeGroupDefinitions: RouteGroupDefinition[] = [
  {
    key: "settings-management",
    title: "Settings & Management",
    eyebrow: "Configure your studio",
    childPaths: ["/settings", "/services", "/staff", "/resources"],
  },
];

const topPriorities = [
  { label: "Calendar-first booking", value: "Live", detail: "Availability is already backend-backed for demo tenants." },
  { label: "Payment follow-up", value: "Queued", detail: "UI patterns now separate balance work from recent activity." },
  { label: "Forms", value: "Scoped", detail: "Customer-facing and internal forms stay permission-separated." },
  { label: "Tenant safety", value: "Required", detail: "Every future list and action must be tenant-filtered." },
];

const operatorQueues = [
  { title: "Bookings needing attention", count: "API", detail: "Confirmed, canceled, no-show, and completion queues will bind to booking list endpoints." },
  { title: "Balance follow-up", count: "Next", detail: "Completed bookings with follow-up outcomes need a dedicated payment work queue." },
  { title: "Form tasks", count: "Soon", detail: "Pre-booking gates, pre-visit reminders, and internal forms stay distinct." },
];

const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  month: "short",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hour: "numeric",
  minute: "2-digit",
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function getStatusLabel(tone: RouteDefinition["tone"]): string {
  if (tone === "ready") {
    return "Ready";
  }

  if (tone === "progress") {
    return "In build";
  }

  return "Planned";
}

function formatMoney(cents: number): string {
  return currencyFormatter.format(cents / 100);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${dayLabelFormatter.format(date)} at ${timeFormatter.format(date)}`;
}

function parseMoneyInput(value: string): number | null {
  const normalizedValue = value.replace(/[$,\s]/g, "");
  if (!normalizedValue) {
    return null;
  }

  const parsedValue = Number(normalizedValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return Math.round(parsedValue * 100);
}

const pageByPath = new Map(routeDefinitions.map((definition) => [definition.path.replace(/^\//, ""), definition]));
const protectedRouteDefinitions = routeDefinitions.filter(
  (definition) => definition.path !== "/onboarding",
);

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((permission) => permission.key === key && permission.allowed);
}

function getAuthNoticeMessage(): string | null {
  const notice = readStoredAuthNotice();
  if (notice === "session-expired") {
    return "Your session has expired. Please sign in again.";
  }
  return null;
}

function LoginRedirect() {
  const redirectPathRef = useRef<string>(readStoredRedirectPath() ?? "/calendar");

  useEffect(() => {
    clearStoredRedirectPath();
  }, []);

  return <Navigate to={redirectPathRef.current} replace />;
}

function RequireLoginRedirect() {
  const location = useLocation();

  useEffect(() => {
    writeStoredRedirectPath(`${location.pathname}${location.search}${location.hash}`);
  }, [location.hash, location.pathname, location.search]);

  return <Navigate to="/login" replace />;
}

function AuthenticatedLayout({
  session,
  onSignOut,
}: {
  session: SessionResponse;
  onSignOut: () => void;
}) {
  const location = useLocation();
  const pathKey = location.pathname === "/" ? "calendar" : location.pathname.replace(/^\//, "");
  const isCalendarRoute = pathKey === "calendar";
  const currentDefinition = pageByPath.get(pathKey) ?? pageByPath.get("calendar") ?? routeDefinitions[0];

  const activePath = location.pathname === "/" ? "/calendar" : location.pathname;
  const groupedPathsByGroup = useMemo(() => {
    const map = new Map<RouteGroupKey, RouteDefinition[]>();
    for (const definition of routeDefinitions) {
      if (!definition.group) continue;
      const list = map.get(definition.group) ?? [];
      list.push(definition);
      map.set(definition.group, list);
    }
    return map;
  }, []);
  const groupContainsActive = (groupKey: RouteGroupKey) => {
    const children = groupedPathsByGroup.get(groupKey) ?? [];
    return children.some((definition) => activePath === definition.path || activePath.startsWith(`${definition.path}/`));
  };
  const [expandedGroups, setExpandedGroups] = useState<Record<RouteGroupKey, boolean>>(() => {
    const initial = {} as Record<RouteGroupKey, boolean>;
    for (const group of routeGroupDefinitions) {
      initial[group.key] = groupContainsActive(group.key);
    }
    return initial;
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("booking.dashboard.sidebar-collapsed") === "true";
  });
  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem("booking.dashboard.sidebar-collapsed", String(next));
      return next;
    });
  };
  useEffect(() => {
    setExpandedGroups((current) => {
      let next = current;
      for (const group of routeGroupDefinitions) {
        if (groupContainsActive(group.key) && !current[group.key]) {
          if (next === current) {
            next = { ...current };
          }
          next[group.key] = true;
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  const toggleGroup = (key: RouteGroupKey) => {
    setExpandedGroups((current) => ({ ...current, [key]: !current[key] }));
  };

  const topLevelDefinitions = routeDefinitions.filter(
    (definition) => definition.path !== "/onboarding" && !definition.group,
  );

  return (
    <div className={`ops-shell${isCalendarRoute ? " ops-shell--calendar" : ""}${sidebarCollapsed ? " ops-shell--sidebar-collapsed" : ""}`}>
      <aside className={`ops-sidebar${isCalendarRoute ? " ops-sidebar--calendar" : ""}`}>
        <div className="ops-sidebar-brand" aria-label="Dashboard workspace">
          <span className="ops-sidebar-brand__mark" aria-hidden="true" />
          <div>
            <strong>Brow Beauty Lab</strong>
            <span>Operator desk</span>
          </div>
          <button
            type="button"
            className="ops-sidebar-collapse"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          >
            {sidebarCollapsed ? "»" : "«"}
          </button>
        </div>

        {isCalendarRoute ? <div id="dashboard-calendar-sidebar-rail" className="ops-sidebar-calendar-slot" aria-label="Sidebar month calendar" /> : null}

        <nav className="ops-nav" aria-label="Dashboard sections">
          {topLevelDefinitions.map((definition) => (
            <NavLink
              key={definition.path}
              to={definition.path}
              end={definition.path === "/calendar"}
              className={({ isActive }) => `ops-nav-link${isActive ? " ops-nav-link--active" : ""}`}
            >
              <span>{definition.title}</span>
              <small>{definition.metric}</small>
            </NavLink>
          ))}

          {routeGroupDefinitions.map((group) => {
            const children = groupedPathsByGroup.get(group.key) ?? [];
            if (children.length === 0) return null;
            const isExpanded = expandedGroups[group.key];
            const groupActive = groupContainsActive(group.key);
            return (
              <div
                key={group.key}
                className={`ops-nav-group${isExpanded ? " ops-nav-group--expanded" : ""}${groupActive ? " ops-nav-group--active" : ""}`}
              >
                <button
                  type="button"
                  className="ops-nav-group__header"
                  aria-expanded={isExpanded}
                  aria-controls={`ops-nav-group-${group.key}`}
                  onClick={() => toggleGroup(group.key)}
                >
                  <span className="ops-nav-group__title">{group.title}</span>
                  <span className="ops-nav-group__chevron" aria-hidden="true">
                    {isExpanded ? "▾" : "▸"}
                  </span>
                </button>
                {isExpanded ? (
                  <div className="ops-nav-group__children" id={`ops-nav-group-${group.key}`}>
                    {children.map((definition) => (
                      <NavLink
                        key={definition.path}
                        to={definition.path}
                        className={({ isActive }) =>
                          `ops-nav-link ops-nav-link--child${isActive ? " ops-nav-link--active" : ""}`
                        }
                      >
                        <span>{definition.title}</span>
                        <small>{definition.metric}</small>
                      </NavLink>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        {isCalendarRoute ? (
          <div className="sidebar-filters">
            <div className="sidebar-filters__head">
              <span>Service types</span>
              <span>▾</span>
            </div>
            <label className="sidebar-filter-check">
              <input type="checkbox" defaultChecked />
              <span className="sidebar-filter-check__box">✓</span>
              <span className="sidebar-filter-dot" style={{ background: "var(--ui-cat-pink-bar)" }} />
              Facials
            </label>
            <label className="sidebar-filter-check">
              <input type="checkbox" defaultChecked />
              <span className="sidebar-filter-check__box">✓</span>
              <span className="sidebar-filter-dot" style={{ background: "var(--ui-cat-blue-bar)" }} />
              Injectables
            </label>
            <label className="sidebar-filter-check">
              <input type="checkbox" defaultChecked />
              <span className="sidebar-filter-check__box">✓</span>
              <span className="sidebar-filter-dot" style={{ background: "var(--ui-cat-peach-bar)" }} />
              Laser &amp; skin
            </label>
            <label className="sidebar-filter-check">
              <input type="checkbox" defaultChecked />
              <span className="sidebar-filter-check__box">✓</span>
              <span className="sidebar-filter-dot" style={{ background: "var(--ui-cat-purple-bar)" }} />
              Peels
            </label>
            <label className="sidebar-filter-check">
              <input type="checkbox" defaultChecked />
              <span className="sidebar-filter-check__box">✓</span>
              <span className="sidebar-filter-dot" style={{ background: "var(--ui-cat-green-bar)" }} />
              Massage
            </label>
            <label className="sidebar-filter-check">
              <input type="checkbox" defaultChecked />
              <span className="sidebar-filter-check__box">✓</span>
              <span className="sidebar-filter-dot" style={{ background: "var(--ui-cat-teal-bar)" }} />
              Consultation
            </label>

            <div className="sidebar-filters__head" style={{ marginTop: "0.5rem" }}>
              <span>Status</span>
            </div>
            <div className="sidebar-legend">
              <div className="sidebar-legend__row">
                <span className="sidebar-legend__swatch sidebar-legend__swatch--service" />
                Booked · service color
              </div>
              <div className="sidebar-legend__row">
                <span className="sidebar-legend__swatch sidebar-legend__swatch--active" />
                In progress · checked in
              </div>
              <div className="sidebar-legend__row">
                <span className="sidebar-legend__swatch sidebar-legend__swatch--done" />
                Checked out · completed
              </div>
              <div className="sidebar-legend__row">
                <span className="sidebar-legend__swatch sidebar-legend__swatch--canceled" />
                Canceled · no-show
              </div>
            </div>
          </div>
        ) : null}

      </aside>

      <div className="ops-main">
        <button
          type="button"
          className="ops-sidebar-reopen"
          onClick={toggleSidebar}
          aria-label="Show sidebar"
        >
          » Menu
        </button>
        <header className="ops-topbar">
          <div>
            {isCalendarRoute ? (
              <div className="ops-topbar-search">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>
                <input placeholder="Search appointments, customers…" />
              </div>
            ) : (
              <>
                {currentDefinition.eyebrow ? <p className="eyebrow">{currentDefinition.eyebrow}</p> : null}
                <h2>{currentDefinition.title}</h2>
              </>
            )}
          </div>

          <div className="ops-topbar-actions">
            <div className="user-pill">
              <span>{session.user.role}</span>
              <strong>{session.user.name}</strong>
            </div>
            <a href={`${storefrontBaseUrl}/${session.user.tenantSlug}`} target="_blank" rel="noreferrer" className="ghost-action">
              Open storefront
            </a>
            <button type="button" className="ghost-action" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </header>

        <Outlet />
      </div>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(() => readStoredSession());
  const [tenantSummary, setTenantSummary] = useState<TenantSummary | null>(null);
  const onboardingDefinition = pageByPath.get("onboarding") ?? routeDefinitions[0];

  useEffect(() => {
    let isCancelled = false;

    const syncSession = () => {
      if (isCancelled) {
        return;
      }

      setSession(readStoredSession());
    };

    void ensureActiveStoredSession().then((nextSession) => {
      if (isCancelled) {
        return;
      }

      setSession(nextSession);
    });

    const unsubscribe = subscribeToStoredSession(() => {
      syncSession();
    });

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, []);

  const handleSessionCreated = (nextSession: SessionResponse) => {
    writeStoredSession(nextSession);
    setSession(nextSession);
  };

  const handleSignOut = () => {
    clearStoredRedirectPath();
    clearStoredSession();
    setSession(null);
    setTenantSummary(null);
  };

  const tenantSlug = session?.user.tenantSlug ?? null;

  useEffect(() => {
    let isCancelled = false;

    if (!tenantSlug) {
      setTenantSummary(null);
      return () => {
        isCancelled = true;
      };
    }

    const loadTenant = async () => {
      try {
        const tenant = await platformApi.getTenantBySlug(tenantSlug);
        if (isCancelled) return;
        setTenantSummary(tenant);
      } catch {
        if (isCancelled) return;
        setTenantSummary(null);
      }
    };

    void loadTenant();

    return () => {
      isCancelled = true;
    };
  }, [tenantSlug]);

  const calendarDisplayStartHour = tenantSummary?.settings.calendarDisplayStartHour ?? 9;
  const calendarDisplayEndHour = tenantSummary?.settings.calendarDisplayEndHour ?? 19;
  const weekStartsOn = tenantSummary?.settings.weekStartsOn ?? 0;

  return (
    <Routes>
      <Route path="/" element={<Navigate to={session === null ? "/login" : "/calendar"} replace />} />
      <Route path="/login" element={<LoginPage session={session} onSessionCreated={handleSessionCreated} />} />
      <Route
        path="/onboarding"
        element={
          <div className="public-route-shell">
            <OnboardingPage definition={onboardingDefinition} onSessionCreated={handleSessionCreated} />
          </div>
        }
      />

      {session === null ? (
        <Route path="*" element={<RequireLoginRedirect />} />
      ) : (
        <Route element={<AuthenticatedLayout session={session} onSignOut={handleSignOut} />}>
          <Route
            path="/calendar"
            element={
              <CalendarPage
                definition={pageByPath.get("calendar") ?? routeDefinitions[0]}
                tenantSlug={session.user.tenantSlug}
                displayStartHour={calendarDisplayStartHour}
                displayEndHour={calendarDisplayEndHour}
                weekStartsOn={weekStartsOn}
              />
            }
          />
          <Route
            path="/payments"
            element={<PaymentsPage definition={pageByPath.get("payments") ?? routeDefinitions[0]} currentUser={session.user} />}
          />
          <Route
            path="/services"
            element={<ServicesPage definition={pageByPath.get("services") ?? routeDefinitions[0]} currentUser={session.user} />}
          />
          <Route path="/customers" element={<CustomersPage definition={pageByPath.get("customers") ?? routeDefinitions[0]} currentUser={session.user} />} />
          <Route path="/locations" element={<LocationsPage definition={pageByPath.get("locations") ?? routeDefinitions[0]} currentUser={session.user} />} />
          <Route path="/providers" element={<Navigate to="/staff" replace />} />
          <Route path="/forms" element={<FormsPage definition={pageByPath.get("forms") ?? routeDefinitions[0]} currentUser={session.user} />} />
          <Route
            path="/settings"
            element={
              <SettingsPage
                definition={pageByPath.get("settings") ?? routeDefinitions[0]}
                currentUser={session.user}
                tenant={tenantSummary}
                onTenantUpdated={setTenantSummary}
              />
            }
          />
          <Route
            path="/staff"
            element={
              <StaffPage
                definition={pageByPath.get("staff") ?? routeDefinitions[0]}
                currentUser={session.user}
              />
            }
          />
          <Route path="/resources" element={<ResourcesPage definition={pageByPath.get("resources") ?? routeDefinitions[0]} currentUser={session.user} />} />
          <Route path="*" element={<Navigate to="/calendar" replace />} />
        </Route>
      )}
    </Routes>
  );
}

function OnboardingPage({
  definition,
  onSessionCreated,
}: {
  definition: RouteDefinition;
  onSessionCreated?: (session: SessionResponse) => void;
}) {
  const navigate = useNavigate();
  const [saveState, setSaveState] = useState<OnboardingSaveState>({ kind: "idle" });
  const [ownerSignInState, setOwnerSignInState] = useState<OwnerSignInState>({ kind: "idle" });
  const [formState, setFormState] = useState<OnboardingFormState>({
    name: "",
    slug: "",
    timezone: "America/Los_Angeles",
    locationName: "Main Studio",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
    homepageUrl: "",
    primaryColor: "#9f5323",
    accentColor: "#7a3c13",
  });

  const updateFormField = <TField extends keyof OnboardingFormState>(field: TField, value: OnboardingFormState[TField]) => {
    setFormState((current) => ({ ...current, [field]: value }));
  };

  const handleCreateBusiness = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveState({ kind: "saving" });

    try {
      const payload: CreateTenantRequest = {
        name: formState.name.trim(),
        slug: formState.slug.trim().toLowerCase(),
        timezone: formState.timezone,
        locationName: formState.locationName.trim(),
        ownerName: formState.ownerName.trim(),
        ownerEmail: formState.ownerEmail.trim().toLowerCase(),
        ownerPassword: formState.ownerPassword,
        homepageUrl: formState.homepageUrl.trim() || undefined,
        primaryColor: formState.primaryColor,
        accentColor: formState.accentColor,
      };
      const result = await platformApi.createTenant(payload);

      startTransition(() => {
        setSaveState({
          kind: "success",
          message: "Business created and storefront published.",
          result,
          password: formState.ownerPassword,
        });
        setFormState((current) => ({
          ...current,
          ownerPassword: "",
        }));
      });
    } catch (error) {
      startTransition(() => {
        setSaveState({
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to create the business.",
        });
      });
    }
  };

  const storefrontUrl =
    saveState.kind === "success" ? `${storefrontBaseUrl}/${saveState.result.tenant.slug}` : null;

  const handleContinueAsOwner = async () => {
    if (saveState.kind !== "success" || onSessionCreated === undefined) {
      return;
    }

    setOwnerSignInState({ kind: "submitting" });

    try {
      const session = await platformApi.login({
        email: saveState.result.ownerEmail,
        password: saveState.password,
      });
      onSessionCreated(session);
      navigate("/dashboard");
    } catch (error) {
      setOwnerSignInState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to sign in with the new owner account.",
      });
    }
  };

  return (
    <main className="ops-page-stack">
      <section className="ops-hero ops-hero--compact">
        <div className="ops-hero-copy">
          <p className="eyebrow">{definition.eyebrow}</p>
          <h3>Stand up a new studio, owner login, and storefront in one pass.</h3>
          <p>{definition.description}</p>
        </div>
        <div className="ops-hero-panel">
          <p className="eyebrow">Launch outcome</p>
          <strong>{saveState.kind === "success" ? saveState.result.tenant.name : definition.metric}</strong>
          <span>The onboarding slice creates the tenant, default location, owner account, and a publishable storefront route.</span>
        </div>
      </section>

      <section className="catalog-layout">
        <article className="ops-panel">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Business setup</p>
              <h4>Set up a new business</h4>
            </div>
            <span className="status-chip status-chip--planned">Launch checklist</span>
          </div>

          {saveState.kind !== "idle" ? (
            <div className={saveState.kind === "error" ? "message-banner message-banner--error" : "message-banner"}>
              {saveState.kind === "saving" ? "Creating business..." : saveState.message}
            </div>
          ) : null}

          {ownerSignInState.kind === "error" ? (
            <div className="message-banner message-banner--error">{ownerSignInState.message}</div>
          ) : null}

          <form className="catalog-form" onSubmit={handleCreateBusiness}>
            <div className="form-grid">
              <label>
                <span>Business name</span>
                <input value={formState.name} onChange={(event) => updateFormField("name", event.target.value)} required />
              </label>

              <label>
                <span>Business slug</span>
                <input
                  value={formState.slug}
                  onChange={(event) => updateFormField("slug", event.target.value)}
                  placeholder="luna-skin-studio"
                  required
                />
              </label>

              <label>
                <span>Timezone</span>
                <input value={formState.timezone} onChange={(event) => updateFormField("timezone", event.target.value)} required />
              </label>

              <label>
                <span>Launch location</span>
                <input value={formState.locationName} onChange={(event) => updateFormField("locationName", event.target.value)} required />
              </label>

              <label>
                <span>Owner name</span>
                <input value={formState.ownerName} onChange={(event) => updateFormField("ownerName", event.target.value)} required />
              </label>

              <label>
                <span>Owner email</span>
                <input
                  type="email"
                  value={formState.ownerEmail}
                  onChange={(event) => updateFormField("ownerEmail", event.target.value)}
                  required
                />
              </label>

              <label>
                <span>Temporary password</span>
                <input
                  type="password"
                  value={formState.ownerPassword}
                  onChange={(event) => updateFormField("ownerPassword", event.target.value)}
                  required
                />
              </label>

              <label>
                <span>Website</span>
                <input value={formState.homepageUrl} onChange={(event) => updateFormField("homepageUrl", event.target.value)} />
              </label>

              <label>
                <span>Primary color</span>
                <input value={formState.primaryColor} onChange={(event) => updateFormField("primaryColor", event.target.value)} />
              </label>

              <label>
                <span>Accent color</span>
                <input value={formState.accentColor} onChange={(event) => updateFormField("accentColor", event.target.value)} />
              </label>
            </div>

            <div className="inline-meta">
              <span>Create the tenant, owner login, and first location before catalog import.</span>
              <button type="submit" className="primary-action" disabled={saveState.kind === "saving"}>
                Create business
              </button>
            </div>
          </form>
        </article>

        <aside className="ops-panel">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Launch summary</p>
              <h4>{saveState.kind === "success" ? "Storefront published" : "What gets provisioned"}</h4>
            </div>
            {saveState.kind === "success" ? <span className="status-chip status-chip--ready">Published</span> : null}
          </div>

          {saveState.kind === "success" ? (
            <div className="launch-summary">
              <dl className="launch-summary-list">
                <div>
                  <dt>Tenant</dt>
                  <dd>{saveState.result.tenant.name}</dd>
                </div>
                <div>
                  <dt>Owner login</dt>
                  <dd>{saveState.result.ownerEmail}</dd>
                </div>
                <div>
                  <dt>Default location</dt>
                  <dd>{saveState.result.locationId}</dd>
                </div>
                <div>
                  <dt>Storefront path</dt>
                  <dd>{`/${saveState.result.tenant.slug}`}</dd>
                </div>
              </dl>
              {storefrontUrl ? (
                <div className="action-row">
                  <a href={storefrontUrl} target="_blank" rel="noreferrer" className="secondary-action">
                    Open storefront
                  </a>
                  {onSessionCreated ? (
                    <button type="button" className="primary-action" onClick={handleContinueAsOwner} disabled={ownerSignInState.kind === "submitting"}>
                      {ownerSignInState.kind === "submitting" ? "Signing in..." : "Continue as owner"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <ul className="check-list">
              <li>Create the tenant with portable policy defaults.</li>
              <li>Issue the first owner login and default location.</li>
              <li>Publish a storefront route before services are imported.</li>
            </ul>
          )}
        </aside>
      </section>
    </main>
  );
}

function SectionPage({ definition }: { definition: RouteDefinition }) {
  return (
    <main className="ops-page-stack">
      <section className="ops-hero ops-hero--compact">
        <div className="ops-hero-copy">
          <p className="eyebrow">{definition.eyebrow}</p>
          <h3>{definition.title}</h3>
          <p>{definition.description}</p>
        </div>
        <div className="ops-hero-panel">
          <p className="eyebrow">Current state</p>
          <strong>{definition.metric}</strong>
          <span>{getStatusLabel(definition.tone)} for greenfield implementation.</span>
        </div>
      </section>

      <section className="ops-dashboard-grid">
        <article className="ops-panel">
          <p className="eyebrow">Workflow design</p>
          <h4>Expected operator controls</h4>
          <div className="action-grid">
            {definition.actions.map((action) => (
              <button key={action} type="button" className="action-tile" disabled>
                {action}
              </button>
            ))}
          </div>
        </article>

        <article className="ops-panel">
          <p className="eyebrow">Build sequence</p>
          <h4>Implementation workstreams</h4>
          <ul className="check-list">
            {definition.workstreams.map((stream) => (
              <li key={stream}>{stream}</li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}


function LoginPage({
  session,
  onSessionCreated,
}: {
  session: SessionResponse | null;
  onSessionCreated: (session: SessionResponse) => void;
}) {
  const dashboardDefinition = pageByPath.get("dashboard");
  const [email, setEmail] = useState(demoOwnerEmail);
  const [password, setPassword] = useState(demoOwnerPassword);
  const [authNotice, setAuthNotice] = useState<string | null>(() => getAuthNoticeMessage());
  const [loginState, setLoginState] = useState<LoginState>({ kind: "idle" });

  useEffect(() => {
    if (authNotice !== null) {
      clearStoredAuthNotice();
    }
  }, [authNotice]);

  if (session !== null) {
    return <LoginRedirect />;
  }

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginState({ kind: "submitting" });

    try {
      const nextSession = await platformApi.login({
        email: email.trim().toLowerCase(),
        password,
      });
      setAuthNotice(null);
      onSessionCreated(nextSession);
      setLoginState({ kind: "idle" });
    } catch (error) {
      setLoginState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to sign in.",
      });
    }
  };

  return (
    <main className="login-screen">
      <section className="login-panel">
        <span className="brand-mark">BB</span>
        <p className="eyebrow">Operator access</p>
        <h2>Sign in to Studio OS</h2>
        <p>
          Backend-issued sessions now gate the operator shell. The demo owner account is prefilled for the current local stack.
        </p>
        <div className="login-meta">
          <span>{apiBaseUrl}/auth/login</span>
          <strong>{dashboardDefinition?.title ?? "Overview"}</strong>
        </div>

        {loginState.kind === "error" ? <div className="message-banner message-banner--error">{loginState.message}</div> : null}
  {authNotice !== null ? <div className="message-banner message-banner--muted">{authNotice}</div> : null}

        <form className="login-form" onSubmit={handleLogin}>
          <label>
            <span>Email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>

          <label>
            <span>Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>

          <div className="action-row">
            <button type="submit" className="primary-action" disabled={loginState.kind === "submitting"}>
              {loginState.kind === "submitting" ? "Signing in..." : "Sign in"}
            </button>
            <NavLink to="/onboarding" className="secondary-action">
              Set up a new business
            </NavLink>
          </div>
        </form>
      </section>
    </main>
  );
}
