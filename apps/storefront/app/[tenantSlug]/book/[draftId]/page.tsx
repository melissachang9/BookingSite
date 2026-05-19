import Link from "next/link";
import { notFound } from "next/navigation";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../lib/storefront-api";
import {
  bookingJourney,
  formatCurrency,
  formatDuration,
  formatExpiryWindow,
  formatInTenantTime,
  slugify,
  titleFromSlug,
} from "../../../lib/storefront-shell";

type BookingDraftPageProps = {
  params: Promise<{ tenantSlug: string; draftId: string }>;
};

export const dynamic = "force-dynamic";

export default async function BookingDraftPage({ params }: BookingDraftPageProps) {
  const { tenantSlug, draftId } = await params;

  try {
    const [tenant, draft] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.getBookingDraft(tenantSlug, draftId),
    ]);
    const activeState = draft.status;
    const pendingRequirements = draft.formRequirements.filter((requirement) => requirement.status === "pending");

    return (
      <main className="page-stack">
        <section className="checkout-hero">
          <div>
            <p className="store-eyebrow">Appointment review</p>
            <h2>{draft.service.name}</h2>
            <p>
              Your selected time is being held while booking details and required pre-visit steps are completed.
            </p>
          </div>
          <aside className="hold-card">
            <span>Hold expires</span>
            <strong>{formatExpiryWindow(draft.expiresAt)}</strong>
            <p>{formatInTenantTime(draft.expiresAt, tenant.timezone)} in {tenant.timezone}</p>
          </aside>
        </section>

        <section className="checkout-layout">
          <div className="checkout-main">
            <section className="store-section">
              <div className="section-header">
                <div>
                  <p className="store-eyebrow">Booking details</p>
                  <h2>Review your visit</h2>
                </div>
                <span className="panel-badge">{draft.status.replaceAll("_", " ")}</span>
              </div>

              <div className="summary-grid">
                <article className="summary-card">
                  <span>Provider</span>
                  <strong>{draft.provider.name}</strong>
                  <p>{formatDuration(draft.durationMinutes)}</p>
                </article>
                <article className="summary-card">
                  <span>When</span>
                  <strong>{formatInTenantTime(draft.startsAt, tenant.timezone)}</strong>
                  <p>{tenant.timezone}</p>
                </article>
                <article className="summary-card">
                  <span>Payment</span>
                  <strong>{draft.depositCents > 0 ? `${formatCurrency(draft.depositCents)} deposit` : "No deposit"}</strong>
                  <p>Total service value {formatCurrency(draft.priceCents)}</p>
                </article>
                <article className="summary-card">
                  <span>Contact</span>
                  <strong>{draft.customer?.name ?? "Contact details needed"}</strong>
                  <p>{draft.customer?.email ?? "Email will be attached to this appointment."}</p>
                </article>
              </div>
            </section>

            <section className="store-section">
              <div className="section-header">
                <div>
                  <p className="store-eyebrow">Required intake</p>
                  <h2>Forms and consent</h2>
                </div>
                <span className="panel-badge">{pendingRequirements.length} pending</span>
              </div>

              {draft.formRequirements.length > 0 ? (
                <div className="requirement-grid">
                  {draft.formRequirements.map((requirement) => (
                    <article key={requirement.id} className="requirement-card">
                      <span>{requirement.customerPromptTiming?.replaceAll("_", " ") ?? requirement.scope}</span>
                      <strong>{requirement.status.replaceAll("_", " ")}</strong>
                      <p>Version {requirement.formVersionId}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-panel empty-panel--compact">
                  <strong>No intake forms are required for this service.</strong>
                  <span>You can continue to payment once contact details are complete.</span>
                </div>
              )}
            </section>
          </div>

          <aside className="checkout-rail">
            <section className="payment-card">
              <p className="store-eyebrow">Due now</p>
              <strong>{draft.depositCents > 0 ? formatCurrency(draft.depositCents) : "$0"}</strong>
              <span>{draft.depositCents > 0 ? "Deposit required to confirm" : "Deposit not required"}</span>
              <button type="button" disabled>
                Continue to payment
              </button>
            </section>

            <section className="stepper-card" aria-label="Booking progress">
              {bookingJourney.map((step, index) => (
                <article key={step.state} className={step.state === activeState ? "stepper-item stepper-item--active" : "stepper-item"}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <p>{step.detail}</p>
                  </div>
                </article>
              ))}
            </section>

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
    const detail = isApiClientError(error) ? error.message : "The booking draft could not be loaded.";

    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Booking unavailable</p>
          <h2>{tenantName}</h2>
          <p>{detail}</p>
        </section>
      </main>
    );
  }
}
