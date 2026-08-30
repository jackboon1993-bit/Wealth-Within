import React, { useState, useMemo, useEffect, useRef, Suspense, lazy } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { API_BASE } from "./lib/apiBase";
import { startUpgrade, fetchSubscriptionStatus } from "./lib/subscription";
import { getData, setData, deleteData, subscribeToHouseholdData, getHouseholdId, hasAccounts } from "./lib/storage";
import { supabase } from "./lib/supabaseClient";
import { submitFeedback } from "./lib/feedback";
import {
  gbp,
  clamp,
  estimateBalanceToday,
  monthsToPayoff,
  totalInterestOwed,
  futureValue,
  nextId,
  monthKey,
  defaultProfile,
  mergeWithDefaults,
  estimateUKIncomeTax,
  totalIncome,
  runForecast,
} from "./lib/finance";
import { NAV, TAB_TITLES, FREE_BANK_PULL_COOLDOWN_DAYS } from "./lib/constants";
import { useCountUp, NavIcon, BrandMark, Mascot, TabTip } from "./components/ui";
import { AccountPanel } from "./components/AccountPanel";
import { SetupWizard } from "./components/SetupWizard";
import { checkCategoryBudgets, requestNotificationPermission } from "./utils/notifications";
import { syncWidgetData } from "./utils/widgetSync";

// Each tab is its own chunk, fetched only when the person actually visits
// it, instead of all eight being bundled into the single ~800kB initial
// load. Overview is used at every startup so we DON'T lazy-load it — that
// would just trade one big blocking download for a different one.
import { OverviewTab } from "./tabs/OverviewTab";
const IncomeTab = lazy(() => import("./tabs/IncomeTab").then((m) => ({ default: m.IncomeTab })));
const DebtsTab = lazy(() => import("./tabs/DebtsTab").then((m) => ({ default: m.DebtsTab })));
const GoalsTab = lazy(() => import("./tabs/GoalsTab").then((m) => ({ default: m.GoalsTab })));
const PensionTab = lazy(() => import("./tabs/PensionTab").then((m) => ({ default: m.PensionTab })));
const ForecastTab = lazy(() => import("./tabs/ForecastTab").then((m) => ({ default: m.ForecastTab })));
const EducationTab = lazy(() => import("./tabs/EducationTab").then((m) => ({ default: m.EducationTab })));

// Thin wrappers so PensionReaderTab/ImportTab (two named exports from one
// chunk) can each still be lazy-loaded individually without fetching the
// whole BankImportTab chunk twice.
const PensionReaderTab = lazy(() => import("./tabs/BankImportTab").then((m) => ({ default: m.PensionReaderTab })));
const ImportTab = lazy(() => import("./tabs/BankImportTab").then((m) => ({ default: m.ImportTab })));

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
  // Set right before applying a change that arrived from another household
  // member, so the save effect below can skip writing it straight back to
  // Supabase — without this, receiving a remote update would immediately
  // re-save it, which re-notifies every subscriber, which re-applies it
  // again, forever.
  const applyingRemoteUpdate = useRef(false);

  // Tracks whether this household actually has a bank connected — null
  // until the first check completes, then either [] (checked, none
  // connected) or the real account list. This is the single source of
  // truth several screens need (Overview's banner, the Import tab's
  // "pull transactions" button) — each used to guess at this from
  // unrelated state (whether Supabase was configured, whether a
  // household existed) rather than actually checking, so they'd stay
  // stuck showing "Connect a bank" forever even after one was connected.
  const [connectedBankAccounts, setConnectedBankAccounts] = useState(null);
  const hasConnectedBank = Array.isArray(connectedBankAccounts) && connectedBankAccounts.length > 0;

  const refreshConnectedBank = async () => {
    if (!hasAccounts) return;
    try {
      const householdId = await getHouseholdId();
      if (!householdId) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const resp = await fetch(`${API_BASE}/api/truelayer-accounts`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (resp.status === 404) {
        setConnectedBankAccounts([]);
        return;
      }
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setConnectedBankAccounts(data.accounts || []);
    } catch {
      // Leave whatever we last knew as-is — a transient network failure
      // here shouldn't flip a genuinely connected bank back to looking
      // disconnected in the UI.
    }
  };

  const [subscription, setSubscription] = useState({ hasPremium: false, status: "none" });

  const refreshSubscriptionStatus = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const data = await fetchSubscriptionStatus(session.access_token);
      setSubscription(data);
    } catch (err) {
      console.error("Failed to refresh subscription status:", err);
    }
  };

  const [planPickerOpen, setPlanPickerOpen] = useState(false);
  const [upgradeBusy, setUpgradeBusy] = useState(false);

  // Every gated feature calls onUpgrade the same way it always has — this
  // now opens a small "choose your plan" step first, since there are two
  // prices (monthly, with a 14-day trial; annual, with none) instead of
  // the one price this used to jump straight to checkout with.
  const handleUpgrade = () => setPlanPickerOpen(true);

  const confirmUpgrade = async (plan) => {
    setUpgradeBusy(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      await startUpgrade(session.access_token, plan);
      // The browser tab/sheet takes over from here; the deep-link
      // handlers below pick things up again once it closes — same
      // pattern as connectBank().
    } catch (err) {
      console.error("Failed to start upgrade:", err);
    } finally {
      setUpgradeBusy(false);
      setPlanPickerOpen(false);
    }
  };

  // ---- Feature gating -----------------------------------------------
  // hasPremium (from `subscription`, above) is the single source of truth
  // for what's Premium-only. Every gated feature reads it the same way
  // OverviewTab already did before this change — this block just extends
  // that same pattern to the rest of the app rather than inventing a new
  // one. See the priority to-do list: item 2 (thread hasPremium into
  // household sharing, AI Pension Reader, spending insights, bill
  // checker, subscription detection, and the free-tier bank-pull
  // frequency limit) and item 3 (gate the nightly automatic sync too).

  // Free-tier bank-pull frequency limit. Premium: unlimited manual pulls
  // (and gets automatic nightly sync on top — gated server-side in
  // api/sync-bank-transactions.js, not here). Free: one manual pull every
  // FREE_BANK_PULL_COOLDOWN_DAYS. profile.lastManualBankPullAt is null
  // until the first pull, which always allows a pull.
  const nextPullAvailableAt = useMemo(() => {
    if (!profile.lastManualBankPullAt) return null;
    const next = new Date(profile.lastManualBankPullAt);
    next.setDate(next.getDate() + FREE_BANK_PULL_COOLDOWN_DAYS);
    return next;
  }, [profile.lastManualBankPullAt]);

  const canPullBank = subscription.hasPremium || !nextPullAvailableAt || nextPullAvailableAt <= new Date();

  // ImportTab calls this once a manual (bank-originated, not CSV) pull has
  // actually been applied — deliberately separate from
  // onApplyImportedSpending, since that's shared with CSV import and CSV
  // shouldn't count against the free-tier limit.
  const recordManualBankPull = () => setField(["lastManualBankPullAt"])(new Date().toISOString());

  // The bank-consent redirect target. api/truelayer-callback.js does the
  // server-side token exchange (it MUST run there — that's the only place
  // the client secret can live) and then sends the browser on to this
  // second URL once that work is done. This second hop is the one
  // Android's App Link intercepts, handing control back to the native app
  // — deliberately NOT the callback URL itself, since intercepting that
  // one would skip the server-side exchange entirely and nothing would
  // ever get saved. (This was the actual cause of connections silently
  // going nowhere after App Links were first added.)
  const handleBankReturn = () => {
    setTab("import");
    refreshConnectedBank();
  };

  // Same idea as handleBankReturn, for the Stripe Checkout return trip —
  // Stripe redirects to /subscription-connected once checkout completes
  // (see create-checkout-session.js), which the App Link intercepts the
  // same way. The webhook (running server-side, separately from this)
  // is what actually updates the subscription record — this just
  // re-checks status once control's back in the app.
  const handleSubscriptionReturn = () => {
    refreshSubscriptionStatus();
  };

  // Web case: a plain browser tab does a normal full-page navigation to
  // /bank-connected or /subscription-connected, so this only needs to
  // run once on initial mount.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.pathname.includes("bank-connected")) {
      handleBankReturn();
      // Clean the URL back to the app's normal root so a refresh later
      // doesn't re-trigger this.
      window.history.replaceState({}, "", "/");
    } else if (typeof window !== "undefined" && window.location.pathname.includes("subscription-connected")) {
      handleSubscriptionReturn();
      window.history.replaceState({}, "", "/");
    } else {
      refreshConnectedBank();
    }
    refreshSubscriptionStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native case: Android hands the app links.wealth-within.vercel.app/
  // bank-connected or /subscription-connected URL to the app directly via
  // an intent — this never touches window.location, so it needs its own
  // listener rather than reusing the effect above.
  useEffect(() => {
    const listener = CapacitorApp.addListener("appUrlOpen", (data) => {
      if (data?.url?.includes("bank-connected")) {
        handleBankReturn();
      } else if (data?.url?.includes("subscription-connected")) {
        handleSubscriptionReturn();
      }
    });
    return () => {
      listener.then((l) => l.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Live sync: apply another household member's changes as they happen,
  // rather than only picking them up on next reload. Subscribes once,
  // independent of the initial load above, since subscribeToHouseholdData
  // resolves the household id itself.
  useEffect(() => {
    const unsubscribe = subscribeToHouseholdData((remoteData) => {
      const merged = mergeWithDefaults(remoteData);
      applyingRemoteUpdate.current = true;
      setProfile(merged);
      if (merged.loans && merged.loans[0]) setSelectedDebtId(merged.loans[0].id);
    });
    return unsubscribe;
  }, []);

  // save the household data whenever it changes, debounced, after the initial load completes
  useEffect(() => {
    if (!hasLoaded.current) return;
    if (applyingRemoteUpdate.current) {
      applyingRemoteUpdate.current = false;
      return;
    }
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

  // Ask for notification permission once the household's data has actually
  // loaded — not on cold mount, so the prompt doesn't compete with the
  // initial load spinner.
  useEffect(() => {
    if (storageStatus === "ready") requestNotificationPermission();
  }, [storageStatus]);

  // Re-check every budgeted category against its current spend whenever the
  // categories change — covers edits from this tab, bulk bank import, and
  // the "Use suggested budget" quick-apply all funnelling through the same
  // profile state.
  useEffect(() => {
    if (!hasLoaded.current) return;
    checkCategoryBudgets(profile.expenseCategories);
  }, [profile.expenseCategories]);

  const [confirmingReset, setConfirmingReset] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
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

  // After joining or leaving a household, the profile data belongs to a
  // different household entirely — reload it from scratch rather than
  // trying to patch the in-memory profile, same as the initial mount load.
  const reloadAfterHouseholdChange = async () => {
    try {
      const result = await getData();
      const merged = mergeWithDefaults(result);
      setProfile(merged);
      if (merged.loans && merged.loans[0]) setSelectedDebtId(merged.loans[0].id);
    } catch (err) {
      setStorageStatus("error");
    }
  };

  const [confirmingDeleteAccount, setConfirmingDeleteAccount] = useState(false);
  const [deleteAccountText, setDeleteAccountText] = useState("");
  const [deleteAccountStatus, setDeleteAccountStatus] = useState("idle"); // idle | deleting | error
  const deleteAccountNow = async () => {
    if (!supabase) return;
    setDeleteAccountStatus("deleting");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not signed in.");

      const resp = await fetch(`${API_BASE}/api/delete-account`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(result.error || "Couldn't delete the account.");

      sessionStorage.setItem("wwa-account-deleted", "1");
      await supabase.auth.signOut();
    } catch (err) {
      setDeleteAccountStatus("error");
    }
  };

  const allDebts = useMemo(
    () => [
      ...profile.loans.map((l) => ({ ...l, kind: "Loan", confirmedBalance: l.balance, balance: estimateBalanceToday(l.balance, l.rate, l.payment, l.lastConfirmedAt) })),
      ...profile.cards.map((c) => ({ ...c, kind: "Credit card", confirmedBalance: c.balance, balance: estimateBalanceToday(c.balance, c.rate, c.payment, c.lastConfirmedAt, c.paymentDayOfMonth) })),
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
    const cardsBalance = profile.cards.reduce((s, c) => s + estimateBalanceToday(Number(c.balance || 0), c.rate, c.payment, c.lastConfirmedAt, c.paymentDayOfMonth), 0);
    const cardsPayment = profile.cards.reduce((s, c) => s + Number(c.payment || 0), 0);

    const activeSubs = profile.subscriptions.filter((s) => !s.cancelled);
    const subsTotal = activeSubs.reduce((s, x) => s + Number(x.amount || 0), 0);

    // If the mortgage payment is already counted as a line item within
    // Essentials (flagged via mortgage.includedInExpenditure), don't add
    // the dedicated mortgage.payment figure on top of that too — that
    // would double-count the same payment.
    const essential = (profile.mortgage.includedInExpenditure ? 0 : Number(profile.mortgage.payment || 0)) + essentialCatTotal;
    const debtPayments = loansPayment + cardsPayment;
    const lifestyle = lifestyleCatTotal + subsTotal;
    const income = totalIncome(profile);
    const available = income - essential - debtPayments - lifestyle;

    const mortgageBalanceToday = estimateBalanceToday(
      Number(profile.mortgage.balance || 0),
      profile.mortgage.rate,
      profile.mortgage.payment,
      profile.mortgage.lastConfirmedAt
    );
    const homeEquity = Number(profile.homeValue || 0) - mortgageBalanceToday;
    const totalDebt = loansBalance + cardsBalance;
    const pensionBalance = profile.pensions.reduce((s, p) => s + Number(p.balance || 0), 0);
    const pensionContribution = profile.pensions.reduce((s, p) => s + Number(p.contribution || 0), 0);
    const netWorth =
      homeEquity +
      Number(profile.savings.balance || 0) +
      Number(profile.investments.balance || 0) +
      pensionBalance -
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
      pensionBalance,
      pensionContribution,
    };
  }, [profile]);

  // Must live below the totals declaration above — this effect's dependency
  // array reads `totals` directly during render (not just inside the
  // callback), so placing it any earlier throws a "Cannot access 'totals'
  // before initialization" error the moment the component renders.
  useEffect(() => {
    if (!hasLoaded.current) return;
    syncWidgetData(totals);
  }, [totals]);

  const score = useMemo(() => {
    const annualIncome = totals.income * 12 || 1;
    const savingsRate = totals.available / (totals.income || 1);
    const efMonths = profile.emergencyFund.balance / Math.max(1, totals.essential + totals.debtPayments);
    const dtiRatio = totals.totalDebt / annualIncome;
    const investRatio = (totals.pensionBalance + profile.investments.balance) / annualIncome;
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

  const ccAnnualCost = totals.cardsBalance > 0 ? profile.cards.reduce((sum, c) => sum + (estimateBalanceToday(c.balance, c.rate, c.payment, c.lastConfirmedAt, c.paymentDayOfMonth) * c.rate) / 100, 0) : 0;

  const essentialRatio = totals.income > 0 ? totals.essential / totals.income : 0;
  // Essential costs alone meeting or exceeding income is a fundamentally
  // different situation from "overspending on lifestyle stuff" — there's no
  // discretionary spending left to trim, and the usual gamified coaching
  // tone (cancel subscriptions, hit your savings goal) isn't just unhelpful
  // here, it can read as tone-deaf. This is a purely numeric signal from
  // data already being calculated — not a diagnosis of anyone's situation.
  const inFinancialHardship = essentialRatio >= 1;

  const coachTips = useMemo(() => {
    if (inFinancialHardship) return [];
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
    if (essentialRatio > 0.6) {
      tips.push({ tone: "rust", tab: "income", text: `Essential costs are eating ${Math.round(essentialRatio * 100)}% of your income — a common guideline is keeping this under 50-60%. Worth checking bills and housing costs for anything that could realistically shrink.` });
    } else if (essentialRatio > 0 && essentialRatio < 0.45) {
      tips.push({ tone: "sage", tab: "income", text: `Essential costs are a comfortable ${Math.round(essentialRatio * 100)}% of your income — well within the usual 50-60% guideline, giving you real room to save or invest the rest.` });
    }
    const pensionContribRatio = totals.income > 0 ? totals.pensionContribution / totals.income : 0;
    if (pensionContribRatio < 0.05 && totals.pensionContribution >= 0) {
      tips.push({ tone: "gold", tab: "pension", text: `Your pension contribution is under 5% of income. If your employer offers to match a higher contribution, that's effectively free money left unclaimed — worth checking.` });
    }
    return tips;
  }, [inFinancialHardship, totals, flaggedCount, flaggedSavings, profile.emergencyFund, ccAnnualCost, extraCalc, extraPayment, selectedDebt, comfortableTarget]);

  const forecast = useMemo(() => runForecast(profile, totals, horizonYears, allocationPct), [profile, totals, horizonYears, allocationPct]);
  const forecastBaseline = useMemo(() => runForecast(profile, totals, horizonYears, 0), [profile, totals, horizonYears]);

  const pensionMonthsToRetire = Math.max(0, (profile.pensionSettings.retirementAge - profile.pensionSettings.currentAge) * 12);
  const pensionYearsToRetire = Math.round(pensionMonthsToRetire / 12);
  // Each pot grows under its own low/medium/high rates; the three scenario
  // totals below are the SUM of all pots' outcomes under that scenario —
  // not one blended rate applied to a combined balance, so a pot with a
  // punchier growth assumption doesn't get diluted by a cautious one.
  const pensionScenarios = useMemo(() => {
    const pots = profile.pensions || [];
    const fvAtMonths = (m) =>
      pots.reduce(
        (acc, p) => {
          acc.low += futureValue(p.balance, p.contribution, p.growthLow, m);
          acc.medium += futureValue(p.balance, p.contribution, p.growthMedium, m);
          acc.high += futureValue(p.balance, p.contribution, p.growthHigh, m);
          return acc;
        },
        { low: 0, medium: 0, high: 0 }
      );
    const fv = fvAtMonths(pensionMonthsToRetire);
    const series = [];
    for (let y = 0; y <= pensionYearsToRetire; y += Math.max(1, Math.round(pensionYearsToRetire / 12))) {
      const totals = fvAtMonths(y * 12);
      series.push({ year: y, low: Math.round(totals.low), medium: Math.round(totals.medium), high: Math.round(totals.high) });
    }
    if (series[series.length - 1]?.year !== pensionYearsToRetire) {
      series.push({ year: pensionYearsToRetire, low: Math.round(fv.low), medium: Math.round(fv.medium), high: Math.round(fv.high) });
    }

    const inflation = profile.assumptions?.inflation ?? 0;
    const discount = Math.pow(1 + inflation / 100, pensionYearsToRetire);
    const real = {};
    const netMonthlyIncome = {};
    const grossMonthlyIncome = {};
    const combinedNetMonthlyIncome = {};

    const drawdownRate = profile.pensionSettings.drawdownRate;
    const spIncluded = profile.statePension?.included ?? false;
    const spClaimAge = profile.statePension?.claimAge ?? 67;
    const spWeekly = profile.statePension?.weeklyAmount ?? 0;
    const spAnnualToday = spWeekly * 52;
    const spAlreadyClaimingAtRetirement = spIncluded && spClaimAge <= profile.pensionSettings.retirementAge;
    const spAnnualAtRetirement = spAlreadyClaimingAtRetirement ? spAnnualToday * discount : 0;
    const spMonthlyToday = spIncluded ? spAnnualToday / 12 : 0;

    Object.entries(fv).forEach(([k, v]) => {
      real[k] = v / discount;
      const grossAnnualDrawdown = (v * drawdownRate) / 100;
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
  }, [profile.pensions, profile.pensionSettings, profile.statePension, profile.assumptions, pensionMonthsToRetire, pensionYearsToRetire]);

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
  // Same as addArrayItem, but the caller supplies the id up front (via
  // nextId()) so it can track which entry was just added and open it
  // straight into edit mode — new entries shouldn't appear as a collapsed,
  // blank-looking summary bubble.
  const addArrayItemWithId = (arrKey, itemWithId) => () =>
    setProfile((p) => ({ ...p, [arrKey]: [...p[arrKey], itemWithId] }));
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

  const dismissTabTip = (tabKey) =>
    setProfile((p) => ({ ...p, seenTabTips: p.seenTabTips.includes(tabKey) ? p.seenTabTips : [...p.seenTabTips, tabKey] }));

  const addCategory = (type = "essential") =>
    setProfile((p) => ({
      ...p,
      expenseCategories: [...p.expenseCategories, { id: nextId(), name: type === "lifestyle" ? "New lifestyle item" : "New essential", type, budget: 0, items: [] }],
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
  // Same as addItem but lets the caller specify the item's name up front —
  // used by the "common bills you haven't added" quick-add chips, so the
  // person doesn't have to add a blank item and then type the name in.
  const addNamedItem = (catId, name) =>
    setProfile((p) => ({
      ...p,
      expenseCategories: p.expenseCategories.map((c) =>
        c.id === catId ? { ...c, items: [...c.items, { id: nextId(), name, amount: 0 }] } : c
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

  // Fully replaces each matched category's items with a single line
  // reflecting the bank data (updating in place on repeat imports rather
  // than duplicating) — deliberately NOT merged alongside old manual
  // entries, so re-pulling from the bank becomes the source of truth for
  // any category it actually covers. Categories the bank data has nothing
  // for are left completely untouched, so anything only entered by hand
  // (or not picked up by this pull) still has to be added/amended manually.
  // categoryTotals: { [categoryName]: monthlyAmount }
  // categoryTotals: { [categoryName]: monthlyAmount } — always present.
  // categoryItems: { [categoryName]: [{ id, name, amount }] } — only
  // present for a manual bank pull, which has the individual transactions
  // to name; CSV imports and nightly-sync reviews only ever have the flat
  // total, so those categories still fall back to one combined line.
  const applyImportedSpending = (categoryTotals, estimatedIncome, categoryItems) => {
    setProfile((p) => ({
      ...p,
      incomes: estimatedIncome != null ? [{ id: nextId(), name: "From bank import", amount: estimatedIncome }] : p.incomes,
      expenseCategories: p.expenseCategories.map((c) => {
        const imported = categoryTotals[c.name];
        if (imported == null) return c;
        const namedItems = categoryItems?.[c.name];
        const items =
          namedItems && namedItems.length > 0
            ? namedItems.map((it) => ({ id: nextId(), name: it.name, amount: it.amount }))
            : [{ id: nextId(), name: "From bank import", amount: imported }];
        return { ...c, items };
      }),
    }));
  };

  // Called after a bank-sourced review (manual pull or an overnight
  // sync) is actually applied to the budget — clears the pending flag
  // (if this was a synced one) and advances the household's
  // bank_connections.last_synced_at cursor to toDateIso, so the next
  // overnight sync only covers what's genuinely new. RLS already lets a
  // household member update their own connection's row (same policy the
  // TrueLayer migration set up), so this can go straight through the
  // browser client rather than needing a new API endpoint.
  const applyBankSync = async (toDateIso) => {
    setProfile((p) => (p.pendingBankSync ? { ...p, pendingBankSync: null } : p));
    if (!supabase) return;
    try {
      const householdId = await getHouseholdId();
      if (!householdId) return;
      await supabase.from("bank_connections").update({ last_synced_at: toDateIso }).eq("household_id", householdId);
    } catch (err) {
      // Non-fatal: the budget update itself has already gone through.
      // Worst case the next overnight sync recomputes a slightly wider
      // window than strictly necessary — annoying, not lossy.
      console.error("Couldn't advance bank sync cursor:", err);
    }
  };

  // Clears a pending overnight sync the household chose not to apply,
  // without touching last_synced_at — see the comment on that column in
  // supabase/bank-connections-last-synced-migration.sql for why leaving
  // it untouched here is the safe choice.
  const discardPendingBankSync = () => {
    setProfile((p) => (p.pendingBankSync ? { ...p, pendingBankSync: null } : p));
  };

  // Accepting a detected subscription/bill adds it to the real
  // subscriptions list (same shape as one typed in by hand — see
  // handleAddSubscription in IncomeTab.jsx) and removes it from the
  // pending suggestions in one update, so it can never briefly appear in
  // both places.
  const acceptDetectedSubscription = (suggestion) => {
    setProfile((p) => ({
      ...p,
      subscriptions: [...p.subscriptions, { id: nextId(), name: suggestion.name, amount: suggestion.monthlyAmount, flagged: false, cancelled: false }],
      pendingSubscriptions: p.pendingSubscriptions.filter((s) => s.id !== suggestion.id),
    }));
  };

  // Dismissing just drops the suggestion — nothing to undo elsewhere,
  // since it was never added anywhere. The same merchant can resurface
  // on a future scan if it keeps recurring; there's no permanent
  // "never suggest this again" list, since that would need its own
  // storage and matching logic for a fairly small annoyance (worst case,
  // re-dismissing something takes one tap).
  // A manual, deliberate action (a button tap on a specific account),
  // not an automatic sync — TrueLayer's own account_type field
  // distinguishes a savings account from a current account, so this
  // just takes whatever balance is showing on that account right now.
  // cardId === "__new__" adds it as a brand new card debt; any other value
  // is treated as an existing card's id to update — deliberately a
  // person-driven choice (a dropdown on the Connect a Bank screen) rather
  // than auto-matching by name, since a wrong silent match would corrupt
  // real debt data.
  const applyCardBalanceFromBank = (cardId, balance, bankCardName) => {
    if (cardId === "__new__") {
      addArrayItem("cards", {
        name: bankCardName || "New card",
        balance,
        rate: 0,
        payment: 0,
        originalBalance: balance,
        lastConfirmedAt: new Date().toISOString(),
        debtType: "card",
      })();
    } else {
      confirmBalance("cards")(cardId, balance);
    }
  };

  const applySavingsFromBank = (balance) =>
    setProfile((p) => ({ ...p, savings: { ...p.savings, balance } }));

  const dismissDetectedSubscription = (suggestionId) => {
    setProfile((p) => ({ ...p, pendingSubscriptions: p.pendingSubscriptions.filter((s) => s.id !== suggestionId) }));
  };

  // A manual "Pull transactions" runs the same subscription-detection
  // Claude call the nightly sync already uses (see
  // api/detect-subscriptions.js), so this feeds into the exact same
  // pendingSubscriptions queue — whatever UI already reviews an overnight
  // sync's suggestions reviews these too, no separate mechanism needed.
  // Replaces rather than appends: a fresh pull's suggestions are the
  // current picture, not additive to whatever a previous pull surfaced.
  const applyDetectedSubscriptions = (suggestions) =>
    setProfile((p) => ({ ...p, pendingSubscriptions: suggestions }));

  // Populated when a bank pull's subscription detection flags an
  // existing active subscription as no longer appearing in the
  // transaction history — e.g. a gym membership that's actually been
  // cancelled. Never auto-removed; this only ever surfaces a suggestion
  // for review, same review-before-change philosophy as everything else
  // in this flow.
  const flagPossiblyStoppedSubscriptions = (matches) =>
    setProfile((p) => ({
      ...p,
      pendingSubscriptionRemovals: [
        ...(p.pendingSubscriptionRemovals || []).filter((r) => !matches.some((m) => m.id === r.id)),
        ...matches.map((m) => ({ id: m.id, name: m.name })),
      ],
    }));

  // Confirms it's genuinely gone — marks it cancelled (same mechanism as
  // manually toggling cancel on a subscription) and clears the flag.
  const confirmSubscriptionStopped = (id) =>
    setProfile((p) => ({
      ...p,
      subscriptions: p.subscriptions.map((s) => (s.id === id ? { ...s, cancelled: true } : s)),
      pendingSubscriptionRemovals: (p.pendingSubscriptionRemovals || []).filter((r) => r.id !== id),
    }));

  // "No, I still have this" — just dismisses the flag, changes nothing.
  const keepFlaggedSubscription = (id) =>
    setProfile((p) => ({
      ...p,
      pendingSubscriptionRemovals: (p.pendingSubscriptionRemovals || []).filter((r) => r.id !== id),
    }));

  const updateGoal = (id, field, value) =>
    setProfile((p) => ({ ...p, goals: p.goals.map((g) => (g.id === id ? { ...g, [field]: value } : g)) }));
  const addGoal = () =>
    setProfile((p) => ({ ...p, goals: [...p.goals, { id: nextId(), name: "New goal", target: 1000, current: 0, monthlyContribution: 50, desiredMonths: null }] }));
  const addGoalWithId = (goalWithId) => () =>
    setProfile((p) => ({ ...p, goals: [...p.goals, goalWithId] }));
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

  // Deliberately different from totals.available (used for the score,
  // forecast, pie chart, and Overview's own "past comfortable" message) —
  // this is specifically for the top bar's "Available / mo" figure, which
  // Jack wants to reflect take-home minus fixed costs only: essentials,
  // debt, and subscriptions. Lifestyle category spending is left out on
  // purpose, since it's variable/discretionary rather than fixed.
  const topbarAvailable = totals.income - totals.essential - totals.debtPayments - totals.subsTotal;
  const animatedTopbarAvailableFixed = useCountUp(topbarAvailable);

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

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState("general");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("idle"); // idle | sending | sent | error

  // Accessibility: Escape closes whichever overlay is open. The "more" sheet
  // in particular has no visible close button — a keyboard user who opens it
  // without picking a different tab otherwise has no way to dismiss it.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (moreOpen) setMoreOpen(false);
      if (accountOpen) setAccountOpen(false);
      if (feedbackOpen) setFeedbackOpen(false);
      if (confirmingReset) setConfirmingReset(false);
      if (confirmingDeleteAccount) setConfirmingDeleteAccount(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moreOpen, accountOpen, feedbackOpen, confirmingReset, confirmingDeleteAccount]);

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
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Fraunces:ital,wght@0,500;0,600;0,700;1,500&display=swap');

        .wmg-root {
          --ink: #FBF7F0;
          --ink-2: #FFFDF9;
          --ink-3: #F5EEE0;
          --paper: #3D3A34;
          --paper-dim: #796D5C;
          --brand: #8A7FC9;
          --brand-2: #C97099;
          --brand-deep: #6C5FB0;
          --brand-soft: #EDEAFB;
          --coral: #B5652F;
          --coral-soft: #F7D9C4;
          --gold: #97701A;
          --gold-soft: #F5E6C8;
          --sage: #4A7A3A;
          --sage-soft: #D9E4D0;
          --rust: #B2504F;
          --rust-soft: #F5DEDE;
          --slate: #5C6BA3;
          --slate-soft: #DCE0F0;
          --hair: #EDE4D3;
          --gold-fill: #F0C878;
          --sage-fill: #A8C99A;
          --rust-fill: #E0A0A0;
          --slate-fill: #AEB8DD;
          --coral-text: #6B3D1F;
          background: var(--ink);
          color: var(--paper);
          font-family: 'Plus Jakarta Sans', sans-serif;
          min-height: 100%;
          font-variant-numeric: tabular-nums;
          overflow-x: hidden;
        }
        .wmg-root * { box-sizing: border-box; }
        .wmg-mono { font-family: 'Plus Jakarta Sans', sans-serif; font-variant-numeric: tabular-nums; }
        .wmg-serif { font-family: 'Fraunces', serif; font-weight: 600; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }

        .wmg-app { display: flex; min-height: 100vh; align-items: flex-start; }
        @media (max-width: 880px) { .wmg-app { flex-direction: column; align-items: stretch; } }

        .wmg-sidebar { width: 240px; flex-shrink: 0; padding: 26px 16px; border-right: 1px solid var(--hair); position: sticky; top: 0; align-self: flex-start; height: 100vh; overflow-y: auto; background: var(--ink-2); }
        @media (max-width: 880px) {
          .wmg-sidebar { width: auto; height: auto; position: fixed; left: 14px; right: 14px; bottom: calc(14px + env(safe-area-inset-bottom)); top: auto; border: 1px solid var(--hair); border-radius: 22px; padding: 6px; box-shadow: 0 12px 28px -8px rgba(15,15,45,0.18); z-index: 20; }
        }

        .wmg-brand-block { display: flex; align-items: center; gap: 11px; margin-bottom: 26px; }
        .wmg-brand-block svg { flex-shrink: 0; }
        .wmg-brand { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 18px; font-weight: 800; letter-spacing: -0.02em; margin: 0; line-height: 1.2; color: var(--paper); }
        .wmg-brand-tagline { font-size: 10.5px; color: var(--paper-dim); margin-top: 2px; letter-spacing: 0.01em; }
        @media (max-width: 880px) { .wmg-brand-block { display: none; } }

        .wmg-nav { display: flex; flex-direction: column; gap: 6px; }
        @media (max-width: 880px) { .wmg-nav { flex-direction: row; gap: 2px; justify-content: space-around; align-items: flex-end; } }
        .wmg-nav-item { display: flex; align-items: center; gap: 11px; text-align: left; background: transparent; border: none; color: var(--paper-dim); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13.5px; padding: 6px 10px; cursor: pointer; border-radius: 999px; white-space: nowrap; transition: color .15s ease, background .15s ease; }
        .wmg-nav-icon-badge { display: flex; align-items: center; justify-content: center; width: 38px; height: 38px; border-radius: 50%; background: var(--ink-3); color: var(--paper-dim); flex-shrink: 0; transition: background .15s ease, color .15s ease, box-shadow .15s ease; }
        .wmg-nav-item:hover { color: var(--paper); background: var(--ink-3); }
        .wmg-nav-item.active { color: var(--paper); background: transparent; font-weight: 700; }
        .wmg-nav-item.active .wmg-nav-icon-badge { background: linear-gradient(135deg, #A78BFA, #7C4DFF); color: #FFFFFF; box-shadow: 0 6px 18px rgba(124,77,255,0.45); }
        .wmg-nav-item.active:nth-of-type(2) .wmg-nav-icon-badge { background: linear-gradient(135deg, #FF9166, #FF6B4A); box-shadow: 0 6px 18px rgba(255,107,74,0.4); }
        .wmg-nav-item.active:nth-of-type(3) .wmg-nav-icon-badge { background: linear-gradient(135deg, #FF7AB0, #FF3D81); box-shadow: 0 6px 18px rgba(255,61,129,0.4); }
        .wmg-nav-item.active:nth-of-type(4) .wmg-nav-icon-badge { background: linear-gradient(135deg, #4FD1C5, #17A398); box-shadow: 0 6px 18px rgba(23,163,152,0.4); }
        .wmg-nav-item.active:nth-of-type(5) .wmg-nav-icon-badge { background: linear-gradient(135deg, #FFCE6B, #FFA400); box-shadow: 0 6px 18px rgba(255,164,0,0.4); }
        .wmg-nav-item.active:nth-of-type(6) .wmg-nav-icon-badge { background: linear-gradient(135deg, #A78BFA, #7C4DFF); box-shadow: 0 6px 18px rgba(124,77,255,0.45); }
        .wmg-nav-item.active:nth-of-type(7) .wmg-nav-icon-badge { background: linear-gradient(135deg, #FF9166, #FF6B4A); box-shadow: 0 6px 18px rgba(255,107,74,0.4); }
        .wmg-nav-item.active:nth-of-type(8) .wmg-nav-icon-badge { background: linear-gradient(135deg, #FF7AB0, #FF3D81); box-shadow: 0 6px 18px rgba(255,61,129,0.4); }
        .wmg-nav-more { display: none; }
        @media (max-width: 880px) {
          .wmg-nav-item { flex-direction: column; gap: 3px; padding: 4px 2px; border-radius: 18px; min-width: 56px; flex: 1; white-space: normal; }
          .wmg-nav-item span:last-child { display: block; width: 100%; font-size: 9px; font-weight: 600; letter-spacing: 0.01em; text-align: center; line-height: 1.15; white-space: normal; overflow-wrap: break-word; }
          .wmg-nav-item.active { background: transparent; }
          .wmg-nav-icon-badge { width: 34px; height: 34px; }
          .wmg-nav-item:first-child .wmg-nav-icon-badge { width: 50px; height: 50px; margin-top: -22px; border: 4px solid var(--ink-2); background: linear-gradient(135deg, #A78BFA, #7C4DFF); color: #FFFFFF; box-shadow: 0 8px 20px rgba(124,77,255,0.5); }
          .wmg-nav-item-overflow { display: none; }
          .wmg-nav-more { display: flex; }
        }

        .wmg-more-sheet-backdrop { position: fixed; inset: 0; background: rgba(15,15,45,0.4); z-index: 40; display: flex; align-items: flex-end; }
        .wmg-more-sheet { width: 100%; background: var(--ink-2); border-radius: 22px 22px 0 0; padding: 10px 16px calc(20px + env(safe-area-inset-bottom)); box-shadow: 0 -10px 30px rgba(15,15,45,0.2); }
        .wmg-more-sheet-handle { width: 36px; height: 4px; border-radius: 3px; background: var(--hair); margin: 6px auto 14px; }
        .wmg-more-sheet-item { display: flex; align-items: center; gap: 14px; width: 100%; background: transparent; border: none; padding: 10px 6px; border-radius: 18px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14.5px; font-weight: 600; color: var(--paper); text-align: left; cursor: pointer; }
        .wmg-more-sheet-item.active { background: var(--brand-soft); }
        .wmg-more-sheet-item.active .wmg-nav-icon-badge { background: var(--brand); color: #FFFFFF; }
        .wmg-more-sheet-divider { height: 1px; background: var(--hair); margin: 8px 6px; }
        .wmg-more-sheet-title { display: flex; align-items: center; justify-content: space-between; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 15px; font-weight: 800; color: var(--paper); padding: 4px 6px 12px; }
        .wmg-account-sheet { max-height: 82vh; overflow-y: auto; }
        .wmg-account-panel { font-size: 11px; color: var(--paper-dim); line-height: 1.6; }
        .wmg-account-divider { height: 1px; background: var(--hair); margin: 14px 0; }
        .wmg-mfa-section { margin: 4px 0; }
        .wmg-mfa-title { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12.5px; font-weight: 800; color: var(--paper); margin-bottom: 6px; }
        .wmg-mfa-enroll { margin-top: 10px; background: var(--ink-3); border-radius: 16px; padding: 14px; }
        .wmg-mfa-qr { width: 160px; height: 160px; background: #FFFFFF; border-radius: 12px; padding: 10px; margin: 8px 0; display: block; }
        .wmg-hardship-card { font-size: 13px; line-height: 1.6; color: var(--paper-dim); border: 1px solid var(--hair); }
        .wmg-hardship-links { display: flex; flex-direction: column; gap: 10px; }
        .wmg-hardship-links a { display: block; background: var(--ink-3); border-radius: 14px; padding: 12px 14px; color: var(--paper); text-decoration: none; font-size: 13px; }
        .wmg-hardship-links a:hover { background: var(--brand-soft); }
        .wmg-hardship-links a strong { color: var(--brand); }
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

        .wmg-topbar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 32px; background: rgba(26,26,61,0.88); backdrop-filter: blur(8px); border-bottom: 1px solid var(--hair); flex-wrap: wrap; }
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

        .wmg-content { padding: 24px 32px 0; animation: wmgContentIn 0.28s cubic-bezier(0.22, 1, 0.36, 1); }
        .wmg-tab-loading { display: flex; align-items: center; justify-content: center; min-height: 240px; color: var(--paper-dim); font-size: 13px; }
        @keyframes wmgContentIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) { .wmg-content { animation: none; } }
        @media (max-width: 880px) { .wmg-content { padding: 4px 18px 0; } }

        .wmg-card { background: var(--ink-2); border: 1px solid rgba(30,36,48,0.06); border-radius: 23px; padding: 22px; box-shadow: 0 1px 2px rgba(15,15,45,0.02), 0 20px 40px -20px rgba(15,15,45,0.14); }

        .wmg-hero { background: linear-gradient(135deg, var(--brand-deep) 0%, var(--brand) 100%); border-radius: 26px; padding: 22px 24px; color: #FFFFFF; box-shadow: 0 16px 36px -16px rgba(60,30,140,0.5); margin-bottom: 16px; position: relative; }
        .wmg-hero::after { content: ""; position: absolute; top: -60px; right: -60px; width: 220px; height: 220px; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,0.14), transparent 70%); pointer-events: none; }
        .wmg-hero-label { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 700; line-height: 1.5; position: relative; z-index: 1; margin-bottom: 16px; }
        .wmg-hero-label strong { font-weight: 800; }
        .wmg-hero-main-row { display: flex; align-items: flex-end; justify-content: space-between; position: relative; z-index: 1; }
        .wmg-hero-net-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.8; font-weight: 700; margin-bottom: 3px; display: flex; align-items: center; gap: 5px; }
        .wmg-hero-net-val { font-family: 'Fraunces', serif; font-weight: 600; font-size: 27px; font-variant-numeric: tabular-nums; }
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

        .wmg-mosaic-hero { background: linear-gradient(150deg, #F7D9C4 0%, #F4D9E0 50%, #DCE0F0 100%); border-radius: 24px; padding: 18px; color: var(--paper); display: flex; flex-direction: column; justify-content: space-between; min-height: 110px; position: relative; overflow: hidden; margin-bottom: 14px; }
        .wmg-mosaic-hero::after { content: ""; position: absolute; top: -50px; right: -50px; width: 160px; height: 160px; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,0.12), transparent 70%); pointer-events: none; }
        .wmg-mosaic-hero-top { display: flex; align-items: center; justify-content: space-between; position: relative; z-index: 1; }
        .wmg-mosaic-hero-label { font-size: 12.5px; opacity: 0.8; }
        .wmg-mosaic-hero-val { font-family: 'Fraunces', serif; font-weight: 600; font-size: 27px; line-height: 1.1; position: relative; z-index: 1; font-variant-numeric: tabular-nums; }
        .wmg-mosaic-hero-sub { font-size: 12.5px; opacity: 0.85; margin-top: 4px; position: relative; z-index: 1; }
        .wmg-mosaic-hero-score { display: flex; align-items: center; gap: 6px; background: rgba(61,58,52,0.08); border: none; border-radius: 999px; padding: 4px 10px 4px 6px; cursor: pointer; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 13px; color: var(--paper); }
        .wmg-mosaic-hero-score:hover { background: rgba(61,58,52,0.14); }
        .wmg-score-explainer-card { margin-bottom: 10px; }
        .wmg-score-explainer-head { display: flex; align-items: center; justify-content: space-between; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13px; font-weight: 800; color: var(--paper); margin-bottom: 8px; }
        .wmg-score-explainer-close { background: transparent; border: none; color: var(--paper-dim); font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px; }
        .wmg-score-explainer-close:hover { color: var(--paper); }
        .wmg-score-explainer-card p { font-size: 12.5px; line-height: 1.6; color: var(--paper); margin: 0; }

        .wmg-stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 14px; }
        .wmg-stat-tile { background: var(--ink-2); border: 1px solid var(--hair); border-radius: 16px; padding: 10px 12px; }
        .wmg-stat-tile-clickable { display: block; width: 100%; text-align: left; font-family: inherit; cursor: pointer; transition: background .15s ease, border-color .15s ease, transform .1s ease; }
        .wmg-stat-tile-clickable:hover { background: var(--ink-3); border-color: var(--brand-soft); }
        .wmg-stat-tile-clickable:active { transform: scale(0.98); }
        .wmg-stat-tile-clickable:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
        .wmg-stat-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-bottom: 6px; }
        .wmg-stat-dot.tone-brand { background: linear-gradient(150deg, #A78BFA, #7C4DFF); }
        .wmg-stat-dot.tone-coral { background: linear-gradient(150deg, #FF9166, #FF6B4A); }
        .wmg-stat-dot.tone-sage { background: linear-gradient(150deg, #4FD1C5, #17A398); }
        .wmg-stat-dot.tone-gold { background: linear-gradient(150deg, #FFCE6B, #FFA400); }
        .wmg-stat-dot.tone-slate { background: var(--slate); }
        .wmg-stat-tile-gradient { border: none; }
        .wmg-stat-tile-gradient.tone-brand { background: var(--brand-soft); }
        .wmg-stat-tile-gradient.tone-coral { background: var(--coral-soft); }
        .wmg-stat-tile-gradient.tone-sage { background: var(--sage-soft); }
        .wmg-stat-tile-gradient.tone-gold { background: var(--gold-soft); }
        .wmg-stat-tile-gradient.tone-slate { background: var(--slate-soft); }
        .wmg-stat-tile-gradient.tone-rust { background: var(--rust-soft); }
        .wmg-stat-tile-gradient:hover { filter: brightness(0.98); background: inherit; border-color: transparent; }
        .wmg-stat-tile-gradient.tone-brand .wmg-stat-tile-icon-badge { color: var(--brand-deep); }
        .wmg-stat-tile-gradient.tone-coral .wmg-stat-tile-icon-badge { color: var(--coral-text); }
        .wmg-stat-tile-gradient.tone-sage .wmg-stat-tile-icon-badge { color: var(--sage); }
        .wmg-stat-tile-gradient.tone-gold .wmg-stat-tile-icon-badge { color: var(--gold); }
        .wmg-stat-tile-gradient.tone-slate .wmg-stat-tile-icon-badge { color: var(--slate); }
        .wmg-stat-tile-gradient.tone-rust .wmg-stat-tile-icon-badge { color: var(--rust); }
        .wmg-stat-tile-gradient .wmg-stat-tile-label { color: var(--paper-dim); }
        .wmg-stat-tile-gradient .wmg-stat-tile-val { color: var(--paper); }
        .wmg-stat-tile-icon-badge { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: rgba(255,255,255,0.6); margin-bottom: 8px; }
        .wmg-stat-tile-label { font-size: 11.5px; color: var(--paper-dim); font-weight: 600; margin-bottom: 2px; }
        .wmg-stat-tile-val { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 15px; font-weight: 700; color: var(--paper); font-variant-numeric: tabular-nums; }
        .wmg-chip-row { display: flex; gap: 8px; overflow-x: auto; margin: 0 0 6px; padding: 2px 2px 6px; }
        .wmg-chip { flex: 0 0 auto; background: var(--ink-2); border: 1px solid var(--hair); border-radius: 19px; padding: 9px 13px; min-width: 92px; }
        .wmg-chip-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--paper-dim); white-space: nowrap; }
        .wmg-chip-value { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 15px; font-weight: 800; margin-top: 3px; white-space: nowrap; }

        .wmg-coach-single { display: flex; align-items: flex-start; gap: 10px; background: linear-gradient(135deg, var(--gold-soft), var(--ink-2) 65%); border: none; text-align: left; width: 100%; font-family: inherit; }
        .wmg-coach-single p { font-size: 13.5px; line-height: 1.55; font-weight: 500; margin: 0; }
        .wmg-coach-single .wmg-coach-dot { margin-top: 5px; }
        .wmg-insight-card { display: flex; align-items: flex-start; gap: 12px; text-align: left; width: 100%; font-family: inherit; border: none; cursor: pointer; margin-bottom: 8px; }
        .wmg-insight-card p { font-size: 14.5px; line-height: 1.5; font-weight: 500; margin: 0; color: var(--paper); flex: 1; }
        .wmg-insight-rust { background: linear-gradient(135deg, var(--rust-soft), var(--ink-2) 70%); }
        .wmg-insight-gold { background: linear-gradient(135deg, var(--gold-soft), var(--ink-2) 70%); }
        .wmg-insight-sage { background: linear-gradient(135deg, var(--sage-soft), var(--ink-2) 70%); }
        .wmg-insight-icon-badge { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 13px; flex-shrink: 0; margin-top: 1px; color: #FFFFFF; }
        .wmg-insight-icon-badge.tone-rust { background: linear-gradient(150deg, #FF7AB0, #FF3D81); }
        .wmg-insight-icon-badge.tone-gold { background: linear-gradient(150deg, #FFCE6B, #FFA400); }
        .wmg-insight-icon-badge.tone-sage { background: linear-gradient(150deg, #4FD1C5, #17A398); }
        .wmg-coach-clickable { cursor: pointer; transition: transform .12s ease, box-shadow .12s ease; }
        .wmg-coach-clickable:hover { transform: translateY(-1px); box-shadow: 0 4px 14px -6px rgba(15,15,45,0.2); }
        .wmg-coach-chevron { margin-left: auto; align-self: center; flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; background: linear-gradient(150deg, #4FC3F7, #2E86F0); color: #FFFFFF; display: flex; align-items: center; justify-content: center; font-size: 13px; }
        .wmg-coach-more { display: block; margin: 8px auto 0; background: transparent; border: none; color: var(--brand); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12.5px; font-weight: 700; cursor: pointer; padding: 6px 10px; }
        .wmg-coach-more:hover { text-decoration: underline; }

        .wmg-section-title { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 15.5px; font-weight: 800; letter-spacing: -0.01em; color: var(--paper); margin: 22px 0 10px; display: flex; align-items: center; gap: 10px; }
        .wmg-section-title:first-child { margin-top: 0; }
        .wmg-section-title::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--brand); flex-shrink: 0; }
        .wmg-section-desc { font-size: 13px; color: var(--paper-dim); margin: -4px 0 12px; max-width: 60ch; }

        .wmg-nw-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
        @media (max-width: 900px) { .wmg-nw-grid { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 560px) { .wmg-nw-grid { grid-template-columns: repeat(2, 1fr); } }
        .wmg-stat { padding: 18px 18px; position: relative; }
        .wmg-eyebrow { color: var(--paper-dim); margin-bottom: 6px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; }
        .wmg-stat .wmg-eyebrow { color: var(--paper-dim); margin-bottom: 6px; font-size: 10.5px; font-weight: 600; }
        .wmg-stat-icon-badge { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 16px; margin-bottom: 12px; }
        .wmg-stat-icon-badge.tone-gold { background: var(--gold-soft); color: var(--gold); }
        .wmg-stat-icon-badge.tone-sage { background: var(--sage-soft); color: var(--sage); }
        .wmg-stat-icon-badge.tone-rust { background: var(--rust-soft); color: var(--rust); }
        .wmg-stat-icon-badge.tone-brand { background: var(--brand-soft); color: var(--brand); }
        .wmg-stat-icon-badge.tone-slate { background: var(--slate-soft); color: var(--slate); }
        .wmg-figure { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .wmg-sub { font-size: 11px; color: var(--paper-dim); margin-top: 4px; }
        .tone-paper { color: var(--paper); }
        .tone-gold { color: var(--gold); }
        .tone-sage { color: var(--sage); }
        .tone-rust { color: var(--rust); }
        .tone-slate { color: var(--slate); }
        .tone-brand { color: var(--brand); }
        .wmg-networth-card { grid-column: span 2; background: linear-gradient(135deg, var(--gold-soft), var(--ink-2) 70%); }
        @media (max-width: 560px) { .wmg-networth-card { grid-column: span 2; } }

        .wmg-flow-income-row { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
        .wmg-flow-income-label { font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; color: var(--paper-dim); }
        .wmg-flow-income-val { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 19px; font-weight: 800; color: var(--paper); }
        .wmg-flow-legend { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; }
        .wmg-flow-legend-item { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }
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

        .wmg-ef-ring-row { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
        .wmg-ef-ring-val { font-family: 'Fraunces', serif; font-weight: 600; font-size: 19px; color: var(--paper); line-height: 1.1; font-variant-numeric: tabular-nums; }
        .wmg-ef-ring-label { font-size: 11px; color: var(--paper-dim); margin-top: 2px; }
        .wmg-ef-ring-side { display: flex; flex-direction: column; gap: 2px; }
        .wmg-ef-ring-side-label { font-size: 12.5px; color: var(--paper-dim); font-weight: 600; }
        .wmg-ef-ring-side-val { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 22px; font-weight: 800; color: var(--paper); }
        .wmg-progress-track { width: 100%; height: 12px; background: var(--ink-3); border-radius: 999px; overflow: hidden; }
        .wmg-progress-fill { height: 100%; border-radius: 999px; transition: width .3s ease; }
        .wmg-progress-fill.tone-gold { background: linear-gradient(90deg, var(--gold), #FFA400); }
        .wmg-progress-fill.tone-sage { background: linear-gradient(90deg, var(--brand), var(--sage)); }
        .wmg-progress-fill.tone-rust { background: linear-gradient(90deg, #FF7AB0, var(--rust)); }
        .wmg-cat-budget-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .wmg-cat-badge { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #FFFFFF; font-family: 'Baloo 2', sans-serif; font-weight: 700; font-size: 13px; }
        .wmg-cat-badge.tone-brand { background: linear-gradient(150deg, #A78BFA, #7C4DFF); }
        .wmg-cat-badge.tone-coral { background: linear-gradient(150deg, #FF9166, #FF6B4A); }
        .wmg-cat-budget-info { flex: 1; min-width: 0; }
        .wmg-cat-budget-label { font-size: 12.5px; color: var(--paper-dim); margin-bottom: 6px; }
        .wmg-cat-budget-over { color: var(--rust); font-weight: 700; }
        .wmg-budget-suggestion { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }

        .wmg-sub-list { display: flex; flex-direction: column; gap: 8px; }
        .wmg-sub-card { background: var(--ink-3); border-radius: 19px; overflow: hidden; }
        .wmg-sub-card.cancelled .wmg-sub-summary-amount, .wmg-sub-card.cancelled .wmg-sub-summary-name { opacity: 0.45; text-decoration: line-through; }
        .wmg-sub-summary { width: 100%; display: flex; align-items: center; gap: 12px; background: transparent; border: none; padding: 11px 14px; cursor: pointer; text-align: left; font-family: inherit; }
        .wmg-sub-avatar { width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #FFFFFF; font-family: 'Baloo 2', sans-serif; font-weight: 700; font-size: 14px; }
        .wmg-sub-avatar.tone-brand { background: linear-gradient(150deg, #A78BFA, #7C4DFF); }
        .wmg-sub-avatar.tone-coral { background: linear-gradient(150deg, #FF9166, #FF6B4A); }
        .wmg-sub-avatar.tone-sage { background: linear-gradient(150deg, #4FD1C5, #17A398); }
        .wmg-sub-avatar.tone-gold { background: linear-gradient(150deg, #FFCE6B, #FFA400); }
        .wmg-sub-avatar.tone-rust { background: linear-gradient(150deg, #FF7AB0, #FF3D81); }
        .wmg-sub-summary-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .wmg-sub-summary-name { font-size: 14px; font-weight: 700; color: var(--paper); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wmg-sub-summary-cancelled { font-size: 10px; font-weight: 700; color: var(--paper-dim); text-transform: uppercase; letter-spacing: 0.04em; width: fit-content; }
        .wmg-sub-summary-right { display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; }
        .wmg-sub-summary-amount { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 15px; font-weight: 800; color: var(--paper); }
        .wmg-sub-summary-freq { font-size: 10.5px; color: var(--paper-dim); }
        .wmg-sub-chevron { font-size: 18px; color: var(--paper-dim); flex-shrink: 0; transition: transform .15s ease; transform: rotate(90deg); }
        .wmg-sub-chevron.open { transform: rotate(-90deg); }
        .wmg-sub-edit { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 10px; }
        .wmg-sub-edit-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .wmg-sub-edit-actions { display: flex; align-items: center; gap: 10px; }
        .wmg-sub-edit-actions .wmg-toggle-btn { margin-left: 0; }
        .wmg-sub-name-input { width: 160px; max-width: 42vw; }
        .wmg-sub-amount-input { width: 80px; }
        @media (max-width: 480px) { .wmg-sub-name-input { max-width: 100%; width: 100%; } }
        .wmg-sub-name { font-size: 13.5px; font-weight: 500; }
        .wmg-flag { font-size: 9.5px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; color: var(--coral-text); background: var(--coral-soft); border-radius: 999px; padding: 3px 9px; }
        .wmg-sub-amount { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13.5px; font-weight: 700; }
        .wmg-toggle-btn { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 10.5px; font-weight: 700; border: 1px solid var(--hair); background: var(--ink-2); color: var(--paper); padding: 6px 12px; border-radius: 999px; cursor: pointer; margin-left: 14px; }
        .wmg-toggle-btn.is-cancelled { border-color: var(--sage); color: var(--sage); }
        .wmg-subs-total { display: flex; justify-content: space-between; margin-top: 14px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12.5px; color: var(--paper-dim); font-weight: 600; }

        .wmg-coach { border: none; background: linear-gradient(135deg, var(--gold-soft), var(--ink-2) 60%); }
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
        .wmg-infotip-btn:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
        .wmg-infotip-btn-light { border-color: rgba(255,255,255,0.6); color: rgba(255,255,255,0.9); }
        .wmg-infotip-btn-light:hover, .wmg-infotip-btn-light:focus { border-color: #FFFFFF; color: #FFFFFF; }
        .wmg-hero-score-wrap { display: flex; align-items: center; gap: 4px; }
        .wmg-infotip-bubble { position: absolute; z-index: 30; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); width: 220px; background: var(--paper); color: var(--ink); font-size: 11.5px; font-weight: 500; text-transform: none; letter-spacing: normal; line-height: 1.5; padding: 10px 12px; border-radius: 16px; box-shadow: 0 8px 20px rgba(15,15,45,0.25); }
        .wmg-infotip-bubble::after { content: ""; position: absolute; top: 100%; left: 50%; transform: translateX(-50%); border: 6px solid transparent; border-top-color: var(--paper); }
        .wmg-why-card { background: var(--brand-soft); border-radius: 18px; margin-bottom: 14px; overflow: hidden; }
        .wmg-why-toggle { width: 100%; display: flex; align-items: center; gap: 9px; background: transparent; border: none; padding: 11px 14px; cursor: pointer; text-align: left; font-family: inherit; }
        .wmg-why-icon { font-size: 13px; color: var(--brand); flex-shrink: 0; }
        .wmg-why-label { flex: 1; font-size: 12.5px; font-weight: 700; color: var(--paper); }
        .wmg-why-body { padding: 0 14px 14px; font-size: 12.5px; line-height: 1.6; color: var(--paper-dim); }
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
        .wmg-entry-card { padding: 12px 14px; }
        .wmg-entry-view { display: flex; align-items: center; gap: 10px; }
        .wmg-entry-view-text { flex: 1; min-width: 0; }
        .wmg-entry-title { font-size: 14.5px; font-weight: 700; color: var(--paper); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wmg-entry-detail { font-size: 12px; color: var(--paper-dim); margin-top: 2px; }
        .wmg-entry-edit-btn { flex-shrink: 0; background: var(--brand-soft); border: none; color: var(--brand); border-radius: 15px; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .wmg-entry-edit { display: flex; flex-direction: column; gap: 10px; }
        .wmg-entry-edit-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 2px; }
        .wmg-entry-done-btn { background: var(--brand); color: #FFFFFF; border: none; border-radius: 18px; padding: 9px 18px; font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: 'Plus Jakarta Sans', sans-serif; }
        .wmg-add-btn { background: transparent; border: 1.5px dashed var(--hair); color: var(--paper-dim); border-radius: 18px; padding: 10px 12px; font-size: 11.5px; font-weight: 700; cursor: pointer; width: 100%; font-family: 'Plus Jakarta Sans', sans-serif; }
        .wmg-add-btn:hover { border-color: var(--brand); color: var(--brand); }

        .wmg-cat-card { margin-bottom: 14px; }
        .wmg-cat-summary-toggle { width: 100%; display: flex; align-items: center; gap: 12px; background: transparent; border: none; padding: 0 0 12px; cursor: pointer; text-align: left; font-family: inherit; }
        .wmg-cat-summary-name-wrap { flex: 1; min-width: 0; display: flex; align-items: center; gap: 9px; }
        .wmg-cat-summary-name { font-size: 15px; font-weight: 700; color: var(--paper); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wmg-cat-edit { margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--hair); display: flex; flex-direction: column; gap: 4px; }
        .wmg-cat-edit-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
        .wmg-tag { font-size: 9.5px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 3px 9px; border-radius: 999px; color: var(--paper-dim); background: var(--ink-3); }
        .wmg-tag.essential { background: var(--slate-soft); color: var(--slate); }
        .wmg-tag.lifestyle { background: var(--coral-soft); color: var(--coral-text); }
        .wmg-tag.assumed { background: var(--gold-soft, #3D3320); color: var(--gold, #FFCE6B); }

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

        .wmg-tooltip { background: var(--ink-2); border: 1px solid var(--hair); border-radius: 18px; padding: 10px 12px; font-size: 12px; box-shadow: 0 8px 24px rgba(15,15,45,0.12); }
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
        .wmg-accordion-toggle { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #FFFFFF; font-size: 15px; font-weight: 800; flex-shrink: 0; line-height: 1; transition: transform .15s ease; }
        .wmg-accordion-toggle.tone-brand { background: linear-gradient(150deg, #A78BFA, #7C4DFF); }
        .wmg-accordion-toggle.tone-coral { background: linear-gradient(150deg, #FF9166, #FF6B4A); }
        .wmg-accordion-toggle.tone-sage { background: linear-gradient(150deg, #4FD1C5, #17A398); }
        .wmg-accordion-toggle.tone-gold { background: linear-gradient(150deg, #FFCE6B, #FFA400); }
        .wmg-edu-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
        .wmg-edu-dot.tone-brand { background: linear-gradient(150deg, #A78BFA, #7C4DFF); }
        .wmg-edu-dot.tone-coral { background: linear-gradient(150deg, #FF9166, #FF6B4A); }
        .wmg-edu-dot.tone-sage { background: linear-gradient(150deg, #4FD1C5, #17A398); }
        .wmg-edu-dot.tone-gold { background: linear-gradient(150deg, #FFCE6B, #FFA400); }

        /* Accessibility: white text fails WCAG AA contrast on the lighter/brighter
           gold, sage, coral and rust badge tones (as low as 1.7:1 for gold) — dark
           text reads clearly on all four (6.5–9.7:1). Brand purple is left as white
           since it's much closer to passing (4.2:1) and dark text there is worse,
           not better (3.9:1) — a small remaining gap, not a regression. */
        .wmg-sub-avatar.tone-coral, .wmg-sub-avatar.tone-sage, .wmg-sub-avatar.tone-gold, .wmg-sub-avatar.tone-rust,
        .wmg-accordion-toggle.tone-coral, .wmg-accordion-toggle.tone-sage, .wmg-accordion-toggle.tone-gold,
        .wmg-cat-badge.tone-coral,
        .wmg-insight-icon-badge.tone-coral, .wmg-insight-icon-badge.tone-sage, .wmg-insight-icon-badge.tone-gold, .wmg-insight-icon-badge.tone-rust {
          color: #1A1A3D;
        }
        .wmg-accordion-body { padding: 0 2px 16px; font-size: 13.5px; line-height: 1.65; color: var(--paper-dim); }

        .wmg-footnote { font-size: 11px; color: var(--paper-dim); margin-top: 40px; text-align: center; line-height: 1.6; }
        @media (max-width: 880px) { .wmg-footnote { margin-bottom: 80px; } }

        .wmg-onboard { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: linear-gradient(160deg, var(--brand) 0%, var(--brand-2) 55%, #4FD1C5 100%); }
        .wmg-onboard-card { width: 100%; max-width: 360px; background: var(--ink-2); border-radius: 24px; padding: 34px 28px 28px; text-align: center; box-shadow: 0 24px 48px -20px rgba(60,30,140,0.5); }
        .wmg-onboard-icon { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(150deg, var(--brand), var(--brand-2)); color: #FFFFFF; display: flex; align-items: center; justify-content: center; margin: 0 auto 18px; box-shadow: 0 8px 20px -6px rgba(60,30,140,0.5); }
        .wmg-onboard-icon svg { width: 26px; height: 26px; }
        .wmg-onboard-dots { display: flex; justify-content: center; gap: 6px; margin-bottom: 20px; }
        .wmg-onboard-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--hair); transition: all .2s ease; }
        .wmg-onboard-dot.on { background: var(--coral); width: 18px; border-radius: 3px; }
        .wmg-onboard-title { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 21px; font-weight: 800; letter-spacing: -0.01em; margin-bottom: 12px; color: var(--paper); }
        .wmg-onboard-body { font-size: 13.5px; line-height: 1.6; color: var(--paper-dim); margin-bottom: 28px; }
        .wmg-onboard-actions { display: flex; align-items: center; justify-content: center; gap: 14px; }
        .wmg-onboard-skip { background: transparent; border: none; color: var(--paper-dim); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; }
        .wmg-onboard-next { background: linear-gradient(135deg, var(--brand), var(--brand-2)); color: #FFFFFF; border: none; border-radius: 999px; padding: 13px 30px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; flex: 1; box-shadow: 0 10px 24px -10px rgba(60,30,140,0.6); transition: filter .15s ease, transform .15s ease; }
        .wmg-onboard-next:hover { filter: brightness(1.08); transform: translateY(-1px); }

        .wmg-btn-primary { background: var(--brand); color: #FFFFFF; border: none; border-radius: 999px; padding: 13px 22px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13.5px; font-weight: 700; cursor: pointer; }
        .wmg-btn-primary:hover { background: var(--brand-2); }
        .wmg-btn-primary:disabled { background: var(--hair); color: var(--paper-dim); cursor: not-allowed; }

        .wmg-pill { display: inline-block; background: var(--coral-soft); color: var(--coral-text); border: none; border-radius: 8px; padding: 2px 9px; font-weight: 700; font-size: inherit; font-family: inherit; cursor: pointer; line-height: 1.5; }
        .wmg-pill:hover { background: var(--coral); color: #FFFFFF; }
        .wmg-pill-input { display: inline-block; width: 76px; background: var(--coral-soft); color: var(--coral-text); border: 1.5px solid var(--coral); border-radius: 8px; padding: 1px 8px; font-size: inherit; font-weight: 700; font-family: inherit; text-align: center; }
        .wmg-sentence-card { font-size: 14.5px; line-height: 1.85; color: var(--paper); }
        .wmg-guided-summary-card { background: var(--brand-soft); border: 1px solid var(--brand); font-size: 14.5px; line-height: 1.7; margin-bottom: 14px; }
        .wmg-address-suggestions { position: absolute; z-index: 20; left: 0; right: 0; top: 100%; margin-top: 4px; background: var(--ink-2); border: 1px solid var(--hair); border-radius: 12px; max-height: 240px; overflow-y: auto; box-shadow: 0 12px 28px -10px rgba(15,15,45,0.35); }
        .wmg-address-suggestion { display: block; width: 100%; text-align: left; background: transparent; border: none; border-bottom: 1px solid var(--hair); padding: 10px 12px; font-size: 12.5px; color: var(--paper); cursor: pointer; }
        .wmg-address-suggestion:last-child { border-bottom: none; }
        .wmg-address-suggestion:hover { background: var(--ink-3); }
        .wmg-readonly-value { padding: 11px 14px; font-size: 13.5px; color: var(--paper-dim); background: var(--ink-3); border: 1px solid var(--hair); border-radius: 10px; }
        .wmg-detail-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--hair); }
        .wmg-detail-row:last-child { border-bottom: none; }
        .wmg-detail-row-label { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--paper-dim); }
        .wmg-detail-row-value { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14.5px; font-weight: 700; color: var(--paper); font-variant-numeric: tabular-nums; }
        .wmg-connect-bank-banner { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
        .wmg-connect-bank-banner-text { flex: 1 1 240px; min-width: 0; }
        .wmg-connect-bank-banner-title { font-family: 'Baloo 2', sans-serif; font-weight: 700; font-size: 14.5px; color: var(--paper); margin-bottom: 3px; }
        .wmg-connect-bank-banner-sub { font-size: 12.5px; line-height: 1.5; color: var(--paper-dim); }
        .wmg-tab-tip { display: flex; align-items: flex-start; gap: 10px; background: var(--brand-soft); border: 1px solid var(--brand); border-radius: 16px; padding: 12px 14px; margin-bottom: 14px; }
        .wmg-tab-tip-icon { flex-shrink: 0; margin-top: 2px; color: var(--brand); }
        .wmg-tab-tip-text { flex: 1; margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--paper); }
        .wmg-tab-tip-close { flex-shrink: 0; background: var(--brand); color: #FFFFFF; border: none; border-radius: 999px; padding: 6px 14px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }
        .wmg-tab-tip-close:hover { background: var(--brand-dark, var(--brand)); opacity: 0.9; }
        .wmg-sentence-name-input { background: transparent; border: none; border-bottom: 1.5px dashed var(--hair); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 800; color: var(--paper); padding: 2px 0; margin-bottom: 6px; width: 100%; }
        .wmg-sentence-name-input:focus { outline: none; border-bottom-color: var(--brand-2); }
        .wmg-sentence-row { display: flex; align-items: flex-start; gap: 10px; }
        .wmg-sentence-row-main { flex: 1; min-width: 0; }
        .wmg-item-line { display: flex; align-items: center; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--hair); }
        .wmg-item-remove-btn { background: transparent; border: none; color: var(--paper-dim); border-radius: 10px; width: 26px; height: 26px; cursor: pointer; flex-shrink: 0; font-size: 15px; line-height: 1; display: flex; align-items: center; justify-content: center; }
        .wmg-item-remove-btn:hover { background: var(--rust-soft); color: var(--rust); }
        .wmg-item-line:last-of-type { border-bottom: none; }
        .wmg-item-line-costs { font-size: 12.5px; color: var(--paper-dim); flex-shrink: 0; }
        .wmg-pill-fill { display: block; width: 100%; box-sizing: border-box; text-align: left; }
        input.wmg-pill-fill { text-align: left; }
        .wmg-item-line > .wmg-pill-fill:first-child, .wmg-item-line > input.wmg-pill-fill:first-child { flex: 1; min-width: 0; }
        .wmg-item-line > .wmg-pill-fill:nth-child(2), .wmg-item-line > input.wmg-pill-fill:nth-child(2) { width: 100px; flex-shrink: 0; }

        .wmg-mascot-wrap { position: fixed; left: 18px; bottom: 18px; z-index: 30; }
        @media (max-width: 880px) { .wmg-mascot-wrap { left: auto; right: 14px; bottom: calc(100px + env(safe-area-inset-bottom)); } }
        .wmg-mascot-face { width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(150deg, #A78BFA, #7C4DFF); border: none; box-shadow: 0 8px 20px -6px rgba(124,77,255,0.5); cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; animation: wmgMascotBob 4.5s ease-in-out infinite; }
        .wmg-mascot-face:hover { animation-play-state: paused; transform: scale(1.05); }
        @keyframes wmgMascotBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        @media (prefers-reduced-motion: reduce) { .wmg-mascot-face { animation: none; } }
        .wmg-mascot-bubble { position: absolute; bottom: calc(100% + 12px); left: 0; width: 270px; background: var(--paper); color: var(--ink); border-radius: 18px; padding: 14px 16px; font-size: 12.5px; line-height: 1.55; box-shadow: 0 12px 28px rgba(10,8,35,0.35); }
        .wmg-mascot-bubble::after { content: ""; position: absolute; top: 100%; left: 18px; border: 7px solid transparent; border-top-color: var(--paper); }
        @media (max-width: 880px) {
          .wmg-mascot-bubble { left: auto; right: 0; }
          .wmg-mascot-bubble::after { left: auto; right: 18px; }
        }
        .wmg-mascot-bubble-close { position: absolute; top: 8px; right: 10px; background: transparent; border: none; color: var(--ink); opacity: 0.6; font-size: 16px; line-height: 1; cursor: pointer; padding: 2px; }
        .wmg-mascot-bubble-close:hover { opacity: 1; }
        .wmg-mascot-bubble p { margin: 0; padding-right: 10px; }
        .wmg-mascot-coach-list { display: flex; flex-direction: column; gap: 8px; padding-right: 10px; }
        .wmg-mascot-coach-tip { text-align: left; background: rgba(124,77,255,0.08); border: none; border-radius: 12px; padding: 9px 10px; font-size: 12px; line-height: 1.45; color: var(--ink); cursor: pointer; }
        .wmg-mascot-coach-tip:hover { background: rgba(124,77,255,0.14); }

        .wmg-life-event-card { padding: 12px; background: var(--ink-3); border: 1px solid var(--hair); border-radius: 14px; margin-bottom: 10px; }
        .wmg-life-event-row-top { display: flex; align-items: flex-end; gap: 8px; margin-bottom: 10px; }
        .wmg-life-event-row-top > div { flex: 1; min-width: 0; }
        .wmg-life-event-row-bottom { display: flex; flex-wrap: wrap; gap: 8px; }
        .wmg-life-event-row-bottom > div { flex: 1; min-width: 90px; }

        .wmg-bank-connected-row { display: flex; align-items: center; gap: 12px; }
        .wmg-bank-connected-icon { width: 44px; height: 44px; border-radius: 14px; background: var(--brand-soft); color: var(--brand-2); display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
        .wmg-bank-connected-name { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14.5px; font-weight: 800; color: var(--paper); }
        .wmg-bank-list { max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
        .wmg-bank-list-item { display: flex; align-items: center; gap: 10px; width: 100%; background: transparent; border: none; border-radius: 14px; padding: 10px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13.5px; font-weight: 600; color: var(--paper); text-align: left; cursor: pointer; }
        .wmg-bank-list-item:hover { background: var(--ink-3); }
        .wmg-bank-list-item:disabled { opacity: 0.6; cursor: not-allowed; }
        .wmg-bank-list-logo { width: 26px; height: 26px; border-radius: 7px; object-fit: contain; flex-shrink: 0; }

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

        .wmg-wizard-card { width: 100%; max-width: 460px; background: var(--ink-2); border-radius: 24px; padding: 30px 26px 26px; box-shadow: 0 24px 48px -20px rgba(60,30,140,0.5); max-height: 88vh; overflow-y: auto; }
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
        .wmg-wizard-section-title { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--paper-dim); margin: 18px 0 8px; }
        .wmg-wizard-section-title:first-of-type { margin-top: 0; }
        .wmg-wizard-mode-options { display: flex; flex-direction: column; gap: 8px; }
        .wmg-wizard-mode-option { text-align: left; background: var(--ink-3); border: 1px solid var(--hair); border-radius: 14px; padding: 12px 14px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13px; font-weight: 600; color: var(--paper); cursor: pointer; transition: border-color .15s ease, background .15s ease; }
        .wmg-wizard-mode-option:hover { border-color: var(--brand-soft); }
        .wmg-wizard-mode-option.active { background: var(--brand-soft); border-color: var(--brand); color: var(--brand); }
        .wmg-wizard-mode-recommend { background: var(--brand-soft); border: 1px solid var(--brand); border-radius: 14px; padding: 12px 14px; font-size: 12.5px; line-height: 1.55; color: var(--paper); }
        .wmg-wizard-mode-recommend strong { color: var(--brand); }
        .wmg-mode-toggle { display: flex; gap: 6px; margin-bottom: 4px; }
        .wmg-mode-toggle-btn { flex: 1; background: var(--ink-3); border: 1px solid var(--hair); border-radius: 10px; padding: 8px 6px; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 11.5px; font-weight: 700; color: var(--paper-dim); cursor: pointer; transition: border-color .15s ease, background .15s ease, color .15s ease; }
        .wmg-mode-toggle-btn:hover { border-color: var(--brand-soft); }
        .wmg-mode-toggle-btn.active { background: var(--brand); border-color: var(--brand); color: #FFFFFF; }
        .wmg-disclosure { margin-top: 10px; }
        .wmg-disclosure-toggle { background: transparent; border: none; color: var(--brand); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12.5px; font-weight: 700; cursor: pointer; padding: 4px 0; display: flex; align-items: center; gap: 5px; }
        .wmg-disclosure-toggle:hover { text-decoration: underline; }
        .wmg-disclosure-chevron { font-size: 11px; }
        .wmg-disclosure-body { margin-top: 10px; padding-top: 12px; border-top: 1px solid var(--hair); }
        .wmg-mini-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
        .wmg-mini-field-label { font-size: 10.5px; font-weight: 700; color: var(--paper-dim); text-transform: uppercase; letter-spacing: 0.03em; }
        .wmg-mini-field input { width: 100%; box-sizing: border-box; }
        .wmg-wizard-list-row-numbers { display: flex; gap: 8px; align-items: flex-start; }
        .wmg-wizard-list-card { background: var(--ink-3); border: 1px solid var(--hair); border-radius: 14px; padding: 10px; margin-bottom: 10px; }
        .wmg-wizard-list-row-top { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
        .wmg-wizard-add-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
        .wmg-wizard-add-row .wmg-wizard-list-add { width: auto; flex: 1 1 auto; margin-bottom: 0; }
        .wmg-wizard-list-add-secondary { background: transparent; border-style: solid; }
        .wmg-wizard-list-remove:hover { background: var(--rust-soft); color: var(--rust); border-color: var(--rust-soft); }
        .wmg-wizard-list-add { background: var(--ink-3); border: 1px dashed var(--hair); color: var(--brand); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12px; font-weight: 700; border-radius: 16px; padding: 9px; width: 100%; cursor: pointer; margin-bottom: 18px; }
        .wmg-wizard-list-add:hover { background: var(--brand-soft); }
        .wmg-wizard-back { background: transparent; border: 1px solid var(--hair); color: var(--paper); font-family: 'Plus Jakarta Sans', sans-serif; font-size: 13px; font-weight: 700; border-radius: 999px; padding: 13px 20px; cursor: pointer; }
        @media (max-width: 480px) { .wmg-onboard { padding: 14px; } .wmg-wizard-card { padding: 24px 18px 20px; } .wmg-onboard-actions { flex-wrap: wrap; } }

        .wmg-celebration { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 50; background: linear-gradient(135deg, var(--brand), var(--brand-2)); color: #FFFFFF; padding: 13px 22px 13px 16px; border-radius: 999px; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; font-size: 13px; box-shadow: 0 14px 32px -10px rgba(60,30,140,0.5); display: flex; align-items: center; gap: 10px; max-width: 90vw; animation: wmg-celebration-in 0.5s cubic-bezier(0.34,1.56,0.64,1); }
        .wmg-celebration-icon { width: 22px; height: 22px; border-radius: 50%; background: rgba(255,255,255,0.22); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #FFFFFF; }
        @keyframes wmg-celebration-in { from { transform: translate(-50%, -24px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }

        .wmg-feedback-modal { width: 100%; max-width: 380px; background: var(--ink-2); border-radius: 22px; padding: 26px 24px; margin: 16px; box-shadow: 0 20px 44px -14px rgba(15,15,45,0.4); }
        .wmg-feedback-title { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 18px; font-weight: 800; margin-bottom: 6px; }
        .wmg-feedback-sub { font-size: 13px; color: var(--paper-dim); line-height: 1.55; margin-bottom: 16px; }
        /* Deliberately its own backdrop rather than reusing
           .wmg-more-sheet-backdrop — that one is hidden above 880px
           (mobile-only bottom sheet), but onUpgrade fires from buttons
           that appear on desktop too (Overview, sidebar AccountPanel). */
        .wmg-plan-modal-backdrop { position: fixed; inset: 0; background: rgba(15,15,45,0.4); z-index: 50; display: flex; align-items: center; justify-content: center; }
        .wmg-plan-modal { width: 100%; max-width: 380px; background: var(--ink-2); border-radius: 22px; padding: 26px 24px; margin: 16px; box-shadow: 0 20px 44px -14px rgba(15,15,45,0.4); }
        .wmg-plan-option { width: 100%; text-align: left; background: var(--ink-3); border: 1px solid var(--hair); border-radius: 16px; padding: 14px 16px; margin-bottom: 10px; cursor: pointer; display: block; }
        .wmg-plan-option:hover:not(:disabled) { border-color: var(--brand); }
        .wmg-plan-option:disabled { opacity: 0.6; cursor: not-allowed; }
        .wmg-plan-option-top { display: flex; align-items: center; justify-content: space-between; font-family: 'Plus Jakarta Sans', sans-serif; }
        .wmg-plan-option-name { font-size: 14.5px; font-weight: 700; color: var(--paper); }
        .wmg-plan-option-price { font-size: 14.5px; font-weight: 800; color: var(--brand); }
        .wmg-plan-option-note { display: block; font-size: 11.5px; color: var(--paper-dim); margin-top: 4px; font-family: 'Plus Jakarta Sans', sans-serif; }
        .wmg-feedback-cats { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
        .wmg-feedback-cat { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 11.5px; font-weight: 700; border: 1px solid var(--hair); background: transparent; color: var(--paper-dim); padding: 7px 12px; border-radius: 999px; cursor: pointer; }
        .wmg-feedback-cat.active { background: var(--brand); border-color: var(--brand); color: #FFFFFF; }

        @media (prefers-reduced-motion: reduce) {
          .wmg-growth-ring svg circle { transition: none; }
          .wmg-stat-tile-clickable { transition: background .15s ease, border-color .15s ease; }
          .wmg-stat-tile-clickable:hover { transform: none; }
          .wmg-coach-clickable { transition: box-shadow .12s ease; }
          .wmg-coach-clickable:hover { transform: none; }
          .wmg-celebration { animation: none; }
          .wmg-onboard-next:hover, .wmg-onboard-next:active { transform: none; }
        }
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
              className={`wmg-nav-item wmg-nav-more ${NAV.slice(4).some((n) => n.key === tab) ? "active" : ""}`}
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
                <div className="wmg-more-sheet-divider" />
                <button
                  className="wmg-more-sheet-item"
                  onClick={() => {
                    setMoreOpen(false);
                    setAccountOpen(true);
                  }}
                >
                  <span className="wmg-nav-icon-badge">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                    </svg>
                  </span>
                  Account
                </button>
              </div>
            </div>
          )}
          {accountOpen && (
            <div className="wmg-more-sheet-backdrop" onClick={() => setAccountOpen(false)}>
              <div className="wmg-more-sheet wmg-account-sheet" onClick={(e) => e.stopPropagation()}>
                <div className="wmg-more-sheet-handle" />
                <div className="wmg-more-sheet-title">
                  Account
                  <button className="wmg-icon-btn" onClick={() => setAccountOpen(false)} aria-label="Close">✕</button>
                </div>
                <AccountPanel
                  storageStatus={storageStatus}
                  profile={profile}
                  setField={setField}
                  onOpenFeedback={() => {
                    setAccountOpen(false);
                    setFeedbackOpen(true);
                    setFeedbackStatus("idle");
                  }}
                  confirmingReset={confirmingReset}
                  setConfirmingReset={setConfirmingReset}
                  resetData={resetData}
                  confirmingDeleteAccount={confirmingDeleteAccount}
                  setConfirmingDeleteAccount={(v) => {
                    setConfirmingDeleteAccount(v);
                    if (v) {
                      setDeleteAccountText("");
                      setDeleteAccountStatus("idle");
                    }
                  }}
                  deleteAccountText={deleteAccountText}
                  setDeleteAccountText={setDeleteAccountText}
                  deleteAccountStatus={deleteAccountStatus}
                  deleteAccountNow={deleteAccountNow}
                  onHouseholdChanged={reloadAfterHouseholdChange}
                  hasPremium={subscription.hasPremium}
                  subscriptionStatus={subscription.status}
                  onUpgrade={handleUpgrade}
                />
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
          {planPickerOpen && (
            <div className="wmg-plan-modal-backdrop" onClick={() => !upgradeBusy && setPlanPickerOpen(false)}>
              <div className="wmg-plan-modal" onClick={(e) => e.stopPropagation()}>
                <div className="wmg-feedback-title">Choose your plan</div>
                <p className="wmg-feedback-sub">
                  Both unlock the same Premium features — household sharing, the AI Document Reader, spending
                  insights, and automatic nightly bank sync.
                </p>
                <button
                  type="button"
                  className="wmg-plan-option"
                  disabled={upgradeBusy}
                  onClick={() => confirmUpgrade("monthly")}
                >
                  <span className="wmg-plan-option-top">
                    <span className="wmg-plan-option-name">Monthly</span>
                    <span className="wmg-plan-option-price">£4.99/mo</span>
                  </span>
                  <span className="wmg-plan-option-note">14-day free trial, cancel any time</span>
                </button>
                <button
                  type="button"
                  className="wmg-plan-option"
                  disabled={upgradeBusy}
                  onClick={() => confirmUpgrade("annual")}
                >
                  <span className="wmg-plan-option-top">
                    <span className="wmg-plan-option-name">Annual</span>
                    <span className="wmg-plan-option-price">£49.99/yr</span>
                  </span>
                  <span className="wmg-plan-option-note">Works out cheaper than paying monthly — no trial</span>
                </button>
                <button
                  className="wmg-reset-btn"
                  style={{ width: "100%", marginTop: 4 }}
                  disabled={upgradeBusy}
                  onClick={() => setPlanPickerOpen(false)}
                >
                  {upgradeBusy ? "Opening checkout…" : "Cancel"}
                </button>
              </div>
            </div>
          )}
          <div className="wmg-sidebar-foot">
            <AccountPanel
              storageStatus={storageStatus}
              profile={profile}
              setField={setField}
              onOpenFeedback={() => {
                setFeedbackOpen(true);
                setFeedbackStatus("idle");
              }}
              confirmingReset={confirmingReset}
              setConfirmingReset={setConfirmingReset}
              resetData={resetData}
              confirmingDeleteAccount={confirmingDeleteAccount}
              setConfirmingDeleteAccount={(v) => {
                setConfirmingDeleteAccount(v);
                if (v) {
                  setDeleteAccountText("");
                  setDeleteAccountStatus("idle");
                }
              }}
              deleteAccountText={deleteAccountText}
              setDeleteAccountText={setDeleteAccountText}
              deleteAccountStatus={deleteAccountStatus}
              deleteAccountNow={deleteAccountNow}
              onHouseholdChanged={reloadAfterHouseholdChange}
              hasPremium={subscription.hasPremium}
              subscriptionStatus={subscription.status}
              onUpgrade={handleUpgrade}
            />
          </div>
        </div>

        {/* main */}
        <div className="wmg-main">
          <div className="wmg-topbar">
            <div className="wmg-topbar-left">
              <span className="wmg-topbar-brand"><BrandMark size={26} /></span>
              <div className="wmg-topbar-title">{TAB_TITLES[tab]}</div>
            </div>
            <div className="wmg-topbar-stats">
            {tab !== "overview" && (
              <>
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
                  <div className="wmg-topbar-stat-val" style={{ color: topbarAvailable >= 0 ? "var(--sage)" : "var(--rust)" }}>{gbp(Math.round(animatedTopbarAvailableFixed))}</div>
                </div>
              </>
            )}
            </div>
          </div>

          <div className="wmg-content" key={tab}>
          <TabTip tab={tab} seen={profile.seenTabTips.includes(tab)} onDismiss={() => dismissTabTip(tab)} />
          <Suspense fallback={<div className="wmg-tab-loading">Loading…</div>}>
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
                inFinancialHardship={inFinancialHardship}
                onNavigate={setTab}
                hasConnectedBank={hasConnectedBank}
                hasPremium={subscription.hasPremium}
                subscriptionStatus={subscription.status}
                onUpgrade={handleUpgrade}
                setField={setField}
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
                addNamedItem={addNamedItem}
                removeItem={removeItem}
                updateItem={updateItem}
                toggleSub={toggleSub}
                updateArrayItem={updateArrayItem}
                addArrayItem={addArrayItem}
                addArrayItemWithId={addArrayItemWithId}
                removeArrayItem={removeArrayItem}
                onAcceptDetectedSubscription={acceptDetectedSubscription}
                onDismissDetectedSubscription={dismissDetectedSubscription}
                onConfirmSubscriptionStopped={confirmSubscriptionStopped}
                onKeepFlaggedSubscription={keepFlaggedSubscription}
                hasPremium={subscription.hasPremium}
                subscriptionStatus={subscription.status}
                onUpgrade={handleUpgrade}
              />
            )}

            {tab === "import" && (
              <ImportTab
                profile={profile}
                addBulkItems={addBulkItems}
                onApplyImportedSpending={applyImportedSpending}
                onBankSyncApplied={applyBankSync}
                onDiscardPendingSync={discardPendingBankSync}
                hasConnectedBank={hasConnectedBank}
                onBankAccountsChanged={refreshConnectedBank}
                onSubscriptionsDetected={applyDetectedSubscriptions}
                onUseAsSavings={applySavingsFromBank}
                onSubscriptionsPossiblyStopped={flagPossiblyStoppedSubscriptions}
                onUseAsCardDebt={applyCardBalanceFromBank}
                hasPremium={subscription.hasPremium}
                subscriptionStatus={subscription.status}
                onUpgrade={handleUpgrade}
                canPullBank={canPullBank}
                nextPullAvailableAt={nextPullAvailableAt}
                onManualBankPullApplied={recordManualBankPull}
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
                addArrayItemWithId={addArrayItemWithId}
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
                hasPremium={subscription.hasPremium}
                subscriptionStatus={subscription.status}
                onUpgrade={handleUpgrade}
              />
            )}

            {tab === "goals" && (
              <GoalsTab
                profile={profile}
                totals={totals}
                setField={setField}
                updateGoal={updateGoal}
                addGoal={addGoal}
                addGoalWithId={addGoalWithId}
                removeGoal={removeGoal}
              />
            )}

            {tab === "pension" && (
              <PensionTab
                profile={profile}
                setField={setField}
                pensionScenarios={pensionScenarios}
                pensionYearsToRetire={pensionYearsToRetire}
                totals={totals}
                updateArrayItem={updateArrayItem}
                addArrayItem={addArrayItem}
                addArrayItemWithId={addArrayItemWithId}
                removeArrayItem={removeArrayItem}
              />
            )}

            {tab === "pension-reader" && (
              <PensionReaderTab
                pensions={profile.pensions}
                investmentsBalance={profile.investments.balance}
                hasPremium={subscription.hasPremium}
                subscriptionStatus={subscription.status}
                onUpgrade={handleUpgrade}
                onUseInPension={(result, targetPotId) => {
                  if (targetPotId === "new") {
                    addArrayItem("pensions", {
                      name: result.provider || "New pension",
                      balance: result.currentValue ?? 0,
                      contribution: result.monthlyContribution ?? 0,
                      growthLow: defaultProfile.pensions[0].growthLow,
                      growthMedium: defaultProfile.pensions[0].growthMedium,
                      growthHigh: defaultProfile.pensions[0].growthHigh,
                    })();
                  } else {
                    if (result.currentValue != null) updateArrayItem("pensions")(targetPotId, "balance", result.currentValue);
                    if (result.monthlyContribution != null) updateArrayItem("pensions")(targetPotId, "contribution", result.monthlyContribution);
                  }
                  // Retirement age is a person-level assumption shared across
                  // all pots, so a statement's assumed retirement age updates
                  // it regardless of which pot the numbers went into.
                  if (result.retirementAge != null) setField(["pensionSettings", "retirementAge"])(result.retirementAge);
                }}
                onUseInInvestments={(result, mode) => {
                  // Investments is a single running balance (not multiple
                  // named pots like Pensions), so this is simpler than the
                  // pension handler above — just add to or replace it.
                  if (result.currentValue != null) {
                    const newBalance = mode === "add" ? profile.investments.balance + result.currentValue : result.currentValue;
                    setField(["investments", "balance"])(newBalance);
                  }
                  if (result.monthlyContribution != null) {
                    const newContribution =
                      mode === "add" ? profile.investments.monthlyContribution + result.monthlyContribution : result.monthlyContribution;
                    setField(["investments", "monthlyContribution"])(newContribution);
                  }
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
          </Suspense>

            <div className="wmg-footnote">
              Figures come from what you've entered, plus your connected bank if you've linked one via Open Banking —
              nothing here is financial advice. {supabase ? "Your data is saved to your account." : "Your data is saved on this device."}
            </div>
          </div>
        </div>
        <Mascot tab={tab} coachTips={coachTips} inFinancialHardship={inFinancialHardship} onNavigate={setTab} />
      </div>
      )}
    </div>
  );
}

/* ============================== tabs ============================== */


