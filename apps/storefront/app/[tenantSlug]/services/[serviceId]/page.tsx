import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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
  searchParams: Promise<{ error?: string; locationId?: string; screening?: string; providerId?: string }>;
};

export const dynamic = "force-dynamic";

const initialsFor = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

export default async function ServiceRoutePage({ params, searchParams }: ServicePageProps) {
  const { tenantSlug, serviceId } = await params;
  const { error, locationId, screening, providerId: preselectedProviderId } = await searchParams;

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

    // If a specific provider was pre-selected (via direct booking link),
    // skip the provider chooser and jump straight to their availability.
    if (preselectedProviderId) {
      const providerListForCheck = await storefrontApi.listServiceProviders(
        tenantSlug,
        service.id,
        { locationId: selectedLocation?.id },
      );
      const matched = providerListForCheck.providers.find((p) => p.id === preselectedProviderId);
      if (matched) {
        const preselectedAvailability = await storefrontApi.getAvailability({
          tenantSlug,
          serviceId: service.id,
          providerId: matched.id,
          locationId: selectedLocation?.id,
          date: today,
          windowDays: 31,
        });
        const nextSlot = preselectedAvailability.nextAvailableSlot?.startAt;
        const nextDate = nextSlot
          ? isoDateFromValueInTimeZone(nextSlot, tenant.timezone)
          : undefined;
        redirect(
          pathWithQuery(availabilityPath, {
            ...selectionQuery,
            providerId: matched.id,
            month: nextDate ? nextDate.slice(0, 7) : undefined,
            date: nextDate,
          }),
        );
      }
    }

    // If the service is configured to auto-assign or hide provider selection,
    // skip the provider chooser and go straight to availability.
    if (service.providerSelectionMode === "auto_assign" || service.providerSelectionMode === "hide") {
      const noPrefAvailability = await storefrontApi.getAvailability({
        tenantSlug,
        serviceId: service.id,
        locationId: selectedLocation?.id,
        date: today,
        windowDays: 31,
      });
      const nextSlot = noPrefAvailability.nextAvailableSlot?.startAt;
      const nextDate = nextSlot
        ? isoDateFromValueInTimeZone(nextSlot, tenant.timezone)
        : undefined;
      redirect(
        pathWithQuery(availabilityPath, {
          ...selectionQuery,
          month: nextDate ? nextDate.slice(0, 7) : undefined,
          date: nextDate,
        }),
      );
    }

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
    const servicePriceLabel = formatCurrency(service.priceCents);

    return (
      <main className="page-stack">
        <section className="booking-intro booking-intro--compact booking-intro--service">
          <div>
            <Link href={pathWithQuery(`/${tenantSlug}/services`, selectionQuery)} className="back-link">
              Services
            </Link>
            <p className="store-eyebrow">Provider preference</p>
            <h2>{service.name}</h2>
          </div>
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
              <p className="booking-entry-intro">Choose who you would like to see, or let the studio match you with the earliest opening.</p>
            </div>
            <span className="panel-badge">{providerResponse.providers.length} providers</span>
          </div>

          <div className="provider-choice-list">
            <Link
              href={nextAvailabilityHref(noPreferenceAvailability.nextAvailableSlot?.startAt)}
              className="provider-choice-row provider-choice-row--featured"
              aria-label="Choose anyone"
            >
              <span className="provider-choice-avatar provider-choice-avatar--any" aria-hidden="true">
                Any
              </span>
              <span className="provider-choice-copy">
                <strong>Anyone</strong>
                <small>All providers</small>
              </span>
              <span className="provider-choice-price">{servicePriceLabel}</span>
            </Link>

            {providersWithAvailability.map(({ provider, availability }) => {
              const providerHref = nextAvailabilityHref(availability.nextAvailableSlot?.startAt, provider.id);
              const locationLabel = selectedLocation
                ? selectedLocation.name
                : `${provider.locationIds.length} location${provider.locationIds.length === 1 ? "" : "s"} available`;

              return (
                <Link key={provider.id} href={providerHref} className="provider-choice-row" aria-label={`Choose ${provider.name}`}>
                  {provider.imageUrl ? (
                    <img src={provider.imageUrl} alt={provider.imageAltText ?? provider.name} className="provider-choice-avatar" />
                  ) : (
                    <span className="provider-choice-avatar" aria-hidden="true">
                      {initialsFor(provider.name)}
                    </span>
                  )}
                  <span className="provider-choice-copy">
                    <strong>{provider.name}</strong>
                    <small>{provider.availabilityLabel ?? locationLabel}</small>
                    {provider.description ? <span>{provider.description}</span> : <span>{availability.nextAvailableSlot ? "Next opening available" : "No openings in this window"}</span>}
                  </span>
                  <span className="provider-choice-price">{servicePriceLabel}</span>
                </Link>
              );
            })}
          </div>
        </section>
      </main>
    );
  } catch (error) {
    // Re-throw Next.js redirect/notFound control-flow errors so they aren't
    // swallowed by the "service unavailable" fallback below.
    const digest = (error as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")) {
      throw error;
    }
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
