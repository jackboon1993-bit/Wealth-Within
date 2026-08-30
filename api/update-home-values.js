// Vercel Cron Job — runs monthly (see vercel.json).
//
// For every Premium household that's typed in a propertyAddress:
//   1. If they don't have a propertyUprn cached yet, resolve one from the
//      address (this is the only step that costs money — see
//      _lib/chimnieValuation.js — and it only ever happens once per
//      household, since the UPRN is then cached forever).
//   2. Look up the current AVM value for that UPRN (free) and write it
//      into household_data.data.homeValue, stamping homeValueUpdatedAt
//      and homeValueSource: "auto".
//
// Gated to Premium households only — same reasoning and same pattern as
// api/sync-bank-transactions.js's nightly bank sync: this is an ongoing
// automation convenience, not a one-off calculation, so it follows the
// same "cancel and it stops updating automatically" shape rather than
// being locked away entirely (a free user can still type in a home value
// by hand any time).
//
// Requires CRON_SECRET (same as every other cron in this project) and a
// CHIMNIE_API_KEY environment variable. See _lib/chimnieValuation.js for
// an important note: the exact Chimnie endpoint/response shape used here
// hasn't been verified against their real API docs (only their public
// marketing/pricing pages) — confirm and adjust that file before this
// runs against real data.

export const config = {
  maxDuration: 300,
};

import { createClient } from "@supabase/supabase-js";
import { resolveUprnFromAddress, getAvmValue } from "./_lib/chimnieValuation.js";

// Small batches, same reasoning as sync-bank-transactions.js's
// SYNC_BATCH_SIZE — deliberately conservative rather than fully parallel.
const VALUATION_BATCH_SIZE = 5;

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || "";
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const chimnieApiKey = (process.env.CHIMNIE_API_KEY || "").trim();
  if (!url || !serviceRoleKey) {
    res.status(500).json({ error: "Server is not configured for home valuation updates." });
    return;
  }
  if (!chimnieApiKey) {
    res.status(500).json({ error: "Server is not configured with a CHIMNIE_API_KEY." });
    return;
  }

  const admin = createClient(url, serviceRoleKey);
  const results = { uprnResolved: 0, valuesUpdated: 0, skippedNotPremium: 0, skippedNoAddress: 0, errors: [] };

  const { data: rows, error: fetchError } = await admin.from("household_data").select("household_id, data");
  if (fetchError) {
    res.status(500).json({ error: fetchError.message });
    return;
  }

  const candidates = (rows || []).filter((r) => r.data && r.data.propertyAddress);
  if (!candidates.length) {
    res.status(200).json(results);
    return;
  }

  const householdIds = candidates.map((r) => r.household_id);
  const { data: subs } = await admin.from("subscriptions").select("household_id, status").in("household_id", householdIds);
  const statusByHousehold = new Map((subs || []).map((s) => [s.household_id, s.status]));
  const hasPremium = (householdId) => {
    const status = statusByHousehold.get(householdId);
    return status === "trialing" || status === "active";
  };

  for (let i = 0; i < candidates.length; i += VALUATION_BATCH_SIZE) {
    const batch = candidates.slice(i, i + VALUATION_BATCH_SIZE);
    await Promise.all(
      batch.map(async (row) => {
        if (!hasPremium(row.household_id)) {
          results.skippedNotPremium++;
          return;
        }
        try {
          let uprn = row.data.propertyUprn;
          if (!uprn) {
            uprn = await resolveUprnFromAddress(row.data.propertyAddress, chimnieApiKey);
            results.uprnResolved++;
          }
          const value = await getAvmValue(uprn, chimnieApiKey);
          const updatedData = {
            ...row.data,
            propertyUprn: uprn,
            homeValue: value,
            homeValueSource: "auto",
            homeValueUpdatedAt: new Date().toISOString(),
          };
          const { error: updateError } = await admin
            .from("household_data")
            .update({ data: updatedData })
            .eq("household_id", row.household_id);
          if (updateError) throw updateError;
          results.valuesUpdated++;
        } catch (err) {
          results.errors.push({ household_id: row.household_id, error: err.message });
        }
      })
    );
  }

  res.status(200).json(results);
}
