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
import { SettingsPage } from "./settings-page";
import { StaffPage } from "./staff-page";
import { ServicesPage } from "./services-page";
import { CustomersPage } from "./customers-page";
import { LocationsPage } from "./locations-page";
import { FormsPage } from "./forms-page";
import { ResourcesPage } from "./resources-page";
import "./styles.css";
import "./club-sunday.css";

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

  const getInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  };

  const NAV_ICONS: Record<string, JSX.Element> = {
    "/calendar": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
    "/customers": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
      </svg>
    ),
    "/locations": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z" />
        <circle cx="12" cy="9" r="2.5" />
      </svg>
    ),
    "/forms": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 3h10l4 4v14H5z" />
        <path d="M9 12h6M9 16h6M9 8h3" />
      </svg>
    ),
    "/settings": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.4.7a7 7 0 00-2-1.2L14 3h-4l-.5 2.4a7 7 0 00-2 1.2l-2.4-.7-2 3.4 2 1.5a7 7 0 000 2.4l-2 1.5 2 3.4 2.4-.7a7 7 0 002 1.2L10 21h4l.5-2.4a7 7 0 002-1.2l2.4.7 2-3.4-2-1.5a7 7 0 00.1-1.2z" />
      </svg>
    ),
    "/services": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h16v13H4z" />
        <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" />
      </svg>
    ),
    "/staff": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="3.5" />
        <circle cx="17" cy="10" r="2.5" />
        <path d="M2 20c1-3.5 4-5 7-5s6 1.5 7 5M15 20c.5-2 2-3.5 4-3.5s3.5 1.5 4 3.5" />
      </svg>
    ),
    "/resources": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="8" rx="1.5" />
        <rect x="3" y="14" width="18" height="6" rx="1.5" />
      </svg>
    ),
    "/onboarding": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12l4 4L19 6" />
      </svg>
    ),
  };
  const navIcon = (path: string): JSX.Element =>
    NAV_ICONS[path] ?? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
      </svg>
    );

  const initials = getInitials(session.user.name || session.user.email || "");
  const pageTitle = currentDefinition.title;

  return (
    <div className="cs-desk">
      <div className="cs-shell">
        <aside className="cs-sidebar">
          <div className="cs-brand">
            <div className="cs-brand__name">
              Brow Beauty <em>Lab</em>
            </div>
            <div className="cs-brand__site">Operator desk</div>
          </div>

          {isCalendarRoute ? (
            <div id="dashboard-calendar-sidebar-rail" aria-label="Sidebar month calendar" />
          ) : null}

          <nav className="cs-nav" aria-label="Dashboard sections">
            {topLevelDefinitions.map((definition) => (
              <NavLink
                key={definition.path}
                to={definition.path}
                end={definition.path === "/calendar"}
                className={({ isActive }) => `cs-nav__item${isActive ? " cs-nav__item--active" : ""}`}
              >
                {navIcon(definition.path)}
                <span className="cs-nav__label">{definition.title}</span>
              </NavLink>
            ))}

            {routeGroupDefinitions.map((group) => {
              const children = groupedPathsByGroup.get(group.key) ?? [];
              if (children.length === 0) return null;
              const isExpanded = expandedGroups[group.key];
              const groupActive = groupContainsActive(group.key);
              return (
                <div key={group.key} className={`cs-nav__group${groupActive ? " cs-nav__group--active" : ""}`}>
                  <button
                    type="button"
                    className="cs-nav__item cs-nav__group-header"
                    aria-expanded={isExpanded}
                    aria-controls={`cs-nav-group-${group.key}`}
                    onClick={() => toggleGroup(group.key)}
                  >
                    {navIcon("/settings")}
                    <span className="cs-nav__label">{group.title}</span>
                    <span className="cs-nav__chevron" aria-hidden="true">
                      {isExpanded ? "▾" : "▸"}
                    </span>
                  </button>
                  {isExpanded ? (
                    <div className="cs-nav__children" id={`cs-nav-group-${group.key}`}>
                      {children.map((definition) => (
                        <NavLink
                          key={definition.path}
                          to={definition.path}
                          className={({ isActive }) =>
                            `cs-nav__item cs-nav__item--child${isActive ? " cs-nav__item--active" : ""}`
                          }
                        >
                          {navIcon(definition.path)}
                          <span className="cs-nav__label">{definition.title}</span>
                        </NavLink>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </nav>

          {isCalendarRoute ? (
            <div className="cs-legend">
              <div className="cs-legend__title">Treatment families</div>
              <div className="cs-legend__row">
                <span className="cs-legend__swatch" style={{ background: "var(--cs-mint)" }} />
                Facials
              </div>
              <div className="cs-legend__row">
                <span className="cs-legend__swatch" style={{ background: "var(--cs-lilac)" }} />
                Advanced
              </div>
              <div className="cs-legend__row">
                <span className="cs-legend__swatch" style={{ background: "var(--cs-pink)" }} />
                Laser &amp; peels
              </div>
              <div className="cs-legend__row">
                <span className="cs-legend__swatch" style={{ background: "var(--cs-blue)" }} />
                Consults
              </div>
            </div>
          ) : null}
        </aside>

        <main className="cs-main">
          <header className="cs-topbar">
            {isCalendarRoute ? (
              <CalendarSearchBar tenantSlug={session.user.tenantSlug} />
            ) : (
              <div className="cs-page-title">
                {currentDefinition.eyebrow ? <p className="cs-page-title__eyebrow">{currentDefinition.eyebrow}</p> : null}
                <h2>{pageTitle}</h2>
              </div>
            )}
            <div className="cs-topbar__right">
              <a
                href={`${storefrontBaseUrl}/${session.user.tenantSlug}`}
                target="_blank"
                rel="noreferrer"
                className="cs-topbar__link"
              >
                Open storefront
              </a>
              <button type="button" className="cs-topbar__link" onClick={onSignOut}>
                Sign out
              </button>
              <div className="cs-avatar" aria-label={session.user.name}>
                {initials}
              </div>
            </div>
          </header>

          <Outlet />
        </main>
      </div>
    </div>
  );
}

type SearchResult =
  | { kind: "customer"; id: string; name: string; email?: string | null; phone?: string | null }
  | { kind: "booking"; id: string; serviceName: string; customerName: string; startsAt: string; status: string };

function CalendarSearchBar({ tenantSlug }: { tenantSlug: string }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown]);

  const doSearch = async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    setSearching(true);
    try {
      const [customers, bookings] = await Promise.all([
        platformApi.listCustomers(tenantSlug, trimmed).catch(() => ({ items: [] })),
        platformApi.listBookings(tenantSlug, { limit: 10 }).catch(() => ({ items: [] })),
      ]);

      const customerResults: SearchResult[] = (customers.items ?? []).slice(0, 5).map((c) => ({
        kind: "customer" as const,
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
      }));

      const lowerQ = trimmed.toLowerCase();
      const bookingResults: SearchResult[] = (bookings.items ?? [])
        .filter((b) =>
          b.customer.name.toLowerCase().includes(lowerQ) ||
          b.service.name.toLowerCase().includes(lowerQ) ||
          (b.customer.email ?? "").toLowerCase().includes(lowerQ) ||
          (b.customer.phone ?? "").includes(trimmed)
        )
        .slice(0, 5)
        .map((b) => ({
          kind: "booking" as const,
          id: b.id,
          serviceName: b.service.name,
          customerName: b.customer.name,
          startsAt: b.startsAt,
          status: b.status,
        }));

      setResults([...customerResults, ...bookingResults]);
      setShowDropdown(true);
    } catch {
      setResults([]);
    }
    setSearching(false);
  };

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 250);
  };

  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

  return (
    <div className="ops-topbar-search" ref={containerRef} style={{ position: "relative" }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>
      <input
        placeholder="Search customers & appointments…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
      />
      {searching ? <span style={{ fontSize: "0.8rem", color: "var(--ui-ink-soft)" }}>…</span> : null}
      {showDropdown && results.length > 0 ? (
        <div className="search-dropdown" style={{
          position: "absolute", top: "100%", left: 0, right: 0,
          background: "#fff", border: "1px solid var(--ui-border, #e5e7eb)",
          borderRadius: "8px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          zIndex: 50, maxHeight: "400px", overflowY: "auto", marginTop: "4px",
        }}>
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.id}-${i}`}
              type="button"
              style={{
                display: "flex", alignItems: "center", gap: "0.5rem",
                width: "100%", textAlign: "left",
                padding: "0.6rem 0.75rem", border: "none", background: "none",
                cursor: "pointer", fontSize: "0.9rem",
              }}
              onClick={() => {
                setShowDropdown(false);
                setQuery("");
                if (r.kind === "customer") {
                  navigate(`/customers?customerId=${r.id}`);
                } else {
                  navigate(`/calendar?bookingId=${r.id}`);
                }
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "var(--ui-sand, #f5f0eb)"; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "none"; }}
            >
              <span style={{
                fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase",
                color: r.kind === "customer" ? "var(--ui-amber-deep, #b45309)" : "var(--ui-cat-pink-bar, #c2416c)",
                minWidth: "3.5rem",
              }}>
                {r.kind === "customer" ? "Client" : "Appt"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.kind === "customer" ? r.name : r.serviceName}
                </strong>
                <span style={{ color: "var(--ui-ink-soft)", fontSize: "0.8rem" }}>
                  {r.kind === "customer"
                    ? (r.email ?? r.phone ?? "")
                    : `${r.customerName} · ${timeFormatter.format(new Date(r.startsAt))}`}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : null}
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
