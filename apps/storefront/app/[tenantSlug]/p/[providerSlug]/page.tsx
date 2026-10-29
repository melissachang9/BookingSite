import Link from "next/link";
import { notFound } from "next/navigation";

import { FinancingLink } from "../../../components/financing-link";
import { storefrontApi, isApiNotFoundError } from "../../../lib/storefront-api";
import { formatCurrency, formatDuration } from "../../../lib/storefront-shell";

type ProviderPageProps = {
  params: Promise<{ tenantSlug: string; providerSlug: string }>;
};

export const dynamic = "force-dynamic";

const TINTS = 6;

export default async function ProviderLandingPage({ params }: ProviderPageProps) {
  const { tenantSlug, providerSlug } = await params;

  try {
    const [tenant, provider, servicesResp] = await Promise.all([
      storefrontApi.getTenantBySlug(tenantSlug),
      storefrontApi.getProviderBySlug(tenantSlug, providerSlug),
      storefrontApi.listServices(tenantSlug).catch(() => ({ services: [] })),
    ]);
    const providerServiceIds = new Set(provider.serviceIds);
    const providerServices = servicesResp.services.filter(
      (svc) => providerServiceIds.has(svc.id) && svc.isActive,
    );

    return (
      <main className="sf-flow">
        <div className={`sf-flow__grid${provider.imageUrl ? " sf-flow__grid--aside" : ""}`}>
          <section className="sf-flow__main" aria-labelledby="provider-title">
            <header className="sf-head">
              <div>
                <p className="sf-eyebrow">Book with</p>
                <h1 id="provider-title" className="sf-title sf-title--page">{provider.name}</h1>
                <p className="sf-lead sf-lead--sub">
                  {provider.description
                    ? provider.description
                    : provider.isBookableOnline
                      ? `${tenant.name} · Select a service below to book directly.`
                      : `${tenant.name} · Not currently accepting online bookings.`}
                </p>
              </div>
              {providerServices.length > 0 ? (
                <span className="sf-pill">
                  {providerServices.length} {providerServices.length === 1 ? "service" : "services"}
                </span>
              ) : null}
            </header>

            {providerServices.length > 0 ? (
              <div className="sf-services">
                {providerServices.map((svc, index) => (
                  <article key={svc.id} className="sf-service">
                    {svc.imageUrl ? (
                      <img src={svc.imageUrl} alt={svc.imageAltText ?? svc.name} className="sf-service__tile sf-service__tile--image" />
                    ) : (
                      <span className={`sf-service__tile sf-tint-${index % TINTS}`} aria-hidden="true">
                        {svc.name.charAt(0)}
                      </span>
                    )}
                    <div className="sf-service__body">
                      <h3>{svc.name}</h3>
                      <p>{svc.description ?? "Personalised studio service with live appointment availability."}</p>
                      <FinancingLink financing={svc.effectiveFinancing} priceCents={svc.priceCents} />
                    </div>
                    <div className="sf-service__side">
                      <strong>{formatCurrency(svc.priceCents)}</strong>
                      <span>{formatDuration(svc.durationMinutes)}</span>
                      {provider.isBookableOnline ? (
                        <Link
                          href={`/${tenantSlug}/services/${svc.id}?providerId=${provider.id}`}
                          className="sf-btn"
                          aria-label={`Choose ${svc.name}`}
                        >
                          Choose
                        </Link>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="sf-empty">
                <strong>{provider.name} has no services to book online right now.</strong>
                <span>
                  <Link href={`/${tenantSlug}/services`}>Browse all services</Link>
                </span>
              </div>
            )}

            {providerServices.length > 0 ? (
              <p className="sf-help">
                Looking for something else? <Link href={`/${tenantSlug}/services?providerId=${provider.id}`}>View all services</Link>
              </p>
            ) : null}
          </section>

          {provider.imageUrl ? (
            <aside className="sf-aside" aria-label={provider.name}>
              <div className="sf-aside__media">
                <img src={provider.imageUrl} alt={provider.name} />
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
    throw error;
  }
}
