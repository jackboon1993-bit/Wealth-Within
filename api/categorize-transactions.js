// Vercel Serverless Function.
// Receives a batch of bank transaction descriptions + amounts from the
// browser (no account numbers, sort codes, or balances — just what's needed
// to categorize) and asks Claude to match each one to the user's own budget
// category names, and flag which look like income.
// The Anthropic API key lives only here, server-side.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "2mb",
    },
  },
};

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is not configured with an ANTHROPIC_API_KEY." });
    return;
  }

  const { transactions, categories } = req.body || {};
  if (!Array.isArray(transactions) || transactions.length === 0) {
    res.status(400).json({ error: "Missing transactions." });
    return;
  }
  if (!Array.isArray(categories) || categories.length === 0) {
    res.status(400).json({ error: "Missing categories." });
    return;
  }
  if (transactions.length > 200) {
    res.status(400).json({ error: "Too many transactions in one batch (max 200)." });
    return;
  }

  const payload = transactions.map((t, i) => ({ index: i, description: String(t.description || "").slice(0, 200), amount: t.amount }));

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
      res.status(502).json({ error: "The categoriser is temporarily unavailable. Please try again shortly." });
      return;
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "No readable response from the categoriser." });
      return;
    }

    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // Not logging `cleaned` — it echoes back the user's own transaction
      // descriptions, which is personal financial data. Length only.
      console.error("Failed to parse model JSON. Response length:", cleaned.length);
      res.status(502).json({ error: "Couldn't understand the categoriser's response. Please try again." });
      return;
    }

    if (!Array.isArray(parsed.results)) {
      res.status(502).json({ error: "Unexpected response shape from the categoriser." });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    console.error("categorize-transactions error:", err);
    res.status(500).json({ error: "Something went wrong categorising these transactions." });
  }
}
