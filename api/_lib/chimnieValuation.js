// Wraps calls to Chimnie's UK property data API (chimnie.com) for the
// monthly automatic home valuation feature.
//
// *** VERIFY BEFORE DEPLOYING ***
// The endpoint paths, auth header name, and response field names below
// are based on Chimnie's public marketing/pricing pages, NOT their actual
// API reference (docs.chimnie.com requires a logged-in account to view
// properly, so this couldn't be checked directly). Sign up for a free
// trial at https://dashboard.chimnie.com, then check the real request/
// response shape in their docs and adjust CHIMNIE_BASE_URL, the request
// shape in resolveUprn()/getAvmValue(), and the field names pulled off
// the response, before this runs against real data. Everything else in
// this file (the calling pattern, error handling, the free-vs-paid split)
// should be correct regardless of exact field names.
//
// What's confirmed from Chimnie's public pricing page (chimnie.com/pricing,
// chimnie.com/free-avm):
//   - Looking up a property VALUE by UPRN is free, rate-limited to 1
//     request/second on the free tier.
//   - Looking up a property by ADDRESS instead of UPRN costs money
//     (£0.05–0.15/property depending on data tier) — this is only used
//     once per household, to resolve and cache a UPRN, never repeated.

const CHIMNIE_BASE_URL = "https://api.chimnie.com/v1"; // CONFIRM against real docs

export async function resolveUprnFromAddress(address, apiKey) {
  const resp = await fetch(`${CHIMNIE_BASE_URL}/property/search?address=${encodeURIComponent(address)}`, {
    headers: { Authorization: `Bearer ${apiKey}` }, // CONFIRM auth header format against real docs
  });
  if (!resp.ok) {
    throw new Error(`Chimnie address lookup failed: ${resp.status}`);
  }
  const data = await resp.json();
  // CONFIRM the real field name for UPRN in the response — "uprn" is a
  // reasonable guess given it's the term used throughout their docs, but
  // unverified.
  const uprn = data?.uprn || data?.results?.[0]?.uprn || null;
  if (!uprn) {
    throw new Error("Chimnie address lookup returned no UPRN — check the address is a valid UK residential address.");
  }
  return uprn;
}

export async function getAvmValue(uprn, apiKey) {
  const resp = await fetch(`${CHIMNIE_BASE_URL}/valuation/${uprn}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    throw new Error(`Chimnie valuation lookup failed: ${resp.status}`);
  }
  const data = await resp.json();
  // CONFIRM the real field name for the estimated value — commonly
  // "estimatedValue" or "value" in AVM APIs, unverified here.
  const value = data?.estimatedValue ?? data?.value ?? null;
  if (value == null) {
    throw new Error("Chimnie valuation lookup returned no value for this UPRN.");
  }
  return Math.round(value);
}
