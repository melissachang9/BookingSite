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
  const stepNumber = screening ? 2 : 1;

  return (
    <main className="booking-flow-layout">
      <section className="booking-flow-panel">
        <Link href={`/${tenantSlug}`} className="back-link">
          Start
        </Link>
        <div className="booking-entry-copy">
          <p className="store-eyebrow">Step {stepNumber}</p>
          <h2>Choose a location</h2>
        </div>

        <div className="location-option-list">
          {locations.map((location) => {
            const address = formatLocationAddress(location);
            return (
              <Link
                key={location.id}
                href={pathWithQuery(`/${tenantSlug}/services`, { screening, locationId: location.id })}
                className="location-option-card"
              >
                <span>
                  <strong>{location.name}</strong>
                  {address ? <small>{address}</small> : <small>{location.timeZone}</small>}
                </span>
                <b aria-hidden="true">→</b>
              </Link>
            );
          })}
        </div>
      </section>

      <aside className="booking-ad-panel booking-ad-panel--quiet" aria-label="Studio highlight">
        {bookingAd?.imageUrl ? <img src={bookingAd.imageUrl} alt={bookingAd.imageAltText ?? tenantName} /> : null}
        <div>
          <strong>{bookingAd?.headline ?? tenantName}</strong>
          {bookingAd?.body ? <p>{bookingAd.body}</p> : null}
        </div>
      </aside>
    </main>
  );
}
