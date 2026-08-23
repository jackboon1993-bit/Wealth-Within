import React, { useState } from "react";
import { gbp, addMonths, nextId } from "../lib/finance";
import { Card, GrowthRing, ProgressBar, WhyItMatters, InfoTip, InlinePill } from "../components/ui";

export function GoalCard({ goal: g, monthsAtPace, desired, requiredMonthly, extraNeeded, available, updateGoal, removeGoal, startEditing = false }) {
  const [editing, setEditing] = useState(startEditing);
  return (
    <Card className="wmg-goal-card">
      <div className="wmg-goal-head">
        {editing ? (
          <input className="wmg-goal-name-input" value={g.name} onChange={(e) => updateGoal(g.id, "name", e.target.value)} />
        ) : (
          <span className="wmg-entry-title" style={{ fontSize: 15.5 }}>{g.name}</span>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="wmg-entry-edit-btn" onClick={() => setEditing((e) => !e)} aria-label={editing ? "Done editing goal" : "Edit goal"}>
            {editing ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            )}
          </button>
          <button className="wmg-icon-btn" onClick={() => removeGoal(g.id)} aria-label="Remove goal">✕</button>
        </div>
      </div>
      <ProgressBar value={g.current} max={g.target} tone="gold" />
      {editing ? (
        <>
          <div className="wmg-sentence-card" style={{ marginTop: 10 }}>
            You've saved{" "}
            <InlinePill value={g.current} onChange={(v) => updateGoal(g.id, "current", v)} formatter={(v) => gbp(v)} ariaLabel="Saved so far" />{" "}
            of{" "}
            <InlinePill value={g.target} onChange={(v) => updateGoal(g.id, "target", v)} formatter={(v) => gbp(v)} ariaLabel="Target amount" />
            , adding{" "}
            <InlinePill value={g.monthlyContribution} onChange={(v) => updateGoal(g.id, "monthlyContribution", v)} formatter={(v) => gbp(v)} ariaLabel="Monthly contribution" />{" "}
            a month.
          </div>
          <div className="wmg-goal-plan">
            At that pace, you'll reach {gbp(g.target)} by{" "}
            <span className="wmg-goal-plan-highlight">{isFinite(monthsAtPace) ? addMonths(monthsAtPace) : "—"}</span>.
            <br />
            Or, choose a timeframe: reach it in{" "}
            <input
              className="wmg-input wmg-inline-input"
              type="number"
              value={g.desiredMonths ?? Math.max(1, Math.round(isFinite(monthsAtPace) ? monthsAtPace : 12))}
              onChange={(e) => updateGoal(g.id, "desiredMonths", Number(e.target.value))}
              style={{ display: "inline-block", margin: "0 6px" }}
            />{" "}
            months by saving <span className="wmg-goal-plan-highlight">{gbp(Math.max(0, requiredMonthly))}</span>/month.
          </div>
        </>
      ) : (
        <div className="wmg-sub" style={{ marginTop: 8 }}>
          {gbp(g.current)} of {gbp(g.target)} · {gbp(g.monthlyContribution)}/mo · on track for {isFinite(monthsAtPace) ? addMonths(monthsAtPace) : "—"}
        </div>
      )}
      {extraNeeded > 0.5 && (
        <div className="wmg-sub" style={{ marginTop: 8, color: extraNeeded <= available ? "var(--gold)" : "var(--rust)" }}>
          {extraNeeded <= available
            ? `That's ${gbp(extraNeeded)}/month more than you're putting in now — affordable given what's available.`
            : `That's ${gbp(extraNeeded)}/month more than you're putting in now — more than your ${gbp(available)}/month available, so this date may not be realistic on its own.`}
        </div>
      )}
    </Card>
  );
}

export function GoalsTab({ profile, totals, setField, updateGoal, addGoal, addGoalWithId, removeGoal }) {
  const [savingsEditing, setSavingsEditing] = useState(false);
  const [efEditing, setEfEditing] = useState(false);
  const [justAddedGoalId, setJustAddedGoalId] = useState(null);
  const handleAddGoal = () => {
    const id = nextId();
    addGoalWithId({ id, name: "New goal", target: 1000, current: 0, monthlyContribution: 50, desiredMonths: null })();
    setJustAddedGoalId(id);
  };
  // Feasibility check: purely arithmetic, no AI needed here — comparing what
  // each goal's chosen timeframe actually requires against real monthly
  // surplus (totals.available), not just showing the numbers in isolation.
  const goalPlans = profile.goals.map((g) => {
    const monthsAtPace = g.monthlyContribution > 0 ? Math.ceil((g.target - g.current) / g.monthlyContribution) : Infinity;
    const desired = g.desiredMonths && g.desiredMonths > 0 ? g.desiredMonths : Math.max(1, Math.round(isFinite(monthsAtPace) ? monthsAtPace : 12));
    const requiredMonthly = Math.max(0, (g.target - g.current) / desired);
    const extraNeeded = Math.max(0, requiredMonthly - g.monthlyContribution);
    return { goal: g, monthsAtPace, desired, requiredMonthly, extraNeeded };
  });
  const totalRequiredMonthly = goalPlans.reduce((s, p) => s + p.requiredMonthly, 0);
  const totalCurrentMonthly = profile.goals.reduce((s, g) => s + Number(g.monthlyContribution || 0), 0);
  const totalExtraNeeded = Math.max(0, totalRequiredMonthly - totalCurrentMonthly);
  const available = totals.available;

  return (
    <>
      <div className="wmg-section-title">Savings & investments</div>
      <Card>
        {savingsEditing ? (
          <>
            <div className="wmg-sentence-card">
              You currently have{" "}
              <InlinePill value={profile.savings.balance} onChange={(v) => setField(["savings", "balance"])(v)} formatter={(v) => gbp(v)} ariaLabel="Savings balance" />{" "}
              in general savings, and{" "}
              <InlinePill value={profile.investments.balance} onChange={(v) => setField(["investments", "balance"])(v)} formatter={(v) => gbp(v)} ariaLabel="Investments balance" />{" "}
              in investments (outside your pension) <InfoTip text="This is your ISA, general investment account, or other non-pension investments — pension balance is tracked separately on the Pension screen." />.
            </div>
            <div className="wmg-entry-edit-actions" style={{ marginTop: 10 }}>
              <button type="button" className="wmg-entry-done-btn" onClick={() => setSavingsEditing(false)}>Done</button>
            </div>
          </>
        ) : (
          <div className="wmg-entry-view">
            <div className="wmg-entry-view-text">
              <div className="wmg-entry-title">{gbp(profile.savings.balance)} savings · {gbp(profile.investments.balance)} investments</div>
            </div>
            <button type="button" className="wmg-entry-edit-btn" onClick={() => setSavingsEditing(true)} aria-label="Edit savings and investments">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          </div>
        )}
      </Card>

      <div className="wmg-section-title">Emergency fund</div>
      <WhyItMatters>
        Without a buffer, an unexpected bill or a lost month of income often gets paid for with high-interest
        debt — turning a one-off problem into an ongoing one. An emergency fund breaks that cycle. It's not about
        maximising returns; it's about not being forced into a bad financial decision the moment something goes
        wrong.
      </WhyItMatters>
      <Card>
        <div className="wmg-ef-ring-row">
          <GrowthRing progress={profile.emergencyFund.balance / Math.max(1, profile.emergencyFund.target)} size={132} tone="sage">
            <div className="wmg-ef-ring-val">{gbp(profile.emergencyFund.balance)}</div>
            <div className="wmg-ef-ring-label">of {gbp(profile.emergencyFund.target)}</div>
          </GrowthRing>
          <div className="wmg-ef-ring-side">
            <div className="wmg-ef-ring-side-label">Still to save</div>
            <div className="wmg-ef-ring-side-val">
              {gbp(Math.max(0, profile.emergencyFund.target - profile.emergencyFund.balance))}
            </div>
          </div>
        </div>
        {efEditing ? (
          <>
            <div className="wmg-sentence-card" style={{ marginTop: 14 }}>
              You've put aside{" "}
              <InlinePill value={profile.emergencyFund.balance} onChange={(v) => setField(["emergencyFund", "balance"])(v)} formatter={(v) => gbp(v)} ariaLabel="Emergency fund balance" />{" "}
              towards a{" "}
              <InlinePill value={profile.emergencyFund.target} onChange={(v) => setField(["emergencyFund", "target"])(v)} formatter={(v) => gbp(v)} ariaLabel="Emergency fund target" />{" "}
              target <InfoTip text="Aim for 3–6 months of essential spending — enough to cover a job loss or unexpected bill without reaching for a credit card." />.
            </div>
            <div className="wmg-entry-edit-actions" style={{ marginTop: 10 }}>
              <button type="button" className="wmg-entry-done-btn" onClick={() => setEfEditing(false)}>Done</button>
            </div>
          </>
        ) : (
          <button type="button" className="wmg-entry-edit-btn" style={{ marginTop: 12 }} onClick={() => setEfEditing(true)} aria-label="Edit emergency fund">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        )}
      </Card>

      <div className="wmg-section-title">Savings goals</div>
      <div className="wmg-section-desc">Set a target for anything you're saving towards, and see when you'll get there — or what it takes to hit a date you choose.</div>

      {profile.goals.length > 0 && (
        <Card style={{ marginBottom: 12 }}>
          <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>Are all your goals realistic together?</div>
          <div className="wmg-sub">
            Hitting the timeframes you've chosen across all goals needs{" "}
            <strong style={{ color: "var(--paper)" }}>{gbp(totalRequiredMonthly)}/month</strong> in total — you're
            currently putting in {gbp(totalCurrentMonthly)}/month, and you have{" "}
            <strong style={{ color: available >= 0 ? "var(--sage)" : "var(--rust)" }}>{gbp(available)}/month</strong> available.
          </div>
          <div className="wmg-sub" style={{ marginTop: 6, fontWeight: 700, color: totalExtraNeeded === 0 ? "var(--sage)" : totalExtraNeeded <= available ? "var(--gold)" : "var(--rust)" }}>
            {totalExtraNeeded === 0
              ? "You're on pace for every goal at its chosen date."
              : totalExtraNeeded <= available
              ? `You'd need to find an extra ${gbp(totalExtraNeeded)}/month — comfortably covered by what's available.`
              : `You'd need an extra ${gbp(totalExtraNeeded)}/month, but only ${gbp(available)} is available — these timeframes aren't realistic together without freeing up more, or pushing some dates back.`}
          </div>
        </Card>
      )}

      {goalPlans.map(({ goal: g, monthsAtPace, desired, requiredMonthly, extraNeeded }) => (
        <GoalCard
          key={g.id}
          goal={g}
          monthsAtPace={monthsAtPace}
          desired={desired}
          requiredMonthly={requiredMonthly}
          extraNeeded={extraNeeded}
          available={available}
          updateGoal={updateGoal}
          removeGoal={removeGoal}
          startEditing={g.id === justAddedGoalId}
        />
      ))}
      <button className="wmg-add-btn" onClick={handleAddGoal}>+ Add savings goal</button>
    </>
  );
}


