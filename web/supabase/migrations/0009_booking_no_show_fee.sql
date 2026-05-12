alter table public.bookings
  add column assessed_no_show_fee_cents integer;

alter table public.bookings
  add constraint bookings_assessed_no_show_fee_cents_check
  check (assessed_no_show_fee_cents is null or assessed_no_show_fee_cents >= 0);