alter table public.bookings
  add column tip_cents integer not null default 0,
  add column wallet_applied_cents integer not null default 0,
  add constraint bookings_tip_cents_nonnegative check (tip_cents >= 0),
  add constraint bookings_wallet_applied_cents_nonnegative check (wallet_applied_cents >= 0);

create table public.customer_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  amount_cents integer not null,
  reason text not null check (
    reason in (
      'manual_credit',
      'checkout_applied',
      'refund_credit',
      'gift_card',
      'membership_credit',
      'package_credit',
      'referral_credit'
    )
  ),
  note text,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (amount_cents <> 0)
);

create index customer_wallet_ledger_tenant_customer_idx
  on public.customer_wallet_ledger(tenant_id, customer_id, created_at desc);

create index customer_wallet_ledger_booking_idx
  on public.customer_wallet_ledger(booking_id);

alter table public.customer_wallet_ledger enable row level security;

create policy customer_wallet_ledger_staff_all on public.customer_wallet_ledger
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy customer_wallet_ledger_customer_select on public.customer_wallet_ledger
  for select to authenticated
  using (
    customer_id in (
      select id from public.customers where auth_user_id = auth.uid()
    )
  );