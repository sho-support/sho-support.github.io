-- Additive, initially disabled. Never writes/deletes Storage metadata or customer files.
create table public.website_resource_limits (
  id boolean primary key default true check(id),
  upload_enabled boolean not null default false,
  ai_enabled boolean not null default false,
  upload_bucket_bytes bigint not null default 800000000 check(upload_bucket_bytes between 7000000 and 1000000000),
  upload_site_bytes bigint not null default 400000000 check(upload_site_bytes between 7000000 and 1000000000),
  ai_job_micro_usd bigint not null default 2000000 check(ai_job_micro_usd between 1 and 100000000),
  ai_site_month_micro_usd bigint not null default 4000000 check(ai_site_month_micro_usd between 1 and 100000000),
  ai_day_micro_usd bigint not null default 3000000 check(ai_day_micro_usd between 1 and 100000000),
  ai_month_micro_usd bigint not null default 10000000 check(ai_month_micro_usd between 1 and 100000000),
  pricing_checked_on date not null default date '2026-11-12'
);
insert into public.website_resource_limits(id) values(true);
create table public.website_upload_reservations (
  reservation_id uuid primary key,
  site_id text not null references public.website_sites(site_id),
  object_path text not null unique,
  reserved_bytes bigint not null default 7000000 check(reserved_bytes=7000000),
  created_at timestamptz not null default clock_timestamp()
);
create index website_upload_reservations_site_time on public.website_upload_reservations(site_id,created_at);
create index website_upload_reservations_time on public.website_upload_reservations(created_at);
-- Every issued path stays reserved at the BUCKET maximum, even after failures/expiry/deletion.
-- A signed URL can have an uncertain result; time passing alone is never a safe refund.
create table public.website_ai_charges (
  request_id uuid primary key,
  job_id bigint not null references public.website_jobs(id),
  site_id text not null references public.website_sites(site_id),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  model text not null check(model='gpt-6.1-sol'),
  input_bound integer not null check(input_bound between 8192 and 208192),
  output_bound integer not null check(output_bound between 1 and 16000),
  reserved_micro_usd bigint not null,
  charged_micro_usd bigint not null,
  state text not null default 'reserved' check(state in ('reserved','settled','uncertain')),
  response_id text,
  input_tokens integer, output_tokens integer,
  created_at timestamptz not null default clock_timestamp(), settled_at timestamptz
);
create index website_ai_charges_job on public.website_ai_charges(job_id);
create index website_ai_charges_site_time on public.website_ai_charges(site_id,created_at);
create index website_ai_charges_time on public.website_ai_charges(created_at);
create index website_ai_charges_pending on public.website_ai_charges(created_at) where state<>'settled';
alter table public.website_resource_limits enable row level security;
alter table public.website_upload_reservations enable row level security;
alter table public.website_ai_charges enable row level security;
revoke all on public.website_resource_limits,public.website_upload_reservations,public.website_ai_charges from public,anon,authenticated;
grant select,insert,update on public.website_resource_limits,public.website_upload_reservations,public.website_ai_charges to service_role;
-- This one public boolean supports RLS without a SECURITY DEFINER function or private budget exposure.
grant select(upload_enabled) on public.website_resource_limits to authenticated;
create policy website_resource_flag_read on public.website_resource_limits for select to authenticated using(true);
-- Restrictive policies intersect with existing ownership policies. Other buckets are unaffected.
create policy website_intake_server_insert on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'website-intake-files' or coalesce((select not upload_enabled from public.website_resource_limits),false));
create policy website_intake_server_update on storage.objects as restrictive for update to authenticated
using(bucket_id<>'website-intake-files' or coalesce((select not upload_enabled from public.website_resource_limits),false))
with check(bucket_id<>'website-intake-files' or coalesce((select not upload_enabled from public.website_resource_limits),false));

create function public.website_upload_reserve(p_site text,p_id uuid,p_folder text,p_name text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.website_resource_limits%rowtype; v_path text; v_total bigint; v_site bigint;
begin
  select * into strict l from public.website_resource_limits where id for update nowait;
  if not l.upload_enabled then raise exception 'UPLOAD_DISABLED'; end if;
  if p_id is null or p_site is null or p_site !~ '^[A-Za-z0-9_-]{3,32}$' or p_folder is null
    or p_folder not in ('top_photos','gallery_photos','logo_file','member_photos') or p_name is null
    or length(p_name)>100 or p_name !~ '^[A-Za-z0-9_-][A-Za-z0-9._-]*\.(jpg|jpeg|png|webp|gif|avif)$' then raise exception 'UPLOAD_INVALID'; end if;
  if not exists(select 1 from public.website_sites where site_id=p_site and status in ('request_waiting','live')) then raise exception 'UPLOAD_STATE'; end if;
  if (select count(*) from public.website_upload_reservations where site_id=p_site and created_at>clock_timestamp()-interval '1 hour')>=60
    or (select count(*) from public.website_upload_reservations where site_id=p_site and created_at>clock_timestamp()-interval '1 day')>=80
    or (select count(*) from public.website_upload_reservations where created_at>clock_timestamp()-interval '1 day')>=160 then raise exception 'UPLOAD_RATE_LIMIT'; end if;
  -- Storage is READ ONLY. Legacy/untracked objects also count; never delete them here.
  select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]+$' then greatest((o.metadata->>'size')::numeric,1) else 7000000 end),0)
    into v_total from storage.objects o where o.bucket_id='website-intake-files'
    and not exists(select 1 from public.website_upload_reservations r where r.object_path=o.name);
  select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]+$' then greatest((o.metadata->>'size')::numeric,1) else 7000000 end),0)
    into v_site from storage.objects o where o.bucket_id='website-intake-files' and split_part(o.name,'/',1)=p_site
    and not exists(select 1 from public.website_upload_reservations r where r.object_path=o.name);
  select v_total+coalesce(sum(reserved_bytes),0) into v_total from public.website_upload_reservations;
  select v_site+coalesce(sum(reserved_bytes),0) into v_site from public.website_upload_reservations where site_id=p_site;
  if v_total+7000000>l.upload_bucket_bytes or v_site+7000000>l.upload_site_bytes then raise exception 'UPLOAD_CAPACITY'; end if;
  if not exists(select 1 from storage.buckets where id='website-intake-files' and not public and file_size_limit=7000000
    and allowed_mime_types is not null and cardinality(allowed_mime_types)>0 and allowed_mime_types<@array['image/jpeg','image/png','image/webp','image/gif','image/avif']::text[]) then raise exception 'UPLOAD_BUCKET_UNSAFE'; end if;
  v_path=p_site||'/secure-intake/'||p_folder||'/'||p_id::text||'-'||p_name;
  insert into public.website_upload_reservations(reservation_id,site_id,object_path) values(p_id,p_site,v_path);
  return jsonb_build_object('path',v_path,'reserved_bytes',7000000);
end $$;

create function public.website_ai_reserve(p_job bigint,p_request uuid,p_model text,p_hash text,p_input integer,p_output integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.website_resource_limits%rowtype; j public.website_jobs%rowtype; v_cost bigint; v_job bigint; v_site bigint; v_day bigint; v_month bigint;
begin
  select * into strict l from public.website_resource_limits where id for update nowait;
  if not l.ai_enabled then raise exception 'AI_DISABLED'; end if;
  if l.pricing_checked_on>(clock_timestamp() at time zone 'UTC')::date or l.pricing_checked_on<(clock_timestamp() at time zone 'UTC')::date-30 then raise exception 'AI_PRICING_REVIEW'; end if;
  if p_request is null or p_model is distinct from 'gpt-6.1-sol' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
    or p_input is null or p_input not between 8192 and 208192 or p_output is null or p_output not between 1 and 16000 then raise exception 'AI_INVALID'; end if;
  select * into strict j from public.website_jobs where id=p_job;
  if j.status<>'running' then raise exception 'AI_JOB_STATE'; end if;
  -- Conservative accounting units, NOT an invoice: $4/M input and $20/M output.
  -- Current Standard pricing is $2/$10; the margin allows caching/region overhead.
  v_cost=p_input::bigint*4+p_output::bigint*20;
  select coalesce(sum(charged_micro_usd),0) into v_job from public.website_ai_charges where job_id=j.id;
  select coalesce(sum(charged_micro_usd),0) into v_site from public.website_ai_charges where site_id=j.site_id and
    (created_at>=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC' or state<>'settled');
  select coalesce(sum(charged_micro_usd),0) into v_day from public.website_ai_charges where
    created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC' or state<>'settled';
  select coalesce(sum(charged_micro_usd),0) into v_month from public.website_ai_charges where
    created_at>=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC' or state<>'settled';
  if v_job+v_cost>l.ai_job_micro_usd or v_site+v_cost>l.ai_site_month_micro_usd or v_day+v_cost>l.ai_day_micro_usd
    or v_month+v_cost>l.ai_month_micro_usd then raise exception 'AI_BUDGET'; end if;
  if (select count(*) from public.website_ai_charges where job_id=j.id)>=40 then raise exception 'AI_ATTEMPTS'; end if;
  insert into public.website_ai_charges(request_id,job_id,site_id,request_hash,model,input_bound,output_bound,reserved_micro_usd,charged_micro_usd)
    values(p_request,j.id,j.site_id,p_hash,p_model,p_input,p_output,v_cost,v_cost);
  return jsonb_build_object('request_id',p_request,'reserved_micro_usd',v_cost);
end $$;

create function public.website_ai_settle(p_request uuid,p_response text,p_input integer,p_output integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.website_resource_limits%rowtype; r public.website_ai_charges%rowtype; v_cost bigint; v_overrun boolean;
begin
  select * into strict l from public.website_resource_limits where id for update nowait;
  select * into strict r from public.website_ai_charges where request_id=p_request for update;
  if p_response is null or p_response !~ '^resp_[A-Za-z0-9_-]{1,150}$' or p_input is null or p_output is null
    or p_input<0 or p_output<0 or p_input>2000000 or p_output>2000000 then raise exception 'AI_USAGE_INVALID'; end if;
  if r.state='settled' then
    if r.response_id is distinct from p_response or r.input_tokens is distinct from p_input or r.output_tokens is distinct from p_output then raise exception 'AI_SETTLEMENT_CONFLICT'; end if;
    return jsonb_build_object('settled',true,'overrun',r.input_tokens>r.input_bound or r.output_tokens>r.output_bound);
  end if;
  v_cost=p_input::bigint*4+p_output::bigint*20;
  v_overrun=p_input>r.input_bound or p_output>r.output_bound;
  update public.website_ai_charges set state='settled',response_id=p_response,input_tokens=p_input,output_tokens=p_output,
    charged_micro_usd=v_cost,settled_at=clock_timestamp() where request_id=p_request;
  if v_overrun then update public.website_resource_limits set ai_enabled=false where id; end if;
  return jsonb_build_object('settled',true,'overrun',v_overrun);
end $$;

create function public.website_ai_uncertain(p_request uuid) returns void
language sql security invoker set search_path='' as $$
  update public.website_ai_charges set state='uncertain' where request_id=p_request and state='reserved';
$$;
create function public.website_resource_usage(p_actor uuid,p_site text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.website_resource_limits%rowtype;
begin
  if p_actor is null or not exists(select 1 from public.website_admins where user_id=p_actor) then raise exception 'Administrator required' using errcode='42501'; end if;
  select * into strict l from public.website_resource_limits where id;
  return jsonb_build_object('limits',to_jsonb(l),
    'upload_reserved_bytes',(select coalesce(sum(reserved_bytes),0) from public.website_upload_reservations),
    'site_upload_reserved_bytes',(select coalesce(sum(reserved_bytes),0) from public.website_upload_reservations where site_id=p_site),
    'ai_month_micro_usd',(select coalesce(sum(charged_micro_usd),0) from public.website_ai_charges where created_at>=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC' or state<>'settled'),
    'ai_uncertain_calls',(select count(*) from public.website_ai_charges where state<>'settled'),
    'site_ai_calls',(select count(*) from public.website_ai_charges where site_id=p_site),
    'usage_is_provider_invoice',false);
end $$;
revoke all on function public.website_upload_reserve(text,uuid,text,text),public.website_ai_reserve(bigint,uuid,text,text,integer,integer),
  public.website_ai_settle(uuid,text,integer,integer),public.website_ai_uncertain(uuid),public.website_resource_usage(uuid,text) from public,anon,authenticated;
grant execute on function public.website_upload_reserve(text,uuid,text,text),public.website_ai_reserve(bigint,uuid,text,text,integer,integer),
  public.website_ai_settle(uuid,text,integer,integer),public.website_ai_uncertain(uuid),public.website_resource_usage(uuid,text) to service_role;
