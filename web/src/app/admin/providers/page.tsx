import { requireTenant } from "@/lib/admin/require-tenant";
import { ProvidersList } from "./providers-list";
import type { LocationOption, ProviderRow, ServiceOption } from "./provider-form";

export const metadata = { title: "Providers — BookingSite" };

type ProviderRecord = {
  id: string;
  name: string;
  email: string | null;
  bio: string | null;
  is_active: boolean;
  provider_services: { service_id: string }[];
  provider_locations: { location_id: string }[];
  provider_schedules: {
    id: string;
    location_id: string;
    locations: { name: string | null } | { name: string | null }[] | null;
    weekday: number;
    start_time: string;
    end_time: string;
  }[];
};

export default async function ProvidersPage() {
  const { supabase, tenantId } = await requireTenant();

  const [{ data: providers, error: provErr }, { data: services, error: svcErr }, { data: locations, error: locErr }] = await Promise.all([
    supabase
      .from("providers")
      .select(
        "id, name, email, bio, is_active, provider_services(service_id), provider_locations(location_id), provider_schedules(id, location_id, weekday, start_time, end_time, locations(name))"
      )
      .eq("tenant_id", tenantId)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("services")
      .select("id, name, is_active")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }),
    supabase
      .from("locations")
      .select("id, name, is_active")
      .eq("tenant_id", tenantId)
      .order("is_active", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  const error = provErr ?? svcErr ?? locErr;

  const providerRows: ProviderRow[] = ((providers ?? []) as ProviderRecord[]).map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    bio: p.bio,
    is_active: p.is_active,
    service_ids: p.provider_services.map((ps) => ps.service_id),
    location_ids: p.provider_locations.map((pl) => pl.location_id),
    schedules: p.provider_schedules
      .map((schedule) => ({
        id: schedule.id,
        location_id: schedule.location_id,
        location_name: Array.isArray(schedule.locations)
          ? schedule.locations[0]?.name ?? null
          : schedule.locations?.name ?? null,
        weekday: schedule.weekday,
        start_time: schedule.start_time,
        end_time: schedule.end_time,
      }))
      .sort(
        (a, b) =>
          a.weekday - b.weekday ||
          a.start_time.localeCompare(b.start_time) ||
          (a.location_name ?? "").localeCompare(b.location_name ?? "")
      ),
  }));

  const serviceOptions: ServiceOption[] = (services ?? [])
    .filter((s) => s.is_active)
    .map((s) => ({ id: s.id, name: s.name }));
  const locationOptions: LocationOption[] = (locations ?? [])
    .filter((location) => location.is_active)
    .map((location) => ({ id: location.id, name: location.name }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Providers</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          The people who perform services. Each provider lists what they do and when they are available.
        </p>
      </div>
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error.message}
        </p>
      )}
      <ProvidersList providers={providerRows} services={serviceOptions} locations={locationOptions} />
    </div>
  );
}
