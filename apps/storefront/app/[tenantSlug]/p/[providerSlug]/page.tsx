import Link from "next/link";
import { notFound } from "next/navigation";

import { storefrontApi, isApiNotFoundError } from "../../../lib/storefront-api";

type ProviderPageProps = {
  params: Promise<{ tenantSlug: string; providerSlug: string }>;
};

export const dynamic = "force-dynamic";

export default async function ProviderLandingPage({ params }: ProviderPageProps) {
  const { tenantSlug, providerSlug } = await params;

  try {
    const provider = await storefrontApi.getProviderBySlug(tenantSlug, providerSlug);
    const servicesResp = await storefrontApi.listServices(tenantSlug).catch(() => ({ services: [] }));
    const providerServiceIds = new Set(provider.serviceIds);
    const providerServices = servicesResp.services.filter(
      (svc) => providerServiceIds.has(svc.id) && svc.isActive,
    );

    return (
      <main className="page-stack">
        <section className="state-panel state-panel--manage">
          <p className="store-eyebrow">Book with</p>
          <h1>{provider.name}</h1>
          <p>
            {provider.isBookableOnline
              ? "Select a service below to book directly."
              : "This provider is not currently accepting online bookings."}
          </p>
        </section>

        {providerServices.length > 0 ? (
          <section className="store-section">
            <div className="section-header">
              <div>
                <p className="store-eyebrow">Services</p>
                <h2>Available with {provider.name}</h2>
              </div>
            </div>
            <div className="summary-grid summary-grid--three">
              {providerServices.map((svc) => (
                <Link
                  key={svc.id}
                  href={`/${tenantSlug}/services/${svc.id}?providerId=${provider.id}`}
                  className="summary-card"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <span>{svc.durationMinutes ? `${svc.durationMinutes} min` : "Service"}</span>
                  <strong>{svc.name}</strong>
                  {svc.description ? <p>{svc.description}</p> : null}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="support-panel">
          <div>
            <p className="store-eyebrow">Browse all services</p>
            <h3>See everything the studio offers.</h3>
          </div>
          <Link href={`/${tenantSlug}/services?providerId=${provider.id}`} className="store-button">
            View all services
          </Link>
        </section>
      </main>
    );
  } catch (error) {
    if (isApiNotFoundError(error)) {
      notFound();
    }
    throw error;
  }
}

