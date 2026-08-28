// Vercel Serverless Function.
// Receives the user's current spending-by-category breakdown and monthly
// income (no transaction-level detail) and asks Claude for a few short,
// plain-English observations.
//
// Optionally also receives `previousPeriod` — a genuine prior month's total
// spending, from the app's spending-snapshot history feature. This is ONLY
// ever real, explicitly-saved data (see spendingSnapshots in lib/finance.js
// on the client) — never inferred or estimated server-side. When present,
// the model is allowed exactly one trend observation using that real total;
// when absent, it's instructed the same as before: no trend claims at all,
// since a single snapshot genuinely can't support one.
// The Anthropic API key lives only here, server-side.

import { requirePremiumUser } from "./_lib/requirePremiumUser.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

function buildSystemPrompt(hasPreviousPeriod) {
  const trendRule = hasPreviousPeriod
    ? `You ARE given one genuine prior period's total spending figure (see "previousPeriod" below), explicitly saved by the person — not estimated. You may make AT MOST ONE observation comparing the current total spending to that prior total (e.g. "total spending is up/down £X (Y%) from [prior month]"). Do NOT invent or imply any category-level trend ("dining out is up") — you only have a prior TOTAL, not a prior category breakdown, so any category-specific comparison would be fabricated. All other observations must still follow the current-snapshot-only rule below.`
    : `You have no information about how this person's spending has changed over time. Do NOT claim or imply anything increased, decreased, or changed compared to a previous period ("up from last month", "you're spending more than you used to", etc) — you only have this one snapshot. Frame everything in terms of the current amounts and proportions only.`;

  return `You are a UK household-finance assistant. You will be given someone's current monthly spending broken down by category, and their monthly take-home income. Both are in GBP.

Write 2-4 short, plain-English observations — for example, a category that's a notably large or small share of income compared to typical UK household proportions, or a healthy pattern worth acknowledging. Be specific with figures (cite the category name, its £ amount, and/or its % of income) but keep each observation to one sentence.

CRITICAL: ${trendRule}

Keep tone neutral and non-judgmental — this is information, not a lecture. If nothing stands out as unusual, it's fine to say the breakdown looks reasonable. Do not give regulated financial advice.

Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{
  "insights": ["short observation 1", "short observation 2"]
}`;
}

export default async function handler(req, res) {
  // See check-bills.js / truelayer-accounts.js for why this is needed —
  // the native app calls this directly from https://localhost.
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

  // Spending insights are a Premium feature — see the priority to-do
  // list, "Feature gating". Also closes a real gap: this route had no
  // auth at all before, so anyone could POST here and spend Anthropic
  // API credit regardless of sign-in or subscription status.
  const session = await requirePremiumUser(req, res);
  if (!session.ok) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is not configured with an ANTHROPIC_API_KEY." });
    return;
  }

  const { categories, income, previousPeriod } = req.body || {};
  if (!Array.isArray(categories) || categories.length === 0) {
    res.status(400).json({ error: "Missing categories." });
    return;
  }
  if (categories.length > 30) {
    res.status(400).json({ error: "Too many categories in one request (max 30)." });
    return;
  }

  const payload = categories.map((c) => ({
    name: String(c.name || "").slice(0, 80),
    value: Number(c.value) || 0,
  }));
  const incomeNum = Number(income) || 0;

  // Only trust previousPeriod if it's genuinely shaped like one — a month
  // label and a positive total. Anything else is silently dropped rather
  // than passed to the model, which just falls back to the no-trend prompt.
  const validPreviousPeriod =
    previousPeriod && typeof previousPeriod.month === "string" && Number(previousPeriod.totalSpending) > 0
      ? { month: previousPeriod.month.slice(0, 40), totalSpending: Number(previousPeriod.totalSpending) }
      : null;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: buildSystemPrompt(Boolean(validPreviousPeriod)),
        messages: [
          {
            role: "user",
            content: `income: ${incomeNum}\n\ncategories: ${JSON.stringify(payload)}${
              validPreviousPeriod ? `\n\npreviousPeriod: ${JSON.stringify(validPreviousPeriod)}` : ""
            }\n\nRespond with the JSON object described in your instructions.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      res.status(502).json({ error: "The insight generator is temporarily unavailable. Please try again shortly." });
      return;
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "No readable response from the insight generator." });
      return;
    }

    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // Not logging `cleaned` — it echoes back the user's own spending
      // categories and amounts, which is personal financial data. Length only.
      console.error("Failed to parse model JSON. Response length:", cleaned.length);
      res.status(502).json({ error: "Couldn't understand the insight generator's response. Please try again." });
      return;
    }

    if (!Array.isArray(parsed.insights)) {
      res.status(502).json({ error: "Unexpected response shape from the insight generator." });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    console.error("spending-insight error:", err);
    res.status(500).json({ error: "Something went wrong generating your insight." });
  }
}
