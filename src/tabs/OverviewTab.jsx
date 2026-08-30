import React, { useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { gbp, addMonths, getActiveMode } from "../lib/finance";
import { FLOW_TONE_COLORS } from "../lib/constants";
import { hasAccounts } from "../lib/storage";
import { Card, GrowthRing, useCountUp, CategoryTooltip, StatIcon } from "../components/ui";

export function OverviewTab({ score, gap, totals, profile, debtFreeMonths, mortgageMonths, flowSegments, flowTotal, coachTips, inFinancialHardship, onNavigate, hasConnectedBank, hasPremium, subscriptionStatus, onUpgrade, setField }) {
  const [scoreInfoOpen, setScoreInfoOpen] = useState(false);
  // Purely local "not now" — hides the banner for this session only.
  // Nothing is cleared in storage, so it reappears next time the app is
  // opened until the sync is actually reviewed or discarded in the
  // Import tab. Resets automatically if a newer sync replaces this one.
  const [pendingSyncDismissed, setPendingSyncDismissed] = useState(false);
  // Session-only, same reasoning as pendingSyncDismissed above — this
  // card is safety-relevant, so it's worth it reappearing next time the
  // app opens rather than being permanently gone after one dismissal.
  const [hardshipDismissed, setHardshipDismissed] = useState(false);
  const pendingBankSync = profile.pendingBankSync;
  const activeMode = getActiveMode(profile);
  const scoreTone = score >= 70 ? "sage" : score >= 45 ? "gold" : "rust";
  const animatedNetWorth = useCountUp(totals.netWorth);
  const animatedScore = useCountUp(score, 500);
  // Matches the top bar's "Available / mo" figure — fixed costs only
  // (essentials, debt, subscriptions), excluding variable lifestyle
  // spending. Deliberately different from totals.available, which is
  // still used elsewhere on this page (the "past comfortable" message,
  // the pie chart) since those need to reflect all spending.
  const animatedAvailable = useCountUp(totals.income - totals.essential - totals.debtPayments - totals.subsTotal);
  const animatedTotalDebt = useCountUp(totals.totalDebt);
  const animatedSavings = useCountUp(profile.savings.balance);
  const animatedHomeEquity = useCountUp(totals.homeEquity);
  const animatedPension = useCountUp(totals.pensionBalance);
  const animatedInvestments = useCountUp(profile.investments.balance);
  const animatedIncome = useCountUp(totals.income);
  const scoreExplainer =
    "Not just this month's cash flow — it's a blend of five things: how much you're saving each month (30%), how well-funded your emergency fund is (20%), how much debt you're carrying relative to your income (20%), your pension and investments relative to your income (15%), and how much of your home you actually own outright (15%). Being close to \"comfortable\" on cash flow alone doesn't lift the score much if debt or savings are still catching up.";

  const heroStats = [
    { label: "Income & Expenditure", value: `${gbp(Math.round(animatedAvailable))} left`, tone: "brand", tab: "income", icon: "wallet", gradient: true },
    { label: "Debt", value: gbp(Math.round(animatedTotalDebt)), tone: "coral", tab: "debts", icon: "debt", gradient: true },
    { label: "Savings", value: gbp(Math.round(animatedSavings)), tone: "sage", tab: "goals", icon: "savings", gradient: true },
    { label: "Debt-free", value: isFinite(debtFreeMonths) ? addMonths(debtFreeMonths) : "—", tone: "gold", tab: "debts", icon: "calendar", gradient: true },
    { label: "Mortgage-free", value: isFinite(mortgageMonths) ? addMonths(mortgageMonths) : "—", tone: "gold", tab: "debts", icon: "calendar", gradient: true },
    { label: "Home equity", value: gbp(Math.round(animatedHomeEquity)), tone: "slate", tab: "debts", icon: "home", gradient: true },
    { label: "Pension", value: gbp(Math.round(animatedPension)), tone: "rust", tab: "pension", icon: "pension", gradient: true },
    { label: "Investments", value: gbp(Math.round(animatedInvestments)), tone: "slate", tab: "goals", icon: "invest", gradient: true },
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

      {hasAccounts && pendingBankSync && !pendingSyncDismissed && (
        <Card className="wmg-connect-bank-banner">
          <div className="wmg-connect-bank-banner-text">
            <div className="wmg-connect-bank-banner-title">New spending synced from your bank</div>
            <div className="wmg-connect-bank-banner-sub">
              {pendingBankSync.transactionCount} transaction{pendingBankSync.transactionCount === 1 ? "" : "s"} since{" "}
              {pendingBankSync.fromDate}, ready to review — nothing's been added to your budget yet.
            </div>
          </div>
          <div className="wmg-chip-row" style={{ flexShrink: 0 }}>
            <button type="button" className="wmg-onboard-skip" onClick={() => setPendingSyncDismissed(true)}>
              Not now
            </button>
            <button type="button" className="wmg-btn-primary" onClick={() => onNavigate?.("import")}>
              Review
            </button>
          </div>
        </Card>
      )}

      {hasAccounts && !(pendingBankSync && !pendingSyncDismissed) && !profile.dismissedConnectBankBanner && (
        hasConnectedBank ? (
          <Card className="wmg-connect-bank-banner">
            <div className="wmg-connect-bank-banner-text">
              <div className="wmg-connect-bank-banner-title">Bank connected</div>
              <div className="wmg-connect-bank-banner-sub">
                Pull in fresh transactions any time, or check what's connected.
              </div>
            </div>
            <button type="button" className="wmg-btn-primary" onClick={() => onNavigate?.("import")}>
              View
            </button>
          </Card>
        ) : (
          <Card className="wmg-connect-bank-banner">
            <div className="wmg-connect-bank-banner-text">
              <div className="wmg-connect-bank-banner-title">Connect a bank</div>
              <div className="wmg-connect-bank-banner-sub">
                Link an account via Open Banking to pull in real balances automatically, instead of entering them by
                hand. Read-only — this can't move money.
              </div>
            </div>
            <button type="button" className="wmg-btn-primary" onClick={() => onNavigate?.("import")}>
              Connect
            </button>
            <button
              type="button"
              className="wmg-score-explainer-close"
              aria-label="Dismiss"
              onClick={() => setField?.(["dismissedConnectBankBanner"])(true)}
            >
              ×
            </button>
          </Card>
        )
      )}

      {!hasPremium && !profile.dismissedPremiumBanner && (
        <Card className="wmg-connect-bank-banner" style={{ background: "var(--brand-soft)", borderColor: "var(--brand)" }}>
          <div className="wmg-connect-bank-banner-text">
            <div className="wmg-connect-bank-banner-title">
              {subscriptionStatus === "canceled" || subscriptionStatus === "past_due" ? "Renew Premium" : "Go Premium"}
            </div>
            <div className="wmg-connect-bank-banner-sub">
              Share this household with a partner, get your pension read by AI, and unlock spending insights —
              monthly with a 14-day free trial, or annual for less overall. Cancel any time.
            </div>
          </div>
          <button type="button" className="wmg-btn-primary" onClick={onUpgrade}>
            {subscriptionStatus === "canceled" || subscriptionStatus === "past_due" ? "Renew" : "Choose a plan"}
          </button>
          <button
            type="button"
            className="wmg-score-explainer-close"
            aria-label="Dismiss"
            onClick={() => setField?.(["dismissedPremiumBanner"])(true)}
          >
            ×
          </button>
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

      {inFinancialHardship && !hardshipDismissed && (
        <>
          <div className="wmg-section-title">Some real help</div>
          <Card className="wmg-hardship-card">
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -8 }}>
              <button
                type="button"
                className="wmg-score-explainer-close"
                onClick={() => setHardshipDismissed(true)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
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
            className={`wmg-stat-tile wmg-stat-tile-clickable ${s.gradient ? `wmg-stat-tile-gradient tone-${s.tone}` : ""}`}
            key={s.label}
            onClick={() => onNavigate?.(s.tab)}
            aria-label={
              s.tab === "income"
                ? `${s.label}: ${s.value}`
                : `${s.label}: ${s.value}. Go to ${s.tab === "debts" ? "Debts & Mortgage" : s.tab === "goals" ? "Savings & Goals" : "Pension"}`
            }
          >
            {s.gradient ? (
              <span className="wmg-stat-tile-icon-badge" aria-hidden="true">
                <StatIcon name={s.icon} />
              </span>
            ) : (
              <span className={`wmg-stat-dot tone-${s.tone}`} aria-hidden="true" />
            )}
            <div className="wmg-stat-tile-label">{s.label}</div>
            <div className="wmg-stat-tile-val">{s.value}</div>
          </button>
        ))}
      </div>

      <div className="wmg-section-title">This month</div>
      <Card>
        <div className="wmg-flow-income-row">
          <div className="wmg-flow-income-label">Income</div>
          <div className="wmg-flow-income-val">{gbp(Math.round(animatedIncome))}</div>
        </div>
        <div className="wmg-category-chart-row">
          <div style={{ width: 140, height: 140, flexShrink: 0 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={flowSegments} dataKey="value" nameKey="label" innerRadius={42} outerRadius={68} paddingAngle={2} strokeWidth={0}>
                  {flowSegments.map((seg) => (
                    <Cell key={seg.key} fill={FLOW_TONE_COLORS[seg.tone] || "#8A7FC9"} />
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

