-- SHO Band Support CRM v1 | additive objects only in sho-web-support Supabase.
-- No changes to any website_*, svs_*, guns_*, Storage or existing functions.
-- Every data table has RLS and is admin-only, no public/anon permission.
create schema if not exists band_private;
revoke all on schema band_private from public, anon;
grant usage on schema band_private to authenticated;

create table if not exists public.band_crm_admins(
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.band_crm_admins enable row level security;
revoke all on public.band_crm_admins from public, anon, authenticated;
grant select on public.band_crm_admins to authenticated;
drop policy if exists band_admin_self on public.band_crm_admins;
create policy band_admin_self on public.band_crm_admins for select to authenticated
 using(user_id=(select auth.uid()));

create or replace function band_private.is_operator() returns boolean
 language sql stable security definer set search_path=''
 as $$ select exists(select 1 from public.band_crm_admins a where a.user_id=(select auth.uid())) $$;
revoke all on function band_private.is_operator() from public, anon;
grant execute on function band_private.is_operator() to authenticated;

-- Bind the already-verified owner identity; never grant admin to any unverified account.
insert into public.band_crm_admins(user_id)
 select id from auth.users where lower(email)='zodiac.suu@gmail.com' and email_confirmed_at is not null
 on conflict(user_id) do nothing;

create table if not exists public.band_crm_leads(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 100),
 organization text not null default '' check(length(organization)<=120),
 channel text not null default 'line' check(channel in ('line','instagram','facebook','email','other')),
 handle text not null default '' check(length(handle)<=200),
 stage text not null default 'new' check(stage in ('new','approached','replied','quoted','booked','lost')),
 notes text not null default '' check(length(notes)<=4000),
 next_action_on date,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.band_crm_deals(
 id uuid primary key default gen_random_uuid(),
 lead_id uuid not null references public.band_crm_leads(id) on delete restrict,
 title text not null check(length(trim(title)) between 1 and 160),
 service text not null check(service in ('shorts','one_song','full_live','shoot_30','shoot_60','other')),
 amount_yen integer not null check(amount_yen between 1 and 100000000),
 tax_mode text not null check(tax_mode in ('included','excluded')),
 status text not null default 'draft' check(status in ('draft','sent','accepted','in_progress','delivered','completed','cancelled')),
 scope text not null default '' check(length(scope)<=4000),
 revision_terms text not null default '' check(length(revision_terms)<=1000),
 delivery_due date,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists band_crm_deals_lead_idx on public.band_crm_deals(lead_id);
create table if not exists public.band_crm_payments(
 id uuid primary key default gen_random_uuid(),
 deal_id uuid not null references public.band_crm_deals(id) on delete restrict,
 amount_yen integer not null check(amount_yen between -100000000 and 100000000 and amount_yen<>0),
 method text not null check(method in ('bank_transfer','cash','other')),
 evidence_reference text not null unique check(length(trim(evidence_reference)) between 6 and 160),
 reason text not null default '' check(length(reason)<=500),
 received_on date not null default current_date,
 verified_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 constraint band_negative_reason check(amount_yen>0 or length(trim(reason))>=8)
);
create index if not exists band_crm_payments_deal_idx on public.band_crm_payments(deal_id);

create table if not exists public.band_crm_audit(
 id bigint generated always as identity primary key,
 actor_id uuid not null references auth.users(id),
 action text not null,
 entity_id uuid,
 info jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index if not exists band_crm_audit_created_idx on public.band_crm_audit(created_at desc);

create or replace function band_private.touch_and_audit() returns trigger
 language plpgsql security definer set search_path=''
 as $$
 declare actor uuid:=(select auth.uid());
 begin
  if actor is null or not (select band_private.is_operator()) then
   raise exception 'Not authorized' using errcode='42501';
  end if;
  if tg_op='UPDATE' then new.updated_at=now();end if;
  insert into public.band_crm_audit(actor_id,action,entity_id,info)
  values(actor,lower(tg_table_name)||'_'||lower(tg_op),new.id,
   jsonb_build_object('before', case when tg_op='UPDATE' then row_to_json(old) else null end,
                      'after',row_to_json(new)));
  return new;
 end;
 $$;
revoke all on function band_private.touch_and_audit() from public,anon,authenticated;

create or replace function band_private.payment_guard_and_audit() returns trigger
 language plpgsql security definer set search_path=''
 as $$
 declare actor uuid:=(select auth.uid());
 begin
  if actor is null or not (select band_private.is_operator()) or new.verified_by<>actor then
   raise exception 'Not authorized' using errcode='42501';
  end if;
  if new.received_on>current_date then raise exception 'Future receipt date is not allowed';end if;
  insert into public.band_crm_audit(actor_id,action,entity_id,info)
  values(actor,'payment_recorded',new.id,
   jsonb_build_object('deal_id',new.deal_id,'amount_yen',new.amount_yen,'method',new.method,
                      'reference',new.evidence_reference));
  return new;
 end;
 $$;
revoke all on function band_private.payment_guard_and_audit() from public,anon,authenticated;

-- Grant only the operations the browser app actually needs.
-- Additive tables retain no anonymous access.
do $$declare t text;begin
 foreach t in array array['band_crm_leads','band_crm_deals','band_crm_payments','band_crm_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated',t);
 end loop;
end$$;
grant select,insert,update on public.band_crm_leads to authenticated;
grant select,insert,update on public.band_crm_deals to authenticated;
grant select,insert on public.band_crm_payments to authenticated;
grant select on public.band_crm_audit to authenticated;

drop policy if exists band_leads_admin on public.band_crm_leads;
create policy band_leads_admin on public.band_crm_leads for all to authenticated
 using((select band_private.is_operator())) with check((select band_private.is_operator()));
drop policy if exists band_deals_admin on public.band_crm_deals;
create policy band_deals_admin on public.band_crm_deals for all to authenticated
 using((select band_private.is_operator())) with check((select band_private.is_operator()));
drop policy if exists band_payments_admin_read on public.band_crm_payments;
create policy band_payments_admin_read on public.band_crm_payments for select to authenticated
 using((select band_private.is_operator()));
drop policy if exists band_payments_admin_insert on public.band_crm_payments;
create policy band_payments_admin_insert on public.band_crm_payments for insert to authenticated
 with check((select band_private.is_operator()) and verified_by=(select auth.uid()));
drop policy if exists band_audit_admin_read on public.band_crm_audit;
create policy band_audit_admin_read on public.band_crm_audit for select to authenticated
 using((select band_private.is_operator()));

drop trigger if exists band_leads_audit on public.band_crm_leads;
create trigger band_leads_audit before insert or update on public.band_crm_leads
 for each row execute function band_private.touch_and_audit();
drop trigger if exists band_deals_audit on public.band_crm_deals;
create trigger band_deals_audit before insert or update on public.band_crm_deals
 for each row execute function band_private.touch_and_audit();
drop trigger if exists band_payments_audit on public.band_crm_payments;
create trigger band_payments_audit before insert on public.band_crm_payments
 for each row execute function band_private.payment_guard_and_audit();
