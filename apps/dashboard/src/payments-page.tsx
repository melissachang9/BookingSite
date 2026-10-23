import { startTransition, useEffect, useState } from "react";
import type {
  AuthenticatedUser,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  DepositPaymentFollowUpItem,
  DepositPaymentFollowUpListResponse,
  SendPaymentReminderResponse,
} from "@booking/shared-types";

import { useMoneyFormat } from "./money-format";
import { MoneyHeldTab, type MoneyHeldTabApi } from "./payments-money-held-tab";
import { MoneyOwedPanel, type MoneyOwedApi } from "./payments-money-owed";
import { SalesTab, type SalesTabApi } from "./payments-sales-tab";
import { TransactionsTab, type TransactionsTabApi } from "./payments-transactions-tab";
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

export type PaymentsPageApi = TransactionsTabApi & SalesTabApi & MoneyHeldTabApi & MoneyOwedApi & {
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

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((permission) => permission.key === key && permission.allowed);
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

function buildDepositReminderMailto(
  item: DepositPaymentFollowUpItem,
  checkoutUrl: string,
  formatMoney: (cents: number) => string,
  formatDateTime: (iso: string) => string,
): string {
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

function DepositFollowUpPanel({
  currentUser,
  api,
  storefrontBaseUrl,
}: {
  currentUser: AuthenticatedUser | null;
  api: PaymentsPageApi;
  storefrontBaseUrl: string;
}) {
  const { money: formatMoney, dateTime: rawDateTime } = useMoneyFormat();
  const formatDateTime = (iso: string) => rawDateTime(iso).replace(", ", " at ");
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
      window.open(buildDepositReminderMailto(item, checkoutSession.checkoutUrl, formatMoney, formatDateTime), "_blank", "noopener,noreferrer");

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
    <div className="cs-page-stack">
      <section className="cs-catalog-layout">
        <article className="cs-panel-card">
          <div className="cs-panel-title-row">
            <div>
              <p className="cs-eyebrow">Deposit follow-up</p>
              <h4>Outstanding payment links</h4>
            </div>
            {followUpState.kind === "ready" ? (
              <span className="cs-status-chip cs-status-chip--progress">{followUpState.items.length} drafts</span>
            ) : null}
          </div>

          {actionState.kind !== "idle" ? (
            <div className={actionState.kind === "error" ? "cs-banner cs-banner--error" : "cs-banner"}>
              {actionState.kind === "submitting" ? "Preparing outreach..." : actionState.message}
            </div>
          ) : null}

          {!canManagePayments && canViewPayments ? (
            <div className="cs-banner cs-banner--muted">Your role can review payment follow-up work, but it cannot send reminders, reopen links, or draft outreach.</div>
          ) : null}

          {followUpState.kind === "loading" ? (
            <div className="cs-empty">Loading payment follow-up queue...</div>
          ) : followUpState.kind === "error" ? (
            <div className="cs-empty cs-empty--muted">{followUpState.message}</div>
          ) : followUpState.items.length === 0 ? (
            <div className="cs-empty cs-empty--muted">No deposit follow-up work is waiting right now.</div>
          ) : (
            <div className="cs-service-catalog-list">
              {followUpState.items.map((item) => (
                <article key={item.bookingDraft.id} className="cs-service-catalog-card">
                  <div className="cs-panel-title-row">
                    <div>
                      <p className="cs-eyebrow">Deposit follow-up</p>
                      <h5>{item.bookingDraft.customer?.name ?? item.bookingDraft.customer?.email ?? item.bookingDraft.service.name}</h5>
                    </div>
                    <span className={`cs-status-chip cs-status-chip--${getPaymentLinkTone(item)}`}>{getPaymentLinkLabel(item)}</span>
                  </div>
                  <p>
                    {item.bookingDraft.service.name} with {item.bookingDraft.provider.name} on {formatDateTime(item.bookingDraft.startsAt)}.
                  </p>
                  <dl className="cs-service-stats">
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
                  <div className="cs-catalog-location-list">
                    <span className="cs-status-chip cs-status-chip--planned">{item.bookingDraft.provider.name}</span>
                    <span className="cs-status-chip cs-status-chip--planned">{item.paymentStatus ?? "pending"}</span>
                  </div>
                  <div className="cs-action-row">
                    <button
                      type="button"
                      className="cs-btn cs-btn--primary cs-btn--sm"
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
                      className="cs-btn cs-btn--sm"
                      disabled={!canManagePayments || (actionState.kind === "submitting" && actionState.bookingDraftId === item.bookingDraft.id)}
                      onClick={() => {
                        void handleOpenCheckoutLink(item);
                      }}
                    >
                      {item.linkState === "open" ? "Open checkout link" : "Reopen checkout link"}
                    </button>
                    <button
                      type="button"
                      className="cs-btn cs-btn--sm"
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
                      className="cs-btn cs-btn--sm"
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
                      className="cs-btn cs-btn--sm"
                    >
                      Open booking review
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </article>

        <aside className="cs-panel-card">
          <p className="cs-eyebrow">Operator steps</p>
          <h4>Handle unpaid deposits</h4>
          <ul className="cs-check-list">
            <li>Review drafts that are still waiting on deposit payment.</li>
            <li>Send a real reminder email from the backend, or open, copy, and draft outreach with a current hosted checkout link when needed.</li>
            <li>Jump into the storefront booking review when the operator needs the exact public context.</li>
          </ul>
        </aside>
      </section>
    </div>
  );
}

type PaymentsTab = "transactions" | "sales" | "held" | "follow-up";

const PAYMENT_TABS: Array<[PaymentsTab, string]> = [
  ["transactions", "Transactions"],
  ["sales", "Sales"],
  ["held", "Money held"],
  ["follow-up", "Follow-up"],
];

export function PaymentsPage({
  definition,
  currentUser,
  api = platformApi,
  storefrontBaseUrl = defaultStorefrontBaseUrl,
}: PaymentsPageProps) {
  const [tab, setTab] = useState<PaymentsTab>("transactions");
  const canViewPayments = currentUser !== null && hasPermission(currentUser, "payments.view");
  const canManagePayments = currentUser !== null && hasPermission(currentUser, "payments.manage");
  const tenantSlug = currentUser?.tenantSlug ?? "";

  return (
    <main className="cs-page-stack">
      <header className="cs-pay-header">
        <p className="cs-eyebrow">{definition.eyebrow}</p>
        <h3>Payments</h3>
        <p>{definition.description}</p>
      </header>

      {!canViewPayments || !tenantSlug ? (
        <div className="cs-empty cs-empty--muted">
          {canViewPayments
            ? "Tenant session is missing tenant context."
            : "Your role can access the dashboard, but it cannot view payments."}
        </div>
      ) : (
        <>
          <div className="cs-pay-tabs" role="tablist" aria-label="Payments sections">
            {PAYMENT_TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`payments-tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`payments-panel-${key}`}
                className={tab === key ? "cs-pay-tab is-active" : "cs-pay-tab"}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`payments-panel-${tab}`} aria-labelledby={`payments-tab-${tab}`}>
            {tab === "transactions" ? <TransactionsTab api={api} tenantSlug={tenantSlug} canEmailReceipts={canManagePayments} /> : null}
            {tab === "sales" ? <SalesTab api={api} tenantSlug={tenantSlug} canEmailReceipts={canManagePayments} /> : null}
            {tab === "held" ? <MoneyHeldTab api={api} tenantSlug={tenantSlug} /> : null}
            {tab === "follow-up" ? (
              <div className="cs-page-stack">
                <MoneyOwedPanel api={api} tenantSlug={tenantSlug} />
                <DepositFollowUpPanel currentUser={currentUser} api={api} storefrontBaseUrl={storefrontBaseUrl} />
              </div>
            ) : null}
          </div>
        </>
      )}
    </main>
  );
}
