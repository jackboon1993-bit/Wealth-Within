// api/create-checkout-session.js
//
// Called from the app (with the signed-in user's Supabase access token) to
// start a subscription. Returns a Stripe-hosted Checkout URL — the app
// opens this in a browser via Browser.open(), the same way connectBank()
// opens TrueLayer's consent page. Payment details are entered on Stripe's
// own page, never inside the native app itself — this is deliberate:
// Google Play requires apps to use Google Play Billing for in-app digital
// purchases, so this route (and the browser-based flow around it) exists
// specifically to keep payment on the website instead, sidestepping that
// requirement entirely rather than risking the app being rejected.
//
// The 14-day free trial is configured directly on the Stripe Price object
// (in the dashboard), so it applies automatically to any subscription
// created from this price — nothing extra needed here for that.

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabaseAdmin = createClient((process.env.SUPABASE_URL || "").trim(), (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim());
const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || "").trim());

// The two Wealth Within Premium prices, read from Vercel env vars rather
// than hardcoded — lets pricing change (or a new plan be added later)
// without a code deploy. Set on the Price object in the Stripe dashboard:
// STRIPE_PRICE_MONTHLY should have the 14-day free trial configured on
// it directly; STRIPE_PRICE_ANNUAL deliberately has no trial (the
// annual option's whole purpose is removing the monthly "try then
// cancel" cycle, so re-adding a trial there would undercut that).
const PRICE_IDS = {
  monthly: (process.env.STRIPE_PRICE_MONTHLY || "").trim(),
  annual: (process.env.STRIPE_PRICE_ANNUAL || "").trim(),
};

export default async function handler(req, res) {
  // Same reasoning as every other route the native app calls directly —
  // see truelayer-accounts.js.
  res.setHeader("Access-Control-Allow-Origin", "https://localhost");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
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

  const { plan } = req.body || {};
  const priceId = PRICE_IDS[plan] || PRICE_IDS.monthly;
  if (!priceId) {
    console.error(`create-checkout-session: no Stripe price configured for plan "${plan || "monthly"}"`);
    return res.status(500).json({ error: "This plan isn't available right now." });
  }

  try {
    // Reuse an existing Stripe customer for this household if one already
    // exists (e.g. from a previous trial/cancellation), rather than
    // creating duplicates every time someone starts checkout.
    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("household_id", membership.household_id)
      .maybeSingle();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: existing?.stripe_customer_id || undefined,
      customer_email: existing?.stripe_customer_id ? undefined : userData.user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      // The App Link intercepts this exact path once Stripe redirects
      // here after checkout completes, handing control back to the
      // native app — same App Links mechanism already set up for the
      // bank-connect flow, just a different path.
      success_url: "https://wealth-within.vercel.app/subscription-connected?status=success",
      cancel_url: "https://wealth-within.vercel.app/subscription-connected?status=cancelled",
      // Carries the household id through so the webhook knows which
      // household this checkout belongs to.
      client_reference_id: membership.household_id,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: "Couldn't start checkout." });
  }
}
