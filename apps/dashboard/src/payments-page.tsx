import { startTransition, useEffect, useState } from "react";
import type {
  AuthenticatedUser,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  DepositPaymentFollowUpItem,
  DepositPaymentFollowUpListResponse,
  SendPaymentReminderResponse,
} from "@booking/shared-types";

import { platformApi } from "./platform-api";

type PaymentFollowUpState =
  | { kind: "loading" }
  | { kind: "ready"; items: DepositPaymentFollowUpItem[] }
  | { kind: "error"; message: string };

type PaymentActionState =
  | { kind: "idle" }
  | { kind: "submitting"; bookingDraftId: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export type PaymentsPageDefinition = {
  eyebrow: string;
  description: string;
  metric: string;
};

export type PaymentsPageApi = {
  listPaymentFollowUp: (tenantSlug: string) => Promise<DepositPaymentFollowUpListResponse>;
  createCheckoutSession: (body: CreateCheckoutSessionRequest) => Promise<CreateCheckoutSessionResponse>;
  sendPaymentReminder: (tenantSlug: string, bookingDraftId: string) => Promise<SendPaymentReminderResponse>;
};

type PaymentsPageProps = {
  definition: PaymentsPageDefinition;
  currentUser: AuthenticatedUser | null;
  api?: PaymentsPageApi;
  storefrontBaseUrl?: string;
};

const defaultStorefrontBaseUrl = import.meta.env.VITE_PUBLIC_STOREFRONT_BASE_URL ?? "http://127.0.0.1:3001";

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

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((permission) => permission.key === key && permission.allowed);
}

function formatMoney(cents: number): string {
  return currencyFormatter.format(cents / 100);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${dayLabelFormatter.format(date)} at ${timeFormatter.format(date)}`;
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
    throw new Error("Clipboard access is not available in this browser.");
  }

  await navigator.clipboard.writeText(value);
}

function getPaymentLinkLabel(item: DepositPaymentFollowUpItem): "Link ready" | "Link expired" | "Needs link" {
  if (item.linkState === "open") {
    return "Link ready";
  }

  if (item.linkState === "expired") {
    return "Link expired";
  }

  return "Needs link";
}

function getPaymentLinkTone(item: DepositPaymentFollowUpItem): "ready" | "progress" | "planned" {
  if (item.linkState === "open") {
    return "ready";
  }

  if (item.linkState === "expired") {
    return "progress";
  }

  return "planned";
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

export function PaymentsPage({
  definition,
  currentUser,
  api = platformApi,
  storefrontBaseUrl = defaultStorefrontBaseUrl,
}: PaymentsPageProps) {
  const [followUpState, setFollowUpState] = useState<PaymentFollowUpState>({ kind: "loading" });
  const [actionState, setActionState] = useState<PaymentActionState>({ kind: "idle" });
  const canViewPayments = currentUser !== null && hasPermission(currentUser, "payments.view");
  const canManagePayments = currentUser !== null && hasPermission(currentUser, "payments.manage");
  const tenantSlug = currentUser?.tenantSlug ?? "";

  const loadFollowUp = async () => {
    const response = await api.listPaymentFollowUp(tenantSlug);
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

    const loadPaymentFollowUp = async () => {
      try {
        const response = await api.listPaymentFollowUp(tenantSlug);
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

    void loadPaymentFollowUp();

    return () => {
      isCancelled = true;
    };
  }, [api, canViewPayments, tenantSlug]);

  const ensureCheckoutLink = async (item: DepositPaymentFollowUpItem) => {
    const checkoutSession = await api.createCheckoutSession({
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
      const reminder = await api.sendPaymentReminder(tenantSlug, item.bookingDraft.id);
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