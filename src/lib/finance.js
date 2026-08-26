export const gbp = (n, decimals = 0) => {
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

/* For forward-looking, assumption-based figures (forecasts, projections) —
   deliberately rounds off false precision. A number generated from growth
   and inflation guesses shouldn't be presented down to the exact pound, as
   that implies a confidence the underlying maths doesn't have. Prefixes
   with ≈ so it visually reads as an estimate, not a fact. */

export const gbpApprox = (n) => {
  if (n === null || n === undefined || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const roundTo = abs >= 100000 ? 5000 : abs >= 10000 ? 1000 : abs >= 1000 ? 100 : 10;
  const rounded = Math.round(n / roundTo) * roundTo;
  return "≈ " + gbp(rounded);
};


export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));


export function daysSince(dateStr) {
  if (!dateStr) return 0;
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)));
}


export function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/* Projects a balance forward from the date it was last confirmed, using
   ordinary scheduled amortisation only (no extra payments) — this is
   deliberately a plain, honest estimate, not a promise. */

export function estimateBalanceToday(balance, annualRatePct, payment, lastConfirmedAt) {
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


export function monthsToPayoff(balance, annualRatePct, payment) {
  const r = annualRatePct / 100 / 12;
  if (balance <= 0) return 0;
  if (r === 0) return payment > 0 ? balance / payment : Infinity;
  if (payment <= balance * r) return Infinity;
  return Math.log(payment / (payment - balance * r)) / Math.log(1 + r);
}


export function totalInterestOwed(balance, annualRatePct, payment, months) {
  if (!isFinite(months)) return Infinity;
  return Math.max(0, payment * months - balance);
}


export function addMonths(months) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + Math.round(months));
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

// "2026-08" style key for a given date (defaults to now) — used to tag
// spending snapshots by calendar month.
export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// "2026-08" -> "Aug 2026" for display.
export function formatMonthKey(key) {
  const [y, m] = String(key).split("-").map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}


export function futureValue(balance, monthlyContribution, annualRatePct, months) {
  const r = annualRatePct / 100 / 12;
  if (months <= 0) return balance;
  if (r === 0) return balance + monthlyContribution * months;
  return (
    balance * Math.pow(1 + r, months) +
    monthlyContribution * ((Math.pow(1 + r, months) - 1) / r)
  );
}


export let uid = 1000;

export const nextId = () => uid++;

/* ====================== adaptive experience (Phase 2) ====================== */


export const MODE_LABELS = { guided: "Guided", standard: "Standard" };

// preferredMode (an explicit choice, from onboarding or Settings) always wins
// over recommendedMode (the onboarding suggestion) — this is what lets a
// future smarter recommendation engine exist later without ever silently
// changing someone's chosen experience.

export function getActiveMode(profile) {
  return profile.preferredMode || profile.recommendedMode || "standard";
}

// Base the recommendation on how the person wants information presented
// (Q2) — that's the more direct signal for a *presentation* setting.
// Only two modes exist: Guided (simple, explained) and Standard (full
// detail). There used to be a third "Advanced" mode, but it never actually
// behaved differently from Standard anywhere in the app, so it was removed
// rather than kept as a label with no real effect.

export function deriveRecommendedMode(comfort, detail) {
  return detail === "simple" ? "guided" : "standard";
}

/* ============================ default data ============================ */


export const defaultProfile = {
  onboarded: false,
  incomes: [{ id: nextId(), name: "Your income", amount: 5800 }],
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
    { id: nextId(), name: "Car loan", balance: 21000, rate: 7.9, payment: 300, originalBalance: 24000, lastConfirmedAt: daysAgoISO(48), debtType: "loan" },
    { id: nextId(), name: "Personal loan", balance: 18800, rate: 9.9, payment: 290, originalBalance: 18800, lastConfirmedAt: daysAgoISO(6), debtType: "loan" },
  ],
  cards: [{ id: nextId(), name: "Credit card", balance: 3200, rate: 22.9, payment: 150, originalBalance: 4500, lastConfirmedAt: daysAgoISO(12), debtType: "card" }],
  expenseCategories: [
    {
      id: nextId(),
      name: "Housing & utilities",
      type: "essential",
      budget: 500,
      isBills: true,
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
      budget: 140,
      isBills: true,
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
      budget: 260,
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
      budget: 550,
      items: [
        { id: nextId(), name: "Groceries", amount: 520 },
        { id: nextId(), name: "Household goods", amount: 40 },
      ],
    },
    {
      id: nextId(),
      name: "Childcare & family",
      type: "essential",
      budget: 340,
      items: [{ id: nextId(), name: "Childcare", amount: 340 }],
    },
    {
      id: nextId(),
      name: "Health & personal care",
      type: "essential",
      budget: 150,
      items: [
        { id: nextId(), name: "Pharmacy / health", amount: 70 },
        { id: nextId(), name: "Personal care", amount: 80 },
      ],
    },
    {
      id: nextId(),
      name: "Lifestyle & leisure",
      type: "lifestyle",
      budget: 900,
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
  // Multiple pension pots are supported (workplace, personal, old employer
  // pots, etc). Each pot compounds independently under its own growth
  // assumptions. currentAge/retirementAge/drawdownRate are deliberately
  // person-level (pensionSettings), not per-pot — retirement age doesn't
  // vary by which pot you're looking at.
  pensions: [
    { id: nextId(), name: "Workplace pension", balance: 74000, contribution: 350, growthLow: 3, growthMedium: 5, growthHigh: 7 },
  ],
  pensionSettings: {
    currentAge: 35,
    retirementAge: 67,
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
  billsConfirmed: false,
  // Phase 2 of the adaptive experience: recommendedMode comes from the two
  // onboarding preference questions and is never overwritten automatically.
  // preferredMode is null until the person explicitly picks a mode (either
  // by accepting the onboarding recommendation or changing it later in
  // Settings) — once set, it always wins over recommendedMode.
  recommendedMode: "standard",
  preferredMode: null,
  // Month-over-month spending history. Deliberately NOT auto-inferred from
  // calendar rollover — the app has no per-transaction dates, so silently
  // guessing which numbers belong to "last month" risks mislabelling data
  // the person already edited for the current month. Instead each entry is
  // an explicit, dated save: { id, month: "YYYY-MM", savedAt: ISO string,
  // income, totalSpending, byCategory: [{ id, name, amount }] }. Saving
  // again in the same month updates that month's entry rather than adding
  // a duplicate.
  spendingSnapshots: [],
  // Tracks which tabs' first-visit tip banner has been dismissed, so the
  // one-time "what to add and why" explainer never nags on repeat visits.
  seenTabTips: [],
  // Set by the overnight bank-sync cron job (api/sync-bank-transactions.js)
  // when it finds new transactions for a connected bank: { categoryTotals,
  // incomeEstimate, transactionCount, fromDate, toDate, syncedAt }. Never
  // written by the frontend. Cleared once the household reviews and
  // applies (or discards) it in the Import tab — see OverviewTab's banner
  // and BankImportTab's TransactionsImport. null means nothing pending.
  pendingBankSync: null,
  // Set by the same cron job's periodic (roughly weekly) recurring-payment
  // scan: an array of { id, name, rawAmount, frequency, monthlyAmount,
  // occurrences, lastDate }. Never written by the frontend. Each entry is
  // reviewed individually in IncomeTab's Subscriptions section — accepting
  // one adds it to `subscriptions` below and removes it from this list;
  // dismissing just removes it. Replaced wholesale on each scan.
  pendingSubscriptions: [],
};

/* Backfills any fields missing from previously-saved data (e.g. saved before a
   feature like State Pension existed) with sensible defaults, so old saves never
   crash the app when new fields are added. */

export function mergeWithDefaults(saved) {
  if (!saved || typeof saved !== "object") return defaultProfile;
  const merged = { ...defaultProfile, ...saved };
  const nestedObjectKeys = ["mortgage", "pensionSettings", "statePension", "savings", "emergencyFund", "investments", "assumptions"];
  nestedObjectKeys.forEach((k) => {
    merged[k] = { ...defaultProfile[k], ...(saved[k] && typeof saved[k] === "object" ? saved[k] : {}) };
  });
  const arrayKeys = ["loans", "cards", "expenseCategories", "subscriptions", "goals", "lifeEvents", "scenarios", "spendingSnapshots", "seenTabTips", "pendingSubscriptions"];
  arrayKeys.forEach((k) => {
    merged[k] = Array.isArray(saved[k]) ? saved[k] : defaultProfile[k];
  });

  // migrate the old single-figure `income` field (pre-multi-income) into the
  // new `incomes` list, so nobody's saved take-home figure gets silently lost
  if (Array.isArray(saved.incomes) && saved.incomes.length > 0) {
    merged.incomes = saved.incomes;
  } else if (typeof saved.income === "number") {
    merged.incomes = [{ id: nextId(), name: "Your income", amount: saved.income }];
  } else {
    merged.incomes = defaultProfile.incomes;
  }
  delete merged.income;

  // "advanced" mode was removed (it never actually behaved differently from
  // "standard" anywhere in the app) — anyone who'd previously picked it
  // lands on "standard" instead, rather than an option that no longer exists.
  if (merged.preferredMode === "advanced") merged.preferredMode = "standard";

  // Drawdown rate is no longer user-editable (fixed at the standard 4% —
  // see PensionTab) — anyone with an old saved custom value gets normalised
  // to 4 rather than silently keeping a stale figure the UI no longer shows.
  merged.pensionSettings = { ...merged.pensionSettings, drawdownRate: defaultProfile.pensionSettings.drawdownRate };
  if (merged.recommendedMode === "advanced") merged.recommendedMode = "standard";

  // migrate the old single-pot `pension` object (pre-multi-pension) into the
  // new `pensions` list, same pattern as incomes above. currentAge,
  // retirementAge and drawdownRate move out to the new person-level
  // `pensionSettings` object (merged separately above), since those were
  // never really "per pot" even in the old single-pension shape.
  if (Array.isArray(saved.pensions) && saved.pensions.length > 0) {
    merged.pensions = saved.pensions;
  } else if (saved.pension && typeof saved.pension === "object") {
    merged.pensions = [
      {
        id: nextId(),
        name: "Your pension",
        balance: saved.pension.balance ?? 0,
        contribution: saved.pension.contribution ?? 0,
        growthLow: saved.pension.growthLow ?? defaultProfile.pensions[0].growthLow,
        growthMedium: saved.pension.growthMedium ?? defaultProfile.pensions[0].growthMedium,
        growthHigh: saved.pension.growthHigh ?? defaultProfile.pensions[0].growthHigh,
      },
    ];
    merged.pensionSettings = {
      currentAge: saved.pension.currentAge ?? defaultProfile.pensionSettings.currentAge,
      retirementAge: saved.pension.retirementAge ?? defaultProfile.pensionSettings.retirementAge,
      drawdownRate: saved.pension.drawdownRate ?? defaultProfile.pensionSettings.drawdownRate,
    };
  } else {
    merged.pensions = defaultProfile.pensions;
  }
  delete merged.pension;

  // backfill balance-tracking fields for debts saved before this feature existed
  const backfillDebt = (d, fallbackType) => ({
    ...d,
    originalBalance: d.originalBalance ?? d.balance,
    lastConfirmedAt: d.lastConfirmedAt ?? new Date().toISOString(),
    debtType: d.debtType ?? fallbackType,
  });
  merged.loans = merged.loans.map((d) => backfillDebt(d, "loan"));
  merged.cards = merged.cards.map((d) => backfillDebt(d, "card"));
  merged.mortgage = backfillDebt(merged.mortgage, "mortgage");

  // backfill budget for expense categories saved before this feature existed —
  // default to their current spend so nothing looks suddenly "over budget"
  merged.expenseCategories = merged.expenseCategories.map((c) => ({
    ...c,
    budget: c.budget ?? c.items.reduce((s, i) => s + Number(i.amount || 0), 0),
    isBills: c.isBills ?? (c.name === "Housing & utilities" || c.name === "Insurance & protection"),
  }));

  return merged;
}

/* Sums every income source into one monthly figure. Everywhere else in the
   app (score, available funds, the forecast engine) reads this single number
   rather than the incomes list directly, so adding or removing an income
   source needs no other changes anywhere downstream. */
export function totalIncome(profile) {
  return (profile.incomes || []).reduce((s, i) => s + Number(i.amount || 0), 0);
}

/* ============================ UK tax estimate ============================ */
/* Simplified 2024/25-style England & NI bands. Ignores National Insurance,
   the personal allowance taper above £100k, Scottish rates, and any other
   income the person may have. It's a directional estimate, not a tax return. */

export function estimateUKIncomeTax(grossAnnual) {
  const PA = 12570;
  const BASIC = 50270;
  const HIGHER = 125140;
  if (grossAnnual <= PA) return 0;
  if (grossAnnual <= BASIC) return (grossAnnual - PA) * 0.2;
  if (grossAnnual <= HIGHER) return (BASIC - PA) * 0.2 + (grossAnnual - BASIC) * 0.4;
  return (BASIC - PA) * 0.2 + (HIGHER - BASIC) * 0.4 + (grossAnnual - HIGHER) * 0.45;
}

/* ============================ forecast engine ============================ */


export function runForecast(profile, totals, horizonYears, allocationPct, growthOffsetPct = 0) {
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
  // Each pension pot compounds independently under its own medium-growth
  // assumption and receives its own contribution — a person with one
  // higher-growth pot and one cautious pot shouldn't have them blended into
  // a single average rate.
  const pensionPots = (profile.pensions || []).map((p) => ({
    balance: p.balance,
    rate: Math.max(0, p.growthMedium + growthOffsetPct),
    contribution: p.contribution,
  }));

  let essential = totals.essential - mortgagePayment;
  let lifestyle = totals.lifestyle;
  let income = totals.income;
  const incomeGrowthM = (profile.assumptions?.incomeGrowth ?? 0) / 100 / 12;
  const inflationM = (profile.assumptions?.inflation ?? 0) / 100 / 12;

  const statePensionIncluded = profile.statePension?.included ?? false;
  let statePensionMonthly = ((profile.statePension?.weeklyAmount ?? 0) * 52) / 12;
  const statePensionClaimAgeMonths = (profile.statePension?.claimAge ?? 67) * 12;
  const startAgeMonths = (profile.pensionSettings?.currentAge ?? 35) * 12;
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
    pensionPots.forEach((pot) => {
      pot.balance = pot.balance * (1 + pot.rate / 100 / 12) + pot.contribution;
    });
    const pension = pensionPots.reduce((s, pot) => s + pot.balance, 0);

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


export function parseDebtLines(text) {
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


