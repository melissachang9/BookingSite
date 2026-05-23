import "@booking/ui-components/styles.css";

import { startTransition, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type {
  AuthenticatedUser,
  ApiRootResponse,
  CreateServiceRequest,
  CreateTenantRequest,
  CreateTenantResponse,
  DepositPaymentFollowUpItem,
  HealthResponse,
  LocationSummary,
  SessionResponse,
  ServiceSummary,
  SlotAvailability,
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

type ServiceCatalogState =
  | { kind: "loading" }
  | { kind: "ready"; tenant: TenantSummary; services: ServiceSummary[]; locations: LocationSummary[] }
  | { kind: "error"; message: string };

type PaymentFollowUpState =
  | { kind: "loading" }
  | { kind: "ready"; items: DepositPaymentFollowUpItem[] }
  | { kind: "error"; message: string };

type ServiceFormState = {
  name: string;
  description: string;
  durationMinutes: string;
  priceAmount: string;
  depositAmount: string;
  locationId: string;
};

type ServiceSaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type PaymentActionState =
  | { kind: "idle" }
  | { kind: "submitting"; bookingDraftId: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

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

type CalendarDay = {
  date: string;
  label: string;
  slots: SlotAvailability[];
};

type SelectedCalendarSlot = SlotAvailability & {
  dayLabel: string;
};

const demoOwnerEmail = "owner@browbeautylab.test";
const demoOwnerPassword = "DemoBooking123";
const storefrontBaseUrl = import.meta.env.VITE_PUBLIC_STOREFRONT_BASE_URL ?? "http://127.0.0.1:3001";

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

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
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

function getPaymentLinkLabel(item: DepositPaymentFollowUpItem): string {
  if (item.linkState === "open") {
    return "Link ready";
  }

  if (item.linkState === "expired") {
    return "Link expired";
  }

  return "Needs link";
}

function getPaymentLinkTone(item: DepositPaymentFollowUpItem): RouteDefinition["tone"] {
  if (item.linkState === "open") {
    return "ready";
  }

  if (item.linkState === "expired") {
    return "progress";
  }

  return "planned";
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
    throw new Error("Clipboard access is not available in this browser.");
  }

  await navigator.clipboard.writeText(value);
}

function buildDepositReminderMailto(item: DepositPaymentFollowUpItem, checkoutUrl: string): string {
  const customerEmail = item.bookingDraft.customer?.email?.trim();
  if (!customerEmail) {
    throw new Error("Customer email is required before drafting a reminder.");
  }

  const customerName = item.bookingDraft.customer?.name?.trim() || "there";
  const subject = `${item.bookingDraft.service.name} deposit link`;
  const body = [
    `Hi ${customerName},`,
    "",
    `Here is your secure link to pay the ${formatMoney(item.bookingDraft.depositCents)} deposit for your ${item.bookingDraft.service.name} appointment on ${formatDateTime(item.bookingDraft.startsAt)}.`,
    "",
    checkoutUrl,
    "",
    "Reply here if you need a different time or have any questions before checkout.",
  ].join("\n");

  return `mailto:${encodeURIComponent(customerEmail)}?${new URLSearchParams({ subject, body }).toString()}`;
}

const pageByPath = new Map(routeDefinitions.map((definition) => [definition.path.replace(/^\//, ""), definition]));
const protectedRouteDefinitions = routeDefinitions.filter(
  (definition) => definition.path !== "/dashboard" && definition.path !== "/onboarding",
);

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((permission) => permission.key === key && permission.allowed);
}

function getAuthNoticeMessage(): string | null {
  const notice = readStoredAuthNotice();
  if (notice === "session-expired") {
    return "Your session expired. Sign in again to continue.";
  }

  return null;
}

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
  const [session, setSession] = useState<SessionResponse | null>(() => readStoredSession());
  const onboardingDefinition = pageByPath.get("onboarding") ?? routeDefinitions[0];
  const authenticatedSession = session;

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
  };

  return (
    <Routes>
      <Route path="/login" element={<LoginPage session={session} onSessionCreated={handleSessionCreated} />} />
      <Route
        path="/onboarding"
        element={
          <PublicRouteFrame>
            <OnboardingPage definition={onboardingDefinition} onSessionCreated={handleSessionCreated} />
          </PublicRouteFrame>
        }
      />
      <Route
        path="/"
        element={
          authenticatedSession !== null ? (
            <DashboardLayout session={authenticatedSession} onSignOut={handleSignOut} />
          ) : (
            <ProtectedRouteGate />
          )
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route
          path="dashboard"
          element={authenticatedSession !== null ? <DashboardHomePage tenantSlug={authenticatedSession.user.tenantSlug} /> : null}
        />
        {protectedRouteDefinitions.map((definition) => (
          <Route
            key={definition.path}
            path={definition.path.replace(/^\//, "")}
            element={
              authenticatedSession === null ? null : definition.path === "/calendar" ? (
                <CalendarPage definition={definition} tenantSlug={authenticatedSession.user.tenantSlug} />
              ) : definition.path === "/payments" ? (
                <PaymentsPage definition={definition} currentUser={authenticatedSession.user} />
              ) : definition.path === "/services" ? (
                <ServicesPage definition={definition} currentUser={authenticatedSession.user} />
              ) : (
                <SectionPage definition={definition} />
              )
            }
          />
        ))}
      </Route>
      <Route path="*" element={<Navigate to={session !== null ? "/dashboard" : "/login"} replace />} />
    </Routes>
  );
}

function ProtectedRouteGate() {
  const location = useLocation();

  writeStoredRedirectPath(`${location.pathname}${location.search}${location.hash}`);

  return <Navigate to="/login" replace />;
}

function LoginRedirect() {
  const navigate = useNavigate();
  const redirectPathRef = useRef<string>(readStoredRedirectPath() ?? "/dashboard");

  useEffect(() => {
    navigate(redirectPathRef.current, { replace: true });
    clearStoredRedirectPath();
  }, [navigate]);

  return null;
}

function PublicRouteFrame({ children }: { children: ReactNode }) {
  return <div className="public-route-shell">{children}</div>;
}

function DashboardLayout({ session, onSignOut }: { session: SessionResponse; onSignOut: () => void }) {
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
          {routeDefinitions
            .filter((definition) => definition.path !== "/onboarding")
            .map((definition) => (
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
            <section className="user-pill" aria-label="Signed-in operator">
              <span>{session.user.role}</span>
              <strong>{session.user.name}</strong>
            </section>
            <BackendStatusCard status={backendStatus} />
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

function DashboardHomePage({ tenantSlug }: { tenantSlug: string }) {
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
          <strong>{tenantSlug}</strong>
          <span>Operator views are now scoped to the signed-in tenant session.</span>
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

function CalendarPage({ definition, tenantSlug }: { definition: RouteDefinition; tenantSlug: string }) {
  const [calendarState, setCalendarState] = useState<CalendarDataState>({ kind: "loading" });
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);

  const selectedSlot = useMemo<SelectedCalendarSlot | null>(() => {
    if (calendarState.kind !== "ready" || selectedSlotKey === null) {
      return null;
    }

    for (const day of calendarState.days) {
      const slot = day.slots.find((candidate) => `${candidate.providerId}-${candidate.startAt}` === selectedSlotKey);
      if (slot) {
        return {
          ...slot,
          dayLabel: day.label,
        };
      }
    }

    return null;
  }, [calendarState, selectedSlotKey]);

  useEffect(() => {
    let isCancelled = false;

    setSelectedSlotKey(null);

    const loadCalendar = async () => {
      try {
        const serviceResponse = await platformApi.listServices(tenantSlug);
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
              tenantSlug,
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
  }, [tenantSlug]);

  const selectedOpeningLabel = selectedSlot ? formatDateTime(selectedSlot.startAt) : "Choose a slot";
  const selectedProviderLabel = selectedSlot?.providerName ?? "Choose a slot";
  const customerLookupLabel = selectedSlot ? "Search existing customer" : "Choose a slot first";
  const serviceLabel = calendarState.kind === "ready" ? calendarState.service.name : "Load service";

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
          <CalendarBoard
            state={calendarState}
            selectedSlotKey={selectedSlotKey}
            onSelectSlot={setSelectedSlotKey}
          />
        </article>

        <aside className="ops-panel booking-rail">
          <p className="eyebrow">Manual booking</p>
          <h4>Selected-slot drawer</h4>
          <p>
            {selectedSlot
              ? `Start with ${formatDateTime(selectedSlot.startAt)} with ${selectedSlot.providerName}. Customer lookup, deposit mode, and hold creation stay anchored to this opening.`
              : "Staff booking stays anchored to calendar time. Choose an opening to load customer lookup, deposit mode, and hold creation context."}
          </p>
          <div className="drawer-form-preview" aria-label="Manual booking preview">
            <div className="drawer-selection-note" aria-live="polite">
              {selectedSlot
                ? `Selected ${selectedSlot.dayLabel} at ${timeFormatter.format(new Date(selectedSlot.startAt))} with ${selectedSlot.providerName}.`
                : "Select a slot from the calendar to begin the manual booking handoff."}
            </div>
            <label>
              Customer
              <input value={customerLookupLabel} readOnly />
            </label>
            <label>
              Service
              <input value={serviceLabel} readOnly />
            </label>
            <label>
              Selected opening
              <input value={selectedOpeningLabel} readOnly />
            </label>
            <label>
              Provider
              <input value={selectedProviderLabel} readOnly />
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

function CalendarBoard({
  state,
  selectedSlotKey,
  onSelectSlot,
}: {
  state: CalendarDataState;
  selectedSlotKey: string | null;
  onSelectSlot: (slotKey: string) => void;
}) {
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
              day.slots.map((slot) => {
                const slotKey = `${slot.providerId}-${slot.startAt}`;
                const isSelected = slotKey === selectedSlotKey;

                return (
                  <button
                    key={slotKey}
                    type="button"
                    className={`calendar-slot-card${isSelected ? " calendar-slot-card--selected" : ""}`}
                    aria-label={`Select ${formatDateTime(slot.startAt)} with ${slot.providerName}`}
                    aria-pressed={isSelected}
                    onClick={() => onSelectSlot(slotKey)}
                  >
                    <strong>{timeFormatter.format(new Date(slot.startAt))}</strong>
                    <span>{slot.providerName}</span>
                    <small>{slot.locationId ? "Location selected" : state.service.name}</small>
                  </button>
                );
              })
            ) : (
              <div className="calendar-empty-cell">Protected time</div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function ServicesPage({ definition, currentUser }: { definition: RouteDefinition; currentUser: AuthenticatedUser | null }) {
  const [catalogState, setCatalogState] = useState<ServiceCatalogState>({ kind: "loading" });
  const [saveState, setSaveState] = useState<ServiceSaveState>({ kind: "idle" });
  const [formState, setFormState] = useState<ServiceFormState>({
    name: "",
    description: "",
    durationMinutes: "60",
    priceAmount: "",
    depositAmount: "25.00",
    locationId: "",
  });
  const canManageServices = currentUser !== null && hasPermission(currentUser, "services.manage");
  const tenantSlug = currentUser?.tenantSlug ?? "";

  useEffect(() => {
    let isCancelled = false;

    if (!tenantSlug) {
      setCatalogState({ kind: "error", message: "Tenant session is missing tenant context." });
      return () => {
        isCancelled = true;
      };
    }

    const loadCatalog = async () => {
      try {
        const [tenant, serviceResponse, locationResponse] = await Promise.all([
          platformApi.getTenantBySlug(tenantSlug),
          platformApi.listServices(tenantSlug),
          platformApi.listLocations(tenantSlug),
        ]);

        if (isCancelled) {
          return;
        }

        const locations = locationResponse.locations.filter((location) => location.isActive);
        startTransition(() => {
          setCatalogState({
            kind: "ready",
            tenant,
            services: serviceResponse.services,
            locations,
          });
          setFormState((current) => ({
            ...current,
            locationId: current.locationId || locations[0]?.id || "",
            depositAmount: current.depositAmount || (tenant.settings.defaultDepositCents / 100).toFixed(2),
          }));
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setCatalogState({
            kind: "error",
            message: error instanceof Error ? error.message : "Unable to load the tenant catalog.",
          });
        });
      }
    };

    void loadCatalog();

    return () => {
      isCancelled = true;
    };
  }, [tenantSlug]);

  const locationNamesById = useMemo(() => {
    if (catalogState.kind !== "ready") {
      return new Map<string, string>();
    }

    return new Map(catalogState.locations.map((location) => [location.id, location.name]));
  }, [catalogState]);

  const updateFormField = <TField extends keyof ServiceFormState>(field: TField, value: ServiceFormState[TField]) => {
    setFormState((current) => ({ ...current, [field]: value }));
  };

  const handleCreateService = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (catalogState.kind !== "ready") {
      return;
    }

    const trimmedName = formState.name.trim();
    const priceCents = parseMoneyInput(formState.priceAmount);
    const depositCents = parseMoneyInput(formState.depositAmount);
    const durationMinutes = Number(formState.durationMinutes);

    if (!trimmedName || !Number.isInteger(durationMinutes) || durationMinutes < 15 || priceCents === null || depositCents === null) {
      setSaveState({
        kind: "error",
        message: "Enter a name, a 15-minute-plus duration, and valid price and deposit amounts.",
      });
      return;
    }

    if (!formState.locationId) {
      setSaveState({ kind: "error", message: "Choose an active location before creating the service." });
      return;
    }

    setSaveState({ kind: "saving" });

    try {
      const payload: CreateServiceRequest = {
        name: trimmedName,
        description: formState.description.trim() || undefined,
        durationMinutes,
        priceCents,
        depositCents,
        locationIds: [formState.locationId],
      };
      const createdService = await platformApi.createService(tenantSlug, payload);

      startTransition(() => {
        setCatalogState((current) => {
          if (current.kind !== "ready") {
            return current;
          }

          return {
            ...current,
            services: [...current.services, createdService],
          };
        });
        setFormState((current) => ({
          ...current,
          name: "",
          description: "",
          durationMinutes: "60",
          priceAmount: "",
        }));
        setSaveState({ kind: "success", message: "Service created and added to the demo catalog." });
      });
    } catch (error) {
      startTransition(() => {
        setSaveState({
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to create the service.",
        });
      });
    }
  };

  return (
    <main className="ops-page-stack">
      <section className="ops-hero ops-hero--compact">
        <div className="ops-hero-copy">
          <p className="eyebrow">{definition.eyebrow}</p>
          <h3>Create and price services without leaving the operator shell.</h3>
          <p>{definition.description}</p>
        </div>
        <div className="ops-hero-panel">
          <p className="eyebrow">Catalog state</p>
          <strong>{catalogState.kind === "ready" ? `${catalogState.services.length} live services` : definition.metric}</strong>
          <span>New services are written through the tenant API with explicit location coverage and deposit values.</span>
        </div>
      </section>

      <section className="catalog-layout">
        <article className="ops-panel">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Catalog editor</p>
              <h4>Create tenant-scoped service</h4>
            </div>
            {catalogState.kind === "ready" ? (
              <span className="status-chip status-chip--progress">Default deposit {formatMoney(catalogState.tenant.settings.defaultDepositCents)}</span>
            ) : null}
          </div>

          {saveState.kind !== "idle" ? (
            <div className={saveState.kind === "error" ? "message-banner message-banner--error" : "message-banner"}>
              {saveState.kind === "saving" ? "Saving service..." : saveState.message}
            </div>
          ) : null}

          {!canManageServices ? (
            <div className="message-banner message-banner--muted">Your role can review services, but it cannot create or edit the catalog.</div>
          ) : null}

          {catalogState.kind === "error" ? (
            <div className="calendar-state calendar-state--muted">{catalogState.message}</div>
          ) : (
            <form className="catalog-form" onSubmit={handleCreateService}>
              <fieldset className="form-fieldset" disabled={!canManageServices || saveState.kind === "saving" || catalogState.kind !== "ready"}>
                <div className="form-grid">
                <label>
                  <span>Service name</span>
                  <input
                    value={formState.name}
                    onChange={(event) => updateFormField("name", event.target.value)}
                    placeholder="Signature peel"
                    required
                  />
                </label>

                <label>
                  <span>Location</span>
                  <select
                    value={formState.locationId}
                    onChange={(event) => updateFormField("locationId", event.target.value)}
                    disabled={catalogState.kind !== "ready" || catalogState.locations.length === 0}
                  >
                    {(catalogState.kind === "ready" ? catalogState.locations : []).map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Duration (minutes)</span>
                  <input
                    type="number"
                    min="15"
                    step="15"
                    value={formState.durationMinutes}
                    onChange={(event) => updateFormField("durationMinutes", event.target.value)}
                    required
                  />
                </label>

                <label>
                  <span>Price</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formState.priceAmount}
                    onChange={(event) => updateFormField("priceAmount", event.target.value)}
                    placeholder="185.00"
                    required
                  />
                </label>

                <label>
                  <span>Deposit due today</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formState.depositAmount}
                    onChange={(event) => updateFormField("depositAmount", event.target.value)}
                    required
                  />
                </label>

                <label className="form-grid__full">
                  <span>Description</span>
                  <textarea
                    rows={4}
                    value={formState.description}
                    onChange={(event) => updateFormField("description", event.target.value)}
                    placeholder="Explain the treatment outcome, recovery, or pricing context."
                  />
                </label>
                </div>
              </fieldset>

              <div className="inline-meta">
                <span>Deposit cannot exceed the service price.</span>
                <button
                  type="submit"
                  className="primary-action"
                  disabled={saveState.kind === "saving" || catalogState.kind !== "ready" || !canManageServices}
                >
                  Create service
                </button>
              </div>
            </form>
          )}
        </article>

        <aside className="ops-panel">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Active catalog</p>
              <h4>Live service list</h4>
            </div>
            {catalogState.kind === "ready" ? <span className="status-chip status-chip--ready">{catalogState.services.length} services</span> : null}
          </div>

          {catalogState.kind === "loading" ? (
            <div className="calendar-state">Loading catalog...</div>
          ) : catalogState.kind === "error" ? (
            <div className="calendar-state calendar-state--muted">{catalogState.message}</div>
          ) : (
            <div className="service-catalog-list">
              {catalogState.services.map((service) => {
                const previewLocationId = service.locationIds[0] ?? catalogState.locations[0]?.id;
                const previewHref = previewLocationId
                  ? `${storefrontBaseUrl}/${tenantSlug}/services?locationId=${previewLocationId}`
                  : `${storefrontBaseUrl}/${tenantSlug}/services`;

                return (
                  <article key={service.id} className="service-catalog-card">
                    <div>
                      <p className="eyebrow">{service.isActive ? "Active" : "Inactive"}</p>
                      <h5>{service.name}</h5>
                    </div>
                    <p>{service.description ?? "No service description added yet."}</p>
                    <dl className="service-stats">
                      <div>
                        <dt>Duration</dt>
                        <dd>{service.durationMinutes} min</dd>
                      </div>
                      <div>
                        <dt>Price</dt>
                        <dd>{formatMoney(service.priceCents)}</dd>
                      </div>
                      <div>
                        <dt>Deposit</dt>
                        <dd>{formatMoney(service.depositCents)}</dd>
                      </div>
                    </dl>
                    <div className="catalog-location-list">
                      {service.locationIds.map((locationId) => (
                        <span key={locationId} className="status-chip status-chip--planned">
                          {locationNamesById.get(locationId) ?? "Assigned location"}
                        </span>
                      ))}
                    </div>
                    <a href={previewHref} target="_blank" rel="noreferrer" className="secondary-action">
                      Preview storefront
                    </a>
                  </article>
                );
              })}
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function PaymentsPage({ definition, currentUser }: { definition: RouteDefinition; currentUser: AuthenticatedUser | null }) {
  const [followUpState, setFollowUpState] = useState<PaymentFollowUpState>({ kind: "loading" });
  const [actionState, setActionState] = useState<PaymentActionState>({ kind: "idle" });
  const canViewPayments = currentUser !== null && hasPermission(currentUser, "payments.view");
  const canManagePayments = currentUser !== null && hasPermission(currentUser, "payments.manage");
  const tenantSlug = currentUser?.tenantSlug ?? "";

  const loadFollowUp = async () => {
    const response = await platformApi.listPaymentFollowUp(tenantSlug);
    startTransition(() => {
      setFollowUpState({ kind: "ready", items: response.items });
    });
    return response.items;
  };

  useEffect(() => {
    let isCancelled = false;

    if (!canViewPayments) {
      setFollowUpState({ kind: "error", message: "Your role can access the dashboard, but it cannot view payment follow-up work." });
      return () => {
        isCancelled = true;
      };
    }

    if (!tenantSlug) {
      setFollowUpState({ kind: "error", message: "Tenant session is missing tenant context." });
      return () => {
        isCancelled = true;
      };
    }

    const loadFollowUp = async () => {
      try {
        const response = await platformApi.listPaymentFollowUp(tenantSlug);
        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setFollowUpState({ kind: "ready", items: response.items });
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        startTransition(() => {
          setFollowUpState({
            kind: "error",
            message: error instanceof Error ? error.message : "Unable to load payment follow-up work.",
          });
        });
      }
    };

    void loadFollowUp();

    return () => {
      isCancelled = true;
    };
  }, [canViewPayments, tenantSlug]);

  const ensureCheckoutLink = async (item: DepositPaymentFollowUpItem) => {
    const checkoutSession = await platformApi.createCheckoutSession({
      tenantSlug,
      bookingDraftId: item.bookingDraft.id,
      kind: "deposit",
      successUrl: `${storefrontBaseUrl}/${tenantSlug}/book/${item.bookingDraft.id}/success`,
      cancelUrl: `${storefrontBaseUrl}/${tenantSlug}/book/${item.bookingDraft.id}`,
    });

    await loadFollowUp();
    return checkoutSession;
  };

  const handleOpenCheckoutLink = async (item: DepositPaymentFollowUpItem) => {
    if (!canManagePayments || !tenantSlug) {
      return;
    }

    setActionState({ kind: "submitting", bookingDraftId: item.bookingDraft.id });

    try {
      const checkoutSession = await ensureCheckoutLink(item);
      window.open(checkoutSession.checkoutUrl, "_blank", "noopener,noreferrer");

      startTransition(() => {
        setActionState({
          kind: "success",
          message:
            item.linkState === "open"
              ? "Opened the current checkout link in a new tab."
              : "Generated a fresh checkout link and opened it in a new tab.",
        });
      });
    } catch (error) {
      startTransition(() => {
        setActionState({
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to open the checkout link.",
        });
      });
    }
  };

  const handleCopyCheckoutLink = async (item: DepositPaymentFollowUpItem) => {
    if (!canManagePayments || !tenantSlug) {
      return;
    }

    setActionState({ kind: "submitting", bookingDraftId: item.bookingDraft.id });

    try {
      const checkoutSession = await ensureCheckoutLink(item);
      await copyTextToClipboard(checkoutSession.checkoutUrl);

      startTransition(() => {
        setActionState({
          kind: "success",
          message: "Copied checkout link to the clipboard.",
        });
      });
    } catch (error) {
      startTransition(() => {
        setActionState({
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to copy the checkout link.",
        });
      });
    }
  };

  const handleSendReminderEmail = async (item: DepositPaymentFollowUpItem) => {
    if (!canManagePayments || !tenantSlug) {
      return;
    }

    setActionState({ kind: "submitting", bookingDraftId: item.bookingDraft.id });

    try {
      const reminder = await platformApi.sendPaymentReminder(tenantSlug, item.bookingDraft.id);
      await loadFollowUp();

      startTransition(() => {
        setActionState({
          kind: "success",
          message: `Reminder email sent to ${reminder.recipientEmail}.`,
        });
      });
    } catch (error) {
      startTransition(() => {
        setActionState({
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to send the reminder email.",
        });
      });
    }
  };

  const handleDraftReminderEmail = async (item: DepositPaymentFollowUpItem) => {
    if (!canManagePayments || !tenantSlug) {
      return;
    }

    setActionState({ kind: "submitting", bookingDraftId: item.bookingDraft.id });

    try {
      const checkoutSession = await ensureCheckoutLink(item);
      window.open(buildDepositReminderMailto(item, checkoutSession.checkoutUrl), "_blank", "noopener,noreferrer");

      startTransition(() => {
        setActionState({
          kind: "success",
          message: "Opened a prefilled reminder email.",
        });
      });
    } catch (error) {
      startTransition(() => {
        setActionState({
          kind: "error",
          message: error instanceof Error ? error.message : "Unable to draft the reminder email.",
        });
      });
    }
  };

  return (
    <main className="ops-page-stack">
      <section className="ops-hero ops-hero--compact">
        <div className="ops-hero-copy">
          <p className="eyebrow">{definition.eyebrow}</p>
          <h3>Keep unpaid deposits from going cold.</h3>
          <p>{definition.description}</p>
        </div>
        <div className="ops-hero-panel">
          <p className="eyebrow">Deposit queue</p>
          <strong>{followUpState.kind === "ready" ? `${followUpState.items.length} awaiting payment` : definition.metric}</strong>
          <span>Operators can send or prepare deposit reminders without losing tenant context.</span>
        </div>
      </section>

      <section className="catalog-layout">
        <article className="ops-panel">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Deposit follow-up</p>
              <h4>Outstanding payment links</h4>
            </div>
            {followUpState.kind === "ready" ? (
              <span className="status-chip status-chip--progress">{followUpState.items.length} drafts</span>
            ) : null}
          </div>

          {actionState.kind !== "idle" ? (
            <div className={actionState.kind === "error" ? "message-banner message-banner--error" : "message-banner"}>
              {actionState.kind === "submitting" ? "Preparing outreach..." : actionState.message}
            </div>
          ) : null}

          {!canManagePayments && canViewPayments ? (
            <div className="message-banner message-banner--muted">Your role can review payment follow-up work, but it cannot send reminders, reopen links, or draft outreach.</div>
          ) : null}

          {followUpState.kind === "loading" ? (
            <div className="calendar-state">Loading payment follow-up queue...</div>
          ) : followUpState.kind === "error" ? (
            <div className="calendar-state calendar-state--muted">{followUpState.message}</div>
          ) : followUpState.items.length === 0 ? (
            <div className="calendar-state calendar-state--muted">No deposit follow-up work is waiting right now.</div>
          ) : (
            <div className="service-catalog-list">
              {followUpState.items.map((item) => (
                <article key={item.bookingDraft.id} className="service-catalog-card">
                  <div className="panel-title-row">
                    <div>
                      <p className="eyebrow">Deposit follow-up</p>
                      <h5>{item.bookingDraft.customer?.name ?? item.bookingDraft.customer?.email ?? item.bookingDraft.service.name}</h5>
                    </div>
                    <span className={`status-chip status-chip--${getPaymentLinkTone(item)}`}>{getPaymentLinkLabel(item)}</span>
                  </div>
                  <p>
                    {item.bookingDraft.service.name} with {item.bookingDraft.provider.name} on {formatDateTime(item.bookingDraft.startsAt)}.
                  </p>
                  <dl className="service-stats">
                    <div>
                      <dt>Deposit due</dt>
                      <dd>{formatMoney(item.bookingDraft.depositCents)}</dd>
                    </div>
                    <div>
                      <dt>Link expires</dt>
                      <dd>{item.checkoutExpiresAt ? formatDateTime(item.checkoutExpiresAt) : "No link yet"}</dd>
                    </div>
                    <div>
                      <dt>Customer</dt>
                      <dd>{item.bookingDraft.customer?.email ?? "Missing email"}</dd>
                    </div>
                  </dl>
                  <div className="catalog-location-list">
                    <span className="status-chip status-chip--planned">{item.bookingDraft.provider.name}</span>
                    <span className="status-chip status-chip--planned">{item.paymentStatus ?? "pending"}</span>
                  </div>
                  <div className="action-row">
                    <button
                      type="button"
                      className="primary-action"
                      disabled={
                        !canManagePayments ||
                        !item.bookingDraft.customer?.email ||
                        (actionState.kind === "submitting" && actionState.bookingDraftId === item.bookingDraft.id)
                      }
                      onClick={() => {
                        void handleSendReminderEmail(item);
                      }}
                    >
                      {actionState.kind === "submitting" && actionState.bookingDraftId === item.bookingDraft.id
                        ? "Working..."
                        : "Send reminder email"}
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={!canManagePayments || (actionState.kind === "submitting" && actionState.bookingDraftId === item.bookingDraft.id)}
                      onClick={() => {
                        void handleOpenCheckoutLink(item);
                      }}
                    >
                      {item.linkState === "open" ? "Open checkout link" : "Reopen checkout link"}
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={
                        !canManagePayments ||
                        !item.bookingDraft.customer?.email ||
                        (actionState.kind === "submitting" && actionState.bookingDraftId === item.bookingDraft.id)
                      }
                      onClick={() => {
                        void handleDraftReminderEmail(item);
                      }}
                    >
                      Draft reminder email
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={!canManagePayments || (actionState.kind === "submitting" && actionState.bookingDraftId === item.bookingDraft.id)}
                      onClick={() => {
                        void handleCopyCheckoutLink(item);
                      }}
                    >
                      Copy checkout link
                    </button>
                    <a
                      href={`${storefrontBaseUrl}/${tenantSlug}/book/${item.bookingDraft.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="secondary-action"
                    >
                      Open booking review
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>

        <aside className="ops-panel">
          <p className="eyebrow">Operator steps</p>
          <h4>Handle unpaid deposits</h4>
          <ul className="check-list">
            <li>Review drafts that are still waiting on deposit payment.</li>
            <li>Send a real reminder email from the backend, or open, copy, and draft outreach with a current hosted checkout link when needed.</li>
            <li>Jump into the storefront booking review when the operator needs the exact public context.</li>
          </ul>
        </aside>
      </section>
    </main>
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
