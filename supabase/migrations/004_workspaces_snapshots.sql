-- Team workspaces + versioned CSV snapshots (anon RLS — demo / internal use only).

create extension if not exists "pgcrypto";

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  team_slug text unique not null,
  team_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  label text,
  agent_count int,
  module_count int,
  processed_data jsonb not null,
  share_token text not null unique default gen_random_uuid()::text,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_snapshots_workspace_uploaded
  on public.snapshots (workspace_id, uploaded_at desc);

create index if not exists idx_snapshots_share_token
  on public.snapshots (share_token);

alter table public.workspaces enable row level security;
alter table public.snapshots enable row level security;

drop policy if exists "public access workspaces" on public.workspaces;
create policy "public access workspaces"
  on public.workspaces
  for all
  using (true)
  with check (true);

drop policy if exists "public access snapshots" on public.snapshots;
create policy "public access snapshots"
  on public.snapshots
  for all
  using (true)
  with check (true);

grant select, insert, update, delete on public.workspaces to anon, authenticated;
grant select, insert, update, delete on public.snapshots to anon, authenticated;
