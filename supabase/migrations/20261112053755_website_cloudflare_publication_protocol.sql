-- Additive, opt-in Cloudflare publication protocol. No existing site is enrolled here.
-- Server-only RPCs; never accept publication/approval assertions from the browser.
-- External R2 calls take place BETWEEN transactions, under a durable operation lock.

create table public.website_hosting_urls (
  order_code text primary key references public.website_orders(order_code),
  public_site_id text not null unique check (public_site_id ~ '^[0-9]{4,10}$'),
  base_domain text not null,
  public_url text not null unique,
  created_at timestamptz not null default now()
);
create table public.website_hosting_sites (
  site_id text primary key references public.website_sites(site_id),
  order_code text not null unique references public.website_hosting_urls(order_code),
  public_site_id text not null unique check (public_site_id ~ '^[0-9]{4,10}$'),
  public_url text not null unique,
  pending_release text,
  approved_release text,
  active_release text,
  active_publication_id uuid,
  status text not null default 'unpublished' check (status in ('unpublished','private','live')),
  active_operation_id uuid,
  updated_at timestamptz not null default now()
);
create table public.website_hosting_releases (
  site_id text not null references public.website_hosting_sites(site_id),
  release_id text not null check (release_id ~ '^[a-f0-9]{24,64}$'),
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  job_id bigint not null references public.website_jobs(id),
  quality_report jsonb not null check (quality_report->>'ok' = 'true'),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  published_at timestamptz,
  primary key (site_id,release_id),
  unique (site_id,job_id)
);
create index website_hosting_releases_job_idx on public.website_hosting_releases(job_id);
create table public.website_hosting_operations (
  operation_id uuid primary key check (operation_id::text ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  fence_id uuid not null unique default gen_random_uuid(),
  site_id text not null references public.website_hosting_sites(site_id),
  actor_id uuid not null, -- Immutable audit snapshot; revoking admin membership must remain possible.
  kind text not null check (kind in ('publish','rollback','private')),
  release_id text,
  base_pointer jsonb,
  state text not null default 'writing' check (state in ('writing','reconcile','committed','fenced')),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  result_pointer jsonb
);
create index website_hosting_operations_site_idx on public.website_hosting_operations(site_id,created_at desc);
create index website_hosting_operations_actor_idx on public.website_hosting_operations(actor_id);
create unique index website_hosting_one_operation_idx on public.website_hosting_operations(site_id)
  where state in ('writing','reconcile');
create table public.website_hosting_outbox (
  operation_id uuid primary key references public.website_hosting_operations(operation_id),
  site_id text not null references public.website_hosting_sites(site_id),
  kind text not null,
  state text not null default 'pending' check (state in ('pending','sent','manual_review')),
  delivery_started_at timestamptz,
  delivery_payload jsonb,
  customer_sent_at timestamptz,
  owner_sent_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index website_hosting_outbox_pending_idx on public.website_hosting_outbox(created_at) where state='pending';
create index website_hosting_outbox_site_idx on public.website_hosting_outbox(site_id);

alter table public.website_hosting_urls enable row level security;
alter table public.website_hosting_sites enable row level security;
alter table public.website_hosting_releases enable row level security;
alter table public.website_hosting_operations enable row level security;
alter table public.website_hosting_outbox enable row level security;
revoke all on public.website_hosting_urls,public.website_hosting_sites,public.website_hosting_releases,
  public.website_hosting_operations,public.website_hosting_outbox from public,anon,authenticated;
grant select,insert,update on public.website_hosting_urls,public.website_hosting_sites,public.website_hosting_releases,
  public.website_hosting_operations,public.website_hosting_outbox to service_role;

create function public.website_hosting_require_admin(p_actor uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_actor is null or not exists(select 1 from public.website_admins where user_id=p_actor) then
    raise exception 'Hosting administrator required' using errcode='42501';
  end if;
end $$;

-- Reserve before the quotation, not after payment: a quoted URL must stay stable.
-- Legacy nonnumeric sites and already promised different URLs require explicit migration review.
create function public.website_hosting_reserve_url(p_actor uuid,p_order text,p_domain text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.website_orders%rowtype; u public.website_hosting_urls%rowtype; n text; v_url text;
begin
  perform public.website_hosting_require_admin(p_actor);
  if p_domain is null or length(p_domain)>190 or p_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    or p_domain ~ '(^|\.)(workers\.dev|pages\.dev|github\.io|netlify\.app|sho-support\.com)$' then
    raise exception 'A separately owned customer hosting domain is required';
  end if;
  select * into strict o from public.website_orders where order_code=p_order for update;
  n=regexp_replace(p_order,'^[FSP]','');
  if n !~ '^[0-9]{4,10}$' or n::bigint>=9000000000 or o.status='cancelled' then
    raise exception 'Order cannot receive an automatic customer URL';
  end if;
  v_url='https://s'||n||'.'||p_domain||'/';
  if coalesce(o.selections->>'final_public_domain','')<>'' and o.selections->>'final_public_domain'<>v_url then
    raise exception 'Previously quoted URL requires explicit migration review';
  end if;
  select * into u from public.website_hosting_urls where order_code=p_order;
  if found then
    if u.public_url<>v_url then raise exception 'Reserved URL is immutable'; end if;
    return to_jsonb(u);
  end if;
  insert into public.website_hosting_urls(order_code,public_site_id,base_domain,public_url)
    values(p_order,n,p_domain,v_url) returning * into u;
  return to_jsonb(u);
end $$;

create function public.website_hosting_enrol(p_actor uuid,p_site text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.website_sites%rowtype; o public.website_orders%rowtype; u public.website_hosting_urls%rowtype;
  h public.website_hosting_sites%rowtype;
begin
  perform public.website_hosting_require_admin(p_actor);
  select * into strict s from public.website_sites where site_id=p_site for update;
  select * into strict o from public.website_orders where site_id=p_site and status='site_created';
  select * into strict u from public.website_hosting_urls where order_code=o.order_code;
  if s.published_at is not null or coalesce(s.custom_domain,'')<>'' or s.public_url is distinct from u.public_url
    or o.selections->>'final_public_domain' is distinct from u.public_url then
    raise exception 'Site URL or existing publication requires migration review';
  end if;
  insert into public.website_hosting_sites(site_id,order_code,public_site_id,public_url)
    values(p_site,o.order_code,u.public_site_id,u.public_url) on conflict(site_id) do nothing;
  select * into strict h from public.website_hosting_sites where site_id=p_site;
  if h.order_code<>o.order_code or h.public_url<>u.public_url then raise exception 'Hosting mapping mismatch'; end if;
  return to_jsonb(h);
end $$;

create function public.website_hosting_register_release(p_site text,p_job bigint,p_release text,
  p_commit text,p_manifest text,p_quality jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h public.website_hosting_sites%rowtype; j public.website_jobs%rowtype; r public.website_hosting_releases%rowtype;
begin
  select * into strict h from public.website_hosting_sites where site_id=p_site for update nowait;
  if h.active_operation_id is not null then raise exception 'Publication requires reconciliation'; end if;
  select * into strict j from public.website_jobs where id=p_job and site_id=p_site for update;
  if j.status<>'running' or p_quality->>'ok' is distinct from 'true'
    or exists(select 1 from public.website_jobs where site_id=p_site and id>p_job) then
    raise exception 'Only the latest running, verified production job may register a release';
  end if;
  insert into public.website_hosting_releases(site_id,release_id,job_id,source_commit,manifest_sha256,quality_report)
    values(p_site,p_release,p_job,p_commit,p_manifest,p_quality) returning * into r;
  update public.website_hosting_sites set pending_release=p_release,approved_release=null,updated_at=now() where site_id=p_site;
  return to_jsonb(r);
end $$;

create function public.website_hosting_activate_order(p_actor uuid,p_order text,p_key_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.website_orders%rowtype; u public.website_hosting_urls%rowtype; s public.website_sites%rowtype; label text;
begin
  perform public.website_hosting_require_admin(p_actor);
  select * into strict o from public.website_orders where order_code=p_order for update;
  select * into strict u from public.website_hosting_urls where order_code=p_order;
  if o.status='site_created' and exists(select 1 from public.website_hosting_sites where site_id=o.site_id and order_code=p_order) then
    return jsonb_build_object('site_id',o.site_id,'already_active',true);
  end if;
  if o.status<>'pending_payment' or coalesce(o.line_user_id,'')='' or p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$'
    or coalesce(o.selections->>'final_quote_amount','')='' or coalesce(o.selections->>'final_quote_sent_at','')=''
    or coalesce(o.selections->>'quote_domain_owner_confirmed_at','')=''
    or o.selections->>'final_public_domain' is distinct from u.public_url then
    raise exception 'A paid-order confirmation requires its sent quotation and immutable URL';
  end if;
  label=case o.plan when 'one' then '1ページ完結サイト' when 'semi' then 'セミオーダーサイト' else 'フルオーダーサイト' end;
  insert into public.website_sites(site_id,site_name,status,current_note,public_url,publish_branch,live_path,offline_path)
    values(u.public_site_id,label,'request_waiting','ヒアリング入力待ち。',u.public_url,'main','/','/docs')
    on conflict(site_id) do nothing;
  select * into strict s from public.website_sites where site_id=u.public_site_id for update;
  if s.public_url is distinct from u.public_url or s.status<>'request_waiting' or s.published_at is not null or coalesce(s.custom_domain,'')<>'' then
    raise exception 'Existing site cannot be reused for this order';
  end if;
  insert into public.website_intakes(site_id,payload) values(s.site_id,jsonb_build_object(
    'fields',jsonb_build_object('build_plan',o.plan,'template_style',coalesce(o.template_style,'')),
    'checks','{}'::jsonb,'members','[]'::jsonb,'lives','[]'::jsonb,'contacts','[]'::jsonb,
    'files',jsonb_build_object('top_photos','[]'::jsonb,'gallery_photos','[]'::jsonb,'logo_file','[]'::jsonb),'meta','{}'::jsonb))
    on conflict(site_id) do nothing;
  insert into public.website_line_links(site_id,line_user_id,line_display_name) values(s.site_id,o.line_user_id,o.line_display_name)
    on conflict(site_id) do update set line_user_id=excluded.line_user_id,line_display_name=excluded.line_display_name;
  update public.website_orders set status='site_created',site_id=s.site_id,customer_access_token_hash=p_key_hash,
    access_token_created_at=now(),updated_at=now() where order_code=p_order;
  perform public.website_hosting_enrol(p_actor,s.site_id);
  return jsonb_build_object('site_id',s.site_id,'already_active',false);
end $$;

create function public.website_hosting_open_review(p_actor uuid,p_site text,p_release text,p_key_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h public.website_hosting_sites%rowtype;
begin
  perform public.website_hosting_require_admin(p_actor);
  select * into strict h from public.website_hosting_sites where site_id=p_site for update nowait;
  if h.active_operation_id is not null or h.pending_release is distinct from p_release or p_key_hash !~ '^[a-f0-9]{64}$'
    or p_key_hash is null or exists(select 1 from public.website_jobs where site_id=p_site and status in ('queued','running'))
    or exists(select 1 from public.website_review_issues where site_id=p_site and status<>'confirmed') then
    raise exception 'Review requires the latest complete, verified release and resolved review issues';
  end if;
  if not exists(select 1 from public.website_hosting_releases where site_id=p_site and release_id=p_release) then
    raise exception 'Release does not exist';
  end if;
  perform set_config('sho.hosting_protocol','1',true);
  update public.website_hosting_sites set approved_release=null,updated_at=now() where site_id=p_site;
  update public.website_sites set status='customer_review',customer_approved=false,review_access_token_hash=p_key_hash,
    current_note='運営確認済み。お客様の最終確認待ち。' where site_id=p_site;
  insert into public.website_activity(site_id,actor_type,actor_user_id,action,detail,payload)
    values(p_site,'admin',p_actor,'admin_transition','検査済みの固定版をお客様の最終確認へ。',jsonb_build_object('release_id',p_release));
  perform set_config('sho.hosting_protocol','0',true);
  return jsonb_build_object('site_id',p_site,'release_id',p_release,'status','customer_review');
end $$;

create function public.website_hosting_approve(p_site text,p_release text,p_key_hash text default null,p_user uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h public.website_hosting_sites%rowtype; s public.website_sites%rowtype;
begin
  select * into strict h from public.website_hosting_sites where site_id=p_site for update nowait;
  select * into strict s from public.website_sites where site_id=p_site for update nowait;
  if h.active_operation_id is not null or h.pending_release is distinct from p_release or s.status<>'customer_review'
    or exists(select 1 from public.website_jobs where site_id=p_site and status in ('queued','running')) then
    raise exception 'Customer approval refers to an obsolete release';
  end if;
  if not ((p_key_hash is not null and s.review_access_token_hash is not null and p_key_hash=s.review_access_token_hash)
    or (p_user is not null and exists(select 1 from public.website_site_users
      where site_id=p_site and user_id=p_user and role in ('owner','editor')))) then
    raise exception 'Customer review authority required' using errcode='42501';
  end if;
  perform set_config('sho.hosting_protocol','1',true);
  update public.website_hosting_releases set approved_at=coalesce(approved_at,now()) where site_id=p_site and release_id=p_release;
  update public.website_hosting_sites set approved_release=p_release,updated_at=now() where site_id=p_site;
  update public.website_sites set customer_approved=true,current_note='お客様が内容承認。運営者の公開操作待ち。' where site_id=p_site;
  if h.approved_release is distinct from p_release or not s.customer_approved then
    insert into public.website_activity(site_id,actor_type,actor_user_id,action,detail,payload)
      values(p_site,case when p_user is null then 'customer_line' else 'customer' end,p_user,'customer_approved','サイト内容を承認。',jsonb_build_object('release_id',p_release));
  end if;
  perform set_config('sho.hosting_protocol','0',true);
  return jsonb_build_object('site_id',p_site,'release_id',p_release,'approved',true,'already_approved',h.approved_release=p_release and s.customer_approved);
end $$;

create function public.website_hosting_claim(p_actor uuid,p_site text,p_operation uuid,p_kind text,p_release text,p_base jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h public.website_hosting_sites%rowtype; s public.website_sites%rowtype; o public.website_hosting_operations%rowtype;
begin
  perform public.website_hosting_require_admin(p_actor);
  select * into strict h from public.website_hosting_sites where site_id=p_site for update nowait;
  select * into o from public.website_hosting_operations where operation_id=p_operation;
  if found then
    if o.site_id<>p_site or o.actor_id<>p_actor or o.kind<>p_kind or o.release_id is distinct from p_release then
      raise exception 'Operation ID belongs to another request';
    end if;
    return to_jsonb(o)||jsonb_build_object('reused',true,'public_site_id',h.public_site_id,'public_url',h.public_url);
  end if;
  if h.active_operation_id is not null then raise exception 'Publication requires reconciliation'; end if;
  if p_kind not in ('publish','rollback','private') or p_kind is null then raise exception 'Invalid publication kind'; end if;
  select * into strict s from public.website_sites where site_id=p_site for update nowait;
  if exists(select 1 from public.website_jobs where site_id=p_site and status in ('queued','running')) then
    raise exception 'Production job is still active';
  end if;
  if p_base is null then
    if h.active_publication_id is not null or h.active_release is not null or h.status<>'unpublished' then
      raise exception 'Expected R2 publication is missing';
    end if;
  elsif jsonb_typeof(p_base)<>'object' or p_base->>'site_id' is distinct from h.public_site_id
    or p_base->>'etag' is null or p_base->>'etag' !~ '^"[^"\r\n]+"$'
    or p_base->>'release' is distinct from h.active_release
    or p_base->>'publication_id' is distinct from h.active_publication_id::text
    or p_base->>'status' is distinct from h.status then
    raise exception 'Database and R2 publication do not agree';
  end if;
  if p_kind='publish' and (h.pending_release is distinct from p_release or h.approved_release is distinct from p_release
    or p_release is null or not s.customer_approved or s.status<>'customer_review'
    or exists(select 1 from public.website_review_issues where site_id=p_site and status<>'confirmed')) then
    raise exception 'The exact current release needs customer and administrator review';
  end if;
  if p_kind in ('publish','rollback') and not exists(select 1 from public.website_hosting_releases
    where site_id=p_site and release_id=p_release and approved_at is not null
      and (p_kind='publish' or published_at is not null)) then
    raise exception 'Target release has not been approved and previously published';
  end if;
  if p_kind='private' and p_release is distinct from h.active_release then raise exception 'Unexpected private target'; end if;
  insert into public.website_hosting_operations(operation_id,site_id,actor_id,kind,release_id,base_pointer)
    values(p_operation,p_site,p_actor,p_kind,p_release,p_base) returning * into o;
  update public.website_hosting_sites set active_operation_id=p_operation,updated_at=now() where site_id=p_site;
  return to_jsonb(o)||jsonb_build_object('reused',false,'public_site_id',h.public_site_id,'public_url',h.public_url);
end $$;

create function public.website_hosting_request_revision(p_site text,p_release text,p_note text,
  p_key_hash text default null,p_user uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare h public.website_hosting_sites%rowtype; s public.website_sites%rowtype; j public.website_jobs%rowtype;
begin
  select * into strict h from public.website_hosting_sites where site_id=p_site for update nowait;
  select * into strict s from public.website_sites where site_id=p_site for update nowait;
  if h.active_operation_id is not null or h.pending_release is distinct from p_release or s.status<>'customer_review'
    or p_note is null or length(trim(p_note))<1 or length(p_note)>4000 then raise exception 'Review revision is not available'; end if;
  if not ((p_key_hash is not null and s.review_access_token_hash is not null and p_key_hash=s.review_access_token_hash)
    or (p_user is not null and exists(select 1 from public.website_site_users
      where site_id=p_site and user_id=p_user and role in ('owner','editor')))) then
    raise exception 'Customer review authority required' using errcode='42501';
  end if;
  insert into public.website_jobs(site_id,kind,status,instruction,payload)
    values(p_site,'customer_revision','queued',trim(p_note),jsonb_build_object('source','cloudflare_frozen_review','release_id',p_release)) returning * into j;
  perform set_config('sho.hosting_protocol','1',true);
  update public.website_sites set status='building',customer_approved=false,review_access_token_hash=null,
    current_note='お客様から修正依頼。再作成中。' where site_id=p_site;
  perform set_config('sho.hosting_protocol','0',true);
  insert into public.website_activity(site_id,actor_type,actor_user_id,action,detail,payload)
    values(p_site,case when p_user is null then 'customer_line' else 'customer' end,p_user,'customer_revision_requested',trim(p_note),jsonb_build_object('job_id',j.id,'release_id',p_release));
  return jsonb_build_object('site_id',p_site,'status','building','job_id',j.id);
end $$;

create function public.website_hosting_finalize(p_operation uuid,p_pointer jsonb,p_fenced boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.website_hosting_operations%rowtype; h public.website_hosting_sites%rowtype;
  v_status text; v_release text; v_nonce uuid; s public.website_sites%rowtype; v_plan text;
begin
  -- Same lock order as claim/approval/production triggers.
  select * into strict o from public.website_hosting_operations where operation_id=p_operation;
  select * into strict h from public.website_hosting_sites where site_id=o.site_id for update nowait;
  select * into strict o from public.website_hosting_operations where operation_id=p_operation for update;
  if o.state in ('committed','fenced') then return to_jsonb(o)||jsonb_build_object('idempotent',true); end if;
  if h.active_operation_id is distinct from p_operation then raise exception 'Operation lock no longer belongs to this request'; end if;
  v_status=case when p_fenced then coalesce(o.base_pointer->>'status','private') when o.kind='private' then 'private' else 'live' end;
  v_release=case when p_fenced then o.base_pointer->>'release' else o.release_id end;
  v_nonce=case when p_fenced then o.fence_id else o.operation_id end;
  if p_pointer is null or jsonb_typeof(p_pointer)<>'object' or p_pointer->>'site_id' is distinct from h.public_site_id
    or p_pointer->>'status' is distinct from v_status or p_pointer->>'release' is distinct from v_release
    or p_pointer->>'publication_id' is distinct from v_nonce::text or p_pointer->>'etag' is null
    or p_pointer->>'etag' !~ '^"[^"\r\n]+"$' then
    raise exception 'Confirmed R2 pointer does not match the operation';
  end if;
  perform set_config('sho.hosting_protocol','1',true);
  update public.website_hosting_sites set status=v_status,active_release=v_release,active_publication_id=v_nonce,
    active_operation_id=null,pending_release=case when p_fenced then pending_release else null end,
    approved_release=case when p_fenced then approved_release else null end,updated_at=now() where site_id=o.site_id;
  if not p_fenced then
    select * into strict s from public.website_sites where site_id=o.site_id for update nowait;
    select plan into strict v_plan from public.website_orders where order_code=h.order_code;
    update public.website_sites set status=v_status,public_url=h.public_url,customer_approved=false,
      current_note=case o.kind when 'private' then 'サイトを一時非公開中。' when 'rollback' then '以前の正常な内容へ復元・公開済み。' else 'お客様の内容承認を確認して公開完了。' end,
      preview_url=case when v_status='live' then h.public_url else preview_url end,preview_branch=null,
      review_access_token_hash=null,preview_access_token_hash=null,
      published_at=case when v_status='live' then coalesce(published_at,now()) else published_at end,
      adjustment_free_until=case when v_status='live' then coalesce(adjustment_free_until,now()+interval '30 days') else adjustment_free_until end,
      update_free_until=case when v_status='live' and v_plan in ('semi','full') then coalesce(update_free_until,now()+interval '3 months') else update_free_until end
      where site_id=o.site_id;
    if v_status='live' then
      update public.website_hosting_releases set published_at=coalesce(published_at,now()) where site_id=o.site_id and release_id=v_release;
      -- The customer's already-delivered final review link becomes their update access.
      -- No plaintext bearer token is stored or reconstructed by an administrator.
      update public.website_orders set
        customer_access_token_hash=case when o.kind='publish' then s.review_access_token_hash else customer_access_token_hash end,
        access_token_created_at=case when o.kind='publish' then now() else access_token_created_at end,
        update_free_until=case when v_plan in ('semi','full') then coalesce(update_free_until,now()+interval '3 months') else update_free_until end
        where order_code=h.order_code;
      update public.website_jobs set status='done',finished_at=coalesce(finished_at,now()) where id=(
        select job_id from public.website_hosting_releases where site_id=o.site_id and release_id=v_release);
    end if;
    insert into public.website_hosting_outbox(operation_id,site_id,kind) values(o.operation_id,o.site_id,o.kind);
  end if;
  update public.website_hosting_operations set state=case when p_fenced then 'fenced' else 'committed' end,
    result_pointer=p_pointer,completed_at=now(),error_code=null where operation_id=p_operation returning * into o;
  insert into public.website_activity(site_id,actor_type,actor_user_id,action,detail,payload)
    values(o.site_id,'admin',(select user_id from public.website_admins where user_id=o.actor_id),
      case when p_fenced then 'publication_reconciled' when o.kind='rollback' then 'publication_rollback' when o.kind='private' then 'publication_private' else 'published' end,
      case when p_fenced then '未確定の公開処理を中止し、遅延処理の再反映を防止。' when o.kind='rollback' then '以前の正常版へ復元。' when o.kind='private' then 'サイトを一時非公開へ。' else 'お客様の承認済み固定版を公開。' end,
      jsonb_build_object('operation_id',o.operation_id,'release_id',v_release));
  perform set_config('sho.hosting_protocol','0',true);
  return to_jsonb(o)||jsonb_build_object('idempotent',false);
end $$;

create function public.website_hosting_mark_uncertain(p_operation uuid,p_error text) returns void
language sql security invoker set search_path='' as $$
  update public.website_hosting_operations set state='reconcile',error_code=left(p_error,100)
  where operation_id=p_operation and state in ('writing','reconcile');
$$;

create function public.website_hosting_claim_notice(p_actor uuid,p_operation uuid,p_lease uuid,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare n public.website_hosting_outbox%rowtype;
begin
  perform public.website_hosting_require_admin(p_actor);
  select * into strict n from public.website_hosting_outbox where operation_id=p_operation for update nowait;
  if n.state<>'pending' then return to_jsonb(n)||jsonb_build_object('claimed',false); end if;
  if n.delivery_started_at is not null and n.delivery_started_at<now()-interval '23 hours' then
    update public.website_hosting_outbox set state='manual_review',lease_id=null,lease_until=null where operation_id=p_operation returning * into n;
    return to_jsonb(n)||jsonb_build_object('claimed',false);
  end if;
  if n.lease_until>now() then return to_jsonb(n)||jsonb_build_object('claimed',false); end if;
  if n.delivery_payload is null and (p_payload is null or jsonb_typeof(p_payload)<>'object'
    or coalesce(length(p_payload#>>'{customer,to}'),0) not between 3 and 100
    or coalesce(length(p_payload#>>'{owner,to}'),0) not between 3 and 100
    or coalesce(length(p_payload#>>'{customer,text}'),0) not between 1 and 5000
    or coalesce(length(p_payload#>>'{owner,text}'),0) not between 1 and 5000) then
    raise exception 'Notice recipients and messages must be frozen before the first attempt';
  end if;
  update public.website_hosting_outbox set delivery_started_at=coalesce(delivery_started_at,now()),
    delivery_payload=coalesce(delivery_payload,p_payload),
    lease_id=p_lease,lease_until=now()+interval '2 minutes' where operation_id=p_operation returning * into n;
  return to_jsonb(n)||jsonb_build_object('claimed',true);
end $$;

create function public.website_hosting_complete_notice(p_operation uuid,p_lease uuid,p_recipient text) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_recipient not in ('customer','owner') or p_recipient is null then raise exception 'Invalid notice recipient'; end if;
  update public.website_hosting_outbox set customer_sent_at=case when p_recipient='customer' then now() else customer_sent_at end,
    owner_sent_at=case when p_recipient='owner' then now() else owner_sent_at end
    where operation_id=p_operation and lease_id=p_lease and state='pending';
  if not found then raise exception 'Notice delivery lease changed'; end if;
  update public.website_hosting_outbox set state='sent',sent_at=now(),lease_id=null,lease_until=null
    where operation_id=p_operation and customer_sent_at is not null and owner_sent_at is not null;
end $$;

-- Only enrolled sites are protected; unrelated sites/businesses retain existing behavior.
create function public.website_hosting_guard_site() returns trigger
language plpgsql security invoker set search_path='' as $$
declare h public.website_hosting_sites%rowtype;
begin
  if current_setting('sho.hosting_protocol',true)='1' then return new; end if;
  select * into h from public.website_hosting_sites where site_id=old.site_id for update nowait;
  if not found then return new; end if;
  if new.site_id<>old.site_id or new.public_url is distinct from h.public_url or new.custom_domain is distinct from old.custom_domain then
    raise exception 'Enrolled customer URL cannot be changed through the legacy route';
  end if;
  if h.active_operation_id is not null and (new.status is distinct from old.status
    or new.customer_approved is distinct from old.customer_approved or new.repo_full_name is distinct from old.repo_full_name
    or new.publish_branch is distinct from old.publish_branch or new.preview_branch is distinct from old.preview_branch
    or new.review_access_token_hash is distinct from old.review_access_token_hash
    or new.preview_access_token_hash is distinct from old.preview_access_token_hash) then
    raise exception 'Publication requires reconciliation before site changes';
  end if;
  if (new.status in ('live','private','improving_private','customer_review') and new.status is distinct from old.status)
    or (new.customer_approved and not old.customer_approved) then
    raise exception 'Use the Cloudflare review/publication protocol';
  end if;
  if new.status is distinct from old.status or new.preview_branch is distinct from old.preview_branch
    or new.review_access_token_hash is distinct from old.review_access_token_hash then
    update public.website_hosting_sites set pending_release=null,approved_release=null,updated_at=now() where site_id=old.site_id;
    new.customer_approved=false;
  end if;
  return new;
end $$;
create trigger website_hosting_guard_site before update on public.website_sites
  for each row execute function public.website_hosting_guard_site();

create function public.website_hosting_guard_job() returns trigger
language plpgsql security invoker set search_path='' as $$
declare h public.website_hosting_sites%rowtype;
begin
  if new.status not in ('queued','running') then return new; end if;
  if tg_op='UPDATE' and new.status=old.status then return new; end if;
  select * into h from public.website_hosting_sites where site_id=new.site_id for update nowait;
  if not found then return new; end if;
  if h.active_operation_id is not null then raise exception 'Publication requires reconciliation before production can start'; end if;
  if new.status='running' and exists(select 1 from public.website_jobs where site_id=new.site_id and status='running' and id<>new.id) then
    raise exception 'Another production job is already running for this site';
  end if;
  update public.website_hosting_sites set pending_release=null,approved_release=null,updated_at=now() where site_id=new.site_id;
  return new;
end $$;
create trigger website_hosting_guard_job before insert or update on public.website_jobs
  for each row execute function public.website_hosting_guard_job();

create function public.website_hosting_guard_issue() returns trigger
language plpgsql security invoker set search_path='' as $$
declare h public.website_hosting_sites%rowtype;
begin
  select * into h from public.website_hosting_sites where site_id=new.site_id for update nowait;
  if not found then return new; end if;
  if h.active_operation_id is not null then raise exception 'Publication requires reconciliation before review issues can change'; end if;
  if new.status<>'confirmed' then
    update public.website_hosting_sites set approved_release=null,updated_at=now() where site_id=new.site_id;
  end if;
  return new;
end $$;
create trigger website_hosting_guard_issue before insert or update on public.website_review_issues
  for each row execute function public.website_hosting_guard_issue();

-- Explicit EXECUTE grants override Postgres' PUBLIC function default.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'website_hosting_%'
  loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
