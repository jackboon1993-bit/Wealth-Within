// api/truelayer-accounts.js
//
// Called from the app (with the signed-in user's Supabase access token) to
// fetch a fresh account summary. Looks up the stored refresh token,
// exchanges it for a short-lived access token, then pulls balances.
// Deliberately returns only a simplified summary — not raw transaction
// data — since that's all the Overview/Import screens actually need, and
// it keeps sensitive transaction detail from sitting in client memory
// longer than necessary.

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient((process.env.SUPABASE_URL || "").trim(), (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim());
const TOKEN_URL = "https://auth.truelayer.com/connect/token";
const API_BASE = "https://api.truelayer.com/data/v1";

export default async function handler(req, res) {
  const authHeader = req.headers.authorization || "";
  const userToken = authHeader.replace("Bearer ", "");
  if (!userToken) return res.status(401).json({ error: "Not signed in." });

  // Verify the caller is actually a signed-in Supabase user, then resolve
  // their household — mirrors the pattern in lib/storage.js so this
  // endpoint can't be called with an arbitrary household_id.
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(userToken);
  if (userError || !userData?.user) return res.status(401).json({ error: "Invalid session." });

  const { data: membership } = await supabaseAdmin
    .from("household_members")
    .select("household_id")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return res.status(404).json({ error: "No household found." });

  const { data: connection } = await supabaseAdmin
    .from("bank_connections")
    .select("refresh_token")
    .eq("household_id", membership.household_id)
    .maybeSingle();
  if (!connection) return res.status(404).json({ error: "No bank connected." });

  try {
    const tokenResp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: (process.env.TRUELAYER_CLIENT_ID || "").trim(),
        client_secret: (process.env.TRUELAYER_CLIENT_SECRET || "").trim(),
        refresh_token: connection.refresh_token,
      }),
    });
    const tokens = await tokenResp.json();
    if (!tokenResp.ok) throw new Error(tokens.error_description || "Refresh failed");

    const accountsResp = await fetch(`${API_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const accountsData = await accountsResp.json();

    const summary = await Promise.all(
      (accountsData.results || []).map(async (acc) => {
        const balResp = await fetch(`${API_BASE}/accounts/${acc.account_id}/balance`, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        const balData = await balResp.json();
        const balance = balData.results?.[0];
        return {
          name: acc.display_name,
          type: acc.account_type,
          balance: balance?.current ?? null,
          currency: balance?.currency ?? "GBP",
        };
      })
    );

    // Refresh tokens can themselves rotate on use — if TrueLayer returns a
    // new one, store it or the next refresh will fail.
    if (tokens.refresh_token && tokens.refresh_token !== connection.refresh_token) {
      await supabaseAdmin
        .from("bank_connections")
        .update({ refresh_token: tokens.refresh_token })
        .eq("household_id", membership.household_id);
    }

    return res.status(200).json({ accounts: summary });
  } catch (err) {
    console.error("TrueLayer accounts error:", err);
    return res.status(500).json({ error: "Couldn't fetch account data." });
  }
}
