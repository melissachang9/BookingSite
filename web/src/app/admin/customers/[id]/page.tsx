import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageBookingCheckout } from "@/lib/admin/roles";
import { getCustomerWalletBalanceCents } from "@/lib/payments/customer-wallet";
import { requireTenant } from "@/lib/admin/require-tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeTenantSettings } from "@/lib/tenants/settings";
import {
  DISPLAY_ONLY_TYPES,
  formatAnswer,
  normalizeAttachmentAnswers,
  type FormSchema,
} from "@/lib/forms/schema";
import { CustomerBookingActions } from "./customer-booking-actions";
import { InternalCustomerFormRuntime } from "./internal-form-runtime";

export const metadata = { title: "Customer — BookingSite" };

type BookingRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  customer_id: string;
  status: "confirmed" | "completed" | "canceled" | "no_show";
  price_cents: number;
  deposit_cents: number;
  deposit_status: string | null;
  stripe_payment_intent_id: string | null;
  stripe_refund_id: string | null;
  refunded_at: string | null;
  refunded_amount_cents: number | null;
  services: { name: string; duration_minutes: number } | { name: string; duration_minutes: number }[] | null;
  providers: { name: string } | { name: string }[] | null;
};

type FormResponseRow = {
  id: string;
  booking_id: string | null;
  form_version_id: string;
  answers_json: Record<string, unknown>;
  submitted_at: string;
  filled_by_user_id: string | null;
};

type FormVersionRow = {
  id: string;
  form_id: string;
  schema_json: FormSchema;
};

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

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

function statusClasses(status: BookingRow["status"]) {
  if (status === "confirmed") {
    return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";
  }
  if (status === "canceled") {
    return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
  }
  if (status === "completed") {
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
  }
  return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
}

export default async function CustomerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ form?: string }>;
}) {
  const { id } = await params;
  const { form: selectedFormId } = await searchParams;
  const { supabase, tenantId, role } = await requireTenant();

  const { data: customer } = await supabase
    .from("customers")
    .select("id, tenant_id, name, email, phone, notes, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!customer || customer.tenant_id !== tenantId) notFound();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("settings_json")
    .eq("id", tenantId)
    .maybeSingle();
  const taxRatePercent = normalizeTenantSettings(
    (tenant?.settings_json ?? null) as Partial<Record<string, unknown>> | null
  ).tax_rate_percent ?? 0;
  const canManageCheckout = canManageBookingCheckout(role);
  const walletBalanceCents = await getCustomerWalletBalanceCents({
    tenantId,
    customerId: customer.id,
  });

  const [{ data: bookingsData }, { data: responsesData }, { data: internalFormsData }] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, starts_at, ends_at, customer_id, status, price_cents, deposit_cents, deposit_status, stripe_payment_intent_id, stripe_refund_id, refunded_at, refunded_amount_cents, services(name, duration_minutes), providers(name)"
      )
      .eq("tenant_id", tenantId)
      .eq("customer_id", customer.id)
      .order("starts_at", { ascending: false }),
    supabase
      .from("form_responses")
      .select("id, booking_id, form_version_id, answers_json, submitted_at, filled_by_user_id")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customer.id)
      .order("submitted_at", { ascending: false }),
    supabase
      .from("forms")
      .select("id, name, description, current_version_id")
      .eq("tenant_id", tenantId)
      .eq("scope", "internal")
      .eq("is_archived", false)
      .order("name", { ascending: true }),
  ]);
  const bookings = (bookingsData ?? []) as BookingRow[];
  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  const responses = (responsesData ?? []) as FormResponseRow[];
  const internalForms = (internalFormsData ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    current_version_id: string | null;
  }>;
  const selectedInternalForm =
    internalForms.find((form) => form.id === selectedFormId && form.current_version_id) ?? null;

  const versionIds = [
    ...new Set(
      [
        ...responses.map((response) => response.form_version_id),
        ...(selectedInternalForm?.current_version_id ? [selectedInternalForm.current_version_id] : []),
      ].filter(Boolean)
    ),
  ];
  const { data: versionsData } = versionIds.length
    ? await supabase
        .from("form_versions")
        .select("id, form_id, schema_json")
        .eq("tenant_id", tenantId)
        .in("id", versionIds)
    : { data: [] as FormVersionRow[] };
  const versions = (versionsData ?? []) as FormVersionRow[];
  const versionById = new Map(versions.map((version) => [version.id, version]));

  const formIds = [...new Set(versions.map((version) => version.form_id))];
  const { data: formsData } = formIds.length
    ? await supabase
        .from("forms")
        .select("id, name, scope")
        .eq("tenant_id", tenantId)
        .in("id", formIds)
    : { data: [] as Array<{ id: string; name: string; scope: string }> };
  const formById = new Map((formsData ?? []).map((form) => [form.id, form]));

  const filledByIds = [...new Set(responses.map((response) => response.filled_by_user_id).filter(Boolean))];
  const { data: filledByUsers } = filledByIds.length
    ? await supabase
        .from("users")
        .select("id, name, email")
        .eq("tenant_id", tenantId)
        .in("id", filledByIds)
    : { data: [] as Array<{ id: string; name: string | null; email: string }> };
  const filledByUserById = new Map(
    (filledByUsers ?? []).map((user) => [user.id, user.name?.trim() || user.email])
  );

  const responseIds = responses.map((response) => response.id);
  const { data: attachments } = responseIds.length
    ? await supabase
        .from("form_response_attachments")
        .select("id, form_response_id, kind, mime_type, original_filename, storage_path")
        .in("form_response_id", responseIds)
    : {
        data: [] as Array<{
          id: string;
          form_response_id: string | null;
          kind: string;
          mime_type: string | null;
          original_filename: string | null;
          storage_path: string;
        }>,
      };

  const attachmentById = new Map<
    string,
    { kind: string; mime_type: string | null; filename: string | null; url: string | null }
  >();
  if ((attachments?.length ?? 0) > 0) {
    const admin = createAdminClient();
    for (const attachment of attachments ?? []) {
      const { data: signed } = await admin.storage
        .from("form-uploads")
        .createSignedUrl(attachment.storage_path, 60 * 60);
      attachmentById.set(attachment.id, {
        kind: attachment.kind,
        mime_type: attachment.mime_type,
        filename: attachment.original_filename,
        url: signed?.signedUrl ?? null,
      });
    }
  }

  const upcomingCount = bookings.filter(
    (booking) => booking.status === "confirmed" && new Date(booking.starts_at) >= new Date()
  ).length;
  const completedCount = bookings.filter((booking) => booking.status === "completed").length;
  const selectedInternalVersion = selectedInternalForm?.current_version_id
    ? versionById.get(selectedInternalForm.current_version_id) ?? null
    : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/customers" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Customers
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{customer.name}</h1>
        <p className="text-sm text-neutral-600">Customer profile and booking history.</p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total bookings" value={String(bookings.length)} />
        <MetricCard label="Upcoming" value={String(upcomingCount)} />
        <MetricCard label="Completed" value={String(completedCount)} />
        <MetricCard label="Forms submitted" value={String(responses.length)} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card title="Contact">
          <Row label="Name" value={customer.name} />
          <Row label="Email" value={customer.email} />
          <Row label="Phone" value={customer.phone ?? "—"} />
          <Row label="Wallet balance" value={fmtMoney(walletBalanceCents)} />
          <Row label="Created" value={new Date(customer.created_at).toLocaleDateString()} />
        </Card>
        <Card title="Notes">
          <div className="text-sm text-neutral-700 whitespace-pre-wrap">
            {customer.notes?.trim() ? customer.notes : "No notes yet."}
          </div>
        </Card>
      </section>

      <section>
        <div className="mb-2">
          <h2 className="text-lg font-semibold">Internal forms</h2>
          <p className="text-sm text-neutral-500">Staff-only forms that can be filled directly from this customer profile.</p>
        </div>
        {internalForms.length === 0 ? (
          <p className="rounded-md border border-neutral-200 p-4 text-sm text-neutral-500">
            No internal forms yet. Create one in the forms builder and set its scope to internal-only.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {internalForms.map((form) => {
              const active = selectedInternalForm?.id === form.id;

              return (
                <div key={form.id} className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-neutral-900">{form.name}</h3>
                      <p className="mt-1 text-sm text-neutral-500">
                        {form.description?.trim() || "Internal customer record form."}
                      </p>
                    </div>
                    {form.current_version_id ? (
                      <Link
                        href={`/admin/customers/${customer.id}?form=${form.id}`}
                        className={`rounded-md px-3 py-2 text-sm font-medium ${
                          active
                            ? "bg-neutral-900 text-white"
                            : "border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
                        }`}
                      >
                        {active ? "Open" : "Fill form"}
                      </Link>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
                        Unpublished
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {selectedInternalForm && selectedInternalVersion ? (
        <section>
          <InternalCustomerFormRuntime
            customerId={customer.id}
            customerName={customer.name}
            form={{
              id: selectedInternalForm.id,
              versionId: selectedInternalVersion.id,
              name: selectedInternalForm.name,
              description: selectedInternalForm.description,
              schema: selectedInternalVersion.schema_json,
            }}
          />
        </section>
      ) : null}

      <section>
        <div className="mb-2">
          <h2 className="text-lg font-semibold">Booking history</h2>
          <p className="text-sm text-neutral-500">All bookings for this customer.</p>
        </div>
        <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Service</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-neutral-500">
                    No bookings yet.
                  </td>
                </tr>
              ) : (
                bookings.map((booking) => {
                  const service = normalizeRelation(booking.services);
                  const provider = normalizeRelation(booking.providers);
                  return (
                    <tr key={booking.id} className="border-t border-neutral-200 dark:border-neutral-800">
                      <td className="px-3 py-2">
                        <Link href={`/admin/bookings/${booking.id}`} className="hover:underline">
                          {fmtDateTime(booking.starts_at)}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{service?.name ?? "—"}</td>
                      <td className="px-3 py-2">{provider?.name ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${statusClasses(booking.status)}`}>
                          {booking.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(booking.price_cents)}</td>
                      <td className="px-3 py-2 align-top">
                        <CustomerBookingActions
                          bookingId={booking.id}
                          status={booking.status}
                          startsAt={booking.starts_at}
                          endsAt={booking.ends_at}
                          durationMinutes={service?.duration_minutes ?? 60}
                          priceCents={booking.price_cents}
                          depositCents={booking.deposit_cents}
                          depositStatus={booking.deposit_status}
                          taxRatePercent={taxRatePercent}
                          stripePaymentIntentId={booking.stripe_payment_intent_id}
                          stripeRefundId={booking.stripe_refund_id}
                          refundedAmountCents={booking.refunded_amount_cents}
                          refundedAt={booking.refunded_at}
                          walletBalanceCents={walletBalanceCents}
                          canManageCheckout={canManageCheckout}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2">
          <h2 className="text-lg font-semibold">Form history</h2>
          <p className="text-sm text-neutral-500">Customer-facing and internal responses linked to this profile.</p>
        </div>
        {responses.length === 0 ? (
          <p className="rounded-md border border-neutral-200 p-4 text-sm text-neutral-500">
            No form responses yet.
          </p>
        ) : (
          <div className="space-y-4">
            {responses.map((response) => {
              const version = versionById.get(response.form_version_id);
              const form = version ? formById.get(version.form_id) ?? null : null;
              const formName = form?.name ?? "Form";
              const schema = version?.schema_json ?? { fields: [] };
              const booking = response.booking_id ? bookingById.get(response.booking_id) ?? null : null;
              const service = booking ? normalizeRelation(booking.services) : null;
              const filledBy = response.filled_by_user_id
                ? filledByUserById.get(response.filled_by_user_id) ?? null
                : null;

              return (
                <div key={response.id} className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium">{formName}</h3>
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-600">
                          {form?.scope === "internal" ? "Internal" : "Customer"}
                        </span>
                      </div>
                      {booking ? (
                        <p className="text-xs text-neutral-500">
                          <Link href={`/admin/bookings/${booking.id}`} className="hover:underline">
                            {service?.name ?? "Booking"} · {fmtDateTime(booking.starts_at)}
                          </Link>
                        </p>
                      ) : form?.scope === "internal" ? (
                        <p className="text-xs text-neutral-500">Filled from the customer profile.</p>
                      ) : null}
                      {filledBy ? <p className="text-xs text-neutral-500">Filled by {filledBy}</p> : null}
                    </div>
                    <span className="text-xs text-neutral-500">
                      Submitted {new Date(response.submitted_at).toLocaleString()}
                    </span>
                  </div>
                  <dl className="space-y-2 text-sm">
                    {schema.fields.map((field) => {
                      if (DISPLAY_ONLY_TYPES.has(field.type)) {
                        if (field.type === "section") {
                          return (
                            <div key={field.id} className="pt-2 text-xs font-semibold uppercase text-neutral-500">
                              {field.label}
                            </div>
                          );
                        }
                        return null;
                      }

                      return (
                        <div key={field.id}>
                          <dt className="text-xs text-neutral-500">{field.label}</dt>
                          <dd className="whitespace-pre-wrap">
                            {field.type === "file_upload" || field.type === "signature" ? (
                              <AttachmentLink
                                answer={response.answers_json[field.id]}
                                attachmentById={attachmentById}
                                kind={field.type}
                              />
                            ) : (
                              formatAnswer(field, response.answers_json[field.id])
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="mb-2 text-sm font-medium">{title}</div>
      <div>{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <div className="text-neutral-500">{label}</div>
      <div className="text-right">{value}</div>
    </div>
  );
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