import { requireTenant } from "@/lib/admin/require-tenant";
import { ServicesList } from "./services-list";
import type { ServiceRow } from "./service-form";

export const metadata = { title: "Services — BookingSite" };

export default async function ServicesPage() {
  const { supabase, tenantId } = await requireTenant();
  const [{ data, error }, { data: forms }, { data: links }] = await Promise.all([
    supabase
      .from("services")
      .select(
        "id, name, description, duration_minutes, price_cents, deposit_cents, buffer_before_minutes, buffer_after_minutes, is_active"
      )
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
  ]);

  const serviceFormIds = new Map<string, string[]>();
  for (const link of links ?? []) {
    const list = serviceFormIds.get(link.service_id) ?? [];
    list.push(link.form_id);
    serviceFormIds.set(link.service_id, list);
  }
  const services = (data ?? []).map((s) => ({
    ...(s as ServiceRow),
    form_ids: serviceFormIds.get(s.id) ?? [],
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Services</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          The catalog customers can book from. Add duration, price, deposit, and buffer time.
        </p>
      </div>
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error.message}
        </p>
      )}
      <ServicesList services={services} forms={forms ?? []} />
    </div>
  );
}
