import React, { useState, useMemo } from "react";
import { LineChart, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { gbp, gbpApprox, addMonths, runForecast, getActiveMode } from "../lib/finance";
import { Card, Field, ChartTooltip, InfoTip, WhyItMatters, NumberInput } from "../components/ui";

export function ForecastTab({ horizonYears, setHorizonYears, allocationPct, setAllocationPct, forecast, interestSavedFromAllocation, totals, profile, setField, updateLifeEvent, addLifeEvent, removeLifeEvent, addScenario, updateScenario, removeScenario }) {
  const activeMode = getActiveMode(profile);
  const [realTerms, setRealTerms] = useState(false);
  const suffix = realTerms ? "Real" : "";
  const last = forecast.series[forecast.series.length - 1];
  const key = (base) => `${base}${suffix}`;

  const growthUncertainty = profile.assumptions?.growthUncertaintyPct ?? 2;
  const forecastLow = useMemo(
    () => runForecast(profile, totals, horizonYears, allocationPct, -growthUncertainty),
    [profile, totals, horizonYears, allocationPct, growthUncertainty]
  );
  const forecastHigh = useMemo(
    () => runForecast(profile, totals, horizonYears, allocationPct, growthUncertainty),
    [profile, totals, horizonYears, allocationPct, growthUncertainty]
  );
  const lastLow = forecastLow.series[forecastLow.series.length - 1];
  const lastHigh = forecastHigh.series[forecastHigh.series.length - 1];

  const chartData = forecast.series.map((row, i) => {
    const lo = forecastLow.series[i];
    const hi = forecastHigh.series[i];
    return {
      ...row,
      netWorthLow: lo ? lo.netWorth : row.netWorth,
      netWorthBand: lo && hi ? Math.max(0, hi.netWorth - lo.netWorth) : 0,
      netWorthLowReal: lo ? lo.netWorthReal : row.netWorthReal,
      netWorthBandReal: lo && hi ? Math.max(0, hi.netWorthReal - lo.netWorthReal) : 0,
    };
  });

  const SCENARIO_COLORS = ["#8A7FC9", "#B5652F", "#97701A", "#4A7A3A", "#B2504F", "#5C6BA3"];
  const scenarioForecasts = useMemo(
    () => profile.scenarios.map((s) => ({ ...s, result: runForecast(profile, totals, horizonYears, s.allocationPct, 0) })),
    [profile, totals, horizonYears]
  );
  const scenarioChartData = (scenarioForecasts[0]?.result.series || []).map((_, i) => {
    const point = { year: i + 1 };
    scenarioForecasts.forEach((s) => {
      const row = s.result.series[i];
      point[`s_${s.id}`] = row ? row[key("netWorth")] : null;
    });
    return point;
  });

  return (
    <>
      <div className="wmg-section-title">Cash flow forecast</div>
      <div className="wmg-section-desc">
        This takes everything you've entered elsewhere — your income, spending, debts, savings, and pension — and
        projects it forward in time, so you can see roughly where you'd end up rather than just where you stand
        today.
      </div>
      <WhyItMatters>
        Every month you have some money left over after essentials and debt payments — your "surplus." This
        forecast asks: what happens to your net worth over time if that surplus goes toward debt, toward savings,
        or some mix of both? Move the sliders below to see the difference. Nothing here changes your real numbers —
        it's a "what if," not a plan you're locked into.
      </WhyItMatters>

      {activeMode === "guided" && last && (
        <Card className="wmg-guided-summary-card">
          <p style={{ margin: 0 }}>
            At this pace — with your current surplus split between debt and savings, and pay-rise/inflation
            assumptions applied — your net worth could be around{" "}
            <strong>{gbpApprox(last.netWorth)}</strong> in <strong>{horizonYears} years</strong>. Adjust the horizon
            or the split below to see how that changes.
          </p>
        </Card>
      )}

      <Card>
        <div className="wmg-three-col">
          <div>
            <label className="wmg-field-label">
              Forecast horizon <InfoTip text="How many years ahead to project. Try a shorter horizon (2-5 years) for something that feels concrete, or a longer one to see the full picture toward retirement." />
            </label>
            <div className="wmg-slider-row">
              <input type="range" min="1" max="30" step="1" value={horizonYears} className="wmg-slider" onChange={(e) => setHorizonYears(Number(e.target.value))} />
              <div className="wmg-slider-val">{horizonYears} yrs</div>
            </div>
          </div>
          <div>
            <label className="wmg-field-label">
              Surplus to debt vs. saving <InfoTip text="Your leftover money each month, after bills and debt payments. 100% sends all of it toward your highest-interest debt first; 0% puts all of it into savings and investments instead. Try both ends to see the trade-off." />
            </label>
            <div className="wmg-slider-row">
              <input type="range" min="0" max="100" step="5" value={allocationPct} className="wmg-slider" onChange={(e) => setAllocationPct(Number(e.target.value))} />
              <div className="wmg-slider-val">{allocationPct}%</div>
            </div>
          </div>
          <div>
            <label className="wmg-field-label">View</label>
            <button
              className="wmg-edit-toggle"
              style={{ width: "100%" }}
              onClick={() => setRealTerms((v) => !v)}
            >
              {realTerms ? "Today's money" : "Actual (nominal) £"}
            </button>
          </div>
        </div>

        <div className="wmg-three-col" style={{ marginTop: 4 }}>
          <Field label="Assumed annual pay growth (%)">
            <NumberInput className="wmg-input" step="0.1" value={profile.assumptions.incomeGrowth} onChange={setField(["assumptions", "incomeGrowth"])} />
          </Field>
          <Field label="Assumed annual inflation (%)">
            <NumberInput className="wmg-input" step="0.1" value={profile.assumptions.inflation} onChange={setField(["assumptions", "inflation"])} />
          </Field>
          <Field
            label="Growth uncertainty (± percentage points)"
            hint="Controls the shaded band around the net worth line in the chart below — how far off your actual results might be from the growth rates you've set elsewhere, in either direction."
          >
            <NumberInput className="wmg-input" step="0.5" min="0" value={profile.assumptions.growthUncertaintyPct} onChange={setField(["assumptions", "growthUncertaintyPct"])} />
          </Field>
        </div>

        <div style={{ width: "100%", height: 320, marginTop: 10 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--hair)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "var(--paper-dim)", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(y) => `Yr ${y}`} stroke="var(--hair)" />
              <YAxis tick={{ fill: "var(--paper-dim)", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(v) => `£${Math.round(v / 1000)}k`} stroke="var(--hair)" width={54} />
              <Legend
                wrapperStyle={{ fontSize: 12, fontFamily: "Inter" }}
                itemSorter={(item) => [key("netWorthBand"), key("netWorth"), key("debt"), key("savingsInvest"), key("pension")].indexOf(item.dataKey)}
              />
              <Tooltip content={<ChartTooltip />} />
              {forecast.resolvedLifeEvents?.map((e) => (
                <ReferenceLine
                  key={e.id}
                  x={Math.round((e.month / 12) * 10) / 10}
                  stroke={e.type === "expense" ? "#B2504F" : "#4A7A3A"}
                  strokeDasharray="3 3"
                  label={{ value: e.name, position: "top", fontSize: 10, fill: e.type === "expense" ? "#B2504F" : "#4A7A3A" }}
                />
              ))}
              <Area type="monotone" dataKey={key("netWorthLow")} name="" stackId="band" stroke="none" fill="transparent" legendType="none" isAnimationActive={false} />
              <Area type="monotone" dataKey={key("netWorthBand")} name="Net worth range (low–high)" stackId="band" stroke="none" fill="#8A7FC9" fillOpacity={0.15} isAnimationActive={false} />
              <Line type="monotone" dataKey={key("netWorth")} name="Net worth" stroke="#8A7FC9" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey={key("debt")} name="Total debt (incl. mortgage)" stroke="#B2504F" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey={key("savingsInvest")} name="Savings & investments" stroke="#4A7A3A" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey={key("pension")} name="Pension" stroke="var(--paper-dim)" strokeWidth={2} dot={false} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="wmg-forecast-summary">
          <div>
            <div className="wmg-calc-item-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Net worth in {horizonYears} years{realTerms ? " (today's money)" : ""}
              <span className="wmg-tag assumed">Assumed</span>
            </div>
            <div className="wmg-calc-item-val" style={{ color: "var(--brand)" }}>{last ? gbpApprox(last[key("netWorth")]) : "—"}</div>
            {lastLow && lastHigh && (
              <div className="wmg-sub" style={{ marginTop: 2 }}>
                Likely range: {gbpApprox(lastLow[key("netWorth")])} – {gbpApprox(lastHigh[key("netWorth")])}
              </div>
            )}
          </div>
          <div>
            <div className="wmg-calc-item-label">Debt remaining then</div>
            <div className="wmg-calc-item-val" style={{ color: "var(--rust)" }}>{last ? gbp(last[key("debt")]) : "—"}</div>
          </div>
          <div>
            <div className="wmg-calc-item-label">Debt-free date</div>
            <div className="wmg-calc-item-val" style={{ color: "var(--paper)" }}>{forecast.debtFreeMonth !== null ? addMonths(forecast.debtFreeMonth) : `beyond ${horizonYears} yrs`}</div>
            <div className="wmg-sub" style={{ marginTop: 2 }}>Assumes spare income each month goes toward your highest-interest debt first — earlier than the fixed-payment date on the Debts & Mortgage tab.</div>
          </div>
          <div>
            <div className="wmg-calc-item-label">Mortgage-free date</div>
            <div className="wmg-calc-item-val" style={{ color: "var(--brand)" }}>{forecast.mortgageFreeMonth !== null ? addMonths(forecast.mortgageFreeMonth) : `beyond ${horizonYears} yrs`}</div>
          </div>
          {interestSavedFromAllocation !== null && interestSavedFromAllocation > 0 && (
            <div>
              <div className="wmg-calc-item-label">Sooner than saving it all</div>
              <div className="wmg-calc-item-val" style={{ color: "var(--sage)" }}>{Math.round(interestSavedFromAllocation)} months</div>
            </div>
          )}
          {profile.statePension?.included && forecast.statePensionStartMonth !== null && (
            <div>
              <div className="wmg-calc-item-label">State Pension joins the household income</div>
              <div className="wmg-calc-item-val" style={{ color: "var(--sage)" }}>{addMonths(forecast.statePensionStartMonth)}</div>
            </div>
          )}
        </div>

        {profile.statePension?.included && forecast.statePensionStartMonth === null && (
          <div className="wmg-forecast-note" style={{ marginTop: 0, marginBottom: -6 }}>
            State Pension isn't included in this chart yet — it starts at age {profile.statePension.claimAge}, which falls
            beyond this {horizonYears}-year horizon. Extend the horizon to see it join your income.
          </div>
        )}

        <div className="wmg-forecast-note">
          Income grows at {profile.assumptions.incomeGrowth}%/yr and essential + lifestyle spending inflate at{" "}
          {profile.assumptions.inflation}%/yr, compounding monthly. Extra surplus goes to whichever debt has the
          highest interest rate first —{" "}
          {profile.mortgage.allowOverpayment
            ? `including your mortgage, up to ${profile.mortgage.overpaymentCapPct}% of its balance per year (the usual penalty-free limit on UK mortgages) — set this in Debts & Mortgage.`
            : "your mortgage is excluded from this, and just pays its normal monthly amount — turn this on in Debts & Mortgage if you'd like it included."}{" "}
          Cash savings, investments and pension compound at the rates set in their own sections; house prices grow at
          the rate set in Debts &amp; Mortgage.{" "}
          {profile.statePension?.included
            ? `Your State Pension (£${profile.statePension.weeklyAmount}/week today) is added to household income from age ${profile.statePension.claimAge}, uprated with inflation.`
            : "Your State Pension isn't included — switch it on in Pension & Retirement."}{" "}
          Any life events below land as a lump sum into your cash savings in the year they happen, then grow (or reduce
          what you have) from there. The shaded band around the net worth line shows what happens if savings,
          investment and pension growth run {growthUncertainty} percentage points below or above what you've set —
          nobody can promise a return, so the line alone was always a bit more confident than reality. "Today's money"
          discounts every figure back to present-day purchasing power using the inflation rate above. Real life still
          has rate changes, job changes and surprises — treat this as a direction of travel, not a promise.
        </div>
      </Card>

      <div className="wmg-section-title">Compare scenarios</div>
      <div className="wmg-section-desc">
        Save a couple of different debt-vs-saving splits and see them plotted together, instead of overwriting the
        line every time you move the slider above.
      </div>
      <Card>
        {profile.scenarios.length > 0 && (
          <div style={{ width: "100%", height: 260, marginBottom: 16 }}>
            <ResponsiveContainer>
              <LineChart data={scenarioChartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--hair)" vertical={false} />
                <XAxis dataKey="year" tick={{ fill: "var(--paper-dim)", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(y) => `Yr ${y}`} stroke="var(--hair)" />
                <YAxis tick={{ fill: "var(--paper-dim)", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(v) => `£${Math.round(v / 1000)}k`} stroke="var(--hair)" width={54} />
                <Legend
                  wrapperStyle={{ fontSize: 12, fontFamily: "Inter" }}
                  itemSorter={(item) => scenarioForecasts.findIndex((s) => `s_${s.id}` === item.dataKey)}
                />
                <Tooltip content={<ChartTooltip />} />
                {scenarioForecasts.map((s, idx) => (
                  <Line
                    key={s.id}
                    type="monotone"
                    dataKey={`s_${s.id}`}
                    name={`${s.name} (${s.allocationPct}% to debt)`}
                    stroke={SCENARIO_COLORS[idx % SCENARIO_COLORS.length]}
                    strokeWidth={2.5}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {scenarioForecasts.map((s, idx) => {
          const finalRow = s.result.series[s.result.series.length - 1];
          return (
            <div className="wmg-life-event-card" key={s.id}>
              <div className="wmg-life-event-row-top">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="wmg-field-label">Name</div>
                  <input
                    className="wmg-input"
                    style={{ borderLeft: `3px solid ${SCENARIO_COLORS[idx % SCENARIO_COLORS.length]}` }}
                    value={s.name}
                    onChange={(e) => updateScenario(s.id, "name", e.target.value)}
                  />
                </div>
                <button className="wmg-icon-btn" onClick={() => removeScenario(s.id)} aria-label="Remove">
                  ✕
                </button>
              </div>
              <div className="wmg-life-event-row-bottom">
                <div>
                  <div className="wmg-field-label">% to debt</div>
                  <NumberInput
                    className="wmg-input"
                    min="0"
                    max="100"
                    value={s.allocationPct}
                    onChange={(v) => updateScenario(s.id, "allocationPct", v)}
                  />
                </div>
                <div>
                  <div className="wmg-field-label">Net worth then</div>
                  <div className="wmg-input" style={{ display: "flex", alignItems: "center", fontFamily: "Inter", fontWeight: 700 }}>
                    {finalRow ? gbp(finalRow[key("netWorth")]) : "—"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <button className="wmg-add-btn" onClick={() => addScenario(allocationPct)}>
          + Save current split ({allocationPct}% to debt) as a scenario
        </button>
      </Card>

      <div className="wmg-section-title">Life events</div>
      <div className="wmg-section-desc">
        One-off things that aren't part of your regular monthly numbers — a redundancy payout, an inheritance, a house
        move, a wedding, university fees. Add them here and the forecast above actually accounts for them landing in
        that year, marked on the chart.
      </div>
      <Card>
        {profile.lifeEvents.length === 0 && (
          <div className="wmg-sub" style={{ marginBottom: 12 }}>No life events added yet.</div>
        )}
        {profile.lifeEvents.map((e) => (
          <div className="wmg-life-event-card" key={e.id}>
            <div className="wmg-life-event-row-top">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="wmg-field-label">Name</div>
                <input
                  className="wmg-input"
                  value={e.name}
                  onChange={(ev) => updateLifeEvent(e.id, "name", ev.target.value)}
                />
              </div>
              <button className="wmg-icon-btn" onClick={() => removeLifeEvent(e.id)} aria-label="Remove">
                ✕
              </button>
            </div>
            <div className="wmg-life-event-row-bottom">
              <div>
                <div className="wmg-field-label">Type</div>
                <select
                  className="wmg-select"
                  value={e.type}
                  onChange={(ev) => updateLifeEvent(e.id, "type", ev.target.value)}
                >
                  <option value="expense">Expense</option>
                  <option value="income">Windfall</option>
                </select>
              </div>
              <div>
                <div className="wmg-field-label">Amount</div>
                <NumberInput
                  className="wmg-input"
                  value={e.amount}
                  onChange={(v) => updateLifeEvent(e.id, "amount", v)}
                />
              </div>
              <div>
                <div className="wmg-field-label">In (years)</div>
                <NumberInput
                  className="wmg-input"
                  step="0.5"
                  title="Years from now"
                  value={e.yearsFromNow}
                  onChange={(v) => updateLifeEvent(e.id, "yearsFromNow", v)}
                />
              </div>
            </div>
            {e.yearsFromNow > horizonYears && (
              <div className="wmg-forecast-note" style={{ marginTop: 8 }}>
                This falls beyond your current {horizonYears}-year forecast horizon, so it isn't shown on the chart
                above yet — extend the horizon to see its effect.
              </div>
            )}
          </div>
        ))}
        <button className="wmg-add-btn" onClick={addLifeEvent}>
          + Add life event
        </button>
      </Card>
    </>
  );
}

/* ============================== education content ============================== */


