-- Keep public.website_jobs consistent with the production update-request workflow.
alter table public.website_jobs drop constraint if exists website_jobs_kind_check;
alter table public.website_jobs
  add constraint website_jobs_kind_check
  check (kind = any(array[
    'initial_create','customer_revision','sho_revision','improvement','customer_update'
  ]::text[]));
