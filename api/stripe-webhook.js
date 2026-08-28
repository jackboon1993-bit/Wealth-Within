// api/stripe-webhook.js
//
// Called directly by Stripe's servers (not the app) whenever something
// changes about a subscription — trial started, payment succeeded,
// cancelled, etc. This is the ONLY place the subscriptions table gets
// written to; the app only ever reads it (see subscription-status.js).
//
// No CORS or Supabase-auth here — this isn't called from the app or a
// browser at all. Stripe authenticates itself with a signature in the
// stripe-signature header instead, verified against STRIPE_WEBHOOK_SECRET.
//
// Needs the RAW request body (not Vercel's parsed JSON) to verify that
// signature correctly — bodyParser is disabled below for that reason.

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { buffer } from "micro";

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabaseAdmin = createClient((process.env.SUPABASE_URL || "").trim(), (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim());
const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || "").trim());

// Maps a Stripe subscription status to the simpler set this app tracks.
function mapStatus(stripeStatus) {
  if (stripeStatus === "trialing") return "trialing";
  if (stripeStatus === "active") return "active";
  if (stripeStatus === "past_due" || stripeStatus === "unpaid") return "past_due";
  return "canceled";
}

async function upsertFromSubscription(subscription, householdIdFromCheckout) {
  // On the very first checkout, the subscription object doesn't carry the
  // household id directly — it comes from the Checkout Session's
  // client_reference_id instead (passed in separately when this is
  // called from checkout.session.completed). On later updates
  // (renewals, cancellations), look up the household by the Stripe
  // customer/subscription id already stored from that first event.
  let householdId = householdIdFromCheckout;
  if (!householdId) {
    const { data: existing } = await supabaseAdmin
      .from("subscriptions")
      .select("household_id")
      .eq("stripe_subscription_id", subscription.id)
      .maybeSingle();
    householdId = existing?.household_id;
  }
  if (!householdId) {
    console.error("Stripe webhook: couldn't resolve household_id for subscription", subscription.id);
    return;
  }

  await supabaseAdmin.from("subscriptions").upsert({
    household_id: householdId,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    status: mapStatus(subscription.status),
    trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
    current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const signature = req.headers["stripe-signature"];
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();

  let event;
  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return res.status(400).json({ error: "Invalid signature." });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        // Fetch the full subscription object — the checkout session
        // itself only has the subscription id, not its status/dates.
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        await upsertFromSubscription(subscription, session.client_reference_id);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await upsertFromSubscription(event.data.object, null);
        break;
      }
      default:
        // Other event types aren't relevant to what this app tracks —
        // ignored rather than erroring.
        break;
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Stripe webhook handler error:", err);
    // Still return 200 here — returning an error would make Stripe retry
    // repeatedly, which won't help if the bug is in this code rather than
    // something transient. Logged above for investigation instead.
    return res.status(200).json({ received: true, error: "logged" });
  }
}
