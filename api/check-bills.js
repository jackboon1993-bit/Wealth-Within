// Vercel Serverless Function.
// Receives a list of the user's household bills (name + monthly amount, no
// account details) and asks Claude to flag any that look unusually high or
// low against typical UK household costs, with a short non-alarmist note.
// The Anthropic API key lives only here, server-side.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

const SYSTEM_PROMPT = `You are a UK household-finance assistant. You will be given a JSON array of household bills, each with a "name" and monthly "amount" in GBP. For each bill, decide whether the amount looks "high", "typical", or "low" compared to what a typical UK household pays for that kind of bill in 2025/2026. Use your general knowledge of UK costs (energy, council tax bands, broadband, mobile, insurance, etc) — this is a rough, directional check, not a precise quote.

Only include a "note" field for "high" or "low" verdicts — one short, plain, non-alarmist sentence (under 20 words) suggesting what might be worth checking. Do not name specific providers or products, and do not give regulated financial advice. For "typical" verdicts, omit the "note" field entirely.

If a bill's name is too vague or generic to judge (e.g. "Other", "Misc"), return "typical" with no note rather than guessing.

Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{
  "results": [
    { "index": 0, "verdict": "high" | "typical" | "low", "note": "..." }
  ]
}

There must be exactly one result per bill given, in the same order, with the same "index". Omit "note" when verdict is "typical".`;

export default async function handler(req, res) {
  // The native app's WebView runs from https://localhost, a different
  // origin than wealth-within.vercel.app, so every call from the app needs
  // explicit CORS permission or the browser blocks it before the request
  // reaches this handler. Must come before the method check below, since
  // browsers send a preflight OPTIONS request first for a POST like this.
  res.setHeader("Access-Control-Allow-Origin", "https://localhost");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is not configured with an ANTHROPIC_API_KEY." });
    return;
  }

  const { bills } = req.body || {};
  if (!Array.isArray(bills) || bills.length === 0) {
    res.status(400).json({ error: "Missing bills." });
    return;
  }
  if (bills.length > 60) {
    res.status(400).json({ error: "Too many bills in one batch (max 60)." });
    return;
  }

  const payload = bills.map((b, i) => ({
    index: i,
    name: String(b.name || "").slice(0, 80),
    amount: Number(b.amount) || 0,
  }));

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
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `bills: ${JSON.stringify(payload)}\n\nRespond with the JSON object described in your instructions.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      res.status(502).json({ error: "The bill checker is temporarily unavailable. Please try again shortly." });
      return;
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "No readable response from the bill checker." });
      return;
    }

    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // Not logging `cleaned` — it echoes back the user's own bill names and
      // amounts, which is personal financial data. Length only.
      console.error("Failed to parse model JSON. Response length:", cleaned.length);
      res.status(502).json({ error: "Couldn't understand the bill checker's response. Please try again." });
      return;
    }

    if (!Array.isArray(parsed.results) || parsed.results.length !== payload.length) {
      res.status(502).json({ error: "Unexpected response shape from the bill checker." });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    console.error("check-bills error:", err);
    res.status(500).json({ error: "Something went wrong checking your bills." });
  }
}
