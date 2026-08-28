// api/subscription-status.js
//
// Called from the app to check whether the household currently has
// premium access. "trialing" and "active" both count as having access;
// anything else (or no row at all) means free tier only.

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient((process.env.SUPABASE_URL || "").trim(), (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim());

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://localhost");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const authHeader = req.headers.authorization || "";
  const userToken = authHeader.replace("Bearer ", "");
  if (!userToken) return res.status(401).json({ error: "Not signed in." });

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(userToken);
  if (userError || !userData?.user) return res.status(401).json({ error: "Invalid session." });

  const { data: membership } = await supabaseAdmin
    .from("household_members")
    .select("household_id")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle();
  if (!membership) return res.status(404).json({ error: "No household found." });

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("status, trial_ends_at, current_period_end")
    .eq("household_id", membership.household_id)
    .maybeSingle();

  const status = sub?.status || "none";
  const hasPremium = status === "trialing" || status === "active";

  return res.status(200).json({
    hasPremium,
    status,
    trialEndsAt: sub?.trial_ends_at || null,
    currentPeriodEnd: sub?.current_period_end || null,
  });
}
