-- Preserve the published Pages branch during customer update production.
-- Preview changes remain in a distinct branch until explicit approval.
alter table public.website_sites
  add column if not exists preview_branch text;
