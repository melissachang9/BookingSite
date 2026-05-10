-- 0004_bookings.sql
-- BookingSite v1 — booking drafts, slot holds, confirmed bookings, form requirements (stub).
-- Forms tables are added in 0005; we forward-declare booking_form_requirements here so
-- the booking row knows its requirement set at draft time.

-- =========================================================================
-- booking_drafts: the customer's in-progress booking before payment
-- =========================================================================
-- Lifecycle: draft -> awaiting_form -> awaiting_payment -> (promoted to bookings row)
-- A draft is anonymous-creatable; the slot hold blocks the time until expires_at.
create type public.booking_draft_status as enum (
  'draft',
  'awaiting_form',
  'awaiting_payment',
  'promoted',
  'abandoned'
);

create table public.booking_drafts (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete restrict,
  provider_id uuid not null references public.providers(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.booking_draft_status not null default 'draft',
  -- Customer details captured before payment. Customer row is created/upserted on submit.
  customer_id uuid references public.customers(id) on delete set null,
  customer_email text,
  customer_name text,
  customer_phone text,
  -- Stripe Checkout session id (set when payment kicks off).
  stripe_session_id text,
  -- TTL for the slot hold; sweep job marks abandoned past this.
  expires_at timestamptz not null,
  promoted_booking_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create index booking_drafts_tenant_idx on public.booking_drafts(tenant_id);
create index booking_drafts_provider_time_idx on public.booking_drafts(provider_id, starts_at, ends_at);
create index booking_drafts_status_expires_idx on public.booking_drafts(status, expires_at);

create trigger booking_drafts_set_updated_at
  before update on public.booking_drafts
  for each row execute function public.set_updated_at();

-- =========================================================================
-- slot_holds: rows that block a provider's time during a draft
-- =========================================================================
-- Separate from booking_drafts so we can index/query holds independently.
-- One hold per draft.
create table public.slot_holds (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  booking_draft_id uuid not null unique references public.booking_drafts(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create index slot_holds_provider_time_idx on public.slot_holds(provider_id, starts_at, ends_at);
create index slot_holds_expires_idx on public.slot_holds(expires_at);

-- =========================================================================
-- bookings: confirmed appointments
-- =========================================================================
create type public.booking_status as enum (
  'confirmed',
  'completed',
  'canceled',
  'no_show'
);

create table public.bookings (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  provider_id uuid not null references public.providers(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.booking_status not null default 'confirmed',
  price_cents integer not null,
  deposit_cents integer not null,
  stripe_payment_intent_id text,
  stripe_session_id text,
  -- Magic-link token for customer cancellation/reschedule from email.
  cancel_token text not null default encode(gen_random_bytes(16), 'hex'),
  -- For audit: who created this booking. null = customer self-service via booking site.
  created_by_user_id uuid references public.users(id) on delete set null,
  canceled_at timestamptz,
  canceled_by_user_id uuid references public.users(id) on delete set null,
  cancel_reason text,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create index bookings_tenant_idx on public.bookings(tenant_id);
create index bookings_customer_idx on public.bookings(customer_id);
create index bookings_provider_time_idx on public.bookings(provider_id, starts_at, ends_at);
create index bookings_status_idx on public.bookings(tenant_id, status, starts_at);
create unique index bookings_cancel_token_idx on public.bookings(cancel_token);

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- =========================================================================
-- booking_form_requirements: which forms must be completed for a booking
-- =========================================================================
-- Created at draft time when service has attached forms. Satisfied when a matching
-- form_response is submitted. (form_responses table comes in 0005.)
create table public.booking_form_requirements (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_draft_id uuid references public.booking_drafts(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  form_id uuid not null,
  form_version_id uuid not null,
  satisfied_by_response_id uuid,
  created_at timestamptz not null default now(),
  -- Must point at exactly one of draft or booking.
  check ((booking_draft_id is null) <> (booking_id is null))
);

create index bfr_draft_idx on public.booking_form_requirements(booking_draft_id);
create index bfr_booking_idx on public.booking_form_requirements(booking_id);
create index bfr_tenant_idx on public.booking_form_requirements(tenant_id);

-- =========================================================================
-- RLS
-- =========================================================================
alter table public.booking_drafts enable row level security;
alter table public.slot_holds enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_form_requirements enable row level security;

-- Staff: full access within tenant.
create policy booking_drafts_staff_all on public.booking_drafts
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy slot_holds_staff_all on public.slot_holds
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy bookings_staff_all on public.bookings
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy bfr_staff_all on public.booking_form_requirements
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Authenticated customers: see only their own bookings.
create policy bookings_customer_select on public.bookings
  for select to authenticated
  using (
    customer_id in (
      select id from public.customers where auth_user_id = auth.uid()
    )
  );

-- Public (anon): no direct read of drafts, holds, or bookings.
-- All booking-site mutations go through Server Actions that use the service-role client,
-- which bypasses RLS but enforces tenant correctness in code.

-- =========================================================================
-- Slot conflict check: prevent overlapping confirmed bookings for same provider.
-- =========================================================================
-- Soft check via trigger; slot_holds are checked in app code at availability time.
create or replace function public.assert_no_booking_conflict()
returns trigger
language plpgsql
as $$
begin
  if new.status not in ('confirmed') then
    return new;
  end if;
  if exists (
    select 1 from public.bookings b
    where b.provider_id = new.provider_id
      and b.id <> new.id
      and b.status = 'confirmed'
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'time conflicts with existing booking';
  end if;
  return new;
end;
$$;

create trigger bookings_conflict_check
  before insert or update of starts_at, ends_at, provider_id, status on public.bookings
  for each row execute function public.assert_no_booking_conflict();
