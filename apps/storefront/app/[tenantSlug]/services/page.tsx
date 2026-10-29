import Link from "next/link";
import { notFound } from "next/navigation";

import { storefrontApi, isApiClientError, isApiNotFoundError } from "../../lib/storefront-api";
import { BookingSteps } from "../../components/booking-steps";
import { FinancingLink } from "../../components/financing-link";
import { formatCurrency, formatDuration, pathWithQuery, slugify, titleFromSlug } from "../../lib/storefront-shell";

const FEATURED_LABELS: Record<string, string> = {
  signature: "Signature",
  most_popular: "Most popular",
  new: "New",
  limited: "Limited",
};

type ServicesPageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ locationId?: string; screening?: string; category?: string }>;
};

export const dynamic = "force-dynamic";

const CATEGORY_TINTS = 6;

export default async function ServicesPage({ params, searchParams }: ServicesPageProps) {
  const { tenantSlug } = await params;
  const { locationId, screening, category: categoryKey } = await searchParams;

  try {
    const [tenant, serviceResponse, locationResponse, categoryResponse] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.listServices(tenantSlug),
      storefrontApi.listLocations(tenantSlug),
      storefrontApi.listPublicServiceCategories(tenantSlug).catch(() => ({ categories: [] })),
    ]);
    const activeLocations = locationResponse.locations.filter((location) => location.isActive);
    const selectedLocation = locationId ? activeLocations.find((location) => location.id === locationId) : activeLocations[0];

    if (locationId && !selectedLocation) {
      notFound();
    }

    const available = selectedLocation
      ? serviceResponse.services.filter((service) => service.locationIds.length === 0 || service.locationIds.includes(selectedLocation.id))
      : serviceResponse.services;

    // Only categories that still have a bookable service here; each keeps its colour by position.
    const categories = categoryResponse.categories
      .filter((entry) => entry.isActive !== false)
      .map((entry, index) => ({ ...entry, tint: index % CATEGORY_TINTS }))
      .filter((entry) => available.some((service) => service.categoryId === entry.id));
    const categoryById = new Map(categories.map((entry) => [entry.id, entry]));
    const activeCategory = categories.find((entry) => entry.id === categoryKey || entry.slug === categoryKey) ?? null;
    const services = activeCategory ? available.filter((service) => service.categoryId === activeCategory.id) : available;

    const bookingAd = tenant.branding.bookingAd;
    const locationStepHref = pathWithQuery(`/${tenantSlug}/locations`, { screening });
    const serviceStepNumber = (screening ? 1 : 0) + (activeLocations.length > 1 ? 1 : 0) + 1;
    // This screen's own photo, falling back to the first screen's.
    const asideImageUrl = bookingAd?.serviceImageUrl ?? bookingAd?.imageUrl ?? null;
    const asideImageAlt = bookingAd?.serviceImageUrl ? bookingAd.serviceImageAltText : bookingAd?.imageAltText;
    const hasAside = Boolean(asideImageUrl || bookingAd?.serviceHeadline || bookingAd?.serviceBody);
    const filterHref = (key?: string) =>
      pathWithQuery(`/${tenantSlug}/services`, { locationId: selectedLocation?.id, screening, category: key });

    return (
      <main className="sf-flow">
        <BookingSteps current={1} />

        <div className={`sf-flow__grid${hasAside ? " sf-flow__grid--aside" : ""}`}>
          <section className="sf-flow__main" aria-labelledby="services-title">
            <header className="sf-head">
              <div>
                <p className="sf-eyebrow">Step {serviceStepNumber}</p>
                <h1 id="services-title" className="sf-title sf-title--page">Select a service</h1>
                <p className="sf-lead sf-lead--sub">
                  {selectedLocation ? `${tenant.name} · ${selectedLocation.name}` : tenant.name}
                </p>
              </div>
              <span className="sf-pill">{services.length} {services.length === 1 ? "service" : "services"}</span>
            </header>

            {categories.length > 0 ? (
              <nav className="sf-filters" aria-label="Treatment categories">
                <Link href={filterHref()} className={`sf-filter${activeCategory ? "" : " is-active"}`} aria-current={activeCategory ? undefined : "true"}>
                  All treatments
                </Link>
                {categories.map((entry) => (
                  <Link
                    key={entry.id}
                    href={filterHref(entry.slug ?? entry.id)}
                    className={`sf-filter${activeCategory?.id === entry.id ? " is-active" : ""}`}
                    aria-current={activeCategory?.id === entry.id ? "true" : undefined}
                  >
                    <span className={`sf-dot sf-dot--${entry.tint}`} aria-hidden="true" />
                    {entry.name}
                  </Link>
                ))}
              </nav>
            ) : null}

            {services.length > 0 ? (
              <div className="sf-services">
                {services.map((service) => {
                  const category = service.categoryId ? categoryById.get(service.categoryId) : undefined;
                  const tint = category?.tint ?? 0;
                  const badge = service.featuredLabel ? FEATURED_LABELS[service.featuredLabel] : null;
                  return (
                    <article key={service.id} className="sf-service">
                      {service.imageUrl ? (
                        <img src={service.imageUrl} alt={service.imageAltText ?? service.name} className="sf-service__tile sf-service__tile--image" />
                      ) : (
                        <span className={`sf-service__tile sf-tint-${tint}`} aria-hidden="true">
                          {service.name.charAt(0)}
                        </span>
                      )}
                      <div className="sf-service__body">
                        {category || badge ? (
                          <div className="sf-service__tags">
                            {category ? <span className={`sf-tag sf-tag--tint sf-tint-${tint}`}>{category.name}</span> : null}
                            {badge ? <span className="sf-tag sf-tag--dark">{badge}</span> : null}
                          </div>
                        ) : null}
                        <h3>{service.name}</h3>
                        <p>{service.description ?? "Personalised studio service with live appointment availability."}</p>
                        <FinancingLink financing={service.effectiveFinancing} priceCents={service.priceCents} />
                      </div>
                      <div className="sf-service__side">
                        <strong>{formatCurrency(service.priceCents)}</strong>
                        <span>{formatDuration(service.durationMinutes)}</span>
                        <Link
                          href={pathWithQuery(`/${tenantSlug}/services/${slugify(service.name)}`, {
                            locationId: selectedLocation?.id,
                            screening,
                          })}
                          className="sf-btn"
                          aria-label={`Choose ${service.name}`}
                        >
                          Choose
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="sf-empty">
                <strong>No services are available here{activeCategory ? ` in ${activeCategory.name}` : ""}.</strong>
                <span>
                  {activeCategory ? (
                    <Link href={filterHref()}>Show all treatments</Link>
                  ) : activeLocations.length > 1 ? (
                    <Link href={locationStepHref}>Choose another location</Link>
                  ) : (
                    "Contact the studio directly."
                  )}
                </span>
              </div>
            )}
          </section>

          {hasAside ? (
            <aside className="sf-aside" aria-label="Studio highlight">
              <div className="sf-aside__media">
                {asideImageUrl ? (
                  <img src={asideImageUrl} alt={asideImageAlt ?? tenant.name} />
                ) : (
                  <span className="sf-aside__placeholder">Treatment photograph</span>
                )}
              </div>
              {bookingAd?.serviceHeadline || bookingAd?.serviceBody ? (
                <div className="sf-aside__copy">
                  <p className="sf-eyebrow">{bookingAd?.serviceLabel ?? "From the studio"}</p>
                  {bookingAd?.serviceHeadline ? <h2>{bookingAd.serviceHeadline}</h2> : null}
                  {bookingAd?.serviceBody ? <p>{bookingAd.serviceBody}</p> : null}
                </div>
              ) : null}
            </aside>
          ) : null}
        </div>
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
