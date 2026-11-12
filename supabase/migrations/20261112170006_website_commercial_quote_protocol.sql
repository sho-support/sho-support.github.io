-- Additive, server-only quotation ledger. No price/policy is enabled here.
-- Do not apply to hosted production before the complete release is approved.
create function public.website_hosting_claim_quote(p_actor uuid,p_order text,p_snapshot jsonb,p_message text,p_fingerprint text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.website_orders%rowtype; u public.website_hosting_urls%rowtype; q jsonb; policy jsonb; amount integer; updates integer; initial_fee integer;
begin
 perform public.website_hosting_require_admin(p_actor);
 select * into strict o from public.website_orders where order_code=p_order for update;
 if o.status<>'pending_payment' or coalesce(o.line_user_id,'')='' or coalesce(o.selections->>'final_quote_sent_at','')<>'' then
  raise exception 'A quotation requires an unsent, LINE-linked pending order';
 end if;
 if p_message is null or length(p_message)<100 or length(p_message)>4800 or p_fingerprint is null
   or p_fingerprint<>encode(sha256(convert_to(p_message,'UTF8')),'hex') then raise exception 'Invalid quotation fingerprint'; end if;
 q=o.selections->'commercial_quote';
 if q is not null then
  if q->>'state' is distinct from 'sending' or q->>'fingerprint' is distinct from p_fingerprint or q->>'message' is distinct from p_message
    or q->'snapshot' is distinct from p_snapshot or q->>'recipient' is distinct from o.line_user_id then
   raise exception 'A pending quotation is immutable; reconcile the LINE conversation';
  end if;
  if (q->>'started_at')::timestamptz < now()-interval '23 hours' then raise exception 'Quotation retry window expired; reconcile LINE before any further delivery'; end if;
  return q;
 end if;
 select value into policy from public.website_settings where key='commercial_policy';
 if policy is null or policy->>'schema' is distinct from '1' or policy->>'enabled' is distinct from 'true' or policy->>'approved_at' is null
   or (policy->>'approved_at')::timestamptz>now() or not exists(select 1 from public.website_admins where user_id=(policy->>'approved_by')::uuid)
   or policy is distinct from p_snapshot->'policy' then raise exception 'A current administrator must approve the server-side commercial policy'; end if;
 select * into strict u from public.website_hosting_urls where order_code=p_order;
 amount=(p_snapshot->>'production_amount_jpy')::integer;
 updates=case when o.plan='one' and o.update_plan='unlimited' then 7000 else 0 end;
 initial_fee=(policy->'hosting'->>'initial_fee_jpy')::integer;
 if p_snapshot is null or p_snapshot->>'schema'<>'1' or p_snapshot->>'order_code' is distinct from p_order
   or p_snapshot->>'plan' is distinct from o.plan or p_snapshot->>'public_url' is distinct from u.public_url
   or amount is null or amount<greatest(coalesce(o.amount_from,0),case o.plan when 'one' then 15000 when 'semi' then 22000 else 30000 end)
   or initial_fee is null or initial_fee<0 or initial_fee>3000000
   or (p_snapshot->>'hosting_initial_fee_jpy')::integer is distinct from initial_fee
   or (p_snapshot->>'update_initial_fee_jpy')::integer is distinct from updates
   or (p_snapshot->>'initial_total_jpy')::integer is distinct from amount+initial_fee+updates
   or amount+initial_fee+updates>3000000 or coalesce(length(p_snapshot->>'delivery_terms'),0)<10
   or p_snapshot->>'payment_deadline' is null
   or (p_snapshot->>'payment_deadline')::date<(now() at time zone 'Asia/Tokyo')::date
   or (p_snapshot->>'payment_deadline')::date>(now() at time zone 'Asia/Tokyo')::date+30 then
  raise exception 'Quotation must match its order, URL, approved fees, delivery terms and payment deadline';
 end if;
 q=jsonb_build_object('state','sending','snapshot',p_snapshot,'message',p_message,'fingerprint',p_fingerprint,
   'retry_key',gen_random_uuid()::text,'recipient',o.line_user_id,'started_at',now(),'created_by',p_actor);
 update public.website_orders set selections=selections||jsonb_build_object('commercial_quote',q,'final_public_domain',u.public_url,
   'quote_url_type','free','quote_domain_owner_confirmed_at',now()),updated_at=now() where order_code=p_order;
 return q;
end $$;

create function public.website_hosting_complete_quote(p_actor uuid,p_order text,p_fingerprint text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.website_orders%rowtype; q jsonb;
begin
 perform public.website_hosting_require_admin(p_actor);
 select * into strict o from public.website_orders where order_code=p_order for update;
 q=o.selections->'commercial_quote';
 if q is null or p_fingerprint is null or q->>'fingerprint' is distinct from p_fingerprint
   or o.status<>'pending_payment' or q->>'recipient' is distinct from o.line_user_id then raise exception 'Quotation completion requires its exact reserved delivery'; end if;
 if q->>'state' in ('sent','accepted') then return q; end if;
 if q->>'state' is distinct from 'sending' then raise exception 'Unexpected quotation state'; end if;
 q=q||jsonb_build_object('state','sent','sent_at',now());
 update public.website_orders set selections=selections||jsonb_build_object('commercial_quote',q,
   'final_quote_amount',q->'snapshot'->'initial_total_jpy','final_quote_sent_at',now(),
   'final_quote_note',q->'snapshot'->'request'->'quote_note'),updated_at=now() where order_code=p_order;
 return q;
end $$;

create function public.website_hosting_accept_contract(p_actor uuid,p_order text,p_fingerprint text,p_reference text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.website_orders%rowtype; q jsonb;
begin
 perform public.website_hosting_require_admin(p_actor);
 if p_reference is null or length(trim(p_reference))<8 or length(p_reference)>240 then raise exception 'Record the customer LINE acceptance message date and identifying reference'; end if;
 select * into strict o from public.website_orders where order_code=p_order for update;
 q=o.selections->'commercial_quote';
 if o.status<>'pending_payment' or q is null or p_fingerprint is null or q->>'fingerprint' is distinct from p_fingerprint
   or coalesce(q->>'state','') not in ('sent','accepted') then raise exception 'Acceptance requires the exact completed quotation'; end if;
 if q->>'state'='accepted' then
  if q->>'acceptance_reference' is distinct from trim(p_reference) then raise exception 'An existing acceptance record cannot be replaced'; end if;
  return jsonb_build_object('accepted_at',q->'accepted_at','already_recorded',true);
 end if;
 if (q->'snapshot'->>'payment_deadline')::date<(now() at time zone 'Asia/Tokyo')::date then raise exception 'The quotation has expired; confirm revised terms with the customer'; end if;
 q=q||jsonb_build_object('state','accepted','accepted_at',now(),'accepted_by',p_actor,
   'acceptance_reference',trim(p_reference),'acceptance_method','operator_attested_LINE_reply');
 update public.website_orders set selections=selections||jsonb_build_object('commercial_quote',q),updated_at=now() where order_code=p_order;
 return jsonb_build_object('accepted_at',q->'accepted_at','already_recorded',false);
end $$;

create function public.website_hosting_require_accepted_contract() returns trigger
language plpgsql security invoker set search_path='' as $$
declare before_quote jsonb; after_quote jsonb; mutable text[]=array['state','sent_at','accepted_at','accepted_by','acceptance_reference','acceptance_method'];
begin
 before_quote=old.selections->'commercial_quote';after_quote=new.selections->'commercial_quote';
 if before_quote is not null then
  if after_quote is null or (after_quote-mutable) is distinct from (before_quote-mutable)
    or not ((before_quote->>'state'='sending' and after_quote->>'state' in ('sending','sent'))
      or (before_quote->>'state'='sent' and after_quote->>'state' in ('sent','accepted'))
      or (before_quote->>'state'='accepted' and after_quote->>'state'='accepted'))
    or (before_quote ? 'sent_at' and before_quote->'sent_at' is distinct from after_quote->'sent_at')
    or (before_quote ? 'accepted_at' and (
      before_quote->'accepted_at' is distinct from after_quote->'accepted_at' or before_quote->'accepted_by' is distinct from after_quote->'accepted_by'
      or before_quote->'acceptance_reference' is distinct from after_quote->'acceptance_reference' or before_quote->'acceptance_method' is distinct from after_quote->'acceptance_method')) then
   raise exception 'Frozen quotation content and existing acceptance records are immutable';
  end if;
  if old.selections ? 'final_quote_sent_at' and (
    new.selections->'final_quote_sent_at' is distinct from old.selections->'final_quote_sent_at'
    or new.selections->'final_quote_amount' is distinct from old.selections->'final_quote_amount'
    or new.selections->'final_public_domain' is distinct from old.selections->'final_public_domain') then
   raise exception 'Sent quotation totals, URL and timestamp are immutable';
  end if;
 end if;
 if new.status='site_created' and old.status is distinct from 'site_created'
   and exists(select 1 from public.website_hosting_urls where order_code=new.order_code) then
  if new.selections->'commercial_quote'->>'state' is distinct from 'accepted'
    or coalesce(new.selections->'commercial_quote'->>'accepted_at','')=''
    or coalesce(new.selections->'commercial_quote'->>'acceptance_reference','')=''
    or new.selections->'commercial_quote'->'snapshot'->>'public_url' is distinct from new.selections->>'final_public_domain' then
   raise exception 'Record acceptance of the exact frozen contract before confirming payment and creating a site';
  end if;
 end if;
 return new;
end $$;
create trigger website_hosting_contract_before_activation before update on public.website_orders
 for each row execute function public.website_hosting_require_accepted_contract();
revoke all on function public.website_hosting_claim_quote(uuid,text,jsonb,text,text),public.website_hosting_complete_quote(uuid,text,text),
 public.website_hosting_accept_contract(uuid,text,text,text),public.website_hosting_require_accepted_contract() from public,anon,authenticated;
grant execute on function public.website_hosting_claim_quote(uuid,text,jsonb,text,text),public.website_hosting_complete_quote(uuid,text,text),
 public.website_hosting_accept_contract(uuid,text,text,text),public.website_hosting_require_accepted_contract() to service_role;
