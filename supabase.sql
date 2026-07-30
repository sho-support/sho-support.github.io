create table if not exists public.supporters (
  id bigint generated always as identity primary key,
  email text not null unique,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'inactive',
  plan_amount integer,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_event_created bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 以前のSQLを実行済みでも不足列を追加できます。
alter table public.supporters add column if not exists cancel_at_period_end boolean not null default false;
alter table public.supporters add column if not exists last_event_created bigint not null default 0;
create unique index if not exists supporters_subscription_id_unique
  on public.supporters (stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.supporters enable row level security;
revoke all on table public.supporters from anon, authenticated;

create table if not exists public.webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
revoke all on table public.webhook_events from anon, authenticated;
