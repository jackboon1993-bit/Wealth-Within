// Shared "ask Claude to categorize these transactions" logic — used by
// both api/categorize-transactions.js (the frontend-facing endpoint used
// by CSV import and the manual bank pull) and api/sync-bank-transactions.js
// (the overnight cron job), so there's exactly one place that defines the
// categorization prompt and response parsing. A change to how this works
// only ever needs to happen here.
//
// `admin` must be a Supabase client created with the service-role key.

const SYSTEM_PROMPT = `You categorize UK bank transaction descriptions for a personal finance app. You will be given a JSON list of transactions (each with an index, a description, and a signed amount in GBP — positive means money in, negative means money out) and a list of the user's own budget category names.

For each transaction, decide:
- If it looks like money coming in that isn't a transfer between the user's own accounts (e.g. salary, wages, a regular income-like payment): set "isIncome": true and "category": null.
- If it looks like a transfer between the user's own accounts (e.g. "TRANSFER TO SAVINGS", "FROM ISA", moving money to/from a pot they likely also own): set "isIncome": false and "category": null.
- Otherwise it's spending: set "isIncome": false and pick the single best-fitting category name from the exact "categories" list given. If nothing reasonably fits, set "category": null.

Only ever use category names exactly as given in the "categories" list, or null. Never invent new category names.

Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{
  "results": [
    { "index": 0, "category": "exact category name from the list, or null", "isIncome": boolean }
  ]
}

There must be exactly one result per transaction given, in the same order, with the same "index".`;

const MAX_BATCH = 200;

// Categorizes a single batch (<= MAX_BATCH transactions) in one Claude
// call. Throws on any failure — callers decide how to handle/report that
// (an HTTP 502 for the live endpoint, a per-household error entry for the
// cron job).
export async function categorizeBatch(transactions, categories, apiKey) {
  if (transactions.length > MAX_BATCH) {
    throw new Error(`Too many transactions in one batch (max ${MAX_BATCH}).`);
  }

  const payload = transactions.map((t, i) => ({ index: i, description: String(t.description || "").slice(0, 200), amount: t.amount }));

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `categories: ${JSON.stringify(categories)}\n\ntransactions: ${JSON.stringify(payload)}\n\nRespond with the JSON object described in your instructions.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Anthropic API error:", response.status, errText);
    throw new Error("The categoriser is temporarily unavailable. Please try again shortly.");
  }

  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("No readable response from the categoriser.");

  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Not logging `cleaned` — it echoes back the user's own transaction
    // descriptions, which is personal financial data. Length only.
    console.error("Failed to parse model JSON. Response length:", cleaned.length);
    throw new Error("Couldn't understand the categoriser's response. Please try again.");
  }

  if (!Array.isArray(parsed.results)) throw new Error("Unexpected response shape from the categoriser.");
  return parsed.results;
}

// Categorizes an arbitrary-length list of { description, amount } rows
// against the given category names, batching internally at MAX_BATCH,
// and returns { categoryTotals, incomeEstimate } using the same
// monthly-average logic the frontend review screen uses — sum spending
// per matched category, sum income, then divide by the number of months
// spanned by the transaction dates (clamped to a minimum of one day's
// worth of a month, so a single day of transactions doesn't get
// multiplied up into an inflated monthly figure).
export async function categorizeAndSummarize(transactions, categories, apiKey) {
  const results = new Array(transactions.length).fill(null);
  for (let start = 0; start < transactions.length; start += MAX_BATCH) {
    const batch = transactions.slice(start, start + MAX_BATCH);
    const batchResults = await categorizeBatch(batch, categories, apiKey);
    batchResults.forEach((r, i) => {
      results[start + i] = r;
    });
  }

  const dates = transactions.map((t) => new Date(t.date).getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const spanDays = Math.max(1, (maxDate - minDate) / (1000 * 60 * 60 * 24));
  const spanMonths = Math.max(spanDays / 30, 1 / 30);

  const totals = {};
  let incomeTotal = 0;
  transactions.forEach((t, i) => {
    const r = results[i];
    if (!r) return;
    if (r.isIncome) {
      if (t.amount > 0) incomeTotal += t.amount;
      return;
    }
    if (r.category) {
      totals[r.category] = (totals[r.category] || 0) + Math.abs(t.amount);
    }
  });

  const categoryTotals = {};
  Object.entries(totals).forEach(([cat, sum]) => {
    categoryTotals[cat] = Math.round(sum / spanMonths);
  });

  return {
    categoryTotals,
    incomeEstimate: incomeTotal > 0 ? Math.round(incomeTotal / spanMonths) : null,
  };
}
