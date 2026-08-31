// Vercel Cron Job — runs monthly (see vercel.json).
//
// Automatically applies the same balance-decay calculation the app
// already shows live in Debts ("Estimated today: £X — confirmed £Y N
// days ago") — but actually WRITES the result back as the new confirmed
// balance, with lastConfirmedAt reset to today. Before this, that update
// only ever happened if the person manually clicked "Edit" -> "Save" (or
// used the plain balance input, which calls confirmBalance directly) —
// so records could quietly drift out of date if someone didn't check in.
//
// Covers mortgage, loans, and credit cards — anywhere a balance/rate/
// payment/lastConfirmedAt exists. Applied to every household, not just
// Premium ones: this is pure arithmetic on data already in Supabase, no
// external API call and no cost, unlike the home-valuation or bank-sync
// crons — so there's no reason to gate it.
//
// *** IMPORTANT: this duplicates estimateBalanceToday() from
// src/lib/finance.js on purpose — Vercel serverless functions (api/) and
// the Vite client bundle (src/) are two separate build contexts that
// don't share code today, so this can't just import the client version.
// If that function's amortization logic is ever changed, this copy must
// be updated to match, or the live "Estimated today" figure shown in the
// app and what this cron actually writes to the database will silently
// diverge. ***

export const config = {
  maxDuration: 300,
};

import { createClient } from "@supabase/supabase-js";

const DECAY_BATCH_SIZE = 10;

// Exact copy of src/lib/finance.js's estimateBalanceToday() — see the
// file-level note above on why this can't just be imported instead.
function daysSince(dateStr) {
  if (!dateStr) return 0;
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)));
}

function estimateBalanceToday(balance, annualRatePct, payment, lastConfirmedAt, paymentDayOfMonth) {
  if (!isFinite(balance)) return balance;
  const monthlyRate = annualRatePct / 100 / 12;
  let bal = balance;

  if (paymentDayOfMonth) {
    const last = new Date(lastConfirmedAt);
    const now = new Date();
    if (!(now > last)) return bal;

    let cursor = new Date(last.getFullYear(), last.getMonth(), paymentDayOfMonth);
    if (cursor <= last) cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, paymentDayOfMonth);
    while (cursor <= now) {
      if (bal <= 0) break;
      const interest = bal * monthlyRate;
      const principal = Math.max(0, Math.min(payment - interest, bal));
      bal = Math.max(0, bal - principal);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, paymentDayOfMonth);
    }
    return bal;
  }

  const months = daysSince(lastConfirmedAt) / 30.4375;
  if (months <= 0) return balance;
  const fullMonths = Math.floor(months);
  for (let i = 0; i < fullMonths; i++) {
    if (bal <= 0) break;
    const interest = bal * monthlyRate;
    const principal = Math.max(0, Math.min(payment - interest, bal));
    bal = Math.max(0, bal - principal);
  }
  return bal;
}

// Applies decay to one balance-carrying record (mortgage object, or a
// single loan/card item) if it has enough to compute with. Returns
// { balance, lastConfirmedAt } — either updated, or the original values
// unchanged if there was nothing to confirm (e.g. never confirmed before,
// zero balance, or missing rate/payment).
function decayOne(item) {
  if (!item || !(item.balance > 0) || !item.lastConfirmedAt) {
    return { balance: item?.balance, lastConfirmedAt: item?.lastConfirmedAt, changed: false };
  }
  const newBalance = estimateBalanceToday(item.balance, item.rate || 0, item.payment || 0, item.lastConfirmedAt, item.paymentDayOfMonth);
  const rounded = Math.round(newBalance * 100) / 100;
  if (rounded === item.balance) {
    // Nothing to apply (e.g. confirmed very recently, or payment doesn't
    // cover interest) — still worth confirming the noise, but don't
    // fabricate a change that didn't happen.
    return { balance: item.balance, lastConfirmedAt: item.lastConfirmedAt, changed: false };
  }
  return { balance: rounded, lastConfirmedAt: new Date().toISOString(), changed: true };
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
  if (!url || !serviceRoleKey) {
    res.status(500).json({ error: "Server is not configured for balance decay." });
    return;
  }

  const admin = createClient(url, serviceRoleKey);
  const results = { householdsUpdated: 0, itemsDecayed: 0, errors: [] };

  const { data: rows, error: fetchError } = await admin.from("household_data").select("household_id, data");
  if (fetchError) {
    res.status(500).json({ error: fetchError.message });
    return;
  }
  if (!rows || !rows.length) {
    res.status(200).json(results);
    return;
  }

  for (let i = 0; i < rows.length; i += DECAY_BATCH_SIZE) {
    const batch = rows.slice(i, i + DECAY_BATCH_SIZE);
    await Promise.all(
      batch.map(async (row) => {
        try {
          const data = row.data || {};
          let anyChanged = false;
          let itemsChangedThisHousehold = 0;

          let updatedMortgage = data.mortgage;
          if (data.mortgage) {
            const result = decayOne(data.mortgage);
            if (result.changed) {
              updatedMortgage = { ...data.mortgage, balance: result.balance, lastConfirmedAt: result.lastConfirmedAt };
              anyChanged = true;
              itemsChangedThisHousehold++;
            }
          }

          const updatedLoans = (data.loans || []).map((loan) => {
            const result = decayOne(loan);
            if (result.changed) {
              anyChanged = true;
              itemsChangedThisHousehold++;
              return { ...loan, balance: result.balance, lastConfirmedAt: result.lastConfirmedAt };
            }
            return loan;
          });

          const updatedCards = (data.cards || []).map((card) => {
            const result = decayOne(card);
            if (result.changed) {
              anyChanged = true;
              itemsChangedThisHousehold++;
              return { ...card, balance: result.balance, lastConfirmedAt: result.lastConfirmedAt };
            }
            return card;
          });

          if (!anyChanged) return;

          const updatedData = { ...data, mortgage: updatedMortgage, loans: updatedLoans, cards: updatedCards };
          const { error: updateError } = await admin
            .from("household_data")
            .update({ data: updatedData })
            .eq("household_id", row.household_id);
          if (updateError) throw updateError;

          results.householdsUpdated++;
          results.itemsDecayed += itemsChangedThisHousehold;
        } catch (err) {
          results.errors.push({ household_id: row.household_id, error: err.message });
        }
      })
    );
  }

  res.status(200).json(results);
}
