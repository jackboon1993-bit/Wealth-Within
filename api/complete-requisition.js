// Called after the user returns from their bank's consent flow, to confirm
// the connection succeeded and store which bank was linked.

import { requireUser, yapilyFetch } from "./_shared.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { supabase, userId } = await requireUser(req);

    const { data: connection, error: fetchError } = await supabase
      .from("bank_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError || !connection) {
      res.status(404).json({ error: "No pending bank connection found." });
      return;
    }

    const statusResp = await yapilyFetch(`/hosted/consent-requests/${connection.consent_request_id}`);
    if (!statusResp.ok) {
      const text = await statusResp.text();
      console.error("Yapily consent-request status error:", statusResp.status, text);
      res.status(502).json({ error: "Could not confirm the bank connection. Please try again shortly." });
      return;
    }

    const statusBody = await statusResp.json();
    const consentRequest = statusBody.data;
    const linked = consentRequest.status === "AUTHORIZED";

    let institutionName = null;
    const institutionId = consentRequest.institutionIdentifiers && consentRequest.institutionIdentifiers.institutionId;

    if (linked && institutionId) {
      try {
        const instResp = await yapilyFetch(`/institutions/${institutionId}`);
        if (instResp.ok) {
          const instBody = await instResp.json();
          institutionName = instBody.data && instBody.data.name;
        }
      } catch (e) {
        // Not fatal — we can still show the connection as linked without a
        // pretty name, falling back to the raw id below.
        console.error("Institution lookup failed (continuing anyway):", e);
      }
    }

    const { error: updateError } = await supabase
      .from("bank_connections")
      .update({
        status: linked ? "linked" : "error",
        consent_id: consentRequest.consentId || null,
        institution_id: institutionId || null,
        institution_name: institutionName || institutionId || null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updateError) {
      console.error("Supabase update error:", updateError);
      res.status(500).json({ error: "Could not save the connection result." });
      return;
    }

    if (!linked) {
      res.status(200).json({ linked: false, message: "The bank connection wasn't completed. You can try again." });
      return;
    }

    res.status(200).json({ linked: true, institutionName: institutionName || institutionId });
  } catch (err) {
    console.error("complete-requisition error:", err);
    res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
  }
}
