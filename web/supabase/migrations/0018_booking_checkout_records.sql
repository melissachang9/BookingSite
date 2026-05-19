alter table public.bookings
  add column checkout_record_json jsonb not null default jsonb_build_object(
    'version', 1,
    'events', '[]'::jsonb,
    'latest_event', null
  );