import Link from "next/link";
import { notFound } from "next/navigation";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../../lib/storefront-api";
import { formatCurrency, formatInTenantTime, slugify, titleFromSlug } from "../../../../lib/storefront-shell";

type BookingSuccessPageProps = {
  params: Promise<{ tenantSlug: string; draftId: string }>;
};

export const dynamic = "force-dynamic";

export default async function BookingSuccessPage({ params }: BookingSuccessPageProps) {
  const { tenantSlug, draftId } = await params;

  try {
    const [tenant, draft] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.getBookingDraft(tenantSlug, draftId),
    ]);

    return (
      <main className="page-stack">
        <section className="state-panel state-panel--success">
          <p className="store-eyebrow">Booking status</p>
          <h2>We are checking your appointment confirmation.</h2>
          <p>When the booking is confirmed, this page will show the final visit details and customer manage link.</p>
          <span className="panel-badge">{draft.status.replaceAll("_", " ")}</span>
        </section>

        <section className="store-section">
          <div className="section-header">
            <div>
              <p className="store-eyebrow">Visit details</p>
              <h2>{draft.service.name}</h2>
            </div>
            <span className="panel-badge">{formatCurrency(draft.priceCents)}</span>
          </div>

          <div className="summary-grid summary-grid--three">
            <article className="summary-card">
              <span>When</span>
              <strong>{formatInTenantTime(draft.startsAt, tenant.timezone)}</strong>
              <p>{tenant.timezone}</p>
            </article>
            <article className="summary-card">
              <span>Provider</span>
              <strong>{draft.provider.name}</strong>
              <p>{draft.locationId ? "Location selected" : "Location to be confirmed"}</p>
            </article>
            <article className="summary-card">
              <span>Deposit</span>
              <strong>{draft.depositCents > 0 ? formatCurrency(draft.depositCents) : "Not required"}</strong>
              <p>Attached to this booking draft.</p>
            </article>
          </div>
        </section>

        <section className="support-panel">
          <div>
            <p className="store-eyebrow">Need a different time?</p>
            <h3>Choose another opening for this service.</h3>
          </div>
          <Link href={`/${tenantSlug}/services/${slugify(draft.service.name)}`} className="ghost-link">
            Back to openings
          </Link>
        </section>
      </main>
    );
  } catch (error) {
    if (isApiNotFoundError(error)) {
      notFound();
    }

    const tenantName = titleFromSlug(tenantSlug);
    const detail = isApiClientError(error) ? error.message : "The confirmation state could not be loaded.";

    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Confirmation unavailable</p>
          <h2>{tenantName}</h2>
          <p>{detail}</p>
        </section>
      </main>
    );
  }
}
