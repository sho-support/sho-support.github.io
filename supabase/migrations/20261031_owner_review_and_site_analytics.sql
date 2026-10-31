-- Production additions: owner review checklist, checkout add-on consultations,
-- and aggregate pageviews counted only after publication.
alter table public.website_orders add column if not exists extra_request text;

create table if not exists public.website_review_issues(
  id bigint generated always as identity primary key,
  site_id text not null references public.website_sites(site_id) on delete cascade,
  note text not null check(char_length(note) between 1 and 5000),
  status text not null default 'fixing' check(status in('fixing','ready_for_check','confirmed')),
  job_id bigint references public.website_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index if not exists website_review_issues_site_status_idx
  on public.website_review_issues(site_id,status,created_at);
alter table public.website_review_issues enable row level security;
revoke all on public.website_review_issues from anon,authenticated;

create table if not exists public.website_pageviews(
  site_id text not null references public.website_sites(site_id) on delete cascade,
  view_date date not null,
  views bigint not null default 0 check(views>=0),
  primary key(site_id,view_date)
);
alter table public.website_pageviews enable row level security;
revoke all on public.website_pageviews from anon,authenticated;
create or replace function public.record_website_pageview(p_site_id text,p_day date)
returns void language plpgsql security invoker set search_path=public as $$
begin
 insert into public.website_pageviews(site_id,view_date,views)
 select site_id,p_day,1 from public.website_sites
 where site_id=p_site_id and status='live' and published_at is not null
 on conflict(site_id,view_date)
 do update set views=website_pageviews.views+1;
end $$;
revoke all on function public.record_website_pageview(text,date) from public,anon,authenticated;
grant execute on function public.record_website_pageview(text,date) to service_role;
