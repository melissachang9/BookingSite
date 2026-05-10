/**
 * Booking review page: shows the held slot, intake forms (if required), and a contact
 * details form. Phase 2 ends with status `awaiting_payment`. Phase 4 wires Stripe.
 */
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { BookingDetailsForm } from "./booking-details-form";
import { FormRuntime } from "./form-runtime";
import { PayButton } from "./pay-button";
import type { FormSchema } from "@/lib/forms/schema";

type Params = { tenantSlug: string; draftId: string };

async function loadDraft(slug: string, draftId: string) {
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant) return null;

  const { data: draft } = await admin
    .from("booking_drafts")
    .select("id, tenant_id, service_id, provider_id, starts_at, ends_at, status, expires_at, customer_email, customer_name, customer_phone")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft || draft.tenant_id !== tenant.id) return null;

  const [{ data: service }, { data: provider }, { data: requirements }] = await Promise.all([
    admin.from("services").select("id, name, price_cents, deposit_cents, duration_minutes").eq("id", draft.service_id).maybeSingle(),
    admin.from("providers").select("id, name").eq("id", draft.provider_id).maybeSingle(),
    admin
      .from("booking_form_requirements")
      .select("id, form_id, form_version_id, satisfied_by_response_id, forms(name, description), form_versions(schema_json)")
      .eq("booking_draft_id", draftId)
      .order("id", { ascending: true }),
  ]);

  return { tenant, draft, service, provider, requirements: requirements ?? [] };
}

export default async function BookingReviewPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { tenantSlug, draftId } = await params;
  const data = await loadDraft(tenantSlug, draftId);
  if (!data || !data.service || !data.provider) notFound();
  const { tenant, draft, service, provider, requirements } = data;

  const expired = new Date(draft.expires_at) < new Date();
  const pendingForms = requirements.filter((r) => !r.satisfied_by_response_id);

  return (
    <div className="mx-auto w-full max-w-xl px-6 py-12">
      <header className="mb-6">
        <a
          href={`/${tenant.slug}`}
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← {tenant.name}
        </a>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Confirm your booking</h1>
      </header>

      <div className="mb-6 rounded-lg border border-neutral-200 bg-white p-5 text-sm">
        <dl className="space-y-2">
          <Row label="Service" value={service.name} />
          <Row label="Provider" value={provider.name} />
          <Row label="When" value={formatWhen(draft.starts_at, draft.ends_at)} />
          <Row
            label="Price"
            value={
              service.deposit_cents > 0
                ? `$${(service.price_cents / 100).toFixed(0)} (${(service.deposit_cents / 100).toFixed(0)} due now)`
                : `$${(service.price_cents / 100).toFixed(0)}`
            }
          />
        </dl>
      </div>

      {expired ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          Your hold has expired. Please{" "}
          <a className="underline" href={`/${tenant.slug}/services/${service.id}`}>
            pick a new time
          </a>
          .
        </div>
      ) : draft.status === "promoted" ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
          This booking is already confirmed.
        </div>
      ) : !draft.customer_email ? (
        <BookingDetailsForm
          draftId={draft.id}
          defaultName={draft.customer_name ?? ""}
          defaultEmail={draft.customer_email ?? ""}
          defaultPhone={draft.customer_phone ?? ""}
          hasPendingForms={pendingForms.length > 0}
        />
      ) : pendingForms.length > 0 ? (
        <FormRuntime
          draftId={draft.id}
          requirement={{
            id: pendingForms[0].id,
            formName: (pendingForms[0].forms as unknown as { name: string } | null)?.name ?? "Intake form",
            schema: ((pendingForms[0].form_versions as unknown as { schema_json: FormSchema } | null)?.schema_json) ?? { fields: [] },
          }}
          totalPending={pendingForms.length}
        />
      ) : (
        <PayButton
          draftId={draft.id}
          tenantSlug={tenant.slug}
          amountCents={service.deposit_cents > 0 ? service.deposit_cents : service.price_cents}
          isDeposit={service.deposit_cents > 0}
          totalCents={service.price_cents}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium text-right">{value}</dd>
    </div>
  );
}

function formatWhen(starts: string, ends: string) {
  const s = new Date(starts);
  const e = new Date(ends);
  const day = s.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const t1 = s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const t2 = e.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day}, ${t1} – ${t2}`;
}
