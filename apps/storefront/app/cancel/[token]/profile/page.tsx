import Link from "next/link";
import { notFound } from "next/navigation";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../lib/storefront-api";
import { formatCurrency, formatInTenantTime, slugify } from "../../../lib/storefront-shell";

type ProfileRouteProps = {
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

const PAYMENT_LABELS: Record<string, string> = {
  succeeded: "Paid",
  refunded: "Refunded",
  failed: "Failed",
  pending: "Pending",
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  stripe: "Credit card (online)",
  card: "Credit card (in-person)",
  cash: "Cash",
  manual: "Manual",
  external_pos: "External POS",
  no_show_fee: "No-show fee",
};

function paymentMethodLabel(paymentMethodType: string): string {
  return PAYMENT_METHOD_LABELS[paymentMethodType] ?? paymentMethodType;
}

function paymentLabel(p: { status: string; depositStatus: string; paymentMethodType: string }): string {
  if (p.depositStatus === "refunded") return "Refunded";
  if (p.depositStatus === "forfeited") return "Forfeited";
  if (p.status === "succeeded") return paymentMethodLabel(p.paymentMethodType);
  return PAYMENT_LABELS[p.status] ?? p.status;
}

export default async function CustomerProfilePage({ params }: ProfileRouteProps) {
  const { token } = await params;

  try {
    const [manageBooking, bookingList] = await Promise.all([
      storefrontApi.getManageBooking(token),
      storefrontApi.listCustomerBookings(token),
    ]);

    const { booking, tenant } = manageBooking;
    const bookings = bookingList.items;
    const now = new Date();

    const upcoming = bookings.filter((b) => b.status === "confirmed" && new Date(b.startsAt) >= now);
    const past = bookings.filter((b) => b.status !== "confirmed" || new Date(b.startsAt) < now);

    // Collect all payments across all bookings
    const allPayments = bookings.flatMap((b) =>
      (b.payments ?? []).map((p) => ({ ...p, bookingServiceName: b.service.name, bookingStartsAt: b.startsAt }))
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return (
      <main className="manage-page page-stack">
        <section className="state-panel state-panel--manage">
          <p className="store-eyebrow">Your profile</p>
          <h1>{booking.customer.name}</h1>
          <p>
            {bookings.length === 0
              ? "No appointments yet."
              : `${bookings.length} appointment${bookings.length === 1 ? "" : "s"}`}
          </p>
        </section>

        <section className="store-section">
          <div className="section-header">
            <div>
              <p className="store-eyebrow">Contact</p>
              <h2>Your information</h2>
            </div>
          </div>
          <div className="summary-grid summary-grid--three">
            <article className="summary-card">
              <span>Name</span>
              <strong>{booking.customer.name}</strong>
            </article>
            {booking.customer.email ? (
              <article className="summary-card">
                <span>Email</span>
                <strong>{booking.customer.email}</strong>
              </article>
            ) : null}
            {booking.customer.phone ? (
              <article className="summary-card">
                <span>Phone</span>
                <strong>{booking.customer.phone}</strong>
              </article>
            ) : null}
          </div>
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
              {upcoming.map((b) => (
                <Link
                  key={b.id}
                  href={`/cancel/${b.customerManageToken}`}
                  className="summary-card"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <span>{STATUS_LABELS[b.status] ?? b.status}</span>
                  <strong>{b.service.name}</strong>
                  <p>
                    {formatInTenantTime(b.startsAt, tenant.timezone)}
                    {" · "}
                    {b.provider.name}
                    {b.balanceDueCents > 0
                      ? ` · ${formatCurrency(b.balanceDueCents)} due`
                      : b.amountPaidCents > 0
                        ? ` · ${formatCurrency(b.amountPaidCents)} paid`
                        : ""}
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
              {past.map((b) => (
                <Link
                  key={b.id}
                  href={`/cancel/${b.customerManageToken}`}
                  className="summary-card"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <span>{STATUS_LABELS[b.status] ?? b.status}</span>
                  <strong>{b.service.name}</strong>
                  <p>
                    {formatInTenantTime(b.startsAt, tenant.timezone)}
                    {" · "}
                    {b.provider.name}
                    {b.balanceDueCents > 0
                      ? ` · ${formatCurrency(b.balanceDueCents)} due`
                      : b.amountPaidCents > 0
                        ? ` · ${formatCurrency(b.amountPaidCents)} paid`
                        : ""}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {allPayments.length > 0 ? (
          <section className="store-section">
            <div className="section-header">
              <div>
                <p className="store-eyebrow">Payment history</p>
                <h2>{allPayments.length} payment{allPayments.length === 1 ? "" : "s"}</h2>
              </div>
            </div>
            <div className="summary-grid summary-grid--three">
              {allPayments.map((p) => (
                <article key={p.id} className="summary-card">
                  <span>{paymentLabel(p)}</span>
                  <strong>{formatCurrency(p.amountCents)}</strong>
                  <p>
                    {p.bookingServiceName}
                    {" · "}
                    {formatInTenantTime(p.bookingStartsAt, tenant.timezone)}
                  </p>
                </article>
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
              When you book an appointment with {tenant.name}, it will appear here.
            </p>
          </section>
        ) : null}

        <section className="support-panel">
          <div>
            <p className="store-eyebrow">Need another appointment?</p>
            <h3>Book again with {tenant.name}.</h3>
          </div>
          <div className="hero-actions">
            <Link href={`/cancel/${token}`} className="ghost-link">
              Back to appointment
            </Link>
            <Link href={`/${tenant.slug}/services/${slugify(booking.service.name)}`} className="store-button">
              Book another visit
            </Link>
          </div>
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

    const detail = isApiClientError(error) ? error.message : "Your profile could not be loaded.";

    return (
      <main className="manage-page page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Profile unavailable</p>
          <h1>We could not load your profile.</h1>
          <p>{detail}</p>
        </section>
      </main>
    );
  }
}
