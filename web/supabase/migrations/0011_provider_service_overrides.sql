alter table public.provider_services
  add column price_cents_override integer,
  add column deposit_cents_override integer,
  add column duration_minutes_override integer;

alter table public.provider_services
  add constraint provider_services_price_override_nonnegative
    check (price_cents_override is null or price_cents_override >= 0),
  add constraint provider_services_deposit_override_nonnegative
    check (deposit_cents_override is null or deposit_cents_override >= 0),
  add constraint provider_services_duration_override_positive
    check (duration_minutes_override is null or (duration_minutes_override > 0 and duration_minutes_override <= 600)),
  add constraint provider_services_deposit_override_lte_price_override
    check (
      price_cents_override is null
      or deposit_cents_override is null
      or deposit_cents_override <= price_cents_override
    );

alter table public.booking_drafts
  add column price_cents integer,
  add column deposit_cents integer,
  add column duration_minutes integer;

update public.booking_drafts draft
set
  price_cents = service.price_cents,
  deposit_cents = service.deposit_cents,
  duration_minutes = service.duration_minutes
from public.services service
where service.id = draft.service_id;

alter table public.booking_drafts
  alter column price_cents set not null,
  alter column deposit_cents set not null,
  alter column duration_minutes set not null,
  add constraint booking_drafts_price_nonnegative check (price_cents >= 0),
  add constraint booking_drafts_deposit_nonnegative check (deposit_cents >= 0),
  add constraint booking_drafts_deposit_lte_price check (deposit_cents <= price_cents),
  add constraint booking_drafts_duration_positive check (duration_minutes > 0 and duration_minutes <= 600);