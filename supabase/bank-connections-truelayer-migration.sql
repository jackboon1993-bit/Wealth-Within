-- Wealth Within: TrueLayer bank_connections migration
-- Recreated from the actual columns read/written by:
--   api/truelayer-callback.js  (upsert: household_id, refresh_token, connected_at)
--   api/truelayer-accounts.js  (select/update: household_id, refresh_token)
--
-- This drops the old Yapily-era bank_connections table (id, user_id,
-- consent_request_id, consent_id — none of which match what TrueLayer
-- code actually uses) and recreates it with the correct schema.
--
-- NOTE: this SQL was already run successfully against the live Supabase
-- project via the SQL Editor ("Success. No rows returned") during the
-- session that built the TrueLayer integration. This file exists to get
-- that change into git for the historical record — running it again
-- against the same database is safe (DROP ... IF EXISTS / CREATE) but
-- should not be necessary.

drop table if exists bank_connections;

create table bank_connections (
  -- Primary key doubles as the upsert conflict target: truelayer-callback.js
  -- calls .upsert({ household_id, refresh_token, connected_at }) with no
  -- onConflict specified, so PostgREST matches on the primary key. One
  -- connection per household — a new consent for the same household
  -- overwrites the previous refresh_token rather than creating a second row.
  household_id uuid primary key references households(id) on delete cascade,
  refresh_token text not null,
  connected_at timestamptz not null default now()
);

alter table bank_connections enable row level security;

-- Same is_household_member() pattern already used for household_data.
create policy "Household members can view their bank connection"
  on bank_connections
  for select
  using (is_household_member(household_id));

create policy "Household members can insert their bank connection"
  on bank_connections
  for insert
  with check (is_household_member(household_id));

create policy "Household members can update their bank connection"
  on bank_connections
  for update
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy "Household members can delete their bank connection"
  on bank_connections
  for delete
  using (is_household_member(household_id));
