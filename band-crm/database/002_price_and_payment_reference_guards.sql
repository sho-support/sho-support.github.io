-- 002 Band Support CRM: server-side price floor and normalized payment reference uniqueness
alter table public.band_crm_deals
 drop constraint if exists band_crm_service_floor;
alter table public.band_crm_deals
 add constraint band_crm_service_floor check(
  amount_yen >= case service
   when 'shorts' then 2500
   when 'one_song' then 4000
   when 'full_live' then 8000
   when 'shoot_30' then 4000
   when 'shoot_60' then 6500
   else 1 end
 );
create unique index if not exists band_crm_payments_normalized_reference_uidx
 on public.band_crm_payments(lower(btrim(evidence_reference)));
