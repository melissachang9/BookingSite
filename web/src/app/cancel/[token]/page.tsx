import Link from "next/link";
import { CancelBookingForm } from "./cancel-form";
import { getBookingByCancelToken } from "@/lib/bookings/cancel";
import { formatInTimeZone } from "@/lib/datetime/timezone";

export const metadata = { title: "Cancel Booking — BookingSite" };

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