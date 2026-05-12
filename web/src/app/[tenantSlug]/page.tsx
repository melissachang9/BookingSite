/**
 * Public booking site, scoped to a tenant by slug: /[tenantSlug]
 *
 * Renders the tenant landing page and active service list, each linking to the slot picker.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

type Params = { tenantSlug: string };

type Service = {
  id: string;
  name: string;
  description: string | null;
};

type ServiceCategoryConfig = {
  id: string;
  title: string;
  description: string | null;
  serviceIds: string[];
};

type TenantBranding = {
  logoUrl: string | null;
  homepageUrl: string | null;
  catalogMode: "list" | "categories";
  categories: ServiceCategoryConfig[];
};

type ServiceGroup = {
  id: string;
  title: string | null;
  description: string | null;
  services: Service[];
};

async function loadTenant(slug: string) {
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, slug, branding_json")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant) return null;
  const { data: services } = await admin
    .from("services")
    .select("id, name, description")
    .eq("tenant_id", tenant.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  return { tenant, services: services ?? [] };
}

export default async function TenantPublicPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { tenantSlug } = await params;
  const data = await loadTenant(tenantSlug);
  if (!data) notFound();
  const { tenant, services } = data;
  const branding = normalizeTenantBranding(
    (tenant.branding_json ?? null) as Partial<Record<string, unknown>> | null
  );
  const serviceGroups = buildServiceGroups(services as Service[], branding);
  const homepageHref = branding.homepageUrl ?? "/";

  return (
    <div
      className="min-h-screen bg-[linear-gradient(180deg,#fbf8f4_0%,#f6f1ea_100%)]"
      style={{ fontFamily: '"Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif' }}
    >
      <div className="mx-auto w-full max-w-5xl px-6 py-6 lg:px-8 lg:py-8">
        <header className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-b border-stone-200/80 pb-6">
          <a
            href={homepageHref}
            className="inline-flex items-center gap-2 text-sm font-medium text-stone-600 transition hover:text-stone-950"
          >
            <span aria-hidden="true">←</span>
            <span>Back</span>
          </a>

          <div className="justify-self-center text-center">
            {branding.logoUrl ? (
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={branding.logoUrl}
                  alt={`${tenant.name} logo`}
                  className="mx-auto h-14 w-auto object-contain sm:h-16"
                />
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.28em] text-stone-500">
                  Online booking
                </p>
              </div>
            ) : (
              <div>
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-stone-300 bg-white text-sm font-semibold uppercase tracking-[0.18em] text-stone-800 shadow-sm sm:h-16 sm:w-16">
                  {getTenantInitials(tenant.name)}
                </div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-500">
                  Online booking
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-[0.08em] text-stone-950 sm:text-3xl">
                  {tenant.name}
                </h1>
              </div>
            )}
          </div>

          <div aria-hidden="true" className="h-10 w-12" />
        </header>

        <main className="py-10 lg:py-12">
          <section className="max-w-2xl">
            <h2
              className="text-5xl leading-none tracking-[-0.06em] text-stone-950 sm:text-6xl"
              style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif' }}
            >
              What would you like to book?
            </h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-stone-600 sm:text-lg">
              Choose a service to begin. You can review availability and any service-specific details after making your selection.
            </p>
          </section>

          <section className="mt-10">
            {services.length === 0 ? (
              <div className="rounded-[2rem] border border-stone-200 bg-white px-6 py-8 text-center text-stone-600 shadow-[0_18px_48px_rgba(63,40,22,0.08)]">
                No services are bookable right now. Please check back later.
              </div>
            ) : (
              <div className="space-y-10">
                {serviceGroups.map((group) => (
                  <section key={group.id} className="space-y-4">
                    {group.title ? (
                      <div className="space-y-2">
                        <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-stone-500">
                          {group.title}
                        </h3>
                        {group.description ? (
                          <p className="max-w-2xl text-sm leading-6 text-stone-600">
                            {group.description}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <ul className="space-y-4">
                      {group.services.map((service) => (
                        <li key={service.id}>
                          <ServiceCard tenantSlug={tenant.slug} service={service} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            <p className="mt-8 text-sm leading-6 text-stone-500">
              Need to change or cancel an existing appointment? Use the secure link in your confirmation email.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}

function ServiceCard({
  tenantSlug,
  service,
}: {
  tenantSlug: string;
  service: Service;
}) {
  const description = service.description?.trim() || null;
  const preview = description
    ? getDescriptionPreview(description)
    : "Choose this service to continue to availability and review any service-specific details on the next screen.";
  const expandedDescription = description
    ? preview === description
      ? `${description} Pricing, timing, and provider-specific details are shown after you continue.`
      : description
    : "This service opens the next booking step, where the business can show provider-specific timing, pricing, and any additional details before checkout.";

  return (
    <article className="rounded-[1.75rem] border border-stone-200 bg-white px-5 py-5 shadow-[0_18px_40px_rgba(63,40,22,0.08)] transition duration-200 hover:-translate-y-0.5 hover:border-stone-900 hover:shadow-[0_24px_55px_rgba(63,40,22,0.12)] sm:px-6 sm:py-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 max-w-2xl">
          <h3 className="text-2xl font-semibold tracking-[-0.03em] text-stone-950 sm:text-3xl">
            {service.name}
          </h3>
          <p className="mt-3 text-sm leading-6 text-stone-600 sm:text-base">{preview}</p>

          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-stone-700 underline decoration-stone-400 underline-offset-4 list-none">
              Learn more
            </summary>
            <p className="mt-3 text-sm leading-6 text-stone-600 sm:text-base">{expandedDescription}</p>
          </details>
        </div>

        <Link
          href={`/${tenantSlug}/services/${service.id}`}
          className="inline-flex shrink-0 items-center justify-center rounded-full border border-stone-300 bg-stone-50 px-5 py-2.5 text-sm font-semibold text-stone-800 transition hover:border-stone-900 hover:bg-stone-900 hover:text-white"
        >
          Book service
        </Link>
      </div>
    </article>
  );
}

function normalizeTenantBranding(
  brandingJson: Partial<Record<string, unknown>> | null | undefined
): TenantBranding {
  const raw = toRecord(brandingJson);
  const catalog = toRecord(raw.service_catalog ?? raw.serviceCatalog);
  const categoryItems = Array.isArray(catalog.categories)
    ? catalog.categories
    : Array.isArray(raw.service_categories)
      ? raw.service_categories
      : Array.isArray(raw.serviceCategories)
        ? raw.serviceCategories
        : [];

  return {
    logoUrl: normalizeUrl(catalog.logo_url ?? catalog.logoUrl ?? raw.logo_url ?? raw.logoUrl),
    homepageUrl: normalizeUrl(
      catalog.homepage_url ??
        catalog.homepageUrl ??
        raw.homepage_url ??
        raw.homepageUrl ??
        raw.website_url ??
        raw.websiteUrl
    ),
    catalogMode:
      (catalog.mode ?? raw.service_catalog_mode ?? raw.serviceCatalogMode) === "categories"
        ? "categories"
        : "list",
    categories: categoryItems
      .map((category, index) => normalizeCategory(category, index))
      .filter((category): category is ServiceCategoryConfig => category !== null),
  };
}

function normalizeCategory(value: unknown, index: number): ServiceCategoryConfig | null {
  const raw = toRecord(value);
  const title = stringValue(raw.title);
  if (!title) return null;

  const serviceIdsRaw = Array.isArray(raw.service_ids)
    ? raw.service_ids
    : Array.isArray(raw.serviceIds)
      ? raw.serviceIds
      : [];

  return {
    id: stringValue(raw.id) ?? `category-${index}`,
    title,
    description: stringValue(raw.description),
    serviceIds: serviceIdsRaw.filter((serviceId): serviceId is string => typeof serviceId === "string"),
  };
}

function buildServiceGroups(services: Service[], branding: TenantBranding): ServiceGroup[] {
  if (branding.catalogMode !== "categories" || branding.categories.length === 0) {
    return [{ id: "all-services", title: null, description: null, services }];
  }

  const servicesById = new Map(services.map((service) => [service.id, service]));
  const groupedServiceIds = new Set<string>();
  const groups: ServiceGroup[] = [];

  for (const category of branding.categories) {
    const groupedServices = category.serviceIds
      .map((serviceId) => servicesById.get(serviceId))
      .filter((service): service is Service => service !== undefined);

    if (groupedServices.length === 0) continue;

    groupedServices.forEach((service) => groupedServiceIds.add(service.id));
    groups.push({
      id: category.id,
      title: category.title,
      description: category.description,
      services: groupedServices,
    });
  }

  const ungroupedServices = services.filter((service) => !groupedServiceIds.has(service.id));
  if (ungroupedServices.length > 0) {
    groups.push({
      id: "more-services",
      title: groups.length > 0 ? "More services" : null,
      description: null,
      services: ungroupedServices,
    });
  }

  return groups.length > 0 ? groups : [{ id: "all-services", title: null, description: null, services }];
}

function getDescriptionPreview(description: string) {
  const compact = description.replace(/\s+/g, " ").trim();
  if (compact.length <= 140) return compact;

  const preview = compact.slice(0, 137).trimEnd();
  return preview.endsWith(".") ? preview : `${preview}...`;
}

function toRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeUrl(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return null;
  if (
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("/") ||
    raw.startsWith("data:")
  ) {
    return raw;
  }

  return `https://${raw}`;
}

function getTenantInitials(name: string) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return initials || "BS";
}
