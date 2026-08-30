// Vercel Serverless Function.
// Proxies Chimnie's Address Autocomplete endpoint so the API key never
// reaches the browser. Called as the person types their property address
// in Debts (debounced client-side — see DebtsTab.jsx). Returns address
// suggestion strings plus an autocomplete_session id, which the client
// must send back unchanged to api/property-resolve-address.js when a
// suggestion is picked (Chimnie uses it to correlate the two calls).

import { requirePremiumUser } from "./_lib/requirePremiumUser.js";
import { searchAddresses } from "./_lib/chimnieValuation.js";

export default async function handler(req, res) {
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

  // Automatic home valuation (and the address search that feeds it) is a
  // Premium feature — see api/update-home-values.js for the matching
  // gate on the monthly cron side.
  const session = await requirePremiumUser(req, res);
  if (!session.ok) return;

  const chimnieApiKey = (process.env.CHIMNIE_API_KEY || "").trim();
  if (!chimnieApiKey) {
    res.status(500).json({ error: "Server is not configured with a CHIMNIE_API_KEY." });
    return;
  }

  const { query } = req.body || {};
  if (!query || typeof query !== "string" || query.trim().length < 3) {
    res.status(400).json({ error: "Query must be at least 3 characters." });
    return;
  }

  try {
    const result = await searchAddresses(query.trim(), chimnieApiKey);
    res.status(200).json(result);
  } catch (err) {
    console.error("property-address-search error:", err);
    res.status(502).json({ error: "Couldn't search addresses right now." });
  }
}
