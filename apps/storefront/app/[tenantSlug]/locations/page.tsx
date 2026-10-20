import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { LocationSummary, TenantSummary } from "@booking/shared-types";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../lib/storefront-api";
import { formatLocationAddress, pathWithQuery, titleFromSlug } from "../../lib/storefront-shell";

type LocationsPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ screening?: string }>;
};

export const dynamic = "force-dynamic";

export default async function LocationsPage({ params, searchParams }: LocationsPageProps) {
  const { tenantSlug } = await params;
  const { screening } = await searchParams;
  let tenantName = titleFromSlug(tenantSlug);
  let data: { tenant: TenantSummary; locations: LocationSummary[] } | null = null;

  try {
    const [tenant, locationResponse] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.listLocations(tenantSlug),
    ]);
    tenantName = tenant.name;
    data = { tenant, locations: locationResponse.locations };
  } catch (error) {
    if (isApiNotFoundError(error)) {
      notFound();
    }

    const detail = isApiClientError(error) ? error.message : "Locations could not be loaded.";

    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Locations unavailable</p>
          <h2>{tenantName}</h2>
          <p>{detail}</p>
        </section>
      </main>
    );
  }

  if (data === null) {
    notFound();
  }

  const { tenant, locations: allLocations } = data;
  const locations = allLocations.filter((location) => location.isActive);

  if (locations.length <= 1) {
    redirect(pathWithQuery(`/${tenantSlug}/services`, { screening, locationId: locations[0]?.id }));
  }

  const bookingAd = tenant.branding.bookingAd;
  // This screen's own photo, falling back to the first screen's.
  const panelImageUrl = bookingAd?.locationImageUrl ?? bookingAd?.imageUrl ?? null;
  const panelImageAlt = bookingAd?.locationImageUrl ? bookingAd.locationImageAltText : bookingAd?.imageAltText;
  const stepNumber = screening ? 2 : 1;

  return (
    <main className="sf-entry">
      <section className="sf-entry__panel" aria-labelledby="locations-title">
        <p className="sf-eyebrow">Step {stepNumber}</p>
        <h1 id="locations-title" className="sf-title">Choose a location</h1>

        <div className="sf-entry__options">
          {locations.map((location) => {
            const address = formatLocationAddress(location);
            return (
              <Link
                key={location.id}
                href={pathWithQuery(`/${tenantSlug}/services`, { screening, locationId: location.id })}
                className="sf-option"
              >
                <span className="sf-option__text">
                  <strong>{location.name}</strong>
                  <small>{address || location.timeZone}</small>
                </span>
                <span className="sf-option__arrow" aria-hidden="true">→</span>
              </Link>
            );
          })}
        </div>
      </section>

      <aside className="sf-promo" aria-label="Studio highlight">
        <div className="sf-promo__media">
          {panelImageUrl ? (
            <img src={panelImageUrl} alt={panelImageAlt ?? tenantName} />
          ) : (
            <span className="sf-promo__placeholder">Studio photograph</span>
          )}
        </div>
        {bookingAd?.locationHeadline || bookingAd?.locationBody ? (
          <div className="sf-promo__copy">
            <p className="sf-eyebrow sf-eyebrow--dark">{bookingAd?.locationLabel ?? "Our studios"}</p>
            {bookingAd?.locationHeadline ? <h2>{bookingAd.locationHeadline}</h2> : null}
            {bookingAd?.locationBody ? <p>{bookingAd.locationBody}</p> : null}
          </div>
        ) : null}
      </aside>
    </main>
  );
}
