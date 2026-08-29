// src/lib/subscription.js
//
// Mirrors lib/trueLayer.js's pattern — connectBank() opens a browser to an
// external consent flow; startUpgrade() does the same for Stripe Checkout.
// Payment happens on Stripe's hosted page, never inside the native app —
// this is deliberate, not incidental (see create-checkout-session.js for
// the full reasoning: Google Play requires its own billing system for
// in-app purchases, so this sidesteps that entirely by keeping payment on
// the web).

import { Browser } from "@capacitor/browser";
import { API_BASE } from "./apiBase";

export async function startUpgrade(accessToken, plan = "monthly") {
  const resp = await fetch(`${API_BASE}/api/create-checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ plan }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.url) throw new Error(data.error || "Couldn't start checkout.");
  await Browser.open({ url: data.url });
}

export async function fetchSubscriptionStatus(accessToken) {
  const resp = await fetch(`${API_BASE}/api/subscription-status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) return { hasPremium: false, status: "none" };
  return resp.json();
}
