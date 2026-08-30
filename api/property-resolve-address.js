// Vercel Serverless Function.
// Called once, when the person picks a suggestion from the address
// autocomplete dropdown in Debts. Resolves and returns the UPRN for that
// exact address immediately, rather than waiting for the monthly cron to
// do it — so the person gets confirmation their address matched a real
// UK property right away. Costs Chimnie's 10p minimum address-lookup fee
// (see _lib/chimnieValuation.js) — this is the one paid call per
// household in the whole feature; every monthly refresh after this is
// free (looked up by the cached UPRN, not the address).
//
// Also fetches the first valuation immediately in the same request —
// once the UPRN is known, the AVM-by-UPRN lookup is free (see
// _lib/chimnieValuation.js), so there's no cost reason to make someone
// wait for the monthly cron just to see their first number. If this
// second call fails for any reason, the UPRN/address are still returned
// and saved — the monthly cron will pick up the valuation next run
// regardless, so a value-fetch failure here never loses the address.

import { requirePremiumUser } from "./_lib/requirePremiumUser.js";
import { resolveUprnFromSelectedAddress, getAvmValue } from "./_lib/chimnieValuation.js";

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

  const { address, autocompleteSession } = req.body || {};
  if (!address || !autocompleteSession) {
    res.status(400).json({ error: "Missing address or autocompleteSession." });
    return;
  }

  try {
    const result = await resolveUprnFromSelectedAddress(address, autocompleteSession, chimnieApiKey);
    let value = null;
    try {
      value = await getAvmValue(result.uprn, chimnieApiKey);
    } catch (valueErr) {
      // Address resolution still succeeded — don't fail the whole request
      // over the value fetch. The monthly cron will pick this up next
      // run since propertyUprn is now saved either way.
      console.error("property-resolve-address: value fetch failed after successful UPRN resolution:", valueErr);
    }
    res.status(200).json({ ...result, value });
  } catch (err) {
    console.error("property-resolve-address error:", err);
    res.status(502).json({ error: "Couldn't confirm that address right now." });
  }
}
