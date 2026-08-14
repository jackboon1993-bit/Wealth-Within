import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { getData, setData, deleteData } from "./lib/storage";
import { supabase } from "./lib/supabaseClient";

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
  income: 5800,
  homeValue: 337000,
  homeValueGrowth: 2,
  mortgage: { balance: 210000, rate: 4.5, payment: 1150 },
  loans: [
    { id: nextId(), name: "Car loan", balance: 21000, rate: 7.9, payment: 300 },
    { id: nextId(), name: "Personal loan", balance: 18800, rate: 9.9, payment: 290 },
  ],
  cards: [{ id: nextId(), name: "Credit card", balance: 3200, rate: 22.9, payment: 150 }],
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
  assumptions: { incomeGrowth: 3, inflation: 2.5 },
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
  const arrayKeys = ["loans", "cards", "expenseCategories", "subscriptions", "goals"];
  arrayKeys.forEach((k) => {
    merged[k] = Array.isArray(saved[k]) ? saved[k] : defaultProfile[k];
  });
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

function runForecast(profile, totals, horizonYears, allocationPct) {
  const months = horizonYears * 12;
  const debts = [...profile.loans, ...profile.cards].map((d) => ({ ...d }));
  let mortgageBalance = profile.mortgage.balance;
  const mortgageRate = profile.mortgage.rate;
  const mortgagePayment = profile.mortgage.payment;
  let homeValue = profile.homeValue;
  const homeGrowth = profile.homeValueGrowth;

  let savings = profile.savings.balance;
  const savingsRate = profile.savings.growthRate;
  let investments = profile.investments.balance;
  const investRate = profile.investments.growthRate;
  const investContribution = profile.investments.monthlyContribution;
  let pension = profile.pension.balance;
  const pensionRate = profile.pension.growthMedium;
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

  const series = [];
  let debtFreeMonth = null;
  const startingDebt = debts.reduce((s, d) => s + d.balance, 0);
  if (startingDebt <= 0) debtFreeMonth = 0;

  for (let m = 1; m <= months; m++) {
    // pay rises and cost-of-living increases, applied monthly
    income *= 1 + incomeGrowthM;
    essential *= 1 + inflationM;
    lifestyle *= 1 + inflationM;
    statePensionMonthly *= 1 + inflationM;

    const statePensionAdd = statePensionIncluded && startAgeMonths + m >= statePensionClaimAgeMonths ? statePensionMonthly : 0;
    if (statePensionAdd > 0 && statePensionStartMonth === null) statePensionStartMonth = m;

    if (mortgageBalance > 0) {
      const mi = mortgageBalance * (mortgageRate / 100 / 12);
      const mp = Math.min(mortgagePayment, mortgageBalance + mi);
      mortgageBalance = Math.max(0, mortgageBalance + mi - mp);
    }
    homeValue *= 1 + homeGrowth / 100 / 12;

    let scheduledDebtPayment = 0;
    debts.forEach((d) => {
      if (d.balance > 0) {
        const di = d.balance * (d.rate / 100 / 12);
        const dp = Math.min(d.payment, d.balance + di);
        d.balance = Math.max(0, d.balance + di - dp);
        scheduledDebtPayment += dp;
      }
    });

    const surplus = income + statePensionAdd - essential - lifestyle - scheduledDebtPayment - mortgagePayment;
    let extraSavings;
    if (surplus > 0) {
      const extraDebt = surplus * (allocationPct / 100);
      extraSavings = surplus - extraDebt;
      let remaining = extraDebt;
      let guard = 0;
      while (remaining > 0.01 && guard < 20) {
        const target = debts.filter((d) => d.balance > 0).sort((a, b) => b.rate - a.rate)[0];
        if (!target) break;
        const pay = Math.min(remaining, target.balance);
        target.balance -= pay;
        remaining -= pay;
        guard++;
      }
    } else {
      extraSavings = surplus;
    }

    savings = savings * (1 + savingsRate / 100 / 12) + extraSavings;
    investments = investments * (1 + investRate / 100 / 12) + investContribution;
    pension = pension * (1 + pensionRate / 100 / 12) + pensionContribution;

    const remainingNonMortgageDebt = debts.reduce((s, d) => s + d.balance, 0);
    if (debtFreeMonth === null && remainingNonMortgageDebt <= 0.5) debtFreeMonth = m;

    if (m % 12 === 0) {
      const year = m / 12;
      const homeEquity = homeValue - mortgageBalance;
      const netWorth = homeEquity + savings + investments + pension - remainingNonMortgageDebt;
      const debtTotal = remainingNonMortgageDebt + mortgageBalance;
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

  return { series, debtFreeMonth, statePensionStartMonth };
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

function Stat({ label, value, tone = "paper", sub }) {
  return (
    <Card className="wmg-stat">
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

function Gauge({ score }) {
  const cx = 110,
    cy = 118,
    r = 92;
  const theta = (180 - clamp(score, 0, 100) * 1.8) * (Math.PI / 180);
  const nx = cx + (r - 12) * Math.cos(theta);
  const ny = cy - (r - 12) * Math.sin(theta);

  return (
    <svg viewBox="0 0 220 134" className="wmg-gauge" role="img" aria-label={`Financial score ${score} out of 100`}>
      <defs>
        <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#B23B2E" />
          <stop offset="50%" stopColor="#9A752B" />
          <stop offset="100%" stopColor="#227A56" />
        </linearGradient>
      </defs>
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="#E2E5EA"
        strokeWidth="11"
        strokeLinecap="round"
        pathLength="100"
      />
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="url(#gaugeGrad)"
        strokeWidth="11"
        strokeLinecap="round"
        pathLength="100"
        strokeDasharray={`${clamp(score, 0, 100)} 100`}
      />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#171B21" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="5.5" fill="#9A752B" stroke="#FFFFFF" strokeWidth="2" />
    </svg>
  );
}

function Field({ label, children }) {
  return (
    <div className="wmg-field">
      <label className="wmg-field-label">{label}</label>
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
    default:
      return null;
  }
}

function BrandMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none">
      <defs>
        <linearGradient id="brandMarkGrad" x1="0" y1="0" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#B5924C" />
          <stop offset="100%" stopColor="#8A6A22" />
        </linearGradient>
      </defs>
      <rect width="34" height="34" rx="9" fill="url(#brandMarkGrad)" />
      <path d="M8 21.5 13.2 15l4 4.2L26 10" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="26" cy="10" r="1.8" fill="#FFFFFF" />
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
      ...profile.loans.map((l) => ({ ...l, kind: "Loan" })),
      ...profile.cards.map((c) => ({ ...c, kind: "Credit card" })),
    ],
    [profile.loans, profile.cards]
  );

  const totals = useMemo(() => {
    const essentialCats = profile.expenseCategories.filter((c) => c.type === "essential");
    const lifestyleCats = profile.expenseCategories.filter((c) => c.type === "lifestyle");
    const sumCat = (cats) => cats.reduce((s, c) => s + c.items.reduce((s2, i) => s2 + Number(i.amount || 0), 0), 0);
    const essentialCatTotal = sumCat(essentialCats);
    const lifestyleCatTotal = sumCat(lifestyleCats);

    const loansBalance = profile.loans.reduce((s, l) => s + Number(l.balance || 0), 0);
    const loansPayment = profile.loans.reduce((s, l) => s + Number(l.payment || 0), 0);
    const cardsBalance = profile.cards.reduce((s, c) => s + Number(c.balance || 0), 0);
    const cardsPayment = profile.cards.reduce((s, c) => s + Number(c.payment || 0), 0);

    const activeSubs = profile.subscriptions.filter((s) => !s.cancelled);
    const subsTotal = activeSubs.reduce((s, x) => s + Number(x.amount || 0), 0);

    const essential = Number(profile.mortgage.payment || 0) + essentialCatTotal;
    const debtPayments = loansPayment + cardsPayment;
    const lifestyle = lifestyleCatTotal + subsTotal;
    const income = Number(profile.income || 0);
    const available = income - essential - debtPayments - lifestyle;

    const homeEquity = Number(profile.homeValue || 0) - Number(profile.mortgage.balance || 0);
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
    () => monthsToPayoff(profile.mortgage.balance, profile.mortgage.rate, profile.mortgage.payment),
    [profile.mortgage]
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

  const ccAnnualCost = totals.cardsBalance > 0 ? profile.cards.reduce((sum, c) => sum + (c.balance * c.rate) / 100, 0) : 0;

  const coachTips = useMemo(() => {
    const tips = [];
    if (totals.available < 0) {
      tips.push({ tone: "rust", text: `You're spending ${gbp(Math.abs(totals.available))} more than comes in each month. Close that gap before anything else — start with the lifestyle column.` });
    }
    if (flaggedCount > 0) {
      tips.push({ tone: "gold", text: `Cancel ${flaggedCount} flagged subscriptions → save ${gbp(flaggedSavings)}/month, ${gbp(flaggedSavings * 12)} a year.` });
    }
    if (profile.emergencyFund.balance < profile.emergencyFund.target && totals.available > 0) {
      const suggestedMove = Math.max(50, Math.round(Math.min(totals.available * 0.4, profile.emergencyFund.target - profile.emergencyFund.balance) / 10) * 10);
      tips.push({ tone: "sage", text: `Move ${gbp(suggestedMove)}/month into your emergency fund — you'll reach ${gbp(profile.emergencyFund.target)} in about ${Math.ceil((profile.emergencyFund.target - profile.emergencyFund.balance) / suggestedMove)} months.` });
    }
    if (ccAnnualCost > 50) {
      tips.push({ tone: "rust", text: `Your credit card is costing you roughly ${gbp(ccAnnualCost)} a year in interest. Paying above the minimum here beats most savings rates.` });
    }
    if (extraCalc && isFinite(extraCalc.interestSaved) && extraCalc.interestSaved > 0) {
      tips.push({ tone: "gold", text: `An extra ${gbp(extraPayment)}/month on your ${selectedDebt.name.toLowerCase()} saves roughly ${gbp(extraCalc.interestSaved)} in interest and clears it ${Math.round(extraCalc.monthsSaved)} months earlier.` });
    }
    if (totals.available > comfortableTarget) {
      tips.push({ tone: "sage", text: `You're already ${gbp(totals.available - comfortableTarget)}/month past "comfortable." Consider directing the surplus at your highest-interest debt or your pension.` });
    }
    return tips;
  }, [totals, flaggedCount, flaggedSavings, profile.emergencyFund, ccAnnualCost, extraCalc, extraPayment, selectedDebt, comfortableTarget]);

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

  /* ================================ render ================================ */

  return (
    <div className="wmg-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        .wmg-root {
          --ink: #F4F5F7;
          --ink-2: #FFFFFF;
          --ink-3: #F0F1F4;
          --paper: #171B21;
          --paper-dim: #626B7A;
          --gold: #9A752B;
          --sage: #227A56;
          --rust: #B23B2E;
          --slate: #55606E;
          --hair: #E2E5EA;
          --gold-soft: #C9A24B;
          --sage-soft: #6FA089;
          --rust-soft: #C1594A;
          --slate-soft: #5A6B84;
          background: var(--ink);
          color: var(--paper);
          font-family: 'Inter', sans-serif;
          min-height: 100%;
          font-variant-numeric: tabular-nums;
        }
        .wmg-root * { box-sizing: border-box; }
        .wmg-mono { font-family: 'Inter', sans-serif; font-variant-numeric: tabular-nums; }
        .wmg-serif { font-family: 'Inter', sans-serif; font-weight: 700; letter-spacing: -0.01em; }

        .wmg-app { display: flex; min-height: 100vh; align-items: flex-start; }
        @media (max-width: 880px) { .wmg-app { flex-direction: column; } }

        .wmg-sidebar { width: 236px; flex-shrink: 0; padding: 28px 18px; border-right: 1px solid var(--hair); position: sticky; top: 0; align-self: flex-start; height: 100vh; overflow-y: auto; background: #FFFFFF; }
        @media (max-width: 880px) { .wmg-sidebar { width: 100%; height: auto; position: relative; border-right: none; border-bottom: 1px solid var(--hair); padding: 18px; } }

        .wmg-brand-block { display: flex; align-items: center; gap: 11px; margin-bottom: 28px; }
        .wmg-brand-block svg { flex-shrink: 0; }
        .wmg-brand { font-family: 'Inter', sans-serif; font-size: 18px; font-weight: 800; letter-spacing: -0.02em; margin: 0; line-height: 1.2; color: var(--paper); }
        .wmg-brand-tagline { font-size: 10.5px; color: var(--paper-dim); margin-top: 2px; letter-spacing: 0.01em; }
        @media (max-width: 880px) { .wmg-brand-block { margin-bottom: 16px; } }

        .wmg-nav { display: flex; flex-direction: column; gap: 2px; }
        @media (max-width: 880px) { .wmg-nav { flex-direction: row; overflow-x: auto; gap: 6px; padding-bottom: 4px; } }
        .wmg-nav-item { display: flex; align-items: center; gap: 10px; text-align: left; background: transparent; border: none; border-left: 2px solid transparent; color: var(--paper-dim); font-family: 'Inter', sans-serif; font-size: 13.5px; padding: 9px 14px; cursor: pointer; border-radius: 0 6px 6px 0; white-space: nowrap; transition: color .15s ease, background .15s ease, border-color .15s ease; }
        .wmg-nav-icon { display: flex; color: var(--paper-dim); flex-shrink: 0; transition: color .15s ease; }
        .wmg-nav-item:hover { color: var(--paper); background: var(--ink-3); }
        .wmg-nav-item:hover .wmg-nav-icon { color: var(--gold); }
        .wmg-nav-item.active { color: var(--paper); background: var(--ink-3); border-left-color: var(--gold); font-weight: 600; }
        .wmg-nav-item.active .wmg-nav-icon { color: var(--gold); }
        @media (max-width: 880px) { .wmg-nav-item { border-left: none; border-bottom: 2px solid transparent; border-radius: 6px; } .wmg-nav-item.active { border-bottom-color: var(--gold); } }

        .wmg-sidebar-foot { margin-top: 32px; padding-top: 18px; border-top: 1px solid var(--hair); font-size: 11px; color: var(--paper-dim); line-height: 1.6; }
        @media (max-width: 880px) { .wmg-sidebar-foot { display: none; } }
        .wmg-sync-row { display: flex; align-items: center; gap: 7px; font-family: 'Inter', sans-serif; font-size: 10.5px; }
        .wmg-sync-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--paper-dim); flex-shrink: 0; }
        .wmg-sync-dot.status-ready, .wmg-sync-dot.status-saved { background: var(--sage); }
        .wmg-sync-dot.status-saving, .wmg-sync-dot.status-loading { background: var(--gold); }
        .wmg-sync-dot.status-error, .wmg-sync-dot.status-unavailable { background: var(--rust); }
        .wmg-reset-btn { background: transparent; border: 1px solid var(--hair); color: var(--paper-dim); font-family: 'Inter', sans-serif; font-size: 10.5px; padding: 7px 12px; border-radius: 999px; cursor: pointer; }
        .wmg-reset-btn:hover { border-color: var(--gold); color: var(--gold); }
        .wmg-reset-btn.danger { border-color: var(--rust); color: var(--rust); }

        .wmg-main { flex: 1; min-width: 0; padding: 0 0 70px; }

        .wmg-topbar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 32px; background: rgba(244,245,247,0.86); backdrop-filter: blur(6px); border-bottom: 1px solid var(--hair); flex-wrap: wrap; }
        @media (max-width: 880px) { .wmg-topbar { position: relative; padding: 16px 18px; } }
        .wmg-topbar-title { font-family: 'Inter', sans-serif; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
        .wmg-topbar-stats { display: flex; gap: 22px; flex-wrap: wrap; }
        .wmg-topbar-stat { text-align: right; }
        .wmg-topbar-stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--paper-dim); font-family: 'Inter', sans-serif; }
        .wmg-topbar-stat-val { font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 600; }
        .wmg-score-chip { display: flex; align-items: center; gap: 8px; border: 1px solid var(--hair); border-radius: 999px; padding: 6px 14px 6px 10px; }
        .wmg-score-chip-dot { width: 8px; height: 8px; border-radius: 50%; }

        .wmg-content { padding: 28px 32px 0; }
        @media (max-width: 880px) { .wmg-content { padding: 22px 18px 0; } }

        .wmg-card { background: var(--ink-2); border: 1px solid var(--hair); border-radius: 12px; padding: 20px; box-shadow: 0 1px 2px rgba(23,27,33,0.04), 0 1px 8px rgba(23,27,33,0.03); }

        .wmg-score-row { display: grid; grid-template-columns: 260px 1fr; gap: 18px; margin-bottom: 8px; }
        @media (max-width: 720px) { .wmg-score-row { grid-template-columns: 1fr; } }
        .wmg-score-card { display: flex; flex-direction: column; align-items: center; text-align: center; }
        .wmg-gauge { width: 190px; height: auto; }
        .wmg-score-num { font-family: 'Inter', sans-serif; font-size: 36px; font-weight: 600; margin-top: -8px; }
        .wmg-score-label { font-family: 'Inter', sans-serif; font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--paper-dim); }

        .wmg-verdict-card { display: flex; flex-direction: column; justify-content: center; }
        .wmg-verdict { font-family: 'Inter', sans-serif; font-size: 21px; line-height: 1.4; margin: 0 0 14px; }
        .wmg-verdict .wmg-mono { color: var(--gold); }
        .wmg-mini-stats { display: flex; gap: 26px; flex-wrap: wrap; margin-top: 4px; }
        .wmg-mini-stat-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--paper-dim); font-family: 'Inter', sans-serif; }
        .wmg-mini-stat-val { font-family: 'Inter', sans-serif; font-size: 16px; font-weight: 600; }

        .wmg-section-title { font-family: 'Inter', sans-serif; font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--gold); margin: 32px 0 12px; display: flex; align-items: center; gap: 10px; }
        .wmg-section-title:first-child { margin-top: 0; }
        .wmg-section-title::after { content: ""; flex: 1; height: 1px; background: var(--hair); }
        .wmg-section-desc { font-size: 12.5px; color: var(--paper-dim); margin: -6px 0 14px; max-width: 60ch; }

        .wmg-nw-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
        @media (max-width: 900px) { .wmg-nw-grid { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 560px) { .wmg-nw-grid { grid-template-columns: repeat(2, 1fr); } }
        .wmg-stat { padding: 15px 16px; }
        .wmg-stat .wmg-eyebrow { color: var(--paper-dim); margin-bottom: 8px; font-size: 10px; }
        .wmg-figure { font-family: 'Inter', sans-serif; font-size: 19px; font-weight: 600; }
        .wmg-sub { font-size: 11px; color: var(--paper-dim); margin-top: 4px; }
        .tone-paper { color: var(--paper); }
        .tone-gold { color: var(--gold); }
        .tone-sage { color: var(--sage); }
        .tone-rust { color: var(--rust); }
        .tone-slate { color: var(--slate); }
        .wmg-networth-card { grid-column: span 2; background: linear-gradient(135deg, #FBF6E9, var(--ink-2)); }
        @media (max-width: 560px) { .wmg-networth-card { grid-column: span 2; } }

        .wmg-flow-bar { display: flex; width: 100%; height: 36px; border-radius: 7px; overflow: hidden; border: 1px solid var(--hair); }
        .wmg-flow-seg { height: 100%; display: flex; align-items: center; justify-content: center; font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; transition: width .3s ease; }
        .bg-slate { background: var(--slate-soft); color: #171B21; }
        .bg-rust { background: var(--rust-soft); color: #171B21; }
        .bg-gold { background: var(--gold-soft); color: #171B21; }
        .bg-sage { background: var(--sage-soft); color: #171B21; }
        .wmg-flow-legend { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 14px; }
        .wmg-flow-legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
        .wmg-swatch { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }
        .wmg-flow-legend-val { font-family: 'Inter', sans-serif; margin-left: 4px; color: var(--paper-dim); }

        .wmg-horizon { position: relative; height: 5px; background: var(--hair); border-radius: 3px; margin: 44px 10px 26px; }
        .wmg-horizon-point { position: absolute; top: -7px; width: 19px; height: 19px; border-radius: 50%; border: 3px solid var(--ink-2); }
        .wmg-horizon-label { position: absolute; top: -44px; font-size: 10.5px; white-space: nowrap; font-family: 'Inter', sans-serif; text-align: center; transform: translateX(-50%); text-transform: uppercase; letter-spacing: 0.04em; }
        .wmg-horizon-date { position: absolute; top: 18px; font-size: 12px; font-weight: 600; white-space: nowrap; transform: translateX(-50%); font-family: 'Inter', sans-serif; }

        .wmg-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 720px) { .wmg-two-col { grid-template-columns: 1fr; } }
        .wmg-three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
        @media (max-width: 780px) { .wmg-three-col { grid-template-columns: 1fr; } }

        .wmg-select { background: var(--ink-3); color: var(--paper); border: 1px solid var(--hair); border-radius: 7px; padding: 9px 11px; font-family: 'Inter', sans-serif; font-size: 12.5px; width: 100%; }
        .wmg-slider-row { display: flex; align-items: center; gap: 14px; }
        .wmg-slider { flex: 1; accent-color: var(--gold); }
        .wmg-slider-val { font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600; color: var(--gold); min-width: 60px; text-align: right; }

        .wmg-calc-result { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 10px; padding-top: 14px; border-top: 1px dashed var(--hair); }
        .wmg-calc-item-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--paper-dim); font-family: 'Inter', sans-serif; }
        .wmg-calc-item-val { font-family: 'Inter', sans-serif; font-size: 17px; font-weight: 600; color: var(--sage); }

        .wmg-ef-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
        .wmg-progress-track { width: 100%; height: 11px; background: var(--ink-3); border-radius: 6px; overflow: hidden; border: 1px solid var(--hair); }
        .wmg-progress-fill { height: 100%; border-radius: 6px; transition: width .3s ease; }
        .wmg-progress-fill.tone-gold { background: var(--gold); }
        .wmg-progress-fill.tone-sage { background: var(--sage); }

        .wmg-sub-list { display: flex; flex-direction: column; gap: 8px; }
        .wmg-sub-row { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; background: var(--ink-3); border-radius: 9px; border: 1px solid var(--hair); }
        .wmg-sub-row.cancelled { opacity: 0.4; }
        .wmg-sub-left { display: flex; align-items: center; gap: 10px; }
        .wmg-sub-name { font-size: 13.5px; }
        .wmg-flag { font-size: 9.5px; font-family: 'Inter', sans-serif; color: var(--gold); border: 1px solid var(--gold); border-radius: 999px; padding: 2px 8px; }
        .wmg-sub-amount { font-family: 'Inter', sans-serif; font-size: 13.5px; }
        .wmg-toggle-btn { font-family: 'Inter', sans-serif; font-size: 10.5px; border: 1px solid var(--hair); background: transparent; color: var(--paper); padding: 6px 12px; border-radius: 999px; cursor: pointer; margin-left: 14px; }
        .wmg-toggle-btn.is-cancelled { border-color: var(--sage); color: var(--sage); }
        .wmg-subs-total { display: flex; justify-content: space-between; margin-top: 14px; font-family: 'Inter', sans-serif; font-size: 12.5px; color: var(--paper-dim); }

        .wmg-coach { border-left: 3px solid var(--gold); }
        .wmg-coach-title { font-family: 'Inter', sans-serif; font-style: italic; font-size: 16px; margin-bottom: 12px; }
        .wmg-coach-tip { display: flex; gap: 10px; padding: 11px 0; border-top: 1px solid var(--hair); font-size: 13.5px; line-height: 1.5; }
        .wmg-coach-tip:first-of-type { border-top: none; }
        .wmg-coach-dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
        .dot-gold { background: var(--gold); }
        .dot-sage { background: var(--sage); }
        .dot-rust { background: var(--rust); }

        .wmg-field-label { font-family: 'Inter', sans-serif; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--paper-dim); margin-bottom: 6px; display: block; }
        .wmg-field { margin-bottom: 12px; }
        .wmg-input { background: var(--ink-3); color: var(--paper); border: 1px solid var(--hair); border-radius: 7px; padding: 9px 10px; font-family: 'Inter', sans-serif; font-size: 12.5px; width: 100%; }
        .wmg-input:focus, .wmg-select:focus { outline: 2px solid var(--gold); outline-offset: 1px; }
        .wmg-textarea { min-height: 92px; resize: vertical; line-height: 1.6; }
        .wmg-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .wmg-add-btn:disabled:hover { border-color: var(--hair); color: var(--paper-dim); }
        .wmg-array-editor { margin-bottom: 6px; }
        .wmg-array-title { font-size: 11.5px; color: var(--paper-dim); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; font-family: 'Inter', sans-serif;}
        .wmg-array-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
        .wmg-icon-btn { background: transparent; border: 1px solid var(--hair); color: var(--rust); border-radius: 6px; width: 32px; height: 32px; cursor: pointer; flex-shrink: 0; }
        .wmg-add-btn { background: transparent; border: 1px dashed var(--hair); color: var(--paper-dim); border-radius: 8px; padding: 8px 12px; font-size: 11.5px; cursor: pointer; width: 100%; font-family: 'Inter', sans-serif; }
        .wmg-add-btn:hover { border-color: var(--gold); color: var(--gold); }

        .wmg-cat-card { margin-bottom: 14px; }
        .wmg-cat-head { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
        .wmg-cat-name-input { flex: 2; }
        .wmg-cat-type-select { flex: 1; }
        .wmg-cat-subtotal { display: flex; justify-content: space-between; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--hair); font-family: 'Inter', sans-serif; font-size: 12.5px; }
        .wmg-cat-subtotal-val { font-weight: 600; }
        .wmg-tag { font-size: 9.5px; font-family: 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--hair); color: var(--paper-dim); }
        .wmg-tag.essential { border-color: var(--slate); color: var(--paper); }
        .wmg-tag.lifestyle { border-color: var(--gold); color: var(--gold); }

        .wmg-goal-card { margin-bottom: 14px; }
        .wmg-goal-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; gap: 10px; flex-wrap: wrap; }
        .wmg-goal-name-input { font-family: 'Inter', sans-serif; font-size: 16px; background: transparent; border: none; border-bottom: 1px solid transparent; color: var(--paper); padding: 2px 0; }
        .wmg-goal-name-input:focus { outline: none; border-bottom-color: var(--gold); }
        .wmg-goal-numbers { display: flex; gap: 20px; flex-wrap: wrap; margin: 12px 0; }
        .wmg-goal-plan { margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--hair); font-size: 13px; line-height: 1.6; }
        .wmg-goal-plan-highlight { color: var(--gold); font-weight: 600; }
        .wmg-inline-input { width: 90px; }

        .wmg-pension-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 20px; }
        @media (max-width: 780px) { .wmg-pension-cards { grid-template-columns: 1fr; } }
        .wmg-pension-scenario-name { font-family: 'Inter', sans-serif; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 10px; }
        .wmg-pension-value { font-family: 'Inter', sans-serif; font-size: 26px; font-weight: 600; margin-bottom: 4px; }
        .wmg-pension-income { font-size: 12px; color: var(--paper-dim); }

        .wmg-tooltip { background: #FFFFFF; border: 1px solid var(--hair); border-radius: 8px; padding: 10px 12px; font-size: 12px; box-shadow: 0 4px 16px rgba(23,27,33,0.1); }
        .wmg-tooltip-label { font-family: 'Inter', sans-serif; color: var(--paper-dim); margin-bottom: 6px; font-size: 11px; }
        .wmg-tooltip-row { display: flex; align-items: center; gap: 7px; margin-top: 3px; }
        .wmg-tooltip-name { color: var(--paper-dim); }
        .wmg-tooltip-val { font-family: 'Inter', sans-serif; font-weight: 600; margin-left: auto; }

        .wmg-forecast-summary { display: flex; gap: 24px; flex-wrap: wrap; margin: 18px 0 6px; padding: 16px 0; border-top: 1px solid var(--hair); border-bottom: 1px solid var(--hair); }
        .wmg-forecast-note { font-size: 11.5px; color: var(--paper-dim); margin-top: 14px; line-height: 1.6; }

        .wmg-accordion-item { border-bottom: 1px solid var(--hair); }
        .wmg-accordion-item:last-child { border-bottom: none; }
        .wmg-accordion-head { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: transparent; border: none; text-align: left; padding: 14px 2px; cursor: pointer; font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600; color: var(--paper); }
        .wmg-accordion-head:hover { color: var(--gold); }
        .wmg-accordion-icon { font-family: 'Inter', sans-serif; font-size: 16px; color: var(--gold); flex-shrink: 0; width: 18px; text-align: center; }
        .wmg-accordion-body { padding: 0 2px 16px; font-size: 13.5px; line-height: 1.65; color: var(--paper-dim); }

        .wmg-footnote { font-size: 11px; color: var(--paper-dim); margin-top: 40px; text-align: center; line-height: 1.6; }
      `}</style>

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
            {NAV.map((n) => (
              <button key={n.key} className={`wmg-nav-item ${tab === n.key ? "active" : ""}`} onClick={() => setTab(n.key)}>
                <span className="wmg-nav-icon"><NavIcon name={n.icon} /></span>
                <span>{n.label}</span>
              </button>
            ))}
          </nav>
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
            {confirmingReset ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button className="wmg-reset-btn danger" onClick={resetData}>Yes, reset</button>
                <button className="wmg-reset-btn" onClick={() => setConfirmingReset(false)}>Cancel</button>
              </div>
            ) : (
              <button className="wmg-reset-btn" onClick={() => setConfirmingReset(true)}>Reset to example data</button>
            )}
            {supabase && (
              <button
                className="wmg-reset-btn"
                style={{ marginTop: 8 }}
                onClick={() => supabase.auth.signOut()}
              >
                Sign out
              </button>
            )}
          </div>
        </div>

        {/* main */}
        <div className="wmg-main">
          <div className="wmg-topbar">
            <div className="wmg-topbar-title">{NAV.find((n) => n.key === tab)?.label}</div>
            <div className="wmg-topbar-stats">
              <div className="wmg-score-chip">
                <span className="wmg-score-chip-dot" style={{ background: score >= 70 ? "var(--sage)" : score >= 45 ? "var(--gold)" : "var(--rust)" }} />
                <span className="wmg-mono" style={{ fontSize: 13, fontWeight: 600 }}>{score}/100</span>
              </div>
              <div className="wmg-topbar-stat">
                <div className="wmg-topbar-stat-label">Net worth</div>
                <div className="wmg-topbar-stat-val tone-gold">{gbp(totals.netWorth)}</div>
              </div>
              <div className="wmg-topbar-stat">
                <div className="wmg-topbar-stat-label">Available / mo</div>
                <div className="wmg-topbar-stat-val" style={{ color: totals.available >= 0 ? "var(--sage)" : "var(--rust)" }}>{gbp(totals.available)}</div>
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
                setField={setField}
                updateArrayItem={updateArrayItem}
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
    </div>
  );
}

/* ============================== tabs ============================== */

function OverviewTab({ score, gap, totals, profile, debtFreeMonths, mortgageMonths, flowSegments, flowTotal, coachTips }) {
  return (
    <>
      <div className="wmg-score-row">
        <Card className="wmg-score-card">
          <Gauge score={score} />
          <div className="wmg-score-num">
            {score}
            <span style={{ fontSize: 16, color: "var(--paper-dim)" }}>/100</span>
          </div>
          <div className="wmg-score-label">Financial score</div>
        </Card>
        <Card className="wmg-verdict-card">
          <p className="wmg-verdict">
            {gap > 0 ? (
              <>You're <span className="wmg-mono">{gbp(Math.round(gap))}/month</span> away from being financially comfortable.</>
            ) : (
              <>You're <span className="wmg-mono">{gbp(Math.round(-gap))}/month</span> past "comfortable." Put the surplus to work.</>
            )}
          </p>
          <div className="wmg-mini-stats">
            <div>
              <div className="wmg-mini-stat-label">Debt-free</div>
              <div className="wmg-mini-stat-val">{isFinite(debtFreeMonths) ? addMonths(debtFreeMonths) : "—"}</div>
            </div>
            <div>
              <div className="wmg-mini-stat-label">Mortgage-free</div>
              <div className="wmg-mini-stat-val">{isFinite(mortgageMonths) ? addMonths(mortgageMonths) : "—"}</div>
            </div>
            <div>
              <div className="wmg-mini-stat-label">Disposable / month</div>
              <div className="wmg-mini-stat-val">{gbp(totals.available)}</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="wmg-section-title">Net worth</div>
      <div className="wmg-nw-grid">
        <Card className="wmg-stat wmg-networth-card">
          <div className="wmg-eyebrow">Net worth</div>
          <div className="wmg-figure tone-gold" style={{ fontSize: 24 }}>{gbp(totals.netWorth)}</div>
        </Card>
        <Stat label="Debt" value={gbp(totals.totalDebt)} tone="rust" />
        <Stat label="Home equity" value={gbp(totals.homeEquity)} tone="sage" />
        <Stat label="Savings" value={gbp(profile.savings.balance)} tone="paper" />
        <Stat label="Pension" value={gbp(profile.pension.balance)} tone="paper" />
        <Stat label="Investments" value={gbp(profile.investments.balance)} tone="paper" />
      </div>

      <div className="wmg-section-title">This month</div>
      <Card>
        <div className="wmg-flow-bar">
          {flowSegments.map((seg) => (
            <div key={seg.key} className={`wmg-flow-seg bg-${seg.tone}`} style={{ width: `${(seg.value / flowTotal) * 100}%` }}>
              {(seg.value / flowTotal) * 100 > 8 ? gbp(seg.value) : ""}
            </div>
          ))}
        </div>
        <div className="wmg-flow-legend">
          <div className="wmg-flow-legend-item">
            <span className="wmg-swatch" style={{ background: "var(--paper-dim)" }} />
            Income <span className="wmg-flow-legend-val">{gbp(totals.income)}</span>
          </div>
          {flowSegments.map((seg) => (
            <div className="wmg-flow-legend-item" key={seg.key}>
              <span className="wmg-swatch" style={{ background: `var(--${seg.tone})` }} />
              {seg.label} <span className="wmg-flow-legend-val">{gbp(seg.value)}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="wmg-section-title">Your coach</div>
      <Card className="wmg-coach">
        <div className="wmg-coach-title">"Here's what I'd do if I were you."</div>
        {coachTips.length === 0 && (
          <div className="wmg-coach-tip">
            <span className="wmg-coach-dot dot-sage" />
            Everything's in decent shape. Keep going.
          </div>
        )}
        {coachTips.map((tip, i) => (
          <div className="wmg-coach-tip" key={i}>
            <span className={`wmg-coach-dot dot-${tip.tone}`} />
            <span>{tip.text}</span>
          </div>
        ))}
      </Card>
    </>
  );
}

function IncomeTab({ profile, totals, setField, addCategory, removeCategory, updateCategoryField, addItem, removeItem, updateItem, toggleSub, updateArrayItem, addArrayItem, removeArrayItem }) {
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
                <button className={`wmg-toggle-btn ${s.cancelled ? "is-cancelled" : ""}`} onClick={() => toggleSub(s.id)}>
                  {s.cancelled ? "Restored" : "Cancel"}
                </button>
                <button className="wmg-icon-btn" onClick={() => removeArrayItem("subscriptions")(s.id)} aria-label="Remove">✕</button>
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

function DebtsTab({ profile, setField, updateArrayItem, addArrayItem, removeArrayItem, allDebts, mortgageMonths, debtFreeMonths, selectedDebtId, setSelectedDebtId, extraPayment, setExtraPayment, extraCalc, addBulkItems }) {
  const selectedDebt = allDebts.find((d) => d.id === selectedDebtId) || allDebts[0];
  return (
    <>
      <div className="wmg-section-title">Mortgage</div>
      <Card>
        <div className="wmg-three-col">
          <Field label="Balance outstanding">
            <input className="wmg-input" type="number" value={profile.mortgage.balance} onChange={(e) => setField(["mortgage", "balance"])(Number(e.target.value))} />
          </Field>
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
      </Card>

      <div className="wmg-section-title">Quick add</div>
      <QuickImport onAdd={addBulkItems} />

      <div className="wmg-section-title">Loans</div>
      <Card>
        <ArrayEditor
          title="Loans"
          items={profile.loans}
          fields={[
            { key: "name", label: "Name" },
            { key: "balance", label: "Balance", type: "number" },
            { key: "rate", label: "Rate %", type: "number" },
            { key: "payment", label: "Payment", type: "number" },
          ]}
          onChange={updateArrayItem("loans")}
          onAdd={addArrayItem("loans", { name: "New loan", balance: 0, rate: 0, payment: 0 })}
          onRemove={removeArrayItem("loans")}
          addLabel="Add loan"
        />
      </Card>

      <div className="wmg-section-title">Credit cards</div>
      <Card>
        <ArrayEditor
          title="Credit cards"
          items={profile.cards}
          fields={[
            { key: "name", label: "Name" },
            { key: "balance", label: "Balance", type: "number" },
            { key: "rate", label: "Rate %", type: "number" },
            { key: "payment", label: "Payment", type: "number" },
          ]}
          onChange={updateArrayItem("cards")}
          onAdd={addArrayItem("cards", { name: "New card", balance: 0, rate: 0, payment: 0 })}
          onRemove={removeArrayItem("cards")}
          addLabel="Add credit card"
        />
      </Card>

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
          <Field label="Drawdown rate at retirement (%)">
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
          <Field label="Medium growth scenario (%/yr)">
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
              <CartesianGrid stroke="#E2E5EA" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "#626B7A", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(y) => `Yr ${y}`} stroke="#E2E5EA" />
              <YAxis tick={{ fill: "#626B7A", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(v) => `£${Math.round(v / 1000)}k`} stroke="#E2E5EA" width={54} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Inter" }} />
              <Line type="monotone" dataKey="high" name="High" stroke="#227A56" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="medium" name="Medium" stroke="#9A752B" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="low" name="Low" stroke="#B23B2E" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}

function ForecastTab({ horizonYears, setHorizonYears, allocationPct, setAllocationPct, forecast, interestSavedFromAllocation, totals, profile, setField }) {
  const [realTerms, setRealTerms] = useState(false);
  const suffix = realTerms ? "Real" : "";
  const last = forecast.series[forecast.series.length - 1];
  const key = (base) => `${base}${suffix}`;

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

        <div className="wmg-two-col" style={{ marginTop: 4 }}>
          <Field label="Assumed annual pay growth (%)">
            <input className="wmg-input" type="number" step="0.1" value={profile.assumptions.incomeGrowth} onChange={(e) => setField(["assumptions", "incomeGrowth"])(Number(e.target.value))} />
          </Field>
          <Field label="Assumed annual inflation (%)">
            <input className="wmg-input" type="number" step="0.1" value={profile.assumptions.inflation} onChange={(e) => setField(["assumptions", "inflation"])(Number(e.target.value))} />
          </Field>
        </div>

        <div style={{ width: "100%", height: 320, marginTop: 10 }}>
          <ResponsiveContainer>
            <LineChart data={forecast.series} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#E2E5EA" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: "#626B7A", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(y) => `Yr ${y}`} stroke="#E2E5EA" />
              <YAxis tick={{ fill: "#626B7A", fontSize: 11, fontFamily: "Inter" }} tickFormatter={(v) => `£${Math.round(v / 1000)}k`} stroke="#E2E5EA" width={54} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: "Inter" }} />
              <Line type="monotone" dataKey={key("netWorth")} name="Net worth" stroke="#9A752B" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey={key("debt")} name="Total debt (incl. mortgage)" stroke="#B23B2E" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey={key("savingsInvest")} name="Savings & investments" stroke="#227A56" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey={key("pension")} name="Pension" stroke="#626B7A" strokeWidth={2} dot={false} strokeDasharray="4 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="wmg-forecast-summary">
          <div>
            <div className="wmg-calc-item-label">Net worth in {horizonYears} years{realTerms ? " (today's money)" : ""}</div>
            <div className="wmg-calc-item-val" style={{ color: "var(--gold)" }}>{last ? gbp(last[key("netWorth")]) : "—"}</div>
          </div>
          <div>
            <div className="wmg-calc-item-label">Debt remaining then</div>
            <div className="wmg-calc-item-val" style={{ color: "var(--rust)" }}>{last ? gbp(last[key("debt")]) : "—"}</div>
          </div>
          <div>
            <div className="wmg-calc-item-label">Debt-free date</div>
            <div className="wmg-calc-item-val" style={{ color: "var(--paper)" }}>{forecast.debtFreeMonth !== null ? addMonths(forecast.debtFreeMonth) : `beyond ${horizonYears} yrs`}</div>
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
          {profile.assumptions.inflation}%/yr, compounding monthly. Mortgage, loan and card payments are held fixed, as
          they contractually are. Cash savings, investments and pension compound at the rates set in their own
          sections; house prices grow at the rate set in Debts &amp; Mortgage.{" "}
          {profile.statePension?.included
            ? `Your State Pension (£${profile.statePension.weeklyAmount}/week today) is added to household income from age ${profile.statePension.claimAge}, uprated with inflation.`
            : "Your State Pension isn't included — switch it on in Pension & Retirement."}{" "}
          "Today's money" discounts every figure back to present-day purchasing power using the inflation rate above.
          Real life still has rate changes, job changes and surprises — treat this as a direction of travel, not a
          promise.
        </div>
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
