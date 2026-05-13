/**
 * Booking review page: shows the held slot, intake forms (if required), and a contact
 * details form. Phase 2 ends with status `awaiting_payment`. Phase 4 wires Stripe.
 */
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { BookingDetailsForm } from "./booking-details-form";
import { FormRuntime } from "./form-runtime";
import { PayButton } from "./pay-button";
import type { FormSchema } from "@/lib/forms/schema";
import { normalizeTenantSettings } from "@/lib/tenants/settings";
import { formatInTimeZone } from "@/lib/datetime/timezone";

type Params = { tenantSlug: string; draftId: string };

type CheckoutSessionState = {
  status: "open" | "complete" | "expired";
  expiresAt: string | null;
};

async function loadCheckoutSessionState(
  stripeSessionId: string | null
): Promise<CheckoutSessionState | null> {
  if (!stripeSessionId) return null;

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
    if (
      session.status !== "open" &&
      session.status !== "complete" &&
      session.status !== "expired"
    ) {
      return null;
    }

    return {
      status: session.status,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000).toISOString()
        : null,
    };
  } catch (error) {
    console.error("Failed to load checkout session state", error);
    return null;
  }
}

async function loadDraft(slug: string, draftId: string) {
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, slug, timezone, settings_json")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant) return null;

  const { data: draft } = await admin
    .from("booking_drafts")
    .select("id, tenant_id, service_id, location_id, provider_id, starts_at, ends_at, status, expires_at, stripe_session_id, customer_email, customer_name, customer_phone, draft_contact_details_json, draft_contact_details_saved_at, price_cents, deposit_cents, duration_minutes")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft || draft.tenant_id !== tenant.id) return null;

  const [{ data: service }, { data: location }, { data: provider }, { data: requirements }, checkoutSession] = await Promise.all([
    admin.from("services").select("id, name").eq("id", draft.service_id).maybeSingle(),
    admin.from("locations").select("id, name").eq("id", draft.location_id).maybeSingle(),
    admin.from("providers").select("id, name").eq("id", draft.provider_id).maybeSingle(),
    admin
      .from("booking_form_requirements")
      .select("id, form_id, form_version_id, satisfied_by_response_id, draft_answers_json, draft_saved_at, forms(name, description), form_versions(schema_json)")
      .eq("booking_draft_id", draftId)
      .order("id", { ascending: true }),
    draft.status === "promoted"
      ? Promise.resolve(null)
      : loadCheckoutSessionState(draft.stripe_session_id ?? null),
  ]);

  return {
    tenant,
    draft,
    service,
    location,
    provider,
    requirements: requirements ?? [],
    checkoutSession,
  };
}

export default async function BookingReviewPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { tenantSlug, draftId } = await params;
  const data = await loadDraft(tenantSlug, draftId);
  if (!data || !data.service || !data.provider) notFound();
  const { tenant, draft, service, location, provider, requirements, checkoutSession } = data;
  const tenantSettings = normalizeTenantSettings(
    (tenant.settings_json ?? null) as Partial<Record<string, unknown>> | null
  );

  const expired = new Date(draft.expires_at) < new Date();
  const draftContactDetails = normalizeDraftContactDetails(draft.draft_contact_details_json);
  const pendingForms = requirements.filter((r) => !r.satisfied_by_response_id);
  const hasContactDetails = Boolean(draft.customer_email);
  const hasForms = requirements.length > 0;
  const paymentDueCents = draft.deposit_cents > 0 ? draft.deposit_cents : draft.price_cents;
  const balanceDueLaterCents = Math.max(0, draft.price_cents - paymentDueCents);

  const steps = [
    {
      label: "Details",
      description: "Contact and confirmation",
      state: expired
        ? "disabled"
        : hasContactDetails || draft.status === "promoted"
          ? "complete"
          : "current",
    },
    {
      label: hasForms ? "Intake" : "Prep",
      description: hasForms ? `${requirements.length} required form${requirements.length === 1 ? "" : "s"}` : "No form required",
      state: expired
        ? "disabled"
        : !hasForms
          ? hasContactDetails || draft.status === "promoted"
            ? "complete"
            : "disabled"
          : hasContactDetails && pendingForms.length === 0
            ? "complete"
            : hasContactDetails && pendingForms.length > 0
              ? "current"
              : "disabled",
    },
    {
      label: "Payment",
      description: draft.deposit_cents > 0 ? "Deposit checkout" : "Full payment",
      state: expired
        ? "disabled"
        : draft.status === "promoted"
          ? "complete"
          : hasContactDetails && pendingForms.length === 0
            ? "current"
            : "disabled",
    },
  ] as const;

  const stage = expired
    ? {
        eyebrow: "Hold expired",
        title: "This reservation needs a new time",
        description:
          "Your temporary hold ran out before checkout finished. Pick another slot and the same flow will reopen.",
      }
    : draft.status === "promoted"
      ? {
          eyebrow: "Booking confirmed",
          title: "This appointment is already locked in",
          description:
            "The secure hold has already been converted into a confirmed booking, so no further action is needed here.",
        }
      : !hasContactDetails
        ? {
            eyebrow: "Step 1",
            title: "Tell the studio where to send everything",
            description:
              "Start with your contact details so confirmations, reminders, and updates reach the right place.",
          }
        : pendingForms.length > 0
          ? {
              eyebrow: "Step 2",
              title: "Complete the intake before checkout",
              description:
                "Answer the required form so the provider has everything needed before your appointment is confirmed.",
            }
          : {
              eyebrow: "Final step",
              title: "Secure the appointment",
              description:
                "Your time is still on hold. Finish payment now to convert it into a confirmed booking.",
            };

  return (
    <div
      className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,244,223,0.95),_rgba(252,247,240,0.92)_38%,_rgba(255,255,255,1)_72%)]"
      style={{ fontFamily: '"Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif' }}
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-10 lg:py-14">
        <header className="mb-8 max-w-4xl">
          <a
            href={`/${tenant.slug}`}
            className="text-sm font-medium uppercase tracking-[0.18em] text-stone-500 transition hover:text-stone-900"
          >
            ← Back to {tenant.name}
          </a>
          <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
                {stage.eyebrow}
              </p>
              <h1
                className="text-4xl leading-none tracking-[-0.04em] text-stone-950 sm:text-5xl"
                style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif' }}
              >
                {stage.title}
              </h1>
              <p className="max-w-xl text-base leading-7 text-stone-600 sm:text-lg">
                {stage.description}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[28rem]">
              {steps.map((step) => (
                <div
                  key={step.label}
                  className={
                    "rounded-2xl border px-4 py-4 shadow-sm transition " +
                    (step.state === "complete"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                      : step.state === "current"
                        ? "border-stone-900 bg-stone-900 text-white shadow-[0_20px_45px_rgba(35,21,10,0.18)]"
                        : "border-stone-200 bg-white/80 text-stone-500")
                  }
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em]">
                    {step.state === "complete"
                      ? "Complete"
                      : step.state === "current"
                        ? "Current"
                        : "Upcoming"}
                  </p>
                  <p className="mt-3 text-base font-semibold">{step.label}</p>
                  <p className="mt-1 text-sm opacity-80">{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)] lg:items-start">
          <section className="order-2 space-y-6 lg:order-1">
            <div className="rounded-[2rem] border border-stone-200 bg-white/90 p-6 shadow-[0_24px_70px_rgba(53,35,18,0.1)] backdrop-blur">
              {expired ? (
                <StatusPanel
                  tone="expired"
                  title="Your hold has expired"
                  body={
                    <>
                      Please{" "}
                      <a
                        className="underline decoration-stone-400 underline-offset-4"
                        href={`/${tenant.slug}/services/${service.id}?location=${draft.location_id}`}
                      >
                        pick a new time
                      </a>
                      {" "}to reopen the flow.
                    </>
                  }
                />
              ) : draft.status === "promoted" ? (
                <StatusPanel
                  tone="confirmed"
                  title="This booking is already confirmed"
                  body="You can close this page or return to the main booking site."
                />
              ) : !draft.customer_email ? (
                <BookingDetailsForm
                  draftId={draft.id}
                  defaultName={draft.customer_name ?? draftContactDetails.name}
                  defaultEmail={draft.customer_email ?? draftContactDetails.email}
                  defaultPhone={draft.customer_phone ?? draftContactDetails.phone}
                  initialSavedAt={draft.draft_contact_details_saved_at ?? null}
                  hasPendingForms={pendingForms.length > 0}
                />
              ) : pendingForms.length > 0 ? (
                <FormRuntime
                  key={`${pendingForms[0].id}:${JSON.stringify((pendingForms[0] as { draft_answers_json?: Record<string, unknown> | null }).draft_answers_json ?? {})}:${(pendingForms[0] as { draft_saved_at?: string | null }).draft_saved_at ?? ""}`}
                  draftId={draft.id}
                  requirement={{
                    id: pendingForms[0].id,
                    formName: (pendingForms[0].forms as unknown as { name: string } | null)?.name ?? "Intake form",
                    schema:
                      ((pendingForms[0].form_versions as unknown as { schema_json: FormSchema } | null)?.schema_json) ??
                      { fields: [] },
                  }}
                  initialAnswers={
                    ((pendingForms[0] as { draft_answers_json?: Record<string, unknown> | null }).draft_answers_json ?? {})
                  }
                  initialSavedAt={
                    (pendingForms[0] as { draft_saved_at?: string | null }).draft_saved_at ?? null
                  }
                  totalPending={pendingForms.length}
                />
              ) : (
                <PayButton
                  draftId={draft.id}
                  tenantSlug={tenant.slug}
                  amountCents={paymentDueCents}
                  isDeposit={draft.deposit_cents > 0}
                  totalCents={draft.price_cents}
                  noShowFeeCents={tenantSettings.no_show_fee_cents}
                  autoChargeNoShowFee={tenantSettings.auto_charge_no_show_fee}
                  checkoutSessionStatus={checkoutSession?.status ?? null}
                  checkoutSessionExpiresLabel={
                    checkoutSession?.expiresAt
                      ? formatExpiry(checkoutSession.expiresAt, tenant.timezone)
                      : null
                  }
                />
              )}
            </div>
          </section>

          <aside className="order-1 lg:order-2 lg:sticky lg:top-8">
            <div className="overflow-hidden rounded-[2rem] border border-stone-200 bg-[linear-gradient(180deg,#fffdf8_0%,#f4ebdc_100%)] shadow-[0_26px_80px_rgba(53,35,18,0.12)]">
              <div className="border-b border-stone-200 px-6 py-6">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                  Booking summary
                </p>
                <h2
                  className="mt-3 text-3xl tracking-[-0.03em] text-stone-950"
                  style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif' }}
                >
                  {service.name}
                </h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  Reserved with {provider.name} at {location?.name ?? tenant.name}.
                </p>
              </div>

              <div className="space-y-5 px-6 py-6 text-sm text-stone-700">
                <div className="grid gap-4 rounded-2xl bg-white/75 p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <Metric label="When" value={formatWhen(draft.starts_at, draft.ends_at, tenant.timezone)} />
                  {location ? <Metric label="Where" value={location.name} /> : null}
                  <Metric label="Duration" value={`${draft.duration_minutes} minutes`} />
                  <Metric label="Due now" value={formatMoney(paymentDueCents)} />
                  <Metric
                    label={draft.deposit_cents > 0 ? "Remaining later" : "Total value"}
                    value={draft.deposit_cents > 0 ? formatMoney(balanceDueLaterCents) : formatMoney(draft.price_cents)}
                  />
                </div>

                {!expired && draft.status !== "promoted" ? (
                  <div className="rounded-2xl border border-stone-200 bg-white/80 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                      Hold expires
                    </p>
                    <p className="mt-2 text-base font-semibold text-stone-950">
                      {formatExpiry(draft.expires_at, tenant.timezone)}
                    </p>
                    <p className="mt-1 text-sm text-stone-600">
                      Finish this flow before the hold releases back to the calendar.
                    </p>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-stone-200 bg-white/80 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                    Payment structure
                  </p>
                  <p className="mt-2 text-sm leading-6 text-stone-700">
                    {draft.deposit_cents > 0
                      ? `${formatMoney(paymentDueCents)} is collected now to secure the appointment. The remaining ${formatMoney(balanceDueLaterCents)} is paid at the visit.`
                      : `${formatMoney(paymentDueCents)} is collected today to confirm the booking.`}
                  </p>
                </div>

                <div className="rounded-2xl border border-stone-200 bg-stone-950 px-4 py-5 text-stone-100">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
                    What happens next
                  </p>
                  <p className="mt-2 text-sm leading-6 text-stone-200">
                    You&apos;ll receive a confirmation with a secure manage link, and reminders follow the studio&apos;s timing settings.
                  </p>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function normalizeDraftContactDetails(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { name: "", email: "", phone: "" };
  }

  const candidate = value as { name?: unknown; email?: unknown; phone?: unknown };
  return {
    name: typeof candidate.name === "string" ? candidate.name : "",
    email: typeof candidate.email === "string" ? candidate.email : "",
    phone: typeof candidate.phone === "string" ? candidate.phone : "",
  };
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-stone-950">{value}</p>
    </div>
  );
}

function StatusPanel({
  tone,
  title,
  body,
}: {
  tone: "expired" | "confirmed";
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div
      className={
        "rounded-[1.5rem] border px-6 py-6 text-sm " +
        (tone === "expired"
          ? "border-red-200 bg-red-50 text-red-900"
          : "border-emerald-200 bg-emerald-50 text-emerald-900")
      }
    >
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 leading-7">{body}</div>
    </div>
  );
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatExpiry(iso: string, timeZone: string) {
  const day = formatInTimeZone(
    iso,
    timeZone,
    { weekday: "short", month: "short", day: "numeric" },
    "en-US"
  );
  const time = formatInTimeZone(
    iso,
    timeZone,
    { hour: "numeric", minute: "2-digit", timeZoneName: "short" },
    "en-US"
  );
  return `${day} at ${time}`;
}

function formatWhen(starts: string, ends: string, timeZone: string) {
  const day = formatInTimeZone(starts, timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const t1 = formatInTimeZone(starts, timeZone, { hour: "numeric", minute: "2-digit" });
  const t2 = formatInTimeZone(ends, timeZone, { hour: "numeric", minute: "2-digit" });
  return `${day}, ${t1} – ${t2}`;
}
