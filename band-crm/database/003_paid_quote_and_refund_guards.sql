-- 003: protect commercial receipts and quoted terms after payment.
-- Additive to Band Support CRM only; website_* remains untouched.

create or replace function band_private.lock_paid_quote()
returns trigger language plpgsql security definer set search_path=''
as $guard$
begin
 if exists(select 1 from public.band_crm_payments p where p.deal_id=old.id)
  and (
   old.lead_id is distinct from new.lead_id
   or old.title is distinct from new.title
   or old.service is distinct from new.service
   or old.amount_yen is distinct from new.amount_yen
   or old.tax_mode is distinct from new.tax_mode
  ) then
  raise exception 'Payment already recorded; quoted commercial terms are locked';
 end if;
 return new;
end;
$guard$;
revoke all on function band_private.lock_paid_quote() from public,anon,authenticated;
drop trigger if exists band_deals_quote_lock on public.band_crm_deals;
create trigger band_deals_quote_lock before update on public.band_crm_deals
for each row execute function band_private.lock_paid_quote();

create or replace function band_private.validate_payment_balance()
returns trigger language plpgsql security definer set search_path=''
as $guard$
declare v_status text;v_balance bigint;
begin
 -- Lock the parent row to serialize concurrent corrections/payments for a deal.
 select d.status into v_status from public.band_crm_deals d
 where d.id=new.deal_id for update;
 if v_status is null then
  raise exception 'Unknown deal';
 end if;
 if new.amount_yen>0 and v_status in ('draft','cancelled') then
  raise exception 'Cannot record payment for an unissued or cancelled quote';
 end if;
 select coalesce(sum(p.amount_yen),0) into v_balance
 from public.band_crm_payments p where p.deal_id=new.deal_id;
 if v_balance+new.amount_yen<0 then
  raise exception 'Correction/refund cannot exceed the total payments recorded for this deal';
 end if;
 return new;
end;
$guard$;
revoke all on function band_private.validate_payment_balance() from public,anon,authenticated;
drop trigger if exists band_payment_balance_guard on public.band_crm_payments;
create trigger band_payment_balance_guard before insert on public.band_crm_payments
for each row execute function band_private.validate_payment_balance();

-- The CRM is a Japan-operated business. A JST receipt date must not be
-- rejected merely because UTC is still on the previous day.
create or replace function band_private.payment_guard_and_audit()
returns trigger language plpgsql security definer set search_path=''
as $guard$
declare actor uuid:=(select auth.uid());
begin
 if actor is null or not (select band_private.is_operator()) or new.verified_by<>actor then
  raise exception 'Not authorized' using errcode='42501';
 end if;
 if new.received_on > (now() at time zone 'Asia/Tokyo')::date then
  raise exception 'Future receipt date is not allowed';
 end if;
 insert into public.band_crm_audit(actor_id,action,entity_id,info)
 values(actor,'payment_recorded',new.id,
  jsonb_build_object('deal_id',new.deal_id,'amount_yen',new.amount_yen,
     'method',new.method,'reference',new.evidence_reference));
 return new;
end;
$guard$;
revoke all on function band_private.payment_guard_and_audit() from public,anon,authenticated;
