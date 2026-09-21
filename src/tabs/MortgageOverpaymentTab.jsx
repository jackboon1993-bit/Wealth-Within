import React, { useState } from "react";
import { gbp, gbpApprox, addMonths, monthsToPayoff, totalInterestOwed } from "../lib/finance";
import { Card, NumberInput, Reveal, Celebration, WhyItMatters, InfoTip, useCountUp } from "../components/ui";

// A dedicated home for exploring mortgage overpayments — pulled out of
// Debts & Mortgage into its own tab because "how much could I actually
// save" deserves proper room to breathe (a real before/after comparison,
// not a cramped inline calculator), and because it's exactly the kind of
// thing worth a polished, purpose-built screen rather than a footnote on
// a form. Reuses the exact same allowOverpayment/overpaymentCapPct fields
// Debts & Mortgage already tracks — this tab doesn't introduce any new
// mortgage state, just a much better way to explore what's already there.
// A house that fills up like a glass of water as more of it gets paid
// off — equityFraction (1 - LTV) drives how high the fill sits, clipped
// to a simple house silhouette so it reads as "the home", not just an
// abstract gauge. Deliberately a flat fill rather than anything more
// literal (waves, ripples) — the point is legibility at a glance, not
// a gimmick that's harder to read than a plain percentage would be.
function HouseEquityGauge({ equityFraction, equityAmount, balance }) {
  const pct = Math.max(0, Math.min(1, equityFraction));
  const houseTop = 8;
  const houseBottom = 90;
  const fillY = houseBottom - pct * (houseBottom - houseTop);
  const housePath = "M 50 8 L 92 42 L 80 42 L 80 90 L 20 90 L 20 42 L 8 42 Z";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <svg width="110" height="110" viewBox="0 0 100 100" style={{ flexShrink: 0 }} aria-hidden="true">
        <defs>
          <clipPath id="mortgageHouseClip">
            <path d={housePath} />
          </clipPath>
        </defs>
        <path d={housePath} fill="var(--ink-3)" stroke="var(--brand)" strokeWidth="2.5" />
        <g clipPath="url(#mortgageHouseClip)">
          <rect x="0" y={fillY} width="100" height={houseBottom - fillY + 4} fill="var(--brand)" opacity="0.85" />
          <rect x="0" y={Math.max(houseTop, fillY - 2)} width="100" height="3" fill="var(--brand-2)" opacity="0.7" />
        </g>
        <rect x="44" y="72" width="12" height="18" fill="var(--paper)" opacity="0.18" />
      </svg>
      <div>
        <div className="wmg-eyebrow" style={{ marginBottom: 4 }}>You own</div>
        <div className="wmg-figure tone-brand">{Math.round(pct * 100)}%</div>
        <div className="wmg-sub" style={{ marginTop: 4 }}>
          {gbp(equityAmount)} of equity — {gbp(balance)} left, {Math.round((1 - pct) * 100)}% LTV
        </div>
      </div>
    </div>
  );
}

export function MortgageOverpaymentTab({ profile, totals, setField, onNavigate }) {
  const [lumpSum, setLumpSum] = useState(0);
  const [extraMonthly, setExtraMonthly] = useState(0);

  const balance = totals?.mortgageBalanceToday ?? profile.mortgage.balance;
  const rate = profile.mortgage.rate;
  const payment = profile.mortgage.payment;
  const capPct = profile.mortgage.overpaymentCapPct;
  // The usual UK penalty-free overpayment allowance is a percentage of
  // the outstanding balance per year — same figure Debts & Mortgage and
  // the Cash Flow Forecast popout already reference.
  const annualAllowance = balance * (capPct / 100);
  const lumpSumExceedsAllowance = lumpSum > annualAllowance;

  const hasMortgage = balance > 0 && payment > 0;

  // Baseline: no overpayment at all.
  const baselineMonths = hasMortgage ? monthsToPayoff(balance, rate, payment) : 0;
  const baselineInterest = hasMortgage ? totalInterestOwed(balance, rate, payment, baselineMonths) : 0;

  // With a one-off lump sum applied today, then paying as normal.
  const balanceAfterLump = Math.max(0, balance - (lumpSum || 0));
  const lumpMonths = hasMortgage ? monthsToPayoff(balanceAfterLump, rate, payment) : 0;
  const lumpInterest = hasMortgage ? totalInterestOwed(balanceAfterLump, rate, payment, lumpMonths) : 0;
  const lumpMonthsSaved = Math.round(baselineMonths - lumpMonths);
  const lumpInterestSaved = Math.max(0, baselineInterest - lumpInterest - (lumpSum || 0) + (lumpSum || 0)); // interest-only saving, lump sum itself isn't "saved", just interest avoided
  const lumpInterestSavedDisplay = Math.max(0, baselineInterest - lumpInterest);

  // With an ongoing extra amount every month from today onward.
  const extraMonths = hasMortgage ? monthsToPayoff(balance, rate, payment + (extraMonthly || 0)) : 0;
  const extraInterest = hasMortgage ? totalInterestOwed(balance, rate, payment + (extraMonthly || 0), extraMonths) : 0;
  const extraMonthsSaved = Math.round(baselineMonths - extraMonths);
  const extraInterestSaved = Math.max(0, baselineInterest - extraInterest);

  const animatedLumpInterestSaved = useCountUp(lumpInterestSavedDisplay);
  const animatedExtraInterestSaved = useCountUp(extraInterestSaved);

  if (!hasMortgage) {
    return (
      <>
        <div className="wmg-section-title">Mortgage overpayment calculator</div>
        <Card>
          <p className="wmg-sub" style={{ marginBottom: 12 }}>
            Add your mortgage details on Mortgage first, and this calculator will be ready to show you what
            overpaying could actually save.
          </p>
          {/* Was onNavigate?.("debts", "mortgage") — "debts" hasn't been a
              real tab since Session 10 split Debts & Mortgage into
              separate Loans/Mortgage tabs; that stale tab key landed on a
              blank page (only the shared header/disclaimer render, since
              nothing matches an unknown tab). Fixed to the tab's actual
              current key. */}
          <button type="button" className="wmg-add-btn" onClick={() => onNavigate?.("mortgage")}>
            Go to Mortgage
          </button>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="wmg-section-title">Mortgage overpayment calculator</div>
      <WhyItMatters>
        Even a modest regular overpayment can cut years off a mortgage and save a genuinely large amount in
        interest, because you're reducing the balance interest gets charged on for every month that follows. The
        earlier you start, the bigger the effect — the same amount overpaid later in the mortgage saves less, since
        there's less time left for it to compound.
      </WhyItMatters>

      <Reveal>
        <Card>
          <div className="wmg-three-col">
            <div>
              <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Balance outstanding</div>
              <div className="wmg-figure tone-paper">{gbp(balance)}</div>
            </div>
            <div>
              <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Interest rate</div>
              <div className="wmg-figure tone-paper">{rate}%</div>
            </div>
            {profile.homeValue > 0 && (
              <div>
                <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Home value</div>
                <div className="wmg-figure tone-paper">{gbp(profile.homeValue)}</div>
              </div>
            )}
          </div>
        </Card>
      </Reveal>

      {profile.homeValue > 0 && (
        <Reveal delay={10}>
          <Card>
            <HouseEquityGauge
              equityFraction={1 - balance / profile.homeValue}
              equityAmount={Math.max(0, profile.homeValue - balance)}
              balance={balance}
            />
          </Card>
        </Reveal>
      )}

      <Reveal delay={20}>
        <Card>
          <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>Without any overpayment</div>
          <div className="wmg-sub">
            At {gbp(payment)}/month on {rate}%, you'd be mortgage-free by{" "}
            <strong style={{ color: "var(--paper)" }}>{addMonths(Math.round(baselineMonths))}</strong>, paying{" "}
            <strong style={{ color: "var(--paper)" }}>{gbpApprox(baselineInterest)}</strong> in interest along the way.
          </div>
        </Card>
      </Reveal>

      {/* Was a warning banner shown whenever profile.mortgage.allowOverpayment
          was false, pointing at a "turn it on" toggle that no longer
          exists — that checkbox was removed from Mortgage earlier this
          session, and surplus-to-mortgage overpayment now always applies
          automatically. A user whose profile still has the old flag
          saved as false (from before the checkbox was removed) would
          otherwise see this permanently, with a "Go turn it on" button
          that also happened to navigate to a dead tab key. Removed
          entirely rather than fixed, since there's nothing left to turn
          on. */}

      <div className="wmg-section-title">One-off lump sum</div>
      <Reveal delay={100}>
        <Card>
          <div className="wmg-field-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            How much could you put in today?
            <InfoTip text={`Most UK mortgages let you overpay up to ${capPct}% of the balance per year without an early repayment charge — that's currently ${gbp(annualAllowance)} for you. Above that, check your lender's terms before going ahead.`} />
          </div>
          <NumberInput className="wmg-input" value={lumpSum} placeholder="e.g. 5000" onChange={setLumpSum} />
          {lumpSumExceedsAllowance && (
            <div className="wmg-sub" style={{ marginTop: 8, color: "var(--rust)" }}>
              That's above your {capPct}% penalty-free allowance ({gbp(annualAllowance)}/year) — you may be charged
              an early repayment fee on the amount over that, depending on your lender.
            </div>
          )}
          {lumpSum > 0 && (
            <div className="wmg-forecast-summary" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 14 }}>
              <div>
                <div className="wmg-calc-item-label">New payoff date</div>
                <div className="wmg-calc-item-val">{addMonths(Math.round(lumpMonths))}</div>
              </div>
              <div>
                <div className="wmg-calc-item-label">Interest saved</div>
                <div className="wmg-calc-item-val" style={{ color: "var(--sage)" }}>{gbpApprox(animatedLumpInterestSaved)}</div>
              </div>
            </div>
          )}
          {lumpSum > 0 && lumpMonthsSaved > 0 && (
            <div className="wmg-sub" style={{ marginTop: 10 }}>
              That's <strong style={{ color: "var(--sage)" }}>{lumpMonthsSaved} month{lumpMonthsSaved === 1 ? "" : "s"} sooner</strong> mortgage-free.
            </div>
          )}
        </Card>
      </Reveal>

      <div className="wmg-section-title">Or, an extra amount every month</div>
      <Reveal delay={140}>
        <Card>
          <div className="wmg-field-label">Extra on top of your usual payment</div>
          <NumberInput className="wmg-input" value={extraMonthly} placeholder="e.g. 150" onChange={setExtraMonthly} />
          {extraMonthly > 0 && (
            <div className="wmg-forecast-summary" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 14 }}>
              <div>
                <div className="wmg-calc-item-label">New payoff date</div>
                <div className="wmg-calc-item-val">{addMonths(Math.round(extraMonths))}</div>
              </div>
              <div>
                <div className="wmg-calc-item-label">Interest saved</div>
                <div className="wmg-calc-item-val" style={{ color: "var(--sage)" }}>{gbpApprox(animatedExtraInterestSaved)}</div>
              </div>
            </div>
          )}
          {extraMonthly > 0 && extraMonthsSaved > 0 && (
            <div className="wmg-sub" style={{ marginTop: 10 }}>
              That's <strong style={{ color: "var(--sage)" }}>{extraMonthsSaved} month{extraMonthsSaved === 1 ? "" : "s"} sooner</strong> mortgage-free —{" "}
              {gbp(extraMonthly)}/month is {gbp(extraMonthly * 12)}/year, well within your {capPct}% allowance as long as it's the only overpayment you make that year.
            </div>
          )}
        </Card>
      </Reveal>

      {(lumpInterestSavedDisplay > 1000 || extraInterestSaved > 1000) && (
        <Reveal delay={180}>
          <Celebration
            title="That's a real saving"
            message="Worth thinking seriously about — small changes to a mortgage compound into genuinely large numbers over its lifetime."
            tone="sage"
          />
        </Reveal>
      )}
    </>
  );
}
