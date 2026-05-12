import { requireTenant } from "@/lib/admin/require-tenant";
import { LocationsList, type LocationRow } from "./locations-list";

export const metadata = { title: "Locations — BookingSite" };

type LocationRecord = LocationRow;

export default async function LocationsPage() {
  const { supabase, tenantId, role } = await requireTenant();

  const [{ data: locations, error }, { data: tenant }] = await Promise.all([
    supabase
      .from("locations")
      .select(
        "id, name, slug, timezone, phone, email, address_line1, address_line2, city, state_region, postal_code, country_code, sort_order, is_active"
      )
      .eq("tenant_id", tenantId)
      .order("is_active", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase.from("tenants").select("default_location_id").eq("id", tenantId).maybeSingle(),
  ]);

  const locationRows = (locations ?? []) as LocationRecord[];
  const canManage = role === "owner" || role === "manager";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Locations</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Define the business locations that everything else will hang off of: provider assignment, service assignment, schedules, and booking visibility.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error.message}
        </p>
      ) : null}

      <LocationsList
        locations={locationRows}
        defaultLocationId={tenant?.default_location_id ?? null}
        canManage={canManage}
      />
    </div>
  );
}