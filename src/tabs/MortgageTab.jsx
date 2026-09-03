import React, { useState, useRef, useEffect } from "react";
import { gbp, daysSince, addMonths, getActiveMode } from "../lib/finance";
import { Card, WhyItMatters, InfoTip, DisclosureSection, Field, NumberInput, StatIcon } from "../components/ui";
import { API_BASE } from "../lib/apiBase";
import { supabase } from "../lib/supabaseClient";

// Split out of DebtsTab.jsx so "Mortgage equity" on Overview lands on a
// screen that's genuinely only about the mortgage — no loans, cards, or
// debt-free calculator mixed in, and no "show everything" fallback back
// to a combined view. See LoansAndCardsTab.jsx for the other half of the
// old DebtsTab.jsx.
//
// Deliberately duplicated from IncomeTab.jsx/BankImportTab.jsx/
// AccountPanel.jsx rather than imported — this is its own lazy-loaded
// chunk, and importing across chunks would couple two that were
// deliberately split apart, for the sake of one small stateless component.
function PremiumGate({ subscriptionStatus, onUpgrade, text }) {
  const isLapsed = subscriptionStatus === "canceled" || subscriptionStatus === "past_due";
  return (
    <div className="wmg-premium-gate" style={{ textAlign: "center", padding: "8px 0" }}>
      <div className="wmg-sub" style={{ marginBottom: 10 }}>{text}</div>
      <button className="wmg-btn-primary" onClick={onUpgrade}>
        {isLapsed ? "Renew Premium" : "See Premium plans"}
      </button>
    </div>
  );
}

export function MortgageTab({ profile, totals, setField, confirmMortgageBalance, mortgageMonths, hasPremium, subscriptionStatus, onUpgrade, onNavigate }) {
  const [editingMortgage, setEditingMortgage] = useState(false);
  const [mortgageDraft, setMortgageDraft] = useState(profile.mortgage.balance);
  const mortgageDaysSince = daysSince(profile.mortgage.lastConfirmedAt);
  const mortgageChanged = Math.abs((totals?.mortgageBalanceToday ?? profile.mortgage.balance) - profile.mortgage.balance) > 1;
  const activeMode = getActiveMode(profile);

  // Address autocomplete: typing debounces into a search against
  // api/property-address-search (Chimnie's Address Autocomplete), which
  // returns real matched UK addresses rather than free text — picking one
  // resolves its UPRN immediately via api/property-resolve-address rather
  // than waiting for the monthly valuation cron. See both files' comments
  // for why this doesn't eliminate the one-time 10p Chimnie cost, just
  // moves it earlier and makes the address itself reliable.
  const [addressQuery, setAddressQuery] = useState(profile.propertyAddress || "");
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [autocompleteSession, setAutocompleteSession] = useState(null);
  const [addressSearchStatus, setAddressSearchStatus] = useState("idle"); // idle | searching | error
  const [addressSearchError, setAddressSearchError] = useState("");
  const [addressResolveStatus, setAddressResolveStatus] = useState("idle"); // idle | resolving | error
  const addressDebounceRef = useRef(null);
  useEffect(() => {
    setAddressQuery(profile.propertyAddress || "");
  }, [profile.propertyAddress]);

  // FOUND WHILE SPLITTING THIS OUT OF DebtsTab.jsx: the "Get valuation
  // now" button below referenced valuationFetchStatus/retryValuation, but
  // neither was ever actually declared anywhere in the original file —
  // this would have thrown a ReferenceError and crashed the tab the
  // moment a Premium user with a tracked address+UPRN saw this button.
  // FOLLOW-UP: the first fix called property-resolve-address again, which
  // re-resolves the address and costs another 10p Chimnie call each time.
  // api/property-fetch-valuation.js already exists specifically for this
  // — it retries the free valuation-only step against an already-known
  // propertyUprn, without touching address resolution at all. Confirmed
  // working; this now calls that endpoint instead.
  const [valuationFetchStatus, setValuationFetchStatus] = useState("idle"); // idle | fetching | error
  const retryValuation = async () => {
    if (!profile.propertyUprn) return;
    setValuationFetchStatus("fetching");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const resp = await fetch(`${API_BASE}/api/property-fetch-valuation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ uprn: profile.propertyUprn }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Couldn't fetch a valuation.");
      if (data.value != null) {
        setField(["homeValue"])(data.value);
        setField(["homeValueSource"])("auto");
        setField(["homeValueUpdatedAt"])(new Date().toISOString());
      }
      setValuationFetchStatus("idle");
    } catch (e) {
      setValuationFetchStatus("error");
    }
  };

  const searchAddress = async (query) => {
    setAddressSearchStatus("searching");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const resp = await fetch(`${API_BASE}/api/property-address-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ query }),
      });
      const data = await resp.json();
      if (resp.status === 402) {
        // hasPremium was true client-side (this whole address-search UI
        // is already gated behind it — see the render below) but the
        // server disagreed. That's a real mismatch worth surfacing
        // honestly rather than folding into the generic error message
        // below, since "try again in a moment" isn't the right advice
        // for this — signing out and back in, or checking Premium
        // status on Account, actually might fix it.
        setAddressSearchStatus("error");
        setAddressSearchError("Your Premium status couldn't be confirmed just now — try signing out and back in, or check your subscription on the Account screen.");
        return;
      }
      if (!resp.ok) throw new Error(data.error || "Search failed.");
      setAddressSuggestions(data.addresses || []);
      setAutocompleteSession(data.session || null);
      setAddressSearchStatus("idle");
    } catch (e) {
      // Previously always showed one hardcoded "Couldn't search addresses
      // right now" message no matter what actually failed (missing
      // CHIMNIE_API_KEY, a real Chimnie API error, a network issue) —
      // that made a real misconfiguration indistinguishable from a
      // one-off blip. Now shows the server's actual error text when
      // there is one.
      setAddressSearchStatus("error");
      setAddressSearchError(e.message || "Couldn't search addresses right now — try again in a moment.");
      setAddressSuggestions([]);
    }
  };

  const handleAddressQueryChange = (value) => {
    setAddressQuery(value);
    setAddressSuggestions([]);
    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    if (value.trim().length < 3) return;
    // Waits for a pause in typing before searching, rather than firing on
    // every keystroke — Chimnie's autocomplete has its own per-request
    // cost/rate limit like the rest of their API, so this keeps that down
    // regardless of exactly what that cost turns out to be.
    addressDebounceRef.current = setTimeout(() => searchAddress(value.trim()), 400);
  };

  const selectAddress = async (address) => {
    setAddressSuggestions([]);
    setAddressResolveStatus("resolving");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const resp = await fetch(`${API_BASE}/api/property-resolve-address`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ address, autocompleteSession }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Couldn't confirm that address.");
      setField(["propertyAddress"])(data.address || address);
      setField(["propertyUprn"])(data.uprn);
      if (data.value != null) {
        setField(["homeValue"])(data.value);
        setField(["homeValueSource"])("auto");
        setField(["homeValueUpdatedAt"])(new Date().toISOString());
      }
      setAddressQuery(data.address || address);
      setAddressResolveStatus("idle");
    } catch (e) {
      setAddressResolveStatus("error");
    }
  };

  const switchToManualHomeValue = () => {
    setField(["propertyAddress"])("");
    setField(["propertyUprn"])(null);
    setField(["homeValueSource"])("manual");
    setAddressQuery("");
    setAddressSuggestions([]);
  };

  return (
    <>
      <div className="wmg-section-title">Mortgage</div>
      <Card>
        {profile.mortgageDetailsConfirmed ? (
          <>
            <div className="wmg-detail-row">
              <span className="wmg-detail-row-label"><StatIcon name="home" />Balance outstanding</span>
              <span className="wmg-detail-row-value">{gbp(profile.mortgage.balance)}</span>
            </div>
            <div className="wmg-detail-row">
              <span className="wmg-detail-row-label"><StatIcon name="calendar" />Monthly payment</span>
              <span className="wmg-detail-row-value">{gbp(profile.mortgage.payment)}</span>
            </div>
            <div className="wmg-detail-row">
              <span className="wmg-detail-row-label"><StatIcon name="percent" />Interest rate</span>
              <span className="wmg-detail-row-value">{profile.mortgage.rate}%</span>
            </div>
            <div className="wmg-detail-row">
              <span className="wmg-detail-row-label"><StatIcon name="flag" />Mortgage-free</span>
              <span className="wmg-detail-row-value tone-sage">{isFinite(mortgageMonths) ? addMonths(mortgageMonths) : "—"}</span>
            </div>
            {profile.mortgage.remainingTermYears != null && (
              <div className="wmg-sub" style={{ marginTop: 2 }}>
                {profile.mortgage.remainingTermYears} year{profile.mortgage.remainingTermYears === 1 ? "" : "s"} left on your actual mortgage term
                {isFinite(mortgageMonths) ? ` — the figure above is our calculation of when you'll actually finish paying at your current rate and payment, which can land earlier or later than your contracted term.` : ""}
              </div>
            )}
            <div className="wmg-sub" style={{ marginTop: 8 }}>
              {mortgageChanged ? `Estimated today: ${gbp(totals?.mortgageBalanceToday ?? profile.mortgage.balance)} — ` : ""}
              confirmed {gbp(profile.mortgage.balance)} {mortgageDaysSince === 0 ? "today" : `${mortgageDaysSince} day${mortgageDaysSince === 1 ? "" : "s"} ago`}
            </div>
            <button
              type="button"
              className="wmg-debt-card-edit"
              style={{ marginTop: 10 }}
              onClick={() => setField(["mortgageDetailsConfirmed"])(false)}
            >
              Edit mortgage details
            </button>
          </>
        ) : (
          <>
            <div className="wmg-three-col">
              <div>
                <label className="wmg-field-label">Balance outstanding</label>
                {editingMortgage ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <NumberInput
                      className="wmg-input"
                      autoFocus
                      value={mortgageDraft}
                      onChange={setMortgageDraft}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          confirmMortgageBalance(mortgageDraft);
                          setEditingMortgage(false);
                        }
                      }}
                    />
                    <button
                      className="wmg-debt-card-edit"
                      onClick={() => {
                        confirmMortgageBalance(mortgageDraft);
                        setEditingMortgage(false);
                      }}
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <NumberInput
                      className="wmg-input"
                      value={profile.mortgage.balance}
                      onChange={confirmMortgageBalance}
                    />
                    <button
                      className="wmg-debt-card-edit"
                      onClick={() => {
                        setMortgageDraft(Math.round(totals?.mortgageBalanceToday ?? profile.mortgage.balance));
                        setEditingMortgage(true);
                      }}
                    >
                      Edit
                    </button>
                  </div>
                )}
                <div className="wmg-sub" style={{ marginTop: 4 }}>
                  {mortgageChanged ? `Estimated today: ${gbp(totals?.mortgageBalanceToday ?? profile.mortgage.balance)} — ` : ""}
                  confirmed {gbp(profile.mortgage.balance)} {mortgageDaysSince === 0 ? "today" : `${mortgageDaysSince} day${mortgageDaysSince === 1 ? "" : "s"} ago`}
                </div>
              </div>
              <Field label="Monthly payment">
                <NumberInput className="wmg-input" value={profile.mortgage.payment} onChange={setField(["mortgage", "payment"])} />
              </Field>
              <div>
                <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Mortgage-free</div>
                <div className="wmg-figure tone-sage">{isFinite(mortgageMonths) ? addMonths(mortgageMonths) : "—"}</div>
              </div>
            </div>
            <button
              type="button"
              className="wmg-btn-primary"
              style={{ marginTop: 10 }}
              onClick={() => setField(["mortgageDetailsConfirmed"])(true)}
            >
              ✓ I've confirmed these mortgage details
            </button>
          </>
        )}
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "var(--paper-dim)", marginTop: 12 }}>
          <input
            type="checkbox"
            checked={profile.mortgage.includedInExpenditure}
            onChange={(e) => setField(["mortgage", "includedInExpenditure"])(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          I've already added my mortgage payment as a line item under Essentials in Income &amp; Expenditure — don't count it again here
        </label>

        <DisclosureSection label="See more details" defaultOpen={activeMode !== "guided"}>
          {!profile.mortgageDetailsConfirmed && (
            <div className="wmg-three-col">
              <Field label="Interest rate (%)">
                <NumberInput className="wmg-input" step="0.1" value={profile.mortgage.rate} onChange={setField(["mortgage", "rate"])} />
              </Field>
              <Field
                label="Years left on your term"
                hint="Optional. Your mortgage statement or lender's app will show this — it's just for comparison, not used in any calculation, since 'Mortgage-free' above is worked out from your balance, rate and payment instead."
              >
                <NumberInput
                  className="wmg-input"
                  step="1"
                  value={profile.mortgage.remainingTermYears ?? ""}
                  onChange={(v) => setField(["mortgage", "remainingTermYears"])(v === "" ? null : v)}
                />
              </Field>
            </div>
          )}
          <div className="wmg-two-col" style={{ marginTop: profile.mortgageDetailsConfirmed ? 0 : 4 }}>
            {/* Removed the "let surplus go toward the mortgage too" toggle
                per Jack's request — it was a separate mechanism from house
                price growth (which is already factored into the Cash Flow
                Forecast automatically via homeValueGrowth, regardless of
                this setting) and he found the toggle itself unnecessary
                clutter. Surplus-to-mortgage is now always on by default
                (profile.mortgage.allowOverpayment stays true in
                defaultProfile) rather than user-controlled — this field
                is still shown since it's real UK mortgage terminology used
                by both this forecast and the separate Mortgage
                Overpayment Calculator tab. */}
            <Field
              label="Penalty-free overpayment allowance (% of balance/year)"
              hint="Most mortgages let you pay extra off the balance up to a limit each year — usually 10% — without being charged a fee. Check your mortgage documents or ask your lender for your actual limit."
            >
              <NumberInput
                className="wmg-input"
                step="1"
                value={profile.mortgage.overpaymentCapPct}
                onChange={setField(["mortgage", "overpaymentCapPct"])}
              />
            </Field>
          </div>
        </DisclosureSection>
      </Card>

      {/* Was a single small text link buried inside the collapsed "See
          more details" section above — easy to never see at all, for
          something that can genuinely change someone's payoff date by
          years. Pulled out into its own standalone, always-visible card
          instead. No new calculation here — MortgageOverpaymentTab.jsx
          does the real work; this is purely about making the door to it
          impossible to miss. */}
      {profile.mortgage.balance > 0 && (
        <Card
          style={{ borderColor: "var(--sage)", cursor: "pointer" }}
          onClick={() => onNavigate?.("mortgage-overpayment")}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="wmg-showcase-icon tone-sage" style={{ width: 40, height: 40, flexShrink: 0 }} aria-hidden="true">
              <StatIcon name="flag" />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="wmg-detail-row-label" style={{ fontWeight: 500, fontSize: 15 }}>Could you be mortgage-free sooner?</div>
              <div className="wmg-sub" style={{ marginTop: 2 }}>
                See how a lump sum or a bit extra each month could cut years off your mortgage and save on interest.
              </div>
            </div>
            <span aria-hidden="true" style={{ flexShrink: 0, color: "var(--sage)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          </div>
        </Card>
      )}

      <div className="wmg-section-title">Home value</div>
      <Card>
        {profile.homeValueSource === "auto" && profile.propertyUprn && profile.homeValueUpdatedAt ? (
          <>
            <div className="wmg-detail-row">
              <span className="wmg-detail-row-label"><StatIcon name="home" />Estimated value</span>
              <span className="wmg-detail-row-value">{gbp(profile.homeValue)}</span>
            </div>
            <div className="wmg-sub" style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <StatIcon name="pin" /> Tracking {profile.propertyAddress} — updated{" "}
              {new Date(profile.homeValueUpdatedAt).toLocaleDateString("en-GB")}
            </div>
            <button
              type="button"
              className="wmg-onboard-skip"
              style={{ marginTop: 6 }}
              onClick={switchToManualHomeValue}
            >
              Switch to manual entry instead
            </button>
          </>
        ) : (
          <>
            <div className="wmg-three-col">
              <Field label="Estimated home value">
                <NumberInput
                  className="wmg-input"
                  value={profile.homeValue}
                  onChange={(v) => {
                    setField(["homeValue"])(v);
                    setField(["homeValueSource"])("manual");
                  }}
                />
              </Field>
              <Field label="Assumed annual house price growth (%)">
                <NumberInput className="wmg-input" step="0.1" value={profile.homeValueGrowth} onChange={setField(["homeValueGrowth"])} />
              </Field>
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="wmg-field-label">Track this automatically instead</div>
              <div className="wmg-sub" style={{ marginBottom: 8 }}>
                Add your property's address and we'll look up an estimated value once a month, so this stays current
                without you having to check anywhere or update it by hand.
              </div>
              {!hasPremium ? (
                <PremiumGate
                  subscriptionStatus={subscriptionStatus}
                  onUpgrade={onUpgrade}
                  text="Automatic monthly home value tracking is a Premium feature."
                />
              ) : profile.propertyAddress && profile.propertyUprn ? (
                <div>
                  <div className="wmg-sub">
                    Tracking <strong style={{ color: "var(--paper)" }}>{profile.propertyAddress}</strong> — no
                    automatic valuation yet.
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      className="wmg-add-btn"
                      style={{ width: "auto" }}
                      disabled={valuationFetchStatus === "fetching"}
                      onClick={retryValuation}
                    >
                      {valuationFetchStatus === "fetching" ? "Fetching…" : "Get valuation now"}
                    </button>
                    {valuationFetchStatus === "error" && (
                      <div className="wmg-sub" style={{ marginTop: 4, color: "var(--rust)" }}>
                        Couldn't fetch a valuation — try again in a moment.
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="wmg-onboard-skip"
                    style={{ marginTop: 6 }}
                    onClick={switchToManualHomeValue}
                  >
                    Switch to manual entry instead
                  </button>
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  <input
                    className="wmg-input"
                    type="text"
                    placeholder="Start typing your address…"
                    value={addressQuery}
                    onChange={(e) => handleAddressQueryChange(e.target.value)}
                    autoComplete="off"
                  />
                  {addressSearchStatus === "searching" && (
                    <div className="wmg-sub" style={{ marginTop: 6 }}>Searching…</div>
                  )}
                  {addressSearchStatus === "error" && (
                    <div className="wmg-sub" style={{ marginTop: 6, color: "var(--rust)" }}>
                      {addressSearchError || "Couldn't search addresses right now — try again in a moment."}
                    </div>
                  )}
                  {addressSuggestions.length > 0 && (
                    <div className="wmg-address-suggestions">
                      {addressSuggestions.map((addr) => (
                        <button
                          key={addr}
                          type="button"
                          className="wmg-address-suggestion"
                          onClick={() => selectAddress(addr)}
                        >
                          {addr}
                        </button>
                      ))}
                    </div>
                  )}
                  {addressResolveStatus === "resolving" && (
                    <div className="wmg-sub" style={{ marginTop: 6 }}>Confirming that address…</div>
                  )}
                  {addressResolveStatus === "error" && (
                    <div className="wmg-sub" style={{ marginTop: 6, color: "var(--rust)" }}>
                      Couldn't confirm that address — try selecting it again.
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
