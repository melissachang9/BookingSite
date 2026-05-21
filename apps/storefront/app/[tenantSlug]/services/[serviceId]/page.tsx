import Link from "next/link";
import { notFound } from "next/navigation";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../lib/storefront-api";
import {
  formatCurrency,
  formatDuration,
  isoDateForTimeZone,
  isoDateFromValueInTimeZone,
  pathWithQuery,
  slugify,
} from "../../../lib/storefront-shell";

type ServicePageProps = {
  params: Promise<{ tenantSlug: string; serviceId: string }>;
  searchParams: Promise<{ error?: string; locationId?: string; screening?: string }>;
};

export const dynamic = "force-dynamic";

export default async function ServiceRoutePage({ params, searchParams }: ServicePageProps) {
  const { tenantSlug, serviceId } = await params;
  const { error, locationId, screening } = await searchParams;

  try {
    const [tenant, serviceResponse, locationResponse] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.listServices(tenantSlug),
      storefrontApi.listLocations(tenantSlug),
    ]);
    const service = serviceResponse.services.find(
      (entry) => entry.id === serviceId || slugify(entry.name) === serviceId,
    );

    if (!service) {
      notFound();
    }

    const activeLocations = locationResponse.locations.filter((location) => location.isActive);
    const selectedLocation = locationId ? activeLocations.find((location) => location.id === locationId) : undefined;
    if (locationId && (!selectedLocation || !service.locationIds.includes(locationId))) {
      notFound();
    }

    const availabilityPath = `/${tenantSlug}/services/${slugify(service.name)}/availability`;
    const selectionQuery = { locationId: selectedLocation?.id, screening };
    const providerStepNumber = (screening ? 1 : 0) + (selectedLocation ? 1 : 0) + 2;
    const today = isoDateForTimeZone(tenant.timezone);
    const [providerResponse, noPreferenceAvailability] = await Promise.all([
      storefrontApi.listServiceProviders(tenantSlug, service.id, { locationId: selectedLocation?.id }),
      storefrontApi.getAvailability({
        tenantSlug,
        serviceId: service.id,
        locationId: selectedLocation?.id,
        date: today,
        windowDays: 31,
      }),
    ]);
    const providersWithAvailability = await Promise.all(
      providerResponse.providers.map(async (provider) => {
        const availability = await storefrontApi.getAvailability({
          tenantSlug,
          serviceId: service.id,
          providerId: provider.id,
          locationId: selectedLocation?.id,
          date: today,
          windowDays: 31,
        });
        return { provider, availability };
      }),
    );
    const nextAvailabilityHref = (slotStartAt: string | undefined, providerId?: string) => {
      if (!slotStartAt) {
        return pathWithQuery(availabilityPath, { ...selectionQuery, providerId });
      }

      const nextDate = isoDateFromValueInTimeZone(slotStartAt, tenant.timezone);
      return pathWithQuery(availabilityPath, {
        ...selectionQuery,
        providerId,
        month: nextDate.slice(0, 7),
        date: nextDate,
      });
    };

    return (
      <main className="page-stack">
        <section className="booking-intro booking-intro--compact">
          <div>
            <Link href={pathWithQuery(`/${tenantSlug}/services`, selectionQuery)} className="back-link">
              Services
            </Link>
            <p className="store-eyebrow">Provider preference</p>
            <h2>{service.name}</h2>
            <p>{service.description ?? "Choose who you would like to see, or let the studio match you with the earliest opening."}</p>
          </div>
          <dl className="summary-list booking-summary-list">
            <div>
              <dt>Duration</dt>
              <dd>{formatDuration(service.durationMinutes)}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{formatCurrency(service.priceCents)}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{selectedLocation?.name ?? "Any available"}</dd>
            </div>
          </dl>
        </section>

        {error === "slot-unavailable" ? (
          <section className="status-banner" aria-live="polite">
            <strong>That opening is no longer available.</strong>
            <span>Please choose another time.</span>
          </section>
        ) : null}

        <section className="store-section">
          <div className="section-header">
            <div>
              <p className="store-eyebrow">Step {providerStepNumber}</p>
              <h2>Choose your provider preference</h2>
            </div>
            <span className="panel-badge">{providerResponse.providers.length} providers</span>
          </div>

          <div className="provider-grid">
            <article className="provider-card provider-card--featured">
              <div>
                <p className="store-eyebrow">Recommended</p>
                <h3>No preference</h3>
                <p>Show all available providers and choose the time that works best.</p>
              </div>
              <div className="provider-card__meta">
                <span>{noPreferenceAvailability.nextAvailableSlot ? "Next opening available" : "No openings in this window"}</span>
                <strong>{noPreferenceAvailability.days.reduce((total, day) => total + day.slotCount, 0)} openings</strong>
              </div>
              <div className="provider-card__actions">
                {noPreferenceAvailability.nextAvailableSlot ? (
                  <Link href={nextAvailabilityHref(noPreferenceAvailability.nextAvailableSlot.startAt)} className="card-action">
                    Show next availability
                  </Link>
                ) : null}
                <Link href={pathWithQuery(availabilityPath, selectionQuery)} className="ghost-link">
                  View monthly calendar
                </Link>
              </div>
            </article>

            {providersWithAvailability.map(({ provider, availability }) => (
              <article key={provider.id} className="provider-card">
                <div>
                  <p className="store-eyebrow">Provider</p>
                  <h3>{provider.name}</h3>
                  <p>{selectedLocation ? selectedLocation.name : `${provider.locationIds.length} location${provider.locationIds.length === 1 ? "" : "s"} available`}.</p>
                </div>
                <div className="provider-card__meta">
                  <span>{availability.nextAvailableSlot ? "Next opening available" : "No openings in this window"}</span>
                  <strong>{availability.days.reduce((total, day) => total + day.slotCount, 0)} openings</strong>
                </div>
                <div className="provider-card__actions">
                  {availability.nextAvailableSlot ? (
                    <Link href={nextAvailabilityHref(availability.nextAvailableSlot.startAt, provider.id)} className="card-action">
                      Show next availability
                    </Link>
                  ) : null}
                  <Link href={pathWithQuery(availabilityPath, { ...selectionQuery, providerId: provider.id })} className="ghost-link">
                    View monthly calendar
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    );
  } catch (error) {
    if (isApiNotFoundError(error)) {
      notFound();
    }

    const detail = isApiClientError(error) ? error.message : "This service could not be loaded.";

    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Service unavailable</p>
          <h2>We could not load this service.</h2>
          <p>{detail}</p>
          <Link href={`/${tenantSlug}`} className="ghost-link">
            Back to services
          </Link>
        </section>
      </main>
    );
  }
}
