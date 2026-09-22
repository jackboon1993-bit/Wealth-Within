import React, { useState } from "react";
import { gbp, gbpApprox, addMonths, getActiveMode, monthsToPayoff, totalInterestOwed } from "../lib/finance";
import { hasAccounts } from "../lib/storage";
import { Card, GrowthRing, useCountUp, StatIcon, Reveal, StreakBadge, Popout } from "../components/ui";

export function OverviewTab({ score, gap, totals, profile, debtFreeMonths, mortgageMonths, flowSegments, flowTotal, coachTips, inFinancialHardship, onNavigate, hasConnectedBank, hasPremium, subscriptionStatus, onUpgrade, setField, setupChecklistReady }) {
  const [scoreInfoOpen, setScoreInfoOpen] = useState(false);
  const [netWorthBreakdownOpen, setNetWorthBreakdownOpen] = useState(false);
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
  // "Complete setup — X/5" checklist (see finance.js's dismissedSetupChecklist
  // for the dismiss-vs-auto-hide reasoning). Each item's `done` reads real
  // profile/prop state already tracked elsewhere in the app — nothing new
  // to maintain here if any of those five things' own logic changes.
  const setupChecklistItems = [
    { id: "bank", label: "Connect a bank", done: hasConnectedBank, action: () => onNavigate?.("import"), icon: "wallet", tone: "brand" },
    { id: "mortgage", label: "Confirm mortgage details", done: !!profile.mortgageDetailsConfirmed, action: () => onNavigate?.("mortgage"), icon: "home", tone: "slate" },
    { id: "pension", label: "Confirm retirement assumptions", done: !!profile.pensionAssumptionsConfirmed, action: () => onNavigate?.("pension"), icon: "pension", tone: "rust" },
    { id: "lifeevent", label: "Add a life event", done: (profile.lifeEvents || []).length > 0, action: () => onNavigate?.("forecast"), icon: "flag", tone: "gold" },
    { id: "premium", label: "Go Premium", done: hasPremium, action: onUpgrade, icon: "sparkle", tone: "coral" },
  ];
  const incompleteSetupItems = setupChecklistItems.filter((i) => !i.done);
  const showSetupChecklist = setupChecklistReady && incompleteSetupItems.length > 0 && !profile.dismissedSetupChecklist;
  const scoreTone = score >= 70 ? "sage" : score >= 45 ? "gold" : "rust";
  const animatedNetWorth = useCountUp(totals.netWorth);
  const animatedScore = useCountUp(score, 500);
  const animatedTotalDebt = useCountUp(totals.totalDebt);
  const animatedSavings = useCountUp(profile.savings.balance);
  const animatedHomeEquity = useCountUp(totals.homeEquity);
  const animatedPension = useCountUp(totals.pensionBalance);
  const animatedInvestments = useCountUp(profile.investments.balance);
  const animatedIncome = useCountUp(totals.income);
  const scoreExplainer =
    "Not just this month's cash flow — it's a blend of five things: how much you're saving each month (30%), how well-funded your emergency fund is (20%), how much debt you're carrying relative to your income (20%), your pension and investments relative to your income (15%), and how much of your home you actually own outright (15%). Being close to \"comfortable\" on cash flow alone doesn't lift the score much if debt or savings are still catching up.";

  const heroStats = [
    // "Budget" removed — the new "Income & essential outgoings" list
    // below now has its own tappable "Bills" row routing to the same
    // place, so this no longer needs to be the only way there the way
    // it was earlier tonight. Without it, every remaining row here is
    // genuinely a net-worth component (a balance or an equity figure),
    // which is what let this box get reframed properly below rather
    // than staying a mixed bag of different kinds of number.
    { label: "Loans & credit cards", value: gbp(Math.round(animatedTotalDebt)), tone: "coral", tab: "loans", icon: "debt", gradient: true },
    { label: "Savings", value: gbp(Math.round(animatedSavings)), tone: "sage", tab: "savings", icon: "savings", gradient: true },
    // Debt-free and Mortgage-free payoff-date tiles were dropped from
    // here — they clustered with Debt/Home equity into four tiles all
    // orbiting the same two underlying facts, which read as cluttered.
    // Both dates are still fully visible on their own tabs, just not
    // repeated here. "Home equity" was briefly relabelled "Mortgage
    // equity" for clarity while these two tiles' icons/tones were still
    // being finalised, but with the home icon (this one) and debt icon
    // (Loans & credit cards) now clearly distinct, and each tile going
    // to a tab literally titled "Mortgage" / "Loans & Credit Cards", the
    // extra word wasn't earning its place — reverted to just "Mortgage"
    // so the tile name matches its destination tab exactly, same as
    // every other tile here. Loans & credit cards and Mortgage now each
    // land on their own fully separate, single-purpose tab ("loans" /
    // "mortgage") — see LoansAndCardsTab.jsx and MortgageTab.jsx.
    // There's no combined "show everything" view any more; each tile is
    // genuinely only about its own thing.
    { label: "Mortgage", value: gbp(Math.round(animatedHomeEquity)), tone: "slate", tab: "mortgage", icon: "home", gradient: true },
    { label: "Pension", value: gbp(Math.round(animatedPension)), tone: "rust", tab: "pension", icon: "pension", gradient: true },
    { label: "Investments", value: gbp(Math.round(animatedInvestments)), tone: "slate", tab: "investments", icon: "invest", gradient: true },
  ];

  // The one thing genuinely worth leading with, instead of six equally-
  // weighted tiles that never say what actually changed. Same logic as
  // findBiggestMover() in api/send-monthly-recap.js — biggest % swing
  // vs last month, matched by category name, using the same
  // profile.spendingSnapshots data the monthly recap email already
  // reads. Requires two real months of snapshot history and at least a
  // 15% swing to bother surfacing — a smaller move is just normal
  // month-to-month noise, not a headline.
  const spendingSnapshots = profile.spendingSnapshots || [];
  const thisMonthSnap = spendingSnapshots[spendingSnapshots.length - 1];
  const lastMonthSnap = spendingSnapshots.length >= 2 ? spendingSnapshots[spendingSnapshots.length - 2] : null;
  const biggestMover = (() => {
    if (!thisMonthSnap || !lastMonthSnap) return null;
    const lastByName = new Map((lastMonthSnap.categories || []).map((c) => [c.name, c.value]));
    let biggest = null;
    (thisMonthSnap.categories || []).forEach((c) => {
      const prev = lastByName.get(c.name);
      if (!prev || prev <= 0) return;
      const pctChange = ((c.value - prev) / prev) * 100;
      if (!biggest || Math.abs(pctChange) > Math.abs(biggest.pctChange)) {
        biggest = { name: c.name, value: c.value, prev, pctChange, diff: c.value - prev };
      }
    });
    if (!biggest || Math.abs(biggest.pctChange) < 15) return null;
    return biggest;
  })();

  return (
    <>
      <div className="wmg-mosaic-hero">
        <div className="wmg-mosaic-hero-top">
          <div className="wmg-mosaic-hero-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>Net worth</span>
            <StreakBadge streakCount={profile.streakCount} />
          </div>
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
          {/* Was a separate card full of tappable rows sitting on the
              page permanently — collapsed into a popout triggered from
              right here instead, since it's specifically about the Net
              Worth figure directly above it, not something that needs
              to always be visible. */}
          <button
            type="button"
            onClick={() => setNetWorthBreakdownOpen(true)}
            style={{
              marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6,
              background: "rgba(255,255,255,0.16)", border: "none", borderRadius: 999,
              padding: "7px 14px", color: "#FFFFFF", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            }}
          >
            See breakdown
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      <Popout open={netWorthBreakdownOpen} onClose={() => setNetWorthBreakdownOpen(false)} title="What makes up your net worth">
        {heroStats.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => {
              setNetWorthBreakdownOpen(false);
              onNavigate?.(s.tab);
            }}
            aria-label={`${s.label}: ${s.value}. Go to ${s.label}`}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "11px 0",
              borderBottom: i === heroStats.length - 1 ? "none" : "0.5px solid var(--hair)",
              background: "none", border: "none", borderTop: "none", borderLeft: "none", borderRight: "none",
              textAlign: "left", cursor: "pointer",
            }}
          >
            <span className={`wmg-showcase-icon tone-${s.tone}`} style={{ width: 26, height: 26, flexShrink: 0 }} aria-hidden="true">
              <StatIcon name={s.icon} />
            </span>
            <span style={{ flex: 1, fontSize: 13, color: "var(--paper)" }}>{s.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--paper)" }}>{s.value}</span>
          </button>
        ))}
      </Popout>

      {scoreInfoOpen && (
        <Card className="wmg-score-explainer-card">
          <div className="wmg-score-explainer-head">
            <span>How your score is worked out</span>
            <button type="button" className="wmg-score-explainer-close" onClick={() => setScoreInfoOpen(false)} aria-label="Close">×</button>
          </div>
          <p>{scoreExplainer}</p>
        </Card>
      )}

      {showSetupChecklist && (
        <Reveal>
          <Card className="wmg-connect-bank-banner" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <GrowthRing
                  progress={(setupChecklistItems.length - incompleteSetupItems.length) / setupChecklistItems.length}
                  size={32}
                  tone="sage"
                >
                  <div style={{ fontSize: 10, fontWeight: 500 }}>
                    {setupChecklistItems.length - incompleteSetupItems.length}/{setupChecklistItems.length}
                  </div>
                </GrowthRing>
                <div className="wmg-connect-bank-banner-title">Complete setup</div>
              </div>
              <button
                type="button"
                className="wmg-score-explainer-close"
                aria-label="Dismiss setup checklist"
                onClick={() => setField?.(["dismissedSetupChecklist"])(true)}
              >
                ×
              </button>
            </div>
            <div>
              {incompleteSetupItems.map((item, i) => (
                <Reveal key={item.id} delay={i * 60}>
                  <button type="button" className="wmg-checklist-item" onClick={item.action}>
                    <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <span
                        className={`wmg-showcase-icon tone-${item.tone}`}
                        style={{ width: 28, height: 28, flexShrink: 0 }}
                        aria-hidden="true"
                      >
                        <StatIcon name={item.icon} />
                      </span>
                      <span>{item.label}</span>
                    </span>
                    <span className="wmg-checklist-item-chevron" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </span>
                  </button>
                </Reveal>
              ))}
            </div>
          </Card>
        </Reveal>
      )}

      {hasAccounts && !(pendingBankSync && !pendingSyncDismissed) && !profile.dismissedConnectBankBanner && !hasConnectedBank && (
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

      {!profile.dismissedReaderBanner && (
        <Card className="wmg-connect-bank-banner" style={{ background: "var(--brand-soft)", borderColor: "var(--brand)" }}>
          <span className="wmg-showcase-icon tone-brand" style={{ flexShrink: 0 }} aria-hidden="true">
            <StatIcon name="document" />
          </span>
          <div className="wmg-connect-bank-banner-text">
            <div className="wmg-connect-bank-banner-title">Try AI Document Reader</div>
            <div className="wmg-connect-bank-banner-sub">
              Upload a pension statement, mortgage offer, or payslip and let AI pull out the numbers for you — no
              manual typing.
            </div>
          </div>
          <button type="button" className="wmg-btn-primary" onClick={() => onNavigate?.("pension-reader")}>
            Try it
          </button>
          <button
            type="button"
            className="wmg-score-explainer-close"
            aria-label="Dismiss"
            onClick={() => setField?.(["dismissedReaderBanner"])(true)}
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
              : "You could use some of this to build up your savings or work towards a goal — the boxes below break down where you stand overall."}
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

      {/* Was a flat 2-column grid of six equally-weighted tiles — see
          the conversation for the reasoning: it never told you
          anything beyond "here are six numbers", and it's a very
          common pattern (Monzo pots, Emma, etc.) rather than a
          distinctive one. Restructured into three tiers instead: what
          changed (biggestMover above, if there's a real one), the one
          figure that actually matters most day-to-day (Budget, in its
          own featured card), then everything else as a compact list —
          still one tap away, just not shouting at the same volume as
          the first two. */}
      {biggestMover && (
        <Reveal>
          <div
            style={{
              display: "flex", alignItems: "center", gap: 12,
              background: "var(--brand-soft)", border: "0.5px solid var(--brand)",
              borderRadius: 14, padding: "12px 14px", marginBottom: 14,
            }}
          >
            <span className="wmg-showcase-icon tone-brand" style={{ width: 30, height: 30, flexShrink: 0 }} aria-hidden="true">
              <StatIcon name="flag" />
            </span>
            <div style={{ fontSize: 12.5, color: "var(--paper)", lineHeight: 1.4 }}>
              <strong>{biggestMover.name}</strong> is {biggestMover.pctChange > 0 ? "up" : "down"}{" "}
              {Math.round(Math.abs(biggestMover.pctChange))}% since last month (
              {biggestMover.pctChange > 0 ? "+" : "−"}
              {gbp(Math.abs(biggestMover.diff))}).
            </div>
          </div>
        </Reveal>
      )}


      {/* Moved down from the very top of the page — same reasoning as
          the "All wired up" banner and the "Connect a bank" card
          above: this was competing for the very first thing anyone
          saw on opening the app. Still keeps its full Card treatment
          (unlike the small "bank synced" badge) since "Not now" vs.
          "Review" is a genuine choice, not just a status to glance at. */}
      {hasAccounts && pendingBankSync && !pendingSyncDismissed && (
        <Reveal>
          <Card className="wmg-connect-bank-banner" style={{ marginBottom: 16 }}>
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
        </Reveal>
      )}

      {/* Two new cards, directly under the net-worth tiles — on request.
          Was keyed off profile.billsConfirmed, the flag the OLD guided
          bills flow inside Budget used to set — but the new, separate
          Household Bills page (built since) never touches that flag at
          all, so this kept showing "add my bills" forever even once
          real bills had genuinely been entered there. Now checks the
          actual essential-category total instead — the real number the
          new page writes into — so this disappears the moment real
          money has actually been entered, regardless of that now
          orphaned flag. Before that's true, ask for it right here,
          since it's exactly what makes the spare-money figure below
          trustworthy; once it's true, show what that spare money could
          actually do, immediately, rather than making someone tap
          through to find out. */}
      {totals.essentialCatTotal <= 0 ? (
        <Reveal delay={30}>
          <Card style={{ marginBottom: 16 }}>
            <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>One more thing that'd help</div>
            <div className="wmg-sub" style={{ marginBottom: 12 }}>
              Add your actual utility bills — electricity, gas, water and the like — and we can tell you exactly how
              much you have spare each month, and what that spare money could actually do for you.
            </div>
            <button type="button" className="wmg-btn-primary" onClick={() => onNavigate?.("household-bills")}>
              Add my bills
            </button>
          </Card>
        </Reveal>
      ) : (
        (() => {
          const spare = Math.max(0, totals.available);
          if (spare <= 0) return null;

          const balance = totals?.mortgageBalanceToday ?? profile.mortgage.balance;
          const rate = profile.mortgage.rate;
          const payment = profile.mortgage.payment;
          const hasMortgage = balance > 0 && payment > 0 && rate > 0;

          let monthsSaved = 0;
          let interestSaved = 0;
          if (hasMortgage) {
            const baselineMonths = monthsToPayoff(balance, rate, payment);
            const baselineInterest = totalInterestOwed(balance, rate, payment, baselineMonths);
            const withExtraMonths = monthsToPayoff(balance, rate, payment + spare);
            const withExtraInterest = totalInterestOwed(balance, rate, payment + spare, withExtraMonths);
            monthsSaved = Math.round(baselineMonths - withExtraMonths);
            interestSaved = Math.max(0, baselineInterest - withExtraInterest);
          }

          // Now genuinely compound when a rate is actually set — this
          // is a future-value-of-an-annuity calculation (regular monthly
          // contributions, each compounding for the months remaining),
          // not the existing balance growing; the existing balance would
          // grow (or not) regardless of this decision, so it's kept out
          // of this specific comparison on purpose. Falls back to the
          // honest principal-only figure when no rate has been set —
          // SavingsTab.jsx now has a real interestRate field to fill in,
          // but until someone actually does, this stays truthful rather
          // than assuming a rate nobody's confirmed.
          const months = 60; // 5 years, same illustrative horizon as before
          const annualRate = Number(profile.savings.interestRate || 0);
          const monthlyRate = annualRate / 100 / 12;
          const savingsAfterFiveYears =
            monthlyRate > 0 ? spare * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) : spare * months;
          const savingsInterestEarned = Math.max(0, savingsAfterFiveYears - spare * months);

          return (
            <Reveal delay={30}>
              <Card style={{ marginBottom: 16 }}>
                <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>What your spare money could do</div>
                <div className="wmg-sub" style={{ marginBottom: 14 }}>
                  After everything essential, you have{" "}
                  <strong style={{ color: "var(--paper)" }}>{gbp(spare)}/month</strong> spare.
                </div>
                {hasMortgage && monthsSaved > 0 && (
                  <div className="wmg-sub" style={{ marginBottom: 10 }}>
                    Put it all toward your mortgage, and you'd be mortgage-free{" "}
                    <strong style={{ color: "var(--sage)" }}>{monthsSaved} month{monthsSaved === 1 ? "" : "s"} sooner</strong>, saving{" "}
                    <strong style={{ color: "var(--sage)" }}>{gbpApprox(interestSaved)}</strong> in interest.
                  </div>
                )}
                <div className="wmg-sub" style={{ marginBottom: 14 }}>
                  Or put it all into savings instead, and you'd have{" "}
                  <strong style={{ color: "var(--paper)" }}>{gbp(savingsAfterFiveYears)}</strong> saved after 5 years
                  {monthlyRate > 0 ? (
                    <>
                      {" "}— {gbp(savingsInterestEarned)} of that is interest, at {profile.savings.interestRate}%/year.
                    </>
                  ) : (
                    <>
                      {" "}— before any interest, since there's no savings rate set yet.{" "}
                      <button
                        type="button"
                        className="wmg-onboard-skip"
                        style={{ display: "inline", padding: 0, fontSize: "inherit" }}
                        onClick={() => onNavigate?.("savings")}
                      >
                        Add your rate
                      </button>{" "}
                      for a real projection.
                    </>
                  )}
                </div>
                <button type="button" className="wmg-onboard-skip" onClick={() => onNavigate?.("mortgage-overpayment")}>
                  Explore the mortgage overpayment calculator
                </button>
              </Card>
            </Reveal>
          );
        })()
      )}

      {/* Was a donut chart + legend — replaced with a plain sorted list
          on request: mortgage gets its own line (previously bundled
          into "Essential" for the pie), and savings now appears too,
          using the real monthly figure already tracked per savings
          goal (profile.goals[].monthlyContribution) rather than the
          account balance. Sorted by size, matching the stated
          preference for lists over pie charts throughout tonight — the
          biggest outflow sits at the top, "Left over" always last
          since it's what remains, not a competing outflow. */}
      <div className="wmg-section-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 7, background: "var(--brand-soft)", fontSize: 12 }}>
          💷
        </span>
        Income &amp; essential outgoings
        {/* Was a full-width "All wired up" banner sitting right at the
            top of the page, the very first thing anyone saw on opening
            the app — on request, replaced with something small enough
            to just be a passing detail, tucked next to the section it
            actually relates to, rather than announcing itself first. */}
        {hasConnectedBank && (
          <button
            type="button"
            onClick={() => onNavigate?.("import")}
            style={{
              background: "var(--sage-soft)", border: "none", borderRadius: 999,
              padding: "3px 9px", fontSize: 10.5, fontWeight: 700, color: "var(--sage)", cursor: "pointer",
            }}
          >
            🔗 bank synced
          </button>
        )}
      </div>
      <Card style={{ marginBottom: 16 }}>
        <div className="wmg-flow-income-row">
          <div className="wmg-flow-income-label">Income</div>
          <div className="wmg-flow-income-val">{gbp(Math.round(animatedIncome))}</div>
        </div>
        {(() => {
          const savingsMonthly = (profile.goals || []).reduce((s, g) => s + Number(g.monthlyContribution || 0), 0);
          const investmentsMonthly = Number(profile.investments.monthlyContribution || 0);
          const mortgagePayment = Number(profile.mortgage.payment || 0);
          const billsOnly = totals.essentialCatTotal;
          const leftOver = Math.max(
            0,
            totals.income - mortgagePayment - billsOnly - totals.debtPayments - totals.pensionContribution - savingsMonthly - investmentsMonthly
          );

          const rows = [
            { label: "Mortgage", value: mortgagePayment, tone: "slate", tab: "mortgage" },
            // Now its own genuinely separate page — the previous
            // "navigate to Budget and force billsConfirmed false"
            // approach still left this buried inside a much longer
            // tab. household-bills is a small, single-purpose page
            // with nothing else on it.
            { label: "Bills", value: billsOnly, tone: "gold", tab: "household-bills" },
            { label: "Debt repayments", value: totals.debtPayments, tone: "rust", tab: "loans" },
            { label: "Pension", value: totals.pensionContribution, tone: "coral", tab: "pension" },
            { label: "Savings", value: savingsMonthly, tone: "sage", tab: "savings" },
            { label: "Investments", value: investmentsMonthly, tone: "brand", tab: "investments" },
          ]
            .filter((r) => r.value > 0)
            .sort((a, b) => b.value - a.value);
          rows.push({ label: "Left over", value: leftOver, tone: "paper", tab: null });

          // A quick, exciting teaser under "Left over" specifically —
          // reusing the exact same mortgage-overpayment maths as the
          // full "What your spare money could do" card further down,
          // rather than a second, separately-tuned calculation. Kept
          // deliberately to one line here; the full comparison (plus
          // the savings alternative) still lives in that card below —
          // this is what makes someone want to scroll down and look,
          // not a replacement for it.
          let leftOverTeaser = null;
          if (leftOver > 0) {
            const mortBalance = totals?.mortgageBalanceToday ?? profile.mortgage.balance;
            const mortRate = profile.mortgage.rate;
            if (mortBalance > 0 && mortgagePayment > 0 && mortRate > 0) {
              const baselineMonths = monthsToPayoff(mortBalance, mortRate, mortgagePayment);
              const withExtraMonths = monthsToPayoff(mortBalance, mortRate, mortgagePayment + leftOver);
              const saved = Math.round(baselineMonths - withExtraMonths);
              if (saved > 0) {
                leftOverTeaser = `Put it all toward your mortgage, and you'd be mortgage-free ${saved} month${saved === 1 ? "" : "s"} sooner.`;
              }
            }
            if (!leftOverTeaser) {
              leftOverTeaser = `Even putting a little of this into savings each month adds up faster than you'd think.`;
            }
          }

          return (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 2 }}>
              {rows.map((r) =>
                r.tab ? (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => onNavigate?.(r.tab)}
                    aria-label={`${r.label}: ${gbp(r.value)}. Go to ${r.label}`}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "9px 0",
                      borderBottom: "0.5px solid var(--hair)",
                      background: "none", border: "none", borderTop: "none", borderLeft: "none", borderRight: "none",
                      width: "100%", textAlign: "left", cursor: "pointer",
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: `var(--${r.tone})` }} />
                    <span style={{ flex: 1, fontSize: 13, color: "var(--paper)", fontWeight: 500 }}>{r.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--paper)" }}>{gbp(r.value)}</span>
                  </button>
                ) : (
                  <div key={r.label} style={{ padding: "9px 0 4px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: "var(--brand)" }} />
                      <span style={{ flex: 1, fontSize: 13, color: "var(--paper)", fontWeight: 700 }}>{r.label}</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: "var(--brand)" }}>{gbp(r.value)}</span>
                    </div>
                    {leftOverTeaser && (
                      <div style={{ marginTop: 6, marginLeft: 18, fontSize: 12, color: "var(--sage)", fontWeight: 600 }}>
                        ✨ {leftOverTeaser}
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          );
        })()}
      </Card>
    </>
  );
}

/* Emma-inspired compact subscription row: icon + name + price at a glance,
   tap to expand for editing/cancel/remove controls. */

