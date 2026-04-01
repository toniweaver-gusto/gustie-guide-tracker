-- Uplimit Training Dashboard — saved snapshots (accessed via Next.js API + service role)
-- Run in Supabase SQL Editor or via CLI: supabase db push

create extension if not exists "pgcrypto";

create table if not exists public.uplimit_dashboards (
  id uuid primary key default gen_random_uuid(),
  share_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  program_name text not null default 'Training Dashboard',
  processed_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_uplimit_dashboards_share_token
  on public.uplimit_dashboards (share_token);

comment on table public.uplimit_dashboards is
  'Deduplicated Uplimit CSV aggregates. Server: service role. Static SPA: run 002_uplimit_dashboards_anon_rpc.sql and use anon + RPCs.';

alter table public.uplimit_dashboards enable row level security;

-- No GRANT to anon/authenticated — only the service role (used server-side) bypasses RLS.

create or replace function public.touch_uplimit_dashboards_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_uplimit_dashboards_touch on public.uplimit_dashboards;
create trigger trg_uplimit_dashboards_touch
  before update on public.uplimit_dashboards
  for each row
  execute procedure public.touch_uplimit_dashboards_updated_at();
