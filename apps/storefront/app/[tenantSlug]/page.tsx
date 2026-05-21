import Link from "next/link";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import type { LocationSummary, TenantSummary } from "@booking/shared-types";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../lib/storefront-api";
import { pathWithQuery, titleFromSlug } from "../lib/storefront-shell";

type TenantPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export const dynamic = "force-dynamic";

export default async function TenantHomePage({ params }: TenantPageProps) {
  const { tenantSlug } = await params;
  let data: { tenant: TenantSummary; locations: LocationSummary[] } | null = null;

  try {
    const [tenant, locationResponse] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.listLocations(tenantSlug),
    ]);
    data = { tenant, locations: locationResponse.locations };
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

  if (data === null) {
    notFound();
  }

  const { tenant, locations } = data;
  const activeLocations = locations.filter((location) => location.isActive);
  const screening = tenant.branding.bookingScreening;
  const hasScreening = Boolean(screening?.enabled && screening.options.length > 0);

  if (!hasScreening) {
    redirect(
      activeLocations.length > 1
        ? `/${tenantSlug}/locations`
        : pathWithQuery(`/${tenantSlug}/services`, { locationId: activeLocations[0]?.id }),
    );
  }

  const nextPathForScreening = (screeningId: string) =>
    activeLocations.length > 1
      ? pathWithQuery(`/${tenantSlug}/locations`, { screening: screeningId })
      : pathWithQuery(`/${tenantSlug}/services`, { screening: screeningId, locationId: activeLocations[0]?.id });
  const bookingAd = tenant.branding.bookingAd;

  return (
    <main className="booking-entry-layout">
      <section className="booking-entry-panel">
        <div className="booking-entry-copy">
          <p className="store-eyebrow">Book online</p>
          <h2>{screening?.title ?? "How can we help?"}</h2>
        </div>

        <div className="screening-option-list">
          {screening?.options.map((option) => (
            <Link key={option.id} href={nextPathForScreening(option.id)} className="screening-option-card">
              <span>
                <strong>{option.label}</strong>
                {option.description ? <small>{option.description}</small> : null}
              </span>
              <b aria-hidden="true">→</b>
            </Link>
          ))}
        </div>
      </section>

      <aside className="booking-ad-panel" aria-label="Studio highlight">
        {bookingAd?.imageUrl ? <img src={bookingAd.imageUrl} alt={bookingAd.imageAltText ?? tenant.name} /> : null}
        <div>
          {bookingAd?.headline ? <strong>{bookingAd.headline}</strong> : null}
          {bookingAd?.body ? <p>{bookingAd.body}</p> : null}
        </div>
      </aside>
    </main>
  );
}
