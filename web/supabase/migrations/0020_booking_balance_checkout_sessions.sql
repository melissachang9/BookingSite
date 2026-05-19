alter table public.bookings
  add column balance_checkout_stripe_session_id text,
  add column balance_checkout_session_expires_at timestamptz;

create index bookings_balance_checkout_session_idx
  on public.bookings(balance_checkout_stripe_session_id)
  where balance_checkout_stripe_session_id is not null;