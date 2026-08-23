import React, { useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { gbp, addMonths, getActiveMode } from "../lib/finance";
import { FLOW_TONE_COLORS } from "../lib/constants";
import { Card, GrowthRing, useCountUp, CategoryTooltip } from "../components/ui";

export function OverviewTab({ score, gap, totals, profile, debtFreeMonths, mortgageMonths, flowSegments, flowTotal, inFinancialHardship, onNavigate }) {
  const [scoreInfoOpen, setScoreInfoOpen] = useState(false);
  const activeMode = getActiveMode(profile);
  const scoreTone = score >= 70 ? "sage" : score >= 45 ? "gold" : "rust";
  const animatedNetWorth = useCountUp(totals.netWorth);
  const animatedScore = useCountUp(score, 500);
  const scoreExplainer =
    "Not just this month's cash flow — it's a blend of five things: how much you're saving each month (30%), how well-funded your emergency fund is (20%), how much debt you're carrying relative to your income (20%), your pension and investments relative to your income (15%), and how much of your home you actually own outright (15%). Being close to \"comfortable\" on cash flow alone doesn't lift the score much if debt or savings are still catching up.";

  const heroStats = [
    { label: "Income & Expenditure", value: `${gbp(totals.available)} left`, tone: "brand", tab: "income" },
    { label: "Debt", value: gbp(totals.totalDebt), tone: "coral", tab: "debts" },
    { label: "Savings", value: gbp(profile.savings.balance), tone: "sage", tab: "goals" },
    { label: "Debt-free", value: isFinite(debtFreeMonths) ? addMonths(debtFreeMonths) : "—", tone: "gold", tab: "debts" },
    { label: "Mortgage-free", value: isFinite(mortgageMonths) ? addMonths(mortgageMonths) : "—", tone: "gold", tab: "debts" },
    { label: "Home equity", value: gbp(totals.homeEquity), tone: "slate", tab: "debts" },
    { label: "Pension", value: gbp(totals.pensionBalance), tone: "slate", tab: "pension" },
    { label: "Investments", value: gbp(profile.investments.balance), tone: "slate", tab: "goals" },
  ];

  return (
    <>
      <div className="wmg-mosaic-hero">
        <div className="wmg-mosaic-hero-top">
          <div className="wmg-mosaic-hero-label">Net worth</div>
          <button type="button" className="wmg-mosaic-hero-score" onClick={() => setScoreInfoOpen((o) => !o)} aria-expanded={scoreInfoOpen}>
            <GrowthRing progress={score / 100} size={24} tone={scoreTone} />
            <span className="wmg-mosaic-hero-score-val">{Math.round(animatedScore)}</span>
          </button>
        </div>
        <div>
          <div className="wmg-mosaic-hero-val">{gbp(Math.round(animatedNetWorth))}</div>
          <div className="wmg-mosaic-hero-sub">
            {gap > 0 ? (
              <>{gbp(Math.round(gap))}/mo from "comfortable"</>
            ) : (
              <>{gbp(Math.round(-gap))}/mo past "comfortable"</>
            )}
          </div>
        </div>
      </div>

      {scoreInfoOpen && (
        <Card className="wmg-score-explainer-card">
          <div className="wmg-score-explainer-head">
            <span>How your score is worked out</span>
            <button type="button" className="wmg-score-explainer-close" onClick={() => setScoreInfoOpen(false)} aria-label="Close">×</button>
          </div>
          <p>{scoreExplainer}</p>
        </Card>
      )}

      {activeMode === "guided" && (
        <Card className="wmg-guided-summary-card">
          <p style={{ margin: 0 }}>
            After your regular income and spending, you have <strong>{gbp(Math.round(totals.available))}</strong> left
            each month.{" "}
            {totals.totalDebt > 0
              ? "You could use some of this to pay off debt faster, or build up your savings — the boxes below break down where you stand on each."
              : "You could use some of this to build up your savings or work toward a goal — the boxes below break down where you stand overall."}
          </p>
        </Card>
      )}

      {inFinancialHardship && (
        <>
          <div className="wmg-section-title">Some real help</div>
          <Card className="wmg-hardship-card">
            <p style={{ margin: "0 0 12px" }}>
              Right now your essential costs alone come to more than your income. That's a genuinely hard position
              to be in, and it's more common than it feels — you're not alone in this, and there's real, free help
              available today, not just app tips.
            </p>
            <div className="wmg-hardship-links">
              <a href="https://www.stepchange.org" target="_blank" rel="noopener">
                <strong>StepChange</strong> — free debt advice charity, online or by phone
              </a>
              <a href="https://www.nationaldebtline.org" target="_blank" rel="noopener">
                <strong>National Debtline</strong> — free, confidential debt advice
              </a>
              <a href="https://www.citizensadvice.org.uk" target="_blank" rel="noopener">
                <strong>Citizens Advice</strong> — free advice on debt and financial difficulty
              </a>
              <a href="https://www.moneyhelper.org.uk" target="_blank" rel="noopener">
                <strong>MoneyHelper</strong> — free, government-backed money guidance
              </a>
            </div>
            <p style={{ margin: "12px 0 0", fontSize: 11.5 }}>
              This app can't give you advice, and the numbers above shouldn't be the main thing on your mind right
              now — a real adviser can look at your whole situation and what actually helps, for free.
            </p>
          </Card>
        </>
      )}

      <div className="wmg-stat-grid">
        {heroStats.map((s) => (
          <button
            type="button"
            className="wmg-stat-tile wmg-stat-tile-clickable"
            key={s.label}
            onClick={() => onNavigate?.(s.tab)}
            aria-label={
              s.tab === "income"
                ? `${s.label}: ${s.value}`
                : `${s.label}: ${s.value}. Go to ${s.tab === "debts" ? "Debts & Mortgage" : s.tab === "goals" ? "Savings & Goals" : "Pension"}`
            }
          >
            <span className={`wmg-stat-dot tone-${s.tone}`} aria-hidden="true" />
            <div className="wmg-stat-tile-label">{s.label}</div>
            <div className="wmg-stat-tile-val">{s.value}</div>
          </button>
        ))}
      </div>

      <div className="wmg-section-title">This month</div>
      <Card>
        <div className="wmg-flow-income-row">
          <div className="wmg-flow-income-label">Income</div>
          <div className="wmg-flow-income-val">{gbp(totals.income)}</div>
        </div>
        <div className="wmg-category-chart-row">
          <div style={{ width: 140, height: 140, flexShrink: 0 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={flowSegments} dataKey="value" nameKey="label" innerRadius={42} outerRadius={68} paddingAngle={2} strokeWidth={0}>
                  {flowSegments.map((seg) => (
                    <Cell key={seg.key} fill={FLOW_TONE_COLORS[seg.tone] || "#8B5CF6"} />
                  ))}
                </Pie>
                <Tooltip content={<CategoryTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="wmg-flow-legend">
            {flowSegments.map((seg) => (
              <div className="wmg-flow-legend-item" key={seg.key}>
                <span className="wmg-swatch" style={{ background: `var(--${seg.tone}-fill)` }} />
                {seg.label} <span className="wmg-flow-legend-val">{gbp(seg.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}

/* Emma-inspired compact subscription row: icon + name + price at a glance,
   tap to expand for editing/cancel/remove controls. */

