import React from "react";
import { gbp, addMonths } from "../lib/finance";
import { Card, GrowthRing, ProgressBar, WhyItMatters, InfoTip, InlinePill } from "../components/ui";

export function GoalsTab({ profile, totals, setField, updateGoal, addGoal, removeGoal }) {
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
        <div className="wmg-sentence-card">
          You currently have{" "}
          <InlinePill value={profile.savings.balance} onChange={(v) => setField(["savings", "balance"])(v)} formatter={(v) => gbp(v)} ariaLabel="Savings balance" />{" "}
          in general savings, and{" "}
          <InlinePill value={profile.investments.balance} onChange={(v) => setField(["investments", "balance"])(v)} formatter={(v) => gbp(v)} ariaLabel="Investments balance" />{" "}
          in investments (outside your pension) <InfoTip text="This is your ISA, general investment account, or other non-pension investments — pension balance is tracked separately on the Pension screen." />.
        </div>
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
        <div className="wmg-sentence-card" style={{ marginTop: 14 }}>
          You've put aside{" "}
          <InlinePill value={profile.emergencyFund.balance} onChange={(v) => setField(["emergencyFund", "balance"])(v)} formatter={(v) => gbp(v)} ariaLabel="Emergency fund balance" />{" "}
          towards a{" "}
          <InlinePill value={profile.emergencyFund.target} onChange={(v) => setField(["emergencyFund", "target"])(v)} formatter={(v) => gbp(v)} ariaLabel="Emergency fund target" />{" "}
          target <InfoTip text="Aim for 3–6 months of essential spending — enough to cover a job loss or unexpected bill without reaching for a credit card." />.
        </div>
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

      {goalPlans.map(({ goal: g, monthsAtPace, desired, requiredMonthly, extraNeeded }) => {
        return (
          <Card className="wmg-goal-card" key={g.id}>
            <div className="wmg-goal-head">
              <input className="wmg-goal-name-input" value={g.name} onChange={(e) => updateGoal(g.id, "name", e.target.value)} />
              <button className="wmg-icon-btn" onClick={() => removeGoal(g.id)} aria-label="Remove goal">✕</button>
            </div>
            <ProgressBar value={g.current} max={g.target} tone="gold" />
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
            {extraNeeded > 0.5 && (
              <div className="wmg-sub" style={{ marginTop: 8, color: extraNeeded <= available ? "var(--gold)" : "var(--rust)" }}>
                {extraNeeded <= available
                  ? `That's ${gbp(extraNeeded)}/month more than you're putting in now — affordable given what's available.`
                  : `That's ${gbp(extraNeeded)}/month more than you're putting in now — more than your ${gbp(available)}/month available, so this date may not be realistic on its own.`}
              </div>
            )}
          </Card>
        );
      })}
      <button className="wmg-add-btn" onClick={addGoal}>+ Add savings goal</button>
    </>
  );
}


