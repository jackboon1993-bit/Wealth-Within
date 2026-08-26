// Vercel Cron Job — runs nightly.
//
// Does two separate jobs for every household with a connected bank:
//
// 1. Transaction sync (every run): pulls transactions since that
//    connection's last_synced_at (or a 90-day lookback if it's never
//    been synced), categorizes them with the same pipeline CSV import
//    and the manual bank pull already use, and stages the result as
//    household_data.data.pendingBankSync for review — it does NOT touch
//    the budget directly. See src/tabs/BankImportTab.jsx and
//    OverviewTab.jsx for the review UI.
//
// 2. Subscription/bill detection (roughly weekly per household, see
//    last_subscription_scan_at below): pulls a fresh 90-day window and
//    asks Claude to spot recurring subscriptions/bills, staging any
//    finds as household_data.data.pendingSubscriptions — again, never
//    written straight into profile.subscriptions. See IncomeTab.jsx for
//    the review UI (Add / Dismiss per suggestion).
//
// Every other import path in this app requires an explicit accept
// before anything is saved; both jobs above keep that guarantee by
// fetching and analysing automatically but leaving the actual apply to
// a person, next time they open the app.
//
// IMPORTANT — last_synced_at is intentionally NOT updated by job 1.
// It only moves forward when a bank-sourced review is actually applied
// (see the top-of-file comment in the migration this depends on:
// supabase/bank-connections-last-synced-migration.sql). That means this
// job always recomputes pendingBankSync from scratch over the full
// unreviewed window each run — slightly more repeated work than an
// incrementally-advancing cursor, but it guarantees no household's
// unreviewed days ever get silently dropped just because they didn't
// open the app for a few days.
//
// Requires the same CRON_SECRET Vercel env var as api/inactivity-check.js
// (Vercel automatically sends it as "Authorization: Bearer <CRON_SECRET>"
// when triggering this on schedule) — without this check, anyone who
// found this URL could trigger unlimited Anthropic API usage against
// every connected household.

import { createClient } from "@supabase/supabase-js";
import { categorizeAndSummarize } from "./_lib/categorizeTransactions.js";
import { detectRecurringPayments } from "./_lib/detectRecurringPayments.js";

const TOKEN_URL = "https://auth.truelayer.com/connect/token";
const API_BASE = "https://api.truelayer.com/data/v1";
const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_TRANSACTIONS = 1000;
// How often to re-run subscription/bill detection per household — see
// supabase/subscription-scan-cadence-migration.sql for the reasoning.
const SUBSCRIPTION_SCAN_INTERVAL_DAYS = 7;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || "";
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !serviceRoleKey) {
    res.status(500).json({ error: "Server is not configured for bank sync." });
    return;
  }
  if (!apiKey) {
    res.status(500).json({ error: "Server is not configured with an ANTHROPIC_API_KEY." });
    return;
  }

  const admin = createClient(url, serviceRoleKey);
  const results = { synced: 0, noNewTransactions: 0, skipped: 0, subscriptionsScanned: 0, errors: [] };

  const { data: connections, error: connError } = await admin
    .from("bank_connections")
    .select("household_id, refresh_token, last_synced_at, last_subscription_scan_at");
  if (connError) {
    res.status(500).json({ error: connError.message });
    return;
  }

  for (const conn of connections || []) {
    try {
      await syncOne(admin, apiKey, conn, results);
    } catch (e) {
      results.errors.push(`household ${conn.household_id}: ${e.message || e}`);
    }
  }

  res.status(200).json(results);
}

async function syncOne(admin, apiKey, conn, results) {
  const { household_id: householdId, refresh_token: refreshToken, last_synced_at: lastSyncedAt, last_subscription_scan_at: lastScanAt } = conn;

  // Household's own budget category names are needed to categorize
  // against — same source the frontend review screen uses
  // (profile.expenseCategories). If there's no household_data row yet,
  // or no categories set up, there's nothing sensible to categorize
  // into, so skip this household this run rather than guessing.
  const { data: householdRow } = await admin.from("household_data").select("data").eq("household_id", householdId).maybeSingle();
  const profileData = householdRow?.data || null;
  const categories = (profileData?.expenseCategories || []).map((c) => c.name).filter(Boolean);
  if (categories.length === 0) {
    results.skipped++;
    return;
  }

  const tokenResp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: (process.env.TRUELAYER_CLIENT_ID || "").trim(),
      client_secret: (process.env.TRUELAYER_CLIENT_SECRET || "").trim(),
      refresh_token: refreshToken,
    }),
  });
  const tokens = await tokenResp.json();
  if (!tokenResp.ok) throw new Error(tokens.error_description || "Refresh failed");

  // Refresh tokens can rotate on use — same as truelayer-accounts.js and
  // truelayer-transactions.js — store the new one immediately so a
  // failure partway through this household doesn't leave a stale token
  // for tomorrow's run.
  if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    await admin.from("bank_connections").update({ refresh_token: tokens.refresh_token }).eq("household_id", householdId);
  }

  const accountsResp = await fetch(`${API_BASE}/accounts`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const accountsData = await accountsResp.json();
  const accountIds = (accountsData.results || []).map((a) => a.account_id);
  const accessToken = tokens.access_token;

  // Everything staged in household_data this run gets merged into one
  // object and written in a single upsert at the end, so a household
  // that gets both a transaction sync AND a subscription scan in the
  // same run doesn't risk one write clobbering the other.
  const dataToWrite = { ...(profileData || {}) };
  let wroteAnything = false;

  // ---- 1. Incremental transaction sync ----
  const bankSyncTx = await fetchTransactions(accountIds, accessToken, lastSyncedAt);
  if (bankSyncTx.transactions.length === 0) {
    results.noNewTransactions++;
  } else {
    const { categoryTotals, incomeEstimate } = await categorizeAndSummarize(bankSyncTx.transactions, categories, apiKey);
    dataToWrite.pendingBankSync = {
      categoryTotals,
      incomeEstimate,
      transactionCount: bankSyncTx.transactions.length,
      fromDate: bankSyncTx.fromParam,
      toDate: bankSyncTx.toParam,
      syncedAt: new Date().toISOString(),
    };
    wroteAnything = true;
    results.synced++;
  }

  // ---- 2. Periodic subscription/bill detection ----
  const scanDue = !lastScanAt || (Date.now() - new Date(lastScanAt).getTime()) / (24 * 60 * 60 * 1000) >= SUBSCRIPTION_SCAN_INTERVAL_DAYS;
  if (scanDue) {
    // Independent 90-day window, not tied to last_synced_at — spotting a
    // recurring pattern needs to see multiple occurrences regardless of
    // how recently the budget itself was last synced.
    const detectionTx = await fetchTransactions(accountIds, accessToken, null);
    const existingNames = (profileData?.subscriptions || []).map((s) => s.name).filter(Boolean);
    if (detectionTx.transactions.length > 0) {
      const suggestions = await detectRecurringPayments(detectionTx.transactions, existingNames, apiKey);
      dataToWrite.pendingSubscriptions = suggestions;
      wroteAnything = true;
    }
    await admin.from("bank_connections").update({ last_subscription_scan_at: new Date().toISOString() }).eq("household_id", householdId);
    results.subscriptionsScanned++;
  }

  if (wroteAnything) {
    await admin.from("household_data").upsert({
      household_id: householdId,
      data: dataToWrite,
      updated_at: new Date().toISOString(),
    });
  }
}

// Fetches transactions across every account on this connection, from
// `since` (or a 90-day lookback if since is null/undefined) up to now.
async function fetchTransactions(accountIds, accessToken, since) {
  const to = new Date();
  const from = since ? new Date(since) : new Date(to.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const fromParam = isoDate(from);
  const toParam = isoDate(to);

  const perAccountResults = await Promise.all(
    accountIds.map(async (accountId) => {
      const txResp = await fetch(
        `${API_BASE}/accounts/${accountId}/transactions?from=${fromParam}&to=${toParam}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!txResp.ok) return []; // one account failing shouldn't sink the whole household's fetch
      const txData = await txResp.json();
      return txData.results || [];
    })
  );

  const transactions = perAccountResults
    .flat()
    .map((t) => ({
      description: t.merchant_name || t.description || "Unknown",
      amount: t.amount,
      date: t.timestamp,
    }))
    .filter((t) => typeof t.amount === "number" && t.date)
    .slice(0, MAX_TRANSACTIONS);

  return { transactions, fromParam, toParam };
}
