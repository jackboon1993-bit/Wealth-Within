import React, { useEffect, useRef, useState } from "react";
import { Card, InfoTip, Celebration } from "../components/ui";
import { supabase } from "../lib/supabaseClient";
import { connectBank } from "../lib/trueLayer";
import { API_BASE } from "../lib/apiBase";

// Sits alongside the existing CSV import options in ImportTab — an
// alternative, lower-effort path to the same place (populated spending
// categories) rather than a replacement for manual entry, which stays the
// fallback for anyone who'd rather not connect a bank at all.
// A person-driven choice, not automatic — picks which existing debt entry
// (by name, since that's all a person can reasonably judge) this card's
// balance should update, or adds it as a new one. Deliberately no
// auto-matching, since silently updating the wrong debt would corrupt
// real data with no easy way to notice.
function CardDebtMatcher({ card, existingCards, onUseAsCardDebt }) {
  const [selected, setSelected] = useState(existingCards?.length ? existingCards[0].id : "__new__");
  // Only shown after adding a brand new card — TrueLayer only ever gives
  // us the current balance, never an interest rate or monthly payment, so
  // a freshly-added card's balance won't move on its own at all until
  // those are filled in on Debts & Mortgage. Updating an existing card
  // doesn't need this, since it presumably already has both set.
  const [justAddedNew, setJustAddedNew] = useState(false);
  const handleApply = () => {
    onUseAsCardDebt?.(selected, card.balance, card.name);
    if (selected === "__new__") setJustAddedNew(true);
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <select
          className="wmg-input"
          style={{ fontSize: 12, padding: "3px 6px", width: "auto" }}
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setJustAddedNew(false);
          }}
        >
          {(existingCards || []).map((c) => (
            <option key={c.id} value={c.id}>Update "{c.name}"</option>
          ))}
          <option value="__new__">Add as a new card</option>
        </select>
        <button
          type="button"
          className="wmg-onboard-skip"
          style={{ padding: "3px 10px", fontSize: 12 }}
          onClick={handleApply}
        >
          Apply
        </button>
      </div>
      {justAddedNew && (
        <div className="wmg-sub" style={{ marginTop: 6, fontSize: 12, color: "var(--gold)" }}>
          Added — now go to Debts &amp; Mortgage and fill in its interest rate and monthly payment, or its balance
          won't update between bank pulls.
        </div>
      )}
    </div>
  );
}

export function BankConnectPanel({ householdId, onAccountsChanged, onUseAsSavings, savingsBalance, onUseAsCardDebt, existingCards }) {
  const [accounts, setAccounts] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | connecting | loading | error
  // A real "hit" moment — first bank connection succeeding — but only
  // the first time it happens in this component's life, not on every
  // ordinary re-check (mount, focus, reconnecting an already-connected
  // bank). connectingRef flips true right before the OAuth flow opens;
  // fetchAccounts only celebrates if that flag is set AND accounts is
  // going from "nothing connected" to "something connected" — a
  // reconnect of an already-connected bank never re-triggers this,
  // since accounts was already non-null going in.
  const connectingRef = useRef(false);
  const [showCelebration, setShowCelebration] = useState(false);

  const fetchAccounts = async () => {
    setStatus("loading");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const resp = await fetch(`${API_BASE}/api/truelayer-accounts`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (resp.status === 404) {
        setAccounts(null); // not connected yet — normal, not an error
        setStatus("idle");
        onAccountsChanged?.(null);
        return;
      }
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setAccounts((prev) => {
        if (connectingRef.current && !prev && data.accounts?.length) {
          setShowCelebration(true);
          // Unlike the Forecast reveal screen or GoalsTab (which show
          // Celebration on a screen the person naturally navigates away
          // from), this panel stays on screen indefinitely once
          // connected — so without a timer, "Bank connected!" would sit
          // there forever instead of being a one-off moment.
          setTimeout(() => setShowCelebration(false), 3500);
        }
        return data.accounts;
      });
      connectingRef.current = false;
      setStatus("idle");
      onAccountsChanged?.(data.accounts);
    } catch {
      connectingRef.current = false;
      setStatus("error");
    }
  };

  // Check connection status on load, and again after returning from the
  // bank's consent flow (App.jsx routes back here on ?bank_callback=1).
  useEffect(() => {
    fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The in-app browser used for bank consent doesn't remount this
  // component when it closes — the person lands back on the same screen,
  // same component instance. So `status` never got reset on its own,
  // leaving the button stuck on "Opening…" forever even after a
  // successful connection. Re-checking on window focus (which fires when
  // the browser closes and control returns to the app) fixes that without
  // needing App.jsx to pass anything extra down.
  useEffect(() => {
    const onFocus = () => {
      if (status === "connecting") fetchAccounts();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleConnect = async () => {
    setStatus("connecting");
    connectingRef.current = true;
    try {
      await connectBank(householdId);
      // The browser tab/sheet takes over from here; the focus listener
      // above picks things up again once it closes.
    } catch {
      // connectBank/Browser.open failed to even launch — don't leave the
      // button stuck saying "Opening…" for something that never opened.
      connectingRef.current = false;
      setStatus("error");
    }
  };

  return (
    <Card>
      {showCelebration && (
        <Celebration title="Bank connected!" message="Your balances and spending will now pull in automatically." tone="sage" />
      )}
      <div className="wmg-eyebrow" style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        Connect a bank
        <InfoTip text="Connect banks one at a time — each pull saves permanently. Add a payment date, rate, and monthly payment on Debts & Mortgage so balances keep updating correctly." />
      </div>
      {accounts ? (
        <>
          <div className="wmg-sub" style={{ marginBottom: 10 }}>
            {accounts.length} account{accounts.length === 1 ? "" : "s"} connected.
          </div>
          {accounts.map((acc) => {
            const isSavings = acc.kind !== "card" && String(acc.type || "").toUpperCase().includes("SAV");
            const alreadyUsed = isSavings && acc.balance != null && savingsBalance === acc.balance;
            return (
              <div key={acc.id || acc.name} className="wmg-item-line" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ flex: 1, fontSize: 13.5 }}>{acc.name}{acc.kind === "card" ? " (credit card)" : ""}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>
                    {acc.balance != null ? `£${acc.balance.toFixed(2)}` : "—"}
                  </span>
                </div>
                {isSavings && acc.balance != null && (
                  <button
                    type="button"
                    className="wmg-onboard-skip"
                    style={{ alignSelf: "flex-start", padding: "3px 10px", fontSize: 12 }}
                    disabled={alreadyUsed}
                    onClick={() => onUseAsSavings?.(acc.balance)}
                  >
                    {alreadyUsed ? "✓ Used as Savings balance" : "Use as Savings balance"}
                  </button>
                )}
                {acc.kind === "card" && acc.balance != null && (
                  <CardDebtMatcher card={acc} existingCards={existingCards} onUseAsCardDebt={onUseAsCardDebt} />
                )}
              </div>
            );
          })}
        </>
      ) : (
        <div className="wmg-sub" style={{ marginBottom: 10 }}>
          Link your bank via Open Banking to pull in balances and spending automatically, instead of entering it by
          hand. Read-only — this can't move money.
        </div>
      )}
      <button className="wmg-add-btn" onClick={handleConnect} disabled={status === "connecting"}>
        {status === "connecting" ? "Opening…" : accounts ? "Reconnect a bank" : "+ Connect your bank"}
      </button>
      {status === "error" && (
        <div className="wmg-sub" style={{ marginTop: 8, color: "var(--rust)" }}>
          Couldn't load account data — try reconnecting.
        </div>
      )}
    </Card>
  );
}
