import React, { useState, useEffect } from "react";
import { gbp, addMonths, nextId } from "../lib/finance";
import { Card, GrowthRing, ProgressBar, WhyItMatters, InfoTip, InlinePill, NumberInput, Reveal, Popout, Celebration } from "../components/ui";

export function GoalCard({ goal: g, monthsAtPace, desired, requiredMonthly, extraNeeded, available, updateGoal, removeGoal, startEditing = false, onViewProgress }) {
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
            <NumberInput
              className="wmg-input wmg-inline-input"
              value={g.desiredMonths ?? Math.max(1, Math.round(isFinite(monthsAtPace) ? monthsAtPace : 12))}
              onChange={(v) => updateGoal(g.id, "desiredMonths", v)}
              style={{ display: "inline-block", margin: "0 6px" }}
            />{" "}
            months by saving <span className="wmg-goal-plan-highlight">{gbp(Math.max(0, requiredMonthly))}</span>/month.
          </div>
        </>
      ) : (
        <>
          <div className="wmg-sub" style={{ marginTop: 8 }}>
            {gbp(g.current)} of {gbp(g.target)} · {gbp(g.monthlyContribution)}/mo · on track for {isFinite(monthsAtPace) ? addMonths(monthsAtPace) : "—"}
          </div>
          {onViewProgress && (
            <button type="button" className="wmg-onboard-skip" style={{ marginTop: 8 }} onClick={() => onViewProgress(g)}>
              View progress
            </button>
          )}
        </>
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
  // Goals created via the wizard below arrive fully filled in (name,
  // target, contribution all already answered), so — unlike other
  // "+ Add" flows in this app — a freshly-added goal doesn't need to
  // pop open in edit mode; it renders normally straight away.
  // The goal currently shown in the "View progress" popout — null when
  // closed. Doubles as the celebration popout when celebratingGoal is set
  // instead (see below), so only one of the two is ever open at once.
  const [progressGoalId, setProgressGoalId] = useState(null);
  // A goal that's just crossed 100% and hasn't been celebrated yet (see
  // the effect below) — separate from progressGoalId so a goal someone
  // taps into manually via "View progress" doesn't re-trigger the
  // celebration animation every time they look at it.
  const [celebratingGoal, setCelebratingGoal] = useState(null);
  // The guided "+ Add savings goal" flow — replaces silently creating a
  // generic "New goal, £1,000, £50/mo" for the person to rename after the
  // fact. 0 = wizard closed; 1/2/3 = which question is showing. Draft
  // answers live separately from the real goals list until the final
  // step, so cancelling partway through (closing the popout) leaves
  // nothing behind.
  const [goalWizardStep, setGoalWizardStep] = useState(0);
  const [goalDraft, setGoalDraft] = useState({ name: "", target: "", monthlyContribution: "" });
  const openGoalWizard = () => {
    setGoalDraft({ name: "", target: "", monthlyContribution: "" });
    setGoalWizardStep(1);
  };
  const finishGoalWizard = () => {
    const id = nextId();
    addGoalWithId({
      id,
      name: goalDraft.name.trim() || "Savings goal",
      target: Number(goalDraft.target) || 1000,
      current: 0,
      monthlyContribution: Number(goalDraft.monthlyContribution) || 0,
      desiredMonths: null,
    })();
    setGoalWizardStep(0);
  };

  // Detect any goal that's newly reached its target and hasn't had its
  // celebration shown yet (profile.celebratedGoals persists this across
  // sessions, so it only ever fires once per goal, not every time the
  // tab is revisited). Only pops one at a time even if several goals
  // complete in the same update — the celebration popout closing will
  // naturally reveal the next one on the following render, since this
  // effect re-runs whenever profile.goals or celebratedGoals changes.
  useEffect(() => {
    if (celebratingGoal) return;
    const celebrated = profile.celebratedGoals || [];
    const newlyDone = profile.goals.find((g) => g.current >= g.target && g.target > 0 && !celebrated.includes(g.id));
    if (newlyDone) {
      setCelebratingGoal(newlyDone);
      setField(["celebratedGoals"])([...celebrated, newlyDone.id]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.goals, profile.celebratedGoals]);
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
        <div className="wmg-ef-guidance-bar" style={{ background: "var(--brand-soft)", border: "1px solid var(--brand)", borderRadius: 12, padding: "10px 12px", marginBottom: 14, fontSize: 12.5, lineHeight: 1.5 }}>
          Most financial guidance suggests <strong>3–6 months of essential spending</strong> as an emergency fund —
          enough to cover a job loss or unexpected bill without reaching for a credit card. Your essential costs are
          currently <strong>{gbp(totals.essential)}/month</strong>, which puts that range at{" "}
          <strong>{gbp(totals.essential * 3)} – {gbp(totals.essential * 6)}</strong>.
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="wmg-onboard-skip" onClick={() => setField(["emergencyFund", "target"])(Math.round(totals.essential * 3))}>
              Set target to 3 months
            </button>
            <button type="button" className="wmg-onboard-skip" onClick={() => setField(["emergencyFund", "target"])(Math.round(totals.essential * 6))}>
              Set target to 6 months
            </button>
          </div>
        </div>
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

      {goalPlans.map(({ goal: g, monthsAtPace, desired, requiredMonthly, extraNeeded }, i) => (
        <Reveal key={g.id} delay={i * 60}>
          <GoalCard
            goal={g}
            monthsAtPace={monthsAtPace}
            desired={desired}
            requiredMonthly={requiredMonthly}
            extraNeeded={extraNeeded}
            available={available}
            updateGoal={updateGoal}
            removeGoal={removeGoal}
            startEditing={false}
            onViewProgress={(goal) => setProgressGoalId(goal.id)}
          />
        </Reveal>
      ))}
      <button className="wmg-add-btn" onClick={openGoalWizard}>+ Add savings goal</button>

      <Popout open={goalWizardStep > 0} onClose={() => setGoalWizardStep(0)} title="Add a savings goal">
        {goalWizardStep === 1 && (
          <>
            <div className="wmg-field-label">What are you saving for?</div>
            <div className="wmg-sub" style={{ marginBottom: 10 }}>A house deposit, a wedding, a new car — whatever it is.</div>
            <input
              className="wmg-input"
              type="text"
              autoFocus
              placeholder="e.g. New car"
              value={goalDraft.name}
              onChange={(e) => setGoalDraft((d) => ({ ...d, name: e.target.value }))}
            />
            <button
              type="button"
              className="wmg-btn-primary"
              style={{ width: "100%", marginTop: 14 }}
              disabled={!goalDraft.name.trim()}
              onClick={() => setGoalWizardStep(2)}
            >
              Continue
            </button>
          </>
        )}

        {goalWizardStep === 2 && (
          <>
            <div className="wmg-field-label">How much do you need?</div>
            <div className="wmg-sub" style={{ marginBottom: 10 }}>Your best estimate is fine — you can always change this later.</div>
            <NumberInput className="wmg-input" value={goalDraft.target} onChange={(v) => setGoalDraft((d) => ({ ...d, target: v }))} />
            <button
              type="button"
              className="wmg-btn-primary"
              style={{ width: "100%", marginTop: 14 }}
              disabled={!goalDraft.target || Number(goalDraft.target) <= 0}
              onClick={() => setGoalWizardStep(3)}
            >
              Continue
            </button>
            <button type="button" className="wmg-onboard-skip" style={{ marginTop: 8 }} onClick={() => setGoalWizardStep(1)}>
              Back
            </button>
          </>
        )}

        {goalWizardStep === 3 && (
          <>
            <div className="wmg-field-label">Putting away each month? (optional)</div>
            <div className="wmg-sub" style={{ marginBottom: 10 }}>
              Skip this if you're not sure yet — you can set or change it any time from the goal itself.
            </div>
            <NumberInput className="wmg-input" value={goalDraft.monthlyContribution} onChange={(v) => setGoalDraft((d) => ({ ...d, monthlyContribution: v }))} />
            <button type="button" className="wmg-btn-primary" style={{ width: "100%", marginTop: 14 }} onClick={finishGoalWizard}>
              Add goal
            </button>
            <button type="button" className="wmg-onboard-skip" style={{ marginTop: 8 }} onClick={() => setGoalWizardStep(2)}>
              Back
            </button>
          </>
        )}
      </Popout>

      {(() => {
        const progressGoal = profile.goals.find((g) => g.id === progressGoalId);
        if (!progressGoal) return null;
        const progress = Math.max(0, Math.min(1, progressGoal.current / Math.max(1, progressGoal.target)));
        const stillToSave = Math.max(0, progressGoal.target - progressGoal.current);
        return (
          <Popout open onClose={() => setProgressGoalId(null)} title={progressGoal.name}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
              <GrowthRing progress={progress} size={140} tone="gold">
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--paper)" }}>{Math.round(progress * 100)}%</div>
                <div className="wmg-sub" style={{ fontSize: 11 }}>{gbp(progressGoal.current)} of {gbp(progressGoal.target)}</div>
              </GrowthRing>
            </div>
            <div className="wmg-detail-row">
              <span className="wmg-detail-row-label">Still to save</span>
              <span className="wmg-detail-row-value">{gbp(stillToSave)}</span>
            </div>
            <div className="wmg-detail-row">
              <span className="wmg-detail-row-label">Putting away</span>
              <span className="wmg-detail-row-value">{gbp(progressGoal.monthlyContribution)}/mo</span>
            </div>
          </Popout>
        );
      })()}

      <Popout open={!!celebratingGoal} onClose={() => setCelebratingGoal(null)} title="">
        {celebratingGoal && (
          <Celebration
            title={`"${celebratingGoal.name}" reached!`}
            message={`You've saved the full ${gbp(celebratingGoal.target)} — nice work. You can raise the target or start a new goal any time.`}
            tone="gold"
          />
        )}
      </Popout>
    </>
  );
}


