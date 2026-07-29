create table if not exists public.supporters (
  id bigint generated always as identity primary key,
  email text not null unique,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  status text not null default 'inactive',
  plan_amount integer,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.supporters enable row level security;

-- ブラウザーから直接supportersテーブルを読ませません。
-- Vercel APIがservice role keyを使って確認します。
revoke all on table public.supporters from anon, authenticated;

create table if not exists public.webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
revoke all on table public.webhook_events from anon, authenticated;
