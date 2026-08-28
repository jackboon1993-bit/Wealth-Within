// api/_lib/requirePremiumUser.js
//
// Shared auth + premium check for Premium-only endpoints (AI Pension
// Reader, spending insights, bill checker, subscription detection,
// household invites). Mirrors the auth pattern already used in
// truelayer-accounts.js / subscription-status.js — verify the Supabase
// access token, resolve the household, then check the subscriptions
// table — so there's one definition of "signed in + has Premium" shared
// across every route that needs it, instead of a slightly different copy
// in each file that could drift out of sync.
//
// Before this helper existed, analyze-pension.js, spending-insight.js,
// check-bills.js, and detect-subscriptions.js had NO auth check at all —
// anyone could POST to them directly, signed in or not, free tier or
// not, and each call spends real Anthropic API credit. Client-side
// hasPremium checks (the App.jsx/tab-component prop threading) stop a
// normal user from finding the paywalled button, but do nothing against
// someone calling the endpoint directly — this is the actual enforcement.
//
// Usage in a route:
//   const session = await requirePremiumUser(req, res);
//   if (!session.ok) return; // response already sent — 401/402/404
//   // session.userId, session.householdId are available here

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient((process.env.SUPABASE_URL || "").trim(), (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim());

export async function requirePremiumUser(req, res) {
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

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("status")
    .eq("household_id", membership.household_id)
    .maybeSingle();

  const status = sub?.status || "none";
  const hasPremium = status === "trialing" || status === "active";

  if (!hasPremium) {
    // 402 Payment Required — the closest-fitting standard status for
    // "you're properly signed in, this just needs a Premium subscription".
    // The app-side fetch wrappers should check for this status
    // specifically and show the upgrade prompt rather than a generic
    // error (see the updated lib files' handling of premium_required).
    res.status(402).json({ error: "This feature needs Wealth Within Premium.", code: "premium_required" });
    return { ok: false };
  }

  return { ok: true, userId: userData.user.id, householdId: membership.household_id, status };
}
