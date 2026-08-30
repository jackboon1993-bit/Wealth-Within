// Wraps calls to Chimnie's UK property data API (chimnie.com) for the
// monthly automatic home valuation feature.
//
// Confirmed 30 Aug 2026 directly from docs.chimnie.com (via their in-docs
// assistant, cross-checked against the Free AVM docs page) — unlike the
// first version of this file, these details are no longer guesses:
//
//   - Base URL: https://api.chimnie.com (no /v1 — my first guess had one).
//   - Auth: `Authorization: Bearer <API key>` header.
//   - AVM lookup by UPRN, requesting only the free field, is free with a
//     1 request/second rate limit:
//       GET /residential/uprn/{uprn}?fields=property.value.sale.property_value
//     IMPORTANT: if any *other* (non-free) field is added to the same
//     request, Chimnie bills the whole request at that field's tier — so
//     this must request ONLY property_value and nothing else, or the
//     "free" part of this feature silently stops being free.
//   - Address lookup to resolve a UPRN costs a flat 10p minimum per
//     Chimnie's docs (their marketing/pricing page says 5p — the docs are
//     the authoritative number, and 10p is what this codes against). This
//     only ever runs once per household, the first time they add an
//     address — after that, the cached UPRN is reused forever.
//   - The UPRN comes back in the response's root "id" field.
//
// One thing that's still an assumption rather than confirmed: the exact
// shape of the AVM response JSON for a `fields`-filtered request wasn't
// shown as a full example, only the request. Based on how the `fields`
// dot-path parameter is documented elsewhere (mirroring the requested
// path back in the response), getAvmValue() below reads
// data.property.value.sale.property_value. If Chimnie's actual response
// is a flatter shape instead, only that one line needs adjusting — check
// the real response the first time this runs (e.g. log it once) and fix
// if needed.

const CHIMNIE_BASE_URL = "https://api.chimnie.com";

export async function resolveUprnFromAddress(address, apiKey) {
  const resp = await fetch(`${CHIMNIE_BASE_URL}/residential/address`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ address, fields: "id" }),
  });
  if (!resp.ok) {
    throw new Error(`Chimnie address lookup failed: ${resp.status}`);
  }
  const data = await resp.json();
  // Confirmed: UPRN comes back in the root "id" field.
  const uprn = data?.id || null;
  if (!uprn) {
    throw new Error("Chimnie address lookup returned no UPRN — check the address is a valid UK residential address.");
  }
  return uprn;
}

export async function getAvmValue(uprn, apiKey) {
  // Deliberately requests ONLY this one field — see the file-level note
  // above on why adding any other field here would make this billable.
  const resp = await fetch(
    `${CHIMNIE_BASE_URL}/residential/uprn/${encodeURIComponent(uprn)}?fields=property.value.sale.property_value`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  if (!resp.ok) {
    throw new Error(`Chimnie valuation lookup failed: ${resp.status}`);
  }
  const data = await resp.json();
  // See file-level note: response shape for a fields-filtered request
  // wasn't shown as a full example, so this nested path is the best
  // inference from how `fields` is documented — verify against the real
  // response and adjust this one line if it comes back differently.
  const value = data?.property?.value?.sale?.property_value ?? null;
  if (value == null) {
    throw new Error("Chimnie valuation lookup returned no value for this UPRN.");
  }
  return Math.round(value);
}
