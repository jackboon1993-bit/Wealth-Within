// Vercel Serverless Function.
// Receives a batch of bank transaction descriptions + amounts from the
// browser (no account numbers, sort codes, or balances — just what's needed
// to categorize) and asks Claude to match each one to the user's own budget
// category names, and flag which look like income.
// The Anthropic API key lives only here, server-side.
//
// The actual prompt + Claude call lives in api/_lib/categorizeTransactions.js
// (categorizeBatch), shared with api/sync-bank-transactions.js's overnight
// sync — this file is just the HTTP wrapper around it for the browser.

import { categorizeBatch, persistTransactions } from "./_lib/categorizeTransactions.js";
import { requireUser } from "./_lib/requireUser.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "2mb",
    },
  },
};

export default async function handler(req, res) {
  // The native app's WebView runs from https://localhost, a different
  // origin than wealth-within.vercel.app, so every call from the app needs
  // explicit CORS permission or the browser blocks it before the request
  // reaches this handler. Must come before the method check below, since
  // browsers send a preflight OPTIONS request first for a POST like this.
  // Authorization added to the allowed headers now that this route
  // actually checks it (see requireUser below) — previously anyone could
  // POST here with no session at all, which also meant no household to
  // persist transaction history against even if this route wanted to.
  res.setHeader("Access-Control-Allow-Origin", "https://localhost");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const session = await requireUser(req, res);
  if (!session.ok) return; // response already sent — 401/404

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is not configured with an ANTHROPIC_API_KEY." });
    return;
  }

  const { transactions, categories, source } = req.body || {};
  if (!Array.isArray(transactions) || transactions.length === 0) {
    res.status(400).json({ error: "Missing transactions." });
    return;
  }
  if (!Array.isArray(categories) || categories.length === 0) {
    res.status(400).json({ error: "Missing categories." });
    return;
  }
  if (transactions.length > 200) {
    res.status(400).json({ error: "Too many transactions in one batch (max 200)." });
    return;
  }

  try {
    const results = await categorizeBatch(transactions, categories, apiKey);
    // Fire-and-forget-ish, but awaited: persisting transaction history
    // shouldn't block the response any longer than it has to, but a
    // genuine failure here is still worth knowing about server-side (see
    // persistTransactions' own error handling) rather than silently
    // losing history. Doesn't affect what's returned to the browser
    // either way — categoryTotals/results are already correct by now.
    await persistTransactions(session.admin, session.householdId, transactions, results, source || "csv");
    res.status(200).json({ results });
  } catch (err) {
    console.error("categorize-transactions error:", err);
    // categorizeBatch's own errors already have a safe, user-facing message
    // (it never includes raw transaction data) — pass it straight through.
    res.status(502).json({ error: err.message || "Something went wrong categorising these transactions." });
  }
}
