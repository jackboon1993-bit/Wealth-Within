// Vercel Serverless Function.
// Receives the user's current spending-by-category breakdown and monthly
// income (no transaction-level detail) and asks Claude for a few short,
// plain-English observations about the CURRENT snapshot.
//
// Deliberately does NOT claim anything changed over time ("up 18% this
// month" etc) — the app doesn't retain monthly history yet, CSV imports
// collapse into a single running total per category, and there's no
// snapshot mechanism. A genuine month-over-month version of this belongs
// alongside that feature if it gets built later.
// The Anthropic API key lives only here, server-side.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

const SYSTEM_PROMPT = `You are a UK household-finance assistant. You will be given someone's current monthly spending broken down by category, and their monthly take-home income. Both are in GBP.

Write 2-4 short, plain-English observations about this snapshot — for example, a category that's a notably large or small share of income compared to typical UK household proportions, or a healthy pattern worth acknowledging. Be specific with figures (cite the category name, its £ amount, and/or its % of income) but keep each observation to one sentence.

CRITICAL: You have no information about how this person's spending has changed over time. Do NOT claim or imply anything increased, decreased, or changed compared to a previous period ("up from last month", "you're spending more than you used to", etc) — you only have this one snapshot. Frame everything in terms of the current amounts and proportions only.

Keep tone neutral and non-judgmental — this is information, not a lecture. If nothing stands out as unusual, it's fine to say the breakdown looks reasonable. Do not give regulated financial advice.

Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{
  "insights": ["short observation 1", "short observation 2"]
}`;

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

  const { categories, income } = req.body || {};
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
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `income: ${incomeNum}\n\ncategories: ${JSON.stringify(payload)}\n\nRespond with the JSON object described in your instructions.`,
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
