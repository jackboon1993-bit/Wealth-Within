-- Household/family sharing migration. Run this ONCE in your Supabase
-- project's SQL editor (Dashboard -> SQL Editor -> New query), ideally with
-- Jack and Claude going through it together rather than pasting the whole
-- thing blind — some of these statements (especially the RLS policies and
-- the data-migration block near the end) are worth checking the results of
-- as you go.
--
-- Safe to run on a project that already has the old `profiles` table —
-- this migration does NOT touch or drop it. It's kept in place as a
-- rollback safety net; drop it manually only once you've confirmed
-- everything works on the new tables.

-- ============================================================
-- 1. Schema
-- ============================================================

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My household',
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.household_data (
  household_id uuid primary key references public.households(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  code text not null unique default substr(md5(random()::text), 1, 8),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

-- ============================================================
-- 2. Row-level security
-- ============================================================

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_data enable row level security;
alter table public.household_invites enable row level security;

create policy "members can view their household"
  on public.households for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = households.id and m.user_id = auth.uid()
  ));

create policy "members can update their household"
  on public.households for update
  using (exists (
    select 1 from public.household_members m
    where m.household_id = households.id and m.user_id = auth.uid()
  ));

create policy "members can delete their household"
  on public.households for delete
  using (exists (
    select 1 from public.household_members m
    where m.household_id = households.id and m.user_id = auth.uid()
  ));

create policy "members can view co-members"
  on public.household_members for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = household_members.household_id and m.user_id = auth.uid()
  ));

create policy "members can remove themselves"
  on public.household_members for delete
  using (user_id = auth.uid());

create policy "members can view household data"
  on public.household_data for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = household_data.household_id and m.user_id = auth.uid()
  ));

create policy "members can update household data"
  on public.household_data for update
  using (exists (
    select 1 from public.household_members m
    where m.household_id = household_data.household_id and m.user_id = auth.uid()
  ));

create policy "members can delete household data"
  on public.household_data for delete
  using (exists (
    select 1 from public.household_members m
    where m.household_id = household_data.household_id and m.user_id = auth.uid()
  ));

create policy "members can insert household data"
  on public.household_data for insert
  with check (exists (
    select 1 from public.household_members m
    where m.household_id = household_data.household_id and m.user_id = auth.uid()
  ));

create policy "members can view their household's invites"
  on public.household_invites for select
  using (exists (
    select 1 from public.household_members m
    where m.household_id = household_invites.household_id and m.user_id = auth.uid()
  ));

create policy "members can create invites for their household"
  on public.household_invites for insert
  with check (exists (
    select 1 from public.household_members m
    where m.household_id = household_invites.household_id and m.user_id = auth.uid()
  ));

-- ============================================================
-- 3. Functions (security definer — do their own validation, see
--    household-sharing-design.md for why this is the safe pattern here)
-- ============================================================

create or replace function public.create_household(household_name text default 'My household')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.households (name, owner_id) values (household_name, auth.uid())
    returning id into new_id;
  insert into public.household_members (household_id, user_id) values (new_id, auth.uid());
  insert into public.household_data (household_id, data) values (new_id, '{}'::jsonb);
  return new_id;
end;
$$;

create or replace function public.join_household(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_household uuid;
begin
  -- Enforce "one household at a time" at the source, not just as a UI
  -- convention — a person already in a household can't accidentally end up
  -- in two via a stray joinHousehold() call.
  if exists (select 1 from public.household_members where user_id = auth.uid()) then
    raise exception 'You already belong to a household — leave it first before joining another.';
  end if;

  select household_id into target_household
  from public.household_invites
  where code = invite_code and expires_at > now();

  if target_household is null then
    raise exception 'Invite code is invalid or expired';
  end if;

  insert into public.household_members (household_id, user_id)
  values (target_household, auth.uid())
  on conflict do nothing;

  return target_household;
end;
$$;

-- ============================================================
-- 4. Migrate existing solo users into one-person households
-- ============================================================
-- Safe to re-run: existing profiles rows are untouched, and this only
-- creates a household for a profiles row that doesn't already have one via
-- household_data. If you run this migration twice by accident, each run
-- would create DUPLICATE households for the same user — so in practice,
-- run it once, confirm the row counts below make sense, and don't re-run.

do $$
declare
  r record;
  new_household uuid;
begin
  for r in select * from public.profiles loop
    insert into public.households (name, owner_id) values ('My household', r.id)
      returning id into new_household;
    insert into public.household_members (household_id, user_id) values (new_household, r.id);
    insert into public.household_data (household_id, data) values (new_household, r.data);
  end loop;
end $$;

-- Sanity checks worth running after the block above:
--   select count(*) from public.profiles;           -- old row count
--   select count(*) from public.households;         -- should match
--   select count(*) from public.household_members;  -- should match
--   select count(*) from public.household_data;     -- should match
