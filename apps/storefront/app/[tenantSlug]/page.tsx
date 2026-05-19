import Link from "next/link";
import { notFound } from "next/navigation";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../lib/storefront-api";
import { bookingJourney, formatCurrency, formatDuration, slugify, titleFromSlug } from "../lib/storefront-shell";

type TenantPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export const dynamic = "force-dynamic";

export default async function TenantHomePage({ params }: TenantPageProps) {
  const { tenantSlug } = await params;

  try {
    const [tenant, serviceResponse] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.listServices(tenantSlug),
    ]);
    const services = serviceResponse.services;
    const startingPrice = services.length > 0 ? Math.min(...services.map((service) => service.priceCents)) : 0;

    return (
      <main className="page-stack">
        <section className="studio-hero studio-hero--tenant">
          <div className="studio-hero__copy">
            <p className="store-eyebrow">Online booking</p>
            <h2>Reserve your appointment at {tenant.name}.</h2>
            <p>
              Choose a service, review the studio policy, and select from live openings in {tenant.timezone}.
            </p>
            <div className="hero-actions">
              <a href="#services" className="store-button">
                View services
              </a>
              {tenant.branding.homepageUrl ? (
                <a href={tenant.branding.homepageUrl} target="_blank" rel="noreferrer" className="ghost-link ghost-link--light">
                  Studio website
                </a>
              ) : null}
            </div>
          </div>
        </section>

        <section className="policy-strip" aria-label="Studio booking policy">
          <article className="policy-card">
            <span>Booking window</span>
            <p>{tenant.settings.maxAdvanceBookingDays} days ahead</p>
          </article>
          <article className="policy-card">
            <span>Minimum lead time</span>
            <p>{tenant.settings.minLeadTimeMinutes} minutes</p>
          </article>
          <article className="policy-card">
            <span>Cancellation window</span>
            <p>{tenant.settings.cancellationWindowHours} hours</p>
          </article>
          <article className="policy-card">
            <span>Starting at</span>
            <p>{startingPrice > 0 ? formatCurrency(startingPrice) : "Catalog pending"}</p>
          </article>
        </section>

        <section id="services" className="store-section">
          <div className="section-header">
            <div>
              <p className="store-eyebrow">Service menu</p>
              <h2>Select a service</h2>
            </div>
            <span className="panel-badge">{services.length} active</span>
          </div>

          {services.length > 0 ? (
            <div className="service-grid">
              {services.map((service) => (
                <article key={service.id} className="service-card">
                  <div className="service-card__topline">
                    <span>{formatDuration(service.durationMinutes)}</span>
                    <strong>{formatCurrency(service.priceCents)}</strong>
                  </div>
                  <h3>{service.name}</h3>
                  <p>{service.description ?? "Personalized studio service with live appointment availability."}</p>
                  <dl className="meta-list">
                    <div>
                      <dt>Deposit</dt>
                      <dd>{service.depositCents > 0 ? formatCurrency(service.depositCents) : "Not required"}</dd>
                    </div>
                    <div>
                      <dt>Forms</dt>
                      <dd>{service.formIds.length}</dd>
                    </div>
                    <div>
                      <dt>Locations</dt>
                      <dd>{service.locationIds.length || 1}</dd>
                    </div>
                  </dl>
                  <Link href={`/${tenantSlug}/services/${slugify(service.name)}`} className="card-action">
                    View openings
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-panel">
              <strong>No services are available for online booking.</strong>
              <span>Contact the studio directly for current availability.</span>
            </div>
          )}
        </section>

        <section className="journey-rail" aria-label="Booking progress">
          {bookingJourney.slice(0, 4).map((step, index) => (
            <article key={step.state} className="journey-step">
              <span>{index + 1}</span>
              <div>
                <strong>{step.label}</strong>
                <p>{step.detail}</p>
              </div>
            </article>
          ))}
        </section>
      </main>
    );
  } catch (error) {
    if (isApiNotFoundError(error)) {
      notFound();
    }

    const tenantName = titleFromSlug(tenantSlug);
    const detail = isApiClientError(error) ? error.message : "The studio booking page could not load.";

    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Storefront unavailable</p>
          <h2>{tenantName}</h2>
          <p>{detail}</p>
        </section>
      </main>
    );
  }
}
