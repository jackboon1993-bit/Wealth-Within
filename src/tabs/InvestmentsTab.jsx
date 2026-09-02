import React, { useState } from "react";
import { gbp } from "../lib/finance";
import { Card, WhyItMatters, InfoTip, InlinePill } from "../components/ui";

// Split out of the old GoalsTab.jsx so "Investments" on Overview lands on
// its own screen, rather than being folded into Savings with no
// separation. This is deliberately minimal today — investments.balance
// is currently just a single figure with nothing else tracked against it
// (no holdings, no performance) — but it now has a real, single-purpose
// home to grow into rather than never getting one at all.

export function InvestmentsTab({ profile, setField, onNavigate }) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="wmg-section-title">Investments</div>
      <WhyItMatters>
        This is your ISA, general investment account, or any other non-pension investing — kept separate from your
        pension balance, which is tracked on its own Pension screen, and separate from cash savings, which don't
        carry the same risk or potential for growth.
      </WhyItMatters>
      <Card>
        {editing ? (
          <>
            <div className="wmg-sentence-card">
              You currently have{" "}
              <InlinePill value={profile.investments.balance} onChange={(v) => setField(["investments", "balance"])(v)} formatter={(v) => gbp(v)} ariaLabel="Investments balance" />{" "}
              in investments (outside your pension){" "}
              <InfoTip text="This is your ISA, general investment account, or other non-pension investments — pension balance is tracked separately on the Pension screen." />.
            </div>
            <div className="wmg-entry-edit-actions" style={{ marginTop: 10 }}>
              <button type="button" className="wmg-entry-done-btn" onClick={() => setEditing(false)}>Done</button>
            </div>
          </>
        ) : (
          <div className="wmg-entry-view">
            <div className="wmg-entry-view-text">
              <div className="wmg-entry-title">{gbp(profile.investments.balance)} in investments</div>
            </div>
            <button type="button" className="wmg-entry-edit-btn" onClick={() => setEditing(true)} aria-label="Edit investments">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          </div>
        )}
      </Card>

      {!profile.dismissedReaderBannerInvestments && (
        <Card style={{ marginTop: 12 }}>
          <div className="wmg-entry-view">
            <div className="wmg-entry-view-text">
              <div className="wmg-eyebrow" style={{ marginBottom: 4 }}>Got an ISA or investment statement?</div>
              <div className="wmg-sub">Upload it to the AI Document Reader and get a plain-English breakdown — current value, fees, and what it's likely to grow to.</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" className="wmg-btn-primary" onClick={() => onNavigate?.("pension-reader")}>
              Read a statement
            </button>
            <button
              type="button"
              className="wmg-onboard-skip"
              onClick={() => setField?.(["dismissedReaderBannerInvestments"])(true)}
            >
              Dismiss
            </button>
          </div>
        </Card>
      )}
    </>
  );
}
