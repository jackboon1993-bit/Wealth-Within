-- Wealth Within: adds the cadence column for recurring
-- subscription/bill detection (api/sync-bank-transactions.js).
--
-- Detection is deliberately NOT run every night alongside the regular
-- transaction sync — spotting a genuine recurring pattern needs a wide
-- lookback (90 days) to see multiple occurrences, and re-running that
-- full pattern-search nightly would mean paying for an unnecessary
-- Claude call most nights, since a merchant that wasn't recurring
-- yesterday is very unlikely to have become recurring today.
-- last_subscription_scan_at tracks when this household was last
-- scanned; the sync job only re-scans once at least 7 days have passed.
--
-- Safe to run more than once (IF NOT EXISTS).

alter table bank_connections
  add column if not exists last_subscription_scan_at timestamptz;
