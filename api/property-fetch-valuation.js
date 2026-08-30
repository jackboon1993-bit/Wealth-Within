// Vercel Serverless Function.
// Fetches (or retries) the home valuation for a household that already
// has a confirmed propertyUprn — the value-fetch step from
// api/property-resolve-address.js can be triggered again here without
// re-resolving the address, since the UPRN never changes once resolved.
// Exists specifically for the case where the value fetch failed the
// first time (e.g. Chimnie's free-tier rate limit) and the person is
// left with a confirmed address but no value — this gives them a way to
// just retry the free part, rather than needing to reset to manual entry
// and search their address from scratch again (which would also cost
// another 10p unnecessarily, since the UPRN is already known and cached).

import { requirePremiumUser } from "./_lib/requirePremiumUser.js";
import { getAvmValue } from "./_lib/chimnieValuation.js";

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

  const session = await requirePremiumUser(req, res);
  if (!session.ok) return;

  const chimnieApiKey = (process.env.CHIMNIE_API_KEY || "").trim();
  if (!chimnieApiKey) {
    res.status(500).json({ error: "Server is not configured with a CHIMNIE_API_KEY." });
    return;
  }

  const { uprn } = req.body || {};
  if (!uprn) {
    res.status(400).json({ error: "Missing uprn." });
    return;
  }

  try {
    const value = await getAvmValue(uprn, chimnieApiKey);
    res.status(200).json({ value });
  } catch (err) {
    console.error("property-fetch-valuation error:", err);
    res.status(502).json({ error: "Couldn't fetch a valuation right now — try again in a moment." });
  }
}
