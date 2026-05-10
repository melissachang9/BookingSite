/**
 * Public service page: shows providers for the service and a date picker that loads
 * available slots via a Server Action. Selecting a slot starts a booking draft.
 */
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { SlotPicker } from "./slot-picker";

type Params = { tenantSlug: string; serviceId: string };

async function loadServiceContext(slug: string, serviceId: string) {
  const admin = createAdminClient();
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant) return null;

  const { data: service } = await admin
    .from("services")
    .select("id, name, description, duration_minutes, price_cents, deposit_cents, is_active, tenant_id")
    .eq("id", serviceId)
    .maybeSingle();
  if (!service || service.tenant_id !== tenant.id || !service.is_active) return null;

  const { data: providerLinks } = await admin
    .from("provider_services")
    .select("provider_id, providers!inner(id, name, bio, avatar_url, is_active, sort_order)")
    .eq("service_id", serviceId)
    .eq("tenant_id", tenant.id);

  const providers = (providerLinks ?? [])
    .map((row) => row.providers as unknown as {
      id: string;
      name: string;
      bio: string | null;
      avatar_url: string | null;
      is_active: boolean;
      sort_order: number;
    })
    .filter((p) => p && p.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);

  return { tenant, service, providers };
}

export default async function ServiceBookingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { tenantSlug, serviceId } = await params;
  const data = await loadServiceContext(tenantSlug, serviceId);
  if (!data) notFound();
  const { tenant, service, providers } = data;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-8">
        <a
          href={`/${tenant.slug}`}
          className="text-sm text-neutral-500 hover:text-neutral-900"
        >
          ← {tenant.name}
        </a>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{service.name}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {service.duration_minutes} min · ${(service.price_cents / 100).toFixed(0)}
          {service.deposit_cents > 0
            ? ` · $${(service.deposit_cents / 100).toFixed(0)} deposit`
            : ""}
        </p>
      </header>

      {providers.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-8 text-center text-neutral-600">
          No providers are available for this service.
        </div>
      ) : (
        <SlotPicker
          tenantId={tenant.id}
          tenantSlug={tenant.slug}
          serviceId={service.id}
          providers={providers.map((p) => ({ id: p.id, name: p.name }))}
        />
      )}
    </div>
  );
}
