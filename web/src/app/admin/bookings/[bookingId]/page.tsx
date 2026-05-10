import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/admin/require-tenant";
import { CancelButton } from "./cancel-button";
import { RescheduleForm } from "./reschedule-form";
import type { FormSchema, FormField } from "@/lib/forms/schema";

export const metadata = { title: "Booking — BookingSite" };

function fmtMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtAnswer(field: FormField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.type === "checkbox") return value === true ? "Yes" : "No";
  return String(value);
}

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const { supabase, tenantId } = await requireTenant();

  const { data: booking, error } = await supabase
    .from("bookings")
    .select(
      `id, starts_at, ends_at, status, price_cents, deposit_cents, notes,
       stripe_session_id, stripe_payment_intent_id,
       canceled_at, cancel_reason,
       provider_id, customer_id, service_id,
       providers(name),
       services(name, duration_minutes),
       customers(id, name, email, phone)`
    )
    .eq("id", bookingId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !booking) notFound();

  const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
  const service = Array.isArray(booking.services) ? booking.services[0] : booking.services;
  const provider = Array.isArray(booking.providers) ? booking.providers[0] : booking.providers;

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
                      : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300")
              }
            >
              {booking.status}
            </span>
          </p>
        </div>
        {booking.status === "confirmed" && (
          <div className="flex flex-col gap-2">
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

      <section className="grid gap-4 sm:grid-cols-2">
        <Card title="Customer">
          <Row label="Name" value={customer?.name ?? "—"} />
          <Row label="Email" value={customer?.email ?? "—"} />
          <Row label="Phone" value={customer?.phone ?? "—"} />
        </Card>
        <Card title="Service & provider">
          <Row label="Service" value={service?.name ?? "—"} />
          <Row label="Duration" value={`${service?.duration_minutes ?? 0} min`} />
          <Row label="Provider" value={provider?.name ?? "—"} />
        </Card>
        <Card title="Payment">
          <Row label="Price" value={fmtMoney(booking.price_cents)} />
          <Row
            label="Deposit"
            value={booking.deposit_cents > 0 ? fmtMoney(booking.deposit_cents) : "—"}
          />
          <Row label="Stripe session" value={booking.stripe_session_id ?? "—"} mono />
          <Row label="Payment intent" value={booking.stripe_payment_intent_id ?? "—"} mono />
        </Card>
        {booking.status === "canceled" && (
          <Card title="Cancellation">
            <Row
              label="Canceled at"
              value={booking.canceled_at ? new Date(booking.canceled_at).toLocaleString() : "—"}
            />
            <Row label="Reason" value={booking.cancel_reason ?? "—"} />
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Intake forms</h2>
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
                      {schema.fields.map((f) => (
                        <div key={f.id}>
                          <dt className="text-xs text-neutral-500">{f.label}</dt>
                          <dd className="whitespace-pre-wrap">
                            {fmtAnswer(f, resp.answers_json[f.id])}
                          </dd>
                        </div>
                      ))}
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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className={"text-right " + (mono ? "font-mono text-xs break-all" : "")}>{value}</dd>
    </div>
  );
}
