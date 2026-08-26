-- Wealth Within: adds the cursor column the overnight transaction-sync
-- cron job (api/sync-bank-transactions.js) needs.
--
-- Meaning of last_synced_at: NOT "the last time we fetched from
-- TrueLayer" — it's "the last date the household's transactions have
-- actually been reviewed and applied to the budget". The cron job reads
-- from here (or 90 days ago if null) up to now every night and can
-- safely overwrite its draft each run, because the window always covers
-- everything since the last real apply — nothing is ever silently
-- skipped, and nothing needs deduplicating. Only two places ever move
-- this column forward: applying a bank-sourced review in
-- src/tabs/BankImportTab.jsx (both the manual "Pull transactions" button
-- and a reviewed overnight sync), never the cron job itself.
--
-- Safe to run more than once (IF NOT EXISTS).

alter table bank_connections
  add column if not exists last_synced_at timestamptz;
