// api/_lib/requireUser.js
//
// Shared auth-only check (no Premium requirement) for endpoints any
// signed-in user can call. categorize-transactions.js is the first of
// these — CSV import and the manual bank pull are both free-tier
// features, so requirePremiumUser.js's subscription check doesn't
// belong here, but the same "verify the token, resolve the household"
// need still does. Mirrors requirePremiumUser.js's auth pattern exactly,
// minus that last step — see that file's own comment for why this kind
// of check needs to live server-side at all (a client-side prop check
// stops a normal user from finding a button, but does nothing against
// someone calling the endpoint directly).
//
// Usage in a route:
//   const session = await requireUser(req, res);
//   if (!session.ok) return; // response already sent — 401/404
//   // session.userId, session.householdId, session.admin are available

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient((process.env.SUPABASE_URL || "").trim(), (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim());

export async function requireUser(req, res) {
  const authHeader = req.headers.authorization || "";
  const userToken = authHeader.replace("Bearer ", "");
  if (!userToken) {
    res.status(401).json({ error: "Not signed in." });
    return { ok: false };
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(userToken);
  if (userError || !userData?.user) {
    res.status(401).json({ error: "Invalid session." });
    return { ok: false };
  }

  const { data: membership } = await supabaseAdmin
    .from("household_members")
    .select("household_id")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) {
    res.status(404).json({ error: "No household found." });
    return { ok: false };
  }

  // Handing back the same admin client the caller can reuse for its own
  // Supabase calls (e.g. persistTransactions) rather than each route
  // creating a second one.
  return { ok: true, userId: userData.user.id, householdId: membership.household_id, admin: supabaseAdmin };
}
