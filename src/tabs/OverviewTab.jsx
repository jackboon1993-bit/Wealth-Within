import React, { useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { gbp, gbpApprox, addMonths, getActiveMode, monthsToPayoff, totalInterestOwed } from "../lib/finance";
import { hasAccounts } from "../lib/storage";
import { Card, GrowthRing, useCountUp, StatIcon, Reveal, StreakBadge, Popout, CategoryTooltip, NumberInput } from "../components/ui";

export function OverviewTab({ score, gap, totals, profile, debtFreeMonths, mortgageMonths, flowSegments, flowTotal, coachTips, inFinancialHardship, onNavigate, hasConnectedBank, hasPremium, subscriptionStatus, onUpgrade, setField, setupChecklistReady }) {
  const [scoreInfoOpen, setScoreInfoOpen] = useState(false);
  const [netWorthBreakdownOpen, setNetWorthBreakdownOpen] = useState(false);
  const [leftOverPopoutOpen, setLeftOverPopoutOpen] = useState(false);
  // Drives the "what if I only put some of it away" choice inside the
  // spare-money popout — a preset percentage, or "custom" to reveal a
  // free-entry amount instead. Reset each time the popout is reopened
  // (below) rather than persisted, since it's a quick what-if, not a
  // setting.
  const [leftOverPct, setLeftOverPct] = useState(100);
  const [leftOverCustom, setLeftOverCustom] = useState("");
  const [paydayInput, setPaydayInput] = useState("");
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
      <div className="wmg-mosaic-hero" style={{ background: "linear-gradient(135deg, var(--brand-deep), var(--brand))" }}>
        <div className="wmg-mosaic-hero-top">
          <div className="wmg-mosaic-hero-label">Net worth</div>
          {/* Streak moved up here, small — was sharing a row with the
              score button lower down, which (along with the "past
              comfortable" line below) made this feel crowded. */}
          <StreakBadge streakCount={profile.streakCount} />
        </div>
        <div>
          <div className="wmg-mosaic-hero-val">{gbp(Math.round(animatedNetWorth))}</div>
          {/* The "£X/mo from/past comfortable" line is gone — on
              request, it was making this feel busy. Score and the
              breakdown link now share one clear row below instead. */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20 }}>
            <button
              type="button"
              onClick={() => setScoreInfoOpen((o) => !o)}
              aria-expanded={scoreInfoOpen}
              style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              <GrowthRing progress={score / 100} size={40} tone={scoreTone} />
              <span style={{ textAlign: "left" }}>
                <span style={{ display: "block", fontSize: 18, fontWeight: 800, color: "#FFFFFF" }}>{Math.round(animatedScore)}</span>
                <span style={{ display: "block", fontSize: 10.5, color: "rgba(255,255,255,0.7)" }}>health score</span>
              </span>
            </button>
            {/* Was a separate card full of tappable rows sitting on the
                page permanently — collapsed into a popout triggered from
                right here instead, since it's specifically about the Net
                Worth figure directly above it, not something that needs
                to always be visible. */}
            <button
              type="button"
              onClick={() => setNetWorthBreakdownOpen(true)}
              style={{
                marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6,
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

      {/* "Coming up" — a genuinely new, forward-looking section, on
          request. Combines two sources of real due-dates added
          specifically to support this: subscriptions' renewsOn
          (IncomeTab.jsx) and household bills' dueOn
          (HouseholdBillsTab.jsx). Mortgage and loan payments are
          deliberately NOT included here — neither currently tracks a
          payment day, and I didn't want to guess at one or silently
          leave the biggest payment out of a list that looks complete.
          If a real due-day gets added to those later, they belong
          here too. */}
      {(() => {
        const now = new Date();
        const today = now.getDate();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();

        // Turns a bare day-of-month into a real, sorted-comparable
        // date — this month if it hasn't happened yet, next month if
        // it has (or is today, handled as "today" rather than pushed
        // out a whole month).
        const nextOccurrence = (day) => {
          const candidate = new Date(thisYear, thisMonth, day);
          if (candidate < new Date(thisYear, thisMonth, today)) {
            return new Date(thisYear, thisMonth + 1, day);
          }
          return candidate;
        };

        const subItems = (profile.subscriptions || [])
          .filter((s) => !s.cancelled && s.renewsOn > 0)
          .map((s) => ({ name: s.name, amount: Number(s.amount) || 0, date: nextOccurrence(s.renewsOn), kind: "Subscription" }));

        const billItems = (profile.expenseCategories || [])
          .filter((c) => c.type === "essential")
          .flatMap((c) => c.items)
          .filter((i) => i.dueOn > 0 && Number(i.amount) > 0)
          .map((i) => ({ name: i.name, amount: Number(i.amount) || 0, date: nextOccurrence(i.dueOn), kind: "Bill" }));

        const upcoming = [...subItems, ...billItems]
          .filter((i) => (i.date - now) / 86400000 <= 31)
          .sort((a, b) => a.date - b.date);

        if (upcoming.length === 0) return null;

        const payday = Number(profile.payday) || 0;
        const nextPayday = payday > 0 ? nextOccurrence(payday) : null;
        const beforePayday = nextPayday ? upcoming.filter((i) => i.date <= nextPayday) : [];
        const beforePaydayTotal = beforePayday.reduce((s, i) => s + i.amount, 0);

        return (
          <Reveal>
            <div className="wmg-section-title">📅 Coming up</div>
            <Card style={{ marginBottom: 16 }}>
              {!payday && (
                <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "0.5px solid var(--hair)" }}>
                  <div className="wmg-sub" style={{ marginBottom: 8 }}>
                    When do you usually get paid? Add the day of the month and this can tell you what's due before
                    your next payday specifically.
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <NumberInput
                      className="wmg-input"
                      style={{ width: 70 }}
                      value={paydayInput}
                      onChange={setPaydayInput}
                      placeholder="day"
                    />
                    <button
                      type="button"
                      className="wmg-btn-primary"
                      onClick={() => {
                        const day = Math.max(1, Math.min(31, Math.round(Number(paydayInput)) || 0));
                        if (day > 0) setField?.(["payday"])(day);
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
              {payday && beforePayday.length > 0 && (
                <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "0.5px solid var(--hair)" }}>
                  <div className="wmg-eyebrow" style={{ marginBottom: 4 }}>Before your next payday</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "var(--brand)" }}>{gbp(beforePaydayTotal)}</div>
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {upcoming.map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 34, textAlign: "center", flexShrink: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "var(--paper)" }}>{item.date.getDate()}</div>
                      <div style={{ fontSize: 9, color: "var(--paper-dim)" }}>{item.date.toLocaleDateString("en-GB", { month: "short" })}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, color: "var(--paper)", fontWeight: 500 }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: "var(--paper-dim)" }}>{item.kind}</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--paper)" }}>{gbp(item.amount)}</div>
                  </div>
                ))}
              </div>
            </Card>
          </Reveal>
        );
      })()}

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
          saw on opening the app. On request, shrunk further still —
          into a small orange pill sitting right next to the green
          "bank synced" one, rather than a full Card anywhere on the
          page at all. */}

      {/* Was two cards — the bills prompt, and "What your spare money
          could do" underneath it. The second one is removed entirely
          on request; that whole comparison now lives properly on its
          own Savings Growth screen, reached via the "Left over" teaser
          further down instead of sitting here permanently. */}
      {totals.essentialCatTotal <= 0 && (
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
      {/* Moved inside the Card as a proper wmg-eyebrow — the same
          small-caps style used for every other card header tonight
          ("One more thing that'd help", etc.), rather than a one-off
          treatment. Genuinely "its own box" now, since it's inside
          the bordered card rather than floating as plain text above it. */}
      {(hasConnectedBank || (hasAccounts && pendingBankSync && !pendingSyncDismissed)) && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {hasConnectedBank && (
            <button
              type="button"
              onClick={() => onNavigate?.("import")}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "var(--sage-soft)", border: "1px solid var(--sage)", borderRadius: 999,
                padding: "5px 12px 5px 8px", fontSize: 11, fontWeight: 700, color: "var(--sage)", cursor: "pointer",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--sage)", flexShrink: 0 }} />
              Bank synced
            </button>
          )}
          {/* Small orange pill replacing the old full-width "New spending
              synced" banner — tapping it goes straight to Review (the
              same destination the banner's own "Review" button did);
              there's no room for a separate "Not now" in something this
              small, but being this unobtrusive means there's much less
              need for one — it's easy to just not tap it. */}
          {hasAccounts && pendingBankSync && !pendingSyncDismissed && (
            <button
              type="button"
              onClick={() => onNavigate?.("import")}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "var(--gold-soft)", border: "1px solid var(--gold)", borderRadius: 999,
                padding: "5px 12px 5px 8px", fontSize: 11, fontWeight: 700, color: "var(--gold)", cursor: "pointer",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gold)", flexShrink: 0 }} />
              New transactions to sync
            </button>
          )}
        </div>
      )}
      <Card style={{ marginBottom: 16 }}>
        <div className="wmg-eyebrow" style={{ marginBottom: 10 }}>💷 Income &amp; essential outgoings</div>
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
          rows.push({ label: "Left over", value: leftOver, tone: "brand", tab: null });

          // Whether "Left over" is worth making tappable at all —
          // the actual content (a real compound-interest projection,
          // plus a link through to the mortgage overpayment calculator)
          // now lives in the leftOverPopoutOpen popout below, rather
          // than a single pre-computed sentence guessed at in advance.
          const hasLeftOverTease = leftOver > 0;

          return (
            <div>
              {/* Rebuilt using the exact same `rows` the list below
                  renders, rather than the old flowSegments prop — that
                  prop's breakdown (Essential/Debt/Pension/Investments/
                  Available) is coarser than what this list now shows
                  (Mortgage and Bills split out, Savings included), so
                  reusing it here would have shown different numbers in
                  the chart than in the list directly underneath it. */}
              <div style={{ width: 160, height: 160, margin: "0 auto 4px" }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={rows} dataKey="value" nameKey="label" innerRadius={48} outerRadius={76} paddingAngle={2} strokeWidth={0}>
                      {rows.map((r) => (
                        <Cell key={r.label} fill={`var(--${r.tone})`} />
                      ))}
                    </Pie>
                    <Tooltip content={<CategoryTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
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
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => {
                      if (!hasLeftOverTease) return;
                      setLeftOverPct(100);
                      setLeftOverCustom("");
                      setLeftOverPopoutOpen(true);
                    }}
                    disabled={!hasLeftOverTease}
                    aria-label={`${r.label}: ${gbp(r.value)}${hasLeftOverTease ? ". See what this could do" : ""}`}
                    style={{
                      display: "block", width: "100%", padding: "9px 0 4px",
                      background: "none", border: "none", textAlign: "left",
                      cursor: hasLeftOverTease ? "pointer" : "default",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: "var(--brand)" }} />
                      <span style={{ flex: 1, fontSize: 13, color: "var(--paper)", fontWeight: 700 }}>{r.label}</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: "var(--brand)" }}>{gbp(r.value)}</span>
                    </div>
                    {hasLeftOverTease && (
                      <div style={{ marginTop: 6, marginLeft: 18, fontSize: 12, color: "var(--sage)", fontWeight: 600 }}>
                        ✨ What could you do with your spare money? →
                      </div>
                    )}
                  </button>
                )
              )}
            </div>

            {/* The actual "what could this become" content — reached
                by tapping "Left over" above. A popout rather than a
                fully separate page, given how much else was already
                being asked for in the same message this was requested
                in — it delivers the same substance (a real savings
                projection, plus mortgage overpayment) without the extra
                scope of a brand new standalone screen. */}
            <Popout
              open={leftOverPopoutOpen}
              onClose={() => setLeftOverPopoutOpen(false)}
              title="What could your spare money do?"
            >
              <div className="wmg-sub" style={{ marginBottom: 14 }}>
                You have <strong style={{ color: "var(--paper)" }}>{gbp(leftOver)}/month</strong> spare, after
                everything essential.
              </div>
              {/* How much of it to actually run the projection on —
                  defaults to all of it, but a real household often
                  wants to keep some back for day-to-day spending
                  rather than commit every last pound to a what-if. */}
              <div className="wmg-field-label" style={{ marginBottom: 6 }}>How much of it?</div>
              <div style={{ display: "flex", gap: 6, marginBottom: leftOverPct === -1 ? 10 : 16 }}>
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setLeftOverPct(pct)}
                    style={{
                      flex: 1, padding: "8px 0", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                      border: leftOverPct === pct ? "1.5px solid var(--brand)" : "0.5px solid var(--hair)",
                      background: leftOverPct === pct ? "var(--brand-soft)" : "var(--ink-2)",
                      color: leftOverPct === pct ? "var(--brand)" : "var(--paper)",
                    }}
                  >
                    {pct}%
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setLeftOverPct(-1)}
                  style={{
                    flex: 1.4, padding: "8px 0", borderRadius: 10, fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                    border: leftOverPct === -1 ? "1.5px solid var(--brand)" : "0.5px solid var(--hair)",
                    background: leftOverPct === -1 ? "var(--brand-soft)" : "var(--ink-2)",
                    color: leftOverPct === -1 ? "var(--brand)" : "var(--paper)",
                  }}
                >
                  Custom
                </button>
              </div>
              {leftOverPct === -1 && (
                <div style={{ marginBottom: 16 }}>
                  <NumberInput
                    className="wmg-input"
                    style={{ width: "100%" }}
                    value={leftOverCustom}
                    onChange={setLeftOverCustom}
                    placeholder={`Up to ${gbp(leftOver)}`}
                  />
                </div>
              )}
              {(() => {
                const projectionAmount =
                  leftOverPct === -1
                    ? Math.min(leftOver, Math.max(0, Number(leftOverCustom || 0)))
                    : leftOver * (leftOverPct / 100);
                // Was principal-only when no rate had been set — now
                // falls back to a real average instead, per the Bank
                // of England's own data (average UK easy-access rate,
                // Dec 2025: 3.12%), rather than either fabricating a
                // number or showing flat, ungrown principal. Still
                // clearly labelled as an estimate, and still prefers
                // your own real rate the moment one's set on Savings.
                const usingOwnRate = Number(profile.savings.interestRate || 0) > 0;
                const AVERAGE_UK_EASY_ACCESS_RATE = 3.12;
                const annualRate = usingOwnRate ? Number(profile.savings.interestRate) : AVERAGE_UK_EASY_ACCESS_RATE;
                const monthlyRate = annualRate / 100 / 12;
                const fv = (months) => projectionAmount * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
                return (
                  <div style={{ marginBottom: 16 }}>
                    <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>
                      Saving {gbp(projectionAmount)}/month at {annualRate}%/year
                    </div>
                    <div className="wmg-forecast-summary" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                      <div>
                        <div className="wmg-calc-item-label">1 year</div>
                        <div className="wmg-calc-item-val">{gbp(fv(12))}</div>
                      </div>
                      <div>
                        <div className="wmg-calc-item-label">5 years</div>
                        <div className="wmg-calc-item-val">{gbp(fv(60))}</div>
                      </div>
                      <div>
                        <div className="wmg-calc-item-label">10 years</div>
                        <div className="wmg-calc-item-val">{gbp(fv(120))}</div>
                      </div>
                    </div>
                    {!usingOwnRate && (
                      <div className="wmg-sub" style={{ marginTop: 10, fontSize: 11.5 }}>
                        Based on the average UK easy-access rate (3.12%, Bank of England data) — add your own
                        account's real rate on Savings for an exact figure.
                      </div>
                    )}
                  </div>
                );
              })()}
              <button
                type="button"
                className="wmg-btn-primary"
                style={{ width: "100%" }}
                onClick={() => {
                  setLeftOverPopoutOpen(false);
                  onNavigate?.("mortgage-overpayment");
                }}
              >
                Or see what it could do for your mortgage
              </button>
            </Popout>
            </div>
          );
        })()}
      </Card>
    </>
  );
}

/* Emma-inspired compact subscription row: icon + name + price at a glance,
   tap to expand for editing/cancel/remove controls. */

