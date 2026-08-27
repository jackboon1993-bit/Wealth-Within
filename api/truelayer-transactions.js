// api/truelayer-transactions.js
//
// Called from the app (with the signed-in user's Supabase access token) to
// pull transaction history from the household's connected bank via
// TrueLayer's Data API, so it can be run through the same
// categorize-transactions pipeline that CSV import already uses.
//
// Mirrors the auth/refresh-token pattern in api/truelayer-accounts.js
// exactly — see that file for the reasoning behind each check.
//
// Returns transactions already shaped as { description, amount, date }
// (date as an ISO string, amount signed the same way CSV-parsed rows are:
// positive = money in, negative = money out) so the frontend can hand them
// straight to the existing categorize() flow with no extra mapping.
//
// This is a one-time pull, not an ongoing sync — the frontend re-fetches
// whenever the person chooses to import from their connected bank again.
// Subscription/bill detection and automatic background sync are separate,
// not-yet-built follow-ups.

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient((process.env.SUPABASE_URL || "").trim(), (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim());
const TOKEN_URL = "https://auth.truelayer.com/connect/token";
const API_BASE = "https://api.truelayer.com/data/v1";

// How far back to pull on a one-time import. 90 days covers most people's
// "get me started" use case without the request ballooning in size; some
// banks won't return more than this anyway depending on the consent given.
const DEFAULT_LOOKBACK_DAYS = 90;
// Hard ceiling so a single request can't grow unbounded — matches the
// batch cap already enforced in api/categorize-transactions.js (200 per
// batch); the frontend can batch this many across multiple categorize
// calls the same way it already does for CSV rows.
const MAX_TRANSACTIONS = 1000;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  // See truelayer-accounts.js for why this is needed — the native app's
  // WebView runs from https://localhost, a different origin than
  // wealth-within.vercel.app, so every call from the app needs explicit
  // CORS permission or the browser blocks it before the request even
  // reaches this handler.
  res.setHeader("Access-Control-Allow-Origin", "https://localhost");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const authHeader = req.headers.authorization || "";
  const userToken = authHeader.replace("Bearer ", "");
  if (!userToken) return res.status(401).json({ error: "Not signed in." });

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(userToken);
  if (userError || !userData?.user) return res.status(401).json({ error: "Invalid session." });

  const { data: membership } = await supabaseAdmin
    .from("household_members")
    .select("household_id")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return res.status(404).json({ error: "No household found." });

  const { data: connection } = await supabaseAdmin
    .from("bank_connections")
    .select("refresh_token")
    .eq("household_id", membership.household_id)
    .maybeSingle();
  if (!connection) return res.status(404).json({ error: "No bank connected." });

  try {
    const tokenResp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: (process.env.TRUELAYER_CLIENT_ID || "").trim(),
        client_secret: (process.env.TRUELAYER_CLIENT_SECRET || "").trim(),
        refresh_token: connection.refresh_token,
      }),
    });
    const tokens = await tokenResp.json();
    if (!tokenResp.ok) throw new Error(tokens.error_description || "Refresh failed");

    const accountsResp = await fetch(`${API_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const accountsData = await accountsResp.json();
    const accountIds = (accountsData.results || []).map((a) => a.account_id);

    const to = new Date();
    const from = new Date(to.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const fromParam = isoDate(from);
    const toParam = isoDate(to);

    const perAccountResults = await Promise.all(
      accountIds.map(async (accountId) => {
        const txResp = await fetch(
          `${API_BASE}/accounts/${accountId}/transactions?from=${fromParam}&to=${toParam}`,
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        if (!txResp.ok) return []; // one account failing shouldn't sink the whole import
        const txData = await txResp.json();
        return txData.results || [];
      })
    );

    const transactions = perAccountResults
      .flat()
      .map((t) => ({
        description: t.merchant_name || t.description || "Unknown",
        // TrueLayer already signs amounts (negative = money out, positive
        // = money in) for current accounts, matching what
        // categorize-transactions.js expects — no sign-flipping needed.
        amount: t.amount,
        date: t.timestamp,
      }))
      .filter((t) => typeof t.amount === "number" && t.date)
      .slice(0, MAX_TRANSACTIONS);

    // Refresh tokens can themselves rotate on use — same as
    // truelayer-accounts.js — so store the new one or the next call fails.
    if (tokens.refresh_token && tokens.refresh_token !== connection.refresh_token) {
      await supabaseAdmin
        .from("bank_connections")
        .update({ refresh_token: tokens.refresh_token })
        .eq("household_id", membership.household_id);
    }

    return res.status(200).json({ transactions });
  } catch (err) {
    console.error("TrueLayer transactions error:", err);
    return res.status(500).json({ error: "Couldn't fetch transaction data." });
  }
}
