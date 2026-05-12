import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/admin/require-tenant";
import { createAdminClient } from "@/lib/supabase/admin";
import { CancelButton } from "./cancel-button";
import { CustomerManageTools } from "./customer-manage-tools";
import { RescheduleForm } from "./reschedule-form";
import { StatusButtons } from "./status-buttons";
import {
  DISPLAY_ONLY_TYPES,
  formatAnswer,
  normalizeAttachmentAnswers,
  type FormSchema,
} from "@/lib/forms/schema";

export const metadata = { title: "Booking — BookingSite" };

function fmtMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
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
      `id, starts_at, ends_at, status, cancel_token, price_cents, deposit_cents, assessed_no_show_fee_cents, notes,
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

  const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
  const service = Array.isArray(booking.services) ? booking.services[0] : booking.services;
  const provider = Array.isArray(booking.providers) ? booking.providers[0] : booking.providers;
  const manageUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/cancel/${booking.cancel_token}`;

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
            <StatusButtons bookingId={booking.id} />
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
