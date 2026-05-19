import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/admin/require-tenant";
import { canManageBookingCheckout } from "@/lib/admin/roles";
import {
  calculateBookingPaymentBreakdown,
  readBookingCheckoutRecord,
  type BookingCheckoutRecord,
} from "@/lib/payments/booking-checkout";
import { getCustomerWalletBalanceCents } from "@/lib/payments/customer-wallet";
import {
  reconcileBookingBalanceCheckoutSession,
  type BookingBalanceCheckoutReconcileResult,
} from "@/lib/payments/stripe-balance-checkout";
import { loadStripeCheckoutSessionState } from "@/lib/payments/stripe-checkout-session-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeTenantSettings } from "@/lib/tenants/settings";
import { CancelButton } from "./cancel-button";
import { BookingBalanceCheckoutButton } from "./balance-checkout-button";
import { CustomerManageTools } from "./customer-manage-tools";
import { ReopenCheckoutButton } from "./reopen-checkout-button";
import { RescheduleForm } from "./reschedule-form";
import { StatusButtons } from "./status-buttons";
import {
  DISPLAY_ONLY_TYPES,
  formatAnswer,
  normalizeAttachmentAnswers,
  type FormSchema,
} from "@/lib/forms/schema";

export const metadata = { title: "Booking — BookingSite" };

type CheckoutReturnNotice = {
  tone: "success" | "warning" | "error";
  title: string;
  body: string;
};

function fmtMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtShortDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getCheckoutReturnNotice(input: {
  payment?: string;
  sessionId?: string;
  result: BookingBalanceCheckoutReconcileResult | null;
}): CheckoutReturnNotice | null {
  if (input.payment === "cancel") {
    return {
      tone: "warning",
      title: "Card checkout canceled",
      body: "No payment was collected. You can reopen hosted checkout from the completion card when you're ready.",
    };
  }

  if (input.payment !== "success") {
    return null;
  }

  if (!input.sessionId) {
    return {
      tone: "error",
      title: "Missing Stripe return details",
      body: "Stripe returned without a checkout session id, so the booking could not be updated automatically.",
    };
  }

  if (!input.result) {
    return {
      tone: "error",
      title: "Stripe payment could not be verified",
      body: "The booking did not receive a payment update from Stripe. Try reloading this page or check webhook delivery.",
    };
  }

  switch (input.result.status) {
    case "applied":
      return {
        tone: "success",
        title: "Stripe payment recorded",
        body: "The hosted balance checkout completed and this booking was updated from the Stripe return path.",
      };
    case "already_applied":
      return {
        tone: "success",
        title: "Stripe payment already recorded",
        body: "This hosted checkout was already applied, so the booking is up to date.",
      };
    case "session_not_complete":
      return {
        tone: "warning",
        title:
          input.result.sessionStatus === "expired"
            ? "Card checkout expired"
            : "Waiting for Stripe confirmation",
        body:
          input.result.error ??
          "Stripe has not marked this checkout session complete yet, so the booking is still awaiting payment.",
      };
    case "session_not_found":
    case "not_balance_checkout":
    case "booking_not_found":
    case "tenant_mismatch":
    case "update_failed":
      return {
        tone: "error",
        title: "Stripe payment could not be applied",
        body:
          input.result.error ??
          "Stripe reported a checkout return, but the booking could not be synchronized automatically.",
      };
    default:
      return null;
  }
}

function getCheckoutReturnToneClasses(tone: CheckoutReturnNotice["tone"]) {
  if (tone === "success") {
    return "border-green-200 bg-green-50 text-green-800 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-300";
  }
  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";
  }
  return "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300";
}

function buildRebookUrl(input: { customerId: string | null; providerId: string | null }) {
  if (!input.customerId) return null;

  const params = new URLSearchParams({
    view: "week",
    drawer: "new-booking",
    rebookCustomerId: input.customerId,
  });

  if (input.providerId) {
    params.set("provider", input.providerId);
  }

  return `/admin/calendar?${params.toString()}`;
}

export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ flow?: string; payment?: string; session_id?: string }>;
}) {
  const { bookingId } = await params;
  const { flow, payment, session_id: sessionId } = await searchParams;
  const openCheckoutFlow = flow === "checkout";
  const { supabase, tenantId, role } = await requireTenant();
  const canManageCheckout = canManageBookingCheckout(role);

  const checkoutReturnResult =
    payment === "success" && sessionId && canManageCheckout
      ? await reconcileBookingBalanceCheckoutSession({ sessionId, tenantId })
      : null;
  const checkoutReturnNotice = getCheckoutReturnNotice({
    payment,
    sessionId,
    result: checkoutReturnResult,
  });

  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      `id, starts_at, ends_at, status, cancel_token, price_cents, deposit_cents, deposit_status, booking_method, source_channel,
        tip_cents, wallet_applied_cents,
       confirmation_requested, confirmation_delivery_status, confirmation_sent_at, confirmation_send_count, confirmation_last_error,
       assessed_no_show_fee_cents, notes, checkout_record_json,
       balance_checkout_stripe_session_id, balance_checkout_session_expires_at,
       no_show_fee_payment_intent_id, no_show_fee_charged_at, no_show_fee_charge_error,
       stripe_session_id, stripe_payment_intent_id, stripe_refund_id, refunded_at, refunded_amount_cents,
        canceled_at, cancel_reason, completed_at,
       provider_id, customer_id, service_id,
       providers(name),
       services(name, duration_minutes),
       customers(id, name, email, phone)`
    )
    .eq("id", bookingId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !booking) notFound();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("settings_json")
    .eq("id", tenantId)
    .maybeSingle();
  const tenantSettings = normalizeTenantSettings(
    (tenant?.settings_json ?? null) as Partial<Record<string, unknown>> | null
  );
  const taxRatePercent = tenantSettings.tax_rate_percent ?? 0;
  const paymentBreakdown = calculateBookingPaymentBreakdown({
    priceCents: booking.price_cents,
    depositCents: booking.deposit_cents,
    depositStatus: booking.deposit_status,
    refundedAmountCents: booking.refunded_amount_cents,
    taxRatePercent,
    tipCents: booking.tip_cents,
    walletAppliedCents: booking.wallet_applied_cents,
  });
  const checkoutRecord = readBookingCheckoutRecord(booking.checkout_record_json);
  const latestCheckoutEvent = checkoutRecord.latest_event;
  const walletBalanceCents = booking.customer_id
    ? await getCustomerWalletBalanceCents({
        tenantId,
        customerId: booking.customer_id,
      })
    : 0;
  const balanceCheckoutSessionState =
    canManageCheckout && booking.balance_checkout_stripe_session_id
      ? await loadStripeCheckoutSessionState(booking.balance_checkout_stripe_session_id)
      : null;

  const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
  const service = Array.isArray(booking.services) ? booking.services[0] : booking.services;
  const provider = Array.isArray(booking.providers) ? booking.providers[0] : booking.providers;
  const manageUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/cancel/${booking.cancel_token}`;
  const canReopenCheckoutForCorrection =
    canManageCheckout &&
    booking.status === "completed" &&
    Boolean(latestCheckoutEvent) &&
    (latestCheckoutEvent.kind === "stripe_balance_checkout" ||
      latestCheckoutEvent.kind === "admin_completion" ||
      booking.tip_cents > 0 ||
      booking.wallet_applied_cents > 0);
  const correctionNeedsManualReconciliation =
    latestCheckoutEvent?.kind !== "stripe_balance_checkout" &&
    (latestCheckoutEvent?.payment_resolution === "collected_cash" ||
      latestCheckoutEvent?.payment_resolution === "collected_external" ||
      latestCheckoutEvent?.payment_resolution === "already_paid");
  const rebookUrl = buildRebookUrl({
    customerId: booking.customer_id,
    providerId: booking.provider_id,
  });

  // Form responses linked to this booking.
  const { data: requirements } = await supabase
    .from("booking_form_requirements")
    .select(
      `id, form_id, form_version_id, satisfied_by_response_id,
       forms(name),
       form_versions(schema_json)`
    )
    .eq("booking_id", booking.id);

  const responseIds = (requirements ?? [])
    .map((r) => r.satisfied_by_response_id)
    .filter((v): v is string => !!v);

  const { data: responses } = responseIds.length
    ? await supabase
        .from("form_responses")
        .select("id, form_version_id, answers_json, submitted_at")
        .in("id", responseIds)
    : { data: [] as Array<{ id: string; form_version_id: string; answers_json: Record<string, unknown>; submitted_at: string }> };

  const responsesByReqId = new Map<string, { answers_json: Record<string, unknown>; submitted_at: string }>();
  for (const req of requirements ?? []) {
    if (!req.satisfied_by_response_id) continue;
    const r = (responses ?? []).find((x) => x.id === req.satisfied_by_response_id);
    if (r) responsesByReqId.set(req.id, { answers_json: r.answers_json, submitted_at: r.submitted_at });
  }

  // Fetch attachments + signed URLs (1h) keyed by attachment id.
  const { data: attachments } = await supabase
    .from("form_response_attachments")
    .select("id, kind, mime_type, original_filename, storage_path")
    .eq("booking_id", booking.id);
  const attachmentById = new Map<
    string,
    { kind: string; mime_type: string | null; filename: string | null; url: string | null }
  >();
  if (attachments && attachments.length > 0) {
    const admin = createAdminClient();
    for (const a of attachments) {
      const { data: signed } = await admin.storage
        .from("form-uploads")
        .createSignedUrl(a.storage_path, 60 * 60);
      attachmentById.set(a.id, {
        kind: a.kind,
        mime_type: a.mime_type,
        filename: a.original_filename,
        url: signed?.signedUrl ?? null,
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/bookings"
            className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            ← Bookings
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {service?.name ?? "Booking"}
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {new Date(booking.starts_at).toLocaleString()} →{" "}
            {new Date(booking.ends_at).toLocaleString()}
          </p>
          <p className="text-sm">
            <span
              className={
                "rounded-full px-2 py-0.5 text-xs " +
                (booking.status === "confirmed"
                  ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                  : booking.status === "canceled"
                    ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                    : booking.status === "completed"
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                      : booking.status === "no_show"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300")
              }
            >
              {booking.status}
            </span>
          </p>
        </div>
        {booking.status === "confirmed" && (
          <div className="flex flex-col gap-2">
            <StatusButtons
              bookingId={booking.id}
              priceCents={booking.price_cents}
              depositCents={booking.deposit_cents}
              depositStatus={booking.deposit_status}
              refundedAmountCents={booking.refunded_amount_cents}
              taxRatePercent={taxRatePercent}
              walletBalanceCents={walletBalanceCents}
              autoOpenCompletionDrawer={openCheckoutFlow}
              rebookUrl={rebookUrl}
              canManageCheckout={canManageCheckout}
            />
            <RescheduleForm
              bookingId={booking.id}
              currentStart={booking.starts_at}
              currentEnd={booking.ends_at}
              durationMinutes={service?.duration_minutes ?? 60}
            />
            <CancelButton bookingId={booking.id} />
          </div>
        )}
      </div>

      {checkoutReturnNotice ? (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${getCheckoutReturnToneClasses(checkoutReturnNotice.tone)}`}
        >
          <p className="font-medium">{checkoutReturnNotice.title}</p>
          <p className="mt-1">{checkoutReturnNotice.body}</p>
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2">
        <Card title="Customer">
          <Row
            label="Name"
            value={
              customer?.id ? (
                <Link href={`/admin/customers/${customer.id}`} className="text-blue-600 hover:underline">
                  {customer.name}
                </Link>
              ) : (
                customer?.name ?? "—"
              )
            }
          />
          <Row label="Email" value={customer?.email ?? "—"} />
          <Row label="Phone" value={customer?.phone ?? "—"} />
          <Row label="Wallet balance" value={fmtMoney(walletBalanceCents)} />
        </Card>
        <Card title="Service & provider">
          <Row label="Service" value={service?.name ?? "—"} />
          <Row label="Duration" value={`${service?.duration_minutes ?? 0} min`} />
          <Row label="Provider" value={provider?.name ?? "—"} />
        </Card>
        <Card title="Payment">
          <Row label="Price" value={fmtMoney(booking.price_cents)} />
          <Row label={`Tax (${taxRatePercent.toFixed(2)}%)`} value={fmtMoney(paymentBreakdown.taxCents)} />
          <Row label="Total with tax" value={fmtMoney(paymentBreakdown.totalWithTaxCents)} />
          <Row label="Tip" value={paymentBreakdown.tipCents > 0 ? fmtMoney(paymentBreakdown.tipCents) : "—"} />
          <Row
            label="Deposit"
            value={booking.deposit_cents > 0 ? fmtMoney(booking.deposit_cents) : "—"}
          />
          <Row
            label="Wallet applied"
            value={paymentBreakdown.walletAppliedCents > 0 ? fmtMoney(paymentBreakdown.walletAppliedCents) : "—"}
          />
          <Row label="Amount owing" value={fmtMoney(paymentBreakdown.balanceDueCents)} />
          <Row label="Payment status" value={booking.deposit_status ?? "—"} />
          <Row label="Stripe session" value={booking.stripe_session_id ?? "—"} mono />
          <Row label="Payment intent" value={booking.stripe_payment_intent_id ?? "—"} mono />
          <Row
            label="Refund amount"
            value={
              booking.refunded_amount_cents && booking.refunded_amount_cents > 0
                ? fmtMoney(booking.refunded_amount_cents)
                : "—"
            }
          />
          <Row
            label="Refunded at"
            value={booking.refunded_at ? new Date(booking.refunded_at).toLocaleString() : "—"}
          />
          <Row label="Refund id" value={booking.stripe_refund_id ?? "—"} mono />
        </Card>
        <Card title="Customer manage link">
          <Row
            label="Link status"
            value={booking.status === "confirmed" ? "Active" : "Still viewable"}
          />
          <CustomerManageTools bookingId={booking.id} manageUrl={manageUrl} />
        </Card>
        <Card title="Operations">
          <Row label="Booking method" value={booking.booking_method ?? "—"} />
          <Row label="Source" value={booking.source_channel ?? "—"} />
          <Row
            label="Confirmation requested"
            value={booking.confirmation_requested ? "Yes" : "No"}
          />
          <Row
            label="Confirmation status"
            value={booking.confirmation_delivery_status ?? "unknown"}
          />
          <Row
            label="Confirmation sent"
            value={
              booking.confirmation_sent_at
                ? new Date(booking.confirmation_sent_at).toLocaleString()
                : "—"
            }
          />
          <Row
            label="Confirmation attempts"
            value={String(booking.confirmation_send_count ?? 0)}
          />
          {booking.confirmation_last_error ? (
            <Row label="Confirmation error" value={booking.confirmation_last_error} />
          ) : null}
        </Card>
        {checkoutRecord.events.length > 0 ? (
          <CheckoutAuditCard checkoutRecord={checkoutRecord} />
        ) : null}
        {booking.status === "canceled" && (
          <Card title="Cancellation">
            <Row
              label="Canceled at"
              value={booking.canceled_at ? new Date(booking.canceled_at).toLocaleString() : "—"}
            />
            <Row label="Reason" value={booking.cancel_reason ?? "—"} />
          </Card>
        )}
        {booking.status === "completed" && (
          <Card title="Completion">
            <Row
              label="Completed at"
              value={booking.completed_at ? new Date(booking.completed_at).toLocaleString() : "—"}
            />
            {canManageCheckout && paymentBreakdown.balanceDueCents > 0 ? (
              <div className="mt-4 space-y-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                <Row label="Outstanding balance" value={fmtMoney(paymentBreakdown.balanceDueCents)} />
                {balanceCheckoutSessionState?.status === "open" ? (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    A hosted checkout is already open for this balance. Resume the same Stripe session
                    {balanceCheckoutSessionState.expiresAt
                      ? ` before ${fmtShortDateTime(balanceCheckoutSessionState.expiresAt)}.`
                      : "."}
                  </p>
                ) : balanceCheckoutSessionState?.status === "expired" ? (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    The previous hosted checkout expired before payment completed. Start a fresh secure checkout below.
                  </p>
                ) : balanceCheckoutSessionState?.status === "complete" ? (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    Stripe has a submitted payment for this balance. Refresh payment status to synchronize the booking if the webhook is delayed.
                  </p>
                ) : (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    Use hosted checkout to collect the remaining balance after the appointment is complete.
                  </p>
                )}
                <BookingBalanceCheckoutButton
                  bookingId={booking.id}
                  checkoutSessionStatus={balanceCheckoutSessionState?.status ?? null}
                />
              </div>
            ) : null}
            {canReopenCheckoutForCorrection ? (
              <div className="mt-4 space-y-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Reopen checkout to correct the closeout, return any applied guest wallet credit, and redo payment from the completion drawer.
                </p>
                {latestCheckoutEvent?.kind === "stripe_balance_checkout" ? (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    The latest Stripe balance checkout will be refunded before the booking returns to confirmed status.
                  </p>
                ) : null}
                {correctionNeedsManualReconciliation ? (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    Cash, external POS, or outside payment already taken must still be reconciled outside the app.
                  </p>
                ) : null}
                <ReopenCheckoutButton bookingId={booking.id} />
              </div>
            ) : null}
            {rebookUrl ? (
              <div className="mt-4 space-y-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Start the next appointment with this customer from the calendar drawer.
                </p>
                <Link href={rebookUrl} className="inline-flex text-sm font-medium text-blue-600 hover:underline">
                  Book next appointment
                </Link>
              </div>
            ) : null}
          </Card>
        )}
        {booking.status === "no_show" && (
          <Card title="No-show">
            <Row
              label="Recorded fee"
              value={
                booking.assessed_no_show_fee_cents && booking.assessed_no_show_fee_cents > 0
                  ? fmtMoney(booking.assessed_no_show_fee_cents)
                  : "—"
              }
            />
            <Row
              label="Collection"
              value={
                booking.no_show_fee_payment_intent_id
                  ? "Charged saved card"
                  : booking.no_show_fee_charge_error
                    ? "Auto-charge failed"
                    : booking.assessed_no_show_fee_cents && booking.assessed_no_show_fee_cents > 0
                      ? "Manual follow-up"
                      : "No fee recorded"
              }
            />
            <Row
              label="Charged at"
              value={
                booking.no_show_fee_charged_at
                  ? new Date(booking.no_show_fee_charged_at).toLocaleString()
                  : "No fee recorded"
              }
            />
            <Row
              label="Charge intent"
              value={booking.no_show_fee_payment_intent_id ?? "—"}
              mono
            />
            <Row
              label="Charge error"
              value={booking.no_show_fee_charge_error ?? "—"}
            />
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Customer forms</h2>
        {(requirements ?? []).length === 0 ? (
          <p className="text-sm text-neutral-500">No forms required for this booking.</p>
        ) : (
          <div className="space-y-4">
            {(requirements ?? []).map((req) => {
              const formName = (req.forms as unknown as { name: string } | null)?.name ?? "Form";
              const schema = (req.form_versions as unknown as { schema_json: FormSchema } | null)
                ?.schema_json ?? { fields: [] };
              const resp = responsesByReqId.get(req.id);
              return (
                <div
                  key={req.id}
                  className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-medium">{formName}</h3>
                    {resp ? (
                      <span className="text-xs text-neutral-500">
                        Submitted {new Date(resp.submitted_at).toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-700 dark:text-amber-400">
                        Not submitted
                      </span>
                    )}
                  </div>
                  {resp ? (
                    <dl className="space-y-2 text-sm">
                      {schema.fields.map((f) => {
                        if (DISPLAY_ONLY_TYPES.has(f.type)) {
                          if (f.type === "section") {
                            return (
                              <div key={f.id} className="pt-2 text-xs font-semibold uppercase text-neutral-500">
                                {f.label}
                              </div>
                            );
                          }
                          return null;
                        }
                        return (
                          <div key={f.id}>
                            <dt className="text-xs text-neutral-500">{f.label}</dt>
                            <dd className="whitespace-pre-wrap">
                              {f.type === "file_upload" || f.type === "signature" ? (
                                <AttachmentLink
                                  answer={resp.answers_json[f.id]}
                                  attachmentById={attachmentById}
                                  kind={f.type}
                                />
                              ) : (
                                formatAnswer(f, resp.answers_json[f.id])
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="mb-2 text-sm font-medium">{title}</div>
      <dl className="space-y-1 text-sm">{children}</dl>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className={"text-right " + (mono ? "font-mono text-xs break-all" : "")}>{value}</dd>
    </div>
  );
}

function CheckoutAuditCard({ checkoutRecord }: { checkoutRecord: BookingCheckoutRecord }) {
  const events = [...checkoutRecord.events].reverse();

  return (
    <div className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800 sm:col-span-2">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Checkout audit</div>
          <p className="text-xs text-neutral-500">
            Structured record of how checkout was closed out.
          </p>
        </div>
        <div className="text-xs text-neutral-500">
          {checkoutRecord.events.length} event{checkoutRecord.events.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="space-y-3">
        {events.map((event, index) => (
          <div
            key={`${event.kind}-${event.at}-${index}`}
            className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-neutral-900 dark:text-neutral-100">
                  {formatCheckoutEventSource(event.kind)}
                </p>
                <p className="text-xs text-neutral-500">{new Date(event.at).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p>{event.payment_outcome_label}</p>
                <p className="text-xs text-neutral-500">Recorded {fmtMoney(event.amount_recorded_cents)}</p>
              </div>
            </div>
            <dl className="mt-3 space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
              <div className="flex justify-between gap-4">
                <dt>Amount owing</dt>
                <dd>{fmtMoney(event.amount_owing_at_checkout_cents)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Total with tax</dt>
                <dd>{fmtMoney(event.total_with_tax_cents)}</dd>
              </div>
              {event.tip_cents ? (
                <div className="flex justify-between gap-4">
                  <dt>Tip</dt>
                  <dd>{fmtMoney(event.tip_cents)}</dd>
                </div>
              ) : null}
              {event.wallet_applied_cents ? (
                <div className="flex justify-between gap-4">
                  <dt>Wallet applied</dt>
                  <dd>{fmtMoney(event.wallet_applied_cents)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <dt>Tax</dt>
                <dd>
                  {fmtMoney(event.tax_cents)} ({event.tax_rate_percent.toFixed(2)}%)
                </dd>
              </div>
              {event.external_paid_cents ? (
                <div className="flex justify-between gap-4">
                  <dt>External POS amount</dt>
                  <dd>{fmtMoney(event.external_paid_cents)}</dd>
                </div>
              ) : null}
              {event.stripe_session_id ? (
                <div className="flex justify-between gap-4">
                  <dt>Stripe session</dt>
                  <dd className="break-all font-mono">{event.stripe_session_id}</dd>
                </div>
              ) : null}
              {event.stripe_payment_intent_id ? (
                <div className="flex justify-between gap-4">
                  <dt>Payment intent</dt>
                  <dd className="break-all font-mono">{event.stripe_payment_intent_id}</dd>
                </div>
              ) : null}
              {event.note ? (
                <div className="space-y-1 pt-1">
                  <dt>Note</dt>
                  <dd className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">
                    {event.note}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatCheckoutEventSource(kind: BookingCheckoutRecord["events"][number]["kind"]) {
  return kind === "admin_completion" ? "Admin completion" : "Stripe balance checkout";
}

function AttachmentLink({
  answer,
  attachmentById,
  kind,
}: {
  answer: unknown;
  attachmentById: Map<
    string,
    { kind: string; mime_type: string | null; filename: string | null; url: string | null }
  >;
  kind: "file_upload" | "signature";
}) {
  const attachments = normalizeAttachmentAnswers(answer);
  if (attachments.length === 0) return <span>—</span>;
  const entries = kind === "signature" ? attachments.slice(0, 1) : attachments;
  return (
    <div className="space-y-2">
      {entries.map((attachment, index) => {
        const stored = attachmentById.get(attachment.attachment_id);
        if (!stored?.url) {
          return (
            <div key={attachment.attachment_id} className="text-neutral-500">
              Attachment unavailable
            </div>
          );
        }
        const isImage = stored.mime_type?.startsWith("image/") || kind === "signature";
        const label =
          stored.filename ??
          (kind === "signature" ? "Signature" : `Attachment ${index + 1}`);
        return (
          <div key={attachment.attachment_id}>
            <a
              href={stored.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              {label}
            </a>
            {isImage ? (
              <a href={stored.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={stored.url}
                  alt={label}
                  className="mt-2 max-h-48 rounded border border-neutral-200"
                />
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
