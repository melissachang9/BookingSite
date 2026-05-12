-- 0008_notification_log.sql
-- Reminder audit + dedupe table.

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  kind text not null,
  channel text not null check (channel in ('email', 'sms')),
  recipient text,
  status text not null check (status in ('sent', 'failed')),
  provider_message_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notification_log_tenant_idx on public.notification_log(tenant_id);
create index notification_log_booking_idx on public.notification_log(booking_id);
create index notification_log_kind_idx on public.notification_log(kind, created_at desc);

create unique index notification_log_sent_unique_idx
  on public.notification_log(booking_id, kind, channel)
  where status = 'sent';

alter table public.notification_log enable row level security;

create policy notification_log_staff_all on public.notification_log
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());
