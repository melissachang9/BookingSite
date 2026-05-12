alter table public.customers
  add column stripe_customer_id text;

create unique index customers_stripe_customer_id_idx
  on public.customers(stripe_customer_id)
  where stripe_customer_id is not null;

alter table public.bookings
  add column stripe_customer_id text,
  add column no_show_fee_payment_method_id text,
  add column no_show_fee_payment_intent_id text,
  add column no_show_fee_charged_at timestamptz,
  add column no_show_fee_charge_error text;

update public.tenants
set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object(
  'auto_charge_no_show_fee', false
)
where not (coalesce(settings_json, '{}'::jsonb) ? 'auto_charge_no_show_fee');

alter table public.tenants
  alter column settings_json set default jsonb_build_object(
    'cancellation_window_hours', 24,
    'refund_inside_window', false,
    'default_deposit_cents', 2500,
    'reminder_hours_before', 24,
    'no_show_fee_cents', 0,
    'min_lead_time_minutes', 60,
    'max_advance_booking_days', 90,
    'auto_charge_no_show_fee', false
  );