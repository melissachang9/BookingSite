alter table public.booking_form_requirements
  add column draft_answers_json jsonb,
  add column draft_saved_at timestamptz;