-- 0006_form_attachments.sql
-- BookingSite v1.x — file/photo upload + drawn-signature support for intake forms.
--
-- Design:
--   form_response_attachments — one row per uploaded file or signature PNG.
--     Created at upload time (linked to a booking_draft_id), then linked to a
--     form_response when the form is submitted. After payment, draft is promoted
--     and we copy/migrate the booking_id link in the same place we promote.
--
-- Storage:
--   bucket  = "form-uploads" (private)
--   path    = "<tenant_id>/<draft_id>/<attachment_id>.<ext>"
--   access  = service-role only via admin client; signed URLs for staff display.

create table public.form_response_attachments (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- Exactly one of (booking_draft_id, booking_id) is set initially. After
  -- promotion, the row is updated to point to booking_id.
  booking_draft_id uuid references public.booking_drafts(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  -- Once form is submitted, the response link is set so we can find attachments
  -- per response.
  form_response_id uuid references public.form_responses(id) on delete cascade,
  -- The form field this attachment answers. Matches FormField.id in schema_json.
  field_id text not null,
  kind text not null check (kind in ('file', 'signature_png')),
  storage_path text not null unique,
  mime_type text,
  file_size_bytes integer,
  original_filename text,
  created_at timestamptz not null default now(),
  check ((booking_draft_id is null) <> (booking_id is null))
);

create index fra_tenant_idx on public.form_response_attachments(tenant_id);
create index fra_draft_idx on public.form_response_attachments(booking_draft_id);
create index fra_booking_idx on public.form_response_attachments(booking_id);
create index fra_response_idx on public.form_response_attachments(form_response_id);

alter table public.form_response_attachments enable row level security;

create policy fra_staff_all on public.form_response_attachments
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Storage bucket — private. All reads/writes go through service-role admin client.
insert into storage.buckets (id, name, public)
values ('form-uploads', 'form-uploads', false)
on conflict (id) do nothing;
