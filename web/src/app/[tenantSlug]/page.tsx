/**
 * Public booking site, scoped to a tenant by slug: /[tenantSlug]
 *
 * Renders a minimal hero + the active service list, each linking to the slot picker.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";

type Params = { tenantSlug: string };

async function loadTenant(slug: string) {
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant) return null;
  const { data: services } = await admin
    .from("services")
    .select("id, name, description, duration_minutes, price_cents, deposit_cents")
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

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-10">
        <p className="text-sm font-medium uppercase tracking-wider text-neutral-500">
          Book an appointment
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{tenant.name}</h1>
      </header>

      {services.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-8 text-center text-neutral-600">
          No services are bookable right now. Please check back later.
        </div>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {services.map((s) => (
            <li key={s.id}>
              <Link
                href={`/${tenant.slug}/services/${s.id}`}
                className="flex items-start justify-between gap-4 px-5 py-4 hover:bg-neutral-50"
              >
                <div>
                  <p className="font-medium">{s.name}</p>
                  {s.description ? (
                    <p className="mt-0.5 text-sm text-neutral-600">{s.description}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-neutral-500">
                    {s.duration_minutes} min
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium">${(s.price_cents / 100).toFixed(0)}</p>
                  {s.deposit_cents > 0 ? (
                    <p className="text-xs text-neutral-500">
                      ${(s.deposit_cents / 100).toFixed(0)} deposit
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
