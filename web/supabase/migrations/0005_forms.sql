-- 0005_forms.sql
-- BookingSite v1 — intake forms (builder, versioning, responses).
--
-- Design:
--   forms          — a named form template per tenant (e.g. "Brow Lamination Intake")
--   form_versions  — immutable snapshots of form schema. Editing a form creates a new version.
--                    Existing responses always reference a specific version, so old data
--                    keeps its original schema even after the form is edited.
--   form_responses — a customer's answers to one form_version, tied to a draft or booking.
--   service_forms  — many-to-many link of which forms are required for which services.
--
-- Schema for fields lives in form_versions.schema_json as a JSON array:
--   [
--     { "id": "q1", "type": "short_text", "label": "Allergies?", "required": true },
--     { "id": "q2", "type": "long_text",  "label": "Goals",       "required": false },
--     { "id": "q3", "type": "select",     "label": "Skin type",   "required": true,
--       "options": ["Dry", "Oily", "Combo", "Sensitive"] },
--     { "id": "q4", "type": "checkbox",   "label": "I consent to the policies", "required": true }
--   ]
-- Supported field types in v1: short_text, long_text, select, checkbox.
-- File upload comes in v1.x.

create table public.forms (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  -- Pointer to the latest version. Null until first version is created.
  current_version_id uuid,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index forms_tenant_idx on public.forms(tenant_id);

create trigger forms_set_updated_at
  before update on public.forms
  for each row execute function public.set_updated_at();

create table public.form_versions (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  form_id uuid not null references public.forms(id) on delete cascade,
  version_number integer not null,
  schema_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (form_id, version_number)
);

create index form_versions_form_idx on public.form_versions(form_id);
create index form_versions_tenant_idx on public.form_versions(tenant_id);

-- Forward-FK from forms.current_version_id (added after form_versions exists).
alter table public.forms
  add constraint forms_current_version_fk
  foreign key (current_version_id) references public.form_versions(id) on delete set null;

create table public.form_responses (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  form_version_id uuid not null references public.form_versions(id) on delete restrict,
  -- Exactly one of (booking_draft_id, booking_id) is set.
  booking_draft_id uuid references public.booking_drafts(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  -- answers_json: { "<field_id>": <value> }, value type depends on field type.
  answers_json jsonb not null,
  submitted_at timestamptz not null default now(),
  check ((booking_draft_id is null) <> (booking_id is null))
);

create index form_responses_tenant_idx on public.form_responses(tenant_id);
create index form_responses_draft_idx on public.form_responses(booking_draft_id);
create index form_responses_booking_idx on public.form_responses(booking_id);
create index form_responses_customer_idx on public.form_responses(customer_id);

-- Now that form_versions exists we can add the FK columns on booking_form_requirements.
-- (We declared them in 0004 as plain uuid; add the FKs now.)
alter table public.booking_form_requirements
  add constraint bfr_form_id_fk
  foreign key (form_id) references public.forms(id) on delete cascade,
  add constraint bfr_form_version_id_fk
  foreign key (form_version_id) references public.form_versions(id) on delete restrict,
  add constraint bfr_response_id_fk
  foreign key (satisfied_by_response_id) references public.form_responses(id) on delete set null;

-- service_forms: which forms are required for which services. Required forms become
-- booking_form_requirements rows when a draft is created.
create table public.service_forms (
  service_id uuid not null references public.services(id) on delete cascade,
  form_id uuid not null references public.forms(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (service_id, form_id)
);

create index service_forms_tenant_idx on public.service_forms(tenant_id);
create index service_forms_form_idx on public.service_forms(form_id);

-- Cross-tenant integrity: service and form must be in the same tenant.
create or replace function public.assert_service_forms_same_tenant()
returns trigger
language plpgsql
as $$
declare
  v_service_tenant uuid;
  v_form_tenant uuid;
begin
  select tenant_id into v_service_tenant from public.services where id = new.service_id;
  select tenant_id into v_form_tenant from public.forms where id = new.form_id;
  if v_service_tenant is null or v_form_tenant is null then
    raise exception 'service or form not found';
  end if;
  if v_service_tenant <> v_form_tenant or new.tenant_id <> v_service_tenant then
    raise exception 'tenant mismatch on service_forms';
  end if;
  return new;
end;
$$;

create trigger service_forms_tenant_check
  before insert or update on public.service_forms
  for each row execute function public.assert_service_forms_same_tenant();

-- =========================================================================
-- RLS
-- =========================================================================
alter table public.forms enable row level security;
alter table public.form_versions enable row level security;
alter table public.form_responses enable row level security;
alter table public.service_forms enable row level security;

create policy forms_staff_all on public.forms
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy form_versions_staff_all on public.form_versions
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy form_responses_staff_all on public.form_responses
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy service_forms_staff_all on public.service_forms
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Customers: see only their own form responses.
create policy form_responses_customer_select on public.form_responses
  for select to authenticated
  using (
    customer_id in (select id from public.customers where auth_user_id = auth.uid())
  );

-- Public read of form_versions is needed so the booking-site form runtime can render fields.
-- We allow anon to select form_versions, but only the schema_json (no PII lives here).
create policy form_versions_public_read on public.form_versions
  for select to anon
  using (true);
create policy form_versions_auth_read on public.form_versions
  for select to authenticated
  using (true);

-- Public read of forms (just for name/description on the booking-site review screen).
create policy forms_public_read on public.forms
  for select to anon
  using (is_archived = false);
create policy forms_auth_read on public.forms
  for select to authenticated
  using (is_archived = false or tenant_id = public.current_tenant_id());

-- service_forms: public read so the booking-site can know which forms apply.
create policy service_forms_public_read on public.service_forms
  for select to anon
  using (true);
create policy service_forms_auth_read on public.service_forms
  for select to authenticated
  using (true);
