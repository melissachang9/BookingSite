alter table public.booking_drafts
  add column booking_method text not null default 'customer_self_service',
  add column source_channel text,
  add column deposit_status text not null default 'unpaid',
  add column confirmation_requested boolean not null default true,
  add column created_by_user_id uuid references public.users(id) on delete set null;

alter table public.bookings
  add column booking_method text not null default 'customer_self_service',
  add column source_channel text,
  add column deposit_status text not null default 'unpaid',
  add column confirmation_requested boolean not null default true,
  add column confirmation_delivery_status text not null default 'unknown',
  add column confirmation_sent_at timestamptz,
  add column confirmation_send_count integer not null default 0,
  add column confirmation_last_error text;

alter table public.bookings
  add constraint bookings_confirmation_send_count_check
  check (confirmation_send_count >= 0);

create index booking_drafts_payment_state_idx
  on public.booking_drafts(tenant_id, deposit_status, status);

create index bookings_payment_state_idx
  on public.bookings(tenant_id, deposit_status, starts_at desc);

create index bookings_method_idx
  on public.bookings(tenant_id, booking_method, starts_at desc);

update public.booking_drafts
set
  booking_method = coalesce(nullif(booking_method, ''), 'customer_self_service'),
  source_channel = coalesce(source_channel, 'online_booking'),
  confirmation_requested = coalesce(confirmation_requested, true),
  deposit_status = case
    when status = 'awaiting_payment' then 'awaiting_payment'
    when status = 'abandoned' and stripe_session_id is not null then 'expired_unpaid'
    when status = 'promoted' then case
      when coalesce(deposit_cents, 0) > 0 and coalesce(deposit_cents, 0) < coalesce(price_cents, 0)
        then 'deposit_paid'
      else 'paid_in_full'
    end
    else 'unpaid'
  end;

update public.bookings
set
  booking_method = case
    when created_by_user_id is null then 'customer_self_service'
    else 'staff_entered'
  end,
  source_channel = coalesce(
    source_channel,
    case when created_by_user_id is null then 'online_booking' else null end
  ),
  confirmation_requested = coalesce(confirmation_requested, true),
  deposit_status = case
    when stripe_refund_id is not null or coalesce(refunded_amount_cents, 0) > 0 then 'refunded'
    when stripe_payment_intent_id is null then 'unpaid'
    when coalesce(deposit_cents, 0) > 0 and coalesce(deposit_cents, 0) < coalesce(price_cents, 0)
      then 'deposit_paid'
    else 'paid_in_full'
  end,
  confirmation_delivery_status = coalesce(nullif(confirmation_delivery_status, ''), 'unknown'),
  confirmation_send_count = greatest(coalesce(confirmation_send_count, 0), 0);