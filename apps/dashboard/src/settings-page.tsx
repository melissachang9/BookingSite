import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
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
  type CancellationRefundMethod,
  type TenantSummary,
} from "@booking/shared-types";

import { platformApi } from "./platform-api";
import { uploadImageFile } from "./upload-image";
import { DEFAULT_PANEL_COLOR, isHexColor, readableTextColor } from "./color";
import { CropModal } from "./staff-page";
import { PaymentsSettingsSection } from "./payments-settings-section";

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

type SettingsGroup =
  | "Business setup"
  | "Marketing"
  | "Calendar & appointments"
  | "Notifications"
  | "Payments & checkout"
  | "Advanced";

// Each group has its own pastel, shared by its label in the nav and the pill
// on every section card in that group.
const GROUP_TONES: Record<SettingsGroup, "mint" | "pink" | "peach" | "lilac" | "blue" | "grey"> = {
  "Business setup": "mint",
  Marketing: "pink",
  "Calendar & appointments": "peach",
  Notifications: "lilac",
  "Payments & checkout": "blue",
  Advanced: "grey",
};

type SectionDefinition = {
  id: string;
  title: string;
  eyebrow: SettingsGroup;
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
    title: "Marketing",
    eyebrow: "Marketing",
    description: "Brand colors, gallery photos, and the storefront marketing panel.",
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
    id: "business-policies",
    title: "Business Policies",
    eyebrow: "Calendar & appointments",
    description: "Cancellation window, deposit defaults, booking lead time, and no-show fees.",
    status: "available",
  },
  {
    id: "automated-messages",
    title: "Automated Messages",
    eyebrow: "Notifications",
    description: "Configure automated email reminders for intake forms and upcoming appointments.",
    status: "available",
  },
  {
    id: "appointment-reminders",
    title: "Appointment Reminders",
    eyebrow: "Notifications",
    description: "Send email and SMS reminders to customers before their appointments.",
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
    id: "cs-client-ownership",
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
  {
    id: "payments",
    title: "Card Processor",
    eyebrow: "Payments & checkout",
    description: "Connect Clover for card payments, deposit links and refunds.",
    status: "available",
  },
  {
    id: "payment-methods",
    title: "Payment Methods",
    eyebrow: "Payments & checkout",
    description: "Manage custom payment methods for checkout.",
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
    const groups = new Map<SettingsGroup, SectionDefinition[]>();
    for (const section of SECTION_DEFINITIONS) {
      const list = groups.get(section.eyebrow) ?? [];
      list.push(section);
      groups.set(section.eyebrow, list);
    }
    return Array.from(groups.entries());
  }, []);

  return (
    <main className="cs-page-stack cs-settings-page">
      <div className="cs-settings-layout">
        <nav className="cs-settings-nav" aria-label="Settings sections">
          <div className="cs-settings-nav__inner">
            {groupedSections.map(([groupTitle, sections]) => (
              <div key={groupTitle} className={`cs-settings-group cs-settings-tone--${GROUP_TONES[groupTitle]}`}>
                <p className="cs-settings-group__title">{groupTitle}</p>
                <ul>
                  {sections.map((section) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className={`cs-settings-link${activeSection === section.id ? " cs-settings-link--active" : ""}`}
                        onClick={() => setActiveSection(section.id)}
                      >
                        {section.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="cs-settings-content">
          {/* Same order as the nav, so scrolling follows the list on the left. */}
          {groupedSections.flatMap(([, sections]) => sections).map((section) => (
            <SettingsSection key={section.id} section={section}>
              {section.id === "calendar" ? (
                <CalendarDisplaySection
                  canManageSettings={canManageSettings}
                  tenant={tenant}
                  onTenantUpdated={onTenantUpdated}
                  tenantSlug={currentUser.tenantSlug}
                />
              ) : section.id === "business-policies" ? (
                <BusinessPoliciesSection
                  canManageSettings={canManageSettings}
                  tenant={tenant}
                  onTenantUpdated={onTenantUpdated}
                  tenantSlug={currentUser.tenantSlug}
                />
              ) : section.id === "automated-messages" ? (
                <AutomatedMessagesSection
                  canManageSettings={canManageSettings}
                  tenant={tenant}
                  onTenantUpdated={onTenantUpdated}
                  tenantSlug={currentUser.tenantSlug}
                />
              ) : section.id === "appointment-reminders" ? (
                <AppointmentRemindersSection
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
              ) : section.id === "cs-client-ownership" ? (
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
              ) : section.id === "payments" ? (
                <PaymentsSettingsSection
                  tenantSlug={currentUser.tenantSlug}
                  canConfigure={hasPermission(currentUser, "payments.configure")}
                />
              ) : section.id === "payment-methods" ? (
                <PaymentMethodsSection
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
    <section id={section.id} className={`cs-settings-section cs-settings-tone--${GROUP_TONES[section.eyebrow]}`}>
      <header className="cs-settings-section__header">
        <p className="cs-settings-eyebrow">{section.eyebrow}</p>
        <h4>{section.title}</h4>
        <p className="cs-settings-help">{section.description}</p>
      </header>
      <div className="cs-settings-section__body">{children}</div>
    </section>
  );
}

function PlannedPlaceholder({ phase }: { phase: string }) {
  return (
    <div className="cs-settings-placeholder">
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
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (tenant) {
      setStartHour(tenant.settings.calendarDisplayStartHour);
      setEndHour(tenant.settings.calendarDisplayEndHour);
      setWeekStartsOn(tenant.settings.weekStartsOn ?? 0);
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
    <form className="cs-form" onSubmit={handleSubmit}>
      <div className="cs-form-row">
        <label className="cs-field">
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
        <label className="cs-field">
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

      <label className="cs-field">
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


      {validationMessage ? <p role="alert" className="cs-error">{validationMessage}</p> : null}
      {saveState.kind === "success" ? <p role="status" className="cs-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="cs-error">{saveState.message}</p> : null}

      <div className="cs-actions">
        <button
          type="submit"
          className="cs-btn cs-btn--primary cs-btn--sm"
          disabled={!canManageSettings || validationMessage !== null || saveState.kind === "submitting"}
        >
          {saveState.kind === "submitting" ? "Saving…" : "Save calendar hours"}
        </button>
        {!canManageSettings ? (
          <p className="cs-permission-note">You do not have permission to edit tenant settings.</p>
        ) : null}
      </div>
    </form>
  );
}

function BusinessPoliciesSection({
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
  const [cancellationWindowHours, setCancellationWindowHours] = useState<number>(tenant?.settings.cancellationWindowHours ?? 24);
  const [cancellationRefundMethod, setCancellationRefundMethod] = useState<CancellationRefundMethod>(
    tenant?.settings.cancellationRefundMethod ?? "original_payment",
  );
  const [minLeadTimeMinutes, setMinLeadTimeMinutes] = useState<number>(tenant?.settings.minLeadTimeMinutes ?? 60);
  const [maxAdvanceBookingDays, setMaxAdvanceBookingDays] = useState<number>(tenant?.settings.maxAdvanceBookingDays ?? 45);
  const [noShowFeeCents, setNoShowFeeCents] = useState<number>(tenant?.settings.noShowFeeCents ?? 0);
  const [autoChargeNoShowFee, setAutoChargeNoShowFee] = useState<boolean>(tenant?.settings.autoChargeNoShowFee ?? false);
  const [paymentLinkExpiryMinutes, setPaymentLinkExpiryMinutes] = useState<number>(
    tenant?.settings.paymentLinkExpiryMinutes ?? 30,
  );
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (tenant) {
      setCancellationWindowHours(tenant.settings.cancellationWindowHours);
      setCancellationRefundMethod(tenant.settings.cancellationRefundMethod ?? "original_payment");
      setMinLeadTimeMinutes(tenant.settings.minLeadTimeMinutes);
      setMaxAdvanceBookingDays(tenant.settings.maxAdvanceBookingDays);
      setNoShowFeeCents(tenant.settings.noShowFeeCents);
      setAutoChargeNoShowFee(tenant.settings.autoChargeNoShowFee ?? false);
      setPaymentLinkExpiryMinutes(tenant.settings.paymentLinkExpiryMinutes ?? 30);
    }
  }, [tenant]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageSettings) {
      return;
    }
    setSaveState({ kind: "submitting" });
    try {
      const updated = await platformApi.updateTenantSettings(tenantSlug, {
        cancellationWindowHours,
        cancellationRefundMethod,
        minLeadTimeMinutes,
        maxAdvanceBookingDays,
        noShowFeeCents,
        autoChargeNoShowFee,
        paymentLinkExpiryMinutes,
      });
      onTenantUpdated(updated);
      setSaveState({ kind: "success", message: "Business policies saved." });
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
    <form className="cs-form" onSubmit={handleSubmit}>
      <p className="cs-kicker">Cancellation & refunds</p>

      <div className="cs-form-row">
        <label className="cs-field">
          <span>Cancellation window (hours)</span>
          <input
            type="number"
            min={0}
            max={168}
            value={cancellationWindowHours}
            onChange={(event) => setCancellationWindowHours(Number(event.target.value))}
            disabled={!canManageSettings || saveState.kind === "submitting"}
          />
          <small>Hours before the appointment when the cancellation policy applies. 0 means no window.</small>
        </label>
        <label className="cs-field">
          <span>Refund for cancellations with notice</span>
          <select
            value={cancellationRefundMethod}
            onChange={(event) => setCancellationRefundMethod(event.target.value as CancellationRefundMethod)}
            disabled={!canManageSettings || saveState.kind === "submitting"}
          >
            <option value="original_payment">Refund to the original payment method</option>
            <option value="wallet_credit">Give it back as credit</option>
          </select>
          <small>
            Applies when a client cancels before the window starts. Credit goes to the client's wallet, works on any
            service and never expires. Cancellations inside the window keep the deposit.
          </small>
        </label>
      </div>

      <p className="cs-kicker">Booking rules</p>

      <div className="cs-form-row">
        <label className="cs-field">
          <span>Minimum lead time (minutes)</span>
          <input
            type="number"
            min={0}
            max={1440}
            value={minLeadTimeMinutes}
            onChange={(event) => setMinLeadTimeMinutes(Number(event.target.value))}
            disabled={!canManageSettings || saveState.kind === "submitting"}
          />
          <small>How far in advance a customer must book. 0 means no minimum.</small>
        </label>
        <label className="cs-field">
          <span>Maximum advance booking (days)</span>
          <input
            type="number"
            min={1}
            max={365}
            value={maxAdvanceBookingDays}
            onChange={(event) => setMaxAdvanceBookingDays(Number(event.target.value))}
            disabled={!canManageSettings || saveState.kind === "submitting"}
          />
          <small>How far into the future customers can book.</small>
        </label>
      </div>

      <p className="cs-kicker">Fees</p>

      <div className="cs-form-row">
        <label className="cs-field">
          <span>No-show fee ($)</span>
          <input
            type="number"
            min={0}
            max={1000}
            step={0.01}
            value={(noShowFeeCents / 100).toFixed(2)}
            onChange={(event) => setNoShowFeeCents(Math.round(parseFloat(event.target.value || "0") * 100))}
            disabled={!canManageSettings || saveState.kind === "submitting"}
          />
          <small>Fee charged when a customer does not show up.</small>
        </label>
      </div>

      <div className="cs-form-row">
        <div className="cs-field">
          <span>Auto-charge no-show fee</span>
          <label className="cs-switch-row">
            <input
              type="checkbox"
              checked={autoChargeNoShowFee}
              onChange={(event) => setAutoChargeNoShowFee(event.target.checked)}
              disabled={!canManageSettings || saveState.kind === "submitting"}
            />
            <span>Automatically charge the no-show fee when marking a booking as no-show</span>
          </label>
        </div>
      </div>

      <div className="cs-form-row">
        <label className="cs-field">
          <span>Payment link holds the slot for (minutes)</span>
          <input
            type="number"
            min={30}
            max={1440}
            step={5}
            value={paymentLinkExpiryMinutes}
            onChange={(event) => setPaymentLinkExpiryMinutes(parseInt(event.target.value || "30", 10))}
            disabled={!canManageSettings || saveState.kind === "submitting"}
          />
          <small>
            When staff text or email a deposit link, the time stays held this long (30 minutes to 24 hours). Resending
            the link doesn't extend it.
          </small>
        </label>
      </div>

      {saveState.kind === "success" ? <p role="status" className="cs-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="cs-error">{saveState.message}</p> : null}

      <div className="cs-actions">
        <button
          type="submit"
          className="cs-btn cs-btn--primary cs-btn--sm"
          disabled={!canManageSettings || saveState.kind === "submitting"}
        >
          {saveState.kind === "submitting" ? "Saving…" : "Save policies"}
        </button>
        {!canManageSettings ? (
          <p className="cs-permission-note">You do not have permission to edit tenant settings.</p>
        ) : null}
      </div>
    </form>
  );
}

function AutomatedMessagesSection({
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
  const [reminderHoursBefore, setReminderHoursBefore] = useState<number>(tenant?.settings.reminderHoursBefore ?? 24);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (tenant) {
      setReminderHoursBefore(tenant.settings.reminderHoursBefore ?? 24);
    }
  }, [tenant]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageSettings) {
      return;
    }
    setSaveState({ kind: "submitting" });
    try {
      const updated = await platformApi.updateTenantSettings(tenantSlug, {
        reminderHoursBefore,
      });
      onTenantUpdated(updated);
      setSaveState({ kind: "success", message: "Automated message settings saved." });
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
    <form className="cs-form" onSubmit={handleSubmit}>
      <p className="cs-kicker">Form reminders</p>

      <label className="cs-field">
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
        <small>How far in advance to send a reminder email when a customer chooses to complete intake forms later.</small>
      </label>

      {saveState.kind === "success" ? <p role="status" className="cs-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="cs-error">{saveState.message}</p> : null}

      <div className="cs-actions">
        <button
          type="submit"
          className="cs-btn cs-btn--primary cs-btn--sm"
          disabled={!canManageSettings || saveState.kind === "submitting"}
        >
          {saveState.kind === "submitting" ? "Saving…" : "Save message settings"}
        </button>
        {!canManageSettings ? (
          <p className="cs-permission-note">You do not have permission to edit tenant settings.</p>
        ) : null}
      </div>
    </form>
  );
}

function AppointmentRemindersSection({
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
  const [reminderHours, setReminderHours] = useState<number>(tenant?.settings?.appointmentReminderHours ?? 24);
  const [emailEnabled, setEmailEnabled] = useState<boolean>(
    Array.isArray(tenant?.settings?.appointmentReminderChannels)
      ? tenant!.settings.appointmentReminderChannels.includes("email")
      : true,
  );
  const [smsEnabled, setSmsEnabled] = useState<boolean>(
    Array.isArray(tenant?.settings?.appointmentReminderChannels)
      ? tenant!.settings.appointmentReminderChannels.includes("sms")
      : false,
  );
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (tenant) {
      setReminderHours(tenant.settings?.appointmentReminderHours ?? 24);
      const channels = tenant.settings?.appointmentReminderChannels;
      setEmailEnabled(Array.isArray(channels) ? channels.includes("email") : true);
      setSmsEnabled(Array.isArray(channels) ? channels.includes("sms") : false);
    }
  }, [tenant]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageSettings) return;
    setSaveState({ kind: "submitting" });
    try {
      const channels: string[] = [];
      if (emailEnabled) channels.push("email");
      if (smsEnabled) channels.push("sms");
      const updated = await platformApi.updateTenantSettings(tenantSlug, {
        appointmentReminderHours: reminderHours,
        appointmentReminderChannels: channels,
      });
      onTenantUpdated(updated);
      setSaveState({ kind: "success", message: "Appointment reminder settings saved." });
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
    <form className="cs-form" onSubmit={handleSubmit}>
      <p className="cs-kicker">Appointment reminders</p>
      <p className="cs-field-help">
        Send automated reminders to customers before their confirmed appointments.
      </p>

      <label className="cs-field">
        <span>Reminder timing (hours before)</span>
        <select
          value={reminderHours}
          onChange={(event) => setReminderHours(Number(event.target.value))}
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
        <small>How far in advance to send appointment reminders.</small>
      </label>

      <label className="cs-toggle-field">
        <input
          type="checkbox"
          checked={emailEnabled}
          onChange={(event) => setEmailEnabled(event.target.checked)}
          disabled={!canManageSettings || saveState.kind === "submitting"}
        />
        <span>
          <strong>Email reminders</strong>
          <small>Send appointment reminders via email.</small>
        </span>
      </label>

      <label className="cs-toggle-field">
        <input
          type="checkbox"
          checked={smsEnabled}
          onChange={(event) => setSmsEnabled(event.target.checked)}
          disabled={!canManageSettings || saveState.kind === "submitting"}
        />
        <span>
          <strong>SMS reminders</strong>
          <small>Send appointment reminders via SMS. Customers must have SMS consent enabled.</small>
        </span>
      </label>

      {saveState.kind === "success" ? <p role="status" className="cs-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="cs-error">{saveState.message}</p> : null}

      <div className="cs-actions">
        <button
          type="submit"
          className="cs-btn cs-btn--primary cs-btn--sm"
          disabled={!canManageSettings || saveState.kind === "submitting"}
        >
          {saveState.kind === "submitting" ? "Saving…" : "Save reminder settings"}
        </button>
        {!canManageSettings ? (
          <p className="cs-permission-note">You do not have permission to edit tenant settings.</p>
        ) : null}
      </div>
    </form>
  );
}

const COMMON_TIME_ZONES = [
  "America/St_Johns",
  "America/Halifax",
  "America/Toronto",
  "America/Winnipeg",
  "America/Edmonton",
  "America/Vancouver",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Australia/Sydney",
];

/** Every IANA zone the browser knows, always including the one currently saved. */
function timezoneOptions(current: string): string[] {
  let zones: string[] = COMMON_TIME_ZONES;
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    if (supported && supported.length > 0) zones = supported;
  } catch {
    // older browsers: the short list above is enough
  }
  return current && !zones.includes(current) ? [current, ...zones] : zones;
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
  const [timezone, setTimezone] = useState<string>("");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (tenant) {
      setTimezone(tenant.timezone);
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
        timezone,
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
    <form className="cs-form" onSubmit={handleSubmit}>
      <div className="cs-form-row">
        <label className="cs-field">
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
        <label className="cs-field">
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

      <div className="cs-form-row">
        <label className="cs-field">
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
        <label className="cs-field">
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
        <label className="cs-field">
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

      <div className="cs-form-row">
        <label className="cs-field">
          <span>Timezone</span>
          <select
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            disabled={!canManageSettings || saveState.kind === "submitting"}
          >
            {timezoneOptions(timezone).map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <small className="cs-field-help">
            Appointments keep their exact time. Times, weekly hours and business hours are shown and read in this timezone.
          </small>
        </label>
      </div>

      {validationMessage ? <p role="alert" className="cs-error">{validationMessage}</p> : null}
      {saveState.kind === "success" ? <p role="status" className="cs-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="cs-error">{saveState.message}</p> : null}

      <div className="cs-actions">
        <button
          type="submit"
          className="cs-btn cs-btn--primary cs-btn--sm"
          disabled={!canManageSettings || validationMessage !== null || saveState.kind === "submitting"}
        >
          {saveState.kind === "submitting" ? "Saving…" : "Save business details"}
        </button>
        {!canManageSettings ? (
          <p className="cs-permission-note">You do not have permission to edit business details.</p>
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

type TimeFormat = "12h" | "24h";

function to12h(hhmm: string): { hour: number; minute: number; period: "AM" | "PM" } {
  const [rawHour, rawMinute] = hhmm.split(":");
  const hour24 = Number(rawHour);
  const minute = Number(rawMinute);
  const period: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour, minute, period };
}

function from12h(hour: number, minute: number, period: "AM" | "PM"): string {
  let hour24 = hour % 12;
  if (period === "PM") hour24 += 12;
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function TimeField({
  value,
  onChange,
  disabled,
  format,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  format: TimeFormat;
  ariaLabel: string;
}) {
  if (format === "24h") {
    // Selects rather than <input type="time">, which follows the OS locale and
    // shows AM/PM on US machines even in 24-hour mode.
    const [hourText, minuteText] = value.split(":");
    return (
      <span className="cs-bh-time">
        <select
          value={hourText}
          onChange={(event) => onChange(`${event.target.value}:${minuteText}`)}
          disabled={disabled}
          aria-label={`${ariaLabel} hour`}
        >
          {Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0")).map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
        <span className="cs-bh-time__colon" aria-hidden="true">:</span>
        <select
          value={minuteText}
          onChange={(event) => onChange(`${hourText}:${event.target.value}`)}
          disabled={disabled}
          aria-label={`${ariaLabel} minute`}
        >
          {Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0")).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </span>
    );
  }
  const { hour, minute, period } = to12h(value);
  return (
    <span className="cs-bh-time">
      <select
        value={hour}
        onChange={(event) => onChange(from12h(Number(event.target.value), minute, period))}
        disabled={disabled}
        aria-label={`${ariaLabel} hour`}
      >
        {Array.from({ length: 12 }, (_, index) => index + 1).map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span className="cs-bh-time__colon" aria-hidden="true">:</span>
      <select
        value={minute}
        onChange={(event) => onChange(from12h(hour, Number(event.target.value), period))}
        disabled={disabled}
        aria-label={`${ariaLabel} minute`}
      >
        {Array.from({ length: 60 }, (_, index) => index).map((m) => (
          <option key={m} value={m}>{String(m).padStart(2, "0")}</option>
        ))}
      </select>
      <select
        value={period}
        onChange={(event) => onChange(from12h(hour, minute, event.target.value as "AM" | "PM"))}
        disabled={disabled}
        aria-label={`${ariaLabel} period`}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </span>
  );
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
  const [timeFormat, setTimeFormat] = useState<TimeFormat>("12h");
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
    <form className="cs-form" onSubmit={handleSubmit}>
      <div className="cs-bh-head">
        <label className="cs-switch-row">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            disabled={!canManageSettings || saveState.kind === "submitting"}
          />
          <span>Set business hours</span>
        </label>
        {enabled ? (
          <div className="cs-bh-format">
            <span className="cs-bh-format__label">Time format</span>
            <div className="cs-seg" role="group" aria-label="Time format">
              <button
                type="button"
                aria-pressed={timeFormat === "12h"}
                onClick={() => setTimeFormat("12h")}
              >
                12-hour
              </button>
              <button
                type="button"
                aria-pressed={timeFormat === "24h"}
                onClick={() => setTimeFormat("24h")}
              >
                24-hour
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {!enabled ? (
        <p className="cs-settings-help">Availability follows each provider&rsquo;s schedule.</p>
      ) : (
        <div className="cs-bh-grid">
          {BUSINESS_HOURS_WEEKDAY_KEYS.map((key) => {
            const day = week[key];
            return (
              <div key={key} className={`cs-bh-row${day.closed ? " cs-bh-row--closed" : ""}`}>
                <span className="cs-bh-row__label">{WEEKDAY_LABELS[key]}</span>
                <label className="cs-bh-row__field">
                  <span className="cs-visually-hidden">{WEEKDAY_LABELS[key]} open</span>
                  <TimeField
                    value={day.open}
                    onChange={(value) => updateDay(key, { open: value })}
                    disabled={editorDisabled || day.closed}
                    format={timeFormat}
                    ariaLabel={`${WEEKDAY_LABELS[key]} open`}
                  />
                </label>
                <span aria-hidden="true">–</span>
                <label className="cs-bh-row__field">
                  <span className="cs-visually-hidden">{WEEKDAY_LABELS[key]} close</span>
                  <TimeField
                    value={day.close}
                    onChange={(value) => updateDay(key, { close: value })}
                    disabled={editorDisabled || day.closed}
                    format={timeFormat}
                    ariaLabel={`${WEEKDAY_LABELS[key]} close`}
                  />
                </label>
                <label className="cs-bh-row__closed">
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

      <label className={`cs-switch-row${!enabled ? " cs-switch-row--disabled" : ""}`}>
        <input
          type="checkbox"
          checked={restrict}
          onChange={(event) => setRestrict(event.target.checked)}
          disabled={!canManageSettings || saveState.kind === "submitting" || !enabled}
        />
        <span>Only allow providers to offer services within business hours</span>
      </label>

      {validationMessage ? <p role="alert" className="cs-error">{validationMessage}</p> : null}
      {saveState.kind === "success" ? <p role="status" className="cs-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="cs-error">{saveState.message}</p> : null}

      <div className="cs-actions">
        <button
          type="submit"
          className="cs-btn cs-btn--primary cs-btn--sm"
          disabled={!canManageSettings || validationMessage !== null || saveState.kind === "submitting"}
        >
          {saveState.kind === "submitting" ? "Saving…" : "Save business hours"}
        </button>
        {!canManageSettings ? (
          <p className="cs-permission-note">You do not have permission to edit business hours.</p>
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
    return <p role="alert" className="cs-error">{state.message}</p>;
  }

  return (
    <div className="cs-locations-section">
      <ul className="cs-locations-list">
        {state.locations.map((location) => {
          const isEditing = editingId === location.id;
          return (
            <li key={location.id} className="cs-locations-list__item">
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
                <div className="cs-locations-list__row">
                  <div>
                    <strong>{location.name}</strong>
                    {location.id === defaultLocationId ? (
                      <span className="cs-locations-default-tag"> · Default</span>
                    ) : null}
                    <p className="cs-settings-help">
                      {[location.addressLine1, location.city, location.state, location.postalCode]
                        .filter(Boolean)
                        .join(", ") || "No address on file"}
                    </p>
                    <p className="cs-settings-help">
                      {location.phone ? `Phone: ${location.phone}` : "No phone"} · {location.timeZone}
                    </p>
                    {!location.isActive ? (
                      <p className="cs-settings-help">Inactive</p>
                    ) : null}
                  </div>
                  {canManageSettings ? (
                    <div className="cs-locations-list__actions">
                      <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={() => beginEdit(location)}>
                        Edit
                      </button>
                      {location.isActive ? (
                        <button
                          type="button"
                          className="cs-btn cs-btn--ghost cs-btn--sm"
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
                          className="cs-btn cs-btn--ghost cs-btn--sm"
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
          <div className="cs-actions">
            <button type="button" className="cs-btn cs-btn--primary cs-btn--sm" onClick={beginCreate}>
              Add location
            </button>
          </div>
        )
      ) : (
        <p className="cs-permission-note">You do not have permission to edit locations.</p>
      )}

      {!showCreate && editingId === null && saveState.kind === "success" ? (
        <p role="status" className="cs-status">{saveState.message}</p>
      ) : null}
      {!showCreate && editingId === null && saveState.kind === "error" ? (
        <p role="alert" className="cs-error">{saveState.message}</p>
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
    <form className="cs-form" onSubmit={onSubmit}>
      <label className="cs-field">
        <span>Location name</span>
        <input
          type="text"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          disabled={disabled}
          required
        />
      </label>
      <label className="cs-field">
        <span>Time zone</span>
        <select
          value={draft.timeZone}
          onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
          disabled={disabled}
          required
        >
          <option value="">Select a time zone…</option>
          {Intl.supportedValuesOf("timeZone").map((tz) => (
            <option key={tz} value={tz}>{tz}</option>
          ))}
        </select>
      </label>
      <label className="cs-field">
        <span>Address</span>
        <input
          type="text"
          value={draft.addressLine1}
          onChange={(event) => setDraft({ ...draft, addressLine1: event.target.value })}
          disabled={disabled}
        />
      </label>
      <label className="cs-field">
        <span>City</span>
        <input
          type="text"
          value={draft.city}
          onChange={(event) => setDraft({ ...draft, city: event.target.value })}
          disabled={disabled}
        />
      </label>
      <label className="cs-field">
        <span>State / region</span>
        <input
          type="text"
          value={draft.state}
          onChange={(event) => setDraft({ ...draft, state: event.target.value })}
          disabled={disabled}
        />
      </label>
      <label className="cs-field">
        <span>Postal code</span>
        <input
          type="text"
          value={draft.postalCode}
          onChange={(event) => setDraft({ ...draft, postalCode: event.target.value })}
          disabled={disabled}
        />
      </label>
      <label className="cs-field">
        <span>Phone</span>
        <input
          type="tel"
          value={draft.phone}
          onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
          disabled={disabled}
        />
      </label>
      {saveState.kind === "error" ? <p role="alert" className="cs-error">{saveState.message}</p> : null}
      <div className="cs-actions">
        <button type="submit" className="cs-btn cs-btn--primary cs-btn--sm" disabled={disabled}>
          {disabled ? "Saving…" : submitLabel}
        </button>
        <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
      </div>
    </form>
  );
}
/** An image that is uploaded (never typed in as a URL): preview, replace, remove, and an optional crop step. */
function ImageUploadField({
  label,
  value,
  onChange,
  disabled,
  tenantSlug,
  crop = false,
  help,
  inputId,
  render,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  disabled: boolean;
  tenantSlug: string;
  /** Show the crop dialog before uploading. */
  crop?: boolean;
  help?: string;
  /** The file input's id, so other parts of the page (like a live preview) can open the same picker. */
  inputId?: string;
  /** Replaces the default thumbnail and buttons, e.g. with a live preview that is itself the upload control. */
  render?: (state: { inputId: string; uploading: boolean; error: string | null; remove: () => void }) => ReactNode;
}) {
  const generatedId = useId();
  const fileInputId = inputId ?? generatedId;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);

  const upload = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const uploaded = await uploadImageFile(tenantSlug, file);
      onChange(uploaded.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to upload image.");
    } finally {
      setUploading(false);
    }
  };

  const cropDialog = cropFile ? (
    <CropModal
      file={cropFile}
      maskShape="rectangle"
      onCancel={() => setCropFile(null)}
      onSave={(blob) => {
        const cropped = new File([blob], "marketing.png", { type: "image/png" });
        setCropFile(null);
        void upload(cropped);
      }}
    />
  ) : null;
  const fileInput = (
    <input
      id={fileInputId}
      type="file"
      className="cs-visually-hidden"
      aria-label={`${label} file`}
      accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
      disabled={disabled || uploading}
      onChange={(event) => {
        const file = event.target.files?.[0] ?? null;
        event.target.value = "";
        if (!file) return;
        if (crop) setCropFile(file);
        else void upload(file);
      }}
    />
  );

  if (render) {
    return (
      <div className="cs-image-upload cs-image-upload--custom">
        {cropDialog}
        {fileInput}
        {render({ inputId: fileInputId, uploading, error, remove: () => onChange("") })}
        {help ? <span className="cs-field-help">{help}</span> : null}
      </div>
    );
  }

  return (
    <div className="cs-field cs-image-upload">
      <span>{label}</span>
      {cropFile ? (
        <CropModal
          file={cropFile}
          maskShape="rectangle"
          onCancel={() => setCropFile(null)}
          onSave={(blob) => {
            const cropped = new File([blob], "marketing.png", { type: "image/png" });
            setCropFile(null);
            void upload(cropped);
          }}
        />
      ) : null}
      <div className="cs-marketing-upload">
        {value ? (
          <label
            htmlFor={fileInputId}
            className={`cs-marketing-upload__preview${disabled || uploading ? "" : " is-clickable"}`}
            title={disabled ? undefined : "Click to replace"}
          >
            <img src={value} alt={`${label} preview`} />
            {disabled ? null : <span className="cs-marketing-upload__replace">Replace</span>}
          </label>
        ) : null}
        <div className="cs-marketing-upload__controls">
          <label className={`cs-btn cs-btn--ghost cs-btn--sm${disabled || uploading ? " is-disabled" : ""}`}>
            {value ? "Replace image" : "Upload image"}
            <input
              id={fileInputId}
              type="file"
              className="cs-visually-hidden"
              aria-label={`${label} file`}
              accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
              disabled={disabled || uploading}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                event.target.value = "";
                if (!file) return;
                if (crop) setCropFile(file);
                else void upload(file);
              }}
            />
          </label>
          {value ? (
            <button
              type="button"
              className="cs-btn cs-btn--ghost cs-btn--sm"
              onClick={() => onChange("")}
              disabled={disabled || uploading}
              aria-label={`Remove ${label}`}
            >
              Remove
            </button>
          ) : null}
          {uploading ? <small className="cs-field-help">Uploading…</small> : null}
          {error ? <small role="alert" className="cs-error">{error}</small> : null}
        </div>
      </div>
      {help ? <span className="cs-field-help">{help}</span> : null}
    </div>
  );
}

/** A row of uploaded gallery photos. */
function GalleryUploadField({
  photos,
  onChange,
  disabled,
  tenantSlug,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  disabled: boolean;
  tenantSlug: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="cs-field cs-image-upload">
      <span>Gallery photos</span>
      <div className="cs-gallery-upload">
        {photos.map((url, index) => (
          <div key={`${url}-${index}`} className="cs-gallery-upload__item">
            <img src={url} alt={`Gallery photo ${index + 1}`} />
            <button
              type="button"
              className="cs-gallery-upload__remove"
              aria-label={`Remove gallery photo ${index + 1}`}
              disabled={disabled}
              onClick={() => onChange(photos.filter((_, position) => position !== index))}
            >
              ×
            </button>
          </div>
        ))}
        <label className={`cs-gallery-upload__add${disabled || uploading ? " is-disabled" : ""}`}>
          {uploading ? "Uploading…" : "+ Add photo"}
          <input
            type="file"
            className="cs-visually-hidden"
            aria-label="Add gallery photo"
            accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
            disabled={disabled || uploading || photos.length >= 24}
            onChange={async (event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              if (!file) return;
              setError(null);
              setUploading(true);
              try {
                const uploaded = await uploadImageFile(tenantSlug, file);
                onChange([...photos, uploaded.url]);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Unable to upload image.");
              } finally {
                setUploading(false);
              }
            }}
          />
        </label>
      </div>
      {error ? <small role="alert" className="cs-error">{error}</small> : null}
      <span className="cs-field-help">Up to 24 photos.</span>
    </div>
  );
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FINANCING_URL_RE = /^https?:\/\/\S+$/i;

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
  const [photos, setPhotos] = useState<string[]>([]);
  const [bookingAdEnabled, setBookingAdEnabled] = useState<boolean>(true);
  const [bookingAdPanelColor, setBookingAdPanelColor] = useState<string>("");
  const [bookingAdLabel, setBookingAdLabel] = useState<string>("");
  const [bookingAdServiceLabel, setBookingAdServiceLabel] = useState<string>("");
  const [bookingAdLocationLabel, setBookingAdLocationLabel] = useState<string>("");
  const [bookingAdHeadline, setBookingAdHeadline] = useState<string>("");
  const [bookingAdBody, setBookingAdBody] = useState<string>("");
  const [bookingAdImageUrl, setBookingAdImageUrl] = useState<string>("");
  const [bookingAdImageAltText, setBookingAdImageAltText] = useState<string>("");
  const [bookingAdServiceImageUrl, setBookingAdServiceImageUrl] = useState<string>("");
  const [bookingAdServiceImageAltText, setBookingAdServiceImageAltText] = useState<string>("");
  const [bookingAdLocationImageUrl, setBookingAdLocationImageUrl] = useState<string>("");
  const [bookingAdLocationImageAltText, setBookingAdLocationImageAltText] = useState<string>("");
  const [bookingAdServiceHeadline, setBookingAdServiceHeadline] = useState<string>("");
  const [bookingAdServiceBody, setBookingAdServiceBody] = useState<string>("");
  const [bookingAdLocationHeadline, setBookingAdLocationHeadline] = useState<string>("");
  const [bookingAdLocationBody, setBookingAdLocationBody] = useState<string>("");
  const [bookingAdReviewHeadline, setBookingAdReviewHeadline] = useState<string>("");
  const [bookingAdReviewBody, setBookingAdReviewBody] = useState<string>("");
  const [financingEnabled, setFinancingEnabled] = useState<boolean>(false);
  const [financingButtonText, setFinancingButtonText] = useState<string>("");
  const [financingLinkUrl, setFinancingLinkUrl] = useState<string>("");
  const [financingMonths, setFinancingMonths] = useState<string>("12");
  const [financingAprLabel, setFinancingAprLabel] = useState<string>("");
  const [financingDisclosure, setFinancingDisclosure] = useState<string>("");
  const [financingTermsUrl, setFinancingTermsUrl] = useState<string>("");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (tenant) {
      const branding: TenantBranding = tenant.branding ?? {};
      setLogoUrl(branding.logoUrl ?? "");
      setFaviconUrl(branding.faviconUrl ?? "");
      setPrimaryColor(branding.primaryColor ?? "#9f5323");
      setAccentColor(branding.accentColor ?? "#7a3c13");
      setPhotos(branding.photos ?? []);
      setBookingAdEnabled(branding.bookingAd?.enabled ?? true);
      setBookingAdPanelColor(branding.bookingAd?.panelColor ?? "");
      setBookingAdLabel(branding.bookingAd?.label ?? "");
      setBookingAdServiceLabel(branding.bookingAd?.serviceLabel ?? "");
      setBookingAdLocationLabel(branding.bookingAd?.locationLabel ?? "");
      setBookingAdHeadline(branding.bookingAd?.headline ?? "");
      setBookingAdBody(branding.bookingAd?.body ?? "");
      setBookingAdImageUrl(branding.bookingAd?.imageUrl ?? "");
      setBookingAdImageAltText(branding.bookingAd?.imageAltText ?? "");
      setBookingAdServiceImageUrl(branding.bookingAd?.serviceImageUrl ?? "");
      setBookingAdServiceImageAltText(branding.bookingAd?.serviceImageAltText ?? "");
      setBookingAdLocationImageUrl(branding.bookingAd?.locationImageUrl ?? "");
      setBookingAdLocationImageAltText(branding.bookingAd?.locationImageAltText ?? "");
      setBookingAdServiceHeadline(branding.bookingAd?.serviceHeadline ?? "");
      setBookingAdServiceBody(branding.bookingAd?.serviceBody ?? "");
      setBookingAdLocationHeadline(branding.bookingAd?.locationHeadline ?? "");
      setBookingAdLocationBody(branding.bookingAd?.locationBody ?? "");
      setBookingAdReviewHeadline(branding.bookingAd?.reviewHeadline ?? "");
      setBookingAdReviewBody(branding.bookingAd?.reviewBody ?? "");
      setFinancingEnabled(branding.financing?.enabled ?? false);
      setFinancingButtonText(branding.financing?.buttonText ?? "");
      setFinancingLinkUrl(branding.financing?.linkUrl ?? "");
      setFinancingMonths(String(branding.financing?.months ?? 12));
      setFinancingAprLabel(branding.financing?.aprLabel ?? "");
      setFinancingDisclosure(branding.financing?.disclosure ?? "");
      setFinancingTermsUrl(branding.financing?.termsUrl ?? "");
    }
  }, [tenant]);

  const validationMessage = useMemo(() => {
    if (primaryColor.trim() && !HEX_COLOR_RE.test(primaryColor.trim())) {
      return "Primary color must be a #RGB or #RRGGBB hex value.";
    }
    if (accentColor.trim() && !HEX_COLOR_RE.test(accentColor.trim())) {
      return "Accent color must be a #RGB or #RRGGBB hex value.";
    }
    if (bookingAdPanelColor.trim() && !HEX_COLOR_RE.test(bookingAdPanelColor.trim())) {
      return "Card color must be a #RGB or #RRGGBB hex value.";
    }
    if (financingEnabled) {
      if (!FINANCING_URL_RE.test(financingLinkUrl.trim())) {
        return "Enter the financing link as a web address starting with http:// or https://.";
      }
      const months = Number(financingMonths);
      if (!Number.isInteger(months) || months < 2 || months > 84) {
        return "Financing months must be a whole number from 2 to 84.";
      }
      if (financingTermsUrl.trim() && !FINANCING_URL_RE.test(financingTermsUrl.trim())) {
        return "Enter the financing terms link as a web address starting with http:// or https://.";
      }
    }
    return null;
  }, [primaryColor, accentColor, bookingAdPanelColor, financingEnabled, financingLinkUrl, financingMonths, financingTermsUrl]);

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
        photos,
        bookingAd: {
          enabled: bookingAdEnabled,
          panelColor: bookingAdPanelColor.trim() || null,
          label: bookingAdLabel.trim() || null,
          serviceLabel: bookingAdServiceLabel.trim() || null,
          locationLabel: bookingAdLocationLabel.trim() || null,
          headline: bookingAdHeadline.trim() || null,
          body: bookingAdBody.trim() || null,
          imageUrl: bookingAdImageUrl.trim() || null,
          imageAltText: bookingAdImageAltText.trim() || null,
          serviceImageUrl: bookingAdServiceImageUrl.trim() || null,
          serviceImageAltText: bookingAdServiceImageAltText.trim() || null,
          locationImageUrl: bookingAdLocationImageUrl.trim() || null,
          locationImageAltText: bookingAdLocationImageAltText.trim() || null,
          serviceHeadline: bookingAdServiceHeadline.trim() || null,
          serviceBody: bookingAdServiceBody.trim() || null,
          locationHeadline: bookingAdLocationHeadline.trim() || null,
          locationBody: bookingAdLocationBody.trim() || null,
          reviewHeadline: bookingAdReviewHeadline.trim() || null,
          reviewBody: bookingAdReviewBody.trim() || null,
        },
        financing: {
          enabled: financingEnabled,
          buttonText: financingButtonText.trim() || null,
          linkUrl: financingLinkUrl.trim() || null,
          months: Number.isInteger(Number(financingMonths)) && financingMonths.trim() ? Number(financingMonths) : null,
          aprLabel: financingAprLabel.trim() || null,
          disclosure: financingDisclosure.trim() || null,
          termsUrl: financingTermsUrl.trim() || null,
        },
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
    <>
      <form className="cs-form cs-branding-section" onSubmit={handleSubmit}>
      <details className="cs-fieldset cs-collapsible" open>
      <summary>Logo, colors and gallery</summary>
      <div className="cs-form-row">
        <ImageUploadField label="Logo" value={logoUrl} onChange={setLogoUrl} disabled={disabled} tenantSlug={tenantSlug} />
        <ImageUploadField label="Favicon" value={faviconUrl} onChange={setFaviconUrl} disabled={disabled} tenantSlug={tenantSlug} />
      </div>

      <div className="cs-form-row">
        <label className="cs-field cs-branding-color-field">
          <span>Primary color</span>
          <div className="cs-branding-color-input">
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
        <label className="cs-field cs-branding-color-field">
          <span>Accent color</span>
          <div className="cs-branding-color-input">
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

      <GalleryUploadField photos={photos} onChange={setPhotos} disabled={disabled} tenantSlug={tenantSlug} />

      <label className="cs-toggle-field">
        <input
          type="checkbox"
          checked={bookingAdEnabled}
          onChange={(event) => setBookingAdEnabled(event.target.checked)}
          disabled={disabled}
        />
        <span>
          <strong>Show marketing panel on Begin booking</strong>
          <small>Turn this off to hide the right-side marketing container on the first booking screen.</small>
        </span>
      </label>
      </details>

      <details className="cs-fieldset cs-collapsible" open>
        <summary>Marketing panel</summary>
        <p className="cs-fieldset-help">Customize the marketing panel shown on the Begin booking screen.</p>
        <ImageUploadField
          label="Marketing image"
          inputId="begin-booking-photo"
          value={bookingAdImageUrl}
          onChange={setBookingAdImageUrl}
          disabled={disabled}
          tenantSlug={tenantSlug}
          crop
          help="This card is how the first booking screen looks. Click the photo to upload or replace it; the other screens use it unless they have their own."
          render={({ inputId, uploading, error, remove }) => (
            <div className="cs-field">
              <span>Photo and card</span>
              <div
                className="cs-promo-preview"
                aria-label="Begin booking card preview"
                style={{
                  background: isHexColor(bookingAdPanelColor) ? bookingAdPanelColor.trim() : DEFAULT_PANEL_COLOR,
                  color: readableTextColor(isHexColor(bookingAdPanelColor) ? bookingAdPanelColor.trim() : DEFAULT_PANEL_COLOR),
                }}
              >
                {disabled ? (
                  <div className="cs-promo-preview__media">
                    {bookingAdImageUrl ? <img src={bookingAdImageUrl} alt="" /> : <span>Photo</span>}
                  </div>
                ) : (
                  <label
                    htmlFor={inputId}
                    className="cs-promo-preview__media is-clickable"
                    data-busy={uploading || undefined}
                    title={bookingAdImageUrl ? "Click to replace the photo" : "Click to upload a photo"}
                  >
                    {bookingAdImageUrl ? <img src={bookingAdImageUrl} alt="Marketing image preview" /> : null}
                    <span className="cs-promo-preview__replace">
                      {uploading ? "Uploading…" : bookingAdImageUrl ? "Replace photo" : "Upload photo"}
                    </span>
                  </label>
                )}
                <p className="cs-promo-preview__label">{bookingAdLabel || "This season"}</p>
                <h4>{bookingAdHeadline || "Your headline"}</h4>
                <p>{bookingAdBody || "A line or two about what's on offer."}</p>
              </div>
              {bookingAdImageUrl && !disabled ? (
                <button type="button" className="cs-btn cs-btn--ghost cs-btn--sm cs-promo-preview__remove" onClick={remove} aria-label="Remove Marketing image">
                  Remove photo
                </button>
              ) : null}
              {error ? <small role="alert" className="cs-error">{error}</small> : null}
            </div>
          )}
        />
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Marketing image alt text</span>
            <input
              type="text"
              value={bookingAdImageAltText}
              onChange={(event) => setBookingAdImageAltText(event.target.value)}
              disabled={disabled}
              maxLength={512}
              placeholder="Studio reception area"
            />
          </label>
        </div>
        <div className="cs-form-row">
          <label className="cs-field cs-branding-color-field">
            <span>Card color</span>
            <div className="cs-branding-color-input">
              <input
                type="color"
                value={isHexColor(bookingAdPanelColor) ? bookingAdPanelColor.trim() : DEFAULT_PANEL_COLOR}
                onChange={(event) => setBookingAdPanelColor(event.target.value)}
                disabled={disabled}
                aria-label="Card color picker"
              />
              <input
                type="text"
                value={bookingAdPanelColor}
                onChange={(event) => setBookingAdPanelColor(event.target.value)}
                disabled={disabled}
                maxLength={16}
                placeholder={DEFAULT_PANEL_COLOR}
                aria-label="Card color hex"
              />
              {bookingAdPanelColor ? (
                <button
                  type="button"
                  className="cs-btn cs-btn--ghost cs-btn--sm"
                  onClick={() => setBookingAdPanelColor("")}
                  disabled={disabled}
                >
                  Reset
                </button>
              ) : null}
            </div>
            <span className="cs-field-help">The background of the card that holds the photo and text. Text turns light or dark to stay readable.</span>
          </label>
        </div>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Label above the headline</span>
            <input
              type="text"
              value={bookingAdLabel}
              onChange={(event) => setBookingAdLabel(event.target.value)}
              disabled={disabled}
              maxLength={60}
              placeholder="This season"
            />
            <span className="cs-field-help">A short line shown in small capitals above the headline.</span>
          </label>
        </div>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Marketing headline</span>
            <input
              type="text"
              value={bookingAdHeadline}
              onChange={(event) => setBookingAdHeadline(event.target.value)}
              disabled={disabled}
              maxLength={512}
              placeholder="Quiet booking, clear next steps."
            />
          </label>
        </div>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Marketing body</span>
            <textarea
              value={bookingAdBody}
              onChange={(event) => setBookingAdBody(event.target.value)}
              disabled={disabled}
              rows={3}
              maxLength={512}
              placeholder="Choose the visit type, location, provider preference, and time without losing context."
            />
          </label>
        </div>
      </details>

      <details className="cs-fieldset cs-collapsible">
        <summary>Select service screen</summary>
        <p className="cs-fieldset-help">Customize the marketing panel text shown on the &ldquo;Select a service&rdquo; step.</p>
        <ImageUploadField
          label="Service screen image"
          value={bookingAdServiceImageUrl}
          onChange={setBookingAdServiceImageUrl}
          disabled={disabled}
          tenantSlug={tenantSlug}
          crop
          help="Leave empty to use the marketing image."
        />
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Service screen image alt text</span>
            <input
              type="text"
              value={bookingAdServiceImageAltText}
              onChange={(event) => setBookingAdServiceImageAltText(event.target.value)}
              disabled={disabled}
              maxLength={512}
              placeholder="A treatment room"
            />
          </label>
        </div>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Service screen label</span>
            <input
              type="text"
              value={bookingAdServiceLabel}
              onChange={(event) => setBookingAdServiceLabel(event.target.value)}
              disabled={disabled}
              maxLength={60}
              placeholder="From the studio"
            />
          </label>
        </div>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Service screen headline</span>
            <input
              type="text"
              value={bookingAdServiceHeadline}
              onChange={(event) => setBookingAdServiceHeadline(event.target.value)}
              disabled={disabled}
              maxLength={512}
              placeholder="Choose a treatment that matches your ritual."
            />
          </label>
        </div>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Service screen body</span>
            <textarea
              value={bookingAdServiceBody}
              onChange={(event) => setBookingAdServiceBody(event.target.value)}
              disabled={disabled}
              rows={3}
              maxLength={512}
              placeholder="Clear timing, transparent deposits, and provider selection stay connected all the way to checkout."
            />
          </label>
        </div>
      </details>

      <details className="cs-fieldset cs-collapsible">
        <summary>Choose location screen</summary>
        <p className="cs-fieldset-help">Customize the marketing panel text shown on the &ldquo;Choose a location&rdquo; step.</p>
        <ImageUploadField
          label="Location screen image"
          value={bookingAdLocationImageUrl}
          onChange={setBookingAdLocationImageUrl}
          disabled={disabled}
          tenantSlug={tenantSlug}
          crop
          help="Leave empty to use the marketing image."
        />
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Location screen image alt text</span>
            <input
              type="text"
              value={bookingAdLocationImageAltText}
              onChange={(event) => setBookingAdLocationImageAltText(event.target.value)}
              disabled={disabled}
              maxLength={512}
              placeholder="The studio entrance"
            />
          </label>
        </div>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Location screen label</span>
            <input
              type="text"
              value={bookingAdLocationLabel}
              onChange={(event) => setBookingAdLocationLabel(event.target.value)}
              disabled={disabled}
              maxLength={60}
              placeholder="Our studios"
            />
          </label>
        </div>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Location screen headline</span>
            <input
              type="text"
              value={bookingAdLocationHeadline}
              onChange={(event) => setBookingAdLocationHeadline(event.target.value)}
              disabled={disabled}
              maxLength={512}
              placeholder="Choose the studio that fits your day."
            />
          </label>
        </div>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Location screen body</span>
            <textarea
              value={bookingAdLocationBody}
              onChange={(event) => setBookingAdLocationBody(event.target.value)}
              disabled={disabled}
              rows={3}
              maxLength={512}
              placeholder="Location-aware booking keeps service availability, checkout, and booking details consistent."
            />
          </label>
        </div>
      </details>

      <details className="cs-fieldset cs-collapsible">
        <summary>Booking review screen</summary>
        <p className="cs-fieldset-help">Customize the marketing panel text shown on the booking review step.</p>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Review screen headline</span>
            <input
              type="text"
              value={bookingAdReviewHeadline}
              onChange={(event) => setBookingAdReviewHeadline(event.target.value)}
              disabled={disabled}
              maxLength={512}
              placeholder="Booking held while you review"
            />
          </label>
        </div>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Review screen body</span>
            <textarea
              value={bookingAdReviewBody}
              onChange={(event) => setBookingAdReviewBody(event.target.value)}
              disabled={disabled}
              rows={3}
              maxLength={512}
              placeholder="Businesses can configure this artwork and message for the booking review step."
            />
          </label>
        </div>
      </details>

      <details className="cs-fieldset cs-collapsible" open={financingEnabled}>
        <summary>Financing</summary>
        <p className="cs-fieldset-help">
          Set up a financing button for the booking site, shown beside a service price like &ldquo;or $100/mo&rdquo;.
          It stays off until you turn it on for a category or a service under Services.
        </p>
        <label className="cs-toggle-field">
          <input
            type="checkbox"
            checked={financingEnabled}
            onChange={(event) => setFinancingEnabled(event.target.checked)}
            disabled={disabled}
          />
          <span>
            <strong>Financing available</strong>
            <small>Master switch. Each service shows its price divided by the number of months below.</small>
          </span>
        </label>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Button text</span>
            <input
              type="text"
              value={financingButtonText}
              onChange={(event) => setFinancingButtonText(event.target.value)}
              disabled={disabled}
              maxLength={60}
              placeholder="See financing options"
            />
          </label>
          <label className="cs-field">
            <span>Months</span>
            <input
              type="number"
              min={2}
              max={84}
              value={financingMonths}
              onChange={(event) => setFinancingMonths(event.target.value)}
              disabled={disabled}
              aria-label="Financing months"
            />
          </label>
        </div>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Financing link</span>
            <input
              type="url"
              value={financingLinkUrl}
              onChange={(event) => setFinancingLinkUrl(event.target.value)}
              disabled={disabled}
              maxLength={2048}
              placeholder="https://"
            />
            <small className="cs-field-help">Where the button sends clients, such as your financing provider&apos;s application page.</small>
          </label>
        </div>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Rate label (optional)</span>
            <input
              type="text"
              value={financingAprLabel}
              onChange={(event) => setFinancingAprLabel(event.target.value)}
              disabled={disabled}
              maxLength={24}
              placeholder="0% APR"
            />
            <small className="cs-field-help">Shown as a small tag next to the monthly amount. Only use wording your financing provider allows.</small>
          </label>
          <label className="cs-field">
            <span>Financing terms link (optional)</span>
            <input
              type="url"
              value={financingTermsUrl}
              onChange={(event) => setFinancingTermsUrl(event.target.value)}
              disabled={disabled}
              maxLength={2048}
              placeholder="https://"
            />
          </label>
        </div>
        <div className="cs-form-row">
          <label className="cs-field">
            <span>Note shown with the offer (optional)</span>
            <textarea
              value={financingDisclosure}
              onChange={(event) => setFinancingDisclosure(event.target.value)}
              disabled={disabled}
              rows={2}
              maxLength={400}
              placeholder="Quick eligibility check with no impact on your credit score. Subject to approval."
            />
            <small className="cs-field-help">Appears when a client opens the monthly amount and at checkout. Leave blank to show nothing.</small>
          </label>
        </div>
      </details>

      {validationMessage ? <p role="alert" className="cs-error">{validationMessage}</p> : null}
      {saveState.kind === "success" ? <p role="status" className="cs-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="cs-error">{saveState.message}</p> : null}

      <div className="cs-actions">
        <button
          type="submit"
          className="cs-btn cs-btn--primary cs-btn--sm"
          disabled={disabled || validationMessage !== null}
        >
          {saveState.kind === "submitting" ? "Saving…" : "Save branding"}
        </button>
        {!canManageSettings ? (
          <p className="cs-permission-note">You do not have permission to edit branding.</p>
        ) : null}
      </div>
    </form>
    </>
  );
}

function PayrollSection() {
  return (
    <div className="cs-payroll-section">
      <p className="cs-payroll-section__lead">
        Connect a bank account to run provider payroll directly from your booking platform.
      </p>
      <ul className="cs-payroll-section__bullets">
        <li>Calculate commissions per booking, service, or provider.</li>
        <li>Schedule weekly or biweekly payouts to provider bank accounts.</li>
        <li>Track tips, deductions, and 1099/contractor totals automatically.</li>
      </ul>
      <div className="cs-payroll-section__cta">
        <button type="button" className="cs-btn cs-btn--primary cs-btn--sm" disabled>
          Connect bank account
        </button>
        <p className="cs-permission-note">
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
    <form className="cs-form" onSubmit={handleSubmit}>
      <p className="cs-field-help">
        When client ownership is on, providers can only see customers assigned to them. Owners and
        managers always see all customers.
      </p>
      <label className="cs-toggle-field">
        <input
          type="checkbox"
          checked={clientOwnershipEnabled}
          onChange={(event) => {
            setClientOwnershipEnabled(event.target.checked);
            if (!event.target.checked) setOnlineAssignEnabled(false);
          }}
          disabled={disabled}
        />
        <span>
          <strong>Enable client ownership</strong>
          <small>Scope the customer list for non-manager roles to clients they own.</small>
        </span>
      </label>
      <label className={`cs-toggle-field${!clientOwnershipEnabled ? " cs-toggle-field--disabled" : ""}`}>
        <input
          type="checkbox"
          checked={onlineAssignEnabled}
          onChange={(event) => setOnlineAssignEnabled(event.target.checked)}
          disabled={disabled || !clientOwnershipEnabled}
        />
        <span>
          <strong>Assign owner on online bookings</strong>
          <small>
            {clientOwnershipEnabled
              ? "When a new customer books online, set their owner to the booked provider's user account. Existing customers are never reassigned."
              : "Enable client ownership above to use this feature."}
          </small>
        </span>
      </label>

      {saveState.kind === "success" ? <p role="status" className="cs-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="cs-error">{saveState.message}</p> : null}

      <div className="cs-actions">
        <button type="submit" className="cs-btn cs-btn--primary cs-btn--sm" disabled={disabled}>
          {saveState.kind === "submitting" ? "Saving…" : "Save client ownership"}
        </button>
        {!canManageSettings ? (
          <p className="cs-permission-note">You do not have permission to edit client ownership.</p>
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
    <form className="cs-form" onSubmit={handleSubmit}>
      <p className="cs-field-help">
        Use your own domain for outgoing emails. After saving, add the DNS records below at your
        domain registrar.
      </p>
      <label className="cs-field">
        <span>From address</span>
        <input
          type="text"
          value={fromAddress}
          onChange={(event) => setFromAddress(event.target.value)}
          placeholder="hello@yourdomain.com"
          disabled={disabled}
        />
      </label>
      <label className="cs-field">
        <span>Sending domain</span>
        <input
          type="text"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="yourdomain.com"
          disabled={disabled}
        />
      </label>

      {saveState.kind === "success" ? <p role="status" className="cs-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="cs-error">{saveState.message}</p> : null}

      <div className="cs-actions">
        <button type="submit" className="cs-btn cs-btn--primary cs-btn--sm" disabled={disabled}>
          {saveState.kind === "submitting" ? "Saving…" : "Save custom email"}
        </button>
        {!canManageSettings ? (
          <p className="cs-permission-note">You do not have permission to edit custom email.</p>
        ) : null}
      </div>

      <div className="cs-settings-subpanel">
        <h5>DNS records</h5>
        {dnsError ? <p role="alert" className="cs-error">{dnsError}</p> : null}
        {dnsDomain === null || records.length === 0 ? (
          <p className="cs-field-help">Save a sending domain to see the records you need to add.</p>
        ) : (
          <table className="cs-table">
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
        <div className="cs-actions">
          <button type="button" className="cs-btn cs-btn--primary cs-btn--sm" disabled aria-disabled="true">
            {verified ? "Verified" : "Verify"}
          </button>
          <p className="cs-permission-note">Verification ships in a later release.</p>
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
    <form className="cs-form" onSubmit={handleSubmit}>
      <p className="cs-field-help">
        Toggle wallet credit and membership programs. Balances and tiers are not yet implemented;
        these flags reserve the capability for future releases.
      </p>
      <label className="cs-toggle-field">
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
      <label className="cs-field">
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
      <label className="cs-toggle-field">
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

      {saveState.kind === "success" ? <p role="status" className="cs-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="cs-error">{saveState.message}</p> : null}

      <div className="cs-actions">
        <button type="submit" className="cs-btn cs-btn--primary cs-btn--sm" disabled={disabled}>
          {saveState.kind === "submitting" ? "Saving…" : "Save wallet & membership"}
        </button>
        {!canManageSettings ? (
          <p className="cs-permission-note">You do not have permission to edit wallet & membership.</p>
        ) : null}
      </div>
    </form>
  );
}

function PaymentMethodsSection({
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
  const [methods, setMethods] = useState<Array<{ id: string; label: string }>>([]);
  const [newLabel, setNewLabel] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    if (tenant) {
      setMethods([...tenant.settings.customPaymentMethods]);
    }
  }, [tenant]);

  const handleAdd = () => {
    const label = newLabel.trim();
    if (!label) return;
    const id = label.toLowerCase().replace(/\s+/g, "_");
    setMethods((prev) => [...prev, { id, label }]);
    setNewLabel("");
  };

  const handleRemove = (id: string) => {
    setMethods((prev) => prev.filter((m) => m.id !== id));
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageSettings) return;
    setSaveState({ kind: "submitting" });
    try {
      const updated = await platformApi.updateTenantSettings(tenantSlug, {
        customPaymentMethods: methods,
      });
      onTenantUpdated(updated);
      setSaveState({ kind: "success", message: "Payment methods saved." });
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to save payment methods.",
      });
    }
  };

  if (tenant === null) {
    return <p>Loading current settings…</p>;
  }

  const disabled = !canManageSettings || saveState.kind === "submitting";

  return (
    <form className="cs-form" onSubmit={handleSave}>
      <p className="cs-field-help">
        Define custom payment methods that appear in the checkout modal alongside built-in
        options (Cash, External POS, Manual/Card). These are saved per business and reusable.
      </p>
      <div className="cs-payment-methods-list">
        {methods.length === 0 ? (
          <p className="cs-empty">No custom payment methods defined.</p>
        ) : (
          <ul>
            {methods.map((m) => (
              <li key={m.id} className="cs-payment-method-row">
                <span>{m.label}</span>
                <button
                  type="button"
                  className="cs-btn cs-btn--danger cs-btn--sm"
                  onClick={() => handleRemove(m.id)}
                  disabled={disabled}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="cs-payment-methods-add">
        <input
          type="text"
          aria-label="New payment method"
          placeholder="Method label (e.g. Venmo, Zelle)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          className="cs-btn cs-btn--sm"
          onClick={handleAdd}
          disabled={disabled || !newLabel.trim()}
        >
          Add
        </button>
      </div>

      {saveState.kind === "success" ? <p role="status" className="cs-status">{saveState.message}</p> : null}
      {saveState.kind === "error" ? <p role="alert" className="cs-error">{saveState.message}</p> : null}

      <div className="cs-actions">
        <button type="submit" className="cs-btn cs-btn--primary cs-btn--sm" disabled={disabled}>
          {saveState.kind === "submitting" ? "Saving…" : "Save payment methods"}
        </button>
        {!canManageSettings ? (
          <p className="cs-permission-note">You do not have permission to edit payment methods.</p>
        ) : null}
      </div>
    </form>
  );
}
