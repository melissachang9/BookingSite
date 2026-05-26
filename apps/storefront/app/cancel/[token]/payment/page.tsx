import Link from "next/link";
import { notFound } from "next/navigation";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../lib/storefront-api";
import { formatCurrency, formatInTenantTime } from "../../../lib/storefront-shell";
import { completeManageBookingBalanceCheckoutAction } from "../actions";

type ManageBookingPaymentPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ sessionId?: string }>;
};

export const dynamic = "force-dynamic";

export default async function ManageBookingPaymentPage({ params, searchParams }: ManageBookingPaymentPageProps) {
  const [{ token }, { sessionId }] = await Promise.all([params, searchParams]);

  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Payment unavailable</p>
          <h2>Checkout session missing</h2>
          <p>Return to the private booking link and request a fresh payment link from the studio.</p>
        </section>
      </main>
    );
  }

  try {
    const manageBooking = await storefrontApi.getManageBooking(token);
    const { booking, tenant } = manageBooking;

    return (
      <main className="page-stack">
        <section className="checkout-hero">
          <div>
            <p className="store-eyebrow">Checkout step</p>
            <h2>{booking.service.name}</h2>
            <p>Your private booking link keeps the remaining balance checkout tied to this appointment.</p>
          </div>
          <aside className="hold-card">
            <span>Booking status</span>
            <strong>{booking.status.replaceAll("_", " ")}</strong>
            <p>{formatInTenantTime(booking.startsAt, tenant.timezone)} in {tenant.timezone}</p>
          </aside>
        </section>

        <section className="checkout-layout">
          <div className="checkout-main">
            <section className="store-section">
              <div className="section-header">
                <div>
                  <p className="store-eyebrow">Payment summary</p>
                  <h2>Remaining balance</h2>
                </div>
                <span className="panel-badge">Payment step</span>
              </div>

              <div className="summary-grid">
                <article className="summary-card">
                  <span>Service</span>
                  <strong>{booking.service.name}</strong>
                  <p>{formatCurrency(booking.service.priceCents)} service subtotal</p>
                </article>
                <article className="summary-card">
                  <span>Collected so far</span>
                  <strong>{formatCurrency(booking.amountPaidCents)}</strong>
                  <p>Payments already attached to this appointment.</p>
                </article>
                <article className="summary-card">
                  <span>Balance due</span>
                  <strong>{booking.balanceDueCents > 0 ? formatCurrency(booking.balanceDueCents) : "Resolved"}</strong>
                  <p>{booking.paymentResolution.replaceAll("_", " ")}</p>
                </article>
                <article className="summary-card">
                  <span>When</span>
                  <strong>{formatInTenantTime(booking.startsAt, tenant.timezone)}</strong>
                  <p>{tenant.timezone}</p>
                </article>
              </div>
            </section>
          </div>

          <aside className="checkout-rail">
            <section className="payment-card">
              <p className="store-eyebrow">Charge today</p>
              <strong>{booking.balanceDueCents > 0 ? formatCurrency(booking.balanceDueCents) : "Resolved"}</strong>
              <span>Finish this balance step to attach the payment to your appointment.</span>
              <div className="payment-handoff-note">
                <strong>Confirmation</strong>
                <p>Your private booking link will update as soon as this payment step finishes successfully.</p>
              </div>
              <form action={completeManageBookingBalanceCheckoutAction}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="sessionId" value={sessionId} />
                <button type="submit" disabled={booking.balanceDueCents <= 0}>
                  Pay remaining balance
                </button>
              </form>
            </section>

            <Link href={`/cancel/${token}`} className="ghost-link">
              Return to booking details
            </Link>
          </aside>
        </section>
      </main>
    );
  } catch (error) {
    if (isApiNotFoundError(error)) {
      notFound();
    }

    const detail = isApiClientError(error) ? error.message : "The payment page could not be loaded.";

    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Payment unavailable</p>
          <h2>We could not load this balance checkout.</h2>
          <p>{detail}</p>
        </section>
      </main>
    );
  }
}