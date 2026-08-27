// api/truelayer-callback.js
//
// TrueLayer redirects here after the person finishes bank consent. This is
// the ONLY place the client secret is used — it must live in Vercel env
// vars (TRUELAYER_CLIENT_SECRET), never in the shipped app.
//
// Uses the Supabase SERVICE ROLE key (also server-only) to write directly,
// bypassing RLS, since this runs with no user session context — just the
// household_id passed through as `state`.

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  (process.env.SUPABASE_URL || "").trim(),
  (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim() // server-only — never expose this key to the client
);

const TOKEN_URL = "https://auth.truelayer.com/connect/token";

export default async function handler(req, res) {
  const { code, state: householdId, error } = req.query;

  if (error) {
    return res.redirect(302, `/?bank_callback=1&status=denied`);
  }
  if (!code || !householdId) {
    return res.status(400).send("Missing code or household id.");
  }

  try {
    const tokenResp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: (process.env.TRUELAYER_CLIENT_ID || "").trim(),
        client_secret: (process.env.TRUELAYER_CLIENT_SECRET || "").trim(),
        redirect_uri: "https://wealth-within.vercel.app/api/truelayer-callback",
        code,
      }),
    });
    const tokens = await tokenResp.json();
    if (!tokenResp.ok) {
      // Log TrueLayer's actual error payload — the generic thrown message
      // below was hiding the real reason (e.g. invalid_grant because the
      // code was already used/expired, invalid_client, or a redirect_uri
      // mismatch). tokenResp.status is included too since some TrueLayer
      // errors don't set error_description at all.
      console.error("TrueLayer token exchange rejected:", {
        status: tokenResp.status,
        body: tokens,
      });
      throw new Error(tokens.error_description || tokens.error || `Token exchange failed (${tokenResp.status})`);
    }

    // Storing the refresh token lets you fetch fresh account data later
    // without re-running consent every time. This table needs creating —
    // see SETUP.md. In production this column should be encrypted at rest
    // (e.g. Supabase Vault, or application-level encryption) rather than
    // plain text — flagging that as a gap in this first-pass scaffold, not
    // something to ship to real users as-is.
    const { error: dbError } = await supabaseAdmin.from("bank_connections").upsert({
      household_id: householdId,
      refresh_token: tokens.refresh_token,
      connected_at: new Date().toISOString(),
    });
    if (dbError) throw dbError;

    return res.redirect(302, `/?bank_callback=1&status=connected`);
  } catch (err) {
    console.error("TrueLayer callback error:", err);
    return res.redirect(302, `/?bank_callback=1&status=error`);
  }
}
