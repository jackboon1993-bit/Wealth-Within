// Vercel Cron Job — runs nightly.
//
// For every household with a connected bank, pulls transactions from
// TrueLayer since that connection's last_synced_at (or a 90-day lookback
// if it's never been synced), categorizes them with the same pipeline
// CSV import and the manual bank pull already use, and stages the result
// as household_data.data.pendingBankSync for review — it does NOT touch
// the budget directly. Every other import path in this app requires an
// explicit "Apply to my budget" tap before anything is saved; this cron
// job keeps that guarantee by fetching and categorizing automatically
// but leaving the actual apply to a person, next time they open the app.
// See src/tabs/BankImportTab.jsx and OverviewTab.jsx for the review UI.
//
// IMPORTANT — last_synced_at is intentionally NOT updated by this job.
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

const TOKEN_URL = "https://auth.truelayer.com/connect/token";
const API_BASE = "https://api.truelayer.com/data/v1";
const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_TRANSACTIONS = 1000;

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
  const results = { synced: 0, noNewTransactions: 0, skipped: 0, errors: [] };

  const { data: connections, error: connError } = await admin
    .from("bank_connections")
    .select("household_id, refresh_token, last_synced_at");
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
  const { household_id: householdId, refresh_token: refreshToken, last_synced_at: lastSyncedAt } = conn;

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

  const to = new Date();
  const from = lastSyncedAt ? new Date(lastSyncedAt) : new Date(to.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const fromParam = isoDate(from);
  const toParam = isoDate(to);

  const perAccountResults = await Promise.all(
    accountIds.map(async (accountId) => {
      const txResp = await fetch(
        `${API_BASE}/accounts/${accountId}/transactions?from=${fromParam}&to=${toParam}`,
        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
      );
      if (!txResp.ok) return []; // one account failing shouldn't sink the whole household's sync
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

  if (transactions.length === 0) {
    results.noNewTransactions++;
    return;
  }

  const { categoryTotals, incomeEstimate } = await categorizeAndSummarize(transactions, categories, apiKey);

  const pendingBankSync = {
    categoryTotals,
    incomeEstimate,
    transactionCount: transactions.length,
    fromDate: fromParam,
    toDate: toParam,
    syncedAt: new Date().toISOString(),
  };

  await admin.from("household_data").upsert({
    household_id: householdId,
    data: { ...(profileData || {}), pendingBankSync },
    updated_at: new Date().toISOString(),
  });

  results.synced++;
}
