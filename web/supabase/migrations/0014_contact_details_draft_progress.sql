alter table public.booking_drafts
  add column draft_contact_details_json jsonb,
  add column draft_contact_details_saved_at timestamptz;