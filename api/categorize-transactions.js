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

import { categorizeBatch } from "./_lib/categorizeTransactions.js";

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
  res.setHeader("Access-Control-Allow-Origin", "https://localhost");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is not configured with an ANTHROPIC_API_KEY." });
    return;
  }

  const { transactions, categories } = req.body || {};
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
    res.status(200).json({ results });
  } catch (err) {
    console.error("categorize-transactions error:", err);
    // categorizeBatch's own errors already have a safe, user-facing message
    // (it never includes raw transaction data) — pass it straight through.
    res.status(502).json({ error: err.message || "Something went wrong categorising these transactions." });
  }
}
