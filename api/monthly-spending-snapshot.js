// Vercel Cron Job — runs monthly, same day as update-home-values.js but
// a different minute to avoid both crons hitting Supabase at once (see
// vercel.json).
//
// For every Premium household, freezes their current spending-by-category
// totals (the exact same numbers the live "Where it actually goes" chart
// in IncomeTab.jsx computes — see categoryChartData there) into a
// permanent monthly entry in profile.spendingSnapshots. That array
// already existed in the data model and is already read by
// api/spending-insight.js for real month-over-month trend comparisons —
// it's just never been populated until now, so this also quietly
// upgrades that feature from "never has real trend data" to "has it from
// here on."
//
// This is a snapshot of whatever the numbers looked like at the moment
// the cron ran — there's no separate "close out the month" step in this
// app, so it's genuinely just "freeze the live total once a month,"
// labelled with the month that just ended.

export const config = {
  maxDuration: 300,
};

import { createClient } from "@supabase/supabase-js";

const SNAPSHOT_BATCH_SIZE = 10;
const MAX_SNAPSHOTS_KEPT = 12; // rolling year of history, oldest drops off

function previousMonthLabel() {
  const now = new Date();
  // Runs on the 1st, so "the month that just ended" is one month back.
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function computeCategorySnapshot(data) {
  const categories = (data.expenseCategories || [])
    .map((cat) => ({
      name: cat.name,
      value: (cat.items || []).reduce((s, i) => s + (Number(i.amount) || 0), 0),
    }))
    .filter((r) => r.value > 0);

  const subsTotal = (data.subscriptions || [])
    .filter((s) => !s.cancelled)
    .reduce((s, sub) => s + (Number(sub.amount) || 0), 0);
  if (subsTotal > 0) categories.push({ name: "Subscriptions", value: subsTotal });

  categories.sort((a, b) => b.value - a.value);
  const total = categories.reduce((s, c) => s + c.value, 0);
  return { categories, total };
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
    res.status(500).json({ error: "Server is not configured for spending snapshots." });
    return;
  }

  const admin = createClient(url, serviceRoleKey);
  const results = { snapshotted: 0, skippedNotPremium: 0, skippedNoSpending: 0, errors: [] };
  const month = previousMonthLabel();

  const { data: rows, error: fetchError } = await admin.from("household_data").select("household_id, data");
  if (fetchError) {
    res.status(500).json({ error: fetchError.message });
    return;
  }
  if (!rows || !rows.length) {
    res.status(200).json(results);
    return;
  }

  const householdIds = rows.map((r) => r.household_id);
  const { data: subs } = await admin.from("subscriptions").select("household_id, status").in("household_id", householdIds);
  const statusByHousehold = new Map((subs || []).map((s) => [s.household_id, s.status]));
  const hasPremium = (householdId) => {
    const status = statusByHousehold.get(householdId);
    return status === "trialing" || status === "active";
  };

  for (let i = 0; i < rows.length; i += SNAPSHOT_BATCH_SIZE) {
    const batch = rows.slice(i, i + SNAPSHOT_BATCH_SIZE);
    await Promise.all(
      batch.map(async (row) => {
        if (!hasPremium(row.household_id)) {
          results.skippedNotPremium++;
          return;
        }
        try {
          const { categories, total } = computeCategorySnapshot(row.data || {});
          if (total <= 0) {
            results.skippedNoSpending++;
            return;
          }
          const existing = row.data.spendingSnapshots || [];
          // Don't duplicate if this cron somehow runs twice for the same
          // month (e.g. a manual re-trigger) — replace rather than append.
          const withoutThisMonth = existing.filter((s) => s.month !== month);
          const updatedSnapshots = [...withoutThisMonth, { month, categories, total }].slice(-MAX_SNAPSHOTS_KEPT);
          const updatedData = { ...row.data, spendingSnapshots: updatedSnapshots };
          const { error: updateError } = await admin
            .from("household_data")
            .update({ data: updatedData })
            .eq("household_id", row.household_id);
          if (updateError) throw updateError;
          results.snapshotted++;
        } catch (err) {
          results.errors.push({ household_id: row.household_id, error: err.message });
        }
      })
    );
  }

  res.status(200).json({ month, ...results });
}
