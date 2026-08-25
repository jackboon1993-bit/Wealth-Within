import { Browser } from "@capacitor/browser";

// TrueLayer's hosted consent flow — the user picks their bank and
// authenticates on TrueLayer/their bank's own page, never inside this app.
// client_id here is the PUBLIC id, safe to ship in the app. The client
// SECRET must never appear in client code — it only ever lives server-side
// (see api/truelayer-callback.js), used to exchange the returned code for
// tokens.
const TRUELAYER_AUTH_URL = "https://auth.truelayer-sandbox.com"; // switch to https://auth.truelayer.com when moving to a Live app
const CLIENT_ID = import.meta.env.VITE_TRUELAYER_CLIENT_ID;
// Must exactly match a redirect URI registered in your TrueLayer console.
// Pointing this at your deployed web domain (not a custom app:// scheme)
// keeps the OAuth redirect itself simple — the domain's /api route does
// the token exchange, then hands back to the app. Wiring the domain-to-app
// return trip (universal links / app links) is a separate native config
// step, not something this file can do alone.
const REDIRECT_URI = "https://wealth-within.vercel.app/api/truelayer-callback";

export function buildTrueLayerAuthUrl(householdId) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "info accounts balance transactions offline_access",
    providers: "uk-ob-all uk-oauth-all",
    // Carries the household id through the redirect so the callback knows
    // whose row to attach the resulting tokens to.
    state: householdId,
  });
  return `${TRUELAYER_AUTH_URL}/?${params.toString()}`;
}

export async function connectBank(householdId) {
  const url = buildTrueLayerAuthUrl(householdId);
  await Browser.open({ url });
}
