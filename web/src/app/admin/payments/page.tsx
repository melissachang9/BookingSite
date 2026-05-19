import Link from "next/link";
import { canManageBookingCheckout } from "@/lib/admin/roles";
import { requireTenant } from "@/lib/admin/require-tenant";
import {
  getBookingBalanceFollowUpCents,
  readBookingCheckoutRecord,
} from "@/lib/payments/booking-checkout";
import type { StripeCheckoutSessionState } from "@/lib/payments/stripe-checkout-session";
import { loadStripeCheckoutSessionState } from "@/lib/payments/stripe-checkout-session-state";
import { BookingBalanceCheckoutButton } from "./start-balance-checkout-button";
import { AdminCheckoutButton } from "./start-checkout-button";

export const metadata = { title: "Payments — BookingSite" };

type CheckoutVisibilitySummary = {
  tipCents: number;
  walletAppliedCents: number;
  externalPaidCents: number | null;
};

function fmtMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

async function loadCheckoutStates(sessionIds: string[]) {
  if (sessionIds.length === 0) return new Map<string, StripeCheckoutSessionState>();

  const entries = await Promise.all(
    sessionIds.map(async (sessionId) => {
      const state = await loadStripeCheckoutSessionState(sessionId);

      return [
        sessionId,
        state ?? ({ status: null, url: null, expiresAt: null } satisfies StripeCheckoutSessionState),
      ] as const;
    })
  );

  return new Map(entries);
}

function getPendingPaymentLabel(opts: {
  checkoutStatus: StripeCheckoutSessionState["status"];
  expiresAt: string;
}) {
  if (opts.checkoutStatus === "complete") return "Payment submitted";
  if (opts.checkoutStatus === "expired") return "Payment link expired";
  if (new Date(opts.expiresAt) < new Date()) return "Payment link expired";
  if (opts.checkoutStatus === "open") return "Awaiting customer payment";
  return "Awaiting customer payment";
}

function getBalanceCheckoutLabel(status: StripeCheckoutSessionState["status"]) {
  if (status === "complete") return "Payment submitted";
  if (status === "expired") return "Hosted checkout expired";
  if (status === "open") return "Hosted checkout open";
  return "No hosted checkout yet";
}

function getBalanceCheckoutTone(status: StripeCheckoutSessionState["status"]) {
  if (status === "complete") {
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
  }
  if (status === "expired") {
    return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  }
  if (status === "open") {
    return "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  }
  return "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
}

function getPendingPaymentTone(label: string) {
  if (label === "Payment submitted") {
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
  }
  if (label === "Payment link expired") {
    return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  }
  return "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
}

function getCollectedPaymentLabel(booking: {
  refunded_amount_cents: number | null;
  deposit_cents: number;
  stripe_payment_intent_id: string | null;
}) {
  if (booking.refunded_amount_cents && booking.refunded_amount_cents > 0) {
    return `Refunded ${fmtMoney(booking.refunded_amount_cents)}`;
  }
  if (!booking.stripe_payment_intent_id) return "Payment not captured";
  return booking.deposit_cents > 0 ? "Deposit paid" : "Paid in full";
}

function getCollectedPaymentTone(label: string) {
  if (label.startsWith("Refunded")) {
    return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  }
  if (label === "Payment not captured") {
    return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
  }
  return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";
}

function getRecentPaymentActivitySummary(booking: {
  starts_at: string;
  price_cents: number;
  deposit_cents: number;
  deposit_status: string | null;
  refunded_amount_cents: number | null;
  stripe_payment_intent_id: string | null;
  checkout_record_json: unknown;
}) {
  const latestCheckoutEvent = readBookingCheckoutRecord(booking.checkout_record_json).latest_event;

  if (latestCheckoutEvent) {
    const label =
      latestCheckoutEvent.kind === "stripe_balance_checkout"
        ? "Stripe balance paid"
        : latestCheckoutEvent.payment_resolution === "collected_external"
          ? "External POS collected"
          : latestCheckoutEvent.payment_resolution === "collected_cash"
            ? "Cash collected"
            : latestCheckoutEvent.payment_resolution === "already_paid"
              ? "Already paid"
              : latestCheckoutEvent.payment_resolution === "none_due"
                ? "No balance due"
                : latestCheckoutEvent.payment_resolution === "follow_up"
                  ? "Follow-up required"
                  : latestCheckoutEvent.payment_outcome_label;

    const tone =
      latestCheckoutEvent.payment_resolution === "follow_up"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
        : latestCheckoutEvent.payment_resolution === "none_due"
          ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
          : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";

    const amountCents =
      latestCheckoutEvent.payment_resolution === "follow_up"
        ? latestCheckoutEvent.amount_owing_at_checkout_cents
        : latestCheckoutEvent.amount_recorded_cents;

    return {
      label,
      tone,
      detail: latestCheckoutEvent.payment_outcome_label,
      amountCents,
      recordedAt: latestCheckoutEvent.at,
      note: latestCheckoutEvent.note ?? null,
      checkoutSummary: {
        tipCents: latestCheckoutEvent.tip_cents ?? 0,
        walletAppliedCents: latestCheckoutEvent.wallet_applied_cents ?? 0,
        externalPaidCents: latestCheckoutEvent.external_paid_cents ?? null,
      } satisfies CheckoutVisibilitySummary,
    };
  }

  const fallbackLabel = getCollectedPaymentLabel(booking);

  return {
    label: fallbackLabel,
    tone: getCollectedPaymentTone(fallbackLabel),
    detail:
      booking.deposit_status === "paid_in_full"
        ? "Stripe payment captured in full"
        : booking.deposit_cents > 0
          ? "Initial deposit captured with Stripe"
          : "Payment captured with Stripe",
    amountCents: booking.deposit_cents > 0 ? booking.deposit_cents : booking.price_cents,
    recordedAt: booking.starts_at,
    note: null,
    checkoutSummary: {
      tipCents: 0,
      walletAppliedCents: 0,
      externalPaidCents: null,
    } satisfies CheckoutVisibilitySummary,
  };
}

function formatCheckoutVisibilityLine(summary: CheckoutVisibilitySummary) {
  const parts: string[] = [];

  if (summary.tipCents > 0) {
    parts.push(`Tip ${fmtMoney(summary.tipCents)}`);
  }

  if (summary.walletAppliedCents > 0) {
    parts.push(`Wallet ${fmtMoney(summary.walletAppliedCents)}`);
  }

  if (summary.externalPaidCents && summary.externalPaidCents > 0) {
    parts.push(`External POS ${fmtMoney(summary.externalPaidCents)}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function hasPaymentActivity(booking: {
  deposit_status: string | null;
  refunded_amount_cents: number | null;
  stripe_payment_intent_id: string | null;
  checkout_record_json: unknown;
}) {
  const latestCheckoutEvent = readBookingCheckoutRecord(booking.checkout_record_json).latest_event;

  if (latestCheckoutEvent?.payment_resolution === "follow_up") {
    return false;
  }

  return Boolean(
    latestCheckoutEvent ||
      booking.stripe_payment_intent_id ||
      (booking.refunded_amount_cents ?? 0) > 0 ||
      booking.deposit_status === "deposit_paid" ||
      booking.deposit_status === "paid_in_full" ||
      booking.deposit_status === "refunded"
  );
}

function isBalanceFollowUpBooking(booking: {
  checkout_record_json: unknown;
  deposit_status: string | null;
}) {
  return (
    getBookingBalanceFollowUpCents({
      checkoutRecord: booking.checkout_record_json,
      depositStatus: booking.deposit_status,
    }) > 0
  );
}

export default async function PaymentsPage() {
  const { supabase, tenantId, role } = await requireTenant();

  if (!canManageBookingCheckout(role)) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Payment actions are limited to owners, managers, and staff.
          </p>
        </div>
        <p className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
          Your current role can review bookings elsewhere in admin, but it cannot open checkout, collect balances, or manage payment follow-up from this screen.
        </p>
      </div>
    );
  }

  const [tenantRes, pendingRes, followUpRes, recentRes] = await Promise.all([
    supabase.from("tenants").select("slug").eq("id", tenantId).maybeSingle(),
    supabase
      .from("booking_drafts")
      .select(
        "id, starts_at, expires_at, customer_name, customer_email, status, stripe_session_id, price_cents, deposit_cents, services(name), providers(name), locations(name)"
      )
      .eq("tenant_id", tenantId)
      .eq("status", "awaiting_payment")
      .order("starts_at", { ascending: true })
      .limit(50),
    supabase
      .from("bookings")
      .select(
        "id, starts_at, completed_at, status, price_cents, deposit_cents, deposit_status, refunded_amount_cents, stripe_payment_intent_id, balance_checkout_stripe_session_id, balance_checkout_session_expires_at, checkout_record_json, customers(name, email), services(name), providers(name)"
      )
      .eq("tenant_id", tenantId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(50),
    supabase
      .from("bookings")
      .select(
        "id, starts_at, status, price_cents, deposit_cents, deposit_status, refunded_amount_cents, stripe_payment_intent_id, checkout_record_json, customers(name, email), services(name), providers(name)"
      )
      .eq("tenant_id", tenantId)
      .order("starts_at", { ascending: false })
      .limit(50),
  ]);

  const tenantSlug = tenantRes.data?.slug ?? null;
  const pendingDrafts = pendingRes.data ?? [];
  const followUpBookings = (followUpRes.data ?? []).filter(isBalanceFollowUpBooking).slice(0, 25);
  const recentBookings = (recentRes.data ?? []).filter(hasPaymentActivity).slice(0, 25);
  const checkoutStates = await loadCheckoutStates(
    [
      ...pendingDrafts
        .map((draft) => draft.stripe_session_id)
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
      ...followUpBookings
        .map((booking) => booking.balance_checkout_stripe_session_id)
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    ]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Follow up on unpaid appointments and monitor recent collected payments.
        </p>
      </div>

      {pendingRes.error ? (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {pendingRes.error.message}
        </p>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Awaiting payment</h2>
            <p className="text-sm text-neutral-500">Drafts that still need customer payment or payment confirmation.</p>
          </div>
          <div className="text-sm text-neutral-500">{pendingDrafts.length} open draft{pendingDrafts.length === 1 ? "" : "s"}</div>
        </div>

        <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">Appointment</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Due now</th>
                <th className="px-3 py-2">Payment status</th>
                <th className="px-3 py-2">Checkout window</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingDrafts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                    No drafts are currently awaiting payment.
                  </td>
                </tr>
              ) : (
                pendingDrafts.map((draft) => {
                  const service = normalizeRelation(draft.services as { name: string } | null);
                  const provider = normalizeRelation(draft.providers as { name: string } | null);
                  const location = normalizeRelation(draft.locations as { name: string } | null);
                  const checkoutState = draft.stripe_session_id
                    ? checkoutStates.get(draft.stripe_session_id) ?? { status: null, url: null }
                    : { status: null, url: null };
                  const paymentLabel = getPendingPaymentLabel({
                    checkoutStatus: checkoutState.status,
                    expiresAt: draft.expires_at,
                  });
                  const customerBookingPath = tenantSlug
                    ? `/${tenantSlug}/book/${draft.id}`
                    : null;
                  const successPath = tenantSlug
                    ? `/${tenantSlug}/book/${draft.id}/success`
                    : null;

                  return (
                    <tr
                      key={draft.id}
                      className="border-t border-neutral-200 align-top hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                    >
                      <td className="px-3 py-3">
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">
                          {fmtDateTime(draft.starts_at)}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {service?.name ?? "Service"}
                          {provider?.name ? ` · ${provider.name}` : ""}
                          {location?.name ? ` · ${location.name}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">
                          {draft.customer_name || "Pending contact details"}
                        </div>
                        <div className="text-xs text-neutral-500">{draft.customer_email || "No email captured yet"}</div>
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        {fmtMoney(draft.deposit_cents > 0 ? draft.deposit_cents : draft.price_cents)}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${getPendingPaymentTone(paymentLabel)}`}>
                          {paymentLabel}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div>{fmtDateTime(draft.expires_at)}</div>
                        <div className="text-xs text-neutral-500">
                          {checkoutState.status === "complete"
                            ? "Waiting for booking confirmation"
                            : checkoutState.status === "open"
                              ? "Customer can still resume checkout"
                              : "A new checkout session will be needed"}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          {checkoutState.status === "complete" ? null : (
                            <AdminCheckoutButton draftId={draft.id} hasOpenCheckout={checkoutState.status === "open"} />
                          )}
                          {customerBookingPath ? (
                            <a
                              href={customerBookingPath}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                            >
                              Open payment page
                            </a>
                          ) : null}
                          {successPath && checkoutState.status === "complete" ? (
                            <a
                              href={successPath}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                            >
                              Open confirmation
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {followUpRes.error ? (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {followUpRes.error.message}
        </p>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Balance follow-up</h2>
            <p className="text-sm text-neutral-500">
              Completed appointments that still have an outstanding balance and need payment follow-up.
            </p>
          </div>
          <div className="text-sm text-neutral-500">
            {followUpBookings.length} booking{followUpBookings.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">Appointment</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Service</th>
                <th className="px-3 py-2">Checkout detail</th>
                <th className="px-3 py-2">Outstanding</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {followUpBookings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                    No completed bookings currently need balance follow-up.
                  </td>
                </tr>
              ) : (
                followUpBookings.map((booking) => {
                  const customer = normalizeRelation(booking.customers as { name: string; email: string } | null);
                  const service = normalizeRelation(booking.services as { name: string } | null);
                  const provider = normalizeRelation(booking.providers as { name: string } | null);
                  const latestCheckoutEvent = readBookingCheckoutRecord(booking.checkout_record_json).latest_event;
                  const outstandingCents = getBookingBalanceFollowUpCents({
                    checkoutRecord: booking.checkout_record_json,
                    depositStatus: booking.deposit_status,
                  });
                  const balanceCheckoutState = booking.balance_checkout_stripe_session_id
                    ? checkoutStates.get(booking.balance_checkout_stripe_session_id) ?? {
                        status: null,
                        url: null,
                        expiresAt: null,
                      }
                    : { status: null, url: null, expiresAt: null };
                  const balanceCheckoutLabel = getBalanceCheckoutLabel(balanceCheckoutState.status);

                  return (
                    <tr
                      key={booking.id}
                      className="border-t border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                    >
                      <td className="px-3 py-3">
                        <div className="font-medium">
                          <Link href={`/admin/bookings/${booking.id}`} className="hover:underline">
                            {fmtDateTime(booking.starts_at)}
                          </Link>
                        </div>
                        <div className="text-xs text-neutral-500">
                          {provider?.name ?? "Unassigned provider"}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">
                          {customer?.name ?? "—"}
                        </div>
                        <div className="text-xs text-neutral-500">{customer?.email ?? "—"}</div>
                      </td>
                      <td className="px-3 py-3">{service?.name ?? "—"}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">
                          {latestCheckoutEvent?.payment_outcome_label ?? "Follow-up required"}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {booking.completed_at ? fmtDateTime(booking.completed_at) : fmtDateTime(booking.starts_at)}
                          {latestCheckoutEvent?.note ? ` · ${latestCheckoutEvent.note}` : ""}
                        </div>
                        {latestCheckoutEvent &&
                        formatCheckoutVisibilityLine({
                          tipCents: latestCheckoutEvent.tip_cents ?? 0,
                          walletAppliedCents: latestCheckoutEvent.wallet_applied_cents ?? 0,
                          externalPaidCents: latestCheckoutEvent.external_paid_cents ?? null,
                        }) ? (
                          <div className="text-xs text-neutral-500">
                            {formatCheckoutVisibilityLine({
                              tipCents: latestCheckoutEvent.tip_cents ?? 0,
                              walletAppliedCents: latestCheckoutEvent.wallet_applied_cents ?? 0,
                              externalPaidCents: latestCheckoutEvent.external_paid_cents ?? null,
                            })}
                          </div>
                        ) : null}
                        <div className="mt-1 text-xs text-neutral-500">
                          <span className={`rounded-full px-2 py-0.5 ${getBalanceCheckoutTone(balanceCheckoutState.status)}`}>
                            {balanceCheckoutLabel}
                          </span>
                          {balanceCheckoutState.status === "open" && balanceCheckoutState.expiresAt
                            ? ` · Resume before ${fmtDateTime(balanceCheckoutState.expiresAt)}`
                            : balanceCheckoutState.status === "expired"
                              ? " · Start a fresh checkout session"
                              : balanceCheckoutState.status === "complete"
                                ? " · Open checkout again to refresh booking status if needed"
                                : ""}
                        </div>
                      </td>
                      <td className="px-3 py-3 tabular-nums">
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          {fmtMoney(outstandingCents)} due
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <BookingBalanceCheckoutButton
                            bookingId={booking.id}
                            checkoutSessionStatus={balanceCheckoutState.status}
                          />
                          <Link
                            href={`/admin/bookings/${booking.id}`}
                            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                          >
                            Open booking
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {recentRes.error ? (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {recentRes.error.message}
        </p>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Recent payment activity</h2>
          <p className="text-sm text-neutral-500">Recent Stripe captures and structured checkout closeouts, including external POS, cash, wallet application, tip capture, and follow-up outcomes.</p>
        </div>

        <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">Appointment</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Service</th>
                <th className="px-3 py-2">Checkout detail</th>
                <th className="px-3 py-2">Payment status</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {recentBookings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                    No recent payment activity yet.
                  </td>
                </tr>
              ) : (
                recentBookings.map((booking) => {
                  const customer = normalizeRelation(booking.customers as { name: string; email: string } | null);
                  const service = normalizeRelation(booking.services as { name: string } | null);
                  const provider = normalizeRelation(booking.providers as { name: string } | null);
                  const paymentSummary = getRecentPaymentActivitySummary(booking);

                  return (
                    <tr
                      key={booking.id}
                      className="border-t border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                    >
                      <td className="px-3 py-3">
                        <div className="font-medium">
                          <Link href={`/admin/bookings/${booking.id}`} className="hover:underline">
                            {fmtDateTime(booking.starts_at)}
                          </Link>
                        </div>
                        <div className="text-xs text-neutral-500">{provider?.name ?? "Unassigned provider"}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">{customer?.name ?? "—"}</div>
                        <div className="text-xs text-neutral-500">{customer?.email ?? "—"}</div>
                      </td>
                      <td className="px-3 py-3">{service?.name ?? "—"}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">
                          {paymentSummary.detail}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {fmtDateTime(paymentSummary.recordedAt)}
                          {paymentSummary.note ? ` · ${paymentSummary.note}` : ""}
                        </div>
                        {formatCheckoutVisibilityLine(paymentSummary.checkoutSummary) ? (
                          <div className="text-xs text-neutral-500">
                            {formatCheckoutVisibilityLine(paymentSummary.checkoutSummary)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${paymentSummary.tone}`}>
                          {paymentSummary.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {fmtMoney(paymentSummary.amountCents)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}