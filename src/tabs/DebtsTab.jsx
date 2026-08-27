import React, { useState, useRef } from "react";
import { gbp, clamp, daysSince, estimateBalanceToday, addMonths, getActiveMode, nextId } from "../lib/finance";
import { Card, GrowthRing, WhyItMatters, InfoTip, DisclosureSection, Field, InlinePill, NumberInput } from "../components/ui";
import { QuickImport } from "../components/SetupWizard";

export const DEBT_TYPE_LABELS = {
  loan: "Loan",
  card: "Credit card",
  "car-finance": "Car finance",
  overdraft: "Overdraft",
  other: "Other",
};


export function DebtCard({ debt, onEdit, onConfirm, onRemove, startEditing = false }) {
  const [editing, setEditing] = useState(false);
  const [draftBalance, setDraftBalance] = useState(debt.balance);
  const [detailsEditing, setDetailsEditing] = useState(startEditing);
  const estimatedToday = estimateBalanceToday(debt.balance, debt.rate, debt.payment, debt.lastConfirmedAt);
  const original = debt.originalBalance || debt.balance || 1;
  const progress = clamp(1 - estimatedToday / original, 0, 1);
  const days = daysSince(debt.lastConfirmedAt);
  const needsCheck = days >= 30;
  const changed = Math.abs(estimatedToday - debt.balance) > 1;
  const circumference = 2 * Math.PI * 30;
  const debtType = debt.debtType || "loan";

  const finishConfirm = () => {
    onConfirm(draftBalance);
    setEditing(false);
  };

  return (
    <Card className="wmg-debt-card">
      <div className="wmg-debt-card-top">
        <GrowthRing progress={progress} size={76} tone="brand">
          <div className="wmg-debt-ring-label">{Math.round(progress * 100)}%</div>
        </GrowthRing>
        <div className="wmg-debt-card-info">
          {detailsEditing ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input className="wmg-goal-name-input" value={debt.name} onChange={(e) => onEdit("name", e.target.value)} />
              <select
                className="wmg-select"
                style={{ fontSize: 11, padding: "4px 8px" }}
                value={debtType}
                onChange={(e) => onEdit("debtType", e.target.value)}
                aria-label="Debt type"
              >
                {Object.entries(DEBT_TYPE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="wmg-entry-title" style={{ fontSize: 15.5 }}>{debt.name}</span>
              <span className="wmg-tag" style={{ fontSize: 10.5 }}>{DEBT_TYPE_LABELS[debtType]}</span>
            </div>
          )}
          <div className="wmg-debt-card-balance">
            {editing ? (
              <>
                <NumberInput
                  className="wmg-input wmg-inline-input"
                  autoFocus
                  value={draftBalance}
                  onChange={setDraftBalance}
                  onKeyDown={(e) => e.key === "Enter" && finishConfirm()}
                />
                <button className="wmg-debt-card-edit" onClick={finishConfirm}>Save</button>
              </>
            ) : (
              <>
                <span className="wmg-debt-card-balance-val">{gbp(estimatedToday)}</span>
                <button
                  className="wmg-debt-card-edit"
                  onClick={() => {
                    setDraftBalance(Math.round(estimatedToday));
                    setEditing(true);
                  }}
                >
                  Edit
                </button>
              </>
            )}
          </div>
          <div className="wmg-sub">
            {changed ? "Estimated today \u2014 confirmed " : "Confirmed "}
            {gbp(debt.balance)} {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}
          </div>
        </div>
        <button type="button" className="wmg-entry-edit-btn" onClick={() => setDetailsEditing((e) => !e)} aria-label={detailsEditing ? "Done editing debt details" : "Edit debt details"}>
          {detailsEditing ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          )}
        </button>
        <button className="wmg-icon-btn" onClick={onRemove} aria-label="Remove">✕</button>
      </div>

      {detailsEditing ? (
        <div className="wmg-sentence-card" style={{ marginTop: 12 }}>
          Charging{" "}
          <InlinePill value={debt.rate} onChange={(v) => onEdit("rate", v)} step="0.1" formatter={(v) => `${v}%`} ariaLabel="Interest rate" />{" "}
          <InfoTip text="The interest rate this debt charges each year — sometimes called APR. You'll find it on your credit agreement, statement, or the provider's app." />{" "}
          interest, you pay{" "}
          <InlinePill value={debt.payment} onChange={(v) => onEdit("payment", v)} formatter={(v) => gbp(v)} ariaLabel="Monthly payment" />{" "}
          a month.
        </div>
      ) : (
        <div className="wmg-sub" style={{ marginTop: 8 }}>
          {debt.rate}% APR · {gbp(debt.payment)}/mo
        </div>
      )}

      {debtType === "car-finance" && (
        <div className="wmg-sub" style={{ marginTop: 8 }}>
          If this is PCP or HP finance with a final "balloon" payment due at the end of the agreement, add that
          amount to the balance above now — the payoff calculator assumes a normal reducing loan and won't account
          for a lump sum due later otherwise.
        </div>
      )}
      {debtType === "overdraft" && (
        <div className="wmg-sub" style={{ marginTop: 8 }}>
          Overdrafts usually don't have a fixed monthly repayment — it's fine to leave the payment at £0. Just know
          this debt won't get a "debt-free by" date until you set one.
        </div>
      )}

      {needsCheck && !editing && (
        <div className="wmg-debt-nudge">
          It's been {days} days since you confirmed this — still about {gbp(Math.round(estimatedToday))}?
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="wmg-onboard-next" style={{ padding: "8px 16px", fontSize: 12.5, flex: "none" }} onClick={() => onConfirm(estimatedToday)}>
              Yes, still about right
            </button>
            <button
              className="wmg-reset-btn"
              onClick={() => {
                setDraftBalance(Math.round(estimatedToday));
                setEditing(true);
              }}
            >
              It's changed
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}


export function DebtsTab({ profile, totals, setField, updateArrayItem, confirmBalance, confirmMortgageBalance, addArrayItem, addArrayItemWithId, removeArrayItem, allDebts, mortgageMonths, debtFreeMonths, selectedDebtId, setSelectedDebtId, extraPayment, setExtraPayment, extraCalc, addBulkItems }) {
  const [justAddedDebtId, setJustAddedDebtId] = useState(null);
  const handleAddDebt = (arrKey, blank) => () => {
    const id = nextId();
    addArrayItemWithId(arrKey, { id, ...blank })();
    setJustAddedDebtId(id);
  };
  const activeMode = getActiveMode(profile);
  const selectedDebt = allDebts.find((d) => d.id === selectedDebtId) || allDebts[0];
  const [celebration, setCelebration] = useState(null);
  const celebrationTimer = useRef(null);
  const [editingMortgage, setEditingMortgage] = useState(false);
  const [mortgageDraft, setMortgageDraft] = useState(profile.mortgage.balance);
  const mortgageDaysSince = daysSince(profile.mortgage.lastConfirmedAt);
  const mortgageChanged = Math.abs((totals?.mortgageBalanceToday ?? profile.mortgage.balance) - profile.mortgage.balance) > 1;

  const makeCelebratingChange = (arrKey, list) => (id, field, value) => {
    if (field === "balance" && Number(value) <= 0) {
      const debt = list.find((d) => d.id === id);
      if (debt && Number(debt.balance) > 0) {
        setCelebration(debt.name);
        if (celebrationTimer.current) window.clearTimeout(celebrationTimer.current);
        celebrationTimer.current = window.setTimeout(() => setCelebration(null), 5000);
      }
    }
    updateArrayItem(arrKey)(id, field, value);
  };

  return (
    <>
      {celebration && (
        <div className="wmg-celebration">
          <span className="wmg-celebration-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          {celebration} is paid off — one less thing to worry about.
        </div>
      )}
      {activeMode === "guided" && (
        <Card className="wmg-guided-summary-card">
          <p style={{ margin: 0 }}>
            {totals.totalDebt > 0 ? (
              <>
                You have <strong>{gbp(totals.totalDebt)}</strong> in total debt across your mortgage, loans, and
                cards. At your current pace, you're on track to be debt-free by{" "}
                <strong>{isFinite(debtFreeMonths) ? addMonths(debtFreeMonths) : "an unclear date — check the figures below"}</strong>.
              </>
            ) : (
              "You've got no debt currently added here — nice position to be in. Add anything you're paying off below if that changes."
            )}
          </p>
        </Card>
      )}
      <div className="wmg-section-title">Mortgage</div>
      <Card>
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
          <div className="wmg-three-col">
            <Field label="Interest rate (%)">
              <NumberInput className="wmg-input" step="0.1" value={profile.mortgage.rate} onChange={setField(["mortgage", "rate"])} />
            </Field>
            <Field label="Estimated home value">
              <NumberInput className="wmg-input" value={profile.homeValue} onChange={setField(["homeValue"])} />
            </Field>
            <Field label="Assumed annual house price growth (%)">
              <NumberInput className="wmg-input" step="0.1" value={profile.homeValueGrowth} onChange={setField(["homeValueGrowth"])} />
            </Field>
          </div>
          <div className="wmg-two-col" style={{ marginTop: 4 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--paper-dim)" }}>
              <input
                type="checkbox"
                checked={profile.mortgage.allowOverpayment}
                onChange={(e) => setField(["mortgage", "allowOverpayment"])(e.target.checked)}
              />
              Let the Cash Flow Forecast put spare surplus toward the mortgage too, not just loans and cards
            </label>
            {profile.mortgage.allowOverpayment && (
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
            )}
          </div>
        </DisclosureSection>
      </Card>

      <div className="wmg-section-title">Quick add</div>
      <QuickImport onAdd={addBulkItems} />

      <div className="wmg-section-title">Loans</div>
      {profile.loans.map((loan) => (
        <DebtCard
          key={loan.id}
          debt={loan}
          onEdit={(field, value) => updateArrayItem("loans")(loan.id, field, value)}
          onConfirm={(newBalance) => {
            if (Number(newBalance) <= 0 && Number(loan.balance) > 0) {
              setCelebration(loan.name);
              if (celebrationTimer.current) window.clearTimeout(celebrationTimer.current);
              celebrationTimer.current = window.setTimeout(() => setCelebration(null), 5000);
            }
            confirmBalance("loans")(loan.id, newBalance);
          }}
          onRemove={() => removeArrayItem("loans")(loan.id)}
          startEditing={loan.id === justAddedDebtId}
        />
      ))}
      <button
        className="wmg-add-btn"
        onClick={handleAddDebt("loans", { name: "New loan", balance: 0, rate: 0, payment: 0, originalBalance: 0, lastConfirmedAt: new Date().toISOString(), debtType: "loan" })}
      >
        + Add loan
      </button>
      <button
        className="wmg-add-btn"
        style={{ marginTop: 8 }}
        onClick={handleAddDebt("loans", { name: "Car finance", balance: 0, rate: 0, payment: 0, originalBalance: 0, lastConfirmedAt: new Date().toISOString(), debtType: "car-finance" })}
      >
        + Add car finance (PCP / HP)
      </button>

      <div className="wmg-section-title">Credit cards</div>
      {profile.cards.map((card) => (
        <DebtCard
          key={card.id}
          debt={card}
          onEdit={(field, value) => updateArrayItem("cards")(card.id, field, value)}
          onConfirm={(newBalance) => {
            if (Number(newBalance) <= 0 && Number(card.balance) > 0) {
              setCelebration(card.name);
              if (celebrationTimer.current) window.clearTimeout(celebrationTimer.current);
              celebrationTimer.current = window.setTimeout(() => setCelebration(null), 5000);
            }
            confirmBalance("cards")(card.id, newBalance);
          }}
          onRemove={() => removeArrayItem("cards")(card.id)}
          startEditing={card.id === justAddedDebtId}
        />
      ))}
      <button
        className="wmg-add-btn"
        onClick={handleAddDebt("cards", { name: "New card", balance: 0, rate: 0, payment: 0, originalBalance: 0, lastConfirmedAt: new Date().toISOString(), debtType: "card" })}
      >
        + Add credit card
      </button>
      <button
        className="wmg-add-btn"
        style={{ marginTop: 8 }}
        onClick={handleAddDebt("cards", { name: "Overdraft", balance: 0, rate: 0, payment: 0, originalBalance: 0, lastConfirmedAt: new Date().toISOString(), debtType: "overdraft" })}
      >
        + Add overdraft
      </button>

      <div className="wmg-section-title">Debt-free calculator</div>
      <WhyItMatters>
        Every pound of interest you pay is money that never becomes yours — it goes straight to the lender with
        nothing to show for it. Clearing higher-interest debt first, even with a small amount extra each month, often
        does more for your finances than any investment could, because you're guaranteed to "earn" whatever interest
        rate you stop paying.
      </WhyItMatters>
      <Card>
        <div className="wmg-eyebrow" style={{ marginBottom: 2 }}>Debt-free date, at current payments: <span className="wmg-mono" style={{ color: "var(--paper)" }}>{isFinite(debtFreeMonths) ? addMonths(debtFreeMonths) : "—"}</span></div>
        <div className="wmg-sub" style={{ marginBottom: 10 }}>Based on each debt's payment staying as it is now, with no extra money redirected between debts. See the Cash Flow Forecast for a date that assumes any spare income goes toward debt first.</div>
        <div className="wmg-two-col">
          <div>
            <label className="wmg-field-label">Target debt</label>
            <select className="wmg-select" value={selectedDebtId} onChange={(e) => setSelectedDebtId(Number(e.target.value))}>
              {allDebts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {gbp(d.balance)} at {d.rate}%
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="wmg-field-label">Extra payment / month</label>
            <div className="wmg-slider-row">
              <input type="range" min="0" max="500" step="10" value={extraPayment} className="wmg-slider" onChange={(e) => setExtraPayment(Number(e.target.value))} />
              <div className="wmg-slider-val">{gbp(extraPayment)}</div>
            </div>
          </div>
        </div>
        {extraCalc && selectedDebt && (
          <div className="wmg-calc-result">
            <div>
              <div className="wmg-calc-item-label">Interest saved</div>
              <div className="wmg-calc-item-val">{isFinite(extraCalc.interestSaved) ? gbp(Math.round(extraCalc.interestSaved)) : "—"}</div>
            </div>
            <div>
              <div className="wmg-calc-item-label">Cleared earlier by</div>
              <div className="wmg-calc-item-val">{isFinite(extraCalc.monthsSaved) ? `${Math.round(extraCalc.monthsSaved)} months` : "—"}</div>
            </div>
            <div>
              <div className="wmg-calc-item-label">New payoff date</div>
              <div className="wmg-calc-item-val" style={{ color: "var(--paper)" }}>{isFinite(extraCalc.newMonths) ? addMonths(extraCalc.newMonths) : "—"}</div>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}


