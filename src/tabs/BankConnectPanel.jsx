import React, { useEffect, useState } from "react";
import { Card } from "../components/ui";
import { supabase } from "../lib/supabaseClient";
import { connectBank } from "../lib/trueLayer";

// Sits alongside the existing CSV import options in ImportTab — an
// alternative, lower-effort path to the same place (populated spending
// categories) rather than a replacement for manual entry, which stays the
// fallback for anyone who'd rather not connect a bank at all.
export function BankConnectPanel({ householdId }) {
  const [accounts, setAccounts] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | connecting | loading | error

  const fetchAccounts = async () => {
    setStatus("loading");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const resp = await fetch("/api/truelayer-accounts", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (resp.status === 404) {
        setAccounts(null); // not connected yet — normal, not an error
        setStatus("idle");
        return;
      }
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setAccounts(data.accounts);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  // Check connection status on load, and again after returning from the
  // bank's consent flow (App.jsx routes back here on ?bank_callback=1).
  useEffect(() => {
    fetchAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async () => {
    setStatus("connecting");
    await connectBank(householdId);
    // The browser tab/sheet takes over from here; nothing more to do until
    // the redirect brings the person back into the app.
  };

  return (
    <Card>
      <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>Connect a bank</div>
      {accounts ? (
        <>
          <div className="wmg-sub" style={{ marginBottom: 10 }}>
            {accounts.length} account{accounts.length === 1 ? "" : "s"} connected.
          </div>
          {accounts.map((acc) => (
            <div key={acc.name} className="wmg-item-line">
              <span style={{ flex: 1, fontSize: 13.5 }}>{acc.name}</span>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>
                {acc.balance != null ? `£${acc.balance.toFixed(2)}` : "—"}
              </span>
            </div>
          ))}
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
