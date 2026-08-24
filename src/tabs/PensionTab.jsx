import React, { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { gbp, gbpApprox, getActiveMode, nextId } from "../lib/finance";
import { Card, WhyItMatters, DisclosureSection, Field, ChartTooltip, NumberInput } from "../components/ui";

export function PensionPotCard({ pot, canRemove, activeMode, updateArrayItem, removeArrayItem, startEditing = false }) {
  const [editing, setEditing] = useState(startEditing);
  return (
    <div className="wmg-life-event-card">
      <div className="wmg-life-event-row-top">
        {editing ? (
          <div>
            <div className="wmg-field-label">Name</div>
            <input
              className="wmg-input"
              value={pot.name}
              onChange={(e) => updateArrayItem("pensions")(pot.id, "name", e.target.value)}
            />
          </div>
        ) : (
          <span className="wmg-entry-title" style={{ fontSize: 15.5 }}>{pot.name}</span>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="wmg-entry-edit-btn" onClick={() => setEditing((e) => !e)} aria-label={editing ? "Done editing pension" : "Edit pension"}>
            {editing ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            )}
          </button>
          {canRemove && (
            <button className="wmg-icon-btn" onClick={() => removeArrayItem("pensions")(pot.id)} aria-label="Remove">
              ✕
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <>
          <div className="wmg-life-event-row-bottom">
            <div>
              <div className="wmg-field-label">Current pot value</div>
              <NumberInput
                className="wmg-input"
                value={pot.balance}
                onChange={(v) => updateArrayItem("pensions")(pot.id, "balance", v)}
              />
            </div>
            <div>
              <div className="wmg-field-label">Monthly contribution (you + employer)</div>
              <NumberInput
                className="wmg-input"
                value={pot.contribution}
                onChange={(v) => updateArrayItem("pensions")(pot.id, "contribution", v)}
              />
            </div>
          </div>
          <DisclosureSection label="Growth scenarios for this pot" defaultOpen={activeMode !== "guided"}>
            <div className="wmg-life-event-row-bottom">
              <div>
                <div className="wmg-field-label">Low growth (%/yr)</div>
                <NumberInput
                  className="wmg-input"
                  step="0.1"
                  value={pot.growthLow}
                  onChange={(v) => updateArrayItem("pensions")(pot.id, "growthLow", v)}
                />
              </div>
              <div>
                <div className="wmg-field-label">Medium growth (%/yr)</div>
                <NumberInput
                  className="wmg-input"
                  step="0.1"
                  value={pot.growthMedium}
                  onChange={(v) => updateArrayItem("pensions")(pot.id, "growthMedium", v)}
                />
              </div>
              <div>
                <div className="wmg-field-label">High growth (%/yr)</div>
                <NumberInput
                  className="wmg-input"
                  step="0.1"
                  value={pot.growthHigh}
                  onChange={(v) => updateArrayItem("pensions")(pot.id, "growthHigh", v)}
                />
              </div>
            </div>
          </DisclosureSection>
        </>
      ) : (
        <div className="wmg-sub" style={{ marginTop: 8 }}>
          {gbp(pot.balance)} pot · {gbp(pot.contribution)}/mo contribution
        </div>
      )}
    </div>
  );
}

export function PensionTab({ profile, setField, pensionScenarios, pensionYearsToRetire, totals, updateArrayItem, addArrayItem, addArrayItemWithId, removeArrayItem }) {
  const activeMode = getActiveMode(profile);
  const projectedAtRetirement = pensionScenarios?.series?.[pensionScenarios.series.length - 1];
  const pots = profile.pensions;
  const [justAddedId, setJustAddedId] = useState(null);
  const handleAddPot = () => {
    const id = nextId();
    addArrayItemWithId("pensions", { id, name: "New pension", balance: 0, contribution: 0, growthLow: 3, growthMedium: 5, growthHigh: 7 })();
    setJustAddedId(id);
  };

  return (
    <>
      <div className="wmg-section-title">Pension details</div>
      {activeMode === "guided" && projectedAtRetirement && (
        <Card className="wmg-guided-summary-card">
          <p style={{ margin: 0 }}>
            At your current pot{pots.length > 1 ? "s" : ""} and contributions, with a medium growth assumption, your
            pension{pots.length > 1 ? "s" : ""} could be worth around{" "}
            <strong>{gbpApprox(projectedAtRetirement.medium)}</strong> combined by the time you retire in{" "}
            <strong>{pensionYearsToRetire} years</strong>. That's a projection, not a guarantee — see the chart below
            for how it changes under slower or faster growth.
          </p>
        </Card>
      )}
      <WhyItMatters>
        Pensions get a head start almost nothing else does: tax relief tops up what you put in, your employer often
        matches some of it, and any growth compounds untouched for decades. Someone starting at 25 can end up with
        roughly double the pot of someone starting the same monthly amount at 35 — not because they saved more, but
        because their money had longer to grow. Whatever you can contribute now is worth more than the same amount
        contributed next year.
      </WhyItMatters>

      <Card style={{ marginBottom: 10 }}>
        <div className="wmg-sub">
          Add every pension you have — a current workplace pension, old pots from previous jobs, a personal pension.
          We grow each one separately, then combine them for the totals and chart below.
        </div>
      </Card>
      <Card>
        {pots.map((pot) => (
          <PensionPotCard
            key={pot.id}
            pot={pot}
            canRemove={pots.length > 1}
            activeMode={activeMode}
            updateArrayItem={updateArrayItem}
            removeArrayItem={removeArrayItem}
            startEditing={pot.id === justAddedId}
          />
        ))}
        <button className="wmg-add-btn" onClick={handleAddPot}>
          + Add pension pot
        </button>
      </Card>

      <div className="wmg-section-title">Retirement assumptions</div>
      <div className="wmg-section-desc">
        Current age comes from your setup and drawdown rate is fixed at the standard 4% — retirement age is the
        only one you can adjust here.
      </div>
      <Card>
        <div className="wmg-three-col">
          <div>
            <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Current age</div>
            <div className="wmg-figure tone-paper">{profile.pensionSettings.currentAge}</div>
          </div>
          <Field label="Target retirement age">
            <NumberInput className="wmg-input" value={profile.pensionSettings.retirementAge} onChange={setField(["pensionSettings", "retirementAge"])} />
          </Field>
          <div>
            <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Years to retirement</div>
            <div className="wmg-figure tone-paper">{pensionYearsToRetire}</div>
          </div>
        </div>
        <div>
          <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Drawdown rate at retirement</div>
          <div className="wmg-figure tone-paper">4%</div>
          <div className="wmg-sub" style={{ marginTop: 6 }}>
            Fixed at 4% — a standard, widely-used starting point for how much of your combined pots to take out
            each year once retired. Take out much more and there's a real risk of running out; take out less and
            it lasts longer but gives you less to live on.
          </div>
        </div>
      </Card>

      <div className="wmg-section-title">Combined pension total</div>
      <Card>
        <div className="wmg-sentence-card">
          Across {pots.length} pot{pots.length > 1 ? "s" : ""}, you currently have{" "}
          <strong>{gbp(totals.pensionBalance)}</strong>, with <strong>{gbp(totals.pensionContribution)}</strong>/month
          going in combined.
        </div>
      </Card>

      <div className="wmg-section-title">State Pension</div>
      <div className="wmg-section-desc">
        The full new State Pension is a standard, published rate — the same for everyone with a full National
        Insurance record. It's not something you enter, but gaps in your NI record can reduce it, so check your own
        forecast at gov.uk/check-state-pension if you're not sure.
      </div>
      <Card>
        <div className="wmg-three-col">
          <div>
            <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Weekly amount</div>
            <div className="wmg-figure tone-paper">{gbp(profile.statePension.weeklyAmount)}</div>
          </div>
          <div>
            <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Age you can claim it</div>
            <div className="wmg-figure tone-paper">{profile.statePension.claimAge}</div>
          </div>
          <div>
            <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Annual, in today's money</div>
            <div className="wmg-figure tone-paper">{gbp(profile.statePension.weeklyAmount * 52)}</div>
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--paper-dim)", marginTop: 4 }}>
          <input
            type="checkbox"
            checked={profile.statePension.included}
            onChange={(e) => setField(["statePension", "included"])(e.target.checked)}
          />
          Include the State Pension in retirement income estimates and the Cash Flow Forecast
        </label>
      </Card>

      <div className="wmg-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Projected pot at retirement
        <span className="wmg-tag assumed">Assumed</span>
      </div>
      <div className="wmg-section-desc">
        Same contributions, three growth assumptions — because nobody can promise you a return.
        {pots.length > 1 ? " Each pot grows under its own low/medium/high rates from the cards above; the figures below are all your pots combined." : ""}{" "}
        Figures are rounded, since a number built on a growth-rate guess shouldn't be shown down to the exact pound.
        Figures in brackets are in today's money, discounted at {profile.assumptions?.inflation ?? 2.5}%/yr inflation
        (set on the Cash Flow Forecast tab). Monthly income assumes a 25% tax-free lump sum on drawdown and estimates
        UK income tax on the rest, using today's tax bands — it's a floor, not a forecast, and ignores any other
        income you might have.
      </div>
      <div className="wmg-pension-cards">
        {[
          { key: "low", label: "Low growth", rate: pots.length === 1 ? pots[0].growthLow : null, tone: "rust" },
          { key: "medium", label: "Medium growth", rate: pots.length === 1 ? pots[0].growthMedium : null, tone: "gold" },
          { key: "high", label: "High growth", rate: pots.length === 1 ? pots[0].growthHigh : null, tone: "sage" },
        ].map((s) => (
          <Card key={s.key}>
            <div className="wmg-pension-scenario-name" style={{ color: `var(--${s.tone})` }}>{s.label}{s.rate != null ? ` · ${s.rate}%/yr` : ""}</div>
            <div className="wmg-pension-value">{gbpApprox(pensionScenarios.fv[s.key])}</div>
            <div className="wmg-sub" style={{ marginTop: -2, marginBottom: 8 }}>{gbpApprox(pensionScenarios.real[s.key])} in today's money</div>
            <div className="wmg-pension-income">
              {gbp(pensionScenarios.grossMonthlyIncome[s.key])}/month gross at a {profile.pensionSettings.drawdownRate}% drawdown rate
              <br />≈ {gbp(pensionScenarios.netMonthlyIncome[s.key])}/month after estimated tax, pension alone
            </div>
            {pensionScenarios.statePension.included && (
              <div className="wmg-pension-income" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--hair)" }}>
                {pensionScenarios.statePension.alreadyClaimingAtRetirement ? (
                  <>
                    + State Pension from age {pensionScenarios.statePension.claimAge}
                    <br />≈ <strong style={{ color: "var(--paper)" }}>{gbp(pensionScenarios.combinedNetMonthlyIncome[s.key])}/month</strong> combined, after tax
                  </>
                ) : (
                  <>
                    + State Pension adds ≈{gbp(pensionScenarios.statePension.monthlyToday)}/month from age{" "}
                    {pensionScenarios.statePension.claimAge} (after your {profile.pensionSettings.retirementAge} retirement age, so not
                    combined above)
                  </>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      <Card>
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={pensionScenarios.series} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--hair)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "var(--paper-dim)", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(y) => `Yr ${y}`} stroke="var(--hair)" />
              <YAxis tick={{ fill: "var(--paper-dim)", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(v) => `£${Math.round(v / 1000)}k`} stroke="var(--hair)" width={54} />
              <Legend
                wrapperStyle={{ fontSize: 12, fontFamily: "Inter" }}
                itemSorter={(item) => ["high", "medium", "low"].indexOf(item.dataKey)}
              />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="high" name="High" stroke="#4A7A3A" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="medium" name="Medium" stroke="#97701A" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="low" name="Low" stroke="#B2504F" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}


