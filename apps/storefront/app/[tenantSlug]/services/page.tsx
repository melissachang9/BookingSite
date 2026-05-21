import Link from "next/link";
import { notFound } from "next/navigation";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../lib/storefront-api";
import { formatCurrency, formatDuration, pathWithQuery, slugify, titleFromSlug } from "../../lib/storefront-shell";

type ServicesPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ locationId?: string; screening?: string }>;
};

export const dynamic = "force-dynamic";

export default async function ServicesPage({ params, searchParams }: ServicesPageProps) {
  const { tenantSlug } = await params;
  const { locationId, screening } = await searchParams;

  try {
    const [tenant, serviceResponse, locationResponse] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.listServices(tenantSlug),
      storefrontApi.listLocations(tenantSlug),
    ]);
    const activeLocations = locationResponse.locations.filter((location) => location.isActive);
    const selectedLocation = locationId ? activeLocations.find((location) => location.id === locationId) : activeLocations[0];

    if (locationId && !selectedLocation) {
      notFound();
    }

    const services = selectedLocation
      ? serviceResponse.services.filter((service) => service.locationIds.length === 0 || service.locationIds.includes(selectedLocation.id))
      : serviceResponse.services;
    const bookingAd = tenant.branding.bookingAd;
    const locationStepHref = pathWithQuery(`/${tenantSlug}/locations`, { screening });
    const serviceStepNumber = (screening ? 1 : 0) + (activeLocations.length > 1 ? 1 : 0) + 1;

    return (
      <main className="service-selection-layout">
        <section className="service-selection-panel">
          <div className="section-header section-header--plain">
            <div>
              <Link href={activeLocations.length > 1 ? locationStepHref : `/${tenantSlug}`} className="back-link">
                {activeLocations.length > 1 ? "Locations" : "Start"}
              </Link>
              <p className="store-eyebrow">Step {serviceStepNumber}</p>
              <h2>Select a service</h2>
              <p>{selectedLocation ? selectedLocation.name : tenant.name}</p>
            </div>
            <span className="panel-badge">{services.length} services</span>
          </div>

          {services.length > 0 ? (
            <div className="service-list service-list--stacked">
              {services.map((service) => (
                <article key={service.id} className="service-row-card">
                  {service.imageUrl ? (
                    <img src={service.imageUrl} alt={service.imageAltText ?? service.name} className="service-row-card__image" />
                  ) : (
                    <span className="service-row-card__placeholder" aria-hidden="true">
                      {service.name.charAt(0)}
                    </span>
                  )}
                  <div className="service-row-card__body">
                    <div className="service-card__topline">
                      <span>{formatDuration(service.durationMinutes)}</span>
                      <strong>{formatCurrency(service.priceCents)}</strong>
                    </div>
                    <h3>{service.name}</h3>
                    <p>{service.description ?? "Personalized studio service with live appointment availability."}</p>
                    <div className="service-row-card__meta">
                      <span>{service.depositCents > 0 ? `${formatCurrency(service.depositCents)} deposit` : "No deposit"}</span>
                      <span>{service.formIds.length} forms</span>
                    </div>
                  </div>
                  <Link
                    href={pathWithQuery(`/${tenantSlug}/services/${slugify(service.name)}`, {
                      locationId: selectedLocation?.id,
                      screening,
                    })}
                    className="card-action service-row-card__action"
                  >
                    Choose service
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-panel">
              <strong>No services are available for this location.</strong>
              <span>Choose another location or contact the studio directly.</span>
            </div>
          )}
        </section>

        <aside className="booking-ad-panel booking-ad-panel--service" aria-label="Studio highlight">
          {bookingAd?.imageUrl ? <img src={bookingAd.imageUrl} alt={bookingAd.imageAltText ?? tenant.name} /> : null}
          <div>
            <strong>{bookingAd?.headline ?? tenant.name}</strong>
            {bookingAd?.body ? <p>{bookingAd.body}</p> : null}
          </div>
        </aside>
      </main>
    );
  } catch (error) {
    if (isApiNotFoundError(error)) {
      notFound();
    }

    const tenantName = titleFromSlug(tenantSlug);
    const detail = isApiClientError(error) ? error.message : "Services could not be loaded.";

    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Services unavailable</p>
          <h2>{tenantName}</h2>
          <p>{detail}</p>
        </section>
      </main>
    );
  }
}
