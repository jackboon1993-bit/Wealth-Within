// Shared "find recurring subscriptions and bills in this transaction
// history" logic, used by api/sync-bank-transactions.js's weekly
// detection pass. Kept separate from
// api/_lib/categorizeTransactions.js — categorization matches one
// transaction at a time to a fixed category list; this instead looks
// across an entire transaction history at once to spot repetition, a
// genuinely different task with a different prompt.
//
// `admin` must be a Supabase client created with the service-role key.

const SYSTEM_PROMPT = `You look at a UK household's bank transaction history and identify recurring subscriptions and bills — anything that charges the same merchant repeatedly on a roughly regular cycle.

You will be given a JSON list of transactions (each with an index, a description, a signed amount in GBP where negative means money out, and a date), and a list of names the household has already told the app about — never suggest anything that's clearly the same merchant as one of these, even if the description looks a bit different (e.g. "NETFLIX.COM" vs "Netflix").

Include BOTH:
- Fixed-amount subscriptions (streaming, apps, gym memberships, insurance) — same merchant, same or near-identical amount, repeating roughly weekly or monthly.
- Variable bills from the same regular biller (energy, council tax, mobile, broadband) — same merchant, repeating roughly monthly, even if the amount changes a bit between occurrences (e.g. an energy price rise). Use the most recent occurrence's amount as the "amount" you report, since that reflects what it currently costs.

Only report something if you can see it repeat at least twice with a plausible regular interval (about 7 days apart for weekly, about 28-31 days apart for monthly) — a single payment, or two payments close together that look like one-off spending rather than a cycle, doesn't count. Don't guess at annual subscriptions from a single occurrence.

Give each one a short, human, recognisable name (e.g. "Netflix", "British Gas", "EE Mobile") rather than the raw bank description. If the same merchant appears with meaningfully different regular amounts for what are clearly different products (e.g. two different Direct Debits to the same energy supplier), report them separately with names that distinguish them.

Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{
  "suggestions": [
    {
      "name": "short recognisable name",
      "amount": 12.99,
      "frequency": "weekly" | "monthly",
      "occurrences": 3,
      "lastDate": "YYYY-MM-DD"
    }
  ]
}

"amount" is the actual per-occurrence amount as it appears on the bank statement (not converted to a monthly figure) — the app converts that itself. If nothing recurring is found, return an empty "suggestions" array.`;

const MONTHLY_FACTOR_FOR_WEEKLY = 52 / 12; // ~4.33 weeks per month, matching how every other monthly figure in this app is derived from a shorter time span

export async function detectRecurringPayments(transactions, existingNames, apiKey) {
  const payload = transactions.map((t, i) => ({
    index: i,
    description: String(t.description || "").slice(0, 200),
    amount: t.amount,
    date: typeof t.date === "string" ? t.date.slice(0, 10) : t.date,
  }));

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `already tracked, don't re-suggest these: ${JSON.stringify(existingNames)}\n\ntransactions: ${JSON.stringify(payload)}\n\nRespond with the JSON object described in your instructions.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Anthropic API error (subscription detection):", response.status, errText);
    throw new Error("Subscription detection is temporarily unavailable.");
  }

  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("No readable response from subscription detection.");

  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error("Failed to parse subscription-detection JSON. Response length:", cleaned.length);
    throw new Error("Couldn't understand subscription detection's response.");
  }

  if (!Array.isArray(parsed.suggestions)) throw new Error("Unexpected response shape from subscription detection.");

  // Convert to the monthly-equivalent figure the rest of the app expects
  // (profile.subscriptions is always a monthly amount — see
  // SubscriptionRow's "/month" label), but keep the raw per-occurrence
  // amount and frequency too, so the review UI can show its working
  // ("£12/week ≈ £52/month") rather than just a number that doesn't
  // match what's on the statement.
  return parsed.suggestions
    .filter((s) => s && s.name && typeof s.amount === "number" && (s.frequency === "weekly" || s.frequency === "monthly"))
    .map((s) => ({
      id: `sub_${Math.random().toString(36).slice(2, 10)}`,
      name: String(s.name).slice(0, 80),
      rawAmount: Math.abs(s.amount),
      frequency: s.frequency,
      monthlyAmount: Math.round(Math.abs(s.amount) * (s.frequency === "weekly" ? MONTHLY_FACTOR_FOR_WEEKLY : 1)),
      occurrences: Number(s.occurrences) || 2,
      lastDate: s.lastDate || null,
    }));
}
