import Link from "next/link";
import { notFound } from "next/navigation";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../../lib/storefront-api";
import { formatCurrency, formatExpiryWindow, formatInTenantTime, slugify, titleFromSlug } from "../../../../lib/storefront-shell";
import { completeDepositCheckoutAction } from "../actions";

type BookingPaymentPageProps = {
  params: Promise<{ tenantSlug: string; draftId: string }>;
  searchParams: Promise<{ sessionId?: string }>;
};

export const dynamic = "force-dynamic";

export default async function BookingPaymentPage({ params, searchParams }: BookingPaymentPageProps) {
  const [{ tenantSlug, draftId }, { sessionId }] = await Promise.all([params, searchParams]);

  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Payment unavailable</p>
          <h2>Checkout session missing</h2>
          <p>Return to the booking review page and restart payment.</p>
        </section>
      </main>
    );
  }

  try {
    const [tenant, draft] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.getBookingDraft(tenantSlug, draftId),
    ]);

    return (
      <main className="page-stack">
        <section className="checkout-hero">
          <div>
            <p className="store-eyebrow">Checkout step</p>
            <h2>{draft.service.name}</h2>
            <p>Your slot stays reserved while the deposit checkout step is completed for this appointment.</p>
          </div>
          <aside className="hold-card">
            <span>Checkout expires</span>
            <strong>{formatExpiryWindow(draft.expiresAt)}</strong>
            <p>{formatInTenantTime(draft.expiresAt, tenant.timezone)} in {tenant.timezone}</p>
          </aside>
        </section>

        <section className="checkout-layout">
          <div className="checkout-main">
            <section className="store-section">
              <div className="section-header">
                <div>
                  <p className="store-eyebrow">Payment summary</p>
                  <h2>Deposit due today</h2>
                </div>
                <span className="panel-badge">Payment step</span>
              </div>

              <div className="summary-grid">
                <article className="summary-card">
                  <span>Service</span>
                  <strong>{draft.service.name}</strong>
                  <p>{formatCurrency(draft.priceCents)} total service value</p>
                </article>
                <article className="summary-card">
                  <span>Deposit</span>
                  <strong>{formatCurrency(draft.depositCents)}</strong>
                  <p>Required now to confirm the visit.</p>
                </article>
                <article className="summary-card">
                  <span>When</span>
                  <strong>{formatInTenantTime(draft.startsAt, tenant.timezone)}</strong>
                  <p>{tenant.timezone}</p>
                </article>
                <article className="summary-card">
                  <span>Contact</span>
                  <strong>{draft.customer?.name ?? "Contact details needed"}</strong>
                  <p>{draft.customer?.email ?? "Email will be attached to this appointment."}</p>
                </article>
              </div>
            </section>
          </div>

          <aside className="checkout-rail">
            <section className="payment-card">
              <p className="store-eyebrow">Charge today</p>
              <strong>{formatCurrency(draft.depositCents)}</strong>
              <span>Finish this deposit step to confirm the appointment.</span>
              <div className="payment-handoff-note">
                <strong>Confirmation</strong>
                <p>Your appointment will be confirmed as soon as this payment step finishes successfully.</p>
              </div>
              <form action={completeDepositCheckoutAction}>
                <input type="hidden" name="tenantSlug" value={tenantSlug} />
                <input type="hidden" name="bookingDraftId" value={draft.id} />
                <input type="hidden" name="sessionId" value={sessionId} />
                <button type="submit">Pay deposit</button>
              </form>
            </section>

            <Link href={`/${tenantSlug}/book/${draftId}`} className="ghost-link">
              Return to booking review
            </Link>
            <Link href={`/${tenantSlug}/services/${slugify(draft.service.name)}`} className="ghost-link">
              Choose another time
            </Link>
          </aside>
        </section>
      </main>
    );
  } catch (error) {
    if (isApiNotFoundError(error)) {
      notFound();
    }

    const tenantName = titleFromSlug(tenantSlug);
    const detail = isApiClientError(error) ? error.message : "The payment page could not be loaded.";

    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Payment unavailable</p>
          <h2>{tenantName}</h2>
          <p>{detail}</p>
        </section>
      </main>
    );
  }
}