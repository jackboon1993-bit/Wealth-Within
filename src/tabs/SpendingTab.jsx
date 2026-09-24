import React, { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, ResponsiveContainer, Tooltip as RechartsTooltip, Cell } from "recharts";
import { gbp } from "../lib/finance";
import { Card, BarRow } from "../components/ui";
import { API_BASE } from "../lib/apiBase";
import { supabase } from "../lib/supabaseClient";
// PremiumGate lives in IncomeTab.jsx (not ui.js) — reused as-is rather
// than duplicated, same gating pattern already used for the bill
// checker, spending insight and Pension Reader.
import { PremiumGate } from "./IncomeTab";

// The dedicated "Spending" tab — replaces both the old "Ask about your
// spending" popout on Overview and the old Budget tab (IncomeTab.jsx)
// as the place for a real month-by-month deep dive into where money
// actually went. Design approved 2026-09 after several rounds of
// mockup iteration: header + month nav, a spent-vs-income headline, a
// 6-month trend, an Essential/Lifestyle category breakdown (same
// headings Overview's own income/outgoings list uses for Essential —
// Mortgage, Bills, Pension, Investments — with Lifestyle genuinely new,
// drawn from real transaction categories rather than anything Overview
// already shows), and "Ask your budget" carried over unchanged in spirit
// from the old popout/Budget-tab feature.
//
// Every figure here that can be wrong is sourced from real data —
// household_transactions for anything month-specific (spend totals,
// category breakdowns, the 6-month trend, transaction drill-down),
// profile/totals for the handful of fixed monthly figures (income,
// mortgage payment, pension & investment contributions) that don't
// come through bank categorisation at all. Nothing here is invented.

function monthBounds(offset) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return { start, end };
}

function fmtRange(start, end) {
  const endInclusive = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return `${start.toLocaleDateString("en-GB", { day: "numeric", month: "long" })} – ${endInclusive.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
}

// A category counts as "essential" for the Lifestyle-bucket split if its
// name matches one of profile's own essential-type categories, or looks
// like one of the fixed lines (mortgage, pension, investments) already
// shown separately above — everything else genuinely discretionary
// (dining, shopping, entertainment, etc.) falls into Lifestyle.
function isEssentialCategoryName(name, essentialNames) {
  const n = (name || "").toLowerCase();
  if (essentialNames.some((e) => n.includes(e))) return true;
  return ["mortgage", "pension", "investment", "loan", "credit card", "debt"].some((k) => n.includes(k));
}

export function SpendingTab({ profile, totals, onNavigate, hasPremium, subscriptionStatus, onUpgrade }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const { start: monthStart, end: monthEnd } = monthBounds(monthOffset);
  const monthLabel = monthStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const essentialNames = useMemo(
    () => profile.expenseCategories.filter((c) => c.type === "essential").map((c) => c.name.toLowerCase()),
    [profile.expenseCategories]
  );

  // ---- month's transactions (drives spent total + lifestyle breakdown) ----
  const [txStatus, setTxStatus] = useState("idle"); // idle | loading | done | error
  const [monthTx, setMonthTx] = useState([]);

  useEffect(() => {
    setTxStatus("loading");
    (async () => {
      const { data, error } = await supabase
        .from("household_transactions")
        .select("merchant, category, amount, date")
        .lt("amount", 0)
        .gte("date", monthStart.toISOString().slice(0, 10))
        .lt("date", monthEnd.toISOString().slice(0, 10))
        .order("date", { ascending: false });
      if (error) {
        setTxStatus("error");
        return;
      }
      setMonthTx(data || []);
      setTxStatus("done");
    })();
  }, [monthOffset]);

  const spentThisMonth = useMemo(() => monthTx.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0), [monthTx]);

  // Fixed essential lines — same terms Overview's own income/outgoings
  // list uses, deliberately NOT re-derived from monthTx: mortgage,
  // pension and investment contributions don't reliably show up as
  // categorised bank transactions, so profile/totals is the honest
  // source for these, exactly as it already is on Overview.
  const essentialRows = useMemo(() => {
    const mortgagePayment = profile.mortgage.includedInExpenditure ? 0 : Number(profile.mortgage.payment || 0);
    return [
      { name: "Mortgage", value: mortgagePayment },
      { name: "Bills", value: totals.essentialCatTotal },
      { name: "Pension", value: totals.pensionContribution },
      { name: "Investments", value: Number(profile.investments.monthlyContribution || 0) },
    ].filter((r) => r.value > 0);
  }, [profile.mortgage, profile.investments.monthlyContribution, totals.essentialCatTotal, totals.pensionContribution]);

  const lifestyleRows = useMemo(() => {
    const byCategory = new Map();
    monthTx.forEach((t) => {
      const name = t.category || "Other";
      if (isEssentialCategoryName(name, essentialNames)) return;
      const amt = Math.abs(Number(t.amount) || 0);
      byCategory.set(name, (byCategory.get(name) || 0) + amt);
    });
    return Array.from(byCategory.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [monthTx, essentialNames]);

  const essentialMax = Math.max(1, ...essentialRows.map((r) => r.value));
  const lifestyleMax = Math.max(1, ...lifestyleRows.map((r) => r.value));

  // ---- drill-down: tap a category to see the real transactions behind it ----
  const [selectedCategory, setSelectedCategory] = useState(null); // { name, group } | null
  const categoryTransactions = useMemo(() => {
    if (!selectedCategory) return [];
    return monthTx
      .filter((t) => (selectedCategory.group === "lifestyle" ? (t.category || "Other") === selectedCategory.name : true))
      .sort((a, b) => Math.abs(Number(b.amount)) - Math.abs(Number(a.amount)));
  }, [monthTx, selectedCategory]);

  // ---- 6-month trend ----
  const [trendStatus, setTrendStatus] = useState("idle"); // idle | loading | done | error
  const [trendData, setTrendData] = useState([]);

  useEffect(() => {
    setTrendStatus("loading");
    (async () => {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      sixMonthsAgo.setDate(1);
      const { data, error } = await supabase
        .from("household_transactions")
        .select("amount, date")
        .lt("amount", 0)
        .gte("date", sixMonthsAgo.toISOString().slice(0, 10));
      if (error) {
        setTrendStatus("error");
        return;
      }
      const byMonth = new Map();
      (data || []).forEach((t) => {
        const key = String(t.date).slice(0, 7); // YYYY-MM
        byMonth.set(key, (byMonth.get(key) || 0) + Math.abs(Number(t.amount) || 0));
      });
      const months = [];
      const cursor = new Date();
      cursor.setDate(1);
      for (let i = 5; i >= 0; i--) {
        const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
        const key = d.toISOString().slice(0, 7);
        months.push({ key, label: d.toLocaleDateString("en-GB", { month: "short" }), value: Math.round(byMonth.get(key) || 0) });
      }
      setTrendData(months);
      setTrendStatus("done");
    })();
    // Only needs to run once per mount — the trend always shows the
    // trailing 6 real calendar months regardless of which month the
    // person is browsing above, so it doesn't depend on monthOffset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trendLine = useMemo(() => {
    if (trendData.length < 2) return null;
    const current = trendData[trendData.length - 1];
    const priorMonths = trendData.slice(0, -1).filter((m) => m.value > 0);
    if (!priorMonths.length || current.value === 0) return null;
    const avgPrior = priorMonths.reduce((s, m) => s + m.value, 0) / priorMonths.length;
    if (avgPrior <= 0) return null;
    const pct = Math.round(((current.value - avgPrior) / avgPrior) * 100);
    if (Math.abs(pct) < 3) return "About in line with your recent average.";
    return `${pct > 0 ? "Up" : "Down"} ${Math.abs(pct)}% vs your last few months' average.`;
  }, [trendData]);

  // ---- Ask your budget — carried over unchanged in spirit from the old popout ----
  const [askQuestion, setAskQuestion] = useState("");
  const [askStatus, setAskStatus] = useState("idle"); // idle | loading | done | error | locked
  const [askAnswer, setAskAnswer] = useState("");
  const [askError, setAskError] = useState("");

  const askBudget = async () => {
    if (!askQuestion.trim()) return;
    setAskStatus("loading");
    setAskError("");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      let merchants = [];
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const { data: txRows } = await supabase
        .from("household_transactions")
        .select("merchant, category, amount, date")
        .lt("amount", 0)
        .gte("date", threeMonthsAgo.toISOString().slice(0, 10));
      if (txRows && txRows.length > 0) {
        const byMerchant = new Map();
        txRows.forEach((t) => {
          const name = t.merchant || "Other";
          const key = `${name}__${t.category || ""}`;
          if (!byMerchant.has(key)) byMerchant.set(key, { name, category: t.category, total: 0, count: 0 });
          const entry = byMerchant.get(key);
          entry.total += Math.abs(Number(t.amount) || 0);
          entry.count += 1;
        });
        merchants = Array.from(byMerchant.values())
          .sort((a, b) => b.total - a.total)
          .slice(0, 40);
      }

      const resp = await fetch(`${API_BASE}/api/ask-budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          question: askQuestion,
          categories: [...essentialRows, ...lifestyleRows].map((r) => ({ name: r.name, value: r.value, budget: null })),
          income: totals.income,
          subscriptions: profile.subscriptions.filter((s) => !s.cancelled).map((s) => ({ name: s.name, amount: s.amount })),
          merchants,
        }),
      });
      const data = await resp.json();
      if (resp.status === 402) {
        setAskStatus("locked");
        return;
      }
      if (!resp.ok) throw new Error(data.error || "Something went wrong.");
      setAskAnswer(data.answer);
      setAskStatus("done");
    } catch (e) {
      setAskStatus("error");
      setAskError(e.message || "Couldn't answer that right now.");
    }
  };

  // ---- Level 2: real transactions for a tapped category ----
  if (selectedCategory) {
    return (
      <>
        <button
          type="button"
          onClick={() => setSelectedCategory(null)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            background: "var(--brand-soft)", border: "none", borderRadius: 999,
            padding: "6px 12px", marginBottom: 12, fontSize: 12.5, fontWeight: 700, color: "var(--brand)", cursor: "pointer",
          }}
        >
          ← Back to categories
        </button>
        <div className="wmg-section-title">{selectedCategory.name}</div>
        <div className="wmg-sub" style={{ marginBottom: 12, fontSize: 11.5 }}>
          {fmtRange(monthStart, monthEnd)}, sorted by amount
        </div>
        <Card>
          {categoryTransactions.length === 0 && (
            <div className="wmg-sub">No transactions found for this category in {monthLabel}.</div>
          )}
          {categoryTransactions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {categoryTransactions.map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "0.5px solid var(--hair)" }}>
                  <div style={{ fontSize: 11, color: "var(--paper-dim)", width: 60, flexShrink: 0 }}>
                    {new Date(t.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </div>
                  <div style={{ flex: 1, fontSize: 13, color: "var(--paper)" }}>{t.merchant || "Unknown"}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--paper)" }}>{gbp(Math.abs(Number(t.amount) || 0))}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </>
    );
  }

  // ---- Level 1: the main Spending tab ----
  return (
    <>
      <div className="wmg-section-title">Spending</div>

      {/* Month nav — same pattern as the old popout, now its own page. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => { setMonthOffset((m) => m - 1); setSelectedCategory(null); }}
          style={{ background: "var(--brand-soft)", border: "none", borderRadius: 999, width: 32, height: 32, fontSize: 15, fontWeight: 700, color: "var(--brand)", cursor: "pointer" }}
        >
          ‹
        </button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--paper)" }}>{monthLabel}</div>
          <div className="wmg-sub" style={{ fontSize: 11 }}>{fmtRange(monthStart, monthEnd)}</div>
        </div>
        <button
          type="button"
          onClick={() => setMonthOffset((m) => Math.min(0, m + 1))}
          disabled={monthOffset >= 0}
          style={{
            background: "var(--brand-soft)", border: "none", borderRadius: 999, width: 32, height: 32, fontSize: 15, fontWeight: 700,
            color: "var(--brand)", cursor: monthOffset >= 0 ? "default" : "pointer", opacity: monthOffset >= 0 ? 0.35 : 1,
          }}
        >
          ›
        </button>
      </div>

      {/* Spent this month vs Income headline */}
      <Card>
        <div className="wmg-three-col">
          <div>
            <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>Spent this month</div>
            <div className="wmg-figure tone-rust">
              {txStatus === "loading" ? "…" : gbp(spentThisMonth)}
            </div>
          </div>
          <div>
            <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>Income</div>
            <div className="wmg-figure tone-sage">{gbp(totals.income)}</div>
          </div>
          <div>
            <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>Left</div>
            <div className="wmg-figure tone-paper">
              {txStatus === "loading" ? "…" : gbp(totals.income - spentThisMonth)}
            </div>
          </div>
        </div>
      </Card>

      {/* Last 6 months trend */}
      <Card style={{ marginTop: 12 }}>
        <div className="wmg-eyebrow" style={{ marginBottom: 10 }}>Last 6 months</div>
        {trendStatus === "loading" && <div className="wmg-sub">Looking at recent months…</div>}
        {trendStatus === "done" && (
          <>
            <div style={{ width: "100%", height: 110 }}>
              <ResponsiveContainer>
                <BarChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <RechartsTooltip
                    formatter={(v) => gbp(v)}
                    contentStyle={{ background: "var(--ink)", border: "0.5px solid var(--hair)", borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {trendData.map((m, i) => (
                      <Cell key={m.key} fill={i === trendData.length - 1 ? "var(--brand)" : "var(--brand-soft)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              {trendData.map((m) => (
                <div key={m.key} className="wmg-sub" style={{ fontSize: 10.5, flex: 1, textAlign: "center" }}>{m.label}</div>
              ))}
            </div>
            {trendLine && (
              <div className="wmg-sub" style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: "var(--paper)" }}>{trendLine}</div>
            )}
          </>
        )}
      </Card>

      {/* By category — Essential vs Lifestyle, same Essential headings as
          Overview's own income/outgoings list; Lifestyle is genuinely new,
          drawn from real bank categorisation for the selected month. */}
      <div className="wmg-section-title" style={{ marginTop: 18 }}>By category</div>

      <Card>
        <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Essential</div>
        {essentialRows.length === 0 && <div className="wmg-sub" style={{ fontSize: 12 }}>Nothing essential set up yet.</div>}
        {essentialRows.map((r) => (
          <BarRow key={r.name} label={r.name} value={r.value} max={essentialMax} tone="slate" formatter={gbp} />
        ))}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Lifestyle</div>
        {txStatus === "loading" && <div className="wmg-sub" style={{ fontSize: 12 }}>Looking at this month's spending…</div>}
        {txStatus === "done" && lifestyleRows.length === 0 && (
          <div className="wmg-sub" style={{ fontSize: 12 }}>No discretionary spending found for {monthLabel} yet.</div>
        )}
        {lifestyleRows.map((r) => (
          <button
            key={r.name}
            type="button"
            onClick={() => setSelectedCategory({ name: r.name, group: "lifestyle" })}
            style={{ display: "block", width: "100%", background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
          >
            <BarRow label={r.name} value={r.value} max={lifestyleMax} tone="coral" formatter={gbp} />
          </button>
        ))}
      </Card>

      {/* Pull latest from the bank — same escape hatch the old popout had. */}
      <button
        type="button"
        onClick={() => onNavigate?.("import")}
        className="wmg-onboard-skip"
        style={{ width: "100%", marginTop: 14 }}
      >
        🔄 Pull latest from my bank
      </button>

      {/* Ask your budget — same Premium gate and WebView-safe input
          layout (block + calc() width, not flex) already established
          on the old Budget tab, carried over unchanged. */}
      <Card style={{ marginTop: 12, marginBottom: 20 }}>
        <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>Ask your budget</div>
        <div className="wmg-sub" style={{ marginBottom: 10 }}>
          Ask anything about your own numbers — "how much did I spend on takeaways", "what's my biggest
          subscription" — answered from what's actually here, not general advice.
        </div>
        {!hasPremium && (askStatus === "idle" || askStatus === "locked") && (
          <PremiumGate
            subscriptionStatus={subscriptionStatus}
            onUpgrade={onUpgrade}
            text="Asking your budget a question is a Premium feature."
          />
        )}
        {hasPremium && (
          <>
            <div style={{ display: "block", width: "100%" }}>
              <input
                type="text"
                className="wmg-input"
                style={{ display: "inline-block", width: "calc(100% - 120px)", verticalAlign: "middle", minHeight: 44 }}
                placeholder="e.g. What's my biggest subscription?"
                value={askQuestion}
                onChange={(e) => setAskQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    askBudget();
                  }
                }}
                disabled={askStatus === "loading"}
              />
              <button
                className="wmg-btn-primary"
                style={{ display: "inline-block", width: 112, marginLeft: 8, verticalAlign: "middle", minHeight: 44, padding: "0 8px", fontSize: 14, fontWeight: 700 }}
                onClick={askBudget}
                disabled={askStatus === "loading" || !askQuestion.trim()}
              >
                {askStatus === "loading" ? "Asking…" : "Ask"}
              </button>
            </div>
            {askStatus === "locked" && (
              <div style={{ marginTop: 10 }}>
                <PremiumGate
                  subscriptionStatus={subscriptionStatus}
                  onUpgrade={onUpgrade}
                  text="Asking your budget a question is a Premium feature."
                />
              </div>
            )}
            {askStatus === "error" && (
              <div className="wmg-sub" style={{ marginTop: 10, color: "var(--rust)" }}>{askError}</div>
            )}
            {askStatus === "done" && askAnswer && (
              <div className="wmg-sub" style={{ marginTop: 10, color: "var(--paper)" }}>{askAnswer}</div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
