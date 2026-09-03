// Vercel Cron Job — runs monthly, deliberately AFTER
// monthly-spending-snapshot.js (05:15) and monthly-debt-decay.js (05:30)
// on the same day (see vercel.json — this is scheduled 05:45) so that by
// the time this runs, this month's spending snapshot already exists and
// every balance (mortgage, loans, cards) already reflects that day's
// decay update. Running any earlier would mean comparing against a
// spending snapshot that hadn't been written yet.
//
// Sends a monthly recap email to every member of every Premium
// household — net worth right now, spending vs last month (using
// profile.spendingSnapshots, which monthly-spending-snapshot.js already
// populates — this file adds no new spending calculation of its own,
// just reads what's already there), and a subscriptions summary.
//
// Deliberately reuses the exact same Premium-check pattern as
// sync-bank-transactions.js and monthly-spending-snapshot.js (one query
// against the subscriptions table for every household up front, not a
// lookup per household inside the loop) — this is a background cron
// authenticated via CRON_SECRET, not a per-user request, so it does NOT
// use requirePremiumUser.js (that helper is for live endpoints called
// with a person's own Supabase access token; there's no signed-in user
// here, just a scheduled job iterating every household).
//
// Net worth here is a simple point-in-time sum from the household's
// current stored balances (home equity + savings + investments + pension
// - other debts) — NOT the same thing as the multi-month forecast engine
// in src/lib/finance.js, which simulates net worth forward over time for
// the interactive Cash Flow Forecast. This only ever needs "what is net
// worth today", so it recomputes that directly from the same underlying
// fields rather than pulling in the whole forecast module for a single
// number.

export const config = {
  maxDuration: 300,
};

import { createClient } from "@supabase/supabase-js";

const RECAP_BATCH_SIZE = 10;
// Below this, a "spending vs last month" comparison isn't meaningful —
// show this month's total alone instead of a misleading month-on-month
// swing for someone who only just started tracking.
const MIN_SNAPSHOTS_FOR_COMPARISON = 2;

function gbp(n) {
  return `£${Math.round(Number(n) || 0).toLocaleString("en-GB")}`;
}

function monthLabel(monthStr) {
  // monthStr is "YYYY-MM", matching monthly-spending-snapshot.js's format.
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

// Same formula shape as the netWorth line inside src/lib/finance.js's
// forecast simulation (homeEquity + savings + investments + pension -
// remainingNonMortgageDebt), just evaluated once against today's stored
// balances instead of at every month of a multi-year projection.
function computeNetWorthNow(data) {
  const homeValue = Number(data.homeValue) || 0;
  const mortgageBalance = Number(data.mortgage?.balance) || 0;
  const homeEquity = homeValue - mortgageBalance;
  const savings = Number(data.savings?.balance) || 0;
  const investments = Number(data.investments?.balance) || 0;
  const pension = Number(data.pension?.balance) || 0;
  const loansTotal = (data.loans || []).reduce((s, l) => s + (Number(l.balance) || 0), 0);
  const cardsTotal = (data.cards || []).reduce((s, c) => s + (Number(c.balance) || 0), 0);
  return homeEquity + savings + investments + pension - loansTotal - cardsTotal;
}

function buildRecapHtml({ netWorth, thisMonth, lastMonth, subsSummary }) {
  const spendingSection = lastMonth
    ? (() => {
        const diff = thisMonth.total - lastMonth.total;
        const diffLabel = diff === 0 ? "the same as" : diff > 0 ? `${gbp(Math.abs(diff))} more than` : `${gbp(Math.abs(diff))} less than`;
        return `You spent <strong>${gbp(thisMonth.total)}</strong> in ${monthLabel(thisMonth.month)} — that's ${diffLabel} ${monthLabel(lastMonth.month)}.`;
      })()
    : `You spent <strong>${gbp(thisMonth.total)}</strong> in ${monthLabel(thisMonth.month)}.`;

  const topCategories = (thisMonth.categories || [])
    .slice(0, 3)
    .map(
      (c) => `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #EDE9E0; font-size: 14px; color: #3D3A34;">${c.name}</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #EDE9E0; font-size: 14px; color: #3D3A34; text-align: right; font-weight: 600;">${gbp(c.value)}</td>
        </tr>`
    )
    .join("");

  // Real Wealth Within brand values, not generic placeholders — pulled
  // directly from App.jsx's own CSS variables (--brand, --brand-2,
  // --paper, --ink, Plus Jakarta Sans) so this actually looks like it
  // came from the app, not a generic template. Built as an HTML table
  // layout deliberately, not flexbox/grid — email clients (Outlook,
  // Gmail's HTML sanitiser especially) have notoriously poor CSS support,
  // and table-based layout is still the most reliable way to get
  // consistent rendering across inboxes.
  return `
  <!DOCTYPE html>
  <html>
  <body style="margin: 0; padding: 0; background: #F5F1E8; font-family: 'Plus Jakarta Sans', -apple-system, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #F5F1E8; padding: 32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width: 480px; background: #FFFDF9; border-radius: 20px; overflow: hidden;">

            <tr>
              <td style="background: linear-gradient(135deg, #8A7FC9, #C97099); padding: 32px 28px;">
                <div style="font-size: 20px; font-weight: 800; color: #FFFFFF; letter-spacing: -0.02em;">Wealth Within</div>
                <div style="font-size: 13px; color: rgba(255,255,255,0.85); margin-top: 4px;">Your monthly recap</div>
              </td>
            </tr>

            <tr>
              <td style="padding: 28px;">
                <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #8A7FC9; margin-bottom: 6px;">Net worth right now</div>
                <div style="font-size: 30px; font-weight: 800; color: #3D3A34; margin-bottom: 24px;">${gbp(netWorth)}</div>

                <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #8A7FC9; margin-bottom: 6px;">Spending</div>
                <div style="font-size: 14px; color: #3D3A34; line-height: 1.6; margin-bottom: ${topCategories ? "16px" : "24px"};">${spendingSection}</div>

                ${
                  topCategories
                    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">${topCategories}</table>`
                    : ""
                }

                ${
                  subsSummary
                    ? `<div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #8A7FC9; margin-bottom: 6px;">Subscriptions</div>
                       <div style="font-size: 14px; color: #3D3A34; line-height: 1.6; margin-bottom: 24px;">${subsSummary}</div>`
                    : ""
                }

                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius: 999px; background: linear-gradient(135deg, #8A7FC9, #C97099);">
                      <a href="https://wealth-within.vercel.app" style="display: inline-block; padding: 12px 26px; font-size: 13px; font-weight: 700; color: #FFFFFF; text-decoration: none;">Open Wealth Within</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding: 20px 28px; background: #F5F1E8; border-top: 1px solid #EDE9E0;">
                <div style="font-size: 11px; color: #8A8377; line-height: 1.6;">
                  Figures come from what you've entered plus your connected bank if you've linked one via Open
                  Banking. Nothing here is financial advice.
                </div>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
}

function buildSubsSummaryHtml(subscriptions) {
  const active = (subscriptions || []).filter((s) => !s.cancelled);
  if (active.length === 0) return "";
  const total = active.reduce((s, sub) => s + (Number(sub.amount) || 0), 0);
  const flagged = active.filter((s) => s.flagged);
  const flaggedNote = flagged.length
    ? ` — ${flagged.length} worth reconsidering (check the Subscriptions section for which ones).`
    : "";
  return `${active.length} active subscription${active.length === 1 ? "" : "s"}, ${gbp(total)}/month${flaggedNote}`;
}

async function sendRecapEmail(resendApiKey, toEmail, html) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // TODO once a real domain is verified in Resend: replace with
      // something like 'Wealth Within <recap@wealthwithin.app>'. Using
      // Resend's own shared test address for now — works immediately,
      // no DNS setup needed, but real customers see it come from
      // resend.dev rather than a Wealth Within address.
      from: "onboarding@resend.dev",
      to: toEmail,
      subject: "Your Wealth Within monthly recap",
      html,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Resend API error: ${resp.status} ${errText}`);
  }
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
  const resendApiKey = (process.env.RESEND_API_KEY || "").trim();
  if (!url || !serviceRoleKey) {
    res.status(500).json({ error: "Server is not configured for the monthly recap." });
    return;
  }
  if (!resendApiKey) {
    res.status(500).json({ error: "Server is not configured with a RESEND_API_KEY." });
    return;
  }

  const admin = createClient(url, serviceRoleKey);
  const results = { sent: 0, skippedNotPremium: 0, skippedNoMembers: 0, skippedNoData: 0, errors: [] };

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

  const { data: allMembers } = await admin.from("household_members").select("household_id, user_id").in("household_id", householdIds);
  const membersByHousehold = new Map();
  (allMembers || []).forEach((m) => {
    const list = membersByHousehold.get(m.household_id) || [];
    list.push(m.user_id);
    membersByHousehold.set(m.household_id, list);
  });

  for (let i = 0; i < rows.length; i += RECAP_BATCH_SIZE) {
    const batch = rows.slice(i, i + RECAP_BATCH_SIZE);
    await Promise.all(
      batch.map(async (row) => {
        const householdId = row.household_id;
        try {
          if (!hasPremium(householdId)) {
            results.skippedNotPremium++;
            return;
          }

          const data = row.data || {};
          const snapshots = data.spendingSnapshots || [];
          if (snapshots.length === 0) {
            // Nothing to recap yet — this household hasn't had a
            // spending snapshot taken (e.g. no spending entered at all).
            results.skippedNoData++;
            return;
          }
          const thisMonth = snapshots[snapshots.length - 1];
          const lastMonth = snapshots.length >= MIN_SNAPSHOTS_FOR_COMPARISON ? snapshots[snapshots.length - 2] : null;
          const netWorth = computeNetWorthNow(data);
          const subsSummary = buildSubsSummaryHtml(data.subscriptions);
          const html = buildRecapHtml({ netWorth, thisMonth, lastMonth, subsSummary });

          const memberIds = membersByHousehold.get(householdId) || [];
          if (memberIds.length === 0) {
            results.skippedNoMembers++;
            return;
          }

          // Send to every member of the household, not just whoever
          // first set it up — this mirrors how the rest of household
          // sharing works (equal access, no owner-only gate; see
          // household.js's renameHousehold comment for the same
          // reasoning applied elsewhere).
          for (const userId of memberIds) {
            const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
            if (userError || !userData?.user?.email) continue; // skip silently, don't fail the whole household over one bad user record
            await sendRecapEmail(resendApiKey, userData.user.email, html);
          }
          results.sent++;
        } catch (e) {
          results.errors.push(`household ${householdId}: ${e.message || e}`);
        }
      })
    );
  }

  res.status(200).json(results);
}
