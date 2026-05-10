-- 0003_services_and_providers.sql
-- BookingSite v1 — service catalog, providers, schedules, time off.
-- All tenant-scoped with RLS. Public-readable subset for the booking site.

-- =========================================================================
-- services
-- =========================================================================
create table public.services (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 600),
  price_cents integer not null check (price_cents >= 0),
  deposit_cents integer not null default 0 check (deposit_cents >= 0 and deposit_cents <= price_cents),
  is_active boolean not null default true,
  -- buffer before/after appointment in minutes (cleanup, prep, etc.)
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes >= 0),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index services_tenant_id_idx on public.services(tenant_id);
create index services_tenant_active_idx on public.services(tenant_id, is_active);

create trigger services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

-- =========================================================================
-- providers (people who perform services)
-- =========================================================================
create table public.providers (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Optional link to a user account (if provider also logs in as staff).
  user_id uuid references public.users(id) on delete set null,
  name text not null,
  email text,
  bio text,
  avatar_url text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index providers_tenant_id_idx on public.providers(tenant_id);
create index providers_user_id_idx on public.providers(user_id);

create trigger providers_set_updated_at
  before update on public.providers
  for each row execute function public.set_updated_at();

-- =========================================================================
-- provider_services (junction: which providers can do which services)
-- =========================================================================
create table public.provider_services (
  provider_id uuid not null references public.providers(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  -- Denormalize tenant_id for RLS (must match across both sides).
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  primary key (provider_id, service_id)
);

create index provider_services_service_id_idx on public.provider_services(service_id);
create index provider_services_tenant_id_idx on public.provider_services(tenant_id);

-- =========================================================================
-- provider_schedules (recurring weekly availability)
-- =========================================================================
-- weekday: 0 = Sunday, 6 = Saturday (matches Postgres EXTRACT(DOW))
create table public.provider_schedules (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time)
);

create index provider_schedules_provider_idx on public.provider_schedules(provider_id);
create index provider_schedules_tenant_idx on public.provider_schedules(tenant_id);

create trigger provider_schedules_set_updated_at
  before update on public.provider_schedules
  for each row execute function public.set_updated_at();

-- =========================================================================
-- provider_time_off (one-off blocks)
-- =========================================================================
create table public.provider_time_off (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create index provider_time_off_provider_idx on public.provider_time_off(provider_id);
create index provider_time_off_range_idx on public.provider_time_off(provider_id, starts_at, ends_at);

create trigger provider_time_off_set_updated_at
  before update on public.provider_time_off
  for each row execute function public.set_updated_at();

-- =========================================================================
-- RLS
-- =========================================================================
alter table public.services enable row level security;
alter table public.providers enable row level security;
alter table public.provider_services enable row level security;
alter table public.provider_schedules enable row level security;
alter table public.provider_time_off enable row level security;

-- Staff: full access within tenant.
create policy services_staff_all on public.services
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy providers_staff_all on public.providers
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy provider_services_staff_all on public.provider_services
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy provider_schedules_staff_all on public.provider_schedules
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy provider_time_off_staff_all on public.provider_time_off
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Public (anon) read access — required for the booking site to render service/provider lists.
-- Only active rows, only safe columns. We keep all columns visible since no PII lives here;
-- if that changes (e.g. staff cost rates), narrow with a view.
create policy services_public_read on public.services
  for select to anon
  using (is_active = true);

create policy providers_public_read on public.providers
  for select to anon
  using (is_active = true);

create policy provider_services_public_read on public.provider_services
  for select to anon
  using (true);

create policy provider_schedules_public_read on public.provider_schedules
  for select to anon
  using (true);

-- time_off intentionally NOT exposed to anon; availability engine runs server-side.

-- Authenticated users (customers logging in via magic link) get the same public read.
create policy services_auth_read on public.services
  for select to authenticated
  using (is_active = true or tenant_id = public.current_tenant_id());

create policy providers_auth_read on public.providers
  for select to authenticated
  using (is_active = true or tenant_id = public.current_tenant_id());

create policy provider_services_auth_read on public.provider_services
  for select to authenticated
  using (true);

create policy provider_schedules_auth_read on public.provider_schedules
  for select to authenticated
  using (true);

-- =========================================================================
-- Cross-tenant integrity check: provider_services must not link across tenants.
-- =========================================================================
create or replace function public.assert_provider_services_same_tenant()
returns trigger
language plpgsql
as $$
declare
  v_provider_tenant uuid;
  v_service_tenant uuid;
begin
  select tenant_id into v_provider_tenant from public.providers where id = new.provider_id;
  select tenant_id into v_service_tenant from public.services where id = new.service_id;
  if v_provider_tenant is null or v_service_tenant is null then
    raise exception 'provider or service not found';
  end if;
  if v_provider_tenant <> v_service_tenant then
    raise exception 'provider and service belong to different tenants';
  end if;
  if new.tenant_id <> v_provider_tenant then
    raise exception 'tenant_id mismatch on provider_services';
  end if;
  return new;
end;
$$;

create trigger provider_services_tenant_check
  before insert or update on public.provider_services
  for each row execute function public.assert_provider_services_same_tenant();
