import { requireTenant } from "@/lib/admin/require-tenant";
import { normalizeTenantSettings } from "@/lib/tenants/settings";
import { ServicesList } from "./services-list";
import type { LocationOption, ServiceRow } from "./service-form";

export const metadata = { title: "Services — BookingSite" };

export default async function ServicesPage() {
  const { supabase, tenantId } = await requireTenant();
  const [{ data, error }, { data: forms }, { data: links }, { data: tenant }, { data: locations }] = await Promise.all([
    supabase
      .from("services")
      .select(
        "id, name, description, duration_minutes, price_cents, deposit_cents, buffer_before_minutes, buffer_after_minutes, is_active, service_locations(location_id)"
      )
      .eq("tenant_id", tenantId)
      .order("is_active", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("forms")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("is_archived", false)
      .order("name", { ascending: true }),
    supabase
      .from("service_forms")
      .select("service_id, form_id")
      .eq("tenant_id", tenantId),
    supabase.from("tenants").select("settings_json").eq("id", tenantId).maybeSingle(),
    supabase
      .from("locations")
      .select("id, name, is_active")
      .eq("tenant_id", tenantId)
      .order("is_active", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  const serviceFormIds = new Map<string, string[]>();
  for (const link of links ?? []) {
    const list = serviceFormIds.get(link.service_id) ?? [];
    list.push(link.form_id);
    serviceFormIds.set(link.service_id, list);
  }
  const services = (data ?? []).map((s) => ({
    ...(s as ServiceRow),
    location_ids: (s.service_locations ?? []).map((location) => location.location_id),
    form_ids: serviceFormIds.get(s.id) ?? [],
  }));
  const locationOptions: LocationOption[] = (locations ?? [])
    .filter((location) => location.is_active)
    .map((location) => ({ id: location.id, name: location.name }));
  const tenantSettings = normalizeTenantSettings(
    (tenant?.settings_json ?? null) as Partial<Record<string, unknown>> | null
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Services</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          The catalog customers can book from. New services start with your business default deposit of ${(tenantSettings.default_deposit_cents / 100).toFixed(2)}.
        </p>
      </div>
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error.message}
        </p>
      )}
      <ServicesList
        services={services}
        forms={forms ?? []}
        defaultDepositCents={tenantSettings.default_deposit_cents}
        locations={locationOptions}
      />
    </div>
  );
}
