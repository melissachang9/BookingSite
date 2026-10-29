import Link from "next/link";
import { notFound } from "next/navigation";

import { FinancingLink } from "../../../components/financing-link";
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

    const valueBlock = (title: string, items: NonNullable<typeof category.valueStack>, total: number, totalLabel: string) => (
      <section className="sf-card sf-block">
        <h2 className="sf-card__title sf-card__title--lg">{title}</h2>
        <ul className="sf-valuelist">
          {items.map((item, idx) => (
            <li key={idx}>
              <span>{item.label}</span>
              {typeof item.estValueCents === "number" && item.estValueCents > 0 ? (
                <strong>{formatCurrency(item.estValueCents)}</strong>
              ) : null}
            </li>
          ))}
        </ul>
        {total > 0 ? (
          <p className="sf-valuelist__total">
            {totalLabel} <strong>{formatCurrency(total)}</strong>
          </p>
        ) : null}
      </section>
    );

    return (
      <main className="sf-flow">
        <div className={`sf-flow__grid${category.heroImageUrl ? " sf-flow__grid--aside" : ""}`}>
          <section className="sf-flow__main" aria-labelledby="category-title">
            <header className="sf-head sf-head--stack">
              <div>
                <p className="sf-eyebrow">
                  <Link href={`/${tenantSlug}`} className="sf-backlink">{tenant.name}</Link>
                </p>
                <h1 id="category-title" className="sf-title sf-title--page">{category.outcomeHeadline ?? category.name}</h1>
                {category.subheadline ? <p className="sf-lead sf-lead--sub">{category.subheadline}</p> : null}
              </div>
              <div className="sf-chips">
                {featuredCopy ? <span className="sf-tag sf-tag--dark">{featuredCopy}</span> : null}
                {lowestPrice !== null ? <span className="sf-pill">Starting at {formatCurrency(lowestPrice)}</span> : null}
                {category.scarcityHint ? <span className="sf-pill sf-pill--rose">{category.scarcityHint}</span> : null}
              </div>
              {services.length > 0 ? (
                <Link href={pathWithQuery(`/${tenantSlug}/services`, { locationId, screening })} className="sf-btn sf-btn--dark">
                  Book {category.name.toLowerCase()}
                </Link>
              ) : null}
            </header>

            {services.length > 0 ? (
              <div className="sf-services">
                {services.map((service, index) => (
                  <article key={service.id} className="sf-service">
                    {service.imageUrl ? (
                      <img src={service.imageUrl} alt={service.imageAltText ?? service.name} className="sf-service__tile sf-service__tile--image" />
                    ) : (
                      <span className={`sf-service__tile sf-tint-${index % 6}`} aria-hidden="true">
                        {service.name.charAt(0)}
                      </span>
                    )}
                    <div className="sf-service__body">
                      <h3>{service.name}</h3>
                      <p>{service.description ?? "Personalised studio service with live appointment availability."}</p>
                      <FinancingLink financing={service.effectiveFinancing} priceCents={service.priceCents} />
                    </div>
                    <div className="sf-service__side">
                      <strong>{formatCurrency(service.priceCents)}</strong>
                      <span>{formatDuration(service.durationMinutes)}</span>
                      <Link
                        href={pathWithQuery(`/${tenantSlug}/services/${slugify(service.name)}`, { locationId, screening })}
                        className="sf-btn"
                        aria-label={`Choose ${service.name}`}
                      >
                        Choose
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="sf-empty">
                <strong>No services available right now.</strong>
                <span>Check back soon or contact the studio.</span>
              </div>
            )}

            {category.valueStack && category.valueStack.length > 0
              ? valueBlock("What you're getting", category.valueStack, valueStackTotal, "Total value:")
              : null}
            {category.bonuses && category.bonuses.length > 0
              ? valueBlock("Bonuses included", category.bonuses, bonusesTotal, "Bonuses value:")
              : null}

            {category.guaranteeText ? (
              <section className="sf-card sf-block">
                <h2 className="sf-card__title sf-card__title--lg">Our guarantee</h2>
                <p className="sf-block__text">{category.guaranteeText}</p>
              </section>
            ) : null}

            {category.socialProof?.quote ? (
              <section className="sf-card sf-block sf-quote">
                <blockquote>
                  <p>&ldquo;{category.socialProof.quote}&rdquo;</p>
                  {category.socialProof.author ? <cite>{category.socialProof.author}</cite> : null}
                </blockquote>
                {category.socialProof.imageUrl ? (
                  <img src={category.socialProof.imageUrl} alt={category.socialProof.author ?? "Client"} />
                ) : null}
              </section>
            ) : null}

            {category.faqs && category.faqs.length > 0 ? (
              <section className="sf-card sf-block">
                <h2 className="sf-card__title sf-card__title--lg">Common questions</h2>
                <dl className="sf-faq">
                  {category.faqs.map((item, idx) => (
                    <div key={idx}>
                      <dt>{item.question}</dt>
                      <dd>{item.answer}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}

            {bookingAd && (bookingAd.headline || bookingAd.body) ? (
              <aside className="sf-card sf-block" aria-label="Studio highlight">
                {bookingAd.headline ? <h2 className="sf-card__title">{bookingAd.headline}</h2> : null}
                {bookingAd.body ? <p className="sf-block__text">{bookingAd.body}</p> : null}
              </aside>
            ) : null}
          </section>

          {category.heroImageUrl ? (
            <aside className="sf-aside" aria-label={category.name}>
              <div className="sf-aside__media">
                <img src={category.heroImageUrl} alt={category.heroImageAlt ?? category.name} />
              </div>
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
