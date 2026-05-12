-- 0007_booking_refunds.sql
-- Track Stripe refunds issued when bookings are canceled.

alter table public.bookings
  add column stripe_refund_id text,
  add column refunded_at timestamptz,
  add column refunded_amount_cents integer;

create unique index bookings_stripe_refund_id_idx
  on public.bookings(stripe_refund_id)
  where stripe_refund_id is not null;
