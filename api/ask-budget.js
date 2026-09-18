// api/ask-budget.js
//
// "Ask your budget" — a free-form question box on the Budget tab,
// answered from the household's own stored category/income data, not
// general financial advice. Genuinely different from the existing
// spending-insight.js (a fixed one-shot "what stands out" summary) —
// this is conversational: the person types whatever they actually want
// to know ("how much did I spend on takeaways", "what's my biggest
// subscription"), and gets an answer grounded in their real numbers.
//
// Same auth + Premium gating as every other AI-backed route (see
// requirePremiumUser.js) — this spends real Anthropic API credit per
// call, so it needs the same enforcement as spending-insight.js and
// check-bills.js already have, not just a client-side hasPremium check.

import { requirePremiumUser } from "./_lib/requirePremiumUser.js";

const SYSTEM_PROMPT = `You answer questions about a UK household's own budget, using ONLY the data given to you in this message — never general financial advice, and never numbers you're not given. You will receive: their income categories, their spending categories (each with a name, this month's spend, and their set budget if any), and their active subscriptions.

Answer the person's question directly and conversationally, in plain English, in 1-3 short sentences — this is a quick answer, not a report. If the data given genuinely doesn't let you answer (e.g. they ask about something not covered, like a specific transaction merchant, which this data doesn't include), say so plainly rather than guessing or inventing a number. Never invent a category, a subscription, or a figure that isn't in the data you were given.

If they ask something outside the scope of their own budget data entirely (e.g. general financial advice, something about the stock market, an unrelated topic), politely say this box is only for questions about their own budget, and suggest the Education tab for general explainers instead.

Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{ "answer": "your 1-3 sentence answer here" }`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const session = await requirePremiumUser(req, res);
  if (!session.ok) return; // response already sent — 401/402/404

  const { question, categories, income, subscriptions } = req.body || {};
  if (!question || typeof question !== "string" || !question.trim()) {
    res.status(400).json({ error: "No question given." });
    return;
  }
  // A generous but real ceiling — this is a short question box, not a
  // place to paste an essay, and it keeps the prompt (and the cost of
  // answering it) bounded.
  if (question.length > 500) {
    res.status(400).json({ error: "That question's a bit long — try asking it more briefly." });
    return;
  }

  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) {
    res.status(500).json({ error: "Server isn't configured for this yet." });
    return;
  }

  try {
    const dataSummary = {
      income: income ?? null,
      categories: Array.isArray(categories) ? categories.slice(0, 40) : [],
      subscriptions: Array.isArray(subscriptions) ? subscriptions.slice(0, 40) : [],
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `budget data: ${JSON.stringify(dataSummary)}\n\nquestion: ${question.trim()}\n\nRespond with the JSON object described in your instructions.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      res.status(502).json({ error: "Couldn't reach the assistant right now — try again shortly." });
      return;
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "No readable response — try again." });
      return;
    }

    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Not logging `cleaned` — it could echo back category names/
      // amounts, which is personal financial data. Length only.
      console.error("Failed to parse ask-budget response. Length:", cleaned.length);
      res.status(502).json({ error: "Couldn't understand the answer — try again." });
      return;
    }

    if (!parsed.answer || typeof parsed.answer !== "string") {
      res.status(502).json({ error: "Unexpected response shape — try again." });
      return;
    }

    res.status(200).json({ answer: parsed.answer });
  } catch (err) {
    console.error("ask-budget error:", err);
    res.status(500).json({ error: "Something went wrong answering that — try again." });
  }
}
