import Link from "next/link";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import type { LocationSummary, TenantSummary } from "@booking/shared-types";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../lib/storefront-api";
import {
  formatLocationAddress,
  pathWithQuery,
  readableTextColor,
  titleFromSlug,
  todaysHoursLabel,
  validHexColor,
} from "../lib/storefront-shell";

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
  const primaryLocation = activeLocations.length === 1 ? activeLocations[0] : null;
  const address = primaryLocation ? formatLocationAddress(primaryLocation) : "";
  const hoursLabel = todaysHoursLabel(tenant.settings, tenant.timezone);
  const showPromo = bookingAd?.enabled !== false;
  const panelColor = validHexColor(bookingAd?.panelColor);
  const promoStyle = panelColor
    ? ({ "--sf-promo-bg": panelColor, "--sf-promo-ink": readableTextColor(panelColor) } as React.CSSProperties)
    : undefined;

  return (
    <main className={showPromo ? "sf-entry" : "sf-entry sf-entry--solo"}>
      <section className="sf-entry__panel" aria-labelledby="entry-title">
        <p className="sf-eyebrow">Begin booking</p>
        <h1 id="entry-title" className="sf-title">
          {screening?.title ?? "How can we help?"}
        </h1>
        <p className="sf-lead">
          Choose the path that matches your visit so timing, forms and payment stay aligned from the start.
        </p>

        <div className="sf-entry__options">
          {screening?.options.map((option) => (
            <Link key={option.id} href={nextPathForScreening(option.id)} className="sf-option">
              <span className="sf-option__text">
                <strong>{option.label}</strong>
                {option.description ? <small>{option.description}</small> : null}
              </span>
              <span className="sf-option__arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>

        {address || hoursLabel ? (
          <p className="sf-entry__meta">
            {address ? <span>{address}</span> : null}
            {hoursLabel ? <span>{hoursLabel}</span> : null}
          </p>
        ) : null}
      </section>

      {showPromo ? (
      <aside className="sf-promo" aria-label="Studio highlight" style={promoStyle}>
        <div className="sf-promo__media">
          {bookingAd?.imageUrl ? (
            <img src={bookingAd.imageUrl} alt={bookingAd.imageAltText ?? tenant.name} />
          ) : (
            <span className="sf-promo__placeholder">Studio photograph</span>
          )}
        </div>
        <div className="sf-promo__copy">
          <p className="sf-eyebrow sf-eyebrow--dark">{bookingAd?.label ?? "This season"}</p>
          {bookingAd?.headline ? <h2>{bookingAd.headline}</h2> : <h2>Welcome to {tenant.name}.</h2>}
          {bookingAd?.body ? <p>{bookingAd.body}</p> : null}
        </div>
      </aside>
      ) : null}
    </main>
  );
}
