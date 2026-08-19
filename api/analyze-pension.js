// Vercel Serverless Function.
// Receives a base64-encoded pension document (PDF or photo) from the browser,
// sends it to Claude to read and explain, and returns a structured summary.
// The Anthropic API key lives only here, server-side — it is never sent to
// or exposed in the browser.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

const SYSTEM_PROMPT = `You read UK pension statements and documents (workplace pension, personal pension, SIPP, or State Pension forecast) for a non-expert reader. You will be given a PDF or a photo of a document.

Extract what you can find and write a short, plain-English explanation. Avoid jargon; where you must use a term (e.g. "AMC", "drawdown", "defined contribution"), explain it in a few plain words the first time.

Respond with ONLY a JSON object, no other text, no markdown fences, in exactly this shape:
{
  "documentType": "short description of what this document is, e.g. 'Workplace pension annual statement'",
  "provider": "provider/scheme name if visible, else null",
  "asOfDate": "the date the statement is as-of, if visible, else null",
  "currentValue": number or null (the current pot value in GBP, no currency symbol, no commas),
  "monthlyContribution": number or null (combined monthly contribution in GBP if stated, else null),
  "annualFeePercent": number or null (the annual charge/fee as a percentage, e.g. 0.75, else null),
  "projectedValue": number or null (the provider's own projected value at retirement, if stated, else null),
  "projectedIncome": number or null (the provider's own projected annual or monthly retirement income, if stated — state which in projectedIncomeFrequency),
  "projectedIncomeFrequency": "annual" or "monthly" or null,
  "retirementAge": number or null (the retirement age assumed, if stated),
  "summary": "2-4 sentences in plain English explaining what this document shows overall",
  "verdict": {
    "tone": "good" or "neutral" or "caution",
    "text": "1-3 plain-English sentences giving a fair, balanced take — e.g. whether fees look reasonable, whether contributions look on track, anything worth double-checking. Do not give regulated financial advice or tell the person what to do; describe what the numbers suggest and encourage them to check with a financial adviser for anything significant."
  },
  "couldNotRead": false
}

If the document isn't a pension document, or you genuinely cannot read it, set "couldNotRead": true, set all numeric fields to null, and explain briefly in "summary" what went wrong. Never invent numbers that aren't in the document — use null rather than guessing.`;

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

  const { fileBase64, mediaType, fileKind } = req.body || {};
  if (!fileBase64 || !mediaType || !fileKind) {
    res.status(400).json({ error: "Missing file data." });
    return;
  }
  if (fileKind !== "pdf" && fileKind !== "image") {
    res.status(400).json({ error: "Unsupported file kind." });
    return;
  }

  const contentBlock =
    fileKind === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: fileBase64 } };

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
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [contentBlock, { type: "text", text: "Read this pension document and respond with the JSON object described in your instructions." }],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      res.status(502).json({ error: "The document reader is temporarily unavailable. Please try again shortly." });
      return;
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "No readable response from the document reader." });
      return;
    }

    const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // Deliberately not logging `cleaned` here — it's the model's response
      // about the user's actual pension document (provider, values, etc.),
      // so logging it would put personal financial data in plain server
      // logs. Length only, enough to debug a parsing regression without
      // capturing document content.
      console.error("Failed to parse model JSON. Response length:", cleaned.length);
      res.status(502).json({ error: "Couldn't understand the document reader's response. Please try again." });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    console.error("analyze-pension error:", err);
    res.status(500).json({ error: "Something went wrong reading the document." });
  }
}
