// api/detect-subscriptions.js
//
// Wraps the shared detectRecurringPayments logic (api/_lib/detectRecurringPayments.js)
// so the manual "Pull transactions from my connected bank" button can use
// the exact same subscription-detection Claude call the nightly sync
// already uses, instead of duplicating that logic — a manual pull just
// runs the same detection on-demand rather than waiting for the overnight
// job.

import { detectRecurringPayments } from "./_lib/detectRecurringPayments.js";
import { requirePremiumUser } from "./_lib/requirePremiumUser.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "2mb",
    },
  },
  // Detecting recurring payments sends the household's whole pulled
  // transaction history to Claude in a single request (unlike
  // categorize-transactions.js, which batches) — for a large pull this
  // can genuinely take longer than Vercel's default 10s limit, which was
  // silently killing the request and surfacing as a 502 to the app.
  maxDuration: 60,
};

export default async function handler(req, res) {
  // See truelayer-accounts.js for why this is needed — the native app
  // calls this directly from https://localhost.
  res.setHeader("Access-Control-Allow-Origin", "https://localhost");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Subscription detection (manual pull) is a Premium feature — see the
  // priority to-do list, "Feature gating: ... subscription detection
  // (both directions)". The nightly-sync version of this same detection
  // (job 2 in sync-bank-transactions.js) is gated separately, per-
  // household, in that file — see item 3. Also closes a real gap: this
  // route had no auth at all before, so anyone could POST here and spend
  // Anthropic API credit regardless of sign-in or subscription status.
  const session = await requirePremiumUser(req, res);
  if (!session.ok) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is not configured with an ANTHROPIC_API_KEY." });
    return;
  }

  const { transactions, existingNames } = req.body || {};
  if (!Array.isArray(transactions) || transactions.length === 0) {
    res.status(400).json({ error: "Missing transactions." });
    return;
  }

  try {
    const suggestions = await detectRecurringPayments(transactions, Array.isArray(existingNames) ? existingNames : [], apiKey);
    res.status(200).json({ suggestions, possiblyStopped: suggestions.possiblyStopped || [] });
  } catch (err) {
    console.error("detect-subscriptions error:", err);
    res.status(502).json({ error: err.message || "Something went wrong detecting subscriptions." });
  }
}
