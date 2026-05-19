alter table public.form_responses
  add column filled_by_user_id uuid references public.users(id) on delete set null;

create index form_responses_filled_by_user_idx
  on public.form_responses(filled_by_user_id);

do $$
declare
  constraint_name text;
begin
  select conname
    into constraint_name
  from pg_constraint
  where conrelid = 'public.form_responses'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%booking_draft_id%'
    and pg_get_constraintdef(oid) ilike '%booking_id%';

  if constraint_name is not null then
    execute format('alter table public.form_responses drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.form_responses
  add constraint form_responses_context_check
  check (
    booking_draft_id is null
    or booking_id is null
  ),
  add constraint form_responses_has_context_check
  check (
    booking_draft_id is not null
    or booking_id is not null
    or customer_id is not null
  );

alter table public.form_response_attachments
  add column customer_id uuid references public.customers(id) on delete set null,
  add column upload_session_id uuid;

create index fra_customer_idx on public.form_response_attachments(customer_id);
create index fra_upload_session_idx on public.form_response_attachments(upload_session_id);

do $$
declare
  constraint_name text;
begin
  select conname
    into constraint_name
  from pg_constraint
  where conrelid = 'public.form_response_attachments'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%booking_draft_id%'
    and pg_get_constraintdef(oid) ilike '%booking_id%';

  if constraint_name is not null then
    execute format('alter table public.form_response_attachments drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.form_response_attachments
  add constraint form_response_attachments_context_check
  check (
    booking_draft_id is null
    or booking_id is null
  ),
  add constraint form_response_attachments_has_context_check
  check (
    booking_draft_id is not null
    or booking_id is not null
    or customer_id is not null
  );