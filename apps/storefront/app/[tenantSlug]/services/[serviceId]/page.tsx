import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BookingSteps } from "../../../components/booking-steps";
import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../lib/storefront-api";
import {
  findServiceByRouteKey,
  formatCurrency,
  formatDuration,
  isoDateForTimeZone,
  isoDateFromValueInTimeZone,
  pathWithQuery,
  slugify,
} from "../../../lib/storefront-shell";

type ServicePageProps = {
  params: Promise<{ tenantSlug: string; serviceId: string }>;
  searchParams: Promise<{
    error?: string;
    locationId?: string;
    screening?: string;
    providerId?: string;
    // Set once the add-ons screen has been passed (continued or skipped).
    addOnsDone?: string;
    addOns?: string;
    addOn?: string | string[];
  }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Pick<ServicePageProps, "params">) {
  const { tenantSlug, serviceId } = await params;
  try {
    const { services } = await storefrontApi.listServices(tenantSlug);
    const service = findServiceByRouteKey(services, serviceId);
    if (!service) return {};
    return {
      title: service.name,
      description: service.metaDescription ?? service.onlineBookingDescription ?? service.description ?? undefined,
    };
  } catch {
    return {};
  }
}

const initialsFor = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

export default async function ServiceRoutePage({ params, searchParams }: ServicePageProps) {
  const { tenantSlug, serviceId } = await params;
  const { error, locationId, screening, providerId: preselectedProviderId, addOnsDone, addOns, addOn } = await searchParams;

  try {
    const [tenant, serviceResponse, locationResponse] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.listServices(tenantSlug),
      storefrontApi.listLocations(tenantSlug),
    ]);
    const service = findServiceByRouteKey(serviceResponse.services, serviceId);

    if (!service) {
      notFound();
    }

    const activeLocations = locationResponse.locations.filter((location) => location.isActive);
    const selectedLocation = locationId ? activeLocations.find((location) => location.id === locationId) : undefined;
    if (locationId && (!selectedLocation || !service.locationIds.includes(locationId))) {
      notFound();
    }

    const servicePath = `/${tenantSlug}/services/${slugify(service.name)}`;
    const availabilityPath = `${servicePath}/availability`;

    // Extras are chosen first, on their own screen, before any provider is offered.
    const { items: availableAddOns } = await storefrontApi.listServiceAddOns(tenantSlug, service.id);
    if (availableAddOns.length > 0 && !addOnsDone) {
      redirect(
        pathWithQuery(`${servicePath}/add-ons`, {
          locationId: selectedLocation?.id,
          screening,
          providerId: preselectedProviderId,
        }),
      );
    }
    const requestedAddOnIds = [
      ...(addOns ? addOns.split(",") : []),
      ...(Array.isArray(addOn) ? addOn : addOn ? [addOn] : []),
    ];
    // Only extras this service offers; anything else in the URL is ignored.
    const chosenAddOnIds = availableAddOns.filter((item) => requestedAddOnIds.includes(item.id)).map((item) => item.id);
    const selectionQuery = {
      locationId: selectedLocation?.id,
      screening,
      addOns: chosenAddOnIds.length > 0 ? chosenAddOnIds.join(",") : undefined,
    };
    const providerStepNumber = (screening ? 1 : 0) + (selectedLocation ? 1 : 0) + 2 + (availableAddOns.length > 0 ? 1 : 0);
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
    // Uses the rule after inheritance: the service's own setting, else its category's.
    const selectionMode = service.effectiveProviderSelectionMode ?? service.providerSelectionMode;
    if (selectionMode === "auto_assign" || selectionMode === "hide") {
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

    const openingLabel = (startAt: string | undefined, withTime: boolean) => {
      if (!startAt) {
        return null;
      }
      const day = new Intl.DateTimeFormat("en-GB", {
        timeZone: tenant.timezone,
        weekday: "short",
        day: "numeric",
        month: "short",
      })
        .format(new Date(startAt))
        .replace(",", "");
      if (!withTime) {
        return day;
      }
      const time = new Intl.DateTimeFormat("en-US", {
        timeZone: tenant.timezone,
        hour: "numeric",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(startAt));
      return `${day}, ${time.replace(/^0/, "")}`;
    };
    const anyoneOpening = openingLabel(noPreferenceAvailability.nextAvailableSlot?.startAt, true);

    return (
      <main className="sf-flow">
        <BookingSteps current={2} />

        {error === "slot-unavailable" ? (
          <section className="status-banner" aria-live="polite">
            <strong>That opening is no longer available.</strong>
            <span>Please choose another time.</span>
          </section>
        ) : null}

        <section className="sf-provider-step" aria-labelledby="provider-title">
          <header className="sf-head">
            <div>
              <p className="sf-eyebrow">
                Step {providerStepNumber} · {service.name}
              </p>
              <h1 id="provider-title" className="sf-title sf-title--page">Choose your provider</h1>
              <p className="sf-lead">
                {service.onlineBookingDescription ??
                  "Choose who you'd like to see, or let the studio match you with the earliest opening."}
              </p>
              {service.scarcityHint ? <p className="sf-note">{service.scarcityHint}</p> : null}
            </div>
          </header>

          <div className="sf-providers">
            <Link
              href={nextAvailabilityHref(noPreferenceAvailability.nextAvailableSlot?.startAt)}
              className="sf-provider sf-provider--featured"
              aria-label="Choose anyone"
            >
              <span className="sf-provider__tile sf-provider__tile--any" aria-hidden="true">
                Any
              </span>
              <span className="sf-provider__copy">
                <strong>Anyone</strong>
                <small>
                  All providers{anyoneOpening ? ` · earliest opening ${anyoneOpening}` : " · no openings in this window"}
                </small>
              </span>
              <span className="sf-provider__price">{servicePriceLabel}</span>
            </Link>

            {providersWithAvailability.map(({ provider, availability }) => {
              const providerHref = nextAvailabilityHref(availability.nextAvailableSlot?.startAt, provider.id);
              const locationLabel = selectedLocation
                ? selectedLocation.name
                : `${provider.locationIds.length} location${provider.locationIds.length === 1 ? "" : "s"} available`;
              const nextOpening = openingLabel(availability.nextAvailableSlot?.startAt, false);
              const subtitle = [
                provider.availabilityLabel ?? locationLabel,
                nextOpening ? `next opening ${nextOpening}` : "no openings in this window",
              ].join(" · ");

              return (
                <Link key={provider.id} href={providerHref} className="sf-provider" aria-label={`Choose ${provider.name}`}>
                  {provider.imageUrl ? (
                    <img src={provider.imageUrl} alt={provider.imageAltText ?? provider.name} className="sf-provider__tile sf-provider__tile--image" />
                  ) : (
                    <span className="sf-provider__tile" aria-hidden="true">
                      {initialsFor(provider.name)}
                    </span>
                  )}
                  <span className="sf-provider__copy">
                    <strong>{provider.name}</strong>
                    <small>{subtitle}</small>
                    {provider.description ? <span>{provider.description}</span> : null}
                  </span>
                  <span className="sf-provider__price">{servicePriceLabel}</span>
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
