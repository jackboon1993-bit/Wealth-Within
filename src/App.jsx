import React, { useState, useMemo, useEffect, useRef } from "react";
import { getData, setData, deleteData } from "./lib/storage";
import { supabase } from "./lib/supabaseClient";
import { submitFeedback } from "./lib/feedback";
import {
  LineChart,
  ComposedChart,
  Line,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

/* ============================== helpers ============================== */

const gbp = (n, decimals = 0) => {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return (
    sign +
    "£" +
    Math.abs(n).toLocaleString("en-GB", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)));
}

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/* Projects a balance forward from the date it was last confirmed, using
   ordinary scheduled amortisation only (no extra payments) — this is
   deliberately a plain, honest estimate, not a promise. */
function estimateBalanceToday(balance, annualRatePct, payment, lastConfirmedAt) {
  const months = daysSince(lastConfirmedAt) / 30.4375;
  if (months <= 0 || !isFinite(balance)) return balance;
  const monthlyRate = annualRatePct / 100 / 12;
  let bal = balance;
  const fullMonths = Math.floor(months);
  for (let i = 0; i < fullMonths; i++) {
    if (bal <= 0) break;
    const interest = bal * monthlyRate;
    const principal = Math.max(0, Math.min(payment - interest, bal));
    bal = Math.max(0, bal - principal);
  }
  return bal;
}

function monthsToPayoff(balance, annualRatePct, payment) {
  const r = annualRatePct / 100 / 12;
  if (balance <= 0) return 0;
  if (r === 0) return payment > 0 ? balance / payment : Infinity;
  if (payment <= balance * r) return Infinity;
  return Math.log(payment / (payment - balance * r)) / Math.log(1 + r);
}

function totalInterestOwed(balance, annualRatePct, payment, months) {
  if (!isFinite(months)) return Infinity;
  return Math.max(0, payment * months - balance);
}

function addMonths(months) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + Math.round(months));
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function futureValue(balance, monthlyContribution, annualRatePct, months) {
  const r = annualRatePct / 100 / 12;
  if (months <= 0) return balance;
  if (r === 0) return balance + monthlyContribution * months;
  return (
    balance * Math.pow(1 + r, months) +
    monthlyContribution * ((Math.pow(1 + r, months) - 1) / r)
  );
}

let uid = 1000;
const nextId = () => uid++;

/* ============================ default data ============================ */

const defaultProfile = {
  onboarded: false,
  income: 5800,
  homeValue: 337000,
  homeValueGrowth: 2,
  mortgage: {
    balance: 210000,
    rate: 4.5,
    payment: 1150,
    allowOverpayment: true,
    overpaymentCapPct: 10,
    originalBalance: 210000,
    lastConfirmedAt: daysAgoISO(20),
  },
  loans: [
    { id: nextId(), name: "Car loan", balance: 21000, rate: 7.9, payment: 300, originalBalance: 24000, lastConfirmedAt: daysAgoISO(48) },
    { id: nextId(), name: "Personal loan", balance: 18800, rate: 9.9, payment: 290, originalBalance: 18800, lastConfirmedAt: daysAgoISO(6) },
  ],
  cards: [{ id: nextId(), name: "Credit card", balance: 3200, rate: 22.9, payment: 150, originalBalance: 4500, lastConfirmedAt: daysAgoISO(12) }],
  expenseCategories: [
    {
      id: nextId(),
      name: "Housing & utilities",
      type: "essential",
      items: [
        { id: nextId(), name: "Council tax", amount: 210 },
        { id: nextId(), name: "Electricity & gas", amount: 150 },
        { id: nextId(), name: "Water", amount: 55 },
        { id: nextId(), name: "Broadband", amount: 45 },
        { id: nextId(), name: "Mobile phone", amount: 40 },
      ],
    },
    {
      id: nextId(),
      name: "Insurance & protection",
      type: "essential",
      items: [
        { id: nextId(), name: "Home insurance", amount: 35 },
        { id: nextId(), name: "Life insurance", amount: 45 },
        { id: nextId(), name: "Car insurance", amount: 60 },
      ],
    },
    {
      id: nextId(),
      name: "Transport",
      type: "essential",
      items: [
        { id: nextId(), name: "Fuel", amount: 150 },
        { id: nextId(), name: "Car maintenance", amount: 50 },
        { id: nextId(), name: "Public transport", amount: 60 },
      ],
    },
    {
      id: nextId(),
      name: "Groceries & household",
      type: "essential",
      items: [
        { id: nextId(), name: "Groceries", amount: 520 },
        { id: nextId(), name: "Household goods", amount: 40 },
      ],
    },
    {
      id: nextId(),
      name: "Childcare & family",
      type: "essential",
      items: [{ id: nextId(), name: "Childcare", amount: 340 }],
    },
    {
      id: nextId(),
      name: "Health & personal care",
      type: "essential",
      items: [
        { id: nextId(), name: "Pharmacy / health", amount: 70 },
        { id: nextId(), name: "Personal care", amount: 80 },
      ],
    },
    {
      id: nextId(),
      name: "Lifestyle & leisure",
      type: "lifestyle",
      items: [
        { id: nextId(), name: "Eating out", amount: 300 },
        { id: nextId(), name: "Entertainment", amount: 100 },
        { id: nextId(), name: "Clothing & shopping", amount: 250 },
        { id: nextId(), name: "Holidays (saved monthly)", amount: 200 },
        { id: nextId(), name: "Hobbies", amount: 80 },
        { id: nextId(), name: "Other", amount: 65 },
      ],
    },
  ],
  subscriptions: [
    { id: nextId(), name: "Netflix", amount: 16, flagged: false, cancelled: false },
    { id: nextId(), name: "Spotify", amount: 12, flagged: false, cancelled: false },
    { id: nextId(), name: "Disney+", amount: 9, flagged: true, cancelled: false },
    { id: nextId(), name: "Gym membership", amount: 45, flagged: false, cancelled: false },
    { id: nextId(), name: "Amazon Prime", amount: 9, flagged: false, cancelled: false },
    { id: nextId(), name: "Cloud storage", amount: 3, flagged: true, cancelled: false },
    { id: nextId(), name: "Phone insurance", amount: 11, flagged: true, cancelled: false },
  ],
  pension: {
    balance: 74000,
    contribution: 350,
    currentAge: 35,
    retirementAge: 67,
    growthLow: 3,
    growthMedium: 5,
    growthHigh: 7,
    drawdownRate: 4,
  },
  statePension: { weeklyAmount: 221.2, claimAge: 67, included: true },
  savings: { balance: 8000, growthRate: 3 },
  emergencyFund: { balance: 2400, target: 5000 },
  investments: { balance: 16000, monthlyContribution: 150, growthRate: 5 },
  goals: [
    { id: nextId(), name: "House deposit top-up", target: 15000, current: 4000, monthlyContribution: 250, desiredMonths: null },
    { id: nextId(), name: "New car fund", target: 8000, current: 1200, monthlyContribution: 100, desiredMonths: null },
  ],
  lifeEvents: [
    { id: nextId(), name: "New car", yearsFromNow: 3, type: "expense", amount: 8000 },
    { id: nextId(), name: "Inheritance", yearsFromNow: 12, type: "income", amount: 15000 },
  ],
  scenarios: [
    { id: nextId(), name: "Balanced", allocationPct: 50 },
    { id: nextId(), name: "Aggressive debt payoff", allocationPct: 100 },
  ],
  assumptions: { incomeGrowth: 3, inflation: 2.5, growthUncertaintyPct: 2 },
};

/* Backfills any fields missing from previously-saved data (e.g. saved before a
   feature like State Pension existed) with sensible defaults, so old saves never
   crash the app when new fields are added. */
function mergeWithDefaults(saved) {
  if (!saved || typeof saved !== "object") return defaultProfile;
  const merged = { ...defaultProfile, ...saved };
  const nestedObjectKeys = ["mortgage", "pension", "statePension", "savings", "emergencyFund", "investments", "assumptions"];
  nestedObjectKeys.forEach((k) => {
    merged[k] = { ...defaultProfile[k], ...(saved[k] && typeof saved[k] === "object" ? saved[k] : {}) };
  });
  const arrayKeys = ["loans", "cards", "expenseCategories", "subscriptions", "goals", "lifeEvents", "scenarios"];
  arrayKeys.forEach((k) => {
    merged[k] = Array.isArray(saved[k]) ? saved[k] : defaultProfile[k];
  });

  // backfill balance-tracking fields for debts saved before this feature existed
  const backfillDebt = (d) => ({
    ...d,
    originalBalance: d.originalBalance ?? d.balance,
    lastConfirmedAt: d.lastConfirmedAt ?? new Date().toISOString(),
  });
  merged.loans = merged.loans.map(backfillDebt);
  merged.cards = merged.cards.map(backfillDebt);
  merged.mortgage = backfillDebt(merged.mortgage);

  return merged;
}

/* ============================ UK tax estimate ============================ */
/* Simplified 2024/25-style England & NI bands. Ignores National Insurance,
   the personal allowance taper above £100k, Scottish rates, and any other
   income the person may have. It's a directional estimate, not a tax return. */
function estimateUKIncomeTax(grossAnnual) {
  const PA = 12570;
  const BASIC = 50270;
  const HIGHER = 125140;
  if (grossAnnual <= PA) return 0;
  if (grossAnnual <= BASIC) return (grossAnnual - PA) * 0.2;
  if (grossAnnual <= HIGHER) return (BASIC - PA) * 0.2 + (grossAnnual - BASIC) * 0.4;
  return (BASIC - PA) * 0.2 + (HIGHER - BASIC) * 0.4 + (grossAnnual - HIGHER) * 0.45;
}

/* ============================ forecast engine ============================ */

function runForecast(profile, totals, horizonYears, allocationPct, growthOffsetPct = 0) {
  const months = horizonYears * 12;
  const debts = [...profile.loans, ...profile.cards].map((d) => ({
    ...d,
    balance: estimateBalanceToday(d.balance, d.rate, d.payment, d.lastConfirmedAt),
    isMortgage: false,
  }));
  const mortgageRate = profile.mortgage.rate;
  const mortgagePayment = profile.mortgage.payment;
  const mortgageOverpaymentAllowed = profile.mortgage.allowOverpayment ?? true;
  const mortgageCapPct = (profile.mortgage.overpaymentCapPct ?? 10) / 100;
  const mortgageEntry = { id: "mortgage", name: "Mortgage", balance: estimateBalanceToday(profile.mortgage.balance, mortgageRate, mortgagePayment, profile.mortgage.lastConfirmedAt), rate: mortgageRate, payment: mortgagePayment, isMortgage: true };
  const allEntries = [...debts, mortgageEntry];
  const avalanchePool = mortgageOverpaymentAllowed ? allEntries : debts;
  let homeValue = profile.homeValue;
  const homeGrowth = profile.homeValueGrowth;

  let savings = profile.savings.balance;
  const savingsRate = Math.max(0, profile.savings.growthRate + growthOffsetPct);
  let investments = profile.investments.balance;
  const investRate = Math.max(0, profile.investments.growthRate + growthOffsetPct);
  const investContribution = profile.investments.monthlyContribution;
  let pension = profile.pension.balance;
  const pensionRate = Math.max(0, profile.pension.growthMedium + growthOffsetPct);
  const pensionContribution = profile.pension.contribution;

  let essential = totals.essential - mortgagePayment;
  let lifestyle = totals.lifestyle;
  let income = totals.income;
  const incomeGrowthM = (profile.assumptions?.incomeGrowth ?? 0) / 100 / 12;
  const inflationM = (profile.assumptions?.inflation ?? 0) / 100 / 12;

  const statePensionIncluded = profile.statePension?.included ?? false;
  let statePensionMonthly = ((profile.statePension?.weeklyAmount ?? 0) * 52) / 12;
  const statePensionClaimAgeMonths = (profile.statePension?.claimAge ?? 67) * 12;
  const startAgeMonths = (profile.pension.currentAge ?? 35) * 12;
  let statePensionStartMonth = null;

  let mortgageYearStartBalance = mortgageEntry.balance;
  let mortgageYearOverpaid = 0;

  const lifeEvents = (profile.lifeEvents || [])
    .map((e) => ({
      ...e,
      month: Math.max(1, Math.round((e.yearsFromNow ?? 0) * 12)),
      signedAmount: (e.type === "expense" ? -1 : 1) * Math.abs(e.amount || 0),
    }))
    .filter((e) => e.month <= months);
  const lifeEventsByMonth = {};
  lifeEvents.forEach((e) => {
    lifeEventsByMonth[e.month] = (lifeEventsByMonth[e.month] || 0) + e.signedAmount;
  });

  const series = [];
  let debtFreeMonth = null;
  let mortgageFreeMonth = null;
  const startingDebt = debts.reduce((s, d) => s + d.balance, 0);
  if (startingDebt <= 0) debtFreeMonth = 0;
  if (mortgageEntry.balance <= 0) mortgageFreeMonth = 0;

  for (let m = 1; m <= months; m++) {
    // pay rises and cost-of-living increases, applied monthly
    income *= 1 + incomeGrowthM;
    essential *= 1 + inflationM;
    lifestyle *= 1 + inflationM;
    statePensionMonthly *= 1 + inflationM;

    // reset the annual overpayment allowance at the start of each mortgage year
    if ((m - 1) % 12 === 0) {
      mortgageYearStartBalance = mortgageEntry.balance;
      mortgageYearOverpaid = 0;
    }

    const statePensionAdd = statePensionIncluded && startAgeMonths + m >= statePensionClaimAgeMonths ? statePensionMonthly : 0;
    if (statePensionAdd > 0 && statePensionStartMonth === null) statePensionStartMonth = m;

    homeValue *= 1 + homeGrowth / 100 / 12;

    let scheduledPayment = 0;
    allEntries.forEach((d) => {
      if (d.balance > 0) {
        const di = d.balance * (d.rate / 100 / 12);
        const dp = Math.min(d.payment, d.balance + di);
        d.balance = Math.max(0, d.balance + di - dp);
        scheduledPayment += dp;
      }
    });

    const surplus = income + statePensionAdd - essential - lifestyle - scheduledPayment;
    let extraSavings;
    if (surplus > 0) {
      const extraDebt = surplus * (allocationPct / 100);
      extraSavings = surplus - extraDebt;
      let remaining = extraDebt;
      let guard = 0;
      while (remaining > 0.01 && guard < 30) {
        const candidates = avalanchePool
          .filter((d) => {
            if (d.balance <= 0) return false;
            if (d.isMortgage) {
              const capRemaining = mortgageYearStartBalance * mortgageCapPct - mortgageYearOverpaid;
              return capRemaining > 0.01;
            }
            return true;
          })
          .sort((a, b) => b.rate - a.rate);
        const target = candidates[0];
        if (!target) break;
        let pay = Math.min(remaining, target.balance);
        if (target.isMortgage) {
          const capRemaining = mortgageYearStartBalance * mortgageCapPct - mortgageYearOverpaid;
          pay = Math.min(pay, capRemaining);
          mortgageYearOverpaid += pay;
        }
        target.balance -= pay;
        remaining -= pay;
        guard++;
      }
      // anything that couldn't find a debt target (fully paid off, or mortgage capped) goes to savings instead
      extraSavings += remaining;
    } else {
      extraSavings = surplus;
    }

    savings = savings * (1 + savingsRate / 100 / 12) + extraSavings + (lifeEventsByMonth[m] || 0);
    investments = investments * (1 + investRate / 100 / 12) + investContribution;
    pension = pension * (1 + pensionRate / 100 / 12) + pensionContribution;

    const remainingNonMortgageDebt = debts.reduce((s, d) => s + d.balance, 0);
    if (debtFreeMonth === null && remainingNonMortgageDebt <= 0.5) debtFreeMonth = m;
    if (mortgageFreeMonth === null && mortgageEntry.balance <= 0.5) mortgageFreeMonth = m;

    if (m % 12 === 0) {
      const year = m / 12;
      const homeEquity = homeValue - mortgageEntry.balance;
      const netWorth = homeEquity + savings + investments + pension - remainingNonMortgageDebt;
      const debtTotal = remainingNonMortgageDebt + mortgageEntry.balance;
      const savingsInvest = savings + investments;
      const discount = Math.pow(1 + (profile.assumptions?.inflation ?? 0) / 100, year);
      series.push({
        year,
        netWorth: Math.round(netWorth),
        debt: Math.round(debtTotal),
        savingsInvest: Math.round(savingsInvest),
        pension: Math.round(pension),
        netWorthReal: Math.round(netWorth / discount),
        debtReal: Math.round(debtTotal / discount),
        savingsInvestReal: Math.round(savingsInvest / discount),
        pensionReal: Math.round(pension / discount),
      });
    }
  }

  return { series, debtFreeMonth, mortgageFreeMonth, statePensionStartMonth, resolvedLifeEvents: lifeEvents };
}

function parseDebtLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line
        .split(/\t|,/)
        .map((p) => p.trim())
        .filter((p) => p !== "");
      const toNum = (s) => {
        if (s === undefined) return 0;
        const n = parseFloat(String(s).replace(/[£%,]/g, "").trim());
        return isFinite(n) ? n : 0;
      };
      return {
        name: parts[0] || "Debt",
        balance: toNum(parts[1]),
        rate: toNum(parts[2]),
        payment: toNum(parts[3]),
      };
    });
}

/* ============================== ui atoms ============================== */

function Card({ children, className = "", style = {} }) {
  return (
    <div className={`wmg-card ${className}`} style={style}>
      {children}
    </div>
  );
}

/* Concentric growth rings, echoing tree-ring growth — the app's signature
   visual. `progress` is 0–1 on the outer ring; the inner two rings are
   decorative context (fixed, softly filled) so the shape never reads as
   empty even when progress is low. */
function GrowthRing({ progress, size = 84, tone = "brand", children }) {
  const r1 = size * 0.447;
  const r2 = size * 0.355;
  const r3 = size * 0.263;
  const circumference = 2 * Math.PI * r1;
  const clamped = Math.max(0, Math.min(1, isFinite(progress) ? progress : 0));
  const offset = circumference * (1 - clamped);
  const strokeColor = tone === "brand" ? "var(--brand-2)" : `var(--${tone})`;
  return (
    <div className="wmg-growth-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r1} fill="none" stroke="var(--hair)" strokeWidth={size * 0.079} />
        <circle cx={size / 2} cy={size / 2} r={r2} fill="none" stroke="var(--hair)" strokeWidth={size * 0.066} opacity="0.7" />
        <circle cx={size / 2} cy={size / 2} r={r3} fill="none" stroke="var(--hair)" strokeWidth={size * 0.053} opacity="0.5" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r1}
          fill="none"
          stroke={strokeColor}
          strokeWidth={size * 0.079}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children && <div className="wmg-growth-ring-inner" style={{ width: size, height: size }}>{children}</div>}
    </div>
  );
}

function StatIcon({ name }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "networth":
      return (
        <svg {...common}>
          <path d="M12 3v3M12 18v3M4.2 7.8l2.1 1.8M17.7 14.4l2.1 1.8M3 12h3M18 12h3M4.2 16.2l2.1-1.8M17.7 9.6l2.1-1.8" />
          <circle cx="12" cy="12" r="3.4" />
        </svg>
      );
    case "debt":
      return (
        <svg {...common}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
          <path d="M6 15h4" />
        </svg>
      );
    case "home":
      return (
        <svg {...common}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V10" />
        </svg>
      );
    case "savings":
      return (
        <svg {...common}>
          <path d="M4 13.5c0-3.6 3.1-6.5 7-6.5.9 0 1.8.15 2.6.44L17 5.5l1 3-2.1 1.2c1 1.1 1.6 2.4 1.6 3.8v1.7l2 1.3-1 1.5H17v1.5a1 1 0 0 1-1 1h-2.2a1 1 0 0 1-1-.86L12.5 18h-1.3l-.3 1.34a1 1 0 0 1-1 .86H7.7a1 1 0 0 1-1-1V17.5C5 16.3 4 15 4 13.5z" />
          <circle cx="14.5" cy="10.5" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pension":
      return (
        <svg {...common}>
          <path d="M12 3 4.5 6v6c0 5 3.2 8.3 7.5 9.9 4.3-1.6 7.5-4.9 7.5-9.9V6L12 3z" />
        </svg>
      );
    case "invest":
      return (
        <svg {...common}>
          <polyline points="3 17 9.5 10.5 14 15 21 6.5" />
          <polyline points="15 6.5 21 6.5 21 12.5" />
        </svg>
      );
    default:
      return null;
  }
}

function Stat({ label, value, tone = "paper", sub, icon }) {
  return (
    <Card className="wmg-stat">
      {icon && (
        <div className={`wmg-stat-icon-badge tone-${tone}`}>
          <StatIcon name={icon} />
        </div>
      )}
      <div className="wmg-eyebrow">{label}</div>
      <div className={`wmg-figure tone-${tone}`}>{value}</div>
      {sub && <div className="wmg-sub">{sub}</div>}
    </Card>
  );
}

function ProgressBar({ value, max, tone = "gold" }) {
  const pct = clamp((value / Math.max(1, max)) * 100, 0, 100);
  return (
    <div className="wmg-progress-track">
      <div className={`wmg-progress-fill tone-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Gauge({ score, variant = "light" }) {
  const cx = 110,
    cy = 118,
    r = 92;
  const theta = (180 - clamp(score, 0, 100) * 1.8) * (Math.PI / 180);
  const nx = cx + (r - 12) * Math.cos(theta);
  const ny = cy - (r - 12) * Math.sin(theta);
  const isHero = variant === "hero";
  const trackColor = isHero ? "rgba(255,255,255,0.28)" : "#EDE7DA";
  const needleColor = isHero ? "#FFFFFF" : "#142420";
  const hubFill = isHero ? "#FF8A65" : "#1F5D46";
  const hubStroke = isHero ? "#0B5A48" : "#FFFFFF";
  const gradId = isHero ? "gaugeGradHero" : "gaugeGrad";

  return (
    <svg viewBox="0 0 220 134" className="wmg-gauge" role="img" aria-label={`Financial score ${score} out of 100`}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          {isHero ? (
            <>
              <stop offset="0%" stopColor="#FF8A65" />
              <stop offset="50%" stopColor="#FFD9A0" />
              <stop offset="100%" stopColor="#BFF7E3" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#D6483A" />
              <stop offset="50%" stopColor="#9A752B" />
              <stop offset="100%" stopColor="#1F5D46" />
            </>
          )}
        </linearGradient>
      </defs>
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke={trackColor}
        strokeWidth="12"
        strokeLinecap="round"
        pathLength="100"
      />
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="12"
        strokeLinecap="round"
        pathLength="100"
        strokeDasharray={`${clamp(score, 0, 100)} 100`}
      />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={needleColor} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="6" fill={hubFill} stroke={hubStroke} strokeWidth="2" />
    </svg>
  );
}

function InfoTip({ text, light }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="wmg-infotip-wrap">
      <button
        type="button"
        className={`wmg-infotip-btn ${light ? "wmg-infotip-btn-light" : ""}`}
        aria-label="More information"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
      >
        i
      </button>
      {open && (
        <span className="wmg-infotip-bubble" role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="wmg-field">
      <label className="wmg-field-label">
        {label}
        {hint && <InfoTip text={hint} />}
      </label>
      {children}
    </div>
  );
}

function ArrayEditor({ title, items, fields, onChange, onAdd, onRemove, addLabel }) {
  return (
    <div className="wmg-array-editor">
      <div className="wmg-array-title">{title}</div>
      {items.map((item) => (
        <div className="wmg-array-row" key={item.id}>
          {fields.map((f) => (
            <input
              key={f.key}
              className="wmg-input"
              type={f.type || "text"}
              value={item[f.key]}
              placeholder={f.label}
              onChange={(e) =>
                onChange(item.id, f.key, f.type === "number" ? Number(e.target.value) : e.target.value)
              }
              style={{ flex: f.key === "name" ? 2 : 1 }}
            />
          ))}
          <button className="wmg-icon-btn" onClick={() => onRemove(item.id)} aria-label="Remove">
            ✕
          </button>
        </div>
      ))}
      <button className="wmg-add-btn" onClick={onAdd}>
        + {addLabel}
      </button>
    </div>
  );
}

function QuickImport({ onAdd }) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState("loans");
  const [preview, setPreview] = useState(null);

  const handleParse = () => {
    const rows = parseDebtLines(text).filter((r) => r.balance > 0 || r.payment > 0);
    setPreview(rows);
  };
  const handleAdd = () => {
    if (preview && preview.length) {
      onAdd(target, preview);
      setText("");
      setPreview(null);
    }
  };

  return (
    <Card>
      <div className="wmg-array-title">Quick add from text</div>
      <div className="wmg-section-desc" style={{ marginTop: -2 }}>
        No live link to any bank or credit agency — but you can paste several debts in at once instead of typing each
        field separately. One per line: name, balance, rate %, monthly payment.
      </div>
      <div className="wmg-two-col" style={{ marginBottom: 10 }}>
        <div>
          <label className="wmg-field-label">Add as</label>
          <select className="wmg-select" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="loans">Loans</option>
            <option value="cards">Credit cards</option>
          </select>
        </div>
      </div>
      <textarea
        className="wmg-input wmg-textarea"
        rows={4}
        placeholder={"Car loan, 21000, 7.9, 300\nBarclaycard, 3200, 22.9, 150"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button className="wmg-add-btn" style={{ width: "auto", flex: "1 1 160px" }} onClick={handleParse} disabled={!text.trim()}>
          Preview
        </button>
        {preview && preview.length > 0 && (
          <button className="wmg-edit-toggle" onClick={handleAdd}>
            Add {preview.length} {preview.length === 1 ? "debt" : "debts"}
          </button>
        )}
      </div>
      {preview && preview.length === 0 && (
        <div className="wmg-sub" style={{ marginTop: 10 }}>
          Couldn't find a balance or payment on any line — check the format and try again.
        </div>
      )}
      {preview && preview.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {preview.map((r, i) => (
            <div key={i} className="wmg-array-row" style={{ background: "var(--ink-3)", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--hair)" }}>
              <span style={{ flex: 2, fontSize: 12.5 }}>{r.name}</span>
              <span className="wmg-mono" style={{ flex: 1, fontSize: 12 }}>{gbp(r.balance)}</span>
              <span className="wmg-mono" style={{ flex: 1, fontSize: 12 }}>{r.rate}%</span>
              <span className="wmg-mono" style={{ flex: 1, fontSize: 12 }}>{gbp(r.payment)}/mo</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ============================ setup wizard ============================ */

const WIZARD_DATA_STEPS = ["income", "debts", "savings", "pension"];
const WIZARD_STEPS = ["welcome", ...WIZARD_DATA_STEPS, "done"];

const blankLoan = () => ({ id: nextId(), name: "", balance: 0, rate: 0, payment: 0, originalBalance: 0, lastConfirmedAt: new Date().toISOString() });
const blankGoal = () => ({ id: nextId(), name: "", target: 0, current: 0, monthlyContribution: 0, desiredMonths: null });

function WizardListEditor({ items, setItems, fields, addLabel, emptyLabel }) {
  return (
    <div className="wmg-wizard-list">
      {items.length === 0 && <div className="wmg-wizard-list-empty">{emptyLabel}</div>}
      {items.map((item) => (
        <div className="wmg-wizard-list-row" key={item.id}>
          {fields.map((f) => (
            <input
              key={f.key}
              className="wmg-input"
              type={f.type || "text"}
              inputMode={f.type === "number" ? "decimal" : undefined}
              value={item[f.key]}
              placeholder={f.label}
              onChange={(e) => {
                const v = f.type === "number" ? Number(e.target.value) : e.target.value;
                setItems((list) => list.map((it) => (it.id === item.id ? { ...it, [f.key]: v } : it)));
              }}
              style={{ flex: f.key === "name" ? 2 : 1 }}
            />
          ))}
          <button
            type="button"
            className="wmg-wizard-list-remove"
            aria-label={`Remove ${item.name || "item"}`}
            onClick={() => setItems((list) => list.filter((it) => it.id !== item.id))}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="wmg-wizard-list-add" onClick={() => setItems((list) => [...list, fields.factory()])}>
        + {addLabel}
      </button>
    </div>
  );
}

function SetupWizard({ onFinish }) {
  const [stepIdx, setStepIdx] = useState(0);
  const step = WIZARD_STEPS[stepIdx];
  const dataStepPos = WIZARD_DATA_STEPS.indexOf(step); // -1 on welcome/done

  const [income, setIncome] = useState(0);

  const [hasMortgage, setHasMortgage] = useState(false);
  const [mortgage, setMortgage] = useState({ balance: 0, rate: 4.5, payment: 0 });
  const [loans, setLoans] = useState([]);
  const [cards, setCards] = useState([]);

  const [savingsBalance, setSavingsBalance] = useState(0);
  const [emergencyFund, setEmergencyFund] = useState({ balance: 0, target: 0 });
  const [goals, setGoals] = useState([]);

  const [pension, setPension] = useState({ balance: 0, contribution: 0, currentAge: 30, retirementAge: 67 });
  const [statePensionIncluded, setStatePensionIncluded] = useState(true);

  const goNext = () => setStepIdx((i) => Math.min(WIZARD_STEPS.length - 1, i + 1));
  const goBack = () => setStepIdx((i) => Math.max(0, i - 1));

  const finishWithData = () => {
    onFinish((p) => ({
      ...p,
      income,
      mortgage: hasMortgage
        ? { ...p.mortgage, balance: mortgage.balance, rate: mortgage.rate, payment: mortgage.payment, originalBalance: mortgage.balance, lastConfirmedAt: new Date().toISOString() }
        : { ...p.mortgage, balance: 0, payment: 0, originalBalance: 0, lastConfirmedAt: new Date().toISOString() },
      loans,
      cards,
      savings: { ...p.savings, balance: savingsBalance },
      emergencyFund,
      goals,
      pension: { ...p.pension, ...pension },
      statePension: { ...p.statePension, included: statePensionIncluded },
      onboarded: true,
    }));
  };

  const skipAll = () => onFinish((p) => ({ ...p, onboarded: true }));

  return (
    <div className="wmg-onboard">
      <div className="wmg-wizard-card">
        {dataStepPos >= 0 && (
          <div className="wmg-wizard-progress">
            <div className="wmg-wizard-progress-track">
              <div
                className="wmg-wizard-progress-fill"
                style={{ width: `${((dataStepPos + 1) / WIZARD_DATA_STEPS.length) * 100}%` }}
              />
            </div>
            <div className="wmg-wizard-progress-label">
              Step {dataStepPos + 1} of {WIZARD_DATA_STEPS.length}
            </div>
          </div>
        )}

        {step === "welcome" && (
          <div className="wmg-wizard-step">
            <div className="wmg-onboard-icon">
              <NavIcon name="overview" />
            </div>
            <h2 className="wmg-onboard-title">Let's set up your picture</h2>
            <p className="wmg-onboard-body">
              A few quick questions about your income, debts, savings and pension — so your
              dashboard reflects your real numbers from the start, not example data. It takes
              about two minutes, and you can skip at any point.
            </p>
          </div>
        )}

        {step === "income" && (
          <div className="wmg-wizard-step">
            <h2 className="wmg-wizard-step-title">Your income</h2>
            <p className="wmg-wizard-step-sub">Take-home pay, after tax, from all sources.</p>
            <Field label="Monthly income">
              <input
                className="wmg-input"
                type="number"
                inputMode="decimal"
                value={income}
                onChange={(e) => setIncome(Number(e.target.value))}
                placeholder="e.g. 3200"
              />
            </Field>
          </div>
        )}

        {step === "debts" && (
          <div className="wmg-wizard-step">
            <h2 className="wmg-wizard-step-title">Debts & mortgage</h2>
            <p className="wmg-wizard-step-sub">Add anything you're paying off — leave blank if none apply.</p>

            <label className="wmg-wizard-toggle">
              <input type="checkbox" checked={hasMortgage} onChange={(e) => setHasMortgage(e.target.checked)} />
              I have a mortgage
            </label>
            {hasMortgage && (
              <div className="wmg-wizard-list-row" style={{ marginBottom: 16 }}>
                <input
                  className="wmg-input"
                  type="number"
                  inputMode="decimal"
                  placeholder="Balance"
                  value={mortgage.balance}
                  onChange={(e) => setMortgage((m) => ({ ...m, balance: Number(e.target.value) }))}
                />
                <input
                  className="wmg-input"
                  type="number"
                  inputMode="decimal"
                  placeholder="Rate %"
                  value={mortgage.rate}
                  onChange={(e) => setMortgage((m) => ({ ...m, rate: Number(e.target.value) }))}
                />
                <input
                  className="wmg-input"
                  type="number"
                  inputMode="decimal"
                  placeholder="Monthly payment"
                  value={mortgage.payment}
                  onChange={(e) => setMortgage((m) => ({ ...m, payment: Number(e.target.value) }))}
                />
              </div>
            )}

            <WizardListEditor
              items={loans}
              setItems={setLoans}
              addLabel="Add a loan"
              emptyLabel="No loans added"
              fields={Object.assign(
                [
                  { key: "name", label: "Name" },
                  { key: "balance", label: "Balance", type: "number" },
                  { key: "rate", label: "Rate %", type: "number" },
                  { key: "payment", label: "Monthly payment", type: "number" },
                ],
                { factory: blankLoan }
              )}
            />
            <WizardListEditor
              items={cards}
              setItems={setCards}
              addLabel="Add a credit card"
              emptyLabel="No credit cards added"
              fields={Object.assign(
                [
                  { key: "name", label: "Name" },
                  { key: "balance", label: "Balance", type: "number" },
                  { key: "rate", label: "Rate %", type: "number" },
                  { key: "payment", label: "Monthly payment", type: "number" },
                ],
                { factory: blankLoan }
              )}
            />
          </div>
        )}

        {step === "savings" && (
          <div className="wmg-wizard-step">
            <h2 className="wmg-wizard-step-title">Savings & goals</h2>
            <p className="wmg-wizard-step-sub">What you've already got saved, plus anything you're saving towards.</p>

            <Field label="Savings balance">
              <input
                className="wmg-input"
                type="number"
                inputMode="decimal"
                value={savingsBalance}
                onChange={(e) => setSavingsBalance(Number(e.target.value))}
                placeholder="e.g. 4000"
              />
            </Field>
            <div className="wmg-wizard-list-row" style={{ marginBottom: 16 }}>
              <input
                className="wmg-input"
                type="number"
                inputMode="decimal"
                placeholder="Emergency fund balance"
                value={emergencyFund.balance}
                onChange={(e) => setEmergencyFund((f) => ({ ...f, balance: Number(e.target.value) }))}
              />
              <input
                className="wmg-input"
                type="number"
                inputMode="decimal"
                placeholder="Emergency fund target"
                value={emergencyFund.target}
                onChange={(e) => setEmergencyFund((f) => ({ ...f, target: Number(e.target.value) }))}
              />
            </div>

            <WizardListEditor
              items={goals}
              setItems={setGoals}
              addLabel="Add a goal"
              emptyLabel="No goals added"
              fields={Object.assign(
                [
                  { key: "name", label: "Goal name" },
                  { key: "target", label: "Target", type: "number" },
                  { key: "current", label: "Saved so far", type: "number" },
                  { key: "monthlyContribution", label: "Monthly", type: "number" },
                ],
                { factory: blankGoal }
              )}
            />
          </div>
        )}

        {step === "pension" && (
          <div className="wmg-wizard-step">
            <h2 className="wmg-wizard-step-title">Pension</h2>
            <p className="wmg-wizard-step-sub">Workplace or personal pension, plus your State Pension.</p>

            <div className="wmg-wizard-list-row" style={{ marginBottom: 12 }}>
              <input
                className="wmg-input"
                type="number"
                inputMode="decimal"
                placeholder="Pension balance"
                value={pension.balance}
                onChange={(e) => setPension((p) => ({ ...p, balance: Number(e.target.value) }))}
              />
              <input
                className="wmg-input"
                type="number"
                inputMode="decimal"
                placeholder="Monthly contribution"
                value={pension.contribution}
                onChange={(e) => setPension((p) => ({ ...p, contribution: Number(e.target.value) }))}
              />
            </div>
            <div className="wmg-wizard-list-row" style={{ marginBottom: 16 }}>
              <input
                className="wmg-input"
                type="number"
                inputMode="decimal"
                placeholder="Current age"
                value={pension.currentAge}
                onChange={(e) => setPension((p) => ({ ...p, currentAge: Number(e.target.value) }))}
              />
              <input
                className="wmg-input"
                type="number"
                inputMode="decimal"
                placeholder="Retirement age"
                value={pension.retirementAge}
                onChange={(e) => setPension((p) => ({ ...p, retirementAge: Number(e.target.value) }))}
              />
            </div>
            <label className="wmg-wizard-toggle">
              <input type="checkbox" checked={statePensionIncluded} onChange={(e) => setStatePensionIncluded(e.target.checked)} />
              Include my State Pension in the forecast
            </label>
          </div>
        )}

        {step === "done" && (
          <div className="wmg-wizard-step">
            <div className="wmg-onboard-icon">
              <NavIcon name="forecast" />
            </div>
            <h2 className="wmg-onboard-title">You're all set</h2>
            <p className="wmg-onboard-body">
              Your dashboard is ready with your numbers. You can edit any of this at any time from
              its tab — nothing here is final.
            </p>
          </div>
        )}

        <div className="wmg-onboard-actions">
          {step !== "done" && (
            <button className="wmg-onboard-skip" onClick={skipAll}>
              Skip for now
            </button>
          )}
          {dataStepPos > 0 && (
            <button className="wmg-wizard-back" onClick={goBack}>
              Back
            </button>
          )}
          <button
            className="wmg-onboard-next"
            onClick={() => (step === "done" ? finishWithData() : goNext())}
          >
            {step === "welcome" ? "Get started" : step === "done" ? "Go to my dashboard" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

function useCountUp(target, duration = 700) {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevRef.current = target;
      setDisplay(target);
      return;
    }
    const start = prevRef.current;
    const end = target;
    if (start === end) return;
    const startTime = performance.now();
    let frame;
    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (end - start) * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        prevRef.current = end;
        setDisplay(end);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return display;
}

function CategoryTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  return (
    <div className="wmg-tooltip">
      <div className="wmg-tooltip-row">
        <span className="wmg-swatch" style={{ background: p.payload.fill || p.color }} />
        <span className="wmg-tooltip-name">{p.name}</span>
        <span className="wmg-tooltip-val">{gbp(p.value)}</span>
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="wmg-tooltip">
      <div className="wmg-tooltip-label">Year {label}</div>
      {payload.map((p) => (
        <div className="wmg-tooltip-row" key={p.dataKey}>
          <span className="wmg-swatch" style={{ background: p.color }} />
          <span className="wmg-tooltip-name">{p.name}</span>
          <span className="wmg-tooltip-val">{gbp(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ================================ app ================================ */

const NAV = [
  { key: "overview", label: "Overview", icon: "overview" },
  { key: "income", label: "Income & Spending", icon: "income" },
  { key: "debts", label: "Debts & Mortgage", icon: "debts" },
  { key: "goals", label: "Savings & Goals", icon: "goals" },
  { key: "pension", label: "Pension & Retirement", icon: "pension" },
  { key: "pension-reader", label: "Pension Reader", icon: "reader" },
  { key: "forecast", label: "Cash Flow Forecast", icon: "forecast" },
  { key: "education", label: "Education", icon: "education" },
];

function NavIcon({ name }) {
  const common = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
        </svg>
      );
    case "income":
      return (
        <svg {...common}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
          <path d="M6 15h4" />
        </svg>
      );
    case "debts":
      return (
        <svg {...common}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V10" />
        </svg>
      );
    case "goals":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pension":
      return (
        <svg {...common}>
          <path d="M12 3 4.5 6v6c0 5 3.2 8.3 7.5 9.9 4.3-1.6 7.5-4.9 7.5-9.9V6L12 3z" />
        </svg>
      );
    case "reader":
      return (
        <svg {...common}>
          <path d="M14.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8.5L14.5 3z" />
          <path d="M14 3v5.5h5.5" />
          <path d="M8.5 13h7" />
          <path d="M8.5 16.5h4.5" />
        </svg>
      );
    case "forecast":
      return (
        <svg {...common}>
          <polyline points="3 17 9.5 10.5 14 15 21 6.5" />
          <polyline points="15 6.5 21 6.5 21 12.5" />
        </svg>
      );
    case "education":
      return (
        <svg {...common}>
          <path d="M4 19.2A2.4 2.4 0 0 1 6.4 17H20" />
          <path d="M6.4 3H20v18H6.4A2.4 2.4 0 0 1 4 18.6V5.4A2.4 2.4 0 0 1 6.4 3z" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}

function BrandMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none">
      <defs>
        <linearGradient id="brandMarkGrad" x1="0" y1="0" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#17A184" />
          <stop offset="100%" stopColor="#0B5A48" />
        </linearGradient>
      </defs>
      <rect width="34" height="34" rx="10" fill="url(#brandMarkGrad)" />
      <path d="M8 21.5 13.2 15l4 4.2L26 10" stroke="#FFFFFF" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="26" cy="10" r="1.9" fill="#FF8A65" />
    </svg>
  );
}

export default function App() {
  const [profile, setProfile] = useState(defaultProfile);
  const [tab, setTab] = useState("overview");
  const [extraPayment, setExtraPayment] = useState(200);
  const [selectedDebtId, setSelectedDebtId] = useState(defaultProfile.loans[0].id);
  const [horizonYears, setHorizonYears] = useState(10);
  const [allocationPct, setAllocationPct] = useState(50);
  const [storageStatus, setStorageStatus] = useState("loading"); // loading | ready | unavailable | saving | saved | error
  const hasLoaded = useRef(false);
  const saveTimer = useRef(null);

  // load any previously saved household data once, on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await getData();
        if (!cancelled && result) {
          const merged = mergeWithDefaults(result);
          setProfile(merged);
          if (merged.loans && merged.loans[0]) setSelectedDebtId(merged.loans[0].id);
          setStorageStatus("ready");
        } else if (!cancelled) {
          setStorageStatus("ready");
        }
      } catch (err) {
        if (!cancelled) setStorageStatus("error");
      } finally {
        hasLoaded.current = true;
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // save the household data whenever it changes, debounced, after the initial load completes
  useEffect(() => {
    if (!hasLoaded.current) return;
    setStorageStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const result = await setData(profile);
        setStorageStatus(result ? "saved" : "error");
      } catch (err) {
        setStorageStatus("error");
      }
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [profile]);

  const [confirmingReset, setConfirmingReset] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const resetData = async () => {
    setProfile(defaultProfile);
    setSelectedDebtId(defaultProfile.loans[0].id);
    setConfirmingReset(false);
    try {
      await deleteData();
    } catch (err) {
      /* nothing to delete — fine */
    }
  };

  const allDebts = useMemo(
    () => [
      ...profile.loans.map((l) => ({ ...l, kind: "Loan", confirmedBalance: l.balance, balance: estimateBalanceToday(l.balance, l.rate, l.payment, l.lastConfirmedAt) })),
      ...profile.cards.map((c) => ({ ...c, kind: "Credit card", confirmedBalance: c.balance, balance: estimateBalanceToday(c.balance, c.rate, c.payment, c.lastConfirmedAt) })),
    ],
    [profile.loans, profile.cards]
  );

  const totals = useMemo(() => {
    const essentialCats = profile.expenseCategories.filter((c) => c.type === "essential");
    const lifestyleCats = profile.expenseCategories.filter((c) => c.type === "lifestyle");
    const sumCat = (cats) => cats.reduce((s, c) => s + c.items.reduce((s2, i) => s2 + Number(i.amount || 0), 0), 0);
    const essentialCatTotal = sumCat(essentialCats);
    const lifestyleCatTotal = sumCat(lifestyleCats);

    const loansBalance = profile.loans.reduce((s, l) => s + estimateBalanceToday(Number(l.balance || 0), l.rate, l.payment, l.lastConfirmedAt), 0);
    const loansPayment = profile.loans.reduce((s, l) => s + Number(l.payment || 0), 0);
    const cardsBalance = profile.cards.reduce((s, c) => s + estimateBalanceToday(Number(c.balance || 0), c.rate, c.payment, c.lastConfirmedAt), 0);
    const cardsPayment = profile.cards.reduce((s, c) => s + Number(c.payment || 0), 0);

    const activeSubs = profile.subscriptions.filter((s) => !s.cancelled);
    const subsTotal = activeSubs.reduce((s, x) => s + Number(x.amount || 0), 0);

    const essential = Number(profile.mortgage.payment || 0) + essentialCatTotal;
    const debtPayments = loansPayment + cardsPayment;
    const lifestyle = lifestyleCatTotal + subsTotal;
    const income = Number(profile.income || 0);
    const available = income - essential - debtPayments - lifestyle;

    const mortgageBalanceToday = estimateBalanceToday(
      Number(profile.mortgage.balance || 0),
      profile.mortgage.rate,
      profile.mortgage.payment,
      profile.mortgage.lastConfirmedAt
    );
    const homeEquity = Number(profile.homeValue || 0) - mortgageBalanceToday;
    const totalDebt = loansBalance + cardsBalance;
    const netWorth =
      homeEquity +
      Number(profile.savings.balance || 0) +
      Number(profile.investments.balance || 0) +
      Number(profile.pension.balance || 0) -
      totalDebt;

    return {
      essentialCatTotal,
      lifestyleCatTotal,
      loansBalance,
      loansPayment,
      cardsBalance,
      cardsPayment,
      subsTotal,
      essential,
      debtPayments,
      lifestyle,
      income,
      available,
      homeEquity,
      mortgageBalanceToday,
      totalDebt,
      netWorth,
    };
  }, [profile]);

  const score = useMemo(() => {
    const annualIncome = totals.income * 12 || 1;
    const savingsRate = totals.available / (totals.income || 1);
    const efMonths = profile.emergencyFund.balance / Math.max(1, totals.essential + totals.debtPayments);
    const dtiRatio = totals.totalDebt / annualIncome;
    const investRatio = (profile.pension.balance + profile.investments.balance) / annualIncome;
    const equityRatio = totals.homeEquity / Math.max(1, profile.homeValue);

    const s1 = clamp(savingsRate / 0.2, 0, 1) * 30;
    const s2 = clamp(efMonths / 6, 0, 1) * 20;
    const s3 = clamp(1 - dtiRatio, 0, 1) * 20;
    const s4 = clamp(investRatio / 2, 0, 1) * 15;
    const s5 = clamp(equityRatio / 0.5, 0, 1) * 15;

    return Math.round(s1 + s2 + s3 + s4 + s5);
  }, [totals, profile]);

  const comfortableTarget = totals.income * 0.2;
  const gap = comfortableTarget - totals.available;

  const mortgageMonths = useMemo(
    () => monthsToPayoff(totals.mortgageBalanceToday, profile.mortgage.rate, profile.mortgage.payment),
    [totals.mortgageBalanceToday, profile.mortgage]
  );

  const debtFreeMonths = useMemo(() => {
    const finite = allDebts.map((d) => monthsToPayoff(d.balance, d.rate, d.payment)).filter((m) => isFinite(m));
    return finite.length ? Math.max(...finite) : 0;
  }, [allDebts]);

  const selectedDebt = allDebts.find((d) => d.id === selectedDebtId) || allDebts[0];

  const extraCalc = useMemo(() => {
    if (!selectedDebt) return null;
    const baseMonths = monthsToPayoff(selectedDebt.balance, selectedDebt.rate, selectedDebt.payment);
    const baseInterest = totalInterestOwed(selectedDebt.balance, selectedDebt.rate, selectedDebt.payment, baseMonths);
    const newPayment = selectedDebt.payment + Number(extraPayment || 0);
    const newMonths = monthsToPayoff(selectedDebt.balance, selectedDebt.rate, newPayment);
    const newInterest = totalInterestOwed(selectedDebt.balance, selectedDebt.rate, newPayment, newMonths);
    const monthsSaved = isFinite(baseMonths) && isFinite(newMonths) ? baseMonths - newMonths : 0;
    const interestSaved = isFinite(baseInterest) && isFinite(newInterest) ? baseInterest - newInterest : 0;
    return { baseMonths, newMonths, monthsSaved, interestSaved };
  }, [selectedDebt, extraPayment]);

  const flaggedSavings = useMemo(
    () => profile.subscriptions.filter((s) => s.flagged && !s.cancelled).reduce((sum, s) => sum + Number(s.amount || 0), 0),
    [profile.subscriptions]
  );
  const flaggedCount = profile.subscriptions.filter((s) => s.flagged && !s.cancelled).length;

  const ccAnnualCost = totals.cardsBalance > 0 ? profile.cards.reduce((sum, c) => sum + (estimateBalanceToday(c.balance, c.rate, c.payment, c.lastConfirmedAt) * c.rate) / 100, 0) : 0;

  const coachTips = useMemo(() => {
    const tips = [];
    if (totals.available < 0) {
      tips.push({ tone: "rust", tab: "income", text: `You're spending ${gbp(Math.abs(totals.available))} more than comes in each month. Close that gap before anything else — start with the lifestyle column.` });
    }
    if (flaggedCount > 0) {
      tips.push({ tone: "gold", tab: "income", text: `Cancel ${flaggedCount} flagged subscriptions → save ${gbp(flaggedSavings)}/month, ${gbp(flaggedSavings * 12)} a year.` });
    }
    if (profile.emergencyFund.balance < profile.emergencyFund.target && totals.available > 0) {
      const suggestedMove = Math.max(50, Math.round(Math.min(totals.available * 0.4, profile.emergencyFund.target - profile.emergencyFund.balance) / 10) * 10);
      tips.push({ tone: "sage", tab: "goals", text: `Move ${gbp(suggestedMove)}/month into your emergency fund — you'll reach ${gbp(profile.emergencyFund.target)} in about ${Math.ceil((profile.emergencyFund.target - profile.emergencyFund.balance) / suggestedMove)} months.` });
    }
    if (ccAnnualCost > 50) {
      tips.push({ tone: "rust", tab: "debts", text: `Your credit card is costing you roughly ${gbp(ccAnnualCost)} a year in interest. Paying above the minimum here beats most savings rates.` });
    }
    if (extraCalc && isFinite(extraCalc.interestSaved) && extraCalc.interestSaved > 0) {
      tips.push({ tone: "gold", tab: "debts", text: `An extra ${gbp(extraPayment)}/month on your ${selectedDebt.name.toLowerCase()} saves roughly ${gbp(extraCalc.interestSaved)} in interest and clears it ${Math.round(extraCalc.monthsSaved)} months earlier.` });
    }
    if (totals.available > comfortableTarget) {
      tips.push({ tone: "sage", tab: "forecast", text: `You're already ${gbp(totals.available - comfortableTarget)}/month past "comfortable." Consider directing the surplus at your highest-interest debt or your pension.` });
    }
    const essentialRatio = totals.income > 0 ? totals.essential / totals.income : 0;
    if (essentialRatio > 0.6) {
      tips.push({ tone: "rust", tab: "income", text: `Essential costs are eating ${Math.round(essentialRatio * 100)}% of your income — a common guideline is keeping this under 50-60%. Worth checking bills and housing costs for anything that could realistically shrink.` });
    } else if (essentialRatio > 0 && essentialRatio < 0.45) {
      tips.push({ tone: "sage", tab: "income", text: `Essential costs are a comfortable ${Math.round(essentialRatio * 100)}% of your income — well within the usual 50-60% guideline, giving you real room to save or invest the rest.` });
    }
    const pensionContribRatio = totals.income > 0 ? profile.pension.contribution / totals.income : 0;
    if (pensionContribRatio < 0.05 && profile.pension.contribution >= 0) {
      tips.push({ tone: "gold", tab: "pension", text: `Your pension contribution is under 5% of income. If your employer offers to match a higher contribution, that's effectively free money left unclaimed — worth checking.` });
    }
    return tips;
  }, [totals, flaggedCount, flaggedSavings, profile.emergencyFund, profile.pension.contribution, ccAnnualCost, extraCalc, extraPayment, selectedDebt, comfortableTarget]);

  const forecast = useMemo(() => runForecast(profile, totals, horizonYears, allocationPct), [profile, totals, horizonYears, allocationPct]);
  const forecastBaseline = useMemo(() => runForecast(profile, totals, horizonYears, 0), [profile, totals, horizonYears]);

  const pensionMonthsToRetire = Math.max(0, (profile.pension.retirementAge - profile.pension.currentAge) * 12);
  const pensionYearsToRetire = Math.round(pensionMonthsToRetire / 12);
  const pensionScenarios = useMemo(() => {
    const rates = { low: profile.pension.growthLow, medium: profile.pension.growthMedium, high: profile.pension.growthHigh };
    const fv = {};
    Object.entries(rates).forEach(([k, r]) => {
      fv[k] = futureValue(profile.pension.balance, profile.pension.contribution, r, pensionMonthsToRetire);
    });
    const series = [];
    for (let y = 0; y <= pensionYearsToRetire; y += Math.max(1, Math.round(pensionYearsToRetire / 12))) {
      const m = y * 12;
      series.push({
        year: y,
        low: Math.round(futureValue(profile.pension.balance, profile.pension.contribution, rates.low, m)),
        medium: Math.round(futureValue(profile.pension.balance, profile.pension.contribution, rates.medium, m)),
        high: Math.round(futureValue(profile.pension.balance, profile.pension.contribution, rates.high, m)),
      });
    }
    if (series[series.length - 1]?.year !== pensionYearsToRetire) {
      series.push({
        year: pensionYearsToRetire,
        low: Math.round(fv.low),
        medium: Math.round(fv.medium),
        high: Math.round(fv.high),
      });
    }

    const inflation = profile.assumptions?.inflation ?? 0;
    const discount = Math.pow(1 + inflation / 100, pensionYearsToRetire);
    const real = {};
    const netMonthlyIncome = {};
    const grossMonthlyIncome = {};
    const combinedNetMonthlyIncome = {};

    const spIncluded = profile.statePension?.included ?? false;
    const spClaimAge = profile.statePension?.claimAge ?? 67;
    const spWeekly = profile.statePension?.weeklyAmount ?? 0;
    const spAnnualToday = spWeekly * 52;
    const spAlreadyClaimingAtRetirement = spIncluded && spClaimAge <= profile.pension.retirementAge;
    const spAnnualAtRetirement = spAlreadyClaimingAtRetirement ? spAnnualToday * discount : 0;
    const spMonthlyToday = spIncluded ? spAnnualToday / 12 : 0;

    Object.entries(fv).forEach(([k, v]) => {
      real[k] = v / discount;
      const grossAnnualDrawdown = (v * profile.pension.drawdownRate) / 100;
      const taxFreePortion = grossAnnualDrawdown * 0.25;
      const taxablePortion = grossAnnualDrawdown - taxFreePortion;
      const tax = estimateUKIncomeTax(taxablePortion);
      grossMonthlyIncome[k] = grossAnnualDrawdown / 12;
      netMonthlyIncome[k] = (grossAnnualDrawdown - tax) / 12;

      const combinedTax = estimateUKIncomeTax(taxablePortion + spAnnualAtRetirement);
      combinedNetMonthlyIncome[k] = (grossAnnualDrawdown + spAnnualAtRetirement - combinedTax) / 12;
    });

    return {
      fv,
      series,
      real,
      netMonthlyIncome,
      grossMonthlyIncome,
      combinedNetMonthlyIncome,
      statePension: { included: spIncluded, claimAge: spClaimAge, monthlyToday: spMonthlyToday, alreadyClaimingAtRetirement: spAlreadyClaimingAtRetirement },
    };
  }, [profile.pension, profile.statePension, profile.assumptions, pensionMonthsToRetire, pensionYearsToRetire]);

  /* ---------- mutation helpers ---------- */

  const updateArrayItem = (arrKey) => (id, field, value) => {
    setProfile((p) => ({ ...p, [arrKey]: p[arrKey].map((it) => (it.id === id ? { ...it, [field]: value } : it)) }));
  };
  const confirmBalance = (arrKey) => (id, newBalance) => {
    setProfile((p) => ({
      ...p,
      [arrKey]: p[arrKey].map((it) => (it.id === id ? { ...it, balance: newBalance, lastConfirmedAt: new Date().toISOString() } : it)),
    }));
  };
  const confirmMortgageBalance = (newBalance) => {
    setProfile((p) => ({ ...p, mortgage: { ...p.mortgage, balance: newBalance, lastConfirmedAt: new Date().toISOString() } }));
  };
  const addArrayItem = (arrKey, blank) => () =>
    setProfile((p) => ({ ...p, [arrKey]: [...p[arrKey], { id: nextId(), ...blank }] }));
  const addBulkItems = (arrKey, rows) =>
    setProfile((p) => ({ ...p, [arrKey]: [...p[arrKey], ...rows.map((r) => ({ id: nextId(), ...r }))] }));
  const removeArrayItem = (arrKey) => (id) =>
    setProfile((p) => ({ ...p, [arrKey]: p[arrKey].filter((it) => it.id !== id) }));

  const toggleSub = (id) =>
    setProfile((p) => ({ ...p, subscriptions: p.subscriptions.map((s) => (s.id === id ? { ...s, cancelled: !s.cancelled } : s)) }));

  const setField = (path) => (value) => {
    setProfile((p) => {
      const clone = structuredClone(p);
      let obj = clone;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      obj[path[path.length - 1]] = value;
      return clone;
    });
  };

  const addCategory = () =>
    setProfile((p) => ({
      ...p,
      expenseCategories: [...p.expenseCategories, { id: nextId(), name: "New category", type: "essential", items: [] }],
    }));
  const removeCategory = (catId) =>
    setProfile((p) => ({ ...p, expenseCategories: p.expenseCategories.filter((c) => c.id !== catId) }));
  const updateCategoryField = (catId, field, value) =>
    setProfile((p) => ({ ...p, expenseCategories: p.expenseCategories.map((c) => (c.id === catId ? { ...c, [field]: value } : c)) }));
  const addItem = (catId) =>
    setProfile((p) => ({
      ...p,
      expenseCategories: p.expenseCategories.map((c) =>
        c.id === catId ? { ...c, items: [...c.items, { id: nextId(), name: "New item", amount: 0 }] } : c
      ),
    }));
  const removeItem = (catId, itemId) =>
    setProfile((p) => ({
      ...p,
      expenseCategories: p.expenseCategories.map((c) => (c.id === catId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c)),
    }));
  const updateItem = (catId, itemId, field, value) =>
    setProfile((p) => ({
      ...p,
      expenseCategories: p.expenseCategories.map((c) =>
        c.id === catId ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, [field]: value } : i)) } : c
      ),
    }));

  const updateGoal = (id, field, value) =>
    setProfile((p) => ({ ...p, goals: p.goals.map((g) => (g.id === id ? { ...g, [field]: value } : g)) }));
  const addGoal = () =>
    setProfile((p) => ({ ...p, goals: [...p.goals, { id: nextId(), name: "New goal", target: 1000, current: 0, monthlyContribution: 50, desiredMonths: null }] }));
  const removeGoal = (id) => setProfile((p) => ({ ...p, goals: p.goals.filter((g) => g.id !== id) }));

  const updateLifeEvent = (id, field, value) =>
    setProfile((p) => ({ ...p, lifeEvents: p.lifeEvents.map((e) => (e.id === id ? { ...e, [field]: value } : e)) }));
  const addLifeEvent = () =>
    setProfile((p) => ({ ...p, lifeEvents: [...p.lifeEvents, { id: nextId(), name: "New event", yearsFromNow: 5, type: "expense", amount: 1000 }] }));
  const removeLifeEvent = (id) => setProfile((p) => ({ ...p, lifeEvents: p.lifeEvents.filter((e) => e.id !== id) }));

  const addScenario = (allocationPct) =>
    setProfile((p) => ({
      ...p,
      scenarios: [...p.scenarios, { id: nextId(), name: `Scenario ${p.scenarios.length + 1}`, allocationPct }],
    }));
  const updateScenario = (id, field, value) =>
    setProfile((p) => ({ ...p, scenarios: p.scenarios.map((s) => (s.id === id ? { ...s, [field]: value } : s)) }));
  const removeScenario = (id) => setProfile((p) => ({ ...p, scenarios: p.scenarios.filter((s) => s.id !== id) }));

  const flowSegments = [
    { key: "essential", label: "Essential", value: totals.essential, tone: "slate" },
    { key: "debt", label: "Debt", value: totals.debtPayments, tone: "rust" },
    { key: "lifestyle", label: "Lifestyle", value: totals.lifestyle, tone: "gold" },
    { key: "available", label: "Available", value: Math.max(0, totals.available), tone: "sage" },
  ];
  const flowTotal = flowSegments.reduce((s, f) => s + f.value, 0) || 1;

  const interestSavedFromAllocation = useMemo(() => {
    if (forecastBaseline.debtFreeMonth === null || forecast.debtFreeMonth === null) return null;
    return forecastBaseline.debtFreeMonth - forecast.debtFreeMonth;
  }, [forecastBaseline, forecast]);


  const animatedTopbarNetWorth = useCountUp(totals.netWorth);
  const animatedTopbarAvailable = useCountUp(totals.available);

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState("general");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("idle"); // idle | sending | sent | error

  const submitFeedbackNow = async () => {
    if (!feedbackMessage.trim()) return;
    setFeedbackStatus("sending");
    try {
      await submitFeedback({ category: feedbackCategory, message: feedbackMessage });
      setFeedbackStatus("sent");
      setFeedbackMessage("");
    } catch (err) {
      setFeedbackStatus("error");
    }
  };

  /* ================================ render ================================ */

  return (
    <div className="wmg-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

        .wmg-root {
          --ink: #F6F1E4;
          --ink-2: #FEFCF6;
          --ink-3: #EDE6D2;
          --paper: #1F3A2E;
          --paper-dim: #6B7C6F;
          --brand: #1F5D46;
          --brand-2: #3E7A5C;
          --brand-deep: #14442F;
          --brand-soft: #E3EFE6;
          --coral: #FF8A65;
          --coral-soft: #FFDFCE;
          --gold: #97721F;
          --gold-soft: #F3E7C9;
          --sage: #3E8F63;
          --sage-soft: #DCF0E2;
          --rust: #D6483A;
          --rust-soft: #FBE2DE;
          --slate: #5B6473;
          --slate-soft: #E9E7DE;
          --hair: #E3DAC2;
          --gold-fill: #E8C878;
          --sage-fill: #7FC4A0;
          --rust-fill: #E8917F;
          --slate-fill: #97A0AA;
          --coral-text: #B23A1A;
          background: var(--ink);
          color: var(--paper);
          font-family: 'Plus Jakarta Sans', sans-serif;
          min-height: 100%;
          font-variant-numeric: tabular-nums;
        }
        .wmg-root * { box-sizing: border-box; }
        .wmg-mono { font-family: 'Plus Jakarta Sans', sans-serif; font-variant-numeric: tabular-nums; }
        .wmg-serif { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; letter-spacing: -0.01em; }

        .wmg-app { display: flex; min-height: 100vh; align-items: flex-start; }
        @media (max-width: 880px) { .wmg-app { flex-direction: column; } }

        .wmg-sidebar { width: 240px; flex-shrink: 0; padding: 26px 16px; border-right: 1px solid var(--hair); position: sticky; top: 0; align-self: flex-start; height: 100vh; overflow-y: auto; background: var(--ink-2); }
        @media (max-width: 880px) {
          .wmg-sidebar { width: auto; height: auto; position: fixed; left: 14px; right: 14px; bottom: calc(14px + env(safe-area-inset-bottom)); top: auto; border: 1px solid var(--hair); border-radius: 22px; padding: 6px; box-shadow: 0 12px 28px -8px rgba(15,30,25,0.18); z-index: 20; }
        }

        .wmg-brand-block { display: flex; align-items: center; gap: 11px; margin-bottom: 26px; }
        .wmg-brand-block svg { flex-shrink: 0; }
        .wmg-brand { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 18px; font-weight: 800; letter-spacing: -0.02em; margin: 0; line-height: 1.2; color: var(--paper); }
        .wmg-brand-tagline { font-size: 10.5px; color: var(--paper-dim); margin-top: 2px; letter-spacing: 0.01em; }
        @media (max-width: 880px) { .wmg-brand-block { display: none; } }

        .wmg-nav { display: flex; flex-direction: column; gap: 3px; }
        @media (max-width: 880px) { .wmg-nav { flex-direction: row; gap: 2px; justify-content: space-around; } }
        .wmg-nav-item { display: flex; align-items: center; gap: 11px; text-align: left; background: transparent; border: none; color: var(--paper-dim); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13.5px; padding: 9px 12px; cursor: pointer; border-radius: 18px; white-space: nowrap; transition: color .15s ease, background .15s ease; }
        .wmg-nav-icon-badge { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 16px; background: var(--ink-3); color: var(--paper-dim); flex-shrink: 0; transition: background .15s ease, color .15s ease; }
        .wmg-nav-item:hover { color: var(--paper); background: var(--ink-3); }
        .wmg-nav-item.active { color: var(--paper); background: var(--brand-soft); font-weight: 700; }
        .wmg-nav-item.active .wmg-nav-icon-badge { background: var(--brand); color: #FFFFFF; }
        .wmg-nav-more { display: none; }
        @media (max-width: 880px) {
          .wmg-nav-item { flex-direction: column; gap: 3px; padding: 7px 4px; border-radius: 18px; min-width: 56px; flex: 1; }
          .wmg-nav-item span:last-child { font-size: 9px; font-weight: 600; letter-spacing: 0.01em; text-align: center; line-height: 1.15; }
          .wmg-nav-item.active { background: transparent; }
          .wmg-nav-icon-badge { width: 32px; height: 32px; }
          .wmg-nav-item-overflow { display: none; }
          .wmg-nav-more { display: flex; }
        }

        .wmg-more-sheet-backdrop { position: fixed; inset: 0; background: rgba(23,35,31,0.4); z-index: 40; display: flex; align-items: flex-end; }
        .wmg-more-sheet { width: 100%; background: var(--ink-2); border-radius: 22px 22px 0 0; padding: 10px 16px calc(20px + env(safe-area-inset-bottom)); box-shadow: 0 -10px 30px rgba(23,35,31,0.2); }
        .wmg-more-sheet-handle { width: 36px; height: 4px; border-radius: 3px; background: var(--hair); margin: 6px auto 14px; }
        .wmg-more-sheet-item { display: flex; align-items: center; gap: 14px; width: 100%; background: transparent; border: none; padding: 10px 6px; border-radius: 18px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14.5px; font-weight: 600; color: var(--paper); text-align: left; cursor: pointer; }
        .wmg-more-sheet-item.active { background: var(--brand-soft); }
        .wmg-more-sheet-item.active .wmg-nav-icon-badge { background: var(--brand); color: #FFFFFF; }
        @media (min-width: 881px) { .wmg-more-sheet-backdrop { display: none; } }
        .wmg-sidebar-foot { margin-top: 30px; padding-top: 18px; border-top: 1px solid var(--hair); font-size: 11px; color: var(--paper-dim); line-height: 1.6; }
        @media (max-width: 880px) { .wmg-sidebar-foot { display: none; } }
        .wmg-sync-row { display: flex; align-items: center; gap: 7px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 10.5px; }
        .wmg-sync-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--paper-dim); flex-shrink: 0; }
        .wmg-sync-dot.status-ready, .wmg-sync-dot.status-saved { background: var(--sage); }
        .wmg-sync-dot.status-saving, .wmg-sync-dot.status-loading { background: var(--gold); }
        .wmg-sync-dot.status-error, .wmg-sync-dot.status-unavailable { background: var(--rust); }
        .wmg-reset-btn { background: transparent; border: 1px solid var(--hair); color: var(--paper-dim); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 10.5px; font-weight: 600; padding: 7px 12px; border-radius: 999px; cursor: pointer; }
        .wmg-reset-btn:hover { border-color: var(--brand); color: var(--brand); }
        .wmg-reset-btn.danger { border-color: var(--rust); color: var(--rust); }

        .wmg-main { flex: 1; min-width: 0; padding: 0 0 70px; }
        @media (max-width: 880px) { .wmg-main { padding-bottom: 112px; } }

        .wmg-topbar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 32px; background: rgba(245,242,234,0.88); backdrop-filter: blur(8px); border-bottom: 1px solid var(--hair); flex-wrap: wrap; }
        @media (max-width: 880px) { .wmg-topbar { position: relative; padding: 16px 18px; background: transparent; backdrop-filter: none; border-bottom: none; } }
        .wmg-topbar-left { display: flex; align-items: center; gap: 10px; }
        .wmg-topbar-brand { display: none; }
        @media (max-width: 880px) { .wmg-topbar-brand { display: flex; } }
        .wmg-topbar-title { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 19px; font-weight: 800; letter-spacing: -0.015em; }
        .wmg-topbar-stats { display: flex; gap: 22px; flex-wrap: wrap; }
        .wmg-topbar-stat { text-align: right; }
        .wmg-topbar-stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--paper-dim); font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 600; }
        .wmg-topbar-stat-val { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 15px; font-weight: 700; }
        .wmg-score-chip { display: flex; align-items: center; gap: 8px; background: var(--brand-soft); border-radius: 999px; padding: 6px 14px 6px 10px; }
        .wmg-score-chip-dot { width: 8px; height: 8px; border-radius: 50%; }

        .wmg-content { padding: 24px 32px 0; }
        @media (max-width: 880px) { .wmg-content { padding: 4px 18px 0; } }

        .wmg-card { background: var(--ink-2); border: 1px solid var(--hair); border-radius: 23px; padding: 22px; box-shadow: 0 1px 2px rgba(15,30,25,0.03), 0 10px 24px -12px rgba(15,30,25,0.10); }

        .wmg-hero { background: linear-gradient(135deg, var(--brand-deep) 0%, var(--brand) 100%); border-radius: 26px; padding: 22px 24px; color: #FFFFFF; box-shadow: 0 16px 36px -16px rgba(10,70,56,0.5); margin-bottom: 16px; position: relative; }
        .wmg-hero::after { content: ""; position: absolute; top: -60px; right: -60px; width: 220px; height: 220px; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,0.14), transparent 70%); pointer-events: none; }
        .wmg-hero-label { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 700; line-height: 1.5; position: relative; z-index: 1; margin-bottom: 16px; }
        .wmg-hero-label strong { font-weight: 800; }
        .wmg-hero-main-row { display: flex; align-items: flex-end; justify-content: space-between; position: relative; z-index: 1; }
        .wmg-hero-net-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.8; font-weight: 700; margin-bottom: 3px; display: flex; align-items: center; gap: 5px; }
        .wmg-hero-net-val { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 27px; font-weight: 800; }
        .wmg-hero-net-sub { font-size: 10.5px; opacity: 0.75; margin-top: 2px; }
        .wmg-hero-score-badge { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12.5px; font-weight: 800; padding: 7px 14px; border-radius: 999px; background: rgba(255,255,255,0.2); }

        .wmg-hero-organic { background: var(--ink-3); color: var(--paper); box-shadow: none; border: 1px solid var(--hair); overflow: hidden; }
        .wmg-hero-organic::after { top: -70px; right: -90px; width: 260px; height: 260px; background: radial-gradient(circle, var(--coral-soft), transparent 70%); opacity: 0.6; }
        .wmg-hero-organic::before { content: ""; position: absolute; bottom: -90px; left: -70px; width: 220px; height: 220px; border-radius: 50%; background: radial-gradient(circle, var(--brand-soft), transparent 72%); pointer-events: none; }
        .wmg-hero-organic .wmg-hero-label { color: var(--paper); opacity: 0.85; margin-bottom: 0; margin-top: 18px; }
        .wmg-hero-ring-row { display: flex; align-items: center; gap: 18px; position: relative; z-index: 1; }
        .wmg-hero-ring-side { flex: 1; min-width: 0; }
        .wmg-hero-organic .wmg-hero-net-label { color: var(--paper-dim); opacity: 1; }
        .wmg-hero-organic .wmg-hero-net-val { color: var(--paper); }
        .wmg-hero-organic .wmg-hero-net-sub { color: var(--paper-dim); opacity: 1; }
        .wmg-growth-ring { position: relative; flex-shrink: 0; }
        .wmg-growth-ring svg circle { transition: stroke-dashoffset 0.8s cubic-bezier(0.34,1,0.4,1); }
        .wmg-growth-ring-inner { position: absolute; top: 0; left: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .wmg-hero-ring-score { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 22px; font-weight: 800; color: var(--paper); line-height: 1; }
        .wmg-hero-ring-score-label { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--paper-dim); font-weight: 700; margin-top: 2px; }

        .wmg-root { background-image: radial-gradient(circle at 8% 4%, var(--brand-soft) 0%, transparent 34%), radial-gradient(circle at 96% 22%, var(--coral-soft) 0%, transparent 28%), radial-gradient(circle at 50% 100%, var(--gold-soft) 0%, transparent 30%); background-attachment: fixed; background-repeat: no-repeat; }

        .wmg-chip-row { display: flex; gap: 8px; overflow-x: auto; margin: 0 0 8px; padding: 2px 2px 8px; }
        .wmg-chip { flex: 0 0 auto; background: var(--ink-2); border: 1px solid var(--hair); border-radius: 19px; padding: 10px 14px; min-width: 92px; }
        .wmg-chip-label { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--paper-dim); white-space: nowrap; }
        .wmg-chip-value { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 800; margin-top: 3px; white-space: nowrap; }

        .wmg-coach-single { display: flex; align-items: flex-start; gap: 10px; background: linear-gradient(135deg, var(--gold-soft), #FFFFFF 65%); border: none; text-align: left; width: 100%; font-family: inherit; }
        .wmg-coach-single p { font-size: 13.5px; line-height: 1.55; font-weight: 500; margin: 0; }
        .wmg-coach-single .wmg-coach-dot { margin-top: 5px; }
        .wmg-insight-card { display: flex; align-items: flex-start; gap: 12px; text-align: left; width: 100%; font-family: inherit; border: none; cursor: pointer; margin-bottom: 10px; }
        .wmg-insight-card p { font-size: 13.5px; line-height: 1.55; font-weight: 500; margin: 0; color: var(--paper); flex: 1; }
        .wmg-insight-rust { background: linear-gradient(135deg, var(--rust-soft), #FFFFFF 70%); }
        .wmg-insight-gold { background: linear-gradient(135deg, var(--gold-soft), #FFFFFF 70%); }
        .wmg-insight-sage { background: linear-gradient(135deg, var(--sage-soft), #FFFFFF 70%); }
        .wmg-insight-icon-badge { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 12px; flex-shrink: 0; margin-top: 1px; }
        .wmg-insight-icon-badge.tone-rust { background: var(--rust); color: #FFFFFF; }
        .wmg-insight-icon-badge.tone-gold { background: var(--gold); color: #FFFFFF; }
        .wmg-insight-icon-badge.tone-sage { background: var(--sage); color: #FFFFFF; }
        .wmg-coach-clickable { cursor: pointer; transition: transform .12s ease, box-shadow .12s ease; }
        .wmg-coach-clickable:hover { transform: translateY(-1px); box-shadow: 0 4px 14px -6px rgba(15,30,25,0.2); }
        .wmg-coach-chevron { margin-left: auto; color: var(--paper-dim); font-size: 15px; align-self: center; flex-shrink: 0; }
        .wmg-coach-more { display: block; margin: 8px auto 0; background: transparent; border: none; color: var(--brand); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12.5px; font-weight: 700; cursor: pointer; padding: 6px 10px; }
        .wmg-coach-more:hover { text-decoration: underline; }

        .wmg-section-title { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 15px; font-weight: 800; letter-spacing: -0.01em; color: var(--paper); margin: 30px 0 12px; display: flex; align-items: center; gap: 10px; }
        .wmg-section-title:first-child { margin-top: 0; }
        .wmg-section-title::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--brand); flex-shrink: 0; }
        .wmg-section-desc { font-size: 12.5px; color: var(--paper-dim); margin: -6px 0 14px; max-width: 60ch; }

        .wmg-nw-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
        @media (max-width: 900px) { .wmg-nw-grid { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 560px) { .wmg-nw-grid { grid-template-columns: repeat(2, 1fr); } }
        .wmg-stat { padding: 18px 18px; position: relative; }
        .wmg-stat .wmg-eyebrow { color: var(--paper-dim); margin-bottom: 6px; font-size: 10.5px; font-weight: 600; }
        .wmg-stat-icon-badge { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 16px; margin-bottom: 12px; }
        .wmg-stat-icon-badge.tone-gold { background: var(--gold-soft); color: var(--gold); }
        .wmg-stat-icon-badge.tone-sage { background: var(--sage-soft); color: var(--sage); }
        .wmg-stat-icon-badge.tone-rust { background: var(--rust-soft); color: var(--rust); }
        .wmg-stat-icon-badge.tone-brand { background: var(--brand-soft); color: var(--brand); }
        .wmg-stat-icon-badge.tone-slate { background: var(--slate-soft); color: var(--slate); }
        .wmg-figure { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 19px; font-weight: 700; }
        .wmg-sub { font-size: 11px; color: var(--paper-dim); margin-top: 4px; }
        .tone-paper { color: var(--paper); }
        .tone-gold { color: var(--gold); }
        .tone-sage { color: var(--sage); }
        .tone-rust { color: var(--rust); }
        .tone-slate { color: var(--slate); }
        .tone-brand { color: var(--brand); }
        .wmg-networth-card { grid-column: span 2; background: linear-gradient(135deg, var(--gold-soft), var(--ink-2) 70%); }
        @media (max-width: 560px) { .wmg-networth-card { grid-column: span 2; } }

        .wmg-flow-bar { display: flex; width: 100%; height: 38px; border-radius: 18px; overflow: hidden; }
        .wmg-flow-income-row { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
        .wmg-flow-income-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; color: var(--paper-dim); }
        .wmg-flow-income-val { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 19px; font-weight: 800; color: var(--paper); }
        .wmg-flow-seg { height: 100%; display: flex; align-items: center; justify-content: center; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; transition: width .3s ease; }
        .bg-slate { background: var(--slate-fill); color: #17231F; }
        .bg-rust { background: var(--rust-fill); color: #17231F; }
        .bg-gold { background: var(--gold-fill); color: #17231F; }
        .bg-sage { background: var(--sage-fill); color: #17231F; }
        .wmg-flow-legend { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 16px; }
        .wmg-flow-legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 500; }
        .wmg-swatch { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
        .wmg-flow-legend-val { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; margin-left: 4px; color: var(--paper-dim); }

        .wmg-category-chart-row { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
        .wmg-category-legend { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 9px; }
        .wmg-category-legend-item { display: flex; align-items: center; gap: 9px; font-size: 12.5px; }
        .wmg-category-legend-name { flex: 1; font-weight: 500; }
        .wmg-category-legend-pct { color: var(--paper-dim); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 11px; width: 32px; text-align: right; }
        .wmg-category-legend-val { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; width: 60px; text-align: right; }
        @media (max-width: 560px) { .wmg-category-chart-row { flex-direction: column; align-items: stretch; } .wmg-category-legend { width: 100%; } }

        .wmg-horizon { position: relative; height: 5px; background: var(--hair); border-radius: 3px; margin: 44px 10px 26px; }
        .wmg-horizon-point { position: absolute; top: -7px; width: 19px; height: 19px; border-radius: 50%; border: 3px solid var(--ink-2); }
        .wmg-horizon-label { position: absolute; top: -44px; font-size: 10.5px; white-space: nowrap; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; text-align: center; transform: translateX(-50%); text-transform: uppercase; letter-spacing: 0.04em; }
        .wmg-horizon-date { position: absolute; top: 18px; font-size: 12px; font-weight: 700; white-space: nowrap; transform: translateX(-50%); font-family: 'Plus Jakarta Sans', sans-serif; }

        .wmg-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 720px) { .wmg-two-col { grid-template-columns: 1fr; } }
        .wmg-three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
        @media (max-width: 780px) { .wmg-three-col { grid-template-columns: 1fr; } }

        .wmg-select { background: var(--ink-3); color: var(--paper); border: 1px solid var(--hair); border-radius: 16px; padding: 10px 12px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12.5px; width: 100%; }
        .wmg-slider-row { display: flex; align-items: center; gap: 14px; }
        .wmg-slider { flex: 1; accent-color: var(--brand); }
        .wmg-slider-val { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 700; color: var(--brand); min-width: 60px; text-align: right; }

        .wmg-calc-result { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 10px; padding-top: 14px; border-top: 1px dashed var(--hair); }
        .wmg-calc-item-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--paper-dim); font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 600; }
        .wmg-calc-item-val { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 17px; font-weight: 800; color: var(--sage); }

        .wmg-ef-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
        .wmg-progress-track { width: 100%; height: 12px; background: var(--ink-3); border-radius: 999px; overflow: hidden; }
        .wmg-progress-fill { height: 100%; border-radius: 999px; transition: width .3s ease; }
        .wmg-progress-fill.tone-gold { background: linear-gradient(90deg, var(--gold), #C9A64B); }
        .wmg-progress-fill.tone-sage { background: linear-gradient(90deg, var(--brand), var(--sage)); }

        .wmg-sub-list { display: flex; flex-direction: column; gap: 8px; }
        .wmg-sub-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: var(--ink-3); border-radius: 19px; }
        .wmg-sub-row.cancelled { opacity: 0.4; }
        .wmg-sub-left { display: flex; align-items: center; gap: 10px; }
        .wmg-sub-name { font-size: 13.5px; font-weight: 500; }
        .wmg-flag { font-size: 9.5px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; color: var(--coral-text); background: var(--coral-soft); border-radius: 999px; padding: 3px 9px; }
        .wmg-sub-amount { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13.5px; font-weight: 700; }
        .wmg-toggle-btn { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 10.5px; font-weight: 700; border: 1px solid var(--hair); background: var(--ink-2); color: var(--paper); padding: 6px 12px; border-radius: 999px; cursor: pointer; margin-left: 14px; }
        .wmg-toggle-btn.is-cancelled { border-color: var(--sage); color: var(--sage); }
        .wmg-subs-total { display: flex; justify-content: space-between; margin-top: 14px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12.5px; color: var(--paper-dim); font-weight: 600; }

        .wmg-coach { border: none; background: linear-gradient(135deg, var(--gold-soft), #FFFFFF 60%); }
        .wmg-coach-title { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 16px; margin-bottom: 12px; color: var(--paper); }
        .wmg-coach-tip { display: flex; gap: 10px; padding: 11px 0; border-top: 1px solid rgba(151,114,31,0.14); font-size: 13.5px; line-height: 1.5; }
        .wmg-coach-tip:first-of-type { border-top: none; }
        .wmg-coach-tip-clickable { background: transparent; border: none; text-align: left; width: 100%; font-family: inherit; cursor: pointer; padding-left: 22px; padding-right: 22px; }
        .wmg-coach-tip-clickable:hover { background: var(--ink-3); }
        .wmg-coach-tip-clickable:first-of-type { border-top: none; }
        .wmg-coach-dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
        .dot-gold { background: var(--gold); }
        .dot-sage { background: var(--sage); }
        .dot-rust { background: var(--rust); }

        .wmg-field-label { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--paper-dim); margin-bottom: 6px; display: block; }
        .wmg-infotip-wrap { position: relative; display: inline-block; margin-left: 5px; }
        .wmg-infotip-btn { width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--paper-dim); background: transparent; color: var(--paper-dim); font-size: 9px; font-family: 'Plus Jakarta Sans', sans-serif; font-style: italic; font-weight: 700; line-height: 1; cursor: pointer; padding: 0; display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; }
        .wmg-infotip-btn:hover, .wmg-infotip-btn:focus { border-color: var(--brand); color: var(--brand); outline: none; }
        .wmg-infotip-btn-light { border-color: rgba(255,255,255,0.6); color: rgba(255,255,255,0.9); }
        .wmg-infotip-btn-light:hover, .wmg-infotip-btn-light:focus { border-color: #FFFFFF; color: #FFFFFF; }
        .wmg-hero-score-wrap { display: flex; align-items: center; gap: 4px; }
        .wmg-infotip-bubble { position: absolute; z-index: 30; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); width: 220px; background: var(--paper); color: var(--ink); font-size: 11.5px; font-weight: 500; text-transform: none; letter-spacing: normal; line-height: 1.5; padding: 10px 12px; border-radius: 16px; box-shadow: 0 8px 20px rgba(23,35,31,0.25); }
        .wmg-infotip-bubble::after { content: ""; position: absolute; top: 100%; left: 50%; transform: translateX(-50%); border: 6px solid transparent; border-top-color: var(--paper); }
        .wmg-field { margin-bottom: 12px; }
        .wmg-input { background: var(--ink-3); color: var(--paper); border: 1px solid var(--hair); border-radius: 16px; padding: 10px 11px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12.5px; width: 100%; }
        .wmg-input:focus, .wmg-select:focus { outline: 2px solid var(--brand); outline-offset: 1px; }
        .wmg-textarea { min-height: 92px; resize: vertical; line-height: 1.6; }
        .wmg-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .wmg-add-btn:disabled:hover { border-color: var(--hair); color: var(--paper-dim); }
        .wmg-array-editor { margin-bottom: 6px; }
        .wmg-array-title { font-size: 11.5px; color: var(--paper-dim); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; font-family: 'Plus Jakarta Sans', sans-serif;}
        .wmg-array-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
        .wmg-icon-btn { background: var(--rust-soft); border: none; color: var(--rust); border-radius: 15px; width: 34px; height: 34px; cursor: pointer; flex-shrink: 0; font-weight: 700; }
        .wmg-add-btn { background: transparent; border: 1.5px dashed var(--hair); color: var(--paper-dim); border-radius: 18px; padding: 10px 12px; font-size: 11.5px; font-weight: 700; cursor: pointer; width: 100%; font-family: 'Plus Jakarta Sans', sans-serif; }
        .wmg-add-btn:hover { border-color: var(--brand); color: var(--brand); }

        .wmg-cat-card { margin-bottom: 14px; }
        .wmg-cat-head { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
        .wmg-cat-name-input { flex: 2; }
        .wmg-cat-type-select { flex: 1; }
        .wmg-cat-subtotal { display: flex; justify-content: space-between; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--hair); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12.5px; }
        .wmg-cat-subtotal-val { font-weight: 700; }
        .wmg-tag { font-size: 9.5px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 3px 9px; border-radius: 999px; color: var(--paper-dim); background: var(--ink-3); }
        .wmg-tag.essential { background: var(--slate-soft); color: var(--slate); }
        .wmg-tag.lifestyle { background: var(--coral-soft); color: var(--coral-text); }

        .wmg-goal-card { margin-bottom: 14px; }
        .wmg-goal-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; gap: 10px; flex-wrap: wrap; }
        .wmg-goal-name-input { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 16px; background: transparent; border: none; border-bottom: 1px solid transparent; color: var(--paper); padding: 2px 0; }
        .wmg-goal-name-input:focus { outline: none; border-bottom-color: var(--brand); }
        .wmg-goal-numbers { display: flex; gap: 20px; flex-wrap: wrap; margin: 12px 0; }
        .wmg-goal-plan { margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--hair); font-size: 13px; line-height: 1.6; }
        .wmg-goal-plan-highlight { color: var(--brand); font-weight: 700; }

        .wmg-debt-card { margin-bottom: 14px; }
        .wmg-debt-card-top { display: flex; align-items: center; gap: 16px; }
        .wmg-debt-ring { position: relative; width: 76px; height: 76px; flex-shrink: 0; }
        .wmg-debt-ring-label { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13px; font-weight: 800; color: var(--brand); }
        .wmg-debt-card-info { flex: 1; min-width: 0; }
        .wmg-debt-card-balance { display: flex; align-items: center; gap: 10px; margin: 4px 0 2px; }
        .wmg-debt-card-balance-val { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 21px; font-weight: 800; color: var(--paper); }
        .wmg-debt-card-edit { background: var(--ink-3); border: 1px solid var(--hair); color: var(--brand); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 11.5px; font-weight: 700; padding: 6px 12px; border-radius: 999px; cursor: pointer; flex-shrink: 0; }
        .wmg-debt-card-edit:hover { background: var(--brand-soft); border-color: var(--brand); }
        .wmg-debt-nudge { margin-top: 14px; padding: 12px 14px; background: var(--gold-soft); border-radius: 19px; font-size: 12.5px; color: var(--paper); line-height: 1.5; }
        .wmg-inline-input { width: 90px; }

        .wmg-pension-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 20px; }
        @media (max-width: 780px) { .wmg-pension-cards { grid-template-columns: 1fr; } }
        .wmg-pension-scenario-name { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
        .wmg-pension-value { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 26px; font-weight: 800; margin-bottom: 4px; }
        .wmg-pension-income { font-size: 12px; color: var(--paper-dim); }

        .wmg-tooltip { background: var(--ink-2); border: 1px solid var(--hair); border-radius: 18px; padding: 10px 12px; font-size: 12px; box-shadow: 0 8px 24px rgba(15,30,25,0.12); }
        .wmg-tooltip-label { font-family: 'Plus Jakarta Sans', sans-serif; color: var(--paper-dim); margin-bottom: 6px; font-size: 11px; font-weight: 600; }
        .wmg-tooltip-row { display: flex; align-items: center; gap: 7px; margin-top: 3px; }
        .wmg-tooltip-name { color: var(--paper-dim); }
        .wmg-tooltip-val { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; margin-left: auto; }

        .wmg-forecast-summary { display: flex; gap: 24px; flex-wrap: wrap; margin: 18px 0 6px; padding: 16px 0; border-top: 1px solid var(--hair); border-bottom: 1px solid var(--hair); }
        .wmg-forecast-note { font-size: 11.5px; color: var(--paper-dim); margin-top: 14px; line-height: 1.6; }

        .wmg-accordion-item { border-bottom: 1px solid var(--hair); }
        .wmg-accordion-item:last-child { border-bottom: none; }
        .wmg-accordion-head { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: transparent; border: none; text-align: left; padding: 14px 2px; cursor: pointer; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 700; color: var(--paper); }
        .wmg-accordion-head:hover { color: var(--brand); }
        .wmg-accordion-icon { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 16px; color: var(--brand); flex-shrink: 0; width: 18px; text-align: center; }
        .wmg-accordion-body { padding: 0 2px 16px; font-size: 13.5px; line-height: 1.65; color: var(--paper-dim); }

        .wmg-footnote { font-size: 11px; color: var(--paper-dim); margin-top: 40px; text-align: center; line-height: 1.6; }

        .wmg-onboard { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: linear-gradient(160deg, var(--brand) 0%, var(--brand-2) 55%, #1AA187 100%); }
        .wmg-onboard-card { width: 100%; max-width: 360px; background: var(--ink-2); border-radius: 24px; padding: 34px 28px 28px; text-align: center; box-shadow: 0 24px 48px -20px rgba(10,70,56,0.5); }
        .wmg-onboard-icon { width: 56px; height: 56px; border-radius: 21px; background: var(--brand-soft); color: var(--brand); display: flex; align-items: center; justify-content: center; margin: 0 auto 18px; }
        .wmg-onboard-icon svg { width: 26px; height: 26px; }
        .wmg-onboard-dots { display: flex; justify-content: center; gap: 6px; margin-bottom: 20px; }
        .wmg-onboard-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--hair); transition: all .2s ease; }
        .wmg-onboard-dot.on { background: var(--coral); width: 18px; border-radius: 3px; }
        .wmg-onboard-title { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 21px; font-weight: 800; letter-spacing: -0.01em; margin-bottom: 12px; color: var(--paper); }
        .wmg-onboard-body { font-size: 13.5px; line-height: 1.6; color: var(--paper-dim); margin-bottom: 28px; }
        .wmg-onboard-actions { display: flex; align-items: center; justify-content: center; gap: 14px; }
        .wmg-onboard-skip { background: transparent; border: none; color: var(--paper-dim); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; }
        .wmg-onboard-next { background: var(--brand); color: #FFFFFF; border: none; border-radius: 999px; padding: 13px 30px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; flex: 1; }
        .wmg-onboard-next:hover { background: var(--brand-2); }

        .wmg-btn-primary { background: var(--brand); color: #FFFFFF; border: none; border-radius: 999px; padding: 13px 22px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13.5px; font-weight: 700; cursor: pointer; }
        .wmg-btn-primary:hover { background: var(--brand-2); }
        .wmg-btn-primary:disabled { background: var(--hair); color: var(--paper-dim); cursor: not-allowed; }

        .wmg-reader-dropzone { border: 2px dashed var(--hair); border-radius: 18px; padding: 32px 20px; text-align: center; cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease; }
        .wmg-reader-dropzone:hover { border-color: var(--brand-2); background: var(--brand-soft); }
        .wmg-reader-input { display: none; }
        .wmg-reader-dropzone-title { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 700; color: var(--paper); margin-bottom: 4px; }
        .wmg-reader-dropzone-sub { font-size: 12px; color: var(--paper-dim); }
        .wmg-reader-filename { display: flex; align-items: center; justify-content: center; gap: 8px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 700; color: var(--brand-2); }
        .wmg-reader-error { color: var(--rust); font-size: 12.5px; margin-top: 12px; text-align: center; }
        .wmg-reader-analyze { width: 100%; margin-top: 16px; }
        .wmg-reader-doc-type { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 15px; font-weight: 800; color: var(--paper); }
        .wmg-reader-summary-card p { font-size: 13.5px; line-height: 1.6; color: var(--paper); }
        .wmg-reader-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; margin-bottom: 12px; }
        .wmg-reader-applied { text-align: center; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13px; font-weight: 700; color: var(--sage); padding: 12px; }

        .wmg-wizard-card { width: 100%; max-width: 460px; background: var(--ink-2); border-radius: 24px; padding: 30px 26px 26px; box-shadow: 0 24px 48px -20px rgba(10,70,56,0.5); max-height: 88vh; overflow-y: auto; }
        .wmg-wizard-progress { margin-bottom: 22px; }
        .wmg-wizard-progress-track { height: 5px; border-radius: 999px; background: var(--ink-3); overflow: hidden; }
        .wmg-wizard-progress-fill { height: 100%; background: linear-gradient(90deg, var(--brand), var(--brand-2)); border-radius: 999px; transition: width .25s ease; }
        .wmg-wizard-progress-label { font-size: 10.5px; font-weight: 700; color: var(--paper-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 7px; }
        .wmg-wizard-step { text-align: left; }
        .wmg-wizard-step .wmg-onboard-icon { margin: 0 auto 18px; }
        .wmg-wizard-step .wmg-onboard-title, .wmg-wizard-step .wmg-onboard-body { text-align: center; }
        .wmg-wizard-step-title { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 19px; font-weight: 800; letter-spacing: -0.01em; margin-bottom: 4px; color: var(--paper); }
        .wmg-wizard-step-sub { font-size: 12.5px; line-height: 1.5; color: var(--paper-dim); margin-bottom: 18px; }
        .wmg-wizard-toggle { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; color: var(--paper); margin-bottom: 16px; cursor: pointer; }
        .wmg-wizard-toggle input { width: 16px; height: 16px; accent-color: var(--brand); }
        .wmg-wizard-list { margin-bottom: 6px; }
        .wmg-wizard-list-empty { font-size: 12px; color: var(--paper-dim); margin-bottom: 10px; }
        .wmg-wizard-list-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
        .wmg-wizard-list-remove { flex-shrink: 0; width: 26px; height: 26px; border-radius: 14px; border: 1px solid var(--hair); background: transparent; color: var(--paper-dim); font-size: 16px; line-height: 1; cursor: pointer; }
        .wmg-wizard-list-remove:hover { background: var(--rust-soft); color: var(--rust); border-color: var(--rust-soft); }
        .wmg-wizard-list-add { background: var(--ink-3); border: 1px dashed var(--hair); color: var(--brand); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12px; font-weight: 700; border-radius: 16px; padding: 9px; width: 100%; cursor: pointer; margin-bottom: 18px; }
        .wmg-wizard-list-add:hover { background: var(--brand-soft); }
        .wmg-wizard-back { background: transparent; border: 1px solid var(--hair); color: var(--paper); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13px; font-weight: 700; border-radius: 999px; padding: 13px 20px; cursor: pointer; }
        @media (max-width: 480px) { .wmg-onboard { padding: 14px; } .wmg-wizard-card { padding: 24px 18px 20px; } .wmg-onboard-actions { flex-wrap: wrap; } }

        .wmg-celebration { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 50; background: linear-gradient(135deg, var(--brand), var(--brand-2)); color: #FFFFFF; padding: 13px 22px 13px 16px; border-radius: 999px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 13px; box-shadow: 0 14px 32px -10px rgba(10,70,56,0.5); display: flex; align-items: center; gap: 10px; max-width: 90vw; animation: wmg-celebration-in 0.5s cubic-bezier(0.34,1.56,0.64,1); }
        .wmg-celebration-icon { width: 22px; height: 22px; border-radius: 50%; background: rgba(255,255,255,0.22); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #FFFFFF; }
        @keyframes wmg-celebration-in { from { transform: translate(-50%, -24px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }

        .wmg-feedback-modal { width: 100%; max-width: 380px; background: var(--ink-2); border-radius: 22px; padding: 26px 24px; margin: 16px; box-shadow: 0 20px 44px -14px rgba(15,30,25,0.4); }
        .wmg-feedback-title { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 18px; font-weight: 800; margin-bottom: 6px; }
        .wmg-feedback-sub { font-size: 13px; color: var(--paper-dim); line-height: 1.55; margin-bottom: 16px; }
        .wmg-feedback-cats { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
        .wmg-feedback-cat { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 11.5px; font-weight: 700; border: 1px solid var(--hair); background: transparent; color: var(--paper-dim); padding: 7px 12px; border-radius: 999px; cursor: pointer; }
        .wmg-feedback-cat.active { background: var(--brand); border-color: var(--brand); color: #FFFFFF; }
      `}</style>

      {storageStatus !== "loading" && !profile.onboarded ? (
        <SetupWizard onFinish={setProfile} />
      ) : (
      <div className="wmg-app">
        {/* sidebar */}
        <div className="wmg-sidebar">
          <div className="wmg-brand-block">
            <BrandMark size={34} />
            <div>
              <h1 className="wmg-brand">Wealth Within</h1>
              <div className="wmg-brand-tagline">Household finance, in one place</div>
            </div>
          </div>
          <nav className="wmg-nav">
            {NAV.map((n, i) => (
              <button
                key={n.key}
                className={`wmg-nav-item ${tab === n.key ? "active" : ""} ${i >= 4 ? "wmg-nav-item-overflow" : ""}`}
                onClick={() => setTab(n.key)}
              >
                <span className="wmg-nav-icon-badge"><NavIcon name={n.icon} /></span>
                <span>{n.label}</span>
              </button>
            ))}
            <button
              className={`wmg-nav-item wmg-nav-more ${["pension", "forecast", "education"].includes(tab) ? "active" : ""}`}
              onClick={() => setMoreOpen(true)}
            >
              <span className="wmg-nav-icon-badge"><NavIcon name="more" /></span>
              <span>More</span>
            </button>
          </nav>
          {moreOpen && (
            <div className="wmg-more-sheet-backdrop" onClick={() => setMoreOpen(false)}>
              <div className="wmg-more-sheet" onClick={(e) => e.stopPropagation()}>
                <div className="wmg-more-sheet-handle" />
                {NAV.slice(4).map((n) => (
                  <button
                    key={n.key}
                    className={`wmg-more-sheet-item ${tab === n.key ? "active" : ""}`}
                    onClick={() => {
                      setTab(n.key);
                      setMoreOpen(false);
                    }}
                  >
                    <span className="wmg-nav-icon-badge"><NavIcon name={n.icon} /></span>
                    {n.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {feedbackOpen && (
            <div className="wmg-more-sheet-backdrop" style={{ alignItems: "center" }} onClick={() => setFeedbackOpen(false)}>
              <div className="wmg-feedback-modal" onClick={(e) => e.stopPropagation()}>
                {feedbackStatus === "sent" ? (
                  <>
                    <div className="wmg-feedback-title">Thanks — genuinely.</div>
                    <p className="wmg-feedback-sub">That's gone straight to me, not into the void. Appreciate you taking the time.</p>
                    <button className="wmg-onboard-next" style={{ width: "100%" }} onClick={() => setFeedbackOpen(false)}>
                      Close
                    </button>
                  </>
                ) : (
                  <>
                    <div className="wmg-feedback-title">Send feedback</div>
                    <p className="wmg-feedback-sub">What's not working, what's missing, or would you pay for this? Doesn't need to be polite.</p>
                    <div className="wmg-feedback-cats">
                      {[
                        { key: "bug", label: "Something's broken" },
                        { key: "idea", label: "Feature idea" },
                        { key: "would_pay", label: "Would I pay for this?" },
                        { key: "general", label: "General" },
                      ].map((c) => (
                        <button
                          key={c.key}
                          className={`wmg-feedback-cat ${feedbackCategory === c.key ? "active" : ""}`}
                          onClick={() => setFeedbackCategory(c.key)}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      className="wmg-input wmg-textarea"
                      placeholder="Tell me what you think..."
                      value={feedbackMessage}
                      onChange={(e) => setFeedbackMessage(e.target.value)}
                    />
                    {feedbackStatus === "error" && (
                      <div className="wmg-sub" style={{ color: "var(--rust)", marginTop: 6 }}>
                        Couldn't send that — check your connection and try again.
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                      <button className="wmg-reset-btn" onClick={() => setFeedbackOpen(false)}>
                        Cancel
                      </button>
                      <button
                        className="wmg-onboard-next"
                        style={{ flex: 1 }}
                        disabled={feedbackStatus === "sending" || !feedbackMessage.trim()}
                        onClick={submitFeedbackNow}
                      >
                        {feedbackStatus === "sending" ? "Sending…" : "Send"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          <div className="wmg-sidebar-foot">
            <div className="wmg-sync-row">
              <span className={`wmg-sync-dot status-${storageStatus}`} />
              <span>
                {storageStatus === "loading" && "Loading your data…"}
                {storageStatus === "ready" && (supabase ? "Saved to your account" : "Saved on this device")}
                {storageStatus === "saving" && "Saving…"}
                {storageStatus === "saved" && (supabase ? "Saved to your account" : "Saved on this device")}
                {storageStatus === "error" && "Couldn't save — check connection"}
              </span>
            </div>
            <p style={{ margin: "10px 0" }}>
              Figures are calculated from what you enter. Not connected to any bank, and not financial advice.
            </p>
            <p style={{ margin: "0 0 10px" }}>
              <a href="/privacy.html" target="_blank" rel="noopener" style={{ color: "var(--brand)", fontWeight: 600 }}>Privacy</a>
              {" · "}
              <a href="/terms.html" target="_blank" rel="noopener" style={{ color: "var(--brand)", fontWeight: 600 }}>Terms</a>
            </p>
            <button
              className="wmg-reset-btn"
              style={{ marginBottom: 8, borderColor: "var(--brand)", color: "var(--brand)" }}
              onClick={() => {
                setFeedbackOpen(true);
                setFeedbackStatus("idle");
              }}
            >
              Send feedback
            </button>
            {confirmingReset ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button className="wmg-reset-btn danger" onClick={resetData}>Yes, reset</button>
                <button className="wmg-reset-btn" onClick={() => setConfirmingReset(false)}>Cancel</button>
              </div>
            ) : (
              <button className="wmg-reset-btn" onClick={() => setConfirmingReset(true)}>Reset to example data</button>
            )}
            {supabase && (
              <button className="wmg-reset-btn" style={{ marginTop: 8 }} onClick={() => supabase.auth.signOut()}>
                Sign out
              </button>
            )}
          </div>
        </div>

        {/* main */}
        <div className="wmg-main">
          <div className="wmg-topbar">
            <div className="wmg-topbar-left">
              <span className="wmg-topbar-brand"><BrandMark size={26} /></span>
              <div className="wmg-topbar-title">{NAV.find((n) => n.key === tab)?.label}</div>
            </div>
            <div className="wmg-topbar-stats">
              <div className="wmg-score-chip">
                <span className="wmg-score-chip-dot" style={{ background: score >= 70 ? "var(--sage)" : score >= 45 ? "var(--gold)" : "var(--rust)" }} />
                <span className="wmg-mono" style={{ fontSize: 13, fontWeight: 600 }}>{score}/100</span>
              </div>
              <div className="wmg-topbar-stat">
                <div className="wmg-topbar-stat-label">Net worth</div>
                <div className="wmg-topbar-stat-val tone-brand">{gbp(Math.round(animatedTopbarNetWorth))}</div>
              </div>
              <div className="wmg-topbar-stat">
                <div className="wmg-topbar-stat-label">Available / mo</div>
                <div className="wmg-topbar-stat-val" style={{ color: totals.available >= 0 ? "var(--sage)" : "var(--rust)" }}>{gbp(Math.round(animatedTopbarAvailable))}</div>
              </div>
            </div>
          </div>

          <div className="wmg-content">
            {tab === "overview" && (
              <OverviewTab
                score={score}
                gap={gap}
                totals={totals}
                profile={profile}
                debtFreeMonths={debtFreeMonths}
                mortgageMonths={mortgageMonths}
                flowSegments={flowSegments}
                flowTotal={flowTotal}
                coachTips={coachTips}
                onNavigate={setTab}
              />
            )}

            {tab === "income" && (
              <IncomeTab
                profile={profile}
                totals={totals}
                setField={setField}
                addCategory={addCategory}
                removeCategory={removeCategory}
                updateCategoryField={updateCategoryField}
                addItem={addItem}
                removeItem={removeItem}
                updateItem={updateItem}
                toggleSub={toggleSub}
                updateArrayItem={updateArrayItem}
                addArrayItem={addArrayItem}
                removeArrayItem={removeArrayItem}
              />
            )}

            {tab === "debts" && (
              <DebtsTab
                profile={profile}
                totals={totals}
                setField={setField}
                updateArrayItem={updateArrayItem}
                confirmBalance={confirmBalance}
                confirmMortgageBalance={confirmMortgageBalance}
                addArrayItem={addArrayItem}
                removeArrayItem={removeArrayItem}
                allDebts={allDebts}
                mortgageMonths={mortgageMonths}
                debtFreeMonths={debtFreeMonths}
                selectedDebtId={selectedDebtId}
                setSelectedDebtId={setSelectedDebtId}
                extraPayment={extraPayment}
                setExtraPayment={setExtraPayment}
                extraCalc={extraCalc}
                addBulkItems={addBulkItems}
              />
            )}

            {tab === "goals" && (
              <GoalsTab
                profile={profile}
                setField={setField}
                updateGoal={updateGoal}
                addGoal={addGoal}
                removeGoal={removeGoal}
              />
            )}

            {tab === "pension" && (
              <PensionTab profile={profile} setField={setField} pensionScenarios={pensionScenarios} pensionYearsToRetire={pensionYearsToRetire} />
            )}

            {tab === "pension-reader" && (
              <PensionReaderTab
                onUseInPension={(result) => {
                  if (result.currentValue != null) setField(["pension", "balance"])(result.currentValue);
                  if (result.monthlyContribution != null) setField(["pension", "contribution"])(result.monthlyContribution);
                  if (result.retirementAge != null) setField(["pension", "retirementAge"])(result.retirementAge);
                }}
              />
            )}

            {tab === "forecast" && (
              <ForecastTab
                horizonYears={horizonYears}
                setHorizonYears={setHorizonYears}
                allocationPct={allocationPct}
                setAllocationPct={setAllocationPct}
                forecast={forecast}
                interestSavedFromAllocation={interestSavedFromAllocation}
                totals={totals}
                profile={profile}
                setField={setField}
                updateLifeEvent={updateLifeEvent}
                addLifeEvent={addLifeEvent}
                removeLifeEvent={removeLifeEvent}
                addScenario={addScenario}
                updateScenario={updateScenario}
                removeScenario={removeScenario}
              />
            )}

            {tab === "education" && <EducationTab />}

            <div className="wmg-footnote">
              This dashboard is illustrative and calculated entirely from the numbers you enter. It is not connected to
              any bank or pension provider, and nothing here is financial advice. Data resets if you reload the page.
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

/* ============================== tabs ============================== */

function OverviewTab({ score, gap, totals, profile, debtFreeMonths, mortgageMonths, flowSegments, flowTotal, coachTips, onNavigate }) {
  const [showAllTips, setShowAllTips] = useState(false);
  const scoreTone = score >= 70 ? "sage" : score >= 45 ? "gold" : "rust";
  const animatedNetWorth = useCountUp(totals.netWorth);
  const animatedScore = useCountUp(score, 500);
  const scoreExplainer =
    "Not just this month's cash flow — it's a blend of five things: how much you're saving each month (30%), how well-funded your emergency fund is (20%), how much debt you're carrying relative to your income (20%), your pension and investments relative to your income (15%), and how much of your home you actually own outright (15%). Being close to \"comfortable\" on cash flow alone doesn't lift the score much if debt or savings are still catching up.";

  const chips = [
    { label: "Debt-free", value: isFinite(debtFreeMonths) ? addMonths(debtFreeMonths) : "—" },
    { label: "Mortgage-free", value: isFinite(mortgageMonths) ? addMonths(mortgageMonths) : "—" },
    { label: "Available / mo", value: gbp(totals.available) },
    { label: "Debt", value: gbp(totals.totalDebt) },
    { label: "Home equity", value: gbp(totals.homeEquity) },
    { label: "Savings", value: gbp(profile.savings.balance) },
    { label: "Pension", value: gbp(profile.pension.balance) },
    { label: "Investments", value: gbp(profile.investments.balance) },
  ];

  return (
    <>
      <div className="wmg-hero wmg-hero-organic">
        <div className="wmg-hero-ring-row">
          <GrowthRing progress={score / 100} size={92} tone={scoreTone}>
            <div className="wmg-hero-ring-score">{Math.round(animatedScore)}</div>
            <div className="wmg-hero-ring-score-label">score</div>
          </GrowthRing>
          <div className="wmg-hero-ring-side">
            <div className="wmg-hero-net-label">
              Net worth <InfoTip text={scoreExplainer} light />
            </div>
            <div className="wmg-hero-net-val">{gbp(Math.round(animatedNetWorth))}</div>
            <div className="wmg-hero-net-sub">What you own, minus what you owe</div>
          </div>
        </div>
        <div className="wmg-hero-label">
          {gap > 0 ? (
            <>You're <strong>{gbp(Math.round(gap))}/month</strong> away from being financially comfortable.</>
          ) : (
            <>You're <strong>{gbp(Math.round(-gap))}/month</strong> past "comfortable." Put the surplus to work.</>
          )}
        </div>
      </div>

      <div className="wmg-chip-row">
        {chips.map((c) => (
          <div className="wmg-chip" key={c.label}>
            <div className="wmg-chip-label">{c.label}</div>
            <div className="wmg-chip-value">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="wmg-section-title">This month</div>
      <Card>
        <div className="wmg-flow-income-row">
          <div className="wmg-flow-income-label">Income</div>
          <div className="wmg-flow-income-val">{gbp(totals.income)}</div>
        </div>
        <div className="wmg-flow-bar">
          {flowSegments.map((seg) => (
            <div key={seg.key} className={`wmg-flow-seg bg-${seg.tone}`} style={{ width: `${(seg.value / flowTotal) * 100}%` }}>
              {(seg.value / flowTotal) * 100 > 8 ? gbp(seg.value) : ""}
            </div>
          ))}
        </div>
        <div className="wmg-flow-legend">
          {flowSegments.map((seg) => (
            <div className="wmg-flow-legend-item" key={seg.key}>
              <span className="wmg-swatch" style={{ background: `var(--${seg.tone}-fill)` }} />
              {seg.label} <span className="wmg-flow-legend-val">{gbp(seg.value)}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="wmg-section-title">Your coach</div>
      {coachTips.length === 0 ? (
        <Card className="wmg-insight-card wmg-insight-sage">
          <span className="wmg-insight-icon-badge tone-sage">✓</span>
          <p>Everything's in decent shape. Keep going.</p>
        </Card>
      ) : (
        <>
          {coachTips.slice(0, 3).map((tip, i) => (
            <button className={`wmg-card wmg-insight-card wmg-insight-${tip.tone} wmg-coach-clickable`} key={i} onClick={() => onNavigate?.(tip.tab)}>
              <span className={`wmg-insight-icon-badge tone-${tip.tone}`}>{tip.tone === "rust" ? "!" : tip.tone === "sage" ? "✓" : "i"}</span>
              <p>{tip.text}</p>
              <span className="wmg-coach-chevron">→</span>
            </button>
          ))}
          {coachTips.length > 3 && !showAllTips && (
            <button className="wmg-coach-more" onClick={() => setShowAllTips(true)}>
              + {coachTips.length - 3} more {coachTips.length - 3 === 1 ? "insight" : "insights"}
            </button>
          )}
          {showAllTips &&
            coachTips.slice(3).map((tip, i) => (
              <button className={`wmg-card wmg-insight-card wmg-insight-${tip.tone} wmg-coach-clickable`} key={`more-${i}`} onClick={() => onNavigate?.(tip.tab)}>
                <span className={`wmg-insight-icon-badge tone-${tip.tone}`}>{tip.tone === "rust" ? "!" : tip.tone === "sage" ? "✓" : "i"}</span>
                <p>{tip.text}</p>
                <span className="wmg-coach-chevron">→</span>
              </button>
            ))}
        </>
      )}
    </>
  );
}

const CATEGORY_COLORS = ["#1F5D46", "#FF8A65", "#B7924B", "#5B6473", "#7C5CBF", "#2E86AB", "#C1594A", "#3D8F72", "#A64D79", "#8B95A3"];

function IncomeTab({ profile, totals, setField, addCategory, removeCategory, updateCategoryField, addItem, removeItem, updateItem, toggleSub, updateArrayItem, addArrayItem, removeArrayItem }) {
  const categoryChartData = useMemo(() => {
    const rows = profile.expenseCategories
      .map((cat) => ({ name: cat.name, value: cat.items.reduce((s, i) => s + Number(i.amount || 0), 0) }))
      .filter((r) => r.value > 0);
    if (totals.subsTotal > 0) rows.push({ name: "Subscriptions", value: totals.subsTotal });
    return rows.sort((a, b) => b.value - a.value);
  }, [profile.expenseCategories, totals.subsTotal]);
  const categoryChartTotal = categoryChartData.reduce((s, r) => s + r.value, 0) || 1;

  return (
    <>
      <div className="wmg-section-title">Income</div>
      <Card>
        <div className="wmg-two-col">
          <Field label="Monthly take-home income">
            <input className="wmg-input" type="number" value={profile.income} onChange={(e) => setField(["income"])(Number(e.target.value))} />
          </Field>
          <div>
            <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>This month, total spend</div>
            <div className="wmg-figure tone-paper">{gbp(totals.essential + totals.debtPayments + totals.lifestyle)}</div>
          </div>
        </div>
      </Card>

      {categoryChartData.length > 0 && (
        <>
          <div className="wmg-section-title">Where it actually goes</div>
          <Card>
            <div className="wmg-category-chart-row">
              <div style={{ width: 160, height: 160, flexShrink: 0 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={categoryChartData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2} strokeWidth={0}>
                      {categoryChartData.map((entry, i) => (
                        <Cell key={entry.name} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CategoryTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="wmg-category-legend">
                {categoryChartData.map((row, i) => (
                  <div className="wmg-category-legend-item" key={row.name}>
                    <span className="wmg-swatch" style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                    <span className="wmg-category-legend-name">{row.name}</span>
                    <span className="wmg-category-legend-pct">{Math.round((row.value / categoryChartTotal) * 100)}%</span>
                    <span className="wmg-category-legend-val">{gbp(row.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </>
      )}

      <div className="wmg-section-title">Expenditure, by category</div>
      <div className="wmg-section-desc">Add every category and line item that applies to your household. Mark each category essential or lifestyle — this drives your score and cash flow.</div>
      {profile.expenseCategories.map((cat) => {
        const subtotal = cat.items.reduce((s, i) => s + Number(i.amount || 0), 0);
        return (
          <Card className="wmg-cat-card" key={cat.id}>
            <div className="wmg-cat-head">
              <input
                className="wmg-input wmg-cat-name-input"
                value={cat.name}
                onChange={(e) => updateCategoryField(cat.id, "name", e.target.value)}
              />
              <select
                className="wmg-select wmg-cat-type-select"
                value={cat.type}
                onChange={(e) => updateCategoryField(cat.id, "type", e.target.value)}
              >
                <option value="essential">Essential</option>
                <option value="lifestyle">Lifestyle</option>
              </select>
              <span className={`wmg-tag ${cat.type}`}>{cat.type}</span>
              <button className="wmg-icon-btn" onClick={() => removeCategory(cat.id)} aria-label="Remove category">✕</button>
            </div>
            {cat.items.map((item) => (
              <div className="wmg-array-row" key={item.id}>
                <input
                  className="wmg-input"
                  style={{ flex: 2 }}
                  value={item.name}
                  onChange={(e) => updateItem(cat.id, item.id, "name", e.target.value)}
                />
                <input
                  className="wmg-input"
                  type="number"
                  style={{ flex: 1 }}
                  value={item.amount}
                  onChange={(e) => updateItem(cat.id, item.id, "amount", Number(e.target.value))}
                />
                <button className="wmg-icon-btn" onClick={() => removeItem(cat.id, item.id)} aria-label="Remove item">✕</button>
              </div>
            ))}
            <button className="wmg-add-btn" onClick={() => addItem(cat.id)}>+ Add item</button>
            <div className="wmg-cat-subtotal">
              <span style={{ color: "var(--paper-dim)" }}>Subtotal</span>
              <span className="wmg-cat-subtotal-val">{gbp(subtotal)}/month</span>
            </div>
          </Card>
        );
      })}
      <button className="wmg-add-btn" onClick={addCategory} style={{ marginBottom: 8 }}>+ Add category</button>

      <div className="wmg-section-title">Subscriptions</div>
      <Card>
        <div className="wmg-sub-list">
          {profile.subscriptions.map((s) => (
            <div key={s.id} className={`wmg-sub-row ${s.cancelled ? "cancelled" : ""}`}>
              <div className="wmg-sub-left">
                <input
                  className="wmg-input"
                  style={{ width: 160 }}
                  value={s.name}
                  onChange={(e) => updateArrayItem("subscriptions")(s.id, "name", e.target.value)}
                />
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--paper-dim)" }}>
                  <input type="checkbox" checked={s.flagged} onChange={(e) => updateArrayItem("subscriptions")(s.id, "flagged", e.target.checked)} />
                  flag
                </label>
                {s.flagged && !s.cancelled && <span className="wmg-flag">Consider cutting</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  className="wmg-input"
                  type="number"
                  style={{ width: 80 }}
                  value={s.amount}
                  onChange={(e) => updateArrayItem("subscriptions")(s.id, "amount", Number(e.target.value))}
                />
                <button
                  className={`wmg-toggle-btn ${s.cancelled ? "is-cancelled" : ""}`}
                  onClick={() => toggleSub(s.id)}
                  title={s.cancelled ? "Bring this back into your monthly total" : "Stops counting it in your total — doesn't cancel it with the actual provider, and you can bring it back anytime"}
                >
                  {s.cancelled ? "Restore" : "Mark cancelled"}
                </button>
                <button
                  className="wmg-icon-btn"
                  onClick={() => removeArrayItem("subscriptions")(s.id)}
                  aria-label="Remove"
                  title="Delete this row completely — use this if you added it by mistake, not for cancelling a subscription you actually have"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
        <button className="wmg-add-btn" onClick={addArrayItem("subscriptions", { name: "New subscription", amount: 0, flagged: false, cancelled: false })} style={{ marginTop: 10 }}>
          + Add subscription
        </button>
        <div className="wmg-subs-total">
          <span>Active total</span>
          <span>{gbp(totals.subsTotal, 2)}/month</span>
        </div>
      </Card>
    </>
  );
}

function DebtCard({ debt, onEdit, onConfirm, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draftBalance, setDraftBalance] = useState(debt.balance);
  const estimatedToday = estimateBalanceToday(debt.balance, debt.rate, debt.payment, debt.lastConfirmedAt);
  const original = debt.originalBalance || debt.balance || 1;
  const progress = clamp(1 - estimatedToday / original, 0, 1);
  const days = daysSince(debt.lastConfirmedAt);
  const needsCheck = days >= 30;
  const changed = Math.abs(estimatedToday - debt.balance) > 1;
  const circumference = 2 * Math.PI * 30;

  const finishConfirm = () => {
    onConfirm(draftBalance);
    setEditing(false);
  };

  return (
    <Card className="wmg-debt-card">
      <div className="wmg-debt-card-top">
        <GrowthRing progress={progress} size={76} tone="brand">
          <div className="wmg-debt-ring-label">{Math.round(progress * 100)}%</div>
        </GrowthRing>
        <div className="wmg-debt-card-info">
          <input className="wmg-goal-name-input" value={debt.name} onChange={(e) => onEdit("name", e.target.value)} />
          <div className="wmg-debt-card-balance">
            {editing ? (
              <>
                <input
                  className="wmg-input wmg-inline-input"
                  type="number"
                  autoFocus
                  value={draftBalance}
                  onChange={(e) => setDraftBalance(Number(e.target.value))}
                  onKeyDown={(e) => e.key === "Enter" && finishConfirm()}
                />
                <button className="wmg-debt-card-edit" onClick={finishConfirm}>Save</button>
              </>
            ) : (
              <>
                <span className="wmg-debt-card-balance-val">{gbp(estimatedToday)}</span>
                <button
                  className="wmg-debt-card-edit"
                  onClick={() => {
                    setDraftBalance(Math.round(estimatedToday));
                    setEditing(true);
                  }}
                >
                  Edit
                </button>
              </>
            )}
          </div>
          <div className="wmg-sub">
            {changed ? "Estimated today \u2014 confirmed " : "Confirmed "}
            {gbp(debt.balance)} {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}
          </div>
        </div>
        <button className="wmg-icon-btn" onClick={onRemove} aria-label="Remove">✕</button>
      </div>

      <div className="wmg-two-col" style={{ marginTop: 12 }}>
        <Field label="Rate %" hint="The interest rate this debt charges each year — sometimes called APR. You'll find it on your credit agreement, statement, or the provider's app.">
          <input className="wmg-input" type="number" step="0.1" value={debt.rate} onChange={(e) => onEdit("rate", Number(e.target.value))} />
        </Field>
        <Field label="Monthly payment">
          <input className="wmg-input" type="number" value={debt.payment} onChange={(e) => onEdit("payment", Number(e.target.value))} />
        </Field>
      </div>

      {needsCheck && !editing && (
        <div className="wmg-debt-nudge">
          It's been {days} days since you confirmed this — still about {gbp(Math.round(estimatedToday))}?
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="wmg-onboard-next" style={{ padding: "8px 16px", fontSize: 12.5, flex: "none" }} onClick={() => onConfirm(estimatedToday)}>
              Yes, still about right
            </button>
            <button
              className="wmg-reset-btn"
              onClick={() => {
                setDraftBalance(Math.round(estimatedToday));
                setEditing(true);
              }}
            >
              It's changed
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DebtsTab({ profile, totals, setField, updateArrayItem, confirmBalance, confirmMortgageBalance, addArrayItem, removeArrayItem, allDebts, mortgageMonths, debtFreeMonths, selectedDebtId, setSelectedDebtId, extraPayment, setExtraPayment, extraCalc, addBulkItems }) {
  const selectedDebt = allDebts.find((d) => d.id === selectedDebtId) || allDebts[0];
  const [celebration, setCelebration] = useState(null);
  const celebrationTimer = useRef(null);
  const [editingMortgage, setEditingMortgage] = useState(false);
  const [mortgageDraft, setMortgageDraft] = useState(profile.mortgage.balance);
  const mortgageDaysSince = daysSince(profile.mortgage.lastConfirmedAt);
  const mortgageChanged = Math.abs((totals?.mortgageBalanceToday ?? profile.mortgage.balance) - profile.mortgage.balance) > 1;

  const makeCelebratingChange = (arrKey, list) => (id, field, value) => {
    if (field === "balance" && Number(value) <= 0) {
      const debt = list.find((d) => d.id === id);
      if (debt && Number(debt.balance) > 0) {
        setCelebration(debt.name);
        if (celebrationTimer.current) window.clearTimeout(celebrationTimer.current);
        celebrationTimer.current = window.setTimeout(() => setCelebration(null), 5000);
      }
    }
    updateArrayItem(arrKey)(id, field, value);
  };

  return (
    <>
      {celebration && (
        <div className="wmg-celebration">
          <span className="wmg-celebration-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          {celebration} is paid off — one less thing to worry about.
        </div>
      )}
      <div className="wmg-section-title">Mortgage</div>
      <Card>
        <div className="wmg-three-col">
          <div>
            <label className="wmg-field-label">Balance outstanding</label>
            {editingMortgage ? (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="wmg-input"
                  type="number"
                  autoFocus
                  value={mortgageDraft}
                  onChange={(e) => setMortgageDraft(Number(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      confirmMortgageBalance(mortgageDraft);
                      setEditingMortgage(false);
                    }
                  }}
                />
                <button
                  className="wmg-debt-card-edit"
                  onClick={() => {
                    confirmMortgageBalance(mortgageDraft);
                    setEditingMortgage(false);
                  }}
                >
                  Save
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  className="wmg-input"
                  type="number"
                  value={profile.mortgage.balance}
                  onChange={(e) => confirmMortgageBalance(Number(e.target.value))}
                />
                <button
                  className="wmg-debt-card-edit"
                  onClick={() => {
                    setMortgageDraft(Math.round(totals?.mortgageBalanceToday ?? profile.mortgage.balance));
                    setEditingMortgage(true);
                  }}
                >
                  Confirm
                </button>
              </div>
            )}
            <div className="wmg-sub" style={{ marginTop: 4 }}>
              {mortgageChanged ? `Estimated today: ${gbp(totals?.mortgageBalanceToday ?? profile.mortgage.balance)} — ` : ""}
              confirmed {gbp(profile.mortgage.balance)} {mortgageDaysSince === 0 ? "today" : `${mortgageDaysSince} day${mortgageDaysSince === 1 ? "" : "s"} ago`}
            </div>
          </div>
          <Field label="Interest rate (%)">
            <input className="wmg-input" type="number" step="0.1" value={profile.mortgage.rate} onChange={(e) => setField(["mortgage", "rate"])(Number(e.target.value))} />
          </Field>
          <Field label="Monthly payment">
            <input className="wmg-input" type="number" value={profile.mortgage.payment} onChange={(e) => setField(["mortgage", "payment"])(Number(e.target.value))} />
          </Field>
        </div>
        <div className="wmg-three-col">
          <Field label="Estimated home value">
            <input className="wmg-input" type="number" value={profile.homeValue} onChange={(e) => setField(["homeValue"])(Number(e.target.value))} />
          </Field>
          <Field label="Assumed annual house price growth (%)">
            <input className="wmg-input" type="number" step="0.1" value={profile.homeValueGrowth} onChange={(e) => setField(["homeValueGrowth"])(Number(e.target.value))} />
          </Field>
          <div>
            <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Mortgage-free</div>
            <div className="wmg-figure tone-sage">{isFinite(mortgageMonths) ? addMonths(mortgageMonths) : "—"}</div>
          </div>
        </div>
        <div className="wmg-two-col" style={{ marginTop: 4 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--paper-dim)" }}>
            <input
              type="checkbox"
              checked={profile.mortgage.allowOverpayment}
              onChange={(e) => setField(["mortgage", "allowOverpayment"])(e.target.checked)}
            />
            Let the Cash Flow Forecast put spare surplus toward the mortgage too, not just loans and cards
          </label>
          {profile.mortgage.allowOverpayment && (
            <Field
              label="Penalty-free overpayment allowance (% of balance/year)"
              hint="Most mortgages let you pay extra off the balance up to a limit each year — usually 10% — without being charged a fee. Check your mortgage documents or ask your lender for your actual limit."
            >
              <input
                className="wmg-input"
                type="number"
                step="1"
                value={profile.mortgage.overpaymentCapPct}
                onChange={(e) => setField(["mortgage", "overpaymentCapPct"])(Number(e.target.value))}
              />
            </Field>
          )}
        </div>
      </Card>

      <div className="wmg-section-title">Quick add</div>
      <QuickImport onAdd={addBulkItems} />

      <div className="wmg-section-title">Loans</div>
      {profile.loans.map((loan) => (
        <DebtCard
          key={loan.id}
          debt={loan}
          onEdit={(field, value) => updateArrayItem("loans")(loan.id, field, value)}
          onConfirm={(newBalance) => {
            if (Number(newBalance) <= 0 && Number(loan.balance) > 0) {
              setCelebration(loan.name);
              if (celebrationTimer.current) window.clearTimeout(celebrationTimer.current);
              celebrationTimer.current = window.setTimeout(() => setCelebration(null), 5000);
            }
            confirmBalance("loans")(loan.id, newBalance);
          }}
          onRemove={() => removeArrayItem("loans")(loan.id)}
        />
      ))}
      <button
        className="wmg-add-btn"
        onClick={addArrayItem("loans", { name: "New loan", balance: 0, rate: 0, payment: 0, originalBalance: 0, lastConfirmedAt: new Date().toISOString() })}
      >
        + Add loan
      </button>

      <div className="wmg-section-title">Credit cards</div>
      {profile.cards.map((card) => (
        <DebtCard
          key={card.id}
          debt={card}
          onEdit={(field, value) => updateArrayItem("cards")(card.id, field, value)}
          onConfirm={(newBalance) => {
            if (Number(newBalance) <= 0 && Number(card.balance) > 0) {
              setCelebration(card.name);
              if (celebrationTimer.current) window.clearTimeout(celebrationTimer.current);
              celebrationTimer.current = window.setTimeout(() => setCelebration(null), 5000);
            }
            confirmBalance("cards")(card.id, newBalance);
          }}
          onRemove={() => removeArrayItem("cards")(card.id)}
        />
      ))}
      <button
        className="wmg-add-btn"
        onClick={addArrayItem("cards", { name: "New card", balance: 0, rate: 0, payment: 0, originalBalance: 0, lastConfirmedAt: new Date().toISOString() })}
      >
        + Add credit card
      </button>

      <div className="wmg-section-title">Debt-free calculator</div>
      <Card>
        <div className="wmg-eyebrow" style={{ marginBottom: 10 }}>Debt-free date, at current payments: <span className="wmg-mono" style={{ color: "var(--paper)" }}>{isFinite(debtFreeMonths) ? addMonths(debtFreeMonths) : "—"}</span></div>
        <div className="wmg-two-col">
          <div>
            <label className="wmg-field-label">Target debt</label>
            <select className="wmg-select" value={selectedDebtId} onChange={(e) => setSelectedDebtId(Number(e.target.value))}>
              {allDebts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {gbp(d.balance)} at {d.rate}%
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="wmg-field-label">Extra payment / month</label>
            <div className="wmg-slider-row">
              <input type="range" min="0" max="500" step="10" value={extraPayment} className="wmg-slider" onChange={(e) => setExtraPayment(Number(e.target.value))} />
              <div className="wmg-slider-val">{gbp(extraPayment)}</div>
            </div>
          </div>
        </div>
        {extraCalc && selectedDebt && (
          <div className="wmg-calc-result">
            <div>
              <div className="wmg-calc-item-label">Interest saved</div>
              <div className="wmg-calc-item-val">{isFinite(extraCalc.interestSaved) ? gbp(Math.round(extraCalc.interestSaved)) : "—"}</div>
            </div>
            <div>
              <div className="wmg-calc-item-label">Cleared earlier by</div>
              <div className="wmg-calc-item-val">{isFinite(extraCalc.monthsSaved) ? `${Math.round(extraCalc.monthsSaved)} months` : "—"}</div>
            </div>
            <div>
              <div className="wmg-calc-item-label">New payoff date</div>
              <div className="wmg-calc-item-val" style={{ color: "var(--paper)" }}>{isFinite(extraCalc.newMonths) ? addMonths(extraCalc.newMonths) : "—"}</div>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function GoalsTab({ profile, setField, updateGoal, addGoal, removeGoal }) {
  return (
    <>
      <div className="wmg-section-title">Emergency fund</div>
      <Card>
        <div className="wmg-ef-row">
          <span className="wmg-mono" style={{ fontSize: 19, fontWeight: 600 }}>{gbp(profile.emergencyFund.balance)}</span>
          <span style={{ color: "var(--paper-dim)", fontSize: 12.5 }}>of {gbp(profile.emergencyFund.target)} target</span>
        </div>
        <ProgressBar value={profile.emergencyFund.balance} max={profile.emergencyFund.target} tone="sage" />
        <div className="wmg-two-col" style={{ marginTop: 14 }}>
          <Field label="Current balance">
            <input className="wmg-input" type="number" value={profile.emergencyFund.balance} onChange={(e) => setField(["emergencyFund", "balance"])(Number(e.target.value))} />
          </Field>
          <Field label="Target (3–6 months essentials)">
            <input className="wmg-input" type="number" value={profile.emergencyFund.target} onChange={(e) => setField(["emergencyFund", "target"])(Number(e.target.value))} />
          </Field>
        </div>
      </Card>

      <div className="wmg-section-title">Savings goals</div>
      <div className="wmg-section-desc">Set a target for anything you're saving towards, and see when you'll get there — or what it takes to hit a date you choose.</div>
      {profile.goals.map((g) => {
        const monthsAtPace = g.monthlyContribution > 0 ? Math.ceil((g.target - g.current) / g.monthlyContribution) : Infinity;
        const desired = g.desiredMonths && g.desiredMonths > 0 ? g.desiredMonths : Math.max(1, Math.round(isFinite(monthsAtPace) ? monthsAtPace : 12));
        const requiredMonthly = (g.target - g.current) / desired;
        return (
          <Card className="wmg-goal-card" key={g.id}>
            <div className="wmg-goal-head">
              <input className="wmg-goal-name-input" value={g.name} onChange={(e) => updateGoal(g.id, "name", e.target.value)} />
              <button className="wmg-icon-btn" onClick={() => removeGoal(g.id)} aria-label="Remove goal">✕</button>
            </div>
            <ProgressBar value={g.current} max={g.target} tone="gold" />
            <div className="wmg-goal-numbers">
              <Field label="Saved so far">
                <input className="wmg-input" type="number" value={g.current} onChange={(e) => updateGoal(g.id, "current", Number(e.target.value))} />
              </Field>
              <Field label="Target">
                <input className="wmg-input" type="number" value={g.target} onChange={(e) => updateGoal(g.id, "target", Number(e.target.value))} />
              </Field>
              <Field label="Saving / month">
                <input className="wmg-input" type="number" value={g.monthlyContribution} onChange={(e) => updateGoal(g.id, "monthlyContribution", Number(e.target.value))} />
              </Field>
            </div>
            <div className="wmg-goal-plan">
              At {gbp(g.monthlyContribution)}/month, you'll reach {gbp(g.target)} by{" "}
              <span className="wmg-goal-plan-highlight">{isFinite(monthsAtPace) ? addMonths(monthsAtPace) : "—"}</span>.
              <br />
              Or, choose a timeframe: reach it in{" "}
              <input
                className="wmg-input wmg-inline-input"
                type="number"
                value={g.desiredMonths ?? Math.max(1, Math.round(isFinite(monthsAtPace) ? monthsAtPace : 12))}
                onChange={(e) => updateGoal(g.id, "desiredMonths", Number(e.target.value))}
                style={{ display: "inline-block", margin: "0 6px" }}
              />{" "}
              months by saving <span className="wmg-goal-plan-highlight">{gbp(Math.max(0, requiredMonthly))}</span>/month.
            </div>
          </Card>
        );
      })}
      <button className="wmg-add-btn" onClick={addGoal}>+ Add savings goal</button>
    </>
  );
}

function PensionTab({ profile, setField, pensionScenarios, pensionYearsToRetire }) {
  return (
    <>
      <div className="wmg-section-title">Pension details</div>
      <Card>
        <div className="wmg-three-col">
          <Field label="Current pot value">
            <input className="wmg-input" type="number" value={profile.pension.balance} onChange={(e) => setField(["pension", "balance"])(Number(e.target.value))} />
          </Field>
          <Field label="Total monthly contribution (you + employer)">
            <input className="wmg-input" type="number" value={profile.pension.contribution} onChange={(e) => setField(["pension", "contribution"])(Number(e.target.value))} />
          </Field>
          <Field
            label="Drawdown rate at retirement (%)"
            hint="How much of your pot you plan to take out each year once retired. 4% is a commonly used starting point — take out much more and there's a real risk of running out; take out less and it lasts longer but gives you less to live on."
          >
            <input className="wmg-input" type="number" step="0.1" value={profile.pension.drawdownRate} onChange={(e) => setField(["pension", "drawdownRate"])(Number(e.target.value))} />
          </Field>
        </div>
        <div className="wmg-three-col">
          <Field label="Current age">
            <input className="wmg-input" type="number" value={profile.pension.currentAge} onChange={(e) => setField(["pension", "currentAge"])(Number(e.target.value))} />
          </Field>
          <Field label="Target retirement age">
            <input className="wmg-input" type="number" value={profile.pension.retirementAge} onChange={(e) => setField(["pension", "retirementAge"])(Number(e.target.value))} />
          </Field>
          <div>
            <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Years to retirement</div>
            <div className="wmg-figure tone-paper">{pensionYearsToRetire}</div>
          </div>
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

      <div className="wmg-section-title">Projected pot at retirement</div>
      <div className="wmg-section-desc">
        Same contributions, three growth assumptions — because nobody can promise you a return. Figures in brackets are
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
            <div className="wmg-pension-value">{gbp(pensionScenarios.fv[s.key])}</div>
            <div className="wmg-sub" style={{ marginTop: -2, marginBottom: 8 }}>≈ {gbp(pensionScenarios.real[s.key])} in today's money</div>
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
              <CartesianGrid stroke="#E3DAC2" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "#6B7C6F", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(y) => `Yr ${y}`} stroke="#E3DAC2" />
              <YAxis tick={{ fill: "#6B7C6F", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(v) => `£${Math.round(v / 1000)}k`} stroke="#E3DAC2" width={54} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Inter" }} />
              <Line type="monotone" dataKey="high" name="High" stroke="#3E8F63" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="medium" name="Medium" stroke="#9A752B" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="low" name="Low" stroke="#B23B2E" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}

function ForecastTab({ horizonYears, setHorizonYears, allocationPct, setAllocationPct, forecast, interestSavedFromAllocation, totals, profile, setField, updateLifeEvent, addLifeEvent, removeLifeEvent, addScenario, updateScenario, removeScenario }) {
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

  const SCENARIO_COLORS = ["#1F5D46", "#FF8A65", "#97721F", "#3E8F63", "#D6483A", "#5B6473"];
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
              <CartesianGrid stroke="#E3DAC2" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "#6B7C6F", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(y) => `Yr ${y}`} stroke="#E3DAC2" />
              <YAxis tick={{ fill: "#6B7C6F", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(v) => `£${Math.round(v / 1000)}k`} stroke="#E3DAC2" width={54} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Inter" }} />
              {forecast.resolvedLifeEvents?.map((e) => (
                <ReferenceLine
                  key={e.id}
                  x={Math.round((e.month / 12) * 10) / 10}
                  stroke={e.type === "expense" ? "#D6483A" : "#3E8F63"}
                  strokeDasharray="3 3"
                  label={{ value: e.name, position: "top", fontSize: 10, fill: e.type === "expense" ? "#D6483A" : "#3E8F63" }}
                />
              ))}
              <Area type="monotone" dataKey={key("netWorthLow")} stackId="band" stroke="none" fill="transparent" legendType="none" isAnimationActive={false} />
              <Area type="monotone" dataKey={key("netWorthBand")} name="Net worth range (low–high)" stackId="band" stroke="none" fill="#1F5D46" fillOpacity={0.15} isAnimationActive={false} />
              <Line type="monotone" dataKey={key("netWorth")} name="Net worth" stroke="#1F5D46" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey={key("debt")} name="Total debt (incl. mortgage)" stroke="#B23B2E" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey={key("savingsInvest")} name="Savings & investments" stroke="#3E8F63" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey={key("pension")} name="Pension" stroke="#6B7C6F" strokeWidth={2} dot={false} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="wmg-forecast-summary">
          <div>
            <div className="wmg-calc-item-label">Net worth in {horizonYears} years{realTerms ? " (today's money)" : ""}</div>
            <div className="wmg-calc-item-val" style={{ color: "var(--brand)" }}>{last ? gbp(last[key("netWorth")]) : "—"}</div>
            {lastLow && lastHigh && (
              <div className="wmg-sub" style={{ marginTop: 2 }}>
                Likely range: {gbp(lastLow[key("netWorth")])} – {gbp(lastHigh[key("netWorth")])}
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
                <CartesianGrid stroke="#E3DAC2" vertical={false} />
                <XAxis dataKey="year" tick={{ fill: "#6B7C6F", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(y) => `Yr ${y}`} stroke="#E3DAC2" />
                <YAxis tick={{ fill: "#6B7C6F", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(v) => `£${Math.round(v / 1000)}k`} stroke="#E3DAC2" width={54} />
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

const EDUCATION_TOPICS = [
  {
    category: "Pensions",
    items: [
      {
        title: "Workplace pensions & auto-enrolment",
        body: "If you're employed, aged 22+, and earn over £10,000/year, your employer must automatically enrol you into a workplace pension unless you opt out. You pay in (usually a minimum of 5% of qualifying earnings), your employer adds at least 3% on top, and the government adds tax relief. Opting out means walking away from free money from your employer — it's usually worth staying in unless you have a specific reason not to.",
      },
      {
        title: "Defined contribution vs defined benefit",
        body: "Most modern workplace pensions are defined contribution (DC): you and your employer pay into a pot, it's invested, and what you get at retirement depends on how much went in and how it grew. Older or public-sector pensions are often defined benefit (DB) — sometimes called 'final salary' — where you're promised a specific income for life based on your salary and years of service, regardless of investment performance. DB pensions are generally more valuable and rarer; if you have one, think very carefully before transferring out of it.",
      },
      {
        title: "SIPPs — self-invested personal pensions",
        body: "A SIPP is a pension you control directly, choosing your own investments, rather than being defaulted into a provider's fund. They suit people who are self-employed, want more investment choice, or want to consolidate old workplace pensions. They come with the same tax relief as other pensions, but you carry the responsibility for investment decisions — or the cost of paying someone to make them for you.",
      },
      {
        title: "The State Pension",
        body: "The State Pension is separate from any workplace or personal pension, and depends on your National Insurance (NI) record rather than a pot you've built up. You typically need 35 qualifying years of NI contributions for the full amount, and at least 10 years for any payment at all. The age you can claim it is currently rising towards 67, then 68. It's worth checking your own forecast and NI record at gov.uk/check-state-pension — gaps from time abroad, self-employment, or career breaks can reduce what you get, and voluntary contributions can sometimes fill them.",
      },
      {
        title: "Pension tax relief, explained",
        body: "When you pay into a pension, the government tops it up as tax relief — effectively refunding the income tax you'd have paid on that money. A basic-rate taxpayer paying in £80 sees it topped up to £100; higher and additional-rate taxpayers can claim back more via their tax return. This is on top of any employer contribution, which is why pensions are usually the most tax-efficient way to save for the long term, even before investment growth is considered.",
      },
      {
        title: "Annuity vs drawdown at retirement",
        body: "When you access a defined contribution pension (from age 55, rising to 57 from 2028), you can normally take up to 25% as a tax-free lump sum. With the rest, an annuity converts your pot into a guaranteed income for life — simple and predictable, but the rate you're offered depends on interest rates and your health, and it's usually irreversible. Drawdown instead keeps your pot invested and you draw an income from it — more flexible and with more upside, but the pot can run out or fall in value if markets do badly. Many people use a mix of both, or a phased move from drawdown towards an annuity later in retirement.",
      },
    ],
  },
  {
    category: "Savings & ISAs",
    items: [
      {
        title: "Cash ISA vs Stocks & Shares ISA",
        body: "An ISA (Individual Savings Account) lets you save or invest up to an annual allowance (£20,000 for 2024/25) without paying tax on the interest, dividends, or gains. A Cash ISA works like a savings account — low risk, low return, good for money you might need at short notice. A Stocks & Shares ISA invests the money in the market — historically higher long-term returns, but the value can fall as well as rise, so it suits money you won't need for at least 5 years.",
      },
      {
        title: "Lifetime ISA (LISA)",
        body: "If you're 18–39, a LISA lets you save up to £4,000/year towards a first home or retirement, and the government adds a 25% bonus on top — up to £1,000/year. You can access the money for a first home purchase (under £450,000) at any time, or penalty-free from age 60 for anything else. Withdraw it for any other reason and you lose the bonus plus a bit of your own money, so it's best treated as genuinely locked away until one of those two goals.",
      },
      {
        title: "Emergency funds — why 3–6 months",
        body: "An emergency fund is money kept in easy-access savings, separate from your everyday account, for genuine shocks — job loss, a broken boiler, an unexpected bill. The usual guideline is 3–6 months of essential outgoings, with the higher end suiting single incomes, self-employment, or less job security. It belongs in something instant-access, like an easy-access savings account, not invested — the point isn't growth, it's being there when you need it without having to borrow or sell investments at a bad time.",
      },
      {
        title: "Personal Savings Allowance",
        body: "Outside an ISA, most people can still earn some savings interest tax-free each year — currently £1,000 for basic-rate taxpayers, £500 for higher-rate, and £0 for additional-rate taxpayers. With savings rates higher than they've been in years, it's become easier to exceed this on a large cash balance, which is one more reason ISA allowances are worth using where you can.",
      },
    ],
  },
  {
    category: "Debt",
    items: [
      {
        title: "Avalanche vs snowball",
        body: "When paying off multiple debts, the avalanche method puts extra money towards the highest interest rate debt first, while making minimum payments on the rest — mathematically it saves the most money. The snowball method instead targets the smallest balance first, for a quicker psychological win, then rolls that payment onto the next smallest. Avalanche saves more in interest; snowball can be easier to stick with. Either beats paying minimums only.",
      },
      {
        title: "APR, explained",
        body: "APR (Annual Percentage Rate) is the yearly cost of borrowing, including interest and most fees, expressed as a single percentage — it's designed to let you compare loans, cards, and overdrafts on a like-for-like basis. A 0% purchase or balance transfer credit card genuinely charges no interest for a set period, but usually reverts to a much higher rate afterwards and often carries a transfer fee, so the promotional rate isn't the whole story.",
      },
      {
        title: "Secured vs unsecured debt",
        body: "A secured debt, like a mortgage or a car on finance, is tied to an asset the lender can repossess if you stop paying — this is usually why secured rates are lower. An unsecured debt, like a credit card, personal loan, or overdraft, isn't backed by a specific asset, so lenders charge more to offset their risk, and generally accept partial payment plans more readily in genuine hardship. Never treat unsecured debt as more urgent than a mortgage or secured loan just because the calls feel more frequent — missing secured payments risks your home or car.",
      },
    ],
  },
  {
    category: "Getting real help",
    items: [
      {
        title: "Free, impartial guidance",
        body: "MoneyHelper (moneyhelper.org.uk) is a free, government-backed service covering budgeting, debt, pensions, and savings, with phone and webchat advisers. Pension Wise, part of MoneyHelper, offers a free guidance appointment for anyone 50+ with a defined contribution pension, before you make any decisions about accessing it. Citizens Advice can help with debt and wider financial difficulty, including free debt advice charities like StepChange and National Debtline if things feel unmanageable.",
      },
      {
        title: "When to see a regulated financial adviser",
        body: "This app — and free guidance services — can help you understand your options, but neither can tell you what's right for your specific circumstances the way a regulated financial adviser can. It's worth paying for advice before large, hard-to-reverse decisions: transferring a defined benefit pension, choosing an annuity, consolidating old pensions, or investing a large lump sum. Check an adviser is registered on the FCA register at register.fca.org.uk before paying for anything.",
      },
    ],
  },
];

function AccordionItem({ title, body, isOpen, onToggle }) {
  return (
    <div className="wmg-accordion-item">
      <button className="wmg-accordion-head" onClick={onToggle} aria-expanded={isOpen}>
        <span>{title}</span>
        <span className="wmg-accordion-icon">{isOpen ? "−" : "+"}</span>
      </button>
      {isOpen && <div className="wmg-accordion-body">{body}</div>}
    </div>
  );
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function PensionReaderTab({ onUseInPension }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | reading | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [applied, setApplied] = useState(false);
  const inputRef = useRef(null);

  const pickFile = (f) => {
    if (!f) return;
    const isPdf = f.type === "application/pdf";
    const isImage = f.type.startsWith("image/");
    if (!isPdf && !isImage) {
      setStatus("error");
      setErrorMsg("Please choose a PDF or a photo (JPG/PNG).");
      return;
    }
    setFile(f);
    setStatus("idle");
    setResult(null);
    setApplied(false);
  };

  const analyze = async () => {
    if (!file) return;
    setStatus("reading");
    setErrorMsg("");
    try {
      const base64 = await fileToBase64(file);
      const fileKind = file.type === "application/pdf" ? "pdf" : "image";
      const resp = await fetch("/api/analyze-pension", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, mediaType: file.type, fileKind }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Something went wrong.");
      if (data.couldNotRead) {
        setStatus("error");
        setErrorMsg(data.summary || "Couldn't read this document. Try a clearer photo or the original PDF.");
        return;
      }
      setResult(data);
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Something went wrong reading the document.");
    }
  };

  const reset = () => {
    setFile(null);
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    setApplied(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const useInPension = () => {
    if (!result) return;
    onUseInPension(result);
    setApplied(true);
  };

  return (
    <>
      <div className="wmg-section-title">Pension document reader</div>
      <div className="wmg-section-desc">
        Upload a pension statement — a PDF, or a photo if it's on paper — and this reads it and explains it in plain
        English. Nothing is saved unless you choose to use the numbers in your Pension tab.
      </div>

      {status !== "done" && (
        <Card>
          <div
            className="wmg-reader-dropzone"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pickFile(e.dataTransfer.files?.[0]);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/*"
              className="wmg-reader-input"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            {file ? (
              <div className="wmg-reader-filename">
                <i className="ti ti-file-check" aria-hidden="true" /> {file.name}
              </div>
            ) : (
              <>
                <div className="wmg-reader-dropzone-title">Tap to choose a file, or drag one here</div>
                <div className="wmg-reader-dropzone-sub">PDF, JPG or PNG</div>
              </>
            )}
          </div>

          {status === "error" && <div className="wmg-reader-error">{errorMsg}</div>}

          <button className="wmg-btn-primary wmg-reader-analyze" disabled={!file || status === "reading"} onClick={analyze}>
            {status === "reading" ? "Reading your document…" : "Read this document"}
          </button>
        </Card>
      )}

      {status === "done" && result && (
        <>
          <Card className="wmg-reader-summary-card">
            <div className="wmg-reader-doc-type">{result.documentType}{result.provider ? ` — ${result.provider}` : ""}</div>
            {result.asOfDate && <div className="wmg-sub" style={{ marginBottom: 12 }}>As of {result.asOfDate}</div>}
            <p style={{ marginTop: result.asOfDate ? 0 : 8 }}>{result.summary}</p>
          </Card>

          <div className="wmg-chip-row">
            {result.currentValue != null && (
              <div className="wmg-chip"><div className="wmg-chip-label">Current value</div><div className="wmg-chip-value">{gbp(result.currentValue)}</div></div>
            )}
            {result.monthlyContribution != null && (
              <div className="wmg-chip"><div className="wmg-chip-label">Monthly contribution</div><div className="wmg-chip-value">{gbp(result.monthlyContribution)}</div></div>
            )}
            {result.annualFeePercent != null && (
              <div className="wmg-chip"><div className="wmg-chip-label">Annual fee</div><div className="wmg-chip-value">{result.annualFeePercent}%</div></div>
            )}
            {result.projectedValue != null && (
              <div className="wmg-chip"><div className="wmg-chip-label">Projected value</div><div className="wmg-chip-value">{gbp(result.projectedValue)}</div></div>
            )}
            {result.projectedIncome != null && (
              <div className="wmg-chip">
                <div className="wmg-chip-label">Projected income ({result.projectedIncomeFrequency || "—"})</div>
                <div className="wmg-chip-value">{gbp(result.projectedIncome)}</div>
              </div>
            )}
            {result.retirementAge != null && (
              <div className="wmg-chip"><div className="wmg-chip-label">Assumed retirement age</div><div className="wmg-chip-value">{result.retirementAge}</div></div>
            )}
          </div>

          <Card className={`wmg-insight-card wmg-insight-${result.verdict.tone === "good" ? "sage" : result.verdict.tone === "caution" ? "rust" : "gold"}`}>
            <span className={`wmg-insight-icon-badge tone-${result.verdict.tone === "good" ? "sage" : result.verdict.tone === "caution" ? "rust" : "gold"}`}>
              {result.verdict.tone === "good" ? "✓" : result.verdict.tone === "caution" ? "!" : "i"}
            </span>
            <p>{result.verdict.text}</p>
          </Card>

          <div className="wmg-reader-actions">
            {onUseInPension && result.currentValue != null && !applied && (
              <button className="wmg-btn-primary" onClick={useInPension}>Use these numbers in my Pension tab</button>
            )}
            {applied && <div className="wmg-reader-applied">✓ Added to your Pension tab</div>}
            <button className="wmg-onboard-skip" onClick={reset}>Read another document</button>
          </div>
        </>
      )}

      <div className="wmg-footnote" style={{ marginTop: 20 }}>
        This reads the document you upload using AI and does its best to extract accurate figures, but it can make
        mistakes — always check important numbers against the original document. This isn't financial advice.
      </div>
    </>
  );
}


function EducationTab() {
  const [openId, setOpenId] = useState(null);

  return (
    <>
      <div className="wmg-section-title">Education</div>
      <div className="wmg-section-desc">
        General information to help you understand your options — not personalised financial advice, and it doesn't
        know your circumstances the way a regulated adviser or MoneyHelper would. Rules, rates, and allowances change
        most years; treat specific figures below as a guide and check gov.uk or MoneyHelper for current numbers.
      </div>

      {EDUCATION_TOPICS.map((group) => (
        <React.Fragment key={group.category}>
          <div className="wmg-section-title">{group.category}</div>
          <Card>
            {group.items.map((item, i) => {
              const id = `${group.category}-${i}`;
              return (
                <AccordionItem
                  key={id}
                  title={item.title}
                  body={item.body}
                  isOpen={openId === id}
                  onToggle={() => setOpenId(openId === id ? null : id)}
                />
              );
            })}
          </Card>
        </React.Fragment>
      ))}
    </>
  );
}
