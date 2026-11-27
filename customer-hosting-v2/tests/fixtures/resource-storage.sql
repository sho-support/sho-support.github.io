-- Synthetic Storage metadata only; no uploads or production data.
create schema storage;
grant usage on schema storage to authenticated,service_role;
create table storage.buckets(id text primary key,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null,metadata jsonb);
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to authenticated,service_role;
grant select on storage.buckets to service_role;
-- Existing ownership is deliberately permissive here to prove the restrictive gate still wins.
create policy existing_owner_access on storage.objects for all to authenticated using(true) with check(true);
insert into storage.buckets values('website-intake-files',false,7000000,array['image/png','image/jpeg','image/gif','image/webp','image/avif']);
insert into storage.objects(bucket_id,name,metadata) values('website-intake-files','legacy/unrelated.png','{"size":1}');
