alter table public.tenants
  alter column settings_json set default jsonb_build_object(
    'cancellation_window_hours', 24,
    'refund_inside_window', false,
    'default_deposit_cents', 2500,
    'reminder_hours_before', 24,
    'no_show_fee_cents', 0,
    'min_lead_time_minutes', 60,
    'max_advance_booking_days', 90,
    'auto_charge_no_show_fee', false,
    'payment_link_expiry_minutes', 45
  );

update public.tenants
set settings_json = settings_json || jsonb_build_object(
  'auto_charge_no_show_fee', coalesce(settings_json -> 'auto_charge_no_show_fee', to_jsonb(false)),
  'payment_link_expiry_minutes', coalesce(settings_json -> 'payment_link_expiry_minutes', to_jsonb(45))
)
where not (
  settings_json ? 'auto_charge_no_show_fee'
  and settings_json ? 'payment_link_expiry_minutes'
);