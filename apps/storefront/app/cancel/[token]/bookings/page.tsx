import Link from "next/link";
import { notFound } from "next/navigation";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../lib/storefront-api";
import { formatCurrency, formatInTenantTime } from "../../../lib/storefront-shell";

type BookingHistoryRouteProps = {
  params: Promise<{ token: string }>;
};

export const dynamic = "force-dynamic";

const isNextNavigationSignal = (error: unknown): error is { digest: string } =>
  typeof error === "object" &&
  error !== null &&
  "digest" in error &&
  typeof error.digest === "string" &&
  (error.digest.startsWith("NEXT_REDIRECT") || error.digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"));

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Upcoming",
  completed: "Completed",
  canceled: "Canceled",
  no_show: "No-show",
};

export default async function CustomerBookingHistoryPage({ params }: BookingHistoryRouteProps) {
  const { token } = await params;

  try {
    const [manageBooking, bookingList] = await Promise.all([
      storefrontApi.getManageBooking(token),
      storefrontApi.listCustomerBookings(token),
    ]);

    const { tenant } = manageBooking;
    const bookings = bookingList.items;
    const now = new Date();

    const upcoming = bookings.filter((b) => b.status === "confirmed" && new Date(b.startsAt) >= now);
    const past = bookings.filter((b) => b.status !== "confirmed" || new Date(b.startsAt) < now);

    return (
      <main className="manage-page page-stack">
        <section className="state-panel state-panel--manage">
          <p className="store-eyebrow">Booking history</p>
          <h1>Your appointments with {tenant.name}</h1>
          <p>
            {bookings.length === 0
              ? "You don't have any appointments yet."
              : `${bookings.length} appointment${bookings.length === 1 ? "" : "s"} on file.`}
          </p>
        </section>

        {upcoming.length > 0 ? (
          <section className="store-section">
            <div className="section-header">
              <div>
                <p className="store-eyebrow">Upcoming</p>
                <h2>{upcoming.length} appointment{upcoming.length === 1 ? "" : "s"}</h2>
              </div>
            </div>
            <div className="summary-grid summary-grid--three">
              {upcoming.map((booking) => (
                <Link
                  key={booking.id}
                  href={`/cancel/${booking.customerManageToken}`}
                  className="summary-card"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <span>{STATUS_LABELS[booking.status] ?? booking.status}</span>
                  <strong>{booking.service.name}</strong>
                  <p>
                    {formatInTenantTime(booking.startsAt, tenant.timezone)}
                    {" · "}
                    {booking.provider.name}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {past.length > 0 ? (
          <section className="store-section">
            <div className="section-header">
              <div>
                <p className="store-eyebrow">Past</p>
                <h2>{past.length} appointment{past.length === 1 ? "" : "s"}</h2>
              </div>
            </div>
            <div className="summary-grid summary-grid--three">
              {past.map((booking) => (
                <Link
                  key={booking.id}
                  href={`/cancel/${booking.customerManageToken}`}
                  className="summary-card"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <span>{STATUS_LABELS[booking.status] ?? booking.status}</span>
                  <strong>{booking.service.name}</strong>
                  <p>
                    {formatInTenantTime(booking.startsAt, tenant.timezone)}
                    {" · "}
                    {booking.provider.name}
                    {booking.balanceDueCents > 0
                      ? ` · ${formatCurrency(booking.balanceDueCents)} due`
                      : booking.amountPaidCents > 0
                        ? ` · ${formatCurrency(booking.amountPaidCents)} paid`
                        : ""}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {bookings.length === 0 ? (
          <section className="store-section">
            <div className="section-header">
              <div>
                <h2>No appointments yet</h2>
              </div>
            </div>
            <p style={{ color: "var(--ui-ink-soft)" }}>
              When you book an appointment with {tenant.name}, it will appear here. You can manage each appointment from its private link.
            </p>
          </section>
        ) : null}

        <section className="support-panel">
          <div>
            <p className="store-eyebrow">View a specific appointment</p>
            <h3>Back to your booking.</h3>
          </div>
          <Link href={`/cancel/${token}`} className="ghost-link">
            Manage this appointment
          </Link>
        </section>
      </main>
    );
  } catch (error) {
    if (isNextNavigationSignal(error)) {
      throw error;
    }

    if (isApiNotFoundError(error)) {
      notFound();
    }

    const detail = isApiClientError(error) ? error.message : "The booking history could not be loaded.";

    return (
      <main className="manage-page page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Booking history unavailable</p>
          <h1>We could not load your appointments.</h1>
          <p>{detail}</p>
        </section>
      </main>
    );
  }
}
