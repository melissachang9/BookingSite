import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BookingSteps } from "../../../../components/booking-steps";
import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../../../lib/storefront-api";
import { findServiceByRouteKey, formatCurrency, formatDuration, pathWithQuery, slugify } from "../../../../lib/storefront-shell";

type AddOnsPageProps = {
  params: Promise<{ tenantSlug: string; serviceId: string }>;
  searchParams: Promise<{
    locationId?: string;
    screening?: string;
    providerId?: string;
    // Chosen add-ons: `addOns=a,b` in links, `addOn=a&addOn=b` from this form.
    addOns?: string;
    addOn?: string | string[];
  }>;
};

export const dynamic = "force-dynamic";

/** The optional extras for the service just chosen, shown before anyone picks a provider. */
export default async function ServiceAddOnsPage({ params, searchParams }: AddOnsPageProps) {
  const { tenantSlug, serviceId } = await params;
  const { locationId, screening, providerId, addOns, addOn } = await searchParams;

  try {
    const [serviceResponse, locationResponse] = await Promise.all([
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
    const baseQuery = { locationId: selectedLocation?.id, screening, providerId };
    const { items: availableAddOns } = await storefrontApi.listServiceAddOns(tenantSlug, service.id);

    // Nothing to offer: straight on to choosing a provider.
    if (availableAddOns.length === 0) {
      redirect(pathWithQuery(servicePath, { ...baseQuery, addOnsDone: "1" }));
    }

    const requestedIds = [
      ...(addOns ? addOns.split(",") : []),
      ...(Array.isArray(addOn) ? addOn : addOn ? [addOn] : []),
    ];
    const selectedIds = new Set(availableAddOns.filter((item) => requestedIds.includes(item.id)).map((item) => item.id));
    const stepNumber = (screening ? 1 : 0) + (selectedLocation ? 1 : 0) + 2;
    const skipHref = pathWithQuery(servicePath, { ...baseQuery, addOnsDone: "1" });

    return (
      <main className="sf-flow">
        <BookingSteps current={1} />

        <section className="sf-addon-step" aria-labelledby="addons-title">
          <header className="sf-head">
            <div>
              <p className="sf-eyebrow">
                Step {stepNumber} · {service.name}
              </p>
              <h1 id="addons-title" className="sf-title sf-title--page">Add to your visit</h1>
              <p className="sf-lead">
                Optional extras for your {service.name}. Their time and price are added to the appointment.
              </p>
            </div>
          </header>

          <form method="get" action={servicePath} className="sf-addon-list">
            {selectedLocation ? <input type="hidden" name="locationId" value={selectedLocation.id} /> : null}
            {screening ? <input type="hidden" name="screening" value={screening} /> : null}
            {providerId ? <input type="hidden" name="providerId" value={providerId} /> : null}
            <input type="hidden" name="addOnsDone" value="1" />

            {availableAddOns.map((item) => (
              <label key={item.id} className="sf-addon-card">
                <input type="checkbox" name="addOn" value={item.id} defaultChecked={selectedIds.has(item.id)} />
                <span className="sf-addon-card__check" aria-hidden="true" />
                <span className="sf-addon-card__text">
                  <strong>{item.name}</strong>
                  {item.description ? <small>{item.description}</small> : null}
                </span>
                <span className="sf-addon-card__terms">
                  <strong>+{formatCurrency(item.priceCents)}</strong>
                  {item.durationMinutes > 0 ? <small>+{formatDuration(item.durationMinutes)}</small> : null}
                </span>
              </label>
            ))}

            <div className="sf-addon-actions">
              <button type="submit" className="sf-btn sf-btn--dark">Continue</button>
              <Link href={skipHref} className="sf-btn">No thanks, skip</Link>
            </div>
          </form>
        </section>
      </main>
    );
  } catch (error) {
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
          <p className="store-eyebrow">Add-ons unavailable</p>
          <h2>We could not load the extras for this service.</h2>
          <p>{detail}</p>
          <Link href={`/${tenantSlug}/services`} className="ghost-link">Back to services</Link>
        </section>
      </main>
    );
  }
}
