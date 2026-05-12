-- 0012_multi_location_foundation.sql
-- Introduce first-class locations while preserving the current single-location behavior.

-- =========================================================================
-- locations
-- =========================================================================
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  slug text not null,
  timezone text not null default 'America/Los_Angeles',
  phone text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state_region text,
  postal_code text,
  country_code text,
  is_active boolean not null default true,
  settings_json jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug),
  unique (id, tenant_id)
);

create index locations_tenant_id_idx on public.locations(tenant_id);
create index locations_tenant_active_idx on public.locations(tenant_id, is_active);

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

alter table public.tenants
  add column default_location_id uuid;

create index tenants_default_location_idx on public.tenants(default_location_id);

insert into public.locations (
  tenant_id,
  name,
  slug,
  timezone,
  settings_json,
  sort_order
)
select
  tenant.id,
  coalesce(nullif(tenant.name, ''), 'Main Location'),
  'main',
  tenant.timezone,
  jsonb_build_object('inherits_tenant_settings', true),
  0
from public.tenants tenant
on conflict (tenant_id, slug) do nothing;

update public.tenants tenant
set default_location_id = location.id
from public.locations location
where location.tenant_id = tenant.id
  and location.slug = 'main'
  and tenant.default_location_id is null;

alter table public.tenants
  add constraint tenants_default_location_same_tenant
    foreign key (default_location_id, id)
    references public.locations(id, tenant_id);

create or replace function public.ensure_tenant_default_location()
returns trigger
language plpgsql
as $$
declare
  v_location_id uuid;
begin
  if new.default_location_id is not null then
    return new;
  end if;

  insert into public.locations (
    tenant_id,
    name,
    slug,
    timezone,
    settings_json,
    sort_order
  )
  values (
    new.id,
    coalesce(nullif(new.name, ''), 'Main Location'),
    'main',
    new.timezone,
    jsonb_build_object('inherits_tenant_settings', true),
    0
  )
  on conflict (tenant_id, slug) do update
    set timezone = excluded.timezone
  returning id into v_location_id;

  update public.tenants
  set default_location_id = v_location_id
  where id = new.id
    and default_location_id is null;

  return new;
end;
$$;

create trigger tenants_ensure_default_location
  after insert on public.tenants
  for each row execute function public.ensure_tenant_default_location();

-- =========================================================================
-- Composite uniqueness for tenant-safe location mappings
-- =========================================================================
create unique index users_id_tenant_idx on public.users(id, tenant_id);
create unique index providers_id_tenant_idx on public.providers(id, tenant_id);
create unique index services_id_tenant_idx on public.services(id, tenant_id);

-- =========================================================================
-- Location assignment tables
-- =========================================================================
create table public.user_locations (
  user_id uuid not null,
  location_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, location_id),
  foreign key (user_id, tenant_id)
    references public.users(id, tenant_id) on delete cascade,
  foreign key (location_id, tenant_id)
    references public.locations(id, tenant_id) on delete cascade
);

create index user_locations_tenant_idx on public.user_locations(tenant_id);
create index user_locations_location_idx on public.user_locations(location_id);
create unique index user_locations_primary_idx
  on public.user_locations(user_id)
  where is_primary;

create table public.provider_locations (
  provider_id uuid not null,
  location_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (provider_id, location_id),
  foreign key (provider_id, tenant_id)
    references public.providers(id, tenant_id) on delete cascade,
  foreign key (location_id, tenant_id)
    references public.locations(id, tenant_id) on delete cascade
);

create index provider_locations_tenant_idx on public.provider_locations(tenant_id);
create index provider_locations_location_idx on public.provider_locations(location_id);
create unique index provider_locations_primary_idx
  on public.provider_locations(provider_id)
  where is_primary;

create table public.service_locations (
  service_id uuid not null,
  location_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (service_id, location_id),
  foreign key (service_id, tenant_id)
    references public.services(id, tenant_id) on delete cascade,
  foreign key (location_id, tenant_id)
    references public.locations(id, tenant_id) on delete cascade
);

create index service_locations_tenant_idx on public.service_locations(tenant_id);
create index service_locations_location_idx on public.service_locations(location_id);

insert into public.user_locations (user_id, location_id, tenant_id, is_primary)
select
  user_row.id,
  tenant.default_location_id,
  user_row.tenant_id,
  true
from public.users user_row
join public.tenants tenant on tenant.id = user_row.tenant_id
where tenant.default_location_id is not null
on conflict (user_id, location_id) do nothing;

insert into public.provider_locations (provider_id, location_id, tenant_id, is_primary)
select
  provider.id,
  tenant.default_location_id,
  provider.tenant_id,
  true
from public.providers provider
join public.tenants tenant on tenant.id = provider.tenant_id
where tenant.default_location_id is not null
on conflict (provider_id, location_id) do nothing;

insert into public.service_locations (service_id, location_id, tenant_id)
select
  service.id,
  tenant.default_location_id,
  service.tenant_id
from public.services service
join public.tenants tenant on tenant.id = service.tenant_id
where tenant.default_location_id is not null
on conflict (service_id, location_id) do nothing;

-- =========================================================================
-- Default location assignment for existing single-location writes
-- =========================================================================
create or replace function public.assign_tenant_default_location_id()
returns trigger
language plpgsql
as $$
begin
  if new.location_id is null then
    select default_location_id into new.location_id
    from public.tenants
    where id = new.tenant_id;
  end if;

  return new;
end;
$$;

-- =========================================================================
-- Location-aware schedules, holds, drafts, and bookings
-- =========================================================================
alter table public.provider_schedules
  add column location_id uuid;

update public.provider_schedules schedule
set location_id = tenant.default_location_id
from public.tenants tenant
where tenant.id = schedule.tenant_id
  and schedule.location_id is null;

create trigger provider_schedules_assign_default_location
  before insert or update of tenant_id, location_id on public.provider_schedules
  for each row execute function public.assign_tenant_default_location_id();

alter table public.provider_schedules
  add constraint provider_schedules_location_same_tenant
    foreign key (location_id, tenant_id)
    references public.locations(id, tenant_id),
  alter column location_id set not null;

create index provider_schedules_location_idx on public.provider_schedules(location_id);

alter table public.provider_time_off
  add column location_id uuid,
  add constraint provider_time_off_location_same_tenant
    foreign key (location_id, tenant_id)
    references public.locations(id, tenant_id);

create index provider_time_off_location_idx
  on public.provider_time_off(location_id, starts_at, ends_at);

comment on column public.provider_time_off.location_id is
  'Null means the time-off block applies across all assigned locations for the provider.';

alter table public.booking_drafts
  add column location_id uuid;

update public.booking_drafts draft
set location_id = tenant.default_location_id
from public.tenants tenant
where tenant.id = draft.tenant_id
  and draft.location_id is null;

create trigger booking_drafts_assign_default_location
  before insert or update of tenant_id, location_id on public.booking_drafts
  for each row execute function public.assign_tenant_default_location_id();

alter table public.booking_drafts
  add constraint booking_drafts_location_same_tenant
    foreign key (location_id, tenant_id)
    references public.locations(id, tenant_id),
  alter column location_id set not null;

create index booking_drafts_location_idx
  on public.booking_drafts(location_id, starts_at, ends_at);

alter table public.slot_holds
  add column location_id uuid;

update public.slot_holds hold
set location_id = tenant.default_location_id
from public.tenants tenant
where tenant.id = hold.tenant_id
  and hold.location_id is null;

create trigger slot_holds_assign_default_location
  before insert or update of tenant_id, location_id on public.slot_holds
  for each row execute function public.assign_tenant_default_location_id();

alter table public.slot_holds
  add constraint slot_holds_location_same_tenant
    foreign key (location_id, tenant_id)
    references public.locations(id, tenant_id),
  alter column location_id set not null;

create index slot_holds_location_idx
  on public.slot_holds(location_id, starts_at, ends_at);

alter table public.bookings
  add column location_id uuid;

update public.bookings booking
set location_id = tenant.default_location_id
from public.tenants tenant
where tenant.id = booking.tenant_id
  and booking.location_id is null;

create trigger bookings_assign_default_location
  before insert or update of tenant_id, location_id on public.bookings
  for each row execute function public.assign_tenant_default_location_id();

alter table public.bookings
  add constraint bookings_location_same_tenant
    foreign key (location_id, tenant_id)
    references public.locations(id, tenant_id),
  alter column location_id set not null;

create index bookings_location_idx
  on public.bookings(location_id, starts_at, ends_at);

-- =========================================================================
-- RLS
-- =========================================================================
alter table public.locations enable row level security;
alter table public.user_locations enable row level security;
alter table public.provider_locations enable row level security;
alter table public.service_locations enable row level security;

create policy locations_staff_all on public.locations
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy user_locations_staff_all on public.user_locations
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy provider_locations_staff_all on public.provider_locations
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy service_locations_staff_all on public.service_locations
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy locations_public_read on public.locations
  for select to anon
  using (is_active = true);

create policy provider_locations_public_read on public.provider_locations
  for select to anon
  using (true);

create policy service_locations_public_read on public.service_locations
  for select to anon
  using (true);

create policy locations_auth_read on public.locations
  for select to authenticated
  using (is_active = true or tenant_id = public.current_tenant_id());

create policy provider_locations_auth_read on public.provider_locations
  for select to authenticated
  using (true);

create policy service_locations_auth_read on public.service_locations
  for select to authenticated
  using (true);