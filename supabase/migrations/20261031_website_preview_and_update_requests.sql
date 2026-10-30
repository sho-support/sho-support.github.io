-- Mirrors the live database changes deployed on 2026-10-31.
-- Safe to reapply to an existing installation.

alter table public.website_sites
  add column if not exists preview_access_token_hash text,
  add column if not exists preview_token_issued_at timestamptz,
  add column if not exists update_free_until timestamptz;

create table if not exists public.website_update_requests (
  id bigint generated always as identity primary key,
  site_id text not null references public.website_sites(site_id) on delete cascade,
  request_note text not null,
  files jsonb not null default '{}'::jsonb,
  billing_category text not null check (billing_category in
    ('free_monthly','free_adjustment_review','estimate_required')),
  status text not null default 'pending_sho' check (status in
    ('pending_sho','queued','building','completed','cancelled')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists website_update_requests_site_date
  on public.website_update_requests(site_id, created_at desc);

alter table public.website_update_requests enable row level security;

drop policy if exists website_update_requests_read on public.website_update_requests;
create policy website_update_requests_read
  on public.website_update_requests
  for select to authenticated
  using (public.has_website_site_access(site_id));

-- Customer upload files must remain private, restricted to images and 7MB per file.
update storage.buckets
set file_size_limit = 7000000,
    allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','image/gif','image/avif'
    ]::text[]
where id = 'website-intake-files';
