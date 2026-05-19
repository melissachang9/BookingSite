import "@booking/ui-components/styles.css";

import { startTransition, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from "react-router-dom";
import type { ApiRootResponse, HealthResponse, ServiceSummary, SlotAvailability } from "@booking/shared-types";

import { apiBaseUrl, platformApi } from "./platform-api";
import "./styles.css";

type BackendStatusState =
  | { kind: "loading" }
  | { kind: "ready"; root: ApiRootResponse; health: HealthResponse }
  | { kind: "error"; message: string };

type RouteDefinition = {
  path: string;
  title: string;
  eyebrow: string;
  description: string;
  metric: string;
  tone: "ready" | "progress" | "planned";
  workstreams: string[];
  actions: string[];
};

type CalendarDataState =
  | { kind: "loading" }
  | { kind: "ready"; service: ServiceSummary; days: CalendarDay[] }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string };

type CalendarDay = {
  date: string;
  label: string;
  slots: SlotAvailability[];
};

const demoTenantSlug = "brow-beauty-lab";

const routeDefinitions: RouteDefinition[] = [
  {
    path: "/dashboard",
    title: "Overview",
    eyebrow: "Command center",
    description: "Daily operating signal for bookings, forms, payment exceptions, and follow-up work.",
    metric: "Live shell",
    tone: "ready",
    workstreams: ["Today schedule", "Follow-up queue", "Payment exceptions"],
    actions: ["Review day", "Open calendar", "Check API health"],
  },
  {
    path: "/calendar",
    title: "Calendar",
    eyebrow: "Calendar-first booking",
    description: "Provider openings, manual booking entry, and hold-backed scheduling from calendar context.",
    metric: "Live availability",
    tone: "ready",
    workstreams: ["Provider week view", "Manual booking drawer", "Service and location filters"],
    actions: ["Select a slot", "Start customer search", "Send deposit link"],
  },
  {
    path: "/bookings",
    title: "Bookings",
    eyebrow: "Lifecycle management",
    description: "Confirmed visits, completion controls, cancellation decisions, and auditable booking history.",
    metric: "Next API slice",
    tone: "progress",
    workstreams: ["Booking list", "Status transitions", "Timeline history"],
    actions: ["Review status", "Complete visit", "Record cancellation"],
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
  },
  {
    path: "/providers",
    title: "Providers",
    eyebrow: "Staff and schedules",
    description: "Provider availability, service assignment, location coverage, and read-only provider states.",
    metric: "Schedule APIs next",
    tone: "planned",
    workstreams: ["Provider schedules", "Time off", "Service overrides"],
    actions: ["Set schedule", "Assign services", "Block time"],
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

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

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

function getUpcomingDate(offsetDays: number): string {
  return dateFormatter.format(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
}

function getDateLabel(date: string): string {
  return dayLabelFormatter.format(new Date(`${date}T12:00:00Z`));
}

function getStatusLabel(tone: RouteDefinition["tone"]): string {
  if (tone === "ready") {
    return "Ready";
  }

  if (tone === "progress") {
    return "In build";
  }

  return "Planned";
}

const pageByPath = new Map(routeDefinitions.map((definition) => [definition.path.replace(/^\//, ""), definition]));

function useBackendStatus(): BackendStatusState {
  const [state, setState] = useState<BackendStatusState>({ kind: "loading" });

  useEffect(() => {
    let isCancelled = false;

    const loadStatus = async () => {
      try {
        const [root, health] = await Promise.all([platformApi.getApiRoot(), platformApi.getHealth()]);

        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setState({ kind: "ready", root, health });
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "Unable to reach the backend.",
          });
        });
      }
    };

    void loadStatus();

    return () => {
      isCancelled = true;
    };
  }, []);

  return state;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<DashboardLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardHomePage />} />
        {routeDefinitions
          .filter((definition) => definition.path !== "/dashboard")
          .map((definition) => (
            <Route
              key={definition.path}
              path={definition.path.replace(/^\//, "")}
              element={definition.path === "/calendar" ? <CalendarPage definition={definition} /> : <SectionPage definition={definition} />}
            />
          ))}
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function DashboardLayout() {
  const backendStatus = useBackendStatus();
  const location = useLocation();
  const activePage = useMemo(
    () => routeDefinitions.find((definition) => definition.path === location.pathname) ?? routeDefinitions[0],
    [location.pathname],
  );

  return (
    <div className="ops-shell">
      <aside className="ops-sidebar">
        <div className="ops-brand-card">
          <span className="brand-mark">BB</span>
          <div>
            <p className="eyebrow">Booking platform</p>
            <h1>Studio OS</h1>
          </div>
          <p>
            A calm operating layer for booked calendars, clean follow-up, auditable payments, and client-ready intake.
          </p>
        </div>

        <nav className="ops-nav" aria-label="Primary dashboard sections">
          {routeDefinitions.map((definition) => (
            <NavLink
              key={definition.path}
              to={definition.path}
              className={({ isActive }) => (isActive ? "ops-nav-link ops-nav-link--active" : "ops-nav-link")}
            >
              <span>{definition.title}</span>
              <small>{definition.eyebrow}</small>
            </NavLink>
          ))}
        </nav>

        <section className="ops-sidebar-panel">
          <p className="eyebrow">Today&apos;s posture</p>
          <strong>Follow the calendar first.</strong>
          <span>Manual booking starts from a time slot, then moves into customer, form, and payment context.</span>
        </section>
      </aside>

      <div className="ops-main">
        <header className="ops-topbar">
          <div>
            <p className="eyebrow">{activePage.eyebrow}</p>
            <h2>{activePage.title}</h2>
          </div>
          <div className="ops-topbar-actions">
            <span className={`status-chip status-chip--${activePage.tone}`}>{getStatusLabel(activePage.tone)}</span>
            <BackendStatusCard status={backendStatus} />
          </div>
        </header>

        <Outlet />
      </div>
    </div>
  );
}

function BackendStatusCard({ status }: { status: BackendStatusState }) {
  if (status.kind === "loading") {
    return (
      <section className="api-pill" aria-live="polite">
        <span>API</span>
        <strong>Checking</strong>
      </section>
    );
  }

  if (status.kind === "error") {
    return (
      <section className="api-pill api-pill--error" aria-live="polite">
        <span>API</span>
        <strong>Offline</strong>
      </section>
    );
  }

  return (
    <section className="api-pill api-pill--ready" aria-live="polite" title={`${status.root.message} at ${apiBaseUrl}`}>
      <span>{status.root.environment}</span>
      <strong>{status.health.status === "ok" ? "Connected" : "Degraded"}</strong>
    </section>
  );
}

function DashboardHomePage() {
  return (
    <main className="ops-page-stack">
      <section className="ops-hero">
        <div className="ops-hero-copy">
          <p className="eyebrow">Operator command center</p>
          <h3>Keep the day moving before a client ever walks in.</h3>
          <p>
            The dashboard is now shaped around the work that protects revenue: booking coverage, intake completion,
            payment exceptions, and follow-up momentum.
          </p>
        </div>
        <div className="ops-hero-panel">
          <p className="eyebrow">Primary tenant</p>
          <strong>Brow Beauty Lab</strong>
          <span>Demo data is wired through the greenfield FastAPI stack.</span>
        </div>
      </section>

      <section className="ops-metric-grid" aria-label="Operational priorities">
        {topPriorities.map((priority) => (
          <article key={priority.label} className="metric-card">
            <span>{priority.label}</span>
            <strong>{priority.value}</strong>
            <p>{priority.detail}</p>
          </article>
        ))}
      </section>

      <section className="ops-dashboard-grid">
        <article className="ops-panel ops-panel--wide">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Workflow map</p>
              <h4>High-value surfaces</h4>
            </div>
            <NavLink to="/calendar" className="text-action">
              Open calendar
            </NavLink>
          </div>
          <div className="module-grid">
            {routeDefinitions.slice(1, 6).map((definition) => (
              <NavLink key={definition.path} to={definition.path} className="module-tile">
                <span className={`status-dot status-dot--${definition.tone}`} />
                <strong>{definition.title}</strong>
                <p>{definition.description}</p>
              </NavLink>
            ))}
          </div>
        </article>

        <aside className="ops-panel queue-panel">
          <p className="eyebrow">Queues</p>
          <h4>Operator attention</h4>
          <div className="queue-list">
            {operatorQueues.map((queue) => (
              <article key={queue.title} className="queue-item">
                <span>{queue.count}</span>
                <div>
                  <strong>{queue.title}</strong>
                  <p>{queue.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}

function CalendarPage({ definition }: { definition: RouteDefinition }) {
  const [calendarState, setCalendarState] = useState<CalendarDataState>({ kind: "loading" });

  useEffect(() => {
    let isCancelled = false;

    const loadCalendar = async () => {
      try {
        const serviceResponse = await platformApi.listServices(demoTenantSlug);
        const service = serviceResponse.services[0];

        if (!service) {
          startTransition(() => {
            setCalendarState({ kind: "empty", message: "No active services are available for the demo tenant." });
          });
          return;
        }

        const availabilityResponses = await Promise.all(
          Array.from({ length: 7 }, (_, index) => {
            const date = getUpcomingDate(index + 1);
            return platformApi.getAvailability({
              tenantSlug: demoTenantSlug,
              serviceId: service.id,
              date,
            });
          }),
        );

        if (isCancelled) {
          return;
        }

        const days = availabilityResponses.map((availability, index) => {
          const date = getUpcomingDate(index + 1);
          return {
            date,
            label: getDateLabel(date),
            slots: availability.slots.slice(0, 6),
          };
        });

        startTransition(() => {
          setCalendarState({ kind: "ready", service, days });
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setCalendarState({
            kind: "error",
            message: error instanceof Error ? error.message : "Unable to load calendar availability.",
          });
        });
      }
    };

    void loadCalendar();

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <main className="ops-page-stack">
      <section className="calendar-command-bar">
        <div>
          <p className="eyebrow">{definition.eyebrow}</p>
          <h3>Choose a real opening before creating a booking.</h3>
          <p>{definition.description}</p>
        </div>
        <div className="filter-row" aria-label="Calendar filters">
          <button type="button" className="filter-chip filter-chip--active">
            Week
          </button>
          <button type="button" className="filter-chip" disabled>
            Day
          </button>
          <button type="button" className="filter-chip" disabled>
            Location
          </button>
          <button type="button" className="filter-chip" disabled>
            Provider
          </button>
        </div>
      </section>

      <section className="calendar-workspace">
        <article className="ops-panel calendar-panel">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Live availability</p>
              <h4>Provider week</h4>
            </div>
            <span className="status-chip status-chip--ready">Backend-backed</span>
          </div>
          <CalendarBoard state={calendarState} />
        </article>

        <aside className="ops-panel booking-rail">
          <p className="eyebrow">Manual booking</p>
          <h4>Selected-slot drawer</h4>
          <p>
            Staff booking stays anchored to calendar time. Customer lookup, deposit mode, and hold creation will bind here.
          </p>
          <div className="drawer-form-preview" aria-label="Manual booking preview">
            <label>
              Customer
              <input value="Search existing customer" readOnly />
            </label>
            <label>
              Service
              <input value={calendarState.kind === "ready" ? calendarState.service.name : "Load service"} readOnly />
            </label>
            <label>
              Payment outcome
              <select value="deposit_link" disabled>
                <option value="deposit_link">Send deposit link</option>
              </select>
            </label>
            <button type="button" disabled>
              Create from selected slot
            </button>
          </div>
        </aside>
      </section>
    </main>
  );
}

function CalendarBoard({ state }: { state: CalendarDataState }) {
  if (state.kind === "loading") {
    return <div className="calendar-state">Loading calendar availability...</div>;
  }

  if (state.kind === "error" || state.kind === "empty") {
    return <div className="calendar-state calendar-state--muted">{state.message}</div>;
  }

  return (
    <div className="calendar-board" aria-label={`Upcoming openings for ${state.service.name}`}>
      {state.days.map((day) => (
        <section key={day.date} className="calendar-day-column">
          <header>
            <span>{day.label}</span>
            <strong>{day.slots.length > 0 ? `${day.slots.length} openings` : "No openings"}</strong>
          </header>

          <div className="calendar-slot-stack">
            {day.slots.length > 0 ? (
              day.slots.map((slot) => (
                <button key={`${slot.providerId}-${slot.startAt}`} type="button" className="calendar-slot-card">
                  <strong>{timeFormatter.format(new Date(slot.startAt))}</strong>
                  <span>{slot.providerName}</span>
                  <small>{slot.locationId ? "Location selected" : state.service.name}</small>
                </button>
              ))
            ) : (
              <div className="calendar-empty-cell">Protected time</div>
            )}
          </div>
        </section>
      ))}
    </div>
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

function LoginPage() {
  const dashboardDefinition = pageByPath.get("dashboard");

  return (
    <main className="login-screen">
      <section className="login-panel">
        <span className="brand-mark">BB</span>
        <p className="eyebrow">Operator access</p>
        <h2>Sign in to Studio OS</h2>
        <p>
          Backend-issued sessions and permission-aware route gating will power this screen. The route is ready for the first auth slice.
        </p>
        <div className="login-meta">
          <span>{apiBaseUrl}/auth/login</span>
          <strong>{dashboardDefinition?.title ?? "Overview"}</strong>
        </div>
        <NavLink to="/dashboard" className="primary-action">
          Continue to dashboard shell
        </NavLink>
      </section>
    </main>
  );
}
