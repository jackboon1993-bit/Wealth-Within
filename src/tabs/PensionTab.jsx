import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { gbp, gbpApprox, getActiveMode } from "../lib/finance";
import { Card, WhyItMatters, DisclosureSection, Field, ChartTooltip } from "../components/ui";

export function PensionTab({ profile, setField, pensionScenarios, pensionYearsToRetire }) {
  const activeMode = getActiveMode(profile);
  const projectedAtRetirement = pensionScenarios?.[pensionScenarios.length - 1];

  return (
    <>
      <div className="wmg-section-title">Pension details</div>
      {activeMode === "guided" && projectedAtRetirement && (
        <Card className="wmg-guided-summary-card">
          <p style={{ margin: 0 }}>
            At your current pot and contributions, with a medium growth assumption, your pension could be worth
            around <strong>{gbpApprox(projectedAtRetirement.medium)}</strong> by the time you retire in{" "}
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
      <Card>
        <div className="wmg-three-col">
          <Field label="Current pot value">
            <input className="wmg-input" type="number" value={profile.pension.balance} onChange={(e) => setField(["pension", "balance"])(Number(e.target.value))} />
          </Field>
          <Field label="Total monthly contribution (you + employer)">
            <input className="wmg-input" type="number" value={profile.pension.contribution} onChange={(e) => setField(["pension", "contribution"])(Number(e.target.value))} />
          </Field>
          <div>
            <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Years to retirement</div>
            <div className="wmg-figure tone-paper">{pensionYearsToRetire}</div>
          </div>
        </div>

        <DisclosureSection label="See more details" defaultOpen={activeMode !== "guided"}>
          <div className="wmg-three-col">
            <Field label="Current age">
              <input className="wmg-input" type="number" value={profile.pension.currentAge} onChange={(e) => setField(["pension", "currentAge"])(Number(e.target.value))} />
            </Field>
            <Field label="Target retirement age">
              <input className="wmg-input" type="number" value={profile.pension.retirementAge} onChange={(e) => setField(["pension", "retirementAge"])(Number(e.target.value))} />
            </Field>
            <Field
              label="Drawdown rate at retirement (%)"
              hint="How much of your pot you plan to take out each year once retired. 4% is a commonly used starting point — take out much more and there's a real risk of running out; take out less and it lasts longer but gives you less to live on."
            >
              <input className="wmg-input" type="number" step="0.1" value={profile.pension.drawdownRate} onChange={(e) => setField(["pension", "drawdownRate"])(Number(e.target.value))} />
            </Field>
          </div>
          <div className="wmg-three-col">
            <Field label="Low growth scenario (%/yr)">
              <input className="wmg-input" type="number" step="0.1" value={profile.pension.growthLow} onChange={(e) => setField(["pension", "growthLow"])(Number(e.target.value))} />
            </Field>
            <Field
              label="Medium growth scenario (%/yr)"
              hint="How much your pension investments might grow each year on average, after fees. Nobody can know this in advance — that's exactly why there's a low and high scenario alongside this one, rather than a single confident number."
            >
              <input className="wmg-input" type="number" step="0.1" value={profile.pension.growthMedium} onChange={(e) => setField(["pension", "growthMedium"])(Number(e.target.value))} />
            </Field>
            <Field label="High growth scenario (%/yr)">
              <input className="wmg-input" type="number" step="0.1" value={profile.pension.growthHigh} onChange={(e) => setField(["pension", "growthHigh"])(Number(e.target.value))} />
            </Field>
          </div>
        </DisclosureSection>
      </Card>

      <div className="wmg-section-title">State Pension</div>
      <div className="wmg-section-desc">
        The full new State Pension is around £221.20/week (2024/25) if you have a full National Insurance record —
        check your actual forecast at gov.uk/check-state-pension, since gaps in your NI record can reduce it.
      </div>
      <Card>
        <div className="wmg-three-col">
          <Field label="Weekly amount">
            <input className="wmg-input" type="number" step="0.01" value={profile.statePension.weeklyAmount} onChange={(e) => setField(["statePension", "weeklyAmount"])(Number(e.target.value))} />
          </Field>
          <Field label="Age you can claim it">
            <input className="wmg-input" type="number" value={profile.statePension.claimAge} onChange={(e) => setField(["statePension", "claimAge"])(Number(e.target.value))} />
          </Field>
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
        Same contributions, three growth assumptions — because nobody can promise you a return. Figures are rounded,
        since a number built on a growth-rate guess shouldn't be shown down to the exact pound. Figures in brackets are
        in today's money, discounted at {profile.assumptions?.inflation ?? 2.5}%/yr inflation (set on the Cash Flow
        Forecast tab). Monthly income assumes a 25% tax-free lump sum on drawdown and estimates UK income tax on the
        rest, using today's tax bands — it's a floor, not a forecast, and ignores any other income you might have.
      </div>
      <div className="wmg-pension-cards">
        {[
          { key: "low", label: "Low growth", rate: profile.pension.growthLow, tone: "rust" },
          { key: "medium", label: "Medium growth", rate: profile.pension.growthMedium, tone: "gold" },
          { key: "high", label: "High growth", rate: profile.pension.growthHigh, tone: "sage" },
        ].map((s) => (
          <Card key={s.key}>
            <div className="wmg-pension-scenario-name" style={{ color: `var(--${s.tone})` }}>{s.label} · {s.rate}%/yr</div>
            <div className="wmg-pension-value">{gbpApprox(pensionScenarios.fv[s.key])}</div>
            <div className="wmg-sub" style={{ marginTop: -2, marginBottom: 8 }}>{gbpApprox(pensionScenarios.real[s.key])} in today's money</div>
            <div className="wmg-pension-income">
              {gbp(pensionScenarios.grossMonthlyIncome[s.key])}/month gross at a {profile.pension.drawdownRate}% drawdown rate
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
                    {pensionScenarios.statePension.claimAge} (after your {profile.pension.retirementAge} retirement age, so not
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
              <CartesianGrid stroke="#363068" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "#9C97C4", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(y) => `Yr ${y}`} stroke="#363068" />
              <YAxis tick={{ fill: "#9C97C4", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(v) => `£${Math.round(v / 1000)}k`} stroke="#363068" width={54} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Inter" }} />
              <Line type="monotone" dataKey="high" name="High" stroke="#4FD1C5" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="medium" name="Medium" stroke="#FFCE6B" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="low" name="Low" stroke="#FF5C7A" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}


