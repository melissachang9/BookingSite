import { useState } from "react";
import type {
  AuthenticatedUser,
  CustomerBookingAttempt,
  CustomerBookingAttemptListResponse,
  DismissBookingAttemptRequest,
  MarkBookingAttemptFollowedUpRequest,
} from "@booking/shared-types";

import { FollowUpPanel } from "./follow-up-panel";
import { MoneyHeldTab, type MoneyHeldTabApi } from "./payments-money-held-tab";
import { MoneyOwedPanel, type MoneyOwedApi } from "./payments-money-owed";
import { SalesTab, type SalesTabApi } from "./payments-sales-tab";
import { TransactionsTab, type TransactionsTabApi } from "./payments-transactions-tab";
import { platformApi } from "./platform-api";

export type PaymentsPageDefinition = {
  eyebrow: string;
  description: string;
  metric: string;
};

export type PaymentsPageApi = TransactionsTabApi & SalesTabApi & MoneyHeldTabApi & MoneyOwedApi & {
  listBookingAttempts: (
    tenantSlug: string,
    options?: { includeFollowedUp?: boolean },
  ) => Promise<CustomerBookingAttemptListResponse>;
  markBookingAttemptFollowedUp: (
    tenantSlug: string,
    bookingDraftId: string,
    body?: MarkBookingAttemptFollowedUpRequest,
  ) => Promise<CustomerBookingAttempt>;
  dismissBookingAttempt: (
    tenantSlug: string,
    bookingDraftId: string,
    body: DismissBookingAttemptRequest,
  ) => Promise<CustomerBookingAttempt>;
};

type PaymentsPageProps = {
  definition: PaymentsPageDefinition;
  currentUser: AuthenticatedUser | null;
  api?: PaymentsPageApi;
};

function hasPermission(user: AuthenticatedUser, key: string): boolean {
  return user.permissions.some((permission) => permission.key === key && permission.allowed);
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
                <FollowUpPanel currentUser={currentUser} api={api} tenantSlug={tenantSlug} />
              </div>
            ) : null}
          </div>
        </>
      )}
    </main>
  );
}
