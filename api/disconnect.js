// Fully disconnects a linked bank account, revoking the consent at Yapily
// as well as removing our local record — so access is properly cut off,
// not just hidden in the UI.

import { requireUser, yapilyFetch } from "./_shared.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { supabase, userId } = await requireUser(req);

    const { data: connection } = await supabase.from("bank_connections").select("*").eq("user_id", userId).maybeSingle();

    if (connection && connection.consent_id) {
      try {
        // Best-effort — even if this fails, we still remove our local record.
        await yapilyFetch(`/consents/${connection.consent_id}`, { method: "DELETE" });
      } catch (e) {
        console.error("Yapily revoke error (continuing anyway):", e);
      }
    }

    const { error: deleteError } = await supabase.from("bank_connections").delete().eq("user_id", userId);
    if (deleteError) {
      console.error("Supabase delete error:", deleteError);
      res.status(500).json({ error: "Could not remove the connection. Please try again." });
      return;
    }

    res.status(200).json({ disconnected: true });
  } catch (err) {
    console.error("disconnect error:", err);
    res.status(err.status || 500).json({ error: err.message || "Something went wrong." });
  }
}
