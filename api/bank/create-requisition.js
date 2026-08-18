// Starts a bank connection: creates a Yapily hosted consent request and
// returns the hostedUrl to redirect the user to. Yapily's own hosted page
// handles bank selection and the login/consent flow at the bank itself —
// we don't build or maintain a bank picker ourselves.

import { requireUser, yapilyFetch } from "./_shared.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { supabase, userId } = await requireUser(req);
    const { origin } = req.body || {};
    if (!origin) {
      res.status(400).json({ error: "Missing origin." });
      return;
    }

    const resp = await yapilyFetch("/hosted/consent-requests", {
      method: "POST",
      body: JSON.stringify({
        redirectUrl: `${origin}/?bank_callback=1`,
        institutionIdentifiers: { institutionCountryCode: "GB" },
        applicationUserId: userId,
        userSettings: { language: "EN", location: "GB" },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("Yapily create-consent-request error:", resp.status, text);
      res.status(502).json({ error: "Could not start the bank connection. Please try again shortly." });
      return;
    }

    const body = await resp.json();
    const consentRequest = body.data;

    const { error: dbError } = await supabase.from("bank_connections").upsert(
      {
        user_id: userId,
        consent_request_id: consentRequest.consentRequestId,
        status: "pending",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    if (dbError) {
      console.error("Supabase upsert error:", dbError);
      res.status(500).json({ error: "Could not save the connection. Please try again." });
      return;
    }

    res.status(200).json({ hostedUrl: consentRequest.hostedUrl });
  } catch (err) {
    console.error("create-requisition error:", err);
    res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
  }
}
