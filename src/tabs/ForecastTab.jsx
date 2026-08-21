import React, { useState, useMemo } from "react";
import { LineChart, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { gbp, gbpApprox, addMonths, runForecast, getActiveMode } from "../lib/finance";
import { Card, Field, ChartTooltip } from "../components/ui";

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

  const SCENARIO_COLORS = ["#8B5CF6", "#FF9166", "#FFCE6B", "#4FD1C5", "#FF5C7A", "#A6A3D6"];
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
        Projects your net worth, debt, savings & investments, and pension forward from today, growing your income and
        spending with the pay-rise and inflation assumptions below. Choose how your monthly surplus is split between
        overpaying debt (highest interest first) and saving/investing the rest.
      </div>

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
            <label className="wmg-field-label">Forecast horizon</label>
            <div className="wmg-slider-row">
              <input type="range" min="1" max="30" step="1" value={horizonYears} className="wmg-slider" onChange={(e) => setHorizonYears(Number(e.target.value))} />
              <div className="wmg-slider-val">{horizonYears} yrs</div>
            </div>
          </div>
          <div>
            <label className="wmg-field-label">Surplus to debt vs. saving</label>
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
            <input className="wmg-input" type="number" step="0.1" value={profile.assumptions.incomeGrowth} onChange={(e) => setField(["assumptions", "incomeGrowth"])(Number(e.target.value))} />
          </Field>
          <Field label="Assumed annual inflation (%)">
            <input className="wmg-input" type="number" step="0.1" value={profile.assumptions.inflation} onChange={(e) => setField(["assumptions", "inflation"])(Number(e.target.value))} />
          </Field>
          <Field
            label="Growth uncertainty (± percentage points)"
            hint="Controls the shaded band around the net worth line in the chart below — how far off your actual results might be from the growth rates you've set elsewhere, in either direction."
          >
            <input className="wmg-input" type="number" step="0.5" min="0" value={profile.assumptions.growthUncertaintyPct} onChange={(e) => setField(["assumptions", "growthUncertaintyPct"])(Number(e.target.value))} />
          </Field>
        </div>

        <div style={{ width: "100%", height: 320, marginTop: 10 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#363068" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "#9C97C4", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(y) => `Yr ${y}`} stroke="#363068" />
              <YAxis tick={{ fill: "#9C97C4", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(v) => `£${Math.round(v / 1000)}k`} stroke="#363068" width={54} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Inter" }} />
              {forecast.resolvedLifeEvents?.map((e) => (
                <ReferenceLine
                  key={e.id}
                  x={Math.round((e.month / 12) * 10) / 10}
                  stroke={e.type === "expense" ? "#FF5C7A" : "#4FD1C5"}
                  strokeDasharray="3 3"
                  label={{ value: e.name, position: "top", fontSize: 10, fill: e.type === "expense" ? "#FF5C7A" : "#4FD1C5" }}
                />
              ))}
              <Area type="monotone" dataKey={key("netWorthLow")} stackId="band" stroke="none" fill="transparent" legendType="none" isAnimationActive={false} />
              <Area type="monotone" dataKey={key("netWorthBand")} name="Net worth range (low–high)" stackId="band" stroke="none" fill="#8B5CF6" fillOpacity={0.15} isAnimationActive={false} />
              <Line type="monotone" dataKey={key("netWorth")} name="Net worth" stroke="#8B5CF6" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey={key("debt")} name="Total debt (incl. mortgage)" stroke="#FF5C7A" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey={key("savingsInvest")} name="Savings & investments" stroke="#4FD1C5" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey={key("pension")} name="Pension" stroke="#9C97C4" strokeWidth={2} dot={false} strokeDasharray="4 3" />
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
                <CartesianGrid stroke="#363068" vertical={false} />
                <XAxis dataKey="year" tick={{ fill: "#9C97C4", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(y) => `Yr ${y}`} stroke="#363068" />
                <YAxis tick={{ fill: "#9C97C4", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(v) => `£${Math.round(v / 1000)}k`} stroke="#363068" width={54} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Inter" }} />
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

        {profile.scenarios.length > 0 && (
          <div className="wmg-array-row" style={{ marginBottom: 4 }}>
            <div style={{ flex: 2 }} className="wmg-field-label">Name</div>
            <div style={{ flex: 1 }} className="wmg-field-label">% to debt</div>
            <div style={{ flex: 2 }} className="wmg-field-label">Net worth then</div>
            <div style={{ width: 32 }} />
          </div>
        )}
        {scenarioForecasts.map((s, idx) => {
          const finalRow = s.result.series[s.result.series.length - 1];
          return (
            <div className="wmg-array-row" key={s.id}>
              <input
                className="wmg-input"
                style={{ flex: 2, borderLeft: `3px solid ${SCENARIO_COLORS[idx % SCENARIO_COLORS.length]}` }}
                value={s.name}
                onChange={(e) => updateScenario(s.id, "name", e.target.value)}
              />
              <input
                className="wmg-input"
                type="number"
                min="0"
                max="100"
                style={{ flex: 1 }}
                value={s.allocationPct}
                onChange={(e) => updateScenario(s.id, "allocationPct", Number(e.target.value))}
              />
              <div style={{ flex: 2, display: "flex", alignItems: "center", fontFamily: "Inter", fontWeight: 700, fontSize: 13 }}>
                {finalRow ? gbp(finalRow[key("netWorth")]) : "—"}
              </div>
              <button className="wmg-icon-btn" onClick={() => removeScenario(s.id)} aria-label="Remove">
                ✕
              </button>
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
        {profile.lifeEvents.length > 0 && (
          <div className="wmg-array-row" style={{ marginBottom: 4 }}>
            <div style={{ flex: 2 }} className="wmg-field-label">Name</div>
            <div style={{ flex: 1 }} className="wmg-field-label">Type</div>
            <div style={{ flex: 1 }} className="wmg-field-label">Amount</div>
            <div style={{ flex: 1 }} className="wmg-field-label">In (years)</div>
            <div style={{ width: 32 }} />
          </div>
        )}
        {profile.lifeEvents.map((e) => (
          <div className="wmg-array-row" key={e.id}>
            <input
              className="wmg-input"
              style={{ flex: 2 }}
              value={e.name}
              onChange={(ev) => updateLifeEvent(e.id, "name", ev.target.value)}
            />
            <select
              className="wmg-select"
              style={{ flex: 1 }}
              value={e.type}
              onChange={(ev) => updateLifeEvent(e.id, "type", ev.target.value)}
            >
              <option value="expense">Expense</option>
              <option value="income">Windfall</option>
            </select>
            <input
              className="wmg-input"
              type="number"
              style={{ flex: 1 }}
              value={e.amount}
              onChange={(ev) => updateLifeEvent(e.id, "amount", Number(ev.target.value))}
            />
            <input
              className="wmg-input"
              type="number"
              step="0.5"
              style={{ flex: 1 }}
              title="Years from now"
              value={e.yearsFromNow}
              onChange={(ev) => updateLifeEvent(e.id, "yearsFromNow", Number(ev.target.value))}
            />
            <button className="wmg-icon-btn" onClick={() => removeLifeEvent(e.id)} aria-label="Remove">
              ✕
            </button>
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


