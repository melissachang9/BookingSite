-- 0001_init.sql
-- BookingSite v1 — initial schema.
-- Tenancy + users + customers, with tenant-scoped RLS from day 1.

-- =========================================================================
-- Extensions
-- =========================================================================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =========================================================================
-- Helper: get current user's tenant_id from JWT app_metadata
-- =========================================================================
-- Operator/staff users have tenant_id set in their app_metadata at signup.
-- This function reads it on every RLS check.
create or replace function public.current_tenant_id()
returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      auth.jwt() -> 'app_metadata' ->> 'tenant_id',
      auth.jwt() ->> 'tenant_id'
    ),
    ''
  )::uuid;
$$;

create or replace function public.current_user_role()
returns text
language sql stable
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    'customer'
  );
$$;

-- =========================================================================
-- updated_at trigger helper
-- =========================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- tenants
-- =========================================================================
create table public.tenants (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'America/Los_Angeles',
  branding_json jsonb not null default '{}'::jsonb,
  -- Per-tenant configurable policies. All have platform defaults; tenant overrides in admin.
  settings_json jsonb not null default jsonb_build_object(
    'cancellation_window_hours', 24,
    'refund_inside_window', false,
    'default_deposit_cents', 2500,
    'reminder_hours_before', 24,
    'no_show_fee_cents', 0,
    'min_lead_time_minutes', 60,
    'max_advance_booking_days', 90
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

-- =========================================================================
-- users (operator/staff users; mirrors auth.users with tenant scoping + role)
-- =========================================================================
-- One row per staff member. PK is auth.users.id. tenant_id binds them to a tenant.
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  name text,
  role text not null default 'staff'
    check (role in ('owner','manager','staff','provider')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create index users_tenant_id_idx on public.users(tenant_id);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- =========================================================================
-- customers (end-customers booking appointments)
-- =========================================================================
create table public.customers (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- nullable: customer may exist before they create an auth account (CSV import)
  auth_user_id uuid references auth.users(id) on delete set null,
  email text not null,
  phone text,
  name text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create index customers_tenant_id_idx on public.customers(tenant_id);
create index customers_auth_user_id_idx on public.customers(auth_user_id);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- =========================================================================
-- RLS — enable on every table
-- =========================================================================
alter table public.tenants enable row level security;
alter table public.users enable row level security;
alter table public.customers enable row level security;

-- ----- tenants -----
-- Staff can see only their own tenant row.
create policy tenants_staff_select on public.tenants
  for select
  using (id = public.current_tenant_id());

-- Owners/managers can update their own tenant row.
create policy tenants_owner_update on public.tenants
  for update
  using (id = public.current_tenant_id() and public.current_user_role() in ('owner','manager'))
  with check (id = public.current_tenant_id());

-- ----- users -----
-- Staff can read all users in their tenant.
create policy users_staff_select on public.users
  for select
  using (tenant_id = public.current_tenant_id());

-- Owners/managers can manage users in their tenant.
create policy users_owner_write on public.users
  for all
  using (tenant_id = public.current_tenant_id() and public.current_user_role() in ('owner','manager'))
  with check (tenant_id = public.current_tenant_id());

-- ----- customers -----
-- Staff: full access within tenant.
create policy customers_staff_all on public.customers
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Customer: can see their own record (when logged in via magic link).
create policy customers_self_select on public.customers
  for select
  using (auth_user_id = auth.uid());

-- Customer: can update their own record.
create policy customers_self_update on public.customers
  for update
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());
