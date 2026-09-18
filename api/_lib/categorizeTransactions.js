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
// spanned.
//
// `window`, when given, is the actual { fromDate, toDate } (ISO date
// strings) that was requested from the bank — NOT derived from which
// transactions happened to come back. This matters a lot for the
// overnight incremental sync (see sync-bank-transactions.js): that job
// only fetches since the last *applied* sync, so a given run might only
// catch a single salary payment or a single bill. If spanMonths were
// derived from the spread of transactions that happen to appear (the
// previous behaviour), a single transaction gives minDate === maxDate,
// spanDays floors to 1, and spanMonths floors to 1/30 — dividing that
// one transaction by 1/30 multiplies it by 30. A single ~£2,900 salary
// payment could be reported as ~£87,000/month. Using the real requested
// window instead means the denominator reflects how much calendar time
// was actually covered, regardless of how sparsely transactions happen
// to land inside it.
//
// `window` is omitted for CSV import and the manual "pull last 90 days"
// flow, which don't have a single fixed request window in the same way
// (a CSV's date range *is* its own data) — those keep deriving the span
// from the transactions' own dates, same as before.
//
// `persist`, when given as { admin, householdId, source }, saves each
// batch's individual transactions to household_transactions right where
// this function already has direct access to that batch's own results —
// this is the shared function sync-bank-transactions.js calls, and
// unlike categorize-transactions.js (which calls categorizeBatch directly
// and persists separately, since it never goes through this function),
// categorizeAndSummarize never returned per-transaction results to its
// caller at all. Threading persistence through here, rather than adding
// a second return value sync-bank-transactions.js would have to handle,
// keeps that plumbing in one place. Optional and additive — omitting
// `persist` behaves exactly as before.
export async function categorizeAndSummarize(transactions, categories, apiKey, window = null, persist = null) {
  const results = new Array(transactions.length).fill(null);
  for (let start = 0; start < transactions.length; start += MAX_BATCH) {
    const batch = transactions.slice(start, start + MAX_BATCH);
    const batchResults = await categorizeBatch(batch, categories, apiKey);
    batchResults.forEach((r, i) => {
      results[start + i] = r;
    });
    if (persist) {
      await persistTransactions(persist.admin, persist.householdId, batch, batchResults, persist.source);
    }
  }

  let spanDays;
  if (window?.fromDate && window?.toDate) {
    spanDays = Math.max(1, (new Date(window.toDate).getTime() - new Date(window.fromDate).getTime()) / (1000 * 60 * 60 * 24));
  } else {
    const dates = transactions.map((t) => new Date(t.date).getTime());
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    spanDays = Math.max(1, (maxDate - minDate) / (1000 * 60 * 60 * 24));
  }
  // A floor of one week, not one day, when working from a real requested
  // window — an incremental sync can legitimately be just a day or two
  // if a household reviews often, and extrapolating a whole month's
  // figure from one or two days of data is still unreliable even though
  // it's no longer catastrophically wrong the way the old per-transaction
  // floor was. One week is a more honest lower bound for "enough data to
  // guess a monthly rate from" while still never dividing by zero.
  const floorMonths = window?.fromDate && window?.toDate ? 7 / 30 : 1 / 30;
  const spanMonths = Math.max(spanDays / 30, floorMonths);

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

// Persists the individual transactions this batch just categorised, so
// recurring-vs-one-off detection and merchant-level breakdowns have real
// history to work from — previously these were only ever used to compute
// categoryTotals above, then discarded. Called from both
// api/categorize-transactions.js (CSV import, manual pull) and
// api/sync-bank-transactions.js (the nightly cron), same "one shared
// place" reasoning as categorizeBatch/categorizeAndSummarize above.
//
// `admin` must be a Supabase client created with the service-role key.
// `results` must line up index-for-index with `transactions` (the same
// shape categorizeBatch returns). Rows with no category and not income
// (nothing Claude could confidently match) still get stored — that's
// useful information too (something regularly landing as "uncategorised"
// is itself worth knowing about) — only a genuinely missing result (this
// transaction wasn't part of this categorisation run at all) is skipped.
//
// Uses the upsert_household_transactions RPC (see the transactions
// migration) rather than calling .upsert() directly — that function does
// the ON CONFLICT dance against a *partial* unique index natively in
// SQL, which isn't reliably expressible through supabase-js's own
// .upsert() helper.
export async function persistTransactions(admin, householdId, transactions, results, source) {
  const rows = transactions
    .map((t, i) => {
      const r = results[i];
      if (!r) return null;
      return {
        household_id: householdId,
        date: t.date ? new Date(t.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        description: String(t.description || "").slice(0, 500),
        merchant: cleanMerchantName(t.description),
        amount: t.amount,
        category: r.isIncome ? null : r.category,
        source,
        external_id: t.id || t.transactionId || null,
      };
    })
    .filter(Boolean);

  // TEMPORARY diagnostic logging — added while tracking down why zero
  // rows were landing in household_transactions with no visible error.
  // Worth removing once that's actually confirmed fixed, rather than
  // leaving debug noise in permanently.
  console.log(
    `persistTransactions: ${transactions.length} transactions in, ${results.filter(Boolean).length} had a result, ${rows.length} rows to insert (household ${householdId}, source ${source})`
  );

  if (rows.length === 0) {
    console.log("persistTransactions: nothing to insert — returning before any database call.");
    return;
  }

  const { error } = await admin.rpc("upsert_household_transactions", { rows });
  if (error) {
    // Not fatal to the categorisation/sync flow itself — the
    // categoryTotals this run produced are still valid and already
    // applied by the time this runs. Logged so a persistent failure here
    // is visible without taking down the feature people are actually
    // waiting on day to day.
    console.error("Failed to persist transaction history:", error.message);
  } else {
    console.log(`persistTransactions: successfully upserted ${rows.length} rows.`);
  }
}

// Very deliberately simple — strips long digit runs (store/card
// reference numbers) and keeps the first few words, title-cased. Not a
// full merchant-matching system, just enough to turn "TESCO STORES 3421
// LONDON GB" into "Tesco Stores" for grouping purposes.
function cleanMerchantName(description) {
  const raw = String(description || "").trim();
  if (!raw) return null;
  const stripped = raw
    .replace(/\b\d{3,}\b/g, "") // long digit runs — store/card refs
    .replace(/\s{2,}/g, " ")
    .trim();
  const words = stripped.split(" ").filter(Boolean).slice(0, 3);
  if (words.length === 0) return null;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}
