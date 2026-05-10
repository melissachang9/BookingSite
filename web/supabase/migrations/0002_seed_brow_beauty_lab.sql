-- 0002_seed_brow_beauty_lab.sql
-- Seed the first design-partner tenant.
-- Idempotent: safe to re-run.

insert into public.tenants (slug, name, timezone, branding_json)
values (
  'brow-beauty-lab',
  'Brow Beauty Lab',
  'America/Los_Angeles',
  jsonb_build_object('primary_color', '#8B5A3C')
)
on conflict (slug) do nothing;
