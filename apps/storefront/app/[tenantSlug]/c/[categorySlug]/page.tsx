import Link from "next/link";
import { notFound } from "next/navigation";

import { isApiClientError, isApiNotFoundError, storefrontApi } from "../../../lib/storefront-api";
import { formatCurrency, formatDuration, pathWithQuery, slugify, titleFromSlug } from "../../../lib/storefront-shell";

type CategoryPageProps = {
  params: Promise<{ tenantSlug: string; categorySlug: string }>;
  searchParams: Promise<{ locationId?: string; screening?: string }>;
};

export const dynamic = "force-dynamic";

const FEATURED_LABEL_COPY: Record<string, string> = {
  signature: "Signature",
  most_popular: "Most popular",
  new: "New",
  limited: "Limited",
};

function calculateValueStackTotal(items: Array<{ estValueCents?: number | null }> | undefined): number {
  if (!items || items.length === 0) return 0;
  return items.reduce((total, item) => total + (typeof item.estValueCents === "number" ? item.estValueCents : 0), 0);
}

export default async function CategoryLandingPage({ params, searchParams }: CategoryPageProps) {
  const { tenantSlug, categorySlug } = await params;
  const { locationId, screening } = await searchParams;

  try {
    const [tenant, payload] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.getPublicCategory(tenantSlug, categorySlug),
    ]);
    const { category, services } = payload;
    const featuredCopy = category.featuredLabel ? FEATURED_LABEL_COPY[category.featuredLabel] ?? null : null;
    const valueStackTotal = calculateValueStackTotal(category.valueStack);
    const bonusesTotal = calculateValueStackTotal(category.bonuses);
    const bookingAd = tenant.branding.bookingAd;
    const lowestPrice = services.reduce<number | null>((min, service) => {
      if (min === null) return service.priceCents;
      return service.priceCents < min ? service.priceCents : min;
    }, null);

    return (
      <main className="category-landing">
        <section className="category-hero">
          <div className="category-hero__copy">
            <Link href={`/${tenantSlug}`} className="back-link">
              {tenant.name}
            </Link>
            {featuredCopy ? <p className="category-featured-badge">{featuredCopy}</p> : null}
            <h1>{category.outcomeHeadline ?? category.name}</h1>
            {category.subheadline ? <p className="category-subheadline">{category.subheadline}</p> : null}
            {category.scarcityHint ? <p className="category-scarcity">{category.scarcityHint}</p> : null}
            {lowestPrice !== null ? (
              <p className="category-anchor">
                Starting at <strong>{formatCurrency(lowestPrice)}</strong>
              </p>
            ) : null}
            {services.length > 0 ? (
              <Link
                href={pathWithQuery(`/${tenantSlug}/services`, { locationId, screening })}
                className="primary-action category-cta"
              >
                Book {category.name.toLowerCase()}
              </Link>
            ) : null}
          </div>
          {category.heroImageUrl ? (
            <div className="category-hero__media">
              <img src={category.heroImageUrl} alt={category.heroImageAlt ?? category.name} />
            </div>
          ) : null}
        </section>

        {category.valueStack && category.valueStack.length > 0 ? (
          <section className="category-block">
            <h2>What you're getting</h2>
            <ul className="value-stack">
              {category.valueStack.map((item, idx) => (
                <li key={idx}>
                  <span>{item.label}</span>
                  {typeof item.estValueCents === "number" && item.estValueCents > 0 ? (
                    <strong>{formatCurrency(item.estValueCents)}</strong>
                  ) : null}
                </li>
              ))}
            </ul>
            {valueStackTotal > 0 ? (
              <p className="value-stack-total">
                Total value: <strong>{formatCurrency(valueStackTotal)}</strong>
              </p>
            ) : null}
          </section>
        ) : null}

        {category.bonuses && category.bonuses.length > 0 ? (
          <section className="category-block">
            <h2>Bonuses included</h2>
            <ul className="value-stack">
              {category.bonuses.map((item, idx) => (
                <li key={idx}>
                  <span>{item.label}</span>
                  {typeof item.estValueCents === "number" && item.estValueCents > 0 ? (
                    <strong>{formatCurrency(item.estValueCents)}</strong>
                  ) : null}
                </li>
              ))}
            </ul>
            {bonusesTotal > 0 ? (
              <p className="value-stack-total">
                Bonuses value: <strong>{formatCurrency(bonusesTotal)}</strong>
              </p>
            ) : null}
          </section>
        ) : null}

        {category.guaranteeText ? (
          <section className="category-block category-guarantee">
            <h2>Our guarantee</h2>
            <p>{category.guaranteeText}</p>
          </section>
        ) : null}

        {category.socialProof?.quote ? (
          <section className="category-block category-social-proof">
            <blockquote>
              <p>&ldquo;{category.socialProof.quote}&rdquo;</p>
              {category.socialProof.author ? <cite>— {category.socialProof.author}</cite> : null}
            </blockquote>
            {category.socialProof.imageUrl ? (
              <img src={category.socialProof.imageUrl} alt={category.socialProof.author ?? "Client"} />
            ) : null}
          </section>
        ) : null}

        {services.length > 0 ? (
          <section className="category-block category-services">
            <h2>Available services</h2>
            <div className="service-list service-list--stacked">
              {services.map((service) => (
                <article key={service.id} className="service-row-card">
                  {service.imageUrl ? (
                    <img
                      src={service.imageUrl}
                      alt={service.imageAltText ?? service.name}
                      className="service-row-card__image"
                    />
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
                    <p>
                      {service.description ?? "Personalized studio service with live appointment availability."}
                    </p>
                  </div>
                  <Link
                    href={pathWithQuery(`/${tenantSlug}/services/${slugify(service.name)}`, {
                      locationId,
                      screening,
                    })}
                    className="card-action service-row-card__action"
                  >
                    Choose service
                  </Link>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <section className="category-block empty-panel">
            <strong>No services available right now.</strong>
            <span>Check back soon or contact the studio.</span>
          </section>
        )}

        {category.faqs && category.faqs.length > 0 ? (
          <section className="category-block category-faq">
            <h2>Common questions</h2>
            <dl>
              {category.faqs.map((item, idx) => (
                <div key={idx}>
                  <dt>{item.question}</dt>
                  <dd>{item.answer}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {bookingAd ? (
          <aside className="booking-ad-panel booking-ad-panel--category" aria-label="Studio highlight">
            {bookingAd.imageUrl ? (
              <img src={bookingAd.imageUrl} alt={bookingAd.imageAltText ?? tenant.name} />
            ) : null}
            <div>
              {bookingAd.headline ? <strong>{bookingAd.headline}</strong> : null}
              {bookingAd.body ? <p>{bookingAd.body}</p> : null}
            </div>
          </aside>
        ) : null}
      </main>
    );
  } catch (error) {
    if (isApiNotFoundError(error)) {
      notFound();
    }

    const tenantName = titleFromSlug(tenantSlug);
    const detail = isApiClientError(error) ? error.message : "This category could not be loaded.";

    return (
      <main className="page-stack">
        <section className="state-panel">
          <p className="store-eyebrow">Category unavailable</p>
          <h2>{tenantName}</h2>
          <p>{detail}</p>
        </section>
      </main>
    );
  }
}

export async function generateMetadata({ params }: CategoryPageProps) {
  const { tenantSlug, categorySlug } = await params;
  try {
    const payload = await storefrontApi.getPublicCategory(tenantSlug, categorySlug);
    const title = payload.category.outcomeHeadline ?? payload.category.name;
    return {
      title,
      description: payload.category.metaDescription ?? payload.category.subheadline ?? undefined,
    };
  } catch {
    return { title: titleFromSlug(categorySlug) };
  }
}
