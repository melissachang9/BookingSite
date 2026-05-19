import Link from "next/link";
import { CancelBookingForm } from "./cancel-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBookingByCancelToken } from "@/lib/bookings/cancel";
import { formatInTimeZone } from "@/lib/datetime/timezone";
import type { FormSchema } from "@/lib/forms/schema";
import { ManageBookingFormRuntime } from "./manage-form-runtime";

export const metadata = { title: "Manage Booking — BookingSite" };

function formatMoney(cents: number | null | undefined) {
  if (!cents || cents <= 0) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

function formatWhen(startsAt: string, endsAt: string, timeZone: string) {
  const day = formatInTimeZone(startsAt, timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }, "en-US");
  const startTime = formatInTimeZone(startsAt, timeZone, {
    hour: "numeric",
    minute: "2-digit",
  }, "en-US");
  const endTime = formatInTimeZone(endsAt, timeZone, {
    hour: "numeric",
    minute: "2-digit",
  }, "en-US");
  return `${day} · ${startTime} - ${endTime}`;
}

function formatTimestamp(value: string, timeZone: string) {
  return formatInTimeZone(
    value,
    timeZone,
    {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
    "en-US"
  );
}

export default async function CancelBookingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const booking = await getBookingByCancelToken(token);

  if (!booking) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-neutral-900">Invalid cancellation link</h1>
          <p className="mt-3 text-sm text-neutral-600">
            This link is invalid or has expired. Contact the studio directly if you still need help.
          </p>
        </div>
      </main>
    );
  }

  const refundedText = formatMoney(booking.refundedAmountCents);
  const admin = createAdminClient();
  const { data: requirements } = await admin
    .from("booking_form_requirements")
    .select(
      "id, form_id, form_version_id, satisfied_by_response_id, draft_answers_json, draft_saved_at, forms!inner(name, description, customer_prompt_timing, scope), form_versions(schema_json)"
    )
    .eq("booking_id", booking.id)
    .order("created_at", { ascending: true });

  const now = new Date();
  const visiblePendingForms = (requirements ?? []).filter((requirement) => {
    if (requirement.satisfied_by_response_id) return false;
    const form = requirement.forms as unknown as {
      scope: string;
      customer_prompt_timing: string | null;
    } | null;
    if (!form || form.scope !== "customer") return false;

    const timing = form.customer_prompt_timing ?? "pre_booking";
    if (timing === "pre_visit") {
      return booking.status === "confirmed" && new Date(booking.endsAt) > now;
    }
    if (timing === "post_visit") {
      return booking.status !== "canceled" && new Date(booking.endsAt) <= now;
    }
    return false;
  });

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <div className="space-y-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">{booking.tenantName}</p>
          <h1 className="mt-2 text-2xl font-semibold text-neutral-900">
            {booking.status === "confirmed" ? "Manage your booking" : "Booking update"}
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            {booking.customerName ? `Hi ${booking.customerName}, ` : ""}
            review your appointment details below.
          </p>
        </div>

        <section className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-lg font-semibold text-neutral-900">{booking.serviceName}</p>
          <p className="mt-1 text-sm text-neutral-700">
            {formatWhen(booking.startsAt, booking.endsAt, booking.tenantTimeZone)}
          </p>
          {booking.providerName ? (
            <p className="mt-1 text-sm text-neutral-600">Provider: {booking.providerName}</p>
          ) : null}
        </section>

        {visiblePendingForms.length > 0 ? (
          <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              {visiblePendingForms.length > 1 ? `${visiblePendingForms.length} forms pending` : "Pending form"}
            </p>
            <div className="mt-4">
              <ManageBookingFormRuntime
                token={token}
                requirement={{
                  id: visiblePendingForms[0].id,
                  formName:
                    (visiblePendingForms[0].forms as unknown as { name: string } | null)?.name ??
                    "Required form",
                  formDescription:
                    (visiblePendingForms[0].forms as unknown as { description?: string | null } | null)
                      ?.description ?? null,
                  schema:
                    ((visiblePendingForms[0].form_versions as unknown as {
                      schema_json: FormSchema;
                    } | null)?.schema_json) ?? { fields: [] },
                }}
                initialAnswers={
                  ((visiblePendingForms[0] as {
                    draft_answers_json?: Record<string, unknown> | null;
                  }).draft_answers_json ?? {})
                }
                initialSavedAt={
                  (visiblePendingForms[0] as { draft_saved_at?: string | null }).draft_saved_at ?? null
                }
                totalPending={visiblePendingForms.length}
              />
            </div>
          </section>
        ) : null}

        {booking.status === "confirmed" ? (
          <CancelBookingForm
            token={token}
            cancellationWindowHours={booking.cancellationWindowHours}
            refundInsideWindow={booking.refundInsideWindow}
            insideCancellationWindow={booking.insideCancellationWindow}
          />
        ) : booking.status === "canceled" ? (
          <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-900">
            <p className="font-medium">This booking has already been canceled.</p>
            {booking.canceledAt ? (
              <p className="mt-1">
                Canceled on {formatTimestamp(booking.canceledAt, booking.tenantTimeZone)}.
              </p>
            ) : null}
            {refundedText ? (
              <p className="mt-1">
                Refund issued: {refundedText}
                {booking.refundedAt
                  ? ` on ${formatTimestamp(booking.refundedAt, booking.tenantTimeZone)}`
                  : ""}.
              </p>
            ) : null}
            {!refundedText && booking.canceledInsideCancellationWindow && !booking.refundInsideWindow ? (
              <p className="mt-1">
                No refund was issued because the booking was canceled inside the {booking.cancellationWindowHours}-hour cancellation window.
              </p>
            ) : null}
            {booking.cancelReason ? <p className="mt-2">Reason: {booking.cancelReason}</p> : null}
          </div>
        ) : (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-700">
            This booking is marked {booking.status.replace("_", " ")} and can no longer be canceled online.
          </div>
        )}

        <div className="text-sm text-neutral-600">
          Need help instead? Go back to the booking site for <Link href={`/${booking.tenantSlug}`} className="text-neutral-900 underline">{booking.tenantName}</Link>.
        </div>
      </div>
    </main>
  );
}