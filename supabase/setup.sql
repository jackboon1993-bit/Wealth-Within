-- Run this once in your Supabase project's SQL editor (Dashboard -> SQL Editor -> New query).
-- It creates one table, with one row per signed-in user, holding their whole
-- household profile as a single JSON blob — deliberately simple to start.
-- Row-level security means a user can only ever read or write their own row,
-- enforced by the database itself, not just by app code.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can delete their own profile"
  on public.profiles for delete
  using (auth.uid() = id);
