// Vercel Serverless Function.
// Receives a free-text UK personal finance question from the Education
// tab's "Ask a question" box and returns a plain-English, general
// educational answer — deliberately not personalised financial advice
// (it doesn't see the person's actual numbers, unlike analyze-pension.js
// or spending-insight.js). Same auth/CORS/Premium pattern as
// check-bills.js and spending-insight.js. The Anthropic API key lives
// only here, server-side.

import { requirePremiumUser } from "./_lib/requirePremiumUser.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

const SYSTEM_PROMPT = `You are a UK personal finance educator, answering questions inside a budgeting app's "Education" section. You will be given a single question from the user.

Answer in plain English, 2-4 short paragraphs maximum. Assume UK rules, tax bands, and products (ISAs, pensions, National Insurance, etc) unless the question clearly implies otherwise.

Ground rules, strictly followed:
- General education only — never personalised financial advice. You don't know this person's actual income, debts, savings, or circumstances, so don't assume any of it or ask for it.
- Never recommend a specific product, provider, platform, or fund by name.
- Never tell the person what they personally should do ("you should switch to..."). Explain how something works and what people typically weigh up, and let them draw their own conclusion.
- For anything involving a large or hard-to-reverse decision (transferring a defined benefit pension, accessing a pension, large lump-sum investing, debt consolidation), explicitly suggest speaking to a regulated financial adviser or a free service like MoneyHelper before acting.
- If the question is about something you're genuinely unsure of, or that depends heavily on rules that change yearly (exact allowances, thresholds, rates), say so plainly and point to checking gov.uk or MoneyHelper for the current figure, rather than stating a specific number with false confidence.
- If the question isn't really a UK personal finance question at all (or is asking you to do something else entirely, like write code or a poem), politely decline and explain this box is for personal finance education questions only.

Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{
  "answer": "your 2-4 paragraph plain-English answer, or a brief polite decline if out of scope",
  "outOfScope": false
}

Set "outOfScope": true only when declining an off-topic question — in that case "answer" should just be the brief decline message.`;

export default async function handler(req, res) {
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

  // Same Premium gate as every other AI feature in this app (Document
  // Reader, Check my bills, spending insight) — also closes the usual
  // gap of an unauthenticated route that could otherwise spend Anthropic
  // API credit for anyone who found the URL.
  const session = await requirePremiumUser(req, res);
  if (!session.ok) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is not configured with an ANTHROPIC_API_KEY." });
    return;
  }

  const { question } = req.body || {};
  if (!question || typeof question !== "string" || !question.trim()) {
    res.status(400).json({ error: "Missing question." });
    return;
  }
  if (question.length > 500) {
    res.status(400).json({ error: "Question is too long (max 500 characters)." });
    return;
  }

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
            content: `Question: ${question.trim()}\n\nRespond with the JSON object described in your instructions.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      res.status(502).json({ error: "The question box is temporarily unavailable. Please try again shortly." });
      return;
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "No readable response." });
      return;
    }

    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // Not logging `cleaned` — it may echo back part of the user's own
      // question, which could contain personal context. Length only.
      console.error("Failed to parse model JSON. Response length:", cleaned.length);
      res.status(502).json({ error: "Couldn't understand the response. Please try again." });
      return;
    }

    if (typeof parsed.answer !== "string") {
      res.status(502).json({ error: "Unexpected response shape." });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    console.error("education-question error:", err);
    res.status(500).json({ error: "Something went wrong answering that." });
  }
}
